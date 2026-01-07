/**
 * Type declarations for CSS Custom Highlight API
 *
 * The CSS Custom Highlight API allows JavaScript to create and manage
 * custom highlight objects that can be styled using CSS ::highlight() pseudo-element.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
 */

/**
 * Data returned from CSS.highlights.highlightsFromPoint()
 * This is an experimental API not yet in TypeScript's lib.dom.d.ts
 */
interface HighlightFromPointData {
  highlight: Highlight;
  ranges: Range[];
}

/**
 * Extended CSSHighlights interface with experimental methods
 */
interface ExtendedHighlightRegistry {
  /**
   * Returns highlights at a given screen coordinate
   * @experimental This is a non-standard experimental API
   */
  highlightsFromPoint(x: number, y: number): HighlightFromPointData[];
}

declare global {
  interface CSS {
    highlights: HighlightRegistry & ExtendedHighlightRegistry;
  }

  /**
   * Represents a collection of Range objects that can be styled using CSS ::highlight()
   */
  interface Highlight extends Set<Range> {
    /** Priority for stacking order when multiple highlights overlap */
    priority: number;
    /** Type of highlight - can be used for styling purposes */
    type: 'highlight' | 'spelling-error' | 'grammar-error';
  }

  /**
   * Constructor for Highlight objects
   */
  interface HighlightConstructor {
    new (...ranges: Range[]): Highlight;
    prototype: Highlight;
  }

  var Highlight: HighlightConstructor;

  /**
   * Registry for managing named highlights
   */
  interface HighlightRegistry extends Map<string, Highlight> {
    /** Sets a highlight with a given name */
    set(name: string, highlight: Highlight): this;
    /** Gets a highlight by name */
    get(name: string): Highlight | undefined;
    /** Checks if a highlight with the given name exists */
    has(name: string): boolean;
    /** Deletes a highlight by name */
    delete(name: string): boolean;
    /** Clears all highlights */
    clear(): void;
  }
}

export {};
