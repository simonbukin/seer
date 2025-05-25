import { RefreshMessage, RefreshResponse } from "./types";

function showStatus(message: string, isError = false): void {
  const status = document.getElementById("status")!;
  status.textContent = message;
  status.className = `status ${isError ? "error" : "success"}`;
  status.style.display = "block";

  setTimeout(() => {
    status.style.display = "none";
  }, 3000);
}

function setButtonState(disabled: boolean): void {
  const button = document.getElementById("fetch") as HTMLButtonElement;
  button.disabled = disabled;
  button.textContent = disabled ? "Fetching..." : "Fetch Deck";
}

document.addEventListener("DOMContentLoaded", () => {
  const fetchButton = document.getElementById("fetch")!;

  fetchButton.onclick = () => {
    setButtonState(true);

    const message: RefreshMessage = { type: "REFRESH" };

    (globalThis as any).chrome?.runtime?.sendMessage(
      message,
      (response: RefreshResponse) => {
        setButtonState(false);

        if ((globalThis as any).chrome?.runtime?.lastError) {
          showStatus(
            "Error: " + (globalThis as any).chrome.runtime.lastError.message,
            true
          );
          return;
        }

        if (response && response.ok) {
          showStatus("Deck synced successfully!");
        } else {
          showStatus("Failed to sync deck", true);
        }
      }
    );
  };
});
