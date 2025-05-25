import { getFrequencyStats, refreshFrequencyData } from "./frequency-db";
import {
  HighlightStyle,
  GradientColors,
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
  gradientColors: GradientColors;
  customCSS: string;
}

// Default settings
const defaultSettings: Settings = {
  primaryDeck: "Kaishi 1.5k",
  wordField: "Word",
  colorIntensity: 0.7,
  showStats: true,
  highlightStyle: "underline",
  gradientColors: {
    startColor: "#00ff00",
    endColor: "#ff0000",
  },
  customCSS: "",
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
      `AnkiConnect working! Version: ${result.result}`,
      "success"
    );
  } catch (error) {
    showStatus(
      "deckStatus",
      "Failed to connect to AnkiConnect. Make sure Anki is running with AnkiConnect addon installed.",
      "error"
    );
  }
}

// Load frequency database stats
async function loadFrequencyStats(): Promise<void> {
  try {
    const stats = await getFrequencyStats();

    document.getElementById("totalEntries")!.textContent =
      stats.totalEntries.toLocaleString();
    document.getElementById("cacheSize")!.textContent =
      stats.cacheSize.toLocaleString();

    // Estimate database size (rough calculation)
    const estimatedSize =
      Math.round(((stats.totalEntries * 50) / 1024 / 1024) * 10) / 10; // ~50 bytes per entry
    document.getElementById("dbSize")!.textContent = `${estimatedSize} MB`;
  } catch (error) {
    console.error("Failed to load frequency stats:", error);
    document.getElementById("totalEntries")!.textContent = "Error";
    document.getElementById("cacheSize")!.textContent = "Error";
    document.getElementById("dbSize")!.textContent = "Error";
  }
}

// Initialize the options page
async function initializeOptions(): Promise<void> {
  // Load current settings
  const settings = await loadSettings();

  // Load decks first, then set the selected values
  await loadDecks();

  // Now set the deck values after decks are loaded
  (document.getElementById("primaryDeck") as HTMLSelectElement).value =
    settings.primaryDeck;

  // Set display settings form fields
  (document.getElementById("colorIntensity") as HTMLInputElement).value =
    settings.colorIntensity.toString();
  (document.getElementById("showStats") as HTMLInputElement).checked =
    settings.showStats;
  (document.getElementById("highlightStyle") as HTMLSelectElement).value =
    settings.highlightStyle;
  (document.getElementById("startColor") as HTMLInputElement).value =
    settings.gradientColors.startColor;
  (document.getElementById("endColor") as HTMLInputElement).value =
    settings.gradientColors.endColor;
  (document.getElementById("customCSS") as HTMLTextAreaElement).value =
    settings.customCSS;

  // Load ignored words settings
  try {
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
  } catch (error) {
    console.warn("Failed to load ignored words settings:", error);
  }

  // Update color intensity display
  const colorIntensityValue = document.getElementById("colorIntensityValue");
  if (colorIntensityValue) {
    colorIntensityValue.textContent = settings.colorIntensity.toString();
  }

  // Show/hide custom CSS based on highlight style
  updateCustomCSSVisibility();

  // Update preview
  updateStylePreview();

  // Load frequency stats
  await loadFrequencyStats();

  // If primary deck is set, load its fields
  if (settings.primaryDeck) {
    await loadFields(settings.primaryDeck);
    (document.getElementById("wordField") as HTMLSelectElement).value =
      settings.wordField;
  }
}

// Update custom CSS visibility based on highlight style
function updateCustomCSSVisibility(): void {
  const highlightStyle = (
    document.getElementById("highlightStyle") as HTMLSelectElement
  ).value;
  const customCSSGroup = document.getElementById("customCSSGroup");
  if (customCSSGroup) {
    customCSSGroup.style.display =
      highlightStyle === "custom" ? "block" : "none";
  }
}

// Update style preview
function updateStylePreview(): void {
  const highlightStyle = (
    document.getElementById("highlightStyle") as HTMLSelectElement
  ).value as HighlightStyle;
  const colorIntensity = parseFloat(
    (document.getElementById("colorIntensity") as HTMLInputElement).value
  );
  const startColor = (document.getElementById("startColor") as HTMLInputElement)
    .value;
  const endColor = (document.getElementById("endColor") as HTMLInputElement)
    .value;
  const customCSS = (
    document.getElementById("customCSS") as HTMLTextAreaElement
  ).value;

  const previewWord1 = document.getElementById("previewWord1");
  const previewWord2 = document.getElementById("previewWord2");

  if (previewWord1 && previewWord2) {
    // Simulate common word (frequency 100) and rare word (frequency 10000)
    const commonColors = getPreviewColors(
      100,
      startColor,
      endColor,
      colorIntensity
    );
    const rareColors = getPreviewColors(
      10000,
      startColor,
      endColor,
      colorIntensity
    );

    applyPreviewStyle(previewWord1, commonColors, highlightStyle, customCSS);
    applyPreviewStyle(previewWord2, rareColors, highlightStyle, customCSS);
  }
}

// Get preview colors for a given frequency
function getPreviewColors(
  frequency: number,
  startColor: string,
  endColor: string,
  intensity: number
): { color: string; bgColor: string } {
  const logFreq = Math.log10(frequency);
  const minLog = Math.log10(1);
  const maxLog = Math.log10(500000);
  const normalizedFreq = Math.min(
    1.0,
    Math.max(0.0, (logFreq - minLog) / (maxLog - minLog))
  );

  const startRgb = hexToRgb(startColor);
  const endRgb = hexToRgb(endColor);

  if (!startRgb || !endRgb) {
    return { color: "#333333", bgColor: "rgba(128, 128, 128, 0.15)" };
  }

  const r = Math.round(startRgb.r + (endRgb.r - startRgb.r) * normalizedFreq);
  const g = Math.round(startRgb.g + (endRgb.g - startRgb.g) * normalizedFreq);
  const b = Math.round(startRgb.b + (endRgb.b - startRgb.b) * normalizedFreq);

  return {
    color: `rgb(${r}, ${g}, ${b})`,
    bgColor: `rgba(${r}, ${g}, ${b}, ${intensity * 0.2})`,
  };
}

// Apply preview style to element
function applyPreviewStyle(
  element: HTMLElement,
  colors: { color: string; bgColor: string },
  style: HighlightStyle,
  customCSS: string
): void {
  // Reset styles
  element.style.backgroundColor = "";
  element.style.color = "";
  element.style.textDecoration = "";
  element.style.borderBottom = "";
  element.style.cssText = "";

  switch (style) {
    case "highlight":
      element.style.backgroundColor = colors.bgColor;
      element.style.color = colors.color;
      break;

    case "underline":
      element.style.textDecoration = "none";
      element.style.borderBottom = `2px solid ${colors.color}`;
      break;

    case "color":
      element.style.color = colors.color;
      break;

    case "custom":
      if (customCSS) {
        const processedCSS = customCSS
          .replace(/\$\{color\}/g, colors.color)
          .replace(/\$\{bgColor\}/g, colors.bgColor);
        element.style.cssText = processedCSS;
      } else {
        element.style.backgroundColor = colors.bgColor;
        element.style.color = colors.color;
      }
      break;
  }
}

// Helper function to convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  initializeOptions();

  // Primary deck change handler
  document
    .getElementById("primaryDeck")
    ?.addEventListener("change", async (e) => {
      const deckName = (e.target as HTMLSelectElement).value;
      await loadFields(deckName);
    });

  // Test connection button
  document
    .getElementById("testConnection")
    ?.addEventListener("click", testConnection);

  // Save deck settings
  document
    .getElementById("saveDeckSettings")
    ?.addEventListener("click", async () => {
      const primaryDeck = (
        document.getElementById("primaryDeck") as HTMLSelectElement
      ).value;
      const wordField = (
        document.getElementById("wordField") as HTMLSelectElement
      ).value;

      await saveSettings({ primaryDeck, wordField });
      showStatus("deckStatus", "Deck settings saved successfully", "success");
    });

  // Save display settings
  document
    .getElementById("saveDisplaySettings")
    ?.addEventListener("click", async () => {
      const colorIntensity = parseFloat(
        (document.getElementById("colorIntensity") as HTMLInputElement).value
      );
      const showStats = (
        document.getElementById("showStats") as HTMLInputElement
      ).checked;
      const highlightStyle = (
        document.getElementById("highlightStyle") as HTMLSelectElement
      ).value as HighlightStyle;
      const startColor = (
        document.getElementById("startColor") as HTMLInputElement
      ).value;
      const endColor = (document.getElementById("endColor") as HTMLInputElement)
        .value;
      const customCSS = (
        document.getElementById("customCSS") as HTMLTextAreaElement
      ).value;

      await saveSettings({
        colorIntensity,
        showStats,
        highlightStyle,
        gradientColors: { startColor, endColor },
        customCSS,
      });
      showStatus(
        "displayStatus",
        "Display settings saved successfully",
        "success"
      );
    });

  // Highlight style change handler
  document.getElementById("highlightStyle")?.addEventListener("change", () => {
    updateCustomCSSVisibility();
    updateStylePreview();
  });

  // Color intensity slider real-time update
  document.getElementById("colorIntensity")?.addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value;
    const valueDisplay = document.getElementById("colorIntensityValue");
    if (valueDisplay) {
      valueDisplay.textContent = value;
    }
    updateStylePreview();
  });

  // Gradient color change handlers
  document
    .getElementById("startColor")
    ?.addEventListener("change", updateStylePreview);
  document
    .getElementById("endColor")
    ?.addEventListener("change", updateStylePreview);
  document
    .getElementById("customCSS")
    ?.addEventListener("input", updateStylePreview);

  // Refresh frequency data
  document
    .getElementById("refreshFrequency")
    ?.addEventListener("click", async () => {
      showStatus("frequencyStatus", "Refreshing frequency data...", "info");
      try {
        await refreshFrequencyData();
        await loadFrequencyStats();
        showStatus(
          "frequencyStatus",
          "Frequency data refreshed successfully",
          "success"
        );
      } catch (error) {
        showStatus(
          "frequencyStatus",
          "Failed to refresh frequency data",
          "error"
        );
      }
    });

  // Clear and re-download frequency data
  document
    .getElementById("clearFrequency")
    ?.addEventListener("click", async () => {
      if (
        confirm(
          "This will delete all frequency data and re-download it. This may take a few minutes. Continue?"
        )
      ) {
        showStatus(
          "frequencyStatus",
          "Clearing and re-downloading frequency data...",
          "info"
        );
        try {
          await refreshFrequencyData();
          await loadFrequencyStats();
          showStatus(
            "frequencyStatus",
            "Frequency data cleared and re-downloaded successfully",
            "success"
          );
        } catch (error) {
          showStatus(
            "frequencyStatus",
            "Failed to clear and re-download frequency data",
            "error"
          );
        }
      }
    });

  // Export frequency data
  document.getElementById("exportFrequency")?.addEventListener("click", () => {
    showStatus("frequencyStatus", "Export functionality coming soon", "info");
  });

  // Setup ignored words deck and note type
  document
    .getElementById("setupIgnoredWords")
    ?.addEventListener("click", async () => {
      const deckName = (
        document.getElementById("ignoredDeckName") as HTMLInputElement
      ).value.trim();
      const noteType = (
        document.getElementById("ignoredNoteType") as HTMLInputElement
      ).value.trim();
      const fieldName = (
        document.getElementById("ignoredFieldName") as HTMLInputElement
      ).value.trim();

      if (!deckName || !noteType || !fieldName) {
        showStatus("ignoredStatus", "Please fill in all fields", "error");
        return;
      }

      try {
        showStatus("ignoredStatus", "Setting up deck and note type...", "info");

        // Check AnkiConnect first
        const ankiAvailable = await checkAnkiConnect();
        if (!ankiAvailable) {
          showStatus(
            "ignoredStatus",
            "AnkiConnect not available. Make sure Anki is running.",
            "error"
          );
          return;
        }

        const settings: IgnoredWordsSettings = {
          deckName,
          noteType,
          fieldName,
          enabled: true,
        };

        const success = await setupIgnoredWords(settings);
        if (success) {
          showStatus(
            "ignoredStatus",
            "Deck and note type setup successfully",
            "success"
          );
        } else {
          showStatus(
            "ignoredStatus",
            "Failed to setup deck and note type",
            "error"
          );
        }
      } catch (error) {
        console.error("Setup failed:", error);
        showStatus(
          "ignoredStatus",
          "Setup failed: " + (error as Error).message,
          "error"
        );
      }
    });

  // Save ignored words settings
  document
    .getElementById("saveIgnoredSettings")
    ?.addEventListener("click", async () => {
      const enabled = (
        document.getElementById("ignoredWordsEnabled") as HTMLInputElement
      ).checked;
      const deckName = (
        document.getElementById("ignoredDeckName") as HTMLInputElement
      ).value.trim();
      const noteType = (
        document.getElementById("ignoredNoteType") as HTMLInputElement
      ).value.trim();
      const fieldName = (
        document.getElementById("ignoredFieldName") as HTMLInputElement
      ).value.trim();

      if (enabled && (!deckName || !noteType || !fieldName)) {
        showStatus(
          "ignoredStatus",
          "Please fill in all fields when enabling ignored words",
          "error"
        );
        return;
      }

      try {
        const settings: IgnoredWordsSettings = {
          deckName,
          noteType,
          fieldName,
          enabled,
        };

        await saveIgnoredWordsSettings(settings);
        showStatus(
          "ignoredStatus",
          "Ignored words settings saved successfully",
          "success"
        );
      } catch (error) {
        console.error("Save failed:", error);
        showStatus(
          "ignoredStatus",
          "Failed to save settings: " + (error as Error).message,
          "error"
        );
      }
    });
});
