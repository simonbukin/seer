#!/bin/bash

echo "🔍 Verifying Seer Extension Build"
echo "=================================="
echo ""

cd "$(dirname "$0")"

# Check if dist exists
if [ ! -d "dist" ]; then
    echo "❌ dist/ folder not found. Run 'npm run build' first."
    exit 1
fi

echo "✅ dist/ folder exists"

# Check manifest
if [ ! -f "dist/manifest.json" ]; then
    echo "❌ manifest.json missing"
    exit 1
fi
echo "✅ manifest.json exists"

# Check CSS
if [ ! -f "dist/src/styles/highlights.css" ]; then
    echo "❌ CSS file missing (dist/src/styles/highlights.css)"
    exit 1
fi
echo "✅ CSS file exists"

# Check HTML files
for file in "src/popup/popup.html" "src/options/options.html" "src/offscreen/offscreen.html"; do
    if [ ! -f "dist/$file" ]; then
        echo "❌ Missing: dist/$file"
        exit 1
    fi
done
echo "✅ All HTML files exist"

# Check icons
for size in 16 48 128; do
    if [ ! -f "dist/icons/icon${size}.png" ]; then
        echo "❌ Missing icon: dist/icons/icon${size}.png"
        exit 1
    fi
done
echo "✅ All icons exist"

# Check dictionary
if [ ! -d "dist/dict" ] || [ -z "$(ls -A dist/dict)" ]; then
    echo "❌ Dictionary files missing in dist/dict/"
    exit 1
fi
echo "✅ Dictionary files exist ($(ls dist/dict | wc -l | xargs) files)"

# Check service worker
if [ ! -f "dist/service-worker-loader.js" ]; then
    echo "❌ Service worker missing"
    exit 1
fi
echo "✅ Service worker exists"

# Check for critical JS bundles
if [ -z "$(ls dist/assets/*.js 2>/dev/null)" ]; then
    echo "❌ No JavaScript bundles found in dist/assets/"
    exit 1
fi
echo "✅ JavaScript bundles exist ($(ls dist/assets/*.js | wc -l | xargs) files)"

echo ""
echo "✨ Build verification complete!"
echo ""
echo "📁 Extension location: $(pwd)/dist"
echo ""
echo "Next steps:"
echo "1. Open Chrome: chrome://extensions/"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked'"
echo "4. Select: $(pwd)/dist"
echo ""
