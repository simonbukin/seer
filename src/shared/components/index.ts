/**
 * Shared Seer Components
 *
 * Unified component library for consistent UI across all surfaces:
 * - Sidepanel (current page analysis)
 * - Dashboard (global analytics)
 * - Options (settings)
 */

// Word item component
export {
  type WordItemProps,
  renderWordItem,
  attachWordItemListeners,
  renderKnowledgeBadge,
  renderStatusBadge,
  escapeHtml,
  getRelativeTime,
} from './word-item';

// Sentence item component
export {
  type SentenceItemProps,
  renderSentenceItem,
  attachSentenceItemListeners,
  highlightWord,
  highlightWords,
} from './sentence-item';
