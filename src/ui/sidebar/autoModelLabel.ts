/**
 * autoModelLabel -- what the "Auto" model pill says (FIX-24-05-08, D7).
 *
 * The pill used to render the bare word "Auto" on both chat surfaces. "Auto" is
 * a routing decision, not a model, so the user could not tell which model the
 * tier router had picked, while the cost footer of the same run named a model
 * and billed it. Selection and billing have to read the same value (R1), so the
 * label resolves the decision through the same cascade the API handler uses.
 *
 * Shared by the sidebar composer and the inline panel so the two surfaces cannot
 * drift apart, and kept out of tierResolution.ts, which stays free of i18n.
 */

import { t } from '../../i18n';
import { resolveAutoModel } from '../../core/routing/tierResolution';
import { shortModelLabel } from '../../core/pricing/ModelPricing';
import type { ObsidianAgentSettings } from '../../types/settings';

/** The settings slice the Auto cascade reads. */
export type AutoModelSettings = Pick<
    ObsidianAgentSettings,
    'activeProviderId' | 'providerConfigs' | 'defaultMainModelTier' | 'activeModelKey' | 'activeModels'
>;

/**
 * Label plus tooltip for the model pill in Auto mode.
 *
 * The label carries the SHORT id, because a Bedrock cross-region id
 * ('eu.anthropic.claude-opus-5-20260401-v1:0') pushes the composer row
 * off-screen. shortModelLabel is the same helper the cost footer uses, so pill
 * and footer name a model identically instead of in two dialects. The full id
 * stays in the tooltip: shortening must not be the only copy.
 *
 * The provider-supplied displayName is deliberately not used here, matching the
 * override branch of the pill: display names like "EU Anthropic Claude Opus 5
 * [Cross-Region Profile]" are what the shortening exists to avoid.
 *
 * Nothing resolved (no provider, no tier, no legacy selection) falls back to the
 * bare word. Inventing a model name for an unconfigured plugin would be worse
 * than saying nothing.
 */
export function autoModelLabel(settings: AutoModelSettings): { label: string; tooltip: string } {
    const model = resolveAutoModel(settings);
    if (!model) {
        return { label: t('ui.sidebar.modelAuto'), tooltip: t('ui.sidebar.modelAutoTitle') };
    }
    return {
        label: t('ui.sidebar.modelAutoResolved', { model: shortModelLabel(model.name) }),
        tooltip: t('ui.sidebar.modelAutoResolvedTitle', { model: model.name }),
    };
}
