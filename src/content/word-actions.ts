import { getTokenForRange } from './highlighter';
import type { ProcessedToken } from '../shared/types';
// CSS Highlight API types are available globally from css-highlight-types.d.ts
import { logger } from '../shared/logger';

export class WordActionHandler {
  private currentToken: ProcessedToken | null = null;
  private currentRange: Range | null = null;
  private hoverOverlay: HTMLElement | null = null;
  private shiftHeld: boolean = false;

  constructor(
    private onIgnore: (baseForm: string) => Promise<void>,
    private onMarkKnown: (baseForm: string) => Promise<void>
  ) {
    // Check if highlightsFromPoint is available
    if (CSS.highlights && 'highlightsFromPoint' in CSS.highlights) {
      logger.wordActions.debug('Using hover + keyboard for word actions');
      this.setupListeners();
    } else {
      logger.wordActions.warn('highlightsFromPoint not available, word actions disabled');
    }
  }

  private setupListeners() {
    // Use mousemove to track which word is under cursor
    document.addEventListener('mousemove', this.handleMouseMove, { passive: true });

    // Keyboard shortcuts and shift tracking
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  private handleMouseMove = (e: MouseEvent) => {
    // Check if highlightsFromPoint is available
    if (!CSS.highlights?.highlightsFromPoint) {
      return;
    }

    // Track shift state from mouse event
    this.shiftHeld = e.shiftKey;

    // Get highlights at cursor position (uses typed ExtendedHighlightRegistry)
    const highlights = CSS.highlights.highlightsFromPoint(e.clientX, e.clientY);

    // Filter to only our Seer frequency highlights (ignore POS highlights)
    let hoveredRange: Range | null = null;
    for (const highlightData of highlights) {
      const { highlight, ranges } = highlightData;

      // Check if this is a Seer frequency highlight (not POS)
      for (const [name, h] of CSS.highlights.entries()) {
        if (name.startsWith('seer-') && !name.startsWith('seer-pos-') && highlight === h) {
          // Use the first range at this position
          if (ranges.length > 0) {
            hoveredRange = ranges[0];
            break;
          }
        }
      }
      if (hoveredRange) break;
    }

    // If no highlight under cursor, clear current token
    if (!hoveredRange) {
      this.currentToken = null;
      this.currentRange = null;
      this.clearHoverIndicator();
      return;
    }

    // Get the token from the hovered range
    const token = getTokenForRange(hoveredRange);
    if (!token) {
      this.currentToken = null;
      this.currentRange = null;
      this.clearHoverIndicator();
      return;
    }

    // Update current token
    this.currentToken = token;
    this.currentRange = hoveredRange;

    // Only show indicator when Shift is held
    if (this.shiftHeld) {
      this.showHoverIndicator();
    } else {
      this.clearHoverIndicator();
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    // Track shift state and show indicator if hovering a word
    if (e.key === 'Shift') {
      this.shiftHeld = true;
      if (this.currentToken && this.currentRange) {
        this.showHoverIndicator();
      }
      return;
    }

    if (!this.currentToken) return;

    // Ignore if in input field
    if (this.isInInputField()) return;

    switch (e.key.toLowerCase()) {
      case 'i': // Ignore this word (base form)
        e.preventDefault();
        this.ignoreCurrentWord();
        break;
      case 'k': // Mark as known (base form)
        e.preventDefault();
        this.markCurrentWordKnown();
        break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      this.shiftHeld = false;
      this.clearHoverIndicator();
    }
  };

  private async ignoreCurrentWord() {
    if (!this.currentToken) return;

    const baseForm = this.currentToken.baseForm;
    const surface = this.currentToken.surface;

    try {
      await this.onIgnore(baseForm);
      this.showFeedback(`Ignored: ${surface} (${baseForm})`);
      this.currentToken = null;
      this.currentRange = null;
      this.clearHoverIndicator();
    } catch (e) {
      this.showFeedback(`Failed: ${e}`, true);
    }
  }

  private async markCurrentWordKnown() {
    if (!this.currentToken) return;

    const baseForm = this.currentToken.baseForm;
    const surface = this.currentToken.surface;

    try {
      await this.onMarkKnown(baseForm);
      this.showFeedback(`Known: ${surface} (${baseForm})`);
      this.currentToken = null;
      this.currentRange = null;
      this.clearHoverIndicator();
    } catch (e) {
      this.showFeedback(`Failed: ${e}`, true);
    }
  }

  private showHoverIndicator() {
    // Create and position overlay + tooltip
    this.createHoverElements();
    this.updateHoverPosition();
  }

  private clearHoverIndicator() {
    if (this.hoverOverlay) {
      this.hoverOverlay.style.display = 'none';
    }
  }

  private showFeedback(message: string, isError = false) {
    const existing = document.querySelector('.seer-toast');
    existing?.remove();

    const toast = document.createElement('div');
    toast.className = `seer-toast ${isError ? 'seer-toast-error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 2000);
  }

  private isInInputField(): boolean {
    const active = document.activeElement;
    if (!active) return false;

    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if ((active as HTMLElement).isContentEditable) return true;

    return false;
  }

  private createHoverElements(): void {
    if (!this.hoverOverlay) {
      this.hoverOverlay = document.createElement('div');
      this.hoverOverlay.className = 'seer-hover-overlay';
      this.hoverOverlay.setAttribute('data-seer-ignore', 'true');
      document.body.appendChild(this.hoverOverlay);
    }
  }

  private updateHoverPosition(): void {
    if (!this.currentRange || !this.currentToken) return;

    const rect = this.currentRange.getBoundingClientRect();

    if (this.hoverOverlay) {
      this.hoverOverlay.style.left = `${rect.left - 2}px`;
      this.hoverOverlay.style.top = `${rect.top - 2}px`;
      this.hoverOverlay.style.width = `${rect.width + 4}px`;
      this.hoverOverlay.style.height = `${rect.height + 4}px`;
      this.hoverOverlay.style.display = 'block';
    }
  }

  destroy() {
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    this.clearHoverIndicator();

    this.hoverOverlay?.remove();
    this.hoverOverlay = null;
  }
}
