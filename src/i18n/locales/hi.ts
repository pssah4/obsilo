import type { Translations } from '../types';
import { en } from './en';

/**
 * Hindi locale — stub.
 * Falls back to English for untranslated keys via the t() function.
 */
export const hi: Translations = {
    ...en,
};
