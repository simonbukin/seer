import type { HighlightConfig, HighlightLayerConfig, ProcessedToken } from '../shared/types';
import { ALL_LAYER_IDS, getFrequencyLayerId, getStatusLayerId, getKnowledgeLayerId, type LayerId } from '../shared/highlight-defaults';
import { injectLayerStyles, toggleLayerCSS, updateLayerStyle, removeLayerStyles } from './layer-styles';
import { setTokenForRange, getRangesForWord, clearWordRanges } from './highlighter';
import { animateNewHighlight } from './highlight-animation';
import { logger } from '../shared/logger';

/**
 * LayerManager handles all CSS Highlight API registrations and range assignments.
 * Each layer gets its own Highlight instance that can have ranges added to it.
 */
export class LayerManager {
  private highlights: Map<LayerId, Highlight> = new Map();
  private config: HighlightConfig | null = null;

  /**
   * Initialize all highlight layers and register with CSS.highlights
   */
  initialize(config: HighlightConfig): void {
    this.config = config;

    // Check for CSS Highlight API support
    if (!CSS.highlights) {
      logger.layer.warn('CSS Custom Highlight API not supported');
      return;
    }

    // Create and register a Highlight instance for each layer
    for (const layerId of ALL_LAYER_IDS) {
      const highlight = new Highlight();
      this.highlights.set(layerId, highlight);
      CSS.highlights.set(`seer-${layerId}`, highlight);
    }

    // Inject CSS styles
    injectLayerStyles(config);
  }

  /**
   * Toggle a layer on/off (CSS-only, O(1) operation)
   */
  toggleLayer(layerId: LayerId, enabled: boolean): void {
    if (!this.config) return;

    const layer = this.config.layers[layerId];
    if (!layer) return;

    // Update config
    layer.enabled = enabled;

    // Update CSS only (no need to re-add ranges)
    toggleLayerCSS(layerId, enabled, layer);
  }

  /**
   * Update a layer's style configuration
   */
  updateLayerConfig(layerId: LayerId, updates: Partial<HighlightLayerConfig>): void {
    if (!this.config) return;

    const layer = this.config.layers[layerId];
    if (!layer) return;

    // Merge updates
    Object.assign(layer, updates);

    // Regenerate CSS for this layer
    updateLayerStyle(layerId, layer);
  }

  /**
   * Update the entire config (e.g., after loading from storage)
   */
  updateConfig(config: HighlightConfig): void {
    this.config = config;
    injectLayerStyles(config);
  }

  /**
   * Get a Highlight instance for adding ranges
   */
  getHighlight(layerId: LayerId): Highlight | undefined {
    return this.highlights.get(layerId);
  }

  /**
   * Get the current config
   */
  getConfig(): HighlightConfig | null {
    return this.config;
  }

  /**
   * Clear all ranges from all highlights
   */
  clearAll(): void {
    for (const highlight of this.highlights.values()) {
      highlight.clear();
    }
  }

  /**
   * Remove highlights for a specific word (surgical removal for instant ignore)
   * Returns the number of ranges removed
   */
  removeWordHighlights(baseForm: string): number {
    const ranges = getRangesForWord(baseForm);
    if (!ranges) return 0;

    let removed = 0;
    for (const range of ranges) {
      for (const highlight of this.highlights.values()) {
        if (highlight.has(range)) {
          highlight.delete(range);
          removed++;
        }
      }
    }
    clearWordRanges(baseForm);
    return removed;
  }

  /**
   * Assign a token to all applicable layers
   * Creates ranges for status, frequency, and knowledge layers
   * @param animate - If true, trigger a sweep animation for unknown words
   */
  assignToken(token: ProcessedToken, textNode: Text, startOffset: number, endOffset: number, animate = false): void {
    if (!CSS.highlights) return;

    // Create a range for this token and store token metadata
    const createRange = () => {
      const range = new Range();
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);
      setTokenForRange(range, token);  // Store for word actions
      return range;
    };

    // Status layer (bottom)
    const statusId = getStatusLayerId(token.status);
    const statusHighlight = this.highlights.get(statusId);
    if (statusHighlight) {
      statusHighlight.add(createRange());
    }

    // Frequency layer (middle) - only for words with frequency data
    if (token.frequency !== undefined) {
      const freqId = getFrequencyLayerId(token.frequency);
      if (freqId) {
        const freqHighlight = this.highlights.get(freqId);
        if (freqHighlight) {
          freqHighlight.add(createRange());
        }
      }
    }

    // Knowledge level layer - only for tokens with knowledge data
    if (token.knowledgeLevel) {
      const knowledgeId = getKnowledgeLayerId(token.knowledgeLevel);
      const knowledgeHighlight = this.highlights.get(knowledgeId);
      if (knowledgeHighlight) {
        knowledgeHighlight.add(createRange());
      }
    }

    // Trigger animation for unknown words on initial highlight
    if (animate && token.status === 'unknown') {
      animateNewHighlight(textNode, startOffset, endOffset);
    }
  }

  /**
   * Clean up - remove all highlights and styles
   */
  destroy(): void {
    // Clear CSS.highlights
    if (CSS.highlights) {
      for (const layerId of ALL_LAYER_IDS) {
        CSS.highlights.delete(`seer-${layerId}`);
      }
    }

    this.highlights.clear();
    removeLayerStyles();
    this.config = null;
  }
}

// Singleton instance
export const layerManager = new LayerManager();
