import type { ProcessedToken } from '../shared/types';

// Store token metadata for each Range (for word actions)
const rangeTokenMap = new WeakMap<Range, ProcessedToken>();

// Reverse index: baseForm -> Set of Ranges (for surgical removal)
const wordToRanges = new Map<string, Set<Range>>();

// Export helper to get token from a range
export function getTokenForRange(range: Range): ProcessedToken | undefined {
  return rangeTokenMap.get(range);
}

// Export helper to get token from any range in a highlight
export function getTokenFromHighlight(highlight: Highlight): ProcessedToken | undefined {
  // Iterate through the highlight's ranges to find first token
  for (const range of highlight) {
    const token = rangeTokenMap.get(range as Range);
    if (token) return token;
  }
  return undefined;
}

// Store token for a range (called from layer-manager)
export function setTokenForRange(range: Range, token: ProcessedToken): void {
  rangeTokenMap.set(range, token);

  // Add to reverse index for surgical removal
  if (!wordToRanges.has(token.baseForm)) {
    wordToRanges.set(token.baseForm, new Set());
  }
  wordToRanges.get(token.baseForm)!.add(range);
}

// Get all ranges for a word (for surgical removal)
export function getRangesForWord(baseForm: string): Set<Range> | undefined {
  return wordToRanges.get(baseForm);
}

// Clear ranges for a specific word
export function clearWordRanges(baseForm: string): void {
  const ranges = wordToRanges.get(baseForm);
  if (ranges) {
    for (const range of ranges) {
      rangeTokenMap.delete(range);
    }
    wordToRanges.delete(baseForm);
  }
}

// Clear all word ranges (for full page reprocess)
export function clearAllWordRanges(): void {
  wordToRanges.clear();
  // Note: rangeTokenMap is a WeakMap, it will be garbage collected
}
