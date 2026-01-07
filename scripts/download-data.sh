#!/bin/bash
# Downloads required data files for Seer development
# Run from project root: ./scripts/download-data.sh

set -e

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPTS_DIR"

echo "Downloading JMdict data files..."

# JMdict-simplified release version
JMDICT_VERSION="3.6.1"

# Download jmdict-eng (full English dictionary ~115MB uncompressed)
if [ ! -f "jmdict-eng-${JMDICT_VERSION}.json" ]; then
    echo "Downloading jmdict-eng..."
    curl -L "https://github.com/scriptin/jmdict-simplified/releases/latest/download/jmdict-eng-${JMDICT_VERSION}.json.tgz" -o jmdict-eng.json.tgz
    echo "Extracting..."
    tar -xzf jmdict-eng.json.tgz
    # Rename to consistent name
    mv jmdict-eng-*.json "jmdict-eng-${JMDICT_VERSION}.json" 2>/dev/null || true
    echo "Done: jmdict-eng-${JMDICT_VERSION}.json"
else
    echo "jmdict-eng-${JMDICT_VERSION}.json already exists, skipping"
fi

# Download jmdict-eng-common (common words only, smaller)
if [ ! -f "jmdict-eng-common-${JMDICT_VERSION}.json" ]; then
    echo "Downloading jmdict-eng-common..."
    curl -L "https://github.com/scriptin/jmdict-simplified/releases/latest/download/jmdict-eng-common-${JMDICT_VERSION}.json.tgz" -o jmdict-eng-common.json.tgz
    echo "Extracting..."
    tar -xzf jmdict-eng-common.json.tgz
    mv jmdict-eng-common-*.json "jmdict-eng-common-${JMDICT_VERSION}.json" 2>/dev/null || true
    echo "Done: jmdict-eng-common-${JMDICT_VERSION}.json"
else
    echo "jmdict-eng-common-${JMDICT_VERSION}.json already exists, skipping"
fi

echo ""
echo "All data files downloaded to scripts/"
echo ""
echo "Next steps:"
echo "  1. Generate wordlist: bun scripts/generate-wordlist.ts"
echo "  2. Build extension:   bun run build"
