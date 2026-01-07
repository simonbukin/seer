import type { ThemeMode } from './types';

/**
 * Resolves the effective theme ('light' or 'dark') based on the theme mode setting.
 * 'auto' will use the system preference via matchMedia.
 */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

/**
 * Applies the theme to the document by setting the data-theme attribute.
 */
export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.setAttribute('data-theme', resolved);
}

/**
 * Initializes the theme from config and sets up listeners for:
 * 1. System preference changes (when mode is 'auto')
 * 2. Storage changes (when settings are updated from another page)
 */
export async function initializeTheme(): Promise<void> {
  // Load initial theme from config
  const result = await chrome.storage.local.get('seer-config');
  const config = result['seer-config'] || {};
  const mode: ThemeMode = config.theme || 'auto';

  applyTheme(mode);

  // Listen for system preference changes (for 'auto' mode)
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const currentConfig = await chrome.storage.local.get('seer-config');
    const currentMode: ThemeMode = currentConfig['seer-config']?.theme || 'auto';
    if (currentMode === 'auto') {
      applyTheme('auto');
    }
  });

  // Listen for config changes from other pages/tabs
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['seer-config']) {
      const newConfig = changes['seer-config'].newValue || {};
      const newMode: ThemeMode = newConfig.theme || 'auto';
      applyTheme(newMode);
    }
  });
}
