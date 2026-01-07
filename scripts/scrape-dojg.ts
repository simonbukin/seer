/**
 * Scrape Dictionary of Japanese Grammar (DoJG) data from itazuraneko
 *
 * This extracts grammar points from the DoJG pages and outputs a JSON file
 * for use in the Seer extension.
 *
 * Run with: bun scripts/scrape-dojg.ts
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

// Types
type DoJGLevel = 'basic' | 'intermediate' | 'advanced';

interface DoJGExample {
  ja: string;
  en: string;
}

interface DoJGGrammarPoint {
  id: string;
  pattern: string;
  level: DoJGLevel;
  meaning: string;
  formation: string[];
  examples: DoJGExample[];
  notes?: string;
  related?: string[];
  searchPatterns: string[];
  sourceUrl: string;
}

interface DoJGData {
  version: string;
  source: string;
  grammarPoints: DoJGGrammarPoint[];
  lastUpdated: string;
}

// Base URL
const BASE_URL = 'https://kenrick95.github.io/itazuraneko/grammar';
const INDEX_URL = `${BASE_URL}/dojgmain.html`;

// Rate limiting
const DELAY_MS = 100; // Small delay between requests to be polite
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Simple HTML text extraction (no external deps)
function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse the index page to get all grammar point links
async function parseIndexPage(): Promise<Array<{ url: string; pattern: string; level: DoJGLevel }>> {
  console.log('Fetching index page...');
  const response = await fetch(INDEX_URL);
  const html = await response.text();

  const links: Array<{ url: string; pattern: string; level: DoJGLevel }> = [];

  // Pattern: <a href="dojg/dojgpages/basicあげる1.html">㊦あげる(1)</a>
  // Level markers: ㊦ = basic, ㊥ = intermediate, ㊤ = advanced
  const linkRegex = /<a[^>]+href="([^"]+dojgpages\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].trim();

    // Determine level from marker
    let level: DoJGLevel;
    if (text.includes('㊦')) {
      level = 'basic';
    } else if (text.includes('㊥')) {
      level = 'intermediate';
    } else if (text.includes('㊤')) {
      level = 'advanced';
    } else {
      // Try to infer from URL
      if (href.includes('basic')) {
        level = 'basic';
      } else if (href.includes('intermediate')) {
        level = 'intermediate';
      } else if (href.includes('advanced')) {
        level = 'advanced';
      } else {
        continue; // Skip if can't determine level
      }
    }

    // Extract pattern (remove level marker and numbering)
    let pattern = text
      .replace(/[㊦㊥㊤]/g, '')
      .replace(/\(\d+\)/g, '')
      .trim();

    // Build full URL
    const url = new URL(href, INDEX_URL).href;

    links.push({ url, pattern, level });
  }

  console.log(`Found ${links.length} grammar points`);
  return links;
}

// Parse an individual grammar point page
async function parseGrammarPage(url: string, pattern: string, level: DoJGLevel): Promise<DoJGGrammarPoint | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Extract meaning - usually in the first paragraph or after the title
    let meaning = '';
    const meaningPatterns = [
      /<p[^>]*>([^<]+(?:to|a|an|the|for|of|in|with)[^<]+)<\/p>/i,
      /Meaning[:\s]+([^<]+)/i,
      /Definition[:\s]+([^<]+)/i,
    ];

    for (const regex of meaningPatterns) {
      const match = html.match(regex);
      if (match && match[1]) {
        meaning = extractText(match[1]).substring(0, 200);
        break;
      }
    }

    // If still no meaning, try to get first English sentence
    if (!meaning) {
      const englishMatch = html.match(/<p[^>]*>([A-Z][^<]{20,200})<\/p>/);
      if (englishMatch) {
        meaning = extractText(englishMatch[1]);
      }
    }

    // Default meaning if none found
    if (!meaning) {
      meaning = `${pattern} grammar pattern`;
    }

    // Extract formation patterns
    const formation: string[] = [];
    const formationMatch = html.match(/Formation[:\s]*<[^>]*>([\s\S]*?)<\/(?:p|div|ul)>/i);
    if (formationMatch) {
      const formText = extractText(formationMatch[1]);
      // Split on common separators
      formation.push(...formText.split(/[;,]/).map(f => f.trim()).filter(f => f.length > 0 && f.length < 100));
    }

    // Extract examples - look for Japanese text followed by English
    const examples: DoJGExample[] = [];

    // Pattern: Japanese sentence (often marked) followed by translation
    const exampleBlocks = html.match(/<p[^>]*>([^<]*[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF][^<]*)<\/p>\s*<p[^>]*>([^<]*[a-zA-Z][^<]*)<\/p>/g);
    if (exampleBlocks) {
      for (const block of exampleBlocks.slice(0, 5)) { // Limit to 5 examples
        const parts = block.match(/<p[^>]*>([^<]+)<\/p>/g);
        if (parts && parts.length >= 2) {
          const ja = extractText(parts[0]);
          const en = extractText(parts[1]);
          if (ja.length > 5 && en.length > 5 && /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(ja)) {
            examples.push({ ja, en });
          }
        }
      }
    }

    // Generate ID
    const id = `${level}-${pattern.replace(/[^a-zA-Z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '')}`;

    // Generate search patterns
    const searchPatterns = generateSearchPatterns(pattern);

    return {
      id,
      pattern,
      level,
      meaning,
      formation: formation.length > 0 ? formation : [`${pattern} + context`],
      examples,
      searchPatterns,
      sourceUrl: url,
    };
  } catch (error) {
    console.warn(`  Error parsing ${url}:`, error);
    return null;
  }
}

// Generate regex search patterns for a grammar point
function generateSearchPatterns(pattern: string): string[] {
  const patterns: string[] = [];

  // Clean the pattern
  const clean = pattern
    .replace(/[（）()]/g, '')
    .replace(/\d+$/, '')
    .trim();

  // Base pattern - literal match
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  patterns.push(escaped);

  // Common grammar point patterns
  const grammarPatterns: Record<string, string[]> = {
    // Verb endings
    'ている': ['て(?:い)?(?:る|た|ない|ます)'],
    'てある': ['て(?:あ)?(?:る|った|ない|ります)'],
    'ておく': ['て(?:お)?(?:く|いた|かない|きます)'],
    'てしまう': ['て(?:しま)?(?:う|った|わない|います)'],
    'てくる': ['て(?:く)?(?:る|きた|ない|きます)'],
    'ていく': ['て(?:い)?(?:く|った|かない|きます)'],
    'てみる': ['て(?:み)?(?:る|た|ない|ます)'],

    // Conditionals
    'ば': ['(?:[いきしちにびみりぎじぢびぴえけせてねべめれげぜでべぺ])ば'],
    'たら': ['(?:っ|ん|[いきしちにびみりぎじぢびぴ])たら'],
    'なら': ['(?:な)?ら(?:ば)?'],
    'と': ['[るうくすつぬふむゆ]と(?:[、。]|[^a-zA-Z])'],

    // Particles
    'のに': ['のに(?:[、。]|$|[^a-zA-Z])'],
    'ので': ['ので(?:[、。]|$|[^a-zA-Z])'],
    'から': ['から(?:[、。]|$|[^a-zA-Z])'],
    'けど': ['(?:けど|けれど(?:も)?)'],
    'が': ['が(?:[、。]|$|[^a-zA-Z])'],

    // Expressions
    'ことができる': ['こと(?:が)?(?:できる|できた|できない|できます)'],
    'ことにする': ['こと(?:に)?(?:する|した|しない|します)'],
    'ことになる': ['こと(?:に)?(?:なる|なった|ならない|なります)'],
    'ようにする': ['よう(?:に)?(?:する|した|しない|します)'],
    'ようになる': ['よう(?:に)?(?:なる|なった|ならない|なります)'],

    // Auxiliary
    'たい': ['(?:[いきしちにびみりぎじぢびぴ])たい'],
    'ほしい': ['(?:て)?(?:ほしい|欲しい)'],
    'らしい': ['らしい'],
    'ようだ': ['よう(?:だ|です|な|に)'],
    'そうだ': ['そう(?:だ|です|な|に)'],
    'みたい': ['みたい(?:だ|です|な|に)?'],

    // Giving/receiving
    'あげる': ['(?:て)?あげ(?:る|た|ない|ます)'],
    'くれる': ['(?:て)?くれ(?:る|た|ない|ます)'],
    'もらう': ['(?:て)?もら(?:う|った|わない|います)'],

    // Causative/Passive
    'させる': ['(?:[あかさたなはまやらわ])せ(?:る|た|ない|ます)'],
    'られる': ['(?:[あかさたなはまやらわ])れ(?:る|た|ない|ます)'],
  };

  // Check if we have specialized patterns
  if (grammarPatterns[clean]) {
    patterns.push(...grammarPatterns[clean]);
  }

  // For patterns with Japanese characters, add variations
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(clean)) {
    // Add hiragana/katakana variants if applicable
    const hiragana = clean.replace(/[\u30A1-\u30F6]/g, char =>
      String.fromCharCode(char.charCodeAt(0) - 0x60)
    );
    const katakana = clean.replace(/[\u3041-\u3096]/g, char =>
      String.fromCharCode(char.charCodeAt(0) + 0x60)
    );

    if (hiragana !== clean) {
      patterns.push(hiragana.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (katakana !== clean) {
      patterns.push(katakana.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }

  // Deduplicate
  return [...new Set(patterns)];
}

// Main scraping function
async function scrapeDoJG(): Promise<DoJGData> {
  console.log('Starting DoJG scrape...\n');

  // Get all grammar point links
  const links = await parseIndexPage();

  // Parse each grammar point page
  const grammarPoints: DoJGGrammarPoint[] = [];
  let count = 0;

  for (const link of links) {
    count++;
    process.stdout.write(`\r[${count}/${links.length}] Parsing ${link.pattern}...`);

    const point = await parseGrammarPage(link.url, link.pattern, link.level);
    if (point) {
      grammarPoints.push(point);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n\nSuccessfully parsed ${grammarPoints.length} grammar points`);

  // Sort by level then pattern
  const levelOrder: Record<DoJGLevel, number> = { basic: 0, intermediate: 1, advanced: 2 };
  grammarPoints.sort((a, b) => {
    if (levelOrder[a.level] !== levelOrder[b.level]) {
      return levelOrder[a.level] - levelOrder[b.level];
    }
    return a.pattern.localeCompare(b.pattern, 'ja');
  });

  // Stats
  const basicCount = grammarPoints.filter(p => p.level === 'basic').length;
  const intermediateCount = grammarPoints.filter(p => p.level === 'intermediate').length;
  const advancedCount = grammarPoints.filter(p => p.level === 'advanced').length;

  console.log(`\nBreakdown:`);
  console.log(`  Basic: ${basicCount}`);
  console.log(`  Intermediate: ${intermediateCount}`);
  console.log(`  Advanced: ${advancedCount}`);

  return {
    version: '1.0.0',
    source: 'kenrick95/itazuraneko DoJG',
    grammarPoints,
    lastUpdated: new Date().toISOString(),
  };
}

// Run the scraper
async function main() {
  try {
    const data = await scrapeDoJG();

    // Write to JSON file
    const outputPath = join(import.meta.dir, '..', 'src', 'shared', 'dojg-data.json');
    writeFileSync(outputPath, JSON.stringify(data, null, 2));

    console.log(`\nWrote data to ${outputPath}`);
    console.log(`File size: ${(JSON.stringify(data).length / 1024).toFixed(1)} KB`);
  } catch (error) {
    console.error('Scraping failed:', error);
    process.exit(1);
  }
}

main();
