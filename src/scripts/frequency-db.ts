import Dexie from "dexie";
import { HighlightStyle, HighlightSettings } from "./types";

// TypeScript interfaces for frequency data
interface FrequencyEntry {
  id?: number;
  term: string;
  reading: string;
  frequency: number;
  kana_frequency?: number;
}

// Settings interface
interface Settings {
  colorIntensity: number;
  showStats: boolean;
  highlightStyle: HighlightStyle;
  useFrequencyColors: boolean;
  singleColor: string;
  showFrequencyOnHover: boolean;
}

// Color calculation functions
export function getColorForFrequency(
  frequency: number | null,
  intensity: number = 0.7
): { color: string; bgColor: string } {
  if (frequency === null) {
    // Gray for words not in frequency list
    return {
      color: "#333333",
      bgColor: `rgba(128, 128, 128, ${intensity * 0.15})`,
    };
  }

  // Logarithmic scale: log10(frequency) mapped to 0-1 range
  // Most common words (rank 1) -> 0.0 (green)
  // Rare words (rank 500,000) -> 1.0 (red)
  const logFreq = Math.log10(frequency);
  const minLog = Math.log10(1); // Most common word
  const maxLog = Math.log10(500000); // Rarest word in our dataset

  // Normalize to 0-1 range
  const normalizedFreq = Math.min(
    1.0,
    Math.max(0.0, (logFreq - minLog) / (maxLog - minLog))
  );

  // Create smooth gradient from green to red
  // Green: hsl(120, 100%, 50%) = rgb(0, 255, 0)
  // Red: hsl(0, 100%, 50%) = rgb(255, 0, 0)

  // Interpolate hue from 120 (green) to 0 (red)
  const hue = 120 * (1 - normalizedFreq);
  const saturation = 70; // Moderate saturation for gentle colors
  const lightness = 45; // Darker for text color

  // Background uses higher lightness and lower saturation for subtle highlighting
  const bgSaturation = 40;
  const bgLightness = 85;

  const textColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  const bgColor = `hsla(${hue}, ${bgSaturation}%, ${bgLightness}%, ${
    intensity * 0.2
  })`;

  return {
    color: textColor,
    bgColor: bgColor,
  };
}

// Generate single color highlighting
export function getSingleColor(
  singleColor: string,
  intensity: number = 0.7
): { color: string; bgColor: string } {
  const rgb = hexToRgb(singleColor);

  if (!rgb) {
    // Fallback to default red
    return {
      color: "#ff4444",
      bgColor: `rgba(255, 68, 68, ${intensity * 0.3})`,
    };
  }

  return {
    color: singleColor,
    bgColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity * 0.3})`,
  };
}

// Helper function to convert hex to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Helper function to reset element styles
function resetElementStyles(element: HTMLElement): void {
  element.style.backgroundColor = "";
  element.style.color = "";
  element.style.textDecoration = "";
  element.style.textDecorationColor = "";
  element.style.textDecorationThickness = "";
  element.style.textDecorationStyle = "";
  element.style.textShadow = "";
  element.style.boxShadow = "";
  element.style.outline = "";
  element.style.filter = "";
  element.removeAttribute("data-frequency");
  element.style.removeProperty("--frequency-content");
}

// Apply highlight style to element (layout-shift-free)
export function applyHighlightStyle(
  element: HTMLElement,
  colors: { color: string; bgColor: string },
  style: HighlightStyle,
  useFrequencyColors: boolean = true,
  frequency: number | null = null,
  showFrequencyOnHover: boolean = false
): void {
  // Reset all styles first
  resetElementStyles(element);

  // Use provided colors or fallback to neutral
  const finalColors = useFrequencyColors
    ? colors
    : {
        color: "#666666",
        bgColor: "rgba(128, 128, 128, 0.2)",
      };

  // Apply frequency hover if enabled
  if (showFrequencyOnHover && frequency !== null) {
    element.setAttribute("data-frequency", frequency.toString());
    element.style.setProperty("--frequency-content", `"${frequency}"`);
  }

  // Apply highlighting based on style (all layout-shift-free)
  switch (style) {
    case "underline":
      element.style.textDecorationLine = "underline";
      element.style.textDecorationColor = finalColors.color;
      element.style.textDecorationThickness = "2px";
      break;

    case "background":
      element.style.backgroundColor = finalColors.bgColor;
      element.style.color = finalColors.color;
      break;

    case "outline":
      element.style.textShadow = `
        -1px -1px 0 ${finalColors.color},
        1px -1px 0 ${finalColors.color},
        -1px 1px 0 ${finalColors.color},
        1px 1px 0 ${finalColors.color}
      `;
      break;

    case "dots":
      element.style.textDecorationLine = "underline";
      element.style.textDecorationStyle = "dotted";
      element.style.textDecorationColor = finalColors.color;
      element.style.textDecorationThickness = "2px";
      break;
  }
}

// Generate CSS for frequency highlighting (layout-shift-free)
export function generateFrequencyCSS(intensity: number = 0.7): string {
  return `
    .seer-word-unknown {
      cursor: pointer !important;
      transition: filter 0.2s ease !important;
      position: relative !important;
    }
    
    .seer-word-unknown:hover {
      filter: brightness(1.1) !important;
    }

    /* Frequency hover badge (positioned outside normal flow) */
    .seer-word-unknown[data-frequency]::before {
      content: var(--frequency-content) !important;
      position: absolute !important;
      top: -16px !important;
      right: -8px !important;
      background: rgba(0, 0, 0, 0.9) !important;
      color: white !important;
      font-size: 10px !important;
      font-weight: bold !important;
      padding: 3px 6px !important;
      border-radius: 12px !important;
      min-width: 18px !important;
      text-align: center !important;
      opacity: 0 !important;
      transform: translateY(-4px) scale(0.9) !important;
      transition: all 0.2s ease !important;
      pointer-events: none !important;
      z-index: 1000 !important;
      line-height: 1 !important;
      white-space: nowrap !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
    }

    .seer-word-unknown[data-frequency]:hover::before {
      opacity: 1 !important;
      transform: translateY(0) scale(1) !important;
    }
  `;
}

// Dexie database class following the documentation pattern
export class FrequencyDatabase extends Dexie {
  frequencies!: Dexie.Table<FrequencyEntry, number>;

  constructor() {
    super("JapaneseFrequencyDB");
    this.version(1).stores({
      frequencies: "++id, term, reading, frequency",
    });
  }
}

// Database instance
export const db = new FrequencyDatabase();

// Cache for frequency lookups
const frequencyCache = new Map<string, number>();

// Database initialization status
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

// CSV parsing function
function parseCSV(csvText: string): FrequencyEntry[] {
  console.log("🔍 Parsing CSV data...");
  const lines = csvText.trim().split("\n");
  const entries: FrequencyEntry[] = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split("\t");
    if (parts.length >= 3) {
      const term = parts[0];
      const reading = parts[1];
      const frequency = parseInt(parts[2]);
      const kana_frequency = parts[3] ? parseInt(parts[3]) : undefined;

      if (term && reading && !isNaN(frequency)) {
        entries.push({
          term,
          reading,
          frequency,
          kana_frequency,
        });
      }
    }
  }

  console.log(`📊 Parsed ${entries.length} frequency entries`);
  return entries;
}

// Download and initialize frequency data
async function downloadAndInitializeFrequencyData(): Promise<void> {
  try {
    console.log("📥 Downloading JPDB frequency data...");

    const response = await fetch(
      "https://raw.githubusercontent.com/Kuuuube/yomitan-dictionaries/main/data/jpdb_v2.2_freq_list_2024-10-13.csv"
    );
    if (!response.ok) {
      throw new Error(`Failed to download frequency data: ${response.status}`);
    }

    const csvText = await response.text();
    console.log(`📄 Downloaded ${csvText.length} characters of CSV data`);

    const entries = parseCSV(csvText);

    // Clear existing data and insert new data
    console.log("🗑️ Clearing existing frequency data...");
    await db.frequencies.clear();

    console.log("💾 Inserting frequency data into IndexedDB...");

    // Use transaction to ensure atomicity
    await db.transaction("rw", db.frequencies, async () => {
      await (db.frequencies as any).bulkAdd(entries);
    });

    console.log("✅ Frequency database initialized successfully");
    isInitialized = true;

    // Populate cache with most common words for faster lookups
    const commonWords = await db.frequencies
      .where("frequency")
      .below(1000)
      .toArray();
    commonWords.forEach((entry: FrequencyEntry) => {
      frequencyCache.set(entry.term, entry.frequency);
      if (entry.reading !== entry.term) {
        frequencyCache.set(entry.reading, entry.frequency);
      }
    });

    console.log(
      `🚀 Cached ${frequencyCache.size} common words for fast lookup`
    );
  } catch (error) {
    console.error("❌ Error initializing frequency database:", error);
    throw error;
  }
}

// Initialize database
export async function initializeFrequencyDB(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      // Check if we already have data
      const count = await db.frequencies.count();
      if (count > 0) {
        console.log(`📚 Found ${count} existing frequency entries`);
        isInitialized = true;

        // Populate cache
        const commonWords = await db.frequencies
          .where("frequency")
          .below(1000)
          .toArray();
        commonWords.forEach((entry: FrequencyEntry) => {
          frequencyCache.set(entry.term, entry.frequency);
          if (entry.reading !== entry.term) {
            frequencyCache.set(entry.reading, entry.frequency);
          }
        });

        return;
      }

      // Download and initialize data
      await downloadAndInitializeFrequencyData();
    } catch (error) {
      console.error("❌ Failed to initialize frequency database:", error);
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}

// Get frequency rank for a word
export async function getFrequencyRank(word: string): Promise<number | null> {
  try {
    if (!isInitialized) {
      await initializeFrequencyDB();
    }

    // Check cache first
    if (frequencyCache.has(word)) {
      return frequencyCache.get(word)!;
    }

    // Query database
    const entry = await db.frequencies.where("term").equals(word).first();
    if (entry) {
      frequencyCache.set(word, entry.frequency);
      return entry.frequency;
    }

    // Try reading field
    const readingEntry = await db.frequencies
      .where("reading")
      .equals(word)
      .first();
    if (readingEntry) {
      frequencyCache.set(word, readingEntry.frequency);
      return readingEntry.frequency;
    }

    return null;
  } catch (error) {
    console.error("❌ Error getting frequency rank:", error);
    return null;
  }
}

// Force refresh frequency data
export async function refreshFrequencyData(): Promise<void> {
  console.log("🔄 Force refreshing frequency data...");
  isInitialized = false;
  initializationPromise = null;
  frequencyCache.clear();
  await downloadAndInitializeFrequencyData();
}

// Get database statistics
export async function getFrequencyStats(): Promise<{
  totalEntries: number;
  cacheSize: number;
}> {
  const totalEntries = await db.frequencies.count();
  return {
    totalEntries,
    cacheSize: frequencyCache.size,
  };
}

// Load settings from Chrome storage
export async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    const defaultSettings: Settings = {
      colorIntensity: 0.7,
      showStats: true,
      highlightStyle: "underline",
      useFrequencyColors: true,
      singleColor: "#ff6b6b",
      showFrequencyOnHover: false,
    };

    chrome.storage.sync.get(defaultSettings, (result) => {
      resolve(result as Settings);
    });
  });
}
