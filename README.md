# Seer 🔮

Seer is a Chrome extension that highlights webpages with unknown words and helps you identify good targets for
mining in Anki.

# Caveats

This extension is scoped as a vocabulary tracker and a page highlighter. It is _just_ meant to let you easily evaluate the difficulty of content and identify words to mine more easily. Dictionary lookups should be done with a tool like [Yomitan](https://yomitan.wiki/). If you're mining video content, feel free to use [ASBPlayer](https://github.com/killergerbah/asbplayer)

# ⚠️ DISCLAIMER ⚠️ ️

️This extension is still under _heavy_ development and may not work as expected. No functionality or claims of stability are made. This is mostly for personal use at the moment, but I figured I'd share it with the community.

## Table of Contents

- [Installation](#installation)
- [Initial Setup](#initial-setup)
- [Usage](#usage)
- [Features](#features)
- [Troubleshooting](#troubleshooting)
- [Related Tools](#related-tools)

## Demo

[![Seer Demo](https://img.youtube.com/vi/ZzF3ENlepPA/maxresdefault.jpg)](https://www.youtube.com/watch?v=ZzF3ENlepPA)

## Installation

### From Source (Recommended for Development)

1. **Prerequisites**

   - [Node.js](https://nodejs.org/) (version 16 or higher)
   - [Chrome browser](https://www.google.com/chrome/)

2. **Clone and Build**

   ```bash
   git clone https://github.com/simonbukin/seer.git
   cd seer
   npm install
   npm run build
   ```

3. **Load Extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked" and select the `dist` folder
   - The Seer extension should now appear in your extensions list

## Initial Setup

Seer requires several components to function properly. Complete these steps in order:

### 1. Install AnkiConnect (Required)

1. Install [Anki](https://apps.ankiweb.net/) if you haven't already
2. Install the [AnkiConnect add-on](https://ankiweb.net/shared/info/2055492159):
   - In Anki: Tools → Add-ons → Get Add-ons
   - Enter code: `2055492159`
   - Restart Anki
3. Ensure Anki is running when using Seer. You can identify that it works by checking the Anki icon in the Options page after loading Seer.

### 2. Configure Extension Settings

1. **Access Options Page**

   - Right-click the Seer extension icon → "Options"
   - Or go to `chrome://extensions/` → Seer → "Extension options"

2. **Download Frequency Data**

   - This extension requires JPDB data to be downloaded. This can be done from the options page manually, though the extension should do this automatically if you don't have it.
   - This may take a few minutes and requires an internet connection
   - Data is stored locally for offline use

3. **Configure Vocabulary Sources**

   - Click "Add New Source" in the Vocabulary Sources section
   - **Source Name**: Give it a descriptive name (e.g., "Core 2K")
   - **Deck Name**: Select the deck you want to use for vocabulary tracking
   - **Field Name**: Select the field containing Japanese words (usually "Expression" or "Word")
   - Save the source

   The stats section should update with the number of words in the deck. Multiple sources can be configured (for example, if you have Kaishi 1.5k AND a mining deck)

4. **Set Up Ignored Words (Optional)**
   - Enable "ignored words functionality" if you want to mark words as ignored
   - Configure deck name (default: "SeerIgnored")
   - Set note type and field name
   - Click "Setup Deck & Note Type" to create the necessary Anki components. You can also select your own.

### 3. Verify Setup

1. **Check AnkiConnect Status**

   - In the options page, look for the Anki status indicator
   - Should show "Connected" with a green indicator
   - If red, ensure Anki is running and AnkiConnect is installed

2. **Test on a Japanese Website**
   - Visit any Japanese website (e.g., [NHK News](https://www3.nhk.or.jp/news/))
   - Unknown words should be highlighted based on your vocabulary sources
   - Click the extension icon to toggle highlights on/off

## Usage

### Basic Features

- **Word Highlighting**: Unknown words are automatically highlighted based on frequency and your Anki knowledge. Known or ignored words are not highlighted.
- **Stats Panel**: Click the floating stats button 🔮 to view reading statistics and quickly identify good pages for mining.
- **Ignore Words**: Alt+click any word to mark it as ignored

### Highlight Styles

Seer offers multiple highlighting styles (configurable in options):

- **Underline**: Subtle underline highlighting
- **Background**: Background color highlighting
- **Outline**: Border outline highlighting
- **Dots**: Dotted underline highlighting

### Frequency-Based Coloring

Words are color-coded by frequency:

- **Very Common** (1-1000): Light blue
- **Common** (1001-5000): Blue
- **Uncommon** (5001-15000): Orange
- **Rare** (15001-30000): Red
- **Very Rare** (30000+): Dark red

### i+1 Sentence Mode (⚠️ Super Buggy ⚠️)

Enable this mode to highlight sentences containing exactly one unknown word:

- Ideal for comprehensible input
- Helps identify optimal learning material
- Toggle via popup or options page

## Features

### Integration

- **AnkiConnect integration** for real-time deck synchronization
- **JPDB frequency data** for accurate word difficulty assessment
- **Works with [Yomitan](https://yomitan.wiki/)** for dictionary lookups and parsing

## Troubleshooting

### Common Issues

#### Extension Not Working

- **Check AnkiConnect**: Ensure Anki is running and AnkiConnect is installed
- **Verify permissions**: Extension needs access to all websites
- **Reload extension**: Go to `chrome://extensions/` and reload Seer
- **Check console**: Open DevTools (F12) and look for error messages

#### No Words Highlighted

- **Verify vocabulary sources**: Check that deck names and field names are correct
- **Test AnkiConnect**: Use the "Check Connection" button in options
- **Frequency data**: Wait for JPDB data to download completely

#### Highlighting Incorrect Words

- **Field configuration**: Ensure the field name matches your Anki deck structure
- **Deck selection**: Verify you're using the correct deck name
- **Data sync**: Try refreshing vocabulary sources in options

### Debug Mode

Enable debug mode in options for detailed logging:

1. Go to Options → Debug section
2. Enable "Debug Mode"
3. Open browser console (F12) to see detailed logs
4. Useful for diagnosing connection and parsing issues

### Getting Help

If you encounter issues:

1. Check the [Issues page](https://github.com/simonbukin/seer/issues) for known problems
2. Enable debug mode and check console logs
3. Create a new issue with:
   - Browser version
   - Extension version
   - Console error messages
   - Steps to reproduce

### Key Technologies

- **TypeScript** for type-safe JavaScript
- **esbuild** for fast compilation and bundling
- **Chrome Extensions Manifest V3**
- **IndexedDB** via Dexie for local data storage
- **Kuromoji** for Japanese text tokenization

## Related Tools

- **[Yomitan](https://yomitan.wiki/)**: Pop-up dictionary for Japanese (highly recommended companion)
- **[AnkiConnect](https://ankiweb.net/shared/info/2055492159)**: Anki add-on for external integrations
- **[JPDB](https://jpdb.io/)**: Japanese word frequency database (data source)
- **[ASBPlayer](https://github.com/killergerbah/asbplayer)**: Video player for mining content
