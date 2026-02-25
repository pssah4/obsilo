/**
 * i18n Type Definitions
 */

export type Language = 'en' | 'de' | 'es' | 'ja' | 'zh-CN' | 'hi';

/** Flat key-value translation map */
export type Translations = Record<string, string>;

/** Language metadata for the settings dropdown */
export const LANGUAGES: Record<Language, string> = {
    en: 'English',
    de: 'Deutsch',
    es: 'Espanol',
    ja: '\u65E5\u672C\u8A9E',
    'zh-CN': '\u7B80\u4F53\u4E2D\u6587',
    hi: '\u0939\u093F\u0928\u094D\u0926\u0940',
};
