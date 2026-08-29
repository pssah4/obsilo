/**
 * Tier-resolution helpers (EPIC-26 / FEAT-26-01 / FEAT-26-02 / ADR-120).
 *
 * Pure functions that resolve `providerConfigs[]` entries into the
 * `CustomModel` shape the rest of the plugin expects. Extracted out of
 * `src/main.ts` so the logic is unit-testable without instantiating the
 * full Obsidian plugin shell.
 *
 * The plugin's class methods (`getActiveProvider`, `getTierModel`,
 * `getAdvisorModel`, `providerConfigToCustomModel`) delegate here.
 */

import type {
    CustomModel,
    DiscoveredModel,
    ModelTier,
    ObsidianAgentSettings,
    ProviderConfig,
} from '../../types/settings';
import { getModelKey } from '../../types/settings';
import { isEffortOptedIn } from '../../types/model-registry';

/**
 * ADR-158: plausibility clamp for a discovery-reported context window.
 * Values below the floor are bogus (gateway stubs report 0 or 1; no
 * servable chat model ships under 4k). AUDIT 2026-07-18 L-3: values above
 * the ceiling are equally bogus (a compromised or broken endpoint could
 * report 10^12 and thereby disarm the ADR-157 overflow guardrail) -- 50M
 * tokens is 50x the largest served window today. Out-of-range values fall
 * through to the registry chain.
 */
export const MIN_PLAUSIBLE_CONTEXT_WINDOW = 4096;
export const MAX_PLAUSIBLE_CONTEXT_WINDOW = 50_000_000;

/** Return the currently active provider config, or null when none is selected / enabled. */
export function resolveActiveProvider(
    settings: Pick<ObsidianAgentSettings, 'activeProviderId' | 'providerConfigs'>,
): ProviderConfig | null {
    const id = settings.activeProviderId;
    if (!id) return null;
    const provider = (settings.providerConfigs ?? []).find((p) => p.id === id);
    return provider && provider.enabled ? provider : null;
}

/**
 * Resolve a tier slot on the active provider into a CustomModel.
 * Cascade: `tierOverrides[tier]` -> `tierMapping[tier]` -> next lower tier.
 * Returns null when nothing in the cascade is populated.
 */
export function resolveTierModel(
    settings: Pick<ObsidianAgentSettings, 'activeProviderId' | 'providerConfigs'>,
    tier: ModelTier,
): CustomModel | null {
    const provider = resolveActiveProvider(settings);
    if (!provider) return null;

    const cascade: ModelTier[] =
        tier === 'flagship' ? ['flagship', 'mid', 'fast']
        : tier === 'mid' ? ['mid', 'fast']
        : ['fast'];

    for (const t of cascade) {
        const modelId = provider.tierOverrides?.[t] ?? provider.tierMapping?.[t];
        if (!modelId) continue;
        const discovered = (provider.discoveredModels ?? []).find((m) => m.id === modelId);
        return providerConfigToCustomModel(provider, modelId, discovered);
    }
    return null;
}

/**
 * The legacy flat selection: `activeModelKey` looked up in `activeModels`,
 * ignoring a disabled entry. Pre-migration installs (no provider config) run on
 * this path, and it is the fallback under every tier resolver.
 *
 * FIX-24-05-08: extracted so exactly ONE implementation answers "which model
 * will this run use". `ObsidianAgentPlugin.getActiveModel()` delegates here and
 * keeps only its one-time cloud-provider notice; the model pill asks the same
 * function. A second copy could drift, and a pill that names a model the run
 * does not use is the display half of the misattribution this fix is about.
 */
export function resolveActiveModel(
    settings: Pick<ObsidianAgentSettings, 'activeModelKey' | 'activeModels'>,
): CustomModel | null {
    const key = settings.activeModelKey;
    if (!key) return null;
    const model = (settings.activeModels ?? []).find((m) => getModelKey(m) === key);
    return model?.enabled ? model : null;
}

/**
 * FIX-24-05-08 (D7): the model the "Auto" pill actually stands for.
 *
 * Same chain as `ObsidianAgentPlugin.initApiHandler`: the default main tier on
 * the active provider, then the legacy flat selection. "Auto" is a routing
 * decision, so a UI that only prints the word tells the user nothing about what
 * is being billed; this resolves it to the model the next request will go to.
 */
export function resolveAutoModel(
    settings: Pick<
        ObsidianAgentSettings,
        'activeProviderId' | 'providerConfigs' | 'defaultMainModelTier' | 'activeModelKey' | 'activeModels'
    >,
): CustomModel | null {
    const tier = settings.defaultMainModelTier ?? 'mid';
    return resolveTierModel(settings, tier) ?? resolveActiveModel(settings);
}

/**
 * Return the flagship-tier model on the active provider, or null when
 * the flagship slot is empty. Unlike `resolveTierModel('flagship')`,
 * this does NOT cascade down -- the advisor pattern needs the actual
 * flagship or nothing.
 */
export function resolveAdvisorModel(
    settings: Pick<ObsidianAgentSettings, 'activeProviderId' | 'providerConfigs'>,
): CustomModel | null {
    const provider = resolveActiveProvider(settings);
    if (!provider) return null;
    const modelId = provider.tierOverrides?.flagship ?? provider.tierMapping?.flagship;
    if (!modelId) return null;
    const discovered = (provider.discoveredModels ?? []).find((m) => m.id === modelId);
    return providerConfigToCustomModel(provider, modelId, discovered);
}

/**
 * Build a CustomModel from a ProviderConfig + model id, pulling auth
 * credentials from the provider entry. Keeps the rest of the plugin on
 * the existing CustomModel-shaped API surface.
 */
export function providerConfigToCustomModel(
    provider: ProviderConfig,
    modelId: string,
    discovered?: DiscoveredModel,
): CustomModel {
    return {
        name: modelId,
        provider: provider.type,
        displayName: discovered?.displayName ?? modelId,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        apiVersion: provider.apiVersion,
        enabled: true,
        maxTokens: discovered?.maxOutputTokens,
        // ADR-158 stage 1: the discovery-reported window wins over the
        // registry chain. Implausible values (0, negative, tiny gateway
        // stubs) stay undefined so stages 2-4 take over downstream.
        contextWindow:
            discovered?.contextWindow !== undefined
                && discovered.contextWindow >= MIN_PLAUSIBLE_CONTEXT_WINDOW
                && discovered.contextWindow <= MAX_PLAUSIBLE_CONTEXT_WINDOW
                ? discovered.contextWindow
                : undefined,
        // IMP-54-05b: thread the per-model effort opt-in to the wire config.
        // Kept undefined (not false) when absent so untouched configs stay
        // byte-identical.
        effortOptIn: isEffortOptedIn(provider.effortOptIn, modelId) || undefined,
        // D3: without this line the prompt-caching switch did not exist on the
        // path this function serves, which is the live one (activeModels is
        // empty after migration). undefined stays undefined so ADR-111's
        // default-on behaviour is unchanged; an explicit false now arrives.
        promptCachingEnabled: provider.promptCachingEnabled,
        awsRegion: provider.awsRegion,
        awsAuthMode: provider.awsAuthMode,
        awsApiKey: provider.awsApiKey,
        awsAccessKey: provider.awsAccessKey,
        awsSecretKey: provider.awsSecretKey,
        awsSessionToken: provider.awsSessionToken,
    };
}
