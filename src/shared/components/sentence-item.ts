/**
 * Unified SentenceItem component for consistent sentence display across all surfaces.
 * Used in: Sidepanel (i+1 sentences), Dashboard (i+1 mining), Options (sentence search)
 */

import { escapeHtml } from './word-item';

export interface SentenceItemProps {
  text: string;
  targetWord: string;
  targetWords?: string[];  // For i+2/i+3 sentences with multiple unknowns
  url: string;
  pageTitle?: string;
  timestamp?: number;
  compact?: boolean;
  showCopy?: boolean;
  showActions?: boolean;
  clickable?: boolean;
}

/**
 * Escape regex special characters for safe use in RegExp
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight target word(s) in sentence text
 */
export function highlightWord(text: string, word: string): string {
  const escapedWord = escapeRegExp(word);
  const regex = new RegExp(`(${escapedWord})`, 'g');
  return escapeHtml(text).replace(regex, '<mark>$1</mark>');
}

/**
 * Highlight multiple target words in sentence text
 */
export function highlightWords(text: string, words: string[]): string {
  let result = escapeHtml(text);
  for (const word of words) {
    const escapedWord = escapeRegExp(word);
    const regex = new RegExp(`(${escapedWord})`, 'g');
    result = result.replace(regex, '<mark>$1</mark>');
  }
  return result;
}

/**
 * Format a URL for display (extract hostname)
 */
function formatUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Render a sentence item with consistent styling
 */
export function renderSentenceItem(props: SentenceItemProps): string {
  const {
    text,
    targetWord,
    targetWords,
    url,
    pageTitle,
    timestamp,
    compact = false,
    showCopy = true,
    showActions = false,
    clickable = true,
  } = props;

  const allTargets = targetWords || [targetWord];
  const highlightedText = highlightWords(text, allTargets);
  const displayUrl = pageTitle || formatUrl(url);
  const compactClass = compact ? 'compact' : '';
  const clickableClass = clickable ? 'clickable' : '';

  // Format timestamp if provided
  let timeStr = '';
  if (timestamp) {
    const date = new Date(timestamp);
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays < 1) {
      const hours = Math.floor(diffMs / 3600000);
      timeStr = hours < 1 ? 'just now' : `${hours}h ago`;
    } else if (diffDays < 7) {
      timeStr = `${diffDays}d ago`;
    } else {
      timeStr = date.toLocaleDateString();
    }
  }

  return `
    <div class="seer-sentence-item ${compactClass} ${clickableClass}"
         data-url="${escapeHtml(url)}"
         data-sentence="${escapeHtml(text)}"
         data-target="${escapeHtml(targetWord)}">
      <div class="seer-sentence-text">${highlightedText}</div>
      <div class="seer-sentence-meta">
        <span class="seer-sentence-target">${escapeHtml(allTargets.join(', '))}</span>
        <a class="seer-sentence-source" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(displayUrl)}</a>
        ${timeStr ? `<span class="seer-sentence-time">${timeStr}</span>` : ''}
        ${showCopy ? `
          <button class="seer-sentence-copy" data-sentence="${escapeHtml(text)}" title="Copy sentence">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        ` : ''}
      </div>
      ${showActions ? `
        <div class="seer-sentence-actions">
          <button class="seer-action-btn seer-action-known" data-action="known" data-word="${escapeHtml(targetWord)}" title="Mark target as Known">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="seer-action-btn seer-action-ignore" data-action="ignore" data-word="${escapeHtml(targetWord)}" title="Ignore target">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Attach event listeners to sentence items in a container
 */
export function attachSentenceItemListeners(
  container: HTMLElement,
  handlers: {
    onClick?: (url: string, sentence: string) => void;
    onCopy?: (sentence: string) => void;
    onMarkKnown?: (word: string) => Promise<void>;
    onIgnore?: (word: string) => Promise<void>;
  }
): void {
  // Handle copy button clicks
  container.querySelectorAll('.seer-sentence-copy').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const button = e.currentTarget as HTMLButtonElement;
      const sentence = button.dataset.sentence;
      if (!sentence) return;

      try {
        await navigator.clipboard.writeText(sentence);
        button.classList.add('copied');
        if (handlers.onCopy) handlers.onCopy(sentence);
        setTimeout(() => button.classList.remove('copied'), 1500);
      } catch (err) {
        console.error('[Seer] Failed to copy:', err);
      }
    });
  });

  // Handle action button clicks
  container.querySelectorAll('.seer-sentence-actions .seer-action-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const button = e.currentTarget as HTMLButtonElement;
      const word = button.dataset.word;
      const action = button.dataset.action;
      if (!word) return;

      const item = button.closest('.seer-sentence-item') as HTMLElement;

      try {
        if (action === 'known' && handlers.onMarkKnown) {
          button.classList.add('loading');
          await handlers.onMarkKnown(word);
          item?.classList.add('marked');
        } else if (action === 'ignore' && handlers.onIgnore) {
          button.classList.add('loading');
          await handlers.onIgnore(word);
          item?.classList.add('marked');
        }
      } catch (err) {
        console.error(`[Seer] Failed to ${action} word:`, err);
        button.classList.add('error');
        setTimeout(() => button.classList.remove('error'), 1000);
      } finally {
        button.classList.remove('loading');
      }
    });
  });

  // Handle source link clicks (prevent default navigation if handler exists)
  container.querySelectorAll('.seer-sentence-source').forEach((link) => {
    link.addEventListener('click', (e) => {
      // Let the link work normally - opens in new tab
    });
  });

  // Handle item click (for scroll-to-sentence or navigation)
  if (handlers.onClick) {
    container.querySelectorAll('.seer-sentence-item.clickable').forEach((item) => {
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking buttons or links
        const target = e.target as HTMLElement;
        if (target.closest('.seer-sentence-copy') ||
            target.closest('.seer-sentence-source') ||
            target.closest('.seer-sentence-actions')) return;

        const el = item as HTMLElement;
        const url = el.dataset.url;
        const sentence = el.dataset.sentence;
        if (url && sentence) handlers.onClick!(url, sentence);
      });
    });
  }
}
