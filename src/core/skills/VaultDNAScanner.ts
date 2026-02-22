/**
 * VaultDNAScanner — Discovers Obsidian plugins and generates skill files (PAS-1)
 *
 * Scans core + community plugins, classifies by command count,
 * generates .skill.md files at .obsidian-agent/plugin-skills/,
 * persists vault-dna.json, and polls for plugin enable/disable changes.
 *
 * ADR-102: Scans app.plugins.manifests (all installed, enabled + disabled).
 * ADR-103: Generates Stufe A skeletons only (no LLM, no network).
 */

import type { App, Vault } from 'obsidian';
import type { VaultDNA, VaultDNAEntry, PluginClassification, PluginSkillMeta, PluginSource } from './types';
import { CORE_PLUGIN_DEFS, CORE_PLUGIN_IDS } from './CorePluginLibrary';

/** Patterns that indicate a command is UI-only (not agentifiable) */
const UI_ONLY_PATTERNS = [
    /^toggle/i, /toggle$/i, /^show-/i, /^focus/i,
    /settings$/i, /-panel$/i, /-sidebar$/i, /-pane$/i,
    /^open-settings/i, /^show-settings/i,
];

function isUIOnlyCommand(commandName: string): boolean {
    const lower = commandName.toLowerCase();
    return UI_ONLY_PATTERNS.some((p) => p.test(lower));
}

export class VaultDNAScanner {
    private readonly app: App;
    private readonly vault: Vault;
    private readonly skillsDir = '.obsidian-agent/plugin-skills';
    private readonly dnaPath = '.obsidian-agent/vault-dna.json';
    private vaultDNA: VaultDNA | null = null;
    private pollIntervalId: ReturnType<typeof setInterval> | null = null;
    private lastKnownEnabledSet = new Set<string>();
    /** Runtime skill metadata — built after scan */
    private pluginSkills: PluginSkillMeta[] = [];

    constructor(app: App, vault: Vault) {
        this.app = app;
        this.vault = vault;
    }

    async initialize(): Promise<void> {
        // Ensure directory exists
        const exists = await this.vault.adapter.exists(this.skillsDir);
        if (!exists) {
            await this.vault.adapter.mkdir(this.skillsDir);
        }

        // Load existing vault-dna.json (if any)
        try {
            const dnaExists = await this.vault.adapter.exists(this.dnaPath);
            if (dnaExists) {
                const raw = await this.vault.adapter.read(this.dnaPath);
                this.vaultDNA = JSON.parse(raw) as VaultDNA;
            }
        } catch {
            // Corrupted or missing — rescan
        }

        // Full scan
        await this.fullScan();

        // Start continuous sync polling
        this.startSync();
    }

    // ── Full Scan ────────────────────────────────────────────────────────

    async fullScan(): Promise<VaultDNA> {
        const plugins: VaultDNAEntry[] = [];
        const skills: PluginSkillMeta[] = [];

        // Phase 1: Core plugins
        const coreEntries = this.scanCorePlugins();
        for (const entry of coreEntries) {
            plugins.push(entry.dna);
            if (entry.skill) skills.push(entry.skill);
        }

        // Phase 2: Community plugins
        const communityEntries = this.scanCommunityPlugins();
        for (const entry of communityEntries) {
            plugins.push(entry.dna);
            if (entry.skill) skills.push(entry.skill);
        }

        // Phase 3: Write .skill.md files
        for (const skill of skills) {
            await this.writeSkillFile(skill);
        }

        // Phase 4: Persist vault-dna.json
        const archived = this.vaultDNA?.archived ?? [];
        this.vaultDNA = {
            scannedAt: new Date().toISOString(),
            agentVersion: '0.1.0',
            mode: 'local',
            plugins,
            archived,
        };
        await this.vault.adapter.write(this.dnaPath, JSON.stringify(this.vaultDNA, null, 2));

        this.pluginSkills = skills;

        console.log(`[VaultDNA] Scanned ${plugins.length} plugins (${skills.length} with skills)`);
        return this.vaultDNA;
    }

    // ── Core Plugin Scan ─────────────────────────────────────────────────

    private scanCorePlugins(): Array<{ dna: VaultDNAEntry; skill?: PluginSkillMeta }> {
        const results: Array<{ dna: VaultDNAEntry; skill?: PluginSkillMeta }> = [];
        const internalPlugins = (this.app as any).internalPlugins?.plugins;
        if (!internalPlugins) return results;

        for (const def of CORE_PLUGIN_DEFS) {
            const internal = internalPlugins[def.id];
            const isEnabled = internal?.enabled === true;

            const entry: VaultDNAEntry = {
                id: def.id,
                name: def.name,
                type: 'core',
                classification: def.classification,
                status: isEnabled ? 'enabled' : 'disabled',
                source: 'core',
                skillFile: `${def.id}.skill.md`,
                description: def.description,
            };

            const skill: PluginSkillMeta = {
                id: def.id,
                name: def.name,
                source: 'core',
                classification: def.classification,
                enabled: isEnabled,
                commands: def.commands,
                description: def.description,
            };

            results.push({ dna: entry, skill });
        }

        return results;
    }

    // ── Community Plugin Scan ────────────────────────────────────────────

    private scanCommunityPlugins(): Array<{ dna: VaultDNAEntry; skill?: PluginSkillMeta }> {
        const results: Array<{ dna: VaultDNAEntry; skill?: PluginSkillMeta }> = [];
        const manifests: Record<string, any> = (this.app as any).plugins?.manifests ?? {};
        const enabledPlugins: Set<string> = (this.app as any).plugins?.enabledPlugins ?? new Set();

        for (const [id, manifest] of Object.entries(manifests)) {
            // Skip our own plugin
            if (id === 'obsidian-agent') continue;
            // Skip core plugins (handled separately)
            if (CORE_PLUGIN_IDS.has(id)) continue;

            const isEnabled = enabledPlugins.has(id);
            const classification = isEnabled ? this.classify(id) : 'PARTIAL';
            // Disabled plugins can't be classified (no commands loaded) — assume PARTIAL

            const pluginDesc = manifest.description ?? `Community plugin: ${manifest.name ?? id}`;
            const entry: VaultDNAEntry = {
                id,
                name: manifest.name ?? id,
                type: 'community',
                classification,
                status: isEnabled ? 'enabled' : 'disabled',
                version: manifest.version,
                source: 'vault-native',
                description: pluginDesc,
                ...(classification === 'NONE' ? { reason: 'No agentifiable commands' } : {}),
                ...(classification !== 'NONE' ? { skillFile: `${id}.skill.md` } : {}),
            };

            if (classification !== 'NONE') {
                const commands = isEnabled ? this.getPluginCommands(id) : [];
                const skill: PluginSkillMeta = {
                    id,
                    name: manifest.name ?? id,
                    source: 'vault-native',
                    classification,
                    enabled: isEnabled,
                    commands,
                    description: manifest.description ?? `Community plugin: ${manifest.name ?? id}`,
                };
                results.push({ dna: entry, skill });
            } else {
                results.push({ dna: entry });
            }
        }

        return results;
    }

    // ── Classification ───────────────────────────────────────────────────

    classify(pluginId: string): PluginClassification {
        const commands = this.getPluginCommands(pluginId);
        const meaningful = commands.filter((c) => !isUIOnlyCommand(c.name));

        if (meaningful.length === 0) return 'NONE';
        if (meaningful.length >= 3) return 'FULL';
        return 'PARTIAL';
    }

    private getPluginCommands(pluginId: string): { id: string; name: string }[] {
        const allCommands: Record<string, any> = (this.app as any).commands?.commands ?? {};
        const result: { id: string; name: string }[] = [];

        for (const [cmdId, cmd] of Object.entries(allCommands)) {
            // Commands are prefixed with plugin ID (e.g. "dataview:refresh-views")
            if (cmdId.startsWith(pluginId + ':')) {
                result.push({ id: cmdId, name: cmd.name ?? cmdId });
            }
        }

        return result;
    }

    // ── Plugin Settings ─────────────────────────────────────────────────

    /** Patterns indicating a sensitive field name — silently redacted */
    private static readonly SENSITIVE_PATTERNS = [
        /api[_-]?key/i,
        /apikey/i,
        /secret/i,
        /password/i,
        /passwd/i,
        /credential/i,
        /token(?!ize)/i,
        /license[_-]?key/i,
        /access[_-]?key/i,
        /private[_-]?key/i,
        /auth(?:orization)?[_-]?(?:key|header|bearer)/i,
        /^oauth/i,
        /client[_-]?secret/i,
        /webhook[_-]?(?:url|secret)/i,
    ];

    /** Keys that are internal state, not useful to the agent */
    private static readonly EXCLUDED_KEYS = [
        /^lastBatch/i,
        /^last(?:Sync|Run|Check|Update|Shown)/i,
        /^cache/i,
        /^__/,
        /^installed/i,
        /^version$/i,
        /once[_-]?off/i,
        /settings[_-]?converted/i,
    ];

    private static readonly MAX_VALUE_SIZE = 500;
    private static readonly MAX_SETTINGS_OUTPUT = 3000;
    private static readonly MAX_NESTING_DEPTH = 3;

    /**
     * Read plugin settings from disk.
     * Community: .obsidian/plugins/{id}/data.json
     * Core: .obsidian/{id}.json (fallback: instance.options)
     */
    private async readPluginSettings(
        pluginId: string,
        source: PluginSource,
    ): Promise<Record<string, unknown> | null> {
        try {
            const settingsPath = source === 'core'
                ? `.obsidian/${pluginId}.json`
                : `.obsidian/plugins/${pluginId}/data.json`;

            const exists = await this.vault.adapter.exists(settingsPath);
            if (!exists) return null;

            const raw = await this.vault.adapter.read(settingsPath);
            return JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    /**
     * Sanitize plugin settings: remove secrets, trim large values,
     * enforce size budget. Returns a readable string for the .skill.md.
     */
    private sanitizeSettings(
        raw: Record<string, unknown>,
    ): { sanitized: string; redactedCount: number; isEmpty: boolean } {
        const result: Record<string, unknown> = {};
        let redactedCount = 0;

        const processObject = (
            obj: Record<string, unknown>,
            target: Record<string, unknown>,
            depth: number,
        ): void => {
            if (depth > VaultDNAScanner.MAX_NESTING_DEPTH) return;

            for (const [key, value] of Object.entries(obj)) {
                if (VaultDNAScanner.SENSITIVE_PATTERNS.some((p) => p.test(key))) {
                    redactedCount++;
                    continue;
                }
                if (VaultDNAScanner.EXCLUDED_KEYS.some((p) => p.test(key))) {
                    continue;
                }
                if (value === null || value === undefined) continue;

                if (typeof value === 'string') {
                    if (value.length > VaultDNAScanner.MAX_VALUE_SIZE) {
                        target[key] = `[string, ${value.length} chars]`;
                    } else if (value !== '') {
                        target[key] = value;
                    }
                } else if (typeof value === 'boolean' || typeof value === 'number') {
                    target[key] = value;
                } else if (Array.isArray(value)) {
                    if (value.length === 0) continue;
                    const serialized = JSON.stringify(value);
                    if (serialized.length > VaultDNAScanner.MAX_VALUE_SIZE) {
                        const preview = value.slice(0, 3).map((v) =>
                            typeof v === 'string' ? v :
                            typeof v === 'object' ? '{...}' : String(v),
                        );
                        target[key] = `[${value.length} items: ${preview.join(', ')}...]`;
                    } else if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
                        target[key] = value;
                    } else {
                        target[key] = `[${value.length} items]`;
                    }
                } else if (typeof value === 'object') {
                    const child: Record<string, unknown> = {};
                    processObject(value as Record<string, unknown>, child, depth + 1);
                    if (Object.keys(child).length > 0) {
                        target[key] = child;
                    }
                }
            }
        };

        processObject(raw, result, 0);

        let output = this.settingsToYamlString(result, 0);

        if (output.length > VaultDNAScanner.MAX_SETTINGS_OUTPUT) {
            output = output.substring(0, VaultDNAScanner.MAX_SETTINGS_OUTPUT)
                + '\n[...truncated -- full settings in data.json]';
        }

        return {
            sanitized: output,
            redactedCount,
            isEmpty: Object.keys(result).length === 0,
        };
    }

    /**
     * Convert a settings object to a readable indented key-value format.
     */
    private settingsToYamlString(
        obj: Record<string, unknown>,
        indent: number,
    ): string {
        const lines: string[] = [];
        const prefix = '  '.repeat(indent);

        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                lines.push(`${prefix}${key}:`);
                lines.push(this.settingsToYamlString(
                    value as Record<string, unknown>, indent + 1,
                ));
            } else if (Array.isArray(value)) {
                lines.push(`${prefix}${key}: [${value.join(', ')}]`);
            } else {
                lines.push(`${prefix}${key}: ${value}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Determine if a plugin needs setup based on its settings state.
     */
    private detectSetupStatus(
        settings: Record<string, unknown> | null,
        isEnabled: boolean,
    ): string | null {
        if (!isEnabled) {
            return 'Plugin is disabled. Use enable_plugin to activate it first.';
        }
        if (settings === null) {
            return 'No settings file found (data.json). Plugin may need initial setup via Obsidian Settings.';
        }
        if (Object.keys(settings).length === 0) {
            return 'Settings are empty. Plugin likely needs configuration via Obsidian Settings.';
        }
        return null;
    }

    // ── .skill.md Generation ─────────────────────────────────────────────

    private async writeSkillFile(skill: PluginSkillMeta): Promise<void> {
        const coreDef = CORE_PLUGIN_IDS.has(skill.id)
            ? CORE_PLUGIN_DEFS.find((d) => d.id === skill.id)
            : undefined;

        // Read and sanitize plugin settings
        const rawSettings = await this.readPluginSettings(skill.id, skill.source);
        const { sanitized, redactedCount, isEmpty } = rawSettings
            ? this.sanitizeSettings(rawSettings)
            : { sanitized: '', redactedCount: 0, isEmpty: true };
        const setupHint = this.detectSetupStatus(rawSettings, skill.enabled);

        // Update skill meta flags
        skill.hasSettings = !isEmpty;
        skill.needsSetup = setupHint !== null;

        const commandsYaml = skill.commands
            .map((c) => `  - id: "${c.id}"\n    name: "${c.name}"`)
            .join('\n');

        const body = coreDef
            ? this.enrichCoreBody(coreDef.instructions, sanitized, setupHint, redactedCount)
            : this.generateSkeletonBody(skill, sanitized, setupHint, redactedCount);

        const content = [
            '---',
            `id: ${skill.id}`,
            `name: ${skill.name}`,
            `source: ${skill.source}`,
            `plugin-type: ${skill.source === 'core' ? 'core' : 'community'}`,
            `status: ${skill.enabled ? 'enabled' : 'disabled'}`,
            `class: ${skill.classification}`,
            `description: "${skill.description.replace(/"/g, '\\"')}"`,
            `has-settings: ${!isEmpty}`,
            ...(setupHint ? ['needs-setup: true'] : []),
            ...(commandsYaml ? [`commands:\n${commandsYaml}`] : []),
            '---',
            '',
            body,
            '',
        ].join('\n');

        const path = `${this.skillsDir}/${skill.id}.skill.md`;
        await this.vault.adapter.write(path, content);
    }

    private generateSkeletonBody(
        skill: PluginSkillMeta,
        settingsBlock: string,
        setupHint: string | null,
        redactedCount: number,
    ): string {
        const lines: string[] = [];
        lines.push(`# ${skill.name}`);
        lines.push('');
        lines.push(`**Description:** ${skill.description}`);
        lines.push(`**Status:** ${skill.enabled ? 'Enabled' : 'Disabled'}`);
        lines.push(`**Plugin ID:** ${skill.id}`);

        if (setupHint) {
            lines.push('');
            lines.push('## Setup Required');
            lines.push('');
            lines.push(setupHint);
            lines.push('Guide the user to configure this plugin via Obsidian Settings if needed.');
        }

        if (skill.commands.length > 0) {
            lines.push('');
            lines.push('## Available Commands');
            lines.push('');
            lines.push('Use these with execute_command(command_id):');
            for (const cmd of skill.commands) {
                lines.push(`- \`${cmd.id}\` -- ${cmd.name}`);
            }
        }

        if (settingsBlock) {
            lines.push('');
            lines.push('## Current Configuration');
            lines.push('');
            lines.push('These are the plugin\'s current settings (sensitive values redacted):');
            lines.push('');
            lines.push('```');
            lines.push(settingsBlock);
            lines.push('```');
            if (redactedCount > 0) {
                lines.push(`(${redactedCount} sensitive field(s) redacted)`);
            }
        }

        lines.push('');
        lines.push('## Usage');
        lines.push('');
        if (skill.enabled) {
            lines.push(`When the user asks for functionality related to ${skill.name}, use execute_command with the commands listed above.`);
            lines.push('Do NOT substitute built-in tools -- always use this plugin\'s own commands.');
            if (settingsBlock) {
                lines.push('Use the configuration above to understand how the plugin is set up. Reference specific settings when helping the user.');
            }
        } else {
            lines.push(`This plugin is currently disabled. Use enable_plugin("${skill.id}") to activate it first.`);
            lines.push('After enabling, the plugin\'s commands will become available for execute_command.');
        }

        return lines.join('\n');
    }

    /**
     * Enrich a core plugin's existing hand-written instructions with settings data.
     */
    private enrichCoreBody(
        originalInstructions: string,
        settingsBlock: string,
        setupHint: string | null,
        redactedCount: number,
    ): string {
        const parts: string[] = [originalInstructions];

        if (setupHint) {
            parts.push('');
            parts.push('## Setup Required');
            parts.push('');
            parts.push(setupHint);
        }

        if (settingsBlock) {
            parts.push('');
            parts.push('## Current Configuration');
            parts.push('');
            parts.push('```');
            parts.push(settingsBlock);
            parts.push('```');
            if (redactedCount > 0) {
                parts.push(`(${redactedCount} sensitive field(s) redacted)`);
            }
        }

        return parts.join('\n');
    }

    // ── Continuous Sync (Polling) ────────────────────────────────────────

    startSync(): void {
        const enabledPlugins = (this.app as any).plugins?.enabledPlugins;
        this.lastKnownEnabledSet = new Set(enabledPlugins ?? []);
        this.pollIntervalId = setInterval(() => this.checkForChanges(), 5000);
    }

    stopSync(): void {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }
    }

    private async checkForChanges(): Promise<void> {
        const currentEnabled = new Set<string>((this.app as any).plugins?.enabledPlugins ?? []);

        // Find newly enabled plugins
        for (const id of currentEnabled) {
            if (!this.lastKnownEnabledSet.has(id) && id !== 'obsidian-agent') {
                console.log(`[VaultDNA] Plugin enabled: ${id}`);
                await this.handlePluginEnabled(id);
            }
        }

        // Find newly disabled plugins
        for (const id of this.lastKnownEnabledSet) {
            if (!currentEnabled.has(id) && id !== 'obsidian-agent') {
                console.log(`[VaultDNA] Plugin disabled: ${id}`);
                await this.handlePluginDisabled(id);
            }
        }

        this.lastKnownEnabledSet = currentEnabled;
    }

    async handlePluginEnabled(pluginId: string): Promise<void> {
        if (!this.vaultDNA) return;
        const entry = this.vaultDNA.plugins.find((p) => p.id === pluginId);
        if (entry) {
            entry.status = 'enabled';
            entry.classification = this.classify(pluginId);
        }

        // Update skill meta
        const skillIdx = this.pluginSkills.findIndex((s) => s.id === pluginId);
        if (skillIdx >= 0) {
            this.pluginSkills[skillIdx].enabled = true;
            this.pluginSkills[skillIdx].commands = this.getPluginCommands(pluginId);
            await this.writeSkillFile(this.pluginSkills[skillIdx]);
        }

        await this.vault.adapter.write(this.dnaPath, JSON.stringify(this.vaultDNA, null, 2));
    }

    async handlePluginDisabled(pluginId: string): Promise<void> {
        if (!this.vaultDNA) return;
        const entry = this.vaultDNA.plugins.find((p) => p.id === pluginId);
        if (entry) {
            entry.status = 'disabled';
        }

        const skillIdx = this.pluginSkills.findIndex((s) => s.id === pluginId);
        if (skillIdx >= 0) {
            this.pluginSkills[skillIdx].enabled = false;
            await this.writeSkillFile(this.pluginSkills[skillIdx]);
        }

        await this.vault.adapter.write(this.dnaPath, JSON.stringify(this.vaultDNA, null, 2));
    }

    // ── Getters ──────────────────────────────────────────────────────────

    getVaultDNA(): VaultDNA | null {
        return this.vaultDNA;
    }

    getEnabledPluginSkills(): PluginSkillMeta[] {
        return this.pluginSkills.filter((s) => s.enabled);
    }

    getDisabledPluginSkills(): PluginSkillMeta[] {
        return this.pluginSkills.filter((s) => !s.enabled);
    }

    getAllPluginSkills(): PluginSkillMeta[] {
        return this.pluginSkills;
    }

    destroy(): void {
        this.stopSync();
    }
}
