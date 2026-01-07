#!/usr/bin/env python3
"""
Generate Seer extension icons with a kanji character.
Requires: pip install pillow
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Configuration
KANJI = "視"  # "See" - matches "Seer" name
BACKGROUND_COLOR = (59, 130, 246)  # Blue-500 (#3B82F6)
TEXT_COLOR = (255, 255, 255)  # White
SIZES = [16, 48, 128]
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")


def find_font():
    """Find a Japanese font on the system."""
    font_paths = [
        # macOS
        "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        # Linux
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        # Windows
        "C:\\Windows\\Fonts\\msgothic.ttc",
        "C:\\Windows\\Fonts\\meiryo.ttc",
        "C:\\Windows\\Fonts\\YuGothM.ttc",
    ]

    for path in font_paths:
        if os.path.exists(path):
            return path

    raise FileNotFoundError(
        "No Japanese font found. Install a CJK font like Noto Sans CJK."
    )


def generate_icon(size: int, kanji: str, font_path: str) -> Image.Image:
    """Generate a single icon at the specified size."""
    # Create image with background
    img = Image.new("RGBA", (size, size), BACKGROUND_COLOR + (255,))
    draw = ImageDraw.Draw(img)

    # Calculate font size (roughly 65% of icon size for good centering)
    font_size = int(size * 0.65)
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception as e:
        print(f"Warning: Could not load font at size {font_size}: {e}")
        font = ImageFont.load_default()

    # Get text bounding box for centering
    bbox = draw.textbbox((0, 0), kanji, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    # Center the text
    x = (size - text_width) // 2 - bbox[0]
    y = (size - text_height) // 2 - bbox[1]

    # Draw the kanji
    draw.text((x, y), kanji, fill=TEXT_COLOR, font=font)

    # Add rounded corners for larger sizes
    if size >= 48:
        # Create a rounded rectangle mask
        mask = Image.new("L", (size, size), 0)
        mask_draw = ImageDraw.Draw(mask)
        radius = size // 6
        mask_draw.rounded_rectangle(
            [(0, 0), (size - 1, size - 1)], radius=radius, fill=255
        )

        # Apply mask
        output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        output.paste(img, mask=mask)
        return output

    return img


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        font_path = find_font()
        print(f"Using font: {font_path}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Please install a Japanese font and try again.")
        return 1

    for size in SIZES:
        icon = generate_icon(size, KANJI, font_path)
        output_path = os.path.join(OUTPUT_DIR, f"icon{size}.png")
        icon.save(output_path, "PNG")
        print(f"Generated: {output_path}")

    print("\nDone! Icons generated successfully.")
    return 0


if __name__ == "__main__":
    exit(main())
