import {
  RefreshMessage,
  RefreshResponse,
  ToggleHighlightsMessage,
  ToggleHighlightsResponse,
  GetHighlightStateMessage,
  GetHighlightStateResponse,
  ToggleI1SentenceModeMessage,
  ToggleI1SentenceModeResponse,
  GetI1SentenceModeMessage,
  GetI1SentenceModeResponse,
} from "./types";

function showStatus(
  message: string,
  type: "success" | "error" | "info" = "success"
): void {
  const status = document.getElementById("status")!;
  status.textContent = message;
  status.className = `status ${type}`;
  status.style.display = "block";

  setTimeout(() => {
    status.style.display = "none";
  }, 3000);
}

function setLoading(loading: boolean): void {
  const body = document.body;
  if (loading) {
    body.classList.add("loading");
  } else {
    body.classList.remove("loading");
  }
}

function updateToggleUI(enabled: boolean): void {
  const toggle = document.getElementById("highlightToggle")!;
  if (enabled) {
    toggle.classList.add("active");
  } else {
    toggle.classList.remove("active");
  }
}

function updateI1SentenceToggleUI(enabled: boolean): void {
  const toggle = document.getElementById("i1SentenceToggle")!;
  if (enabled) {
    toggle.classList.add("active");
  } else {
    toggle.classList.remove("active");
  }
}

function updatePreserveTextColorToggleUI(enabled: boolean): void {
  const toggle = document.getElementById("preserveTextColorToggle")!;
  if (enabled) {
    toggle.classList.add("active");
  } else {
    toggle.classList.remove("active");
  }
}

async function getCurrentHighlightState(): Promise<boolean> {
  return new Promise((resolve) => {
    const message: GetHighlightStateMessage = { type: "GET_HIGHLIGHT_STATE" };

    chrome.runtime.sendMessage(
      message,
      (response: GetHighlightStateResponse) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error getting highlight state:",
            chrome.runtime.lastError
          );
          resolve(true); // Default to enabled
          return;
        }
        resolve(response?.enabled ?? true);
      }
    );
  });
}

async function getCurrentI1SentenceMode(): Promise<boolean> {
  return new Promise((resolve) => {
    const message: GetI1SentenceModeMessage = { type: "GET_I1_SENTENCE_MODE" };

    chrome.runtime.sendMessage(
      message,
      (response: GetI1SentenceModeResponse) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error getting i+1 sentence mode state:",
            chrome.runtime.lastError
          );
          resolve(false); // Default to disabled
          return;
        }
        resolve(response?.enabled ?? false);
      }
    );
  });
}

async function getCurrentPreserveTextColorState(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ preserveTextColor: false }, (result) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Error getting preserve text color state:",
          chrome.runtime.lastError
        );
        resolve(false); // Default to disabled
        return;
      }
      resolve(result.preserveTextColor);
    });
  });
}

async function setPreserveTextColorState(enabled: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ preserveTextColor: enabled }, () => {
      if (chrome.runtime.lastError) {
        console.error(
          "Error setting preserve text color state:",
          chrome.runtime.lastError
        );
        showStatus("Failed to update preserve text color setting", "error");
        resolve(false);
        return;
      }

      const statusMessage = enabled
        ? "Preserve text color enabled"
        : "Preserve text color disabled";
      showStatus(statusMessage, "success");

      // Send message to content scripts to reload settings
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "RELOAD_SETTINGS" });
        }
      });

      resolve(true);
    });
  });
}

async function toggleHighlights(enabled: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const message: ToggleHighlightsMessage = {
      type: "TOGGLE_HIGHLIGHTS",
      enabled,
    };

    chrome.runtime.sendMessage(
      message,
      (response: ToggleHighlightsResponse) => {
        if (chrome.runtime.lastError) {
          console.error("Error toggling highlights:", chrome.runtime.lastError);
          showStatus("Failed to toggle highlights", "error");
          resolve(false);
          return;
        }

        if (response?.ok) {
          const statusMessage = enabled
            ? "Highlights enabled"
            : "Highlights disabled";
          showStatus(statusMessage, "success");
          resolve(true);
        } else {
          showStatus("Failed to toggle highlights", "error");
          resolve(false);
        }
      }
    );
  });
}

async function toggleI1SentenceMode(enabled: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const message: ToggleI1SentenceModeMessage = {
      type: "TOGGLE_I1_SENTENCE_MODE",
      enabled,
    };

    chrome.runtime.sendMessage(
      message,
      (response: ToggleI1SentenceModeResponse) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error toggling i+1 sentence mode:",
            chrome.runtime.lastError
          );
          showStatus("Failed to toggle i+1 sentence mode", "error");
          resolve(false);
          return;
        }

        if (response?.ok) {
          const statusMessage = enabled
            ? "i+1 Sentence Mode enabled"
            : "i+1 Sentence Mode disabled";
          showStatus(statusMessage, "success");
          resolve(true);
        } else {
          showStatus("Failed to toggle i+1 sentence mode", "error");
          resolve(false);
        }
      }
    );
  });
}

async function refreshDeckData(): Promise<void> {
  setLoading(true);

  const message: RefreshMessage = { type: "REFRESH" };

  chrome.runtime.sendMessage(message, (response: RefreshResponse) => {
    setLoading(false);

    if (chrome.runtime.lastError) {
      showStatus("Error: " + chrome.runtime.lastError.message, "error");
      return;
    }

    if (response?.ok) {
      showStatus("Deck data refreshed successfully", "success");
    } else {
      showStatus("Failed to refresh deck data", "error");
    }
  });
}

function openOptionsPage(): void {
  chrome.runtime.openOptionsPage();
  window.close(); // Close popup after opening options
}

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize UI with current state
  const currentState = await getCurrentHighlightState();
  const currentI1State = await getCurrentI1SentenceMode();
  const currentPreserveTextColorState =
    await getCurrentPreserveTextColorState();
  updateToggleUI(currentState);
  updateI1SentenceToggleUI(currentI1State);
  updatePreserveTextColorToggleUI(currentPreserveTextColorState);

  // Toggle highlights handler
  const highlightToggle = document.getElementById("highlightToggle")!;
  highlightToggle.addEventListener("click", async () => {
    const currentEnabled = highlightToggle.classList.contains("active");
    const newEnabled = !currentEnabled;

    // Optimistically update UI
    updateToggleUI(newEnabled);

    // Send toggle message
    const success = await toggleHighlights(newEnabled);

    // Revert UI if failed
    if (!success) {
      updateToggleUI(currentEnabled);
    }
  });

  // Toggle i+1 sentence mode handler
  const i1SentenceToggle = document.getElementById("i1SentenceToggle")!;
  i1SentenceToggle.addEventListener("click", async () => {
    const currentEnabled = i1SentenceToggle.classList.contains("active");
    const newEnabled = !currentEnabled;

    // Optimistically update UI
    updateI1SentenceToggleUI(newEnabled);

    // Send toggle message
    const success = await toggleI1SentenceMode(newEnabled);

    // Revert UI if failed
    if (!success) {
      updateI1SentenceToggleUI(currentEnabled);
    }
  });

  // Toggle preserve text color handler
  const preserveTextColorToggle = document.getElementById(
    "preserveTextColorToggle"
  )!;
  preserveTextColorToggle.addEventListener("click", async () => {
    const currentEnabled = preserveTextColorToggle.classList.contains("active");
    const newEnabled = !currentEnabled;

    // Optimistically update UI
    updatePreserveTextColorToggleUI(newEnabled);

    // Send toggle message
    const success = await setPreserveTextColorState(newEnabled);

    // Revert UI if failed
    if (!success) {
      updatePreserveTextColorToggleUI(currentEnabled);
    }
  });

  // Refresh button handler
  const refreshButton = document.getElementById("refreshButton")!;
  refreshButton.addEventListener("click", refreshDeckData);

  // Options button handler
  const optionsButton = document.getElementById("optionsButton")!;
  optionsButton.addEventListener("click", openOptionsPage);
});
