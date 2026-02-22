/**
 * DiffReviewModal — Multi-file diff editor with per-hunk approval
 *
 * Two modes:
 * - 'review' (post-task): Agent finished, user reviews all changes.
 *   Accept = keep change, Reject = undo change. Editable.
 * - 'checkpoint': Single-file read-only diff with restore button.
 *
 * Shown after agent task completes (not during execution).
 */

import { App, Modal, setIcon } from 'obsidian';
import { diffLines, getDiffStats } from '../core/utils/diffLines';
import type { DiffLine } from '../core/utils/diffLines';
import type { CheckpointInfo } from '../core/checkpoints/GitCheckpointService';

/** A contiguous block of changed lines (added/removed) */
interface DiffHunk {
    id: number;
    lines: DiffLine[];
    status: 'pending' | 'approved' | 'rejected';
}

/** Per-file diff data */
interface FileDiffState {
    filePath: string;
    oldContent: string;
    newContent: string;
    diffLines: DiffLine[];
    hunks: DiffHunk[];
}

/** Input: one file to diff */
export interface FileDiffEntry {
    filePath: string;
    oldContent: string;
    newContent: string;
}

/** Output: per-file decision after user review */
export interface FileDecision {
    filePath: string;
    /** Assembled content after user's accept/reject/edit decisions */
    finalContent: string;
    /** True if finalContent differs from newContent (user reverted or edited something) */
    hasChanges: boolean;
}

export interface DiffReviewOptions {
    mode: 'review' | 'checkpoint';
    onRestore?: () => Promise<void>;
    checkpointInfo?: CheckpointInfo;
}

/** Number of unchanged lines to show around a changed block before collapsing. */
const CONTEXT_LINES = 3;

export class DiffReviewModal extends Modal {
    private files: FileDiffState[] = [];
    private resolved = false;
    private applyBtn: HTMLElement | null = null;

    constructor(
        app: App,
        private entries: FileDiffEntry[],
        private options: DiffReviewOptions,
        private onResult?: (decisions: FileDecision[]) => void,
    ) {
        super(app);
        this.modalEl.addClass('diff-review-modal');
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;

        // Compute diffs for all files
        let globalHunkId = 0;
        for (const entry of this.entries) {
            const dl = diffLines(entry.oldContent, entry.newContent);
            const hunks = this.buildHunks(dl, globalHunkId);
            globalHunkId += hunks.length;
            this.files.push({
                filePath: entry.filePath,
                oldContent: entry.oldContent,
                newContent: entry.newContent,
                diffLines: dl,
                hunks,
            });
        }

        // Title
        const fileCount = this.files.length;
        titleEl.setText(
            this.options.mode === 'checkpoint'
                ? 'Checkpoint Diff'
                : `Review Changes (${fileCount} file${fileCount !== 1 ? 's' : ''})`,
        );

        // Checkpoint info header
        if (this.options.mode === 'checkpoint' && this.options.checkpointInfo) {
            const cp = this.options.checkpointInfo;
            const infoEl = contentEl.createDiv('checkpoint-diff-header');
            const time = new Date(cp.timestamp).toLocaleTimeString('de-DE', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
            infoEl.createSpan({ text: `${time} · ${cp.toolName ?? 'write'}` });
        }

        // Render each file section
        for (const file of this.files) {
            this.renderFileSection(contentEl, file);
        }

        // Footer
        this.renderFooter(contentEl);
    }

    onClose(): void {
        if (!this.resolved) {
            // Treat as "keep all" (no changes to apply)
            this.resolved = true;
        }
    }

    // -------------------------------------------------------------------------
    // File section rendering
    // -------------------------------------------------------------------------

    private renderFileSection(container: HTMLElement, file: FileDiffState): void {
        const section = container.createDiv('diff-file-section');
        const stats = getDiffStats(file.diffLines);

        // File header
        const header = section.createDiv('approve-edit-header');
        const pathEl = header.createDiv('approve-edit-path');
        setIcon(pathEl.createSpan('approve-edit-path-icon'), 'file-text');
        pathEl.createSpan('approve-edit-path-text').setText(file.filePath);

        const statsEl = header.createDiv('approve-edit-stats');
        if (stats.added > 0) {
            statsEl.createSpan({ cls: 'diff-stat-added', text: `+${stats.added}` });
        }
        if (stats.removed > 0) {
            statsEl.createSpan({ cls: 'diff-stat-removed', text: `-${stats.removed}` });
        }
        if (stats.added === 0 && stats.removed === 0) {
            statsEl.createSpan({ cls: 'diff-stat-none', text: 'No changes' });
            return; // No diff to show
        }

        // Diff body
        const diffEl = section.createDiv('approve-edit-diff');
        this.renderDiff(diffEl, file);
    }

    // -------------------------------------------------------------------------
    // Hunk computation
    // -------------------------------------------------------------------------

    private buildHunks(lines: DiffLine[], startId: number): DiffHunk[] {
        const hunks: DiffHunk[] = [];
        let currentChanged: DiffLine[] = [];
        let hunkId = startId;

        for (const line of lines) {
            if (line.type !== 'unchanged') {
                currentChanged.push(line);
            } else {
                if (currentChanged.length > 0) {
                    hunks.push({ id: hunkId++, lines: [...currentChanged], status: 'pending' });
                    currentChanged = [];
                }
            }
        }
        if (currentChanged.length > 0) {
            hunks.push({ id: hunkId++, lines: [...currentChanged], status: 'pending' });
        }
        return hunks;
    }

    // -------------------------------------------------------------------------
    // Diff rendering
    // -------------------------------------------------------------------------

    private renderDiff(container: HTMLElement, file: FileDiffState): void {
        const groups = this.groupIntoSections(file.diffLines, file.hunks);

        for (const section of groups) {
            if (section.type === 'collapse') {
                const btn = container.createEl('button', {
                    cls: 'diff-collapse-btn',
                    text: `... ${section.count} unchanged lines`,
                });
                const captured = section;
                btn.addEventListener('click', () => {
                    btn.remove();
                    for (const l of captured.lines) {
                        this.renderContextLine(container, l);
                    }
                });
            } else if (section.type === 'context') {
                for (const l of section.lines) {
                    this.renderContextLine(container, l);
                }
            } else {
                this.renderHunk(container, section.hunk);
            }
        }
    }

    private renderContextLine(container: HTMLElement, line: DiffLine): void {
        const row = container.createDiv('diff-line diff-line-unchanged');
        row.createSpan({ cls: 'diff-line-prefix', text: ' ' });
        row.createSpan({ cls: 'diff-line-content', text: line.content });
    }

    private renderHunk(container: HTMLElement, hunk: DiffHunk): void {
        const hunkEl = container.createDiv('diff-hunk');
        hunkEl.dataset.hunkId = String(hunk.id);

        // Hunk header with accept/reject buttons (review mode only, not checkpoint)
        if (this.options.mode === 'review') {
            const hunkHeader = hunkEl.createDiv('diff-hunk-header');
            const acceptBtn = hunkHeader.createEl('button', {
                cls: 'diff-hunk-btn diff-hunk-accept', text: 'Keep',
            });
            const rejectBtn = hunkHeader.createEl('button', {
                cls: 'diff-hunk-btn diff-hunk-reject', text: 'Undo',
            });

            acceptBtn.addEventListener('click', () => {
                hunk.status = 'approved';
                hunkEl.removeClass('diff-hunk-rejected');
                hunkEl.addClass('diff-hunk-approved');
                this.updateFooterState();
            });
            rejectBtn.addEventListener('click', () => {
                hunk.status = 'rejected';
                hunkEl.removeClass('diff-hunk-approved');
                hunkEl.addClass('diff-hunk-rejected');
                this.updateFooterState();
            });
        }

        // Lines
        for (let i = 0; i < hunk.lines.length; i++) {
            const line = hunk.lines[i];
            const row = hunkEl.createDiv(`diff-line diff-line-${line.type}`);
            const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
            row.createSpan({ cls: 'diff-line-prefix', text: prefix });

            if (line.type === 'added' && this.options.mode === 'review') {
                // Editable: contenteditable span
                const contentSpan = row.createSpan({ cls: 'diff-line-content diff-line-editable' });
                contentSpan.contentEditable = 'plaintext-only';
                contentSpan.textContent = line.content;
                const lineIndex = i;
                contentSpan.addEventListener('input', () => {
                    hunk.lines[lineIndex] = { ...line, content: contentSpan.textContent ?? '' };
                });
            } else {
                row.createSpan({ cls: 'diff-line-content', text: line.content });
            }
        }
    }

    // -------------------------------------------------------------------------
    // Section grouping (context collapsing)
    // -------------------------------------------------------------------------

    private groupIntoSections(lines: DiffLine[], hunks: DiffHunk[]): Array<
        | { type: 'context'; lines: DiffLine[] }
        | { type: 'collapse'; count: number; lines: DiffLine[] }
        | { type: 'hunk'; hunk: DiffHunk }
    > {
        const result: Array<
            | { type: 'context'; lines: DiffLine[] }
            | { type: 'collapse'; count: number; lines: DiffLine[] }
            | { type: 'hunk'; hunk: DiffHunk }
        > = [];

        // Mark which lines are "near a change"
        const changed = lines.map((l) => l.type !== 'unchanged');
        const visible = new Array(lines.length).fill(false);

        for (let i = 0; i < lines.length; i++) {
            if (changed[i]) {
                for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) {
                    visible[j] = true;
                }
            }
        }

        let hunkIndex = 0;
        let i = 0;

        while (i < lines.length) {
            if (lines[i].type !== 'unchanged') {
                // Collect the changed block (skip it, hunk handles rendering)
                while (i < lines.length && lines[i].type !== 'unchanged') i++;
                if (hunkIndex < hunks.length) {
                    result.push({ type: 'hunk', hunk: hunks[hunkIndex] });
                    hunkIndex++;
                }
            } else if (visible[i]) {
                const contextLines: DiffLine[] = [];
                while (i < lines.length && lines[i].type === 'unchanged' && visible[i]) {
                    contextLines.push(lines[i]);
                    i++;
                }
                result.push({ type: 'context', lines: contextLines });
            } else {
                const collapsedLines: DiffLine[] = [];
                while (i < lines.length && lines[i].type === 'unchanged' && !visible[i]) {
                    collapsedLines.push(lines[i]);
                    i++;
                }
                if (collapsedLines.length <= CONTEXT_LINES * 2) {
                    result.push({ type: 'context', lines: collapsedLines });
                } else {
                    result.push({ type: 'collapse', count: collapsedLines.length, lines: collapsedLines });
                }
            }
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Footer
    // -------------------------------------------------------------------------

    private renderFooter(container: HTMLElement): void {
        const footer = container.createDiv('diff-review-footer');

        if (this.options.mode === 'review') {
            const undoAllBtn = footer.createEl('button', {
                cls: 'diff-review-btn diff-review-reject-all', text: 'Undo All',
            });
            undoAllBtn.addEventListener('click', () => {
                // Reject all hunks → revert everything to old content
                for (const file of this.files) {
                    for (const h of file.hunks) h.status = 'rejected';
                }
                this.resolved = true;
                this.onResult?.(this.buildDecisions());
                this.close();
            });

            // Apply Selected — only active when all hunks have been decided
            this.applyBtn = footer.createEl('button', {
                cls: 'diff-review-btn diff-review-accept-selected', text: 'Apply Selected',
            });
            (this.applyBtn as HTMLButtonElement).disabled = true;
            this.applyBtn.addEventListener('click', () => {
                // Pending hunks become approved (keep as-is)
                for (const file of this.files) {
                    for (const h of file.hunks) {
                        if (h.status === 'pending') h.status = 'approved';
                    }
                }
                this.resolved = true;
                this.onResult?.(this.buildDecisions());
                this.close();
            });

            const keepAllBtn = footer.createEl('button', {
                cls: 'mod-cta diff-review-btn', text: 'Keep All',
            });
            keepAllBtn.addEventListener('click', () => {
                this.resolved = true;
                // No changes needed — keep everything as-is
                this.onResult?.([]);
                this.close();
            });
        }

        if (this.options.mode === 'checkpoint') {
            footer.createEl('button', { text: 'Close' })
                .addEventListener('click', () => this.close());

            if (this.options.onRestore) {
                const restoreBtn = footer.createEl('button', {
                    cls: 'mod-cta', text: 'Restore to this checkpoint',
                });
                restoreBtn.addEventListener('click', async () => {
                    restoreBtn.setText('Restoring...');
                    (restoreBtn as HTMLButtonElement).disabled = true;
                    try {
                        await this.options.onRestore!();
                        restoreBtn.setText('Restored');
                        restoreBtn.addClass('checkpoint-restored');
                    } catch {
                        restoreBtn.setText('Failed');
                    }
                });
            }
        }
    }

    private updateFooterState(): void {
        if (!this.applyBtn) return;
        const allHunks = this.files.flatMap((f) => f.hunks);
        const hasDecision = allHunks.some((h) => h.status !== 'pending');
        const hasPending = allHunks.some((h) => h.status === 'pending');
        // Active when at least 1 decision made AND no pending left
        (this.applyBtn as HTMLButtonElement).disabled = !hasDecision || hasPending;
    }

    // -------------------------------------------------------------------------
    // Decision building
    // -------------------------------------------------------------------------

    private buildDecisions(): FileDecision[] {
        const decisions: FileDecision[] = [];

        for (const file of this.files) {
            // Check if any hunk was rejected or edited
            const hasRejectedOrEdited = file.hunks.some((h) => h.status === 'rejected');
            if (!hasRejectedOrEdited) continue; // Keep as-is, no action needed

            const finalContent = this.assembleFinalContent(file);
            decisions.push({
                filePath: file.filePath,
                finalContent,
                hasChanges: finalContent !== file.newContent,
            });
        }

        return decisions;
    }

    private assembleFinalContent(file: FileDiffState): string {
        const resultLines: string[] = [];
        let hunkIndex = 0;
        let currentChangedBlock: DiffLine[] = [];

        for (const line of file.diffLines) {
            if (line.type === 'unchanged') {
                if (currentChangedBlock.length > 0) {
                    this.flushHunk(resultLines, currentChangedBlock, file.hunks, hunkIndex);
                    hunkIndex++;
                    currentChangedBlock = [];
                }
                resultLines.push(line.content);
            } else {
                currentChangedBlock.push(line);
            }
        }
        if (currentChangedBlock.length > 0) {
            this.flushHunk(resultLines, currentChangedBlock, file.hunks, hunkIndex);
        }

        return resultLines.join('\n');
    }

    private flushHunk(resultLines: string[], block: DiffLine[], hunks: DiffHunk[], hunkIndex: number): void {
        if (hunkIndex >= hunks.length) return;
        const hunk = hunks[hunkIndex];

        if (hunk.status === 'rejected') {
            // Undo: keep old lines (removed lines stay, added lines discarded)
            for (const h of block) {
                if (h.type === 'removed') resultLines.push(h.content);
            }
        } else {
            // Approved or pending: keep new lines (possibly edited)
            for (const h of hunk.lines) {
                if (h.type === 'added') resultLines.push(h.content);
            }
        }
    }
}
