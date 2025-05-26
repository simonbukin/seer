// Debug utility for conditional logging
// This module provides debug logging that can be enabled/disabled via settings

interface DebugSettings {
  debugMode: boolean;
}

let debugEnabled = false;

// Initialize debug mode from storage
export async function initializeDebugMode(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get({ debugMode: false });
    debugEnabled = result.debugMode;
  } catch (error) {
    // Fallback to enabled if we can't read settings
    debugEnabled = false;
  }
}

// Update debug mode (called when settings change)
export function setDebugMode(enabled: boolean): void {
  debugEnabled = enabled;
}

// Get current debug mode status
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

// Debug logging functions that respect the debug mode setting
export const debug = {
  log: (...args: any[]) => {
    if (debugEnabled) {
      console.log(...args);
    }
  },

  warn: (...args: any[]) => {
    if (debugEnabled) {
      console.warn(...args);
    }
  },

  error: (...args: any[]) => {
    // Always show errors regardless of debug mode
    console.error(...args);
  },

  info: (...args: any[]) => {
    if (debugEnabled) {
      console.info(...args);
    }
  },

  // Special function for verbose/spammy logs
  verbose: (...args: any[]) => {
    if (debugEnabled) {
      console.log("[VERBOSE]", ...args);
    }
  },

  // Group logging for better organization
  group: (label: string) => {
    if (debugEnabled) {
      console.group(label);
    }
  },

  groupEnd: () => {
    if (debugEnabled) {
      console.groupEnd();
    }
  },

  // Time logging for performance debugging
  time: (label: string) => {
    if (debugEnabled) {
      console.time(label);
    }
  },

  timeEnd: (label: string) => {
    if (debugEnabled) {
      console.timeEnd(label);
    }
  },
};

// Initialize debug mode when the module loads
initializeDebugMode();
