# Seer - Japanese Reading Companion

Seer is a Chrome extension that highlights unknown Japanese words on any webpage by syncing with your Anki vocabulary. It tracks every word you encounter across the web, enabling "long-tail immersion" analytics, i+1 sentence mining, and comprehension progress tracking over time.

## Features

- **Vocabulary Highlighting** - Unknown words are highlighted based on JPDB frequency bands and your Anki knowledge level
- **Encounter Tracking** - Every word you see is recorded with full sentence context, URL, and timestamp
- **i+1 Sentence Mining** - Automatically finds sentences with exactly one unknown word—optimal for learning
- **Comprehension Analytics** - Track your comprehension percentage across sites and watch it improve over time
- **Content Library** - Import books, subtitles, and articles for pre-reading difficulty assessment
- **SPA Support** - Correctly tracks distinct content within single-page applications
- **Multi-Layer Highlights** - Independent highlight layers for frequency, status (known/unknown), and knowledge level
- **Grammar Detection** - Detects Dictionary of Japanese Grammar patterns in encountered sentences

## Installation

### Prerequisites

- Chrome 105+ (Chrome 135+ for click-to-ignore)
- [Anki](https://apps.ankiweb.net/) with [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on
- [Bun](https://bun.sh) runtime (for building)

### Build from Source

```bash
git clone https://github.com/simonbukin/seer.git
cd seer
bun install
```

### Download Data Files

Seer requires JMdict data for word validation. Download it before building:

```bash
./scripts/download-data.sh
bun scripts/generate-wordlist.ts
```

This downloads ~11MB compressed and extracts to ~115MB. The wordlist generator creates `src/shared/jmdict-words.txt` used for word validation.

### Build

```bash
bun run build
```

### Load in Chrome

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. Seer should now appear in your extensions list

## Setup

### 1. Install AnkiConnect

1. In Anki: **Tools → Add-ons → Get Add-ons**
2. Enter code: `2055492159`
3. Restart Anki

Anki must be running for Seer to sync vocabulary.

### 2. Configure Vocabulary Sources

1. Right-click the Seer icon → **Options**
2. Under **Known Sources**, click **Add Source**
3. Select your mining deck and the field containing Japanese words (e.g., "Expression")
4. Add additional decks if you have multiple (Kaishi, Core, mining deck, etc.)

### 3. Ignored & Known Words (Optional)

- **Ignored Deck**: Words you don't want highlighted (particles, names, etc.)
  - Default: `Seer::Ignored`
- **Known Deck**: Words marked as known via keyboard shortcut
  - Default: `Seer::Known`

Seer will create these decks automatically when you first ignore/mark a word.

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Open popup |
| `Ctrl+Shift+P` | Open side panel |
| `Ctrl+Shift+H` | Toggle all highlights |
| `Ctrl+Shift+M` | Cycle highlight mode (Frequency/Status/Knowledge) |
| `Shift+K` (hover) | Mark word as known |
| `Alt+I` (hover) | Ignore word |

Customize shortcuts at `chrome://extensions/shortcuts`.

### Highlight Modes

- **Frequency Mode** - Colors by JPDB frequency band (common → rare)
- **Status Mode** - Known vs unknown vs ignored
- **Knowledge Mode** - New/learning/young/mature based on Anki card status

### Side Panel

The side panel (`Ctrl+Shift+P`) shows:

- **Live Stats** - Current page comprehension %, known/unknown word counts
- **Unknown Words** - List of unknown words on the current page
- **Virtual Analysis** - "Scan Full Page" for complete page assessment without recording encounters
- **i+1 Sentences** - Sentences with exactly one unknown word found on this page

### Dashboard

Access the dashboard from the Options page for:

- **Vocabulary** - Search and filter your known vocabulary
- **Encounters** - Browse every word you've encountered with sentence context
- **i+1 Mining** - Find high-value i+1 sentences across all your reading
- **Sentences** - Search all recorded sentences
- **Sites** - Per-site comprehension stats and time tracking
- **Library** - Import and analyze content before reading

## Key Concepts

### Knowledge Levels

Seer tracks your Anki card maturity:

| Level | Criteria |
|-------|----------|
| **Mature** | Interval ≥ 21 days |
| **Young** | Reviewed, interval < 21 days |
| **Learning** | In learning/relearning phase |
| **New** | Never reviewed |

### Frequency Bands

Words are colored by JPDB v2.2 frequency rank:

| Band | Rank | Coverage |
|------|------|----------|
| Very Common | 1-1,000 | Top 1k words |
| Common | 1k-5k | High frequency |
| Medium | 5k-15k | Moderate frequency |
| Uncommon | 15k-50k | Lower frequency |
| Rare | 50k+ | Rare vocabulary |

### i+1 Sentences

Sentences containing exactly one unknown word. These are optimal for learning because:
- Context helps you understand the unknown word
- High comprehension (only one gap)
- Natural SRS candidate

Seer automatically identifies these sentences and ranks them by the value of the unknown word.

### Encounter Deduplication

To avoid inflating statistics:
- Same word+sentence won't be recorded twice in one session
- Time-window deduplication (default: 4 hours) prevents repeated recording

## Configuration

Access via **Options** page:

| Setting | Description |
|---------|-------------|
| **AnkiConnect URL** | Default: `http://127.0.0.1:8765` |
| **Known Sources** | Anki decks to sync as known vocabulary |
| **Ignored Source** | Deck for ignored words |
| **Known Source** | Deck for manually marked words |
| **Sync Interval** | How often to sync with Anki (default: 30 min) |
| **Highlight Layers** | Customize colors and styles per layer |
| **Ignore List** | Domains/URLs to skip tracking |
| **Mokuro Mode** | Force OCR text extraction for manga readers |
| **Deduplication** | Time window for encounter deduplication |

## Anki Safety

Seer is read-only by design:
- Reads vocabulary from configured decks
- Queries card info (intervals, review counts, lapses)
- **Cannot** modify, delete, or suspend existing cards

Exception: Adding words to Seer-owned decks (`Seer::Ignored`, `Seer::Known`).

## Troubleshooting

### No highlights appearing

1. Check Anki is running with AnkiConnect installed
2. Verify vocabulary sources are configured in Options
3. Check the page isn't in your ignore list
4. Try toggling highlights with `Ctrl+Shift+H`

### AnkiConnect not connecting

1. Ensure Anki is running
2. Check AnkiConnect URL in Options (default: `http://127.0.0.1:8765`)
3. Try accessing `http://127.0.0.1:8765` in browser—should show AnkiConnect version

### Wrong words highlighted

1. Verify the correct field is selected for your deck
2. Check your deck actually contains the expected vocabulary
3. Try forcing a sync from the popup

## Development

```bash
bun run dev      # Development build with hot reload
bun run build    # Production build
bun run preview  # Preview production build
```

### Project Structure

```
src/
├── background/     # Service worker, vocab sync, analytics services
├── content/        # DOM processing, highlighting, encounter tracking
├── dashboard/      # Analytics dashboard (external page)
├── options/        # Settings page
├── popup/          # Extension popup
├── sidepanel/      # Side panel with live stats
└── shared/         # Types, Anki client, frequency data, database
```

### Tech Stack

- **TypeScript** with strict mode
- **Vite** with CRXJS plugin for Chrome extension bundling
- **Dexie** for IndexedDB wrapper
- **Chart.js** for dashboard visualizations

## Browser Compatibility

| Feature | Chrome 135+ | Chrome 105-134 |
|---------|-------------|----------------|
| Highlighting | CSS Highlight API | Span fallback |
| Word Actions | Full | Limited |
| Stats/Tracking | Full | Full |

## Acknowledgments

- **[Yomitan](https://github.com/themoeway/yomitan)** - Seer's word finding uses Yomitan's longest-match-first algorithm and deinflection rules for accurate Japanese text parsing
- **[JMdict-simplified](https://github.com/scriptin/jmdict-simplified)** - Word validation dictionary data
- **[JPDB](https://jpdb.io)** - Frequency rankings (v2.2)
- **[Dictionary of Japanese Grammar](https://github.com/kenrick95/itazuraneko)** - Grammar pattern data

## Related Tools

- [Yomitan](https://github.com/themoeway/yomitan) - Pop-up dictionary (recommended companion)
- [AnkiConnect](https://ankiweb.net/shared/info/2055492159) - Anki add-on for external integrations
- [asbplayer](https://github.com/killergerbah/asbplayer) - Video player for mining subtitled content

## License

ISC
