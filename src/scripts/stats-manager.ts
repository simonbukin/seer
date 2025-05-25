import { getFrequencyRank } from "./frequency-db";
import { segmentJapanese } from "./kuromoji-tokenizer";
import { PageStats, FrequencyBucket, I1Sentence } from "./stats-panel";

export class StatsManager {
  private stats: PageStats = {
    totalWords: 0,
    knownWords: 0,
    unknownWords: 0,
    ignoredWords: 0,
    frequencyDistribution: [],
    i1Sentences: [],
    lastUpdate: new Date(),
  };

  private updateCallbacks: ((stats: PageStats) => void)[] = [];
  private isCalculating = false;
  private pendingUpdate = false;

  constructor() {
    // Listen for refresh events
    document.addEventListener("seer:refresh-stats", () => {
      this.recalculateStats();
    });
  }

  public onStatsUpdate(callback: (stats: PageStats) => void): void {
    this.updateCallbacks.push(callback);
  }

  public removeStatsUpdateCallback(callback: (stats: PageStats) => void): void {
    const index = this.updateCallbacks.indexOf(callback);
    if (index > -1) {
      this.updateCallbacks.splice(index, 1);
    }
  }

  private notifyCallbacks(): void {
    this.updateCallbacks.forEach((callback) => {
      try {
        callback({ ...this.stats });
      } catch (error) {
        console.warn("Error in stats update callback:", error);
      }
    });
  }

  public async updateStats(
    allWords: Set<string>,
    unknownWords: Set<string>,
    ignoredWords: Set<string>
  ): Promise<void> {
    if (this.isCalculating) {
      this.pendingUpdate = true;
      return;
    }

    this.isCalculating = true;

    try {
      // Calculate basic stats
      const totalWords = allWords.size;
      const unknownCount = unknownWords.size;
      const ignoredCount = ignoredWords.size;
      const knownCount = totalWords - unknownCount;

      // Calculate frequency distribution
      const frequencyDistribution = await this.calculateFrequencyDistribution(
        allWords
      );

      // Find i+1 sentences
      const i1Sentences = await this.findI1Sentences(
        unknownWords,
        ignoredWords
      );

      // Update stats
      this.stats = {
        totalWords,
        knownWords: knownCount,
        unknownWords: unknownCount,
        ignoredWords: ignoredCount,
        frequencyDistribution,
        i1Sentences,
        lastUpdate: new Date(),
      };

      // Notify callbacks
      this.notifyCallbacks();
    } catch (error) {
      console.error("Error updating stats:", error);
    } finally {
      this.isCalculating = false;

      // Handle pending update
      if (this.pendingUpdate) {
        this.pendingUpdate = false;
        // Defer to next tick to avoid recursion
        setTimeout(() => this.recalculateStats(), 0);
      }
    }
  }

  public async recalculateStats(): Promise<void> {
    try {
      // Collect all words from the page
      const allWords = new Set<string>();
      const textNodes = this.getTextNodes(document.body);

      for (const textNode of textNodes) {
        const segments = await segmentJapanese(textNode.data);
        segments.forEach((segment) => {
          if (segment.isWordLike) {
            const word = segment.segment.trim();
            if (
              word.length > 0 &&
              /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(word)
            ) {
              allWords.add(word);
            }
          }
        });
      }

      if (allWords.size === 0) {
        console.log("⚠️ No Japanese words found for stats calculation");
        return;
      }

      // Send words to background script to check against vocabulary database
      const message = {
        type: "TOKENS",
        tokens: Array.from(allWords),
      };

      chrome.runtime.sendMessage(message, (response: any) => {
        if (chrome.runtime.lastError) {
          console.error(
            "❌ Error checking words for stats:",
            chrome.runtime.lastError
          );
          return;
        }

        if (response && response.unknown) {
          // Handle the response asynchronously
          this.handleVocabularyResponse(response, allWords);
        }
      });
    } catch (error) {
      console.error("Error recalculating stats:", error);
    }
  }

  private async calculateFrequencyDistribution(
    words: Set<string>
  ): Promise<FrequencyBucket[]> {
    const buckets: FrequencyBucket[] = [
      {
        name: "Very Common",
        color: "#10b981",
        count: 0,
        percentage: 0,
        range: "1-1,000",
      },
      {
        name: "Common",
        color: "#3b82f6",
        count: 0,
        percentage: 0,
        range: "1,001-3,000",
      },
      {
        name: "Uncommon",
        color: "#8b5cf6",
        count: 0,
        percentage: 0,
        range: "3,001-6,000",
      },
      {
        name: "Rare",
        color: "#f59e0b",
        count: 0,
        percentage: 0,
        range: "6,001-10,000",
      },
      {
        name: "Very Rare",
        color: "#ef4444",
        count: 0,
        percentage: 0,
        range: "10,000+",
      },
    ];

    const frequencyPromises = Array.from(words).map(async (word) => {
      try {
        const rank = await getFrequencyRank(word);
        return { word, rank };
      } catch {
        return { word, rank: null };
      }
    });

    const frequencies = await Promise.all(frequencyPromises);

    frequencies.forEach(({ rank }) => {
      if (rank === null) {
        buckets[4].count++; // Very rare (not in database)
      } else if (rank <= 1000) {
        buckets[0].count++; // Very common
      } else if (rank <= 3000) {
        buckets[1].count++; // Common
      } else if (rank <= 6000) {
        buckets[2].count++; // Uncommon
      } else if (rank <= 10000) {
        buckets[3].count++; // Rare
      } else {
        buckets[4].count++; // Very rare
      }
    });

    // Calculate percentages
    const total = words.size;
    buckets.forEach((bucket) => {
      bucket.percentage = total > 0 ? (bucket.count / total) * 100 : 0;
    });

    return buckets;
  }

  private async findI1Sentences(
    unknownWords: Set<string>,
    ignoredWords: Set<string>
  ): Promise<I1Sentence[]> {
    const i1Sentences: I1Sentence[] = [];
    const sentences = this.extractSentences(document.body);

    for (const sentenceInfo of sentences) {
      try {
        const segments = await segmentJapanese(sentenceInfo.text);
        const wordsInSentence = segments
          .filter((segment) => segment.isWordLike)
          .map((segment) => segment.segment.trim());

        // Count unknown words (excluding ignored words)
        const unknownInSentence = wordsInSentence.filter(
          (word) => unknownWords.has(word) && !ignoredWords.has(word)
        );

        // i+1 sentence has exactly 1 unknown word
        if (unknownInSentence.length === 1) {
          const rect = sentenceInfo.element.getBoundingClientRect();
          i1Sentences.push({
            element: sentenceInfo.element,
            text: sentenceInfo.text,
            unknownWord: unknownInSentence[0],
            position: {
              top: rect.top + window.scrollY,
              left: rect.left + window.scrollX,
            },
          });
        }
      } catch (error) {
        console.warn("Error analyzing sentence for i+1:", error);
      }
    }

    return i1Sentences;
  }

  private extractSentences(
    root: Node
  ): Array<{ element: Element; text: string }> {
    const sentences: Array<{ element: Element; text: string }> = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip script, style, and other non-content elements
        const tagName = parent.tagName.toLowerCase();
        if (["script", "style", "noscript", "iframe"].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip if text is too short or doesn't contain Japanese
        const text = node.textContent?.trim() || "";
        if (
          text.length < 10 ||
          !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      if (text && text.length >= 10) {
        // Split into sentences (basic Japanese sentence splitting)
        const sentenceTexts = text
          .split(/[。！？]/)
          .filter((s) => s.trim().length > 5);

        sentenceTexts.forEach((sentenceText) => {
          if (sentenceText.trim().length > 5) {
            sentences.push({
              element: (node as Text).parentElement!,
              text: sentenceText.trim() + "。", // Add period back
            });
          }
        });
      }
    }

    return sentences;
  }

  private getTextNodes(root: Node): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip script, style, and other non-content elements
        const tagName = parent.tagName.toLowerCase();
        if (["script", "style", "noscript", "iframe"].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip if text doesn't contain Japanese
        const text = node.textContent?.trim() || "";
        if (!/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    return textNodes;
  }

  private async getIgnoredWordsFromStorage(): Promise<Set<string>> {
    // This will be called by the content script to provide ignored words
    // For now, return empty set - will be updated by content script
    return new Set<string>();
  }

  public getCurrentStats(): PageStats {
    return { ...this.stats };
  }

  public updateIgnoredWords(ignoredWords: Set<string>): void {
    // Update ignored words count and recalculate if needed
    const newIgnoredCount = ignoredWords.size;
    if (newIgnoredCount !== this.stats.ignoredWords) {
      this.stats.ignoredWords = newIgnoredCount;
      this.stats.lastUpdate = new Date();
      this.notifyCallbacks();
    }
  }

  public wordIgnored(word: string): void {
    // Handle immediate feedback when a word is ignored
    if (this.stats.unknownWords > 0) {
      this.stats.unknownWords--;
      this.stats.knownWords++; // Treat ignored as known for stats
      this.stats.ignoredWords++;
      this.stats.lastUpdate = new Date();
      this.notifyCallbacks();
    }
  }

  public destroy(): void {
    this.updateCallbacks.length = 0;
  }

  private async handleVocabularyResponse(
    response: any,
    allWords: Set<string>
  ): Promise<void> {
    try {
      // Get ignored words from storage
      const ignoredWordsFromStorage: Set<string> =
        await this.getIgnoredWordsFromStorage();

      // Filter out ignored words from unknown words
      const filteredUnknown = response.unknown.filter(
        (word: string) => !ignoredWordsFromStorage.has(word)
      );

      const unknownWords = new Set<string>(filteredUnknown);

      await this.updateStats(allWords, unknownWords, ignoredWordsFromStorage);
    } catch (error) {
      console.error("Error handling vocabulary response:", error);
    }
  }
}
