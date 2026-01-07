import { containsJapanese } from '../shared/normalization';

const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA',
  'CODE', 'PRE', 'INPUT', 'SVG', 'MATH', 'CANVAS', 'IFRAME'
]);

// Support multiple Mokuro implementations
const MOKURO_SELECTORS = [
  '.textBox',      // Standard Mokuro
  '.ocrtext',      // Bilingualmanga
] as const;

// Detect if page is using Mokuro reader (auto-detection)
export function isMokuroPage(): boolean {
  return MOKURO_SELECTORS.some(sel => document.querySelector(sel) !== null) ||
         document.querySelector('.pageContainer') !== null;
}

// Get text nodes from Mokuro textboxes specifically
export function* walkMokuroTextNodes(): Generator<Text> {
  // Try each selector
  for (const selector of MOKURO_SELECTORS) {
    const containers = document.querySelectorAll(selector);
    for (const container of containers) {
      // Walk all text nodes inside container, including hidden <p> elements
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
          acceptNode(node) {
            // Skip elements with data-seer-ignore
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.hasAttribute('data-seer-ignore')) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_SKIP;
            }

            // Check parent for data-seer-ignore (for text nodes)
            if (node.parentElement?.closest('[data-seer-ignore]')) {
              return NodeFilter.FILTER_REJECT;
            }

            const text = node.textContent?.trim();
            if (!text || !containsJapanese(text)) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node: Node | null;
      while ((node = walker.nextNode())) {
        yield node as Text;
      }
    }
  }
}

export function* walkTextNodes(root: Node = document.body): Generator<Text> {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;

          // Skip excluded tags entirely
          if (EXCLUDED_TAGS.has(element.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip elements marked to be ignored by Seer (e.g., grammar mode UI)
          if (element.hasAttribute('data-seer-ignore')) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip contenteditable
          if (element.hasAttribute('contenteditable')) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip hidden elements
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_SKIP;
        }

        // Text node - check if it has Japanese
        const text = node.textContent?.trim();
        if (!text || !containsJapanese(text)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    yield node as Text;
  }
}
