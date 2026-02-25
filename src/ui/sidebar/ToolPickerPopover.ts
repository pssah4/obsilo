import { setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { ModeService } from '../../core/modes/ModeService';
import { TOOL_METADATA, GROUP_META, getToolsForGroup } from '../../core/tools/toolMetadata';
import { t } from '../../i18n';

/**
 * ToolPickerPopover — manages the "pocket-knife" tool/skill/workflow picker.
 *
 * All changes are immediately persisted to settings (no session-only state).
 * Web tools are excluded — they are managed by a dedicated toggle in the toolbar.
 */
export class ToolPickerPopover {
    private popoverEl: HTMLElement | null = null;
    private closeHandler: ((e: MouseEvent) => void) | null = null;
    private resizeHandler: (() => void) | null = null;

    constructor(
        private plugin: ObsidianAgentPlugin,
        private modeService: ModeService,
    ) {}

    show(event: MouseEvent, anchorBtn: HTMLElement, containerEl: HTMLElement): void {
        this.close();

        const slug = this.plugin.settings.currentMode;
        const mode = this.modeService.getMode(slug);
        if (!mode) return;

        const popover = document.createElement('div');
        popover.className = 'tool-picker-popover';
        this.popoverEl = popover;

        // ── Header ───────────────────────────────────────────────────────────
        const headerEl = popover.createDiv('tool-picker-header');
        headerEl.createSpan({ cls: 'tool-picker-title', text: t('ui.toolPicker.title') });
        const countBadge = headerEl.createSpan('tool-picker-count');

        // ── Search ───────────────────────────────────────────────────────────
        const searchInput = popover.createEl('input', {
            cls: 'tool-picker-search',
            attr: { placeholder: t('ui.toolPicker.filter'), type: 'text', spellcheck: 'false' },
        }) as HTMLInputElement;

        // ── Scroll container ─────────────────────────────────────────────────
        const scrollEl = popover.createDiv('tool-picker-scroll');

        // ── Data from central tool metadata (single source of truth) ────────
        const GROUP_TOOLS: Record<string, string[]> = {};
        for (const [group] of Object.entries(GROUP_META)) {
            GROUP_TOOLS[group] = getToolsForGroup(group as any).map(([name]) => name);
        }

        // Excluded groups: 'web' (dedicated toggle), 'mcp' (own section)
        const EXCLUDED_GROUPS = new Set(['web', 'mcp']);

        // Current effective tools (settings → defaults)
        const effectiveTools = new Set(
            this.plugin.settings.modeToolOverrides?.[slug]
            ?? this.modeService.getEffectiveToolNames(mode)
        );
        const toolChecks = new Map<string, HTMLInputElement>();
        const allItemRows: HTMLElement[] = [];   // for search filtering

        // ── Helpers ──────────────────────────────────────────────────────────

        const applyToolOverride = async () => {
            const allGroupTools = mode.toolGroups
                .filter((g) => !EXCLUDED_GROUPS.has(g))
                .flatMap((g) => GROUP_TOOLS[g] ?? []);
            const selected = allGroupTools.filter((t) => toolChecks.get(t)?.checked ?? false);
            await this.modeService.setModeToolOverride(slug, selected);
        };

        const updateCount = () => {
            let n = 0;
            for (const cb of toolChecks.values()) { if (cb.checked) n++; }
            countBadge.setText(t('ui.toolPicker.selected', { count: n }));
        };

        // Create a top-level expandable category row
        const makeTopCat = (label: string, startOpen = true): { catRow: HTMLElement; catBody: HTMLElement } => {
            const catRow = scrollEl.createDiv('tp-cat-row');
            if (startOpen) catRow.addClass('is-open');
            catRow.createSpan('tp-cat-arrow').setText('▸');
            catRow.createSpan({ cls: 'tp-cat-label', text: label });
            const catBody = scrollEl.createDiv('tp-cat-body');
            catBody.style.display = startOpen ? '' : 'none';
            catRow.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).tagName === 'INPUT') return;
                const open = catRow.classList.toggle('is-open');
                catBody.style.display = open ? '' : 'none';
            });
            return { catRow, catBody };
        };

        // Create a sub-category row inside Built-In
        const makeSubCat = (
            parent: HTMLElement, label: string, iconName: string,
        ): { subRow: HTMLElement; subBody: HTMLElement; subGroupCb: HTMLInputElement } => {
            const subRow = parent.createDiv('tp-subcat-row');
            subRow.createSpan('tp-subcat-arrow').setText('▸');
            const subIconEl = subRow.createSpan('tp-subcat-icon');
            setIcon(subIconEl, iconName);
            subRow.createSpan({ cls: 'tp-subcat-label', text: label });
            const subGroupCb = subRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            subGroupCb.className = 'tp-cat-group-cb';
            const subBody = parent.createDiv('tp-subcat-body');
            subBody.style.display = 'none';
            subRow.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).tagName === 'INPUT') return;
                const open = subRow.classList.toggle('is-open');
                subBody.style.display = open ? '' : 'none';
            });
            return { subRow, subBody, subGroupCb };
        };

        // Create an item row with checkbox, name, description
        const makeItemRow = (
            parent: HTMLElement, label: string, desc: string, _iconName: string,
            checked: boolean, indentCls = 'tp-item-row',
        ): HTMLInputElement => {
            const row = parent.createDiv(indentCls);
            row.setAttribute('data-label', label.toLowerCase());
            row.setAttribute('data-desc', desc.toLowerCase());
            allItemRows.push(row);
            const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            cb.checked = checked;
            row.createSpan({ cls: 'tp-item-name', text: label });
            if (desc) row.createSpan({ cls: 'tp-item-desc', text: desc });
            return cb;
        };

        // ── Built-In section ─────────────────────────────────────────────────
        const { catRow: builtInCatRow, catBody: builtInCatBody } = makeTopCat(t('ui.toolPicker.builtIn'));
        const builtInGroupCb = builtInCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        builtInGroupCb.className = 'tp-cat-group-cb';
        const allBuiltInTools = mode.toolGroups
            .filter((g) => !EXCLUDED_GROUPS.has(g))
            .flatMap((g) => GROUP_TOOLS[g] ?? []);
        const biAllEnabled = allBuiltInTools.every((t) => effectiveTools.has(t));
        const biSomeEnabled = allBuiltInTools.some((t) => effectiveTools.has(t));
        builtInGroupCb.checked = biAllEnabled;
        builtInGroupCb.indeterminate = !biAllEnabled && biSomeEnabled;

        for (const group of mode.toolGroups) {
            if (EXCLUDED_GROUPS.has(group)) continue;
            const tools = (GROUP_TOOLS[group] ?? []).filter((t) => {
                const modeTools = mode.toolGroups
                    .filter((g) => !EXCLUDED_GROUPS.has(g))
                    .flatMap((g) => GROUP_TOOLS[g] ?? []);
                return modeTools.includes(t);
            });
            if (tools.length === 0) continue;

            const { subRow, subBody, subGroupCb } = makeSubCat(
                builtInCatBody,
                GROUP_META[group]?.label ?? group,
                GROUP_META[group]?.icon ?? 'tool',
            );
            const grpAllEnabled = tools.every((t) => effectiveTools.has(t));
            const grpSomeEnabled = tools.some((t) => effectiveTools.has(t));
            subGroupCb.checked = grpAllEnabled;
            subGroupCb.indeterminate = !grpAllEnabled && grpSomeEnabled;

            for (const toolName of tools) {
                const meta = TOOL_METADATA[toolName];
                const cb = makeItemRow(
                    subBody,
                    meta?.label ?? toolName,
                    meta?.description ?? '',
                    meta?.icon ?? 'tool',
                    effectiveTools.has(toolName),
                );
                toolChecks.set(toolName, cb);
                cb.addEventListener('change', () => {
                    const allInGrp = tools.every((t) => toolChecks.get(t)?.checked);
                    const someInGrp = tools.some((t) => toolChecks.get(t)?.checked);
                    subGroupCb.checked = !!allInGrp;
                    subGroupCb.indeterminate = !allInGrp && !!someInGrp;
                    const allBI = allBuiltInTools.every((t) => toolChecks.get(t)?.checked);
                    const someBI = allBuiltInTools.some((t) => toolChecks.get(t)?.checked);
                    builtInGroupCb.checked = !!allBI;
                    builtInGroupCb.indeterminate = !allBI && !!someBI;
                    applyToolOverride();
                    updateCount();
                });
            }
            subGroupCb.addEventListener('change', () => {
                for (const t of tools) { const cb = toolChecks.get(t); if (cb) cb.checked = subGroupCb.checked; }
                subGroupCb.indeterminate = false;
                applyToolOverride();
                updateCount();
            });
        }
        builtInGroupCb.addEventListener('change', () => {
            for (const t of allBuiltInTools) { const cb = toolChecks.get(t); if (cb) cb.checked = builtInGroupCb.checked; }
            builtInGroupCb.indeterminate = false;
            applyToolOverride();
            updateCount();
        });

        // ── MCP Servers section ───────────────────────────────────────────────
        if (mode.toolGroups.includes('mcp')) {
            const servers = Object.keys(this.plugin.settings.mcpServers ?? {});
            const { catRow: mcpCatRow, catBody: mcpCatBody } = makeTopCat(t('ui.toolPicker.mcpServers'), servers.length > 0);
            const mcpGroupCb = mcpCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            mcpGroupCb.className = 'tp-cat-group-cb';
            const mcpChecks: HTMLInputElement[] = [];

            if (servers.length > 0) {
                const activeMcpServers: string[] = this.plugin.settings.activeMcpServers ?? [];
                for (const serverName of servers) {
                    const cb = makeItemRow(
                        mcpCatBody, serverName, t('ui.toolPicker.mcpServer'), 'plug-2',
                        activeMcpServers.length === 0 || activeMcpServers.includes(serverName),
                        'tp-item-row tp-item-indent-cat',
                    );
                    mcpChecks.push(cb);
                    cb.addEventListener('change', async () => {
                        const cur: string[] = this.plugin.settings.activeMcpServers ?? [];
                        if (cur.length === 0) {
                            const all = Object.keys(this.plugin.settings.mcpServers ?? {});
                            this.plugin.settings.activeMcpServers = all.filter((s) => s !== serverName);
                        } else if (cb.checked) {
                            this.plugin.settings.activeMcpServers = [...cur, serverName];
                        } else {
                            this.plugin.settings.activeMcpServers = cur.filter((s) => s !== serverName);
                        }
                        await this.plugin.saveSettings();
                        const allCb = mcpChecks.every((c) => c.checked);
                        const someCb = mcpChecks.some((c) => c.checked);
                        mcpGroupCb.checked = allCb;
                        mcpGroupCb.indeterminate = !allCb && someCb;
                    });
                }
                const allMcp = mcpChecks.every((c) => c.checked);
                const someMcp = mcpChecks.some((c) => c.checked);
                mcpGroupCb.checked = allMcp;
                mcpGroupCb.indeterminate = !allMcp && someMcp;
            } else {
                mcpCatBody.createEl('span', { cls: 'tp-empty-hint', text: t('ui.toolPicker.noMcpServers') });
                mcpGroupCb.checked = false;
                mcpGroupCb.disabled = true;
            }
            mcpGroupCb.addEventListener('change', async () => {
                for (const cb of mcpChecks) cb.checked = mcpGroupCb.checked;
                mcpGroupCb.indeterminate = false;
                this.plugin.settings.activeMcpServers = mcpGroupCb.checked ? [] : [];
                await this.plugin.saveSettings();
            });
        }

        // ── Skills section (async) ────────────────────────────────────────────
        const { catRow: skillsCatRow, catBody: skillsCatBody } = makeTopCat(t('ui.toolPicker.skills'), false);
        const skillsGroupCb = skillsCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        skillsGroupCb.className = 'tp-cat-group-cb';
        skillsCatBody.createEl('span', { cls: 'tp-empty-hint', text: t('ui.toolPicker.loading') });

        // ── Workflows section (async) ─────────────────────────────────────────
        const { catRow: wfCatRow, catBody: wfCatBody } = makeTopCat(t('ui.toolPicker.workflows'), false);
        const wfGroupCb = wfCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        wfGroupCb.className = 'tp-cat-group-cb';
        wfCatBody.createEl('span', { cls: 'tp-empty-hint', text: t('ui.toolPicker.loading') });

        // ── Position (clamped to container bounds) ──────────────────────────
        const positionPopover = () => {
            const br = anchorBtn.getBoundingClientRect();
            const cr = containerEl.getBoundingClientRect();
            const pad = 8;
            popover.style.position = 'fixed';

            // Constrain width to container
            const popWidth = Math.min(400, cr.width - pad * 2);
            popover.style.width = `${popWidth}px`;
            popover.style.minWidth = `${Math.min(320, popWidth)}px`;
            popover.style.maxWidth = `${popWidth}px`;

            // Prefer opening upward; fall back to downward
            const spaceAbove = br.top - cr.top - pad;
            const spaceBelow = cr.bottom - br.bottom - pad;

            if (spaceAbove >= spaceBelow) {
                popover.style.bottom = (window.innerHeight - br.top + 4) + 'px';
                popover.style.top = '';
                popover.style.maxHeight = `${Math.max(spaceAbove, 200)}px`;
            } else {
                popover.style.top = (br.bottom + 4) + 'px';
                popover.style.bottom = '';
                popover.style.maxHeight = `${Math.max(spaceBelow, 200)}px`;
            }

            // Horizontal: keep inside container
            let left = Math.max(br.left, cr.left + pad);
            if (left + popWidth > cr.right - pad) left = cr.right - pad - popWidth;
            left = Math.max(left, cr.left + pad);
            popover.style.left = `${left}px`;
        };
        document.body.appendChild(popover);
        positionPopover();

        // Re-position on window resize so the popover tracks its anchor
        this.resizeHandler = positionPopover;
        window.addEventListener('resize', this.resizeHandler);

        updateCount();

        // ── Search filter ─────────────────────────────────────────────────────
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.toLowerCase();
            for (const row of allItemRows) {
                const matches = !q
                    || (row.getAttribute('data-label') ?? '').includes(q)
                    || (row.getAttribute('data-desc') ?? '').includes(q);
                row.style.display = matches ? '' : 'none';
            }
            if (q) {
                builtInCatRow.addClass('is-open');
                builtInCatBody.style.display = '';
            }
        });

        // ── Async: skills + workflows ─────────────────────────────────────────
        (async () => {
            const skillsManager = (this.plugin as any).skillsManager;
            if (skillsManager) {
                skillsCatBody.empty();
                try {
                    const skills = await skillsManager.discoverSkills();
                    if (skills.length === 0) {
                        skillsCatBody.createEl('span', { cls: 'tp-empty-hint', text: t('ui.toolPicker.noSkills') });
                        skillsGroupCb.disabled = true;
                    } else {
                        const skillCbs: HTMLInputElement[] = [];
                        const modeAllowed = this.plugin.settings.modeSkillAllowList?.[slug];
                        // empty/undefined = all allowed
                        const allowedSet = new Set<string>(
                            modeAllowed && modeAllowed.length > 0 ? modeAllowed : skills.map((s: any) => s.name),
                        );
                        skillsCatRow.addClass('is-open');
                        skillsCatBody.style.display = '';
                        for (const skill of skills) {
                            const cb = makeItemRow(
                                skillsCatBody, skill.name, skill.description ?? '', 'wand-2',
                                allowedSet.has(skill.name), 'tp-item-row tp-item-indent-cat',
                            );
                            skillCbs.push(cb);
                            cb.addEventListener('change', async () => {
                                if (!this.plugin.settings.modeSkillAllowList) this.plugin.settings.modeSkillAllowList = {};
                                const cur = new Set<string>(
                                    this.plugin.settings.modeSkillAllowList[slug]?.length
                                        ? this.plugin.settings.modeSkillAllowList[slug]
                                        : skills.map((s: any) => s.name),
                                );
                                if (cb.checked) cur.add(skill.name);
                                else cur.delete(skill.name);
                                const next = [...cur];
                                this.plugin.settings.modeSkillAllowList[slug] =
                                    next.length === skills.length ? [] : next;
                                await this.plugin.saveSettings();
                                const allSk = skillCbs.every((c) => c.checked);
                                const someSk = skillCbs.some((c) => c.checked);
                                skillsGroupCb.checked = allSk;
                                skillsGroupCb.indeterminate = !allSk && someSk;
                                updateCount();
                            });
                        }
                        const allSk = skillCbs.every((c) => c.checked);
                        const someSk = skillCbs.some((c) => c.checked);
                        skillsGroupCb.checked = allSk;
                        skillsGroupCb.indeterminate = !allSk && someSk;
                        skillsGroupCb.addEventListener('change', async () => {
                            for (const c of skillCbs) c.checked = skillsGroupCb.checked;
                            skillsGroupCb.indeterminate = false;
                            if (!this.plugin.settings.modeSkillAllowList) this.plugin.settings.modeSkillAllowList = {};
                            // all checked → [] (no restriction); none checked → [] (same, no restriction)
                            const next = skillsGroupCb.checked ? skills.map((s: any) => s.name) : [];
                            this.plugin.settings.modeSkillAllowList[slug] =
                                next.length === skills.length ? [] : next;
                            await this.plugin.saveSettings();
                            updateCount();
                        });
                    }
                } catch {
                    skillsCatBody.createEl('span', { cls: 'tp-empty-hint', text: t('ui.toolPicker.errorSkills') });
                }
            } else {
                skillsCatRow.remove();
                skillsCatBody.remove();
            }

            const workflowLoader = (this.plugin as any).workflowLoader;
            if (workflowLoader) {
                wfCatBody.empty();
                try {
                    const workflows = await workflowLoader.discoverWorkflows();
                    if (workflows.length === 0) {
                        wfCatBody.createEl('span', { cls: 'tp-empty-hint', text: t('ui.toolPicker.noWorkflows') });
                        wfGroupCb.disabled = true;
                    } else {
                        const wfCbs: HTMLInputElement[] = [];
                        const activeWfSlug = this.plugin.settings.forcedWorkflow?.[slug] ?? '';
                        wfCatRow.addClass('is-open');
                        wfCatBody.style.display = '';
                        for (const wf of workflows) {
                            const cb = makeItemRow(
                                wfCatBody, wf.displayName, `/${wf.slug}`, 'git-branch',
                                activeWfSlug === wf.slug, 'tp-item-row tp-item-indent-cat',
                            );
                            wfCbs.push(cb);
                            cb.addEventListener('change', async () => {
                                if (!this.plugin.settings.forcedWorkflow) this.plugin.settings.forcedWorkflow = {};
                                if (cb.checked) {
                                    for (const other of wfCbs) { if (other !== cb) other.checked = false; }
                                    this.plugin.settings.forcedWorkflow[slug] = wf.slug;
                                } else {
                                    this.plugin.settings.forcedWorkflow[slug] = '';
                                }
                                await this.plugin.saveSettings();
                                wfGroupCb.checked = wfCbs.some((c) => c.checked);
                                wfGroupCb.indeterminate = false;
                                updateCount();
                            });
                        }
                        wfGroupCb.checked = wfCbs.some((c) => c.checked);
                        wfGroupCb.addEventListener('change', async () => {
                            if (!wfGroupCb.checked) {
                                for (const c of wfCbs) c.checked = false;
                                if (!this.plugin.settings.forcedWorkflow) this.plugin.settings.forcedWorkflow = {};
                                this.plugin.settings.forcedWorkflow[slug] = '';
                                await this.plugin.saveSettings();
                            }
                            updateCount();
                        });
                    }
                } catch {
                    wfCatBody.createEl('span', { cls: 'tp-empty-hint', text: t('ui.toolPicker.errorWorkflows') });
                }
            } else {
                wfCatRow.remove();
                wfCatBody.remove();
            }
        })();

        // Close on outside click
        this.closeHandler = (e: MouseEvent) => {
            if (!this.popoverEl?.contains(e.target as Node) && e.target !== anchorBtn) {
                this.close();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', this.closeHandler!), 50);
    }

    close(): void {
        if (this.closeHandler) {
            document.removeEventListener('mousedown', this.closeHandler);
            this.closeHandler = null;
        }
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        this.popoverEl?.remove();
        this.popoverEl = null;
    }

    isOpen(): boolean {
        return this.popoverEl !== null;
    }
}
