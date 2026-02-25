import { App, Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../../types/settings';
import { t } from '../../i18n';

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

/** Category IDs (stable, used for toggles and manifest keys) */
const CATEGORY_IDS = [
    'settings', 'memory', 'history', 'workflows', 'rules',
    'skills', 'plugin-skills', 'vault-dna', 'semantic-index', 'logs',
] as const;

/** Build categories with translated labels (called at render time so t() picks up the active locale) */
function getCategories(): BackupCategory[] {
    return [
        {
            id: 'settings',
            label: t('settings.backup.catSettings'),
            root: 'plugin',
            dir: null,
            recursive: false,
            description: t('settings.backup.catSettingsDesc'),
        },
        {
            id: 'memory',
            label: t('settings.backup.catMemory'),
            root: 'plugin',
            dir: 'memory',
            recursive: true,
            description: t('settings.backup.catMemoryDesc'),
        },
        {
            id: 'history',
            label: t('settings.backup.catHistory'),
            root: 'plugin',
            dir: 'history',
            recursive: false,
            description: t('settings.backup.catHistoryDesc'),
        },
        {
            id: 'workflows',
            label: t('settings.backup.catWorkflows'),
            root: 'vault',
            dir: '.obsidian-agent/workflows',
            recursive: false,
            description: t('settings.backup.catWorkflowsDesc'),
        },
        {
            id: 'rules',
            label: t('settings.backup.catRules'),
            root: 'vault',
            dir: '.obsidian-agent/rules',
            recursive: false,
            description: t('settings.backup.catRulesDesc'),
        },
        {
            id: 'skills',
            label: t('settings.backup.catSkills'),
            root: 'vault',
            dir: '.obsidian-agent/skills',
            recursive: true,
            description: t('settings.backup.catSkillsDesc'),
        },
        {
            id: 'plugin-skills',
            label: t('settings.backup.catPluginSkills'),
            root: 'vault',
            dir: '.obsidian-agent/plugin-skills',
            recursive: false,
            description: t('settings.backup.catPluginSkillsDesc'),
        },
        {
            id: 'vault-dna',
            label: t('settings.backup.catVaultDNA'),
            root: 'vault',
            dir: null,
            recursive: false,
            description: t('settings.backup.catVaultDNADesc'),
        },
        {
            id: 'semantic-index',
            label: t('settings.backup.catSemanticIndex'),
            root: 'vault',
            dir: '.obsidian-agent/semantic-index',
            recursive: false,
            description: t('settings.backup.catSemanticIndexDesc'),
        },
        {
            id: 'logs',
            label: t('settings.backup.catLogs'),
            root: 'plugin',
            dir: 'logs',
            recursive: false,
            description: t('settings.backup.catLogsDesc'),
        },
    ];
}

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
    const toggles: Record<string, boolean> = {};
    for (const id of CATEGORY_IDS) toggles[id] = true;
    return toggles;
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
            text: t('settings.backup.desc'),
        });

        this.buildExportSection(containerEl);
        this.buildImportSection(containerEl);
    }

    // ── Export ────────────────────────────────────────────────────────────────

    private buildExportSection(container: HTMLElement): void {
        const section = container.createDiv('agent-backup-section');
        section.createEl('h4', { text: t('settings.backup.headingExport') });

        // Category checkboxes with live stats
        const list = section.createDiv('agent-backup-category-list');
        for (const cat of getCategories()) {
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
        const exportBtn = btnRow.createEl('button', { text: t('settings.backup.export'), cls: 'mod-cta' });
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
        btn.setText(t('settings.backup.exporting'));

        try {
            const manifest: BackupManifest = {
                format: 'obsilo-backup',
                version: BACKUP_VERSION,
                exportedAt: new Date().toISOString(),
                categories: {},
            };

            let totalFiles = 0;
            let selectedCount = 0;

            for (const cat of getCategories()) {
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

            new Notice(t('settings.backup.exported', { files: totalFiles, categories: selectedCount, size: this.formatSize(json.length) }));
        } catch (e) {
            new Notice(t('settings.backup.exportFailed', { error: (e as Error).message }));
        } finally {
            btn.removeClass('is-loading');
            btn.setText(t('settings.backup.export'));
        }
    }

    // ── Import ───────────────────────────────────────────────────────────────

    private buildImportSection(container: HTMLElement): void {
        const section = container.createDiv('agent-backup-section');
        section.createEl('h4', { text: t('settings.backup.headingImport') });

        if (!_pendingImport) {
            // Initial state: just the file picker button
            const btnRow = section.createDiv('agent-backup-row');
            const importBtn = btnRow.createEl('button', { text: t('settings.backup.selectFile') });
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
                        new Notice(t('settings.backup.invalidFile'));
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
                new Notice(t('settings.backup.importFailed', { error: (e as Error).message }));
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
            text: t('settings.backup.backupFrom', { date: dateStr, version: data.version }),
        });

        const categories = getCategories();
        const list = container.createDiv('agent-backup-category-list');
        for (const [catId, catData] of Object.entries(data.categories)) {
            const catDef = categories.find((c) => c.id === catId);
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
            text: t('settings.backup.overwriteWarning'),
        });

        const btnRow = container.createDiv('agent-backup-row');

        const confirmBtn = btnRow.createEl('button', { text: t('settings.backup.confirmImport'), cls: 'mod-cta' });
        confirmBtn.addEventListener('click', () => this.doImport(confirmBtn));

        const cancelBtn = btnRow.createEl('button', { text: t('settings.backup.cancel') });
        cancelBtn.addEventListener('click', () => {
            _pendingImport = null;
            _importToggles = {};
            this.rerender();
        });
    }

    private async doImport(btn: HTMLElement): Promise<void> {
        if (!_pendingImport) return;
        btn.addClass('is-loading');
        btn.setText(t('settings.backup.importing'));

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
                    const catDef = getCategories().find((c) => c.id === catId);
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
            new Notice(t('settings.backup.imported', { files: totalFiles, categories: selectedCount }));
            this.rerender();
        } catch (e) {
            new Notice(t('settings.backup.importFailed', { error: (e as Error).message }));
        } finally {
            btn.removeClass('is-loading');
            btn.setText(t('settings.backup.confirmImport'));
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
