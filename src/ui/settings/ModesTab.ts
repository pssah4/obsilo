import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { ModeConfig, ToolGroup } from '../../types/settings';
import { getModelKey } from '../../types/settings';
import { BUILT_IN_MODES } from '../../core/modes/builtinModes';
import { buildSystemPromptForMode } from '../../core/systemPrompt';
import { GlobalModeStore } from '../../core/modes/GlobalModeStore';
import { TOOL_LABEL_MAP, TOOL_GROUP_META } from './constants';
import { SystemPromptPreviewModal } from './SystemPromptPreviewModal';
import { NewModeModal } from './NewModeModal';
import { t } from '../../i18n';
import type { ModeService } from '../../core/modes/ModeService';

export class ModesTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void, private modeService?: ModeService) {}

    build(containerEl: HTMLElement): void {
        // Collect all selectable modes (built-in + custom, not __custom instruction entries).
        // Vault entries with the same slug as a built-in are overrides — they are already
        // represented by the built-in entry in the dropdown, so exclude them here.
        const builtInSlugs = new Set(BUILT_IN_MODES.map((m) => m.slug));
        const getAllModes = (): ModeConfig[] => [
            ...BUILT_IN_MODES,
            ...(this.modeService?.getGlobalModes?.() ?? []),
            ...this.plugin.settings.customModes.filter(
                (m) => m.source === 'vault' && !m.slug.endsWith('__custom') && !builtInSlugs.has(m.slug),
            ),
        ];

        let selectedSlug = this.plugin.settings.currentMode;
        if (!getAllModes().find((m) => m.slug === selectedSlug)) {
            selectedSlug = BUILT_IN_MODES[0].slug;
        }

        // ── Top row: selector + action buttons ───────────────────────────────
        const topRow = containerEl.createDiv('modes-top-row');

        const select = topRow.createEl('select', { cls: 'modes-select' });
        const refreshSelect = () => {
            select.empty();
            const groups: { label: string; modes: ModeConfig[] }[] = [
                { label: t('settings.modes.groupBuiltIn'), modes: BUILT_IN_MODES },
                { label: t('settings.modes.groupGlobal'), modes: this.modeService?.getGlobalModes?.() ?? [] },
                { label: t('settings.modes.groupVault'), modes: this.plugin.settings.customModes.filter((m) => m.source === 'vault' && !m.slug.endsWith('__custom') && !builtInSlugs.has(m.slug)) },
            ];
            for (const group of groups) {
                if (group.modes.length === 0) continue;
                const optgroup = select.createEl('optgroup');
                optgroup.label = group.label;
                for (const m of group.modes) {
                    const opt = optgroup.createEl('option', { value: m.slug, text: m.name });
                    if (m.slug === selectedSlug) opt.selected = true;
                }
            }
        };
        refreshSelect();

        const btnGroup = topRow.createDiv('modes-btn-group');
        const newBtn = btnGroup.createEl('button', { text: t('settings.modes.newMode'), cls: 'mod-cta modes-top-btn' });
        const importBtn = btnGroup.createEl('button', { text: t('settings.modes.import'), cls: 'modes-top-btn' });

        // ── Form area ─────────────────────────────────────────────────────────
        const formArea = containerEl.createDiv('modes-form-area');

        const renderForm = (slug: string) => {
            formArea.empty();

            const builtIn = BUILT_IN_MODES.find((m) => m.slug === slug);
            // Vault override: same slug as built-in, stored in customModes with source 'vault'
            const vaultOverride = builtIn
                ? this.plugin.settings.customModes.find(
                      (m) => m.slug === slug && m.source === 'vault' && !m.slug.endsWith('__custom'),
                  )
                : undefined;
            // Vault custom mode (not a built-in at all)
            const vaultCustom = !builtIn
                ? this.plugin.settings.customModes.find(
                      (m) => m.slug === slug && m.source === 'vault',
                  )
                : undefined;
            // Global mode (not a built-in, not in customModes)
            const globalMode: ModeConfig | undefined = !builtIn && !vaultCustom
                ? (this.modeService?.getGlobalModes?.() ?? []).find(
                      (m: ModeConfig) => m.slug === slug,
                  )
                : undefined;

            // Effective mode for display: override > built-in > vault custom > global
            const mode = vaultOverride ?? builtIn ?? vaultCustom ?? globalMode;
            if (!mode) return;

            const isBuiltIn = !!builtIn;
            const isGlobal = !!globalMode;

            /**
             * Returns the mutable reference for this mode's edits.
             * For built-in modes this lazily creates a vault override entry so
             * that changes are persisted without mutating the constant.
             */
            const getOrCreateEditable = (): ModeConfig => {
                if (isBuiltIn) {
                    let ov = this.plugin.settings.customModes.find(
                        (m) => m.slug === slug && m.source === 'vault' && !m.slug.endsWith('__custom'),
                    );
                    if (!ov) {
                        ov = { ...builtIn, source: 'vault' };
                        this.plugin.settings.customModes.push(ov);
                    }
                    return ov;
                }
                if (isGlobal && globalMode) return globalMode;
                return vaultCustom ?? mode;
            };

            const saveMode = async () => {
                if (isGlobal && globalMode) {
                    await GlobalModeStore.updateMode(globalMode);
                    await this.modeService?.reloadGlobalModes?.();
                } else {
                    await this.plugin.saveSettings();
                }
            };

            // ── Customized badge (built-in modes that have been overridden) ────
            if (isBuiltIn && vaultOverride) {
                const badge = formArea.createDiv('modes-customized-badge');
                setIcon(badge.createSpan('modes-customized-icon'), 'pencil');
                badge.createEl('span', { cls: 'modes-customized-text', text: t('settings.modes.customized') });
            }

            // ── Model Selection ───────────────────────────────────────────────
            const modelSetting = new Setting(formArea)
                .setName(t('settings.modes.model'))
                .setDesc(t('settings.modes.modelDesc'));
            const models = this.plugin.settings.activeModels;
            const currentModeModelKey = this.plugin.settings.modeModelKeys?.[slug] ?? '';
            modelSetting.addDropdown((dd) => {
                dd.addOption('', t('settings.modes.useGlobalModel'));
                for (const m of models) {
                    const key = getModelKey(m);
                    dd.addOption(key, m.displayName ?? m.name);
                }
                dd.setValue(currentModeModelKey);
                dd.onChange(async (v) => {
                    if (!this.plugin.settings.modeModelKeys) this.plugin.settings.modeModelKeys = {};
                    if (v) this.plugin.settings.modeModelKeys[slug] = v;
                    else delete this.plugin.settings.modeModelKeys[slug];
                    await this.plugin.saveSettings();
                });
            });

            // ── Name ─────────────────────────────────────────────────────────
            new Setting(formArea)
                .setName(t('settings.modes.name'))
                .addText((txt) => {
                    txt.setValue(mode.name);
                    // Name is read-only for built-in modes (slug must remain stable)
                    if (isBuiltIn) {
                        txt.inputEl.disabled = true;
                    } else {
                        txt.onChange(async (v) => {
                            getOrCreateEditable().name = v;
                            await saveMode();
                            refreshSelect();
                        });
                    }
                });

            // ── Slug (always read-only) ───────────────────────────────────────
            new Setting(formArea)
                .setName(t('settings.modes.slug'))
                .addText((txt) => { txt.setValue(mode.slug); txt.inputEl.disabled = true; });

            // ── Short description ─────────────────────────────────────────────
            const descWrap = formArea.createDiv('modes-field');
            descWrap.createEl('div', { cls: 'modes-field-label', text: t('settings.modes.shortDesc') });
            descWrap.createEl('div', { cls: 'modes-field-desc', text: t('settings.modes.shortDescHint') });
            const descTextarea = descWrap.createEl('textarea', { cls: 'modes-textarea', attr: { placeholder: t('settings.modes.shortDescPlaceholder') } });
            descTextarea.value = mode.description || '';
            descTextarea.rows = 2;
            descTextarea.addEventListener('input', () => {
                const editable = getOrCreateEditable();
                editable.description = descTextarea.value;
                void saveMode();
            });

            // ── When to Use ───────────────────────────────────────────────────
            const wtuWrap = formArea.createDiv('modes-field');
            wtuWrap.createEl('div', { cls: 'modes-field-label', text: t('settings.modes.whenToUse') });
            wtuWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: t('settings.modes.whenToUseHint'),
            });
            const wtuTextarea = wtuWrap.createEl('textarea', {
                cls: 'modes-textarea',
                attr: { placeholder: t('settings.modes.whenToUsePlaceholder') },
            });
            wtuTextarea.value = mode.whenToUse ?? '';
            wtuTextarea.rows = 3;
            wtuTextarea.addEventListener('input', () => {
                const editable = getOrCreateEditable();
                editable.whenToUse = wtuTextarea.value;
                void saveMode();
            });

            // ── Available Tools ───────────────────────────────────────────────
            const toolsWrap = formArea.createDiv('modes-field');
            const toolsHeaderRow = toolsWrap.createDiv('modes-tools-header');
            toolsHeaderRow.createEl('div', { cls: 'modes-field-label', text: t('settings.modes.availableTools') });

            let toolsEditMode = false;
            const toolsBody = toolsWrap.createDiv('modes-tools-body');

            const renderToolsReadOnly = () => {
                toolsBody.empty();
                const enabled = mode.toolGroups.filter((g) => g in TOOL_GROUP_META);
                if (enabled.length === 0) {
                    toolsBody.createEl('span', { cls: 'modes-tools-none', text: t('settings.modes.noTools') });
                } else {
                    toolsBody.createEl('span', {
                        cls: 'modes-tools-list',
                        text: enabled.map((g) => TOOL_GROUP_META[g]?.label ?? g).join(', '),
                    });
                }
            };

            const renderToolsEdit = () => {
                toolsBody.empty();
                // Current per-tool override for this mode (if any)
                const currentOverride: string[] | undefined =
                    this.plugin.settings.modeToolOverrides?.[slug];

                for (const [group, meta] of Object.entries(TOOL_GROUP_META)) {
                    const isGroupEnabled = mode.toolGroups.includes(group as ToolGroup);

                    // --- Group accordion ---
                    const details = toolsBody.createEl('details', { cls: 'modes-tool-group-accordion' });
                    if (isGroupEnabled) details.open = true;

                    const summary = details.createEl('summary', { cls: 'modes-tool-group-summary' });

                    // Group enable/disable checkbox
                    const groupCb = summary.createEl('input', { type: 'checkbox' });
                    groupCb.checked = isGroupEnabled;
                    groupCb.addEventListener('click', (e) => e.stopPropagation()); // prevent accordion toggle
                    groupCb.addEventListener('change', () => {
                        const editable = getOrCreateEditable();
                        if (groupCb.checked) {
                            if (!editable.toolGroups.includes(group as ToolGroup)) editable.toolGroups.push(group as ToolGroup);
                            details.open = true;
                        } else {
                            editable.toolGroups = editable.toolGroups.filter((g) => g !== group);
                            details.open = false;
                        }
                        mode.toolGroups = [...editable.toolGroups];
                        void saveMode();
                        // Recount active tools badge
                        badgeEl.setText(getCountBadge(group, groupCb.checked));
                    });

                    summary.createEl('span', { cls: 'modes-tool-group-label', text: meta.label });

                    // Active tools count badge
                    const getCountBadge = (grp: string, enabled: boolean): string => {
                        if (!enabled) return '0 / ' + TOOL_GROUP_META[grp].tools.length;
                        const override = this.plugin.settings.modeToolOverrides?.[slug];
                        if (!override) return meta.tools.length + ' / ' + meta.tools.length;
                        const active = meta.tools.filter((tn) => override.includes(tn)).length;
                        return `${active} / ${meta.tools.length}`;
                    };
                    const badgeEl = summary.createEl('span', {
                        cls: 'modes-tool-count-badge',
                        text: getCountBadge(group, isGroupEnabled),
                    });

                    // --- Individual tool checkboxes ---
                    const toolsGrid = details.createDiv('modes-tool-checkboxes');
                    for (const toolName of meta.tools) {
                        const row = toolsGrid.createDiv('modes-tool-row');
                        const toolCb = row.createEl('input', { type: 'checkbox' });
                        const isEnabled = !currentOverride || currentOverride.includes(toolName);
                        toolCb.checked = isEnabled && isGroupEnabled;
                        toolCb.disabled = !isGroupEnabled;

                        const toolMeta = TOOL_LABEL_MAP[toolName];
                        const labelEl = row.createEl('label', { cls: 'modes-tool-name' });
                        labelEl.createSpan({ cls: 'modes-tool-label-text', text: toolMeta?.label ?? toolName });
                        if (toolMeta?.desc) {
                            labelEl.createSpan({ cls: 'modes-tool-label-desc', text: toolMeta.desc });
                        }

                        toolCb.addEventListener('change', () => {
                            // Start from current override or all tools in all groups
                            let allActiveTools: string[] = this.plugin.settings.modeToolOverrides?.[slug]
                                ?? this.modeService?.getToolNames(mode) ?? [];
                            if (toolCb.checked) {
                                if (!allActiveTools.includes(toolName)) allActiveTools = [...allActiveTools, toolName];
                            } else {
                                allActiveTools = allActiveTools.filter((tn) => tn !== toolName);
                            }
                            void this.modeService?.setModeToolOverride(slug, allActiveTools);
                            badgeEl.setText(getCountBadge(group, isGroupEnabled));
                        });
                    }
                }
            };

            renderToolsReadOnly();

            // "Edit tools" button — hidden for Ask mode (protected)
            if (slug !== 'ask') {
                const editToolsBtn = toolsHeaderRow.createEl('button', {
                    text: t('settings.modes.editTools'),
                    cls: 'modes-edit-tools-btn',
                });
                editToolsBtn.addEventListener('click', () => {
                    toolsEditMode = !toolsEditMode;
                    editToolsBtn.setText(toolsEditMode ? t('settings.modes.done') : t('settings.modes.editTools'));
                    if (toolsEditMode) renderToolsEdit();
                    else renderToolsReadOnly();
                });
            }

            // ── Allowed MCP Servers ──────────────────────────────────────────
            const mcpServerNames = Object.keys(this.plugin.settings.mcpServers ?? {});
            if (mcpServerNames.length > 0) {
                const mcpWrap = formArea.createDiv('modes-field');
                mcpWrap.createEl('div', { cls: 'modes-field-label', text: t('settings.modes.allowedMcpServers') });
                mcpWrap.createEl('div', {
                    cls: 'modes-field-desc',
                    text: t('settings.modes.allowedMcpServersHint'),
                });
                const mcpCbList = mcpWrap.createDiv('modes-skills-list');
                const modeMcpAllowed = this.plugin.settings.modeMcpServers?.[slug];
                // undefined or empty = all allowed
                const allowedSet = new Set<string>(modeMcpAllowed && modeMcpAllowed.length > 0 ? modeMcpAllowed : mcpServerNames);
                for (const serverName of mcpServerNames) {
                    const row = mcpCbList.createDiv('modes-skills-row');
                    const cb = row.createEl('input', { type: 'checkbox' });
                    cb.checked = allowedSet.has(serverName);
                    row.createEl('label', { cls: 'modes-skills-label', text: serverName });
                    cb.addEventListener('change', () => { void (async () => {
                        if (!this.plugin.settings.modeMcpServers) this.plugin.settings.modeMcpServers = {};
                        const cur = new Set<string>(
                            this.plugin.settings.modeMcpServers[slug]?.length
                                ? this.plugin.settings.modeMcpServers[slug]
                                : mcpServerNames
                        );
                        if (cb.checked) cur.add(serverName);
                        else cur.delete(serverName);
                        // If all are checked, store empty array (= no restriction)
                        const next = [...cur];
                        this.plugin.settings.modeMcpServers[slug] = next.length === mcpServerNames.length ? [] : next;
                        await this.plugin.saveSettings();
                    })(); });
                }
            }

            // ── Allowed Skills ────────────────────────────────────────────────
            const skillsManager = this.plugin.skillsManager;
            if (skillsManager) {
                const skillsWrap = formArea.createDiv('modes-field');
                const skillsHeaderRow = skillsWrap.createDiv('modes-tools-header');
                skillsHeaderRow.createEl('div', { cls: 'modes-field-label', text: t('settings.modes.allowedSkills') });

                let skillsEditMode = false;
                const skillsBody = skillsWrap.createDiv('modes-tools-body');

                // Cache discovered skills for both views
                let cachedSkills: { path: string; name: string; description: string }[] = [];

                const getSkillAllowedSet = (): Set<string> => {
                    const modeAllowed = this.plugin.settings.modeSkillAllowList?.[slug];
                    return new Set<string>(
                        modeAllowed && modeAllowed.length > 0 ? modeAllowed : cachedSkills.map((s) => s.name),
                    );
                };

                const renderSkillsReadOnly = () => {
                    skillsBody.empty();
                    if (cachedSkills.length === 0) {
                        skillsBody.createEl('span', { cls: 'modes-tools-none', text: t('settings.modes.noSkills') });
                        return;
                    }
                    const allowedSet = getSkillAllowedSet();
                    const allowed = cachedSkills.filter((s) => allowedSet.has(s.name));
                    if (allowed.length === cachedSkills.length) {
                        skillsBody.createEl('span', {
                            cls: 'modes-tools-list',
                            text: t('settings.modes.allSkills', { count: cachedSkills.length }),
                        });
                    } else if (allowed.length === 0) {
                        skillsBody.createEl('span', { cls: 'modes-tools-none', text: t('settings.modes.noTools') });
                    } else {
                        skillsBody.createEl('span', {
                            cls: 'modes-tools-list',
                            text: allowed.map((s) => s.name).join(', '),
                        });
                    }
                };

                const renderSkillsEdit = () => {
                    skillsBody.empty();
                    if (cachedSkills.length === 0) {
                        skillsBody.createEl('span', { cls: 'modes-tools-none', text: t('settings.modes.noSkills') });
                        return;
                    }
                    const allowedSet = getSkillAllowedSet();
                    for (const skill of cachedSkills) {
                        const row = skillsBody.createDiv('modes-skills-row');
                        const cb = row.createEl('input', { type: 'checkbox' });
                        cb.checked = allowedSet.has(skill.name);
                        const lbl = row.createEl('label', { cls: 'modes-skills-label' });
                        lbl.createSpan({ text: skill.name });
                        if (skill.description) lbl.createSpan({ cls: 'modes-skills-desc', text: skill.description });
                        cb.addEventListener('change', () => {
                            if (!this.plugin.settings.modeSkillAllowList) this.plugin.settings.modeSkillAllowList = {};
                            const cur = new Set<string>(
                                this.plugin.settings.modeSkillAllowList[slug]?.length
                                    ? this.plugin.settings.modeSkillAllowList[slug]
                                    : cachedSkills.map((s) => s.name),
                            );
                            if (cb.checked) cur.add(skill.name);
                            else cur.delete(skill.name);
                            const next = [...cur];
                            this.plugin.settings.modeSkillAllowList[slug] =
                                next.length === cachedSkills.length ? [] : next;
                            void this.plugin.saveSettings();
                        });
                    }
                };

                // Show loading, then render read-only once skills are loaded
                skillsBody.createEl('span', { cls: 'modes-loading-hint', text: t('settings.modes.loading') });
                void (async () => {
                    cachedSkills = await skillsManager.discoverSkills();
                    renderSkillsReadOnly();
                })();

                // "Edit skills" button
                const editSkillsBtn = skillsHeaderRow.createEl('button', {
                    text: t('settings.modes.editSkills'),
                    cls: 'modes-edit-tools-btn',
                });
                editSkillsBtn.addEventListener('click', () => {
                    skillsEditMode = !skillsEditMode;
                    editSkillsBtn.setText(skillsEditMode ? t('settings.modes.done') : t('settings.modes.editSkills'));
                    if (skillsEditMode) renderSkillsEdit();
                    else renderSkillsReadOnly();
                });
            }

            // ── Role Definition ───────────────────────────────────────────────
            const roleWrap = formArea.createDiv('modes-field');
            roleWrap.createEl('div', { cls: 'modes-field-label', text: t('settings.modes.roleDefinition') });
            roleWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: t('settings.modes.roleDefinitionHint'),
            });
            const roleTextarea = roleWrap.createEl('textarea', { cls: 'modes-textarea' });
            roleTextarea.value = mode.roleDefinition || '';
            roleTextarea.rows = 8;
            roleTextarea.addEventListener('input', () => {
                const editable = getOrCreateEditable();
                editable.roleDefinition = roleTextarea.value;
                mode.roleDefinition = editable.roleDefinition;
                void saveMode();
            });

            // ── Mode-specific Custom Instructions ─────────────────────────────
            const ciWrap = formArea.createDiv('modes-field');
            ciWrap.createEl('div', { cls: 'modes-field-label', text: t('settings.modes.customInstructions') });
            ciWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: t('settings.modes.customInstructionsHint', { mode: mode.name }),
            });
            const ciTextarea = ciWrap.createEl('textarea', {
                cls: 'modes-textarea',
                attr: { placeholder: t('settings.modes.customInstructionsPlaceholder', { mode: mode.name }) },
            });
            // Read from override (preferred) or legacy __custom entry
            const legacyCi = this.plugin.settings.customModes.find((m) => m.slug === `${slug}__custom`);
            ciTextarea.value = isBuiltIn
                ? (vaultOverride?.customInstructions ?? legacyCi?.customInstructions ?? '')
                : (mode.customInstructions ?? '');
            ciTextarea.rows = 4;
            ciTextarea.addEventListener('input', () => {
                const value = ciTextarea.value.trim();
                const editable = getOrCreateEditable();
                editable.customInstructions = value || undefined;
                if (isBuiltIn) {
                    // Migrate away from legacy __custom entry
                    const legacyIdx = this.plugin.settings.customModes.findIndex((m) => m.slug === `${slug}__custom`);
                    if (legacyIdx >= 0) this.plugin.settings.customModes.splice(legacyIdx, 1);
                }
                void saveMode();
            });

            // ── Bottom action bar ─────────────────────────────────────────────
            const bottomBar = formArea.createDiv('modes-bottom-bar');

            const isActive = this.plugin.settings.currentMode === slug;
            if (isActive) {
                bottomBar.createEl('span', { cls: 'modes-active-badge', text: t('settings.modes.activeMode') });
            } else {
                const setBtn = bottomBar.createEl('button', { text: t('settings.modes.setActive'), cls: 'mod-cta' });
                setBtn.addEventListener('click', () => { void (async () => {
                    this.plugin.settings.currentMode = slug;
                    await this.plugin.saveSettings();
                    this.rerender();
                })(); });
            }

            // Preview System Prompt
            const previewBtn = bottomBar.createEl('button', { text: t('settings.modes.previewPrompt'), cls: 'modes-preview-btn' });
            previewBtn.addEventListener('click', () => {
                const prompt = buildSystemPromptForMode({
                    mode,
                    globalCustomInstructions: this.plugin.settings.globalCustomInstructions || undefined,
                    configDir: this.app.vault.configDir,
                });
                new SystemPromptPreviewModal(this.app, mode.name, prompt).open();
            });

            // Export
            const exportBtn = bottomBar.createEl('button', { text: t('settings.modes.export'), cls: 'modes-export-btn' });
            exportBtn.addEventListener('click', () => {
                const exportData: Partial<ModeConfig> = { ...mode };
                delete exportData.source;
                const json = JSON.stringify(exportData, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${mode.slug}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });

            // Restore defaults (built-in modes only — visible, disabled unless there is an override)
            if (isBuiltIn) {
                const hasOverride = !!this.plugin.settings.customModes.find(
                    (m) => (m.slug === slug && m.source === 'vault') || m.slug === `${slug}__custom`,
                );
                const restoreBtn = bottomBar.createEl('button', {
                    text: t('settings.modes.restoreDefaults'),
                    cls: 'modes-restore-btn',
                });
                if (!hasOverride) restoreBtn.disabled = true;
                restoreBtn.addEventListener('click', () => { void (async () => {
                    // Remove vault override + legacy __custom entry (restores role definition,
                    // tool groups, custom instructions, and agent instructions to built-in defaults)
                    this.plugin.settings.customModes = this.plugin.settings.customModes.filter(
                        (m) => !(m.slug === slug && m.source === 'vault') && m.slug !== `${slug}__custom`,
                    );
                    // Also clear the per-mode model override so global default is used again
                    if (this.plugin.settings.modeModelKeys) {
                        delete this.plugin.settings.modeModelKeys[slug];
                    }
                    await this.plugin.saveSettings();
                    new Notice(t('settings.modes.restored', { name: mode.name }));
                    renderForm(slug);
                })(); });
            }

            // Delete (non-built-in modes only)
            if (!isBuiltIn) {
                const deleteBtn = bottomBar.createEl('button', {
                    text: t('settings.modes.delete'),
                    cls: 'mod-warning modes-delete-btn',
                });
                deleteBtn.addEventListener('click', () => { void (async () => {
                    if (isGlobal) {
                        await GlobalModeStore.removeMode(slug);
                        await this.modeService?.reloadGlobalModes?.();
                    } else {
                        this.plugin.settings.customModes = this.plugin.settings.customModes.filter(
                            (m) => m.slug !== slug,
                        );
                        await this.plugin.saveSettings();
                    }
                    if (this.plugin.settings.currentMode === slug) {
                        this.plugin.settings.currentMode = 'ask';
                        await this.plugin.saveSettings();
                    }
                    this.rerender();
                })(); });
            }
        };

        // Initial render
        renderForm(selectedSlug);

        // Selector change
        select.addEventListener('change', () => {
            selectedSlug = select.value;
            renderForm(selectedSlug);
        });

        // New Mode
        newBtn.addEventListener('click', () => {
            new NewModeModal(this.app, this.plugin, () => this.rerender(), this.modeService).open();
        });

        // Import
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', () => { void (async () => {
                const file = input.files?.[0];
                if (!file) return;
                const text = await file.text();
                try {
                    // M-1: Validate JSON size and structure before accepting imported mode
                    if (text.length > 500_000) {
                        new Notice(t('settings.modes.fileTooLarge'));
                        return;
                    }
                    let raw: unknown;
                    try {
                        raw = JSON.parse(text);
                    } catch {
                        new Notice(t('settings.modes.invalidJson'));
                        return;
                    }
                    if (!raw || typeof raw !== 'object' ||
                        typeof (raw as Record<string, unknown>).slug !== 'string' ||
                        typeof (raw as Record<string, unknown>).name !== 'string' ||
                        typeof (raw as Record<string, unknown>).roleDefinition !== 'string') {
                        new Notice(t('settings.modes.invalidMode'));
                        return;
                    }
                    const parsed = raw as ModeConfig;
                    parsed.source = 'vault';
                    const allSlugs = [
                        ...BUILT_IN_MODES.map((m) => m.slug),
                        ...this.plugin.settings.customModes.map((m) => m.slug),
                    ];
                    if (allSlugs.includes(parsed.slug)) {
                        parsed.slug = `${parsed.slug}-imported`;
                    }
                    this.plugin.settings.customModes.push(parsed);
                    await this.plugin.saveSettings();
                    this.rerender();
                    new Notice(t('settings.modes.importSuccess', { name: parsed.name }));
                } catch {
                    new Notice(t('settings.modes.parseFailed'));
                }
            })(); });
            input.click();
        });

        // ── Global Custom Instructions ────────────────────────────────────────
        const globalSection = containerEl.createDiv('modes-global-section');
        globalSection.createEl('h3', { text: t('settings.modes.globalCustomInstructions') });
        globalSection.createEl('p', {
            cls: 'modes-field-desc',
            text: t('settings.modes.globalCustomInstructionsDesc'),
        });
        const globalTextarea = globalSection.createEl('textarea', {
            cls: 'modes-textarea',
            attr: { placeholder: t('settings.modes.globalInstructionsPlaceholder') },
        });
        globalTextarea.value = this.plugin.settings.globalCustomInstructions ?? '';
        globalTextarea.rows = 5;
        globalTextarea.addEventListener('input', () => {
            this.plugin.settings.globalCustomInstructions = globalTextarea.value;
            void this.plugin.saveSettings();
        });
    }

    // ---------------------------------------------------------------------------
    // Models tab
    // ---------------------------------------------------------------------------

}
