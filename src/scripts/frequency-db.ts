import Dexie from "dexie";
import { HighlightStyle, GradientColors, HighlightSettings } from "./types";

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
  gradientColors: GradientColors;
  customCSS: string;
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

// Generate color from custom gradient
export function getColorFromGradient(
  frequency: number | null,
  gradientColors: GradientColors,
  intensity: number = 0.7
): { color: string; bgColor: string } {
  if (frequency === null) {
    // Gray for words not in frequency list
    return {
      color: "#333333",
      bgColor: `rgba(128, 128, 128, ${intensity * 0.15})`,
    };
  }

  // Normalize frequency to 0-1 range
  const logFreq = Math.log10(frequency);
  const minLog = Math.log10(1);
  const maxLog = Math.log10(500000);
  const normalizedFreq = Math.min(
    1.0,
    Math.max(0.0, (logFreq - minLog) / (maxLog - minLog))
  );

  // Parse start and end colors
  const startColor = hexToRgb(gradientColors.startColor);
  const endColor = hexToRgb(gradientColors.endColor);

  if (!startColor || !endColor) {
    // Fallback to default colors
    return getColorForFrequency(frequency, intensity);
  }

  // Interpolate between start and end colors
  const r = Math.round(
    startColor.r + (endColor.r - startColor.r) * normalizedFreq
  );
  const g = Math.round(
    startColor.g + (endColor.g - startColor.g) * normalizedFreq
  );
  const b = Math.round(
    startColor.b + (endColor.b - startColor.b) * normalizedFreq
  );

  const textColor = `rgb(${r}, ${g}, ${b})`;
  const bgColor = `rgba(${r}, ${g}, ${b}, ${intensity * 0.2})`;

  return {
    color: textColor,
    bgColor: bgColor,
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

// Apply highlight style to element
export function applyHighlightStyle(
  element: HTMLElement,
  colors: { color: string; bgColor: string },
  style: HighlightStyle,
  customCSS: string = ""
): void {
  // Reset all styles first
  element.style.backgroundColor = "";
  element.style.color = "";
  element.style.textDecoration = "";
  element.style.borderBottom = "";
  element.style.cssText = "";

  switch (style) {
    case "highlight":
      element.style.backgroundColor = colors.bgColor;
      element.style.color = colors.color;
      break;

    case "underline":
      element.style.textDecoration = "none";
      element.style.borderBottom = `2px solid ${colors.color}`;
      break;

    case "color":
      element.style.color = colors.color;
      break;

    case "custom":
      if (customCSS) {
        // Apply custom CSS with color variables
        const processedCSS = customCSS
          .replace(/\$\{color\}/g, colors.color)
          .replace(/\$\{bgColor\}/g, colors.bgColor);
        element.style.cssText = processedCSS;
      } else {
        // Fallback to highlight style
        element.style.backgroundColor = colors.bgColor;
        element.style.color = colors.color;
      }
      break;

    case "rainbow":
      element.style.textDecoration = "none";
      element.style.borderBottom = "3px solid transparent";
      element.style.backgroundImage =
        "linear-gradient(90deg, #ff0000, #ff8000, #ffff00, #80ff00, #00ff00, #00ff80, #00ffff, #0080ff, #0000ff, #8000ff, #ff00ff, #ff0080)";
      element.style.backgroundSize = "100% 3px";
      element.style.backgroundRepeat = "no-repeat";
      element.style.backgroundPosition = "0 100%";
      element.style.animation = "rainbow-shift 3s linear infinite";
      break;
  }
}

// Generate CSS for frequency highlighting with gradient system
export function generateFrequencyCSS(intensity: number = 0.7): string {
  return `
    .seer-word-unknown {
      border-radius: 2px !important;
      padding: 1px 2px !important;
      margin: 0 1px !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
      font-weight: 500 !important;
    }
    
    .seer-word-unknown:hover {
      transform: scale(1.05) !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
      filter: brightness(1.1) !important;
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
      gradientColors: {
        startColor: "#00ff00", // Green for common words
        endColor: "#ff0000", // Red for rare words
      },
      customCSS: "",
    };

    chrome.storage.sync.get(defaultSettings, (result) => {
      resolve(result as Settings);
    });
  });
}
