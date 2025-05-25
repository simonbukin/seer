export interface TokensMessage {
  type: "TOKENS";
  tokens: string[];
}

export interface RefreshMessage {
  type: "REFRESH";
}

export interface TokensResponse {
  unknown: string[];
}

export interface RefreshResponse {
  ok: boolean;
  error?: string;
}

export type Message = TokensMessage | RefreshMessage;
export type Response = TokensResponse | RefreshResponse;

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
