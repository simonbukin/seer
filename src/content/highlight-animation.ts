/**
 * Highlight animation module - creates fade-in animations when words are first highlighted
 * Uses temporary overlay spans since CSS Custom Highlight API has limited animation support
 */

const ANIMATION_DURATION_MS = 300;
const ANIMATION_COLOR = 'rgba(96, 165, 250, 0.4)';

/**
 * Animate a newly highlighted word with a simple fade-in effect
 */
export function animateNewHighlight(textNode: Text, startOffset: number, endOffset: number): void {
  const parent = textNode.parentElement;
  if (!parent) return;

  // Create a temporary range to get bounding rect
  const range = document.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);

  const rect = range.getBoundingClientRect();
  range.detach();

  // Skip if rect is not visible or too small
  if (rect.width === 0 || rect.height === 0) return;

  // Create overlay element for fade-in animation
  const overlay = document.createElement('span');
  overlay.className = 'seer-highlight-animation';
  overlay.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    pointer-events: none;
    z-index: 9998;
    border-radius: 2px;
    background: ${ANIMATION_COLOR};
    animation: seer-fade-in ${ANIMATION_DURATION_MS}ms ease-out forwards;
    will-change: opacity;
  `;

  document.body.appendChild(overlay);

  // Remove after animation completes
  setTimeout(() => {
    overlay.remove();
  }, ANIMATION_DURATION_MS);
}

/**
 * Batch animate multiple highlights (for performance when many words are highlighted at once)
 * Uses requestAnimationFrame to avoid layout thrashing
 */
export function animateNewHighlights(
  highlights: Array<{ textNode: Text; startOffset: number; endOffset: number }>
): void {
  if (highlights.length === 0) return;

  // Limit animations to avoid overwhelming the browser
  const maxAnimations = 50;
  const toAnimate = highlights.slice(0, maxAnimations);

  requestAnimationFrame(() => {
    for (const { textNode, startOffset, endOffset } of toAnimate) {
      animateNewHighlight(textNode, startOffset, endOffset);
    }
  });
}
