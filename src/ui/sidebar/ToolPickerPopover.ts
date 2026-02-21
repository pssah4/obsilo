import { setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import type { ModeService } from '../../core/modes/ModeService';
import { TOOL_METADATA, GROUP_META, getToolsForGroup } from '../../core/tools/toolMetadata';

/**
 * ToolPickerPopover — manages the "pocket-knife" tool/skill/workflow picker.
 *
 * Extracted from AgentSidebarView to reduce file size.
 * Owns the three session-override Maps that are also read by handleSendMessage().
 */
export class ToolPickerPopover {
    /** Session-only tool overrides: mode slug → enabled tool names (RAM only) */
    readonly sessionToolOverrides = new Map<string, string[]>();
    /** Session-only forced skill names: mode slug → skill names to force-include */
    readonly sessionForcedSkills = new Map<string, string[]>();
    /** Session-only forced workflow: mode slug → workflow slug ('' = none) */
    readonly sessionForcedWorkflow = new Map<string, string>();

    private popoverEl: HTMLElement | null = null;
    private closeHandler: ((e: MouseEvent) => void) | null = null;

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
        headerEl.createSpan({ cls: 'tool-picker-title', text: 'Configure tools' });
        const countBadge = headerEl.createSpan('tool-picker-count');

        // ── Search ───────────────────────────────────────────────────────────
        const searchInput = popover.createEl('input', {
            cls: 'tool-picker-search',
            attr: { placeholder: 'Filter tools…', type: 'text', spellcheck: 'false' },
        }) as HTMLInputElement;

        // ── Scroll container ─────────────────────────────────────────────────
        const scrollEl = popover.createDiv('tool-picker-scroll');

        // ── Data from central tool metadata (single source of truth) ────────
        const GROUP_TOOLS: Record<string, string[]> = {};
        for (const [group] of Object.entries(GROUP_META)) {
            GROUP_TOOLS[group] = getToolsForGroup(group as any).map(([name]) => name);
        }
        const GROUP_LABELS: Record<string, string> = {};
        const GROUP_ICONS: Record<string, string> = {};
        for (const [group, meta] of Object.entries(GROUP_META)) {
            GROUP_LABELS[group] = meta.label;
            GROUP_ICONS[group] = meta.icon;
        }
        const TOOL_LABELS: Record<string, string> = {};
        const TOOL_ICONS: Record<string, string> = {};
        const TOOL_DESCS: Record<string, string> = {};
        for (const [name, meta] of Object.entries(TOOL_METADATA)) {
            TOOL_LABELS[name] = meta.label;
            TOOL_ICONS[name] = meta.icon;
            TOOL_DESCS[name] = meta.description;
        }

        // Current effective tools (session → settings → defaults)
        const effectiveTools = new Set(
            this.sessionToolOverrides.get(slug)
            ?? this.plugin.settings.modeToolOverrides?.[slug]
            ?? this.modeService.getEffectiveToolNames(mode)
        );
        const toolChecks = new Map<string, HTMLInputElement>();
        const allItemRows: HTMLElement[] = [];   // for search filtering

        // ── Helpers ──────────────────────────────────────────────────────────

        const applyToolOverride = () => {
            const allGroupTools = mode.toolGroups.flatMap((g) => GROUP_TOOLS[g] ?? []);
            const selected = allGroupTools.filter((t) => toolChecks.get(t)?.checked ?? false);
            this.sessionToolOverrides.set(slug, selected);
        };

        const updateCount = () => {
            let n = 0;
            for (const cb of toolChecks.values()) { if (cb.checked) n++; }
            countBadge.setText(`${n} selected`);
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
        const { catRow: builtInCatRow, catBody: builtInCatBody } = makeTopCat('Built-In');
        const builtInGroupCb = builtInCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        builtInGroupCb.className = 'tp-cat-group-cb';
        const allBuiltInTools = mode.toolGroups.filter((g) => g !== 'mcp').flatMap((g) => GROUP_TOOLS[g] ?? []);
        const biAllEnabled = allBuiltInTools.every((t) => effectiveTools.has(t));
        const biSomeEnabled = allBuiltInTools.some((t) => effectiveTools.has(t));
        builtInGroupCb.checked = biAllEnabled;
        builtInGroupCb.indeterminate = !biAllEnabled && biSomeEnabled;

        for (const group of mode.toolGroups) {
            if (group === 'mcp') continue;
            const tools = (GROUP_TOOLS[group] ?? []).filter((t) => {
                const modeTools = mode.toolGroups.flatMap((g) => GROUP_TOOLS[g] ?? []);
                return modeTools.includes(t);
            });
            if (tools.length === 0) continue;

            const { subRow, subBody, subGroupCb } = makeSubCat(
                builtInCatBody, GROUP_LABELS[group] ?? group, GROUP_ICONS[group] ?? 'tool',
            );
            const grpAllEnabled = tools.every((t) => effectiveTools.has(t));
            const grpSomeEnabled = tools.some((t) => effectiveTools.has(t));
            subGroupCb.checked = grpAllEnabled;
            subGroupCb.indeterminate = !grpAllEnabled && grpSomeEnabled;

            for (const toolName of tools) {
                const cb = makeItemRow(
                    subBody,
                    TOOL_LABELS[toolName] ?? toolName,
                    TOOL_DESCS[toolName] ?? '',
                    TOOL_ICONS[toolName] ?? 'tool',
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
            const { catRow: mcpCatRow, catBody: mcpCatBody } = makeTopCat('MCP Servers', servers.length > 0);
            const mcpGroupCb = mcpCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            mcpGroupCb.className = 'tp-cat-group-cb';
            const mcpChecks: HTMLInputElement[] = [];

            if (servers.length > 0) {
                const activeMcpServers: string[] = this.plugin.settings.activeMcpServers ?? [];
                for (const serverName of servers) {
                    const cb = makeItemRow(
                        mcpCatBody, serverName, 'MCP server', 'plug-2',
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
                mcpCatBody.createEl('span', { cls: 'tp-empty-hint', text: 'No MCP servers configured.' });
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
        const { catRow: skillsCatRow, catBody: skillsCatBody } = makeTopCat('Skills', false);
        const skillsGroupCb = skillsCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        skillsGroupCb.className = 'tp-cat-group-cb';
        skillsCatBody.createEl('span', { cls: 'tp-empty-hint', text: 'Loading…' });

        // ── Workflows section (async) ─────────────────────────────────────────
        const { catRow: wfCatRow, catBody: wfCatBody } = makeTopCat('Workflows', false);
        const wfGroupCb = wfCatRow.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        wfGroupCb.className = 'tp-cat-group-cb';
        wfCatBody.createEl('span', { cls: 'tp-empty-hint', text: 'Loading…' });

        // ── Footer ───────────────────────────────────────────────────────────
        const footerEl = popover.createDiv('tool-picker-footer');
        const saveBtn = footerEl.createEl('button', { cls: 'tool-picker-save-btn' });
        const saveBtnIcon = saveBtn.createSpan('tp-save-icon');
        setIcon(saveBtnIcon, 'save');
        const saveBtnText = saveBtn.createSpan({ text: 'Save to Settings' });
        saveBtn.addEventListener('click', async () => {
            const sessionTools = this.sessionToolOverrides.get(slug);
            if (sessionTools) await this.modeService.setModeToolOverride(slug, sessionTools);
            const sessionSkills = this.sessionForcedSkills.get(slug);
            if (sessionSkills !== undefined) {
                if (!this.plugin.settings.forcedSkills) this.plugin.settings.forcedSkills = {};
                this.plugin.settings.forcedSkills[slug] = sessionSkills;
            }
            const sessionWorkflow = this.sessionForcedWorkflow.get(slug);
            if (sessionWorkflow !== undefined) {
                if (!this.plugin.settings.forcedWorkflow) this.plugin.settings.forcedWorkflow = {};
                this.plugin.settings.forcedWorkflow[slug] = sessionWorkflow;
            }
            await this.plugin.saveSettings();
            saveBtnText.setText('Saved');
            setTimeout(() => saveBtnText.setText('Save to Settings'), 1500);
        });

        // ── Position (upward) ─────────────────────────────────────────────────
        const btnRect = anchorBtn.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        popover.style.position = 'fixed';
        popover.style.bottom = (window.innerHeight - btnRect.top + 4) + 'px';
        popover.style.left = Math.max(btnRect.left, containerRect.left) + 'px';
        document.body.appendChild(popover);

        // Clamp to viewport so the popover is never cut off
        requestAnimationFrame(() => {
            const r = popover.getBoundingClientRect();
            const pad = 8;
            if (r.right > window.innerWidth) popover.style.left = `${window.innerWidth - r.width - pad}px`;
            if (r.left < 0) popover.style.left = `${pad}px`;
            if (r.top < 0) { popover.style.top = `${pad}px`; popover.style.bottom = ''; }
            if (r.bottom > window.innerHeight) { popover.style.bottom = `${pad}px`; popover.style.top = ''; }
        });

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
                        skillsCatBody.createEl('span', { cls: 'tp-empty-hint', text: 'No skills found.' });
                        skillsGroupCb.disabled = true;
                    } else {
                        const skillCbs: HTMLInputElement[] = [];
                        const activeForcedSkills = new Set(
                            this.sessionForcedSkills.get(slug) ?? this.plugin.settings.forcedSkills?.[slug] ?? []
                        );
                        skillsCatRow.addClass('is-open');
                        skillsCatBody.style.display = '';
                        for (const skill of skills) {
                            const cb = makeItemRow(
                                skillsCatBody, skill.name, skill.description ?? '', 'wand-2',
                                activeForcedSkills.has(skill.name), 'tp-item-row tp-item-indent-cat',
                            );
                            skillCbs.push(cb);
                            cb.addEventListener('change', () => {
                                const cur = new Set(this.sessionForcedSkills.get(slug) ?? this.plugin.settings.forcedSkills?.[slug] ?? []);
                                if (cb.checked) cur.add(skill.name);
                                else cur.delete(skill.name);
                                this.sessionForcedSkills.set(slug, [...cur]);
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
                        skillsGroupCb.addEventListener('change', () => {
                            for (const c of skillCbs) c.checked = skillsGroupCb.checked;
                            skillsGroupCb.indeterminate = false;
                            const next = skillsGroupCb.checked ? skills.map((s: any) => s.name) : [];
                            this.sessionForcedSkills.set(slug, next);
                            updateCount();
                        });
                    }
                } catch {
                    skillsCatBody.createEl('span', { cls: 'tp-empty-hint', text: 'Error loading skills.' });
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
                        wfCatBody.createEl('span', { cls: 'tp-empty-hint', text: 'No workflows found.' });
                        wfGroupCb.disabled = true;
                    } else {
                        const wfCbs: HTMLInputElement[] = [];
                        const activeWfSlug = this.sessionForcedWorkflow.get(slug) ?? this.plugin.settings.forcedWorkflow?.[slug] ?? '';
                        wfCatRow.addClass('is-open');
                        wfCatBody.style.display = '';
                        for (const wf of workflows) {
                            const cb = makeItemRow(
                                wfCatBody, wf.displayName, `/${wf.slug}`, 'git-branch',
                                activeWfSlug === wf.slug, 'tp-item-row tp-item-indent-cat',
                            );
                            wfCbs.push(cb);
                            cb.addEventListener('change', () => {
                                if (cb.checked) {
                                    for (const other of wfCbs) { if (other !== cb) other.checked = false; }
                                    this.sessionForcedWorkflow.set(slug, wf.slug);
                                } else {
                                    this.sessionForcedWorkflow.set(slug, '');
                                }
                                wfGroupCb.checked = wfCbs.some((c) => c.checked);
                                wfGroupCb.indeterminate = false;
                                updateCount();
                            });
                        }
                        wfGroupCb.checked = wfCbs.some((c) => c.checked);
                        wfGroupCb.addEventListener('change', () => {
                            if (!wfGroupCb.checked) {
                                for (const c of wfCbs) c.checked = false;
                                this.sessionForcedWorkflow.set(slug, '');
                            }
                            updateCount();
                        });
                    }
                } catch {
                    wfCatBody.createEl('span', { cls: 'tp-empty-hint', text: 'Error loading workflows.' });
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
        this.popoverEl?.remove();
        this.popoverEl = null;
    }

    isOpen(): boolean {
        return this.popoverEl !== null;
    }
}
