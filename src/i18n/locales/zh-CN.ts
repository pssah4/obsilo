import type { Translations } from '../types';
import { en } from './en';

/**
 * Simplified Chinese locale — stub.
 * Falls back to English for untranslated keys via the t() function.
 */
export const zhCN: Translations = {
    ...en,
};
