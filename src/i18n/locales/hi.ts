import type { Translations } from '../types';

/**
 * Hindi locale — partial.
 * Only the most visible UI strings are translated.
 * Missing keys fall back to English via the t() function.
 */
export const hi: Translations = {
    // Settings — Tab Groups
    'settings.group.providers': '\u092A\u094D\u0930\u0926\u093E\u0924\u093E',
    'settings.group.agentBehaviour': '\u090F\u091C\u0947\u0902\u091F \u0935\u094D\u092F\u0935\u0939\u093E\u0930',
    'settings.group.vault': 'Vault',
    'settings.group.advanced': '\u0909\u0928\u094D\u0928\u0924',

    // Settings — Sub-Tab Labels
    'settings.tab.models': '\u092E\u0949\u0921\u0932',
    'settings.tab.embeddings': '\u090F\u092E\u094D\u092C\u0947\u0921\u093F\u0902\u0917',
    'settings.tab.webSearch': '\u0935\u0947\u092C \u0916\u094B\u091C',
    'settings.tab.mcp': 'MCP',
    'settings.tab.modes': '\u092E\u094B\u0921',
    'settings.tab.autoApprove': '\u0911\u091F\u094B-\u0905\u092A\u094D\u0930\u0942\u0935',
    'settings.tab.loop': '\u0932\u0942\u092A',
    'settings.tab.memory': '\u092E\u0947\u092E\u094B\u0930\u0940',
    'settings.tab.rules': '\u0928\u093F\u092F\u092E',
    'settings.tab.workflows': '\u0935\u0930\u094D\u0915\u092B\u093C\u094D\u0932\u094B',
    'settings.tab.skills': '\u0915\u094C\u0936\u0932',
    'settings.tab.prompts': '\u092A\u094D\u0930\u0949\u092E\u094D\u092A\u094D\u091F',
    'settings.tab.interface': '\u0907\u0902\u091F\u0930\u092B\u093C\u0947\u0938',
    'settings.tab.shell': '\u0936\u0947\u0932',
    'settings.tab.log': '\u0932\u0949\u0917',
    'settings.tab.debug': '\u0921\u0940\u092C\u0917',
    'settings.tab.backup': '\u092C\u0948\u0915\u0905\u092A',
    'settings.tab.language': '\u092D\u093E\u0937\u093E',

    // Chat UI — Sidebar
    'ui.sidebar.title': 'Obsilo Agent',
    'ui.sidebar.settings': '\u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938',
    'ui.sidebar.chatHistory': '\u091A\u0948\u091F \u0907\u0924\u093F\u0939\u093E\u0938',
    'ui.sidebar.newChat': '\u0928\u0908 \u091A\u0948\u091F',
    'ui.sidebar.stop': '\u0930\u094B\u0915\u0947\u0902',
    'ui.sidebar.send': '\u0938\u0902\u0926\u0947\u0936 \u092D\u0947\u091C\u0947\u0902',
    'ui.sidebar.placeholder': '\u0905\u092A\u0928\u093E \u0938\u0902\u0926\u0947\u0936 \u092F\u0939\u093E\u0901 \u091F\u093E\u0907\u092A \u0915\u0930\u0947\u0902...',
    'ui.sidebar.working': '\u0915\u093E\u092E \u091A\u0932 \u0930\u0939\u093E \u0939\u0948\u2026',
    'ui.sidebar.reasoning': '\u0924\u0930\u094D\u0915 \u0915\u0930 \u0930\u0939\u093E \u0939\u0948\u2026',
    'ui.sidebar.copy': '\u0915\u0949\u092A\u0940 \u0915\u0930\u0947\u0902',
    'ui.sidebar.plan': '\u092F\u094B\u091C\u0928\u093E',
    'ui.sidebar.activity': '\u0917\u0924\u093F\u0935\u093F\u0927\u093F',

    // Notices
    'notice.copied': '\u0915\u0949\u092A\u0940 \u0939\u094B \u0917\u092F\u093E\u0964',
    'notice.copiedToClipboard': '\u0915\u094D\u0932\u093F\u092A\u092C\u094B\u0930\u094D\u0921 \u092E\u0947\u0902 \u0915\u0949\u092A\u0940 \u0939\u094B \u0917\u092F\u093E',
    'notice.taskComplete': '\u090F\u091C\u0947\u0902\u091F \u0915\u093E\u0930\u094D\u092F \u092A\u0942\u0930\u094D\u0923',
    'notice.noActiveFile': '\u0915\u094B\u0908 \u0938\u0915\u094D\u0930\u093F\u092F \u092B\u093C\u093E\u0907\u0932 \u0928\u0939\u0940\u0902',

    // Approval
    'ui.approval.allowOnce': '\u090F\u0915 \u092C\u093E\u0930 \u0905\u0928\u0941\u092E\u0924\u093F \u0926\u0947\u0902',
    'ui.approval.enableInSettings': '\u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938 \u092E\u0947\u0902 \u0938\u0915\u094D\u0937\u092E \u0915\u0930\u0947\u0902',

    // Errors
    'ui.error.invalidKey': '\u0905\u092E\u093E\u0928\u094D\u092F API Key \u2014 \u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938 \u2192 Obsilo Agent \u091C\u093E\u0901\u091A\u0947\u0902',
    'ui.error.rateLimit': '\u0926\u0930 \u0938\u0940\u092E\u093E \u092A\u0939\u0941\u0901\u091A \u0917\u0908 \u2014 \u0915\u0943\u092A\u092F\u093E \u0925\u094B\u0921\u093C\u093E \u0930\u0941\u0915\u0947\u0902',
    'ui.error.generic': '\u0924\u094D\u0930\u0941\u091F\u093F',

    // Language Tab
    'settings.language.language': '\u092D\u093E\u0937\u093E',
    'settings.language.languageDesc': '\u092A\u094D\u0932\u0917\u0907\u0928 \u0907\u0902\u091F\u0930\u092B\u093C\u0947\u0938 \u0915\u0940 \u092A\u094D\u0930\u0926\u0930\u094D\u0936\u0928 \u092D\u093E\u0937\u093E \u091A\u0941\u0928\u0947\u0902\u0964 \u0905\u0928\u0941\u0935\u093E\u0926\u093F\u0924 \u0928\u0939\u0940\u0902 \u0915\u093F\u090F \u0917\u090F \u0938\u094D\u091F\u094D\u0930\u093F\u0902\u0917\u094D\u0938 \u0915\u0947 \u0932\u093F\u090F English \u092B\u093C\u0949\u0932\u092C\u0948\u0915 \u0939\u0948\u0964',
    'settings.language.restartHint': '\u0938\u092D\u0940 \u092A\u0930\u093F\u0935\u0930\u094D\u0924\u0928\u094B\u0902 \u0915\u094B \u0932\u093E\u0917\u0942 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F Obsidian \u092A\u0941\u0928\u0903 \u092A\u094D\u0930\u093E\u0930\u0902\u092D \u0915\u0930\u0947\u0902\u0964',

    // Onboarding
    'onboarding.welcome.heading': 'Obsilo \u092E\u0947\u0902 \u0906\u092A\u0915\u093E \u0938\u094D\u0935\u093E\u0917\u0924 \u0939\u0948',
    'onboarding.welcome.freeButton': '\u092E\u0941\u092B\u093C\u094D\u0924 \u092E\u0947\u0902 \u0906\u091C\u093C\u092E\u093E\u090F\u0902 (Google)',
    'onboarding.welcome.apiKeyButton': '\u092E\u0947\u0930\u0947 \u092A\u093E\u0938 API Key \u0939\u0948',
};
