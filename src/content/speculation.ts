/**
 * Speculation Rules API Integration
 *
 * Uses browser-native prefetch/prerender to pre-load Japanese pages
 * Enables zero-latency highlighting when user navigates
 */

/**
 * Detect if a URL likely leads to Japanese content
 */
function looksJapanese(url: string): boolean {
  const jpPatterns = [
    /\.jp$/,                          // Japanese TLD
    /wikipedia\.org\/.*\/ja/,         // Japanese Wikipedia
    /nhk\.or\.jp/,                    // NHK News
    /yahoo\.co\.jp/,                  // Yahoo Japan
    /rakuten\.co\.jp/,                // Rakuten
    /amazon\.co\.jp/,                 // Amazon Japan
    /note\.com/,                      // note (popular Japanese blogging)
    /hatena\.ne\.jp/,                 // Hatena
    /bunshun\.jp/,                    // Bungeishunju
  ];

  return jpPatterns.some(pattern => pattern.test(url));
}

/**
 * Check if link text contains Japanese characters
 */
function hasJapaneseText(link: HTMLAnchorElement): boolean {
  const text = link.textContent || '';
  return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
}

/**
 * Find Japanese links on the current page
 *
 * @returns Array of URLs to prefetch/prerender
 */
export function findJapaneseLinks(): string[] {
  const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];

  return links
    .filter(link => {
      const url = link.href;
      return (looksJapanese(url) || hasJapaneseText(link)) &&
             url.startsWith('http'); // External links only
    })
    .map(link => link.href)
    .slice(0, 5); // Chrome limit: 2 eager + 2 moderate prerenders
}

/**
 * Inject speculation rules for Japanese links
 * This tells the browser to prefetch/prerender these pages
 */
export function injectSpeculationRules(): void {
  const japaneseLinks = findJapaneseLinks();

  if (japaneseLinks.length === 0) {
    console.log('[Seer Speculation] No Japanese links found on page');
    return;
  }

  const rules = {
    // Prefetch: Download HTML only (lightweight)
    prefetch: [{
      source: "list",
      urls: japaneseLinks,
      eagerness: "moderate" // Triggers on ~200ms hover
    }],
    // Prerender: Full page load (heavier, but instant navigation)
    prerender: [{
      source: "document",
      where: {
        and: [
          { href_matches: "/*" },
          { or: [
            { selector_matches: "a[href*='japanese']" },
            { selector_matches: "a[hreflang='ja']" },
            { selector_matches: "a[href$='.jp']" }
          ]}
        ]
      },
      eagerness: "conservative" // Triggers on pointerdown (click started)
    }]
  };

  const script = document.createElement('script');
  script.type = 'speculationrules';
  script.textContent = JSON.stringify(rules);
  document.head.appendChild(script);

  console.log(`[Seer Speculation] Injected speculation rules for ${japaneseLinks.length} links:`, japaneseLinks);
}

/**
 * Check if Speculation Rules API is supported
 */
export function isSpeculationSupported(): boolean {
  return 'supports' in HTMLScriptElement &&
         HTMLScriptElement.supports('speculationrules');
}
