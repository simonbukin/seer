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
    // Match Yomitan's word detection logic for shift+hover highlighting
    // Yomitan is more permissive than the previous Seer logic

    const pos = token.pos;
    const surface = token.surface_form;

    // Skip whitespace and certain symbols
    if (pos === "空白" || pos === "記号") {
      // But allow some symbols that contain Japanese characters
      if (!/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(surface)) {
        return false;
      }
    }

    // Skip pure punctuation and ASCII-only tokens
    if (
      /^[\s\p{P}\p{S}]+$/u.test(surface) &&
      !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(surface)
    ) {
      return false;
    }

    // Include any token that contains Japanese characters
    // This matches Yomitan's permissive approach
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(surface)) {
      return true;
    }

    return false;
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
