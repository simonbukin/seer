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
  | RawAnkiConnectMessage;
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
  | RawAnkiConnectResponse;

// New highlight style interfaces
export type HighlightStyle =
  | "highlight"
  | "underline"
  | "color"
  | "custom"
  | "rainbow";

export interface GradientColors {
  startColor: string;
  endColor: string;
}

export interface HighlightSettings {
  style: HighlightStyle;
  colorIntensity: number;
  gradientColors: GradientColors;
  customCSS: string;
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
