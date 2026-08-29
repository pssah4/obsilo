/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- File-level disable: interacts with external SDK / JSON / Obsidian internals where untyped 'any' values are unavoidable. Inputs are validated at boundaries via type guards or schema checks where security-relevant. */
import { Plugin, WorkspaceLeaf, Notice, TFile, TFolder, addIcon, Platform, MarkdownView, normalizePath } from 'obsidian';
import { formatHotkeyHint, formatSendSelectionToSidebarHotkeyHint } from './core/inline/HotkeyHint';
import { preWarmProviderConnection } from './api/warmup';
import { scheduleRecurring } from './util/scheduleRecurring';
import { ObsidianAgentSettings, DEFAULT_SETTINGS, BUILTIN_MCP_SERVERS, getModelKey, modelToLLMProvider, OKF_DEFAULTS, INCOMING_LINKS_DEFAULT_THRESHOLD } from './types/settings';
import type { CustomModel, ModelTier, ProviderConfig } from './types/settings';
import { resolveActiveModel, resolveActiveProvider, resolveAdvisorModel, resolveTierModel } from './core/routing/tierResolution';
import { migrateActiveModelsToProviders, type MigrationSummary } from './core/settings/migrations/activeModelsToProviders';
import {
    encryptProviderCredentialsInPlace,
    decryptProviderCredentialsInPlace,
} from './core/security/providerCredentialCrypto';
import { ModelDiscoveryService, type RawDiscoveredModel } from './core/routing/ModelDiscoveryService';
import { PriceCatalogService } from './core/pricing/PriceCatalogService';
import { estimateSpendUsd, setPricingConfig } from './core/pricing/ModelPricing';
import { resetUsageLedger } from './core/pricing/meteredCall';
import { InflightStore } from './core/agent/InflightStore';
import { LearnedCapsStore, registerLearnedCapsStore } from './core/agent/LearnedCapsStore';
import { BackgroundTaskRunner } from './core/background/BackgroundTaskRunner';
import { createBackgroundTaskExecutor } from './core/background/backgroundTaskExecutor';
import { fetchProviderModelLineup } from './ui/settings/testModelConnection';
import { AgentSidebarView, VIEW_TYPE_AGENT_SIDEBAR } from './ui/AgentSidebarView';
import { shouldRebuildSidebarLeaf } from './ui/sidebar/staleLeafGuard';
import { resolveActiveChatLeaf } from './ui/sidebar/resolveActiveChatLeaf';
import { InflightResumeClaims } from './ui/sidebar/inflightResumeClaim';
import { requestRateLimiter } from './api/RequestRateLimiter';
import { AgentSettingsTab, type TabId } from './ui/AgentSettingsTab';
import { ToolRegistry } from './core/tools/ToolRegistry';
import { sanitizeDirectoryEntry } from './core/tools/BaseTool';
import { SKILL_DESCRIPTION_PROMPT_CAP } from './core/skills/descriptionCaps';
import { ToolExecutionPipeline } from './core/tool-execution/ToolExecutionPipeline';
import { getPerformanceMarks } from './core/observability/PerformanceMarks';
import { IgnoreService, matchesObsidianExcluded } from './core/governance/IgnoreService';
import { OperationLogger } from './core/governance/OperationLogger';
import { GlobalFileService } from './core/storage/GlobalFileService';
import * as safeFs from './core/security/safeFs';
import { getPluginSkillsDir, getSelfAuthoredSkillsDir, getAgentDataDir, getInternalAgentFolderPath } from './core/utils/agentFolder';
import { SkillProvenanceStore } from './core/skills/SkillProvenanceStore';
import { SkillRegistryClient } from './core/skills/SkillRegistryClient';
import { isSafePathSegment } from './core/utils/safePathName';
import { resolveRunIntent } from './core/utils/runDeeplinkIntent';
import { confirmModal } from './ui/modals/PromptModal';
import { GlobalSettingsService, resolveVaultForcedWorkflow, resolveModeMcpOverrides } from './core/storage/GlobalSettingsService';
import { RefreshHub } from './core/events/RefreshHub';
import { GlobalMigrationService } from './core/storage/GlobalMigrationService';
// SyncBridge removed (FEATURE-1508: storage consolidated to vault-parent)
import { RulesLoader } from './core/context/RulesLoader';
import { WorkflowLoader } from './core/context/WorkflowLoader';
import { SkillsManager, loadableSkills } from './core/context/SkillsManager';
import { enabledSelfAuthoredNames } from './core/skills/skillToggleGate';
import { GitCheckpointService } from './core/checkpoints/GitCheckpointService';
import { SemanticIndexService } from './core/semantic/SemanticIndexService';
import { EmbeddingService } from './core/memory/EmbeddingService';
import { VaultOperatorEmbeddingProvider } from './core/memory/VaultOperatorEmbeddingProvider';
import { KnowledgeDB, WriterLockHeldError } from './core/knowledge/KnowledgeDB';
import { VectorStore } from './core/knowledge/VectorStore';
import { GraphStore } from './core/knowledge/GraphStore';
import { VaultRenameHandler } from './core/knowledge/VaultRenameHandler';
import { SnapshotJob, type SnapshotTarget } from './core/persistence/SnapshotJob';
import { OntologyStore } from './core/knowledge/OntologyStore';
import { CommunityDetectionService } from './core/knowledge/CommunityDetectionService';
import { VaultHealthService, buildHealthCheckOptions } from './core/knowledge/VaultHealthService';
// BA-25 Karpathy-Wiki-Pattern (PLAN-10..14)
import { NoteSummaryStore } from './core/knowledge/NoteSummaryStore';
import { FrontmatterPropertyStore } from './core/knowledge/FrontmatterPropertyStore';
import { ClusterMetadataStore } from './core/knowledge/ClusterMetadataStore';
import type { ClusterMetadataRecord } from './core/knowledge/ClusterMetadataStore';
import { countDueNotesByCluster } from './core/health/clusterDueCounts';
import { selectDueClusters, type ClusterFreshnessInput } from './core/health/ClusterFreshnessPriority';
import { DEFAULT_FRESHNESS_SETTINGS } from './types/settings';
import { ClusterSourceStatsStore } from './core/knowledge/ClusterSourceStatsStore';
import { IngestSessionStore } from './core/ingest/IngestSessionStore';
import { IngestTriageLogStore } from './core/ingest/IngestTriageLogStore';
import { FrontmatterIndexer } from './core/ingest/FrontmatterIndexer';
import { sanitizeVaultContentForLLM } from './core/memory/sanitizeVaultContentForLLM';
import { AutoTriggerObserver } from './core/ingest/AutoTriggerObserver';
import { TopHubBlockGenerator, type TopHubBlockState } from './core/memory/TopHubBlockGenerator';
import { Stufe3PeriodicJob, ClusterMetadataStatePersistence, type Stufe3RunResult } from './core/health/Stufe3PeriodicJob';
import { renderFreshnessReport, FRESHNESS_REPORT_PATH } from './core/health/freshnessReport';
import { Stufe2ActivityTrigger } from './core/health/Stufe2ActivityTrigger';
import { FreshnessOrchestrator } from './core/health/FreshnessOrchestrator';
import { FreshnessFrontmatterPatcher } from './core/health/FreshnessFrontmatterPatcher';
import { FrontmatterWriter } from './core/ingest/FrontmatterWriter';
import { FreshnessQueryBuilder } from './core/health/FreshnessQueryBuilder';
import { FreshnessVerifier } from './core/health/FreshnessVerifier';
import { FreshnessWebSearch } from './core/health/FreshnessWebSearch';
import { LlmVerifierProvider } from './core/health/LlmVerifierProvider';
import { NoteFreshnessHistoryStore } from './core/health/NoteFreshnessHistoryStore';
import { NoteSelector } from './core/health/NoteSelector';
import { isFrontierZdrEnabled } from './core/health/ZdrCapabilityResolver';
import { FrontmatterBackfillJob } from './core/ingest/FrontmatterBackfillJob';
import { buildSummaryGenerator } from './core/ingest/SummaryGenerator';
import { DEFAULT_VAULT_INGEST_SETTINGS } from './types/settings';
import { GraphExtractor } from './core/knowledge/GraphExtractor';
import { ImplicitConnectionService } from './core/knowledge/ImplicitConnectionService';
import { MemoryDB } from './core/knowledge/MemoryDB';
import { RerankerService } from './core/knowledge/RerankerService';
import { ChatHistoryService } from './core/ChatHistoryService';
import { ConversationStore } from './core/history/ConversationStore';
import { runHistoryRepair } from './core/history/historyRepairJob';
import { MemoryService } from './core/memory/MemoryService';
import { ExtractionQueue } from './core/memory/ExtractionQueue';
import { SingleCallProcessor } from './core/memory/SingleCallProcessor';
import { MemoryV2Telemetry } from './core/memory/MemoryV2Telemetry';
import { DriftEventBus } from './core/memory/DriftEventBus';
import { TokenBudgetGuard } from './core/memory/TokenBudgetGuard';
import { generateSoakReport } from './core/memory/SoakReport';
import { McpClient } from './core/mcp/McpClient';
import { DeviceLocalStore, createDeviceLocalStore } from './core/storage/DeviceLocalStore';
import { pruneUntouchedSeededBuiltinsInPlace } from './core/mcp/connectorCatalog';
import { encryptMcpOAuthInPlace, decryptMcpOAuthInPlace } from './core/security/mcpOAuthCrypto';
import { VaultDNAScanner } from './core/skills/VaultDNAScanner';
import { SkillRegistry } from './core/skills/SkillRegistry';
import { CapabilityGapResolver } from './core/skills/CapabilityGapResolver';
import { buildApiHandler, buildApiHandlerForModel } from './api/index';
import type { ApiHandler } from './api/types';
import type { ToolUse, ToolCallbacks } from './core/tools/types';
import { BUILT_IN_MODES } from './core/modes/builtinModes';
import { mergeDefaultPrompts } from './core/prompts/defaultPrompts';
import { initI18n, t, getActiveLocale } from './i18n';
import { loadInstalledLocalePack, activeLocaleSpec, LOCALE_LABELS } from './i18n/localePacks';
import { OptionalAssetManager } from './core/assets/OptionalAssetManager';
import type { SupportedLocale } from './i18n';
import { SafeStorageService } from './core/security/SafeStorageService';
import { GitHubCopilotAuthService } from './core/security/GitHubCopilotAuthService';
import { ChatGptOAuthService } from './core/auth/ChatGptOAuthService';
import { KiloAuthService } from './core/security/KiloAuthService';
import { setGlobalModeStoreFs } from './core/modes/GlobalModeStore';
import { RecipeStore } from './core/mastery/RecipeStore';
import { RecipeMatchingService } from './core/mastery/RecipeMatchingService';
import { EpisodicExtractor } from './core/mastery/EpisodicExtractor';
import { RecipePromotionService } from './core/mastery/RecipePromotionService';
import { ConsoleRingBuffer } from './core/observability/ConsoleRingBuffer';
import { setDebugLogging } from './core/observability/log';
import { SelfAuthoredSkillLoader } from './core/skills/SelfAuthoredSkillLoader';
import { migrateLegacySkillsIfNeeded } from './core/skills/SkillMigration';
import { BuiltinSkillMaterializer } from './core/skills/BuiltinSkillMaterializer';
import { SkillSnapshotService } from './core/skills/SkillSnapshotService';
import { SkillWriteInterceptor } from './core/skills/SkillWriteInterceptor';
import { BUNDLED_SKILLS } from './_generated/bundled-skills';
import type { ISandboxExecutor } from './core/sandbox/ISandboxExecutor';
import { createSandboxExecutor } from './core/sandbox/createSandboxExecutor';
import { EsbuildWasmManager } from './core/sandbox/EsbuildWasmManager';
import { DynamicToolLoader } from './core/tools/dynamic/DynamicToolLoader';
import { drainBootJobs, type BootJob } from './core/boot/bootJobQueue';
import { waitWhileBusy, BACKGROUND_STARVATION_MS, BACKGROUND_POLL_MS } from './core/semantic/agentBusyGate';
import { EmbeddedSourceManager } from './core/self-development/EmbeddedSourceManager';
import { PluginBuilder } from './core/self-development/PluginBuilder';
import { PluginReloader } from './core/self-development/PluginReloader';

/**
 * Obsidian Agent Plugin
 *
 * An agentic operating layer for Obsidian that provides:
 * - Approval-based vault operations
 * - Local checkpoints with restore capability
 * - MCP (Model Context Protocol) support
 * - Semantic search and indexing
 * - Multiple agent modes
 *
 * Architecture:
 * - Tool Execution Pipeline: Central governance for all operations
 * - Shadow Checkpoint System: isomorphic-git based version control
 * - MCP Integration: External tool extensibility
 * - Semantic Index: Local vector search
 */

// REF-12: extractUrlsFromText + countIndependentDomains moved into
// src/core/health/Stufe3Hooks.ts alongside the only call site (Stufe-3
// web update pass). Re-exported here for backwards compatibility with any
// test that may have imported them from main.
export { extractUrlsFromText, countIndependentDomains } from './core/health/Stufe3Hooks';

export default class ObsidianAgentPlugin extends Plugin {
    // obsidian 1.13.0 declared `settings` on the base Plugin class; we
    // override with our typed settings, hence the `declare` modifier.
    declare settings: ObsidianAgentSettings;
    toolRegistry: ToolRegistry;
    apiHandler: ApiHandler | null = null;
    /**
     * EPIC-33: Inline-Editor-AI-Actions service. Instantiated by
     * wireInlineActions() once the apiHandler and tool registry are
     * ready. Disposed in onunload.
     */
    inlineActions: import('./core/inline/PluginWiring').InlineWiringResult | null = null;
    /**
     * EPIC-26 / FEAT-26-04: when a one-shot migration ran during onload
     * its summary lives here until the sidebar consumes it for the
     * notification modal. Cleared after first display.
     */
    pendingMigrationSummary: MigrationSummary | null = null;
    /**
     * EPIC-26 / FEAT-26-02: discovery service for provider model lists.
     * Wired in onload after settings load. ProvidersTab consumes it.
     */
    modelDiscovery: ModelDiscoveryService | null = null;
    /**
     * FEAT-44-02a (session scope): grant keys the user approved "for this
     * session". Lives on the plugin instance so every pipeline (parent,
     * subtasks, the next task) sees the same set without explicit sharing.
     * Deliberately in-memory only: NEVER persisted, dies with plugin reload.
     * config/self-modify can never enter it (guarded at the insert in
     * ToolExecutionPipeline.askOrDeny and by the alwaysAsk lookup order).
     */
    readonly sessionApprovedGrants = new Set<import('./core/tools/toolEffects').ApprovalGrantKey>();
    /**
     * FEAT-44-07 (kill switch, part a): in-memory revocation epoch for
     * run-scope grants. The run sets live per task inside the pipelines,
     * which the settings tab cannot reach; bumping this counter makes every
     * pipeline clear its (shared) run set lazily on the next approval check.
     * In-memory on purpose: run grants themselves never survive a reload.
     */
    approvalRevocationEpoch = 0;
    ignoreService: IgnoreService;
    operationLogger: OperationLogger;
    checkpointService: GitCheckpointService;
    rulesLoader: RulesLoader;
    workflowLoader: WorkflowLoader;
    skillsManager: SkillsManager;
    semanticIndex: SemanticIndexService | null = null;
    embeddingService: EmbeddingService | null = null;
    knowledgeDB: KnowledgeDB | null = null;
    vectorStore: VectorStore | null = null;
    graphStore: GraphStore | null = null;
    vaultRenameHandler: VaultRenameHandler | null = null;
    snapshotJob: SnapshotJob | null = null;
    snapshotTargets: SnapshotTarget[] = [];
    graphExtractor: GraphExtractor | null = null;
    implicitConnectionService: ImplicitConnectionService | null = null;
    ontologyStore: OntologyStore | null = null;
    communityDetectionService: CommunityDetectionService | null = null;
    vaultHealthService: VaultHealthService | null = null;
    memoryDB: MemoryDB | null = null;
    // BA-25 Karpathy-Wiki-Pattern stores and services
    noteSummaryStore: NoteSummaryStore | null = null;
    frontmatterPropertyStore: FrontmatterPropertyStore | null = null;
    clusterMetadataStore: ClusterMetadataStore | null = null;
    clusterSourceStatsStore: ClusterSourceStatsStore | null = null;
    ingestSessionStore: IngestSessionStore | null = null;
    ingestTriageLogStore: IngestTriageLogStore | null = null;
    /** FEAT-03-25 / ADR-109: Vault-zu-Memory-Bruecke-Tabellenzugriff. */
    memorySourceStore: import('./core/knowledge/MemorySourceStore').MemorySourceStore | null = null;
    frontmatterIndexer: FrontmatterIndexer | null = null;
    autoTriggerObserver: AutoTriggerObserver | null = null;
    topHubBlockGenerator: TopHubBlockGenerator | null = null;
    /**
     * FIX-19-01-03: set true while the Vault Health repair pass is
     * mutating frontmatter. The global vault.on('modify') listener
     * skips its synchronous `graphExtractor.extractFile(file)` call
     * during the window so it cannot read the STALE metadataCache
     * and overwrite the freshly-inserted reverse edges. The repair
     * orchestrator owns its own extractAll/extractFile sequence
     * once the cache has settled.
     */
    vaultHealthRepairInProgress = false;
    stufe3PeriodicJob: Stufe3PeriodicJob | null = null;
    private stufe3IntervalHandle: import('./util/scheduleRecurring').RecurringHandle | null = null;
    /** FEAT-19-19: Stufe-2 Activity-Trigger fuer Light-Web-Search-Update-Hints. */
    stufe2ActivityTrigger: Stufe2ActivityTrigger | null = null;
    /** FEAT-03-26: cached state for cooldown-decision and ContextComposer-Hook. */
    topHubBlockState: TopHubBlockState | null = null;
    topHubBlockMarkdown: string = '';
    /** FEAT-19-09 wiring: indexer-event listener cleanup callbacks. */
    private frontmatterIndexerListeners: Array<() => void> = [];
    historyDB: import('./core/knowledge/HistoryDB').HistoryDB | null = null;
    historyIndexer: import('./core/memory/HistoryIndexer').HistoryIndexer | null = null;
    rerankerService: RerankerService | null = null;
    bundleLoader: import('./core/assets/BundleLoader').BundleLoader | null = null;
    mcpBridge: { start(): Promise<void>; stop(): void; running: boolean; tunnelUrl: string | null; remoteConnected: boolean; remoteConnecting: boolean; deployedWorkerVersion: string | null; startTunnel(onUrl?: (url: string | null) => void): void; stopTunnel(): void; connectRelay(): void; disconnectRelay(): void; getToolsWithContext(): unknown[]; buildResourceList(): unknown[] } | null = null;
    private autoIndexDebounceTimers = new Map<string, number>();
    /** FEAT-03-26 Lifecycle: Debounce-Timer fuer Top-Hub-Block Regen bei Ontology-Changes. */
    private topHubBlockRegenTimer: number | null = null;
    private warmupFired = false;
    private cloudProviderWarningShown = false;
    chatHistoryService: ChatHistoryService | null = null;
    conversationStore: ConversationStore | null = null;
    memoryService: MemoryService | null = null;
    extractionQueue: ExtractionQueue | null = null;
    memoryV2Telemetry: MemoryV2Telemetry | null = null;
    /** IMP-03-18-01: Daily-Scheduler-Tick fuer AgingService. */
    private agingSchedulerHandle: import('./util/scheduleRecurring').RecurringHandle | null = null;
    /** FIX-23-01-01: Living-Document state for Cross-Surface MCP. */
    activeMcpSessions: import('./core/memory/ActiveMcpSessions').ActiveMcpSessions | null = null;
    private activeMcpSessionsEvictHandle: import('./util/scheduleRecurring').RecurringHandle | null = null;
    /** AUDIT-015 M-1: Sliding-window MCP Rate-Limiter. */
    mcpRateLimiter: import('./mcp/McpRateLimiter').McpRateLimiter | null = null;
    private mcpRateLimiterCleanupHandle: import('./util/scheduleRecurring').RecurringHandle | null = null;
    driftBus: DriftEventBus | null = null;
    tokenBudget: TokenBudgetGuard | null = null;
    mcpClient: McpClient;
    /** FEAT-04-13 / ADR-168: device-local (non-synced) store for stdio MCP
     *  server configs + per-device spawn trust. Created in onload. */
    deviceLocalStore: DeviceLocalStore | null = null;
    vaultDNAScanner: VaultDNAScanner | null = null;
    skillRegistry: SkillRegistry | null = null;
    capabilityGapResolver: CapabilityGapResolver | null = null;
    settingsTab: AgentSettingsTab | null = null;
    /** Reentrancy guard for obsidian://vault-operator-run: set the moment a
     *  deeplink run is accepted, held until the started run has flipped a
     *  sidebar view to busy. Blocks a second (foreign) trigger from overlapping
     *  a run or slipping in as a mid-run steering nudge (2026-07-05 follow-up). */
    private skillRunPending = false;
    recipeStore: RecipeStore | null = null;
    recipeMatchingService: RecipeMatchingService | null = null;
    episodicExtractor: EpisodicExtractor | null = null;
    recipePromotionService: RecipePromotionService | null = null;
    safeStorage: SafeStorageService;
    globalFs: GlobalFileService;
    /** IMP-41-03-01: inflight snapshot store for crash recovery. */
    inflightStore: InflightStore | null = null;
    /**
     * FEAT-55-01 (EPIC-55, ADR-169): the chat leaf the user most recently
     * focused. With parallel chat sessions this is what vault-wide actions
     * (send-selection, deep-link, mark-for-memory, programmatic send,
     * onboarding) target instead of the first leaf. Tracked via an
     * active-leaf-change listener; resolved through resolveActiveChatLeaf
     * with a getMostRecentLeaf / first-leaf fallback. Weakly held so a
     * closed leaf does not leak; the resolver drops it when detached.
     */
    private lastActiveChatLeaf: WorkspaceLeaf | null = null;
    /**
     * FEAT-55-04 (ADR-171): plugin-level boot-recovery ownership. Each
     * interrupted-run snapshot is offered for resume in exactly one chat
     * leaf; the first leaf to claim a taskId wins so N restored leaves do
     * not each render a card for the same snapshot.
     */
    readonly inflightResumeClaims = new InflightResumeClaims();
    /**
     * FEAT-55-04 (ADR-171): plugin-once guard for the locale-pack consent
     * card. Without it, N restored chat leaves each show the same card on
     * boot. The first leaf to show it sets this; the others skip.
     */
    localePackCardShownThisBoot = false;
    /**
     * FEAT-55-01 (user request 2026-07-25): conversationIds that currently
     * have an interrupted-task snapshot. Filled from the boot recovery scan
     * and refreshed by refreshInterruptedConversations(); History reads it
     * synchronously to tag resumable chats. A cache (not a live async call)
     * so row rendering stays sync.
     */
    readonly interruptedConversationIds = new Set<string>();

    /**
     * PERF 2026-07-25: heavy startup work, drained one job at a time by
     * enqueueBootJob instead of all firing in one onLayoutReady tick.
     */
    private readonly bootJobs: BootJob[] = [];
    private bootJobsScheduled = false;
    /** True once onLayoutReady has fired, so late jobs can start their own drain. */
    private bootJobsLayoutReady = false;
    /** Guards against two drains running the queue at the same time. */
    private bootJobsDraining = false;

    /** FEAT-55-01: recompute the interrupted-conversation cache from the store. */
    async refreshInterruptedConversations(): Promise<void> {
        try {
            const recoverable = await this.inflightStore?.listRecoverable() ?? [];
            this.interruptedConversationIds.clear();
            for (const s of recoverable) {
                if (s.conversationId) this.interruptedConversationIds.add(s.conversationId);
            }
        } catch (e) {
            console.debug('[InflightStore] refreshInterrupted failed (non-fatal):', e);
        }
    }
    /** ADR-148: output caps learned from provider max_tokens rejections. */
    learnedCapsStore: LearnedCapsStore | null = null;
    /**
     * FEAT-24-12: live price catalog. A field, not a boot-local const: the
     * settings tab shows when it was last fetched and offers a manual refresh,
     * and both need the instance that actually holds the catalog.
     */
    priceCatalog: PriceCatalogService | null = null;
    /** IMP-41-03-05: single-slot background research task runner. */
    backgroundTaskRunner: BackgroundTaskRunner | null = null;
    globalSettingsService: GlobalSettingsService | null = null;
    /** IMP-02-12-01: cross-surface refresh channel for the forced-workflow chip. */
    readonly forcedWorkflowHub = new RefreshHub();
    // syncBridge removed (FEATURE-1508)
    ringBuffer: ConsoleRingBuffer;
    /** FIX-PERF-39: central scheduler. Jobs migrate over time. */
    backgroundJobs: import('./core/background/BackgroundJobCoordinator').BackgroundJobCoordinator | null = null;
    /** FIX-PERF-29: central vault-event dispatcher with self-write suppression. */
    vaultEventDispatcher: import('./core/vault-events/VaultEventDispatcher').VaultEventDispatcher | null = null;
    selfAuthoredSkillLoader: SelfAuthoredSkillLoader | null = null;
    /** Provenance authority. Set during onload; the registry installer stamps through it. */
    skillProvenance: SkillProvenanceStore | null = null;
    /** Registry client, cached here so the fetched catalogue survives a settings rerender. */
    skillRegistryClient: SkillRegistryClient | null = null;
    skillSnapshotService: SkillSnapshotService | null = null;
    skillWriteInterceptor: SkillWriteInterceptor | null = null;
    sandboxExecutor: ISandboxExecutor | null = null;
    esbuildWasmManager: EsbuildWasmManager | null = null;
    dynamicToolLoader: DynamicToolLoader | null = null;
    embeddedSourceManager: EmbeddedSourceManager | null = null;
    pluginBuilder: PluginBuilder | null = null;
    pluginReloader: PluginReloader | null = null;

    // ── Chat-Linking: deferred frontmatter stamping (ADR-022) ────────────
    /** Paths written by the agent, grouped by conversationId. Flushed on conversation end. */
    pendingChatLinks = new Map<string, Set<string>>();

    /** Track a written .md path for deferred chat-link stamping. */
    trackChatLinkPath(conversationId: string, path: string): void {
        if (!path.endsWith('.md')) return;
        // FEAT-07-06 (Issue #72): never stamp a note the user excluded. This
        // sits at the single entry point of the automatic path, so it covers
        // the pipeline and every write tool that reaches it in one place, next
        // to the .md rule it belongs with. The manual "link this note" action
        // stays unfiltered on purpose -- that is an explicit user decision.
        // Reused matcher, not a second pattern dialect; the IgnoreService
        // itself is deliberately NOT consulted, because its rules are access
        // rules and an excluded template must stay editable.
        const excluded = this.settings.chatLinking?.excludedPaths;
        if (excluded && excluded.length > 0 && matchesObsidianExcluded(path, excluded)) return;
        let paths = this.pendingChatLinks.get(conversationId);
        if (!paths) {
            paths = new Set();
            this.pendingChatLinks.set(conversationId, paths);
        }
        paths.add(path);
    }

    /**
     * Stamp chat-links into frontmatter for all pending paths of a conversation.
     * Idempotent: can be called multiple times (e.g. after fallback title, then again after semantic title).
     * Does NOT clear pending paths — call clearPendingChatLinks() for that.
     */
    async flushPendingChatLinks(conversationId: string): Promise<void> {
        const paths = this.pendingChatLinks.get(conversationId);
        if (!paths || paths.size === 0 || !this.settings.chatLinking?.enabled) return;

        const store = this.conversationStore;
        const meta = store?.list().find((m: { id: string }) => m.id === conversationId);
        const title = meta?.title || 'Chat';
        const uri = `obsidian://vault-operator-chat?id=${encodeURIComponent(conversationId)}`;
        const link = `[${title}](${uri})`;

        for (const p of paths) {
            const file = this.app.vault.getAbstractFileByPath(p);
            if (!(file instanceof TFile) || file.extension !== 'md') continue;
            try {
                await this.app.fileManager.processFrontMatter(file, (fm) => {
                    const links: string[] = fm['chats'] ?? [];
                    const idx = links.findIndex((l: string) => l.includes(conversationId));
                    if (idx >= 0) {
                        links[idx] = link;
                    } else {
                        links.push(link);
                    }
                    fm['chats'] = links;
                });
            } catch (e) {
                // FIX-11: YAML parse errors happen when agent writes frontmatter values
                // with unquoted special chars (colons, brackets). Log concisely and skip.
                const msg = e instanceof Error ? e.message : String(e);
                if (msg.includes('YAML') || msg.includes('mapping')) {
                    console.warn(`[ChatLink] Skipping ${p} — invalid frontmatter (YAML parse error)`);
                } else {
                    console.warn(`[ChatLink] Failed to stamp ${p}:`, e);
                }
            }
        }
    }

    /** Remove pending chat-link paths for a conversation (called on conversation clear/switch). */
    clearPendingChatLinks(conversationId: string): void {
        this.pendingChatLinks.delete(conversationId);
    }

    /**
     * Plugin initialization
     *
     * Lifecycle:
     * 1. Load settings
     * 2. Initialize core services
     * 3. Register UI views
     * 4. Register commands
     * 5. Initialize MCP connections
     * 6. Start semantic indexing
     */
    /**
     * Resolves when doLoad() has populated settings + ModeService. The view's
     * onOpen awaits this before reading any plugin state so it cannot race
     * with layout-restore (BUG-026, 2026-04-19).
     */
    readyPromise!: Promise<void>;

    /**
     * FIX-PERF-28 (Welle 3): two-stage readiness.
     *   shellReady     -> settings + ModeService construction done; sidebar
     *                     can render its shell (input box, send button,
     *                     mode dropdown). Resolves much earlier than
     *                     readyPromise on a cold boot.
     *   servicesReady  -> alias for readyPromise for now; will split into
     *                     per-subsystem promises in follow-up commits
     *                     (knowledgeReady, memoryReady, semanticReady, etc).
     * Public surface is still internal-only in 3.x per decision 4.
     */
    shellReady!: Promise<void>;
    servicesReady!: Promise<void>;
    private markShellReady!: () => void;

    /**
     * FIX-PERF-28d: per-subsystem readiness promises. Each resolves at
     * the moment its subsystem becomes safe to use. AgentTask.run and
     * other consumers can `await plugin.semanticReady` instead of
     * blocking on the full servicesReady when they only need that one
     * subsystem. Same internal-only contract as shellReady (Decision 4).
     */
    knowledgeReady!: Promise<void>;
    semanticReady!: Promise<void>;
    memoryReady!: Promise<void>;
    skillsReady!: Promise<void>;
    mcpReady!: Promise<void>;
    private markKnowledgeReady!: () => void;
    private markSemanticReady!: () => void;
    private markMemoryReady!: () => void;
    private markSkillsReady!: () => void;
    private markMcpReady!: () => void;

    onload(): void {
        // EPIC-42: resolve the UI locale from the Obsidian app language before
        // anything renders. No plugin-side language setting; a language change
        // reloads the app, so once per load is enough.
        initI18n();

        // FEAT-29-11 follow-up: register the Lucide "toolbox" SVG under the
        // same icon id so setIcon('toolbox', ...) renders on Obsidian builds
        // whose bundled Lucide does not yet ship it (added upstream in
        // v0.288, end of 2023). Idempotent: re-registering does nothing on
        // newer builds. The svg-content path data is the canonical Lucide
        // toolbox glyph, scaled to the 100-unit viewBox addIcon expects.
        addIcon(
            'toolbox',
            '<path d="M92 45.83v25a8.33 8.33 0 0 1-8.33 8.34H16.67A8.33 8.33 0 0 1 8.33 70.83v-25" fill="none" stroke="currentColor" stroke-width="8.33" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M92 45.83H8.33" fill="none" stroke="currentColor" stroke-width="8.33" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M66.67 45.83V33.33a8.33 8.33 0 0 0-8.34-8.33H41.67a8.33 8.33 0 0 0-8.34 8.33v12.5" fill="none" stroke="currentColor" stroke-width="8.33" stroke-linecap="round" stroke-linejoin="round"/>',
        );

        // BUG-026 (2026-04-19): create the readiness promise BEFORE registerView.
        // Obsidian instantiates the view the moment registerView runs (to restore
        // saved layout), which in a BRAT hot reload is before doLoad() has loaded
        // settings or the mode service. Reading plugin.settings.currentMode at
        // that point threw and left the sidebar broken. The view awaits this
        // promise in its onOpen.
        let markReady: () => void = () => {};
        this.readyPromise = new Promise<void>((resolve) => { markReady = resolve; });
        // FIX-PERF-28: shellReady fires earlier (after settings + migration
        // flush) so the sidebar can render its input shell without waiting
        // on KnowledgeDB / Memory / Semantic / MCP. servicesReady aliases
        // readyPromise during the 3.x stabilization period.
        this.shellReady = new Promise<void>((resolve) => { this.markShellReady = resolve; });
        this.servicesReady = this.readyPromise;
        // FIX-PERF-28d: per-subsystem promises. Each resolves at the
        // point its subsystem becomes safe to use.
        this.knowledgeReady = new Promise<void>((resolve) => { this.markKnowledgeReady = resolve; });
        this.semanticReady = new Promise<void>((resolve) => { this.markSemanticReady = resolve; });
        this.memoryReady = new Promise<void>((resolve) => { this.markMemoryReady = resolve; });
        this.skillsReady = new Promise<void>((resolve) => { this.markSkillsReady = resolve; });
        this.mcpReady = new Promise<void>((resolve) => { this.markMcpReady = resolve; });
        // Backstop: if a subsystem fails to construct, its promise must
        // still resolve so consumers do not hang. doLoad's finally
        // resolves any still-unresolved subsystem promise.
        void this.readyPromise.finally(() => {
            this.markKnowledgeReady();
            this.markSemanticReady();
            this.markMemoryReady();
            this.markSkillsReady();
            this.markMcpReady();
        });

        // Register view SYNCHRONOUSLY so Obsidian can restore saved layout
        // immediately — before any async initialization runs.
        // ModeService uses lazy toolRegistry access, so the view is safe
        // to construct even before doLoad() finishes; the view waits on
        // readyPromise before reading any plugin state.
        this.registerView(
            VIEW_TYPE_AGENT_SIDEBAR,
            (leaf) => new AgentSidebarView(leaf, this)
        );

        // MEAS-01: span around the async boot work. Resolves at the same
        // point readyPromise resolves, so the duration equals the visible
        // boot latency for any consumer that waits on readyPromise.
        const perfMarks = getPerformanceMarks();
        perfMarks.start('plugin.boot');

        void this.doLoad()
            .catch((err) => {
                console.error('[Boot] doLoad threw before completion:', err);
            })
            .finally(() => {
                perfMarks.end('plugin.boot', { log: true });
                markReady();
            });
    }

    private async doLoad(): Promise<void> {
        // 0. ConsoleRingBuffer — install FIRST so all subsequent logs are captured
        this.ringBuffer = new ConsoleRingBuffer(500);
        // FIX-PERF-39: central background scheduler. Migrating jobs over.
        const { BackgroundJobCoordinator } = await import('./core/background/BackgroundJobCoordinator');
        this.backgroundJobs = new BackgroundJobCoordinator();
        // FIX-PERF-29: central vault-event dispatcher. Consumers migrate over.
        const { VaultEventDispatcher } = await import('./core/vault-events/VaultEventDispatcher');
        this.vaultEventDispatcher = new VaultEventDispatcher(this.app.vault);
        this.ringBuffer.install();

        console.debug('Loading Vault Operator plugin');

        // 0-pre-pre. safeFs allowlist. Every fs operation in the plugin goes
        // through src/core/security/safeFs.ts; this initialise call defines
        // the five categories of paths the plugin is allowed to touch. See
        // REVIEWER_NOTES.md for the threat model and FEAT-28-01 for the spec.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- one-time path/os import for safeFs allowlist construction; the rest of the plugin uses safeFs and not direct fs
        const nodePath = require('path') as typeof import('path');
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- one-time os import for safeFs allowlist construction
        const nodeOs = require('os') as typeof import('os');
        const safeFsVaultRoot = (this.app.vault.adapter as unknown as { getBasePath?(): string }).getBasePath?.() ?? '';
        const homeDir = nodeOs.homedir();
        const appData = process.env.APPDATA ?? '';
        const desktopConfigDirs = [
            nodePath.join(homeDir, '.config', 'Claude'),
            nodePath.join(homeDir, 'Library', 'Application Support', 'Claude'),
            appData ? nodePath.join(appData, 'Claude') : '',
            nodePath.join(homeDir, '.obsidian-agent'),
            nodePath.join(homeDir, 'vault-operator-shared'),
        ].filter((p): p is string => p.length > 0);
        // Fallback: when vaultBasePath is unavailable (mobile, headless,
        // FileSystemAdapter missing) the plugin still needs SOME root the
        // wrapper can validate against. Use the home dir as a coarse fallback;
        // the plugin is desktop-only so this path is rare.
        const effectiveVaultRoot = safeFsVaultRoot || homeDir;
        const vaultParent = safeFsVaultRoot ? nodePath.dirname(safeFsVaultRoot) : homeDir;
        safeFs.initialize({
            vaultRoot: effectiveVaultRoot,
            pluginDataDir: nodePath.join(effectiveVaultRoot, this.app.vault.configDir, 'plugins', this.manifest.id),
            agentConfigDir: nodePath.join(effectiveVaultRoot, '.obsilo-vault'),
            systemTempDir: nodeOs.tmpdir(),
            desktopConfigDirs,
            extraRoots: [
                // Cross-vault shared dir lives at {vault-parent}/<name>/ (FEATURE-1508).
                // Fresh installs use `vault-operator-shared`; legacy names are
                // detected at runtime by GlobalFileService and kept in place.
                nodePath.join(vaultParent, 'vault-operator-shared'),
                nodePath.join(vaultParent, 'obsilo-shared'),
                nodePath.join(vaultParent, '.obsidian-agent'),
            ],
        });

        // 0-pre. Rebrand migration: the plugin id changed from `obsilo-agent` to
        // `vault-operator` (the Obsidian community-plugin review bot rejects any
        // name that starts with "Obsi"). Obsidian loads the plugin from the new
        // `<configDir>/plugins/vault-operator/` folder, which has no data.json on
        // the first launch after the rename, so all settings/credentials would
        // reset. Copy the legacy data.json over once, before anything reads it.
        // The agent-data folder (`.obsilo-vault`, vault-parent `obsilo-shared`)
        // keeps its name — it is internal plumbing the user never sees and a
        // folder move carries real risk for no visible benefit.
        try {
            const cfg = this.app.vault.configDir;
            const adapter = this.app.vault.adapter;
            const newDataPath = `${this.manifest.dir ?? `${cfg}/plugins/${this.manifest.id}`}/data.json`;
            const legacyDataPath = `${cfg}/plugins/vault-operator/data.json`;
            if (!(await adapter.exists(newDataPath)) && (await adapter.exists(legacyDataPath))) {
                await adapter.write(newDataPath, await adapter.read(legacyDataPath));
                console.debug(`[Plugin] Rebrand migration: copied data.json from legacy plugin folder obsilo-agent -> ${this.manifest.id}`);
            }
        } catch (e) {
            console.warn('[Plugin] Rebrand data.json migration failed (non-fatal):', e);
        }

        // 0a. Initialize SafeStorageService (must happen before loadSettings)
        this.safeStorage = new SafeStorageService();

        // 0a-bis. BundleLoader for office / pdfjs Optional Assets. Has no
        // side effects on construction; first .load*Bundle() call goes to
        // OptionalAssetManager. Tools that need exceljs/docx/pptxgenjs/
        // pdfjs-dist read through this loader.
        const { BundleLoader } = await import('./core/assets/BundleLoader');
        this.bundleLoader = new BundleLoader(this);

        // 0b. Pre-init folder rename: legacy `.obsidian-agent` -> `obsilo-vault`
        //     (vault-local) and `.obsidian-agent` -> `obsilo-shared` (vault-parent).
        //     Must run BEFORE GlobalFileService points at the new global path,
        //     otherwise the service would create a fresh empty folder beside
        //     the unrenamed legacy data.
        const vaultBasePath = (this.app.vault.adapter as unknown as { getBasePath?(): string }).getBasePath?.() ?? '';
        // Peek at the persisted settings BEFORE loadSettings() so the
        // GlobalFileService constructor below can land directly on the
        // consolidated layout when FEAT-29-01 is already complete. Without
        // this peek the constructor probes for legacy folders, lands on
        // `obsilo-shared/`, and every `saveSettings()` call between here and
        // the post-migration `useVaultLocalRoot()` hop (~10 calls during
        // boot) writes into the stale legacy folder — which then shadows
        // the newer values from `.vault-operator/data/settings.json` on the
        // next reload (latent setting-loss bug).
        let savedFolderPath: string | undefined;
        let savedLayoutMigrationStatus: string | undefined;
        // ADR-162-Guard: true wenn ein per Sync angekommenes 'complete'-Flag
        // auf diesem Geraet als fremd erkannt wurde (Legacy-Bestand ohne
        // konsolidiertes data-Root). Haelt den Boot auch dann konsistent,
        // wenn der korrigierende saveData-Write fehlschlaegt.
        let adr162GuardTripped = false;
        try {
            const rawSaved = await this.loadData() as Record<string, unknown> | null;
            savedFolderPath = typeof rawSaved?.agentFolderPath === 'string'
                ? rawSaved.agentFolderPath
                : undefined;
            savedLayoutMigrationStatus = typeof rawSaved?._layoutMigrationStatus === 'string'
                ? rawSaved._layoutMigrationStatus
                : undefined;
            const { migrateFolderRename } = await import('./core/utils/migrateFolderRename');
            const renameReport = await migrateFolderRename(this.app, vaultBasePath, savedFolderPath);
            if (renameReport.vaultLocalRenamed || renameReport.globalRenamed) {
                console.debug('[Plugin] Folder rename migrated:', renameReport);
            }

            // ADR-162 / FIX-30-07-04: Fresh-install fast-path. Ohne jeden
            // Legacy-Bestand gibt es nichts zu migrieren; der Status wird
            // direkt auf 'complete' gesetzt, damit GlobalFileService (unten)
            // von Anfang an auf {vault}/.vault-operator/data/ zeigt statt
            // dauerhaft auf dem Legacy-Layout im Vault-Parent zu landen.
            // Jeder Legacy-Treffer laesst den Opt-in-Migrationspfad unberuehrt.
            if (vaultBasePath) {
                const { detectLegacyLayoutPresence } = await import('./core/utils/migrateAgentLayout');
                const vaultParentDir = nodePath.dirname(vaultBasePath);
                if (savedLayoutMigrationStatus !== 'complete') {
                    const hasLegacy = detectLegacyLayoutPresence({
                        vaultBasePath,
                        vaultParent: vaultParentDir,
                    });
                    if (!hasLegacy) {
                        const folderForHint = savedFolderPath ?? '.vault-operator';
                        const persisted = rawSaved ?? {};
                        persisted._layoutMigrationStatus = 'complete';
                        if (typeof persisted.agentFolderPath !== 'string') {
                            persisted.agentFolderPath = folderForHint;
                        }
                        await this.saveData(persisted);
                        // Erst NACH erfolgreichem Persist uebernehmen: wirft
                        // saveData, bleibt dieser Boot konsistent auf dem
                        // Legacy-Hint (Review-Finding Split-Brain).
                        savedLayoutMigrationStatus = 'complete';
                        savedFolderPath = folderForHint;
                        console.debug('[VaultOperator] ADR-162 fresh-install fast-path: no legacy roots found, layout marked complete');
                    }
                } else {
                    // ADR-162-Guard (Review-Finding, High): 'complete' kann per
                    // Obsidian-Sync/iCloud von einem ANDEREN Geraet stammen,
                    // waehrend dieses Geraet noch unmigrierten Legacy-Bestand
                    // hat. Diskriminator: ein lokal wirklich migrierter (oder
                    // fast-gepfadeter) Vault hat das konsolidierte data-Root;
                    // fehlt es UND existiert echter Legacy-Bestand, ist das
                    // Flag fremd. Dann gilt auf diesem Geraet wieder 'pending'
                    // (Legacy-Layout bleibt aktiv, Migrations-Section sichtbar).
                    const consolidatedFolder = savedFolderPath ?? '.vault-operator';
                    // Zuerst die billige Ein-Aufruf-Probe (Review-Finding
                    // Effizienz): ist das data-Root da, ist das Flag echt und
                    // die teure Legacy-Kette entfaellt.
                    let dataRootExists = true;
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-require-imports -- one-time fs probe for the ADR-162 sync guard; same pattern as the md5-backup probe below
                        const nodeFs = require('fs') as typeof import('fs');
                        dataRootExists = nodeFs.existsSync(
                            nodePath.join(vaultBasePath, consolidatedFolder, 'data'),
                        );
                    } catch {
                        // Probe-Fehler: Flag im Zweifel respektieren (kein Guard).
                    }
                    // consolidatedFolder ausschliessen (Review-Finding #16):
                    // das eigene '.vault-operator' des konsolidierten Vaults
                    // darf NICHT als Legacy-Treffer zaehlen, sonst wird eine
                    // frisch fast-gepfadete Installation mit cache/ aber ohne
                    // data/ faelschlich auf 'pending' zurueckgestuft.
                    const hasLegacy = !dataRootExists && detectLegacyLayoutPresence({
                        vaultBasePath,
                        vaultParent: vaultParentDir,
                        consolidatedFolder,
                    });
                    if (hasLegacy && !dataRootExists) {
                        savedLayoutMigrationStatus = undefined;
                        adr162GuardTripped = true;
                        try {
                            const persisted = rawSaved ?? {};
                            persisted._layoutMigrationStatus = 'pending';
                            await this.saveData(persisted);
                        } catch {
                            // Non-fatal: der In-Memory-Override nach loadSettings
                            // haelt diesen Boot trotzdem konsistent.
                        }
                        console.debug('[VaultOperator] ADR-162 guard: synced complete-flag without local consolidated data root; treating layout as pending on this device');
                    }
                }
            }
        } catch (e) {
            console.warn('[Plugin] Folder rename migration failed (non-fatal):', e);
        }

        // 0c. Global file service — points at the consolidated vault-local
        // data root when the layout migration is complete, otherwise probes
        // the legacy vault-parent folders (vault-operator-shared / obsilo-shared
        // / .obsidian-agent) to preserve existing user data.
        const layoutHint = (savedFolderPath && savedLayoutMigrationStatus === 'complete')
            ? { agentFolderPath: savedFolderPath, layoutMigrationStatus: 'complete' as const }
            : undefined;
        this.globalFs = new GlobalFileService(vaultBasePath, layoutHint);
        this.globalSettingsService = new GlobalSettingsService(this.globalFs, this.safeStorage);
        // Share the GlobalFileService with GlobalModeStore (consolidates all global I/O)
        setGlobalModeStoreFs(this.globalFs);

        // 1. Load settings (merges global + vault-local)
        await this.loadSettings();

        // The level layer is off until the user opts in, so hot paths (stream
        // events, indexing, tool steps) stay out of the console and out of the
        // ring buffer. Set right after the settings are known, before the rest
        // of the boot chain starts logging.
        setDebugLogging(this.settings.debugMode);

        // ADR-162-Guard-Nachlauf: falls der korrigierende Persist oben
        // fehlschlug, traegt loadSettings noch das fremde 'complete'.
        // In-Memory auf 'pending' zwingen, damit der spaetere
        // useVaultLocalRoot-Block nicht auf das nicht-migrierte Root zeigt
        // und der naechste saveSettings den Zustand persistiert.
        if (adr162GuardTripped && this.settings._layoutMigrationStatus === 'complete') {
            this.settings._layoutMigrationStatus = 'pending';
            this.markSettingsDirty();
        }

        // 1a. Settings consolidation after the folder rename: rewrite any
        //     known legacy default to the current default so VaultTab and
        //     consumers using getAgentFolderPath() pick it up. Custom paths
        //     are untouched.
        if (this.settings.agentFolderPath === '.obsidian-agent'
            || this.settings.agentFolderPath === 'obsilo-vault') {
            this.settings.agentFolderPath = '.obsilo-vault';
            // FIX-PERF-04: defer to flushSettings() after the migration chain
            this.markSettingsDirty();
        }

        // 1a-bis. AUDIT-034 M-5 / M-15 -- surface the plaintext-fallback
        //         state via a one-time toast Notice when the OS keychain
        //         is unavailable. The persistent banner in ProvidersTab
        //         carries the long-form explanation; this toast only fires
        //         once per session and is suppressed entirely once the user
        //         dismissed the banner (acknowledged flag in settings).
        this.safeStorage.notifyPlaintextFallbackOnce(
            Notice,
            this.settings.safeStoragePlaintextFallbackAcknowledged === true,
        );

        // 1a-orphan. FIX-19-01-12 -- drop the legacy `Inbox/Orphans/` exclude
        //     prefix. It only ever made sense together with the orphan
        //     move-repair, which is deleted: moving a note creates no incoming
        //     link, so the note stayed an orphan AND the prefix then hid it
        //     from the very check that would have reported it. Exact-match
        //     removal, guarded by a one-shot flag so a deliberate re-add sticks.
        try {
            if (!this.settings._orphanExcludeLegacyCleaned) {
                const prefixes = this.settings.vaultHealth?.orphanExcludePathPrefixes;
                if (Array.isArray(prefixes)) {
                    const cleaned = prefixes.filter((p) => p !== 'Inbox/Orphans/');
                    if (cleaned.length !== prefixes.length) {
                        this.settings.vaultHealth.orphanExcludePathPrefixes = cleaned;
                        console.debug('[Plugin] FIX-19-01-12: dropped legacy Inbox/Orphans/ exclude prefix');
                    }
                }
                this.settings._orphanExcludeLegacyCleaned = true;
                this.markSettingsDirty();
            }
        } catch (e) {
            console.warn('[Plugin] Orphan exclude-prefix migration failed (non-fatal):', e);
        }

        // 1a-verdict. W4 (IMP-19-01-03): deutsche Verdict-Literale im
        //     frontierSeverityFilter einmalig auf die englischen Werte
        //     uebersetzen, die der FreshnessVerifier vergleicht.
        try {
            if (!this.settings._freshnessVerdictLiteralsMigrated) {
                const filter = this.settings.freshness?.frontierSeverityFilter;
                if (Array.isArray(filter)) {
                    const { migrateVerdictLiterals } = await import('./core/health/knowledgeReviewGates');
                    const { migrated, changed } = migrateVerdictLiterals(filter);
                    if (changed) {
                        this.settings.freshness.frontierSeverityFilter = migrated as typeof filter;
                        console.debug('[Plugin] W4: verdict literals migrated to english values');
                    }
                }
                this.settings._freshnessVerdictLiteralsMigrated = true;
                this.markSettingsDirty();
            }
        } catch (e) {
            console.warn('[Plugin] Verdict-literal migration failed (non-fatal):', e);
        }

        // 1b. EPIC-26 / FEAT-26-04 / ADR-123 -- one-shot migration from
        //     legacy activeModels[] to providerConfigs[]. Idempotent (no-op
        //     when schemaVersion is already set or providerConfigs is non-empty).
        //     Anomalies are stashed for the MigrationNotificationModal which
        //     the sidebar opens on first display.
        try {
            const migration = migrateActiveModelsToProviders(this.settings);
            if (migration.didMigrate) {
                this.settings.providerConfigs = migration.providerConfigs;
                this.settings.activeProviderId = migration.activeProviderId;
                this.settings.legacy_active_models_backup = migration.legacyBackup;
                this.settings.schemaVersion = migration.schemaVersion;
                // EPIC-26 follow-up: after a successful migration, clear the
                // legacy `activeModels[]` and the per-mode model key map. The
                // new path reads from `providerConfigs[]` exclusively; leaving
                // the old arrays populated created duplicate state that the
                // user could not delete (delete a provider in the new tab,
                // legacy entry stayed, OAuth tokens stayed). Backup in
                // `legacy_active_models_backup` is the 30-day safety net.
                this.settings.activeModels = [];
                this.settings.activeModelKey = '';
                this.settings.modeModelKeys = {};
                // `helperModelKey` is now derived from the active provider's
                // fast tier (Stage 2 in getHelperModel). The legacy explicit
                // key would mask that fallback indefinitely.
                this.settings.helperModelKey = '';
                // FIX-PERF-04: batch with the rest of the migration chain
                this.markSettingsDirty();
                this.pendingMigrationSummary = migration.summary;
                console.debug(
                    `[Plugin] EPIC-26 migration: ${migration.summary.providersCreated} providers, `
                    + `${migration.summary.modelsClassified} models, `
                    + `${migration.summary.anomalies.length} anomalies; `
                    + 'legacy activeModels + activeModelKey + modeModelKeys + helperModelKey cleared',
                );
            }
        } catch (e) {
            // Non-fatal: keep legacy setup functional, log the failure.
            console.warn('[Plugin] EPIC-26 migration failed (non-fatal):', e);
        }

        // 1b-fixup. EPIC-26 follow-up: early-migration users got the lowercase
        // provider type as displayName (e.g. "openrouter", "github-copilot").
        // Replace with the human-readable brand label when the displayName
        // matches the type string. Idempotent.
        {
            const { getProviderBrandLabel } = await import('./types/settings');
            let changed = false;
            for (const p of this.settings.providerConfigs ?? []) {
                if (!p.displayName || p.displayName === p.type) {
                    p.displayName = getProviderBrandLabel(p.type);
                    changed = true;
                }
            }
            // FIX-PERF-04: batch with the rest of the migration chain
            if (changed) this.markSettingsDirty();
        }

        // 1b-orphan-purge. EPIC-26 follow-up #2: users who migrated under
        // earlier code and then removed an OAuth/gateway provider in the
        // new tab had no purge step, so their plugin-level OAuth tokens
        // lingered with no matching ProviderConfig. The next "Add
        // provider" flow then reported "Signed in" against the
        // orphan token. Idempotent: clears tokens whose provider type
        // is no longer represented in providerConfigs[]. Also clears
        // any leftover activeModels[] / activeModelKey / modeModelKeys
        // / helperModelKey if providerConfigs[] is already populated,
        // covering the case where migration ran under earlier code
        // that did not clear them.
        {
            const { purgeProviderLegacyState } = await import(
                './core/security/providerLegacyPurge'
            );
            const types: Array<'github-copilot' | 'chatgpt-oauth' | 'kilo-gateway'> = [
                'github-copilot', 'chatgpt-oauth', 'kilo-gateway',
            ];
            const before = JSON.stringify({
                gh: this.settings.githubCopilotAccessToken ?? '',
                cgpt: this.settings.chatgptOAuthAccessToken ?? '',
                kilo: this.settings.kiloToken ?? '',
                am: this.settings.activeModels?.length ?? 0,
            });
            for (const t of types) {
                purgeProviderLegacyState(this.settings, t);
            }
            if ((this.settings.providerConfigs ?? []).length > 0) {
                if ((this.settings.activeModels?.length ?? 0) > 0) {
                    this.settings.activeModels = [];
                }
                if (this.settings.activeModelKey) {
                    this.settings.activeModelKey = '';
                }
                if (Object.keys(this.settings.modeModelKeys ?? {}).length > 0) {
                    this.settings.modeModelKeys = {};
                }
                if (this.settings.helperModelKey) {
                    this.settings.helperModelKey = '';
                }
            }
            const after = JSON.stringify({
                gh: this.settings.githubCopilotAccessToken ?? '',
                cgpt: this.settings.chatgptOAuthAccessToken ?? '',
                kilo: this.settings.kiloToken ?? '',
                am: this.settings.activeModels?.length ?? 0,
            });
            if (before !== after) {
                // FIX-PERF-04: batch with the rest of the migration chain
                this.markSettingsDirty();
                console.debug('[Plugin] EPIC-26 orphan-purge: cleared stale legacy state');
            }
        }

        // 1b-openai-cleanup. EPIC-26 follow-up: early refreshes of OpenAI
        //     captured non-chat-completion modalities (realtime, tts, audio,
        //     image, search-preview, deep-research, *-pro, *-codex) because
        //     fetchProviderModels filtered them only by prefix. The tier
        //     classifier then mapped flagship to gpt-5.5-pro-* (Responses-API
        //     only) and Test Connection 404'd. Strip the polluted entries
        //     from discoveredModels, drop any tierMapping/tierOverrides slot
        //     that referenced one, and zero lastRefreshAt so the background
        //     refresh re-discovers the cleaned list. Idempotent: a clean
        //     state produces no changes.
        {
            const { isOpenAIChatCompletionModel } = await import(
                './ui/settings/testModelConnection'
            );
            let changed = false;
            for (const p of this.settings.providerConfigs ?? []) {
                if (p.type !== 'openai') continue;
                const before = p.discoveredModels?.length ?? 0;
                const cleaned = (p.discoveredModels ?? []).filter(
                    (m) => isOpenAIChatCompletionModel(m.id),
                );
                if (cleaned.length !== before) {
                    p.discoveredModels = cleaned;
                    p.lastRefreshAt = 0;
                    changed = true;
                }
                const validIds = new Set(cleaned.map((m) => m.id));
                for (const tier of ['flagship', 'mid', 'fast'] as const) {
                    const mapId = p.tierMapping?.[tier];
                    if (mapId && !validIds.has(mapId)) {
                        delete p.tierMapping?.[tier];
                        changed = true;
                    }
                    const ovrId = p.tierOverrides?.[tier];
                    if (ovrId && !isOpenAIChatCompletionModel(ovrId)) {
                        delete p.tierOverrides?.[tier];
                        changed = true;
                    }
                }
            }
            if (changed) {
                // FIX-PERF-04: batch with the rest of the migration chain
                this.markSettingsDirty();
                console.debug(
                    '[Plugin] EPIC-26 openai cleanup: stripped non-chat modalities '
                    + 'and stale tier slots; refreshOnStartup will re-discover',
                );
            }
        }

        // FIX-PERF-04: flush all batched migration-block dirty-marks in
        // one go. Migration blocks above call markSettingsDirty(); this
        // is the single save that replaces 5+ separate saveSettings()
        // calls. Idempotency-critical markers (parentDirMigrated,
        // pluginDataDirsMigrated, layoutMigrationStatus) keep their own
        // direct saveSettings() and are unaffected by this batching.
        await this.flushSettings();

        // FEAT-42-05: apply the installed language pack (if any) BEFORE the
        // shell is marked ready, so the sidebar renders translated on first
        // paint. English needs no pack. A missing/invalid pack for a non-en
        // locale leaves English active and schedules a one-time offer below.
        await this.applyLocalePackAtBoot();

        // FIX-PERF-28: shell is ready -- settings are loaded, migrations
        // have flushed, ModeService is constructible. The sidebar can
        // render its input shell now without waiting on KnowledgeDB,
        // Memory, Semantic, MCP. Heavy subsystems below still finish
        // before servicesReady resolves at the end of doLoad.
        this.markShellReady();

        // 1c. EPIC-26 / FEAT-26-02 -- ModelDiscoveryService for the new
        //     provider-only settings. Wraps fetchProviderModels with the
        //     classifier + 24h cache.
        this.modelDiscovery = new ModelDiscoveryService(
            {
                getProviderConfigs: () => this.settings.providerConfigs ?? [],
                saveProviderConfigs: async (next) => {
                    this.settings.providerConfigs = next;
                    await this.saveSettings();
                },
            },
            async (provider) => {
                // Build the bedrock-credentials object only for bedrock.
                const bedrockCreds = provider.type === 'bedrock' ? {
                    authMode: provider.awsAuthMode,
                    apiKey: provider.awsApiKey,
                    accessKey: provider.awsAccessKey,
                    secretKey: provider.awsSecretKey,
                    sessionToken: provider.awsSessionToken,
                    region: provider.awsRegion,
                } : undefined;
                // Review finding AL1 (2026-07-14): the lineup variant carries
                // its provenance in-band so ModelDiscoveryService can refuse
                // to persist a static fallback lineup (chatgpt-oauth) over
                // previously discovered live data on the auto-refresh paths.
                const lineup = await fetchProviderModelLineup(
                    provider.type,
                    provider.apiKey ?? '',
                    provider.baseUrl,
                    provider.apiVersion,
                    bedrockCreds,
                );
                // FIX-26-99-04: forward pricing + capability fields. The
                // OpenRouter branch of fetchProviderModels fills these in
                // (OpenRouter ships them inline with /v1/models); other
                // providers leave them undefined and ModelDiscoveryService
                // falls back to its built-in heuristics.
                const models = lineup.models.map((r): RawDiscoveredModel => ({
                    id: r.id,
                    displayName: r.label,
                    contextWindow: r.contextWindow,
                    maxOutputTokens: r.maxOutputTokens,
                    pricingPromptUsd: r.pricingPromptUsd,
                    pricingCompletionUsd: r.pricingCompletionUsd,
                }));
                return { models, source: lineup.source };
            },
        );
        // Refresh stale provider lists in the background -- non-blocking.
        if ((this.settings.providerConfigs ?? []).length > 0) {
            void this.modelDiscovery.refreshOnStartup().catch((e) =>
                console.warn('[Plugin] EPIC-26 startup discovery failed:', e),
            );
        }

        // 2. Initialize core services
        const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
        const pluginDataRoot = this.globalFs.getRoot();
        // checkpointsAbsPath and devEnvAbsPath are recomputed AFTER the FEAT-29-01
        // migration runs further down, because the migration may relocate both
        // caches from vault-parent/obsilo-shared/* to vault-local
        // .vault-operator/cache/*. The placeholder values here are only used by
        // the FEATURE-1508 / migratePluginDataDirs path which runs against the
        // pre-migration layout.
        let checkpointsAbsPath = `${pluginDataRoot}/checkpoints`;
        let devEnvAbsPath = `${pluginDataRoot}/dev-env`;

        // FEATURE-1508: One-time migration from ~/.obsidian-agent/ to {vault-parent}/.obsidian-agent/
        if (!this.settings._parentDirMigrated) {
            await this.migrateToParentDir(vaultBasePath).catch((e) =>
                console.warn('[Plugin] Storage migration failed (non-fatal):', e)
            );
            this.settings._parentDirMigrated = true;
            await this.saveData({ ...this.settings, _parentDirMigrated: true });
        }

        // 2026-05-19: Move large internal caches OUT of the vault. iCloud and
        // Obsidian Sync used to replicate <vault>/.obsidian/plugins/<id>/checkpoints
        // (often 100+ MB across thousands of git-object files) and dev-env/
        // (11 MB esbuild WASM) to every device, which stalled mobile startups.
        // Both now live next to GlobalFileService's root, outside the vault.
        // Idempotent and best-effort; failures degrade to a no-op.
        if (!this.settings._pluginDataDirsMigrated) {
            try {
                const { planPluginDataMigration, migratePluginDataDirs } =
                    await import('./core/utils/migratePluginDataDirs');
                const targets = planPluginDataMigration(
                    vaultBasePath,
                    this.app.vault.configDir,
                    this.manifest.id,
                    pluginDataRoot,
                );
                const report = await migratePluginDataDirs(targets);
                if (report.migrated > 0) {
                    console.debug('[Plugin] Moved plugin data dirs out of vault:', report);
                    new Notice(
                        t('notice.migration.cachesMoved', { count: report.migrated }),
                        6000,
                    );
                }
                const failed = report.entries.filter((e) => e.status === 'failed');
                if (failed.length > 0) {
                    console.warn('[Plugin] Plugin data dir migration partial failures:', failed);
                }
            } catch (e) {
                console.warn('[Plugin] Plugin data dir migration failed (non-fatal):', e);
            }
            this.settings._pluginDataDirsMigrated = true;
            await this.saveSettings();
        }

        // Legacy in-vault folder cleanup. Pre-FEATURE-1508 the plugin
        // experimented with .obsilo / .obsilo-sync / .obsidian/.obsilo
        // names. cleanupLegacyVaultDirs() handled them but only ran via
        // the migrateToParentDir branch when ~/.obsidian-agent had already
        // disappeared. For users where the legacy ~/.obsidian-agent still
        // exists alongside, that branch never fired. Run it directly,
        // gated by an idempotent flag.
        if (!this.settings._legacyVaultDirsCleaned) {
            await this.cleanupLegacyVaultDirs().catch((e) =>
                console.warn('[Plugin] Legacy vault dir cleanup failed (non-fatal):', e)
            );
            this.settings._legacyVaultDirsCleaned = true;
            await this.saveSettings();
        }

        // FEAT-29-01: Consolidate all plugin storage under {vault}/.vault-operator/
        // {data,cache}. Replaces the four legacy roots .obsidian-agent,
        // .obsilo-vault, .vault-operator (asset-cache), obsilo-shared. Idempotent
        // and resumable via _layoutMigrationStatus. See ADR-119 third iteration.
        //
        // OPT-IN gate: the migration is destructive and depends on a code-path
        // refactor (GlobalFileService, rulesLoader, workflowLoader, skillsManager
        // and other services point at obsilo-shared today; after the migration
        // they would fail to find their data). The trigger runs only when the
        // user has explicitly set _layoutMigrationOptIn=true in data.json or
        // via the Settings restore-action (PLAN-27 Task 5). Until then the
        // migration service ships but stays dormant.
        if (this.settings._layoutMigrationOptIn === true
            && this.settings._layoutMigrationStatus !== 'complete') {
            // Backup destination MUST be outside every migration source folder
            // (recursive self-copy bug -- 14 GB ENAMETOOLONG explosion observed
            // 2026-05-20) AND outside any sync container (iCloud-replicated
            // vaults would otherwise push a 288 MB knowledge.db clone to Apple
            // servers; M-1 in AUDIT-FEAT-29-01-2026-05-20.md). The home
            // directory satisfies both constraints. A vault-hash sub-folder
            // keeps multiple vaults on the same machine separate.
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- one-time crypto require to hash the vault path; not a security-sensitive hash
            const nodeCrypto = require('crypto') as typeof import('crypto');
            // AUDIT-034 Info-5: use sha256 instead of md5. Pure hygiene
            // (CodeQL/SonarQube re-flag MD5 every audit). 12-char slice keeps
            // the same path-bucket shape. For backward compatibility we still
            // probe the legacy md5 directory and prefer it when present so
            // existing migration backups stay accessible. New writes go to
            // the sha256 directory.
            const vaultIdInput = vaultBasePath || '__no_vault_path__';
            const vaultIdHash = nodeCrypto
                .createHash('sha256')
                .update(vaultIdInput)
                .digest('hex')
                .slice(0, 12);
            const legacyVaultIdHashMd5 = nodeCrypto
                .createHash('md5')
                .update(vaultIdInput)
                .digest('hex')
                .slice(0, 12);
            const sha256BackupDir = nodePath.join(
                homeDir,
                '.vault-operator-migration-backups',
                vaultIdHash,
            );
            const legacyMd5BackupDir = nodePath.join(
                homeDir,
                '.vault-operator-migration-backups',
                legacyVaultIdHashMd5,
            );
            let safeBackupDir = sha256BackupDir;
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports -- one-time fs require to probe legacy md5 backup dir
                const nodeFs = require('fs') as typeof import('fs');
                if (
                    !nodeFs.existsSync(sha256BackupDir)
                    && nodeFs.existsSync(legacyMd5BackupDir)
                ) {
                    safeBackupDir = legacyMd5BackupDir;
                }
            } catch {
                // Probe failure is non-fatal; fall through to the sha256 path.
            }
            // Cast-through-unknown legacy view so the deprecated property
            // access in the migration path does not trigger
            // `@typescript-eslint/no-deprecated`. The bot rejects every
            // `eslint-disable` of that rule (Tier 4); breaking the type
            // chain via `as unknown as { ... }` keeps the back-compat read
            // working without a directive. AUDIT-2.13.x follow-up.
            const legacySettings = this.settings as unknown as {
                chatHistoryFolder?: string;
            };
            console.debug('[VaultOperator] storage layout migration trigger entered', {
                optIn: this.settings._layoutMigrationOptIn,
                status: this.settings._layoutMigrationStatus,
                agentFolderPath: this.settings.agentFolderPath,
                chatHistoryFolder: legacySettings.chatHistoryFolder,
                vaultBasePath,
                vaultParent,
                safeBackupDir,
            });
            new Notice(t('notice.migration.layoutStarting'), 6000);
            try {
                const { migrateAgentLayout } = await import('./core/utils/migrateAgentLayout');
                const knownLegacyDefaults = ['.obsidian-agent', '.obsilo-vault', 'obsilo-vault', '.vault-operator'];
                const isLegacyDefault = knownLegacyDefaults.includes(this.settings.agentFolderPath ?? '');
                const chatHistoryFolderLegacyValue = legacySettings.chatHistoryFolder?.trim() ?? '';
                console.debug('[VaultOperator] migrateAgentLayout calling', {
                    isLegacyDefault,
                    chatHistoryFolderLegacyValue,
                });
                const report = await migrateAgentLayout({
                    vaultBasePath,
                    vaultParent,
                    pluginDataDir: safeBackupDir,
                    agentFolderPath: this.settings.agentFolderPath ?? '',
                    chatHistoryFolder: legacySettings.chatHistoryFolder ?? '',
                    currentStatus: this.settings._layoutMigrationStatus ?? 'pending',
                    setStatus: async (status) => {
                        this.settings._layoutMigrationStatus = status;
                        await this.saveSettings();
                    },
                });
                // Phase 8 (settings-update): flip the agentFolderPath default
                // when it was a known legacy default, capture the legacy
                // chatHistoryFolder for the post-migration notice, then mark complete.
                // NOTE: agentFolderPath stays at the .vault-operator ROOT (not the
                // /data sub-folder) so the existing helpers (getPluginSkillsDir,
                // getTmpRoot, getSelfAuthoredSkillsDir, getVaultDnaPath) can append
                // the correct data/ or cache/ sub-folder via their FEAT-29-01
                // layout-aware logic in agentFolder.ts.
                if (isLegacyDefault) {
                    this.settings.agentFolderPath = '.vault-operator';
                }
                if (chatHistoryFolderLegacyValue) {
                    this.settings._chatHistoryFolderLegacy = chatHistoryFolderLegacyValue;
                    legacySettings.chatHistoryFolder = '';
                }
                this.settings._layoutMigrationStatus = 'complete';
                await this.saveSettings();
                // FEAT-29-01: GlobalFileService now points at the consolidated
                // vault-local data root. Re-point before any service that
                // depends on globalFs initialises (rulesLoader, workflowLoader,
                // skillsManager, memory, history all run next).
                this.globalFs.useVaultLocalRoot(this.settings.agentFolderPath ?? '.vault-operator');
                console.debug('[VaultOperator] migrateAgentLayout returned', report);
                if (report.phases.length > 0) {
                    new Notice(
                        t('notice.migration.layoutDone', { backupPath: report.backupPath ?? t('notice.migration.backupNone') }),
                        8000,
                    );
                } else {
                    new Notice(t('notice.migration.layoutNoWork'), 5000);
                }
            } catch (e) {
                console.error('[VaultOperator] storage layout migration failed:', e);
                new Notice(
                    t('notice.migration.layoutFailed', { error: e instanceof Error ? e.message : String(e) }),
                    15000,
                );
            }
        } else {
            console.debug('[VaultOperator] storage layout migration trigger NOT entered', {
                optIn: this.settings._layoutMigrationOptIn,
                status: this.settings._layoutMigrationStatus,
            });
        }

        // FEAT-29-01: ensure GlobalFileService points at the consolidated
        // vault-local layout on every reload after migration completed (not
        // just the boot that ran the migration). Idempotent.
        if (this.settings._layoutMigrationStatus === 'complete') {
            this.globalFs.useVaultLocalRoot(this.settings.agentFolderPath ?? '.vault-operator');
            // Recompute the cache-side absolute paths so GitCheckpointService
            // and EsbuildWasmManager (instantiated further down) read from the
            // consolidated cache folder rather than the legacy vault-parent
            // location. The migration physically moved both folders in
            // phase 5; without this recompute the services would point at
            // empty legacy paths.
            const cacheRoot = `${vaultBasePath}/${this.settings.agentFolderPath ?? '.vault-operator'}/cache`;
            checkpointsAbsPath = `${cacheRoot}/checkpoints`;
            devEnvAbsPath = `${cacheRoot}/dev-env`;

            // One-shot notice for users who had chatHistoryFolder configured
            // before the setting was removed. Defers to after layout-ready so
            // the modal renders on top of an initialised workspace.
            const legacyChatHistoryFolder = this.settings._chatHistoryFolderLegacy;
            if (legacyChatHistoryFolder) {
                this.app.workspace.onLayoutReady(() => {
                    void (async () => {
                        const { openChatHistoryFolderRemovedModal } = await import(
                            './ui/modals/ChatHistoryFolderRemovedModal'
                        );
                        await openChatHistoryFolderRemovedModal(this.app, {
                            legacyPath: legacyChatHistoryFolder,
                        });
                        this.settings._chatHistoryFolderLegacy = undefined;
                        await this.saveSettings();
                    })();
                });
            }
        }

        // Governance: ignore/protected path rules. FIX-44-24: pass the agent
        // folder root so its config zone (settings, mcp config, provenance
        // manifest) is write-protected against the agent's own vault tools.
        this.ignoreService = new IgnoreService(this.app.vault, getInternalAgentFolderPath(this));
        await this.ignoreService.load(this.settings.respectObsidianExcludedFiles ?? true);

        // Rules loader (Sprint 3.2) — now uses global storage
        this.rulesLoader = new RulesLoader(this.globalFs);
        await this.rulesLoader.initialize();

        // Workflow loader (Sprint 3.3) — now uses global storage
        this.workflowLoader = new WorkflowLoader(this.globalFs);
        await this.workflowLoader.initialize();

        // Skills manager (Sprint 3.4) — now uses global storage
        this.skillsManager = new SkillsManager(this.globalFs);
        await this.skillsManager.initialize();
        // FIX-PERF-28d: skills subsystem promise resolves here.
        this.markSkillsReady();

        // VaultDNA: auto-discover plugins as skills (PAS-1)
        // Create scanner/registry immediately so references exist,
        // but defer the actual scan to onLayoutReady so all community
        // plugins have registered their commands in app.commands.
        if (this.settings.vaultDNA.enabled) {
            this.vaultDNAScanner = new VaultDNAScanner(this.app, this.app.vault, this);
            this.skillRegistry = new SkillRegistry(
                this.vaultDNAScanner,
                this.settings.vaultDNA.skillToggles,
                getPluginSkillsDir(this),
            );
            this.capabilityGapResolver = new CapabilityGapResolver(
                this.vaultDNAScanner,
            );
            this.app.workspace.onLayoutReady(async () => {
                await this.vaultDNAScanner!.initialize().catch((e) =>
                    console.warn('[Plugin] VaultDNA scanner init failed (non-fatal):', e)
                );
                // FEAT-29-03: event-driven re-sync trigger. workspace.layout-change
                // fires on most UI-driven settings activations (including plugin
                // enable/disable), so we coalesce them into a debounced
                // immediate-sync call. Sub-second responsiveness without
                // hammering the diff loop on every layout flicker.
                let layoutChangeTimer: number | null = null;
                this.registerEvent(this.app.workspace.on('layout-change', () => {
                    if (layoutChangeTimer !== null) window.clearTimeout(layoutChangeTimer);
                    layoutChangeTimer = window.setTimeout(() => {
                        layoutChangeTimer = null;
                        void this.vaultDNAScanner?.triggerImmediateSync().catch((e) =>
                            console.warn('[Plugin] VaultDNA immediate-sync failed (non-fatal):', e),
                        );
                    }, 200);
                }));
            });
        }

        // FEAT-55-01 (ADR-169): track the most recently focused chat leaf so
        // vault-wide actions target it instead of the first leaf. Registered
        // unconditionally (not gated on the vaultDNA block) so it always runs.
        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            if (leaf?.view instanceof AgentSidebarView) {
                this.lastActiveChatLeaf = leaf;
            }
        }));

        // Governance: persistent operation log + checkpoints
        this.operationLogger = new OperationLogger(this.globalFs);
        await this.operationLogger.initialize();

        // Checkpoints (isomorphic-git shadow repo).
        // Lives outside the vault (see migratePluginDataDirs.ts) to keep
        // iCloud / Obsidian Sync from replicating 100+ MB of git objects.
        this.checkpointService = new GitCheckpointService(
            this.app,
            this.app.vault,
            checkpointsAbsPath,
            this.settings.checkpointTimeoutSeconds,
            this.settings.checkpointAutoCleanup,
        );
        if (this.settings.enableCheckpoints) {
            await this.checkpointService.initialize().catch((e) =>
                console.warn('[Plugin] Checkpoint service init failed (non-fatal):', e)
            );
        }

        // MCP Client — connect to all configured servers.
        // AUDIT-034 M-14: the SSRF guard runs inside McpClient.connect() and
        // reads the per-server `allowLocalUrls` flag off each McpServerConfig.
        // No global opt-in is needed here; the McpTab modal manages the flag
        // per server.
        // FEAT-04-13 / ADR-168: device-local store for stdio configs + trust.
        // Desktop only (needs Node fs/os); on mobile it stays null and the
        // stdio path is unreachable anyway.
        this.deviceLocalStore = Platform.isDesktopApp ? createDeviceLocalStore(this.safeStorage) : null;

        this.mcpClient = new McpClient({
            // FEAT-04-10: OAuth connectors open the system browser for the
            // authorization redirect and persist the resulting tokens.
            openExternal: (url) => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell only loadable via dynamic require in the renderer
                const electron = require('electron') as { shell?: { openExternal: (u: string) => Promise<void> } };
                if (electron.shell?.openExternal) {
                    void electron.shell.openExternal(url);
                } else {
                    window.open(url);
                }
            },
            persistOAuth: () => { void this.saveSettings(); },
            // FEAT-04-13: spawn trust is checked per device against the local store.
            isStdioTrusted: (name: string, fingerprint?: string) => this.deviceLocalStore?.isTrusted(name, fingerprint) ?? false,
            // FEAT-04-13: stdio env secrets are stored encrypted; decrypt right
            // before spawn (passthrough for plaintext / non-secret values).
            decryptSecret: (v: string) => this.safeStorage.decrypt(v),
        });
        // FIX-PERF-28d: mcp client constructed; consumers can begin
        // requesting servers via this.mcpClient. Actual server
        // connections come later but the client API surface exists.
        this.markMcpReady();
        // stdio servers live in the device-local store, not in synced settings;
        // merge them in so the boot connect covers both transports.
        const stdioServers = this.deviceLocalStore?.listStdioServers() ?? {};
        const allMcpServers = { ...(this.settings.mcpServers ?? {}), ...stdioServers };
        if (Object.keys(allMcpServers).length > 0) {
            this.mcpClient.connectAll(allMcpServers).catch((e) =>
                console.warn('[Plugin] MCP connect failed (non-fatal):', e)
            );
        }

        // Sandbox + Dynamic Modules (Phase 3) — lazy initialization (ADR-021: OS-level isolation).
        // esbuild WASM cache lives outside the vault (see migratePluginDataDirs.ts).
        this.sandboxExecutor = createSandboxExecutor(this, this.settings.sandboxMode);
        this.esbuildWasmManager = new EsbuildWasmManager(this, devEnvAbsPath);
        this.dynamicToolLoader = new DynamicToolLoader(this);

        // Self-Authored Skills (Phase 2+3: unified skills with optional code modules)
        this.selfAuthoredSkillLoader = new SelfAuthoredSkillLoader(
            this, this.esbuildWasmManager, this.sandboxExecutor,
        );

        // Core Self-Modification (Phase 4) -- source bundle is an
        // optional download (Phase 2.2). load() is fire-and-forget:
        // first manage_source call awaits it via ensureLoaded.
        this.embeddedSourceManager = new EmbeddedSourceManager(this);
        void this.embeddedSourceManager.load().catch((e) =>
            console.debug('[Plugin] Source bundle load deferred:', e),
        );
        this.pluginBuilder = new PluginBuilder(this.esbuildWasmManager, this.embeddedSourceManager);
        this.pluginReloader = new PluginReloader(this);

        // Tool registry (ToolExecutionPipeline created per-task)
        this.toolRegistry = new ToolRegistry(
            this, this.mcpClient, this.ringBuffer, this.selfAuthoredSkillLoader,
            this.sandboxExecutor, this.esbuildWasmManager, this.dynamicToolLoader,
            this.embeddedSourceManager, this.pluginBuilder, this.pluginReloader,
        );

        // Late-bind ToolRegistry to SelfAuthoredSkillLoader (circular dependency)
        this.selfAuthoredSkillLoader.setDependencies(
            this.esbuildWasmManager, this.sandboxExecutor, this.toolRegistry,
        );

        // FEATURE-2201: one-time migration from legacy `.obsilo-sync/skills/` to
        // the configurable agent-folder (ADR-072). Idempotent via `.migrated` marker.
        await migrateLegacySkillsIfNeeded(this).then((report) => {
            if (report && (report.migratedSlugs.length > 0 || report.errors.length > 0)) {
                console.debug('[Plugin] Skill migration:', report);
            }
        }).catch((e) =>
            console.warn('[Plugin] Skill migration failed (non-fatal):', e)
        );

        // FEAT-29-11 Step B: materialize built-in skills to disk
        // (`data/skills/{name}/`) BEFORE the loader runs. The bundled skills
        // ship as a Record<name, Record<relPath, content>> generated by
        // esbuild and overwrite any prior builtin materialization. User
        // overrides (`source: user`) and plugin-managed skills
        // (`source: <plugin-id>`) win.
        try {
            const builtinMaterializer = new BuiltinSkillMaterializer(
                this.app.vault.adapter,
                getSelfAuthoredSkillsDir(this),
            );
            const report = await builtinMaterializer.materializeAll(BUNDLED_SKILLS);
            if (report.errors.length > 0 || report.skipped.length > 0 || report.written.length > 0) {
                console.debug('[Plugin] Builtin skill materialization:', report);
            }

            // FIX-44-05: reconcile the provenance manifest so the loader can tell
            // a genuinely materialized trusted skill from a forged `source: pro`.
            // The manifest lives in the protected config zone (not skills/), so a
            // sandboxed script cannot write it. Freshly written skills are
            // authoritative; a trusted entry whose skill left the bundle is
            // pruned (trust ends with bundle membership -- the folder stays and
            // resolves as `user`); everything else is preserved (ADR-152).
            const provenanceStore = new SkillProvenanceStore(
                this.app.vault.adapter,
                normalizePath(`${getAgentDataDir(this)}/skill-provenance.json`),
            );
            await provenanceStore.load();
            // The bundle, not the disk, decides what may be grandfathered after
            // a lost manifest. Passing the shipped skill names closes the
            // "plant a folder, delete the manifest, restart" bypass.
            await provenanceStore.reconcile(
                getSelfAuthoredSkillsDir(this),
                report.written,
                new Set(Object.keys(BUNDLED_SKILLS)),
            );
            this.selfAuthoredSkillLoader.setProvenanceStore(provenanceStore);
            // Kept on the plugin so the registry installer can stamp provenance
            // after a verified download (FEAT-31-02).
            this.skillProvenance = provenanceStore;
        } catch (e) {
            console.warn('[Plugin] Builtin skill materialization failed (non-fatal):', e);
        }

        // Load skills (includes cached code module tools)
        await this.selfAuthoredSkillLoader.loadAll().catch((e) =>
            console.warn('[Plugin] SelfAuthoredSkillLoader init failed (non-fatal):', e)
        );
        this.selfAuthoredSkillLoader.setupWatcher();

        // FEAT-29-09: Skill-Versioning. Snapshot service handles the
        // .versions/{id}/ folders, the write-interceptor monkey-patches
        // the vault adapter so every write into data/skills/{name}/ is
        // preceded by a snapshot (debounced 5s per skill).
        try {
            const skillsRoot = getSelfAuthoredSkillsDir(this);
            this.skillSnapshotService = new SkillSnapshotService(
                this.app.vault.adapter,
                skillsRoot,
            );
            this.skillWriteInterceptor = new SkillWriteInterceptor(
                this.app.vault.adapter,
                this.skillSnapshotService,
                skillsRoot,
            );
            this.skillWriteInterceptor.install();

            // One-time prune cycle per plugin load. Retention default = 20.
            const retention = this.settings.skillVersioning?.retentionCount ?? 20;
            void (async () => {
                if (!this.skillSnapshotService) return;
                try {
                    const listing = await this.app.vault.adapter.list(skillsRoot).catch(() => null);
                    if (!listing) return;
                    for (const sub of listing.folders) {
                        const name = sub.slice(skillsRoot.length + 1);
                        if (name.startsWith('.')) continue;
                        await this.skillSnapshotService.prune(name, retention).catch(() => {});
                    }
                } catch (e) {
                    console.debug('[Plugin] Skill-version prune cycle skipped:', e);
                }
            })();
        } catch (e) {
            console.warn('[Plugin] Skill-Versioning init failed (non-fatal):', e);
        }

        // Migrate legacy dynamic tools to unified skills
        if (this.dynamicToolLoader && this.selfAuthoredSkillLoader) {
            const migrated = await this.dynamicToolLoader.migrateToSkills(this.selfAuthoredSkillLoader).catch((e) => {
                console.warn('[Plugin] Dynamic tool migration failed (non-fatal):', e);
                return 0;
            });
            if (migrated > 0) {
                // Reload skills to pick up migrated tools
                await this.selfAuthoredSkillLoader.loadAll().catch((e) =>
                    console.warn('[Plugin] SelfAuthoredSkillLoader reload after migration failed (non-fatal):', e)
                );
            }
        }

        // Semantic index (Phase C2) — SQLite-backed via KnowledgeDB (ADR-050)
        if (this.settings.enableSemanticIndex) {
            // FEATURE-0507: pass the configurable agent folder so knowledge.db
            // lands under {agentFolderPath}/knowledge.db instead of the
            // hardcoded ".obsidian-agent/knowledge.db".
            //
            // FEAT-29-01: use the layout-aware data-dir helper so the file
            // resolves to .vault-operator/data/knowledge.db after migration,
            // and stays flat at .obsilo-vault/knowledge.db before. Without
            // this the post-migration boot would spawn an empty knowledge.db
            // at the legacy root path and the 288 MB migrated copy in data/
            // would never be loaded.
            const { getAgentDataDir } = await import('./core/utils/agentFolder');
            this.knowledgeDB = new KnowledgeDB(
                this.app.vault,
                pluginDir,
                'local', // FEATURE-1508: knowledge.db is vault-local (syncs with vault)
                'knowledge.db',
                undefined, // globalRoot — not used in local mode
                getAgentDataDir(this),
            );
            await this.knowledgeDB.open().catch((e) => {
                if (e instanceof WriterLockHeldError) {
                    new Notice(e.message, 10000);
                }
                console.warn('[Plugin] KnowledgeDB open failed (non-fatal):', e);
            });
            // FIX-PERF-28d: knowledge subsystem ready (DB open or
            // gracefully marked unavailable in the next block).
            this.markKnowledgeReady();
            // FIX-18: If open() failed, null out to prevent cascading "not opened" errors
            if (!this.knowledgeDB.isOpen()) {
                console.warn('[Plugin] KnowledgeDB not available — semantic features disabled for this session');
                this.knowledgeDB = null;
            }
            // Only create downstream stores if DB is available
            if (!this.knowledgeDB) {
                this.semanticIndex = null;
            } else {
            this.vectorStore = new VectorStore(this.knowledgeDB);
            this.graphStore = new GraphStore(this.knowledgeDB);
            this.ontologyStore = new OntologyStore(this.knowledgeDB, () => this.clusterMetadataStore);
            this.vaultRenameHandler = new VaultRenameHandler(this.knowledgeDB);
            // BA-25 Stores (knowledge.db v10 tables)
            this.noteSummaryStore = new NoteSummaryStore(this.knowledgeDB);
            this.frontmatterPropertyStore = new FrontmatterPropertyStore(this.knowledgeDB);
            this.clusterMetadataStore = new ClusterMetadataStore(this.knowledgeDB);
            this.clusterSourceStatsStore = new ClusterSourceStatsStore(this.knowledgeDB);
            this.ingestSessionStore = new IngestSessionStore(this.knowledgeDB);
            this.ingestTriageLogStore = new IngestTriageLogStore(this.knowledgeDB);
            // FrontmatterIndexer wires the per-note read-and-mirror hook (FEAT-15-09/10, FEAT-19-09).
            // SummaryGeneratorFn stays null until autoSummary feature is enabled in settings; the
            // indexer then only mirrors properties from frontmatter and adopts existing summaries.
            // FEAT-19-09: Auto-Summary-Generator-Hook (LLM via Memory-Model).
            // SummaryGenerator wird nur registriert wenn autoSummary.enabled.
            const ingestCfg = this.settings.vaultIngest ?? DEFAULT_VAULT_INGEST_SETTINGS;
            const summaryGenerator = ingestCfg.autoSummary.enabled
                ? buildSummaryGenerator({
                    promptTemplate: ingestCfg.summaryPrompt.template,
                    apiHandlerFactory: () => {
                        const model = this.getMemoryModel();
                        if (!model) return null;
                        try {
                            return buildApiHandlerForModel(model);
                        } catch (e) {
                            console.warn('[Plugin] SummaryGenerator API handler failed:', e);
                            return null;
                        }
                    },
                })
                : undefined;
            // FEAT-03-25 / ADR-109: MemorySourceStore + Bridge-Hook
            // initialisieren. Der Hook liest die Note und triggert
            // ExtractionQueue.enqueueImmediate, damit der bereits
            // existierende SingleCallProcessor die Facts extrahiert.
            // Best-effort: alles in eigenem try/catch -- Hook-Fehler
            // blockieren den Vault-Indexer niemals.
            if (this.memoryDB?.isOpen()) {
                const { MemorySourceStore } = await import('./core/knowledge/MemorySourceStore');
                this.memorySourceStore = new MemorySourceStore(this.memoryDB);
            }
            const memorySourceStore = this.memorySourceStore;
            // AUDIT-015 M-2: Prompt-Injection-Resistance fuer Vault-Notes.
            // Vault-Inhalte koennen unkontrolliert sein (Web-Imports, Notes
            // mit "ignore previous instructions"-Pattern, etc.). Wir
            // wrappen sie in deutlich abgegrenzte Marker, kappen die
            // Laenge auf 16k Chars und entschaerfen typische Injection-
            // Patterns. SingleCallProcessor sieht nur 'user'-content,
            // also bleibt das Risiko Surface-orientiert.
            const memorySourceHook = memorySourceStore
                ? async (input: { file: TFile; fromFrontmatter: boolean }) => {
                    if (!this.extractionQueue) return;
                    try {
                        const raw = await this.app.vault.cachedRead(input.file);
                        const sanitized = sanitizeVaultContentForLLM(raw, input.file.path);
                        const conversationId = `vault://${input.file.path}`;
                        await this.extractionQueue.enqueueImmediate({
                            conversationId,
                            messages: [{ role: 'user', text: sanitized }],
                            title: `Vault note: ${input.file.basename}`,
                            queuedAt: new Date().toISOString(),
                        });
                        memorySourceStore.markDirty(input.file.path);
                    } catch (e) {
                        console.debug(`[memory-source-hook] failed for ${input.file.path}:`, e);
                    }
                }
                : undefined;

            this.frontmatterIndexer = new FrontmatterIndexer(
                this.app,
                this.noteSummaryStore,
                this.frontmatterPropertyStore,
                {
                    autoSummaryEnabled: ingestCfg.autoSummary.enabled,
                    summaryGenerator,
                    memorySourceStore: memorySourceStore ?? undefined,
                    memorySourceHook,
                },
            );

            // FEAT-19-09 / FEAT-15-09 / FEAT-15-10: vault-event-Hooks fuer
            // FrontmatterIndexer (per-note Spiegel von Frontmatter und
            // optional Auto-Summary). Idempotent ueber mtime im Indexer.
            const indexerOnCreate = this.app.vault.on('create', (file) => {
                if (file instanceof TFile && file.extension === 'md' && this.frontmatterIndexer) {
                    void this.frontmatterIndexer.indexNote(file).catch(() => {});
                }
            });
            const indexerOnModify = this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md' && this.frontmatterIndexer) {
                    void this.frontmatterIndexer.indexNote(file).catch(() => {});
                }
            });
            this.frontmatterIndexerListeners.push(
                () => this.app.vault.offref(indexerOnCreate),
                () => this.app.vault.offref(indexerOnModify),
            );
            // TopHubBlockGenerator (FEAT-03-26) ist als Read-Only-Helper verfuegbar.
            // ContextComposer-Wiring kommt mit explizitem Setting-Toggle.
            this.topHubBlockGenerator = new TopHubBlockGenerator(
                this.knowledgeDB,
                this.noteSummaryStore,
            );
            this.communityDetectionService = new CommunityDetectionService(
                this.knowledgeDB, this.graphStore, this.ontologyStore,
            );
            this.semanticIndex = new SemanticIndexService(this.app.vault, this.knowledgeDB, this.vectorStore, {
                batchSize: this.settings.semanticBatchSize,
                embeddingBatchSize: 16,  // texts per API call -- batch for performance
                excludedFolders: this.settings.semanticExcludedFolders,
                indexPdfs: this.settings.semanticIndexPdfs,
                chunkSize: this.settings.semanticChunkSize ?? 2000,
                enableContextualRetrieval: this.settings.enableContextualRetrieval,
                // Issue #62: opt-in Ollama keep_alive for embeddings.
                embeddingKeepAlive: this.settings.embeddingKeepAlive,
                // AUDIT-013 follow-up: skip ignored notes at index build.
                isIgnored: (path: string) => this.ignoreService.isIgnored(path),
                // FIX-06-01-01: required so SemanticIndex can parse PDFs/DOCX via
                // parseDocument; without it the "not installed" placeholder would
                // land in the vector index.
                plugin: this,
            });
            // FIX-PERF-28d: semantic subsystem ready - consumers can
            // semanticSearch / runBackgroundEnrichment from here.
            this.markSemanticReady();
            const embeddingModel = this.getActiveEmbeddingModel();
            if (embeddingModel) this.semanticIndex.setEmbeddingModel(embeddingModel);
            // Contextual Retrieval: set API handler for prefix generation (FEATURE-1501)
            // FEAT-24-08 Welle A: resolver falls back to active-provider fast-tier
            // when no explicit `contextualModelKey` is set, so the feature stays
            // alive after the EPIC-26 migration to provider-only config.
            if (this.settings.enableContextualRetrieval) {
                const ctxModel = this.getContextualModel();
                if (ctxModel) {
                    const { buildApiHandlerForModel } = await import('./api/index');
                    this.semanticIndex.setContextualApiHandler(buildApiHandlerForModel(ctxModel));
                }
            }
            await this.semanticIndex.initialize().catch((e) =>
                console.warn('[Plugin] Semantic index init failed (non-fatal):', e)
            );
            // Memory v2 / FEATURE-0316 task 6: shared EmbeddingService backed by
            // SemanticIndexService.embedTexts. Phase 2+ engine modules (FactStore
            // embeddings, future history embeddings, Hybrid-Search Cosine signal)
            // route through this single Service instead of growing parallel
            // embed paths.
            const semanticIndexRef = this.semanticIndex;
            this.embeddingService = new EmbeddingService(new VaultOperatorEmbeddingProvider(
                (texts) => semanticIndexRef.embedTexts(texts),
                () => semanticIndexRef.getEmbeddingModelInfo(),
            ));
            // Auto-index on startup if configured
            if (this.settings.semanticAutoIndex === 'startup') {
                // buildIndex() auto-triggers enrichment after completion
                this.semanticIndex.buildIndex().catch((e) =>
                    console.warn('[Plugin] Auto-index on startup failed:', e)
                );
            } else if (
                this.semanticIndex.isIndexed &&
                this.settings.enableContextualRetrieval &&
                this.getContextualModel() &&
                this.vectorStore
            ) {
                // No build needed, but check for unenriched chunks from a previous session
                const unenriched = this.vectorStore.getUnenrichedCount();
                if (unenriched > 0) {
                    console.debug(`[Plugin] ${unenriched} unenriched chunks found — starting background enrichment`);
                    void this.semanticIndex.runBackgroundEnrichment();
                }
            }

            // Graph Extraction (FEATURE-1502): extract Wikilinks, MOC-Properties, Tags
            if (this.settings.enableGraphExpansion && this.graphStore) {
                // FIX-19-01-15: Provider statt Momentaufnahme. Der Extractor
                // liest mocPropertyNames + backlinksProperty +
                // reciprocalProperties bei jeder Extraktion frisch.
                this.graphExtractor = new GraphExtractor(
                    this.app,
                    this.graphStore,
                    () => this.settings,
                );
                // Full extraction on startup. FEAT-19-04-01 W3: extractAll ist
                // async (selektiver Read nur fuer Notizen mit HTML-Kommentar,
                // um Block-Kanten zu klassifizieren); der Normalfall bleibt
                // read-frei.
                this.enqueueBootJob('graph extraction', () =>
                    this.graphExtractor?.extractAll(this.app.vault)
                        .catch((e) => console.warn('[Plugin] boot extractAll failed:', e)));

                // IMP-06-01-01 hint: PDF embeddings created before v2.14.10
                // carry a placeholder string. Show the hint exactly once
                // when (a) the user has PDFs in the vault, (b) the index is
                // enabled with PDFs included, and (c) neither the hint has
                // been dismissed nor a reindex has completed. The two
                // settings flags ensure the modal never re-fires.
                this.app.workspace.onLayoutReady(() => {
                    void this.maybeShowPdfReindexHint();
                });
            }

            // Ontology Bootstrap (FEATURE-1902): build cluster mappings from MOC edges
            if (this.ontologyStore && this.graphStore) {
                this.enqueueBootJob('ontology bootstrap', () => {
                    // Build category map from metadataCache (Kategorie is a string, not a Wikilink)
                    const catProp = this.settings.categoryProperty ?? OKF_DEFAULTS.categoryProperty;
                    const categoryMap = new Map<string, string>();
                    for (const file of this.app.vault.getMarkdownFiles()) {
                        const cache = this.app.metadataCache.getFileCache(file);
                        if (cache?.frontmatter?.[catProp]) {
                            const cat = Array.isArray(cache.frontmatter[catProp])
                                ? (cache.frontmatter[catProp][0] ?? '').toString().trim()
                                : cache.frontmatter[catProp].toString().trim();
                            if (cat) categoryMap.set(file.path, cat);
                        }
                    }
                    const result = this.ontologyStore?.bootstrapFromEdges(
                        this.settings.mocPropertyNames ?? [],
                        catProp,
                        categoryMap,
                    );
                    if (result) {
                        console.debug(`[Ontology] Bootstrap: ${result.clusters} clusters, ${result.entries} entries`);
                    }
                });
            }

            // BA-25 AutoTriggerObserver (FEAT-19-27, ADR-102): listen on vault create/modify
            // and trigger ingest_triage when a note carries the configured frontmatter property.
            const autoTriggerCfg = this.settings.vaultIngest?.autoTrigger;
            if (
                autoTriggerCfg?.enabled
                && autoTriggerCfg.propertyName
                && this.ingestTriageLogStore
            ) {
                this.autoTriggerObserver = new AutoTriggerObserver(
                    this.app,
                    this.ingestTriageLogStore,
                    async (file) => {
                        // FEAT-19-27 Wiring: ruft das ingest_triage Tool im
                        // Pending-Mode auf, damit Cluster-Match und Source-
                        // Domain-Stats automatisch festgehalten werden. Tool
                        // schreibt das Triage-Log selbst und vermeidet so
                        // doppelten Trigger; die User-Entscheidung kommt
                        // spaeter ueber UI oder Agent-Tool-Call.
                        const tool = this.toolRegistry?.getTool('ingest_triage');
                        if (tool) {
                            const captured: string[] = [];
                            const ctx = {
                                plugin: this,
                                callbacks: {
                                    pushToolResult: (r: string) => { captured.push(r); },
                                    say: () => Promise.resolve(),
                                    ask: () => Promise.resolve({ response: 'noButtonClicked' as const }),
                                    isParallelExecution: false,
                                    shouldUseImmediateApproval: () => false,
                                } as unknown as ToolCallbacks,
                            } as unknown as import('./core/tools/types').ToolExecutionContext;
                            try {
                                await tool.execute({
                                    source_uri: `vault://${file.path}`,
                                    decision: 'pending',
                                }, ctx);
                            } catch (e) {
                                console.debug(`[BA-25] auto-triage tool failed for ${file.path}:`, e);
                            }
                        }
                        if (autoTriggerCfg.notification) {
                            new Notice(t('notice.ingest.autoTriageCandidate', { path: file.path }), 4000);
                        }
                        console.debug(`[BA-25] auto-trigger fired for ${file.path}`);
                    },
                    {
                        enabled: autoTriggerCfg.enabled,
                        propertyName: autoTriggerCfg.propertyName,
                        propertyValue: autoTriggerCfg.propertyValue,
                    },
                );
                this.autoTriggerObserver.start();
            }

            // FEAT-19-20 / IMP-19-20-01: Stufe-3 Periodischer Job mit
            // Persistenz und setInterval-Wrapper. Default OFF; Wrapper
            // checkt internal weeklyBudget plus 7d-Cooldown selbst.
            // Hooks: real LLM-Pre-Filter via apiHandler.classifyText (Haiku-
            // class quick yes/no), webUpdatePass nutzt das registrierte
            // web_search Tool (BYOK-Provider via FEAT-04-02). Wenn weder
            // apiHandler noch web_search verfuegbar ist, fallen die Hooks
            // auf no-op zurueck damit Tokenverbrauch null bleibt.
            if (this.knowledgeDB && this.clusterMetadataStore) {
                const persistence = new ClusterMetadataStatePersistence(this.knowledgeDB);

                // IMP-20-06-01 W2-T5: note-level FreshnessVerifier wiring.
                // ADR-163 / FEAT-30-07: Factory statt Boot-Instanz. Der
                // Orchestrator wird pro Lauf (Weekly-Job oder On-demand-
                // Button) frisch gebaut und liest alle Freshness- und
                // Web-Settings zum Aufrufzeitpunkt. Die alten by-value-
                // Konstruktor-Snapshots wirkten erst nach Plugin-Reload,
                // obwohl der Kommentar hier Live-Wirkung behauptete.
                const buildFreshnessOrchestrator = (): FreshnessOrchestrator | null => {
                    if (!this.knowledgeDB || !this.apiHandler) return null;
                    const freshnessSettings = this.settings.freshness;
                    const webSettings = this.settings.webTools;
                    const webProvider: 'brave' | 'tavily' = webSettings?.provider === 'tavily' ? 'tavily' : 'brave';
                    const webApiKey = (webProvider === 'brave' ? webSettings?.braveApiKey : webSettings?.tavilyApiKey) ?? '';
                    const db = this.knowledgeDB.getDB();
                    const verifierProvider = new LlmVerifierProvider({
                        midApi: this.apiHandler,
                        midModelId: this.apiHandler.getModel?.()?.id ?? 'mid-tier',
                        hasZdr: () => isFrontierZdrEnabled(this.settings.providerConfigs),
                    });
                    const verifier = new FreshnessVerifier(verifierProvider, {
                        allowFrontierEscalation: freshnessSettings.allowFrontierEscalation,
                        frontierConfidenceThreshold: freshnessSettings.frontierConfidenceThreshold,
                        frontierSeverityFilter: freshnessSettings.frontierSeverityFilter,
                    });
                    return new FreshnessOrchestrator({
                        selector: new NoteSelector(db, {
                            topN: 5,
                            excludePaths: freshnessSettings.excludePaths,
                            volatileRecheckDays: 7,
                            evolvingRecheckDays: 30,
                            stableRecheckDays: 90,
                        }),
                        queryBuilder: new FreshnessQueryBuilder(),
                        webSearch: new FreshnessWebSearch({
                            externalSourcesEnabled: freshnessSettings.externalSources.enabled,
                            provider: webProvider,
                            apiKey: webApiKey,
                        }),
                        verifier,
                        history: new NoteFreshnessHistoryStore(db),
                        db,
                        // Audit M-3 mitigation (AUDIT-IMP-20-06-01-2026-06-19):
                        // outer authorization gate. The orchestrator
                        // stays a no-op until the user turns on at
                        // least one freshness sub-flag.
                        enabled: () => {
                            const s = this.settings.freshness;
                            return s.externalSources.enabled || s.writeFrontmatter;
                        },
                        readNoteBody: async (path) => {
                            const file = this.app.vault.getAbstractFileByPath(path);
                            if (!(file instanceof TFile)) return null;
                            try {
                                return await this.app.vault.read(file);
                            } catch (e) {
                                console.debug('[FreshnessOrchestrator] read failed', path, e);
                                return null;
                            }
                        },
                        // FIX-19-16-09: die Query-Anreicherung war vorgesehen
                        // und nie verdrahtet -- die Suchanfrage bestand nur aus
                        // Titel plus Clustername, und 84% der Live-Laeufe
                        // endeten mit no_external_source. Die verlinkten
                        // Nachbarn der Notiz (edges, beide Richtungen) sind
                        // das billigste echte Kontextsignal: ihre Basenames
                        // gehen bis zum 400-Zeichen-Cap in die Query.
                        getTopEntities: (path) => {
                            try {
                                const r = db.exec(
                                    `SELECT DISTINCT other FROM (
                                        SELECT target_path AS other FROM edges WHERE source_path = ?
                                        UNION ALL
                                        SELECT source_path AS other FROM edges WHERE target_path = ?
                                     ) LIMIT 6`,
                                    [path, path],
                                );
                                const rows = r[0]?.values ?? [];
                                return rows
                                    // TEXT-Spalte, aber sql.js typisiert jede Zelle als
                                    // SqlValue. Nur ein String ist ein Pfad; alles andere
                                    // faellt gleich hier weg statt als "[object ...]"
                                    // weiterzureisen.
                                    .map((row) => (typeof row[0] === 'string' ? row[0] : ''))
                                    .filter(Boolean)
                                    .map((p) => (p.split('/').pop() ?? p).replace(/\.md$/i, ''));
                            } catch (e) {
                                console.debug('[FreshnessOrchestrator] getTopEntities failed', path, e);
                                return [];
                            }
                        },
                        // FIX-19-99-03: wire FreshnessFrontmatterPatcher so the
                        // freshness.writeFrontmatter setting actually mirrors
                        // verdicts into note frontmatter (single allowlisted
                        // key `freshness:` per ADR-95). Pre-fix the Patcher
                        // was implemented but never instantiated; the setting
                        // had no effect.
                        frontmatterPatcher: new FreshnessFrontmatterPatcher(
                            new FrontmatterWriter(this.app, { storageMode: 'global' }),
                        ),
                        writeFrontmatterEnabled: () => this.settings.freshness.writeFrontmatter,
                        getFileByPath: (path) => {
                            const f = this.app.vault.getAbstractFileByPath(path);
                            return f instanceof TFile ? f : null;
                        },
                    });
                };

                // REF-12: 4 hooks (preFilter / webUpdatePass / notificationSink /
                // budgetExceededSink) extracted into src/core/health/Stufe3Hooks.ts
                // so the wiring stays inline-readable here and unit-testable in
                // isolation. The host shim keeps the surface narrow.
                const { buildStufe3Hooks } = await import('./core/health/Stufe3Hooks');
                const { preFilter, webUpdatePass, notificationSink, budgetExceededSink } = buildStufe3Hooks(
                    {
                        // Live-Getter: das Wiring laeuft VOR initApiHandler();
                        // ein Snapshot waere dauerhaft null (Review-Finding).
                        getApiHandler: () => this.apiHandler,
                        getWebSearchTool: () => this.toolRegistry?.getTool('web_search') ?? null,
                        plugin: this,
                    },
                    buildFreshnessOrchestrator,
                );
                this.stufe3PeriodicJob = new Stufe3PeriodicJob(
                    this.clusterMetadataStore,
                    preFilter,
                    webUpdatePass,
                    notificationSink,
                    {
                        weeklyBudgetUsd: 2.0,
                        notificationThreshold: 0.8,
                        // FEAT-19-03-01: editierbares Budget, live gelesen.
                        weeklyBudgetGetter: () => this.settings.freshness?.weeklyBudgetUsd
                            ?? DEFAULT_FRESHNESS_SETTINGS.weeklyBudgetUsd,
                        // FIX-19-16-04: Kosten aus dem Preiskatalog des Modells,
                        // das der Verifier wirklich benutzt (der Haupt-Loop-
                        // Handler, siehe LlmVerifierProvider-Verdrahtung), mit
                        // input-lastiger 85/15-Aufteilung. Die alte Haiku-
                        // Konstante hat einen 149-Cluster-Lauf als 0,0137 USD
                        // verbucht.
                        //
                        // FIX-24-05-07: estimateSpendUsd statt computeCost.
                        // Ohne Preis liefert computeCost jetzt 0, und die 0
                        // kommt durch das `est >= 0`-Gate in spendTokens: das
                        // Wochenbudget stünde für immer bei null Ausgaben.
                        // estimateSpendUsd gibt NaN und fällt damit in den
                        // tokensPerUsd-Fallback.
                        estimateUsd: (tokens: number) => estimateSpendUsd(
                            this.apiHandler?.getModel?.()?.id,
                            tokens,
                        ),
                    },
                    undefined,
                    budgetExceededSink,
                    persistence,
                    // FEAT-19-03-01: vault-weite, alterungspriorisierte Auswahl.
                    () => this.selectFreshnessClusters(),
                );
                // FIX-19-20-01: dediziertes stufe3-Flag statt autoTrigger.enabled
                // (das war Co-Trigger fuer mehrere Auto-Trigger). Stuendlicher
                // Check, woechentlicher Run via lastRunIso-Persistenz. Pre-Audit
                // wurde lastRun nur ueber rolloverIfNewWeek im RAM gehalten und
                // beim Plugin-Reload neu berechnet -- nach Reboot konnte Stufe-3
                // theoretisch zweimal in einer Woche laufen.
                this.stufe3IntervalHandle = scheduleRecurring(() => {
                    if (!this.stufe3PeriodicJob) return;
                    const stufe3Cfg = this.settings.vaultIngest?.stufe3PeriodicJob;
                    if (!stufe3Cfg?.enabled) return;

                    this.stufe3PeriodicJob.rolloverIfNewWeek();

                    // Persisted lastRunIso ueberprueft: wenn der letzte Run
                    // weniger als 6 Tage her ist, ueberspringen. Sechs statt
                    // sieben Tage als Margin, um den woechentlichen Rhythmus
                    // nicht zu verschieben.
                    const lastRunIso = stufe3Cfg.lastRunIso;
                    if (lastRunIso) {
                        const sinceMs = Date.now() - new Date(lastRunIso).getTime();
                        if (Number.isFinite(sinceMs) && sinceMs < 6 * 86_400_000) return;
                    }

                    // Review-Findings: geteilter Chokepoint statt direktem
                    // run() -- das externalSources-Privacy-Gate, der
                    // In-flight-Guard gegen Overlap mit dem On-demand-Button
                    // und die Budget-No-op-Behandlung (lastRunIso NICHT bei
                    // 0 Clustern setzen) gelten damit auch hier.
                    void this.runStufe3Freshness()
                        .catch((e) => {
                            console.debug('[Stufe3] periodic run failed:', e);
                        });
                }, 3_600_000);
            }

            // FEAT-03-26: Top-Hub-Block initialer Build (cache-stabil).
            if (this.topHubBlockGenerator && ingestCfg.topHubBlock?.enabled) {
                const result = this.topHubBlockGenerator.generateIfNeeded(this.topHubBlockState);
                if (result) {
                    this.topHubBlockState = result.state;
                    this.topHubBlockMarkdown = result.block;
                }
            }

            // FEAT-19-19: Stufe-2 Activity-Trigger. Bei Note-Open/Modify in
            // einem reifen Cluster zeigt das Plugin dezent eine Notice.
            // Klick auf Notice startet anti_echo_search-Pass (UI-Hook).
            const stufe2Cfg = ingestCfg.stufe2Hint;
            if (
                stufe2Cfg?.enabled
                && this.knowledgeDB
                && this.clusterMetadataStore
            ) {
                this.stufe2ActivityTrigger = new Stufe2ActivityTrigger(
                    this.app,
                    this.knowledgeDB,
                    this.clusterMetadataStore,
                    (info) => {
                        const days = info.daysSinceLastCheck === null
                            ? t('notice.stufe2.neverChecked')
                            : `${Math.round(info.daysSinceLastCheck)}d`;
                        const notice = new Notice(
                            t('notice.stufe2.clusterStale', { cluster: info.cluster, score: info.score, days }),
                            10_000,
                        );
                        // IMP-19-19-01: pre-fix the click only opened a
                        // second Tipp-Notice with a string the user was
                        // supposed to paste manually. Now the click opens
                        // the sidebar and programmatically launches an
                        // anti_echo_search task -- the Stufe-2 trigger
                        // finally drives the ToolExecutionPipeline, which
                        // is what the audit asked for.
                        const el = notice.messageEl;
                        if (el) {
                            el.classList.add('agent-u-cursor-pointer');
                            el.addEventListener('click', () => {
                                notice.hide();
                                const prompt =
                                    `Run @anti_echo_search for cluster "${info.cluster}" ` +
                                    `to surface counter-positions. Use a focused query, ` +
                                    `then summarise the most surprising finding back to me.`;
                                void this.sendMessageToAgent(prompt);
                            });
                        }
                    },
                    {
                        enabled: stufe2Cfg.enabled,
                        hintThresholdScore: stufe2Cfg.hintThresholdScore,
                        minDaysSinceCheck: stufe2Cfg.minDaysSinceCheck,
                        perClusterCooldownDays: stufe2Cfg.perClusterCooldownDays,
                        maxHintsPerDay: stufe2Cfg.maxHintsPerDay,
                    },
                );
                this.stufe2ActivityTrigger.start();
            }

            // Vault Health Check (FEATURE-1901): background lint on startup
            if ((this.settings.enableVaultHealthCheck ?? true) && this.knowledgeDB) {
                this.vaultHealthService = new VaultHealthService(this.app, this.knowledgeDB);
                // FIX-19-01-12: dieselbe VectorStore-Instanz wie der Semantik-
                // Index, damit die Orphan-Verknuepfungs-Vorschlaege auf den
                // vorhandenen Note-Vektoren rechnen statt einen zweiten Cache
                // aufzubauen. Null-safe: ohne Index gibt es keine Vorschlaege.
                this.vaultHealthService.vectorStore = this.vectorStore;
            // SEC M-2: Health-Repairs laufen an der ToolExecutionPipeline
            // vorbei; der Ignore-/Protected-Ausschluss muss deshalb direkt
            // am Service haengen.
            this.vaultHealthService.ignoreGate = this.ignoreService;
            // SEC Info-5 (Audit 2026-07-19): das Delta hat den .then()-Block
            // entfernt, der nach dem Boot-Check updateHealthBadge aufrief,
            // und den Push-Ersatz nie verdrahtet -- der Badge blieb nach dem
            // Start leer, bis der Nutzer das Modal oeffnete.
            this.vaultHealthService.onFindingsUpdated = (findings) => {
                try {
                    const svc = this.vaultHealthService;
                    const count = findings.length;
                    const severity = svc ? svc.getMaxSeverity() : null;
                    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR)) {
                        const view = leaf.view as unknown as {
                            updateHealthBadge?: (n: number, s: 'high' | 'medium' | 'low' | null) => void;
                        };
                        view.updateHealthBadge?.(count, severity);
                    }
                } catch (e) {
                    console.warn('[Plugin] health badge refresh failed (non-fatal):', e);
                }
            };
        // ADR-166: Extraktions-Zugang fuer die applyAndVerify-Sequenz.
        if (this.graphExtractor) this.vaultHealthService.graphExtractor = this.graphExtractor;
                this.enqueueBootJob('vault health', () =>
                    this.vaultHealthService?.runChecks(undefined, buildHealthCheckOptions(this.settings)));
            }

            // FIX-19-06-03 (USER 2026-07-20): Hub-History beim Reload IMMER neu
            // bauen, entkoppelt vom Boot-Health-Check. Frueher haing die
            // Regeneration am .then() des Health-Checks -- war der Check aus,
            // aktualisierten sich die Hub-Tabellen beim Neuladen nie. Der
            // Boot-Check ist read-only (Repairs laufen nur ueber das Modal), die
            // Regeneration liest denselben Graph-Store, also kein Konflikt. Nur
            // geschrieben wird bei echter Aenderung (djb2-sha-Kurzschluss).
            this.enqueueBootJob('incoming-links regeneration', () =>
                this.regenerateIncomingLinksBlocks());

            // Implicit Connections (FEATURE-1503): discover semantically similar notes
            if (this.settings.enableImplicitConnections && this.vectorStore && this.graphStore) {
                this.implicitConnectionService = new ImplicitConnectionService(
                    this.knowledgeDB,
                    this.vectorStore,
                    this.graphStore,
                );
                // Auto-compute after startup if index exists
                if (this.semanticIndex.isIndexed) {
                    this.enqueueBootJob('implicit connections', () =>
                        this.implicitConnectionService?.computeAll(this.settings.implicitThreshold));
                }
            }

            // Local Reranking (FEATURE-1504): cross-encoder via transformers.js (WASM)
            if (this.settings.enableReranking) {
                this.rerankerService = new RerankerService(this);
                // Pre-load model at startup so first search is fast.
                // If the ONNX asset isn't installed, loadModel marks the
                // service failed and returns -- semantic search keeps working
                // without the rerank step.
                this.enqueueBootJob('reranker model', () =>
                    this.rerankerService?.loadModel());
            }
            } // end FIX-18 else (knowledgeDB available)
        }

        // Vault file listeners. Two responsibilities are wired here:
        //
        //   (1) Path-cascade: rewrite path columns across knowledge.db on
        //       rename/move so no orphan rows survive. ALWAYS active when
        //       knowledge.db is open -- it just does UPDATEs, no embedding.
        //   (2) Auto-reindex: re-embed and re-extract on modify/create/rename.
        //       Gated on settings.semanticAutoIndexOnChange because users
        //       opt out for cost reasons.
        if (this.knowledgeDB && this.vaultRenameHandler) {
            const autoIndex = !!(
                this.settings.enableSemanticIndex
                && this.semanticIndex
                && this.settings.semanticAutoIndexOnChange
            );

            const DOCUMENT_EXTENSIONS = new Set(['pdf', 'pptx', 'xlsx', 'docx']);
            const isIndexable = (f: TFile): boolean =>
                f.extension === 'md' || (this.settings.semanticIndexPdfs && DOCUMENT_EXTENSIONS.has(f.extension));

            const applyFileRename = (oldPath: string, file: TFile) => {
                // Cascade always -- the 8 (table, column) pairs are content-
                // independent, so this is safe regardless of auto-index.
                this.vaultRenameHandler?.cascadeFileRename(oldPath, file.path);
                if (autoIndex && isIndexable(file)) {
                    void this.semanticIndex?.removeFile(oldPath);
                    this.graphExtractor?.removeFile(oldPath);
                    this.ontologyStore?.removeEntriesForPath(oldPath);
                    if (file.extension === 'md') {
                        // FEAT-19-04-01 W3: extractFile ist async; fire-and-forget
                        // im Event-Handler (kein Consumer wartet auf die Kanten).
                        void this.graphExtractor?.extractFile(file)
                            ?.catch((e) => console.warn('[Plugin] extractFile (rename) failed:', e));
                        this.implicitConnectionService?.recomputeForPath(file.path, this.settings.implicitThreshold);
                        this.ontologyStore?.updateForPath(file.path, this.settings.mocPropertyNames ?? []);
                        this.scheduleTopHubBlockRegen();
                    }
                    this.scheduleFileIndex(file.path);
                }
            };

            this.registerEvent(this.app.vault.on('modify', (file) => {
                if (!autoIndex || !(file instanceof TFile) || !isIndexable(file)) return;
                this.scheduleFileIndex(file.path);
                if (file.extension === 'md') {
                    // FIX-19-01-03: during a Vault Health repair pass
                    // the modify event fires before Obsidian's
                    // metadataCache reparse settles, so a synchronous
                    // extractFile here would read STALE frontmatter
                    // and overwrite the freshly inserted reverse edge
                    // that the repair just produced. The repair's
                    // post-write extractAll handles the graph refresh.
                    if (!this.vaultHealthRepairInProgress) {
                        // FEAT-19-04-01 W3: extractFile ist async; fire-and-forget.
                        void this.graphExtractor?.extractFile(file)
                            ?.catch((e) => console.warn('[Plugin] extractFile (modify) failed:', e));
                    }
                    this.implicitConnectionService?.recomputeForPath(file.path, this.settings.implicitThreshold);
                    this.ontologyStore?.updateForPath(file.path, this.settings.mocPropertyNames ?? []);
                    this.scheduleTopHubBlockRegen();
                }
            }));
            this.registerEvent(this.app.vault.on('create', (file) => {
                if (!autoIndex || !(file instanceof TFile) || !isIndexable(file)) return;
                this.scheduleFileIndex(file.path);
                if (file.extension === 'md') {
                    // FEAT-19-04-01 W3: extractFile ist async; fire-and-forget.
                    void this.graphExtractor?.extractFile(file)
                        ?.catch((e) => console.warn('[Plugin] extractFile (create) failed:', e));
                    this.implicitConnectionService?.recomputeForPath(file.path, this.settings.implicitThreshold);
                    this.ontologyStore?.updateForPath(file.path, this.settings.mocPropertyNames ?? []);
                    this.scheduleTopHubBlockRegen();
                }
            }));
            this.registerEvent(this.app.vault.on('delete', (file) => {
                if (!autoIndex || !(file instanceof TFile)) return;
                void this.semanticIndex?.removeFile(file.path);
                this.graphExtractor?.removeFile(file.path);
                this.ontologyStore?.removeEntriesForPath(file.path);
                this.scheduleTopHubBlockRegen();
                // FEAT-03-25 / ADR-109: Cascade -- entferne MemorySourceStore-
                // Eintrag, abgeleitete Facts bleiben (FEAT-03-22 Forget-Right
                // ist separater Pfad, kein automatisches Hard-Delete).
                this.memorySourceStore?.remove(file.path);
            }));
            this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFolder) {
                    this.vaultRenameHandler?.cascadeFolderRename(oldPath, file.path);
                    return;
                }
                if (!(file instanceof TFile)) return;
                applyFileRename(oldPath, file);
                // FEAT-03-25: MemorySourceStore mitziehen.
                this.memorySourceStore?.rename(oldPath, file.path);
            }));
        }

        // Memory DB (FEATURE-1505/1508): SQLite storage at {vault-parent}/.obsidian-agent/memory.db
        {
            this.memoryDB = new MemoryDB(this.app.vault, pluginDir, this.globalFs.getRoot());
            await this.memoryDB.open().catch((e) =>
                console.warn('[Plugin] MemoryDB open failed (non-fatal):', e)
            );
            // FIX-18: null out if open failed to prevent cascading errors
            if (!this.memoryDB.isOpen()) {
                console.warn('[Plugin] MemoryDB not available — memory features degraded');
                this.memoryDB = null;
            }
            // FIX-24-06-02: ensure MemorySourceStore is initialised once memoryDB
            // is open. The earlier init attempt around the FrontmatterIndexer
            // setup runs BEFORE memoryDB opens (init-order is fixed by Obsidian
            // plugin onload), so memorySourceStore stays null otherwise.
            // Tools that read this.memorySourceStore (list_memory_source_notes,
            // mark/unmark_note_as_memory_source) silently failed with
            // "MemorySourceStore not available" until this second-pass init.
            if (this.memoryDB?.isOpen() && !this.memorySourceStore) {
                const { MemorySourceStore } = await import('./core/knowledge/MemorySourceStore');
                this.memorySourceStore = new MemorySourceStore(this.memoryDB);
            }
            // FIX-PERF-28d: memory subsystem ready (DB open or marked
            // gracefully unavailable above).
            this.markMemoryReady();
        }

        // History DB (FEATURE-0320 Phase 6): per-message keyword + future cosine
        // search across all conversation transcripts.
        try {
            const { HistoryDB } = await import('./core/knowledge/HistoryDB');
            this.historyDB = new HistoryDB(this.app.vault, pluginDir, this.globalFs.getRoot());
            await this.historyDB.open();
            if (!this.historyDB.isOpen()) {
                console.warn('[Plugin] HistoryDB not available — history search degraded');
                this.historyDB = null;
            }
        } catch (e) {
            console.warn('[Plugin] HistoryDB open failed (non-fatal):', e);
            this.historyDB = null;
        }

        // Daily snapshots (FEATURE-0314, ADR-079): copy live DBs into
        // .bak/<name>/<YYYY-MM-DD>.db so a rolling Undo exists on top of the
        // per-write .bak rotation. The window is bounded by age AND by a byte
        // budget per target -- these are full copies, so on a grown vault the
        // age limit alone let them reach several GB. Only fires for
        // filesystem-backed storage modes; obsidian-sync DBs are excluded to
        // avoid duplicating bytes through the same sync provider.
        try {
            this.snapshotJob = new SnapshotJob();
            const targets: SnapshotTarget[] = [];
            if (this.knowledgeDB && this.knowledgeDB.getStorageLocation() !== 'obsidian-sync') {
                targets.push({ name: 'knowledge', sourcePath: this.knowledgeDB.getAbsolutePath() });
            }
            if (this.memoryDB && this.memoryDB.getStorageLocation() !== 'obsidian-sync') {
                targets.push({ name: 'memory', sourcePath: this.memoryDB.getAbsolutePath() });
            }
            // AUDIT-034 Info-4: HistoryDB inherits the per-write atomic .bak
            // rotation via the storage adapter, but the 7-day rolling snapshot
            // gap was not covered. Append it next to knowledge + memory so the
            // chat-history index gets the same daily snapshot window. Skipped
            // for obsidian-sync mode to avoid duplicating bytes through the
            // sync provider.
            if (this.historyDB && this.historyDB.getStorageLocation() !== 'obsidian-sync') {
                targets.push({ name: 'history', sourcePath: this.historyDB.getAbsolutePath() });
            }
            if (targets.length > 0) {
                this.snapshotTargets = targets;
                // Run in background; never block plugin startup on snapshot I/O.
                void this.snapshotJob.runDailySnapshot(targets)
                    .then((results) => {
                        const created = results.filter((r) => r.action === 'created').length;
                        if (created > 0) console.debug(`[SnapshotJob] Created ${created} snapshot(s)`);
                    })
                    .then(() => this.snapshotJob?.cleanupOldSnapshots(targets))
                    .then((result) => {
                        // Bytes included on purpose: the budget pass can free
                        // gigabytes on a grown vault, and that should be
                        // visible rather than silent.
                        if (result && result.removed > 0) {
                            const freedMb = Math.round(result.freedBytes / (1024 * 1024));
                            console.debug(`[SnapshotJob] Removed ${result.removed} snapshot(s), freed ${freedMb} MB`);
                        }
                    })
                    .catch((e) => console.warn('[SnapshotJob] Daily snapshot failed (non-fatal):', e));
            }
        } catch (e) {
            console.warn('[SnapshotJob] Setup failed (non-fatal):', e);
        }

        // Agent Skill Mastery — Procedural Recipes (ADR-017)
        if (this.settings.mastery.enabled) {
            const getLearnedEnabled = () => this.settings.mastery.learnedRecipesEnabled;

            this.recipeStore = new RecipeStore(this.globalFs, getLearnedEnabled, this.memoryDB);
            await this.recipeStore.initialize().catch((e) =>
                console.warn('[Plugin] RecipeStore init failed (non-fatal):', e)
            );
            this.recipeMatchingService = new RecipeMatchingService(this.recipeStore);

            // Episodic memory + recipe promotion (ADR-018)
            this.episodicExtractor = new EpisodicExtractor(
                this.globalFs,
                () => this.semanticIndex,
                this.memoryDB,
            );
            await this.episodicExtractor.initialize().catch((e) =>
                console.warn('[Plugin] EpisodicExtractor init failed (non-fatal):', e)
            );
            // ADR-058: Semantic Recipe Promotion (intent-based, not sequence-based).
            // FEAT-24-07 / ADR-115: helper-model has priority; falls back to
            // memory-model for backwards-compat with users who configured
            // only memoryModelKey before FEAT-24-07.
            this.recipePromotionService = new RecipePromotionService(
                this.recipeStore,
                () => {
                    const helper = this.getHelperModel();
                    if (helper) {
                        try {
                            return buildApiHandler(modelToLLMProvider(helper));
                        } catch (e) {
                            console.warn('[RecipePromotion] helper-model build failed, falling back to memory-model:', e);
                        }
                    }
                    const memModel = this.getMemoryModel();
                    if (!memModel) return null;
                    return buildApiHandler(modelToLLMProvider(memModel));
                },
                getLearnedEnabled,
                this.episodicExtractor,
            );
            await this.recipePromotionService.initialize().catch((e) =>
                console.warn('[Plugin] RecipePromotionService init failed (non-fatal):', e)
            );
        }

        // Chat history service (legacy — only when folder is configured)
        const s = this.settings as unknown as Record<string, unknown>;
        if (s['chatHistoryFolder']) {
            this.chatHistoryService = new ChatHistoryService(this.app.vault, s['chatHistoryFolder'] as string);
        }

        // Conversation store (new persistent history)
        if (this.settings.enableChatHistory) {
            this.conversationStore = new ConversationStore(this.globalFs);
            await this.conversationStore.initialize().catch((e) =>
                console.warn('[Plugin] ConversationStore init failed (non-fatal):', e)
            );

            // History hardening phase A3 (FIX-03-20-02): one-time persistent
            // repair of conversations damaged by the broken drain-owner gate
            // (full API history on disk, thin uiMessages -> History looked
            // empty). Idempotent and resumable: an aborted run keeps the flag
            // on 'pending' and simply resumes next boot.
            if (this.settings._historyRepairStatus !== 'complete') {
                const store = this.conversationStore;
                this.enqueueBootJob('history repair', async () => {
                    const openIds = new Set<string>();
                    const sidebarViews: AgentSidebarView[] = [];
                    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR)) {
                        if (leaf.view instanceof AgentSidebarView) {
                            sidebarViews.push(leaf.view);
                            for (const cid of leaf.view.getOpenConversationIds()) openIds.add(cid);
                        }
                    }
                    const result = await runHistoryRepair({
                        listIds: () => store.list().map((c) => c.id),
                        repair: (id) => store.repairConversation(id),
                        isOpen: (id) => openIds.has(id),
                        onRepaired: (id) => {
                            // Re-index so history search covers the
                            // reconstructed answers too.
                            void store.load(id).then((d) => {
                                if (d) void this.historyIndexer?.onConversationSaved(id, d.uiMessages);
                            });
                        },
                        yieldNow: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
                    });
                    console.debug(
                        `[HistoryRepair] scanned=${result.scanned} repaired=${result.repaired} skippedOpen=${result.skippedOpen}`,
                    );
                    this.settings._historyRepairStatus = 'complete';
                    await this.saveSettings();
                    for (const view of sidebarViews) view.refreshHistoryPanel();
                });
            }
        }

        // FEAT-24-12: the two pricing settings, before any task can report a
        // cost. Unset values fall back to the documented defaults, so a fresh
        // install needs no settings at all. Repeated in saveSettings, because
        // a setting that only takes effect after a reload reads as broken.
        this.applyPricingSettings();

        // FIX-24-05-09 (D10): the usage ledger counts THIS session's calls that
        // no task claimed. Module state can outlive a plugin reload (the module
        // is only re-evaluated on a full disable/enable), so without this the
        // totals would silently span sessions and read as one very expensive one.
        resetUsageLedger();

        // IMP-24-05-02: live price catalog (OpenRouter) for the cost footer.
        // Persisted snapshot applies immediately; refresh is non-blocking
        // and capped at once per 24h. Offline behavior: static table.
        // FEAT-24-12: kept as a field, not a local. The settings tab needs the
        // same instance to force a refresh and to read its timestamp.
        this.priceCatalog = new PriceCatalogService(this.globalFs);
        void this.priceCatalog.load()
            .then(() => this.priceCatalog?.refreshIfStale())
            .catch((e) => console.warn('[PriceCatalog] init failed (non-fatal):', e));

        // ADR-148: learned output caps — load persisted caps and inject them
        // into resolveOutputBudget before any task runs.
        this.learnedCapsStore = new LearnedCapsStore(this.globalFs);
        registerLearnedCapsStore(this.learnedCapsStore);
        void this.learnedCapsStore.load()
            .catch((e) => console.warn('[LearnedCaps] boot load failed (non-fatal):', e));

        // IMP-41-03-01: inflight snapshot store for crash recovery. The boot
        // FEAT-55-04 (ADR-172): surface a dezent notice while a run waits on
        // the shared API budget, so parallel chats do not look hung. Fires
        // only when rate limiting is configured (rateLimitMs>0; default off).
        requestRateLimiter.setWaitObserver((waiting) => {
            if (waiting) new Notice(t('notice.budgetWait'), 4000);
        });

        // sweep drops stale entries (>24h) and surfaces fresh ones so an
        // interrupted task is visible instead of silently lost.
        this.inflightStore = new InflightStore(this.globalFs);
        void this.inflightStore.listRecoverable()
            .then((recoverable) => {
                // FEAT-55-01: seed the interrupted-conversation cache for History tags.
                this.interruptedConversationIds.clear();
                for (const s of recoverable) {
                    if (s.conversationId) this.interruptedConversationIds.add(s.conversationId);
                }
                if (recoverable.length === 0) return;
                // FEAT-55-01 (user decision 2026-07-25): NO global boot notice.
                // With several chat tabs the notice could only name one of the
                // interrupted chats (time + count, no chat identity) and it
                // duplicated the two attribution-correct surfaces that already
                // cover this: the per-row "Interrupted" marker in History and
                // the conversation-scoped Resume card inside each chat. The
                // cache seed above still lights up those History markers.
                console.debug('[InflightStore] recoverable task(s) found:',
                    recoverable.map((r) => `${r.taskId} @ iteration ${r.state.iteration}`).join(', '));
            })
            .catch((e) => console.warn('[InflightStore] boot scan failed (non-fatal):', e));

        // IMP-41-03-05: background research tasks (single slot, read-only
        // research profile, helper model when configured).
        this.backgroundTaskRunner = new BackgroundTaskRunner(createBackgroundTaskExecutor(this));

        // History indexer (FEATURE-0320 Phase 6): backfill on first run,
        // incrementally re-index after every conversation save. Indexer
        // is a no-op when historyDB or conversationStore is unavailable.
        if (this.historyDB && this.conversationStore) {
            const { HistoryIndexer } = await import('./core/memory/HistoryIndexer');
            this.historyIndexer = new HistoryIndexer(this.historyDB, this.conversationStore);
            const backfillCtl = new AbortController();
            void this.historyIndexer.backfillAll(backfillCtl.signal).then((report) => {
                if (report.chunksInserted > 0) {
                    console.debug(
                        `[HistoryIndex] backfill: ${report.chunksInserted} new chunks ` +
                        `(skipped ${report.chunksSkipped}, ${report.conversationsScanned} conversations)`,
                    );
                }
            }).catch((e) => console.warn('[HistoryIndex] backfill failed (non-fatal):', e));
        }

        // Memory service + extraction queue
        if (this.settings.memory.enabled) {
            this.memoryService = new MemoryService(this.globalFs, this.memoryDB);
            await this.memoryService.initialize().catch((e) =>
                console.warn('[Plugin] MemoryService init failed (non-fatal):', e)
            );
            this.extractionQueue = new ExtractionQueue(this.globalFs);
            await this.extractionQueue.load().catch((e) =>
                console.warn('[Plugin] ExtractionQueue load failed (non-fatal):', e)
            );

            // FEATURE-0318 / PLAN-007 task C.2: telemetry + drift + budget wiring.
            this.memoryV2Telemetry = new MemoryV2Telemetry((path, line) => this.globalFs.append(path, line));
            this.driftBus = new DriftEventBus();
            this.driftBus.subscribe((event) => {
                void this.memoryV2Telemetry?.drift({
                    sessionId: event.sessionId,
                    previousTopic: event.previousTopic ?? '',
                    newTopic: event.newTopic,
                    score: event.score,
                });
            });
            // IMP-03-18-02: bei Drift den 60s-Throttle fuer diese
            // conversationId zuruecksetzen, damit die naechste
            // Auto-Extraction direkt durchgeht statt im Throttle-Window
            // zu sterben. Wir enqueuen nicht direkt, weil das DriftEvent
            // keine messages traegt; das naechste normale enqueue laeuft
            // dann ohne Throttle-Skip.
            this.driftBus.subscribe((event) => {
                this.extractionQueue?.clearThrottle(event.sessionId);
            });
            this.tokenBudget = new TokenBudgetGuard({
                loadState: () => this.settings.memory.tokenBudgetState ?? null,
                saveState: async (state) => {
                    this.settings.memory.tokenBudgetState = state;
                    await this.saveSettings();
                },
                thresholds: { dailyInputCap: 1_000_000, dailyOutputCap: 200_000 },
            });

            // FEATURE-0318 / PLAN-007 task C.1: Single-Call replaces both
            // SessionExtractor and LongTermExtractor. One tool-calling LLM
            // round produces session summary + atomic facts + mentions +
            // delta-window summary in a single pass.
            const memoryService = this.memoryService;
            const memoryDB = this.memoryDB;
            if (!memoryDB) {
                console.warn('[Plugin] memoryDB unavailable -- extraction queue will skip items.');
                this.extractionQueue.setProcessor(() => Promise.resolve());
            } else {
                const singleCallProcessor = new SingleCallProcessor({
                    memoryService,
                    memoryDB,
                    embeddingService: this.embeddingService,
                    getMemoryModel: () => this.getMemoryModel(),
                    getSemanticIndex: () => this.semanticIndex,
                    tokenBudget: this.tokenBudget,
                    telemetry: this.memoryV2Telemetry,
                });
                // FIX-32-03-02: forward the AbortSignal so a reload mid-extract
                // can interrupt the API call instead of letting it race the DB close.
                this.extractionQueue.setProcessor((item, signal) => singleCallProcessor.process(item, signal));
                // FIX-32-03-03: route park/drop events through the same JSONL sink
                // the rest of the memory pipeline already writes to.
                this.extractionQueue.setTelemetry(this.memoryV2Telemetry);
            }

            // Process any pending extractions from a previous session
            if (!this.extractionQueue.isEmpty()) {
                console.debug(`[Plugin] Processing ${this.extractionQueue.size()} pending extractions from previous session`);
                this.extractionQueue.processQueue().catch((e) =>
                    console.warn('[Plugin] Queue processing failed (non-fatal):', e)
                );
            }

            // FEATURE-0319b / PLAN-008 task C.7: sync CapabilityManifest into
            // Memory v2 under profile_id='_obsilo'. Detects manifest changes
            // via djb2 hash and replaces the snapshot atomically.
            this.syncCapabilitySnapshot().catch((e) =>
                console.warn('[Plugin] Capability snapshot sync failed (non-fatal):', e),
            );

            // FEATURE-0319 Phase 5: aging sweep on plugin onload.
            // AgingService short-circuits when lastAgingRunAt is < 24h old.
            this.runAgingSweep().catch((e) =>
                console.warn('[Plugin] Aging sweep failed (non-fatal):', e),
            );

            // IMP-03-18-01: 6h-Tick damit Aging auch laufen kann, wenn Obsidian
            // tagelang nicht neu gestartet wird. AgingService 24h-Cooldown
            // bleibt aktiv, der Tick prueft nur ob gerade etwas zu tun ist.
            this.agingSchedulerHandle = scheduleRecurring(() => {
                this.runAgingSweep().catch((e) =>
                    console.debug('[Plugin] Aging tick failed:', e),
                );
            }, 6 * 60 * 60 * 1000);

            // FEATURE-0319 Phase 5: configure re-extraction throttle from settings.
            this.extractionQueue.setThrottleMs(this.settings.memory.reExtractThrottleMs ?? 60_000);
        }

        // FEAT-29-12: auto-daily backup. Runs in the background after a
        // 60s grace period so it does not slow down plugin onload. The
        // runner gates itself on settings.backup.autoDailyEnabled and
        // on a 24h interval (lastAutoBackupAt). Auto-daily backups
        // ALWAYS strip secrets, regardless of any manual export flag.
        window.setTimeout(() => {
            this.runAutoBackup().catch((e) =>
                console.warn('[Plugin] Auto-backup failed (non-fatal):', e),
            );
        }, 60_000);

        // LLM provider (null if no API key configured)
        this.initApiHandler();

        // 3. Register UI views (registerView moved to synchronous onload())

        // Ribbon icon in left activity bar (using built-in lucide icon)
        this.addRibbonIcon('square-slash', t('plugin.ribbonTooltip'), () => {
            void this.activateView();
        });

        // Protocol handler: deep-link into a specific conversation (ADR-022)
        // New canonical name is 'vault-operator-chat'. The legacy
        // 'obsilo-chat' protocol stays registered as an alias so that
        // existing frontmatter links keep working.
        const openChatFromParams = (params: Record<string, string>) => {
            const id = params.id;
            if (!id) return;
            void this.openChatById(id);
        };
        this.registerObsidianProtocolHandler('vault-operator-chat', openChatFromParams);
        this.registerObsidianProtocolHandler('obsilo-chat', openChatFromParams);

        // Register 'Chats' property as list type so Properties view shows individual items
        this.app.metadataTypeManager.setType('chats', 'multitext');

        // Auto-open sidebar when Obsidian starts.
        //
        // FEATURE-2208 (BRAT update fix, 2026-04-19): After a plugin hot-reload
        // (e.g. BRAT update) Obsidian keeps the old leaf in the workspace but
        // the view DOM is stale -- the input field disappears until the user
        // reloads Obsidian. Force a fresh onOpen by cycling each existing
        // leaf through the 'empty' view state, then reactivating normally.
        this.app.workspace.onLayoutReady(() => {
            void (async () => {
                const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR);
                // FIX-22-07-02: only rebuild genuinely stale leaves (view
                // instance from a previous plugin load / deferred view).
                // Views created by THIS plugin instance are live -- cycling
                // them destroyed active chats when the user interacted
                // during a slow boot.
                const stale = existing.filter((leaf) => shouldRebuildSidebarLeaf(leaf.view, AgentSidebarView));
                for (const leaf of stale) {
                    try {
                        await leaf.setViewState({ type: 'empty' });
                        await leaf.setViewState({ type: VIEW_TYPE_AGENT_SIDEBAR, active: true });
                    } catch (e) {
                        console.debug('[Plugin] Failed to rebuild stale sidebar leaf:', e);
                    }
                }
                // FEAT-33-12 follow-up: respect the auto-open setting.
                // When false, the sidebar stays closed until the user
                // opens it via the ribbon / command palette / inline
                // "Send to sidebar chat". Default = true preserves the
                // historical behaviour.
                const autoOpen = this.settings.autoOpenSidebarOnStart ?? true;
                if (existing.length === 0 && autoOpen === true) {
                    await this.activateView();
                }
                // Memory v2 upgrade prompt -- BUG-031 follow-up. Fires only
                // when the detector finds legacy v1 MDs and no v2 facts yet.
                // Fresh installs are silent.
                this.detectAndPromptMemoryV2Upgrade().catch(e =>
                    console.warn('[Plugin] Memory v2 upgrade detection failed (non-fatal):', e),
                );
                // FEAT-29-01-02 (Issue #69): tell existing installs that their
                // settings and workflows live OUTSIDE the vault and therefore
                // do not travel with it. The consolidation and its settings
                // button predate this prompt, but nothing ever surfaced them,
                // so long-time users stayed on the old layout without knowing
                // and only found out when a synced vault arrived incomplete on
                // a second machine.
                this.maybePromptStorageLayoutUpgrade().catch(e =>
                    console.warn('[Plugin] Storage layout upgrade prompt failed (non-fatal):', e),
                );
            })();
        });

        // 4. Register commands
        this.addCommand({
            id: 'open-agent-sidebar',
            name: t('plugin.commandOpen'),
            callback: () => this.activateView()
        });

        // FEAT-55-01: open an additional in-view chat tab (parallel session).
        this.addCommand({
            id: 'new-chat-session',
            name: t('plugin.commandNewChat'),
            callback: () => { void this.openNewChatTab(); },
        });

        // EPIC-33: Inline-Editor-AI-Actions wiring. Builds the action
        // registry + floating-menu over the live editor and the active
        // provider. No default hotkey -- user binds in Settings.
        try {
            const wiring = await import('./core/inline/PluginWiring');
            this.inlineActions = wiring.wireInlineActions(this);
        } catch (e) {
            console.warn('[main] inline-actions wiring failed (non-fatal):', e);
            this.inlineActions = null;
        }

        // FIX-19-09-05: die vault-operator-Auto-Block-Marker im Editor
        // ausblenden (Fold-Callout + .base). Eigenstaendige CM6-Extension,
        // unabhaengig vom Inline-Chat; rein additiv, faellt bei Fehler auf
        // sichtbare Marker zurueck.
        try {
            const { markerHideExtension } = await import('./core/inline/markerHide/markerHideExtension');
            this.registerEditorExtension(markerHideExtension());
        } catch (e) {
            console.debug('[main] marker-hide-extension registration failed (non-fatal):', e);
        }

        this.addCommand({
            id: 'open-inline-ai-menu',
            name: t('plugin.commandOpenInlineChat'),
            callback: () => {
                this.inlineActions?.orchestrator.triggerPanel();
            },
        });
        // EPIC-33: default chord for the inline-AI surface. Per user
        // spec 2026-06-24:
        //   Ctrl + i (control, lowercase) -> open inline AI chat
        // We use 'Ctrl' (not 'Mod') because the user explicitly named
        // the control key, not the platform-native command key. Users
        // can rebind the COMMAND via Settings -> Hotkeys.
        //
        // The previously registered Ctrl+s send-to-sidebar chord was
        // dropped 2026-06-24 (user feedback: did not work reliably --
        // textarea focus shadowed app.scope, and the textarea-level
        // fallback collided with system save shortcuts on some setups).
        // The Send-to-sidebar BUTTON in the composer remains as the
        // canonical trigger.
        // Ctrl+i opens the inline chat. Ctrl held + i pressed TWICE in
        // quick succession (≤ 280 ms between presses) instead opens the
        // sidebar chat with the editor selection pre-populated -- without
        // flashing the inline panel first (user feedback 2026-06-24
        // revision). To make that possible we DEFER the inline-open on
        // the first press by 220 ms; if a second press arrives in that
        // window we cancel the pending inline-open and run the sidebar
        // path instead. The 220 ms wait is invisible at typing speed
        // and shorter than any deliberate single-press cadence.
        const DOUBLE_TAP_MS = 280;
        const INLINE_DEFER_MS = 220;
        let pendingInlineTimer: number | null = null;
        let lastCtrlIAt = 0;
        const inlineOpenHandler = this.app.scope.register(['Ctrl'], 'i', (ev: KeyboardEvent) => {
            ev.preventDefault();
            const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? performance.now()
                : Date.now();
            const isDouble = (now - lastCtrlIAt) < DOUBLE_TAP_MS;
            if (isDouble) {
                // Cancel the deferred inline-open from the first press.
                if (pendingInlineTimer !== null) {
                    window.clearTimeout(pendingInlineTimer);
                    pendingInlineTimer = null;
                }
                lastCtrlIAt = 0; // reset so a third press starts a fresh window
                this.sendCurrentEditorSelectionToSidebar();
                return false;
            }
            // First press: arm a deferred inline-open. Stash timestamp
            // so a follow-up press within DOUBLE_TAP_MS routes to the
            // sidebar branch above.
            lastCtrlIAt = now;
            if (pendingInlineTimer !== null) window.clearTimeout(pendingInlineTimer);
            pendingInlineTimer = window.setTimeout(() => {
                pendingInlineTimer = null;
                if (this.inlineActions === null || this.inlineActions === undefined) return;
                this.inlineActions.orchestrator.triggerPanel();
            }, INLINE_DEFER_MS);
            return false;
        });
        this.register(() => this.app.scope.unregister(inlineOpenHandler));
        this.register(() => {
            if (pendingInlineTimer !== null) {
                window.clearTimeout(pendingInlineTimer);
                pendingInlineTimer = null;
            }
        });

        // EPIC-33 + user feedback 2026-06-24: editor-menu now offers
        // BOTH paths: open the inline chat OR send the selection to the
        // sidebar chat. Each item shows its OS-specific hotkey hint.
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor) => {
                const selection = editor.getSelection();
                if (selection.length === 0) return;
                const inlineHint = formatHotkeyHint(Platform);
                const sidebarHint = formatSendSelectionToSidebarHotkeyHint(Platform);
                menu.addItem(item => item
                    .setTitle(t('ui.editorMenu.inlineChat', { hotkey: inlineHint }))
                    .setIcon('square-slash')
                    .onClick(() => {
                        this.inlineActions?.orchestrator.triggerPanel();
                    }));
                menu.addItem(item => item
                    .setTitle(t('ui.editorMenu.sendSelectionToSidebar', { hotkey: sidebarHint }))
                    .setIcon('panel-right')
                    .onClick(() => {
                        this.sendCurrentEditorSelectionToSidebar();
                    }));
            }),
        );

        // FEATURE-0319 Phase 5: Save active conversation to memory.
        // No default hotkey -- user assigns via Settings -> Hotkeys.
        this.addCommand({
            id: 'save-conversation-to-memory',
            name: t('ui.sidebar.saveToMemory'),
            callback: () => { void this.saveActiveConversationToMemory(); },
        });

        // FEATURE-0319 Phase 6/7 soak: daily health snapshot. User runs once a
        // day, copies JSON to chat for trend analysis. Plain navigator.clipboard
        // -- Notice fallback if the API is unavailable (rare in Electron).
        this.addCommand({
            id: 'generate-memory-soak-report',
            name: t('plugin.commandGenerateSoakReport'),
            callback: () => { void this.generateAndCopySoakReport(); },
        });

        // Development: Test tool execution. Only registered when debugMode is
        // on, so it does not clutter the command palette for normal users
        // (the callback already self-blocks without debugMode; this keeps it
        // out of sight entirely). Toggling debugMode takes effect on reload.
        if (this.settings.debugMode) {
            this.addCommand({
                id: 'test-tool-execution',
                name: t('plugin.commandTestToolExecution'),
                callback: () => this.testToolExecution()
            });
        }

        // BA-25 FEAT-19-10: Frontmatter-Backfill-Job Command
        this.addCommand({
            id: 'ba25-run-frontmatter-backfill',
            name: t('plugin.commandRunFrontmatterBackfill'),
            callback: () => { void this.runFrontmatterBackfill(); },
        });

        // BA-25 FEAT-19-15: Inbox-Workflow Triage-Pass
        this.addCommand({
            id: 'ba25-run-inbox-triage',
            name: t('plugin.commandRunInboxTriage'),
            callback: () => { void this.runInboxTriage(); },
        });

        // BA-25 FEAT-19-11: MOC-Auto-Pflege manuell triggern
        this.addCommand({
            id: 'ba25-refresh-moc-pages',
            name: t('plugin.commandRefreshMocPages'),
            callback: () => { void this.refreshAllMOCs(); },
        });

        // FIX-19-09-01 (USER 2026-07-21): "Update Links" -- baut die
        // Rueckverweis-Tabellen neu. Fuer strukturelle Hub-Typen traegt die
        // Tabelle (echte Wikilinks -> Graph-Rueckkante) die Reziprozitaet, die
        // frueher der related-Frontmatter-Repair uebernahm; beides ist derselbe
        // Need. Command-ID bleibt stabil (Hotkey-Kompat), nur Label geaendert.
        this.addCommand({
            id: 'ba25-update-hubs',
            name: t('plugin.commandUpdateHubs'),
            callback: () => {
                void this.regenerateIncomingLinksBlocks().then((r) => {
                    if (r.status === 'disabled') { new Notice(t('notice.incomingLinks.disabled')); return; }
                    if (r.status === 'unavailable') { new Notice(t('notice.incomingLinks.unavailable')); return; }
                    if (r.status === 'busy') { new Notice(t('notice.incomingLinks.busy')); return; }
                    new Notice(t('notice.incomingLinks.done', { updated: r.written, hubs: r.hubs }));
                });
            },
        });

        // BA-25 FEAT-19-11: Initial-Marker-Injection in MOC-Kandidaten.
        this.addCommand({
            id: 'ba25-inject-moc-markers',
            name: t('plugin.commandInjectMocMarkers'),
            callback: () => { void this.injectInitialMOCMarkers(); },
        });

        // BA-25 FEAT-03-26: Top-Hub-Block manueller Refresh
        this.addCommand({
            id: 'ba25-refresh-top-hub-block',
            name: t('plugin.commandRegenerateTopHubBlock'),
            callback: () => {
                if (!this.topHubBlockGenerator) { new Notice(t('notice.topHub.notAvailable')); return; }
                const r = this.topHubBlockGenerator.generate();
                this.topHubBlockState = r.state;
                this.topHubBlockMarkdown = r.block;
                new Notice(t('notice.topHub.regenerated', { count: r.hubs.length }));
            },
        });

        // issue #45 quirk 3: hotkey-friendly re-enable for the
        // implicit-connection banner. The header-X kill-switch in
        // SuggestionBanner sets enableSuggestionBanner=false; without
        // a command, the only way back is Settings > Embeddings.
        this.addCommand({
            id: 'toggle-implicit-connection-banner',
            name: t('ui.suggestionBanner.toggleCommand'),
            callback: () => {
                this.settings.enableSuggestionBanner = !this.settings.enableSuggestionBanner;
                void this.saveSettings();
                new Notice(this.settings.enableSuggestionBanner
                    ? t('notice.suggestionBanner.enabled')
                    : t('notice.suggestionBanner.disabled'));
            },
        });

        // 5. Register settings tab
        this.settingsTab = new AgentSettingsTab(this.app, this);
        this.addSettingTab(this.settingsTab);

        // 6. Register deep-link protocol handlers:
        //    obsidian://vault-operator-settings?tab=advanced&sub=backup (new canonical)
        //    obsidian://obsilo-settings?...                              (legacy alias)
        const VALID_SETTINGS_TABS: ReadonlySet<TabId> = new Set<TabId>([
            'providers', 'agent-behaviour', 'customize', 'advanced', 'help',
        ]);
        const openSettingsFromParams = (params: Record<string, string>) => {
            const tabParam = params.tab;
            const sub = params.sub;
            if (!tabParam) return;
            // FIX-26-99-01 follow-up: external deep-links can send arbitrary
            // strings; reject anything that is not a known TabId so we never
            // land on the default tab with the user expecting something else.
            if (!(VALID_SETTINGS_TABS as Set<string>).has(tabParam)) {
                console.warn(`[deeplink] Unknown settings tab: ${tabParam}`);
                return;
            }
            this.openSettingsAt(tabParam as TabId, sub);
        };
        this.registerObsidianProtocolHandler('vault-operator-settings', openSettingsFromParams);
        this.registerObsidianProtocolHandler('obsilo-settings', openSettingsFromParams);

        // FEAT: browser-triggered skill runs (obsidian://vault-operator-run?skill=<slug>).
        // obsidian:// URLs are openable by ANY web page, so this handler never
        // accepts free prompt text — only a whitelisted skill slug — and always
        // gates the run behind an in-app confirmation (cost/prompt-injection
        // protection against foreign pages).
        this.registerObsidianProtocolHandler('vault-operator-run', (params) => {
            void this.runSkillFromParams(params);
        });

        // FEAT-04-10: OAuth redirect target for MCP connectors. obsidian:// URLs
        // are openable by any web page, so handleOAuthRedirect validates the
        // OAuth state against the pending flow before exchanging the code (ADR-155).
        this.registerObsidianProtocolHandler('vault-operator-mcp-oauth', (params) => {
            void this.mcpClient.handleOAuthRedirect(params);
        });

        // Phase 2.3: command to open the setup wizard manually
        this.addCommand({
            id: 'open-setup-wizard',
            name: t('plugin.commandOpenSetupWizard'),
            callback: async () => {
                const { FirstRunWizardModal } = await import('./ui/modals/FirstRunWizardModal');
                new FirstRunWizardModal(this.app, this).open();
            },
        });

        // Phase 2.3: the FirstRun wizard is opened by the sidebar's
        // showWelcomeMessage when no chat is active. That guarantees the
        // wizard appears once the sidebar is visible, never double-fires
        // with the legacy welcome card, and gives the user a deterministic
        // single entry point. The maybeAutoOpenSetupWizard helper remains
        // available for the command-palette trigger and as a future hook.

        // MCP Server (EPIC-014): Expose Vault Operator as MCP Server for Claude Desktop/Code
        if (this.settings.enableMcpServer) {
            const { McpBridge } = await import('./mcp/McpBridge');
            // FIX-23-01-01: Living-Document state for save_conversation.
            const { ActiveMcpSessions } = await import('./core/memory/ActiveMcpSessions');
            this.activeMcpSessions = new ActiveMcpSessions();
            // Eviction-Tick alle 5 Minuten -- entfernt abgelaufene
            // Sessions auch wenn keine MCP-Calls reinkommen.
            // FIX-PERF-39 migration: ActiveMcpSessions evict via
            // BackgroundJobCoordinator. mcp resource tag prevents
            // accidental overlap if MCP cleanup tasks grow more siblings.
            this.backgroundJobs?.register({
                id: 'mcp.active-sessions.evict',
                resources: ['mcp'],
                everyMs: 5 * 60 * 1000,
                priority: 'low',
                run: () => {
                    const removed = this.activeMcpSessions?.evictExpired() ?? 0;
                    if (removed > 0) {
                        console.debug(`[ActiveMcpSessions] evicted ${removed} expired session(s)`);
                    }
                },
            });

            // AUDIT-015 M-1: MCP Rate-Limiter, sliding window pro
            // (token, source_interface, rate-class). Cleanup alle 5 min.
            const { McpRateLimiter } = await import('./mcp/McpRateLimiter');
            this.mcpRateLimiter = new McpRateLimiter();
            // FIX-PERF-39 migration: shares the 'mcp' resource tag with
            // the evict job above so they cannot overlap.
            this.backgroundJobs?.register({
                id: 'mcp.rate-limiter.cleanup',
                resources: ['mcp'],
                everyMs: 5 * 60 * 1000,
                priority: 'low',
                run: () => {
                    this.mcpRateLimiter?.cleanup();
                },
            });

            this.mcpBridge = new McpBridge(this);
            await this.mcpBridge.start().catch((e: unknown) =>
                console.warn('[Plugin] MCP Server start failed (non-fatal):', e)
            );
            // Remote relay (if configured)
            if (this.settings.enableRemoteRelay && this.settings.relayUrl) {
                this.mcpBridge.connectRelay();
            }
        }

        // ADR-063: Clean up orphaned externalization temp files from crashed sessions.
        // BUG-014 / FEATURE-1803: tmp files now live inside the vault.
        // FEATURE-0507: orphan sweeper honors the configurable agentFolderPath.
        const { ResultExternalizer } = await import('./core/tool-execution/ResultExternalizer');
        const { VaultDataFileAdapter } = await import('./core/storage/VaultDataFileAdapter');
        const { getTmpRoot } = await import('./core/utils/agentFolder');
        const vaultFs = new VaultDataFileAdapter(this.app.vault.adapter);
        void ResultExternalizer.cleanupOrphaned(vaultFs, getTmpRoot(this));

        console.debug('Vault Operator plugin loaded successfully');

        // v2.10.0: surface a one-shot warning if the pricing table has not
        // been verified for > 90 days. Manual reminder; provider rate
        // cards are not machine-readable so a scraper would be brittle.
        const { getPricingAgeWarning } = await import('./core/pricing/ModelPricing');
        const pricingWarn = getPricingAgeWarning();
        if (pricingWarn) console.warn(pricingWarn);

        // EPIC-26 / FEAT-26-04: open the one-shot migration notification
        // modal after the workspace is ready. Cleared from
        // pendingMigrationSummary on first display so it never re-opens.
        if (this.pendingMigrationSummary) {
            this.app.workspace.onLayoutReady(() => {
                void this.showPendingMigrationModal();
            });
        }
    }

    /**
     * EPIC-26 / FEAT-26-04: show the migration notification modal once
     * after a successful migration. No-op when no summary is pending.
     */
    private async showPendingMigrationModal(): Promise<void> {
        const summary = this.pendingMigrationSummary;
        if (!summary) return;
        // Clear immediately so re-entrancy never opens a second modal.
        this.pendingMigrationSummary = null;
        const { MigrationNotificationModal } = await import('./ui/settings/MigrationNotificationModal');
        new MigrationNotificationModal(this.app, summary, {
            // FIX-26-99-01: pre-fix this used 'agent' as TabId, which is not
            // in the TabId union ('providers' | 'agent-behaviour' | 'customize'
            // | 'advanced' | 'help'), so the cast at openSettingsAt() landed on
            // the default tab and the migration prompt opened a blank settings
            // page. The migration is about provider config, so direct the user
            // straight to the providers tab.
            onOpenSettings: () => this.openSettingsAt('providers'),
            onDismiss: () => { /* nothing to do */ },
        }).open();
    }

    /**
     * Plugin cleanup
     */
    onunload(): void {
        console.debug('Unloading Vault Operator plugin');
        // FIX-24-08-03: abort a running background agent task -- it holds
        // its own AbortController and would otherwise keep calling the API
        // after the plugin is gone.
        try {
            this.backgroundTaskRunner?.stop();
        } catch (e) {
            console.debug('[main] background-task stop error (non-fatal):', e);
        }
        // EPIC-33: dispose inline-actions before async cleanup so the
        // floating-menu listeners detach immediately.
        try {
            this.inlineActions?.dispose();
        } catch (e) {
            console.debug('[main] inline-actions dispose error (non-fatal):', e);
        }
        this.inlineActions = null;
        // Fire-and-forget async cleanup (Plugin API expects synchronous return)
        void (async () => {
            // Flush any pending chat-links before shutdown
            for (const convId of [...this.pendingChatLinks.keys()]) {
                await this.flushPendingChatLinks(convId).catch(() => {});
            }
            await this.mcpClient?.disconnectAll();
            // FIX-PERF-39: dispose coordinator before DB close so any
            // in-flight job awaits cleanly.
            await this.backgroundJobs?.dispose();
            this.backgroundJobs = null;
            // FIX-PERF-29: detach all vault listeners.
            this.vaultEventDispatcher?.dispose();
            this.vaultEventDispatcher = null;
            // Stop background processes before closing DB
            this.semanticIndex?.cancelEnrichment();
            this.implicitConnectionService?.cancel();
            this.vaultHealthService?.cancel();
            // BA-25 listener cleanup
            this.autoTriggerObserver?.stop();
            this.stufe2ActivityTrigger?.stop();
            for (const off of this.frontmatterIndexerListeners) {
                try { off(); } catch { /* noop */ }
            }
            this.frontmatterIndexerListeners = [];
            if (this.stufe3IntervalHandle) {
                this.stufe3IntervalHandle.stop();
                this.stufe3IntervalHandle = null;
            }
            if (this.topHubBlockRegenTimer) {
                window.clearTimeout(this.topHubBlockRegenTimer);
                this.topHubBlockRegenTimer = null;
            }
            this.rerankerService?.unload();
            this.bundleLoader?.reset();
            this.mcpBridge?.stop();
            // FIX-32-03-02: abort the in-flight memory extraction (and clear any
            // pending retry timer) BEFORE memoryDB.close() so SingleCallProcessor
            // sees the abort first and skips its post-extract block, instead of
            // racing the close and emitting closed-DB errors.
            this.extractionQueue?.cancelInFlight();
            // Close databases (final save + cleanup)
            await this.memoryDB?.close().catch((e) =>
                console.warn('[Plugin] MemoryDB close failed (non-fatal):', e)
            );
            await this.knowledgeDB?.close().catch((e) =>
                console.warn('[Plugin] KnowledgeDB close failed (non-fatal):', e)
            );
        })();
        // Synchronous cleanup stays outside the IIFE
        this.pendingChatLinks.clear();
        this.vaultDNAScanner?.destroy();
        for (const timer of this.autoIndexDebounceTimers.values()) window.clearTimeout(timer);
        this.autoIndexDebounceTimers.clear();
        if (this.agingSchedulerHandle) {
            this.agingSchedulerHandle.stop();
            this.agingSchedulerHandle = null;
        }
        if (this.activeMcpSessionsEvictHandle) {
            this.activeMcpSessionsEvictHandle.stop();
            this.activeMcpSessionsEvictHandle = null;
        }
        if (this.mcpRateLimiterCleanupHandle) {
            this.mcpRateLimiterCleanupHandle.stop();
            this.mcpRateLimiterCleanupHandle = null;
        }
        this.sandboxExecutor?.destroy();
        this.ringBuffer?.uninstall();
        console.debug('Vault Operator plugin unloaded');
    }

    /**
     * Load plugin settings from disk
     */
    async loadSettings() {
        const saved = (await this.loadData()) ?? {};
        // FIX (Live-Bug 2026-05-04): deep-merge fuer Settings damit
        // neue Sub-Objekte (vaultIngest.topHubBlock, vaultIngest.stufe2Hint,
        // memory.crossSurface.strictSourceIsolation, etc.) bei Upgrade
        // aus aelteren Plugin-Versionen automatisch mit Defaults
        // gefuellt werden. Vorher: shallow Object.assign machte Sub-
        // Toggles wie "Enable top-hub block" nicht-funktional, weil
        // .topHubBlock im persistenten data.json fehlte und der UI-
        // Click `cfg.topHubBlock.privacyAcknowledged = v` mit
        // TypeError stillschweigend abbrach.
        this.settings = deepMergeSettings(
            DEFAULT_SETTINGS as unknown as Record<string, unknown>,
            saved as Record<string, unknown>,
        ) as unknown as ObsidianAgentSettings;

        // One-time migration: copy per-vault data to global storage (ADR-020)
        if (!saved._globalStorageMigrated && this.globalFs) {
            const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
            const migration = new GlobalMigrationService(this.globalFs, this.app.vault, pluginDir);
            const didMigrate = await migration.migrateIfNeeded(saved._globalStorageMigrated).catch((e) => {
                console.warn('[Plugin] Global storage migration failed (non-fatal):', e);
                return false;
            });
            if (didMigrate) {
                this.settings._globalStorageMigrated = true;
                await this.saveData({ ...saved, _globalStorageMigrated: true });
                // Keep the in-memory boot snapshot in sync: later one-time
                // migrations in this loadSettings spread `saved` into their own
                // saveData and would otherwise clobber the flag on disk.
                saved._globalStorageMigrated = true;
                // Write global settings.json immediately after migration
                if (this.globalSettingsService) {
                    await this.globalSettingsService.saveGlobal(this.settings);
                }
            }
        }

        // Merge global settings (cross-vault) — global keys override vault-local data.json
        if (this.globalSettingsService) {
            // OrNull so the one-time migration below can tell "file missing"
            // ({}) from "file unreadable" (null) and not burn its flag on a
            // transient read failure (ADR-160 review fix).
            const globalSettingsOrNull = await this.globalSettingsService.loadGlobalOrNull();
            const globalSettings = globalSettingsOrNull ?? {};
            if (Object.keys(globalSettings).length > 0) {
                this.settings = this.globalSettingsService.mergeIntoVault(this.settings, globalSettings);
            }
            // FEAT-02-12 / ADR-160: forcedWorkflow moved from global to vault-local.
            // One-time: adopt the legacy global forcedWorkflow into this vault (the
            // global file won on load pre-ADR-160, so it is the authoritative
            // source; the vault mirror is only a fallback). saveGlobal preserves
            // the legacy key for vaults that have not migrated yet.
            if (!saved._forcedWorkflowVaultMigrated) {
                if (globalSettingsOrNull === null) {
                    console.warn('[Plugin] Global settings unreadable; deferring forcedWorkflow migration to next boot');
                } else {
                    this.settings.forcedWorkflow = resolveVaultForcedWorkflow(
                        this.settings.forcedWorkflow,
                        globalSettings.forcedWorkflow,
                    );
                    this.settings._forcedWorkflowVaultMigrated = true;
                    await this.saveData({
                        ...saved,
                        forcedWorkflow: this.settings.forcedWorkflow,
                        _forcedWorkflowVaultMigrated: true,
                    });
                    // Keep the boot snapshot in sync so a later one-time
                    // migration spreading `saved` cannot clobber these keys
                    // on disk (M5 lesson).
                    saved.forcedWorkflow = this.settings.forcedWorkflow;
                    saved._forcedWorkflowVaultMigrated = true;
                }
            }

            // FEAT-04-12 / ADR-161: MCP activation moved from global to
            // per-mode. One-time: a legacy narrowing (explicit subset or
            // mcp-off) is stamped into every mode known right now; the
            // all-active default migrates to no overrides at all. Reads the
            // post-merge settings values (global wins when present, vault
            // data.json otherwise). Same fail-open guard as above.
            if (!saved._mcpPerModeMigrated) {
                if (globalSettingsOrNull === null) {
                    console.warn('[Plugin] Global settings unreadable; deferring MCP per-mode migration to next boot');
                } else {
                    const knownSlugs = [
                        ...BUILT_IN_MODES.map((m) => m.slug),
                        ...(this.settings.customModes ?? []).map((m) => m.slug),
                    ];
                    // activeMcpServers / mcpDisabled are @deprecated (ADR-161) but
                    // still read here for the one-time per-mode migration. Casting
                    // through unknown keeps the deprecation chain from surfacing a
                    // lint finding while the back-compat read runs unchanged.
                    const legacyMcp = this.settings as unknown as {
                        activeMcpServers?: string[];
                        mcpDisabled?: boolean;
                    };
                    this.settings.modeMcpOverrides = resolveModeMcpOverrides(
                        this.settings.modeMcpOverrides,
                        legacyMcp.activeMcpServers,
                        legacyMcp.mcpDisabled,
                        knownSlugs,
                    );
                    this.settings._mcpPerModeMigrated = true;
                    await this.saveData({
                        ...saved,
                        modeMcpOverrides: this.settings.modeMcpOverrides,
                        _mcpPerModeMigrated: true,
                    });
                    saved.modeMcpOverrides = this.settings.modeMcpOverrides;
                    saved._mcpPerModeMigrated = true;
                }
            }
        }

        this.settings.activeModels = this.settings.activeModels ?? [];
        // Migrate: Gemini models from provider 'custom' to dedicated 'gemini' provider (ADR-064)
        for (const m of this.settings.activeModels) {
            if (m.provider === 'custom' && /^gemini-/i.test(m.name) && isGeminiApiUrl(m.baseUrl)) {
                m.provider = 'gemini';
                m.baseUrl = undefined;
            }
        }
        this.settings.webTools = this.settings.webTools ?? DEFAULT_SETTINGS.webTools;

        // Decrypt API keys if they were stored encrypted (ADR-019)
        this.decryptSettings(this.settings);

        // Initialize GitHub Copilot auth service with persisted tokens (ADR-037)
        const copilotAuth = GitHubCopilotAuthService.getInstance();
        copilotAuth.loadFromSettings(this.settings);
        copilotAuth.setSaveCallback(async () => {
            copilotAuth.saveToSettings(this.settings);
            await this.saveData(this.encryptSettingsForSave(this.settings));
        });

        // Initialize Kilo Gateway auth service with persisted session (ADR-041)
        const kiloAuth = KiloAuthService.getInstance();
        kiloAuth.loadFromSettings(this.settings);
        kiloAuth.setSaveCallback(async () => {
            kiloAuth.saveToSettings(this.settings);
            await this.saveData(this.encryptSettingsForSave(this.settings));
        });

        // Initialize ChatGPT OAuth service with persisted tokens (ADR-088, ADR-089)
        const chatgptAuth = ChatGptOAuthService.getInstance();
        chatgptAuth.loadFromSettings(this.settings);
        chatgptAuth.setSaveCallback(async () => {
            chatgptAuth.saveToSettings(this.settings);
            await this.saveData(this.encryptSettingsForSave(this.settings));
        });

        // Migrate old mode slugs to new built-in agent slug.
        // 2026-05-18: Ask removed, Agent (slug "agent") is the only default.
        // All legacy specialist modes + Ask collapse into "agent".
        const OLD_MODE_MAP: Record<string, string> = {
            librarian: 'agent', writer: 'agent', orchestrator: 'agent',
            researcher: 'agent', curator: 'agent', architect: 'agent',
            ask: 'agent',
        };
        if (OLD_MODE_MAP[this.settings.currentMode]) {
            this.settings.currentMode = OLD_MODE_MAP[this.settings.currentMode];
        }
        // Drop any custom vault-override or __custom entry that still
        // points at the removed "ask" slug -- it would dangle otherwise.
        this.settings.customModes = (this.settings.customModes ?? []).filter(
            (m) => m.slug !== 'ask' && m.slug !== 'ask__custom',
        );
        // Drop modeModelKey + modeToolOverrides for 'ask'.
        for (const map of [
            this.settings.modeModelKeys,
            this.settings.modeToolOverrides,
        ]) {
            if (map && typeof map === 'object' && 'ask' in map) delete (map as Record<string, unknown>).ask;
        }
        // 2026-05-18: modeSkillAllowList + modeMcpServers removed. Per-mode
        // skill / MCP allow-listing was redundant with toolGroups (skills
        // cannot call tools the mode lacks) and the chat-header pocket-knife
        // now toggles both globally via activeMcpServers and per-tool via
        // modeToolOverrides.
        // Cast-through-unknown legacy view: the bot rejects every
        // `eslint-disable @typescript-eslint/no-deprecated`, so we break
        // the type-level deprecation chain instead. Both fields are kept
        // for back-compat with old data.json files; loadSettings clears
        // them to `{}` on every load.
        const deprecatedModeFields = this.settings as unknown as {
            modeSkillAllowList: Record<string, unknown>;
            modeMcpServers: Record<string, unknown>;
        };
        deprecatedModeFields.modeSkillAllowList = {};
        deprecatedModeFields.modeMcpServers = {};
        // Migrate source: 'custom' → 'vault' (introduced in Phase 3.1+)
        this.settings.globalCustomInstructions = this.settings.globalCustomInstructions ?? '';
        this.settings.modeModelKeys = this.settings.modeModelKeys ?? {};
        for (const mode of this.settings.customModes) {
            if ((mode.source as string) === 'custom') {
                mode.source = 'vault';
            }
        }
        // Migrate: global temperature override removed — temperature is now per-model on CustomModel
        const advApi = this.settings.advancedApi as unknown as Record<string, unknown>;
        if ('useCustomTemperature' in advApi) delete advApi['useCustomTemperature'];
        if ('temperature' in advApi) delete advApi['temperature'];
        // Migrate: autoApproval.write split into noteEdits + vaultChanges.
        // FIX-44-35: migrate ONLY when the new key is strictly undefined. The old
        // `|| === false` clauses re-armed a flag the user had deliberately turned
        // off, every load, as long as a stale write:true lingered.
        const ap = this.settings.autoApproval as unknown as Record<string, unknown>;
        let autoApprovalMigrated = false;
        if (ap['write'] !== undefined) {
            const writeVal = ap['write'] as boolean;
            if (ap['noteEdits'] === undefined) ap['noteEdits'] = writeVal;
            if (ap['vaultChanges'] === undefined) ap['vaultChanges'] = writeVal;
            delete ap['write'];
            autoApprovalMigrated = true;
        }
        // FIX-44-34: drop dead keys from stored settings so they do not linger in
        // data.json. They have no consumer; reads are always auto.
        for (const deadKey of ['read', 'showMenuInChat', 'mode', 'question', 'todo']) {
            if (deadKey in ap) {
                delete ap[deadKey];
                autoApprovalMigrated = true;
            }
        }
        // Persist the cleanup exactly once so the next load sees a clean object.
        if (autoApprovalMigrated) this.markSettingsDirty();
        // Ensure new fields exist for users upgrading from older versions
        ap.noteEdits = ap.noteEdits ?? false;
        ap.vaultChanges = ap.vaultChanges ?? false;
        ap.skills = ap.skills ?? false;
        // Deep-merge autoApproval: new keys from DEFAULT_SETTINGS are applied
        // so the UI always reflects the actual effective value (WYSIWYG).
        const apDefaults = DEFAULT_SETTINGS.autoApproval;
        for (const key of Object.keys(apDefaults) as Array<keyof typeof apDefaults>) {
            if (ap[key] === undefined) {
                ap[key] = apDefaults[key];
            }
        }
        // Migrate: chatHistoryFolder → enableChatHistory
        const sMigrate = this.settings as unknown as Record<string, unknown>;
        if (sMigrate['chatHistoryFolder'] && this.settings.enableChatHistory === undefined) {
            this.settings.enableChatHistory = true;
        }
        this.settings.enableChatHistory = this.settings.enableChatHistory ?? true;
        // Deep-merge memory settings so upgrading users get new fields with defaults
        const memDefaults = DEFAULT_SETTINGS.memory;
        this.settings.memory = this.settings.memory ?? memDefaults;
        this.settings.memory.enabled = this.settings.memory.enabled ?? memDefaults.enabled;
        this.settings.memory.autoExtractSessions = this.settings.memory.autoExtractSessions ?? memDefaults.autoExtractSessions;
        this.settings.memory.memoryModelKey = this.settings.memory.memoryModelKey ?? memDefaults.memoryModelKey;
        this.settings.memory.extractionThreshold = this.settings.memory.extractionThreshold ?? memDefaults.extractionThreshold;

        // Deep-merge chat-linking settings (ADR-022)
        const clDefaults = DEFAULT_SETTINGS.chatLinking;
        this.settings.chatLinking = this.settings.chatLinking ?? clDefaults;
        this.settings.chatLinking.enabled = this.settings.chatLinking.enabled ?? clDefaults.enabled;
        this.settings.chatLinking.titlingModelKey = this.settings.chatLinking.titlingModelKey ?? clDefaults.titlingModelKey;
        // FEAT-07-06 (Issue #72): absent on every install predating the field.
        this.settings.chatLinking.excludedPaths = this.settings.chatLinking.excludedPaths ?? [];

        // Seed / update built-in default prompts (preserves user enabled state)
        this.settings.customPrompts = mergeDefaultPrompts(this.settings.customPrompts ?? []);

        // Sync vault mode overrides with current built-in definitions.
        // Vault modes that share a slug with a built-in get their roleDefinition,
        // toolGroups, description, and whenToUse updated — customInstructions preserved.
        this.migrateBuiltInModeOverrides();

        // Deep-merge onboarding settings
        const obDefaults = DEFAULT_SETTINGS.onboarding;
        this.settings.onboarding = this.settings.onboarding ?? obDefaults;
        this.settings.onboarding.completed = this.settings.onboarding.completed ?? obDefaults.completed;
        this.settings.onboarding.currentStep = this.settings.onboarding.currentStep ?? obDefaults.currentStep;
        this.settings.onboarding.skippedSteps = this.settings.onboarding.skippedSteps ?? obDefaults.skippedSteps;
        this.settings.onboarding.startedAt = this.settings.onboarding.startedAt ?? obDefaults.startedAt;

        // Deep-merge VaultDNA settings (PAS-1)
        const dnaDefaults = DEFAULT_SETTINGS.vaultDNA;
        this.settings.vaultDNA = this.settings.vaultDNA ?? dnaDefaults;
        this.settings.vaultDNA.enabled = this.settings.vaultDNA.enabled ?? dnaDefaults.enabled;
        this.settings.vaultDNA.skillToggles = this.settings.vaultDNA.skillToggles ?? dnaDefaults.skillToggles;
        this.settings.vaultDNA.lastScanAt = this.settings.vaultDNA.lastScanAt ?? dnaDefaults.lastScanAt;

        // Deep-merge Mastery settings (ADR-016/017/018)
        const masteryDefaults = DEFAULT_SETTINGS.mastery;
        this.settings.mastery = this.settings.mastery ?? masteryDefaults;
        this.settings.mastery.enabled = this.settings.mastery.enabled ?? masteryDefaults.enabled;
        this.settings.mastery.recipeBudget = this.settings.mastery.recipeBudget ?? masteryDefaults.recipeBudget;
        // Force-enable learned recipes — no UI toggle exists yet (FIX-10), early installs had false
        this.settings.mastery.learnedRecipesEnabled = true;
        this.settings.mastery.recipeToggles = this.settings.mastery.recipeToggles ?? masteryDefaults.recipeToggles;

        // FIX-30-07-02: kein Boot-Force-Enable fuer recipes.enabled mehr.
        // Die einmalige Alt-Nutzer-Aktivierung ist seit langem persistiert;
        // der Block machte den Master-Toggle zum Placebo (User-Abwahl wurde
        // bei jedem Start ueberschrieben).

        // FEAT-30-07 Phase 3b: Custom-Recipes load-time validieren. Die
        // Eintraege bleiben in data.json erhalten (der User kann sie im
        // Recipe-Editor korrigieren); ungueltige werden zur Laufzeit von
        // materializeCustomRecipes verworfen und hier einmal angezeigt.
        const storedCustomRecipes = this.settings.recipes?.customRecipes ?? [];
        if (storedCustomRecipes.length > 0) {
            const { validateStoredRecipe } = await import('./core/tools/agent/recipeRegistry');
            for (const s of storedCustomRecipes) {
                const v = validateStoredRecipe(s);
                if (!v.ok) {
                    console.warn(`[VaultOperator] custom recipe "${String((s as { id?: unknown })?.id)}" is invalid and will be ignored:`, v.errors);
                }
            }
        }

        // Seed the permanent built-in helpers only (EPIC-011: icons8 design
        // assets). The OAuth connector catalog (FEAT-04-10) is NO LONGER seeded
        // into the visible list -- it lives in the discovery search and
        // materializes on add (hidden-catalog model, ADR-156 revision). The
        // reconcile only syncs transport/url, never `disabled`/`oauth`.
        this.settings.mcpServers = this.settings.mcpServers ?? {};
        const permanentBuiltins = new Set(Object.keys(BUILTIN_MCP_SERVERS));
        for (const [name, config] of Object.entries(BUILTIN_MCP_SERVERS)) {
            const existing = this.settings.mcpServers[name];
            if (!existing) {
                this.settings.mcpServers[name] = { ...config };
            } else if (existing.isBuiltIn && existing.type !== config.type) {
                // Update transport type if it changed (e.g. SSE -> streamable-http)
                existing.type = config.type;
                existing.url = config.url;
            }
        }
        // Migrate older installs to the hidden-catalog model: drop seeded
        // catalog placeholders the user never engaged with. Authorized/enabled
        // built-ins and user-added servers are kept untouched (grandfathering).
        if (pruneUntouchedSeededBuiltinsInPlace(this.settings, permanentBuiltins)) {
            void this.saveData(this.encryptSettingsForSave(this.settings));
        }

        // Migrate auto-approval: ensure newer keys have sensible defaults
        {
            const ap = this.settings.autoApproval;
            let changed = false;
            // pluginApiRead: may be missing in older data.json — default true
            if (ap.pluginApiRead === undefined) {
                ap.pluginApiRead = true;
                changed = true;
            }
            if (changed) void this.saveData(this.encryptSettingsForSave(this.settings));
        }

        // Migration: remove old hardcoded modeToolOverrides.agent default.
        // Empty object means "use all tools from mode's toolGroups" (new default).
        if (this.settings.modeToolOverrides?.agent && this.settings.modeToolOverrides.agent.length > 20) {
            delete this.settings.modeToolOverrides.agent;
            void this.saveData(this.encryptSettingsForSave(this.settings));
        }

        // One-time migration: encrypt existing plaintext API keys (ADR-019)
        if (this.safeStorage.isAvailable() && !saved._encrypted) {
            const hasKeys = (this.settings.activeModels ?? []).some(m => !!m.apiKey) ||
                (this.settings.embeddingModels ?? []).some(m => !!m.apiKey) ||
                !!this.settings.webTools?.braveApiKey ||
                !!this.settings.webTools?.tavilyApiKey;
            if (hasKeys) {
                console.debug('[Plugin] Migrating API keys to encrypted storage (safeStorage)');
            }
            await this.saveData(this.encryptSettingsForSave(this.settings));
        }
    }

    /**
     * Sync vault custom modes that override a built-in slug.
     * Copies roleDefinition, toolGroups, description, whenToUse from built-in;
     * preserves user customInstructions.
     */
    private migrateBuiltInModeOverrides(): void {
        const builtInBySlug = new Map(BUILT_IN_MODES.map(m => [m.slug, m]));
        let changed = false;

        for (const vm of this.settings.customModes) {
            const bi = builtInBySlug.get(vm.slug);
            if (!bi) continue;

            const needsSync =
                vm.roleDefinition !== bi.roleDefinition ||
                JSON.stringify(vm.toolGroups) !== JSON.stringify(bi.toolGroups);

            if (needsSync) {
                vm.roleDefinition = bi.roleDefinition;
                vm.toolGroups = [...bi.toolGroups];
                vm.description = bi.description;
                vm.whenToUse = bi.whenToUse;
                changed = true;
            }
        }

        if (changed) {
            console.debug('[Plugin] Synced vault mode overrides with built-in definitions');
            void this.saveData(this.encryptSettingsForSave(this.settings));
        }
    }

    /**
     * Return the currently active CustomModel, or null if none configured or
     * disabled.
     *
     * FIX-24-05-08: the lookup itself lives in
     * `src/core/routing/tierResolution.ts` (resolveActiveModel), like every
     * other resolver on this class, so the model pill and this method cannot
     * answer differently. Only the one-time privacy notice stays here, because
     * it is a side effect and the resolvers are pure.
     */
    getActiveModel(): CustomModel | null {
        const model = resolveActiveModel(this.settings);
        if (!model) return null;

        // M-6: One-time privacy notice when using a cloud provider
        if (!this.cloudProviderWarningShown) {
            const cloudProviders = ['anthropic', 'openai', 'openrouter', 'azure'];
            if (cloudProviders.includes(model.provider)) {
                this.cloudProviderWarningShown = true;
                console.debug(
                    `[Agent] Cloud provider "${model.provider}" selected. ` +
                    'Vault content sent to the agent will be transmitted to external servers. ' +
                    'For privacy-sensitive vaults, consider using a local provider (ollama, lmstudio).',
                );
            }
        }

        return model;
    }

    /** Return the memory extraction CustomModel, or null if none configured or disabled */
    /**
     * FEAT-24-08 Welle A (EPIC-26 follow-up): same fallback shape as
     * `getHelperModel`. If `memoryModelKey` is empty (or points at a
     * pre-EPIC-26 `activeModels[]` entry that no longer exists because
     * the migration moved everything into `providerConfigs[]`), fall
     * back to the active provider's `fast`-tier slot. Returns null
     * only when the user has neither set an explicit key nor configured
     * a fast-tier model on the active provider.
     */
    getMemoryModel(): CustomModel | null {
        const key = this.settings.memory.memoryModelKey;
        if (key) {
            const model = this.settings.activeModels.find((m) => getModelKey(m) === key);
            if (model && model.enabled) return model;
        }
        return this.getTierModel('fast');
    }

    /**
     * FEAT-24-08 Welle A: Contextual-Retrieval prefix-generation model.
     * Same explicit-key-then-fast-tier-fallback pattern as the helper /
     * memory resolvers. Returns null when neither a working override
     * nor a fast-tier slot exists.
     */
    getContextualModel(): CustomModel | null {
        const key = this.settings.contextualModelKey;
        if (key) {
            const model = this.settings.activeModels.find((m) => getModelKey(m) === key);
            if (model && model.enabled) return model;
        }
        return this.getTierModel('fast');
    }

    /**
     * FEAT-24-08 Welle A: Chat-Linking semantic-titling model. Same
     * explicit-key-then-fast-tier-fallback pattern as the other slot
     * resolvers.
     */
    getTitlingModel(): CustomModel | null {
        const key = this.settings.chatLinking?.titlingModelKey;
        if (key) {
            const model = this.settings.activeModels.find((m) => getModelKey(m) === key);
            if (model && model.enabled) return model;
        }
        return this.getTierModel('fast');
    }

    /**
     * FEAT-24-07 / ADR-115 (extended by EPIC-26 / ADR-120):
     * return the helper-model CustomModel for agent-internal LLM
     * calls (condensing, fast-path planner/presenter, plan_presentation,
     * recipe-promotion), or null if none.
     *
     * Resolution order:
     *  1. Explicit `helperModelKey` setting (legacy, wins for backwards
     *     compatibility).
     *  2. Active provider's `tierMapping.fast` slot (EPIC-26 path).
     *  3. null (caller falls back to main model).
     */
    getHelperModel(): CustomModel | null {
        const key = this.settings.helperModelKey;
        if (key) {
            const model = this.settings.activeModels.find((m) => getModelKey(m) === key);
            if (model && model.enabled) return model;
        }
        // EPIC-26 fallback: active provider's fast tier.
        return this.getTierModel('fast');
    }

    /**
     * EPIC-26 / ADR-122: return the currently active provider config,
     * or null when no provider was selected yet (pre-migration / fresh
     * install). Pure logic lives in
     * `src/core/routing/tierResolution.ts` so it stays unit-testable
     * without booting the full plugin shell.
     */
    getActiveProvider(): ProviderConfig | null {
        return resolveActiveProvider(this.settings);
    }

    /**
     * EPIC-26 / ADR-120: resolve a tier slot (fast / mid / flagship) on
     * the active provider into a concrete CustomModel ready to feed the
     * API handler layer. Cascade: tierOverrides[tier] -> tierMapping[tier]
     * -> next lower tier. Returns null when nothing in the cascade is
     * populated.
     */
    getTierModel(tier: ModelTier): CustomModel | null {
        return resolveTierModel(this.settings, tier);
    }

    /**
     * EPIC-26 / ADR-120: convenience wrapper for the consult_flagship
     * tool. Returns the flagship-tier model on the active provider, or
     * null when no flagship slot is filled (does NOT cascade down).
     */
    getAdvisorModel(): CustomModel | null {
        return resolveAdvisorModel(this.settings);
    }

    /**
     * Build the cached SKILLS-directory block for a given agent (mode).
     * Mirrors the logic AgentTask uses at runtime so the Preview-Modal
     * can show the user exactly what gets injected for THIS agent.
     * Respects per-mode allow-list + global manualSkillToggles.
     */
    async buildSkillDirectoryForMode(_modeSlug: string): Promise<string | undefined> {
        const skillsManager = this.skillsManager;
        const selfLoader = this.selfAuthoredSkillLoader;

        const toggles = this.settings.manualSkillToggles ?? {};
        // FIX-29-05-03: loadableSkills() drops entries that fail the same hard
        // validation the SelfAuthoredSkillLoader applies. Listing one here would
        // advertise a skill invoke_skill cannot start.
        const userSkills = skillsManager ? loadableSkills(await skillsManager.discoverSkills()) : [];
        const filteredUserSkills = Object.keys(toggles).length > 0
            ? userSkills.filter(s => toggles[s.path] !== false)
            : userSkills;

        // AUDIT 2026-07-26 M-17: the self-authored block ignored the switches.
        // Self-authored skills are keyed by filePath, never by `s.path`, so the
        // filter above never touched them and switching one off changed nothing.
        const selfSkills = selfLoader?.getAllSkills() ?? [];
        const selfAuthoredBlock = selfLoader?.getMetadataSummary(
            enabledSelfAuthoredNames(toggles, selfSkills),
        ) ?? '';
        const selfAuthoredNames = new Set(selfSkills.map(s => s.name));
        const userLines = filteredUserSkills
            .filter(s => !selfAuthoredNames.has(s.name))
            // AUDIT 2026-07-14 (Codex re-review, M-1): sanitise untrusted user
            // skill metadata; getSkillDirectorySection defangs the assembled
            // block as the security backstop.
            .map(s => `- ${sanitizeDirectoryEntry(s.name, 80)}: ${sanitizeDirectoryEntry(s.description, SKILL_DESCRIPTION_PROMPT_CAP)}`);
        const blocks = [selfAuthoredBlock, userLines.join('\n')].filter(Boolean);
        if (blocks.length === 0) return undefined;
        return blocks.join('\n');
    }

    /** Return the active embedding CustomModel, or null if none configured or disabled */
    getActiveEmbeddingModel(): CustomModel | null {
        const key = this.settings.activeEmbeddingModelKey;
        if (!key) return null;
        const model = this.settings.embeddingModels.find((m) => getModelKey(m) === key);
        if (!model || !model.enabled) return null;
        return model;
    }

    /**
     * Decrypt all API keys in settings after loading from disk (ADR-019).
     * Only operates when `_encrypted` is true. Modifies settings in place.
     */
    private decryptSettings(settings: ObsidianAgentSettings): void {
        if (!settings._encrypted) return;
        for (const model of settings.activeModels ?? []) {
            if (model.apiKey) model.apiKey = this.safeStorage.decrypt(model.apiKey);
        }
        for (const model of settings.embeddingModels ?? []) {
            if (model.apiKey) model.apiKey = this.safeStorage.decrypt(model.apiKey);
        }
        // AUDIT-027 H-1 mirror: decrypt per-provider credentials so the
        // in-memory settings carry plaintext for the API handler layer.
        decryptProviderCredentialsInPlace(settings, this.safeStorage);
        if (settings.webTools) {
            if (settings.webTools.braveApiKey) {
                settings.webTools.braveApiKey = this.safeStorage.decrypt(settings.webTools.braveApiKey);
            }
            if (settings.webTools.tavilyApiKey) {
                settings.webTools.tavilyApiKey = this.safeStorage.decrypt(settings.webTools.tavilyApiKey);
            }
        }
        // GitHub Copilot tokens (ADR-038)
        if (settings.githubCopilotAccessToken) {
            settings.githubCopilotAccessToken = this.safeStorage.decrypt(settings.githubCopilotAccessToken);
        }
        if (settings.githubCopilotToken) {
            settings.githubCopilotToken = this.safeStorage.decrypt(settings.githubCopilotToken);
        }
        // Kilo Gateway token (ADR-041)
        if (settings.kiloToken) {
            settings.kiloToken = this.safeStorage.decrypt(settings.kiloToken);
        }
        // ChatGPT OAuth tokens (ADR-088)
        if (settings.chatgptOAuthAccessToken) {
            settings.chatgptOAuthAccessToken = this.safeStorage.decrypt(settings.chatgptOAuthAccessToken);
        }
        if (settings.chatgptOAuthRefreshToken) {
            settings.chatgptOAuthRefreshToken = this.safeStorage.decrypt(settings.chatgptOAuthRefreshToken);
        }
        if (settings.chatgptOAuthIdToken) {
            settings.chatgptOAuthIdToken = this.safeStorage.decrypt(settings.chatgptOAuthIdToken);
        }
        // AUTH-2: mirror the encrypt pass. decrypt() passes through cleartext
        // (pre-fix values), so existing installs migrate transparently.
        if (settings.chatgptOAuthEmail) {
            settings.chatgptOAuthEmail = this.safeStorage.decrypt(settings.chatgptOAuthEmail);
        }
        if (settings.chatgptOAuthAccountId) {
            settings.chatgptOAuthAccountId = this.safeStorage.decrypt(settings.chatgptOAuthAccountId);
        }
        // Remote relay tokens (AUDIT-005 M-2)
        if (settings.cloudflareApiToken) {
            settings.cloudflareApiToken = this.safeStorage.decrypt(settings.cloudflareApiToken);
        }
        if (settings.relayToken) {
            settings.relayToken = this.safeStorage.decrypt(settings.relayToken);
        }
        // Local MCP server token (AUDIT-006 H-1)
        if (settings.mcpServerToken) {
            settings.mcpServerToken = this.safeStorage.decrypt(settings.mcpServerToken);
        }
        // FEAT-04-10: OAuth MCP connector tokens (ADR-155).
        decryptMcpOAuthInPlace(settings, this.safeStorage);
    }

    /**
     * Return a deep copy of settings with all API keys encrypted (ADR-019).
     * The original settings object is NOT modified (in-memory stays plaintext).
     * When safeStorage is unavailable, returns unencrypted copy with `_encrypted = false`.
     */
    private encryptSettingsForSave(settings: ObsidianAgentSettings): ObsidianAgentSettings {
        const copy = JSON.parse(JSON.stringify(settings)) as ObsidianAgentSettings;
        if (!this.safeStorage.isAvailable()) {
            copy._encrypted = false;
            return copy;
        }
        for (const model of copy.activeModels ?? []) {
            if (model.apiKey && !this.safeStorage.isEncrypted(model.apiKey)) {
                model.apiKey = this.safeStorage.encrypt(model.apiKey);
            }
        }
        for (const model of copy.embeddingModels ?? []) {
            if (model.apiKey && !this.safeStorage.isEncrypted(model.apiKey)) {
                model.apiKey = this.safeStorage.encrypt(model.apiKey);
            }
        }
        // AUDIT-027 H-1: per-provider credentials in the EPIC-26
        // providerConfigs[] array + the legacy_active_models_backup
        // snapshot must be encrypted on the same pass; otherwise the
        // migration would write plaintext API keys + AWS credentials
        // into data.json (CWE-312). Pure walker lives in
        // src/core/security/providerCredentialCrypto.ts.
        encryptProviderCredentialsInPlace(copy, this.safeStorage);
        if (copy.webTools) {
            if (copy.webTools.braveApiKey && !this.safeStorage.isEncrypted(copy.webTools.braveApiKey)) {
                copy.webTools.braveApiKey = this.safeStorage.encrypt(copy.webTools.braveApiKey);
            }
            if (copy.webTools.tavilyApiKey && !this.safeStorage.isEncrypted(copy.webTools.tavilyApiKey)) {
                copy.webTools.tavilyApiKey = this.safeStorage.encrypt(copy.webTools.tavilyApiKey);
            }
        }
        // GitHub Copilot tokens (ADR-038)
        if (copy.githubCopilotAccessToken && !this.safeStorage.isEncrypted(copy.githubCopilotAccessToken)) {
            copy.githubCopilotAccessToken = this.safeStorage.encrypt(copy.githubCopilotAccessToken);
        }
        if (copy.githubCopilotToken && !this.safeStorage.isEncrypted(copy.githubCopilotToken)) {
            copy.githubCopilotToken = this.safeStorage.encrypt(copy.githubCopilotToken);
        }
        // Kilo Gateway token (ADR-041)
        if (copy.kiloToken && !this.safeStorage.isEncrypted(copy.kiloToken)) {
            copy.kiloToken = this.safeStorage.encrypt(copy.kiloToken);
        }
        // ChatGPT OAuth tokens (ADR-088)
        if (copy.chatgptOAuthAccessToken && !this.safeStorage.isEncrypted(copy.chatgptOAuthAccessToken)) {
            copy.chatgptOAuthAccessToken = this.safeStorage.encrypt(copy.chatgptOAuthAccessToken);
        }
        if (copy.chatgptOAuthRefreshToken && !this.safeStorage.isEncrypted(copy.chatgptOAuthRefreshToken)) {
            copy.chatgptOAuthRefreshToken = this.safeStorage.encrypt(copy.chatgptOAuthRefreshToken);
        }
        if (copy.chatgptOAuthIdToken && !this.safeStorage.isEncrypted(copy.chatgptOAuthIdToken)) {
            copy.chatgptOAuthIdToken = this.safeStorage.encrypt(copy.chatgptOAuthIdToken);
        }
        // AUTH-2: the ChatGPT account id and email (PII) were persisted in
        // cleartext even with the keychain available. Encrypt them like the
        // tokens above (decrypt pass below mirrors this).
        if (copy.chatgptOAuthEmail && !this.safeStorage.isEncrypted(copy.chatgptOAuthEmail)) {
            copy.chatgptOAuthEmail = this.safeStorage.encrypt(copy.chatgptOAuthEmail);
        }
        if (copy.chatgptOAuthAccountId && !this.safeStorage.isEncrypted(copy.chatgptOAuthAccountId)) {
            copy.chatgptOAuthAccountId = this.safeStorage.encrypt(copy.chatgptOAuthAccountId);
        }
        // Remote relay tokens (AUDIT-005 M-2)
        if (copy.cloudflareApiToken && !this.safeStorage.isEncrypted(copy.cloudflareApiToken)) {
            copy.cloudflareApiToken = this.safeStorage.encrypt(copy.cloudflareApiToken);
        }
        if (copy.relayToken && !this.safeStorage.isEncrypted(copy.relayToken)) {
            copy.relayToken = this.safeStorage.encrypt(copy.relayToken);
        }
        // Local MCP server token (AUDIT-006 H-1)
        if (copy.mcpServerToken && !this.safeStorage.isEncrypted(copy.mcpServerToken)) {
            copy.mcpServerToken = this.safeStorage.encrypt(copy.mcpServerToken);
        }
        // FEAT-04-10: OAuth MCP connector tokens (ADR-155).
        encryptMcpOAuthInPlace(copy, this.safeStorage);
        copy._encrypted = true;
        return copy;
    }

    /**
     * FEAT-24-12: push the pricing settings into the ModelPricing module.
     *
     * Called at boot and from saveSettings, because the module holds the rate
     * and the override map in module state: without the save-time call the
     * user's new rate would only reach the footer after a plugin reload, which
     * is indistinguishable from the setting not working at all.
     *
     * Returns the override lines that could not be parsed, so the settings tab
     * can name them instead of dropping them silently.
     */
    applyPricingSettings(): string[] {
        return setPricingConfig({
            usdToEur: this.settings.advancedApi?.usdToEurRate,
            priceOverridesText: this.settings.advancedApi?.priceOverridesText,
        }).invalidLines;
    }

    /**
     * Save plugin settings to disk and reinitialize API handler
     */
    async saveSettings() {
        await this.saveData(this.encryptSettingsForSave(this.settings));
        // Dual-write: persist global keys to ~/.obsidian-agent/settings.json.
        // FIX-44-36: the global file wins on load, so a failed write silently
        // reverts permission changes on restart. Surface it instead of hiding it.
        if (this.globalSettingsService) {
            const ok = await this.globalSettingsService.saveGlobal(this.settings);
            if (!ok) {
                new Notice(t('notice.globalSettingsSaveFailed'));
            }
        }
        this.initApiHandler();
        // FEAT-24-12: the cost footer converts with module state, so a saved
        // rate has to be applied here and not only at boot.
        this.applyPricingSettings();
        this.settingsDirty = false;
    }

    /**
     * FIX-PERF-04: mark settings as needing a save, but coalesce many
     * markSettingsDirty() calls during boot migration into a single
     * flushSettings() at the end. Idempotency markers that MUST survive
     * a doLoad crash still call saveSettings() directly.
     */
    private settingsDirty = false;
    markSettingsDirty(): void {
        this.settingsDirty = true;
    }
    async flushSettings(): Promise<void> {
        if (this.settingsDirty) {
            await this.saveSettings();
        }
    }

    /** Reconnect all MCP servers from current settings. Called when MCP config changes. */
    async reconnectMcp(): Promise<void> {
        await this.mcpClient.disconnectAll();
        if (Object.keys(this.settings.mcpServers ?? {}).length > 0) {
            await this.mcpClient.connectAll(this.settings.mcpServers);
        }
    }

    /**
     * Initialize the API handler from current settings.
     * Called on load and whenever settings change.
     */
    initApiHandler(): void {
        // EPIC-26 / ADR-115 amendment / ADR-120: try the active provider's
        // configured tier slot first. The default tier is `mid` (Advisor-
        // Pattern Hauptloop), with `flagship` as the rollback escape hatch
        // for H-01 validation. Pre-migration installs (`activeProviderId`
        // null or no provider config) fall back to the legacy
        // `getActiveModel()` path so nothing breaks before Welle 2 runs.
        const defaultTier = this.settings.defaultMainModelTier ?? 'mid';
        const tierModel = this.getTierModel(defaultTier);
        const model = tierModel ?? this.getActiveModel();

        if (!model) {
            if (this.settings.debugMode) {
                console.debug('[Plugin] No active model configured');
            }
            this.apiHandler = null;
            return;
        }

        // Require API key for cloud providers
        if ((model.provider === 'anthropic' || model.provider === 'openai' || model.provider === 'openrouter' || model.provider === 'azure') && !model.apiKey) {
            if (this.settings.debugMode) {
                // AUDIT-034 M-26: do not log the model-id key. It contains
                // the model name + provider tier the user has configured,
                // which is sensitive for users on custom endpoints. The
                // provider alone is enough for debugging.
                console.debug('[Plugin] API key not set for active model (provider:', model.provider, ')');
            }
            this.apiHandler = null;
            return;
        }

        try {
            this.apiHandler = buildApiHandler(modelToLLMProvider(model));
            console.debug(`[Plugin] API handler initialized: ${model.displayName ?? model.name} (${model.provider})`);

            // Pre-warm the DNS + TLS connection so the FIRST user message isn't
            // delayed by cold-start network setup (~5-18 s on some systems /
            // networks). One-shot; helper lives in src/api/warmup.ts.
            if (!this.warmupFired) {
                this.warmupFired = true;
                preWarmProviderConnection(model.provider, model.baseUrl);
            }
        } catch (error) {
            console.error('[Plugin] Failed to initialize API handler:', error);
            this.apiHandler = null;
        }
    }

    /**
     * Activate the agent chat view.
     *
     * FEAT-55-01: parallel chats are TABS INSIDE this one sidebar view (user
     * decision 2026-07-25), so there is exactly ONE sidebar leaf. If it
     * exists, reveal it; otherwise create it in the right sidebar. New chats
     * are opened as in-view tabs (openInViewTab / openNewChatTab), not new
     * Obsidian leaves.
     */
    async activateView() {
        const { workspace } = this.app;
        const existing = this.resolveActiveSidebarLeaf();
        const leaf = existing ?? workspace.getRightLeaf(false);
        if (!leaf) return;
        if (!existing) {
            await leaf.setViewState({ type: VIEW_TYPE_AGENT_SIDEBAR, active: true });
        }
        void workspace.revealLeaf(leaf);
    }

    /**
     * FEAT-55-01: open an ADDITIONAL chat session as a TAB INSIDE the sidebar
     * view (user decision 2026-07-25: tabs live within the one VO sidebar, not
     * as separate Obsidian leaves). Ensures the sidebar is open, then asks the
     * active view to add an in-view tab. A long-running task in one tab never
     * blocks starting work in another; the busy tab keeps running in the
     * background with a running indicator.
     */
    async openNewChatTab(): Promise<void> {
        await this.activateView();
        const leaf = this.resolveActiveSidebarLeaf();
        if (leaf?.view instanceof AgentSidebarView) {
            leaf.view.openInViewTab();
        }
    }

    /**
     * User feedback 2026-06-24: bridge from the active editor selection
     * into the sidebar composer. Used by both the editor-menu item
     * "Send selection to sidebar chat" and the Ctrl+i+i hotkey.
     *
     * Behaviour:
     *   - No active markdown view OR empty selection -> Notice + noop.
     *   - Otherwise opens the sidebar (may have been collapsed) and
     *     prepends a `<context>...</context>` block to the composer so
     *     the LLM sees the same selection boundary the inline panel
     *     uses on its first turn.
     */
    sendCurrentEditorSelectionToSidebar(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view === null || view === undefined) {
            new Notice(t('notice.sidebar.noActiveNote'));
            return;
        }
        const text = view.editor.getSelection();
        if (text.trim().length === 0) {
            new Notice(t('notice.sidebar.selectTextFirst'));
            return;
        }
        const notePath = view.file?.path ?? '(untitled)';
        void (async () => {
            try {
                await this.activateView();
                const leaf = this.resolveActiveSidebarLeaf();
                if (!leaf) return;
                const sidebar = leaf.view;
                if (sidebar instanceof AgentSidebarView) {
                    sidebar.prepopulateComposerWithContext({ text, notePath });
                }
            } catch (e) {
                console.warn('[Sidebar] send-selection-to-sidebar failed:', e);
            }
        })();
    }

    /**
     * Snapshot the active sidebar conversation for the memory pipeline.
     * Manual extraction paths (mark_for_memory tool, Star button) call this
     * to find out what to enqueue. Returns null when no sidebar leaf exists
     * or the active conversation has no messages.
     */
    /**
     * FEAT-55-01 (ADR-169): resolve the chat leaf a vault-wide action
     * should target. Last-focused chat leaf (if still open), else the
     * most-recent chat leaf, else the first leaf, else null. This is the
     * single resolver every migrated call site routes through; while only
     * one chat exists it returns that one, so behaviour is unchanged until
     * the multi-leaf detach loop is removed (final PLAN-53 slice).
     */
    resolveActiveSidebarLeaf(): WorkspaceLeaf | null {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR);
        const mostRecent = this.app.workspace.getMostRecentLeaf();
        const mostRecentChat = mostRecent?.view instanceof AgentSidebarView ? mostRecent : null;
        return resolveActiveChatLeaf(leaves, this.lastActiveChatLeaf, mostRecentChat);
    }

    /**
     * FEAT-55-01 (ADR-169): prepopulate the ACTIVE chat's composer with a
     * context selection. Shared by the editor "send selection to sidebar"
     * command and the inline SendToMainChat action so both target the
     * last-focused chat rather than the first leaf, and neither needs a
     * hard import of AgentSidebarView from a wiring module.
     */
    prepopulateActiveSidebarComposer(args: { text: string; notePath: string }): boolean {
        const leaf = this.resolveActiveSidebarLeaf();
        if (leaf?.view instanceof AgentSidebarView) {
            leaf.view.prepopulateComposerWithContext(args);
            return true;
        }
        return false;
    }

    snapshotActiveConversationForMemory(): ReturnType<AgentSidebarView['snapshotForMemory']> | null {
        const leaf = this.resolveActiveSidebarLeaf();
        if (!(leaf?.view instanceof AgentSidebarView)) return null;
        return leaf.view.snapshotForMemory?.() ?? null;
    }

    /**
     * Command-palette / hotkey entry for the manual save-to-memory flow.
     * Same pipeline as the Star button + chat input "..." menu, just
     * reachable via Cmd+Shift+M (when the user binds it).
     */
    async saveActiveConversationToMemory(): Promise<void> {
        if (!this.settings.memory.enabled) {
            new Notice(t('notice.memoryDisabled'));
            return;
        }
        const queue = this.extractionQueue;
        const snapshot = this.snapshotActiveConversationForMemory();
        if (!queue || !snapshot) {
            new Notice(t('notice.memoryNoActiveConversation'));
            return;
        }
        try {
            await queue.enqueueImmediate(snapshot);
            new Notice(t('notice.memorySaveQueued'));
        } catch (e) {
            console.warn('[Memory] Hotkey save failed:', e);
            new Notice(t('notice.memorySaveFailed'));
        }
    }

    /**
     * Daily aging sweep (FEATURE-0319 Phase 5). Idempotent within 24h
     * via settings.memory.lastAgingRunAt. Records a telemetry event on
     * each non-skipped run.
     */
    async runAgingSweep(force = false): Promise<void> {
        if (!this.memoryDB?.isOpen()) return;
        const { AgingService } = await import('./core/memory/AgingService');
        const service = new AgingService(this.memoryDB);
        const report = service.runAgingCycle({
            force,
            lastRunAt: this.settings.memory.lastAgingRunAt ?? null,
        });
        if (report.skipped) {
            console.debug(`[Plugin] Aging skipped: ${report.skippedReason}`);
            return;
        }
        this.settings.memory.lastAgingRunAt = report.timestamp;
        await this.saveSettings();
        await this.memoryDB.save().catch(() => undefined);
        console.debug(
            `[Plugin] Aging sweep: ${report.factsUpdated}/${report.factsProcessed} facts updated ` +
            `(by kind: identity=${report.byKind.identity}, fact=${report.byKind.fact}, ` +
            `event=${report.byKind.event}, preference=${report.byKind.preference})`,
        );
        await this.memoryV2Telemetry?.aging({
            factsProcessed: report.factsProcessed,
            factsUpdated: report.factsUpdated,
            skipped: false,
        });
    }

    /**
     * FEAT-29-12: auto-daily backup gate + runner. Pure orchestration
     * layer between the AutoBackupRunner pure-logic and the plugin's
     * settings + vault adapter. No-op when settings.backup is missing
     * or autoDailyEnabled is false. Persistence of lastAutoBackupAt is
     * done via saveSettings.
     */
    async runAutoBackup(): Promise<void> {
        if (!this.settings.backup) return;
        const { maybeRunAutoBackup } = await import('./core/backup/AutoBackupRunner');
        const agentRoot = (await import('./core/utils/agentFolder')).getInternalAgentFolderPath(this);
        // Wrap vault.adapter as the BackupFileAdapter shape the runner needs.
        const adapter = this.app.vault.adapter;
        const backupAdapter = {
            exists: (p: string) => adapter.exists(p),
            list: (p: string) => adapter.list(p),
            readBinary: async (p: string) => new Uint8Array(await adapter.readBinary(p)),
            writeBinary: (p: string, d: Uint8Array) => adapter.writeBinary(p, d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)),
            read: (p: string) => adapter.read(p),
            write: (p: string, d: string) => adapter.write(p, d),
            mkdir: async (p: string) => { if (!(await adapter.exists(p))) await adapter.mkdir(p); },
            stat: (p: string) => adapter.stat(p),
            remove: (p: string) => adapter.remove(p),
        };
        const result = await maybeRunAutoBackup(
            this.settings.backup,
            backupAdapter,
            agentRoot,
            this.settings,
            async (ts) => {
                if (this.settings.backup) {
                    this.settings.backup.lastAutoBackupAt = ts;
                    await this.saveSettings();
                }
            },
        );
        if (result.ran) {
            console.debug(`[Plugin] Auto-backup: ${result.filename} (${result.bytesWritten} bytes), pruned ${result.prunedFiles?.length ?? 0}`);
        } else if (result.error) {
            console.warn(`[Plugin] Auto-backup error: ${result.error}`);
        }
    }

    /**
     * Phase 6 -> 7 soak: build a SoakReport and show it in a modal where
     * the user can copy/save. The previous "copy on command" path failed
     * silently when the active leaf wasn't focused (clipboard API rejects
     * but we'd already shown the success Notice). Modal-based copy uses
     * a real user gesture, with a save-to-vault fallback.
     */
    /**
     * FEAT-19-10: One-Shot Backfill-Job ueber den Vault. Default folder
     * = ganzer Vault, optional via Settings.vaultIngest.autoTrigger.propertyName
     * begrenzbar. Progress als Notice alle 50 Notes.
     */
    /**
     * FEAT-42-05: at boot, apply an installed language pack for the active
     * Obsidian locale (English needs none). If the pack is missing for a
     * non-English locale, offer a one-time clickable download notice; the
     * offer repeats only when the locale changes. Never blocks boot on the
     * network, and never downloads without the explicit click.
     */
    private async applyLocalePackAtBoot(): Promise<void> {
        try {
            const result = await loadInstalledLocalePack(this);
            if (!result.needed || result.applied) return;

            const locale = getActiveLocale();
            if (this.settings.localePackPromptedFor === locale) return;
            const spec = result.spec ?? activeLocaleSpec(this);
            if (!spec) return;
            const label = LOCALE_LABELS[locale as Exclude<SupportedLocale, 'en'>] ?? locale;

            // Persist that we offered this locale so we do not nag every boot.
            this.settings.localePackPromptedFor = locale;
            void this.saveSettings();

            const notice = new Notice(t('notice.localePack.offer', { language: label }), 0);
            notice.messageEl.addClass('agent-clickable-notice');
            notice.messageEl.addEventListener('click', () => {
                notice.hide();
                const downloading = new Notice(t('notice.localePack.downloading', { language: label }), 0);
                void new OptionalAssetManager(this).install(spec)
                    .then(() => {
                        downloading.hide();
                        new Notice(t('notice.localePack.installedReload', { language: label }), 10_000);
                    })
                    .catch((e: unknown) => {
                        downloading.hide();
                        const msg = e instanceof Error ? e.message : String(e);
                        new Notice(t('notice.localePack.downloadFailed', { error: msg }), 10_000);
                    });
            });
        } catch (e) {
            console.warn('[i18n] locale pack boot load failed (non-fatal):', e);
        }
    }

    /**
     * Review-Finding: verhindert parallele Laeufe (On-demand-Doppelklick
     * UND Scheduler-Overlap) auf dem geteilten Budget-State. Beide
     * Trigger laufen jetzt durch runStufe3Freshness, das dieses Flag
     * setzt/prueft -- vorher schuetzte es nur den On-demand-Pfad.
     */
    private freshnessRunInFlight = false;

    /**
     * Ergebnis-Codes des geteilten Stufe-3-Chokepoints (ADR-163):
     *   - 'ran': mindestens ein Cluster verarbeitet, lastRunIso gesetzt
     *   - 'budget-noop': Budget erschoepft, 0 Cluster, lastRunIso NICHT gesetzt
     *   - 'busy': ein anderer Lauf ist bereits aktiv
     *   - 'external-off': Privacy-Toggle freshness.externalSources.enabled=false
     *   - 'not-ready': Job/Store noch nicht initialisiert
     */
    /**
     * FEAT-19-03-01: die vault-weite, alterungspriorisierte Kandidatenliste
     * fuer den Freshness-Lauf. Kombiniert alle registrierten Cluster, die
     * faelligen Notizzahlen (Klassen-Cooldown) und die Prioritaets-Regel.
     * Ersetzt die manuelle Hot-Auswahl.
     */
    private selectFreshnessClusters(): ClusterMetadataRecord[] {
        if (!this.clusterMetadataStore || !this.knowledgeDB?.isOpen()) return [];
        const all = this.clusterMetadataStore.getAll();
        if (all.length === 0) return [];

        const fresh = this.settings.freshness ?? DEFAULT_FRESHNESS_SETTINGS;
        const dueByCluster = countDueNotesByCluster(
            this.knowledgeDB.getDB(),
            {
                volatileRecheckDays: 7,
                evolvingRecheckDays: 30,
                stableRecheckDays: 90,
                excludePaths: fresh.excludePaths,
            },
            new Date(),
        );
        const excluded = new Set(fresh.excludeClusters ?? []);

        const inputs: ClusterFreshnessInput[] = all.map((c) => {
            const d = dueByCluster.get(c.cluster) ?? { dueVolatile: 0, dueEvolving: 0, dueStable: 0 };
            return {
                cluster: c.cluster,
                halfLifeDays: c.halfLifeDays,
                lastExternalCheck: c.lastExternalCheck,
                dueVolatile: d.dueVolatile,
                dueEvolving: d.dueEvolving,
                dueStable: d.dueStable,
                excluded: excluded.has(c.cluster),
            };
        });

        const ranked = selectDueClusters(inputs, new Date());
        // Zurueck auf die vollen Records, in der priorisierten Reihenfolge.
        const byName = new Map(all.map((c) => [c.cluster, c]));
        return ranked.map((r) => byName.get(r.cluster)).filter((c): c is ClusterMetadataRecord => !!c);
    }

    private async runStufe3Freshness(): Promise<{ ran: Stufe3RunResult } | 'budget-noop' | 'busy' | 'external-off' | 'not-ready'> {
        if (!this.stufe3PeriodicJob) return 'not-ready';
        if (this.freshnessRunInFlight) return 'busy';
        // Privacy-Gate (Review-Finding): der gesamte Stufe-3-Pass ist eine
        // externe Web-Freshness-Pruefung. freshness.externalSources.enabled
        // ist der dokumentierte "no external traffic"-Schalter; ohne ihn
        // darf weder der Weekly-Job noch der On-demand-Button Web-Queries
        // an Brave/Tavily senden. (Der Note-Verifier-Pfad prueft ihn
        // bereits; dieser Cluster-Level-Pfad tat es nicht.)
        if (this.settings.freshness?.externalSources?.enabled !== true) return 'external-off';
        this.freshnessRunInFlight = true;
        try {
            const result = await this.stufe3PeriodicJob.run();
            // Review-Finding: ein Budget-No-op darf lastRunIso NICHT setzen
            // (das wuerde den Weekly-Job bis zu 6 Tage verzoegern, obwohl
            // nichts gelaufen ist). Gilt jetzt fuer BEIDE Trigger.
            if (result.budgetExceeded && result.clustersProcessed === 0) {
                return 'budget-noop';
            }
            const cfg = this.settings.vaultIngest?.stufe3PeriodicJob;
            if (cfg) {
                cfg.lastRunIso = new Date().toISOString();
                void this.saveSettings();
            }
            // FIX-19-16-08: die sichtbare Spur des Laufs. Auch ein Lauf, in
            // dem der Pre-Filter alles mit "no" beantwortet, schreibt seine
            // Zahlen -- vorher war er von "nie gelaufen" nicht unterscheidbar
            // (Live-Vault 19.08.: 149 Cluster, 0 Spuren).
            if (this.settings.freshness?.writeReport !== false) {
                await this.writeFreshnessReport(renderFreshnessReport(result, new Date().toISOString()));
            }
            return { ran: result };
        } finally {
            this.freshnessRunInFlight = false;
        }
    }

    /** FIX-19-16-08: eine Datei, ueberschrieben pro Lauf, non-fatal. */
    private async writeFreshnessReport(md: string): Promise<void> {
        try {
            const dir = FRESHNESS_REPORT_PATH.split('/').slice(0, -1).join('/');
            if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
                await this.app.vault.createFolder(dir).catch(() => { /* exists */ });
            }
            const existing = this.app.vault.getAbstractFileByPath(FRESHNESS_REPORT_PATH);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, md);
            } else {
                await this.app.vault.create(FRESHNESS_REPORT_PATH, md);
            }
        } catch (e) {
            console.warn('[Freshness] report write failed (non-fatal):', e);
        }
    }

    /**
     * ADR-163 / FEAT-30-07: On-demand-Trigger fuer den External-Freshness-
     * Check aus der Vault-health-Section. Laeuft ueber die als hot
     * markierten Cluster (derselbe Pfad wie der Weekly-Job inklusive
     * Budget-Cap und Privacy-Gate) und aktualisiert lastRunIso.
     */
    async runFreshnessCheckNow(): Promise<void> {
        if (!this.stufe3PeriodicJob || !this.clusterMetadataStore) {
            new Notice(t('notice.freshness.notReady'), 6000);
            return;
        }
        if (this.settings.freshness?.externalSources?.enabled !== true) {
            new Notice(t('notice.freshness.externalSourcesOff'), 8000);
            return;
        }
        // FEAT-19-03-01: kein Hot-Gate mehr. Der Lauf deckt den ganzen
        // Vault alterungsgesteuert ab; sind gerade keine Notizen faellig,
        // ist das ein Ergebnis, keine Sackgasse.
        const due = this.selectFreshnessClusters();
        if (due.length === 0) {
            new Notice(t('notice.freshness.nothingDue'), 6000);
            return;
        }
        new Notice(t('notice.freshness.runStarted', { count: due.length }), 5000);
        try {
            const outcome = await this.runStufe3Freshness();
            if (outcome === 'busy') { new Notice(t('notice.freshness.alreadyRunning'), 5000); return; }
            if (outcome === 'budget-noop') { new Notice(t('notice.freshness.budgetExhausted'), 8000); return; }
            if (typeof outcome === 'object' && 'ran' in outcome) {
                // FIX-19-16-07: die Notice nennt die Zahlen des Laufs, nicht
                // nur "finished" -- ein 149x-"no"-Lauf ist sonst unsichtbar.
                const r = outcome.ran;
                new Notice(t('notice.freshness.runSummary', {
                    clusters: String(r.clustersProcessed),
                    webPasses: String(r.decisions.yes + r.decisions.unsure),
                    verdicts: String(r.verdictCount),
                }), 8000);
                return;
            }
            // external-off/not-ready sind oben bereits abgefangen.
        } catch (e) {
            console.warn('[Freshness] on-demand run failed:', e);
            new Notice(t('notice.freshness.runFailed', { error: e instanceof Error ? e.message : String(e) }), 8000);
        }
    }

    async runFrontmatterBackfill(): Promise<void> {
        if (!this.noteSummaryStore || !this.frontmatterPropertyStore) {
            new Notice(t('notice.backfill.storesNotReady'));
            return;
        }
        const cfg = this.settings.vaultIngest ?? DEFAULT_VAULT_INGEST_SETTINGS;
        const summaryGenerator = cfg.autoSummary.enabled
            ? buildSummaryGenerator({
                promptTemplate: cfg.summaryPrompt.template,
                apiHandlerFactory: () => {
                    const m = this.getMemoryModel();
                    return m ? buildApiHandlerForModel(m) : null;
                },
            })
            : null;
        // FEATURE-1508: knowledge.db lebt vault-lokal (siehe KnowledgeDB-Init oben).
        // Der FrontmatterWriter spiegelt den gleichen Mode wider.
        const storageMode = 'local' as const;
        const job = new FrontmatterBackfillJob(
            this.app,
            this.noteSummaryStore,
            this.frontmatterPropertyStore,
            { storageMode },
            summaryGenerator,
        );
        new Notice(t('notice.backfill.started'), 5000);
        const result = await job.run({
            writeFrontmatter: cfg.autoSummary.writeFrontmatter === true,
            frontmatterProperty: cfg.autoSummary.frontmatterProperty,
        }, (progress) => {
            if (progress.processed % 50 === 0 && progress.processed > 0) {
                new Notice(t('notice.backfill.progress', { processed: progress.processed, total: progress.total, summaries: progress.summariesWritten, errors: progress.errors }), 4000);
            }
        });
        new Notice(t('notice.backfill.done', { processed: result.processed, summaries: result.summariesWritten, mirrors: result.propertiesWritten, errors: result.errors }), 10000);
    }

    /**
     * FEAT-19-15: Inbox-Workflow. Iteriert ueber alle Markdown-Dateien
     * mit konfigurierter Auto-Trigger-Property und ruft das ingest_triage-Tool
     * fuer jede neu (idempotent ueber Triage-Log).
     */
    // eslint-disable-next-line @typescript-eslint/require-await -- async kept for symmetry with future LLM-backed triage decision flow
    async runInboxTriage(): Promise<void> {
        const cfg = this.settings.vaultIngest ?? DEFAULT_VAULT_INGEST_SETTINGS;
        if (!cfg.autoTrigger.propertyName) {
            new Notice(t('notice.triage.configureFirst'));
            return;
        }
        const expectedValues = Array.isArray(cfg.autoTrigger.propertyValue)
            ? cfg.autoTrigger.propertyValue
            : [cfg.autoTrigger.propertyValue];

        const candidates: TFile[] = [];
        for (const f of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(f);
            const v = cache?.frontmatter?.[cfg.autoTrigger.propertyName];
            if (v === null || v === undefined) continue;
            const valueStrs = Array.isArray(v) ? v.map(String) : [String(v)];
            if (valueStrs.some((vs) => expectedValues.includes(vs))) {
                candidates.push(f);
            }
        }
        if (candidates.length === 0) {
            const valueStr = Array.isArray(cfg.autoTrigger.propertyValue) ? cfg.autoTrigger.propertyValue.join(',') : cfg.autoTrigger.propertyValue;
            new Notice(t('notice.triage.noMatches', { property: cfg.autoTrigger.propertyName, value: valueStr }));
            return;
        }
        new Notice(t('notice.triage.candidatesFound', { count: candidates.length }), 6000);
        let triaged = 0;
        for (const file of candidates) {
            const sourceUri = `vault://${file.path}`;
            if (this.ingestTriageLogStore?.exists(sourceUri)) continue;
            this.ingestTriageLogStore?.record(sourceUri, 'pending');
            triaged++;
            console.debug(`[BA-25 Inbox-Triage] queued ${file.path}`);
        }
        new Notice(t('notice.triage.pendingRecorded', { count: triaged }));
    }

    /**
     * FEAT-19-11: MOC-Auto-Pflege manuell triggern. Ueber alle Notes mit
     * dem Marker-Block iterieren und Body neu generieren (Hub-Status,
     * Implicit-Connection-Vorschlaege, Cluster-Statistik). Helper-API
     * via MOCMaintainer.findAutoBlock/replaceOrInsertAutoBlock.
     */
    async refreshAllMOCs(): Promise<void> {
        const { findAutoBlock, replaceOrInsertAutoBlock } = await import('./core/ingest/MOCMaintainer');
        const allFiles = this.app.vault.getMarkdownFiles();
        let touched = 0;
        let skippedUserModified = 0;
        for (const file of allFiles) {
            const content = await this.app.vault.read(file);
            const block = findAutoBlock(content, 'moc-header');
            if (!block) continue; // No marker = not a MOC under management
            const newBody = await this.buildMOCAutoBody(file.path);
            const result = replaceOrInsertAutoBlock(content, newBody, { blockId: 'moc-header' });
            if (result.skippedReason === 'user-modified') { skippedUserModified++; continue; }
            if (result.written && result.newContent) {
                await this.app.vault.modify(file, result.newContent);
                touched++;
            }
        }
        new Notice(t('notice.moc.refreshDone', { updated: touched, skipped: skippedUserModified }));
    }

    /**
     * FEAT-03-26 Lifecycle: regen Top-Hub-Block nach Ontology-Change.
     * Debounced auf 60s damit Burst-Edits einen einzigen Regen-Pass
     * ergeben. generateIfNeeded vergleicht Hash und respektiert
     * Cooldown (24h Default), neue Hubs schlagen aber sofort durch.
     */
    scheduleTopHubBlockRegen(): void {
        if (!this.settings.vaultIngest?.topHubBlock?.enabled) return;
        if (!this.topHubBlockGenerator) return;
        if (this.topHubBlockRegenTimer) window.clearTimeout(this.topHubBlockRegenTimer);
        this.topHubBlockRegenTimer = window.setTimeout(() => {
            this.topHubBlockRegenTimer = null;
            if (!this.topHubBlockGenerator) return;
            const result = this.topHubBlockGenerator.generateIfNeeded(this.topHubBlockState);
            if (result) {
                this.topHubBlockState = result.state;
                this.topHubBlockMarkdown = result.block;
                console.debug('[BA-25] TopHubBlock regenerated after ontology change');
            }
        }, 60_000);
    }

    /**
     * FEAT-19-11: Injects the obsilo:auto-start/end Marker into MOC-Kandidaten,
     * die noch keinen Marker-Block tragen. Kandidat = Markdown-File dessen
     * Basename als Cluster im ClusterMetadataStore oder in der Ontologie
     * auftaucht. Idempotent: Files mit bereits vorhandenem Marker werden
     * uebersprungen.
     */
    async injectInitialMOCMarkers(): Promise<void> {
        const { findAutoBlock, replaceOrInsertAutoBlock } = await import('./core/ingest/MOCMaintainer');
        if (!this.knowledgeDB?.isOpen()) {
            new Notice(t('notice.moc.knowledgeDbUnavailable'));
            return;
        }
        const knownClusters = new Set<string>();
        if (this.clusterMetadataStore) {
            for (const m of this.clusterMetadataStore.getAll()) knownClusters.add(m.cluster);
        }
        try {
            const db = this.knowledgeDB.getDB();
            const r = db.exec('SELECT DISTINCT cluster FROM ontology WHERE cluster IS NOT NULL');
            if (r.length && r[0].values.length) {
                for (const row of r[0].values) {
                    const c = row[0] as string | null;
                    if (c) knownClusters.add(c);
                }
            }
        } catch (e) {
            console.debug('[BA-25] ontology cluster lookup failed:', e);
        }
        if (knownClusters.size === 0) {
            new Notice(t('notice.moc.noClusters'));
            return;
        }

        const allFiles = this.app.vault.getMarkdownFiles();
        let injected = 0;
        let skipped = 0;
        for (const file of allFiles) {
            const basename = file.basename;
            if (!knownClusters.has(basename)) continue;
            const content = await this.app.vault.read(file);
            if (findAutoBlock(content, 'moc-header')) { skipped++; continue; }
            const newBody = await this.buildMOCAutoBody(file.path);
            const result = replaceOrInsertAutoBlock(content, newBody, {
                blockId: 'moc-header',
                position: 'after-frontmatter',
            });
            if (result.written && result.newContent) {
                await this.app.vault.modify(file, result.newContent);
                injected++;
            }
        }
        new Notice(t('notice.moc.markersInjected', { injected, skipped }));
    }

    /**
     * FEAT-19-04-01: baut/aktualisiert den selbstbildenden Rueckverweis-Block
     * in allen Hub-Notizen. Laeuft NACH einem Health-Check-Lauf (USER-Wahl:
     * gebuendelt zu einem bekannten Zeitpunkt statt live per Edit-Event).
     *
     * Reines Script, KEIN LLM: getHubTargets (eine SQL-Query) + getSourcesFor
     * pro Hub + String-Bau + djb2-Hash-Vergleich. Geschrieben wird nur, wenn
     * sich der Blocktext wirklich aendert (replaceOrInsertAutoBlock kurzt
     * no-change ab) und die Notiz nicht vom Nutzer im Block editiert wurde.
     */
    async regenerateIncomingLinksBlocks(): Promise<{ status: 'disabled' | 'unavailable' | 'busy' | 'ok'; written: number; hubs: number }> {
        const cfg = this.settings.vaultIngest?.incomingLinksBlock;
        if (!cfg?.enabled) return { status: 'disabled', written: 0, hubs: 0 };
        if (!this.graphStore || !this.knowledgeDB?.isOpen()) return { status: 'unavailable', written: 0, hubs: 0 };
        // Nicht mitten in einen Health-Repair schreiben (geteilter Mutex).
        if (this.vaultHealthRepairInProgress) return { status: 'busy', written: 0, hubs: 0 };

        const settingsThreshold = cfg.threshold ?? INCOMING_LINKS_DEFAULT_THRESHOLD;
        const { computeIncomingBlockUpdate, INCOMING_BLOCK_ID } = await import('./core/knowledge/incomingLinksMaintainer');
        const { frontmatterCellText } = await import('./core/knowledge/incomingLinksBlock');
        const { buildBacklinksBaseBlock } = await import('./core/knowledge/backlinksBaseBlock');
        const { effectiveHubThreshold, isHubType } = await import('./core/knowledge/hubTypeThreshold');
        const { findAutoBlock } = await import('./core/ingest/MOCMaintainer');
        const summaryProp = this.settings.summaryProperty ?? OKF_DEFAULTS.summaryProperty;
        const typeProp = this.settings.categoryProperty ?? OKF_DEFAULTS.categoryProperty;
        // FEAT-19-04-01 W6: der lesbare .base-Block ist fuer alle Hub-Typen
        // identisch (er filtert live via file.hasLink(this.file)) -- einmal bauen.
        const baseBlock = buildBacklinksBaseBlock(summaryProp, typeProp);

        const typeOf = (file: TFile): string | undefined =>
            frontmatterCellText(this.app.metadataCache.getFileCache(file)?.frontmatter?.[typeProp]);

        // FIX-19-09-01 (USER 2026-07-21): die Zielmenge ist die UNION aus
        //  (a) allen Notes mit MINDESTENS EINEM echten Backlink -- getHubTargets(1)
        //      deckt Threshold-Hubs, strukturelle Hub-Typen (Threshold 1) UND
        //      unter-Settings-Threshold-gefallene Notes ab, und
        //  (b) allen Notes mit bereits vorhandenem Block (Ground Truth aus dem
        //      Dateisystem, resilient gegen Extraktions-Lag).
        // Es gibt KEINE Sonderaufnahme fuer type:person mehr: Hub-Typen haben
        // Threshold 1 (Block ab dem ersten Backlink, kein leerer Block), also
        // deckt getHubTargets(1) sie bereits ab. computeIncomingBlockUpdate
        // entscheidet pro Note anhand des effektiven Thresholds, ob ANGELEGT
        // wird; ein vorhandener Block wird IMMER aktualisiert und nie entfernt.
        const targetPaths = new Set<string>(
            this.graphStore.getHubTargets(1, { excludeLinkTypes: ['backlink-block'] }),
        );
        for (const file of this.app.vault.getMarkdownFiles()) {
            // (b) Notes mit vorhandenem Block -- Ground Truth aus dem File.
            try {
                const content = await this.app.vault.read(file);
                if (!content.includes('incoming-links')) continue; // schneller Vorfilter
                if (findAutoBlock(content, INCOMING_BLOCK_ID)) targetPaths.add(file.path);
            } catch { /* unlesbare Datei ueberspringen */ }
        }

        let written = 0;
        for (const hubPath of targetPaths) {
            const file = this.app.vault.getAbstractFileByPath(hubPath);
            if (!(file instanceof TFile)) continue;
            // FEAT-19-04-01 W6: die technische Tabelle zeigt nur noch den
            // Note-Link -- keine Anreicherung (description/type/timestamp) mehr
            // noetig. Die lesbare .base liest diese Properties live.
            const sources = this.graphStore.getSourcesFor(hubPath, { excludeLinkTypes: ['backlink-block'] });
            // FIX-19-09-01 (USER 2026-07-21): strukturelle Hub-Typen
            // (person/topic/concept/project/organisation + DE-Synonyme) bekommen
            // Threshold 1 -- einen Block ab dem ersten Backlink. Alle anderen
            // Notes erst ab dem konfigurierbaren Settings-Threshold. Die Regel
            // ist hartkodiert (nicht ueber Settings aenderbar).
            const noteType = typeOf(file);
            const effectiveThreshold = effectiveHubThreshold(noteType, settingsThreshold);
            // FEAT-19-04-01 W6: die lesbare .base gibt es NUR fuer Hub-Typen UND
            // nur wenn die Note tatsaechlich Backlinks hat (sonst kein Base ohne
            // Callout). Nicht-Hub-Typen -> undefined -> ein evtl. alter .base-
            // Block wird entfernt.
            const hubBacklinks = sources.filter((s) => s.sourcePath !== hubPath).length;
            const useBase = isHubType(noteType) && hubBacklinks >= 1 ? baseBlock : undefined;
            try {
                const content = await this.app.vault.read(file);
                const updated = computeIncomingBlockUpdate(content, sources, effectiveThreshold, hubPath, useBase);
                if (updated !== null && updated !== content) {
                    await this.app.vault.modify(file, updated);
                    written++;
                }
            } catch (e) {
                console.debug('[IncomingLinks] regen failed for', hubPath, e);
            }
        }
        if (written > 0) console.debug(`[IncomingLinks] updated ${written} hub note(s)`);
        return { status: 'ok', written, hubs: targetPaths.size };
    }

    /** Hilfs-Renderer fuer MOC-Auto-Body (Hub-Status + Cluster-Statistik). */
    // eslint-disable-next-line @typescript-eslint/require-await -- async kept for future LLM-backed body composition
    private async buildMOCAutoBody(mocPath: string): Promise<string> {
        const lines: string[] = [];
        const meta = this.clusterMetadataStore;
        const cluster = mocPath.replace(/\.md$/, '').split('/').pop() ?? mocPath;
        const halfLife = meta?.get(cluster)?.halfLifeDays;
        const stats = this.clusterSourceStatsStore?.getStatsForCluster(cluster) ?? [];
        const conc = this.clusterSourceStatsStore?.concentrationScore(cluster) ?? 0;
        lines.push(`_BA-25 MOC-Pflege ${new Date().toISOString().split('T')[0]}_`);
        lines.push('');
        if (halfLife !== undefined && halfLife > 0) lines.push(`- Halbwertszeit: ${halfLife} Tage`);
        if (stats.length > 0) {
            lines.push(`- Source-Domains: ${stats.length} distinct, top: ${stats[0].sourceDomain} (${stats[0].noteCount}x)`);
            lines.push(`- Concentration-Score: ${(conc * 100).toFixed(0)}%${conc >= 0.7 ? ' Bias-Warnung' : ''}`);
        }
        return lines.join('\n');
    }

    async generateAndCopySoakReport(): Promise<void> {
        try {
            const report = generateSoakReport({
                memoryDB: this.memoryDB,
                historyDB: this.historyDB,
                conversationStore: this.conversationStore,
                extractionQueue: this.extractionQueue,
                settings: { memory: this.settings.memory },
            });
            const json = JSON.stringify(report, null, 2);
            const { SoakReportModal } = await import('./ui/modals/SoakReportModal');
            const modal = new SoakReportModal(this.app, json, async () => {
                const day = new Date().toISOString().slice(0, 10);
                const path = `${this.settings.agentFolderPath}/soak-reports/${day}.json`;
                const adapter = this.app.vault.adapter;
                const dir = `${this.settings.agentFolderPath}/soak-reports`;
                if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
                await adapter.write(path, json);
                return path;
            });
            modal.open();
        } catch (e) {
            console.warn('[Plugin] Soak report generation failed:', e);
            new Notice(t('notice.memory.soakGenerateFailed'));
        }
    }

    /**
     * Sync the curated CapabilityManifest into Memory v2 (FEATURE-0319b).
     * On every plugin onload the live manifest is hashed (djb2 sync). If
     * the hash differs from settings.memory.lastCapabilityHash, the old
     * capability snapshot is deprecated and the new one is inserted as
     * facts under profile_id='_obsilo'. Idempotent on identical runs.
     */
    async syncCapabilitySnapshot(): Promise<void> {
        if (!this.memoryDB?.isOpen()) {
            console.debug('[Plugin] Capability snapshot sync skipped: memoryDB not open');
            return;
        }
        const { CAPABILITIES, manifestHash } = await import('./core/memory/CapabilityManifest');
        const { FactStore } = await import('./core/memory/FactStore');
        const { OBSILO_PROFILE } = await import('./core/memory/SoulView');

        const newHash = manifestHash();
        if (this.settings.memory.lastCapabilityHash === newHash) {
            console.debug(`[Plugin] Capability snapshot up-to-date (hash=${newHash}, ${CAPABILITIES.length} entries)`);
            return;
        }

        const factStore = new FactStore(this.memoryDB);
        const existing = factStore.listLatest({ profileId: OBSILO_PROFILE, limit: 500 })
            .filter(f => f.topics.includes('capability'));
        for (const fact of existing) {
            factStore.deprecate(fact.id, 'superseded by new capability snapshot');
        }
        for (const cap of CAPABILITIES) {
            factStore.insert({
                text: `${cap.summary}${cap.notes ? ' ' + cap.notes : ''}`,
                topics: ['capability', cap.area, cap.key],
                kind: 'identity',
                importance: 0.6,
                profileId: OBSILO_PROFILE,
                sourceInterface: 'obsilo-self',
                metadata: { area: cap.area, key: cap.key },
            });
        }
        await this.memoryDB.save().catch(() => undefined);
        this.settings.memory.lastCapabilityHash = newHash;
        await this.saveSettings();
        console.debug(`[Plugin] Capability snapshot synced: ${CAPABILITIES.length} entries (hash=${newHash}, replaced ${existing.length} stale)`);
    }

    /**
     * Returns the count of latest, non-deprecated Memory v2 facts that
     * came from this conversation. Used by the Star button in HistoryPanel
     * to render the toggle state (filled = has facts, empty = doesn't).
     */
    countMemoryFactsForConversation(conversationId: string): number {
        if (!this.memoryDB?.isOpen() || !conversationId) return 0;
        try {
            const result = this.memoryDB.getDB().exec(
                `SELECT COUNT(*) FROM facts
                  WHERE source_session_id = ?
                    AND is_latest = 1
                    AND deprecated_at IS NULL`,
                [conversationId],
            );
            if (result.length === 0 || result[0].values.length === 0) return 0;
            return Number(result[0].values[0][0]);
        } catch (e) {
            console.warn('[Memory] Fact count lookup failed:', e);
            return 0;
        }
    }

    /**
     * Soft-delete all Memory v2 facts that came from this conversation
     * and reset the thread-delta state so a future Save-to-Memory starts
     * fresh. Returns the number of facts deprecated.
     *
     * Soft-delete (not hard-delete) per ADR-085: the audit trail keeps
     * the original insert + the deprecate event so we can recover or
     * inspect later.
     */
    /**
     * Cascade delete: when a conversation is removed from history, also
     * remove the derived memory artefacts (session summary, thread-delta
     * state) and deprecate every fact that came from this conversation.
     *
     * Returns the number of facts deprecated. Audit trail of those facts
     * stays in `memory_audit` so the user can see what was removed; a
     * full nuke is reachable via "Delete all memory".
     */
    async deleteMemoryForConversationCascade(conversationId: string): Promise<number> {
        if (!this.memoryDB?.isOpen() || !conversationId) return 0;
        const deprecated = await this.unpinMemoryFactsForConversation(conversationId);
        try {
            const db = this.memoryDB.getDB();
            db.run('DELETE FROM sessions WHERE id = ?', [conversationId]);
            db.run('DELETE FROM conversation_threads WHERE thread_id = ?', [conversationId]);
            await this.memoryDB.save().catch(() => undefined);
        } catch (e) {
            console.warn('[Memory] Cascade delete (sessions/threads) failed:', e);
        }
        return deprecated;
    }

    async unpinMemoryFactsForConversation(conversationId: string): Promise<number> {
        if (!this.memoryDB?.isOpen() || !conversationId) return 0;
        try {
            const { FactStore } = await import('./core/memory/FactStore');
            const { ThreadDeltaStore } = await import('./core/memory/ThreadDeltaStore');
            const factStore = new FactStore(this.memoryDB);
            const result = this.memoryDB.getDB().exec(
                `SELECT id FROM facts
                  WHERE source_session_id = ?
                    AND is_latest = 1
                    AND deprecated_at IS NULL`,
                [conversationId],
            );
            const ids = result.length > 0
                ? result[0].values.map(r => r[0] as number)
                : [];
            for (const id of ids) {
                factStore.deprecate(id, 'unpinned by user', conversationId);
            }
            // Reset thread delta so a re-Star starts from message 0 again.
            const deltas = new ThreadDeltaStore(this.memoryDB);
            const existing = deltas.get(conversationId);
            if (existing) {
                deltas.save({ threadId: conversationId, lastExtractedMessageIndex: null, deltaSummary: null });
            }
            await this.memoryDB.save().catch(() => undefined);
            return ids.length;
        } catch (e) {
            console.warn('[Memory] Unpin failed:', e);
            return 0;
        }
    }

    /**
     * Open a conversation by ID via deep-link (ADR-022, FEATURE-300).
     * Activates the sidebar and loads the conversation if it exists.
     */
    async openChatById(id: string): Promise<void> {
        await this.activateView();
        const store = this.conversationStore;
        if (!store) return;
        const meta = store.list().find((m) => m.id === id);
        if (!meta) {
            new Notice(t('notice.conversationNotFound'));
            return;
        }
        const leaf = this.resolveActiveSidebarLeaf();
        if (leaf?.view instanceof AgentSidebarView) {
            void leaf.view.loadConversationById(id);
        }
    }

    /**
     * Open Obsidian settings and navigate to a specific tab/subtab.
     * Used by protocol handler and agent deep-links.
     */
    /**
     * Memory v2 upgrade detection (FEATURE-0316 / BUG-031 follow-up).
     *
     * Fresh installs ship with `v2MigrationStatus = 'not-applicable'` so this
     * method is a no-op for them (the v1 MD files never existed). Existing
     * users from earlier obsilo releases land here on first plugin load
     * after the update -- if they have the legacy memory MDs but no v2
     * facts yet, status flips to 'pending' and the upgrade modal opens.
     *
     * Idempotent: status stays 'completed'/'skipped' once decided.
     */
    /**
     * Prompt once when persistent data still sits outside the vault.
     *
     * FEAT-29-01-02 (Issue #69). Gated on hasMigratableSharedData rather than
     * detectLegacyLayoutPresence: the latter is the fast-path veto and fails
     * safe, answering true for a machine-wide ~/.obsidian-agent belonging to
     * another vault, for a consolidated install's own folder, and for an empty
     * vault path. Prompting on that would ask people to decide about a
     * migration with nothing to migrate. This asks the narrow question the
     * prompt is actually about: is there user data in a shared root that the
     * migration would move?
     *
     * Never nags: one shot, recorded vault-locally, and dismissing counts as
     * "keep as is" because this moves user data.
     */
    async maybePromptStorageLayoutUpgrade(): Promise<void> {
        if (this.settings._layoutMigrationStatus === 'complete') return;
        if (this.settings._layoutMigrationOptIn === true) return;
        if (this.settings._layoutUpgradePromptShown === true) return;

        const basePath = (this.app.vault.adapter as unknown as { getBasePath?(): string })
            .getBasePath?.() ?? '';
        if (!basePath) return;
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- same one-off path import the boot path uses; the plugin otherwise goes through safeFs
        const nodePath = require('path') as typeof import('path');
        const vaultParent = nodePath.dirname(basePath);

        const { hasMigratableSharedData } = await import('./core/utils/migrateAgentLayout');
        if (!(await hasMigratableSharedData(vaultParent))) return;

        const { storageLayoutUpgradeModal } = await import('./ui/modals/StorageLayoutUpgradeModal');
        const choice = await storageLayoutUpgradeModal(this.app);

        // Recorded either way: the question has been asked once.
        this.settings._layoutUpgradePromptShown = true;
        if (choice === 'migrate') {
            this.settings._layoutMigrationOptIn = true;
            await this.saveSettings();
            new Notice(t('notice.vault.layoutMigrationActivated'), 10000);
        } else {
            await this.saveSettings();
        }
    }

    async detectAndPromptMemoryV2Upgrade(): Promise<void> {
        if (!this.memoryDB?.isOpen() || !this.globalFs) return;
        const mem = this.settings.memory;

        // First detection pass: bump 'not-applicable' to a real verdict for
        // existing users. Fresh installs without v1 MDs stay 'not-applicable'.
        if (mem.v2MigrationStatus === 'not-applicable') {
            const hasV1 = await this.hasLegacyMemoryFiles();
            if (!hasV1) return; // truly fresh, nothing to migrate
            const factsCount = this.countV2Facts();
            mem.v2MigrationStatus = factsCount === 0 ? 'pending' : 'completed';
            await this.saveSettings();
        }

        if (mem.v2MigrationStatus !== 'pending') return;

        const { memoryV2UpgradeModal } = await import('./ui/modals/MemoryV2UpgradeModal');
        const choice = await memoryV2UpgradeModal(this.app, { reason: 'auto-on-load' });
        if (choice === 'migrate') {
            // FIX-26-99-01: was 'agent' (tot-String) -- memory lives under
            // agent-behaviour > memory.
            this.openSettingsAt('agent-behaviour', 'memory');
        } else {
            mem.v2MigrationStatus = 'skipped';
            await this.saveSettings();
        }
    }

    private async hasLegacyMemoryFiles(): Promise<boolean> {
        if (!this.globalFs) return false;
        const candidates = [
            'memory/user-profile.md', 'memory/projects.md', 'memory/patterns.md',
            'memory/errors.md', 'memory/custom-tools.md', 'memory/soul.md',
        ];
        for (const path of candidates) {
            try {
                if (await this.globalFs.exists(path)) {
                    const content = await this.globalFs.read(path).catch(() => '');
                    // Non-empty content = real legacy data, not just the auto-created template
                    if (content.trim().length > 50) return true;
                }
            } catch { /* try next */ }
        }
        return false;
    }

    private countV2Facts(): number {
        if (!this.memoryDB?.isOpen()) return 0;
        try {
            const result = this.memoryDB.getDB().exec('SELECT COUNT(*) FROM facts');
            return (result[0]?.values?.[0]?.[0] as number) ?? 0;
        } catch {
            return 0;
        }
    }

    /**
     * FIX-26-99-01: was accepting arbitrary `string` and casting to TabId
     * at the call to settingsTab.openAt(). That swallowed tot-Strings
     * like `'agent'` silently and left the user on the default tab.
     * Now constrained to the TabId union; the compiler refuses any
     * caller that passes an invalid id.
     */
    /**
     * IMP-06-01-01: surface the one-shot PDF-reindex hint exactly once
     * for users who indexed PDFs before v2.14.10. Quietly returns when
     * the precondition does not hold (hint already shown, reindex
     * already done, semantic index off, indexPdfs off, or no PDFs in
     * the vault).
     */
    private async maybeShowPdfReindexHint(): Promise<void> {
        const s = this.settings;
        if (s._pdfReindexHintShown) return;
        if (s._pdfReindexCompleted) return;
        if (!s.enableSemanticIndex) return;
        if (!s.semanticIndexPdfs) return;
        const hasPdfs = this.app.vault.getFiles().some((f) => f.extension.toLowerCase() === 'pdf');
        if (!hasPdfs) return;
        const { PdfReindexHintModal } = await import('./ui/modals/PdfReindexHintModal');
        new PdfReindexHintModal(this.app, this).open();
    }

    openSettingsAt(tab: TabId, subTab?: string): void {
        // Open the Obsidian settings modal
        const setting = this.app.setting;
        if (setting) {
            setting.open();
            // Navigate to our plugin's settings tab
            setting.openTabById(this.manifest.id);
            // Then navigate to the specific tab/subtab within our settings
            window.setTimeout(() => {
                if (this.settingsTab) {
                    this.settingsTab.openAt(tab, subTab);
                }
            }, 50);
        }
    }

    /**
     * Browser-triggered skill run (obsidian://vault-operator-run?skill=<slug>).
     * External input: the slug is validated against the safe-path whitelist
     * and the run is always gated behind an in-app confirmation — any web
     * page can fire this URL, so it must never start a run silently.
     */
    private async runSkillFromParams(params: Record<string, string>): Promise<void> {
        const skill = typeof params.skill === 'string' ? params.skill : '';
        if (!isSafePathSegment(skill)) {
            console.warn('[deeplink] Rejected vault-operator-run with invalid skill slug');
            return;
        }
        // Reentrancy guard (P1, 2026-07-05 data-loss follow-up): obsidian:// URLs
        // are firable by ANY web page, and the dashboard "Aktualisieren" button
        // polls, so a second trigger can arrive while a run is active or being
        // started. A second run would overlap writes to the same day-file, or --
        // if a run is mid-flight -- be swallowed as a steering nudge
        // (AgentSidebarView.handleSendMessage). Refuse both.
        if (this.skillRunPending || this.isAgentBusy()) {
            new Notice(t('protocol.runSkillBusy', { skill }));
            return;
        }
        this.skillRunPending = true;
        let started = false;
        try {
            // IMP-43-01-01: the modal says what actually starts. The intent
            // comes from a hard whitelist (runDeeplinkIntent), never free
            // text, so FEAT-43-01's no-prompt-injection rule is untouched and
            // a forged value falls back to the most cautious generic wording.
            const intent = resolveRunIntent(params);
            const keys = resolveRunIntent.keysFor(intent);
            const ok = await confirmModal(this.app, {
                title: t(keys.title),
                message: t(keys.message, { skill }),
                confirmLabel: t(keys.button),
                cancelLabel: t('settings.vault.cancel'),
            });
            if (!ok) return;
            // Der Slash-Command traegt den Hinweis als Rest hinter EINEM
            // Leerzeichen (AgentSidebarView haengt ihn an den Skill-Body).
            // Ohne ihn stand im Chat nur "/daily-briefing", ununterscheidbar
            // von einem vollen Recherche-Lauf -- der Nutzer brach genau dort
            // ab. Der Text kommt aus i18n, der Link waehlt nur den Intent.
            const hintKey = resolveRunIntent.hintKeyFor(intent);
            const hint = hintKey ? ` ${t(hintKey)}` : '';
            await this.sendMessageToAgent(`/${skill}${hint}`);
            started = true;
        } finally {
            if (started) {
                // Hold the flag briefly so the just-started run has time to flip
                // a view to busy; isAgentRunBusy() covers it from then on.
                window.setTimeout(() => { this.skillRunPending = false; }, 1500);
            } else {
                this.skillRunPending = false;
            }
        }
    }

    /** True while any agent sidebar view has a run in flight. Used by the
     *  deeplink reentrancy guard AND by background indexing (agentBusyGate,
     *  IMP-01-04-03) to defer boot-deferred reindex/enrichment while a task runs. */
    isAgentBusy(): boolean {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_SIDEBAR);
        return leaves.some((leaf) => leaf.view instanceof AgentSidebarView && leaf.view.isBusy);
    }

    /**
     * PERF 2026-07-25 (send-latency RCA): register a heavy startup job instead
     * of firing it directly in `onLayoutReady`.
     *
     * Six heavy jobs used to start in the same tick -- graph extraction, the
     * ontology bootstrap, vault health, incoming-links regeneration, the
     * implicit-connections sweep and the reranker load. On a single-threaded
     * renderer they interleaved with the user's first send; one measured send
     * spent 75 s of HOST time against 1.3 s of provider time. The queue runs
     * them one at a time, waits while an agent task is in flight (the
     * agentBusyGate admission gate, which only the semantic reindex used
     * before), and leaves a gap between jobs so the UI can paint. The gate's
     * starvation deadline still applies, so startup work cannot be postponed
     * forever by back-to-back tasks.
     */
    enqueueBootJob(label: string, run: () => unknown): void {
        this.bootJobs.push({ label, run });
        if (!this.bootJobsScheduled) {
            this.bootJobsScheduled = true;
            this.app.workspace.onLayoutReady(() => {
                this.bootJobsLayoutReady = true;
                void this.drainBootJobsNow();
            });
            return;
        }
        // USER 2026-07-26: re-arm. Registration is spread across an async load
        // with several awaits in it, so on a plugin RELOAD (layout already
        // ready, onLayoutReady fires at once) the first drain could finish
        // before the later jobs were even queued -- they then sat in an array
        // nobody was draining. That stranded four of the six jobs, including the
        // vault-health check, which is why the health button above the chat went
        // missing. The queue consumes its entries, so a second drain only picks
        // up what is left.
        if (this.bootJobsLayoutReady) void this.drainBootJobsNow();
    }

    /** Drain the boot queue, unless a drain is already in flight. */
    private async drainBootJobsNow(): Promise<void> {
        if (this.bootJobsDraining) return;
        this.bootJobsDraining = true;
        try {
            await drainBootJobs(this.bootJobs, {
                isBusy: () => this.isAgentBusy(),
                waitWhileBusy: (isBusy) => waitWhileBusy(isBusy, {
                    maxWaitMs: BACKGROUND_STARVATION_MS,
                    pollMs: BACKGROUND_POLL_MS,
                }),
            });
        } finally {
            this.bootJobsDraining = false;
            // A job appended during the final inter-job gap would otherwise wait
            // for a drain that has just ended.
            if (this.bootJobs.length > 0) void this.drainBootJobsNow();
        }
    }

    /**
     * Open the sidebar and programmatically send a message.
     * Used by Settings buttons to trigger agent actions (e.g. "Start setup").
     */
    async sendMessageToAgent(text: string, hidden = false): Promise<void> {
        await this.activateView();
        // Small delay to ensure the view is rendered
        window.setTimeout(() => {
            const leaf = this.resolveActiveSidebarLeaf();
            if (leaf?.view instanceof AgentSidebarView) {
                leaf.view.sendProgrammaticMessage(text, hidden);
            }
        }, 200);
    }

    /**
     * Phase 2.3: open the FirstRunWizard the first three times the
     * plugin starts unless the user has finished it or said "don't show
     * again". The shown-count is incremented up-front so the user gets
     * a deterministic three exposures.
     */
    async maybeAutoOpenSetupWizard(): Promise<void> {
        const ob = this.settings.onboarding;
        if (ob.modalCompleted) return;
        if (ob.dontShowFirstRunAgain) return;
        const shown = ob.firstRunModalShownCount ?? 0;
        if (shown >= 3) return;
        // FIX (2026-06-15): manual restart-from-Settings + cancel should
        // not re-open the wizard on the next reload when a provider is
        // already configured. Mirror the AgentSidebarView wizardPending
        // gate so both auto-open paths agree.
        const { isActiveOnboardingFlow } = await import('./core/onboarding-status');
        if (!isActiveOnboardingFlow(this.settings)) return;

        ob.firstRunModalShownCount = shown + 1;
        await this.saveSettings();

        const { FirstRunWizardModal } = await import('./ui/modals/FirstRunWizardModal');
        new FirstRunWizardModal(this.app, this).open();
    }

    /**
     * Open the sidebar and start the LLM-driven onboarding conversation.
     * Used by Settings buttons (Start/Restart setup).
     */
    async startOnboarding(): Promise<void> {
        // Close the settings modal so the user sees the chat
        this.app.setting?.close();
        await this.activateView();
        window.setTimeout(() => {
            const leaf = this.resolveActiveSidebarLeaf();
            if (leaf?.view instanceof AgentSidebarView) {
                leaf.view.startOnboardingChat();
            }
        }, 200);
    }

    /**
     * Schedule a single file for re-indexing after a 2s debounce.
     * Fires on vault modify/create events — debounce prevents thrashing
     * while the user is actively typing in a note.
     */
    /**
     * One-time cleanup: remove old sync data from the plugin directory.
     * Called after migration to .obsilo-sync/ to free ~600 MB from the vault.
     * Preserves: skills/ (bundled), checkpoints/, dev-env/, main.js, manifest.json, etc.
     */
    /**
     * FEATURE-1508: Migrate data from ~/.obsidian-agent/ to {vault-parent}/.obsidian-agent/
     * and knowledge.db to {vault}/.obsidian-agent/. One-time, idempotent.
     */
    private async migrateToParentDir(vaultBasePath: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- path/os are pure helpers, no fs surface
        const path = require('path') as typeof import('path');
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- path/os are pure helpers
        const os = require('os') as typeof import('os');

        const oldRoot = path.join(os.homedir(), '.obsidian-agent');
        const newRoot = this.globalFs.getRoot();

        // Skip if old and new are the same (shouldn't happen, but safety check)
        if (oldRoot === newRoot) return;

        // Skip if old root doesn't exist
        try {
            await safeFs.promises.access(oldRoot);
        } catch {
            console.debug('[Plugin] No legacy ~/.obsidian-agent/ found — skip migration');
            // Still clean up legacy vault dirs
            await this.cleanupLegacyVaultDirs();
            return;
        }

        console.debug(`[Plugin] Migrating storage: ${oldRoot} -> ${newRoot}`);
        await safeFs.promises.mkdir(newRoot, { recursive: true });

        // Copy directories
        const dirsToMigrate = ['memory', 'history', 'logs', 'rules', 'skills', 'workflows'];
        let migrated = 0;
        for (const dir of dirsToMigrate) {
            const src = path.join(oldRoot, dir);
            const dst = path.join(newRoot, dir);
            try {
                await safeFs.promises.access(src);
                // Only copy if destination doesn't exist (don't overwrite)
                try { await safeFs.promises.access(dst); } catch {
                    await safeFs.promises.cp(src, dst, { recursive: true });
                    migrated++;
                }
            } catch { /* source dir doesn't exist — skip */ }
        }

        // Copy individual files
        const filesToMigrate = ['settings.json', 'pending-extractions.json'];
        for (const file of filesToMigrate) {
            const src = path.join(oldRoot, file);
            const dst = path.join(newRoot, file);
            try {
                await safeFs.promises.access(src);
                try { await safeFs.promises.access(dst); } catch {
                    await safeFs.promises.copyFile(src, dst);
                    migrated++;
                }
            } catch { /* skip */ }
        }

        // Migrate knowledge.db to vault-local
        const oldKnowledgeDb = path.join(oldRoot, 'knowledge.db');
        const newKnowledgeDb = path.join(vaultBasePath, '.obsilo-vault', 'knowledge.db');
        try {
            await safeFs.promises.access(oldKnowledgeDb);
            await safeFs.promises.mkdir(path.dirname(newKnowledgeDb), { recursive: true });
            try { await safeFs.promises.access(newKnowledgeDb); } catch {
                await safeFs.promises.copyFile(oldKnowledgeDb, newKnowledgeDb);
                migrated++;
                console.debug('[Plugin] Migrated knowledge.db to vault-local');
            }
        } catch { /* skip */ }

        // Migrate memory.db to new global root (legacy vault-local name was '.obsidian-agent')
        const oldMemoryDb = path.join(vaultBasePath, '.obsidian-agent', 'memory.db');
        // (Note: my pre-init migration may have already renamed this to 'obsilo-vault'.
        //  We fall through with whichever path actually exists.)
        const newMemoryDb = path.join(newRoot, 'memory.db');
        try {
            await safeFs.promises.access(oldMemoryDb);
            try { await safeFs.promises.access(newMemoryDb); } catch {
                await safeFs.promises.copyFile(oldMemoryDb, newMemoryDb);
                migrated++;
                console.debug('[Plugin] Migrated memory.db to vault-parent');
            }
        } catch { /* skip */ }

        console.debug(`[Plugin] Storage migration complete: ${migrated} items migrated`);

        // Clean up legacy vault directories
        await this.cleanupLegacyVaultDirs();
    }

    /** Remove legacy vault directories (.obsilo-sync, .obsilo, .obsidian/.obsilo, semantic-index). */
    private async cleanupLegacyVaultDirs(): Promise<void> {
        const adapter = this.app.vault.adapter;
        const legacyDirs = ['.obsilo-sync', '.obsilo'];
        for (const dir of legacyDirs) {
            try {
                if (await adapter.exists(dir)) {
                    await adapter.rmdir(dir, true);
                    console.debug(`[Plugin] Removed legacy ${dir}/`);
                }
            } catch (e) {
                console.warn(`[Plugin] Failed to remove ${dir} (non-fatal):`, e);
            }
        }
        // .obsidian/.obsilo
        const dotObsilo = `${this.app.vault.configDir}/.obsilo`;
        try {
            if (await adapter.exists(dotObsilo)) {
                await adapter.rmdir(dotObsilo, true);
                console.debug('[Plugin] Removed legacy config-dir/.obsilo/');
            }
        } catch { /* non-fatal */ }
    }

    private scheduleFileIndex(filePath: string): void {
        if (!this.semanticIndex?.isIndexed) return;
        if (this.settings.semanticExcludedFolders?.some((f) => filePath.startsWith(f + '/'))) return;
        const existing = this.autoIndexDebounceTimers.get(filePath);
        if (existing) window.clearTimeout(existing);
        const timer = window.setTimeout(() => {
            this.autoIndexDebounceTimers.delete(filePath);
            // Use queue (concurrency=1) instead of direct updateFile to prevent
            // concurrent embedding calls from freezing Obsidian's main thread.
            this.semanticIndex?.queueAutoUpdate(filePath);
        }, 2000);
        this.autoIndexDebounceTimers.set(filePath, timer);
    }

    /**
     * Test tool execution (Development only)
     * M-4: Gated behind debugMode — bypasses approval pipeline.
     */
    async testToolExecution() {
        if (!this.settings.debugMode) {
            console.warn('[testToolExecution] Blocked — enable debugMode in settings first.');
            new Notice(t('notice.debug.testBlocked'));
            return;
        }
        console.debug('=== Testing Tool Execution ===');
        new Notice(t('notice.debug.testStarted'));

        // Create a pipeline instance for testing
        const pipeline = new ToolExecutionPipeline(
            this,
            this.toolRegistry,
            'test-task-001',
            'agent'
        );

        // Create callbacks to collect results. AUDIT-034 M-25: truncate
        // debug dumps to 200 chars so a write_file result with vault
        // content does not flood the renderer console with sensitive data.
        const results: string[] = [];
        const callbacks: ToolCallbacks = {
            pushToolResult: (content: string) => {
                results.push(content);
                const preview = content.length > 200 ? content.slice(0, 200) + '...[truncated]' : content;
                console.debug('Tool result:', preview);
            },
            handleError: (toolName: string, error: unknown) => {
                console.error(`Error in ${toolName}:`, error);
            },
            log: (message: string) => {
                console.debug('Tool log:', message);
            }
        };

        try {
            // Test 1: Write then read to test roundtrip
            console.debug('\n--- Test 1: Write test file ---');
            const writeTool: ToolUse = {
                type: 'tool_use',
                id: 'test-write-001',
                name: 'write_file',
                input: {
                    path: 'obsidian-agent-test.md',
                    content: `# Tool Execution Test\n\nTimestamp: ${new Date().toISOString()}\n\nAll systems operational!`
                }
            };
            await pipeline.executeTool(writeTool, callbacks);

            // Then read it back
            console.debug('\n--- Test 2: Read back the test file ---');
            const readTool: ToolUse = {
                type: 'tool_use',
                id: 'test-read-001',
                name: 'read_file',
                input: { path: 'obsidian-agent-test.md' }
            };

            const readResult = await pipeline.executeTool(readTool, callbacks);
            const readContentText = typeof readResult.content === 'string' ? readResult.content : '[multimodal]';
            console.debug('Read result (content populated):', readContentText.substring(0, 100) + '...');

            console.debug('\n=== Tool Execution Test Complete ===');
            console.debug('Results collected:', results.length);

            new Notice(t('notice.debug.testComplete'));
        } catch (error) {
            console.error('Tool execution test failed:', error);
            new Notice(t('notice.debug.testFailed'));
        }
    }
}

/** Parse URL and check hostname instead of substring match (CodeQL: js/incomplete-url-substring-sanitization) */
function isGeminiApiUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
        const hostname = new URL(url).hostname;
        return hostname === 'generativelanguage.googleapis.com'
            || hostname.endsWith('.generativelanguage.googleapis.com');
    } catch {
        return false;
    }
}

/**
 * FIX 2026-05-04: deep-merge fuer Settings. Sub-Objekte (z.B.
 * vaultIngest.topHubBlock, memory.crossSurface) werden aus den
 * Defaults rekursiv gefuellt wenn sie im persistenten data.json
 * fehlen. Arrays + null-Werte aus saved werden nicht gemergt
 * sondern uebernommen wie sie sind. Plain-Objects werden rekursiv
 * gemergt. Vermeidet die "neuer Toggle reagiert nicht"-Falle bei
 * Plugin-Upgrades.
 */
function deepMergeSettings<T extends Record<string, unknown>>(defaults: T, saved: Partial<T>): T {
    if (!saved || typeof saved !== 'object') return { ...defaults };
    const merged = { ...defaults } as Record<string, unknown>;
    for (const [key, savedValue] of Object.entries(saved)) {
        // AUDIT-034 Info-6 (CWE-1321 hardening): JSON.parse stores __proto__
        // as an own enumerable property, so Object.entries surfaces it. Skip
        // the three prototype-pollution sentinels before any recursion so a
        // hand-crafted data.json cannot mutate the merged object's prototype
        // chain. saveData strips them via JSON.stringify anyway; this is
        // defense in depth.
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }
        const defaultValue = (defaults as Record<string, unknown>)[key];
        if (
            savedValue !== null
            && typeof savedValue === 'object'
            && !Array.isArray(savedValue)
            && defaultValue !== null
            && typeof defaultValue === 'object'
            && !Array.isArray(defaultValue)
        ) {
            merged[key] = deepMergeSettings(
                defaultValue as Record<string, unknown>,
                savedValue as Record<string, unknown>,
            );
        } else {
            merged[key] = savedValue;
        }
    }
    return merged as T;
}

/* eslint-enable -- end of file-level disable for boundary code (SDK/JSON/Obsidian internals) */
