import { fnv1a } from '../shared/hash';
import { PAGE_TIME_FLUSH_INTERVAL_MS } from '../shared/config';

/**
 * Page Time Tracker
 *
 * Tracks time spent on pages via message passing to the service worker.
 * Content scripts CANNOT access the extension's IndexedDB directly.
 */

export class PageTimeTracker {
  private pageStart: number = 0;
  private urlHash: number = 0;
  private url: string = '';
  private flushInterval: number | null = null;
  private isStarted: boolean = false;
  private isFlushing: boolean = false;

  start(): void {
    if (this.isStarted) return;

    this.url = location.href;
    this.urlHash = fnv1a(this.url);
    this.pageStart = Date.now();
    this.isStarted = true;

    window.addEventListener('beforeunload', this.handleUnload);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.flushInterval = window.setInterval(() => {
      this.flush();
    }, PAGE_TIME_FLUSH_INTERVAL_MS);

    console.log('[Seer] Page time tracking started');
  }

  stop(): void {
    if (!this.isStarted) return;

    this.flush();

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    window.removeEventListener('beforeunload', this.handleUnload);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    this.isStarted = false;
  }

  async flush(): Promise<void> {
    if (!this.isStarted || this.pageStart === 0) return;
    if (this.isFlushing) return;

    const now = Date.now();
    const timeSpent = now - this.pageStart;

    if (timeSpent < 100) return;

    this.isFlushing = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'storePageTime',
        pageVisit: {
          urlHash: this.urlHash,
          url: this.url,
          pageTitle: document.title || this.url,
          timeSpent
        }
      });

      if (response?.success) {
        console.log(`[Seer] ✓ Stored ${Math.round(timeSpent / 1000)}s page time`);
        this.pageStart = now;
      } else {
        console.error('[Seer] ✗ Failed to store page time:', response?.error);
      }
    } catch (error) {
      // Silently ignore "Extension context invalidated" - this is expected when extension reloads
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('Extension context invalidated')) {
        console.error('[Seer] ✗ Page time message failed:', error);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  getCurrentTime(): number {
    if (!this.isStarted) return 0;
    return Date.now() - this.pageStart;
  }

  private handleUnload = (): void => {
    this.flush();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.flush();
      // Trigger comprehension snapshot when leaving page
      chrome.runtime.sendMessage({
        type: 'createComprehensionSnapshot',
        urlHash: this.urlHash,
        url: this.url
      }).catch(() => {
        // Non-critical, ignore errors
      });
    } else {
      this.pageStart = Date.now();
    }
  };
}

export const pageTimeTracker = new PageTimeTracker();
