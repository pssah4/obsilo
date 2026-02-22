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
import type { VaultDNA, VaultDNAEntry, PluginClassification, PluginSkillMeta } from './types';
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

            const entry: VaultDNAEntry = {
                id,
                name: manifest.name ?? id,
                type: 'community',
                classification,
                status: isEnabled ? 'enabled' : 'disabled',
                version: manifest.version,
                source: 'vault-native',
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

    // ── .skill.md Generation ─────────────────────────────────────────────

    private async writeSkillFile(skill: PluginSkillMeta): Promise<void> {
        const coreDef = CORE_PLUGIN_IDS.has(skill.id)
            ? CORE_PLUGIN_DEFS.find((d) => d.id === skill.id)
            : undefined;

        const commandsYaml = skill.commands
            .map((c) => `  - id: "${c.id}"\n    name: "${c.name}"`)
            .join('\n');

        const body = coreDef
            ? coreDef.instructions
            : this.generateSkeletonBody(skill);

        const content = [
            '---',
            `id: ${skill.id}`,
            `name: ${skill.name}`,
            `source: ${skill.source}`,
            `plugin-type: ${skill.source === 'core' ? 'core' : 'community'}`,
            `status: ${skill.enabled ? 'enabled' : 'disabled'}`,
            `class: ${skill.classification}`,
            ...(commandsYaml ? [`commands:\n${commandsYaml}`] : []),
            '---',
            '',
            body,
            '',
        ].join('\n');

        const path = `${this.skillsDir}/${skill.id}.skill.md`;
        await this.vault.adapter.write(path, content);
    }

    private generateSkeletonBody(skill: PluginSkillMeta): string {
        const lines: string[] = [];
        lines.push(`Plugin "${skill.name}" ist installiert.`);

        if (skill.commands.length > 0) {
            lines.push('');
            lines.push('Verfuegbare Commands:');
            for (const cmd of skill.commands) {
                lines.push(`- ${cmd.id} -- ${cmd.name}`);
            }
        }

        lines.push('');
        lines.push(`Nutze diesen Skill wenn der Nutzer Aufgaben beschreibt die mit ${skill.name} erledigt werden koennen.`);
        return lines.join('\n');
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

    private async handlePluginEnabled(pluginId: string): Promise<void> {
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

    private async handlePluginDisabled(pluginId: string): Promise<void> {
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
