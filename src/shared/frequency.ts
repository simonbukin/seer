// Frequency lookup module for Japanese words
// Word validation: JMdict (454k+ words)
// Frequency data: JPDB v2.2 (for color-coding by rarity)

import frequencyData from './frequency-list.tsv?raw';
import jmdictWords from './jmdict-words.txt?raw';

// === Word Validation (JMdict) ===

let validWords: Set<string> | null = null;

// Load JMdict word list for validation
function loadWordList(): Set<string> {
  if (validWords) return validWords;

  validWords = new Set(jmdictWords.split('\n').filter(Boolean));
  console.log(`[Seer] Loaded ${validWords.size} words from JMdict`);
  return validWords;
}

// === Frequency Data (JPDB) ===

let frequencyMap: Map<string, number> | null = null;

// Parse JPDB frequency data once on first use
function loadFrequencyData(): Map<string, number> {
  if (frequencyMap) return frequencyMap;

  frequencyMap = new Map();
  const lines = frequencyData.split('\n');

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const term = parts[0];
    const reading = parts[1];
    const frequency = parseInt(parts[2], 10);

    if (term && !isNaN(frequency)) {
      // Store the lowest (best) frequency rank for each term
      const existing = frequencyMap.get(term);
      if (existing === undefined || frequency < existing) {
        frequencyMap.set(term, frequency);
      }
      // Also index by reading for frequency lookup on hiragana text
      if (reading && reading !== term) {
        const existingReading = frequencyMap.get(reading);
        if (existingReading === undefined || frequency < existingReading) {
          frequencyMap.set(reading, frequency);
        }
      }
    }
  }

  console.log(`[Seer] Loaded ${frequencyMap.size} frequency entries from JPDB`);
  return frequencyMap;
}

/**
 * Get the frequency map directly (for bulk lookups)
 * Lazy-loads the map on first access
 */
export const frequencyRankMap: Map<string, number> = new Proxy(new Map(), {
  get(target, prop, receiver) {
    // Forward all operations to the real frequency map
    const realMap = loadFrequencyData();
    const value = Reflect.get(realMap, prop, realMap);
    // Bind functions to the real map
    return typeof value === 'function' ? value.bind(realMap) : value;
  },
});

/**
 * Get frequency rank for a word (lower = more common)
 * Returns undefined if word not found
 */
export function getFrequency(word: string): number | undefined {
  const map = loadFrequencyData();
  return map.get(word);
}

/**
 * Check if a word exists in the JMdict word list.
 * Used to validate deinflection results.
 */
export function isValidWord(word: string): boolean {
  const words = loadWordList();
  return words.has(word);
}

/**
 * Get the set of all valid words from JMdict
 */
export function getWordSet(): Set<string> {
  return loadWordList();
}

/**
 * Get frequency band for gradient coloring
 * Returns a value from 0-4:
 * 0 = very common (top 1k)
 * 1 = common (1k-5k)
 * 2 = medium (5k-15k)
 * 3 = uncommon (15k-50k)
 * 4 = rare (50k+)
 */
export function getFrequencyBand(freq: number | undefined): number {
  if (freq === undefined) return 4; // Unknown words treated as rare

  if (freq <= 1000) return 0;   // very common
  if (freq <= 5000) return 1;    // common
  if (freq <= 15000) return 2;   // medium
  if (freq <= 50000) return 3;   // uncommon
  return 4;                       // rare
}

/**
 * Get CSS color class for frequency band
 * Cold colors (blue) for common, warm colors (red) for rare
 */
export function getFrequencyColorClass(band: number): string {
  const classes = [
    'freq-very-common',  // blue
    'freq-common',       // cyan/teal
    'freq-medium',       // yellow
    'freq-uncommon',     // orange
    'freq-rare'          // red
  ];
  return classes[band] || classes[4];
}
