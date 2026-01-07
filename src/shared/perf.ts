/**
 * Simple performance monitoring utility
 * Tracks operation durations and logs to console
 *
 * Usage:
 *   perf.start('tokenization');
 *   // ... do work ...
 *   perf.end('tokenization'); // Logs: "[Perf] tokenization: 42.56ms"
 */
export class PerfMonitor {
  private marks = new Map<string, number>();

  /**
   * Start timing an operation
   */
  start(label: string): void {
    this.marks.set(label, performance.now());
  }

  /**
   * End timing and log duration
   * @returns Duration in milliseconds
   */
  end(label: string): number {
    const start = this.marks.get(label);
    if (!start) {
      console.warn(`[Perf] No start mark found for "${label}"`);
      return 0;
    }

    const duration = performance.now() - start;
    this.marks.delete(label);

    console.log(`[Perf] ${label}: ${duration.toFixed(2)}ms`);
    return duration;
  }

  /**
   * Clear all marks
   */
  clear(): void {
    this.marks.clear();
  }
}

/**
 * Singleton performance monitor
 */
export const perf = new PerfMonitor();
