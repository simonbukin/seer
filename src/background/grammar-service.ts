/**
 * Grammar detection service for DoJG pattern matching
 *
 * Loads grammar data from the bundled JSON and provides pattern matching
 * against user-encountered sentences.
 */

import type {
  DoJGData,
  DoJGGrammarPoint,
  DoJGLevel,
  GrammarMatch,
  GrammarEncounterSummary,
} from '../shared/dojg-types';
import dojgDataRaw from '../shared/dojg-data.json';
import { db } from '../shared/db';

// Type assertion for the imported JSON
const dojgData = dojgDataRaw as DoJGData;

// Storage key for known grammar
const KNOWN_GRAMMAR_KEY = 'seer-known-grammar';

// Known grammar config stored in chrome.storage.local
interface KnownGrammarConfig {
  knownGrammarIds: string[];
  lastUpdated: number;
}

/**
 * Get the list of grammar IDs marked as "known"
 */
export async function getKnownGrammarIds(): Promise<string[]> {
  const result = await chrome.storage.local.get(KNOWN_GRAMMAR_KEY);
  const config = result[KNOWN_GRAMMAR_KEY] as KnownGrammarConfig | undefined;
  return config?.knownGrammarIds || [];
}

/**
 * Set the list of grammar IDs marked as "known"
 */
export async function setKnownGrammarIds(ids: string[]): Promise<void> {
  const config: KnownGrammarConfig = {
    knownGrammarIds: ids,
    lastUpdated: Date.now(),
  };
  await chrome.storage.local.set({ [KNOWN_GRAMMAR_KEY]: config });
}

/**
 * Add a single grammar ID to the known list
 */
export async function addKnownGrammar(id: string): Promise<void> {
  const current = await getKnownGrammarIds();
  if (!current.includes(id)) {
    await setKnownGrammarIds([...current, id]);
  }
}

/**
 * Remove a single grammar ID from the known list
 */
export async function removeKnownGrammar(id: string): Promise<void> {
  const current = await getKnownGrammarIds();
  await setKnownGrammarIds(current.filter(gid => gid !== id));
}

/**
 * Check if a grammar point is marked as known
 */
export async function isGrammarKnown(id: string): Promise<boolean> {
  const known = await getKnownGrammarIds();
  return known.includes(id);
}

// Cache for compiled regex patterns
let compiledPatterns: Map<string, RegExp[]> | null = null;

/**
 * Get the full DoJG data
 */
export function getDoJGData(): DoJGData {
  return dojgData;
}

/**
 * Get all grammar points, optionally filtered by level
 */
export function getGrammarPoints(levels?: DoJGLevel[]): DoJGGrammarPoint[] {
  if (!levels || levels.length === 0) {
    return dojgData.grammarPoints;
  }
  return dojgData.grammarPoints.filter(gp => levels.includes(gp.level));
}

/**
 * Search grammar points by pattern or meaning
 */
export function searchGrammarPoints(query: string, limit: number = 20): DoJGGrammarPoint[] {
  const lowerQuery = query.toLowerCase();
  const results: DoJGGrammarPoint[] = [];

  for (const gp of dojgData.grammarPoints) {
    // Check pattern match
    if (gp.pattern.toLowerCase().includes(lowerQuery)) {
      results.push(gp);
      continue;
    }

    // Check meaning match
    if (gp.meaning.toLowerCase().includes(lowerQuery)) {
      results.push(gp);
      continue;
    }

    // Check ID match
    if (gp.id.toLowerCase().includes(lowerQuery)) {
      results.push(gp);
    }

    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

/**
 * Get a grammar point by ID
 */
export function getGrammarPointById(id: string): DoJGGrammarPoint | undefined {
  return dojgData.grammarPoints.find(gp => gp.id === id);
}

/**
 * Compile and cache regex patterns for all grammar points
 */
function getCompiledPatterns(): Map<string, RegExp[]> {
  if (compiledPatterns) return compiledPatterns;

  compiledPatterns = new Map();

  for (const gp of dojgData.grammarPoints) {
    const regexes: RegExp[] = [];

    for (const pattern of gp.searchPatterns) {
      try {
        regexes.push(new RegExp(pattern, 'g'));
      } catch (e) {
        // Invalid regex, skip
        console.warn(`[Grammar] Invalid regex for ${gp.id}: ${pattern}`);
      }
    }

    if (regexes.length > 0) {
      compiledPatterns.set(gp.id, regexes);
    }
  }

  console.log(`[Grammar] Compiled ${compiledPatterns.size} pattern sets`);
  return compiledPatterns;
}

/**
 * Determine confidence level of a grammar match
 */
function determineConfidence(
  gp: DoJGGrammarPoint,
  matchedText: string,
  sentence: string
): 'high' | 'medium' | 'low' {
  // High confidence: pattern is distinctive (longer or has multiple parts)
  if (matchedText.length >= 4 || gp.searchPatterns.length > 1) {
    return 'high';
  }

  // Low confidence: very short patterns that might be coincidental
  if (matchedText.length <= 2) {
    return 'low';
  }

  return 'medium';
}

/**
 * Detect grammar patterns in a single sentence
 */
export function detectGrammarInSentence(sentence: string): GrammarMatch[] {
  const patterns = getCompiledPatterns();
  const matches: GrammarMatch[] = [];
  const seen = new Set<string>(); // Dedupe by grammarId

  for (const [grammarId, regexes] of patterns) {
    // Skip if already matched this grammar point
    if (seen.has(grammarId)) continue;

    for (const regex of regexes) {
      // Reset regex state
      regex.lastIndex = 0;

      let match;
      while ((match = regex.exec(sentence)) !== null) {
        const gp = getGrammarPointById(grammarId);
        if (!gp) continue;

        matches.push({
          grammarId,
          pattern: gp.pattern,
          matchedText: match[0],
          sentence,
          position: match.index,
          confidence: determineConfidence(gp, match[0], sentence),
        });

        seen.add(grammarId);
        break; // One match per grammar point per sentence is enough
      }
    }
  }

  return matches;
}

/**
 * Scan all stored sentences for grammar patterns
 * Returns a summary of which patterns appear most frequently
 */
export async function getDetectedGrammarFromEncounters(
  timeRangeDays: number = 30,
  levels?: DoJGLevel[]
): Promise<GrammarEncounterSummary[]> {
  // Get sentences from the last N days
  // Note: timestamp is not indexed, so we fetch all and filter in memory
  const cutoff = Date.now() - timeRangeDays * 24 * 60 * 60 * 1000;

  const allSentences = await db.sentences.toArray();
  const sentences = allSentences.filter(s => s.timestamp >= cutoff);

  console.log(`[Grammar] Scanning ${sentences.length} sentences for grammar patterns (filtered from ${allSentences.length} total)`);

  // Count grammar occurrences
  const grammarCounts = new Map<string, { count: number; lastSeen: number }>();

  // Get grammar points filtered by level
  const grammarPoints = getGrammarPoints(levels);
  const grammarIds = new Set(grammarPoints.map(gp => gp.id));

  for (const sentence of sentences) {
    const matches = detectGrammarInSentence(sentence.text);

    for (const match of matches) {
      // Skip if not in level filter
      if (!grammarIds.has(match.grammarId)) continue;

      const existing = grammarCounts.get(match.grammarId);
      if (existing) {
        existing.count++;
        existing.lastSeen = Math.max(existing.lastSeen, sentence.timestamp);
      } else {
        grammarCounts.set(match.grammarId, {
          count: 1,
          lastSeen: sentence.timestamp,
        });
      }
    }
  }

  // Build summary array
  const summaries: GrammarEncounterSummary[] = [];

  for (const [grammarId, data] of grammarCounts) {
    const gp = getGrammarPointById(grammarId);
    if (!gp) continue;

    summaries.push({
      grammarId,
      pattern: gp.pattern,
      level: gp.level,
      meaning: gp.meaning,
      encounterCount: data.count,
      lastSeen: data.lastSeen,
    });
  }

  // Sort by encounter count (descending)
  summaries.sort((a, b) => b.encounterCount - a.encounterCount);

  console.log(`[Grammar] Found ${summaries.length} unique grammar patterns in encounters`);
  return summaries;
}

/**
 * Get grammar points that appear most frequently in user's encountered sentences
 * Useful for auto-selecting grammar to drill
 */
export async function getTopEncounteredGrammar(
  limit: number = 10,
  timeRangeDays: number = 30,
  levels?: DoJGLevel[]
): Promise<DoJGGrammarPoint[]> {
  const summaries = await getDetectedGrammarFromEncounters(timeRangeDays, levels);

  return summaries.slice(0, limit).map(s => getGrammarPointById(s.grammarId)!).filter(Boolean);
}
