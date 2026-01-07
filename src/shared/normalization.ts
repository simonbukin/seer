// Canonical Japanese character Unicode ranges (excludes punctuation/symbols)
// - Hiragana: U+3040-U+309F
// - Katakana: U+30A0-U+30FF (includes prolonged sound mark ー)
// - Kanji (CJK Unified): U+4E00-U+9FFF
// - Kanji (Extension A): U+3400-U+4DBF
// - Half-width Katakana: U+FF65-U+FF9F
export const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uFF65-\uFF9F]/;
export const JAPANESE_CHAR_REGEX_GLOBAL = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uFF65-\uFF9F]/g;

export function normalizeJapanese(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width chars
    .replace(/[ーｰ−]/g, 'ー'); // Normalize long vowel marks
}

export function stripHtml(html: string): string {
  // Remove cloze deletions: {{c1::word}} → word
  let text = html.replace(/\{\{c\d+::([^}]+)\}\}/g, '$1');

  // Remove furigana brackets: 漢字[かんじ] → 漢字
  text = text.replace(/\[([^\]]+)\]/g, '');

  // Strip HTML tags (service worker compatible - no DOMParser)
  text = text
    .replace(/<br\s*\/?>/gi, ' ')           // <br> → space
    .replace(/<\/?(p|div|li|h\d)[^>]*>/gi, ' ')  // Block elements → space
    .replace(/<[^>]+>/g, '')                // Remove all other tags
    .replace(/&nbsp;/gi, ' ')               // Non-breaking space
    .replace(/&amp;/gi, '&')                // Ampersand
    .replace(/&lt;/gi, '<')                 // Less than
    .replace(/&gt;/gi, '>')                 // Greater than
    .replace(/&quot;/gi, '"')               // Quote
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))  // Numeric entities
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));  // Hex entities

  return text.replace(/\s+/g, ' ').trim();
}

export function extractWordFromAnkiField(field: string): string {
  const stripped = stripHtml(field);
  // Take first part if separated by common delimiters
  return stripped.split(/[・、,;|]/)[0].trim();
}

// Hiragana/Katakana conversion for matching
const HIRAGANA_START = 0x3041;
const KATAKANA_START = 0x30A1;
const KANA_LENGTH = 96;

export function toHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - KATAKANA_START + HIRAGANA_START)
  );
}

export function toKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - HIRAGANA_START + KATAKANA_START)
  );
}

export function getAllForms(word: string): string[] {
  const normalized = normalizeJapanese(word);
  const forms = new Set<string>([normalized]);

  // Add hiragana version
  forms.add(toHiragana(normalized));

  // Add katakana version
  forms.add(toKatakana(normalized));

  return Array.from(forms);
}

export function containsJapanese(text: string): boolean {
  return JAPANESE_CHAR_REGEX.test(text);
}

/**
 * Check if text is a meaningful Japanese word (not punctuation/symbols)
 * Uses canonical Unicode ranges:
 * - Hiragana: U+3040-U+309F
 * - Katakana: U+30A0-U+30FF (includes prolonged sound mark ー)
 * - Kanji: U+4E00-U+9FFF
 * - Half-width katakana: U+FF65-U+FF9F
 */
export function isJapaneseWord(text: string): boolean {
  if (!text || text.length === 0) return false;

  // Must contain at least one Japanese character
  if (!JAPANESE_CHAR_REGEX.test(text)) return false;

  // Filter out strings that are mostly punctuation/symbols
  // A valid word should be primarily Japanese characters
  const japaneseChars = text.match(JAPANESE_CHAR_REGEX_GLOBAL) || [];
  const ratio = japaneseChars.length / text.length;

  // At least 50% of the string should be Japanese characters
  return ratio >= 0.5;
}

/**
 * Check if a token should be tracked as a vocabulary word
 * Filters out particles, punctuation, and non-word tokens
 */
export function isTrackableWord(surface: string, pos: string): boolean {
  // Must be a Japanese word
  if (!isJapaneseWord(surface)) return false;

  // Skip single-character particles (は, が, を, に, etc.)
  if (surface.length === 1 && /[\u3040-\u309F]/.test(surface)) {
    // Allow single kanji
    if (!/[\u4E00-\u9FFF]/.test(surface)) return false;
  }

  // Skip common POS that aren't vocabulary words
  const skipPOS = [
    '記号',     // Symbols
    '助詞',     // Particles
    '助動詞',   // Auxiliary verbs (です, ます, etc.)
    '接頭詞',   // Prefixes
    '接尾辞',   // Suffixes
    'フィラー', // Fillers
  ];

  for (const skip of skipPOS) {
    if (pos.startsWith(skip)) return false;
  }

  return true;
}
