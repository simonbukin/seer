import {
  Message,
  TokensMessage,
  RefreshMessage,
  ToggleHighlightsMessage,
  GetHighlightStateMessage,
  TokensResponse,
  RefreshResponse,
  ToggleHighlightsResponse,
  GetHighlightStateResponse,
  AddIgnoredWordMessage,
  AddIgnoredWordResponse,
  GetIgnoredWordsMessage,
  GetIgnoredWordsResponse,
  SetupIgnoredWordsMessage,
  SetupIgnoredWordsResponse,
  CheckAnkiConnectMessage,
  CheckAnkiConnectResponse,
  RawAnkiConnectMessage,
  RawAnkiConnectResponse,
  IgnoredWordsSettings,
} from "./types";
import { initializeFrequencyDB } from "./frequency-db";

let known = new Set<string>();
let ignored = new Set<string>();

// Settings interface
interface Settings {
  primaryDeck: string;
  wordField: string;
  colorIntensity: number;
  showStats: boolean;
  highlightsEnabled: boolean;
}

// Load settings from Chrome storage
async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    const defaultSettings: Settings = {
      primaryDeck: "Kaishi 1.5k",
      wordField: "Word",
      colorIntensity: 0.7,
      showStats: true,
      highlightsEnabled: true,
    };

    chrome.storage.sync.get(defaultSettings, (result) => {
      resolve(result as Settings);
    });
  });
}

// Save highlight enabled state
async function saveHighlightState(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ highlightsEnabled: enabled }, () => {
      resolve();
    });
  });
}

// Get highlight enabled state
async function getHighlightState(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.highlightsEnabled;
}

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
async function loadKnown(): Promise<Set<string>> {
  try {
    const settings = await loadSettings();
    const deck = settings.primaryDeck;
    const wordField = settings.wordField;

    console.log(
      `Loading known words from deck: "${deck}", field: "${wordField}"`
    );

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

    // Use the configured word field, with fallbacks
    const possibleFields = [
      wordField,
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

// Note: Old loadIgnored() function removed - now using loadIgnoredWordsFromSettings()

// Check if AnkiConnect is available
async function checkAnkiConnect(): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const result = await ac({
      action: "version",
      version: 6,
    });
    return { available: true, version: result.result };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Get ignored words from specific settings
async function getIgnoredWords(
  settings: IgnoredWordsSettings
): Promise<string[]> {
  try {
    const ids = await ac({
      action: "findNotes",
      params: { query: `deck:"${settings.deckName}"` },
      version: 6,
    });

    if (ids.result.length === 0) {
      return [];
    }

    const notes = await ac({
      action: "notesInfo",
      params: { notes: ids.result },
      version: 6,
    });

    const words: string[] = [];
    notes.result.forEach((note: any) => {
      if (note.fields[settings.fieldName]) {
        const value = note.fields[settings.fieldName].value?.trim();
        if (value && value.length > 0) {
          const cleanValue = value.replace(/<[^>]*>/g, "").trim();
          if (cleanValue.length > 0) {
            words.push(cleanValue);
          }
        }
      }
    });

    return words;
  } catch (error) {
    throw new Error(
      `Failed to get ignored words: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Add a word to the ignored deck
async function addIgnoredWord(
  word: string,
  settings: IgnoredWordsSettings
): Promise<void> {
  try {
    // Check if word already exists to avoid duplicates
    const existingNotes = await ac({
      action: "findNotes",
      version: 6,
      params: {
        query: `deck:"${settings.deckName}" ${
          settings.fieldName
        }:"${word.trim()}"`,
      },
    });

    if (existingNotes.result.length > 0) {
      console.log(`Word "${word}" already in ignored deck`);
      // Still add to local set for immediate effect
      ignored.add(word);
      return;
    }

    // First ensure the deck and note type exist
    await setupIgnoredWords(settings);

    // Add the note
    await ac({
      action: "addNote",
      version: 6,
      params: {
        note: {
          deckName: settings.deckName,
          modelName: settings.noteType,
          fields: {
            [settings.fieldName]: word,
          },
          tags: ["seer-ignored"],
        },
      },
    });

    // Add to local ignored set for immediate effect
    ignored.add(word);
    console.log(`Added "${word}" to ignored deck and local set`);
  } catch (error) {
    throw new Error(
      `Failed to add ignored word: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Setup ignored words deck and note type
async function setupIgnoredWords(
  settings: IgnoredWordsSettings
): Promise<void> {
  try {
    // Check if deck exists, create if not
    const deckNames = await ac({
      action: "deckNames",
      version: 6,
    });

    if (!deckNames.result.includes(settings.deckName)) {
      await ac({
        action: "createDeck",
        version: 6,
        params: {
          deck: settings.deckName,
        },
      });
    }

    // Check if note type exists, create if not
    const modelNames = await ac({
      action: "modelNames",
      version: 6,
    });

    if (!modelNames.result.includes(settings.noteType)) {
      await ac({
        action: "createModel",
        version: 6,
        params: {
          modelName: settings.noteType,
          inOrderFields: [settings.fieldName],
          css: ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
          cardTemplates: [
            {
              Name: "Card 1",
              Front: `{{${settings.fieldName}}}`,
              Back: `{{${settings.fieldName}}}<br><br><i>This word is ignored by Seer</i>`,
            },
          ],
        },
      });
    }
  } catch (error) {
    throw new Error(
      `Failed to setup ignored words: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Message bridge
(globalThis as any).chrome?.runtime?.onMessage?.addListener(
  (msg: Message, _: any, sendResponse: any) => {
    if (msg.type === "TOKENS") {
      const tokensMsg = msg as TokensMessage;
      // Filter out ignored words, then filter out known words
      const filteredTokens = tokensMsg.tokens.filter((t) => !ignored.has(t));
      const unknown = filteredTokens.filter((t) => !known.has(t));
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

    if (msg.type === "TOGGLE_HIGHLIGHTS") {
      const toggleMsg = msg as ToggleHighlightsMessage;
      saveHighlightState(toggleMsg.enabled)
        .then(() => {
          // Send message to all content scripts to toggle highlights
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs
                  .sendMessage(tab.id, {
                    type: "TOGGLE_HIGHLIGHTS_CONTENT",
                    enabled: toggleMsg.enabled,
                  })
                  .catch(() => {
                    // Ignore errors for tabs that don't have content script
                  });
              }
            });
          });

          const response: ToggleHighlightsResponse = {
            ok: true,
            enabled: toggleMsg.enabled,
          };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to save highlight state:", error);
          const response: ToggleHighlightsResponse = {
            ok: false,
            enabled: toggleMsg.enabled,
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "GET_HIGHLIGHT_STATE") {
      getHighlightState()
        .then((enabled) => {
          const response: GetHighlightStateResponse = { enabled };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to get highlight state:", error);
          const response: GetHighlightStateResponse = { enabled: true };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "CHECK_ANKI_CONNECT") {
      checkAnkiConnect()
        .then((result) => {
          const response: CheckAnkiConnectResponse = result;
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to check AnkiConnect:", error);
          const response: CheckAnkiConnectResponse = {
            available: false,
            error: error instanceof Error ? error.message : String(error),
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "GET_IGNORED_WORDS") {
      const getIgnoredMsg = msg as GetIgnoredWordsMessage;
      getIgnoredWords(getIgnoredMsg.settings)
        .then((words) => {
          const response: GetIgnoredWordsResponse = { words };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to get ignored words:", error);
          const response: GetIgnoredWordsResponse = {
            words: [],
            error: error instanceof Error ? error.message : String(error),
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "ADD_IGNORED_WORD") {
      const addIgnoredMsg = msg as AddIgnoredWordMessage;
      addIgnoredWord(addIgnoredMsg.word, addIgnoredMsg.settings)
        .then(() => {
          const response: AddIgnoredWordResponse = { success: true };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to add ignored word:", error);
          const response: AddIgnoredWordResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "SETUP_IGNORED_WORDS") {
      const setupMsg = msg as SetupIgnoredWordsMessage;
      setupIgnoredWords(setupMsg.settings)
        .then(() => {
          const response: SetupIgnoredWordsResponse = { success: true };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to setup ignored words:", error);
          const response: SetupIgnoredWordsResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "RAW_ANKI_CONNECT") {
      const rawMsg = msg as RawAnkiConnectMessage;
      ac(rawMsg.params)
        .then((result) => {
          const response: RawAnkiConnectResponse = { result: result.result };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to execute raw AnkiConnect request:", error);
          const response: RawAnkiConnectResponse = {
            error: error instanceof Error ? error.message : String(error),
          };
          sendResponse(response);
        });
      return true;
    }
  }
);

// Load ignored words using new settings
async function loadIgnoredWordsFromSettings(): Promise<Set<string>> {
  try {
    // Get ignored words settings from storage
    const ignoredSettings = await new Promise<IgnoredWordsSettings>(
      (resolve) => {
        chrome.storage.sync.get(
          {
            ignoredWordsEnabled: false,
            ignoredDeckName: "SeerIgnored",
            ignoredNoteType: "Seer",
            ignoredFieldName: "Word",
          },
          (result) => {
            resolve({
              enabled: result.ignoredWordsEnabled,
              deckName: result.ignoredDeckName,
              noteType: result.ignoredNoteType,
              fieldName: result.ignoredFieldName,
            });
          }
        );
      }
    );

    if (!ignoredSettings.enabled || !ignoredSettings.deckName) {
      console.log("Ignored words disabled or no deck configured");
      return new Set();
    }

    console.log(
      `Loading ignored words from deck: "${ignoredSettings.deckName}"`
    );
    const words = await getIgnoredWords(ignoredSettings);
    console.log(`Loaded ${words.length} ignored words from new settings`);
    return new Set(words);
  } catch (error) {
    console.error("Failed to load ignored words from new settings:", error);
    return new Set();
  }
}

// Refresh function
async function refresh(): Promise<void> {
  console.log("Refreshing known and ignored words from Anki...");
  const startTime = Date.now();

  // Load both known and ignored words in parallel
  const [knownWords, ignoredWords] = await Promise.all([
    loadKnown(),
    loadIgnoredWordsFromSettings(),
  ]);

  known = knownWords;
  ignored = ignoredWords;

  const endTime = Date.now();
  console.log(
    `Loaded ${known.size} known words and ${ignored.size} ignored words in ${
      endTime - startTime
    }ms`
  );
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

// Create context menu for options
chrome.runtime.onInstalled.addListener(() => {
  // Create multiple context menu items for better Arc compatibility
  chrome.contextMenus.create({
    id: "openOptions",
    title: "Seer Options",
    contexts: ["action"], // Right-click on extension icon
  });

  // Additional context menu for Arc browser compatibility
  chrome.contextMenus.create({
    id: "openOptionsPage",
    title: "Open Options Page",
    contexts: ["page"], // Right-click on any page
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info) => {
  if (
    info.menuItemId === "openOptions" ||
    info.menuItemId === "openOptionsPage"
  ) {
    chrome.runtime.openOptionsPage();
  }
});
