/**
 * Generate a minimal word list from jmdict-simplified for word validation.
 *
 * This extracts all kanji spellings and kana readings from JMdict,
 * creating a simple newline-separated text file for fast lookup.
 *
 * Run with: bun scripts/generate-wordlist.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Find the jmdict JSON file (prefer common-only for smaller size)
const scriptDir = import.meta.dir;
const jsonFiles = [
  'jmdict-eng-common-3.6.1.json',
  'jmdict-eng-common.json',
  'jmdict-eng-3.6.1.json',
  'jmdict-eng.json',
];
let jmdictPath: string | null = null;

for (const file of jsonFiles) {
  const path = join(scriptDir, file);
  try {
    readFileSync(path);
    jmdictPath = path;
    break;
  } catch {
    // File doesn't exist, try next
  }
}

if (!jmdictPath) {
  console.error('Error: Could not find jmdict JSON file in scripts/');
  console.error('Download from: https://github.com/scriptin/jmdict-simplified/releases');
  process.exit(1);
}

console.log(`Reading ${jmdictPath}...`);
const jmdict = JSON.parse(readFileSync(jmdictPath, 'utf-8'));

const words = new Set<string>();

console.log(`Processing ${jmdict.words.length} entries...`);

for (const entry of jmdict.words) {
  // Add all kanji spellings
  if (entry.kanji) {
    for (const k of entry.kanji) {
      if (k.text) {
        words.add(k.text);
      }
    }
  }

  // Add all kana readings
  if (entry.kana) {
    for (const r of entry.kana) {
      if (r.text) {
        words.add(r.text);
      }
    }
  }
}

console.log(`Found ${words.size} unique words`);

// Sort for consistent output
const sortedWords = [...words].sort();

// Write to src/shared/jmdict-words.txt
const outputPath = join(scriptDir, '..', 'src', 'shared', 'jmdict-words.txt');
writeFileSync(outputPath, sortedWords.join('\n'));

console.log(`Wrote ${sortedWords.length} words to ${outputPath}`);

// Also log some stats
const kanjiCount = sortedWords.filter(w => /[\u4e00-\u9faf]/.test(w)).length;
const kanaCount = sortedWords.filter(w => !/[\u4e00-\u9faf]/.test(w)).length;
console.log(`  - ${kanjiCount} words contain kanji`);
console.log(`  - ${kanaCount} words are kana-only`);
