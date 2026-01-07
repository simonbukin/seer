/**
 * Story Prompt Generation Service
 *
 * Generates Claude-ready prompts that combine lapsed vocabulary from Anki
 * and grammar patterns from DoJG detected in encountered sentences.
 */

import type { VocabData, StoryPromptConfig, PromptTemplate, PromptTemplatesConfig } from "../shared/types";
import type { DoJGGrammarPoint } from "../shared/dojg-types";
import { db } from "../shared/db";
import { getTopEncounteredGrammar, getGrammarPoints, getKnownGrammarIds } from "./grammar-service";

// Storage key for prompt templates
const TEMPLATES_STORAGE_KEY = 'seer-prompt-templates';

// Default template ID
const DEFAULT_TEMPLATE_ID = 'default-story';

// Default template that matches current behavior
const DEFAULT_TEMPLATE: PromptTemplate = {
  id: DEFAULT_TEMPLATE_ID,
  name: 'Story Generation',
  isDefault: true,
  template: `You are a Japanese language learning assistant. Create a short story in Japanese that naturally incorporates the following vocabulary and grammar points.

## Target Vocabulary (words I'm reviewing)
{all_vocab}

## Target Grammar Points (from Dictionary of Japanese Grammar)
{grammar}

## Story Requirements
- Style: {style}
- Difficulty: {difficulty}
- Length: {length}
- Incorporate the target vocabulary and grammar naturally - don't force them all in if it sounds unnatural

## Output Format
1. Write the story in Japanese ({length})
2. Use furigana for kanji on the first occurrence only: 漢字[かんじ]
3. After the story, list which target words and grammar you used
4. Provide a brief English summary

Make sure to repeat frequently in natural and varied contexts to drill in vocab and grammar.

Please write the story now:`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Get all prompt templates from storage
 */
export async function getPromptTemplates(): Promise<PromptTemplatesConfig> {
  const result = await chrome.storage.local.get(TEMPLATES_STORAGE_KEY);
  const config = result[TEMPLATES_STORAGE_KEY] as PromptTemplatesConfig | undefined;

  // If no templates exist, create default
  if (!config || !config.templates || config.templates.length === 0) {
    const defaultConfig: PromptTemplatesConfig = {
      templates: [DEFAULT_TEMPLATE],
      activeTemplateId: DEFAULT_TEMPLATE_ID,
    };
    await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: defaultConfig });
    return defaultConfig;
  }

  // Ensure default template exists
  if (!config.templates.find(t => t.id === DEFAULT_TEMPLATE_ID)) {
    config.templates.unshift(DEFAULT_TEMPLATE);
    await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: config });
  }

  return config;
}

/**
 * Save a prompt template (create or update)
 */
export async function savePromptTemplate(template: PromptTemplate): Promise<void> {
  const config = await getPromptTemplates();

  const existingIndex = config.templates.findIndex(t => t.id === template.id);
  if (existingIndex >= 0) {
    // Update existing
    config.templates[existingIndex] = {
      ...template,
      updatedAt: Date.now(),
    };
  } else {
    // Create new
    config.templates.push({
      ...template,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: config });
}

/**
 * Delete a prompt template
 */
export async function deletePromptTemplate(templateId: string): Promise<void> {
  const config = await getPromptTemplates();

  // Cannot delete default template
  const template = config.templates.find(t => t.id === templateId);
  if (template?.isDefault) {
    throw new Error('Cannot delete default template');
  }

  config.templates = config.templates.filter(t => t.id !== templateId);

  // If active template was deleted, switch to default
  if (config.activeTemplateId === templateId) {
    config.activeTemplateId = DEFAULT_TEMPLATE_ID;
  }

  await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: config });
}

/**
 * Set the active template
 */
export async function setActiveTemplate(templateId: string): Promise<void> {
  const config = await getPromptTemplates();

  if (!config.templates.find(t => t.id === templateId)) {
    throw new Error('Template not found');
  }

  config.activeTemplateId = templateId;
  await chrome.storage.local.set({ [TEMPLATES_STORAGE_KEY]: config });
}

/**
 * Get the currently active template
 */
export async function getActiveTemplate(): Promise<PromptTemplate> {
  const config = await getPromptTemplates();
  const template = config.templates.find(t => t.id === config.activeTemplateId);
  return template || DEFAULT_TEMPLATE;
}

export const DEFAULT_PROMPT_CONFIG: StoryPromptConfig = {
  includeLapsedWords: true,
  lapsedMinLapses: 2,
  lapsedRecencyDays: 30,
  includeUnknownWords: false,
  unknownMinEncounters: 5,
  includeRecentlyWrong: true,
  recentlyWrongDays: 1,
  includeAutoDetected: true,
  excludeKnownGrammar: true,
  grammarTimeRangeDays: 30,
  manualGrammarIds: [],
  grammarLevelFilter: ["basic", "intermediate"],
  wordCount: 10,
  grammarCount: 3,
  storyStyle: "slice-of-life",
  difficultyHint: "natural",
};

// Lapsed word with context
export interface LapsedWordInfo {
  word: string;
  lapses: number;
  interval: number;
  level: string;
  exampleSentence?: string;
}

// Unknown word with encounter count
export interface UnknownWordInfo {
  word: string;
  encounterCount: number;
  lastSeen: number;
  exampleSentence?: string;
}

// Recently wrong word (in relearning state)
export interface RecentlyWrongWordInfo {
  word: string;
  lapses: number;
  level: string;
  exampleSentence?: string;
}

/**
 * Get words that were failed in Anki recently.
 * Uses the failedTodayWords passed from the service worker (queried from Anki via rated:N:1).
 * Falls back to looking at cards in relearning state if no failed words are passed.
 */
export async function getRecentlyWrongWords(
  vocabData: VocabData,
  config: StoryPromptConfig,
  failedTodayWords: string[] = []
): Promise<RecentlyWrongWordInfo[]> {
  const wrongWords: RecentlyWrongWordInfo[] = [];

  // Use failed words from Anki query if available
  if (failedTodayWords.length > 0) {
    for (const word of failedTodayWords) {
      const knowledge = vocabData.knowledgeLevels?.get(word);

      // Get an example sentence from encounters
      const encounters = await db.encounters
        .where("word")
        .equals(word)
        .limit(1)
        .toArray();

      wrongWords.push({
        word,
        lapses: knowledge?.lapses ?? 1,
        level: knowledge?.level ?? 'learning',
        exampleSentence: encounters[0]?.sentence,
      });
    }
  } else if (vocabData.knowledgeLevels) {
    // Fallback: look for cards in relearning state
    for (const [word, knowledge] of vocabData.knowledgeLevels) {
      // Cards in "learning" state with lapses > 0 are being relearned after being forgotten
      if (knowledge.level === 'learning' && knowledge.lapses > 0) {
        const encounters = await db.encounters
          .where("word")
          .equals(word)
          .limit(1)
          .toArray();

        wrongWords.push({
          word,
          lapses: knowledge.lapses,
          level: knowledge.level,
          exampleSentence: encounters[0]?.sentence,
        });
      }
    }
  }

  // Sort by lapses (most problematic first)
  wrongWords.sort((a, b) => b.lapses - a.lapses);

  // Limit to a reasonable number
  return wrongWords.slice(0, Math.min(config.wordCount, 5));
}

/**
 * Get words that the user keeps forgetting (high lapse count)
 */
export async function getLapsedWords(
  vocabData: VocabData,
  config: StoryPromptConfig
): Promise<LapsedWordInfo[]> {
  const lapsed: LapsedWordInfo[] = [];

  console.log(
    "[Seer] getLapsedWords: knowledgeLevels size =",
    vocabData.knowledgeLevels?.size ?? 0
  );
  console.log(
    "[Seer] getLapsedWords: config =",
    config.lapsedMinLapses,
    config.lapsedRecencyDays
  );

  if (!vocabData.knowledgeLevels) {
    console.warn("[Seer] getLapsedWords: knowledgeLevels is undefined");
    return [];
  }

  for (const [word, knowledge] of vocabData.knowledgeLevels) {
    // Skip if not enough lapses
    if (knowledge.lapses < config.lapsedMinLapses) continue;

    // Skip if interval is too long (word is now stable)
    if (
      config.lapsedRecencyDays > 0 &&
      knowledge.interval > config.lapsedRecencyDays
    )
      continue;

    // Get an example sentence from encounters
    const encounters = await db.encounters
      .where("word")
      .equals(word)
      .limit(1)
      .toArray();

    lapsed.push({
      word,
      lapses: knowledge.lapses,
      interval: knowledge.interval,
      level: knowledge.level,
      exampleSentence: encounters[0]?.sentence,
    });
  }

  // Sort by lapses (descending) then by interval (ascending = more urgent)
  lapsed.sort((a, b) => {
    if (b.lapses !== a.lapses) return b.lapses - a.lapses;
    return a.interval - b.interval;
  });

  return lapsed.slice(0, config.wordCount);
}

/**
 * Get unknown words that appear frequently in encounters
 */
export async function getFrequentUnknownWords(
  vocabData: VocabData,
  config: StoryPromptConfig
): Promise<UnknownWordInfo[]> {
  // Get all encounters
  const encounters = await db.encounters.toArray();

  // Count encounters per word, excluding known/ignored
  const wordCounts = new Map<
    string,
    { count: number; lastSeen: number; sentence?: string }
  >();

  for (const enc of encounters) {
    // Skip known and ignored words
    if (vocabData.known.has(enc.word)) continue;
    if (vocabData.ignored.has(enc.word)) continue;

    const existing = wordCounts.get(enc.word);
    if (existing) {
      existing.count++;
      if (enc.timestamp > existing.lastSeen) {
        existing.lastSeen = enc.timestamp;
        existing.sentence = enc.sentence;
      }
    } else {
      wordCounts.set(enc.word, {
        count: 1,
        lastSeen: enc.timestamp,
        sentence: enc.sentence,
      });
    }
  }

  // Filter and sort
  const unknowns: UnknownWordInfo[] = [];

  for (const [word, data] of wordCounts) {
    if (data.count >= config.unknownMinEncounters) {
      unknowns.push({
        word,
        encounterCount: data.count,
        lastSeen: data.lastSeen,
        exampleSentence: data.sentence,
      });
    }
  }

  // Sort by encounter count (descending)
  unknowns.sort((a, b) => b.encounterCount - a.encounterCount);

  // Limit to remaining slots after lapsed words
  const maxUnknowns = Math.max(
    0,
    config.wordCount - (config.includeLapsedWords ? config.wordCount / 2 : 0)
  );
  return unknowns.slice(0, Math.floor(maxUnknowns));
}

/**
 * Get grammar points for the prompt
 */
export async function getGrammarForPrompt(
  config: StoryPromptConfig
): Promise<DoJGGrammarPoint[]> {
  const grammar: DoJGGrammarPoint[] = [];

  // Get known grammar IDs to exclude from auto-detection
  const knownGrammarIds = config.excludeKnownGrammar
    ? new Set(await getKnownGrammarIds())
    : new Set<string>();

  // Get auto-detected grammar from encounters
  if (config.includeAutoDetected) {
    const detected = await getTopEncounteredGrammar(
      // Request more than needed so we have enough after filtering
      config.grammarCount * 2,
      config.grammarTimeRangeDays,
      config.grammarLevelFilter.length > 0
        ? config.grammarLevelFilter
        : undefined
    );
    // Filter out known grammar from auto-detection
    for (const gp of detected) {
      if (!knownGrammarIds.has(gp.id) && grammar.length < config.grammarCount) {
        grammar.push(gp);
      }
    }
  }

  // Add manually selected grammar (don't filter known - user explicitly selected them)
  if (config.manualGrammarIds.length > 0) {
    const allGrammar = getGrammarPoints();
    for (const id of config.manualGrammarIds) {
      const gp = allGrammar.find((g) => g.id === id);
      if (gp && !grammar.find((g) => g.id === id)) {
        grammar.push(gp);
      }
    }
  }

  // If we still don't have enough, fill with common grammar points (excluding known)
  if (grammar.length < config.grammarCount) {
    const filtered = getGrammarPoints(config.grammarLevelFilter);
    for (const gp of filtered) {
      if (!grammar.find((g) => g.id === gp.id) && !knownGrammarIds.has(gp.id)) {
        grammar.push(gp);
        if (grammar.length >= config.grammarCount) break;
      }
    }
  }

  return grammar.slice(0, config.grammarCount);
}

/**
 * Format vocabulary section of the prompt
 */
function formatVocabularySection(
  recentlyWrongWords: RecentlyWrongWordInfo[],
  lapsedWords: LapsedWordInfo[],
  unknownWords: UnknownWordInfo[]
): string {
  const lines: string[] = [];

  if (recentlyWrongWords.length > 0) {
    lines.push("### Words I just got wrong (priority - currently relearning)");
    for (const w of recentlyWrongWords) {
      lines.push(`- ${w.word} (failed ${w.lapses} times total)`);
    }
    lines.push("");
  }

  if (lapsedWords.length > 0) {
    lines.push("### Words to reinforce (I keep forgetting these)");
    for (const w of lapsedWords) {
      lines.push(
        `- ${w.word} (forgotten ${w.lapses} times, interval: ${w.interval} days)`
      );
    }
    lines.push("");
  }

  if (unknownWords.length > 0) {
    lines.push("### New words to introduce (frequently encountered)");
    for (const w of unknownWords) {
      lines.push(`- ${w.word} (seen ${w.encounterCount} times)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format grammar section of the prompt
 */
function formatGrammarSection(grammar: DoJGGrammarPoint[]): string {
  const lines: string[] = [];

  for (const g of grammar) {
    lines.push(`### ${g.pattern} (${g.level})`);
    lines.push(`Meaning: ${g.meaning}`);

    if (g.formation.length > 0) {
      lines.push(`Formation: ${g.formation.slice(0, 2).join(" / ")}`);
    }

    if (g.examples.length > 0) {
      lines.push(`Example: ${g.examples[0].ja}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// Style descriptions for template variable
const STYLE_DESCRIPTIONS: Record<string, string> = {
  "slice-of-life": "A calm, everyday situation (e.g., at home, at work, with friends)",
  adventure: "An exciting adventure or journey",
  mystery: "A mystery or puzzle to solve",
  "casual-conversation": "A natural conversation between characters",
};

// Difficulty descriptions for template variable
const DIFFICULTY_DESCRIPTIONS: Record<string, string> = {
  easy: "Use simpler sentence structures and common vocabulary alongside the target words",
  natural: "Use natural Japanese at an intermediate level - don't force the vocabulary",
  challenging: "Use more complex sentence structures and literary expressions",
};

/**
 * Format recently wrong words section
 */
function formatRecentlyWrongSection(words: RecentlyWrongWordInfo[]): string {
  if (words.length === 0) return "";
  const lines = ["### Words I just got wrong (priority - currently relearning)"];
  for (const w of words) {
    lines.push(`- ${w.word} (failed ${w.lapses} times total)`);
  }
  return lines.join("\n");
}

/**
 * Format lapsed words section
 */
function formatLapsedSection(words: LapsedWordInfo[]): string {
  if (words.length === 0) return "";
  const lines = ["### Words to reinforce (I keep forgetting these)"];
  for (const w of words) {
    lines.push(`- ${w.word} (forgotten ${w.lapses} times, interval: ${w.interval} days)`);
  }
  return lines.join("\n");
}

/**
 * Format unknown words section
 */
function formatUnknownSection(words: UnknownWordInfo[]): string {
  if (words.length === 0) return "";
  const lines = ["### New words to introduce (frequently encountered)"];
  for (const w of words) {
    lines.push(`- ${w.word} (seen ${w.encounterCount} times)`);
  }
  return lines.join("\n");
}

/**
 * Render a template with variable substitution
 */
function renderTemplate(
  template: string,
  data: {
    recentlyWrongWords: RecentlyWrongWordInfo[];
    lapsedWords: LapsedWordInfo[];
    unknownWords: UnknownWordInfo[];
    grammar: DoJGGrammarPoint[];
    config: StoryPromptConfig;
  }
): string {
  const variables: Record<string, string> = {
    recently_wrong: formatRecentlyWrongSection(data.recentlyWrongWords),
    lapsed: formatLapsedSection(data.lapsedWords),
    unknown: formatUnknownSection(data.unknownWords),
    all_vocab: formatVocabularySection(data.recentlyWrongWords, data.lapsedWords, data.unknownWords),
    grammar: formatGrammarSection(data.grammar),
    grammar_list: data.grammar.map(g => g.pattern).join(', '),
    style: STYLE_DESCRIPTIONS[data.config.storyStyle] || data.config.storyStyle,
    difficulty: DIFFICULTY_DESCRIPTIONS[data.config.difficultyHint] || data.config.difficultyHint,
    word_count: String(data.recentlyWrongWords.length + data.lapsedWords.length + data.unknownWords.length),
    grammar_count: String(data.grammar.length),
    length: '300-500 characters',
  };

  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Generate the complete story prompt
 * @param failedTodayWords Words failed in Anki recently (queried via rated:N:1)
 */
export async function generateStoryPrompt(
  vocabData: VocabData,
  config: StoryPromptConfig,
  failedTodayWords: string[] = []
): Promise<{
  prompt: string;
  wordCount: number;
  grammarCount: number;
  recentlyWrongWords: RecentlyWrongWordInfo[];
  lapsedWords: LapsedWordInfo[];
  unknownWords: UnknownWordInfo[];
  grammar: DoJGGrammarPoint[];
}> {
  console.log("[Seer] generateStoryPrompt called");
  console.log(
    "[Seer] vocabData.knowledgeLevels size:",
    vocabData.knowledgeLevels?.size ?? "undefined"
  );
  console.log("[Seer] config:", JSON.stringify(config));
  console.log("[Seer] failedTodayWords:", failedTodayWords.length);

  // Gather all the data - recently wrong first (highest priority)
  const recentlyWrongWords = config.includeRecentlyWrong
    ? await getRecentlyWrongWords(vocabData, config, failedTodayWords)
    : [];

  console.log("[Seer] recentlyWrongWords count:", recentlyWrongWords.length);

  const lapsedWords = config.includeLapsedWords
    ? await getLapsedWords(vocabData, config)
    : [];

  console.log("[Seer] lapsedWords count:", lapsedWords.length);

  const unknownWords = config.includeUnknownWords
    ? await getFrequentUnknownWords(vocabData, config)
    : [];

  console.log("[Seer] unknownWords count:", unknownWords.length);

  const grammar = await getGrammarForPrompt(config);

  console.log("[Seer] grammar count:", grammar.length);

  // Check if we have enough content - allow generating even with just grammar
  if (
    recentlyWrongWords.length === 0 &&
    lapsedWords.length === 0 &&
    unknownWords.length === 0 &&
    grammar.length === 0
  ) {
    return {
      prompt:
        "No vocabulary or grammar data available. Please sync with Anki first and ensure you have some lapsed words, encountered sentences, or select grammar points manually.",
      wordCount: 0,
      grammarCount: 0,
      recentlyWrongWords: [],
      lapsedWords: [],
      unknownWords: [],
      grammar: [],
    };
  }

  // Get active template and render
  const activeTemplate = await getActiveTemplate();
  const prompt = renderTemplate(activeTemplate.template, {
    recentlyWrongWords,
    lapsedWords,
    unknownWords,
    grammar,
    config,
  });

  return {
    prompt,
    wordCount: recentlyWrongWords.length + lapsedWords.length + unknownWords.length,
    grammarCount: grammar.length,
    recentlyWrongWords,
    lapsedWords,
    unknownWords,
    grammar,
  };
}
