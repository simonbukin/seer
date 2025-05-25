import Dexie from "dexie";

// TypeScript interfaces for frequency data
interface FrequencyEntry {
  id?: number;
  term: string;
  reading: string;
  frequency: number;
  kana_frequency?: number;
}

interface FrequencyConfig {
  veryCommon: { min: number; max: number; color: string; bgColor: string };
  common: { min: number; max: number; color: string; bgColor: string };
  uncommon: { min: number; max: number; color: string; bgColor: string };
  rare: { min: number; max: number; color: string; bgColor: string };
  veryRare: { min: number; max: number; color: string; bgColor: string };
  notInList: { color: string; bgColor: string };
}

// Centralized frequency configuration
export const FREQUENCY_CONFIG: FrequencyConfig = {
  veryCommon: { min: 1, max: 100, color: "#2d5016", bgColor: "#90ee90" },
  common: { min: 101, max: 500, color: "#8b6914", bgColor: "#ffff99" },
  uncommon: { min: 501, max: 2000, color: "#cc5500", bgColor: "#ffa500" },
  rare: { min: 2001, max: 10000, color: "#8b0000", bgColor: "#ff6b6b" },
  veryRare: { min: 10001, max: Infinity, color: "#4b0082", bgColor: "#dda0dd" },
  notInList: { color: "#8b0000", bgColor: "#ff6b6b" },
};

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

// Get frequency tier for a word
export function getFrequencyTier(
  frequency: number | null
): keyof FrequencyConfig {
  if (frequency === null) return "notInList";

  if (
    frequency >= FREQUENCY_CONFIG.veryCommon.min &&
    frequency <= FREQUENCY_CONFIG.veryCommon.max
  ) {
    return "veryCommon";
  } else if (
    frequency >= FREQUENCY_CONFIG.common.min &&
    frequency <= FREQUENCY_CONFIG.common.max
  ) {
    return "common";
  } else if (
    frequency >= FREQUENCY_CONFIG.uncommon.min &&
    frequency <= FREQUENCY_CONFIG.uncommon.max
  ) {
    return "uncommon";
  } else if (
    frequency >= FREQUENCY_CONFIG.rare.min &&
    frequency <= FREQUENCY_CONFIG.rare.max
  ) {
    return "rare";
  } else {
    return "veryRare";
  }
}

// Get color configuration for a frequency tier
export function getFrequencyColors(tier: keyof FrequencyConfig): {
  color: string;
  bgColor: string;
} {
  return {
    color: FREQUENCY_CONFIG[tier].color,
    bgColor: FREQUENCY_CONFIG[tier].bgColor,
  };
}

// Generate CSS for frequency highlighting
export function generateFrequencyCSS(): string {
  const tiers = Object.keys(FREQUENCY_CONFIG) as (keyof FrequencyConfig)[];

  return tiers
    .map((tier) => {
      const config = FREQUENCY_CONFIG[tier];
      return `
      .jp-word-${tier} {
        background-color: ${config.bgColor} !important;
        color: ${config.color} !important;
        border-radius: 2px !important;
        padding: 1px 2px !important;
        margin: 0 1px !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
      }
      
      .jp-word-${tier}:hover {
        transform: scale(1.05) !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
      }
    `;
    })
    .join("\n");
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
