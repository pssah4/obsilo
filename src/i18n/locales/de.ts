import type { Translations } from '../types';
import { en } from './en';

/**
 * German locale — stub.
 * Falls back to English for untranslated keys via the t() function.
 */
export const de: Translations = {
    ...en,
};
