import { getFrequencyStats, refreshFrequencyData } from "./frequency-db";

interface Settings {
  primaryDeck: string;
  wordField: string;
  ignoredDeck: string;
  colorIntensity: number;
  showStats: boolean;
}

// Default settings
const defaultSettings: Settings = {
  primaryDeck: "Kaishi 1.5k",
  wordField: "Word",
  ignoredDeck: "",
  colorIntensity: 0.7,
  showStats: true,
};

// AnkiConnect helper
async function ankiConnect(params: any): Promise<any> {
  try {
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
  } catch (error) {
    throw error;
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
    const ignoredDeckSelect = document.getElementById(
      "ignoredDeck"
    ) as HTMLSelectElement;

    // Clear existing options
    primaryDeckSelect.innerHTML = '<option value="">Select a deck</option>';
    ignoredDeckSelect.innerHTML = '<option value="">None</option>';

    // Add deck options
    result.result.forEach((deckName: string) => {
      const option1 = document.createElement("option");
      option1.value = deckName;
      option1.textContent = deckName;
      primaryDeckSelect.appendChild(option1);

      const option2 = document.createElement("option");
      option2.value = deckName;
      option2.textContent = deckName;
      ignoredDeckSelect.appendChild(option2);
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
  (document.getElementById("ignoredDeck") as HTMLSelectElement).value =
    settings.ignoredDeck;

  // Set other form fields
  (document.getElementById("colorIntensity") as HTMLInputElement).value =
    settings.colorIntensity.toString();
  (document.getElementById("showStats") as HTMLInputElement).checked =
    settings.showStats;

  // Load frequency stats
  await loadFrequencyStats();

  // If primary deck is set, load its fields
  if (settings.primaryDeck) {
    await loadFields(settings.primaryDeck);
    (document.getElementById("wordField") as HTMLSelectElement).value =
      settings.wordField;
  }
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
      const ignoredDeck = (
        document.getElementById("ignoredDeck") as HTMLSelectElement
      ).value;

      await saveSettings({ primaryDeck, wordField, ignoredDeck });
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

      await saveSettings({ colorIntensity, showStats });
      showStatus(
        "displayStatus",
        "Display settings saved successfully",
        "success"
      );
    });

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

  // Color intensity slider real-time update
  document.getElementById("colorIntensity")?.addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value;
    const valueDisplay = document.getElementById("colorIntensityValue");
    if (valueDisplay) {
      valueDisplay.textContent = value;
    }
  });
});
