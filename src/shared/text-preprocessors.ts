/**
 * Japanese Text Preprocessors
 * Ported from Yomitan (https://github.com/yomidevs/yomitan)
 *
 * Copyright (C) 2024-2025 Yomitan Authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Hiragana/Katakana conversion ranges
const HIRAGANA_CONVERSION_RANGE: [number, number] = [0x3041, 0x3096];
const KATAKANA_CONVERSION_RANGE: [number, number] = [0x30a1, 0x30f6];
const KANA_PROLONGED_SOUND_MARK = 0x30fc;

/**
 * Check if a code point is in a given range
 */
function isCodePointInRange(codePoint: number, range: [number, number]): boolean {
  return codePoint >= range[0] && codePoint <= range[1];
}

/**
 * Convert katakana to hiragana
 */
export function convertKatakanaToHiragana(text: string): string {
  let result = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (isCodePointInRange(codePoint, KATAKANA_CONVERSION_RANGE)) {
      result += String.fromCodePoint(codePoint - 0x60); // Katakana to Hiragana offset
    } else if (codePoint === KANA_PROLONGED_SOUND_MARK) {
      result += 'ー';
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Convert hiragana to katakana
 */
export function convertHiraganaToKatakana(text: string): string {
  let result = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (isCodePointInRange(codePoint, HIRAGANA_CONVERSION_RANGE)) {
      result += String.fromCodePoint(codePoint + 0x60); // Hiragana to Katakana offset
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Convert half-width katakana to full-width
 */
export function convertHalfWidthKanaToFullWidth(text: string): string {
  const HALFWIDTH_KATAKANA_MAPPING = new Map([
    ['･', '・'],
    ['ｦ', 'ヲ'],
    ['ｧ', 'ァ'],
    ['ｨ', 'ィ'],
    ['ｩ', 'ゥ'],
    ['ｪ', 'ェ'],
    ['ｫ', 'ォ'],
    ['ｬ', 'ャ'],
    ['ｭ', 'ュ'],
    ['ｮ', 'ョ'],
    ['ｯ', 'ッ'],
    ['ｰ', 'ー'],
    ['ｱ', 'ア'],
    ['ｲ', 'イ'],
    ['ｳ', 'ウ'],
    ['ｴ', 'エ'],
    ['ｵ', 'オ'],
    ['ｶ', 'カ'],
    ['ｷ', 'キ'],
    ['ｸ', 'ク'],
    ['ｹ', 'ケ'],
    ['ｺ', 'コ'],
    ['ｻ', 'サ'],
    ['ｼ', 'シ'],
    ['ｽ', 'ス'],
    ['ｾ', 'セ'],
    ['ｿ', 'ソ'],
    ['ﾀ', 'タ'],
    ['ﾁ', 'チ'],
    ['ﾂ', 'ツ'],
    ['ﾃ', 'テ'],
    ['ﾄ', 'ト'],
    ['ﾅ', 'ナ'],
    ['ﾆ', 'ニ'],
    ['ﾇ', 'ヌ'],
    ['ﾈ', 'ネ'],
    ['ﾉ', 'ノ'],
    ['ﾊ', 'ハ'],
    ['ﾋ', 'ヒ'],
    ['ﾌ', 'フ'],
    ['ﾍ', 'ヘ'],
    ['ﾎ', 'ホ'],
    ['ﾏ', 'マ'],
    ['ﾐ', 'ミ'],
    ['ﾑ', 'ム'],
    ['ﾒ', 'メ'],
    ['ﾓ', 'モ'],
    ['ﾔ', 'ヤ'],
    ['ﾕ', 'ユ'],
    ['ﾖ', 'ヨ'],
    ['ﾗ', 'ラ'],
    ['ﾘ', 'リ'],
    ['ﾙ', 'ル'],
    ['ﾚ', 'レ'],
    ['ﾛ', 'ロ'],
    ['ﾜ', 'ワ'],
    ['ﾝ', 'ン'],
  ]);

  let result = '';
  for (const char of text) {
    result += HALFWIDTH_KATAKANA_MAPPING.get(char) || char;
  }
  return result;
}

/**
 * Collapse emphatic character sequences
 * すっっごーーい → すっごーい (partial) or すごい (full)
 */
export function collapseEmphaticSequences(text: string, full: boolean): string {
  const HIRAGANA_SMALL_TSU = 'っ';
  const KATAKANA_SMALL_TSU = 'ッ';
  const PROLONGED_SOUND_MARK = 'ー';

  let result = '';
  let lastChar = '';
  let repeatCount = 0;

  for (const char of text) {
    if (char === lastChar) {
      repeatCount++;
      if (full) {
        // Skip repeated characters entirely
        if (
          char === HIRAGANA_SMALL_TSU ||
          char === KATAKANA_SMALL_TSU ||
          char === PROLONGED_SOUND_MARK
        ) {
          continue;
        }
      } else {
        // Collapse to maximum of 2 repetitions
        if (repeatCount >= 2) continue;
      }
    } else {
      repeatCount = 1;
    }
    lastChar = char;
    result += char;
  }
  return result;
}

/**
 * Normalize combining characters (NFD → NFC)
 * ド (U+30C8 U+3099) → ド (U+30C9)
 */
export function normalizeCombiningCharacters(text: string): string {
  return text.normalize('NFC');
}

/**
 * Convert full-width alphanumeric to normal ASCII
 */
export function convertFullWidthAlphanumericToNormal(text: string): string {
  let result = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    // Full-width digits (０-９)
    if (codePoint >= 0xff10 && codePoint <= 0xff19) {
      result += String.fromCodePoint(codePoint - 0xff10 + 0x30);
    }
    // Full-width uppercase (Ａ-Ｚ)
    else if (codePoint >= 0xff21 && codePoint <= 0xff3a) {
      result += String.fromCodePoint(codePoint - 0xff21 + 0x41);
    }
    // Full-width lowercase (ａ-ｚ)
    else if (codePoint >= 0xff41 && codePoint <= 0xff5a) {
      result += String.fromCodePoint(codePoint - 0xff41 + 0x61);
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Preprocessing options for text normalization
 */
export interface TextPreprocessingOptions {
  convertHalfWidthToFullWidth?: boolean;
  convertHiraganaToKatakana?: 'off' | 'direct' | 'inverse';
  collapseEmphaticSequences?: boolean;
  collapseEmphaticSequencesFull?: boolean;
  normalizeCombiningCharacters?: boolean;
  convertFullWidthAlphanumeric?: boolean;
}

/**
 * Apply text preprocessing based on options
 */
export function preprocessText(text: string, options: TextPreprocessingOptions = {}): string {
  let result = text;

  if (options.convertHalfWidthToFullWidth) {
    result = convertHalfWidthKanaToFullWidth(result);
  }

  if (options.convertHiraganaToKatakana === 'direct') {
    result = convertHiraganaToKatakana(result);
  } else if (options.convertHiraganaToKatakana === 'inverse') {
    result = convertKatakanaToHiragana(result);
  }

  if (options.collapseEmphaticSequences) {
    result = collapseEmphaticSequences(result, options.collapseEmphaticSequencesFull ?? false);
  }

  if (options.normalizeCombiningCharacters) {
    result = normalizeCombiningCharacters(result);
  }

  if (options.convertFullWidthAlphanumeric) {
    result = convertFullWidthAlphanumericToNormal(result);
  }

  return result;
}

/**
 * Generate text variants for matching (hiragana and katakana versions)
 */
export function getTextVariants(text: string): string[] {
  const variants = new Set<string>([text]);

  // Add hiragana version
  const hiragana = convertKatakanaToHiragana(text);
  variants.add(hiragana);

  // Add katakana version
  const katakana = convertHiraganaToKatakana(text);
  variants.add(katakana);

  return Array.from(variants);
}
