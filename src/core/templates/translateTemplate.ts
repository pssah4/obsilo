/**
 * FEAT-29-14: LLM-translator for the FirstRun/Re-materialize Template
 * workflow. Wraps `buildApiHandlerForModel(activeModel)` and returns
 * the translated template content as a string.
 *
 * Returns the source content unchanged if no active model is available
 * (offline-safe). The materializer reports `fallbackLanguage: 'en'`
 * in that case so the wizard can surface a Notice.
 *
 * AUDIT-024 M-1 / OWASP LLM06 (Sensitive Information Disclosure).
 * This helper transmits the source content to the active LLM provider.
 * By contract it is meant ONLY for the bundled note-template structure
 * (YAML frontmatter with empty values, ~200 bytes per file). Callers
 * MUST NOT pass user vault content through it without redaction. The
 * `MAX_TRANSLATION_INPUT_BYTES` guard is defense-in-depth: any source
 * larger than the cap is rejected and the original content is returned
 * unchanged. The FirstRun wizard step shows an explicit consent banner
 * naming the active provider before invoking this translator.
 *
 * AUDIT-024 L-3 (Insecure Default Initialization, accepted).
 * When `activeModelKey` is null we fall back to the first enabled
 * model in `activeModels[]`. This keeps the FirstRun wizard usable
 * before the user picks an active key. The fallback is offline-safe:
 * any provider error returns the source unchanged.
 *
 * AUDIT-024 L-4 (Prompt Injection guard).
 * Sources with more than two `---` frontmatter markers are rejected.
 * A malformed template could break out of the YAML block and inject
 * arbitrary instructions into the translation request; the guard
 * keeps the translator off that path.
 */

import type ObsidianAgentPlugin from '../../main';
import { buildApiHandlerForModel } from '../../api/index';
import { getModelKey } from '../../types/settings';
import { runMeteredCall } from '../pricing/meteredCall';
import { resolveTierModel } from '../routing/tierResolution';

/** AUDIT-024 M-1: hard cap on bytes shipped to the external provider. */
export const MAX_TRANSLATION_INPUT_BYTES = 4096;

/** AUDIT-024 L-4: max number of `---` frontmatter fences in a source. */
export const MAX_FRONTMATTER_FENCES = 2;

export function makeTemplateTranslator(plugin: ObsidianAgentPlugin) {
    return async (lang: string, name: string, sourceContent: string): Promise<string> => {
        // AUDIT-024 M-1: refuse outsize sources. Bundled templates are
        // ~200 bytes each; anything larger means a caller passed user
        // content by mistake, which would leak to the external provider.
        if (sourceContent.length > MAX_TRANSLATION_INPUT_BYTES) {
            console.warn(
                `[templates] refusing to translate source larger than ${MAX_TRANSLATION_INPUT_BYTES} bytes (got ${sourceContent.length}): ${name}`,
            );
            return sourceContent;
        }
        // AUDIT-024 L-4: reject sources with more than 2 `---` markers
        // (would suggest broken-out frontmatter / prompt-injection
        // attempt). The translator stays defensive even though the
        // bundled templates are trusted; user-replaced templates are not.
        const fenceCount = (sourceContent.match(/^---\s*$/gm) ?? []).length;
        if (fenceCount > MAX_FRONTMATTER_FENCES) {
            console.warn(
                `[templates] refusing to translate source with ${fenceCount} frontmatter fences (max ${MAX_FRONTMATTER_FENCES}): ${name}`,
            );
            return sourceContent;
        }
        const model = pickActiveModel(plugin);
        if (!model) return sourceContent;
        try {
            const handler = buildApiHandlerForModel(model);
            const prompt = buildTranslationPrompt(lang, name, sourceContent);
            // Prefer the lightweight classifyText path when the provider
            // exposes it (single-shot, no streaming overhead). Otherwise
            // fall back to createMessage and concatenate the text chunks.
            if (typeof handler.classifyText === 'function') {
                const out = await handler.classifyText(prompt);
                return cleanResponse(out, sourceContent);
            }
            // FIX-24-05-09 (D10): once per bundled template, so a first run in
            // a non-English vault is a small burst of calls nobody counted.
            const stream = runMeteredCall(handler, 'template-translation', {
                systemPrompt: prompt,
                messages: [{ role: 'user', content: 'Translate now.' }],
            });
            let text = '';
            for await (const chunk of stream) {
                if (chunk.type === 'text') text += chunk.text;
            }
            return cleanResponse(text, sourceContent);
        } catch (e) {
            console.warn('[templates] translation failed, keeping EN source:', e);
            return sourceContent;
        }
    };
}

/**
 * Resolve the active model from settings. Used to pick the provider
 * that handles the translation call. Returns null when no enabled
 * model is configured (FirstRun wizard then keeps the EN source).
 *
 * Review finding B1 (2026-07-14): the canonical providerConfigs[] store
 * is read first, via the same tier slot initApiHandler resolves
 * (`defaultMainModelTier`, default `mid`, mid -> fast cascade). The
 * first-run wizard writes only providerConfigs[] (FIX-26-99-03), so the
 * legacy activeModels[] read alone was model-blind right after a wizard
 * install and silently kept the EN source.
 *
 * AUDIT-024 L-3: the legacy "first enabled" fallback is intentional so
 * pre-migration setups work before the user has picked an active key.
 * Callers that want a strict-active behaviour should check
 * `activeModelKey` before invoking the translator.
 */
function pickActiveModel(plugin: ObsidianAgentPlugin) {
    const settings = plugin.settings;
    const canonical = resolveTierModel(settings, settings.defaultMainModelTier ?? 'mid');
    if (canonical) return canonical;
    const key = settings.activeModelKey;
    if (key) {
        const found = settings.activeModels.find((m) => getModelKey(m) === key);
        if (found?.enabled !== false) return found ?? null;
    }
    return settings.activeModels.find((m) => m.enabled !== false) ?? null;
}

function buildTranslationPrompt(lang: string, name: string, source: string): string {
    return [
        `You are translating an Obsidian note template into ${lang}.`,
        '',
        'Rules:',
        '- Translate frontmatter keys (left side of ":") into idiomatic ' + lang + '.',
        '- Translate list values under "Category:" or equivalent.',
        '- DO NOT change the YAML structure (indentation, dashes, colons).',
        '- DO NOT translate the key names "tags", "uid", or "Permanent".',
        '- DO NOT translate the literal value `false`.',
        '- DO NOT add commentary, code fences, or explanations -- output ONLY the translated file content.',
        '',
        `Template filename: ${name}`,
        '',
        'Source content:',
        '---BEGIN---',
        source,
        '---END---',
    ].join('\n');
}

function cleanResponse(raw: string, source: string): string {
    let s = raw.trim();
    // Some providers wrap text in ```markdown ... ``` even though we
    // told them not to. Strip a single leading/trailing fence.
    s = s.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
    s = s.replace(/^---BEGIN---\n/, '').replace(/\n---END---$/, '');
    if (s.length === 0) return source;
    if (!s.endsWith('\n')) s += '\n';
    return s;
}
