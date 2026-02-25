import { App, Notice, Setting, setIcon, TFolder, AbstractInputSuggest } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { ModelConfigModal } from './ModelConfigModal';
import { addInfoButton } from './utils';
import { EMBEDDING_SUGGESTIONS, PROVIDER_LABELS, PROVIDER_COLORS } from './constants';
import type { CustomModel } from '../../types/settings';
import { getModelKey } from '../../types/settings';
import type { SemanticIndexService } from '../../core/semantic/SemanticIndexService';
import { t } from '../../i18n';

export class EmbeddingsTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void) {}

    build(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.embeddings.headingModels') });

        const desc = containerEl.createDiv('model-table-desc');
        desc.setText(t('settings.embeddings.modelsDesc'));

        // Table header
        const table = containerEl.createDiv('model-table embedding-table');
        const header = table.createDiv('model-row model-row-header');
        header.createDiv({ cls: 'mc-name', text: t('settings.embeddings.headerModel') });
        header.createDiv({ cls: 'mc-provider', text: t('settings.embeddings.headerProvider') });
        header.createDiv({ cls: 'mc-key', text: t('settings.embeddings.headerKey') });
        header.createDiv({ cls: 'mc-enable', text: t('settings.embeddings.headerActive') });
        header.createDiv({ cls: 'mc-actions' });

        // Built-in local model (always first)
        if ((this.plugin.settings.embeddingModels ?? []).length === 0) {
            const emptyRow = table.createDiv('model-row');
            emptyRow.createDiv('mc-name').createSpan({
                text: t('settings.embeddings.empty'),
                cls: 'mc-name-text setting-item-description',
            });
        }

        // User-added API models
        const models = this.plugin.settings.embeddingModels ?? [];
        models.forEach((model) => this.renderEmbeddingRow(table, model));

        const footer = containerEl.createDiv('model-table-footer');
        const addBtn = footer.createEl('button', { cls: 'mod-cta model-add-btn', text: t('settings.embeddings.addModel') });
        addBtn.addEventListener('click', () => {
            new ModelConfigModal(this.app, null, async (newModel) => {
                const key = getModelKey(newModel);
                if ((this.plugin.settings.embeddingModels ?? []).some((m) => getModelKey(m) === key)) {
                    new Notice(t('settings.embeddings.alreadyExists', { name: newModel.name }));
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
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.embeddings.headingIndex') });

        const activeEmbModel = this.plugin.getActiveEmbeddingModel();
        const embModelDesc = activeEmbModel
            ? t('settings.embeddings.usingModel', { name: activeEmbModel.displayName ?? activeEmbModel.name, provider: activeEmbModel.provider })
            : t('settings.embeddings.noEmbeddingModel');

        containerEl.createEl('p', {
            cls: 'agent-settings-desc',
            text: t('settings.embeddings.indexDesc', { embModelDesc }),
        });

        if (!activeEmbModel) {
            const guide = containerEl.createDiv({ cls: 'setting-item-description' });
            guide.style.marginBottom = '12px';
            guide.style.padding = '8px 12px';
            guide.style.borderLeft = '3px solid var(--interactive-accent)';
            guide.style.background = 'var(--background-secondary)';
            guide.style.borderRadius = '4px';
            guide.innerHTML = [
                `<strong>${t('settings.embeddings.quickSetupTitle')}</strong>`,
                t('settings.embeddings.quickSetupStep1'),
                t('settings.embeddings.quickSetupStep2'),
                t('settings.embeddings.quickSetupStep3'),
                '',
                `<strong>${t('settings.embeddings.quickSetupFreeTitle')}</strong> ${t('settings.embeddings.quickSetupFreeDesc')}`,
            ].join('<br>');
        }

        const getIdx = () => (this.plugin as any).semanticIndex;
        // statusEl is created later inside the "Build index" setting — declared here for scope
        let statusEl: HTMLElement;

        const semanticEnableSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.enableIndex'))
            .setDesc(t('settings.embeddings.enableIndexDesc'));
        addInfoButton(semanticEnableSetting, this.app, t('settings.embeddings.infoIndexTitle'), t('settings.embeddings.infoIndexBody'));
        semanticEnableSetting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.enableSemanticIndex ?? false).onChange(async (v) => {
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
            .setName(t('settings.embeddings.indexPdfs'))
            .setDesc(t('settings.embeddings.indexPdfsDesc'))
            .addToggle((t) =>
                t.setValue(this.plugin.settings.semanticIndexPdfs ?? false).onChange(async (v) => {
                    this.plugin.settings.semanticIndexPdfs = v;
                    getIdx()?.configure({ indexPdfs: v });
                    await this.plugin.saveSettings();
                }),
            );

        const buildSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.buildIndexName'))
            .setDesc(t('settings.embeddings.buildIndexDesc'));
        statusEl = buildSetting.descEl.createDiv('agent-semantic-status');

        const refreshStatus = () => {
            statusEl.empty();
            if (!this.plugin.settings.enableSemanticIndex) {
                statusEl.setText(t('settings.embeddings.statusDisabled'));
                return;
            }
            const idx = getIdx();
            if (!idx) {
                statusEl.setText(t('settings.embeddings.statusNotInit'));
                return;
            }
            if (idx.building) {
                const p = idx.progressIndexed ?? idx.docCount;
                const total = idx.progressTotal ?? '?';
                statusEl.setText(t('settings.embeddings.statusBuilding') + ` (${p} / ${total} files)`);
                return;
            }
            if (idx.isIndexed) {
                const br = idx.lastBuildResult;
                const base = t('settings.embeddings.statusReady', { docCount: idx.docCount, builtAt: (idx.lastBuiltAt as Date).toLocaleString() });
                if (br && br.errors > 0) {
                    statusEl.setText(`${base} · ${t('settings.embeddings.statusSkipped', { count: br.errors })}`);
                } else {
                    statusEl.setText(base);
                }
            } else {
                statusEl.setText(t('settings.embeddings.statusNotBuilt'));
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
                btn.setButtonText(t('settings.embeddings.buildIndex')).onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice(t('settings.embeddings.enableFirst')); return; }
                    if (idx.building) { new Notice(t('settings.embeddings.alreadyBuilding')); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText(t('settings.embeddings.building')).setDisabled(true);
                    cancelBtn.setDisabled(false);
                    statusEl.setText(t('settings.embeddings.statusBuilding'));
                    try {
                        const result = await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`${t('settings.embeddings.building')} (${indexed}/${total})`);
                        });
                        if (result.errors > 0) {
                            new Notice(t('settings.embeddings.indexBuilt', { indexed: result.indexed, total: result.total, errors: result.errors }));
                        }
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(t('settings.embeddings.statusBuildFailed', { error: (e as Error).message }));
                    } finally {
                        btn.setButtonText(t('settings.embeddings.buildIndex')).setDisabled(false);
                        cancelBtn.setDisabled(true);
                    }
                });
            })
            .addButton((btn) => {
                btn.setButtonText(t('settings.embeddings.forceRebuild')).setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (!idx) { new Notice(t('settings.embeddings.enableFirst')); return; }
                    if (idx.building) { new Notice(t('settings.embeddings.alreadyBuilding')); return; }
                    idx.setEmbeddingModel(this.plugin.getActiveEmbeddingModel() ?? null);
                    btn.setButtonText(t('settings.embeddings.rebuilding')).setDisabled(true);
                    cancelBtn.setDisabled(false);
                    statusEl.setText(t('settings.embeddings.statusForceRebuild'));
                    try {
                        const result = await idx.buildIndex((indexed: number, total: number) => {
                            statusEl.setText(`${t('settings.embeddings.rebuilding')} (${indexed}/${total})`);
                        }, true);
                        if (result.errors > 0) {
                            new Notice(t('settings.embeddings.indexRebuilt', { indexed: result.indexed, total: result.total, errors: result.errors }));
                        }
                        refreshStatus();
                    } catch (e) {
                        statusEl.setText(t('settings.embeddings.statusRebuildFailed', { error: (e as Error).message }));
                    } finally {
                        btn.setButtonText(t('settings.embeddings.forceRebuild')).setDisabled(false);
                        cancelBtn.setDisabled(true);
                    }
                });
            });

        let cancelBtn: any;
        new Setting(containerEl)
            .setName(t('settings.embeddings.cancelIndexing'))
            .setDesc(t('settings.embeddings.cancelIndexingDesc'))
            .addButton((btn) => {
                cancelBtn = btn;
                btn.setButtonText(t('settings.embeddings.cancel')).setDisabled(true).onClick(() => {
                    getIdx()?.cancelBuild();
                    btn.setDisabled(true);
                    statusEl.setText(t('settings.embeddings.statusCancelling'));
                });
            });

        new Setting(containerEl)
            .setName(t('settings.embeddings.deleteIndexName'))
            .setDesc(t('settings.embeddings.deleteIndexDesc'))
            .addButton((btn) => {
                btn.setButtonText(t('settings.embeddings.deleteIndex')).setWarning().onClick(async () => {
                    const idx = getIdx();
                    if (idx) await idx.deleteIndex();
                    refreshStatus();
                });
            });

        // ── Index configuration ───────────────────────────────────────────────
        containerEl.createEl('h3', { cls: 'agent-settings-section', text: t('settings.embeddings.headingConfig') });

        const batchSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.checkpointInterval'))
            .setDesc(t('settings.embeddings.checkpointIntervalDesc'));
        addInfoButton(batchSetting, this.app, t('settings.embeddings.infoCheckpointTitle'), t('settings.embeddings.infoCheckpointBody'));
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
            .setName(t('settings.embeddings.chunkSize'))
            .setDesc(t('settings.embeddings.chunkSizeDesc'));
        chunkSizeSetting.addDropdown((d) =>
            d.addOptions({
                '800':  t('settings.embeddings.chunkSmall'),
                '1200': t('settings.embeddings.chunkMedium'),
                '2000': t('settings.embeddings.chunkStandard'),
                '3000': t('settings.embeddings.chunkLarge'),
            })
                .setValue(String(this.plugin.settings.semanticChunkSize ?? 2000))
                .onChange(async (v) => {
                    const newSize = parseInt(v, 10);
                    this.plugin.settings.semanticChunkSize = newSize;
                    getIdx()?.configure({ chunkSize: newSize });
                    await this.plugin.saveSettings();
                    new Notice(t('settings.embeddings.chunkSizeUpdated'));
                }),
        );

        const hydeSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.hyde'))
            .setDesc(t('settings.embeddings.hydeDesc'));
        addInfoButton(hydeSetting, this.app, t('settings.embeddings.infoHydeTitle'), t('settings.embeddings.infoHydeBody'));
        hydeSetting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.hydeEnabled ?? false).onChange(async (v) => {
                this.plugin.settings.hydeEnabled = v;
                await this.plugin.saveSettings();
            }),
        );

        const autoIndexOnChangeSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.autoIndexOnChange'))
            .setDesc(t('settings.embeddings.autoIndexOnChangeDesc'));
        autoIndexOnChangeSetting.descEl.createDiv({
            cls: 'setting-risk-note',
            text: t('settings.embeddings.riskNote'),
        });
        addInfoButton(autoIndexOnChangeSetting, this.app, t('settings.embeddings.infoAutoChangeTitle'), t('settings.embeddings.infoAutoChangeBody'));
        autoIndexOnChangeSetting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.semanticAutoIndexOnChange ?? false).onChange(async (v) => {
                this.plugin.settings.semanticAutoIndexOnChange = v;
                await this.plugin.saveSettings();
                new Notice(v ? t('settings.embeddings.autoIndexEnabled') : t('settings.embeddings.autoIndexDisabled'));
            }),
        );

        const autoIndexSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.autoIndexStrategy'))
            .setDesc(t('settings.embeddings.autoIndexStrategyDesc'));
        addInfoButton(autoIndexSetting, this.app, t('settings.embeddings.infoAutoStrategyTitle'), t('settings.embeddings.infoAutoStrategyBody'));
        autoIndexSetting.addDropdown((d) =>
            d.addOptions({
                never: t('settings.embeddings.autoIndexNever'),
                startup: t('settings.embeddings.autoIndexStartup'),
                'mode-switch': t('settings.embeddings.autoIndexModeSwitch'),
            })
                .setValue(this.plugin.settings.semanticAutoIndex ?? 'never')
                .onChange(async (v) => {
                    this.plugin.settings.semanticAutoIndex = v as 'startup' | 'mode-switch' | 'never';
                    await this.plugin.saveSettings();
                }),
        );

        const excludedSetting = new Setting(containerEl)
            .setName(t('settings.embeddings.excludedFolders'))
            .setDesc(t('settings.embeddings.excludedFoldersDesc'));
        addInfoButton(excludedSetting, this.app, t('settings.embeddings.infoExcludedTitle'), t('settings.embeddings.infoExcludedBody'));

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
            attr: { type: 'text', placeholder: t('settings.embeddings.folderPlaceholder') },
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
            .setName(t('settings.embeddings.storageLocation'))
            .setDesc(t('settings.embeddings.storageLocationDesc'));
        addInfoButton(storageSetting, this.app, t('settings.embeddings.infoStorageTitle'), t('settings.embeddings.infoStorageBody'));
        storageSetting.addDropdown((d) =>
            d.addOptions({
                'obsidian-sync': t('settings.embeddings.storageSync'),
                local: t('settings.embeddings.storageLocal'),
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
        const configBtn = actionsEl.createEl('button', { cls: 'mc-action-btn', attr: { title: t('settings.embeddings.configureModel') } });
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

        const delBtn = actionsEl.createEl('button', { cls: 'mc-action-btn mc-action-del', attr: { title: t('settings.embeddings.removeModel') } });
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
