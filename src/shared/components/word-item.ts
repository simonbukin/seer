/**
 * Unified WordItem component for consistent word display across all surfaces.
 * Used in: Sidepanel, Dashboard, Options (vocabulary)
 */

import type { KnowledgeLevel } from '../types';

export interface WordItemProps {
  word: string;
  surface?: string;
  count: number;
  frequency?: number;
  knowledgeLevel?: KnowledgeLevel;
  status: 'known' | 'unknown' | 'ignored';
  suspended?: boolean;
  pages?: number;
  lastSeen?: number;
  compact?: boolean;
  showActions?: boolean;
}

// Knowledge level badge colors
const KNOWLEDGE_COLORS: Record<KnowledgeLevel, { bg: string; text: string; darkBg: string; darkText: string }> = {
  mature: { bg: 'rgba(134, 239, 172, 0.5)', text: '#166534', darkBg: 'rgba(134, 239, 172, 0.3)', darkText: '#86efac' },
  young: { bg: 'rgba(147, 197, 253, 0.5)', text: '#1e40af', darkBg: 'rgba(147, 197, 253, 0.3)', darkText: '#93c5fd' },
  learning: { bg: 'rgba(253, 186, 116, 0.5)', text: '#92400e', darkBg: 'rgba(253, 186, 116, 0.3)', darkText: '#fdba74' },
  new: { bg: 'rgba(196, 181, 253, 0.5)', text: '#5b21b6', darkBg: 'rgba(196, 181, 253, 0.3)', darkText: '#c4b5fd' },
};

// Status badge colors
const STATUS_COLORS: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  known: { bg: 'rgba(34, 197, 94, 0.2)', text: '#166534', darkBg: 'rgba(34, 197, 94, 0.25)', darkText: '#4ade80' },
  unknown: { bg: 'rgba(239, 68, 68, 0.2)', text: '#991b1b', darkBg: 'rgba(239, 68, 68, 0.25)', darkText: '#f87171' },
  ignored: { bg: 'rgba(156, 163, 175, 0.2)', text: '#4b5563', darkBg: 'rgba(156, 163, 175, 0.25)', darkText: '#9ca3af' },
  suspended: { bg: 'rgba(250, 204, 21, 0.3)', text: '#854d0e', darkBg: 'rgba(250, 204, 21, 0.25)', darkText: '#fbbf24' },
};

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format relative time from timestamp
 */
export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Render a knowledge level badge
 */
export function renderKnowledgeBadge(level?: KnowledgeLevel, suspended?: boolean): string {
  if (suspended) {
    const colors = STATUS_COLORS.suspended;
    return `<span class="seer-badge seer-badge-suspended" style="background:${colors.bg};color:${colors.text}">suspended</span>`;
  }

  if (!level) return '';

  const colors = KNOWLEDGE_COLORS[level];
  return `<span class="seer-badge seer-badge-knowledge seer-badge-${level}" style="background:${colors.bg};color:${colors.text}">${level}</span>`;
}

/**
 * Render a status badge
 */
export function renderStatusBadge(status: string): string {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  return `<span class="seer-badge seer-badge-status seer-badge-${status}" style="background:${colors.bg};color:${colors.text}">${status}</span>`;
}

/**
 * Render a word item with consistent styling
 */
export function renderWordItem(props: WordItemProps): string {
  const {
    word,
    surface,
    count,
    frequency,
    knowledgeLevel,
    status,
    suspended,
    pages,
    lastSeen,
    compact = false,
    showActions = true,
  } = props;

  const showSurface = surface && surface !== word;
  const compactClass = compact ? 'compact' : '';

  // Build meta info string (only shown in full mode)
  const metaParts: string[] = [];
  metaParts.push(`${count}×`);
  if (pages !== undefined && !compact) metaParts.push(`${pages} page${pages !== 1 ? 's' : ''}`);
  if (frequency && !compact) metaParts.push(`rank ${frequency.toLocaleString()}`);
  if (lastSeen !== undefined && !compact) metaParts.push(getRelativeTime(lastSeen));

  return `
    <div class="seer-word-item ${compactClass}" data-word="${escapeHtml(word)}">
      <div class="seer-word-main">
        <span class="seer-word-text">${escapeHtml(word)}</span>
        ${showSurface ? `<span class="seer-word-surface">(${escapeHtml(surface!)})</span>` : ''}
      </div>
      <div class="seer-word-meta">
        ${metaParts.join(' · ')}
      </div>
      <div class="seer-word-badges">
        ${renderKnowledgeBadge(knowledgeLevel, suspended)}
        ${renderStatusBadge(status)}
      </div>
      ${showActions ? `
        <div class="seer-word-actions">
          <button class="seer-action-btn seer-action-known" data-action="known" data-word="${escapeHtml(word)}" title="Mark as Known (K)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="seer-action-btn seer-action-ignore" data-action="ignore" data-word="${escapeHtml(word)}" title="Ignore (I)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Attach event listeners to word items in a container
 */
export function attachWordItemListeners(
  container: HTMLElement,
  handlers: {
    onMarkKnown?: (word: string) => Promise<void>;
    onIgnore?: (word: string) => Promise<void>;
    onClick?: (word: string) => void;
  }
): void {
  // Handle action button clicks
  container.querySelectorAll('.seer-action-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const button = e.currentTarget as HTMLButtonElement;
      const word = button.dataset.word;
      const action = button.dataset.action;
      if (!word) return;

      // Visual feedback
      const item = button.closest('.seer-word-item') as HTMLElement;

      try {
        if (action === 'known' && handlers.onMarkKnown) {
          button.classList.add('loading');
          await handlers.onMarkKnown(word);
          item?.classList.add('marked', 'marked-known');
        } else if (action === 'ignore' && handlers.onIgnore) {
          button.classList.add('loading');
          await handlers.onIgnore(word);
          item?.classList.add('marked', 'marked-ignored');
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

  // Handle item click
  if (handlers.onClick) {
    container.querySelectorAll('.seer-word-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking action buttons
        if ((e.target as HTMLElement).closest('.seer-word-actions')) return;
        const word = (item as HTMLElement).dataset.word;
        if (word) handlers.onClick!(word);
      });
    });
  }
}
