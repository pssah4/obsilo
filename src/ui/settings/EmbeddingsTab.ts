import { App, Notice, Setting, setIcon, TFolder, AbstractInputSuggest } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ModelConfigModal } from './ModelConfigModal';
import { addInfoButton } from './utils';
import { EMBEDDING_SUGGESTIONS, PROVIDER_LABELS, PROVIDER_COLORS } from './constants';
import type { CustomModel } from '../../types/settings';
import { getModelKey } from '../../types/settings';
import type { SemanticIndexService } from '../../core/semantic/SemanticIndexService';

export class EmbeddingsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Embedding Models' });

        const desc = containerEl.createDiv('model-table-desc');
        desc.setText('Embedding models power semantic search across your vault. Select exactly one model as the active index.');

        // Table header
        const table = containerEl.createDiv('model-table embedding-table');
        const header = table.createDiv('model-row model-row-header');
        header.createDiv({ cls: 'mc-name', text: 'Model' });
        header.createDiv({ cls: 'mc-provider', text: 'Provider' });
        header.createDiv({ cls: 'mc-key', text: 'Key' });
        header.createDiv({ cls: 'mc-enable', text: 'Active' });
        header.createDiv({ cls: 'mc-actions' });

        const models = this.plugin.settings.embeddingModels ?? [];
        if (models.length === 0) {
            table.createDiv({ cls: 'model-table-empty', text: 'No embedding models added yet. Click "+ Add Embedding Model" to get started.' });
        } else {
            models.forEach((model) => this.renderEmbeddingRow(table, model));
        }

        const footer = containerEl.createDiv('model-table-footer');
        const addBtn = footer.createEl('button', { cls: 'mod-cta model-add-btn', text: '+ Add Embedding Model' });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, async (newModel) => {
                const key = getModelKey(newModel);
                if ((this.plugin.settings.embeddingModels ?? []).some((m) => getModelKey(m) === key)) {
                    new Notice(`"${newModel.name}" already exists`);
                    return;
                }
                if (!this.plugin.settings.embeddingModels) this.plugin.settings.embeddingModels = [];
                this.plugin.settings.embeddingModels.push(newModel);
                if (!this.plugin.settings.activeEmbeddingModelKey) {
                    this.plugin.settings.activeEmbeddingModelKey = key;
                }
                await this.plugin.saveSettings();
                this.rerender();
            }, true /* forEmbedding */).open();
        });

        // ── Semantic Index ────────────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Semantic Index' });

        const activeEmbModel = this.plugin.getActiveEmbeddingModel();
        const embModelDesc = activeEmbModel
            ? `Using ${activeEmbModel.displayName ?? activeEmbModel.name} (${activeEmbModel.provider}) for embeddings.`
            : 'No API model active above — falls back to local all-MiniLM-L6-v2 (no data leaves your device).';

        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: `Builds a local vector index of all notes for semantic_search. ${embModelDesc}`,
        });

        const getIdx = () => (this.plugin as any).semanticIndex;
        // statusEl is created later inside the "Build index" setting — declared here for scope
        let statusEl: HTMLElement;

        const semanticEnableSetting = new Setting(containerEl)
            .setName('Enable semantic index')
            .setDesc('Lets the agent find relevant notes by meaning, not just exact keywords. Requires an embedding model. First build may take a few minutes for large vaults.');
        addInfoButton(semanticEnableSetting, this.app, 'Semantic Index', 'The Semantic Index reads all your notes, breaks them into small sections, and converts each section into a mathematical representation of its meaning (called an "embedding"). When you ask the agent a question, it searches for notes with similar meaning rather than just matching words. This is called Retrieval-Augmented Generation (RAG) and makes the agent much better at finding relevant context in your vault.');
        semanticEnableSetting.addToggle((t) =>
            t.setValue(this.plugin.settings.enableSemanticIndex ?? false).onChange(async (v) => {
                this.plugin.settings.enableSemanticIndex = v;
                await this.plugin.saveSettings();
                if (v) {
                    const { SemanticIndexService } = await import('../../core/semantic/SemanticIndexService');
                    const pluginDir = `.obsidian/plugins/${this.plugin.manifest.id}`;
                    const svc = new SemanticIndexService(this.plugin.app.vault, pluginDir);
                    const embModel = this.plugin.getActiveEmbeddingModel();
                    if (embModel) svc.setEmbeddingModel(embModel);
                    (this.plugin as any).semanticIndex = svc;
                    await svc.initialize().catch(console.warn);
                } else {
                    // Cancel any ongoing build before clearing the reference
                    (this.plugin as any).semanticIndex?.cancelBuild();
                    (this.plugin as any).semanticIndex = null;
                }
                refreshStatus();
            }),
        );

        new Setting(containerEl)
            .setName('Index PDF attachments')
            .setDesc('Also index PDF files in your vault. Text is extracted from PDFs and indexed alongside your notes. Image-only (scanned) PDFs are skipped automatically.')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.semanticIndexPdfs ?? false).onChange(async (v) => {
                    this.plugin.settings.semanticIndexPdfs = v;
                    getIdx()?.configure({ indexPdfs: v });
                    await this.plugin.saveSettings();
                }),
            );

        const buildSetting = new Setting(containerEl)
            .setName('Build index')
            .setDesc('Index new and modified notes. Already-indexed notes are skipped. Use "Force Rebuild" to reindex everything from scratch.');
        statusEl = buildSetting.descEl.createDiv('agent-semantic-status');

        const refreshStatus = () => {
            statusEl.empty();
            if (!this.plugin.settings.enableSemanticIndex) {
                statusEl.setText('Semantic index is disabled.');
                return;
            }
            const idx = getIdx();
            if (!idx) {
                statusEl.setText('Not initialized. Toggle off/on to reload.');
                return;
            }
            if (idx.building) {
                const p = idx.progressIndexed ?? idx.docCount;
                const t = idx.progressTotal ?? '?';
                statusEl.setText(`Building… (${p} / ${t} files)`);
                return;
            }
            if (idx.isIndexed) {
                statusEl.setText(`Ready: ${idx.docCount} notes · Built: ${(idx.lastBuiltAt as Date).toLocaleString()}`);
            } else {
                statusEl.setText('Not built yet. Click "Build Index" to start.');
            }
        };
        refreshStatus();

        // Poll every second so status stays current
        const pollInterval = window.setInterval(refreshStatus, 1000);
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of Array.from(m.removedNodes)) {
                    if (node === containerEl || (node as HTMLElement).contains?.(containerEl)) {
                        window.clearInterval(pollInterval);
                        observer.disconnect();
                    }
                }
            }
        });
        if (containerEl.parentElement) observer.observe(containerEl.parentElement, { childList: true });

        buildSetting.addButton((btn) => {
                btn.setButtonText('Build Index').onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice('Enable semantic index first.'); return; }
                    if (idx.building) { new Notice('Already building…'); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText('Building…').setDisabled(true);
                    cancelBtn.setDisabled(false);
                    statusEl.setText('Building index…');
                    try {
                        await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`Building… (${indexed}/${total})`);
                        });
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(`Build failed: ${(e as Error).message}`);
                    } finally {
                        btn.setButtonText('Build Index').setDisabled(false);
                        cancelBtn.setDisabled(true);
                    }
                });
            })
            .addButton((btn) => {
                btn.setButtonText('Force Rebuild').setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice('Enable semantic index first.'); return; }
                    if (idx.building) { new Notice('Already building…'); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText('Rebuilding…').setDisabled(true);
                    cancelBtn.setDisabled(false);
                    statusEl.setText('Force rebuild…');
                    try {
                        await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`Rebuilding… (${indexed}/${total})`);
                        }, true);
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(`Rebuild failed: ${(e as Error).message}`);
                    } finally {
                        btn.setButtonText('Force Rebuild').setDisabled(false);
                        cancelBtn.setDisabled(true);
                    }
                });
            });

        let cancelBtn: any;
        new Setting(containerEl)
            .setName('Cancel indexing')
            .setDesc('Stop the current indexing run. Progress is saved to disk — the next build will resume from where it left off.')
            .addButton((btn) => {
                cancelBtn = btn;
                btn.setButtonText('Cancel').setDisabled(true).onClick(() => {
                    getIdx()?.cancelBuild();
                    btn.setDisabled(true);
                    statusEl.setText('Cancelling…');
                });
            });

        new Setting(containerEl)
            .setName('Delete index')
            .setDesc('Remove the on-disk index. Notes are not affected.')
            .addButton((btn) => {
                btn.setButtonText('Delete Index').setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (idx) await idx.deleteIndex();
                    refreshStatus();
                });
            });

        // ── Index configuration ───────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: 'Index Configuration' });

        const batchSetting = new Setting(containerEl)
            .setName('Checkpoint interval')
            .setDesc('How many files to index before saving progress to disk. Smaller = more frequent checkpoints, safer on slow disks. Larger = fewer writes, slightly faster. Default: 20.');
        addInfoButton(batchSetting, this.app, 'Checkpoint Interval', 'The indexer saves a checkpoint to disk every N files. If indexing is interrupted (Obsidian closed, error), the next run resumes from the last checkpoint — only unindexed or modified files are processed. A smaller interval loses less progress on interruption but writes to disk more often. 10–30 is recommended for most vaults.');
        batchSetting.addSlider((s) =>
            s.setLimits(10, 200, 10)
                .setValue(this.plugin.settings.semanticBatchSize ?? 50)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.semanticBatchSize = v;
                    getIdx()?.configure({ batchSize: v });
                    await this.plugin.saveSettings();
                }),
        );

        const chunkSizeSetting = new Setting(containerEl)
            .setName('Chunk size')
            .setDesc('Characters per chunk when indexing notes. Smaller = more precise results, more chunks. Larger = more context per chunk, fewer API calls. Changing this will trigger a full index rebuild.');
        chunkSizeSetting.addDropdown((d) =>
            d.addOptions({
                '800':  'Small (800 chars) — best for short atomic notes',
                '1200': 'Medium (1200 chars)',
                '2000': 'Standard (2000 chars) — default',
                '3000': 'Large (3000 chars) — best for long journals',
            })
                .setValue(String(this.plugin.settings.semanticChunkSize ?? 2000))
                .onChange(async (v) => {
                    const newSize = parseInt(v, 10);
                    this.plugin.settings.semanticChunkSize = newSize;
                    getIdx()?.configure({ chunkSize: newSize });
                    await this.plugin.saveSettings();
                    new Notice('Chunk size updated. Rebuild the index to apply the new setting.');
                }),
        );

        const hydeSetting = new Setting(containerEl)
            .setName('HyDE (Hypothetical Document Embeddings)')
            .setDesc('Before searching, ask the LLM to write a short hypothetical note that would answer the query. Embed that instead of the raw query — improves recall for vague or abstract questions. Costs one extra LLM call per semantic_search.');
        addInfoButton(hydeSetting, this.app, 'HyDE', 'HyDE (Hypothetical Document Embeddings) is a technique that improves semantic search recall. Instead of embedding your query directly, the agent first asks the LLM to write a short note that would answer your question. That hypothetical text is then embedded and used for the search. This is especially helpful for vague queries like "what are my goals?" where a direct embedding might not match well. The downside is one extra LLM call per search.');
        hydeSetting.addToggle((t) =>
            t.setValue(this.plugin.settings.hydeEnabled ?? false).onChange(async (v) => {
                this.plugin.settings.hydeEnabled = v;
                await this.plugin.saveSettings();
            }),
        );

        const autoIndexOnChangeSetting = new Setting(containerEl)
            .setName('Auto-index on file changes [BETA]')
            .setDesc('Re-index a note automatically when saved, created, renamed, or deleted. Keep OFF if using a local (Xenova) embedding model — runs on the main thread and slows Obsidian. Safe with an API embedding model (e.g. OpenAI text-embedding-3-small).');
        autoIndexOnChangeSetting.descEl.createDiv({
            cls: 'setting-risk-note',
            text: 'Risk: This setting may slow down your vault performance or freeze Obsidian.',
        });
        addInfoButton(autoIndexOnChangeSetting, this.app, 'Auto-Index on Change', 'When enabled, every file you edit is re-embedded 2 seconds after you stop typing. With a local Xenova model the embedding runs on the main JavaScript thread and will noticeably slow Obsidian. Only enable this if you have an API-based embedding model configured.');
        autoIndexOnChangeSetting.addToggle((t) =>
            t.setValue(this.plugin.settings.semanticAutoIndexOnChange ?? false).onChange(async (v) => {
                this.plugin.settings.semanticAutoIndexOnChange = v;
                await this.plugin.saveSettings();
                new Notice(v ? 'Auto-index on change enabled. Reload Obsidian to activate.' : 'Auto-index on change disabled. Reload Obsidian to deactivate.');
            }),
        );

        const autoIndexSetting = new Setting(containerEl)
            .setName('Auto-index strategy')
            .setDesc('When to automatically rebuild the index. "On Startup" is best for active vaults. "Never" lets you trigger it manually from the ellipsis menu in the chat.');
        addInfoButton(autoIndexSetting, this.app, 'Auto-Index Strategy', '"On Startup" rebuilds the index every time Obsidian opens — keeps the index fresh but adds a few seconds to startup time for large vaults. "On Mode Switch" rebuilds whenever you switch agent modes, useful if each mode works with different parts of your vault. "Never" means you control when to rebuild using the "Force Reindex Vault" option in the chat\'s ellipsis menu.');
        autoIndexSetting.addDropdown((d) =>
            d.addOptions({
                never: 'Never (manual only)',
                startup: 'On Startup',
                'mode-switch': 'On Mode Switch',
            })
                .setValue(this.plugin.settings.semanticAutoIndex ?? 'never')
                .onChange(async (v) => {
                    this.plugin.settings.semanticAutoIndex = v as 'startup' | 'mode-switch' | 'never';
                    await this.plugin.saveSettings();
                }),
        );

        const excludedSetting = new Setting(containerEl)
            .setName('Excluded folders')
            .setDesc('Folders to skip when indexing.');
        addInfoButton(excludedSetting, this.app, 'Excluded Folders', 'Use this to skip folders that contain files you do not want the agent to search through — for example, attachment folders full of images or PDFs, template folders, or private journals. Enter the folder path relative to your vault root, one per line.');

        const excludedFolders = this.plugin.settings.semanticExcludedFolders ?? [];

        // Chip list as a separate row below the setting, full width
        const excludedListEl = containerEl.createDiv('excluded-folder-list');
        const renderExcludedList = () => {
            excludedListEl.empty();
            const current = this.plugin.settings.semanticExcludedFolders ?? [];
            for (const folder of current) {
                const chip = excludedListEl.createDiv('excluded-folder-chip');
                chip.createSpan({ text: folder });
                const removeBtn = chip.createSpan({ cls: 'excluded-folder-remove' });
                setIcon(removeBtn, 'x');
                removeBtn.addEventListener('click', async () => {
                    this.plugin.settings.semanticExcludedFolders =
                        (this.plugin.settings.semanticExcludedFolders ?? []).filter((f) => f !== folder);
                    getIdx()?.configure({ excludedFolders: this.plugin.settings.semanticExcludedFolders });
                    await this.plugin.saveSettings();
                    renderExcludedList();
                });
            }
        };
        renderExcludedList();

        const folderInput = excludedSetting.controlEl.createEl('input', {
            cls: 'excluded-folder-input',
            attr: { type: 'text', placeholder: 'Type / to browse folders' },
        });

        // Folder suggest dropdown
        const suggest = new FolderInputSuggest(this.app, folderInput, excludedFolders);
        suggest.onPick = async (folderPath: string) => {
            if (!this.plugin.settings.semanticExcludedFolders) this.plugin.settings.semanticExcludedFolders = [];
            if (!this.plugin.settings.semanticExcludedFolders.includes(folderPath)) {
                this.plugin.settings.semanticExcludedFolders.push(folderPath);
                getIdx()?.configure({ excludedFolders: this.plugin.settings.semanticExcludedFolders });
                await this.plugin.saveSettings();
                renderExcludedList();
            }
            folderInput.value = '';
        };

        folderInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = folderInput.value.trim();
                if (val) {
                    suggest.onPick(val);
                }
            }
        });

        const storageSetting = new Setting(containerEl)
            .setName('Storage location')
            .setDesc('"Obsidian Sync" stores the index inside the plugin folder and syncs it across your devices. "Local" stores it outside the vault so it is never synced.');
        addInfoButton(storageSetting, this.app, 'Storage Location', 'If you use Obsidian Sync, choose "Obsidian Sync" so the index is available on all your devices without rebuilding it. If you do not use Obsidian Sync, or if the index is too large to sync, choose "Local" to store it in a separate folder outside your vault.');
        storageSetting.addDropdown((d) =>
            d.addOptions({
                'obsidian-sync': 'Obsidian Sync (inside plugin folder)',
                local: 'Local (outside vault, no sync)',
            })
                .setValue(this.plugin.settings.semanticStorageLocation ?? 'obsidian-sync')
                .onChange(async (v) => {
                    this.plugin.settings.semanticStorageLocation = v as 'obsidian-sync' | 'local';
                    await this.plugin.saveSettings();
                }),
        );
    }

    renderEmbeddingRow(table: HTMLElement, model: CustomModel): void {
        const key = getModelKey(model);
        const hasKey = !!model.apiKey || model.provider === 'ollama' || model.provider === 'lmstudio';
        const isActive = this.plugin.settings.activeEmbeddingModelKey === key;

        const row = table.createDiv(`model-row${isActive ? ' model-row-active' : ''}`);

        row.createDiv('mc-name').createSpan({ text: model.displayName ?? model.name, cls: 'mc-name-text' });

        const provEl = row.createDiv('mc-provider');
        const badge = provEl.createSpan({ cls: 'provider-badge', text: PROVIDER_LABELS[model.provider] ?? model.provider });
        badge.style.background = PROVIDER_COLORS[model.provider] ?? '#607d8b';

        const keyEl = row.createDiv('mc-key');
        const keyIcon = keyEl.createSpan('mc-key-icon');
        setIcon(keyIcon, hasKey ? 'check' : 'minus');
        keyEl.addClass(hasKey ? 'mc-key-ok' : 'mc-key-missing');

        // Active radio-style toggle
        const enableEl = row.createDiv('mc-enable');
        const toggle = enableEl.createEl('input', { attr: { type: 'radio', name: 'active-embedding' } });
        toggle.checked = isActive;
        toggle.addEventListener('change', async () => {
            if (toggle.checked) {
                this.plugin.settings.activeEmbeddingModelKey = key;
                await this.plugin.saveSettings();
                this.rerender();
            }
        });

        const actionsEl = row.createDiv('mc-actions');
        const configBtn = actionsEl.createEl('button', { cls: 'mc-action-btn', attr: { title: 'Configure' } });
        setIcon(configBtn, 'settings');
        configBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, { ...model }, async (updated) => {
                const idx = (this.plugin.settings.embeddingModels ?? []).findIndex((m) => getModelKey(m) === key);
                if (idx !== -1) this.plugin.settings.embeddingModels[idx] = updated;
                if (this.plugin.settings.activeEmbeddingModelKey === key) {
                    this.plugin.settings.activeEmbeddingModelKey = getModelKey(updated);
                }
                await this.plugin.saveSettings();
                this.rerender();
            }, true /* forEmbedding */).open();
        });

        const delBtn = actionsEl.createEl('button', { cls: 'mc-action-btn mc-action-del', attr: { title: 'Remove' } });
        setIcon(delBtn, 'trash');
        delBtn.addEventListener('click', async () => {
            this.plugin.settings.embeddingModels = (this.plugin.settings.embeddingModels ?? []).filter(
                (m) => getModelKey(m) !== key,
            );
            if (this.plugin.settings.activeEmbeddingModelKey === key) {
                this.plugin.settings.activeEmbeddingModelKey = this.plugin.settings.embeddingModels[0]
                    ? getModelKey(this.plugin.settings.embeddingModels[0])
                    : '';
            }
            await this.plugin.saveSettings();
            this.rerender();
        });
    }


    // ---------------------------------------------------------------------------
    // Web Search tab (under Providers)
    // ---------------------------------------------------------------------------

}

/** Suggest dropdown that lists vault folders, filtered by input text. */
class FolderInputSuggest extends AbstractInputSuggest<string> {
    private excluded: string[];
    onPick: (folderPath: string) => void = () => {};

    constructor(app: App, inputEl: HTMLInputElement, excluded: string[]) {
        super(app, inputEl);
        this.excluded = excluded;
    }

    getSuggestions(query: string): string[] {
        const lower = query.toLowerCase().replace(/^\//, '');
        return this.app.vault
            .getAllFolders()
            .map((f: TFolder) => f.path)
            .filter((p: string) => !this.excluded.includes(p) && p.toLowerCase().includes(lower))
            .sort();
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    selectSuggestion(value: string): void {
        this.onPick(value);
        this.close();
    }
}
