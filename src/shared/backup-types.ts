import type { Encounter, Page, Sentence, ComprehensionSnapshot } from './db';
import type { SeerConfig, VocabDataSerialized } from './types';

/**
 * Seer Backup Format v1
 * Single JSON file containing all user data
 */
export interface SeerBackupV1 {
  // Metadata
  version: 1;
  exportedAt: number;        // Unix timestamp
  seerVersion: string;       // Extension version from manifest

  // IndexedDB tables
  indexedDB: {
    encounters: Encounter[];
    pages: Page[];
    sentences: Sentence[];
    comprehensionSnapshots: ComprehensionSnapshot[];
  };

  // chrome.storage.local
  storage: {
    config: SeerConfig;
    vocabulary: VocabDataSerialized;
  };

  // Integrity checksums (SHA-256)
  checksums: {
    encounters: string;
    pages: string;
    sentences: string;
    comprehensionSnapshots: string;
    config: string;
    vocabulary: string;
  };
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    encounters: number;
    pages: number;
    sentences: number;
    comprehensionSnapshots: number;
    configFields: number;
    vocabWords: number;
  };
  checksumsPassed: boolean;
}

export type ConflictStrategy = 'replace' | 'merge' | 'skip';

export interface ImportOptions {
  conflictStrategy: ConflictStrategy;
  clearExisting: boolean;
}

export interface ImportResult {
  success: boolean;
  error?: string;
  imported: {
    encounters: number;
    pages: number;
    sentences: number;
    comprehensionSnapshots: number;
  };
  skipped: {
    encounters: number;
    pages: number;
    sentences: number;
    comprehensionSnapshots: number;
  };
}

export interface ExportResult {
  success: boolean;
  error?: string;
  data?: string;           // JSON string or base64 for compressed
  compressed?: boolean;
  filename?: string;
}

/**
 * Type guard for backup version 1
 */
export function isSeerBackupV1(data: unknown): data is SeerBackupV1 {
  if (typeof data !== 'object' || data === null) return false;

  const obj = data as Record<string, unknown>;

  return (
    obj.version === 1 &&
    typeof obj.exportedAt === 'number' &&
    typeof obj.seerVersion === 'string' &&
    typeof obj.indexedDB === 'object' &&
    typeof obj.storage === 'object'
  );
}
