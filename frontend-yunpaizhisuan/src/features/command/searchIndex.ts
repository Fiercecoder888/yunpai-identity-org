export type SearchEntityType = 'order' | 'material' | 'supplier' | 'operation';

export type SearchEntry = {
  id: string;
  type: SearchEntityType;
  label: string;
  /** 参与包含匹配的关键词（大小写不敏感） */
  keywords: string[];
  /** 跳转路径；缺省表示仅展示 */
  path?: string;
  hint?: string;
  payload?: Record<string, unknown>;
};

export type SearchIndex = {
  entries: SearchEntry[];
  builtAt: number;
};

export const SEARCH_INDEX_TTL_MS = 5 * 60 * 1000;

export const searchEntityTypes: SearchEntityType[] = ['order', 'material', 'supplier', 'operation'];

export function buildIndex(entries: SearchEntry[], builtAt = Date.now()): SearchIndex {
  return { entries, builtAt };
}

/** 包含匹配：label 或任意 keyword 命中即返回，按索引顺序，最多 limit 条。 */
export function searchIndex(index: SearchIndex, query: string, limit = 50): SearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle || index.entries.length === 0) {
    return [];
  }
  const results: SearchEntry[] = [];
  for (const entry of index.entries) {
    if (results.length >= limit) {
      break;
    }
    if (
      entry.label.toLowerCase().includes(needle) ||
      entry.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
    ) {
      results.push(entry);
    }
  }
  return results;
}

export function isIndexStale(index: SearchIndex | null, now = Date.now(), ttlMs = SEARCH_INDEX_TTL_MS): boolean {
  return index === null || now - index.builtAt > ttlMs;
}

let memoryCache: { index: SearchIndex; expiresAt: number } | null = null;

export function getCachedIndex(now = Date.now()): SearchIndex | null {
  if (memoryCache === null) {
    return null;
  }
  if (now > memoryCache.expiresAt) {
    memoryCache = null;
    return null;
  }
  return memoryCache.index;
}

export function cacheIndex(index: SearchIndex, now = Date.now()): SearchIndex {
  memoryCache = { index, expiresAt: now + SEARCH_INDEX_TTL_MS };
  return index;
}

export function clearIndexCache(): void {
  memoryCache = null;
}
