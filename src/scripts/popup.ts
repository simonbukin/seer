import {
  RefreshMessage,
  RefreshResponse,
  ToggleHighlightsMessage,
  ToggleHighlightsResponse,
  GetHighlightStateMessage,
  GetHighlightStateResponse,
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
  updateToggleUI(currentState);

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

  // Refresh button handler
  const refreshButton = document.getElementById("refreshButton")!;
  refreshButton.addEventListener("click", refreshDeckData);

  // Options button handler
  const optionsButton = document.getElementById("optionsButton")!;
  optionsButton.addEventListener("click", openOptionsPage);
});
