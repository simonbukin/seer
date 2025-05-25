import { TokensMessage, TokensResponse } from "./types";
import {
  initializeFrequencyDB,
  getFrequencyRank,
  getFrequencyTier,
  getFrequencyColors,
  generateFrequencyCSS,
  FREQUENCY_CONFIG,
} from "./frequency-db";

const CLS = "anki-unknown";
let segmenter: Intl.Segmenter;

// Stats tracking
interface Stats {
  totalTokens: number;
  unknownTokens: number;
  knownTokens: number;
  mostCommon: Map<string, number>;
  lastUpdate: Date;
}

let stats: Stats = {
  totalTokens: 0,
  unknownTokens: 0,
  knownTokens: 0,
  mostCommon: new Map(),
  lastUpdate: new Date(),
};

// Cache for frequency ranks to avoid repeated database queries
const frequencyCache = new Map<string, number | null>();

async function getCachedFrequencyRank(word: string): Promise<number | null> {
  if (frequencyCache.has(word)) {
    const cached = frequencyCache.get(word)!;
    console.log(
      `💾 Cache hit for "${word}": rank ${
        cached ? `#${cached.toLocaleString()}` : "not found"
      }`
    );
    return cached;
  }

  try {
    console.log(`🔍 Looking up frequency for "${word}"`);
    const rank = await getFrequencyRank(word);
    frequencyCache.set(word, rank);
    return rank;
  } catch (error) {
    console.error("❌ Error getting frequency rank:", error);
    frequencyCache.set(word, null);
    return null;
  }
}

function getFrequencyClass(rank: number | null): string {
  const tier = getFrequencyTier(rank);
  return `jp-word-${tier}`;
}

function getFrequencyInfo(rank: number | null): string {
  if (!rank) return "Not in frequency list";

  const tier = getFrequencyTier(rank);

  if (tier === "notInList") {
    return "Not in frequency list";
  }

  const config = FREQUENCY_CONFIG[tier];
  if ("min" in config && "max" in config) {
    return `${config.min}-${config.max === Infinity ? "∞" : config.max}`;
  }

  return "Unknown frequency range";
}

async function createTooltip(word: string): Promise<HTMLElement> {
  const tooltip = document.createElement("div");
  tooltip.className = "anki-tooltip";

  const rank = await getCachedFrequencyRank(word);

  const freqInfo = rank
    ? `Frequency rank: #${rank.toLocaleString()}`
    : "Not in frequency list";

  const categoryInfo = getFrequencyInfo(rank);

  tooltip.innerHTML = `
    ${word}
    <span class="freq-info">${freqInfo}</span>
    <span class="freq-info">${categoryInfo}</span>
  `;
  return tooltip;
}

function addTooltipToSpan(span: HTMLElement, word: string): void {
  let tooltip: HTMLElement | null = null;

  span.addEventListener("mouseenter", async () => {
    tooltip = await createTooltip(word);
    span.appendChild(tooltip);
    tooltip.offsetHeight;
    tooltip.classList.add("show");
  });

  span.addEventListener("mouseleave", () => {
    if (tooltip) {
      tooltip.classList.remove("show");
      setTimeout(() => {
        if (tooltip && tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
        }
      }, 200);
    }
  });
}

// Initialize segmenter
try {
  segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  console.log("✅ Japanese segmenter initialized");
} catch (error) {
  console.warn(
    "❌ Intl.Segmenter not available, extension may not work properly"
  );
}

// Generate CSS dynamically from config
function generateCSS(): string {
  let css = `
    .${CLS} {
      border-radius: 2px;
      padding: 0 1px;
      cursor: help;
      position: relative;
      transition: all 0.2s ease;
    }
    
    .${CLS}:hover {
      filter: brightness(1.2);
      transform: scale(1.02);
    }
  `;

  // Add frequency-based styles
  css += generateFrequencyCSS();

  css += `
    .anki-tooltip {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      z-index: 10000;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
    
    .anki-tooltip.show {
      opacity: 1;
    }
    
    .anki-tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 4px solid transparent;
      border-top-color: rgba(0, 0, 0, 0.9);
    }
    
    .anki-tooltip .freq-info {
      display: block;
      font-size: 10px;
      opacity: 0.8;
      margin-top: 2px;
    }
    
    .anki-stats {
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 12px;
      border-radius: 8px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 11px;
      line-height: 1.4;
      z-index: 9999;
      min-width: 200px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transition: all 0.3s ease;
    }
    
    .anki-stats.collapsed {
      transform: translateX(-200px);
    }
    
    .anki-stats .title {
      font-weight: bold;
      margin-bottom: 8px;
      color: #ffeb3b;
      border-bottom: 1px solid #333;
      padding-bottom: 4px;
    }
    
    .anki-stats .stat-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 2px;
    }
    
    .anki-stats .stat-label {
      color: #ccc;
    }
    
    .anki-stats .stat-value {
      color: #4caf50;
      font-weight: bold;
    }
    
    .anki-stats .unknown-value {
      color: #ff5722;
    }
    
    .anki-stats .toggle {
      position: absolute;
      right: -20px;
      top: 50%;
      transform: translateY(-50%);
      width: 20px;
      height: 40px;
      background: rgba(0, 0, 0, 0.85);
      border-radius: 0 8px 8px 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 12px;
    }
    
    .anki-stats .common-words {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #333;
      font-size: 10px;
    }
    
    .anki-stats .common-word {
      display: inline-block;
      background: rgba(255, 255, 255, 0.1);
      padding: 1px 4px;
      margin: 1px;
      border-radius: 2px;
    }
    
    .anki-stats .freq-legend {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #333;
      font-size: 9px;
    }
    
    .anki-stats .freq-item {
      display: flex;
      align-items: center;
      margin-bottom: 2px;
    }
    
    .anki-stats .freq-color {
      width: 12px;
      height: 8px;
      border-radius: 2px;
      margin-right: 6px;
    }
    
    .anki-loading {
      color: #ffeb3b;
      font-style: italic;
    }
  `;

  return css;
}

// Apply CSS
const style = document.createElement("style");
style.textContent = generateCSS();
document.head.appendChild(style);

// Create stats overlay
let statsOverlay: HTMLElement | null = null;

function createStatsOverlay(): void {
  if (statsOverlay) return;

  statsOverlay = document.createElement("div");
  statsOverlay.className = "anki-stats";

  // Generate legend items from config
  const tierLabels = {
    veryCommon: "Very Common (1-100)",
    common: "Common (101-500)",
    uncommon: "Uncommon (501-2k)",
    rare: "Rare (2k-10k)",
    veryRare: "Very Rare (10k+)",
    notInList: "Not in list",
  };

  const legendItems = Object.entries(FREQUENCY_CONFIG)
    .map(
      ([key, config]) => `
    <div class="freq-item">
      <div class="freq-color" style="background: ${config.bgColor};"></div>
      <span>${tierLabels[key as keyof typeof tierLabels]}</span>
    </div>
  `
    )
    .join("");

  statsOverlay.innerHTML = `
    <div class="title">🗾 Anki Highlighter</div>
    <div class="stat-row">
      <span class="stat-label">Total tokens:</span>
      <span class="stat-value" id="total-tokens">0</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Known:</span>
      <span class="stat-value" id="known-tokens">0</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Unknown:</span>
      <span class="stat-value unknown-value" id="unknown-tokens">0</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Knowledge:</span>
      <span class="stat-value" id="knowledge-percent">0%</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Status:</span>
      <span class="anki-loading" id="status">Loading data...</span>
    </div>
    <div class="freq-legend">
      <div style="color: #ccc; margin-bottom: 4px;">Frequency levels:</div>
      ${legendItems}
    </div>
    <div class="common-words">
      <div style="color: #ccc; margin-bottom: 4px;">Most common unknown:</div>
      <div id="common-words-list"></div>
    </div>
    <div class="toggle">◀</div>
  `;

  document.body.appendChild(statsOverlay);

  // Add toggle functionality
  const toggle = statsOverlay.querySelector(".toggle")!;
  toggle.addEventListener("click", () => {
    statsOverlay!.classList.toggle("collapsed");
    toggle.textContent = statsOverlay!.classList.contains("collapsed")
      ? "▶"
      : "◀";
  });
}

function updateStatsOverlay(): void {
  if (!statsOverlay) return;

  const totalTokensEl = statsOverlay.querySelector("#total-tokens")!;
  const knownTokensEl = statsOverlay.querySelector("#known-tokens")!;
  const unknownTokensEl = statsOverlay.querySelector("#unknown-tokens")!;
  const knowledgePercentEl = statsOverlay.querySelector("#knowledge-percent")!;
  const statusEl = statsOverlay.querySelector("#status")!;
  const commonWordsEl = statsOverlay.querySelector("#common-words-list")!;

  totalTokensEl.textContent = stats.totalTokens.toString();
  knownTokensEl.textContent = stats.knownTokens.toString();
  unknownTokensEl.textContent = stats.unknownTokens.toString();

  const knowledgePercent =
    stats.totalTokens > 0
      ? Math.round((stats.knownTokens / stats.totalTokens) * 100)
      : 0;
  knowledgePercentEl.textContent = `${knowledgePercent}%`;

  // Update status
  statusEl.textContent = `Updated ${stats.lastUpdate.toLocaleTimeString()}`;
  statusEl.className = "stat-value";

  // Show top 5 most common unknown words (current page frequency)
  const sortedCommon = Array.from(stats.mostCommon.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  commonWordsEl.innerHTML = sortedCommon
    .map(
      ([word, count]) => `<span class="common-word">${word} (${count})</span>`
    )
    .join("");
}

// Flag to prevent scanning during our own DOM modifications
let isModifyingDOM = false;

function scan(root: Node = document.body): void {
  if (!segmenter || isModifyingDOM) return;

  console.log("🔍 Starting Japanese token scan...");

  const tokens = new Set<string>();
  const textNodes: Text[] = [];

  // Create tree walker to find all text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip script, style, and already processed nodes
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;

      const tagName = parent.tagName.toLowerCase();
      if (tagName === "script" || tagName === "style") {
        return NodeFilter.FILTER_REJECT;
      }

      if (
        parent.closest(`.${CLS}`) ||
        parent.closest(".anki-stats") ||
        parent.closest(".anki-tooltip")
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect text nodes and extract tokens
  let node: Node | null;
  let processedTextNodes = 0;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.data;

    if (text.trim().length === 0) continue;

    textNodes.push(textNode);
    processedTextNodes++;

    // Segment the text and collect tokens
    try {
      const segments = segmenter.segment(text);
      let segmentCount = 0;

      for (const segment of segments) {
        if (segment.isWordLike) {
          const token = segment.segment.trim();
          if (
            token.length > 0 &&
            /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(token)
          ) {
            tokens.add(token);
            segmentCount++;
          }
        }
      }

      if (segmentCount > 0) {
        console.log(
          `📝 Text node "${text.substring(
            0,
            50
          )}..." -> ${segmentCount} Japanese tokens`
        );
      }
    } catch (error) {
      console.warn("❌ Error segmenting text:", error);
    }
  }

  console.log(
    `📊 Scan complete: ${processedTextNodes} text nodes, ${tokens.size} unique Japanese tokens`
  );
  console.log(`🔤 Sample tokens:`, Array.from(tokens).slice(0, 20));

  if (tokens.size === 0) {
    console.log("⚠️ No Japanese tokens found");
    // Create stats overlay even with no tokens
    createStatsOverlay();
    updateStatsOverlay();
    return;
  }

  // Send tokens to background script
  const message: TokensMessage = { type: "TOKENS", tokens: Array.from(tokens) };

  console.log("📤 Sending tokens to background script...");

  (globalThis as any).chrome?.runtime?.sendMessage(
    message,
    async (response: TokensResponse) => {
      if (response && response.unknown) {
        const unknownSet = new Set(response.unknown);

        console.log(
          `📥 Received response: ${response.unknown.length} unknown words out of ${tokens.size} total`
        );
        console.log(`❓ Sample unknown words:`, response.unknown.slice(0, 10));

        // Update stats for current page
        stats.totalTokens = tokens.size;
        stats.unknownTokens = response.unknown.length;
        stats.knownTokens = tokens.size - response.unknown.length;
        stats.lastUpdate = new Date();

        console.log(
          `📈 Stats: ${stats.knownTokens} known, ${
            stats.unknownTokens
          } unknown (${Math.round(
            (stats.knownTokens / stats.totalTokens) * 100
          )}% knowledge)`
        );

        // Count frequency of unknown words on current page
        stats.mostCommon.clear();
        textNodes.forEach((textNode) => {
          const text = textNode.data;
          try {
            const segments = segmenter.segment(text);
            for (const segment of segments) {
              if (segment.isWordLike) {
                const token = segment.segment.trim();
                if (unknownSet.has(token)) {
                  const count = stats.mostCommon.get(token) || 0;
                  stats.mostCommon.set(token, count + 1);
                }
              }
            }
          } catch (error) {
            // Ignore segmentation errors
          }
        });

        // Set flag to prevent observer from triggering during our changes
        isModifyingDOM = true;

        console.log("🎨 Starting to highlight unknown words...");

        // Process each text node (now async)
        let highlightedWords = 0;
        for (const textNode of textNodes) {
          const highlighted = await wrapUnknown(textNode, unknownSet);
          highlightedWords += highlighted;
        }

        console.log(`✨ Highlighted ${highlightedWords} word instances`);

        // Clear flag after DOM modifications are complete
        setTimeout(() => {
          isModifyingDOM = false;
        }, 100);

        // Update UI
        createStatsOverlay();
        updateStatsOverlay();
      } else {
        console.error("❌ Invalid response from background script:", response);
      }
    }
  );
}

async function wrapUnknown(
  textNode: Text,
  unknownWords: Set<string>
): Promise<number> {
  if (!segmenter) return 0;

  const text = textNode.data;
  const parent = textNode.parentNode;

  if (!parent) return 0;

  try {
    const segments = Array.from(segmenter.segment(text));

    if (segments.length <= 1) return 0;

    const fragment = document.createDocumentFragment();
    let highlightedCount = 0;

    for (const segment of segments) {
      if (segment.isWordLike && unknownWords.has(segment.segment.trim())) {
        const word = segment.segment.trim();
        // Get frequency rank for styling
        const rank = await getCachedFrequencyRank(word);
        // Wrap unknown word in span with frequency-based styling
        const span = document.createElement("span");
        span.className = `${CLS} ${getFrequencyClass(rank)}`;
        span.textContent = segment.segment;
        addTooltipToSpan(span, word);
        fragment.appendChild(span);
        highlightedCount++;
      } else {
        // Keep as text
        fragment.appendChild(document.createTextNode(segment.segment));
      }
    }

    // Replace the original text node
    parent.replaceChild(fragment, textNode);
    return highlightedCount;
  } catch (error) {
    console.warn("❌ Error wrapping unknown words:", error);
    return 0;
  }
}

// Initial scan setup
async function initializeScanning(): Promise<void> {
  console.log("Initializing Anki Highlighter...");

  try {
    // Load frequency data first
    await initializeFrequencyDB();
    console.log("Frequency data loaded successfully");

    // Create stats overlay immediately
    createStatsOverlay();

    // Single initial scan
    scan();
  } catch (error) {
    console.error("Error initializing Anki Highlighter:", error);

    // Create stats overlay anyway
    createStatsOverlay();

    // Update status to show error
    const statusEl = document.querySelector("#status");
    if (statusEl) {
      statusEl.textContent = "Error loading data";
      statusEl.className = "unknown-value";
    }
  }
}

// Handle extension context invalidation
let extensionContextValid = true;

function checkExtensionContext(): boolean {
  try {
    chrome.runtime.getURL("");
    return true;
  } catch (error) {
    if (!extensionContextValid) return false; // Already logged

    console.warn("Extension context invalidated. Please reload the page.");
    extensionContextValid = false;

    // Update UI to show context lost
    const statusEl = document.querySelector("#status");
    if (statusEl) {
      statusEl.textContent = "Extension reloaded - refresh page";
      statusEl.className = "unknown-value";
    }

    return false;
  }
}

// Initialize immediately based on document state
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeScanning);
} else {
  // Document is already loaded
  initializeScanning();
}

// MutationObserver with better filtering to prevent self-triggering
const observer = new MutationObserver((mutations) => {
  // Check if extension context is still valid
  if (!checkExtensionContext()) return;

  // Don't scan if we're currently modifying the DOM
  if (isModifyingDOM) return;

  let shouldScan = false;

  for (const mutation of mutations) {
    if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
      for (const node of Array.from(mutation.addedNodes)) {
        // Skip our own elements
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            element.classList?.contains(CLS) ||
            element.classList?.contains("anki-stats") ||
            element.classList?.contains("anki-tooltip") ||
            element.closest(".anki-stats") ||
            element.closest(".anki-tooltip")
          ) {
            continue;
          }
        }

        if (
          node.nodeType === Node.ELEMENT_NODE ||
          node.nodeType === Node.TEXT_NODE
        ) {
          // Check if the added content contains Japanese text
          const textContent = node.textContent || "";
          if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(textContent)) {
            shouldScan = true;
            break;
          }
        }
      }
      if (shouldScan) break;
    }
  }

  if (shouldScan) {
    console.log("Detected new Japanese content, rescanning...");
    scan();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
