#!/usr/bin/env bun
/**
 * Wikipedia Importer - Parse Japanese Wikipedia dump
 *
 * Usage:
 *   bun run scripts/import-wikipedia.ts <jawiki-dump.xml.bz2> [output-dir] [--limit N]
 *
 * Example:
 *   bun run scripts/import-wikipedia.ts ~/Projects/jawiki/jawiki-latest-pages-articles.xml.bz2 ./wiki-library --limit 10000
 *
 * Note: This uses streaming to handle the massive XML file.
 * Output is chunked into multiple JSON files (1000 articles each).
 */

import { createReadStream, existsSync, mkdirSync } from 'fs';
import { createBunzipStream } from 'unbzip2-stream';
import { createInterface } from 'readline';
import { join } from 'path';

// ============================================================================
// Sentence/Word Extraction
// ============================================================================

const SENTENCE_ENDERS = /[。！？\n]+/;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
const WORD_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u3005]+/g;

// Wiki markup patterns to strip
const WIKI_PATTERNS = [
  /\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g,  // [[link|text]] or [[link]] -> text/link
  /\{\{[^}]+\}\}/g,                    // {{templates}}
  /'{2,}/g,                            // ''italic'' '''bold'''
  /<ref[^>]*>.*?<\/ref>/gs,           // <ref>...</ref>
  /<ref[^>]*\/>/g,                    // <ref />
  /<[^>]+>/g,                          // Other HTML tags
  /\[\[ファイル:[^\]]+\]\]/g,          // [[File:...]]
  /\[\[画像:[^\]]+\]\]/g,              // [[Image:...]]
  /\[\[Category:[^\]]+\]\]/g,          // [[Category:...]]
  /\[\[カテゴリ:[^\]]+\]\]/g,          // [[カテゴリ:...]]
  /={2,}[^=]+={2,}/g,                  // == headers ==
  /^\*+\s*/gm,                         // * list items
  /^#+\s*/gm,                          // # numbered items
  /^\|.*$/gm,                          // | table rows
  /^\{.*$/gm,                          // { table start
  /^\}.*$/gm,                          // } table end
  /^!.*$/gm,                           // ! table headers
];

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

function cleanWikiText(text: string): string {
  let cleaned = text;

  // Apply all patterns
  for (const pattern of WIKI_PATTERNS) {
    cleaned = cleaned.replace(pattern, '$1');
  }

  // Clean up extra whitespace
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return cleaned;
}

function extractSentences(text: string): ParsedSentence[] {
  const cleaned = cleanWikiText(text);

  return cleaned
    .split(SENTENCE_ENDERS)
    .map(s => s.trim())
    .filter(s => {
      if (s.length < 5 || s.length > 300) return false;
      return JAPANESE_CHAR_REGEX.test(s);
    })
    .map(text => ({
      text,
      words: extractWords(text)
    }));
}

function generateId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// XML Streaming Parser
// ============================================================================

interface WikiArticle {
  title: string;
  text: string;
}

async function* parseWikiDump(filePath: string): AsyncGenerator<WikiArticle> {
  // Check if we need to decompress
  const isBz2 = filePath.endsWith('.bz2');

  let inputStream: NodeJS.ReadableStream;

  if (isBz2) {
    console.log('Decompressing bz2 file (this may take a while)...');
    inputStream = createReadStream(filePath).pipe(createBunzipStream());
  } else {
    inputStream = createReadStream(filePath);
  }

  const rl = createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });

  let inPage = false;
  let inTitle = false;
  let inText = false;
  let currentTitle = '';
  let currentText = '';
  let textBuffer = '';

  for await (const line of rl) {
    if (line.includes('<page>')) {
      inPage = true;
      currentTitle = '';
      currentText = '';
      continue;
    }

    if (line.includes('</page>')) {
      if (currentTitle && currentText) {
        // Skip redirect pages, disambiguation, etc.
        if (!currentText.includes('#REDIRECT') &&
            !currentText.includes('#redirect') &&
            !currentTitle.includes(':') &&  // Skip Wikipedia:, Help:, etc.
            currentText.length > 100) {
          yield { title: currentTitle, text: currentText };
        }
      }
      inPage = false;
      continue;
    }

    if (!inPage) continue;

    // Title
    const titleMatch = line.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      currentTitle = titleMatch[1];
      continue;
    }

    // Text start
    if (line.includes('<text')) {
      inText = true;
      const textMatch = line.match(/<text[^>]*>(.*)$/);
      if (textMatch) {
        textBuffer = textMatch[1];
      }
      continue;
    }

    // Text end
    if (inText && line.includes('</text>')) {
      const endMatch = line.match(/^(.*)<\/text>/);
      if (endMatch) {
        textBuffer += '\n' + endMatch[1];
      }
      currentText = textBuffer;
      textBuffer = '';
      inText = false;
      continue;
    }

    // Text content
    if (inText) {
      textBuffer += '\n' + line;
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let inputFile = '';
  let outputDir = './wiki-library';
  let limit = Infinity;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (!inputFile) {
      inputFile = args[i];
    } else {
      outputDir = args[i];
    }
  }

  if (!inputFile) {
    console.log('Usage: bun run scripts/import-wikipedia.ts <jawiki-dump.xml[.bz2]> [output-dir] [--limit N]');
    console.log('');
    console.log('Example:');
    console.log('  bun run scripts/import-wikipedia.ts ~/jawiki/jawiki-latest-pages-articles.xml.bz2 ./wiki-library --limit 10000');
    console.log('');
    console.log('Options:');
    console.log('  --limit N    Only process first N articles (default: all)');
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  // Create output directory
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Processing ${inputFile}...`);
  console.log(`Output directory: ${outputDir}`);
  if (limit < Infinity) {
    console.log(`Limit: ${limit} articles`);
  }

  const CHUNK_SIZE = 1000;
  let entries: LibraryEntry[] = [];
  let chunkIndex = 0;
  let processed = 0;
  let totalSentences = 0;

  const startTime = Date.now();

  for await (const article of parseWikiDump(inputFile)) {
    if (processed >= limit) break;

    const sentences = extractSentences(article.text);

    if (sentences.length > 0) {
      const wordSet = new Set<string>();
      sentences.forEach(s => s.words.forEach(w => wordSet.add(w)));

      entries.push({
        id: generateId(),
        title: article.title,
        sourceType: 'wikipedia',
        sourceRef: `ja.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
        sentences,
        sentenceCount: sentences.length,
        wordCount: sentences.reduce((sum, s) => sum + s.words.length, 0),
        uniqueWordCount: wordSet.size
      });

      totalSentences += sentences.length;
    }

    processed++;

    if (processed % 1000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(processed / elapsed);
      console.log(`Processed ${processed} articles (${rate}/sec), ${totalSentences} sentences...`);
    }

    // Write chunk when full
    if (entries.length >= CHUNK_SIZE) {
      const chunkFile = join(outputDir, `wiki-${String(chunkIndex).padStart(4, '0')}.json`);
      await Bun.write(chunkFile, JSON.stringify(entries, null, 2));
      console.log(`Wrote ${chunkFile} (${entries.length} articles)`);
      entries = [];
      chunkIndex++;
    }
  }

  // Write remaining entries
  if (entries.length > 0) {
    const chunkFile = join(outputDir, `wiki-${String(chunkIndex).padStart(4, '0')}.json`);
    await Bun.write(chunkFile, JSON.stringify(entries, null, 2));
    console.log(`Wrote ${chunkFile} (${entries.length} articles)`);
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nDone! Processed ${processed} articles in ${elapsed.toFixed(1)}s`);
  console.log(`Total sentences: ${totalSentences}`);
  console.log(`Output files: ${outputDir}/wiki-*.json`);
}

main().catch(console.error);
