import { App, Notice, Setting, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { ModeConfig } from '../../types/settings';
import { getModelKey } from '../../types/settings';
import { BUILT_IN_MODES, TOOL_GROUP_MAP } from '../../core/modes/builtinModes';
import { buildSystemPromptForMode } from '../../core/systemPrompt';
import { GlobalModeStore } from '../../core/modes/GlobalModeStore';
import { TOOL_LABEL_MAP, TOOL_GROUP_META } from './constants';
import { ContentEditorModal } from './ContentEditorModal';
import { SystemPromptPreviewModal } from './SystemPromptPreviewModal';
import { NewModeModal } from './NewModeModal';
import { addInfoButton } from './utils';

export class ModesTab {
    constructor(private plugin: ObsidianAgentPlugin, private app: App, private rerender: () => void, private modeService?: any) {}

    build(containerEl: HTMLElement): void {
        // Collect all selectable modes (built-in + custom, not __custom instruction entries).
        // Vault entries with the same slug as a built-in are overrides — they are already
        // represented by the built-in entry in the dropdown, so exclude them here.
        const builtInSlugs = new Set(BUILT_IN_MODES.map((m) => m.slug));
        const getAllModes = (): ModeConfig[] => [
            ...BUILT_IN_MODES,
            ...((this.plugin as any).modeService?.getGlobalModes?.() ?? []),
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
                { label: 'Built-in', modes: BUILT_IN_MODES },
                { label: 'Global (all vaults)', modes: (this.plugin as any).modeService?.getGlobalModes?.() ?? [] },
                { label: 'This Vault', modes: this.plugin.settings.customModes.filter((m) => m.source === 'vault' && !m.slug.endsWith('__custom') && !builtInSlugs.has(m.slug)) },
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
        const newBtn = btnGroup.createEl('button', { text: '+ New', cls: 'mod-cta modes-top-btn' });
        const importBtn = btnGroup.createEl('button', { text: 'Import', cls: 'modes-top-btn' });

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
                ? ((this.plugin as any).modeService?.getGlobalModes?.() ?? []).find(
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
                        ov = { ...builtIn!, source: 'vault' };
                        this.plugin.settings.customModes.push(ov);
                    }
                    return ov;
                }
                if (isGlobal) return globalMode!;
                return vaultCustom!;
            };

            const saveMode = async () => {
                if (isGlobal) {
                    await GlobalModeStore.updateMode(globalMode!);
                    await (this.plugin as any).modeService?.reloadGlobalModes?.();
                } else {
                    await this.plugin.saveSettings();
                }
            };

            // ── Customized badge (built-in modes that have been overridden) ────
            if (isBuiltIn && vaultOverride) {
                const badge = formArea.createDiv('modes-customized-badge');
                setIcon(badge.createSpan('modes-customized-icon'), 'pencil');
                badge.createEl('span', { cls: 'modes-customized-text', text: 'This mode has been customised' });
            }

            // ── Model Selection ───────────────────────────────────────────────
            const modelSetting = new Setting(formArea)
                .setName('Model')
                .setDesc('Which model this mode uses. Falls back to the globally selected model if not set.');
            const models = this.plugin.settings.activeModels;
            const currentModeModelKey = this.plugin.settings.modeModelKeys?.[slug] ?? '';
            modelSetting.addDropdown((dd) => {
                dd.addOption('', '— Use global model —');
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
                .setName('Name')
                .addText((t) => {
                    t.setValue(mode.name);
                    // Name is read-only for built-in modes (slug must remain stable)
                    if (isBuiltIn) {
                        t.inputEl.disabled = true;
                    } else {
                        t.onChange(async (v) => {
                            getOrCreateEditable().name = v;
                            await saveMode();
                            refreshSelect();
                        });
                    }
                });

            // ── Slug (always read-only) ───────────────────────────────────────
            new Setting(formArea)
                .setName('Slug')
                .addText((t) => { t.setValue(mode.slug); t.inputEl.disabled = true; });

            // ── Short description ─────────────────────────────────────────────
            const descWrap = formArea.createDiv('modes-field');
            descWrap.createEl('div', { cls: 'modes-field-label', text: 'Short description (for humans)' });
            descWrap.createEl('div', { cls: 'modes-field-desc', text: 'Brief description shown in the mode selector dropdown.' });
            const descTextarea = descWrap.createEl('textarea', { cls: 'modes-textarea', attr: { placeholder: 'Brief description...' } });
            descTextarea.value = mode.description || '';
            descTextarea.rows = 2;
            descTextarea.addEventListener('input', async () => {
                const editable = getOrCreateEditable();
                editable.description = descTextarea.value;
                await saveMode();
            });

            // ── When to Use ───────────────────────────────────────────────────
            const wtuWrap = formArea.createDiv('modes-field');
            wtuWrap.createEl('div', { cls: 'modes-field-label', text: 'When to Use (optional)' });
            wtuWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: 'Guidance for the Orchestrator when deciding which mode to delegate a subtask to.',
            });
            const wtuTextarea = wtuWrap.createEl('textarea', {
                cls: 'modes-textarea',
                attr: { placeholder: 'Describe when this mode should be chosen...' },
            });
            wtuTextarea.value = mode.whenToUse ?? '';
            wtuTextarea.rows = 3;
            wtuTextarea.addEventListener('input', async () => {
                const editable = getOrCreateEditable();
                editable.whenToUse = wtuTextarea.value;
                await saveMode();
            });

            // ── Available Tools ───────────────────────────────────────────────
            const toolsWrap = formArea.createDiv('modes-field');
            const toolsHeaderRow = toolsWrap.createDiv('modes-tools-header');
            toolsHeaderRow.createEl('div', { cls: 'modes-field-label', text: 'Available Tools' });

            let toolsEditMode = false;
            const toolsBody = toolsWrap.createDiv('modes-tools-body');

            const renderToolsReadOnly = () => {
                toolsBody.empty();
                const enabled = mode.toolGroups.filter((g) => g in TOOL_GROUP_META);
                if (enabled.length === 0) {
                    toolsBody.createEl('span', { cls: 'modes-tools-none', text: 'None' });
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
                    const isGroupEnabled = mode.toolGroups.includes(group as any);

                    // --- Group accordion ---
                    const details = toolsBody.createEl('details', { cls: 'modes-tool-group-accordion' });
                    if (isGroupEnabled) details.open = true;

                    const summary = details.createEl('summary', { cls: 'modes-tool-group-summary' });

                    // Group enable/disable checkbox
                    const groupCb = summary.createEl('input', { type: 'checkbox' });
                    groupCb.checked = isGroupEnabled;
                    groupCb.addEventListener('click', (e) => e.stopPropagation()); // prevent accordion toggle
                    groupCb.addEventListener('change', async () => {
                        const editable = getOrCreateEditable();
                        if (groupCb.checked) {
                            if (!editable.toolGroups.includes(group as any)) editable.toolGroups.push(group as any);
                            details.open = true;
                        } else {
                            editable.toolGroups = editable.toolGroups.filter((g) => g !== group);
                            details.open = false;
                        }
                        (mode as any).toolGroups = [...editable.toolGroups];
                        await saveMode();
                        // Recount active tools badge
                        badgeEl.setText(getCountBadge(group, groupCb.checked));
                    });

                    summary.createEl('span', { cls: 'modes-tool-group-label', text: meta.label });

                    // Active tools count badge
                    const getCountBadge = (grp: string, enabled: boolean): string => {
                        if (!enabled) return '0 / ' + TOOL_GROUP_META[grp].tools.length;
                        const override = this.plugin.settings.modeToolOverrides?.[slug];
                        if (!override) return meta.tools.length + ' / ' + meta.tools.length;
                        const active = meta.tools.filter((t) => override.includes(t)).length;
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

                        toolCb.addEventListener('change', async () => {
                            // Compute new override for this mode
                            const allGroupTools = meta.tools;
                            // Start from current override or all tools in all groups
                            let allActiveTools: string[] = this.plugin.settings.modeToolOverrides?.[slug]
                                ?? (this.plugin as any).modeService?.getToolNames(mode) ?? [];
                            if (toolCb.checked) {
                                if (!allActiveTools.includes(toolName)) allActiveTools = [...allActiveTools, toolName];
                            } else {
                                allActiveTools = allActiveTools.filter((t) => t !== toolName);
                            }
                            await (this.plugin as any).modeService?.setModeToolOverride(slug, allActiveTools);
                            badgeEl.setText(getCountBadge(group, isGroupEnabled));
                        });
                    }
                }
            };

            renderToolsReadOnly();

            // "Edit tools" button — hidden for Ask mode (protected)
            if (slug !== 'ask') {
                const editToolsBtn = toolsHeaderRow.createEl('button', {
                    text: 'Edit tools',
                    cls: 'modes-edit-tools-btn',
                });
                editToolsBtn.addEventListener('click', () => {
                    toolsEditMode = !toolsEditMode;
                    editToolsBtn.setText(toolsEditMode ? 'Done' : 'Edit tools');
                    if (toolsEditMode) renderToolsEdit();
                    else renderToolsReadOnly();
                });
            }

            // ── Forced Skills ────────────────────────────────────────────────
            const skillsMgrForMode = (this.plugin as any).skillsManager;
            if (skillsMgrForMode) {
                const skillsWrap = formArea.createDiv('modes-field');
                skillsWrap.createEl('div', { cls: 'modes-field-label', text: 'Forced Skills' });
                skillsWrap.createEl('div', {
                    cls: 'modes-field-desc',
                    text: 'Skills always injected into the system prompt for this mode, regardless of message keyword matching.',
                });
                const skillsCbList = skillsWrap.createDiv('modes-skills-list');
                skillsCbList.createEl('span', { cls: 'modes-loading-hint', text: 'Loading skills…' });
                (async () => {
                    skillsCbList.empty();
                    try {
                        const allSkills: { path: string; name: string; description: string }[] =
                            await skillsMgrForMode.discoverSkills();
                        if (allSkills.length === 0) {
                            skillsCbList.createEl('span', { cls: 'modes-loading-hint', text: 'No skills found. Create skills in the Skills tab.' });
                        } else {
                            const forcedSet = new Set<string>(this.plugin.settings.forcedSkills?.[slug] ?? []);
                            for (const skill of allSkills) {
                                const row = skillsCbList.createDiv('modes-skills-row');
                                const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                                cb.checked = forcedSet.has(skill.name);
                                const lbl = row.createEl('label', { cls: 'modes-skills-label' });
                                lbl.createSpan({ text: skill.name });
                                if (skill.description) lbl.createSpan({ cls: 'modes-skills-desc', text: skill.description });
                                cb.addEventListener('change', async () => {
                                    if (!this.plugin.settings.forcedSkills) this.plugin.settings.forcedSkills = {};
                                    const cur = new Set<string>(this.plugin.settings.forcedSkills[slug] ?? []);
                                    if (cb.checked) cur.add(skill.name);
                                    else cur.delete(skill.name);
                                    this.plugin.settings.forcedSkills[slug] = [...cur];
                                    await this.plugin.saveSettings();
                                });
                            }
                        }
                    } catch {
                        skillsCbList.createEl('span', { cls: 'modes-loading-hint', text: 'Error loading skills.' });
                    }
                })();
            }

            // ── Allowed MCP Servers ──────────────────────────────────────────
            const mcpServerNames = Object.keys(this.plugin.settings.mcpServers ?? {});
            if (mcpServerNames.length > 0) {
                const mcpWrap = formArea.createDiv('modes-field');
                mcpWrap.createEl('div', { cls: 'modes-field-label', text: 'Allowed MCP Servers' });
                mcpWrap.createEl('div', {
                    cls: 'modes-field-desc',
                    text: 'MCP servers available in this mode. All checked = all servers allowed (default).',
                });
                const mcpCbList = mcpWrap.createDiv('modes-skills-list');
                const modeMcpAllowed = this.plugin.settings.modeMcpServers?.[slug];
                // undefined or empty = all allowed
                const allowedSet = new Set<string>(modeMcpAllowed && modeMcpAllowed.length > 0 ? modeMcpAllowed : mcpServerNames);
                for (const serverName of mcpServerNames) {
                    const row = mcpCbList.createDiv('modes-skills-row');
                    const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                    cb.checked = allowedSet.has(serverName);
                    row.createEl('label', { cls: 'modes-skills-label', text: serverName });
                    cb.addEventListener('change', async () => {
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
                    });
                }
            }

            // ── Role Definition ───────────────────────────────────────────────
            const roleWrap = formArea.createDiv('modes-field');
            roleWrap.createEl('div', { cls: 'modes-field-label', text: 'Role Definition' });
            roleWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: 'Core system prompt defining this agent\'s expertise and personality.',
            });
            const roleTextarea = roleWrap.createEl('textarea', { cls: 'modes-textarea' });
            roleTextarea.value = mode.roleDefinition || '';
            roleTextarea.rows = 8;
            roleTextarea.addEventListener('input', async () => {
                const editable = getOrCreateEditable();
                editable.roleDefinition = roleTextarea.value;
                (mode as any).roleDefinition = editable.roleDefinition;
                await saveMode();
            });

            // ── Mode-specific Custom Instructions ─────────────────────────────
            const ciWrap = formArea.createDiv('modes-field');
            ciWrap.createEl('div', { cls: 'modes-field-label', text: 'Mode-specific Custom Instructions (optional)' });
            ciWrap.createEl('div', {
                cls: 'modes-field-desc',
                text: `Behavioral guidelines appended after the role definition for ${mode.name} mode.`,
            });
            const ciTextarea = ciWrap.createEl('textarea', {
                cls: 'modes-textarea',
                attr: { placeholder: `Add behavioral guidelines specific to ${mode.name} mode...` },
            });
            // Read from override (preferred) or legacy __custom entry
            const legacyCi = this.plugin.settings.customModes.find((m) => m.slug === `${slug}__custom`);
            ciTextarea.value = isBuiltIn
                ? (vaultOverride?.customInstructions ?? legacyCi?.customInstructions ?? '')
                : (mode.customInstructions ?? '');
            ciTextarea.rows = 4;
            ciTextarea.addEventListener('input', async () => {
                const value = ciTextarea.value.trim();
                const editable = getOrCreateEditable();
                editable.customInstructions = value || undefined;
                if (isBuiltIn) {
                    // Migrate away from legacy __custom entry
                    const legacyIdx = this.plugin.settings.customModes.findIndex((m) => m.slug === `${slug}__custom`);
                    if (legacyIdx >= 0) this.plugin.settings.customModes.splice(legacyIdx, 1);
                }
                await saveMode();
            });

            // ── Bottom action bar ─────────────────────────────────────────────
            const bottomBar = formArea.createDiv('modes-bottom-bar');

            const isActive = this.plugin.settings.currentMode === slug;
            if (isActive) {
                bottomBar.createEl('span', { cls: 'modes-active-badge', text: '✓ Active mode' });
            } else {
                const setBtn = bottomBar.createEl('button', { text: 'Set Active', cls: 'mod-cta' });
                setBtn.addEventListener('click', async () => {
                    this.plugin.settings.currentMode = slug;
                    await this.plugin.saveSettings();
                    this.rerender();
                });
            }

            // Preview System Prompt
            const previewBtn = bottomBar.createEl('button', { text: 'Preview Prompt', cls: 'modes-preview-btn' });
            previewBtn.addEventListener('click', () => {
                const allModes = [
                    ...BUILT_IN_MODES,
                    ...((this.plugin as any).modeService?.getGlobalModes?.() ?? []),
                    ...this.plugin.settings.customModes.filter((m) => m.source === 'vault' && !m.slug.endsWith('__custom')),
                ];
                const prompt = buildSystemPromptForMode(
                    mode,
                    allModes,
                    this.plugin.settings.globalCustomInstructions || undefined,
                );
                new SystemPromptPreviewModal(this.app, mode.name, prompt).open();
            });

            // Export
            const exportBtn = bottomBar.createEl('button', { text: 'Export', cls: 'modes-export-btn' });
            exportBtn.addEventListener('click', () => {
                const exportData: Partial<ModeConfig> = { ...mode };
                delete (exportData as any).source;
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
                    text: 'Restore defaults',
                    cls: 'modes-restore-btn',
                });
                if (!hasOverride) restoreBtn.disabled = true;
                restoreBtn.addEventListener('click', async () => {
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
                    new Notice(`${mode.name} restored to defaults`);
                    renderForm(slug);
                });
            }

            // Delete (non-built-in modes only)
            if (!isBuiltIn) {
                const deleteBtn = bottomBar.createEl('button', {
                    text: 'Delete',
                    cls: 'mod-warning modes-delete-btn',
                });
                deleteBtn.addEventListener('click', async () => {
                    if (isGlobal) {
                        await GlobalModeStore.removeMode(slug);
                        await (this.plugin as any).modeService?.reloadGlobalModes?.();
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
                });
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
            new NewModeModal(this.app, this.plugin, () => this.rerender(), (this.plugin as any).modeService).open();
        });

        // Import
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                const text = await file.text();
                try {
                    // M-1: Validate JSON size and structure before accepting imported mode
                    if (text.length > 500_000) {
                        new Notice('Mode file too large (max 500 KB)');
                        return;
                    }
                    let parsed: any;
                    try {
                        parsed = JSON.parse(text);
                    } catch {
                        new Notice('Invalid mode file: not valid JSON');
                        return;
                    }
                    if (!parsed || typeof parsed !== 'object' ||
                        typeof parsed.slug !== 'string' ||
                        typeof parsed.name !== 'string' ||
                        typeof parsed.roleDefinition !== 'string') {
                        new Notice('Invalid mode file: missing slug, name, or roleDefinition');
                        return;
                    }
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
                    new Notice(`Mode "${parsed.name}" imported`);
                } catch {
                    new Notice('Failed to parse mode file');
                }
            });
            input.click();
        });

        // ── Global Custom Instructions ────────────────────────────────────────
        const globalSection = containerEl.createDiv('modes-global-section');
        globalSection.createEl('h3', { text: 'Custom Instructions for All Modes' });
        globalSection.createEl('p', {
            cls: 'modes-field-desc',
            text: 'These instructions are appended to the system prompt for every mode. Use them to set global behavior, language preferences, or formatting rules that apply across all agents.',
        });
        const globalTextarea = globalSection.createEl('textarea', {
            cls: 'modes-textarea',
            attr: { placeholder: 'e.g. Always respond in German. Never use bullet points with more than 5 items.' },
        });
        globalTextarea.value = this.plugin.settings.globalCustomInstructions ?? '';
        globalTextarea.rows = 5;
        globalTextarea.addEventListener('input', async () => {
            this.plugin.settings.globalCustomInstructions = globalTextarea.value;
            await this.plugin.saveSettings();
        });
    }

    // ---------------------------------------------------------------------------
    // Models tab
    // ---------------------------------------------------------------------------

}
