/**
 * ToolRepetitionDetector — prevents infinite tool-call loops.
 *
 * Tracks the last N tool calls. If the same tool+input combination appears
 * maxRepetitions or more times within the window, the call is flagged.
 *
 * Adapted from Kilo Code's loop-detection pattern (03-refactoring-plan.md §2.1).
 */
export class ToolRepetitionDetector {
    private recentCalls: string[] = [];
    private readonly windowSize = 10;
    private readonly maxRepetitions = 3;

    /**
     * Record a tool call and return true if a repetition loop is detected.
     * The call IS recorded even when true is returned so the window stays accurate.
     */
    check(toolName: string, input: Record<string, unknown>): boolean {
        const key = `${toolName}:${JSON.stringify(input)}`;
        this.recentCalls.push(key);
        if (this.recentCalls.length > this.windowSize) {
            this.recentCalls.shift();
        }
        return this.recentCalls.filter((k) => k === key).length >= this.maxRepetitions;
    }

    reset(): void {
        this.recentCalls = [];
    }
}
