/**
 * PlanPresentationTool -- plans a presentation from source material and template catalog.
 *
 * Uses an internal constrained LLM call to:
 * 1. Analyze source material and extract key messages
 * 2. Select appropriate slide types from the template catalog
 * 3. Generate content for EVERY non-decorative shape
 * 4. Validate the plan against the catalog (required shapes, shape names, placeholders)
 *
 * Returns a DeckPlan that can be directly fed into create_pptx.
 * This tool does NOT create a PPTX file -- it only plans.
 *
 * ADR-048: Content transformation must happen at tool level, not as prompt suggestion.
 */

import { TFile } from 'obsidian';
import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import { TemplateCatalogLoader } from '../../office/pptx/TemplateCatalog';
import type { DeckPlan, TemplateCatalog, SlideType } from '../../office/pptx/types';
import { getHelperApi } from '../../helper-api';
import { runMeteredCall } from '../../pricing/meteredCall';

export class PlanPresentationTool extends BaseTool<'plan_presentation'> {
    readonly name = 'plan_presentation' as const;
    readonly isWriteOperation = false;

    private catalogLoader: TemplateCatalogLoader;

    constructor(plugin: ObsidianAgentPlugin) {
        super(plugin);
        this.catalogLoader = new TemplateCatalogLoader(plugin);
    }

    getDefinition(): ToolDefinition {
        return {
            name: 'plan_presentation',
            description:
                'Plan a presentation from source material using a corporate template. ' +
                'Reads the source note, loads the template catalog, and generates a complete ' +
                'deck plan with content for every shape on every slide via an internal LLM call. ' +
                'Returns the plan as a table + JSON block ready for create_pptx. ' +
                'ALWAYS call this before create_pptx when using corporate templates. ' +
                'The plan shows all slides with content -- review it before generating.',
            input_schema: {
                type: 'object',
                properties: {
                    source: {
                        type: 'string',
                        description: 'Vault path to the source note, or direct text content if no note exists.',
                    },
                    template: {
                        type: 'string',
                        description: 'Theme name (e.g. "acme"). Must be an ingested corporate template.',
                    },
                    deck_mode: {
                        type: 'string',
                        enum: ['speaker', 'reading'],
                        description: 'Speaker deck (max 25 words/slide, notes carry detail) or Reading deck (max 170 words/slide, self-explanatory).',
                    },
                    goal: {
                        type: 'string',
                        description: 'What should the audience learn, decide, or do?',
                    },
                    audience: {
                        type: 'string',
                        description: 'Who is the target audience? What do they already know?',
                    },
                    slide_count: {
                        type: 'number',
                        description: 'Target number of slides (optional, auto-determined if omitted).',
                    },
                },
                required: ['source', 'template', 'deck_mode'],
            },
        };
    }

    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        const { callbacks } = context;

        const source = ((input.source as string) ?? '').trim();
        const template = ((input.template as string) ?? '').trim();
        const deckMode = (input.deck_mode as string) ?? 'reading';
        const goal = (input.goal as string) ?? '';
        const audience = (input.audience as string) ?? '';
        const slideCount = input.slide_count as number | undefined;

        if (!source) {
            callbacks.pushToolResult(this.formatError(new Error('source is required')));
            return;
        }
        if (!template) {
            callbacks.pushToolResult(this.formatError(new Error('template is required')));
            return;
        }

        try {
            // 1. Read source material
            callbacks.log('Reading source material...');
            const sourceContent = await this.readSource(source);
            if (!sourceContent.trim()) {
                callbacks.pushToolResult(this.formatError(new Error(`Source is empty: ${source}`)));
                return;
            }

            // 2. Load template catalog + guide
            callbacks.log(`Loading template "${template}"...`);
            const resolved = await this.catalogLoader.loadTemplate(template);
            const guide = TemplateCatalogLoader.formatSlideTypeGuide(resolved.catalog);

            // 3. Internal constrained LLM call
            callbacks.log('Planning presentation (internal LLM call)...');
            const plan = await this.callPlanningLLM(sourceContent, guide, {
                deckMode, goal, audience, slideCount,
            }, context.reportAuxUsage);

            // 4. Validate plan against catalog
            const warnings = this.validatePlan(plan, resolved.catalog);

            // 5. Format and return
            const output = this.formatPlanOutput(plan, warnings, template);
            callbacks.pushToolResult(output);
            callbacks.log(`Plan complete: ${plan.slides.length} slides, ${warnings.length} warnings`);

        } catch (error) {
            callbacks.pushToolResult(this.formatError(error));
            await callbacks.handleError('plan_presentation', error);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Source reading                                                      */
    /* ------------------------------------------------------------------ */

    private async readSource(source: string): Promise<string> {
        // Try as vault path first
        const file = this.app.vault.getAbstractFileByPath(source);
        if (file instanceof TFile) {
            return await this.app.vault.read(file);
        }
        // If longer text without path separators, treat as direct text input
        if (source.length > 100 && !source.endsWith('.md')) {
            return source;
        }
        throw new Error(
            `Source not found in vault: "${source}". ` +
            `Provide a valid vault path to a note, or pass the text content directly.`,
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Internal LLM call (constrained planning)                           */
    /* ------------------------------------------------------------------ */

    private async callPlanningLLM(
        sourceContent: string,
        guide: string,
        options: { deckMode: string; goal: string; audience: string; slideCount?: number },
        /**
         * FIX-24-05-09 (D10): the owning task's aux-usage channel. The planning
         * call ships the whole source note plus the template guide, so it is one
         * of the more expensive single calls in the plugin, and it reported
         * nothing. Undefined on a headless dispatch, which the helper handles.
         */
        reportAuxUsage?: import('../../pricing/meteredCall').UsageSink,
    ): Promise<DeckPlan> {
        const { buildApiHandlerForModel } = await import('../../../api');
        const model = this.plugin.getActiveModel();
        if (!model) {
            throw new Error('Kein aktives Modell konfiguriert. Bitte zuerst ein Modell in den Settings einrichten.');
        }

        // FEAT-24-07 / ADR-115: route plan_presentation through the optional
        // helper model. The active-model handler stays as the fallback.
        const mainApi = buildApiHandlerForModel(model);
        const api = getHelperApi(this.plugin, mainApi);

        const userPrompt =
            `SOURCE MATERIAL:\n${sourceContent}\n\n` +
            `TEMPLATE GUIDE:\n${guide}\n\n` +
            `DECK MODE: ${options.deckMode}\n` +
            `GOAL: ${options.goal || 'Informieren und Entscheidung vorbereiten'}\n` +
            `AUDIENCE: ${options.audience || 'Fachpublikum'}\n` +
            (options.slideCount ? `TARGET SLIDES: ~${options.slideCount}\n` : '') +
            '\nReturn a complete DeckPlan as JSON. Every slide must have source_slide, ' +
            'slide_type_id, purpose, key_message, content (ALL non-decorative shapes filled), ' +
            'remove (if needed), and notes.';

        const stream = runMeteredCall(api, 'plan-presentation', {
            systemPrompt: PLANNING_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
            // no tools for the planning call
        }, reportAuxUsage);

        let responseText = '';
        for await (const chunk of stream) {
            if (chunk.type === 'text') responseText += chunk.text;
        }

        if (!responseText.trim()) {
            throw new Error('LLM returned empty response for presentation planning.');
        }

        // Parse JSON -- strip markdown fences if present
        let cleaned = responseText.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        }
        // Also handle case where LLM wraps in { } with extra text before/after
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart > 0 || (jsonEnd >= 0 && jsonEnd < cleaned.length - 1)) {
            cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            throw new Error(
                'Failed to parse DeckPlan JSON from LLM response. ' +
                `Response starts with: "${cleaned.substring(0, 200)}"`,
            );
        }

        // Runtime type guard -- catch malformed LLM output before downstream code
        const p = parsed as Record<string, unknown>;
        if (
            typeof p !== 'object' || p === null ||
            typeof p.title !== 'string' ||
            !Array.isArray(p.slides)
        ) {
            throw new Error(
                'LLM response is valid JSON but not a valid DeckPlan ' +
                '(missing title or slides array).',
            );
        }

        return parsed as DeckPlan;
    }

    /* ------------------------------------------------------------------ */
    /*  Plan validation                                                    */
    /* ------------------------------------------------------------------ */

    private validatePlan(plan: DeckPlan, catalog: TemplateCatalog): string[] {
        const warnings: string[] = [];

        if (!plan.slides || !Array.isArray(plan.slides) || plan.slides.length === 0) {
            warnings.push('Plan enthaelt keine Slides.');
            return warnings;
        }

        const slideTypeLookup = new Map<number, SlideType>();
        for (const st of (catalog.slide_types ?? [])) {
            slideTypeLookup.set(st.representative_slide, st);
            for (const alt of st.alternate_slides) slideTypeLookup.set(alt, st);
        }

        for (const slide of plan.slides) {
            const st = slideTypeLookup.get(slide.source_slide);
            if (!st) {
                warnings.push(`Folie ${slide.position}: source_slide ${slide.source_slide} nicht im Catalog`);
                continue;
            }

            // Check required shapes
            for (const shape of st.shapes) {
                if (!shape.required) continue;
                const key = shape.duplicate_index != null && shape.duplicate_index > 0
                    ? `${shape.name}#${shape.duplicate_index}` : shape.name;
                if (!slide.content?.[key] && !slide.remove?.includes(key)) {
                    warnings.push(`Folie ${slide.position} (${st.id}): REQUIRED "${key}" fehlt`);
                }
            }

            // Check for placeholder text
            if (slide.content) {
                for (const [key, value] of Object.entries(slide.content)) {
                    if (typeof value === 'string' && KNOWN_PLACEHOLDERS.has(value)) {
                        warnings.push(`Folie ${slide.position}: "${key}" enthaelt Platzhalter "${value}"`);
                    }
                }
            }

            // Check group consistency
            if (slide.remove) {
                for (const removedName of slide.remove) {
                    const removedShape = st.shapes.find(s => {
                        const k = s.duplicate_index != null && s.duplicate_index > 0
                            ? `${s.name}#${s.duplicate_index}` : s.name;
                        return k === removedName;
                    });
                    if (removedShape?.group_id) {
                        const groupMembers = st.shapes.filter(s => s.group_id === removedShape.group_id);
                        for (const member of groupMembers) {
                            const memberKey = member.duplicate_index != null && member.duplicate_index > 0
                                ? `${member.name}#${member.duplicate_index}` : member.name;
                            if (memberKey !== removedName &&
                                !slide.remove.includes(memberKey) &&
                                !slide.content?.[memberKey]) {
                                warnings.push(
                                    `Folie ${slide.position}: "${removedName}" entfernt aber ` +
                                    `Gruppen-Mitglied "${memberKey}" weder entfernt noch befuellt`,
                                );
                            }
                        }
                    }
                }
            }
        }

        return warnings;
    }

    /* ------------------------------------------------------------------ */
    /*  Output formatting                                                  */
    /* ------------------------------------------------------------------ */

    private formatPlanOutput(plan: DeckPlan, warnings: string[], template: string): string {
        const lines: string[] = [];

        lines.push(`## Folienplan: ${plan.title}\n`);
        lines.push(`**Narrativ:** ${plan.narrative_framework}`);
        lines.push(`**Modus:** ${plan.deck_mode === 'speaker' ? 'Speaker Deck' : 'Reading Deck'}`);
        lines.push(`**Folien:** ${plan.slides.length}`);
        lines.push(`**Template:** ${template}\n`);

        // Overview table
        lines.push('| # | Typ | Kernaussage | Phase |');
        lines.push('|---|-----|-------------|-------|');
        for (const slide of plan.slides) {
            const msg = (slide.key_message ?? '').substring(0, 60);
            const purpose = (slide.purpose ?? '').substring(0, 30);
            lines.push(`| ${slide.position} | ${slide.slide_type_id} | ${msg} | ${purpose} |`);
        }
        lines.push('');

        // Warnings
        if (warnings.length > 0) {
            lines.push('**Validierungs-Hinweise:**');
            for (const w of warnings) lines.push(`- ${w}`);
            lines.push('');
        }

        // JSON block for create_pptx (copy-paste ready)
        const slidesJson = plan.slides.map(s => {
            const slide: Record<string, unknown> = {
                source_slide: s.source_slide,
                content: s.content,
            };
            if (s.remove && s.remove.length > 0) slide.remove = s.remove;
            if (s.notes) slide.notes = s.notes;
            return slide;
        });

        // Compact JSON (no indentation) to minimize token count for the create_pptx call.
        // Pretty-printed JSON of 16 slides with styled_text was ~20k chars and caused
        // network timeouts on OpenRouter. Compact plain-string JSON is ~3-5k chars.
        lines.push('**JSON fuer create_pptx** (kopiere diesen Block):');
        lines.push('```json');
        lines.push(JSON.stringify({
            output_path: 'presentations/output.pptx',
            template,
            slides: slidesJson,
        }));
        lines.push('```\n');

        lines.push('Soll ich diesen Plan als PPTX generieren? Bei Aenderungswuenschen beschreibe was angepasst werden soll.');

        return lines.join('\n');
    }
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Known placeholder texts from JSON examples that should be replaced with real content. */
const KNOWN_PLACEHOLDERS = new Set([
    'Your slide title', 'Your title here', 'Subtitle or context line',
    'Main content paragraph', 'Content here', 'Step name', 'Brief description',
    'Metric name', 'Section headline', '42%', 'Growth',
]);

/**
 * System prompt for the internal planning LLM call.
 * Based on patterns from PPTAgent, SlideGen, Auto-Slides, Presenton, NotebookLM.
 */
const PLANNING_SYSTEM_PROMPT = `You are an expert presentation designer. Create a complete deck plan from source material and a template catalog guide.

PROCESS (follow this order):
1. ANALYZE: Read the source material completely. Extract 5-8 key messages.
2. NARRATIVE: Choose a storytelling framework (SCR, SCQA, Pyramid, DataStory, StatusReport). Assign each key message to a narrative phase (Hook, Build, Turn, Resolution, Echo).
3. LAYOUT SELECTION: For each key message, choose the slide type that fits the CONTENT:
   - Numbers/metrics -> KPI slides or chart slides
   - Sequence/process -> Process chevrons or timeline
   - Comparison/contrast -> Two-column or comparison slides
   - Section break -> Trenner/divider slides (with correct chapter number)
   - Overview/list -> Content slides (LAST RESORT)
   Layout is determined by CONTENT, not the other way around.
4. CONTENT: Fill EVERY non-decorative shape with real content derived from the source material.

SOURCE-GROUNDING RULES:
- EVERY text must be derivable from the source material
- NEVER invent data, numbers, facts, or quotes
- If source material is insufficient for a shape, remove the shape (add to "remove" array)
- Transform FORMAT (prose to bullets, paragraphs to action titles), not CONTENT

SHAPE RULES:
- Titles are ACTION TITLES: "Plan comparisons consume resources" not "Problem statement"
- Shapes with [section_number]: Set the running chapter number ("1", "2", "3", ...)
- Shapes with {group:X}: Remove or fill the ENTIRE group together. Never leave orphaned group members.
- Respect max_chars limits per shape -- truncate or split if needed
- ALL content values MUST be plain strings (no JSON objects, no styled_text, no html_text). The engine auto-formats multi-line strings with bullets.
- For bullets use "- " prefix per line. For numbered lists use "1. " prefix. For bold emphasis use "**text**". Separate paragraphs with blank lines.
- Example body: "**Hoher Zeitaufwand:** Fließbilder und R&I-Pläne müssen manuell verglichen werden.\n\n**Fehleranfälligkeit:** Übersehene Änderungen führen zu Rückschleifen."
- Use EXACT shape names from the template guide (case-sensitive)
- For duplicate shapes use "ShapeName#N" notation (0-based index)

DECK MODE RULES:
- Speaker: Max 25 words visible per slide. Details in speaker notes (2-3 talking points each).
- Reading: Max 170 words per slide. Complete sentences. Speaker notes optional.

QUALITY CHECKS (verify before output):
- Does every slide have exactly ONE key message?
- Are ALL required shapes filled (not empty, no placeholder text)?
- Are all texts derivable from the source material?
- Are chapter numbers on section dividers correct and sequential?
- Are unused shapes correctly removed (including all group members)?
- Is the narrative arc complete (Hook to Build to Turn to Resolution to Echo)?

OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown fences, no extra text) matching this schema:
{
  "title": "Presentation title",
  "narrative_framework": "SCR",
  "deck_mode": "reading",
  "slides": [
    {
      "position": 1,
      "source_slide": 23,
      "slide_type_id": "titelfolie-ohne-bild-tiefenblau--cover",
      "purpose": "Hook: Opening statement",
      "key_message": "The one key message",
      "content": { "Shape Name": "Content text", ... },
      "remove": ["Unused Shape"],
      "notes": "Speaker notes"
    }
  ]
}`;
