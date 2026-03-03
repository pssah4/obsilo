/**
 * ContextTracker - Tracks token usage and calculates context window utilization
 * Adapted from Kilo Code's context.ts utility
 */

const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;

export interface ContextUsage {
    percentage: number;
    tokensUsed: number;
    maxTokens: number;
    reservedForOutput: number;
    availableSize: number;
}

export interface TokenDistribution {
    currentPercent: number;
    reservedPercent: number;
    availablePercent: number;
}

export class ContextTracker {
    private tokensUsed = 0;
    private contextWindow = 0;
    private maxTokensForOutput = 0;

    constructor(contextWindow: number, maxTokensForOutput?: number) {
        this.contextWindow = contextWindow;
        this.maxTokensForOutput = maxTokensForOutput ?? ANTHROPIC_DEFAULT_MAX_TOKENS;
    }

    updateUsage(tokensIn: number, tokensOut: number): void {
        // SETS (nicht addiert!) tokensUsed auf den aktuellen Context-Stand.
        // Wird mehrfach aufgerufen: zuerst von Subtasks (Zwischenstände),
        // dann vom Parent-Task (finale Gesamtsumme inkl. aller Subtasks).
        // Nur der letzte Aufruf (Parent) ist relevant für die Anzeige.
        this.tokensUsed = tokensIn + tokensOut;
    }

    setTotalTokens(totalTokens: number): void {
        // Directly set total tokens (used after context condensing)
        this.tokensUsed = totalTokens;
    }

    updateContextWindow(contextWindow: number, maxTokensForOutput?: number): void {
        this.contextWindow = contextWindow;
        if (maxTokensForOutput !== undefined) {
            this.maxTokensForOutput = maxTokensForOutput;
        }
    }

    getContextUsage(): ContextUsage {
        const distribution = this.calculateTokenDistribution();
        const percentage = this.contextWindow > 0
            ? Math.round((this.tokensUsed / this.contextWindow) * 100)
            : 0;

        return {
            percentage,
            tokensUsed: this.tokensUsed,
            maxTokens: this.contextWindow,
            reservedForOutput: this.maxTokensForOutput,
            availableSize: Math.max(0, this.contextWindow - this.tokensUsed - this.maxTokensForOutput),
        };
    }

    calculateTokenDistribution(): TokenDistribution {
        const safeContextWindow = Math.max(0, this.contextWindow);
        const safeContextTokens = Math.max(0, this.tokensUsed);
        const availableSize = Math.max(0, safeContextWindow - safeContextTokens - this.maxTokensForOutput);
        const total = safeContextTokens + this.maxTokensForOutput + availableSize;

        if (total <= 0) {
            return { currentPercent: 0, reservedPercent: 0, availablePercent: 0 };
        }

        return {
            currentPercent: (safeContextTokens / total) * 100,
            reservedPercent: (this.maxTokensForOutput / total) * 100,
            availablePercent: (availableSize / total) * 100,
        };
    }

    getContextColor(): 'green' | 'yellow' | 'red' {
        const usage = this.getContextUsage();
        if (usage.percentage >= 86) return 'red';
        if (usage.percentage >= 61) return 'yellow';
        return 'green';
    }

    reset(): void {
        this.tokensUsed = 0;
    }
}
