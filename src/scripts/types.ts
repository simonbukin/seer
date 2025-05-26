export interface TokensMessage {
  type: "TOKENS";
  tokens: string[];
}

export interface RefreshMessage {
  type: "REFRESH";
}

export interface ToggleHighlightsMessage {
  type: "TOGGLE_HIGHLIGHTS";
  enabled: boolean;
}

export interface GetHighlightStateMessage {
  type: "GET_HIGHLIGHT_STATE";
}

export interface ToggleHighlightsContentMessage {
  type: "TOGGLE_HIGHLIGHTS_CONTENT";
  enabled: boolean;
}

export interface ToggleI1SentenceModeMessage {
  type: "TOGGLE_I1_SENTENCE_MODE";
  enabled: boolean;
}

export interface GetI1SentenceModeMessage {
  type: "GET_I1_SENTENCE_MODE";
}

export interface ToggleI1SentenceModeContentMessage {
  type: "TOGGLE_I1_SENTENCE_MODE_CONTENT";
  enabled: boolean;
}

export interface AddIgnoredWordMessage {
  type: "ADD_IGNORED_WORD";
  word: string;
  settings: IgnoredWordsSettings;
}

export interface GetIgnoredWordsMessage {
  type: "GET_IGNORED_WORDS";
  settings: IgnoredWordsSettings;
}

export interface SetupIgnoredWordsMessage {
  type: "SETUP_IGNORED_WORDS";
  settings: IgnoredWordsSettings;
}

export interface CheckAnkiConnectMessage {
  type: "CHECK_ANKI_CONNECT";
}

export interface RawAnkiConnectMessage {
  type: "RAW_ANKI_CONNECT";
  params: any;
}

// Vocabulary Sources Messages
export interface GetVocabSourcesMessage {
  type: "GET_VOCAB_SOURCES";
}

export interface SaveVocabSourcesMessage {
  type: "SAVE_VOCAB_SOURCES";
  sources: VocabSource[];
}

export interface ValidateVocabSourceMessage {
  type: "VALIDATE_VOCAB_SOURCE";
  source: Omit<VocabSource, "id" | "createdAt">;
}

export interface TokensResponse {
  unknown: string[];
}

export interface RefreshResponse {
  ok: boolean;
  error?: string;
}

export interface ToggleHighlightsResponse {
  ok: boolean;
  enabled: boolean;
}

export interface GetHighlightStateResponse {
  enabled: boolean;
}

export interface ToggleI1SentenceModeResponse {
  ok: boolean;
  enabled: boolean;
}

export interface GetI1SentenceModeResponse {
  enabled: boolean;
}

export interface AddIgnoredWordResponse {
  success: boolean;
  error?: string;
}

export interface GetIgnoredWordsResponse {
  words: string[];
  error?: string;
}

export interface SetupIgnoredWordsResponse {
  success: boolean;
  error?: string;
}

export interface CheckAnkiConnectResponse {
  available: boolean;
  version?: string;
  error?: string;
}

export interface RawAnkiConnectResponse {
  result?: any;
  error?: string;
}

// Vocabulary Sources Responses
export interface GetVocabSourcesResponse {
  sources: VocabSource[];
  migrated: boolean;
}

export interface SaveVocabSourcesResponse {
  success: boolean;
  error?: string;
}

export interface ValidateVocabSourceResponse {
  isValid: boolean;
  error?: string;
  deckExists?: boolean;
  fieldExists?: boolean;
}

export type Message =
  | TokensMessage
  | RefreshMessage
  | ToggleHighlightsMessage
  | GetHighlightStateMessage
  | ToggleHighlightsContentMessage
  | ToggleI1SentenceModeMessage
  | GetI1SentenceModeMessage
  | ToggleI1SentenceModeContentMessage
  | AddIgnoredWordMessage
  | GetIgnoredWordsMessage
  | SetupIgnoredWordsMessage
  | CheckAnkiConnectMessage
  | RawAnkiConnectMessage
  | GetVocabSourcesMessage
  | SaveVocabSourcesMessage
  | ValidateVocabSourceMessage
  | GetVocabStatsMessage
  | GetIgnoredWordsCountMessage;
export type Response =
  | TokensResponse
  | RefreshResponse
  | ToggleHighlightsResponse
  | GetHighlightStateResponse
  | ToggleI1SentenceModeResponse
  | GetI1SentenceModeResponse
  | AddIgnoredWordResponse
  | GetIgnoredWordsResponse
  | SetupIgnoredWordsResponse
  | CheckAnkiConnectResponse
  | RawAnkiConnectResponse
  | GetVocabSourcesResponse
  | SaveVocabSourcesResponse
  | ValidateVocabSourceResponse
  | GetVocabStatsResponse
  | GetIgnoredWordsCountResponse;

// New highlight style interfaces
export type HighlightStyle = "underline" | "background" | "outline" | "dots";

export interface GradientColors {
  startColor: string;
  endColor: string;
}

export interface HighlightSettings {
  style: HighlightStyle;
  colorIntensity: number;
  useFrequencyColors: boolean;
  singleColor: string;
  showFrequencyOnHover: boolean;
}

// AnkiConnect types
export interface AnkiConnectRequest {
  action: string;
  version: number;
  params?: any;
}

export interface AnkiConnectResponse {
  result: any;
  error: string | null;
}

export interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags?: string[];
}

export interface IgnoredWordsSettings {
  deckName: string;
  noteType: string;
  fieldName: string;
  enabled: boolean;
}

// Vocabulary Sources System
export interface VocabSource {
  id: string;
  name: string;
  deckName: string;
  fieldName: string;
  enabled: boolean;
  createdAt: string; // ISO date string
  lastValidated?: string; // ISO date string
  isValid?: boolean; // cached validation result
}

export interface VocabSettings {
  sources: VocabSource[];
  migrated?: boolean;
}

// Source validation result
export interface SourceValidationResult {
  isValid: boolean;
  error?: string;
  deckExists?: boolean;
  fieldExists?: boolean;
}

// Vocabulary Statistics
export interface VocabSourceStats {
  sourceId: string;
  sourceName: string;
  wordCount: number;
  percentage: number;
}

export interface VocabStatsData {
  totalWords: number;
  sourceStats: VocabSourceStats[];
}

export interface GetVocabStatsMessage {
  type: "GET_VOCAB_STATS";
}

export interface GetVocabStatsResponse {
  stats: VocabStatsData;
}

export interface GetIgnoredWordsCountMessage {
  type: "GET_IGNORED_WORDS_COUNT";
}

export interface GetIgnoredWordsCountResponse {
  count: number;
}
