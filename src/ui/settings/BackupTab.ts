import { App, Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../../types/settings';

// ── Backup category definitions ──────────────────────────────────────────────

interface BackupCategory {
    id: string;
    label: string;
    /** 'plugin' = .obsidian/plugins/obsidian-agent/, 'vault' = .obsidian-agent/ */
    root: 'plugin' | 'vault';
    /** Directory relative to root (or null for settings which is handled specially) */
    dir: string | null;
    recursive: boolean;
    description: string;
}

const CATEGORIES: BackupCategory[] = [
    {
        id: 'settings',
        label: 'Plugin Settings',
        root: 'plugin',
        dir: null,
        recursive: false,
        description: 'API keys, modes, permissions, all configuration',
    },
    {
        id: 'memory',
        label: 'Agent Memory',
        root: 'plugin',
        dir: 'memory',
        recursive: true,
        description: 'Long-term memory and session summaries',
    },
    {
        id: 'history',
        label: 'Chat History',
        root: 'plugin',
        dir: 'history',
        recursive: false,
        description: 'Full conversation transcripts',
    },
    {
        id: 'workflows',
        label: 'Workflows',
        root: 'vault',
        dir: '.obsidian-agent/workflows',
        recursive: false,
        description: 'Custom workflow definitions',
    },
    {
        id: 'rules',
        label: 'Custom Rules',
        root: 'vault',
        dir: '.obsidian-agent/rules',
        recursive: false,
        description: 'Custom agent rules',
    },
    {
        id: 'skills',
        label: 'Custom Skills',
        root: 'vault',
        dir: '.obsidian-agent/skills',
        recursive: true,
        description: 'Custom skill definitions',
    },
    {
        id: 'plugin-skills',
        label: 'Plugin Skill Files',
        root: 'vault',
        dir: '.obsidian-agent/plugin-skills',
        recursive: false,
        description: 'Auto-generated skill and README files from VaultDNA scanner',
    },
    {
        id: 'vault-dna',
        label: 'VaultDNA Scan Cache',
        root: 'vault',
        dir: null,
        recursive: false,
        description: 'Plugin scan results (vault-dna.json) — avoids rescan on import',
    },
    {
        id: 'semantic-index',
        label: 'Semantic Index',
        root: 'vault',
        dir: '.obsidian-agent/semantic-index',
        recursive: false,
        description: 'Vectra embedding index — can be rebuilt by re-indexing',
    },
    {
        id: 'logs',
        label: 'Operation Logs',
        root: 'plugin',
        dir: 'logs',
        recursive: false,
        description: 'Agent operation log history',
    },
];

// ── Backup manifest types ────────────────────────────────────────────────────

interface BackupManifest {
    format: 'obsilo-backup';
    version: number;
    exportedAt: string;
    categories: Record<string, { files: Record<string, { content: string }> }>;
}

const BACKUP_VERSION = 1;

// Module-level state that survives tab rerenders (new BackupTab instances).
// The settings tab creates a fresh BackupTab on every display() call,
// so instance state would be lost on rerender.
let _pendingImport: BackupManifest | null = null;
let _importToggles: Record<string, boolean> = {};
const _exportToggles: Record<string, boolean> = (() => {
    const t: Record<string, boolean> = {};
    for (const cat of CATEGORIES) t[cat.id] = true;
    return t;
})();

// ── BackupTab ────────────────────────────────────────────────────────────────

export class BackupTab {
    constructor(
        private plugin: ObsidianAgentPlugin,
        private app: App,
        private rerender: () => void,
    ) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: 'Export and import plugin data for backup or migration to another device.',
        });

        this.buildExportSection(containerEl);
        this.buildImportSection(containerEl);
    }

    // ── Export ────────────────────────────────────────────────────────────────

    private buildExportSection(container: HTMLElement): void {
        const section = container.createDiv('agent-backup-section');
        section.createEl('h4', { text: 'Export' });

        // Category checkboxes with live stats
        const list = section.createDiv('agent-backup-category-list');
        for (const cat of CATEGORIES) {
            const row = list.createDiv('agent-backup-category-row');
            const label = row.createEl('label', { cls: 'agent-backup-label' });

            const cb = label.createEl('input', { type: 'checkbox' });
            cb.checked = _exportToggles[cat.id] ?? true;
            cb.addEventListener('change', () => {
                _exportToggles[cat.id] = cb.checked;
            });

            const textWrap = label.createSpan({ cls: 'agent-backup-label-text' });
            textWrap.createSpan({ text: cat.label, cls: 'agent-backup-label-name' });
            textWrap.createSpan({ text: ` -- ${cat.description}`, cls: 'agent-backup-label-desc' });

            // Load stats asynchronously
            this.loadCategoryStats(cat).then((info) => {
                textWrap.createSpan({
                    text: ` (${info})`,
                    cls: 'agent-backup-label-stats',
                });
            });
        }

        const btnRow = section.createDiv('agent-backup-row');
        const exportBtn = btnRow.createEl('button', { text: 'Export backup', cls: 'mod-cta' });
        exportBtn.addEventListener('click', () => this.doExport(exportBtn));
    }

    private async loadCategoryStats(cat: BackupCategory): Promise<string> {
        try {
            if (cat.id === 'settings') {
                const size = JSON.stringify(this.plugin.settings).length;
                return this.formatSize(size);
            }
            if (cat.id === 'vault-dna') {
                const path = '.obsidian-agent/vault-dna.json';
                const exists = await this.app.vault.adapter.exists(path);
                if (!exists) return '0 files';
                const content = await this.app.vault.adapter.read(path);
                return `1 file, ${this.formatSize(content.length)}`;
            }
            const dir = this.resolveDir(cat);
            const exists = await this.app.vault.adapter.exists(dir);
            if (!exists) return '0 files';
            const { count, size } = await this.countAndSize(dir, cat.recursive);
            return `${count} file${count !== 1 ? 's' : ''}, ${this.formatSize(size)}`;
        } catch {
            return '0 files';
        }
    }

    private async doExport(btn: HTMLElement): Promise<void> {
        btn.addClass('is-loading');
        btn.setText('Exporting...');

        try {
            const manifest: BackupManifest = {
                format: 'obsilo-backup',
                version: BACKUP_VERSION,
                exportedAt: new Date().toISOString(),
                categories: {},
            };

            let totalFiles = 0;
            let selectedCount = 0;

            for (const cat of CATEGORIES) {
                if (!_exportToggles[cat.id]) continue;
                selectedCount++;

                const files: Record<string, { content: string }> = {};

                if (cat.id === 'settings') {
                    files['data.json'] = {
                        content: JSON.stringify(this.plugin.settings, null, 2),
                    };
                } else if (cat.id === 'vault-dna') {
                    const path = '.obsidian-agent/vault-dna.json';
                    const exists = await this.app.vault.adapter.exists(path);
                    if (exists) {
                        files['vault-dna.json'] = {
                            content: await this.app.vault.adapter.read(path),
                        };
                    }
                } else {
                    const dir = this.resolveDir(cat);
                    const exists = await this.app.vault.adapter.exists(dir);
                    if (exists) {
                        const collected = cat.recursive
                            ? await this.collectFilesRecursive(dir, dir)
                            : await this.collectFiles(dir, dir);
                        for (const [path, content] of Object.entries(collected)) {
                            files[path] = { content };
                        }
                    }
                }

                manifest.categories[cat.id] = { files };
                totalFiles += Object.keys(files).length;
            }

            const json = JSON.stringify(manifest, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date().toISOString().split('T')[0];
            a.download = `obsilo-backup-${date}.json`;
            a.click();
            URL.revokeObjectURL(url);

            new Notice(`Backup exported: ${totalFiles} files in ${selectedCount} categories (${this.formatSize(json.length)})`);
        } catch (e) {
            new Notice(`Export failed: ${(e as Error).message}`);
        } finally {
            btn.removeClass('is-loading');
            btn.setText('Export backup');
        }
    }

    // ── Import ───────────────────────────────────────────────────────────────

    private buildImportSection(container: HTMLElement): void {
        const section = container.createDiv('agent-backup-section');
        section.createEl('h4', { text: 'Import' });

        if (!_pendingImport) {
            // Initial state: just the file picker button
            const btnRow = section.createDiv('agent-backup-row');
            const importBtn = btnRow.createEl('button', { text: 'Select backup file' });
            importBtn.addEventListener('click', () => this.pickImportFile());
        } else {
            // Confirmation state: show found categories
            this.buildImportConfirmation(section);
        }
    }

    private pickImportFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text) as BackupManifest;

                // Validate format
                if (parsed.format !== 'obsilo-backup' || typeof parsed.version !== 'number') {
                    // Fallback: try legacy settings-only format
                    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) &&
                        ('activeModels' in parsed || 'customModes' in parsed || 'autoApproval' in parsed)) {
                        // Legacy settings file — wrap in manifest
                        _pendingImport = {
                            format: 'obsilo-backup',
                            version: 1,
                            exportedAt: '',
                            categories: {
                                settings: {
                                    files: {
                                        'data.json': { content: JSON.stringify(parsed, null, 2) },
                                    },
                                },
                            },
                        };
                    } else {
                        new Notice('Invalid backup file -- not recognized as Obsilo backup');
                        return;
                    }
                } else {
                    _pendingImport = parsed;
                }

                // Enable all found categories by default
                _importToggles = {};
                for (const catId of Object.keys(_pendingImport!.categories)) {
                    _importToggles[catId] = true;
                }

                this.rerender();
            } catch (e) {
                new Notice(`Import failed: ${(e as Error).message}`);
            }
        });
        input.click();
    }

    private buildImportConfirmation(container: HTMLElement): void {
        const data = _pendingImport!;
        const dateStr = data.exportedAt
            ? new Date(data.exportedAt).toLocaleDateString('de-DE', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            })
            : 'Unknown date';

        container.createEl('p', {
            cls: 'agent-backup-import-info',
            text: `Backup from ${dateStr} (v${data.version})`,
        });

        const list = container.createDiv('agent-backup-category-list');
        for (const [catId, catData] of Object.entries(data.categories)) {
            const catDef = CATEGORIES.find((c) => c.id === catId);
            const fileCount = Object.keys(catData.files).length;
            const totalSize = Object.values(catData.files)
                .reduce((sum, f) => sum + f.content.length, 0);

            const row = list.createDiv('agent-backup-category-row');
            const label = row.createEl('label', { cls: 'agent-backup-label' });

            const cb = label.createEl('input', { type: 'checkbox' });
            cb.checked = _importToggles[catId] ?? true;
            cb.addEventListener('change', () => {
                _importToggles[catId] = cb.checked;
            });

            const textWrap = label.createSpan({ cls: 'agent-backup-label-text' });
            textWrap.createSpan({
                text: catDef?.label ?? catId,
                cls: 'agent-backup-label-name',
            });
            textWrap.createSpan({
                text: ` (${fileCount} file${fileCount !== 1 ? 's' : ''}, ${this.formatSize(totalSize)})`,
                cls: 'agent-backup-label-stats',
            });
        }

        container.createEl('p', {
            cls: 'agent-backup-warning',
            text: 'Existing files will be overwritten.',
        });

        const btnRow = container.createDiv('agent-backup-row');

        const confirmBtn = btnRow.createEl('button', { text: 'Confirm import', cls: 'mod-cta' });
        confirmBtn.addEventListener('click', () => this.doImport(confirmBtn));

        const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            _pendingImport = null;
            _importToggles = {};
            this.rerender();
        });
    }

    private async doImport(btn: HTMLElement): Promise<void> {
        if (!_pendingImport) return;
        btn.addClass('is-loading');
        btn.setText('Importing...');

        try {
            let totalFiles = 0;
            let selectedCount = 0;

            for (const [catId, catData] of Object.entries(_pendingImport.categories)) {
                if (!_importToggles[catId]) continue;
                selectedCount++;

                if (catId === 'settings') {
                    const settingsFile = catData.files['data.json'];
                    if (settingsFile) {
                        const parsed = JSON.parse(settingsFile.content);
                        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
                        await this.plugin.saveSettings();
                        totalFiles++;
                    }
                } else if (catId === 'vault-dna') {
                    const vdnFile = catData.files['vault-dna.json'];
                    if (vdnFile) {
                        const dir = '.obsidian-agent';
                        const exists = await this.app.vault.adapter.exists(dir);
                        if (!exists) await this.app.vault.adapter.mkdir(dir);
                        await this.app.vault.adapter.write(`${dir}/vault-dna.json`, vdnFile.content);
                        totalFiles++;
                    }
                } else {
                    const catDef = CATEGORIES.find((c) => c.id === catId);
                    if (!catDef) continue;

                    const baseDir = this.resolveDir(catDef);
                    // Extract content strings from manifest format
                    const flat: Record<string, string> = {};
                    for (const [path, entry] of Object.entries(catData.files)) {
                        flat[path] = entry.content;
                    }
                    totalFiles += await this.restoreFiles(flat, baseDir);
                }
            }

            _pendingImport = null;
            _importToggles = {};
            new Notice(`Backup imported: ${totalFiles} files in ${selectedCount} categories. Reload Obsidian for full effect.`);
            this.rerender();
        } catch (e) {
            new Notice(`Import failed: ${(e as Error).message}`);
        } finally {
            btn.removeClass('is-loading');
            btn.setText('Confirm import');
        }
    }

    // ── File helpers ─────────────────────────────────────────────────────────

    private resolveDir(cat: BackupCategory): string {
        if (cat.root === 'plugin') {
            return `.obsidian/plugins/${this.plugin.manifest.id}/${cat.dir}`;
        }
        return cat.dir!;
    }

    private async collectFiles(dir: string, baseDir: string): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        try {
            const listed = await this.app.vault.adapter.list(dir);
            for (const filePath of listed.files) {
                try {
                    const content = await this.app.vault.adapter.read(filePath);
                    const relative = filePath.startsWith(baseDir)
                        ? filePath.slice(baseDir.length + 1)
                        : filePath;
                    result[relative] = content;
                } catch { /* skip unreadable files */ }
            }
        } catch { /* directory doesn't exist */ }
        return result;
    }

    private async collectFilesRecursive(dir: string, baseDir: string): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        try {
            const listed = await this.app.vault.adapter.list(dir);
            for (const filePath of listed.files) {
                try {
                    const content = await this.app.vault.adapter.read(filePath);
                    const relative = filePath.startsWith(baseDir)
                        ? filePath.slice(baseDir.length + 1)
                        : filePath;
                    result[relative] = content;
                } catch { /* skip */ }
            }
            for (const subDir of listed.folders) {
                const subFiles = await this.collectFilesRecursive(subDir, baseDir);
                Object.assign(result, subFiles);
            }
        } catch { /* directory doesn't exist */ }
        return result;
    }

    private async restoreFiles(files: Record<string, string>, baseDir: string): Promise<number> {
        let count = 0;
        const createdDirs = new Set<string>();

        for (const [relativePath, content] of Object.entries(files)) {
            const fullPath = `${baseDir}/${relativePath}`;

            // Ensure parent directory exists
            const dirPath = fullPath.includes('/')
                ? fullPath.split('/').slice(0, -1).join('/')
                : null;
            if (dirPath && !createdDirs.has(dirPath)) {
                const exists = await this.app.vault.adapter.exists(dirPath);
                if (!exists) {
                    await this.app.vault.adapter.mkdir(dirPath);
                }
                createdDirs.add(dirPath);
            }

            await this.app.vault.adapter.write(fullPath, content);
            count++;
        }
        return count;
    }

    private async countAndSize(dir: string, recursive: boolean): Promise<{ count: number; size: number }> {
        let count = 0;
        let size = 0;
        try {
            const listed = await this.app.vault.adapter.list(dir);
            for (const filePath of listed.files) {
                try {
                    const content = await this.app.vault.adapter.read(filePath);
                    count++;
                    size += content.length;
                } catch { /* skip */ }
            }
            if (recursive) {
                for (const subDir of listed.folders) {
                    const sub = await this.countAndSize(subDir, true);
                    count += sub.count;
                    size += sub.size;
                }
            }
        } catch { /* directory doesn't exist */ }
        return { count, size };
    }

    private formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}
