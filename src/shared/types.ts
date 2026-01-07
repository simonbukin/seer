// Configuration
export type LayerCategory = 'frequency' | 'pos' | 'status' | 'knowledge';
export type LayerStyleType = 'background' | 'underline' | 'outline' | 'none';
export type UnderlineStyle = 'solid' | 'dotted' | 'dashed' | 'wavy';
export type ThemeMode = 'light' | 'dark' | 'auto';

// Ignore list for filtering out domains/pages from tracking
export interface IgnoreList {
  domains: string[];  // Full domain to ignore (e.g., "jisho.org")
  urls: string[];     // Specific URL patterns to ignore (exact match or prefix)
}

// Deduplication config for encounter tracking
export interface DeduplicationConfig {
  enabled: boolean;           // Whether time-window dedup is enabled
  timeWindowHours: number;    // Skip duplicates within this window (default: 4)
}

export interface HighlightLayerConfig {
  id: string;
  label: string;
  category: LayerCategory;
  enabled: boolean;
  styleType: LayerStyleType;
  color: string;  // RGBA format
  textColor?: string;  // Optional RGBA format for text color (combinable with other styles)
  underlineStyle?: UnderlineStyle;
  underlineThickness?: number;  // 1-5px
  priority: number;  // Stacking order (lower = bottom)
}

export interface HighlightConfig {
  globalEnabled: boolean;
  layers: Record<string, HighlightLayerConfig>;
}

export interface SeerConfig {
  ankiConnectUrl: string;
  ankiConnectApiKey: string;
  knownSources: VocabSource[];
  ignoredSource: VocabSource;
  knownSource: VocabSource;  // Deck for manually marked known words (Shift+K)
  syncIntervalMinutes: number;
  highlightConfig: HighlightConfig;
  showStatsPanel: boolean;
  enabled: boolean;
  debugMode: boolean;
  ignoreList: IgnoreList;
  mokuroMode: boolean;  // Force Mokuro OCR text extraction for manga readers
  deduplication: DeduplicationConfig;  // Encounter deduplication settings
  theme: ThemeMode;  // UI theme: light, dark, or auto (system preference)
  highlightsVisible: boolean;  // Master toggle for highlight visibility
}

export interface VocabSource {
  deckName: string;
  fieldName: string;
}

// Knowledge level based on Anki review state
export type KnowledgeLevel = 'new' | 'learning' | 'young' | 'mature';

// Word with its knowledge level
export interface WordKnowledge {
  word: string;
  level: KnowledgeLevel;
  interval: number;   // Days until next review
  reps: number;       // Total number of reviews
  lapses: number;     // Times forgotten
  suspended: boolean; // Whether card is suspended in Anki (queue=-1)
}

// Vocabulary source breakdown
export interface VocabSourceCounts {
  miningDecks: number;      // Unique words from study/mining decks (knownSources)
  markedKnown: number;      // Words explicitly marked known (Seer::Known)
  ignored: number;          // Words in ignored deck (Seer::Ignored)
}

// Vocabulary
export interface VocabData {
  known: Set<string>;
  ignored: Set<string>;
  knowledgeLevels: Map<string, WordKnowledge>;  // Word -> knowledge details
  lastSync: number;
  totalCards: number;
  sourceCounts?: VocabSourceCounts;  // Breakdown by source
}

// Serializable version for storage/messaging
export interface VocabDataSerialized {
  known: string[];
  ignored: string[];
  knowledgeLevels: Array<[string, WordKnowledge]>;  // Serialized Map
  lastSync: number;
  totalCards: number;
  sourceCounts?: VocabSourceCounts;  // Breakdown by source
}

// Tokenization
export interface TokenResult {
  surface: string;
  baseForm: string;
  start: number;
  end: number;
  inflectionTrace?: string[];  // Yomitan-style deinflection trace
}

export interface ProcessedToken extends TokenResult {
  status: 'known' | 'unknown' | 'ignored';
  frequency?: number;
  knowledgeLevel?: KnowledgeLevel;  // Only set for 'known' tokens that have Anki data
}

// Knowledge level breakdown for comprehension stats
export interface KnowledgeLevelBreakdown {
  mature: number;    // Percentage of words at mature level
  young: number;     // Percentage of words at young level
  learning: number;  // Percentage of words at learning level
  new: number;       // Percentage of words at new level (in Anki but never reviewed)
  unknown: number;   // Percentage of words not in Anki at all
}

// Stats
export interface PageStats {
  url: string;
  totalTokens: number;
  knownTokens: number;
  unknownTokens: number;
  ignoredTokens: number;
  comprehensionPercent: number;
  topUnknown: Array<{ word: string; count: number }>;
  // Knowledge level breakdown
  knowledgeBreakdown?: KnowledgeLevelBreakdown;
  // Rarity metrics
  averageFrequency?: number;      // Average frequency rank (lower = more common)
  veryCommonPercent?: number;     // % of words in top 1k
  commonPercent?: number;          // % of words in 1k-5k
  mediumPercent?: number;          // % of words in 5k-15k
  uncommonPercent?: number;        // % of words in 15k-50k
  rarePercent?: number;            // % of words 50k+
}

// Difficulty rating labels
export type DifficultyLabel = 'Easy' | 'Moderate' | 'Hard' | 'Very Hard';

// =============================================================================
// Content Library Types
// =============================================================================

// Source type for library content
export type LibrarySourceType = 'srt' | 'txt' | 'url' | 'paste' | 'wikipedia' | 'epub' | 'vn';

// Status of a library source
export type LibrarySourceStatus = 'importing' | 'ready' | 'reading' | 'completed' | 'archived';

/**
 * LibrarySource - metadata about each content source in the library
 * (books, anime subtitles, Wikipedia articles, etc.)
 */
export interface LibrarySource {
  id: string;                     // UUID or content hash
  title: string;                  // User-editable title
  sourceType: LibrarySourceType;
  sourceRef?: string;             // Filename, URL, etc.

  // Aggregated stats (computed from sentences)
  sentenceCount: number;
  wordCount: number;
  uniqueWordCount: number;

  // Analysis results (updated on recalc)
  comprehensionPercent?: number;
  i1SentenceCount?: number;
  averageDifficulty?: number;
  difficultyLabel?: DifficultyLabel;
  topUnknownWords?: string[];     // Top 20 unknown words

  // Tracking
  addedAt: number;
  lastAnalyzedAt?: number;
  analysisVocabSize?: number;     // Vocab size when last analyzed

  // User data
  status: LibrarySourceStatus;
  notes?: string;
}

/**
 * LibrarySentence - individual sentence from library content
 * Words are pre-extracted for fast recalculation
 */
export interface LibrarySentence {
  id?: number;                    // Auto-increment PK
  sourceId: string;               // FK to LibrarySource
  text: string;                   // The sentence (for display/mining)
  words: string[];                // Pre-extracted base forms (for fast recalc)
}

// i+1 sentence from virtual analysis (sentence with exactly 1 unknown word)
export interface VirtualI1Sentence {
  text: string;           // Full sentence text
  unknownWord: string;    // The single unknown word in this sentence
}

// Virtual page analysis (full page scan without encounter recording)
export interface VirtualPageStats {
  url: string;
  totalTokens: number;
  knownTokens: number;
  unknownTokens: number;
  ignoredTokens: number;
  comprehensionPercent: number;
  topUnknown: Array<{ word: string; count: number }>;
  knowledgeBreakdown?: KnowledgeLevelBreakdown;
  // Frequency breakdown
  veryCommonPercent?: number;
  commonPercent?: number;
  mediumPercent?: number;
  uncommonPercent?: number;
  rarePercent?: number;
  // Scan progress
  isComplete: boolean;
  scannedNodes: number;
  totalNodes: number;
  // Text metrics
  characterCount?: number;      // Japanese characters only (no spaces/punctuation)
  wordCount?: number;           // Total word tokens
  uniqueWordCount?: number;     // Unique word forms
  hapaxCount?: number;          // Words appearing only once
  hapaxPercent?: number;        // hapax / uniqueWords * 100
  // Kanji metrics
  totalKanjiCount?: number;     // Total kanji occurrences
  uniqueKanjiCount?: number;    // Unique kanji characters
  kanjiHapaxCount?: number;     // Kanji appearing only once
  // Difficulty metrics (research-backed)
  minDifficulty?: number;       // Minimum (easiest) word difficulty
  medianDifficulty?: number;    // Median word difficulty
  averageDifficulty?: number;   // Composite score 0-100 (60% freq + 25% comp + 15% sentence)
  peakDifficulty?: number;      // 90th percentile frequency difficulty
  difficultyLabel?: DifficultyLabel;
  difficultyPerSection?: number[]; // Difficulty per 5% section (20 values)
  // Sentence metrics
  sentenceCount?: number;       // Total sentences
  i1SentenceCount?: number;     // Sentences with exactly 1 unknown word
  avgSentenceLength?: number;   // Average tokens per sentence
  medianSentenceLength?: number; // Median tokens per sentence
  minSentenceLength?: number;   // Shortest sentence
  maxSentenceLength?: number;   // Longest sentence
  // i+1 sentences list (for display in sidepanel)
  i1Sentences?: VirtualI1Sentence[];  // Up to 50 i+1 sentences
}

// DoJG Story Prompt configuration
export type DoJGLevel = 'basic' | 'intermediate' | 'advanced';
export type StoryStyle = 'slice-of-life' | 'adventure' | 'mystery' | 'casual-conversation';
export type DifficultyHint = 'easy' | 'natural' | 'challenging';

export interface StoryPromptConfig {
  // Vocabulary settings
  includeLapsedWords: boolean;      // Words with high lapses count
  lapsedMinLapses: number;          // Minimum lapses to qualify (default: 2)
  lapsedRecencyDays: number;        // Only include words with interval <= N days (0 = any)
  includeUnknownWords: boolean;     // Include frequently encountered unknowns
  unknownMinEncounters: number;     // Minimum encounters for unknown words
  includeRecentlyWrong: boolean;    // Include cards marked wrong recently in Anki
  recentlyWrongDays: number;        // Time window for "recently wrong" (default: 1 = today)

  // Grammar settings
  includeAutoDetected: boolean;     // Auto-detect grammar from encounters
  excludeKnownGrammar: boolean;     // Exclude grammar marked as "known" from auto-detection
  grammarTimeRangeDays: number;     // Time range for grammar detection
  manualGrammarIds: string[];       // Manually selected grammar point IDs
  grammarLevelFilter: DoJGLevel[];  // Filter by level

  // Output settings
  wordCount: number;                // Target words for prompt (default: 10)
  grammarCount: number;             // Target grammar points (default: 3)
  storyStyle: StoryStyle;
  difficultyHint: DifficultyHint;
}

// Messages
export type MessageType =
  | { type: 'tokenize'; text: string }
  | { type: 'getVocabulary' }
  | { type: 'syncVocabulary' }
  | { type: 'getConfig' }
  | { type: 'setConfig'; config: Partial<SeerConfig> }
  | { type: 'getStats'; tabId: number }
  | { type: 'toggleLayer'; layerId: string; enabled: boolean }
  | { type: 'updateLayerStyle'; layerId: string; config: Partial<HighlightLayerConfig> }
  | { type: 'getHighlightConfig' }
  | { type: 'addToIgnoreList'; ignoreType: 'domain' | 'url'; value: string }
  | { type: 'removeFromIgnoreList'; ignoreType: 'domain' | 'url'; value: string }
  | { type: 'isPageIgnored'; url: string }
  | { type: 'addKnownWord'; word: string }
  // Story Prompt messages
  | { type: 'generateStoryPrompt'; config: StoryPromptConfig }
  | { type: 'getDoJGGrammarList'; level?: DoJGLevel }
  | { type: 'searchDoJGGrammar'; query: string; limit?: number }
  // Known Grammar messages
  | { type: 'getKnownGrammar' }
  | { type: 'setKnownGrammar'; grammarIds: string[] }
  | { type: 'toggleKnownGrammar'; grammarId: string; known: boolean }
  // Prompt Template messages
  | { type: 'getPromptTemplates' }
  | { type: 'savePromptTemplate'; template: PromptTemplate }
  | { type: 'deletePromptTemplate'; templateId: string }
  | { type: 'setActiveTemplate'; templateId: string };

// Prompt template for generating story prompts
export interface PromptTemplate {
  id: string;           // UUID
  name: string;         // "Story Generation", "Dialogue Practice"
  template: string;     // The template with {variables}
  isDefault?: boolean;  // Built-in template (cannot be deleted)
  createdAt: number;
  updatedAt: number;
}

export interface PromptTemplatesConfig {
  templates: PromptTemplate[];
  activeTemplateId: string;
}

export type MessageResponse<T extends MessageType> =
  T extends { type: 'tokenize' } ? { tokens: TokenResult[] } :
  T extends { type: 'getVocabulary' } ? VocabDataSerialized :
  T extends { type: 'syncVocabulary' } ? { success: boolean; error?: string } :
  T extends { type: 'getConfig' } ? SeerConfig :
  T extends { type: 'setConfig' } ? { success: boolean } :
  T extends { type: 'getStats' } ? PageStats | null :
  T extends { type: 'toggleLayer' } ? { success: boolean } :
  T extends { type: 'updateLayerStyle' } ? { success: boolean } :
  T extends { type: 'getHighlightConfig' } ? HighlightConfig :
  T extends { type: 'addToIgnoreList' } ? { success: boolean } :
  T extends { type: 'removeFromIgnoreList' } ? { success: boolean } :
  T extends { type: 'isPageIgnored' } ? { ignored: boolean; reason?: 'domain' | 'url' } :
  never;
