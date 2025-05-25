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
