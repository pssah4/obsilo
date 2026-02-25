/**
 * Lightweight i18n module for Obsidian Agent.
 *
 * - English is always bundled (fallback).
 * - Other locales are lazy-loaded on first use.
 * - t() is synchronous; call initI18n() before rendering UI.
 */

import { en } from './locales/en';
import type { Translations, Language } from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let current: Translations = en;
let currentLang: Language = 'en';

// ---------------------------------------------------------------------------
// Lazy loaders for non-EN locales
// ---------------------------------------------------------------------------

const localeLoaders: Record<Language, () => Promise<Translations>> = {
    en: () => Promise.resolve(en),
    de: () => import('./locales/de').then((m) => m.de),
    es: () => import('./locales/es').then((m) => m.es),
    ja: () => import('./locales/ja').then((m) => m.ja),
    'zh-CN': () => import('./locales/zh-CN').then((m) => m.zhCN),
    hi: () => import('./locales/hi').then((m) => m.hi),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate a key. Returns the translated string, falling back to English,
 * then to the raw key if nothing is found.
 *
 * Supports simple interpolation: `t('key', { count: 5 })` replaces `{{count}}`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
    let text = current[key] ?? en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{{${k}}}`, String(v));
        }
    }
    return text;
}

/**
 * Switch language at runtime. Resolves when the locale file is loaded.
 */
export async function setLanguage(lang: Language): Promise<void> {
    const loader = localeLoaders[lang];
    if (loader) {
        current = await loader();
        currentLang = lang;
    }
}

/**
 * Return the currently active language code.
 */
export function getCurrentLanguage(): Language {
    return currentLang;
}

/**
 * Initialize i18n. Call once during plugin onload(), before any UI renders.
 */
export async function initI18n(lang: Language): Promise<void> {
    await setLanguage(lang);
}
