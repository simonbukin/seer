// Dictionary of Japanese Grammar (DoJG) types
// Data sourced from kenrick95.github.io/itazuraneko/grammar/

export type DoJGLevel = 'basic' | 'intermediate' | 'advanced';

export interface DoJGExample {
  ja: string;  // Japanese sentence
  en: string;  // English translation
}

export interface DoJGGrammarPoint {
  id: string;               // Unique ID: "basic-noni", "intermediate-toshite"
  pattern: string;          // The grammar pattern: "のに", "として"
  level: DoJGLevel;         // basic | intermediate | advanced
  meaning: string;          // English meaning/summary
  formation: string[];      // How to form it: ["Verb-て + あげる", "Noun に + あげる"]
  examples: DoJGExample[];  // Example sentences with translations
  notes?: string;           // Usage notes (optional)
  related?: string[];       // Related grammar point IDs (optional)
  searchPatterns: string[]; // Regex patterns for matching in text
  sourceUrl?: string;       // URL to the original DoJG page
}

export interface DoJGData {
  version: string;                    // Data version: "1.0.0"
  source: string;                     // "kenrick95/itazuraneko DoJG"
  grammarPoints: DoJGGrammarPoint[];  // All grammar points
  lastUpdated: string;                // ISO date string
}

// Grammar match result from detection
export interface GrammarMatch {
  grammarId: string;
  pattern: string;
  matchedText: string;
  sentence: string;
  position: number;           // Character position in sentence
  confidence: 'high' | 'medium' | 'low';
}

// Grammar encounter summary (for auto-detection)
export interface GrammarEncounterSummary {
  grammarId: string;
  pattern: string;
  level: DoJGLevel;
  meaning: string;
  encounterCount: number;     // How many sentences contain this pattern
  lastSeen: number;           // Timestamp of most recent encounter
}
