import {
  getFrequencyStats,
  refreshFrequencyData,
  getColorForFrequency,
  getSingleColor,
  applyHighlightStyle,
} from "./frequency-db";
import {
  HighlightStyle,
  IgnoredWordsSettings,
  RawAnkiConnectResponse,
} from "./types";
import {
  getIgnoredWordsSettings,
  saveIgnoredWordsSettings,
  setupIgnoredWords,
  checkAnkiConnect,
} from "./anki-connect";

interface Settings {
  primaryDeck: string;
  wordField: string;
  colorIntensity: number;
  showStats: boolean;
  highlightStyle: HighlightStyle;
  useFrequencyColors: boolean;
  singleColor: string;
  showFrequencyOnHover: boolean;
}

// Default settings
const defaultSettings: Settings = {
  primaryDeck: "Kaishi 1.5k",
  wordField: "Word",
  colorIntensity: 0.7,
  showStats: true,
  highlightStyle: "underline",
  useFrequencyColors: true,
  singleColor: "#ff6b6b",
  showFrequencyOnHover: false,
};

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

// AnkiConnect helper that routes through background script
async function ankiConnect(params: any): Promise<any> {
  const message = {
    type: "RAW_ANKI_CONNECT",
    params: params,
  };

  try {
    const response = await sendMessage<RawAnkiConnectResponse>(message);
    if (response.error) {
      throw new Error(response.error);
    }
    return { result: response.result };
  } catch (error) {
    throw new Error(`AnkiConnect request failed: ${error}`);
  }
}

// Settings management
async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaultSettings, (result) => {
      resolve(result as Settings);
    });
  });
}

async function saveSettings(settings: Partial<Settings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settings, () => {
      resolve();
    });
  });
}

// UI helpers
function showStatus(
  elementId: string,
  message: string,
  type: "success" | "error" | "info"
) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.className = `status ${type}`;
    element.style.display = "block";

    setTimeout(() => {
      element.style.display = "none";
    }, 5000);
  }
}

// Load and populate deck list
async function loadDecks(): Promise<void> {
  try {
    const result = await ankiConnect({
      action: "deckNames",
      version: 6,
    });

    const primaryDeckSelect = document.getElementById(
      "primaryDeck"
    ) as HTMLSelectElement;

    // Clear existing options
    primaryDeckSelect.innerHTML = '<option value="">Select a deck</option>';

    // Add deck options
    result.result.forEach((deckName: string) => {
      const option1 = document.createElement("option");
      option1.value = deckName;
      option1.textContent = deckName;
      primaryDeckSelect.appendChild(option1);
    });

    showStatus("deckStatus", "Decks loaded successfully", "success");
  } catch (error) {
    console.error("Failed to load decks:", error);
    showStatus(
      "deckStatus",
      "Failed to connect to AnkiConnect. Make sure Anki is running.",
      "error"
    );
  }
}

// Load fields for selected deck
async function loadFields(deckName: string): Promise<void> {
  if (!deckName) {
    const wordFieldSelect = document.getElementById(
      "wordField"
    ) as HTMLSelectElement;
    wordFieldSelect.innerHTML = '<option value="">Select deck first</option>';
    return;
  }

  try {
    // Get a sample note from the deck to determine available fields
    const noteIds = await ankiConnect({
      action: "findNotes",
      params: { query: `deck:"${deckName}"` },
      version: 6,
    });

    if (noteIds.result.length === 0) {
      throw new Error("No notes found in deck");
    }

    const noteInfo = await ankiConnect({
      action: "notesInfo",
      params: { notes: [noteIds.result[0]] },
      version: 6,
    });

    const fields = Object.keys(noteInfo.result[0].fields);
    const wordFieldSelect = document.getElementById(
      "wordField"
    ) as HTMLSelectElement;

    wordFieldSelect.innerHTML = '<option value="">Select a field</option>';
    fields.forEach((fieldName) => {
      const option = document.createElement("option");
      option.value = fieldName;
      option.textContent = fieldName;
      wordFieldSelect.appendChild(option);
    });

    showStatus("deckStatus", "Fields loaded successfully", "success");
  } catch (error) {
    console.error("Failed to load fields:", error);
    showStatus("deckStatus", "Failed to load fields from deck", "error");
  }
}

// Test AnkiConnect connection
async function testConnection(): Promise<void> {
  try {
    const result = await ankiConnect({
      action: "version",
      version: 6,
    });

    showStatus(
      "deckStatus",
      `AnkiConnect connected successfully (version ${result.result})`,
      "success"
    );
  } catch (error) {
    console.error("AnkiConnect test failed:", error);
    showStatus(
      "deckStatus",
      "Failed to connect to AnkiConnect. Make sure Anki is running with the AnkiConnect add-on installed.",
      "error"
    );
  }
}

// Load frequency database statistics
async function loadFrequencyStats(): Promise<void> {
  try {
    const stats = await getFrequencyStats();

    document.getElementById("totalEntries")!.textContent =
      stats.totalEntries.toLocaleString();
    document.getElementById("cacheSize")!.textContent =
      stats.cacheSize.toLocaleString();

    // Estimate database size (rough calculation)
    const estimatedSize = Math.round((stats.totalEntries * 50) / 1024 / 1024);
    document.getElementById("dbSize")!.textContent = `${estimatedSize} MB`;
  } catch (error) {
    console.error("Failed to load frequency stats:", error);
    document.getElementById("totalEntries")!.textContent = "Error";
    document.getElementById("cacheSize")!.textContent = "Error";
    document.getElementById("dbSize")!.textContent = "Error";
  }
}

// Initialize options page
async function initializeOptions(): Promise<void> {
  try {
    const settings = await loadSettings();

    // Set deck configuration
    (document.getElementById("primaryDeck") as HTMLSelectElement).value =
      settings.primaryDeck;
    (document.getElementById("wordField") as HTMLSelectElement).value =
      settings.wordField;

    // Set display settings
    (
      document.getElementById("highlightingEnabled") as HTMLInputElement
    ).checked = true;
    (
      document.querySelector(
        `input[name="highlightStyle"][value="${settings.highlightStyle}"]`
      ) as HTMLInputElement
    ).checked = true;
    (
      document.querySelector(
        `input[name="colorScheme"][value="${
          settings.useFrequencyColors ? "frequency" : "single"
        }"]`
      ) as HTMLInputElement
    ).checked = true;
    (document.getElementById("singleColor") as HTMLInputElement).value =
      settings.singleColor;
    (document.getElementById("colorIntensity") as HTMLInputElement).value =
      settings.colorIntensity.toString();
    (
      document.getElementById("showFrequencyOnHover") as HTMLInputElement
    ).checked = settings.showFrequencyOnHover;
    (document.getElementById("showStats") as HTMLInputElement).checked =
      settings.showStats;

    // Update intensity display
    updateIntensityDisplay();

    // Update color scheme visibility
    updateColorSchemeVisibility();

    // Update preview
    updateStylePreview();

    // Load ignored words settings
    const ignoredSettings = await getIgnoredWordsSettings();
    (
      document.getElementById("ignoredWordsEnabled") as HTMLInputElement
    ).checked = ignoredSettings.enabled;
    (document.getElementById("ignoredDeckName") as HTMLInputElement).value =
      ignoredSettings.deckName;
    (document.getElementById("ignoredNoteType") as HTMLInputElement).value =
      ignoredSettings.noteType;
    (document.getElementById("ignoredFieldName") as HTMLInputElement).value =
      ignoredSettings.fieldName;

    // Load frequency stats
    await loadFrequencyStats();
  } catch (error) {
    console.error("Failed to initialize options:", error);
  }
}

// Update intensity display
function updateIntensityDisplay(): void {
  const slider = document.getElementById("colorIntensity") as HTMLInputElement;
  const display = document.getElementById("colorIntensityValue");
  if (display) {
    display.textContent = `${Math.round(parseFloat(slider.value) * 100)}%`;
  }
}

// Update color scheme visibility
function updateColorSchemeVisibility(): void {
  const useFrequency =
    (
      document.querySelector(
        'input[name="colorScheme"]:checked'
      ) as HTMLInputElement
    )?.value === "frequency";
  const singleColorGroup = document.getElementById("singleColorGroup");
  if (singleColorGroup) {
    singleColorGroup.style.display = useFrequency ? "none" : "block";
  }
}

// Update style preview
function updateStylePreview(): void {
  const highlightStyle = (
    document.querySelector(
      'input[name="highlightStyle"]:checked'
    ) as HTMLInputElement
  )?.value as HighlightStyle;
  const useFrequencyColors =
    (
      document.querySelector(
        'input[name="colorScheme"]:checked'
      ) as HTMLInputElement
    )?.value === "frequency";
  const singleColor = (
    document.getElementById("singleColor") as HTMLInputElement
  ).value;
  const colorIntensity = parseFloat(
    (document.getElementById("colorIntensity") as HTMLInputElement).value
  );
  const showFrequencyOnHover = (
    document.getElementById("showFrequencyOnHover") as HTMLInputElement
  ).checked;

  const previewWord1 = document.getElementById("previewWord1");
  const previewWord2 = document.getElementById("previewWord2");

  if (previewWord1 && previewWord2) {
    // Simulate common word (frequency 800) and rare word (frequency 8000)
    const commonColors = useFrequencyColors
      ? getColorForFrequency(800, colorIntensity)
      : getSingleColor(singleColor, colorIntensity);

    const rareColors = useFrequencyColors
      ? getColorForFrequency(8000, colorIntensity)
      : getSingleColor(singleColor, colorIntensity);

    if (commonColors) {
      applyHighlightStyle(
        previewWord1,
        commonColors,
        highlightStyle,
        useFrequencyColors,
        800,
        showFrequencyOnHover
      );
    }

    if (rareColors) {
      applyHighlightStyle(
        previewWord2,
        rareColors,
        highlightStyle,
        useFrequencyColors,
        8000,
        showFrequencyOnHover
      );
    }
  }
}

// Event listeners
document.addEventListener("DOMContentLoaded", async () => {
  await initializeOptions();

  // Deck configuration events
  document.getElementById("primaryDeck")?.addEventListener("change", (e) => {
    const deckName = (e.target as HTMLSelectElement).value;
    loadFields(deckName);
  });

  document
    .getElementById("testConnection")
    ?.addEventListener("click", testConnection);
  document.getElementById("loadDecks")?.addEventListener("click", loadDecks);

  // Display settings events
  document.querySelectorAll('input[name="highlightStyle"]').forEach((radio) => {
    radio.addEventListener("change", updateStylePreview);
  });

  document.querySelectorAll('input[name="colorScheme"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updateColorSchemeVisibility();
      updateStylePreview();
    });
  });

  document
    .getElementById("singleColor")
    ?.addEventListener("change", updateStylePreview);

  document.getElementById("colorIntensity")?.addEventListener("input", () => {
    updateIntensityDisplay();
    updateStylePreview();
  });

  document
    .getElementById("showFrequencyOnHover")
    ?.addEventListener("change", updateStylePreview);

  // Save display settings
  document
    .getElementById("saveDisplaySettings")
    ?.addEventListener("click", async () => {
      try {
        const highlightStyle = (
          document.querySelector(
            'input[name="highlightStyle"]:checked'
          ) as HTMLInputElement
        )?.value as HighlightStyle;
        const useFrequencyColors =
          (
            document.querySelector(
              'input[name="colorScheme"]:checked'
            ) as HTMLInputElement
          )?.value === "frequency";
        const singleColor = (
          document.getElementById("singleColor") as HTMLInputElement
        ).value;
        const colorIntensity = parseFloat(
          (document.getElementById("colorIntensity") as HTMLInputElement).value
        );
        const showFrequencyOnHover = (
          document.getElementById("showFrequencyOnHover") as HTMLInputElement
        ).checked;
        const showStats = (
          document.getElementById("showStats") as HTMLInputElement
        ).checked;

        await saveSettings({
          highlightStyle,
          useFrequencyColors,
          singleColor,
          colorIntensity,
          showFrequencyOnHover,
          showStats,
        });

        showStatus(
          "displayStatus",
          "Display settings saved successfully",
          "success"
        );
      } catch (error) {
        console.error("Failed to save display settings:", error);
        showStatus("displayStatus", "Failed to save display settings", "error");
      }
    });

  // Save deck settings
  document
    .getElementById("saveDeckSettings")
    ?.addEventListener("click", async () => {
      try {
        const primaryDeck = (
          document.getElementById("primaryDeck") as HTMLSelectElement
        ).value;
        const wordField = (
          document.getElementById("wordField") as HTMLSelectElement
        ).value;

        await saveSettings({
          primaryDeck,
          wordField,
        });

        showStatus("deckStatus", "Deck settings saved successfully", "success");
      } catch (error) {
        console.error("Failed to save deck settings:", error);
        showStatus("deckStatus", "Failed to save deck settings", "error");
      }
    });

  // Ignored words events
  document
    .getElementById("saveIgnoredSettings")
    ?.addEventListener("click", async () => {
      try {
        const settings: IgnoredWordsSettings = {
          enabled: (
            document.getElementById("ignoredWordsEnabled") as HTMLInputElement
          ).checked,
          deckName: (
            document.getElementById("ignoredDeckName") as HTMLInputElement
          ).value,
          noteType: (
            document.getElementById("ignoredNoteType") as HTMLInputElement
          ).value,
          fieldName: (
            document.getElementById("ignoredFieldName") as HTMLInputElement
          ).value,
        };

        await saveIgnoredWordsSettings(settings);
        showStatus(
          "ignoredStatus",
          "Ignored words settings saved successfully",
          "success"
        );
      } catch (error) {
        console.error("Failed to save ignored words settings:", error);
        showStatus(
          "ignoredStatus",
          "Failed to save ignored words settings",
          "error"
        );
      }
    });

  document
    .getElementById("setupIgnoredWords")
    ?.addEventListener("click", async () => {
      try {
        const settings: IgnoredWordsSettings = {
          enabled: (
            document.getElementById("ignoredWordsEnabled") as HTMLInputElement
          ).checked,
          deckName: (
            document.getElementById("ignoredDeckName") as HTMLInputElement
          ).value,
          noteType: (
            document.getElementById("ignoredNoteType") as HTMLInputElement
          ).value,
          fieldName: (
            document.getElementById("ignoredFieldName") as HTMLInputElement
          ).value,
        };

        await setupIgnoredWords(settings);
        showStatus(
          "ignoredStatus",
          "Ignored words deck and note type created successfully",
          "success"
        );
      } catch (error) {
        console.error("Failed to setup ignored words:", error);
        showStatus("ignoredStatus", "Failed to setup ignored words", "error");
      }
    });

  // Frequency database events
  document
    .getElementById("refreshFrequency")
    ?.addEventListener("click", async () => {
      try {
        showStatus("frequencyStatus", "Refreshing frequency data...", "info");
        await refreshFrequencyData();
        await loadFrequencyStats();
        showStatus(
          "frequencyStatus",
          "Frequency data refreshed successfully",
          "success"
        );
      } catch (error) {
        console.error("Failed to refresh frequency data:", error);
        showStatus(
          "frequencyStatus",
          "Failed to refresh frequency data",
          "error"
        );
      }
    });

  // Load decks on page load
  await loadDecks();
});
