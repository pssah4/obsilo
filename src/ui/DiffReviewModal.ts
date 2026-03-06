/**
 * DiffReviewModal — Multi-file diff editor with semantic section approval
 *
 * Two modes:
 * - 'review' (post-task): Agent finished, user reviews all changes.
 *   Keep = keep change, Undo = revert change. Per-section editing via textarea.
 * - 'checkpoint': Read-only diff with restore button.
 *
 * Changes are grouped by Markdown structure (frontmatter, headings, lists,
 * code blocks, paragraphs) instead of raw contiguous changed lines.
 */

import { App, Modal, setIcon } from 'obsidian';
import { t } from '../i18n';
import { diffLines, getDiffStats } from '../core/utils/diffLines';
import type { DiffLine } from '../core/utils/diffLines';
import { parseMarkdownSections } from '../core/utils/markdownSections';
import type { SectionType, MarkdownSection } from '../core/utils/markdownSections';
import type { CheckpointInfo } from '../core/checkpoints/GitCheckpointService';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** A contiguous block of changed lines (added/removed) — low-level unit */
interface DiffHunk {
    id: number;
    lines: DiffLine[];
    status: 'pending' | 'approved' | 'rejected';
}

/** Pre-computed diff-line range for a hunk */
interface HunkRange {
    hunk: DiffHunk;
    startDi: number;
    endDi: number;
}

/** Semantic grouping of hunks by Markdown section */
interface SemanticGroup {
    id: number;
    label: string;
    type: SectionType;
    hunkIds: number[];
    status: 'pending' | 'approved' | 'rejected';
    isEditing: boolean;
    editedContent?: string;
    /** Line range in the NEW content that this section covers */
    newLineStart: number;
    newLineEnd: number;
}

/** Per-file diff data */
interface FileDiffState {
    filePath: string;
    oldContent: string;
    newContent: string;
    diffLines: DiffLine[];
    hunks: DiffHunk[];
    semanticGroups: SemanticGroup[];
    /** Pre-computed: hunkId → diff-line range (computed once, used everywhere) */
    hunkRangeMap: Map<number, HunkRange>;
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Input: one file to diff */
export interface FileDiffEntry {
    filePath: string;
    oldContent: string;
    newContent: string;
}

/** Output: per-file decision after user review */
export interface FileDecision {
    filePath: string;
    finalContent: string;
    hasChanges: boolean;
}

export interface DiffReviewOptions {
    mode: 'review' | 'checkpoint';
    onRestore?: () => Promise<void>;
    checkpointInfo?: CheckpointInfo;
}

/** Number of unchanged context lines to show around a change before collapsing. */
const CONTEXT_LINES = 3;

// ---------------------------------------------------------------------------
// Section icon mapping
// ---------------------------------------------------------------------------

const SECTION_ICONS: Record<SectionType, string> = {
    'frontmatter': 'file-cog',
    'heading': 'heading',
    'code-block': 'code',
    'list': 'list',
    'callout': 'message-square',
    'table': 'table',
    'paragraph': 'text',
};

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

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

        // Prevent closing by clicking the backdrop or pressing Escape —
        // user must choose an explicit action (Keep All / Undo All / Apply)
        this.containerEl.addEventListener('click', (e: Event) => {
            if (e.target === this.containerEl) {
                e.stopPropagation();
                e.preventDefault();
            }
        }, true);
        this.scope.register([], 'Escape', (e: KeyboardEvent) => {
            e.preventDefault();
            return false;
        });
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;

        // Hide Obsidian's default close button — user must use footer actions
        const closeBtn = this.modalEl.querySelector('.modal-close-button');
        if (closeBtn instanceof HTMLElement) closeBtn.addClass('agent-u-hidden');

        // Show loading state immediately so the modal feels responsive
        titleEl.setText(
            this.options.mode === 'checkpoint'
                ? t('modal.diffReview.titleCheckpoint')
                : t('modal.diffReview.titleReview', { count: this.entries.length }),
        );
        const loadingEl = contentEl.createDiv('diff-loading');
        loadingEl.setText('...');

        // Defer heavy computation + rendering to next frame
        requestAnimationFrame(() => {
            loadingEl.remove();

            // Compute diffs + semantic groups for all files
            let globalHunkId = 0;
            let globalGroupId = 0;
            for (const entry of this.entries) {
                const dl = diffLines(entry.oldContent, entry.newContent);
                const hunks = this.buildHunks(dl, globalHunkId);
                globalHunkId += hunks.length;

                const sections = parseMarkdownSections(entry.newContent);
                const groups = this.mapHunksToSections(dl, hunks, sections, globalGroupId);
                globalGroupId += groups.length;

                // Pre-compute hunk ranges once per file
                const hunkRangeMap = this.buildHunkRangeMap(dl, hunks);

                this.files.push({
                    filePath: entry.filePath,
                    oldContent: entry.oldContent,
                    newContent: entry.newContent,
                    diffLines: dl,
                    hunks,
                    semanticGroups: groups,
                    hunkRangeMap,
                });
            }

            // Update title with actual file count
            titleEl.setText(
                this.options.mode === 'checkpoint'
                    ? t('modal.diffReview.titleCheckpoint')
                    : t('modal.diffReview.titleReview', { count: this.files.length }),
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
        });
    }

    /** Block close() unless the user made an explicit decision */
    close(): void {
        if (!this.resolved) return;
        super.close();
    }

    onClose(): void {
        // noop — cleanup handled by decision callbacks
    }

    // =========================================================================
    // Hunk computation (low-level — contiguous changed lines)
    // =========================================================================

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

    /**
     * Pre-compute: for each hunk, find its diff-line index range.
     * Computed once per file, used by renderDiff and renderGroupDiffLines.
     */
    private buildHunkRangeMap(dl: DiffLine[], hunks: DiffHunk[]): Map<number, HunkRange> {
        const map = new Map<number, HunkRange>();
        let hunkIdx = 0;
        let blockStart = -1;

        for (let di = 0; di < dl.length; di++) {
            if (dl[di].type !== 'unchanged') {
                if (blockStart === -1) blockStart = di;
            } else {
                if (blockStart !== -1 && hunkIdx < hunks.length) {
                    map.set(hunks[hunkIdx].id, { hunk: hunks[hunkIdx], startDi: blockStart, endDi: di - 1 });
                    hunkIdx++;
                    blockStart = -1;
                }
            }
        }
        if (blockStart !== -1 && hunkIdx < hunks.length) {
            map.set(hunks[hunkIdx].id, { hunk: hunks[hunkIdx], startDi: blockStart, endDi: dl.length - 1 });
        }

        return map;
    }

    // =========================================================================
    // Hunk → Section mapping
    // =========================================================================

    private mapHunksToSections(
        dl: DiffLine[],
        hunks: DiffHunk[],
        sections: MarkdownSection[],
        startGroupId: number,
    ): SemanticGroup[] {
        if (hunks.length === 0 || sections.length === 0) return [];

        // Step 1: For each hunk, find its position in "new content" line space.
        const hunkNewLinePos = new Map<number, number>();
        let newLineIndex = 0;
        let hunkIdx = 0;
        let inChangedBlock = false;

        for (const line of dl) {
            if (line.type === 'unchanged') {
                if (inChangedBlock) {
                    hunkIdx++;
                    inChangedBlock = false;
                }
                newLineIndex++;
            } else {
                if (!inChangedBlock && hunkIdx < hunks.length) {
                    hunkNewLinePos.set(hunks[hunkIdx].id, newLineIndex);
                    inChangedBlock = true;
                }
                if (line.type === 'added') newLineIndex++;
            }
        }

        // Step 2: Assign each hunk to a section
        const sectionHunks = new Map<number, number[]>();
        for (const hunk of hunks) {
            const pos = hunkNewLinePos.get(hunk.id) ?? 0;
            let sectionIdx = sections.findIndex(
                (s) => pos >= s.startLine && pos <= s.endLine,
            );
            if (sectionIdx === -1) {
                // Fallback: find nearest section before this position
                for (let s = sections.length - 1; s >= 0; s--) {
                    if (sections[s].startLine <= pos) {
                        sectionIdx = s;
                        break;
                    }
                }
                if (sectionIdx === -1) sectionIdx = 0;
            }
            const existing = sectionHunks.get(sectionIdx) ?? [];
            existing.push(hunk.id);
            sectionHunks.set(sectionIdx, existing);
        }

        // Step 3: Build SemanticGroup[] — only for sections with changes
        const groups: SemanticGroup[] = [];
        let groupId = startGroupId;
        for (let s = 0; s < sections.length; s++) {
            const hunkIds = sectionHunks.get(s);
            if (!hunkIds || hunkIds.length === 0) continue;
            groups.push({
                id: groupId++,
                label: sections[s].label,
                type: sections[s].type,
                hunkIds,
                status: 'pending',
                isEditing: false,
                newLineStart: sections[s].startLine,
                newLineEnd: sections[s].endLine,
            });
        }

        return groups;
    }

    // =========================================================================
    // File section rendering
    // =========================================================================

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
            statsEl.createSpan({ cls: 'diff-stat-none', text: t('modal.diffReview.noChanges') });
            return;
        }

        // Diff body
        const diffEl = section.createDiv('approve-edit-diff');
        this.renderDiff(diffEl, file);
    }

    // =========================================================================
    // Diff rendering — organized by semantic groups
    // =========================================================================

    private renderDiff(container: HTMLElement, file: FileDiffState): void {
        // Build lookup: hunkId → group
        const hunkIdToGroup = new Map<number, SemanticGroup>();
        for (const g of file.semanticGroups) {
            for (const hId of g.hunkIds) hunkIdToGroup.set(hId, g);
        }

        // Build lookup: diffLine index → hunkId (for changed lines)
        const diffLineToHunkId = new Map<number, number>();
        for (const [hunkId, range] of file.hunkRangeMap) {
            for (let di = range.startDi; di <= range.endDi; di++) {
                diffLineToHunkId.set(di, hunkId);
            }
        }

        // Pre-compute: set of all diffLine indices covered by any group
        // (changed lines + unchanged lines between hunks of the same group)
        const groupCoveredIndices = new Set<number>();
        for (const g of file.semanticGroups) {
            let minDi = file.diffLines.length;
            let maxDi = 0;
            for (const hId of g.hunkIds) {
                const range = file.hunkRangeMap.get(hId);
                if (range) {
                    if (range.startDi < minDi) minDi = range.startDi;
                    if (range.endDi > maxDi) maxDi = range.endDi;
                }
            }
            for (let di = minDi; di <= maxDi; di++) {
                groupCoveredIndices.add(di);
            }
        }

        const renderedGroups = new Set<number>();
        let contextBuffer: DiffLine[] = [];

        const flushContext = () => {
            if (contextBuffer.length === 0) return;
            if (contextBuffer.length > CONTEXT_LINES * 2 + 1) {
                const before = contextBuffer.slice(0, CONTEXT_LINES);
                const middle = contextBuffer.slice(CONTEXT_LINES, -CONTEXT_LINES);
                const after = contextBuffer.slice(-CONTEXT_LINES);
                for (const l of before) this.renderContextRow(container, l);
                const btn = container.createEl('button', {
                    cls: 'diff-collapse-btn',
                    text: t('modal.diffReview.unchangedLines', { count: middle.length }),
                });
                const captured = middle;
                btn.addEventListener('click', () => {
                    btn.remove();
                    for (const l of captured) {
                        this.renderContextRow(container, l);
                    }
                });
                for (const l of after) this.renderContextRow(container, l);
            } else {
                for (const l of contextBuffer) this.renderContextRow(container, l);
            }
            contextBuffer = [];
        };

        for (let di = 0; di < file.diffLines.length; di++) {
            const hunkId = diffLineToHunkId.get(di);

            if (hunkId !== undefined) {
                const group = hunkIdToGroup.get(hunkId);
                if (group && !renderedGroups.has(group.id)) {
                    flushContext();
                    renderedGroups.add(group.id);
                    this.renderSemanticGroup(container, group, file);
                }
            } else {
                // Unchanged line — skip if covered by a group range (O(1) lookup)
                if (!groupCoveredIndices.has(di)) {
                    contextBuffer.push(file.diffLines[di]);
                }
            }
        }
        flushContext();
    }

    // =========================================================================
    // Semantic group rendering
    // =========================================================================

    private renderSemanticGroup(container: HTMLElement, group: SemanticGroup, file: FileDiffState): void {
        const groupEl = container.createDiv('diff-semantic-group');
        groupEl.dataset.groupId = String(group.id);

        // Section header
        const header = groupEl.createDiv('diff-section-header');

        const labelEl = header.createDiv('diff-section-label');
        setIcon(labelEl.createSpan('diff-section-icon'), SECTION_ICONS[group.type] ?? 'text');
        labelEl.createSpan('diff-section-label-text').setText(group.label);

        // Stats for this group
        const groupHunks = file.hunks.filter((h) => group.hunkIds.includes(h.id));
        const groupLines = groupHunks.flatMap((h) => h.lines);
        const added = groupLines.filter((l) => l.type === 'added').length;
        const removed = groupLines.filter((l) => l.type === 'removed').length;
        const statsEl = header.createDiv('diff-section-stats');
        if (added > 0) statsEl.createSpan({ cls: 'diff-stat-added', text: `+${added}` });
        if (removed > 0) statsEl.createSpan({ cls: 'diff-stat-removed', text: `-${removed}` });

        // Action buttons (review mode only)
        if (this.options.mode === 'review') {
            const actions = header.createDiv('diff-section-actions');

            const keepBtn = actions.createEl('button', {
                cls: 'diff-section-btn diff-section-keep', text: t('modal.diffReview.keep'),
            });
            const undoBtn = actions.createEl('button', {
                cls: 'diff-section-btn diff-section-undo', text: t('modal.diffReview.undo'),
            });
            const editBtn = actions.createEl('button', {
                cls: 'diff-section-btn diff-section-edit', text: t('modal.diffReview.edit'),
            });

            keepBtn.addEventListener('click', () => {
                group.status = 'approved';
                for (const h of groupHunks) h.status = 'approved';
                groupEl.removeClass('diff-group-rejected');
                groupEl.addClass('diff-group-approved');
                this.updateFooterState();
            });
            undoBtn.addEventListener('click', () => {
                group.status = 'rejected';
                for (const h of groupHunks) h.status = 'rejected';
                groupEl.removeClass('diff-group-approved');
                groupEl.addClass('diff-group-rejected');
                this.updateFooterState();
            });
            editBtn.addEventListener('click', () => {
                this.toggleSectionEditor(groupEl, group, file);
            });
        }

        // Diff lines body
        const body = groupEl.createDiv('diff-section-body');
        this.renderGroupDiffLines(body, group, file);
    }

    /** Render diff lines for all hunks within a semantic group (side-by-side) */
    private renderGroupDiffLines(container: HTMLElement, group: SemanticGroup, file: FileDiffState): void {
        // Use pre-computed hunk ranges — O(1) lookup per hunk instead of full scan
        const hunkRanges: HunkRange[] = [];
        for (const hId of group.hunkIds) {
            const range = file.hunkRangeMap.get(hId);
            if (range) hunkRanges.push(range);
        }

        if (hunkRanges.length === 0) return;

        // Build all DOM into a fragment, then append once (avoids per-element reflow)
        const frag = document.createDocumentFragment();

        for (let hi = 0; hi < hunkRanges.length; hi++) {
            const range = hunkRanges[hi];

            // Context between previous hunk and this one (within the group)
            if (hi > 0) {
                const prevEnd = hunkRanges[hi - 1].endDi;
                const gapStart = prevEnd + 1;
                const gapEnd = range.startDi - 1;
                if (gapEnd >= gapStart) {
                    const gapLines = file.diffLines.slice(gapStart, gapEnd + 1);
                    if (gapLines.length > CONTEXT_LINES * 2) {
                        const before = gapLines.slice(0, CONTEXT_LINES);
                        const middle = gapLines.slice(CONTEXT_LINES, -CONTEXT_LINES);
                        const after = gapLines.slice(-CONTEXT_LINES);
                        for (const l of before) this.renderContextRowTo(frag, l);
                        const btn = createEl('button', {
                            cls: 'diff-collapse-btn',
                            text: t('modal.diffReview.unchangedLines', { count: middle.length }),
                        });
                        const captured = middle;
                        btn.addEventListener('click', () => {
                            btn.remove();
                            for (const l of captured) this.renderContextRow(container, l);
                        });
                        frag.appendChild(btn);
                        for (const l of after) this.renderContextRowTo(frag, l);
                    } else {
                        for (const l of gapLines) this.renderContextRowTo(frag, l);
                    }
                }
            }

            // Side-by-side: pair removed (left) and added (right) lines
            const leftLines: (DiffLine | null)[] = [];
            const rightLines: (DiffLine | null)[] = [];
            for (const line of range.hunk.lines) {
                if (line.type === 'removed') leftLines.push(line);
                else if (line.type === 'added') rightLines.push(line);
            }

            const rows = Math.max(leftLines.length, rightLines.length);
            for (let r = 0; r < rows; r++) {
                const row = createDiv('diff-row');
                this.renderSide(row, leftLines[r] ?? null, 'old');
                this.renderSide(row, rightLines[r] ?? null, 'new');
                frag.appendChild(row);
            }
        }

        container.appendChild(frag);
    }

    /** Render one side (old/new) of a side-by-side diff row */
    private renderSide(row: HTMLElement, line: DiffLine | null, side: 'old' | 'new'): void {
        const sideEl = row.createDiv(`diff-side diff-side-${side}`);
        if (!line) {
            sideEl.addClass('diff-side-empty');
            return;
        }
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        const cls = line.type === 'added' ? 'diff-line-added'
            : line.type === 'removed' ? 'diff-line-removed'
                : 'diff-line-unchanged';
        sideEl.addClass(cls);
        sideEl.createSpan({ cls: 'diff-line-prefix', text: prefix });
        sideEl.createSpan({ cls: 'diff-line-content', text: line.content });
    }

    /** Render an unchanged context line as a side-by-side row (same text on both sides) */
    private renderContextRow(container: HTMLElement, line: DiffLine): void {
        const row = container.createDiv('diff-row');
        const left = row.createDiv('diff-side diff-side-old diff-line-unchanged');
        left.createSpan({ cls: 'diff-line-prefix', text: ' ' });
        left.createSpan({ cls: 'diff-line-content', text: line.content });
        const right = row.createDiv('diff-side diff-side-new diff-line-unchanged');
        right.createSpan({ cls: 'diff-line-prefix', text: ' ' });
        right.createSpan({ cls: 'diff-line-content', text: line.content });
    }

    /** Render context row into a DocumentFragment (batch mode) */
    private renderContextRowTo(frag: DocumentFragment, line: DiffLine): void {
        const row = createDiv('diff-row');
        const left = row.createDiv('diff-side diff-side-old diff-line-unchanged');
        left.createSpan({ cls: 'diff-line-prefix', text: ' ' });
        left.createSpan({ cls: 'diff-line-content', text: line.content });
        const right = row.createDiv('diff-side diff-side-new diff-line-unchanged');
        right.createSpan({ cls: 'diff-line-prefix', text: ' ' });
        right.createSpan({ cls: 'diff-line-content', text: line.content });
        frag.appendChild(row);
    }

    // =========================================================================
    // Section Editor (Textarea)
    // =========================================================================

    private toggleSectionEditor(groupEl: HTMLElement, group: SemanticGroup, file: FileDiffState): void {
        const existing = groupEl.querySelector('.diff-section-editor');
        if (existing) {
            existing.remove();
            group.isEditing = false;
            return;
        }

        group.isEditing = true;

        // Extract new-side content for this section
        const newLines = file.newContent.split('\n');
        const sectionContent = newLines.slice(group.newLineStart, group.newLineEnd + 1).join('\n');
        const content = group.editedContent ?? sectionContent;

        const editorContainer = groupEl.createDiv('diff-section-editor');

        const editorLabel = editorContainer.createDiv('diff-section-editor-label');
        editorLabel.setText(t('modal.diffReview.editLabel'));

        const textarea = editorContainer.createEl('textarea', {
            cls: 'diff-section-textarea',
        });
        textarea.value = content;
        textarea.rows = Math.min(Math.max(content.split('\n').length + 1, 3), 20);

        const editorFooter = editorContainer.createDiv('diff-section-editor-footer');

        const cancelBtn = editorFooter.createEl('button', {
            cls: 'diff-section-btn', text: t('modal.diffReview.cancelEdit'),
        });
        const applyBtn = editorFooter.createEl('button', {
            cls: 'diff-section-btn mod-cta', text: t('modal.diffReview.applyEdit'),
        });

        cancelBtn.addEventListener('click', () => {
            editorContainer.remove();
            group.isEditing = false;
        });

        applyBtn.addEventListener('click', () => {
            group.editedContent = textarea.value;
            group.status = 'approved';

            // Visual feedback
            groupEl.addClass('diff-group-approved');
            groupEl.removeClass('diff-group-rejected');

            // Close editor
            editorContainer.remove();
            group.isEditing = false;

            // Re-render diff body to show updated state
            const body = groupEl.querySelector('.diff-section-body');
            if (body) {
                body.empty();
                this.renderGroupDiffLines(body as HTMLElement, group, file);
            }

            this.updateFooterState();
        });
    }

    // =========================================================================
    // Footer
    // =========================================================================

    private renderFooter(container: HTMLElement): void {
        const footer = container.createDiv('diff-review-footer');

        if (this.options.mode === 'review') {
            const undoAllBtn = footer.createEl('button', {
                cls: 'diff-review-btn diff-review-reject-all', text: t('modal.diffReview.undoAll'),
            });
            undoAllBtn.addEventListener('click', () => {
                for (const file of this.files) {
                    for (const g of file.semanticGroups) g.status = 'rejected';
                    for (const h of file.hunks) h.status = 'rejected';
                }
                this.resolved = true;
                this.onResult?.(this.buildDecisions());
                this.close();
            });

            this.applyBtn = footer.createEl('button', {
                cls: 'diff-review-btn diff-review-accept-selected', text: t('modal.diffReview.applySelected'),
            });
            (this.applyBtn as HTMLButtonElement).disabled = true;
            this.applyBtn.addEventListener('click', () => {
                for (const file of this.files) {
                    for (const g of file.semanticGroups) {
                        if (g.status === 'pending') g.status = 'approved';
                    }
                    for (const h of file.hunks) {
                        if (h.status === 'pending') h.status = 'approved';
                    }
                }
                this.resolved = true;
                this.onResult?.(this.buildDecisions());
                this.close();
            });

            const keepAllBtn = footer.createEl('button', {
                cls: 'mod-cta diff-review-btn', text: t('modal.diffReview.keepAll'),
            });
            keepAllBtn.addEventListener('click', () => {
                this.resolved = true;
                this.onResult?.([]);
                this.close();
            });
        }

        if (this.options.mode === 'checkpoint') {
            footer.createEl('button', { text: t('modal.diffReview.close') })
                .addEventListener('click', () => {
                    this.resolved = true;
                    this.close();
                });

            if (this.options.onRestore) {
                const restoreBtn = footer.createEl('button', {
                    cls: 'mod-cta', text: t('modal.diffReview.restoreCheckpoint'),
                });
                restoreBtn.addEventListener('click', () => { void (async () => {
                    restoreBtn.setText(t('modal.diffReview.restoring'));
                    restoreBtn.disabled = true;
                    try {
                        await this.options.onRestore!();
                        restoreBtn.setText(t('modal.diffReview.restored'));
                        restoreBtn.addClass('checkpoint-restored');
                    } catch {
                        restoreBtn.setText(t('modal.diffReview.failed'));
                    }
                })(); });
            }
        }
    }

    private updateFooterState(): void {
        if (!this.applyBtn) return;
        const allGroups = this.files.flatMap((f) => f.semanticGroups);
        const hasDecision = allGroups.some((g) => g.status !== 'pending');
        const hasPending = allGroups.some((g) => g.status === 'pending');
        (this.applyBtn as HTMLButtonElement).disabled = !hasDecision || hasPending;
    }

    // =========================================================================
    // Decision building + content assembly
    // =========================================================================

    private buildDecisions(): FileDecision[] {
        const decisions: FileDecision[] = [];

        for (const file of this.files) {
            const hasRejectedOrEdited = file.semanticGroups.some(
                (g) => g.status === 'rejected' || g.editedContent !== undefined,
            );
            if (!hasRejectedOrEdited) continue;

            const finalContent = this.assembleFinalContent(file);
            decisions.push({
                filePath: file.filePath,
                finalContent,
                hasChanges: finalContent !== file.newContent,
            });
        }

        return decisions;
    }

    /**
     * Assemble final file content from hunk decisions and section edits.
     *
     * Two paths:
     * - Fast path: no edited groups → standard hunk-based assembly
     * - Edited path: tracks newLineIndex to splice in editedContent
     */
    private assembleFinalContent(file: FileDiffState): string {
        const hasEdits = file.semanticGroups.some((g) => g.editedContent !== undefined);
        if (!hasEdits) {
            return this.assembleFromHunks(file);
        }
        return this.assembleWithEdits(file);
    }

    /** Standard hunk-based assembly (no section edits) */
    private assembleFromHunks(file: FileDiffState): string {
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

    /** Assembly with section edits — tracks newLineIndex for edited ranges */
    private assembleWithEdits(file: FileDiffState): string {
        // Build edited ranges sorted by startLine
        const editedRanges: Array<{ start: number; end: number; content: string }> = [];
        for (const g of file.semanticGroups) {
            if (g.editedContent !== undefined) {
                editedRanges.push({ start: g.newLineStart, end: g.newLineEnd, content: g.editedContent });
            }
        }
        editedRanges.sort((a, b) => a.start - b.start);

        const resultLines: string[] = [];
        let newLineIndex = 0;
        let hunkIndex = 0;
        let currentChangedBlock: DiffLine[] = [];
        let editedRangeIdx = 0;
        const emittedRanges = new Set<number>();

        for (const line of file.diffLines) {
            const activeRange = editedRangeIdx < editedRanges.length
                ? editedRanges[editedRangeIdx]
                : null;

            if (line.type === 'unchanged') {
                // Flush pending changed block
                if (currentChangedBlock.length > 0) {
                    if (!activeRange || newLineIndex < activeRange.start || newLineIndex > activeRange.end) {
                        this.flushHunk(resultLines, currentChangedBlock, file.hunks, hunkIndex);
                    }
                    hunkIndex++;
                    currentChangedBlock = [];
                }

                if (activeRange && newLineIndex >= activeRange.start && newLineIndex <= activeRange.end) {
                    // Inside edited range — emit once, skip rest
                    if (!emittedRanges.has(editedRangeIdx)) {
                        resultLines.push(...activeRange.content.split('\n'));
                        emittedRanges.add(editedRangeIdx);
                    }
                    if (newLineIndex >= activeRange.end) editedRangeIdx++;
                } else {
                    resultLines.push(line.content);
                }
                newLineIndex++;
            } else if (line.type === 'added') {
                if (activeRange && newLineIndex >= activeRange.start && newLineIndex <= activeRange.end) {
                    if (!emittedRanges.has(editedRangeIdx)) {
                        resultLines.push(...activeRange.content.split('\n'));
                        emittedRanges.add(editedRangeIdx);
                    }
                    if (newLineIndex >= activeRange.end) editedRangeIdx++;
                    newLineIndex++;
                    continue;
                }
                currentChangedBlock.push(line);
                newLineIndex++;
            } else {
                // 'removed' — don't advance newLineIndex
                if (activeRange && newLineIndex >= activeRange.start && newLineIndex <= activeRange.end) {
                    continue; // Skip removed lines inside edited ranges
                }
                currentChangedBlock.push(line);
            }
        }

        // Flush trailing
        if (currentChangedBlock.length > 0) {
            this.flushHunk(resultLines, currentChangedBlock, file.hunks, hunkIndex);
        }

        return resultLines.join('\n');
    }

    private flushHunk(resultLines: string[], block: DiffLine[], hunks: DiffHunk[], hunkIndex: number): void {
        if (hunkIndex >= hunks.length) return;
        const hunk = hunks[hunkIndex];

        if (hunk.status === 'rejected') {
            for (const h of block) {
                if (h.type === 'removed') resultLines.push(h.content);
            }
        } else {
            for (const h of hunk.lines) {
                if (h.type === 'added') resultLines.push(h.content);
            }
        }
    }
}
