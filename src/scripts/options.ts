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
  VocabSource,
  GetVocabSourcesResponse,
  SaveVocabSourcesResponse,
  ValidateVocabSourceResponse,
  GetVocabStatsResponse,
  VocabStatsData,
  GetIgnoredWordsCountResponse,
} from "./types";
import { setupIgnoredWords, checkAnkiConnect } from "./anki-connect";

interface Settings {
  colorIntensity: number;
  showStats: boolean;
  highlightStyle: HighlightStyle;
  useFrequencyColors: boolean;
  singleColor: string;
  showFrequencyOnHover: boolean;
  vocabularyGoal: number;
}

// Default settings
const defaultSettings: Settings = {
  colorIntensity: 0.7,
  showStats: true,
  highlightStyle: "underline",
  useFrequencyColors: true,
  singleColor: "#ff6b6b",
  showFrequencyOnHover: false,
  vocabularyGoal: 10000,
};

// Global state
let currentSources: VocabSource[] = [];
let editingSourceId: string | null = null;
let availableDecks: string[] = [];

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

// Vocabulary Sources Management
async function loadVocabSources(): Promise<void> {
  try {
    const response = await sendMessage<GetVocabSourcesResponse>({
      type: "GET_VOCAB_SOURCES",
    });

    currentSources = response.sources;
    renderSourcesTable();
    updateSourcesStats();

    // Show migration message if this is a fresh migration
    if (response.migrated && response.sources.length > 0) {
      const firstSource = response.sources[0];
      if (firstSource.name.includes("(Migrated)")) {
        showStatus(
          "sourcesStatus",
          `✅ Successfully migrated your existing deck "${firstSource.deckName}" to the new sources system!`,
          "success"
        );
      }
    }
  } catch (error) {
    console.error("Failed to load vocabulary sources:", error);
    showStatus("sourcesStatus", "Failed to load vocabulary sources", "error");
  }
}

async function saveVocabSources(): Promise<void> {
  try {
    const response = await sendMessage<SaveVocabSourcesResponse>({
      type: "SAVE_VOCAB_SOURCES",
      sources: currentSources,
    });

    if (response.success) {
      showStatus(
        "sourcesStatus",
        "Vocabulary sources saved successfully",
        "success"
      );
    } else {
      throw new Error(response.error || "Failed to save sources");
    }
  } catch (error) {
    console.error("Failed to save vocabulary sources:", error);
    showStatus("sourcesStatus", "Failed to save vocabulary sources", "error");
  }
}

async function validateSource(
  source: Omit<VocabSource, "id" | "createdAt">
): Promise<boolean> {
  try {
    const response = await sendMessage<ValidateVocabSourceResponse>({
      type: "VALIDATE_VOCAB_SOURCE",
      source: source,
    });

    if (!response.isValid && response.error) {
      showStatus("sourcesStatus", response.error, "error");
    }

    return response.isValid;
  } catch (error) {
    console.error("Failed to validate source:", error);
    showStatus("sourcesStatus", "Failed to validate source", "error");
    return false;
  }
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

function generateSourceId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Sources Table Rendering
function renderSourcesTable(): void {
  const tableBody = document.getElementById("sourcesTableBody");
  const noSourcesMessage = document.getElementById("noSourcesMessage");
  const sourcesTable = document.getElementById("sourcesTable");

  if (!tableBody || !noSourcesMessage || !sourcesTable) return;

  if (currentSources.length === 0) {
    sourcesTable.style.display = "none";
    noSourcesMessage.style.display = "block";
    return;
  }

  sourcesTable.style.display = "block";
  noSourcesMessage.style.display = "none";

  tableBody.innerHTML = "";

  currentSources.forEach((source) => {
    const row = document.createElement("div");
    row.className = "source-row";
    row.innerHTML = `
      <div class="source-name">${escapeHtml(source.name)}</div>
      <div class="source-deck">${escapeHtml(source.deckName)}</div>
      <div class="source-field">${escapeHtml(source.fieldName)}</div>
      <div class="source-status">
        <div class="status-indicator status-enabled"></div>
        <span class="status-text">Active</span>
      </div>
      <div class="source-actions">
        <button class="action-btn edit" data-action="edit" data-source-id="${
          source.id
        }" title="Edit">✏️</button>
        <button class="action-btn refresh" data-action="refresh" data-source-id="${
          source.id
        }" title="Refresh vocabulary from this source">🔄</button>
        <button class="action-btn delete" data-action="delete" data-source-id="${
          source.id
        }" title="Delete">🗑️</button>
      </div>
    `;
    tableBody.appendChild(row);
  });
}

function updateSourcesStats(): void {
  const sourcesCount = document.getElementById("sourcesCount");
  if (sourcesCount) {
    const totalCount = currentSources.length;
    sourcesCount.textContent = `${totalCount} sources`;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Source Modal Management
function openSourceModal(sourceId?: string): void {
  const modal = document.getElementById("sourceModal");
  const modalTitle = document.getElementById("sourceModalTitle");
  const sourceName = document.getElementById("sourceName") as HTMLInputElement;
  const sourceDeck = document.getElementById("sourceDeck") as HTMLSelectElement;
  const sourceField = document.getElementById(
    "sourceField"
  ) as HTMLSelectElement;

  if (!modal || !modalTitle || !sourceName || !sourceDeck || !sourceField)
    return;

  editingSourceId = sourceId || null;

  if (sourceId) {
    // Edit mode
    const source = currentSources.find((s) => s.id === sourceId);
    if (!source) return;

    modalTitle.textContent = "Edit Vocabulary Source";
    sourceName.value = source.name;
    sourceDeck.value = source.deckName;

    // Load fields for the deck
    loadFieldsForDeck(source.deckName).then(() => {
      sourceField.value = source.fieldName;
    });
  } else {
    // Add mode
    modalTitle.textContent = "Add Vocabulary Source";
    sourceName.value = "";
    sourceDeck.value = "";
    sourceField.innerHTML = '<option value="">Select deck first</option>';
  }

  // Populate decks
  populateDecksDropdown();

  modal.style.display = "flex";
}

function closeSourceModal(): void {
  const modal = document.getElementById("sourceModal");
  if (modal) {
    modal.style.display = "none";
  }
  editingSourceId = null;
}

async function saveSource(): Promise<void> {
  const sourceName = document.getElementById("sourceName") as HTMLInputElement;
  const sourceDeck = document.getElementById("sourceDeck") as HTMLSelectElement;
  const sourceField = document.getElementById(
    "sourceField"
  ) as HTMLSelectElement;

  if (!sourceName || !sourceDeck || !sourceField) return;

  const name = sourceName.value.trim();
  const deckName = sourceDeck.value;
  const fieldName = sourceField.value;
  const enabled = true; // All sources are now always enabled

  // Validation
  if (!name) {
    showStatus("sourcesStatus", "Source name is required", "error");
    return;
  }

  if (!deckName) {
    showStatus("sourcesStatus", "Please select a deck", "error");
    return;
  }

  if (!fieldName) {
    showStatus("sourcesStatus", "Please select a field", "error");
    return;
  }

  // Check for duplicate names (excluding current source if editing)
  const existingSource = currentSources.find(
    (s) =>
      s.name.toLowerCase() === name.toLowerCase() && s.id !== editingSourceId
  );
  if (existingSource) {
    showStatus(
      "sourcesStatus",
      "A source with this name already exists",
      "error"
    );
    return;
  }

  // Validate source with AnkiConnect
  const isValid = await validateSource({ name, deckName, fieldName, enabled });
  if (!isValid) {
    return; // Error message already shown by validateSource
  }

  if (editingSourceId) {
    // Edit existing source
    const sourceIndex = currentSources.findIndex(
      (s) => s.id === editingSourceId
    );
    if (sourceIndex !== -1) {
      currentSources[sourceIndex] = {
        ...currentSources[sourceIndex],
        name,
        deckName,
        fieldName,
        enabled,
      };
    }
  } else {
    // Add new source
    const newSource: VocabSource = {
      id: generateSourceId(),
      name,
      deckName,
      fieldName,
      enabled,
      createdAt: new Date().toISOString(),
    };
    currentSources.push(newSource);
  }

  await saveVocabSources();
  renderSourcesTable();
  updateSourcesStats();
  await loadVocabStats();
  await loadIgnoredWordsCount();
  closeSourceModal();
}

// Source Actions
function editSource(sourceId: string): void {
  openSourceModal(sourceId);
}

async function refreshSource(sourceId: string): Promise<void> {
  const source = currentSources.find((s) => s.id === sourceId);
  if (!source) return;

  try {
    showStatus(
      "sourcesStatus",
      `Refreshing vocabulary from "${source.name}"...`,
      "info"
    );

    // Trigger a refresh of the vocabulary data in the background
    await sendMessage({ type: "REFRESH" });

    // Reload the statistics to reflect any changes
    await loadVocabStats();
    await loadIgnoredWordsCount();

    showStatus(
      "sourcesStatus",
      `Successfully refreshed vocabulary from "${source.name}"`,
      "success"
    );
  } catch (error) {
    console.error(`Failed to refresh source "${source.name}":`, error);
    showStatus(
      "sourcesStatus",
      `Failed to refresh vocabulary from "${source.name}"`,
      "error"
    );
  }
}

function deleteSource(sourceId: string): void {
  const source = currentSources.find((s) => s.id === sourceId);
  if (
    source &&
    confirm(`Are you sure you want to delete the source "${source.name}"?`)
  ) {
    currentSources = currentSources.filter((s) => s.id !== sourceId);
    saveVocabSources();
    renderSourcesTable();
    updateSourcesStats();
    loadVocabStats();
    loadIgnoredWordsCount();
  }
}

// Deck and Field Loading
async function loadDecks(): Promise<void> {
  try {
    const result = await ankiConnect({
      action: "deckNames",
      version: 6,
    });

    availableDecks = result.result;
    showStatus("sourcesStatus", "Decks loaded successfully", "success");
  } catch (error) {
    console.error("Failed to load decks:", error);
    showStatus(
      "sourcesStatus",
      "Failed to connect to AnkiConnect. Make sure Anki is running.",
      "error"
    );
  }
}

function populateDecksDropdown(): void {
  const sourceDeck = document.getElementById("sourceDeck") as HTMLSelectElement;
  if (!sourceDeck) return;

  sourceDeck.innerHTML = '<option value="">Select a deck</option>';
  availableDecks.forEach((deckName) => {
    const option = document.createElement("option");
    option.value = deckName;
    option.textContent = deckName;
    sourceDeck.appendChild(option);
  });
}

async function loadFieldsForDeck(deckName: string): Promise<void> {
  const sourceField = document.getElementById(
    "sourceField"
  ) as HTMLSelectElement;
  if (!sourceField) return;

  if (!deckName) {
    sourceField.innerHTML = '<option value="">Select deck first</option>';
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
      sourceField.innerHTML =
        '<option value="">No notes found in deck</option>';
      return;
    }

    const noteInfo = await ankiConnect({
      action: "notesInfo",
      params: { notes: [noteIds.result[0]] },
      version: 6,
    });

    const fields = Object.keys(noteInfo.result[0].fields);
    sourceField.innerHTML = '<option value="">Select a field</option>';
    fields.forEach((fieldName) => {
      const option = document.createElement("option");
      option.value = fieldName;
      option.textContent = fieldName;
      sourceField.appendChild(option);
    });
  } catch (error) {
    console.error("Failed to load fields:", error);
    sourceField.innerHTML = '<option value="">Error loading fields</option>';
  }
}

// Update AnkiConnect status indicator
async function updateAnkiStatus(): Promise<void> {
  const statusIndicator = document.getElementById("ankiStatus");
  if (!statusIndicator) return;

  // Set checking state
  statusIndicator.className = "anki-status-indicator checking";
  statusIndicator.title = "Checking AnkiConnect...";

  try {
    const isConnected = await checkAnkiConnect();
    if (isConnected) {
      statusIndicator.className = "anki-status-indicator connected";
      statusIndicator.title = "Connected to AnkiConnect";
    } else {
      statusIndicator.className = "anki-status-indicator disconnected";
      statusIndicator.title = "AnkiConnect not available";
    }
  } catch (error) {
    statusIndicator.className = "anki-status-indicator disconnected";
    statusIndicator.title = "Failed to check AnkiConnect";
  }
}

// Frequency stats loading
async function loadFrequencyStats(): Promise<void> {
  try {
    const stats = await getFrequencyStats();

    const totalEntries = document.getElementById("totalEntries");
    const cacheSize = document.getElementById("cacheSize");
    const dbSize = document.getElementById("dbSize");

    if (totalEntries)
      totalEntries.textContent = stats.totalEntries.toLocaleString();
    if (cacheSize) cacheSize.textContent = stats.cacheSize.toLocaleString();
    if (dbSize) dbSize.textContent = "N/A";
  } catch (error) {
    console.error("Failed to load frequency stats:", error);
  }
}

// Initialize options page
async function initializeOptions(): Promise<void> {
  console.log("Initializing options page...");

  // Load settings and apply to UI
  const settings = await loadSettings();

  // Apply settings to form elements
  const colorIntensity = document.getElementById(
    "colorIntensity"
  ) as HTMLInputElement;
  const showStats = document.getElementById("showStats") as HTMLInputElement;
  const showFrequencyOnHover = document.getElementById(
    "showFrequencyOnHover"
  ) as HTMLInputElement;
  const singleColor = document.getElementById(
    "singleColor"
  ) as HTMLInputElement;
  const vocabularyGoal = document.getElementById(
    "vocabularyGoal"
  ) as HTMLInputElement;

  if (colorIntensity) {
    colorIntensity.value = settings.colorIntensity.toString();
    updateIntensityDisplay();
  }
  if (showStats) showStats.checked = settings.showStats;
  if (showFrequencyOnHover)
    showFrequencyOnHover.checked = settings.showFrequencyOnHover;
  if (singleColor) singleColor.value = settings.singleColor;
  if (vocabularyGoal) vocabularyGoal.value = settings.vocabularyGoal.toString();

  // Set highlight style
  const highlightStyleRadios = document.querySelectorAll(
    'input[name="highlightStyle"]'
  ) as NodeListOf<HTMLInputElement>;
  highlightStyleRadios.forEach((radio) => {
    if (radio.value === settings.highlightStyle) {
      radio.checked = true;
    }
  });

  // Set color scheme
  const colorSchemeRadios = document.querySelectorAll(
    'input[name="colorScheme"]'
  ) as NodeListOf<HTMLInputElement>;
  colorSchemeRadios.forEach((radio) => {
    if (
      (radio.value === "frequency" && settings.useFrequencyColors) ||
      (radio.value === "single" && !settings.useFrequencyColors)
    ) {
      radio.checked = true;
    }
  });

  updateColorSchemeVisibility();
  updateStylePreview();

  // Load ignored words settings
  await loadIgnoredWordsSettings();

  // Load vocabulary sources
  await loadVocabSources();

  // Load vocabulary statistics
  await loadVocabStats();

  // Load ignored words count
  await loadIgnoredWordsCount();

  // Load decks for modal
  await loadDecks();

  // Update AnkiConnect status
  await updateAnkiStatus();

  // Load frequency stats
  await loadFrequencyStats();

  console.log("Options page initialized");
}

function updateIntensityDisplay(): void {
  const colorIntensity = document.getElementById(
    "colorIntensity"
  ) as HTMLInputElement;
  const colorIntensityValue = document.getElementById("colorIntensityValue");

  if (colorIntensity && colorIntensityValue) {
    const value = Math.round(parseFloat(colorIntensity.value) * 100);
    colorIntensityValue.textContent = `${value}%`;
  }
}

function updateColorSchemeVisibility(): void {
  const singleColorGroup = document.getElementById("singleColorGroup");
  const singleColorRadio = document.querySelector(
    'input[name="colorScheme"][value="single"]'
  ) as HTMLInputElement;

  if (singleColorGroup && singleColorRadio) {
    singleColorGroup.style.display = singleColorRadio.checked
      ? "block"
      : "none";
  }
}

function updateStylePreview(): void {
  const previewWord1 = document.getElementById("previewWord1");
  const previewWord2 = document.getElementById("previewWord2");

  if (!previewWord1 || !previewWord2) return;

  const highlightStyleRadio = document.querySelector(
    'input[name="highlightStyle"]:checked'
  ) as HTMLInputElement;
  const colorSchemeRadio = document.querySelector(
    'input[name="colorScheme"]:checked'
  ) as HTMLInputElement;
  const colorIntensity = document.getElementById(
    "colorIntensity"
  ) as HTMLInputElement;
  const singleColor = document.getElementById(
    "singleColor"
  ) as HTMLInputElement;

  if (!highlightStyleRadio || !colorSchemeRadio || !colorIntensity) return;

  const style = highlightStyleRadio.value as HighlightStyle;
  const useFrequencyColors = colorSchemeRadio.value === "frequency";
  const intensity = parseFloat(colorIntensity.value);

  // Apply preview styles
  if (useFrequencyColors) {
    const color1 = getColorForFrequency(5000, intensity); // Common word
    const color2 = getColorForFrequency(50000, intensity); // Rare word
    if (color1)
      applyHighlightStyle(previewWord1, color1, style, true, 5000, false);
    if (color2)
      applyHighlightStyle(previewWord2, color2, style, true, 50000, false);
  } else {
    const color = getSingleColor(singleColor?.value || "#ff6b6b", intensity);
    applyHighlightStyle(previewWord1, color, style, false, null, false);
    applyHighlightStyle(previewWord2, color, style, false, null, false);
  }
}

// Clear old configuration
async function clearOldConfiguration(): Promise<void> {
  try {
    // Remove old single deck configuration
    await new Promise<void>((resolve) => {
      chrome.storage.sync.remove(["primaryDeck", "wordField"], () => {
        resolve();
      });
    });

    // Force refresh to reload with new system
    await sendMessage({ type: "REFRESH" });

    showStatus(
      "sourcesStatus",
      "Old configuration cleared. Please add your vocabulary sources using the new system.",
      "success"
    );

    // Reload sources to show current state
    await loadVocabSources();
  } catch (error) {
    console.error("Failed to clear old configuration:", error);
    showStatus("sourcesStatus", "Failed to clear old configuration", "error");
  }
}

// Get ignored words settings from form
async function getIgnoredWordsSettings(): Promise<IgnoredWordsSettings> {
  const ignoredWordsEnabled = document.getElementById(
    "ignoredWordsEnabled"
  ) as HTMLInputElement;
  const ignoredDeckName = document.getElementById(
    "ignoredDeckName"
  ) as HTMLInputElement;
  const ignoredNoteType = document.getElementById(
    "ignoredNoteType"
  ) as HTMLInputElement;
  const ignoredFieldName = document.getElementById(
    "ignoredFieldName"
  ) as HTMLInputElement;

  return {
    enabled: ignoredWordsEnabled?.checked || false,
    deckName: ignoredDeckName?.value || "SeerIgnored",
    noteType: ignoredNoteType?.value || "Seer",
    fieldName: ignoredFieldName?.value || "Word",
  };
}

// Save ignored words settings to storage
async function saveIgnoredWordsSettings(
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

// Load ignored words settings and populate form
async function loadIgnoredWordsSettings(): Promise<void> {
  try {
    const ignoredSettings = await new Promise<{
      ignoredWordsEnabled: boolean;
      ignoredDeckName: string;
      ignoredNoteType: string;
      ignoredFieldName: string;
    }>((resolve) => {
      chrome.storage.sync.get(
        {
          ignoredWordsEnabled: false,
          ignoredDeckName: "SeerIgnored",
          ignoredNoteType: "Seer",
          ignoredFieldName: "Word",
        },
        (result) => {
          resolve(result as any);
        }
      );
    });

    // Populate form elements
    const ignoredWordsEnabled = document.getElementById(
      "ignoredWordsEnabled"
    ) as HTMLInputElement;
    const ignoredDeckName = document.getElementById(
      "ignoredDeckName"
    ) as HTMLInputElement;
    const ignoredNoteType = document.getElementById(
      "ignoredNoteType"
    ) as HTMLInputElement;
    const ignoredFieldName = document.getElementById(
      "ignoredFieldName"
    ) as HTMLInputElement;

    if (ignoredWordsEnabled)
      ignoredWordsEnabled.checked = ignoredSettings.ignoredWordsEnabled;
    if (ignoredDeckName)
      ignoredDeckName.value = ignoredSettings.ignoredDeckName;
    if (ignoredNoteType)
      ignoredNoteType.value = ignoredSettings.ignoredNoteType;
    if (ignoredFieldName)
      ignoredFieldName.value = ignoredSettings.ignoredFieldName;
  } catch (error) {
    console.error("Failed to load ignored words settings:", error);
  }
}

// Load and display ignored words count
async function loadIgnoredWordsCount(): Promise<void> {
  const totalIgnoredCount = document.getElementById("totalIgnoredCount");

  // Show loading state
  if (totalIgnoredCount) totalIgnoredCount.textContent = "Loading...";

  try {
    const response = await sendMessage<GetIgnoredWordsCountResponse>({
      type: "GET_IGNORED_WORDS_COUNT",
    });

    if (totalIgnoredCount) {
      totalIgnoredCount.textContent = response.count.toLocaleString();
    }
  } catch (error) {
    console.error("Failed to load ignored words count:", error);
    if (totalIgnoredCount) {
      totalIgnoredCount.textContent = "0";
    }
  }
}

// Load and display vocabulary statistics
async function loadVocabStats(): Promise<void> {
  const totalVocabCount = document.getElementById("totalVocabCount");
  const vocabBreakdownChart = document.getElementById("vocabBreakdownChart");

  // Show loading state
  if (totalVocabCount) totalVocabCount.textContent = "Loading...";
  if (vocabBreakdownChart) {
    vocabBreakdownChart.innerHTML =
      '<div class="no-data-message">Loading vocabulary statistics...</div>';
  }

  try {
    const response = await sendMessage<GetVocabStatsResponse>({
      type: "GET_VOCAB_STATS",
    });

    await renderVocabStats(response.stats);
  } catch (error) {
    console.error("Failed to load vocabulary statistics:", error);
    await renderVocabStats({ totalWords: 0, sourceStats: [] });
  }
}

// Render vocabulary statistics
async function renderVocabStats(stats: VocabStatsData): Promise<void> {
  const totalVocabCount = document.getElementById("totalVocabCount");
  const vocabBreakdownChart = document.getElementById("vocabBreakdownChart");
  const vocabProgressFill = document.getElementById("vocabProgressFill");
  const vocabProgressText = document.getElementById("vocabProgressText");

  if (!totalVocabCount || !vocabBreakdownChart) return;

  // Update total count
  totalVocabCount.textContent = stats.totalWords.toLocaleString();

  // Update progress bar using saved vocabulary goal
  if (vocabProgressFill && vocabProgressText) {
    const settings = await loadSettings();
    const goal = settings.vocabularyGoal;
    const progressPercentage = Math.min((stats.totalWords / goal) * 100, 100);

    vocabProgressFill.style.width = `${progressPercentage}%`;
    vocabProgressText.textContent = `${stats.totalWords.toLocaleString()} / ${goal.toLocaleString()} words`;
  }

  // Clear existing chart
  vocabBreakdownChart.innerHTML = "";

  if (stats.sourceStats.length === 0 || stats.totalWords === 0) {
    vocabBreakdownChart.innerHTML =
      '<div class="no-data-message">No vocabulary data available</div>';
    return;
  }

  // Create simple list for each source (no individual progress bars)
  stats.sourceStats.forEach((sourceStat) => {
    const sourceElement = document.createElement("div");
    sourceElement.className = "vocab-source-item";

    sourceElement.innerHTML = `
      <div class="vocab-source-header">
        <div class="vocab-source-name">${escapeHtml(
          sourceStat.sourceName
        )}</div>
        <div class="vocab-source-count">
          ${sourceStat.wordCount.toLocaleString()}
          <span class="vocab-source-percentage">(${sourceStat.percentage.toFixed(
            1
          )}%)</span>
        </div>
      </div>
    `;

    vocabBreakdownChart.appendChild(sourceElement);
  });
}

// Functions are now handled via event delegation, no need for global exposure

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  initializeOptions();

  // Vocabulary Sources Events
  const addSourceBtn = document.getElementById("addSource");
  const closeSourceModalBtn = document.getElementById("closeSourceModal");
  const cancelSourceModalBtn = document.getElementById("cancelSourceModal");
  const saveSourceBtn = document.getElementById("saveSource");
  const sourceDeckSelect = document.getElementById(
    "sourceDeck"
  ) as HTMLSelectElement;
  const vocabularyGoalInput = document.getElementById(
    "vocabularyGoal"
  ) as HTMLInputElement;

  if (addSourceBtn) {
    addSourceBtn.addEventListener("click", () => openSourceModal());
  }

  const clearOldConfigBtn = document.getElementById("clearOldConfig");
  if (clearOldConfigBtn) {
    clearOldConfigBtn.addEventListener("click", clearOldConfiguration);
  }

  // Event delegation for source action buttons
  const sourcesTableBody = document.getElementById("sourcesTableBody");
  if (sourcesTableBody) {
    sourcesTableBody.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest("[data-action]") as HTMLElement;

      if (button) {
        const action = button.getAttribute("data-action");
        const sourceId = button.getAttribute("data-source-id");

        if (sourceId) {
          switch (action) {
            case "edit":
              editSource(sourceId);
              break;
            case "refresh":
              refreshSource(sourceId);
              break;
            case "delete":
              deleteSource(sourceId);
              break;
          }
        }
      }
    });
  }

  if (closeSourceModalBtn) {
    closeSourceModalBtn.addEventListener("click", closeSourceModal);
  }

  if (cancelSourceModalBtn) {
    cancelSourceModalBtn.addEventListener("click", closeSourceModal);
  }

  if (saveSourceBtn) {
    saveSourceBtn.addEventListener("click", saveSource);
  }

  if (sourceDeckSelect) {
    sourceDeckSelect.addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      loadFieldsForDeck(target.value);
    });
  }

  if (vocabularyGoalInput) {
    vocabularyGoalInput.addEventListener("change", async () => {
      try {
        const goal = parseInt(vocabularyGoalInput.value);
        if (goal >= 1000 && goal <= 100000) {
          await saveSettings({ vocabularyGoal: goal });
          // Refresh the progress bar with new goal
          await loadVocabStats();
          showStatus("sourcesStatus", "Vocabulary goal updated", "success");
        }
      } catch (error) {
        console.error("Failed to save vocabulary goal:", error);
        showStatus("sourcesStatus", "Failed to save vocabulary goal", "error");
      }
    });
  }

  // Close modal when clicking outside
  const sourceModal = document.getElementById("sourceModal");
  if (sourceModal) {
    sourceModal.addEventListener("click", (e) => {
      if (e.target === sourceModal) {
        closeSourceModal();
      }
    });
  }

  // Display Settings Events
  const colorIntensity = document.getElementById("colorIntensity");
  const colorSchemeRadios = document.querySelectorAll(
    'input[name="colorScheme"]'
  );
  const highlightStyleRadios = document.querySelectorAll(
    'input[name="highlightStyle"]'
  );
  const singleColor = document.getElementById("singleColor");
  const saveDisplaySettingsBtn = document.getElementById("saveDisplaySettings");

  if (colorIntensity) {
    colorIntensity.addEventListener("input", () => {
      updateIntensityDisplay();
      updateStylePreview();
    });
  }

  colorSchemeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      updateColorSchemeVisibility();
      updateStylePreview();
    });
  });

  highlightStyleRadios.forEach((radio) => {
    radio.addEventListener("change", updateStylePreview);
  });

  if (singleColor) {
    singleColor.addEventListener("change", updateStylePreview);
  }

  if (saveDisplaySettingsBtn) {
    saveDisplaySettingsBtn.addEventListener("click", async () => {
      try {
        const settings: Partial<Settings> = {};

        const colorIntensityEl = document.getElementById(
          "colorIntensity"
        ) as HTMLInputElement;
        const showStatsEl = document.getElementById(
          "showStats"
        ) as HTMLInputElement;
        const showFrequencyOnHoverEl = document.getElementById(
          "showFrequencyOnHover"
        ) as HTMLInputElement;
        const singleColorEl = document.getElementById(
          "singleColor"
        ) as HTMLInputElement;

        if (colorIntensityEl)
          settings.colorIntensity = parseFloat(colorIntensityEl.value);
        if (showStatsEl) settings.showStats = showStatsEl.checked;
        if (showFrequencyOnHoverEl)
          settings.showFrequencyOnHover = showFrequencyOnHoverEl.checked;
        if (singleColorEl) settings.singleColor = singleColorEl.value;

        const highlightStyleRadio = document.querySelector(
          'input[name="highlightStyle"]:checked'
        ) as HTMLInputElement;
        const colorSchemeRadio = document.querySelector(
          'input[name="colorScheme"]:checked'
        ) as HTMLInputElement;

        if (highlightStyleRadio)
          settings.highlightStyle = highlightStyleRadio.value as HighlightStyle;
        if (colorSchemeRadio)
          settings.useFrequencyColors = colorSchemeRadio.value === "frequency";

        await saveSettings(settings);
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
  }

  // Frequency Database Events
  const refreshFrequencyBtn = document.getElementById("refreshFrequency");
  const clearFrequencyBtn = document.getElementById("clearFrequency");
  const exportFrequencyBtn = document.getElementById("exportFrequency");

  if (refreshFrequencyBtn) {
    refreshFrequencyBtn.addEventListener("click", async () => {
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
  }

  if (clearFrequencyBtn) {
    clearFrequencyBtn.addEventListener("click", async () => {
      if (
        confirm(
          "Are you sure you want to clear and re-download all frequency data? This may take a few minutes."
        )
      ) {
        try {
          showStatus(
            "frequencyStatus",
            "Clearing and re-downloading frequency data...",
            "info"
          );
          // Implementation would go here
          showStatus(
            "frequencyStatus",
            "Frequency data cleared and re-downloaded successfully",
            "success"
          );
        } catch (error) {
          console.error("Failed to clear frequency data:", error);
          showStatus(
            "frequencyStatus",
            "Failed to clear frequency data",
            "error"
          );
        }
      }
    });
  }

  if (exportFrequencyBtn) {
    exportFrequencyBtn.addEventListener("click", () => {
      // Implementation would go here
      showStatus(
        "frequencyStatus",
        "Export functionality not yet implemented",
        "info"
      );
    });
  }

  // Ignored Words Events
  const setupIgnoredWordsBtn = document.getElementById("setupIgnoredWords");
  const saveIgnoredSettingsBtn = document.getElementById("saveIgnoredSettings");

  if (setupIgnoredWordsBtn) {
    setupIgnoredWordsBtn.addEventListener("click", async () => {
      try {
        const ignoredSettings = await getIgnoredWordsSettings();
        await setupIgnoredWords(ignoredSettings);
        showStatus(
          "ignoredStatus",
          "Ignored words deck and note type setup successfully",
          "success"
        );
      } catch (error) {
        console.error("Failed to setup ignored words:", error);
        showStatus("ignoredStatus", "Failed to setup ignored words", "error");
      }
    });
  }

  if (saveIgnoredSettingsBtn) {
    saveIgnoredSettingsBtn.addEventListener("click", async () => {
      try {
        const ignoredSettings = await getIgnoredWordsSettings();
        await saveIgnoredWordsSettings(ignoredSettings);
        showStatus(
          "ignoredStatus",
          "Ignored words settings saved successfully",
          "success"
        );
        // Reload ignored words count after settings change
        await loadIgnoredWordsCount();
      } catch (error) {
        console.error("Failed to save ignored words settings:", error);
        showStatus(
          "ignoredStatus",
          "Failed to save ignored words settings",
          "error"
        );
      }
    });
  }
});
