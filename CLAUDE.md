# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
bun install          # Install dependencies (bun.lockb exists)
bun run dev          # Development build with hot reload
bun run build        # Production build to dist/
bun run preview      # Preview production build
```

The extension outputs to `dist/` which is loaded as an unpacked Chrome extension.

## Architecture

**Seer** is a Chrome extension (Manifest V3) that highlights unknown Japanese words on web pages by syncing with the user's Anki vocabulary via AnkiConnect.

### Core Data Flow

1. **Vocabulary Sync** (`src/background/service-worker.ts`): Fetches cards from Anki via AnkiConnect, extracts vocabulary from configured deck/field, and caches in `chrome.storage.local`. Tracks knowledge levels (new/learning/young/mature) based on Anki card properties.

2. **Content Processing** (`src/content/content.ts`): On page load, walks DOM for Japanese text nodes, matches words using Yomitan-style deinflection (longest-match-first substring scanning), classifies each token as known/unknown/ignored, and highlights using CSS Custom Highlight API or span fallback.

3. **Encounter Tracking**: Every word encounter is recorded to IndexedDB (`src/shared/db.ts` using Dexie) with sentence context, URL, and timestamp. Enables "long-tail immersion" statistics.

### Key Components

- **LayerManager** (`src/content/layer-manager.ts`): Manages multiple highlight layers (frequency bands, knowledge status) using CSS Custom Highlight API with fallback to spans for older browsers.

- **AnkiClient** (`src/shared/anki-client.ts`): Read-only wrapper for AnkiConnect. Intentionally blocks all write operations except adding to the "ignored words" deck.

- **Normalization** (`src/shared/normalization.ts`): Handles Japanese text normalization, extracting words from Anki fields, and generating all inflected forms for matching.

- **Frequency Data** (`src/shared/frequency.ts`): Contains JPDB v2.2 frequency rankings for 50k words, used for color-coding highlights by rarity.

### IndexedDB Schema (SeerDB)

- `encounters`: Every word seen, with sentence context and source URL
- `pages`: Time spent on each URL (for filtering encounters by reading time)
- `sentences`: i+1 sentence mining (sentences with 1-3 unknown words)
- `comprehensionSnapshots`: Historical comprehension percentages per page

### Extension Entry Points

- Background: `src/background/service-worker.ts`
- Content script: `src/content/content.ts`
- Popup: `src/popup/popup.ts`
- Options: `src/options/options.ts`

### Vite Build

Custom plugins in `vite.config.ts` copy CSS to `dist/` after build. The `@crxjs/vite-plugin` handles manifest processing.

## TypeScript

Uses strict mode. Key types in `src/shared/types.ts`:
- `SeerConfig`: Extension configuration
- `VocabData`/`VocabDataSerialized`: Vocabulary cache (Set/Map vs arrays for storage)
- `ProcessedToken`: Tokenized word with status and frequency
- `PageStats`: Comprehension statistics for a page

Message types for content-script/service-worker communication are typed via `MessageType` and `MessageResponse<T>`.
