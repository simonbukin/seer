import {
  Message,
  TokensMessage,
  RefreshMessage,
  ToggleHighlightsMessage,
  GetHighlightStateMessage,
  ToggleI1SentenceModeMessage,
  GetI1SentenceModeMessage,
  TokensResponse,
  RefreshResponse,
  ToggleHighlightsResponse,
  GetHighlightStateResponse,
  ToggleI1SentenceModeResponse,
  GetI1SentenceModeResponse,
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
  VocabSource,
  VocabSettings,
  SourceValidationResult,
  GetVocabSourcesMessage,
  SaveVocabSourcesMessage,
  ValidateVocabSourceMessage,
  GetVocabSourcesResponse,
  SaveVocabSourcesResponse,
  ValidateVocabSourceResponse,
  GetVocabStatsMessage,
  GetVocabStatsResponse,
  VocabStatsData,
  VocabSourceStats,
  GetIgnoredWordsCountMessage,
  GetIgnoredWordsCountResponse,
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
  i1SentenceMode: boolean;
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
      i1SentenceMode: false,
    };

    chrome.storage.sync.get(defaultSettings, (result) => {
      resolve(result as Settings);
    });
  });
}

// Load vocabulary sources from Chrome storage
async function loadVocabSettings(): Promise<VocabSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["vocabSources", "migrated"], (result) => {
      const vocabSettings: VocabSettings = {
        sources: result.vocabSources || [],
        migrated: result.migrated || false,
      };
      resolve(vocabSettings);
    });
  });
}

// Save vocabulary sources to Chrome storage
async function saveVocabSettings(settings: VocabSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(
      {
        vocabSources: settings.sources,
        migrated: settings.migrated,
      },
      () => {
        resolve();
      }
    );
  });
}

// Generate unique ID for sources
function generateSourceId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Migrate old single deck configuration to new sources system
async function migrateToSources(): Promise<void> {
  const vocabSettings = await loadVocabSettings();

  // Skip if already migrated
  if (vocabSettings.migrated) {
    return;
  }

  console.log("🔄 Migrating to multi-source vocabulary system...");

  const oldSettings = await loadSettings();

  // If there's an existing deck configuration, convert it to a source
  if (oldSettings.primaryDeck && oldSettings.wordField) {
    const migratedSource: VocabSource = {
      id: generateSourceId(),
      name: `${oldSettings.primaryDeck} (Migrated)`,
      deckName: oldSettings.primaryDeck,
      fieldName: oldSettings.wordField,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    vocabSettings.sources.push(migratedSource);
    console.log(
      `✅ Migrated deck "${oldSettings.primaryDeck}" to source "${migratedSource.name}"`
    );
  }

  // Mark as migrated
  vocabSettings.migrated = true;
  await saveVocabSettings(vocabSettings);

  console.log("✅ Migration to multi-source system complete");
}

// Validate a vocabulary source
async function validateVocabSource(
  source: Omit<VocabSource, "id" | "createdAt">
): Promise<SourceValidationResult> {
  try {
    // Check if deck exists
    const deckNames = await ac({
      action: "deckNames",
      version: 6,
    });

    const deckExists = deckNames.result.includes(source.deckName);
    if (!deckExists) {
      return {
        isValid: false,
        error: `Deck "${source.deckName}" not found`,
        deckExists: false,
        fieldExists: false,
      };
    }

    // Check if field exists by getting a sample note from the deck
    const noteIds = await ac({
      action: "findNotes",
      params: { query: `deck:"${source.deckName}"` },
      version: 6,
    });

    if (noteIds.result.length === 0) {
      return {
        isValid: false,
        error: `No notes found in deck "${source.deckName}"`,
        deckExists: true,
        fieldExists: false,
      };
    }

    // Get info for the first note to check field structure
    const noteInfo = await ac({
      action: "notesInfo",
      params: { notes: [noteIds.result[0]] },
      version: 6,
    });

    const fieldExists = Object.keys(noteInfo.result[0].fields).includes(
      source.fieldName
    );
    if (!fieldExists) {
      return {
        isValid: false,
        error: `Field "${source.fieldName}" not found in deck "${source.deckName}"`,
        deckExists: true,
        fieldExists: false,
      };
    }

    return {
      isValid: true,
      deckExists: true,
      fieldExists: true,
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
      deckExists: false,
      fieldExists: false,
    };
  }
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

// Save i+1 sentence mode state
async function saveI1SentenceMode(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ i1SentenceMode: enabled }, () => {
      resolve();
    });
  });
}

// Get i+1 sentence mode state
async function getI1SentenceMode(): Promise<boolean> {
  const settings = await loadSettings();
  return settings.i1SentenceMode;
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

// Fetch words from a single source
async function loadWordsFromSource(source: VocabSource): Promise<Set<string>> {
  try {
    console.log(
      `Loading words from source "${source.name}" (${source.deckName}:${source.fieldName})`
    );

    // Get all notes from the deck
    const ids = await ac({
      action: "findNotes",
      params: { query: `deck:"${source.deckName}"` },
      version: 6,
    });

    if (ids.result.length === 0) {
      console.warn(
        `No notes found in deck "${source.deckName}" for source "${source.name}"`
      );
      return new Set();
    }

    const notes = await ac({
      action: "notesInfo",
      params: { notes: ids.result },
      version: 6,
    });

    console.log(
      `Retrieved info for ${notes.result.length} notes from source "${source.name}"`
    );

    // Use the configured word field, with fallbacks
    const possibleFields = [
      source.fieldName,
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
      `Extracted ${wordsSet.size} unique words from source "${source.name}"`
    );
    return wordsSet;
  } catch (error) {
    console.error(`Failed to load words from source "${source.name}":`, error);
    return new Set();
  }
}

// Fetch words from all enabled sources and combine them
async function loadKnown(): Promise<Set<string>> {
  try {
    // Run migration first
    await migrateToSources();

    const vocabSettings = await loadVocabSettings();
    const sources = vocabSettings.sources;

    if (sources.length === 0) {
      console.warn("No vocabulary sources found");
      return new Set();
    }

    console.log(`Loading known words from ${sources.length} sources...`);

    const allWords = new Set<string>();
    let totalWordsLoaded = 0;

    // Load words from each source
    for (const source of sources) {
      try {
        const sourceWords = await loadWordsFromSource(source);

        // Add all words from this source to the combined set
        sourceWords.forEach((word) => allWords.add(word));
        totalWordsLoaded += sourceWords.size;

        console.log(`✅ Source "${source.name}": ${sourceWords.size} words`);
      } catch (error) {
        console.error(`❌ Failed to load source "${source.name}":`, error);
      }
    }

    console.log(
      `📚 Total: ${allWords.size} unique words from ${totalWordsLoaded} total words across ${sources.length} sources`
    );

    // Log some sample words
    const sampleWords = Array.from(allWords).slice(0, 10);
    console.log("Sample words:", sampleWords);

    return allWords;
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
    const addNoteResult = await ac({
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

    // If note was created successfully, suspend its cards
    if (addNoteResult.result) {
      const noteId = addNoteResult.result;

      // Find cards for this note
      const findCardsResult = await ac({
        action: "findCards",
        version: 6,
        params: {
          query: `nid:${noteId}`,
        },
      });

      // Suspend the cards
      if (findCardsResult.result && findCardsResult.result.length > 0) {
        await ac({
          action: "suspend",
          version: 6,
          params: {
            cards: findCardsResult.result,
          },
        });
        console.log(
          `Suspended ${findCardsResult.result.length} card(s) for ignored word "${word}"`
        );
      }
    }

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

    if (msg.type === "TOGGLE_I1_SENTENCE_MODE") {
      const toggleMsg = msg as ToggleI1SentenceModeMessage;
      saveI1SentenceMode(toggleMsg.enabled)
        .then(() => {
          // Send message to all content scripts to toggle i+1 mode
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs
                  .sendMessage(tab.id, {
                    type: "TOGGLE_I1_SENTENCE_MODE_CONTENT",
                    enabled: toggleMsg.enabled,
                  })
                  .catch(() => {
                    // Ignore errors for tabs that don't have content script
                  });
              }
            });
          });

          const response: ToggleI1SentenceModeResponse = {
            ok: true,
            enabled: toggleMsg.enabled,
          };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to save i+1 sentence mode state:", error);
          const response: ToggleI1SentenceModeResponse = {
            ok: false,
            enabled: toggleMsg.enabled,
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "GET_I1_SENTENCE_MODE") {
      getI1SentenceMode()
        .then((enabled) => {
          const response: GetI1SentenceModeResponse = { enabled };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to get i+1 sentence mode state:", error);
          const response: GetI1SentenceModeResponse = { enabled: false };
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

    if (msg.type === "GET_VOCAB_SOURCES") {
      loadVocabSettings()
        .then((vocabSettings) => {
          const response: GetVocabSourcesResponse = {
            sources: vocabSettings.sources,
            migrated: vocabSettings.migrated || false,
          };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to get vocabulary sources:", error);
          const response: GetVocabSourcesResponse = {
            sources: [],
            migrated: false,
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "SAVE_VOCAB_SOURCES") {
      const saveMsg = msg as SaveVocabSourcesMessage;
      const vocabSettings: VocabSettings = {
        sources: saveMsg.sources,
        migrated: true,
      };

      saveVocabSettings(vocabSettings)
        .then(() => {
          const response: SaveVocabSourcesResponse = { success: true };
          sendResponse(response);

          // Trigger refresh to reload vocabulary with new sources
          refresh().catch((error) => {
            console.error("Failed to refresh after saving sources:", error);
          });
        })
        .catch((error) => {
          console.error("Failed to save vocabulary sources:", error);
          const response: SaveVocabSourcesResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "VALIDATE_VOCAB_SOURCE") {
      const validateMsg = msg as ValidateVocabSourceMessage;
      validateVocabSource(validateMsg.source)
        .then((result) => {
          const response: ValidateVocabSourceResponse = result;
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to validate vocabulary source:", error);
          const response: ValidateVocabSourceResponse = {
            isValid: false,
            error: error instanceof Error ? error.message : String(error),
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "GET_VOCAB_STATS") {
      getVocabStats()
        .then((stats) => {
          const response: GetVocabStatsResponse = { stats };
          sendResponse(response);
        })
        .catch((error) => {
          console.error("Failed to get vocabulary statistics:", error);
          const response: GetVocabStatsResponse = {
            stats: { totalWords: 0, sourceStats: [] },
          };
          sendResponse(response);
        });
      return true;
    }

    if (msg.type === "GET_IGNORED_WORDS_COUNT") {
      getIgnoredWordsCount()
        .then((count: number) => {
          const response: GetIgnoredWordsCountResponse = { count };
          sendResponse(response);
        })
        .catch((error: any) => {
          console.error("Failed to get ignored words count:", error);
          const response: GetIgnoredWordsCountResponse = { count: 0 };
          sendResponse(response);
        });
      return true;
    }
  }
);

// Get ignored words count
async function getIgnoredWordsCount(): Promise<number> {
  try {
    const ignoredWords = await loadIgnoredWordsFromSettings();
    return ignoredWords.size;
  } catch (error) {
    console.error("Failed to get ignored words count:", error);
    return 0;
  }
}

// Get vocabulary statistics for all sources
async function getVocabStats(): Promise<VocabStatsData> {
  try {
    const vocabSettings = await loadVocabSettings();
    const sources = vocabSettings.sources;

    if (sources.length === 0) {
      return {
        totalWords: 0,
        sourceStats: [],
      };
    }

    const sourceStats: VocabSourceStats[] = [];
    let totalWords = 0;
    const allWords = new Set<string>();

    // Load words from each source and count unique words
    for (const source of sources) {
      try {
        const sourceWords = await loadWordsFromSource(source);
        const uniqueWordsFromSource = new Set<string>();

        // Count words that are unique to this source (not already counted)
        for (const word of sourceWords) {
          if (!allWords.has(word)) {
            uniqueWordsFromSource.add(word);
            allWords.add(word);
          }
        }

        sourceStats.push({
          sourceId: source.id,
          sourceName: source.name,
          wordCount: uniqueWordsFromSource.size,
          percentage: 0, // Will be calculated after we have total
        });

        totalWords += uniqueWordsFromSource.size;
      } catch (error) {
        console.warn(
          `Failed to load words from source "${source.name}":`,
          error
        );
        sourceStats.push({
          sourceId: source.id,
          sourceName: source.name,
          wordCount: 0,
          percentage: 0,
        });
      }
    }

    // Calculate percentages
    sourceStats.forEach((stat) => {
      stat.percentage =
        totalWords > 0 ? (stat.wordCount / totalWords) * 100 : 0;
    });

    // Sort by word count (descending)
    sourceStats.sort((a, b) => b.wordCount - a.wordCount);

    return {
      totalWords,
      sourceStats,
    };
  } catch (error) {
    console.error("Failed to get vocabulary statistics:", error);
    return {
      totalWords: 0,
      sourceStats: [],
    };
  }
}

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
