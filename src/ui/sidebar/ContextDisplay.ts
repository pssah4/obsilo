/**
 * ContextDisplay - Visual progress bar for context window usage
 * Adapted from Kilo Code's ContextWindowProgress component
 */

import { setIcon } from 'obsidian';
import type { ContextUsage } from '../../core/context/ContextTracker';

export class ContextDisplay {
    private container: HTMLElement | null = null;
    private barCurrent: HTMLElement | null = null;
    private barReserved: HTMLElement | null = null;
    private barAvailable: HTMLElement | null = null;
    private labelLeft: HTMLElement | null = null;
    private labelRight: HTMLElement | null = null;
    private tooltipContent: HTMLElement | null = null;
    private condenseButton: HTMLElement | null = null;
    private onCondenseClick: (() => void) | null = null;
    private buttonsDisabled = false;

    build(parent: HTMLElement, onCondense?: () => void): HTMLElement {
        this.onCondenseClick = onCondense ?? null;
        // Main container
        this.container = parent.createDiv('context-display-container');

        // Label row
        const labelRow = this.container.createDiv('context-display-labels');
        this.labelLeft = labelRow.createSpan('context-label-left');
        this.labelRight = labelRow.createSpan('context-label-right');

        // Progress bar (with wrapper for button positioning)
        const barWrapper = this.container.createDiv('context-progress-bar-wrapper');
        const barContainer = barWrapper.createDiv('context-progress-bar');
        this.barCurrent = barContainer.createDiv('context-segment-current');
        this.barReserved = barContainer.createDiv('context-segment-reserved');
        this.barAvailable = barContainer.createDiv('context-segment-available');

        // Condense button (always visible, but can be disabled)
        if (this.onCondenseClick) {
            this.condenseButton = barWrapper.createDiv('context-condense-button');
            this.condenseButton.title = 'Condense context';
            setIcon(this.condenseButton, 'fold-vertical');
            this.condenseButton.addEventListener('click', () => {
                if (this.onCondenseClick && !this.buttonsDisabled) {
                    this.onCondenseClick();
                }
            });
        }

        // Tooltip (hover on bar)
        // L-1: CSS class instead of inline style for display toggle
        this.tooltipContent = this.container.createDiv('context-tooltip agent-u-hidden');

        barContainer.addEventListener('mouseenter', () => {
            if (this.tooltipContent) this.tooltipContent.removeClass('agent-u-hidden');
        });
        barContainer.addEventListener('mouseleave', () => {
            if (this.tooltipContent) this.tooltipContent.addClass('agent-u-hidden');
        });

        return this.container;
    }

    update(usage: ContextUsage, color: 'green' | 'yellow' | 'red', buttonsDisabled = false): void {
        if (!this.container) return;

        this.buttonsDisabled = buttonsDisabled;
        const { tokensUsed, maxTokens, reservedForOutput, availableSize } = usage;

        // Update labels
        if (this.labelLeft) {
            this.labelLeft.setText(this.formatNumber(tokensUsed));
        }
        if (this.labelRight) {
            this.labelRight.setText(this.formatNumber(maxTokens));
        }

        // Calculate distribution
        const total = tokensUsed + reservedForOutput + availableSize;
        const currentPercent = total > 0 ? (tokensUsed / total) * 100 : 0;
        const reservedPercent = total > 0 ? (reservedForOutput / total) * 100 : 0;
        const availablePercent = total > 0 ? (availableSize / total) * 100 : 0;

        // L-1: style.setProperty() instead of inline style for dynamic widths
        if (this.barCurrent) {
            this.barCurrent.style.setProperty('width', `${currentPercent}%`);
        }
        if (this.barReserved) {
            this.barReserved.style.setProperty('width', `${reservedPercent}%`);
        }
        if (this.barAvailable) {
            this.barAvailable.style.setProperty('width', `${availablePercent}%`);
        }

        // Update color
        this.container.removeClass('context-green', 'context-yellow', 'context-red');
        this.container.addClass(`context-${color}`);

        // Update condense button state (disable if < 60% or buttons disabled)
        if (this.condenseButton) {
            const percentage = maxTokens > 0 ? (tokensUsed / maxTokens) * 100 : 0;
            const shouldDisable = buttonsDisabled || percentage < 60;

            if (shouldDisable) {
                this.condenseButton.classList.add('context-condense-button-disabled');
                this.condenseButton.title = buttonsDisabled
                    ? 'Context condensing unavailable during task execution'
                    : 'Context condensing available when usage exceeds 60%';
            } else {
                this.condenseButton.classList.remove('context-condense-button-disabled');
                this.condenseButton.title = 'Condense context';
            }
        }

        // Update tooltip
        if (this.tooltipContent) {
            this.tooltipContent.empty();
            this.tooltipContent.createDiv().setText(
                `Tokens used: ${this.formatNumber(tokensUsed)} / ${this.formatNumber(maxTokens)}`
            );
            if (reservedForOutput > 0) {
                this.tooltipContent.createDiv().setText(
                    `Reserved for response: ${this.formatNumber(reservedForOutput)}`
                );
            }
            if (availableSize > 0) {
                this.tooltipContent.createDiv().setText(
                    `Available space: ${this.formatNumber(availableSize)}`
                );
            }
        }
    }

    // L-1: CSS class instead of inline style for show/hide
    show(): void {
        if (this.container) this.container.removeClass('agent-u-hidden');
    }

    hide(): void {
        if (this.container) this.container.addClass('agent-u-hidden');
    }

    private formatNumber(num: number): string {
        if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
        if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
        return num.toString();
    }
}
