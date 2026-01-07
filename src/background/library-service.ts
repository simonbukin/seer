/**
 * Library Service - Import, analyze, and query content library
 *
 * Manages the content library for pre-reading assessment and i+1 mining.
 */

import { db } from '../shared/db';
import type { LibrarySource, LibrarySentence, LibrarySourceType, LibrarySourceStatus, DifficultyLabel } from '../shared/types';
import { parseContent, type ParseResult } from '../shared/content-parser';

/**
 * Generate a unique ID for a library source
 */
function generateSourceId(): string {
  return crypto.randomUUID();
}

/**
 * Calculate difficulty label from comprehension percentage
 */
function getDifficultyLabel(comprehensionPercent: number): DifficultyLabel {
  if (comprehensionPercent >= 95) return 'Easy';
  if (comprehensionPercent >= 85) return 'Moderate';
  if (comprehensionPercent >= 70) return 'Hard';
  return 'Very Hard';
}

/**
 * Import content into the library
 * Parses text, extracts sentences/words, stores in IndexedDB
 */
export async function importContent(opts: {
  title: string;
  sourceType: LibrarySourceType;
  sourceRef?: string;
  text: string;
  onProgress?: (progress: { phase: string; percent: number }) => void;
}): Promise<LibrarySource> {
  const { title, sourceType, sourceRef, text, onProgress } = opts;

  const sourceId = generateSourceId();

  onProgress?.({ phase: 'Parsing content', percent: 0 });

  // Parse the content
  const parseResult = parseContent(text, sourceRef);

  onProgress?.({ phase: 'Storing sentences', percent: 50 });

  // Create the source record first
  const source: LibrarySource = {
    id: sourceId,
    title,
    sourceType,
    sourceRef,
    sentenceCount: parseResult.stats.totalSentences,
    wordCount: parseResult.stats.totalWords,
    uniqueWordCount: parseResult.stats.uniqueWords,
    addedAt: Date.now(),
    status: 'ready'
  };

  await db.librarySources.add(source);

  // Store sentences in batches
  const batchSize = 1000;
  const sentences = parseResult.sentences;

  for (let i = 0; i < sentences.length; i += batchSize) {
    const batch = sentences.slice(i, i + batchSize);
    const sentenceRecords: LibrarySentence[] = batch.map(s => ({
      sourceId,
      text: s.text,
      words: s.words
    }));

    await db.librarySentences.bulkAdd(sentenceRecords);

    const percent = 50 + Math.round((i / sentences.length) * 50);
    onProgress?.({ phase: 'Storing sentences', percent });
  }

  onProgress?.({ phase: 'Complete', percent: 100 });

  console.log(`[Library] Imported "${title}": ${sentences.length} sentences, ${parseResult.stats.uniqueWords} unique words`);

  return source;
}

/**
 * Analyze a source's comprehension based on current vocabulary
 */
export async function analyzeSource(
  sourceId: string,
  vocab: { known: Set<string>; ignored: Set<string> }
): Promise<LibrarySource | null> {
  const source = await db.librarySources.get(sourceId);
  if (!source) return null;

  const sentences = await db.librarySentences
    .where('sourceId')
    .equals(sourceId)
    .toArray();

  let knownCount = 0;
  let totalWords = 0;
  let i1Count = 0;
  const unknownCounts = new Map<string, number>();

  for (const sentence of sentences) {
    let unknownInSentence = 0;

    for (const word of sentence.words) {
      totalWords++;
      if (vocab.known.has(word) || vocab.ignored.has(word)) {
        knownCount++;
      } else {
        unknownInSentence++;
        unknownCounts.set(word, (unknownCounts.get(word) || 0) + 1);
      }
    }

    if (unknownInSentence === 1) i1Count++;
  }

  const comprehension = totalWords > 0
    ? Math.round((knownCount / totalWords) * 100)
    : 0;

  const topUnknown = [...unknownCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);

  const updates: Partial<LibrarySource> = {
    comprehensionPercent: comprehension,
    i1SentenceCount: i1Count,
    topUnknownWords: topUnknown,
    difficultyLabel: getDifficultyLabel(comprehension),
    lastAnalyzedAt: Date.now(),
    analysisVocabSize: vocab.known.size
  };

  await db.librarySources.update(sourceId, updates);

  return { ...source, ...updates } as LibrarySource;
}

/**
 * Recalculate all sources when vocabulary changes
 */
export async function recalculateAllSources(
  vocab: { known: Set<string>; ignored: Set<string> },
  onProgress?: (current: number, total: number) => void
): Promise<{ updated: number }> {
  const sources = await db.librarySources.toArray();
  let updated = 0;

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    await analyzeSource(source.id, vocab);
    updated++;
    onProgress?.(i + 1, sources.length);
  }

  console.log(`[Library] Recalculated ${updated} sources`);

  return { updated };
}

/**
 * Query library sources with filters and sorting
 */
export async function getLibrarySources(opts: {
  status?: LibrarySourceStatus[];
  sortBy?: 'comprehension' | 'difficulty' | 'added' | 'title' | 'sentences';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<LibrarySource[]> {
  const { status, sortBy = 'added', sortDirection = 'desc', limit = 100, offset = 0 } = opts;

  let query = db.librarySources.toCollection();

  // Filter by status if specified
  let sources = await query.toArray();

  if (status && status.length > 0) {
    sources = sources.filter(s => status.includes(s.status));
  }

  // Sort
  sources.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'comprehension':
        comparison = (a.comprehensionPercent ?? 0) - (b.comprehensionPercent ?? 0);
        break;
      case 'difficulty':
        // Lower comprehension = harder
        comparison = (b.comprehensionPercent ?? 0) - (a.comprehensionPercent ?? 0);
        break;
      case 'added':
        comparison = a.addedAt - b.addedAt;
        break;
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
      case 'sentences':
        comparison = a.sentenceCount - b.sentenceCount;
        break;
    }

    return sortDirection === 'desc' ? -comparison : comparison;
  });

  // Apply pagination
  return sources.slice(offset, offset + limit);
}

/**
 * Get a single source by ID
 */
export async function getLibrarySource(sourceId: string): Promise<LibrarySource | undefined> {
  return db.librarySources.get(sourceId);
}

/**
 * Get i+1 sentences from library
 * Optionally filtered to a specific source
 */
export async function getI1Sentences(opts: {
  sourceId?: string;
  vocab: { known: Set<string>; ignored: Set<string> };
  limit?: number;
  offset?: number;
}): Promise<Array<{ sentence: LibrarySentence; unknownWord: string; sourceTitle: string }>> {
  const { sourceId, vocab, limit = 50, offset = 0 } = opts;

  let query = sourceId
    ? db.librarySentences.where('sourceId').equals(sourceId)
    : db.librarySentences.toCollection();

  const sentences = await query.toArray();
  const results: Array<{ sentence: LibrarySentence; unknownWord: string; sourceTitle: string }> = [];

  // Cache source titles
  const sourceTitles = new Map<string, string>();

  for (const sentence of sentences) {
    // Check if this is an i+1 sentence
    let unknownWord: string | null = null;
    let unknownCount = 0;

    for (const word of sentence.words) {
      if (!vocab.known.has(word) && !vocab.ignored.has(word)) {
        unknownCount++;
        if (unknownCount === 1) {
          unknownWord = word;
        } else {
          break; // More than 1 unknown, not i+1
        }
      }
    }

    if (unknownCount === 1 && unknownWord) {
      // Get source title if not cached
      if (!sourceTitles.has(sentence.sourceId)) {
        const source = await db.librarySources.get(sentence.sourceId);
        sourceTitles.set(sentence.sourceId, source?.title || 'Unknown');
      }

      results.push({
        sentence,
        unknownWord,
        sourceTitle: sourceTitles.get(sentence.sourceId) || 'Unknown'
      });

      if (results.length >= offset + limit) break;
    }
  }

  return results.slice(offset, offset + limit);
}

/**
 * Get library statistics
 */
export async function getLibraryStats(): Promise<{
  totalSources: number;
  totalSentences: number;
  totalWords: number;
  avgComprehension: number;
  readySources: number;
}> {
  const sources = await db.librarySources.toArray();

  const totalSources = sources.length;
  const totalSentences = sources.reduce((sum, s) => sum + s.sentenceCount, 0);
  const totalWords = sources.reduce((sum, s) => sum + s.wordCount, 0);

  const sourcesWithComprehension = sources.filter(s => s.comprehensionPercent !== undefined);
  const avgComprehension = sourcesWithComprehension.length > 0
    ? Math.round(
        sourcesWithComprehension.reduce((sum, s) => sum + (s.comprehensionPercent || 0), 0) /
        sourcesWithComprehension.length
      )
    : 0;

  const readySources = sources.filter(s =>
    s.status === 'ready' && (s.comprehensionPercent ?? 0) >= 90
  ).length;

  return {
    totalSources,
    totalSentences,
    totalWords,
    avgComprehension,
    readySources
  };
}

/**
 * Update a source's status or metadata
 */
export async function updateLibrarySource(
  sourceId: string,
  updates: Partial<Pick<LibrarySource, 'title' | 'status' | 'notes'>>
): Promise<LibrarySource | null> {
  await db.librarySources.update(sourceId, updates);
  return db.librarySources.get(sourceId) || null;
}

/**
 * Delete a source and all its sentences
 */
export async function deleteLibrarySource(sourceId: string): Promise<void> {
  // Delete sentences first
  await db.librarySentences.where('sourceId').equals(sourceId).delete();

  // Delete the source
  await db.librarySources.delete(sourceId);

  console.log(`[Library] Deleted source ${sourceId}`);
}

/**
 * Search library sentences by text
 * Returns sentences with source attribution
 */
export async function searchLibrarySentences(opts: {
  query: string;
  limit?: number;
  offset?: number;
}): Promise<{
  sentences: Array<{
    text: string;
    words: string[];
    sourceId: string;
    sourceTitle: string;
    sourceType: string;
  }>;
  total: number;
  hasMore: boolean;
}> {
  const { query, limit = 50, offset = 0 } = opts;

  if (!query || query.length < 2) {
    return { sentences: [], total: 0, hasMore: false };
  }

  // Get all sentences that contain the query
  const allSentences = await db.librarySentences
    .filter(s => s.text.includes(query))
    .toArray();

  // Cache source titles
  const sourceTitles = new Map<string, { title: string; type: string }>();

  // Paginate
  const paginated = allSentences.slice(offset, offset + limit);

  // Fetch source info for results
  const results = await Promise.all(paginated.map(async s => {
    if (!sourceTitles.has(s.sourceId)) {
      const source = await db.librarySources.get(s.sourceId);
      sourceTitles.set(s.sourceId, {
        title: source?.title || 'Unknown',
        type: source?.sourceType || 'unknown'
      });
    }
    const sourceInfo = sourceTitles.get(s.sourceId)!;

    return {
      text: s.text,
      words: s.words,
      sourceId: s.sourceId,
      sourceTitle: sourceInfo.title,
      sourceType: sourceInfo.type
    };
  }));

  return {
    sentences: results,
    total: allSentences.length,
    hasMore: offset + limit < allSentences.length
  };
}

/**
 * Bulk import sentences (for CLI tool integration)
 * Takes pre-parsed sentences and creates a source
 * Deduplicates by sourceRef - skips if already exists
 */
export async function bulkImportSentences(opts: {
  sourceId: string;
  title: string;
  sourceType: LibrarySourceType;
  sourceRef?: string;
  sentences: Array<{ text: string; words: string[] }>;
}): Promise<LibrarySource | null> {
  const { sourceId, title, sourceType, sourceRef, sentences } = opts;

  // Deduplicate by sourceRef - skip if already imported
  if (sourceRef) {
    const existing = await db.librarySources
      .where('sourceType')
      .equals(sourceType)
      .filter(s => s.sourceRef === sourceRef)
      .first();

    if (existing) {
      console.log(`[Library] Skipping duplicate: "${title}" (${sourceRef})`);
      return null;
    }
  }

  // Calculate stats
  const wordSet = new Set<string>();
  let totalWords = 0;

  for (const s of sentences) {
    s.words.forEach(w => wordSet.add(w));
    totalWords += s.words.length;
  }

  // Create source record
  const source: LibrarySource = {
    id: sourceId,
    title,
    sourceType,
    sourceRef,
    sentenceCount: sentences.length,
    wordCount: totalWords,
    uniqueWordCount: wordSet.size,
    addedAt: Date.now(),
    status: 'ready'
  };

  await db.librarySources.add(source);

  // Bulk add sentences
  const sentenceRecords: LibrarySentence[] = sentences.map(s => ({
    sourceId,
    text: s.text,
    words: s.words
  }));

  await db.librarySentences.bulkAdd(sentenceRecords);

  console.log(`[Library] Bulk imported "${title}": ${sentences.length} sentences`);

  return source;
}
