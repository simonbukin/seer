# Icon Files

The extension requires PNG icon files. You have two options:

## Option 1: Convert the SVG
Convert icon.svg to PNG files:
```bash
# Using ImageMagick (install with: brew install imagemagick)
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```

## Option 2: Create your own icons
Create 16x16, 48x48, and 128x128 PNG files with your preferred design tool.

## Option 3: Use placeholder icons (temporary)
For now, we'll create minimal placeholder icons that Chrome will accept.
