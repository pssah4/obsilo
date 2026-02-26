/**
 * ToolRepetitionDetector — loop guard with three responsibilities:
 *
 * 1. Exact repetition detection: blocks identical tool+input calls (3+ in window)
 * 2. Fuzzy search deduplication: blocks semantically similar search queries (3+ in window)
 * 3. Tool call ledger: structured log for context condensing preservation
 *
 * Returns recoverable errors (not fatal) — the agent can try a different approach.
 * The consecutiveMistakeLimit in AgentTask is the ultimate safety net.
 *
 * Adapted from Kilo Code's loop-detection pattern (03-refactoring-plan.md §2.1).
 */

const SEARCH_TOOLS = new Set(['search_files', 'semantic_search', 'search_by_tag', 'web_search']);

interface ToolCallEntry {
    tool: string;
    inputKey: string;
    queryTerms: Set<string>;
    resultSummary: string;
    iteration: number;
}

export interface RepetitionCheck {
    blocked: boolean;
    reason?: string;
}

export class ToolRepetitionDetector {
    /** All recorded calls (for ledger). Grows unbounded but capped by maxIterations (~25). */
    private allCalls: ToolCallEntry[] = [];
    /** Sliding window for repetition detection. */
    private recentKeys: string[] = [];
    private readonly windowSize = 15;
    private readonly maxExactRepetitions = 3;
    private readonly maxSimilarSearches = 3;
    private readonly similarityThreshold = 0.5;

    /**
     * Check BEFORE tool execution whether this call should be blocked.
     * Does NOT record the call — call record() after successful execution.
     */
    check(toolName: string, input: Record<string, unknown>): RepetitionCheck {
        const key = `${toolName}:${JSON.stringify(input)}`;

        // 1. Exact repetition: count identical calls in the sliding window
        const exactCount = this.recentKeys.filter((k) => k === key).length;
        if (exactCount >= this.maxExactRepetitions) {
            return {
                blocked: true,
                reason: `Tool loop detected: "${toolName}" was called with identical input `
                    + `${this.maxExactRepetitions} times. Use the results you already have `
                    + `or try a completely different approach.`,
            };
        }

        // 2. Fuzzy search dedup: only for search tools
        if (SEARCH_TOOLS.has(toolName)) {
            const queryText = String(input.query ?? input.pattern ?? '').toLowerCase();
            const queryTerms = new Set(queryText.split(/\s+/).filter((t) => t.length > 2));

            if (queryTerms.size > 0) {
                let similarCount = 0;
                for (const prev of this.allCalls) {
                    if (!SEARCH_TOOLS.has(prev.tool)) continue;
                    if (prev.queryTerms.size === 0) continue;
                    if (this.jaccard(queryTerms, prev.queryTerms) >= this.similarityThreshold) {
                        similarCount++;
                    }
                }
                if (similarCount >= this.maxSimilarSearches) {
                    return {
                        blocked: true,
                        reason: `Repetitive search detected: you have already performed ${similarCount} `
                            + `similar searches for this topic. Use the results you have, or deliver `
                            + `your answer with current information.`,
                    };
                }
            }
        }

        return { blocked: false };
    }

    /**
     * Record a completed tool call. Called AFTER successful execution.
     * Feeds both the sliding window (for detection) and the ledger (for condensing).
     */
    record(
        toolName: string,
        input: Record<string, unknown>,
        resultSummary: string,
        iteration: number,
    ): void {
        const key = `${toolName}:${JSON.stringify(input)}`;
        const queryText = SEARCH_TOOLS.has(toolName)
            ? String(input.query ?? input.pattern ?? '').toLowerCase()
            : '';
        const queryTerms = new Set(queryText.split(/\s+/).filter((t) => t.length > 2));

        this.allCalls.push({ tool: toolName, inputKey: key, queryTerms, resultSummary, iteration });

        // Sliding window for exact-match detection
        this.recentKeys.push(key);
        if (this.recentKeys.length > this.windowSize) {
            this.recentKeys.shift();
        }
    }

    /**
     * Structured tool-call ledger for injection into condensing prompt.
     * Returns empty string if no calls recorded.
     */
    getLedger(): string {
        if (this.allCalls.length === 0) return '';
        const lines = this.allCalls.map((c, i) => {
            // Extract key params (path, query, pattern) for readability
            let parsed: Record<string, unknown>;
            try { parsed = JSON.parse(c.inputKey.slice(c.tool.length + 1)); } catch { parsed = {}; }
            const params = Object.entries(parsed)
                .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                .join(', ');
            return `${i + 1}. [iter ${c.iteration}] ${c.tool}(${params}) => ${c.resultSummary}`;
        });
        return 'Tool calls executed so far (DO NOT repeat these):\n' + lines.join('\n');
    }

    /** Jaccard similarity coefficient on two word sets. */
    private jaccard(a: Set<string>, b: Set<string>): number {
        let intersection = 0;
        for (const term of a) {
            if (b.has(term)) intersection++;
        }
        const union = a.size + b.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    /**
     * Ordered list of tool names called so far (for episodic memory).
     */
    getToolSequence(): string[] {
        return this.allCalls.map((c) => c.tool);
    }

    reset(): void {
        this.allCalls = [];
        this.recentKeys = [];
    }
}
