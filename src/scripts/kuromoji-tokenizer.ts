import * as kuromoji from "@patdx/kuromoji";

// Token interface that matches what the extension expects
export interface KuromojiToken {
  surface_form: string;
  word_position: number;
  word_type: "KNOWN" | "UNKNOWN";
  pos: string;
  pos_detail_1: string;
  reading: string;
  basic_form: string;
}

// Simple segment interface to match Intl.Segmenter
export interface TokenSegment {
  segment: string;
  index: number;
  isWordLike: boolean;
}

class KuromojiTokenizer {
  private tokenizer: any = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      console.log("🔄 Initializing Kuromoji tokenizer...");

      // Custom loader for browser environment
      const customLoader: kuromoji.LoaderConfig = {
        async loadArrayBuffer(url: string): Promise<ArrayBufferLike> {
          // Strip off .gz extension as recommended in the docs
          url = url.replace(".gz", "");

          // Use CDN for dictionary files
          const dictUrl = `https://cdn.jsdelivr.net/npm/@aiktb/kuromoji@1.0.2/dict/${url}`;

          console.log(`📥 Loading dictionary: ${dictUrl}`);

          const response = await fetch(dictUrl);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch ${dictUrl}, status: ${response.status}`
            );
          }

          return response.arrayBuffer();
        },
      };

      // Build the tokenizer
      this.tokenizer = await new kuromoji.TokenizerBuilder({
        loader: customLoader,
      }).build();

      console.log("✅ Kuromoji tokenizer initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Kuromoji tokenizer:", error);
      throw error;
    }
  }

  async ensureReady(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  // Main tokenization method that returns segments compatible with existing code
  async segment(text: string): Promise<TokenSegment[]> {
    await this.ensureReady();

    if (!this.tokenizer) {
      throw new Error("Kuromoji tokenizer not initialized");
    }

    try {
      const tokens: KuromojiToken[] = this.tokenizer.tokenize(text);
      const segments: TokenSegment[] = [];

      for (const token of tokens) {
        segments.push({
          segment: token.surface_form,
          index: token.word_position,
          isWordLike: this.isWordLike(token),
        });
      }

      return segments;
    } catch (error) {
      console.error("❌ Kuromoji tokenization failed:", error);
      throw error;
    }
  }

  // Helper method to determine if a token is word-like
  private isWordLike(token: KuromojiToken): boolean {
    // Consider tokens as word-like if they are:
    // - Known words (from dictionary)
    // - Nouns, verbs, adjectives, or other content words
    // - Not punctuation or symbols

    if (token.word_type === "UNKNOWN") {
      return false;
    }

    const pos = token.pos;

    // Include content words, exclude function words and punctuation
    const contentWordTypes = [
      "名詞",
      "動詞",
      "形容詞",
      "副詞",
      "連体詞",
      "感動詞",
    ];
    const excludeTypes = ["記号", "補助記号", "空白"];

    if (excludeTypes.includes(pos)) {
      return false;
    }

    if (contentWordTypes.includes(pos)) {
      return true;
    }

    // For other types, check if it contains Japanese characters
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(token.surface_form);
  }

  // Method to get detailed token information (for debugging or advanced features)
  async tokenize(text: string): Promise<KuromojiToken[]> {
    await this.ensureReady();

    if (!this.tokenizer) {
      throw new Error("Kuromoji tokenizer not initialized");
    }

    return this.tokenizer.tokenize(text);
  }
}

// Export a singleton instance
export const kuromojiTokenizer = new KuromojiTokenizer();

// Export a simple function that mimics Intl.Segmenter interface
export async function segmentJapanese(text: string): Promise<TokenSegment[]> {
  return kuromojiTokenizer.segment(text);
}
