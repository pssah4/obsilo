/**
 * ExtractionQueue
 *
 * Persistent FIFO queue for background memory extraction jobs.
 * Survives Obsidian restarts via pending-extractions.json.
 *
 * Processing runs in the background — one item at a time,
 * with a configurable delay between items.
 */

import type { FileAdapter } from '../storage/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingExtraction {
    conversationId: string;
    transcript: string;
    title: string;
    queuedAt: string;
    type: 'session' | 'long-term';
}

export type ExtractionProcessor = (item: PendingExtraction) => Promise<void>;

// ---------------------------------------------------------------------------
// ExtractionQueue
// ---------------------------------------------------------------------------

export class ExtractionQueue {
    private items: PendingExtraction[] = [];
    private filePath: string;
    private processing = false;
    private processor: ExtractionProcessor | null = null;
    /** Delay between processing items (ms). */
    private delayMs = 2000;

    constructor(private fs: FileAdapter) {
        this.filePath = 'pending-extractions.json';
    }

    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------

    /** Set the function that processes each queue item. */
    setProcessor(fn: ExtractionProcessor): void {
        this.processor = fn;
    }

    // -----------------------------------------------------------------------
    // Queue operations
    // -----------------------------------------------------------------------

    async enqueue(item: PendingExtraction): Promise<void> {
        this.items.push(item);
        await this.save();
        // Kick off processing if not already running
        this.processQueue();
    }

    dequeue(): PendingExtraction | undefined {
        return this.items.shift();
    }

    peek(): PendingExtraction | undefined {
        return this.items[0];
    }

    isEmpty(): boolean {
        return this.items.length === 0;
    }

    size(): number {
        return this.items.length;
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    async load(): Promise<void> {
        try {
            const raw = await this.fs.read(this.filePath);
            const parsed = JSON.parse(raw);
            this.items = Array.isArray(parsed) ? parsed : [];
        } catch {
            this.items = [];
        }
    }

    async save(): Promise<void> {
        await this.fs.write(this.filePath, JSON.stringify(this.items, null, 2));
    }

    // -----------------------------------------------------------------------
    // Background processing
    // -----------------------------------------------------------------------

    /**
     * Process all pending items one by one.
     * Runs in the background. Safe to call multiple times (re-entrant guard).
     */
    async processQueue(): Promise<void> {
        if (this.processing || !this.processor) return;
        this.processing = true;

        try {
            while (!this.isEmpty()) {
                const item = this.peek();
                if (!item) break;

                try {
                    await this.processor(item);
                    // Success — remove from queue
                    this.dequeue();
                    await this.save();
                } catch (e) {
                    // Failure — leave in queue for retry on next startup, stop processing
                    console.warn('[ExtractionQueue] Processing failed, will retry later:', e);
                    break;
                }

                // Delay between items to avoid hammering the LLM
                if (!this.isEmpty()) {
                    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
                }
            }
        } finally {
            this.processing = false;
        }
    }
}
