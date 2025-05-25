import {
  IgnoredWordsSettings,
  CheckAnkiConnectMessage,
  CheckAnkiConnectResponse,
  GetIgnoredWordsMessage,
  GetIgnoredWordsResponse,
  AddIgnoredWordMessage,
  AddIgnoredWordResponse,
  SetupIgnoredWordsMessage,
  SetupIgnoredWordsResponse,
} from "./types";

// Helper function to send messages to background script
async function sendMessage<T>(message: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

// Check if AnkiConnect is available
export async function checkAnkiConnect(): Promise<boolean> {
  try {
    const message: CheckAnkiConnectMessage = { type: "CHECK_ANKI_CONNECT" };
    const response = await sendMessage<CheckAnkiConnectResponse>(message);
    return response.available;
  } catch (error) {
    console.warn("Failed to check AnkiConnect:", error);
    return false;
  }
}

// Get ignored words from AnkiConnect
export async function getIgnoredWords(
  settings: IgnoredWordsSettings
): Promise<Set<string>> {
  try {
    const message: GetIgnoredWordsMessage = {
      type: "GET_IGNORED_WORDS",
      settings,
    };
    const response = await sendMessage<GetIgnoredWordsResponse>(message);

    if (response.error) {
      throw new Error(response.error);
    }

    return new Set(response.words);
  } catch (error) {
    console.warn("Failed to get ignored words:", error);
    return new Set();
  }
}

// Add a word to the ignored deck
export async function addIgnoredWord(
  word: string,
  settings: IgnoredWordsSettings
): Promise<boolean> {
  try {
    const message: AddIgnoredWordMessage = {
      type: "ADD_IGNORED_WORD",
      word,
      settings,
    };
    const response = await sendMessage<AddIgnoredWordResponse>(message);

    if (!response.success && response.error) {
      console.warn(`Failed to add ignored word "${word}":`, response.error);
    }

    return response.success;
  } catch (error) {
    console.warn(`Failed to add ignored word "${word}":`, error);
    return false;
  }
}

// Setup ignored words deck and note type
export async function setupIgnoredWords(
  settings: IgnoredWordsSettings
): Promise<boolean> {
  try {
    const message: SetupIgnoredWordsMessage = {
      type: "SETUP_IGNORED_WORDS",
      settings,
    };
    const response = await sendMessage<SetupIgnoredWordsResponse>(message);

    if (!response.success && response.error) {
      console.warn("Failed to setup ignored words:", response.error);
    }

    return response.success;
  } catch (error) {
    console.warn("Failed to setup ignored words:", error);
    return false;
  }
}

// Get ignored words settings from storage
export async function getIgnoredWordsSettings(): Promise<IgnoredWordsSettings> {
  return new Promise((resolve) => {
    const defaultSettings: IgnoredWordsSettings = {
      deckName: "SeerIgnored",
      noteType: "Seer",
      fieldName: "Word",
      enabled: false,
    };

    chrome.storage.sync.get(
      {
        ignoredWordsEnabled: defaultSettings.enabled,
        ignoredDeckName: defaultSettings.deckName,
        ignoredNoteType: defaultSettings.noteType,
        ignoredFieldName: defaultSettings.fieldName,
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
  });
}

// Save ignored words settings to storage
export async function saveIgnoredWordsSettings(
  settings: IgnoredWordsSettings
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(
      {
        ignoredWordsEnabled: settings.enabled,
        ignoredDeckName: settings.deckName,
        ignoredNoteType: settings.noteType,
        ignoredFieldName: settings.fieldName,
      },
      () => {
        resolve();
      }
    );
  });
}
