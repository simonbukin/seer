/**
 * Seer Dashboard Bridge Content Script
 *
 * This content script runs on the Seer dashboard page (localhost:5173 in dev, seer.dev in prod)
 * and bridges postMessage communication between the dashboard and the extension.
 *
 * The bridge enables:
 * - Dashboard to request data from the extension (vocab, encounters, i+1 sentences, etc.)
 * - Dashboard to perform actions (mark known, ignore words)
 * - Other extensions like Yomitan to work on the dashboard page (not sandboxed)
 */

const DASHBOARD_SOURCE = 'seer-dashboard';
const EXTENSION_SOURCE = 'seer-extension';

// Log with prefix for debugging
function log(...args: unknown[]) {
  console.log('[Seer Bridge]', ...args);
}

// Signal that extension is ready
function signalReady() {
  window.postMessage({
    source: EXTENSION_SOURCE,
    type: 'ready',
    version: chrome.runtime.getManifest().version,
  }, '*');
  log('Extension ready, version:', chrome.runtime.getManifest().version);
}

// Handle messages from the dashboard page
async function handleDashboardMessage(event: MessageEvent) {
  // Only accept messages from this window
  if (event.source !== window) return;

  // Only accept messages from the dashboard
  const data = event.data;
  if (!data || data.source !== DASHBOARD_SOURCE) return;

  const { type, payload, requestId } = data;

  if (!type || !requestId) {
    log('Invalid message format:', data);
    return;
  }

  log('Received request:', type, requestId);

  try {
    // Forward the message to the service worker
    const response = await chrome.runtime.sendMessage({
      type,
      ...payload,
    });

    // Debug: log response structure for troubleshooting
    if (type === 'getEncounterStats') {
      log('getEncounterStats response:', response, 'has total:', 'total' in (response ?? {}));
    }

    // Send response back to the dashboard
    window.postMessage({
      source: EXTENSION_SOURCE,
      requestId,
      response,
    }, '*');

    log('Sent response for:', type, requestId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('Error handling request:', type, errorMessage);

    // Send error back to the dashboard
    window.postMessage({
      source: EXTENSION_SOURCE,
      requestId,
      error: errorMessage,
    }, '*');
  }
}

// Initialize the bridge
function init() {
  // Listen for messages from the dashboard
  window.addEventListener('message', handleDashboardMessage);

  // Signal that we're ready
  // Small delay to ensure the page has loaded the listener
  setTimeout(signalReady, 100);

  // Re-signal on visibility change (in case dashboard was loaded before extension)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      signalReady();
    }
  });

  log('Bridge initialized');
}

init();
