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

export type Message =
  | TokensMessage
  | RefreshMessage
  | ToggleHighlightsMessage
  | GetHighlightStateMessage
  | ToggleHighlightsContentMessage;
export type Response =
  | TokensResponse
  | RefreshResponse
  | ToggleHighlightsResponse
  | GetHighlightStateResponse;

// New highlight style interfaces
export type HighlightStyle = "highlight" | "underline" | "color" | "custom";

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
