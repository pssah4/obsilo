import { App, PluginSettingTab, setIcon } from 'obsidian';
import type ObsidianAgentPlugin from '../main';
import { t } from '../i18n';

// ─── Extracted modules ────────────────────────────────────────────────────────
import { ModelsTab }      from './settings/ModelsTab';
import { EmbeddingsTab }  from './settings/EmbeddingsTab';
import { WebSearchTab }   from './settings/WebSearchTab';
import { ModesTab }       from './settings/ModesTab';
import { PermissionsTab } from './settings/PermissionsTab';
import { LoopTab }        from './settings/LoopTab';
import { RulesTab }       from './settings/RulesTab';
import { WorkflowsTab }   from './settings/WorkflowsTab';
import { SkillsTab }      from './settings/SkillsTab';
import { PromptsTab }     from './settings/PromptsTab';
import { McpTab }         from './settings/McpTab';
import { VaultTab }       from './settings/VaultTab';
import { InterfaceTab }   from './settings/InterfaceTab';
import { LogTab }         from './settings/LogTab';
import { DebugTab }       from './settings/DebugTab';
import { BackupTab }      from './settings/BackupTab';
import { MemoryTab }      from './settings/MemoryTab';
import { ShellTab }       from './settings/ShellTab';
import { LanguageTab }    from './settings/LanguageTab';

// Re-export for backward compatibility (used in main.ts and other places)
export { ModelConfigModal } from './settings/ModelConfigModal';
export { ContentEditorModal } from './settings/ContentEditorModal';

// ---------------------------------------------------------------------------

type TabId = 'providers' | 'agent-behaviour' | 'vault' | 'advanced' | 'language';

export class AgentSettingsTab extends PluginSettingTab {
    plugin: ObsidianAgentPlugin;
    private activeTab: TabId = 'providers';
    private activeProvidersSubTab: string = 'models';
    private activeAgentSubTab: string = 'modes';
    private activeAdvancedSubTab: string = 'interface';

    constructor(app: App, plugin: ObsidianAgentPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Programmatically navigate to a specific tab/subtab and re-render.
     * Used by deep-links (obsidian://obsilo-settings) and plugin methods.
     */
    openAt(tab: TabId, subTab?: string): void {
        this.activeTab = tab;
        if (subTab) {
            if (tab === 'providers') this.activeProvidersSubTab = subTab;
            if (tab === 'agent-behaviour') this.activeAgentSubTab = subTab;
            if (tab === 'advanced') this.activeAdvancedSubTab = subTab;
        }
        this.display();
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('agent-settings');

        this.buildTabNav(containerEl);
        this.buildTabContent(containerEl);
    }

    // ---------------------------------------------------------------------------
    // Tab nav
    // ---------------------------------------------------------------------------

    private buildTabNav(container: HTMLElement): void {
        const nav = container.createDiv('agent-settings-nav');
        const tabs: { id: TabId; label: string; icon: string }[] = [
            { id: 'providers',       label: t('settings.group.providers'),       icon: 'plug'         },
            { id: 'agent-behaviour', label: t('settings.group.agentBehaviour'), icon: 'users-round'  },
            { id: 'vault',           label: t('settings.group.vault'),           icon: 'server'       },
            { id: 'advanced',        label: t('settings.group.advanced'),        icon: 'settings-2'   },
            { id: 'language',        label: t('settings.tab.language'),          icon: 'globe'        },
        ];
        tabs.forEach(({ id, label, icon }) => {
            const btn = nav.createEl('button', {
                cls: `agent-settings-tab${this.activeTab === id ? ' active' : ''}`,
            });
            const iconEl = btn.createSpan({ cls: 'agent-settings-tab-icon' });
            setIcon(iconEl, icon);
            btn.createSpan({ cls: 'agent-settings-tab-label', text: label });
            btn.addEventListener('click', () => {
                this.activeTab = id;
                this.display();
            });
        });
    }

    // ---------------------------------------------------------------------------
    // Tab content router
    // ---------------------------------------------------------------------------

    private buildTabContent(container: HTMLElement): void {
        const content = container.createDiv('agent-settings-content');
        if (this.activeTab === 'providers')       this.buildProvidersTab(content);
        if (this.activeTab === 'agent-behaviour') this.buildAgentBehaviourTab(content);
        if (this.activeTab === 'vault')           new VaultTab(this.plugin, this.app, () => this.display()).build(content);
        if (this.activeTab === 'advanced')        this.buildAdvancedTab(content);
        if (this.activeTab === 'language')        new LanguageTab(this.plugin, this.app, () => this.display()).build(content);
    }

    // ---------------------------------------------------------------------------
    // Sub-tab infrastructure
    // ---------------------------------------------------------------------------

    private buildSubTabNav(
        container: HTMLElement,
        tabs: { id: string; label: string; icon?: string }[],
        activeId: string,
        onSelect: (id: string) => void,
    ): void {
        const nav = container.createDiv({ cls: 'agent-settings-subnav' });
        for (const tab of tabs) {
            const btn = nav.createEl('button', {
                cls: `agent-settings-subtab${tab.id === activeId ? ' active' : ''}`,
            });
            if (tab.icon) {
                const iconEl = btn.createSpan({ cls: 'subtab-icon' });
                setIcon(iconEl, tab.icon);
            }
            btn.createSpan({ text: tab.label });
            btn.addEventListener('click', () => onSelect(tab.id));
        }
    }

    private renderComingSoon(
        container: HTMLElement,
        icon: string,
        title: string,
        description: string,
    ): void {
        const wrap = container.createDiv({ cls: 'agent-settings-coming-soon' });
        const iconEl = wrap.createDiv({ cls: 'agent-settings-coming-soon-icon' });
        setIcon(iconEl, icon);
        wrap.createDiv({ cls: 'agent-settings-coming-soon-title', text: title });
        wrap.createDiv({ cls: 'agent-settings-coming-soon-desc', text: description });
    }

    // ---------------------------------------------------------------------------
    // Providers tab (Models + Embeddings + Web Search)
    // ---------------------------------------------------------------------------

    private buildProvidersTab(container: HTMLElement): void {
        this.buildSubTabNav(
            container,
            [
                { id: 'models',      label: t('settings.tab.models')     },
                { id: 'embeddings',  label: t('settings.tab.embeddings') },
                { id: 'web-search',  label: t('settings.tab.webSearch') },
                { id: 'mcp-servers', label: t('settings.tab.mcp')        },
            ],
            this.activeProvidersSubTab,
            (id) => { this.activeProvidersSubTab = id; this.display(); },
        );
        const content = container.createDiv({ cls: 'agent-settings-subcontent' });
        const rerender = () => this.display();
        if (this.activeProvidersSubTab === 'models')      new ModelsTab(this.plugin, this.app, rerender).build(content);
        if (this.activeProvidersSubTab === 'embeddings')  new EmbeddingsTab(this.plugin, this.app, rerender).build(content);
        if (this.activeProvidersSubTab === 'web-search')  new WebSearchTab(this.plugin, this.app, rerender).build(content);
        if (this.activeProvidersSubTab === 'mcp-servers') new McpTab(this.plugin, this.app, rerender).build(content);
    }

    // ---------------------------------------------------------------------------
    // Agent Behaviour tab (Modes + MCP + Rules + Workflows + Skills + …)
    // ---------------------------------------------------------------------------

    private buildAgentBehaviourTab(container: HTMLElement): void {
        const subTabs = [
            { id: 'modes',       label: t('settings.tab.modes')       },
            { id: 'permissions', label: t('settings.tab.autoApprove') },
            { id: 'loop',        label: t('settings.tab.loop')        },
            { id: 'memory',      label: t('settings.tab.memory')      },
            { id: 'rules',       label: t('settings.tab.rules')       },
            { id: 'workflows',   label: t('settings.tab.workflows')   },
            { id: 'skills',      label: t('settings.tab.skills')      },
            { id: 'prompts',     label: t('settings.tab.prompts')     },
        ];
        this.buildSubTabNav(container, subTabs, this.activeAgentSubTab,
            (id) => { this.activeAgentSubTab = id; this.display(); });
        const content = container.createDiv({ cls: 'agent-settings-subcontent' });
        const rerender = () => this.display();
        const ms = (this.plugin as any).modeService;
        if (this.activeAgentSubTab === 'modes')       new ModesTab(this.plugin, this.app, rerender, ms).build(content);
        if (this.activeAgentSubTab === 'permissions') new PermissionsTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAgentSubTab === 'loop')        new LoopTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAgentSubTab === 'memory')      new MemoryTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAgentSubTab === 'rules')       new RulesTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAgentSubTab === 'workflows')   new WorkflowsTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAgentSubTab === 'skills')      new SkillsTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAgentSubTab === 'prompts')     new PromptsTab(this.plugin, this.app, rerender).build(content);
    }

    // ---------------------------------------------------------------------------
    // Advanced tab (Interface + Log + Debug + Backup)
    // ---------------------------------------------------------------------------

    private buildAdvancedTab(container: HTMLElement): void {
        this.buildSubTabNav(
            container,
            [
                { id: 'interface', label: t('settings.tab.interface') },
                { id: 'shell',     label: t('settings.tab.shell')     },
                { id: 'log',       label: t('settings.tab.log')       },
                { id: 'debug',     label: t('settings.tab.debug')     },
                { id: 'backup',    label: t('settings.tab.backup')    },
            ],
            this.activeAdvancedSubTab,
            (id) => { this.activeAdvancedSubTab = id; this.display(); },
        );
        const content = container.createDiv({ cls: 'agent-settings-subcontent' });
        const rerender = () => this.display();
        if (this.activeAdvancedSubTab === 'interface') new InterfaceTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAdvancedSubTab === 'shell')     new ShellTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAdvancedSubTab === 'log')       new LogTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAdvancedSubTab === 'debug')     new DebugTab(this.plugin, this.app, rerender).build(content);
        if (this.activeAdvancedSubTab === 'backup')    new BackupTab(this.plugin, this.app, rerender).build(content);
    }
}
