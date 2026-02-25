import type { Translations } from '../types';
import { en } from './en';

/**
 * Spanish locale — stub.
 * Falls back to English for untranslated keys via the t() function.
 */
export const es: Translations = {
    ...en,
};
