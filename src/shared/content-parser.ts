/**
 * Content Parser - Extract sentences and words from various content formats
 *
 * Supports: SRT subtitles, plain text, Wikipedia dumps
 * Used for populating the content library.
 */

import { findWords } from '../content/word-finder';

// Sentence boundary pattern (Japanese punctuation + newlines)
const SENTENCE_ENDERS = /[。！？\n]+/;

// SRT timestamp pattern: 00:00:00,000 --> 00:00:00,000
const SRT_TIMESTAMP_REGEX = /^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}$/;

// SRT sequence number pattern
const SRT_SEQUENCE_REGEX = /^\d+$/;

// HTML tag pattern
const HTML_TAG_REGEX = /<[^>]+>/g;

// SSA/ASS style tags pattern
const ASS_TAG_REGEX = /\{[^}]+\}/g;

// Japanese character detection
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;

/**
 * Parsed sentence with pre-extracted words
 */
export interface ParsedSentence {
  text: string;           // The sentence text
  words: string[];        // Pre-extracted base forms
}

/**
 * Result of parsing content
 */
export interface ParseResult {
  sentences: ParsedSentence[];
  stats: {
    totalSentences: number;
    totalWords: number;
    uniqueWords: number;
    japaneseCharacters: number;
  };
}

/**
 * Extract sentences from text
 * Filters to reasonable sentence lengths (5-300 chars)
 */
export function extractSentences(text: string): string[] {
  return text
    .split(SENTENCE_ENDERS)
    .map(s => s.trim())
    .filter(s => {
      // Must have content
      if (s.length < 5 || s.length > 300) return false;
      // Must contain Japanese
      return JAPANESE_CHAR_REGEX.test(s);
    });
}

/**
 * Extract base form words from a sentence
 * Uses the existing word-finder (Yomitan-style deinflection)
 */
export function extractWords(sentence: string): string[] {
  const matches = findWords(sentence);
  return matches.map(m => m.baseForm);
}

/**
 * Parse plain text content
 */
export function parseText(content: string): ParseResult {
  const sentences = extractSentences(content);
  const wordSet = new Set<string>();
  let totalWords = 0;
  let japaneseChars = 0;

  const parsedSentences: ParsedSentence[] = sentences.map(text => {
    const words = extractWords(text);
    words.forEach(w => wordSet.add(w));
    totalWords += words.length;

    // Count Japanese characters
    const jpChars = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/g);
    japaneseChars += jpChars ? jpChars.length : 0;

    return { text, words };
  });

  return {
    sentences: parsedSentences,
    stats: {
      totalSentences: sentences.length,
      totalWords,
      uniqueWords: wordSet.size,
      japaneseCharacters: japaneseChars
    }
  };
}

/**
 * Parse SRT subtitle content
 * Strips timestamps, sequence numbers, and formatting tags
 */
export function parseSrt(content: string): ParseResult {
  const lines = content.split('\n');
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Skip sequence numbers (just digits)
    if (SRT_SEQUENCE_REGEX.test(trimmed)) continue;

    // Skip timestamp lines
    if (SRT_TIMESTAMP_REGEX.test(trimmed)) continue;

    // Clean up the line
    let cleaned = trimmed
      // Remove HTML tags
      .replace(HTML_TAG_REGEX, '')
      // Remove ASS/SSA style tags
      .replace(ASS_TAG_REGEX, '')
      .trim();

    if (cleaned && JAPANESE_CHAR_REGEX.test(cleaned)) {
      textLines.push(cleaned);
    }
  }

  // Join lines and parse as text
  return parseText(textLines.join('\n'));
}

/**
 * Parse ASS/SSA subtitle content
 * Extracts dialogue text, strips formatting
 */
export function parseAss(content: string): ParseResult {
  const lines = content.split('\n');
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Only process Dialogue lines
    if (!trimmed.startsWith('Dialogue:')) continue;

    // Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    // We want the Text part (everything after the 9th comma)
    const parts = trimmed.split(',');
    if (parts.length < 10) continue;

    // Text is everything from index 9 onwards (may contain commas)
    const text = parts.slice(9).join(',');

    // Clean up the text
    let cleaned = text
      // Remove ASS style tags like {\pos(x,y)}
      .replace(ASS_TAG_REGEX, '')
      // Remove \N (ASS newline)
      .replace(/\\N/g, ' ')
      // Remove \n
      .replace(/\\n/g, ' ')
      .trim();

    if (cleaned && JAPANESE_CHAR_REGEX.test(cleaned)) {
      textLines.push(cleaned);
    }
  }

  return parseText(textLines.join('\n'));
}

/**
 * Detect content type and parse accordingly
 */
export function parseContent(content: string, filename?: string): ParseResult {
  const ext = filename?.toLowerCase().split('.').pop();

  switch (ext) {
    case 'srt':
      return parseSrt(content);
    case 'ass':
    case 'ssa':
      return parseAss(content);
    default:
      // Check content for SRT markers
      if (content.includes('-->') && SRT_TIMESTAMP_REGEX.test(content.split('\n')[1]?.trim() || '')) {
        return parseSrt(content);
      }
      // Check for ASS markers
      if (content.includes('[Script Info]') || content.includes('Dialogue:')) {
        return parseAss(content);
      }
      // Default to plain text
      return parseText(content);
  }
}

/**
 * Parse content in chunks for large files
 * Yields progress updates
 */
export async function* parseContentChunked(
  content: string,
  chunkSize: number = 50000,
  filename?: string
): AsyncGenerator<{ progress: number; partial: ParseResult }, ParseResult> {
  const ext = filename?.toLowerCase().split('.').pop();

  // For SRT/ASS, we need to parse the whole thing first to strip formatting
  // Then we can chunk the text processing
  let textContent: string;

  if (ext === 'srt' || (content.includes('-->') && SRT_TIMESTAMP_REGEX.test(content.split('\n')[1]?.trim() || ''))) {
    // Pre-process SRT to get clean text
    const lines = content.split('\n');
    const textLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || SRT_SEQUENCE_REGEX.test(trimmed) || SRT_TIMESTAMP_REGEX.test(trimmed)) continue;
      const cleaned = trimmed.replace(HTML_TAG_REGEX, '').replace(ASS_TAG_REGEX, '').trim();
      if (cleaned && JAPANESE_CHAR_REGEX.test(cleaned)) {
        textLines.push(cleaned);
      }
    }
    textContent = textLines.join('\n');
  } else if (ext === 'ass' || ext === 'ssa' || content.includes('[Script Info]')) {
    // Pre-process ASS
    const lines = content.split('\n');
    const textLines: string[] = [];
    for (const line of lines) {
      if (!line.trim().startsWith('Dialogue:')) continue;
      const parts = line.split(',');
      if (parts.length < 10) continue;
      const text = parts.slice(9).join(',')
        .replace(ASS_TAG_REGEX, '')
        .replace(/\\[Nn]/g, ' ')
        .trim();
      if (text && JAPANESE_CHAR_REGEX.test(text)) {
        textLines.push(text);
      }
    }
    textContent = textLines.join('\n');
  } else {
    textContent = content;
  }

  // Now process the clean text in chunks
  const allSentences: ParsedSentence[] = [];
  const wordSet = new Set<string>();
  let totalWords = 0;
  let japaneseChars = 0;

  for (let i = 0; i < textContent.length; i += chunkSize) {
    const chunk = textContent.slice(i, i + chunkSize);
    const sentences = extractSentences(chunk);

    for (const text of sentences) {
      const words = extractWords(text);
      words.forEach(w => wordSet.add(w));
      totalWords += words.length;

      const jpChars = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/g);
      japaneseChars += jpChars ? jpChars.length : 0;

      allSentences.push({ text, words });
    }

    const progress = Math.min(100, Math.round(((i + chunkSize) / textContent.length) * 100));

    yield {
      progress,
      partial: {
        sentences: allSentences,
        stats: {
          totalSentences: allSentences.length,
          totalWords,
          uniqueWords: wordSet.size,
          japaneseCharacters: japaneseChars
        }
      }
    };

    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return {
    sentences: allSentences,
    stats: {
      totalSentences: allSentences.length,
      totalWords,
      uniqueWords: wordSet.size,
      japaneseCharacters: japaneseChars
    }
  };
}
