import type { Translations } from '../types';
import { en } from './en';

/**
 * Japanese locale — stub.
 * Falls back to English for untranslated keys via the t() function.
 */
export const ja: Translations = {
    ...en,
};
