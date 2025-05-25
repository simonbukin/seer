import {
  Message,
  TokensMessage,
  RefreshMessage,
  TokensResponse,
  RefreshResponse,
} from "./types";
import { initializeFrequencyDB } from "./frequency-db";

let known = new Set<string>();

// AnkiConnect helper function
async function ac(params: any): Promise<any> {
  const response = await fetch("http://127.0.0.1:8765", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect request failed: ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(`AnkiConnect error: ${result.error}`);
  }

  return result;
}

// Fetch deck and create known words set
async function loadKnown(deck = "Kaishi 1.5k"): Promise<Set<string>> {
  try {
    console.log(`Loading known words from deck: "${deck}"`);

    // First, let's get all notes from the deck (including mature and learning)
    const ids = await ac({
      action: "findNotes",
      params: { query: `deck:"${deck}"` },
      version: 6,
    });

    console.log(`Found ${ids.result.length} notes in deck`);

    if (ids.result.length === 0) {
      console.warn(
        `No notes found in deck "${deck}". Available decks might be:`
      );
      // Try to get deck names for debugging
      try {
        const deckNames = await ac({
          action: "deckNames",
          version: 6,
        });
        console.log("Available decks:", deckNames.result);
      } catch (e) {
        console.log("Could not fetch deck names");
      }
      return new Set();
    }

    const notes = await ac({
      action: "notesInfo",
      params: { notes: ids.result },
      version: 6,
    });

    console.log(`Retrieved info for ${notes.result.length} notes`);

    // Log the first few notes to debug field structure
    if (notes.result.length > 0) {
      console.log("Sample note fields:", Object.keys(notes.result[0].fields));
      console.log("First note:", notes.result[0].fields);
    }

    // Try multiple field names that might contain the word
    const possibleFields = [
      "Word",
      "Expression",
      "Front",
      "Question",
      "Text",
      "Japanese",
    ];
    const wordsSet = new Set<string>();

    notes.result.forEach((note: any) => {
      for (const fieldName of possibleFields) {
        if (note.fields[fieldName]) {
          const value = note.fields[fieldName].value?.trim();
          if (value && value.length > 0) {
            // Remove HTML tags and get clean text
            const cleanValue = value.replace(/<[^>]*>/g, "").trim();
            if (cleanValue.length > 0) {
              wordsSet.add(cleanValue);
            }
          }
        }
      }
    });

    console.log(
      `Extracted ${wordsSet.size} unique words from ${possibleFields.join(
        ", "
      )} fields`
    );

    // Log some sample words
    const sampleWords = Array.from(wordsSet).slice(0, 10);
    console.log("Sample words:", sampleWords);

    return wordsSet;
  } catch (error) {
    console.error("Failed to load known words:", error);
    return new Set();
  }
}

// Message bridge
(globalThis as any).chrome?.runtime?.onMessage?.addListener(
  (msg: Message, _: any, sendResponse: any) => {
    if (msg.type === "TOKENS") {
      const tokensMsg = msg as TokensMessage;
      const unknown = tokensMsg.tokens.filter((t) => !known.has(t));
      const response: TokensResponse = { unknown };
      sendResponse(response);
      return true;
    }

    if (msg.type === "REFRESH") {
      refresh()
        .then(() => {
          const response: RefreshResponse = { ok: true };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Refresh failed:", error);
          const response: RefreshResponse = { ok: false };
          sendResponse(response);
        });
      return true;
    }
  }
);

// Refresh function
async function refresh(): Promise<void> {
  console.log("Refreshing known words from Anki...");
  const startTime = Date.now();
  known = await loadKnown();
  const endTime = Date.now();
  console.log(`Loaded ${known.size} known words in ${endTime - startTime}ms`);
}

// Timed refresh
(globalThis as any).chrome?.alarms?.create("refresh", { periodInMinutes: 30 });
(globalThis as any).chrome?.alarms?.onAlarm?.addListener((alarm: any) => {
  if (alarm.name === "refresh") {
    refresh();
  }
});

// Initial load
refresh();

// Initialize frequency database
initializeFrequencyDB().catch((error) => {
  console.error("Failed to initialize frequency database:", error);
});
