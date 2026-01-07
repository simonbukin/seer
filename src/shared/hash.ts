/**
 * FNV-1a hash algorithm
 * Fast, non-cryptographic 32-bit hash for URL deduplication
 *
 * Used to quickly compare page URLs without string comparison
 * Perfect for IndexedDB indexes (integer comparison is faster than string)
 *
 * @param str - String to hash
 * @returns Unsigned 32-bit integer hash
 */
export function fnv1a(str: string): number {
  let hash = 2166136261; // FNV offset basis

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }

  return hash >>> 0; // Convert to unsigned 32-bit integer
}
