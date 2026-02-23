/**
 * VaultDNA Types — Plugin-as-Skill (PAS-1)
 *
 * Shared types for VaultDNAScanner, SkillRegistry, and CapabilityGapResolver.
 */

export type PluginClassification = 'FULL' | 'PARTIAL' | 'NONE';
export type PluginStatus = 'enabled' | 'disabled';
export type PluginSource = 'core' | 'vault-native';

/** Single entry in vault-dna.json */
export interface VaultDNAEntry {
    id: string;
    name: string;
    type: 'core' | 'community';
    classification: PluginClassification;
    status: PluginStatus;
    version?: string;
    /** Filename in plugin-skills dir (e.g. "obsidian-dataview.skill.md") */
    skillFile?: string;
    source: PluginSource;
    /** Reason for NONE classification */
    reason?: string;
    /** Plugin description from manifest (used for gap-resolution matching) */
    description?: string;
}

/** Persisted vault-dna.json structure */
export interface VaultDNA {
    scannedAt: string;
    agentVersion: string;
    mode: 'local';
    plugins: VaultDNAEntry[];
    archived: VaultDNAEntry[];
}

/** Runtime skill metadata (enriched from VaultDNAEntry + .skill.md) */
export interface PluginSkillMeta {
    id: string;
    name: string;
    source: PluginSource;
    classification: PluginClassification;
    enabled: boolean;
    commands: { id: string; name: string }[];
    description: string;
    /** Whether this plugin has a non-empty settings file (data.json) */
    hasSettings?: boolean;
    /** Whether the plugin appears to need setup/configuration */
    needsSetup?: boolean;
    /** Whether this plugin exposes a JavaScript API (plugin.api or plugin itself) */
    hasApi?: boolean;
    /** Method names discovered via Reflection on the API object */
    apiMethods?: string[];
}
