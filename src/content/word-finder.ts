/**
 * Word Finder - Yomitan-style substring scanning with deinflection
 *
 * Replaces kuromoji tokenization with longest-match-first substring scanning
 * and Yomitan's deinflection engine.
 */

import { LanguageTransformer, type TransformedText, type Trace } from '../shared/language-transformer';
import { japaneseTransforms } from '../shared/japanese-transforms';
import { isValidWord, getFrequency } from '../shared/frequency';
import { getTextVariants } from '../shared/text-preprocessors';
import { containsJapanese, getAllForms } from '../shared/normalization';
import { logger } from '../shared/logger';

// Initialize the language transformer with Japanese rules
const transformer = new LanguageTransformer();
transformer.addDescriptor(japaneseTransforms);

// Maximum substring length to try (same as Yomitan)
const MAX_SUBSTRING_LENGTH = 20;

/**
 * A matched word from the text
 */
export interface MatchedWord {
  /** The original text as it appears in the source */
  surface: string;
  /** The deinflected dictionary form */
  baseForm: string;
  /** Start position in the source text */
  start: number;
  /** End position in the source text */
  end: number;
  /** The deinflection trace (list of transform names applied) */
  inflectionTrace: string[];
}

/**
 * Result of finding a match at a position
 */
interface MatchResult {
  /** The deinflected text */
  deinflectedForm: string;
  /** Length of the original text consumed */
  consumedLength: number;
  /** The deinflection trace */
  trace: string[];
}

/**
 * Find the longest matching word at the start of the text.
 * Uses substring scanning from longest to shortest with deinflection.
 */
function findLongestMatch(text: string): MatchResult | null {
  // Try substrings from longest to shortest
  const maxLen = Math.min(text.length, MAX_SUBSTRING_LENGTH);

  for (let len = maxLen; len > 0; len--) {
    const substring = text.substring(0, len);

    // Skip if no Japanese characters
    if (!containsJapanese(substring)) continue;

    // Generate text variants (hiragana/katakana)
    const variants = getTextVariants(substring);

    for (const variant of variants) {
      // Get all possible deinflections
      const deinflections = transformer.transform(variant);

      for (const deinflection of deinflections) {
        // Check if the deinflected form exists in JPDB
        if (isValidWord(deinflection.text)) {
          return {
            deinflectedForm: deinflection.text,
            consumedLength: len,
            trace: deinflection.trace.map(frame => frame.transform),
          };
        }

        // Also check hiragana/katakana variants of the deinflected form
        const deinflectedVariants = getAllForms(deinflection.text);
        for (const dv of deinflectedVariants) {
          if (isValidWord(dv)) {
            return {
              deinflectedForm: dv,
              consumedLength: len,
              trace: deinflection.trace.map(frame => frame.transform),
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Find all words in the text using Yomitan-style substring scanning.
 * Returns an array of matched words with their positions.
 */
export function findWords(text: string): MatchedWord[] {
  const results: MatchedWord[] = [];
  let position = 0;

  while (position < text.length) {
    const remaining = text.substring(position);

    // Skip leading whitespace and non-Japanese characters
    if (!containsJapanese(remaining.charAt(0))) {
      position += 1;
      continue;
    }

    const match = findLongestMatch(remaining);

    if (match && match.consumedLength > 0) {
      results.push({
        surface: text.substring(position, position + match.consumedLength),
        baseForm: match.deinflectedForm,
        start: position,
        end: position + match.consumedLength,
        inflectionTrace: match.trace,
      });
      position += match.consumedLength;
    } else {
      // No match found - skip one character
      // Use [...remaining][0].length to handle surrogate pairs correctly
      const firstChar = [...remaining][0];
      position += firstChar ? firstChar.length : 1;
    }
  }

  return results;
}

/**
 * Check if a word is known/unknown/ignored based on vocabulary sets
 */
export function checkWordStatus(
  baseForm: string,
  surface: string,
  knownSet: Set<string>,
  ignoredSet: Set<string>,
  sessionIgnored: Set<string>
): 'known' | 'unknown' | 'ignored' {
  const forms = getAllForms(baseForm);
  forms.push(...getAllForms(surface));

  // Check session ignored first
  for (const form of forms) {
    if (sessionIgnored.has(form)) return 'ignored';
  }

  // Check Anki ignored
  for (const form of forms) {
    if (ignoredSet.has(form)) return 'ignored';
  }

  // Check known
  for (const form of forms) {
    if (knownSet.has(form)) return 'known';
  }

  return 'unknown';
}

/**
 * Get the word finder ready (pre-warm any caches)
 */
export async function initWordFinder(): Promise<void> {
  // Force load the frequency data
  logger.content.debug('Initializing word finder...');
  getFrequency('食べる'); // Warm up the frequency map
  logger.content.info('Word finder initialized');
}

// Re-export for convenience
export { getFrequency };
