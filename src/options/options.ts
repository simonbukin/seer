import type { SeerConfig, VocabSource, HighlightConfig, HighlightLayerConfig, LayerStyleType, UnderlineStyle, ThemeMode } from '../shared/types';
import { getLayersByCategory } from '../shared/highlight-defaults';
import 'vanilla-colorful/rgba-color-picker.js';
import type { RgbaColorPicker } from 'vanilla-colorful/rgba-color-picker.js';
import { initializeTheme, applyTheme } from '../shared/theme';

// Cached data
let availableDecks: string[] = [];
let deckFieldsCache: Map<string, string[]> = new Map();
let currentHighlightConfig: HighlightConfig | null = null;

// DOM Elements
const ankiUrlInput = document.getElementById('anki-url') as HTMLInputElement;
const ankiApiKeyInput = document.getElementById('anki-api-key') as HTMLInputElement;
const connectionStatus = document.getElementById('connection-status')!;
const knownSourcesContainer = document.getElementById('known-sources')!;
const addSourceBtn = document.getElementById('add-source-btn')!;
const ignoredDeckSelect = document.getElementById('ignored-deck') as HTMLSelectElement;
const ignoredFieldSelect = document.getElementById('ignored-field') as HTMLSelectElement;
const knownDeckSelect = document.getElementById('known-deck') as HTMLSelectElement;
const knownFieldSelect = document.getElementById('known-field') as HTMLSelectElement;
const highlightLayersContainer = document.getElementById('highlight-layers')!;
const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn')!;
const saveStatus = document.getElementById('save-status')!;

// Current known sources state
let knownSources: VocabSource[] = [];

// Show status message
function showStatus(element: HTMLElement, message: string, type: 'success' | 'error' | 'info') {
  element.textContent = message;
  element.className = `status ${type}`;
  element.classList.remove('hidden');
}

function hideStatus(element: HTMLElement) {
  element.classList.add('hidden');
}

// Load decks from Anki
async function loadDecksFromAnki(): Promise<boolean> {
  showStatus(connectionStatus, 'Loading decks from Anki...', 'info');

  try {
    // First save the connection settings
    await chrome.runtime.sendMessage({
      type: 'setConfig',
      config: {
        ankiConnectUrl: ankiUrlInput.value,
        ankiConnectApiKey: ankiApiKeyInput.value
      }
    });

    const response = await chrome.runtime.sendMessage({ type: 'getAnkiDecks' });

    if (response.error) {
      showStatus(connectionStatus, `Failed to load decks: ${response.error}`, 'error');
      return false;
    }

    availableDecks = response.decks || [];
    showStatus(connectionStatus, `Loaded ${availableDecks.length} decks from Anki`, 'success');

    // Update all deck dropdowns
    updateAllDeckDropdowns();

    return true;
  } catch (e) {
    showStatus(connectionStatus, `Error: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return false;
  }
}

// Get fields for a deck
async function getFieldsForDeck(deckName: string): Promise<string[]> {
  if (deckFieldsCache.has(deckName)) {
    return deckFieldsCache.get(deckName)!;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'getAnkiFields', deckName });
    const fields = response.fields || [];
    deckFieldsCache.set(deckName, fields);
    return fields;
  } catch {
    return [];
  }
}

// Update all deck dropdowns with available decks
function updateAllDeckDropdowns() {
  // Update known source dropdowns
  const deckSelects = knownSourcesContainer.querySelectorAll('select[data-type="deck"]');
  deckSelects.forEach(select => {
    const currentValue = (select as HTMLSelectElement).value;
    populateDeckDropdown(select as HTMLSelectElement, currentValue);
  });

  // Update ignored deck dropdown
  populateDeckDropdown(ignoredDeckSelect, ignoredDeckSelect.value);

  // Update known deck dropdown
  populateDeckDropdown(knownDeckSelect, knownDeckSelect.value);
}

// Populate a deck dropdown
function populateDeckDropdown(select: HTMLSelectElement, selectedValue?: string) {
  const currentValue = selectedValue || select.value;
  select.innerHTML = '<option value="">Select a deck...</option>';

  for (const deck of availableDecks) {
    const option = document.createElement('option');
    option.value = deck;
    option.textContent = deck;
    if (deck === currentValue) option.selected = true;
    select.appendChild(option);
  }
}

// Populate a field dropdown
async function populateFieldDropdown(select: HTMLSelectElement, deckName: string, selectedValue?: string) {
  select.innerHTML = '<option value="">Loading fields...</option>';

  if (!deckName) {
    select.innerHTML = '<option value="">Select a deck first...</option>';
    return;
  }

  let fields = await getFieldsForDeck(deckName);

  // For Seer special decks that might be empty, default to "Word" field
  if (fields.length === 0 && (deckName.startsWith('Seer::') || deckName.includes('Seer'))) {
    fields = ['Word'];
  }

  select.innerHTML = '<option value="">Select a field...</option>';
  for (const field of fields) {
    const option = document.createElement('option');
    option.value = field;
    option.textContent = field;
    if (field === selectedValue) option.selected = true;
    select.appendChild(option);
  }

  // If we have a selected value but it's not in the list (deck empty), add it
  if (selectedValue && !fields.includes(selectedValue)) {
    const option = document.createElement('option');
    option.value = selectedValue;
    option.textContent = selectedValue;
    option.selected = true;
    select.appendChild(option);
  }
}

// Create a known source row
function createSourceRow(source?: VocabSource): HTMLElement {
  const row = document.createElement('div');
  row.className = 'source-item';

  const deckDiv = document.createElement('div');
  const deckLabel = document.createElement('label');
  deckLabel.textContent = 'Deck';
  const deckSelect = document.createElement('select');
  deckSelect.dataset.type = 'deck';
  populateDeckDropdown(deckSelect, source?.deckName);
  deckDiv.appendChild(deckLabel);
  deckDiv.appendChild(deckSelect);

  const fieldDiv = document.createElement('div');
  const fieldLabel = document.createElement('label');
  fieldLabel.textContent = 'Field';
  const fieldSelect = document.createElement('select');
  fieldSelect.dataset.type = 'field';
  fieldDiv.appendChild(fieldLabel);
  fieldDiv.appendChild(fieldSelect);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'secondary outline';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove';
  removeBtn.addEventListener('click', () => {
    row.remove();
    updateKnownSourcesState();
  });

  // When deck changes, load fields
  deckSelect.addEventListener('change', async () => {
    await populateFieldDropdown(fieldSelect, deckSelect.value);
    updateKnownSourcesState();
  });

  fieldSelect.addEventListener('change', () => {
    updateKnownSourcesState();
  });

  row.appendChild(deckDiv);
  row.appendChild(fieldDiv);
  row.appendChild(removeBtn);

  // If we have a source, populate fields
  if (source?.deckName) {
    populateFieldDropdown(fieldSelect, source.deckName, source.fieldName);
  }

  return row;
}

// Update known sources state from DOM
function updateKnownSourcesState() {
  knownSources = [];
  const rows = knownSourcesContainer.querySelectorAll('.source-item');
  rows.forEach(row => {
    const deckSelect = row.querySelector('select[data-type="deck"]') as HTMLSelectElement;
    const fieldSelect = row.querySelector('select[data-type="field"]') as HTMLSelectElement;
    if (deckSelect?.value && fieldSelect?.value) {
      knownSources.push({ deckName: deckSelect.value, fieldName: fieldSelect.value });
    }
  });
}

// Load settings
async function loadSettings() {
  const config = await chrome.runtime.sendMessage({ type: 'getConfig' }) as SeerConfig;

  ankiUrlInput.value = config.ankiConnectUrl;
  ankiApiKeyInput.value = config.ankiConnectApiKey;
  enabledCheckbox.checked = config.enabled;

  // Load theme setting
  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  if (themeSelect) {
    themeSelect.value = config.theme || 'auto';
  }

  // Load and render highlight layers
  currentHighlightConfig = config.highlightConfig;
  renderHighlightLayers(currentHighlightConfig);

  // Store known sources
  knownSources = config.knownSources || [];

  // Try to load decks
  const loaded = await loadDecksFromAnki();

  if (loaded) {
    // Render known sources
    knownSourcesContainer.innerHTML = '';
    for (const source of knownSources) {
      knownSourcesContainer.appendChild(createSourceRow(source));
    }

    // Set ignored deck/field
    if (config.ignoredSource) {
      ignoredDeckSelect.value = config.ignoredSource.deckName;
      await populateFieldDropdown(ignoredFieldSelect, config.ignoredSource.deckName, config.ignoredSource.fieldName);
    }

    // Set known deck/field
    if (config.knownSource) {
      knownDeckSelect.value = config.knownSource.deckName;
      await populateFieldDropdown(knownFieldSelect, config.knownSource.deckName, config.knownSource.fieldName);
    }
  } else {
    // Show manual entry fallback
    showStatus(connectionStatus, 'Could not connect to Anki. Make sure Anki is running with AnkiConnect installed.', 'error');
  }
}

// Get collapsed states from localStorage
function getCollapsedStates(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('seer-layer-collapsed') || '{}');
  } catch {
    return {};
  }
}

// Save collapsed state to localStorage
function saveCollapsedState(category: string, collapsed: boolean) {
  const states = getCollapsedStates();
  states[category] = collapsed;
  localStorage.setItem('seer-layer-collapsed', JSON.stringify(states));
}

// Render highlight layers configuration
function renderHighlightLayers(config: HighlightConfig) {
  const categories = [
    { id: 'frequency', label: 'Frequency Bands', description: 'Highlight words by frequency rank', defaultCollapsed: false },
    { id: 'pos', label: 'Parts of Speech', description: 'Highlight by grammatical category', defaultCollapsed: true },
    { id: 'status', label: 'Word Status', description: 'Highlight by known/unknown status', defaultCollapsed: true },
  ] as const;

  const collapsedStates = getCollapsedStates();

  highlightLayersContainer.innerHTML = categories.map(cat => {
    const layers = getLayersByCategory(config, cat.id);
    // Use saved state if available, otherwise use default
    const isCollapsed = collapsedStates[cat.id] !== undefined ? collapsedStates[cat.id] : cat.defaultCollapsed;
    const collapsedClass = isCollapsed ? 'collapsed' : '';
    return `
      <div class="layer-category">
        <div class="layer-category-header ${collapsedClass}" data-category="${cat.id}">
          <h4><span class="collapse-indicator">▼</span>${cat.label}</h4>
          <small>${cat.description}</small>
        </div>
        <div class="layer-category-items ${collapsedClass}">
          ${layers.map(layer => renderLayerRow(layer)).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Attach collapse handlers
  highlightLayersContainer.querySelectorAll('.layer-category-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      const items = header.nextElementSibling as HTMLElement;
      items?.classList.toggle('collapsed');

      // Persist collapsed state
      const category = (header as HTMLElement).dataset.category;
      if (category) {
        saveCollapsedState(category, header.classList.contains('collapsed'));
      }
    });
  });

  // Attach event handlers for layer controls
  attachLayerEventHandlers();
}

function renderLayerRow(layer: HighlightLayerConfig): string {
  const hasTextColor = !!layer.textColor;
  return `
    <div class="layer-row" data-layer-id="${layer.id}">
      <label class="layer-toggle-switch">
        <input type="checkbox" ${layer.enabled ? 'checked' : ''} data-action="toggle">
      </label>
      <span class="layer-label">${layer.label}</span>
      <div class="layer-color-container">
        <button type="button" class="layer-color-swatch" data-action="color-toggle" style="background-color: ${layer.color}" title="Click to change highlight color"></button>
        <div class="layer-color-picker-popover" data-action="color-popover">
          <rgba-color-picker data-action="color"></rgba-color-picker>
        </div>
      </div>
      <div class="layer-color-container">
        <button type="button" class="layer-text-color-swatch" data-action="text-color-toggle" style="background-color: ${layer.textColor || 'transparent'}; ${!hasTextColor ? 'border-style: dashed;' : ''}" title="Click to change text color (optional)">
          ${!hasTextColor ? '<span style="font-size: 10px; color: #888;">T</span>' : ''}
        </button>
        <div class="layer-text-color-picker-popover" data-action="text-color-popover">
          <rgba-color-picker data-action="text-color"></rgba-color-picker>
          <button type="button" class="clear-text-color-btn" data-action="clear-text-color">Clear</button>
        </div>
      </div>
      <select class="layer-style-select" data-action="style">
        <option value="background" ${layer.styleType === 'background' ? 'selected' : ''}>Background</option>
        <option value="underline" ${layer.styleType === 'underline' ? 'selected' : ''}>Underline</option>
        <option value="outline" ${layer.styleType === 'outline' ? 'selected' : ''}>Outline</option>
        <option value="none" ${layer.styleType === 'none' ? 'selected' : ''}>None</option>
      </select>
      ${layer.styleType === 'underline' ? `
        <select class="layer-underline-select" data-action="underline">
          <option value="solid" ${layer.underlineStyle === 'solid' ? 'selected' : ''}>Solid</option>
          <option value="dotted" ${layer.underlineStyle === 'dotted' ? 'selected' : ''}>Dotted</option>
          <option value="dashed" ${layer.underlineStyle === 'dashed' ? 'selected' : ''}>Dashed</option>
          <option value="wavy" ${layer.underlineStyle === 'wavy' ? 'selected' : ''}>Wavy</option>
        </select>
      ` : ''}
    </div>
  `;
}

function attachLayerEventHandlers() {
  highlightLayersContainer.querySelectorAll('.layer-row').forEach(row => {
    const layerId = (row as HTMLElement).dataset.layerId!;
    const layer = currentHighlightConfig?.layers[layerId];

    // Toggle
    row.querySelector('[data-action="toggle"]')?.addEventListener('change', (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      updateLayerConfig(layerId, { enabled });
    });

    // Color picker setup
    const colorPicker = row.querySelector('[data-action="color"]') as RgbaColorPicker | null;
    const colorSwatch = row.querySelector('[data-action="color-toggle"]') as HTMLButtonElement | null;
    const colorPopover = row.querySelector('[data-action="color-popover"]') as HTMLElement | null;

    if (colorPicker && layer) {
      // Initialize with current color
      colorPicker.color = parseRgbaToObject(layer.color);

      // Handle color changes
      colorPicker.addEventListener('color-changed', ((e: CustomEvent) => {
        const { r, g, b, a } = e.detail.value;
        const rgba = `rgba(${r}, ${g}, ${b}, ${a})`;
        updateLayerConfig(layerId, { color: rgba });
        if (colorSwatch) {
          colorSwatch.style.backgroundColor = rgba;
        }
      }) as EventListener);
    }

    // Toggle popover visibility
    if (colorSwatch && colorPopover) {
      colorSwatch.addEventListener('click', () => {
        const isOpen = colorPopover.classList.contains('open');
        // Close all other popovers first
        document.querySelectorAll('.layer-color-picker-popover.open, .layer-text-color-picker-popover.open').forEach(p => {
          p.classList.remove('open');
        });
        if (!isOpen) {
          colorPopover.classList.add('open');
        }
      });
    }

    // Text color picker setup
    const textColorPicker = row.querySelector('[data-action="text-color"]') as RgbaColorPicker | null;
    const textColorSwatch = row.querySelector('[data-action="text-color-toggle"]') as HTMLButtonElement | null;
    const textColorPopover = row.querySelector('[data-action="text-color-popover"]') as HTMLElement | null;
    const clearTextColorBtn = row.querySelector('[data-action="clear-text-color"]') as HTMLButtonElement | null;

    if (textColorPicker && layer) {
      // Initialize with current text color or a default
      textColorPicker.color = layer.textColor ? parseRgbaToObject(layer.textColor) : { r: 0, g: 0, b: 0, a: 1 };

      // Handle text color changes
      textColorPicker.addEventListener('color-changed', ((e: CustomEvent) => {
        const { r, g, b, a } = e.detail.value;
        const rgba = `rgba(${r}, ${g}, ${b}, ${a})`;
        updateLayerConfig(layerId, { textColor: rgba });
        if (textColorSwatch) {
          textColorSwatch.style.backgroundColor = rgba;
          textColorSwatch.style.borderStyle = 'solid';
          textColorSwatch.innerHTML = '';
        }
      }) as EventListener);
    }

    // Toggle text color popover visibility
    if (textColorSwatch && textColorPopover) {
      textColorSwatch.addEventListener('click', () => {
        const isOpen = textColorPopover.classList.contains('open');
        // Close all other popovers first
        document.querySelectorAll('.layer-color-picker-popover.open, .layer-text-color-picker-popover.open').forEach(p => {
          p.classList.remove('open');
        });
        if (!isOpen) {
          textColorPopover.classList.add('open');
        }
      });
    }

    // Clear text color button
    if (clearTextColorBtn) {
      clearTextColorBtn.addEventListener('click', () => {
        updateLayerConfig(layerId, { textColor: undefined });
        if (textColorSwatch) {
          textColorSwatch.style.backgroundColor = 'transparent';
          textColorSwatch.style.borderStyle = 'dashed';
          textColorSwatch.innerHTML = '<span style="font-size: 10px; color: #888;">T</span>';
        }
        textColorPopover?.classList.remove('open');
      });
    }

    // Style type
    row.querySelector('[data-action="style"]')?.addEventListener('change', (e) => {
      const styleType = (e.target as HTMLSelectElement).value as LayerStyleType;
      updateLayerConfig(layerId, { styleType });
      // Re-render to show/hide underline options
      if (currentHighlightConfig) {
        renderHighlightLayers(currentHighlightConfig);
      }
    });

    // Underline style
    row.querySelector('[data-action="underline"]')?.addEventListener('change', (e) => {
      const underlineStyle = (e.target as HTMLSelectElement).value as UnderlineStyle;
      updateLayerConfig(layerId, { underlineStyle });
    });
  });

  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.layer-color-container')) {
      document.querySelectorAll('.layer-color-picker-popover.open, .layer-text-color-picker-popover.open').forEach(p => {
        p.classList.remove('open');
      });
    }
  });
}

function updateLayerConfig(layerId: string, updates: Partial<HighlightLayerConfig>) {
  if (!currentHighlightConfig || !currentHighlightConfig.layers[layerId]) return;

  Object.assign(currentHighlightConfig.layers[layerId], updates);

  // Send update to background (broadcasts to content scripts)
  chrome.runtime.sendMessage({
    type: 'updateLayerStyle',
    layerId,
    config: updates
  });
}

// Color conversion helper
function parseRgbaToObject(rgba: string): { r: number; g: number; b: number; a: number } {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
  if (!match) return { r: 128, g: 128, b: 128, a: 0.35 };
  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3]),
    a: match[4] ? parseFloat(match[4]) : 1
  };
}

// Save settings
async function saveSettings() {
  updateKnownSourcesState();

  if (knownSources.length === 0) {
    showStatus(saveStatus, 'Please add at least one known words deck', 'error');
    return;
  }

  const config: Partial<SeerConfig> = {
    ankiConnectUrl: ankiUrlInput.value,
    ankiConnectApiKey: ankiApiKeyInput.value,
    knownSources,
    ignoredSource: {
      deckName: ignoredDeckSelect.value || 'Seer::Ignored',
      fieldName: ignoredFieldSelect.value || 'Word'
    },
    knownSource: {
      deckName: knownDeckSelect.value || 'Seer::Known',
      fieldName: knownFieldSelect.value || 'Word'
    },
    highlightConfig: currentHighlightConfig || undefined,
    enabled: enabledCheckbox.checked
  };

  await chrome.runtime.sendMessage({ type: 'setConfig', config });

  showStatus(saveStatus, 'Settings saved! Syncing vocabulary...', 'success');

  // Trigger vocabulary sync
  const syncResult = await chrome.runtime.sendMessage({ type: 'syncVocabulary' });
  if (syncResult.success) {
    showStatus(saveStatus, 'Settings saved and vocabulary synced!', 'success');
  } else {
    showStatus(saveStatus, `Settings saved but sync failed: ${syncResult.error}`, 'error');
  }

  setTimeout(() => hideStatus(saveStatus), 3000);
}

// Test connection
async function testConnection() {
  showStatus(connectionStatus, 'Testing connection...', 'info');

  // Save connection settings first
  await chrome.runtime.sendMessage({
    type: 'setConfig',
    config: {
      ankiConnectUrl: ankiUrlInput.value,
      ankiConnectApiKey: ankiApiKeyInput.value
    }
  });

  const response = await chrome.runtime.sendMessage({ type: 'syncVocabulary' });

  if (response.success) {
    showStatus(connectionStatus, 'Connection successful! Vocabulary synced.', 'success');
  } else {
    showStatus(connectionStatus, `Connection failed: ${response.error}`, 'error');
  }
}

// ============================================
// DEDUPLICATION SETTINGS
// ============================================

async function initDedupSettings() {
  const config = await chrome.runtime.sendMessage({ type: 'getConfig' }) as SeerConfig;
  const dedupConfig = config.deduplication || { enabled: true, timeWindowHours: 4 };

  const enabledCheckbox = document.getElementById('dedup-enabled') as HTMLInputElement;
  const windowSelect = document.getElementById('dedup-window') as HTMLSelectElement;

  if (enabledCheckbox) {
    enabledCheckbox.checked = dedupConfig.enabled;
    enabledCheckbox.addEventListener('change', async () => {
      await chrome.runtime.sendMessage({
        type: 'setConfig',
        config: {
          deduplication: {
            ...dedupConfig,
            enabled: enabledCheckbox.checked
          }
        }
      });
    });
  }

  if (windowSelect) {
    windowSelect.value = String(dedupConfig.timeWindowHours);
    windowSelect.addEventListener('change', async () => {
      await chrome.runtime.sendMessage({
        type: 'setConfig',
        config: {
          deduplication: {
            ...dedupConfig,
            timeWindowHours: parseInt(windowSelect.value, 10)
          }
        }
      });
    });
  }
}

// ============================================
// BACKUP & RESTORE
// ============================================

let pendingBackupData: unknown = null;

async function initBackupSection() {
  // Load current data statistics
  try {
    const sizes = await chrome.runtime.sendMessage({ type: 'getDatabaseSizes' });
    const statsEl = document.getElementById('backup-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <strong>Current data:</strong>
        ${sizes.encounters?.count?.toLocaleString() || 0} encounters,
        ${sizes.pages?.count?.toLocaleString() || 0} pages,
        ${sizes.sentences?.count?.toLocaleString() || 0} sentences,
        ${sizes.comprehensionSnapshots?.count?.toLocaleString() || 0} snapshots
        <br>
        <strong>Estimated size:</strong> ${sizes.formattedTotal || 'Unknown'}
      `;
    }
  } catch {
    const statsEl = document.getElementById('backup-stats');
    if (statsEl) {
      statsEl.textContent = 'Could not load data statistics';
    }
  }

  // Export handler
  document.getElementById('export-btn')?.addEventListener('click', handleExport);

  // Import handlers
  document.getElementById('import-file')?.addEventListener('change', handleFileSelect);
  document.getElementById('import-btn')?.addEventListener('click', handleImport);
}

async function handleExport() {
  const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('export-status')!;
  const compress = (document.getElementById('export-compress') as HTMLInputElement)?.checked ?? true;

  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting...';
  showStatus(statusEl, 'Creating backup...', 'info');

  try {
    const result = await chrome.runtime.sendMessage({ type: 'exportBackup', compress });

    if (!result.success) {
      throw new Error(result.error);
    }

    // Create download
    let blob: Blob;
    if (result.compressed) {
      // Decode base64 to blob
      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: 'application/gzip' });
    } else {
      blob = new Blob([result.data], { type: 'application/json' });
    }

    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(statusEl, 'Backup exported successfully!', 'success');

  } catch (e) {
    showStatus(statusEl, `Export failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export Backup';
  }

  setTimeout(() => hideStatus(statusEl), 5000);
}

async function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  const previewEl = document.getElementById('import-preview')!;
  const importBtn = document.getElementById('import-btn') as HTMLButtonElement;

  if (!file) {
    previewEl.classList.add('hidden');
    importBtn.disabled = true;
    pendingBackupData = null;
    return;
  }

  previewEl.classList.remove('hidden');
  previewEl.innerHTML = 'Reading file...';

  try {
    let jsonString: string;

    // Handle gzip compression
    if (file.name.endsWith('.gz')) {
      const buffer = await file.arrayBuffer();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        }
      });
      const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
      const reader = decompressed.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const decoder = new TextDecoder();
      jsonString = decoder.decode(combined);
    } else {
      jsonString = await file.text();
    }

    const data = JSON.parse(jsonString);
    const validation = await chrome.runtime.sendMessage({ type: 'validateBackup', data });

    if (!validation.valid) {
      previewEl.innerHTML = `
        <div style="color: #dc2626;">
          <strong>Invalid backup file:</strong>
          <ul style="margin: 0.5rem 0 0 1rem; padding: 0;">
            ${validation.errors.map((err: string) => `<li>${escapeHtml(err)}</li>`).join('')}
          </ul>
        </div>
      `;
      importBtn.disabled = true;
      pendingBackupData = null;
      return;
    }

    pendingBackupData = data;

    const exportDate = new Date(data.exportedAt).toLocaleDateString();
    previewEl.innerHTML = `
      <div style="color: #059669;">
        <strong>Valid backup from ${exportDate}</strong>
        ${validation.checksumsPassed ? '<span style="color: #059669;"> (verified)</span>' : '<span style="color: #d97706;"> (no checksums)</span>'}
      </div>
      <div style="margin-top: 0.25rem;">
        ${validation.stats.encounters.toLocaleString()} encounters,
        ${validation.stats.pages.toLocaleString()} pages,
        ${validation.stats.sentences.toLocaleString()} sentences,
        ${validation.stats.vocabWords.toLocaleString()} vocab words
      </div>
      ${validation.warnings.length > 0 ? `
        <div style="margin-top: 0.25rem; color: #d97706;">
          ${validation.warnings.map((w: string) => `<em>${escapeHtml(w)}</em>`).join('<br>')}
        </div>
      ` : ''}
    `;

    importBtn.disabled = false;

  } catch (e) {
    previewEl.innerHTML = `<div style="color: #dc2626;">Failed to read file: ${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
    importBtn.disabled = true;
    pendingBackupData = null;
  }
}

async function handleImport() {
  if (!pendingBackupData) return;

  const importBtn = document.getElementById('import-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('import-status')!;
  const conflictStrategy = (document.getElementById('import-conflict-strategy') as HTMLSelectElement)?.value || 'replace';
  const clearExisting = (document.getElementById('import-clear-existing') as HTMLInputElement)?.checked || false;

  // Confirm if clearing existing data
  if (clearExisting) {
    if (!confirm('This will delete all your existing data before importing. Are you sure?')) {
      return;
    }
  }

  importBtn.disabled = true;
  importBtn.textContent = 'Importing...';
  showStatus(statusEl, 'Importing backup...', 'info');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'importBackup',
      backup: pendingBackupData,
      options: { conflictStrategy, clearExisting }
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    const total = result.imported.encounters + result.imported.pages + result.imported.sentences + result.imported.comprehensionSnapshots;
    const skippedTotal = result.skipped.encounters + result.skipped.pages + result.skipped.sentences + result.skipped.comprehensionSnapshots;

    let message = `Import complete! ${total.toLocaleString()} records imported.`;
    if (skippedTotal > 0) {
      message += ` ${skippedTotal.toLocaleString()} skipped.`;
    }

    showStatus(statusEl, message, 'success');

    // Refresh the backup stats
    await initBackupSection();

    // Clear pending backup
    pendingBackupData = null;
    const previewEl = document.getElementById('import-preview');
    if (previewEl) {
      previewEl.classList.add('hidden');
    }
    const fileInput = document.getElementById('import-file') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }

  } catch (e) {
    showStatus(statusEl, `Import failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = 'Import Backup';
  }

  setTimeout(() => hideStatus(statusEl), 5000);
}

// ============================================
// DEBUG
// ============================================

async function loadDebugData() {
  const output = document.getElementById('debug-output')!;
  output.textContent = 'Loading...';

  try {
    const [debug, sizes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'getDebugCounts' }) as Promise<{
        rawEncounterCount: number;
        rawPageCount: number;
        rawSentenceCount: number;
        validPageCount: number;
        filteredEncounterCount: number;
        sampleEncounters: Array<{ timestamp: number; surface: string; word: string; url: string; urlHash: number }>;
        samplePages: Array<{ url: string; totalTimeMs: number; urlHash: number }>;
      }>,
      chrome.runtime.sendMessage({ type: 'getDatabaseSizes' }) as Promise<{
        encounters: { count: number; estimatedBytes: number };
        pages: { count: number; estimatedBytes: number };
        sentences: { count: number; estimatedBytes: number };
        comprehensionSnapshots: { count: number; estimatedBytes: number };
        totalBytes: number;
        formattedTotal: string;
      }>
    ]);

    const formatBytes = (bytes: number): string => {
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      return `${bytes} bytes`;
    };

    output.textContent = `=== DATABASE STORAGE ===
Total Size: ${sizes.formattedTotal}

Table Breakdown:
  Encounters:   ${sizes.encounters.count.toLocaleString()} rows (${formatBytes(sizes.encounters.estimatedBytes)})
  Pages:        ${sizes.pages.count.toLocaleString()} rows (${formatBytes(sizes.pages.estimatedBytes)})
  Sentences:    ${sizes.sentences.count.toLocaleString()} rows (${formatBytes(sizes.sentences.estimatedBytes)})
  Snapshots:    ${sizes.comprehensionSnapshots.count.toLocaleString()} rows (${formatBytes(sizes.comprehensionSnapshots.estimatedBytes)})

=== DATABASE COUNTS ===
Raw Encounters: ${debug.rawEncounterCount}
Raw Pages: ${debug.rawPageCount}
Raw Sentences: ${debug.rawSentenceCount}

=== AFTER PAGE TIME FILTER (≥5s) ===
Valid Pages: ${debug.validPageCount}
Filtered Encounters: ${debug.filteredEncounterCount}

=== SAMPLE ENCOUNTERS (with full URLs) ===
${debug.sampleEncounters.slice(0, 5).map(e =>
  `${new Date(e.timestamp).toLocaleString()}
  Word: ${e.surface} (${e.word})
  URL: ${e.url}
  Hash: ${e.urlHash}`
).join('\n\n') || '(none)'}

=== SAMPLE PAGES (with full URLs) ===
${debug.samplePages.slice(0, 5).map(p =>
  `Time: ${Math.round(p.totalTimeMs / 1000)}s | Hash: ${p.urlHash}
  URL: ${p.url}`
).join('\n\n') || '(none)'}
`;
  } catch (e) {
    output.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function clearDatabase() {
  const status = document.getElementById('clear-db-status')!;

  if (!confirm('Are you sure you want to clear all encounter data? This cannot be undone.')) {
    return;
  }

  showStatus(status, 'Clearing database...', 'info');

  try {
    const result = await chrome.runtime.sendMessage({ type: 'clearDatabase' });

    if (result.success) {
      showStatus(status, 'Database cleared successfully!', 'success');
      await loadDebugData();
      await initBackupSection();
    } else {
      showStatus(status, `Failed: ${result.error}`, 'error');
    }
  } catch (e) {
    showStatus(status, `Error: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }

  setTimeout(() => hideStatus(status), 5000);
}

// ============================================
// TOP-LEVEL TABS
// ============================================

function initTopTabs() {
  document.querySelectorAll('.top-tabs .tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = (tab as HTMLElement).dataset.topTab;
      if (tabId) switchTopTab(tabId);
    });
  });

  // Restore last active tab from localStorage
  const lastTab = localStorage.getItem('seer-active-tab') || 'anki';
  switchTopTab(lastTab);
}

function switchTopTab(tabId: string) {
  // Update tab buttons
  document.querySelectorAll('.top-tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.top-tabs .tab[data-top-tab="${tabId}"]`)?.classList.add('active');

  // Update tab content
  document.querySelectorAll('.top-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`top-tab-${tabId}`)?.classList.add('active');

  // Save last active tab to localStorage
  localStorage.setItem('seer-active-tab', tabId);
}

// Helper
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners
document.getElementById('test-connection')!.addEventListener('click', testConnection);
document.getElementById('load-decks')!.addEventListener('click', loadDecksFromAnki);
addSourceBtn.addEventListener('click', () => {
  knownSourcesContainer.appendChild(createSourceRow());
});
ignoredDeckSelect.addEventListener('change', async () => {
  await populateFieldDropdown(ignoredFieldSelect, ignoredDeckSelect.value);
});
knownDeckSelect.addEventListener('change', async () => {
  await populateFieldDropdown(knownFieldSelect, knownDeckSelect.value);
});
saveBtn.addEventListener('click', saveSettings);

// Theme change handler
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
themeSelect?.addEventListener('change', async () => {
  const newTheme = themeSelect.value as ThemeMode;
  applyTheme(newTheme);
  await chrome.runtime.sendMessage({
    type: 'setConfig',
    config: { theme: newTheme }
  });
});

// Debug buttons
document.getElementById('load-debug-btn')?.addEventListener('click', loadDebugData);
document.getElementById('clear-db-btn')?.addEventListener('click', clearDatabase);

// ============================================
// STORY PROMPTS TAB
// ============================================

// Selected grammar points for manual selection
let selectedGrammarIds: string[] = [];
// Known grammar points (excluded from auto-detection)
let knownGrammarIds: string[] = [];
// All grammar points cache
let allGrammarPoints: Array<{ id: string; pattern: string; level: string; meaning: string; sourceUrl?: string }> = [];
// Prompt templates
interface PromptTemplate {
  id: string;
  name: string;
  template: string;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}
let promptTemplates: PromptTemplate[] = [];
let activeTemplateId = '';
let editingTemplateId: string | null = null;

async function initStoryPromptsTab() {
  const generateBtn = document.getElementById('generate-prompt-btn');
  const copyBtn = document.getElementById('copy-prompt-btn');
  const grammarFilter = document.getElementById('grammar-filter') as HTMLInputElement;
  const selectedGrammarContainer = document.getElementById('selected-grammar');

  // Load known grammar from storage
  knownGrammarIds = await chrome.runtime.sendMessage({ type: 'getKnownGrammar' }) || [];

  // Load all grammar points
  allGrammarPoints = await chrome.runtime.sendMessage({ type: 'getDoJGGrammarList' }) || [];

  // Load prompt templates
  await loadTemplates();

  // Render grammar list
  renderGrammarList();

  // Initialize template UI
  initTemplateUI();

  // Generate prompt button
  generateBtn?.addEventListener('click', async () => {
    await generateStoryPrompt();
  });

  // Copy to clipboard button
  copyBtn?.addEventListener('click', async () => {
    const promptText = document.getElementById('prompt-text') as HTMLTextAreaElement;
    const copyStatus = document.getElementById('copy-status')!;

    try {
      await navigator.clipboard.writeText(promptText.value);
      showStatus(copyStatus, 'Copied to clipboard!', 'success');
      setTimeout(() => hideStatus(copyStatus), 3000);
    } catch (e) {
      showStatus(copyStatus, 'Failed to copy', 'error');
    }
  });

  // Grammar filter
  grammarFilter?.addEventListener('input', () => {
    renderGrammarList(grammarFilter.value.toLowerCase());
  });

  // Level section toggle handlers
  document.querySelectorAll('.grammar-level-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking the "Mark all known" button
      if ((e.target as HTMLElement).classList.contains('mark-all-known-btn')) return;

      const section = header.closest('.grammar-level-section');
      const items = section?.querySelector('.grammar-level-items') as HTMLElement;
      const label = header.querySelector('span');

      if (items && label) {
        const isCollapsed = items.style.display === 'none';
        items.style.display = isCollapsed ? 'block' : 'none';
        label.textContent = label.textContent?.replace(isCollapsed ? '▶' : '▼', isCollapsed ? '▼' : '▶') || '';
      }
    });
  });

  // Mark all known button handlers
  document.querySelectorAll('.mark-all-known-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const section = (btn as HTMLElement).closest('.grammar-level-section');
      const level = section?.getAttribute('data-level');
      if (!level) return;

      const levelGrammar = allGrammarPoints.filter(gp => gp.level === level);
      const allKnown = levelGrammar.every(gp => knownGrammarIds.includes(gp.id));

      if (allKnown) {
        // Unmark all as known
        knownGrammarIds = knownGrammarIds.filter(id => !levelGrammar.some(gp => gp.id === id));
      } else {
        // Mark all as known
        for (const gp of levelGrammar) {
          if (!knownGrammarIds.includes(gp.id)) {
            knownGrammarIds.push(gp.id);
          }
        }
      }

      await chrome.runtime.sendMessage({ type: 'setKnownGrammar', grammarIds: knownGrammarIds });
      renderGrammarList(grammarFilter?.value?.toLowerCase() || '');
    });
  });

  function renderGrammarList(filter = '') {
    const levels = ['basic', 'intermediate', 'advanced'] as const;
    const statsEl = document.getElementById('grammar-stats');

    let totalSelected = selectedGrammarIds.length;
    let totalKnown = knownGrammarIds.length;

    for (const level of levels) {
      const section = document.querySelector(`.grammar-level-section[data-level="${level}"]`);
      const itemsContainer = section?.querySelector('.grammar-level-items');
      const countEl = section?.querySelector('.level-count');

      if (!itemsContainer) continue;

      const levelGrammar = allGrammarPoints.filter(gp => gp.level === level);
      const filtered = filter
        ? levelGrammar.filter(gp =>
            gp.pattern.toLowerCase().includes(filter) ||
            gp.meaning.toLowerCase().includes(filter) ||
            gp.id.toLowerCase().includes(filter)
          )
        : levelGrammar;

      if (countEl) {
        countEl.textContent = `(${filtered.length})`;
      }

      itemsContainer.innerHTML = filtered.map(gp => {
        const isSelected = selectedGrammarIds.includes(gp.id);
        const isKnown = knownGrammarIds.includes(gp.id);
        const hasUrl = !!gp.sourceUrl;

        return `
          <div class="grammar-item" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.8rem; border-bottom: 1px solid var(--pico-muted-border-color);">
            <input type="checkbox" class="grammar-select-cb" data-grammar-id="${gp.id}"
                   ${isSelected ? 'checked' : ''} style="margin: 0; width: 1rem; height: 1rem;" title="Include in prompt">
            <button class="grammar-known-btn" data-grammar-id="${gp.id}"
                    style="padding: 0.1rem 0.3rem; font-size: 0.65rem; margin: 0; min-width: 1.5rem;
                           ${isKnown ? 'background: #22c55e; border-color: #22c55e; color: white;' : 'background: transparent; border: 1px dashed var(--pico-muted-border-color); color: var(--pico-muted-color);'}"
                    title="${isKnown ? 'Marked as known' : 'Mark as known'}">K</button>
            <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              <strong>${escapeHtml(gp.pattern)}</strong>
              <span style="color: var(--pico-muted-color);">- ${escapeHtml(gp.meaning.substring(0, 50))}</span>
            </span>
            ${hasUrl ? `<a href="${gp.sourceUrl}" target="_blank" rel="noopener noreferrer" class="grammar-link-btn"
                          style="padding: 0.1rem 0.3rem; font-size: 0.7rem; text-decoration: none; color: var(--pico-primary);"
                          title="View on DoJG">DoJG</a>` : ''}
          </div>
        `;
      }).join('');

      // Add event handlers
      itemsContainer.querySelectorAll('.grammar-select-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = (cb as HTMLInputElement).getAttribute('data-grammar-id')!;
          if ((cb as HTMLInputElement).checked) {
            if (!selectedGrammarIds.includes(id)) selectedGrammarIds.push(id);
          } else {
            const idx = selectedGrammarIds.indexOf(id);
            if (idx >= 0) selectedGrammarIds.splice(idx, 1);
          }
          updateSelectedGrammarDisplay();
          updateGrammarStats();
        });
      });

      itemsContainer.querySelectorAll('.grammar-known-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).getAttribute('data-grammar-id')!;
          const isKnown = knownGrammarIds.includes(id);

          if (isKnown) {
            knownGrammarIds = knownGrammarIds.filter(gid => gid !== id);
          } else {
            knownGrammarIds.push(id);
          }

          await chrome.runtime.sendMessage({
            type: 'toggleKnownGrammar',
            grammarId: id,
            known: !isKnown
          });

          // Update button style
          const btnEl = btn as HTMLElement;
          if (!isKnown) {
            btnEl.style.background = '#22c55e';
            btnEl.style.borderColor = '#22c55e';
            btnEl.style.color = 'white';
            btnEl.title = 'Marked as known';
          } else {
            btnEl.style.background = 'transparent';
            btnEl.style.borderColor = 'var(--pico-muted-border-color)';
            btnEl.style.borderStyle = 'dashed';
            btnEl.style.color = 'var(--pico-muted-color)';
            btnEl.title = 'Mark as known';
          }

          updateGrammarStats();
        });
      });
    }

    updateGrammarStats();
    updateSelectedGrammarDisplay();
  }

  function updateGrammarStats() {
    const statsEl = document.getElementById('grammar-stats');
    if (statsEl) {
      statsEl.textContent = `${selectedGrammarIds.length} selected | ${knownGrammarIds.length} known | ${allGrammarPoints.length} total`;
    }
  }

  function updateSelectedGrammarDisplay() {
    if (!selectedGrammarContainer) return;

    if (selectedGrammarIds.length === 0) {
      selectedGrammarContainer.innerHTML = '<span style="color: var(--pico-muted-color); font-size: 0.75rem;">No grammar manually selected</span>';
      return;
    }

    selectedGrammarContainer.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; gap: 0.35rem;">
        ${selectedGrammarIds.map(id => {
          const gp = allGrammarPoints.find(g => g.id === id);
          return `
            <span style="display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.5rem; background: var(--pico-primary-background); border-radius: 4px; font-size: 0.75rem;">
              ${escapeHtml(gp?.pattern || id)}
              <button type="button" data-remove-id="${id}" style="border: none; background: none; cursor: pointer; padding: 0; font-size: 0.9rem; line-height: 1;">&times;</button>
            </span>
          `;
        }).join('')}
      </div>
    `;

    // Add remove handlers
    selectedGrammarContainer.querySelectorAll('[data-remove-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).getAttribute('data-remove-id')!;
        const index = selectedGrammarIds.indexOf(id);
        if (index >= 0) {
          selectedGrammarIds.splice(index, 1);
          // Also uncheck the checkbox
          const cb = document.querySelector(`.grammar-select-cb[data-grammar-id="${id}"]`) as HTMLInputElement;
          if (cb) cb.checked = false;
          updateSelectedGrammarDisplay();
          updateGrammarStats();
        }
      });
    });
  }
}

// ============================================
// TEMPLATE MANAGEMENT
// ============================================

async function loadTemplates() {
  const result = await chrome.runtime.sendMessage({ type: 'getPromptTemplates' });
  if (result && result.templates) {
    promptTemplates = result.templates;
    activeTemplateId = result.activeTemplateId;
    renderTemplateSelect();
  }
}

function renderTemplateSelect() {
  const select = document.getElementById('template-select') as HTMLSelectElement;
  if (!select) return;

  select.innerHTML = promptTemplates.map(t =>
    `<option value="${t.id}" ${t.id === activeTemplateId ? 'selected' : ''}>${escapeHtml(t.name)}${t.isDefault ? ' (default)' : ''}</option>`
  ).join('');

  // Update delete button state
  const deleteBtn = document.getElementById('delete-template-btn') as HTMLButtonElement;
  const activeTemplate = promptTemplates.find(t => t.id === activeTemplateId);
  if (deleteBtn) {
    deleteBtn.disabled = activeTemplate?.isDefault || false;
  }
}

function initTemplateUI() {
  const select = document.getElementById('template-select') as HTMLSelectElement;
  const editBtn = document.getElementById('edit-template-btn');
  const newBtn = document.getElementById('new-template-btn');
  const deleteBtn = document.getElementById('delete-template-btn');
  const modal = document.getElementById('template-editor-modal') as HTMLDialogElement;
  const cancelBtn = document.getElementById('cancel-template-btn');
  const saveBtn = document.getElementById('save-template-btn');
  const templateName = document.getElementById('template-name') as HTMLInputElement;
  const templateContent = document.getElementById('template-content') as HTMLTextAreaElement;

  // Template select change
  select?.addEventListener('change', async () => {
    activeTemplateId = select.value;
    await chrome.runtime.sendMessage({ type: 'setActiveTemplate', templateId: activeTemplateId });
    renderTemplateSelect();
  });

  // Edit button
  editBtn?.addEventListener('click', () => {
    const template = promptTemplates.find(t => t.id === activeTemplateId);
    if (template) {
      editingTemplateId = template.id;
      templateName.value = template.name;
      templateContent.value = template.template;
      templateName.disabled = template.isDefault || false;
      (document.getElementById('template-modal-title') as HTMLElement).textContent = 'Edit Template';
      modal?.showModal();
    }
  });

  // New button
  newBtn?.addEventListener('click', () => {
    editingTemplateId = null;
    templateName.value = '';
    templateContent.value = '';
    templateName.disabled = false;
    (document.getElementById('template-modal-title') as HTMLElement).textContent = 'New Template';
    modal?.showModal();
  });

  // Delete button
  deleteBtn?.addEventListener('click', async () => {
    const template = promptTemplates.find(t => t.id === activeTemplateId);
    if (template && !template.isDefault) {
      if (confirm(`Delete template "${template.name}"?`)) {
        await chrome.runtime.sendMessage({ type: 'deletePromptTemplate', templateId: template.id });
        await loadTemplates();
      }
    }
  });

  // Cancel button
  cancelBtn?.addEventListener('click', () => {
    modal?.close();
  });

  // Save button
  saveBtn?.addEventListener('click', async () => {
    const name = templateName.value.trim();
    const template = templateContent.value;

    if (!name) {
      alert('Please enter a template name');
      return;
    }

    const templateData: PromptTemplate = {
      id: editingTemplateId || crypto.randomUUID(),
      name,
      template,
      isDefault: editingTemplateId ? promptTemplates.find(t => t.id === editingTemplateId)?.isDefault : false,
      createdAt: editingTemplateId ? promptTemplates.find(t => t.id === editingTemplateId)?.createdAt || Date.now() : Date.now(),
      updatedAt: Date.now(),
    };

    await chrome.runtime.sendMessage({ type: 'savePromptTemplate', template: templateData });
    await loadTemplates();

    // If new template, set it as active
    if (!editingTemplateId) {
      activeTemplateId = templateData.id;
      await chrome.runtime.sendMessage({ type: 'setActiveTemplate', templateId: activeTemplateId });
      renderTemplateSelect();
    }

    modal?.close();
  });

  // Variable buttons
  document.querySelectorAll('.template-var-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const varName = (btn as HTMLElement).getAttribute('data-var');
      if (varName && templateContent) {
        const start = templateContent.selectionStart;
        const end = templateContent.selectionEnd;
        const text = templateContent.value;
        templateContent.value = text.substring(0, start) + varName + text.substring(end);
        templateContent.selectionStart = templateContent.selectionEnd = start + varName.length;
        templateContent.focus();
      }
    });
  });

  // Close modal on outside click
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.close();
    }
  });
}

async function generateStoryPrompt() {
  const generateBtn = document.getElementById('generate-prompt-btn') as HTMLButtonElement;
  const promptOutput = document.getElementById('prompt-output')!;
  const promptText = document.getElementById('prompt-text') as HTMLTextAreaElement;
  const promptStats = document.getElementById('prompt-stats')!;

  // Get config from UI
  const config = {
    includeRecentlyWrong: (document.getElementById('include-recently-wrong') as HTMLInputElement)?.checked ?? true,
    recentlyWrongDays: parseInt((document.getElementById('recently-wrong-days') as HTMLSelectElement)?.value ?? '1'),
    includeLapsedWords: (document.getElementById('include-lapsed') as HTMLInputElement).checked,
    lapsedMinLapses: parseInt((document.getElementById('min-lapses') as HTMLSelectElement).value),
    lapsedRecencyDays: parseInt((document.getElementById('lapsed-recency') as HTMLSelectElement).value),
    includeUnknownWords: (document.getElementById('include-unknown') as HTMLInputElement).checked,
    unknownMinEncounters: parseInt((document.getElementById('min-encounters') as HTMLSelectElement).value),
    includeAutoDetected: (document.getElementById('auto-detect-grammar') as HTMLInputElement).checked,
    excludeKnownGrammar: (document.getElementById('exclude-known-grammar') as HTMLInputElement)?.checked ?? true,
    grammarTimeRangeDays: 30,
    manualGrammarIds: selectedGrammarIds,
    grammarLevelFilter: [
      ...((document.getElementById('level-basic') as HTMLInputElement).checked ? ['basic' as const] : []),
      ...((document.getElementById('level-intermediate') as HTMLInputElement).checked ? ['intermediate' as const] : []),
      ...((document.getElementById('level-advanced') as HTMLInputElement).checked ? ['advanced' as const] : []),
    ],
    wordCount: parseInt((document.getElementById('word-count') as HTMLSelectElement).value),
    grammarCount: parseInt((document.getElementById('grammar-count') as HTMLSelectElement).value),
    storyStyle: (document.getElementById('story-style') as HTMLSelectElement).value as 'slice-of-life' | 'adventure' | 'mystery' | 'casual-conversation',
    difficultyHint: (document.getElementById('difficulty-hint') as HTMLSelectElement).value as 'easy' | 'natural' | 'challenging',
  };

  // Disable button while generating
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';

  try {
    console.log('[Seer] Sending generateStoryPrompt message with config:', config);
    const result = await chrome.runtime.sendMessage({
      type: 'generateStoryPrompt',
      config
    });
    console.log('[Seer] Received result:', result);

    if (result && result.prompt) {
      promptText.value = result.prompt;
      promptStats.textContent = `${result.wordCount} words | ${result.grammarCount} grammar points`;
      promptOutput.classList.remove('hidden');
    } else {
      console.log('generateStoryPrompt result:', result);
      promptText.value = result
        ? `Unexpected result format: ${JSON.stringify(result, null, 2)}`
        : 'No response from background script. Check that the extension is properly loaded.';
      promptStats.textContent = '';
      promptOutput.classList.remove('hidden');
    }
  } catch (e) {
    console.error('Generate prompt error:', e);
    promptText.value = `Error: ${e instanceof Error ? e.message : String(e)}`;
    promptStats.textContent = '';
    promptOutput.classList.remove('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Story Prompt';
  }
}

// Initialize
initializeTheme();  // Apply theme immediately
initTopTabs();
loadSettings();
initDedupSettings();
initBackupSection();
initStoryPromptsTab();
