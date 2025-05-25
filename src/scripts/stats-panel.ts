import { getFrequencyRank } from "./frequency-db";

export interface PageStats {
  totalWords: number;
  knownWords: number;
  unknownWords: number;
  ignoredWords: number;
  frequencyDistribution: FrequencyBucket[];
  i1Sentences: I1Sentence[];
  lastUpdate: Date;
}

export interface FrequencyBucket {
  name: string;
  color: string;
  count: number;
  percentage: number;
  range: string;
}

export interface I1Sentence {
  element: Element;
  text: string;
  unknownWord: string;
  position: { top: number; left: number };
}

export class StatsPanel {
  private container: HTMLElement | null = null;
  private handle: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private isVisible = false;
  private currentI1Index = 0;
  private stats: PageStats = {
    totalWords: 0,
    knownWords: 0,
    unknownWords: 0,
    ignoredWords: 0,
    frequencyDistribution: [],
    i1Sentences: [],
    lastUpdate: new Date(),
  };

  constructor() {
    this.createPanel();
    this.setupEventListeners();
  }

  private createPanel(): void {
    // Create small emoji handle
    this.handle = document.createElement("div");
    this.handle.className = "seer-stats-handle";
    this.handle.innerHTML = `🔮`;
    this.handle.title = "Toggle Seer Stats (Ctrl+Shift+S)";

    // Create stats panel
    this.panel = document.createElement("div");
    this.panel.className = "seer-stats-panel";
    this.panel.innerHTML = `
      <div class="seer-stats-content">
        <div class="seer-row-1">
          <div class="seer-title">🔮 Seer</div>
          <div class="seer-key-stats">
            <div class="seer-stat-compact">
              <span class="seer-stat-number seer-total-value">0</span>
              <span class="seer-stat-unit">words</span>
            </div>
            <div class="seer-stat-compact">
              <span class="seer-stat-number seer-knowledge-percent">0%</span>
              <span class="seer-stat-unit">known</span>
            </div>
            <div class="seer-stat-compact">
              <span class="seer-stat-number seer-unknown-value">0</span>
              <span class="seer-stat-unit">unknown</span>
            </div>
          </div>
          <div class="seer-difficulty-section">
            <div class="seer-difficulty-bar">
              <div class="seer-bar-segment seer-very-common" style="width: 0%">
                <span class="seer-hover-count">0</span>
              </div>
              <div class="seer-bar-segment seer-common" style="width: 0%">
                <span class="seer-hover-count">0</span>
              </div>
              <div class="seer-bar-segment seer-uncommon" style="width: 0%">
                <span class="seer-hover-count">0</span>
              </div>
              <div class="seer-bar-segment seer-rare" style="width: 0%">
                <span class="seer-hover-count">0</span>
              </div>
              <div class="seer-bar-segment seer-very-rare" style="width: 0%">
                <span class="seer-hover-count">0</span>
              </div>
            </div>
          </div>
          <div class="seer-actions">
            <span class="seer-last-update">Never</span>
          </div>
        </div>
      </div>
    `;

    // Create container
    this.container = document.createElement("div");
    this.container.className = "seer-stats-container";
    this.container.appendChild(this.handle);
    this.container.appendChild(this.panel);

    // Add styles
    this.addStyles();

    // Add to page
    document.body.appendChild(this.container);
  }

  private addStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      .seer-stats-container {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
      }

      .seer-stats-handle {
        position: fixed;
        top: 0px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        width: 40px;
        height: 40px;
        border-radius: 0px 0px 10px 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.3s ease;
        user-select: none;
        font-size: 20px;
        z-index: 10001;
      }

      .seer-stats-handle:hover {
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .seer-stats-handle.spinning {
        animation: spin 0.6s ease-in-out;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .seer-stats-panel {
        background: white;
        border-bottom: 2px solid #e0e0e0;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        width: 100%;
        overflow: hidden;
        transform: translateY(-100%);
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10000;
      }

      .seer-stats-container.expanded .seer-stats-panel {
        transform: translateY(0);
        opacity: 1;
        pointer-events: auto;
      }

      .seer-stats-container.expanded .seer-stats-handle {
        opacity: 0;
        pointer-events: none;
        transform: scale(0.8);
      }

      .seer-stats-content {
        padding: 8px 20px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .seer-row-1 {
        display: flex;
        align-items: center;
        gap: 20px;
      }

      .seer-title {
        font-weight: 700;
        font-size: 16px;
        color: #333;
        flex-shrink: 0;
      }

      .seer-key-stats {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
      }

      .seer-stat-compact {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 4px 8px;
        background: #f8f9fa;
        border-radius: 4px;
        min-width: 50px;
      }

      .seer-stat-number {
        font-weight: 700;
        font-size: 16px;
        color: #333;
        line-height: 1;
      }

      .seer-stat-number.seer-knowledge-percent {
        color: #4caf50;
      }

      .seer-stat-number.seer-unknown-value {
        color: #f44336;
      }

      .seer-stat-unit {
        font-size: 9px;
        color: #666;
        text-transform: uppercase;
        font-weight: 600;
        line-height: 1;
        margin-top: 2px;
      }

      .seer-difficulty-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 200px;
      }

      .seer-difficulty-bar {
        width: 100%;
        height: 16px;
        background: #f0f0f0;
        border-radius: 4px;
        overflow: hidden;
        display: flex;
        position: relative;
      }

      .seer-bar-segment {
        height: 100%;
        transition: width 0.6s ease;
        cursor: pointer;
        position: relative;
        min-width: 1px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .seer-bar-segment:hover {
        filter: brightness(1.1);
        transform: scaleY(1.2);
        z-index: 1;
      }

      .seer-hover-count {
        font-size: 10px;
        font-weight: bold;
        color: white;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        white-space: nowrap;
      }

      .seer-bar-segment:hover .seer-hover-count {
        opacity: 1;
      }

      .seer-bar-segment.seer-very-common { background: #10b981; }
      .seer-bar-segment.seer-common { background: #3b82f6; }
      .seer-bar-segment.seer-uncommon { background: #8b5cf6; }
      .seer-bar-segment.seer-rare { background: #f59e0b; }
      .seer-bar-segment.seer-very-rare { background: #ef4444; }



      .seer-i1-compact {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #f0f8ff;
        border: 1px solid #e3f2fd;
        border-radius: 4px;
        padding: 4px 8px;
      }

      .seer-i1-label {
        font-size: 11px;
        color: #1976d2;
        font-weight: 600;
      }

      .seer-i1-count {
        font-size: 11px;
        color: #666;
        background: white;
        padding: 2px 6px;
        border-radius: 10px;
        min-width: 16px;
        text-align: center;
      }

      .seer-i1-nav {
        background: #2196f3;
        color: white;
        border: none;
        padding: 2px 6px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
        transition: all 0.2s ease;
      }

      .seer-i1-nav:hover:not(:disabled) {
        background: #1976d2;
      }

      .seer-i1-nav:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .seer-i1-position {
        font-size: 10px;
        color: #666;
        font-weight: 600;
        min-width: 30px;
        text-align: center;
      }

      .seer-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .seer-last-update {
        font-size: 10px;
        color: #999;
      }





      /* Animation for new data */
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
      }

      .seer-stats-container.updating .seer-stat-number {
        animation: pulse 0.6s ease;
      }
    `;

    document.head.appendChild(style);
  }

  private setupEventListeners(): void {
    // Handle click - toggle panel and refresh if opening
    this.handle?.addEventListener("click", () => {
      const wasVisible = this.isVisible;
      this.toggle();

      // Only refresh when opening the panel, not when closing
      if (!wasVisible && this.isVisible) {
        this.triggerRefresh();
      }
    });

    // i+1 navigation
    this.panel
      ?.querySelector(".seer-i1-prev")
      ?.addEventListener("click", () => {
        this.navigateI1(-1);
      });

    this.panel
      ?.querySelector(".seer-i1-next")
      ?.addEventListener("click", () => {
        this.navigateI1(1);
      });

    // Auto-hide on outside click
    document.addEventListener("click", (event) => {
      if (
        this.isVisible &&
        this.container &&
        !this.container.contains(event.target as Node)
      ) {
        this.hide();
      }
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key === "S") {
        event.preventDefault();
        this.toggle();
      }
      if (this.isVisible && event.key === "Escape") {
        this.hide();
      }
    });
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  public show(): void {
    if (!this.container) return;
    this.isVisible = true;
    this.container.classList.add("expanded");
  }

  public hide(): void {
    if (!this.container) return;
    this.isVisible = false;
    this.container.classList.remove("expanded");
  }

  public updateStats(stats: PageStats): void {
    this.stats = { ...stats };
    this.container?.classList.add("updating");

    // Update key stats
    const totalValue = this.panel?.querySelector(".seer-total-value");
    const knowledgePercent = this.panel?.querySelector(
      ".seer-knowledge-percent"
    );
    const unknownValue = this.panel?.querySelector(".seer-unknown-value");

    if (totalValue) {
      totalValue.textContent = stats.totalWords.toLocaleString();
    }

    if (knowledgePercent) {
      const percent =
        stats.totalWords > 0
          ? Math.round((stats.knownWords / stats.totalWords) * 100)
          : 0;
      knowledgePercent.textContent = `${percent}%`;
    }

    if (unknownValue) {
      unknownValue.textContent = stats.unknownWords.toLocaleString();
    }

    // Update difficulty bar
    this.updateDifficultyMeter(stats.frequencyDistribution);

    // Update i+1 section
    this.updateI1Section(stats.i1Sentences);

    // Update footer
    const lastUpdate = this.panel?.querySelector(".seer-last-update");
    if (lastUpdate) {
      lastUpdate.textContent = stats.lastUpdate.toLocaleTimeString();
    }

    // Remove updating animation
    setTimeout(() => {
      this.container?.classList.remove("updating");
    }, 600);
  }

  private updateDifficultyMeter(distribution: FrequencyBucket[]): void {
    const total = distribution.reduce((sum, bucket) => sum + bucket.count, 0);

    distribution.forEach((bucket, index) => {
      const segment = this.panel?.querySelector(
        `.seer-bar-segment:nth-child(${index + 1})`
      );

      if (segment) {
        const percentage = total > 0 ? (bucket.count / total) * 100 : 0;

        // Ensure minimum width for hovering, even if no data
        const displayWidth = Math.max(percentage, 20); // Minimum 20% width for hovering
        (segment as HTMLElement).style.width = `${displayWidth}%`;

        // If this segment has no data, make it semi-transparent
        (segment as HTMLElement).style.opacity = percentage === 0 ? "0.2" : "1";

        // Update hover count
        const hoverCount = segment.querySelector(".seer-hover-count");
        if (hoverCount) {
          hoverCount.textContent = bucket.count.toString();
        }
      }
    });
  }

  private updateI1Section(i1Sentences: I1Sentence[]): void {
    const count = this.panel?.querySelector(".seer-i1-count");
    const position = this.panel?.querySelector(".seer-i1-position");
    const prevBtn = this.panel?.querySelector(
      ".seer-i1-prev"
    ) as HTMLButtonElement;
    const nextBtn = this.panel?.querySelector(
      ".seer-i1-next"
    ) as HTMLButtonElement;

    if (count) {
      count.textContent = i1Sentences.length.toString();
    }

    if (i1Sentences.length === 0) {
      this.currentI1Index = 0;
      if (position) position.textContent = "0/0";
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    } else {
      // Ensure current index is valid
      if (this.currentI1Index >= i1Sentences.length) {
        this.currentI1Index = 0;
      }

      if (position)
        position.textContent = `${this.currentI1Index + 1}/${
          i1Sentences.length
        }`;
      if (prevBtn) prevBtn.disabled = this.currentI1Index === 0;
      if (nextBtn)
        nextBtn.disabled = this.currentI1Index === i1Sentences.length - 1;
    }
  }

  private navigateI1(direction: number): void {
    if (this.stats.i1Sentences.length === 0) return;

    const newIndex = this.currentI1Index + direction;
    if (newIndex >= 0 && newIndex < this.stats.i1Sentences.length) {
      this.currentI1Index = newIndex;
      this.updateI1Section(this.stats.i1Sentences);

      // Scroll to the sentence
      const sentence = this.stats.i1Sentences[this.currentI1Index];
      if (sentence.element) {
        sentence.element.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        // Briefly highlight the sentence
        this.highlightSentence(sentence.element);
      }
    }
  }

  private highlightSentence(element: Element): void {
    const originalStyle = (element as HTMLElement).style.cssText;
    (element as HTMLElement).style.cssText += `
      background: rgba(33, 150, 243, 0.2) !important;
      border-radius: 4px !important;
      transition: background 0.3s ease !important;
    `;

    setTimeout(() => {
      (element as HTMLElement).style.cssText = originalStyle;
    }, 2000);
  }

  private triggerRefresh(): void {
    // Add spin animation to handle
    if (this.handle) {
      this.handle.classList.add("spinning");
      setTimeout(() => {
        this.handle?.classList.remove("spinning");
      }, 600);
    }

    // Dispatch refresh event
    const event = new CustomEvent("seer:refresh-stats");
    document.dispatchEvent(event);
  }

  public destroy(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.handle = null;
      this.panel = null;
    }
  }

  public setVisible(visible: boolean): void {
    if (!this.container) return;
    this.container.style.display = visible ? "block" : "none";
  }
}
