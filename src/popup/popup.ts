import type { HighlightConfig, SeerConfig, LayerCategory, VocabDataSerialized } from '../shared/types';
import { getRequiredElement } from '../shared/utils';
import { initializeTheme } from '../shared/theme';

// Layer IDs by category (for mode switching)
const LAYER_CATEGORIES: Record<LayerCategory, string[]> = {
  frequency: ['freq-very-common', 'freq-common', 'freq-medium', 'freq-uncommon', 'freq-rare'],
  status: ['status-unknown', 'status-known', 'status-ignored'],
  knowledge: ['knowledge-new', 'knowledge-learning', 'knowledge-young', 'knowledge-mature'],
  pos: [],  // Not used yet
};

// Mode chip IDs mapped to categories
const MODE_TO_CATEGORY: Record<string, LayerCategory> = {
  'mode-freq': 'frequency',
  'mode-status': 'status',
  'mode-knowledge': 'knowledge',
};

// Get DOM elements
const masterToggle = getRequiredElement<HTMLInputElement>('master-toggle');
const statusDot = getRequiredElement<HTMLSpanElement>('status-dot');
const syncStatus = getRequiredElement<HTMLSpanElement>('sync-status');
const modeChips = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
const mokuroModeCheckbox = getRequiredElement<HTMLInputElement>('mokuro-mode');
const sidepanelBtn = getRequiredElement<HTMLButtonElement>('sidepanel-btn');
const optionsBtn = getRequiredElement<HTMLButtonElement>('options-btn');
const syncLink = getRequiredElement<HTMLAnchorElement>('sync-link');
const syncLinkText = getRequiredElement<HTMLSpanElement>('sync-link-text');
const shortcutsLink = getRequiredElement<HTMLAnchorElement>('shortcuts-link');
const advancedToggle = getRequiredElement<HTMLDivElement>('advanced-toggle');
const advancedContent = getRequiredElement<HTMLDivElement>('advanced-content');
const ignoreSectionEl = getRequiredElement<HTMLDivElement>('ignore-section');
const ignoreDomainBtn = getRequiredElement<HTMLButtonElement>('ignore-domain-btn');
const ignorePageBtn = getRequiredElement<HTMLButtonElement>('ignore-page-btn');
const ignoredNoticeEl = getRequiredElement<HTMLDivElement>('ignored-notice');
const ignoreReasonEl = getRequiredElement<HTMLSpanElement>('ignore-reason');
const unignoreBtn = getRequiredElement<HTMLButtonElement>('unignore-btn');

let currentTabUrl: string | null = null;
let currentIgnoreState: { ignored: boolean; reason?: 'domain' | 'url' } | null = null;

// Format relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// Load sync status
async function loadSyncStatus() {
  try {
    const vocab = await chrome.runtime.sendMessage({ type: 'getVocabulary' }) as VocabDataSerialized;
    if (vocab && vocab.lastSync > 0) {
      syncStatus.textContent = `Synced ${formatRelativeTime(vocab.lastSync)} (${vocab.totalCards} cards)`;
      statusDot.classList.remove('offline');
    } else {
      syncStatus.textContent = 'Not synced yet';
      statusDot.classList.add('offline');
    }
  } catch {
    syncStatus.textContent = 'Unable to connect';
    statusDot.classList.add('offline');
  }
}

// Master toggle: show/hide all highlights
async function loadMasterToggle() {
  const config = await chrome.runtime.sendMessage({ type: 'getConfig' }) as SeerConfig;
  const visible = config.highlightsVisible !== false;  // Default to true
  masterToggle.checked = visible;
}

masterToggle.addEventListener('change', async () => {
  const visible = masterToggle.checked;

  // Save to config
  await chrome.runtime.sendMessage({
    type: 'setConfig',
    config: { highlightsVisible: visible }
  });

  // Notify content scripts
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'setHighlightingEnabled', enabled: visible });
    } catch {
      // Content script may not be loaded
    }
  }
});

// Mode chips: switch between frequency/status/knowledge
async function loadActiveMode() {
  const config = await chrome.runtime.sendMessage({ type: 'getHighlightConfig' }) as HighlightConfig;

  // Determine which category has enabled layers
  let activeMode: LayerCategory | null = null;
  for (const [category, layerIds] of Object.entries(LAYER_CATEGORIES)) {
    if (category === 'pos') continue;  // Skip unused category
    const hasEnabled = layerIds.some(id => config.layers[id]?.enabled);
    if (hasEnabled) {
      activeMode = category as LayerCategory;
      break;
    }
  }

  // Update chip UI
  modeChips.forEach(chip => {
    const chipCategory = MODE_TO_CATEGORY[chip.id];
    chip.classList.toggle('active', chipCategory === activeMode);
  });
}

async function setMode(category: LayerCategory) {
  // Enable all layers in this category, disable all others
  const updates: Array<{ layerId: string; enabled: boolean }> = [];

  for (const [cat, layerIds] of Object.entries(LAYER_CATEGORIES)) {
    if (cat === 'pos') continue;
    const shouldEnable = cat === category;
    for (const layerId of layerIds) {
      updates.push({ layerId, enabled: shouldEnable });
    }
  }

  // Send all updates
  for (const { layerId, enabled } of updates) {
    await chrome.runtime.sendMessage({ type: 'toggleLayer', layerId, enabled });
  }

  // Update UI
  modeChips.forEach(chip => {
    const chipCategory = MODE_TO_CATEGORY[chip.id];
    chip.classList.toggle('active', chipCategory === category);
  });
}

modeChips.forEach(chip => {
  chip.addEventListener('click', () => {
    const category = MODE_TO_CATEGORY[chip.id];
    if (category) {
      setMode(category);
    }
  });
});

// Mokuro mode toggle
async function loadMokuroMode() {
  const config = await chrome.runtime.sendMessage({ type: 'getConfig' }) as SeerConfig;
  mokuroModeCheckbox.checked = config.mokuroMode || false;
}

mokuroModeCheckbox.addEventListener('change', async () => {
  const enabled = mokuroModeCheckbox.checked;

  // Save to config
  await chrome.runtime.sendMessage({
    type: 'setConfig',
    config: { mokuroMode: enabled }
  });

  // Send message to content script to trigger rescan
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'setMokuroMode', enabled });
    } catch {
      // Content script may not be loaded
    }
  }
});

// Sync link
syncLink.addEventListener('click', async (e) => {
  e.preventDefault();
  syncLinkText.textContent = 'Syncing...';

  try {
    await chrome.runtime.sendMessage({ type: 'syncVocabulary' });
    syncLinkText.textContent = 'Synced!';
    await loadSyncStatus();
    setTimeout(() => {
      syncLinkText.textContent = 'Sync';
    }, 1500);
  } catch {
    syncLinkText.textContent = 'Error';
    setTimeout(() => {
      syncLinkText.textContent = 'Sync';
    }, 1500);
  }
});

// Options button
optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Side panel button
sidepanelBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();  // Close popup after opening side panel
  }
});

// Shortcuts link
shortcutsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Advanced options toggle
advancedToggle.addEventListener('click', () => {
  advancedToggle.classList.toggle('open');
  advancedContent.classList.toggle('open');
});

// Ignore functionality
async function checkIgnoreState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url) return;

  currentTabUrl = tab.url;
  currentIgnoreState = await chrome.runtime.sendMessage({
    type: 'isPageIgnored',
    url: tab.url
  }) as { ignored: boolean; reason?: 'domain' | 'url' };

  updateIgnoreUI();
}

function updateIgnoreUI() {
  if (!currentIgnoreState) return;

  if (currentIgnoreState.ignored) {
    ignoreSectionEl.style.display = 'none';
    ignoredNoticeEl.style.display = 'block';
    ignoreReasonEl.textContent = currentIgnoreState.reason === 'domain' ? 'domain' : 'page';
  } else {
    ignoreSectionEl.style.display = 'flex';
    ignoredNoticeEl.style.display = 'none';
  }
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

ignoreDomainBtn.addEventListener('click', async () => {
  if (!currentTabUrl) return;

  const domain = getDomainFromUrl(currentTabUrl);
  if (!domain) return;

  ignoreDomainBtn.textContent = 'Ignoring...';
  ignoreDomainBtn.setAttribute('disabled', 'true');

  await chrome.runtime.sendMessage({
    type: 'addToIgnoreList',
    ignoreType: 'domain',
    value: domain
  });

  currentIgnoreState = { ignored: true, reason: 'domain' };
  updateIgnoreUI();
});

ignorePageBtn.addEventListener('click', async () => {
  if (!currentTabUrl) return;

  ignorePageBtn.textContent = 'Ignoring...';
  ignorePageBtn.setAttribute('disabled', 'true');

  await chrome.runtime.sendMessage({
    type: 'addToIgnoreList',
    ignoreType: 'url',
    value: currentTabUrl
  });

  currentIgnoreState = { ignored: true, reason: 'url' };
  updateIgnoreUI();
});

unignoreBtn.addEventListener('click', async () => {
  if (!currentTabUrl || !currentIgnoreState) return;

  unignoreBtn.textContent = 'Removing...';
  unignoreBtn.setAttribute('disabled', 'true');

  const ignoreType = currentIgnoreState.reason === 'domain' ? 'domain' : 'url';
  const value = ignoreType === 'domain' ? getDomainFromUrl(currentTabUrl) : currentTabUrl;

  await chrome.runtime.sendMessage({
    type: 'removeFromIgnoreList',
    ignoreType,
    value
  });

  currentIgnoreState = { ignored: false };
  updateIgnoreUI();

  // Reset button state
  unignoreBtn.textContent = 'Stop Ignoring';
  unignoreBtn.removeAttribute('disabled');
  ignoreDomainBtn.textContent = 'Ignore domain';
  ignoreDomainBtn.removeAttribute('disabled');
  ignorePageBtn.textContent = 'Ignore page';
  ignorePageBtn.removeAttribute('disabled');
});

// Initialize
initializeTheme();
loadMasterToggle();
loadSyncStatus();
loadActiveMode();
loadMokuroMode();
checkIgnoreState();
