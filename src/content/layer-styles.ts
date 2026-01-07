import type { HighlightLayerConfig, HighlightConfig } from '../shared/types';

const STYLE_ELEMENT_ID = 'seer-layer-styles';

/**
 * Animation keyframes for highlight fade-in effect
 */
const ANIMATION_KEYFRAMES = `
@keyframes seer-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
`;

/**
 * Generate CSS for a single highlight layer
 */
function generateLayerCSS(layer: HighlightLayerConfig): string {
  const highlightName = `seer-${layer.id}`;

  if (!layer.enabled || layer.styleType === 'none') {
    // Disabled layers get transparent/invisible styles
    return `::highlight(${highlightName}) {
  background-color: transparent !important;
  text-decoration: none !important;
  color: inherit !important;
}`;
  }

  const rules: string[] = [];

  // Add text color if specified (combinable with any style type)
  if (layer.textColor) {
    rules.push(`color: ${layer.textColor}`);
  }

  switch (layer.styleType) {
    case 'background':
      rules.push(`background-color: ${layer.color}`);
      break;

    case 'underline':
      rules.push(`text-decoration: underline`);
      rules.push(`text-decoration-color: ${layer.color}`);
      rules.push(`text-decoration-style: ${layer.underlineStyle || 'solid'}`);
      rules.push(`text-decoration-thickness: ${layer.underlineThickness || 2}px`);
      rules.push(`text-underline-offset: 2px`);
      // Use 'auto' to let browser decide position based on writing mode
      // 'under left' has inconsistent browser support
      rules.push(`text-underline-position: auto`);
      break;

    case 'outline':
      // CSS Highlight API doesn't support outline, use underline as fallback
      rules.push(`text-decoration: underline`);
      rules.push(`text-decoration-color: ${layer.color}`);
      rules.push(`text-decoration-style: double`);
      rules.push(`text-decoration-thickness: 1px`);
      rules.push(`text-underline-offset: 2px`);
      // Use 'auto' to let browser decide position based on writing mode
      rules.push(`text-underline-position: auto`);
      break;
  }

  return `::highlight(${highlightName}) {
  ${rules.join(';\n  ')};
}`;
}

/**
 * Generate all CSS rules from a highlight config
 */
export function generateAllLayerCSS(config: HighlightConfig): string {
  if (!config.globalEnabled) {
    // Global disable - hide all highlights
    return Object.keys(config.layers)
      .map(id => `::highlight(seer-${id}) { background-color: transparent !important; text-decoration: none !important; color: inherit !important; }`)
      .join('\n');
  }

  // Sort layers by priority for proper stacking
  const sortedLayers = Object.values(config.layers).sort((a, b) => a.priority - b.priority);

  return sortedLayers.map(generateLayerCSS).join('\n\n');
}

/**
 * Inject or update layer styles in the document
 */
export function injectLayerStyles(config: HighlightConfig): void {
  let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleEl);
  }

  // Include animation keyframes + layer CSS
  styleEl.textContent = ANIMATION_KEYFRAMES + '\n\n' + generateAllLayerCSS(config);
}

/**
 * Update a single layer's CSS (faster than regenerating all)
 */
export function updateLayerStyle(layerId: string, layer: HighlightLayerConfig): void {
  const styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!styleEl) return;

  const highlightName = `seer-${layerId}`;
  const newRule = generateLayerCSS(layer);

  // Find and replace the existing rule for this layer
  const css = styleEl.textContent || '';
  const regex = new RegExp(`::highlight\\(${highlightName}\\)\\s*\\{[^}]*\\}`, 'g');

  if (regex.test(css)) {
    styleEl.textContent = css.replace(regex, newRule);
  } else {
    // Layer rule doesn't exist yet, append it
    styleEl.textContent = css + '\n\n' + newRule;
  }
}

/**
 * Toggle a layer's visibility via CSS only (no re-tokenization needed)
 */
export function toggleLayerCSS(layerId: string, enabled: boolean, layer: HighlightLayerConfig): void {
  const updatedLayer = { ...layer, enabled };
  updateLayerStyle(layerId, updatedLayer);
}

/**
 * Remove all layer styles
 */
export function removeLayerStyles(): void {
  const styleEl = document.getElementById(STYLE_ELEMENT_ID);
  styleEl?.remove();
}
