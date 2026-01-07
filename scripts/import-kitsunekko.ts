#!/usr/bin/env bun
/**
 * Kitsunekko Importer - Parse SRT/ASS subtitles from kitsunekko-mirror
 *
 * Usage:
 *   bun run scripts/import-kitsunekko.ts <path-to-kitsunekko-mirror> [output.json]
 *
 * Example:
 *   bun run scripts/import-kitsunekko.ts ~/Projects/kitsunekko-mirror ./library-kitsunekko.json
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { existsSync, mkdirSync } from 'fs';

// ============================================================================
// Sentence/Word Extraction (standalone version for CLI)
// ============================================================================

// Sentence boundary pattern
const SENTENCE_ENDERS = /[。！？\n]+/;

// Patterns for cleaning subtitles
const SRT_TIMESTAMP_REGEX = /^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}$/;
const SRT_SEQUENCE_REGEX = /^\d+$/;
const HTML_TAG_REGEX = /<[^>]+>/g;
const ASS_TAG_REGEX = /\{[^}]+\}/g;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;

// For word extraction, we use a simplified approach (no deinflection in CLI)
// The extension will handle proper word matching
const WORD_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u3005]+/g;

interface ParsedSentence {
  text: string;
  words: string[];
}

interface LibraryEntry {
  id: string;
  title: string;
  sourceType: string;
  sourceRef: string;
  sentences: ParsedSentence[];
  sentenceCount: number;
  wordCount: number;
  uniqueWordCount: number;
}

function extractWords(sentence: string): string[] {
  const matches = sentence.match(WORD_REGEX);
  return matches ? [...new Set(matches)] : [];
}

function extractSentences(text: string): string[] {
  return text
    .split(SENTENCE_ENDERS)
    .map(s => s.trim())
    .filter(s => {
      if (s.length < 3 || s.length > 300) return false;
      return JAPANESE_CHAR_REGEX.test(s);
    });
}

function parseSrt(content: string): ParsedSentence[] {
  const lines = content.split('\n');
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (SRT_SEQUENCE_REGEX.test(trimmed)) continue;
    if (SRT_TIMESTAMP_REGEX.test(trimmed)) continue;

    const cleaned = trimmed
      .replace(HTML_TAG_REGEX, '')
      .replace(ASS_TAG_REGEX, '')
      .trim();

    if (cleaned && JAPANESE_CHAR_REGEX.test(cleaned)) {
      textLines.push(cleaned);
    }
  }

  const sentences = extractSentences(textLines.join('\n'));
  return sentences.map(text => ({
    text,
    words: extractWords(text)
  }));
}

function parseAss(content: string): ParsedSentence[] {
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

  const sentences = extractSentences(textLines.join('\n'));
  return sentences.map(text => ({
    text,
    words: extractWords(text)
  }));
}

function parseSubtitle(content: string, filename: string): ParsedSentence[] {
  const ext = extname(filename).toLowerCase();

  if (ext === '.srt') {
    return parseSrt(content);
  } else if (ext === '.ass' || ext === '.ssa') {
    return parseAss(content);
  }

  // Try to auto-detect
  if (content.includes('-->')) {
    return parseSrt(content);
  } else if (content.includes('[Script Info]') || content.includes('Dialogue:')) {
    return parseAss(content);
  }

  return [];
}

// ============================================================================
// Directory Scanning
// ============================================================================

async function findSubtitleFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (['.srt', '.ass', '.ssa'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await scan(dir);
  return files;
}

function generateId(): string {
  return crypto.randomUUID();
}

function getAnimeTitle(filePath: string, baseDir: string): string {
  // Extract anime title from directory structure
  // kitsunekko-mirror/subtitles/{anime-name}/{episode}.srt
  const relativePath = filePath.replace(baseDir, '').replace(/^[\/\\]/, '');
  const parts = relativePath.split(/[\/\\]/);

  // Find the anime name (usually after 'subtitles' directory)
  const subtitlesIdx = parts.findIndex(p => p.toLowerCase() === 'subtitles');
  if (subtitlesIdx >= 0 && parts[subtitlesIdx + 1]) {
    return parts[subtitlesIdx + 1];
  }

  // Fallback: use parent directory name
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return basename(filePath, extname(filePath));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: bun run scripts/import-kitsunekko.ts <path-to-kitsunekko-mirror> [output-dir]');
    console.log('');
    console.log('Example:');
    console.log('  bun run scripts/import-kitsunekko.ts ~/Projects/kitsunekko-mirror ./kitsunekko-library');
    console.log('');
    console.log('Output is chunked into multiple JSON files (500 anime each) to avoid memory issues.');
    process.exit(1);
  }

  const inputDir = args[0];
  const outputDir = args[1] || './kitsunekko-library';

  if (!existsSync(inputDir)) {
    console.error(`Error: Directory not found: ${inputDir}`);
    process.exit(1);
  }

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Scanning ${inputDir} for subtitle files...`);
  const files = await findSubtitleFiles(inputDir);
  console.log(`Found ${files.length} subtitle files`);

  if (files.length === 0) {
    console.log('No subtitle files found. Make sure the path is correct.');
    process.exit(0);
  }

  // Group files by anime title
  const animeGroups = new Map<string, string[]>();

  for (const file of files) {
    const title = getAnimeTitle(file, inputDir);
    if (!animeGroups.has(title)) {
      animeGroups.set(title, []);
    }
    animeGroups.get(title)!.push(file);
  }

  console.log(`Found ${animeGroups.size} unique anime titles`);
  console.log(`Output directory: ${outputDir}`);

  // Process each anime with chunked output
  const CHUNK_SIZE = 500;
  let entries: LibraryEntry[] = [];
  let chunkIndex = 0;
  let processed = 0;
  let totalSentences = 0;
  let totalEntries = 0;

  for (const [title, animePaths] of animeGroups) {
    const allSentences: ParsedSentence[] = [];
    const wordSet = new Set<string>();

    for (const filePath of animePaths) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const sentences = parseSubtitle(content, filePath);
        allSentences.push(...sentences);
        sentences.forEach(s => s.words.forEach(w => wordSet.add(w)));
      } catch (err) {
        // Skip files we can't read
      }
    }

    if (allSentences.length > 0) {
      const entry: LibraryEntry = {
        id: generateId(),
        title,
        sourceType: 'srt',
        sourceRef: `kitsunekko/${title}`,
        sentences: allSentences,
        sentenceCount: allSentences.length,
        wordCount: allSentences.reduce((sum, s) => sum + s.words.length, 0),
        uniqueWordCount: wordSet.size
      };

      entries.push(entry);
      totalSentences += allSentences.length;
      totalEntries++;
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${animeGroups.size} anime...`);
    }

    // Write chunk when full (compact JSON - no pretty-printing)
    if (entries.length >= CHUNK_SIZE) {
      const chunkFile = join(outputDir, `kitsunekko-${String(chunkIndex).padStart(4, '0')}.json`);
      await Bun.write(chunkFile, JSON.stringify(entries));
      console.log(`Wrote ${chunkFile} (${entries.length} anime)`);
      entries = [];
      chunkIndex++;
    }
  }

  // Write remaining entries
  if (entries.length > 0) {
    const chunkFile = join(outputDir, `kitsunekko-${String(chunkIndex).padStart(4, '0')}.json`);
    await Bun.write(chunkFile, JSON.stringify(entries));
    console.log(`Wrote ${chunkFile} (${entries.length} anime)`);
  }

  console.log(`\nDone! Processed ${totalEntries} anime with ${totalSentences} total sentences`);
  console.log(`Output files: ${outputDir}/kitsunekko-*.json`);
}

main().catch(console.error);
