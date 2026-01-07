/**
 * Writing mode detection utilities for vertical Japanese text (tategaki) support
 *
 * Japanese can be written:
 * - horizontal-tb: Horizontal, left-to-right (modern default)
 * - vertical-rl: Vertical, columns right-to-left (traditional)
 * - vertical-lr: Vertical, columns left-to-right (less common)
 */

export type WritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' | 'sideways-rl' | 'sideways-lr';

/**
 * Check if an element uses vertical writing mode
 */
export function isVerticalWritingMode(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const writingMode = style.writingMode as WritingMode;

  return (
    writingMode === 'vertical-rl' ||
    writingMode === 'vertical-lr' ||
    writingMode === 'sideways-rl' ||
    writingMode === 'sideways-lr'
  );
}

/**
 * Get the writing mode for an element
 */
export function getWritingMode(element: Element): WritingMode {
  const style = window.getComputedStyle(element);
  return (style.writingMode || 'horizontal-tb') as WritingMode;
}

/**
 * Get the writing mode for a text node (via its parent element)
 */
export function getTextNodeWritingMode(textNode: Text): WritingMode {
  const parent = textNode.parentElement;
  if (!parent) return 'horizontal-tb';
  return getWritingMode(parent);
}

/**
 * Check if a text node is in vertical writing mode
 */
export function isTextNodeVertical(textNode: Text): boolean {
  const parent = textNode.parentElement;
  if (!parent) return false;
  return isVerticalWritingMode(parent);
}
