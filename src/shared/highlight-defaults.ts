import type { HighlightLayerConfig, HighlightConfig, KnowledgeLevel } from './types';

// Default layer configurations for the 14 highlight layers
// Priority: lower = rendered first (bottom), higher = rendered on top

const frequencyLayers: HighlightLayerConfig[] = [
  {
    id: 'freq-very-common',
    label: 'Very Common (1-1K)',
    category: 'frequency',
    enabled: true,
    styleType: 'background',
    color: 'rgba(96, 165, 250, 0.35)',  // Blue-400
    priority: 10,
  },
  {
    id: 'freq-common',
    label: 'Common (1K-5K)',
    category: 'frequency',
    enabled: true,
    styleType: 'background',
    color: 'rgba(34, 211, 238, 0.35)',  // Cyan-400
    priority: 11,
  },
  {
    id: 'freq-medium',
    label: 'Medium (5K-15K)',
    category: 'frequency',
    enabled: true,
    styleType: 'background',
    color: 'rgba(250, 204, 21, 0.35)',  // Yellow-400
    priority: 12,
  },
  {
    id: 'freq-uncommon',
    label: 'Uncommon (15K-50K)',
    category: 'frequency',
    enabled: true,
    styleType: 'background',
    color: 'rgba(251, 146, 60, 0.35)',  // Orange-400
    priority: 13,
  },
  {
    id: 'freq-rare',
    label: 'Rare (50K+)',
    category: 'frequency',
    enabled: true,
    styleType: 'background',
    color: 'rgba(248, 113, 113, 0.35)',  // Red-400
    priority: 14,
  },
];

const statusLayers: HighlightLayerConfig[] = [
  {
    id: 'status-unknown',
    label: 'Unknown',
    category: 'status',
    enabled: false,  // Off by default (frequency colors already show unknown)
    styleType: 'background',
    color: 'rgba(239, 68, 68, 0.15)',  // Red-500
    priority: 1,  // Bottom layer
  },
  {
    id: 'status-known',
    label: 'Known',
    category: 'status',
    enabled: false,
    styleType: 'background',
    color: 'rgba(34, 197, 94, 0.15)',  // Green-500
    priority: 2,
  },
  {
    id: 'status-ignored',
    label: 'Ignored',
    category: 'status',
    enabled: false,
    styleType: 'background',
    color: 'rgba(148, 163, 184, 0.15)',  // Slate-400
    priority: 3,
  },
];

// Knowledge level layers (based on Anki review state)
// Pastel colors for visual distinction
const knowledgeLayers: HighlightLayerConfig[] = [
  {
    id: 'knowledge-new',
    label: 'New (In Anki)',
    category: 'knowledge',
    enabled: false,
    styleType: 'background',
    color: 'rgba(196, 181, 253, 0.35)',  // Pastel purple (Violet-300)
    priority: 4,
  },
  {
    id: 'knowledge-learning',
    label: 'Learning',
    category: 'knowledge',
    enabled: false,
    styleType: 'background',
    color: 'rgba(253, 186, 116, 0.35)',  // Pastel orange (Orange-300)
    priority: 5,
  },
  {
    id: 'knowledge-young',
    label: 'Young',
    category: 'knowledge',
    enabled: false,
    styleType: 'background',
    color: 'rgba(147, 197, 253, 0.35)',  // Pastel blue (Blue-300)
    priority: 6,
  },
  {
    id: 'knowledge-mature',
    label: 'Mature',
    category: 'knowledge',
    enabled: false,
    styleType: 'background',
    color: 'rgba(134, 239, 172, 0.35)',  // Pastel green (Green-300)
    priority: 7,
  },
];

// Build the layers record
function buildLayersRecord(): Record<string, HighlightLayerConfig> {
  const layers: Record<string, HighlightLayerConfig> = {};

  for (const layer of [...statusLayers, ...knowledgeLayers, ...frequencyLayers]) {
    layers[layer.id] = layer;
  }

  return layers;
}

export const DEFAULT_HIGHLIGHT_CONFIG: HighlightConfig = {
  globalEnabled: true,
  layers: buildLayersRecord(),
};

// Helper to get layers by category
export function getLayersByCategory(config: HighlightConfig, category: HighlightLayerConfig['category']): HighlightLayerConfig[] {
  return Object.values(config.layers)
    .filter(l => l.category === category)
    .sort((a, b) => a.priority - b.priority);
}

// All layer IDs in order
export const ALL_LAYER_IDS = [
  // Status (bottom)
  'status-unknown', 'status-known', 'status-ignored',
  // Knowledge levels
  'knowledge-new', 'knowledge-learning', 'knowledge-young', 'knowledge-mature',
  // Frequency (top)
  'freq-very-common', 'freq-common', 'freq-medium', 'freq-uncommon', 'freq-rare',
] as const;

export type LayerId = typeof ALL_LAYER_IDS[number];

// Map frequency rank to layer ID
export function getFrequencyLayerId(rank: number | undefined): LayerId | null {
  if (rank === undefined || rank <= 0) return null;
  if (rank <= 1000) return 'freq-very-common';
  if (rank <= 5000) return 'freq-common';
  if (rank <= 15000) return 'freq-medium';
  if (rank <= 50000) return 'freq-uncommon';
  return 'freq-rare';
}

// Map status to layer ID
export function getStatusLayerId(status: 'known' | 'unknown' | 'ignored'): LayerId {
  return `status-${status}` as LayerId;
}

// Map knowledge level to layer ID
export function getKnowledgeLayerId(level: KnowledgeLevel): LayerId {
  return `knowledge-${level}` as LayerId;
}
