import { describe, expect, it } from 'vitest';
import { buildIndex, cacheIndex, clearIndexCache, getCachedIndex, isIndexStale, searchIndex, SEARCH_INDEX_TTL_MS, type SearchEntry } from './searchIndex';

const entry = (overrides: Partial<SearchEntry> & Pick<SearchEntry, 'id' | 'type' | 'label'>): SearchEntry => ({
  keywords: [overrides.label],
  ...overrides,
});

describe('searchIndex', () => {
  it('matches label and keywords with case-insensitive containment', () => {
    const index = buildIndex([
      entry({ id: 'm1', type: 'material', label: '轴承', keywords: ['MAT-001', '轴承'] }),
      entry({ id: 'm2', type: 'material', label: '联轴器', keywords: ['MAT-002', '联轴器'] }),
    ]);
    expect(searchIndex(index, 'MAT-001').map((item) => item.id)).toEqual(['m1']);
    expect(searchIndex(index, '轴承').map((item) => item.id)).toEqual(['m1']);
    expect(searchIndex(index, 'mat-0').map((item) => item.id)).toEqual(['m1', 'm2']);
  });

  it('returns an empty result for a blank query', () => {
    const index = buildIndex([entry({ id: 'o1', type: 'order', label: 'SO-001' })]);
    expect(searchIndex(index, '')).toEqual([]);
    expect(searchIndex(index, '   ')).toEqual([]);
  });

  it('honors the result limit', () => {
    const index = buildIndex(
      Array.from({ length: 10 }, (_, index) => entry({ id: `e${index}`, type: 'order', label: `MAT-${index}` })),
    );
    expect(searchIndex(index, 'mat', 3)).toHaveLength(3);
  });
});

describe('search cache', () => {
  it('marks a missing or expired index as stale', () => {
    expect(isIndexStale(null)).toBe(true);
    const now = 1_000_000;
    expect(isIndexStale(buildIndex([], now), now)).toBe(false);
    expect(isIndexStale(buildIndex([], now), now + SEARCH_INDEX_TTL_MS + 1)).toBe(true);
  });

  it('caches and retrieves the index for five minutes', () => {
    clearIndexCache();
    const now = 1_000_000;
    expect(getCachedIndex(now)).toBeNull();

    const index = cacheIndex(buildIndex([entry({ id: 's1', type: 'supplier', label: '供应商 A' })], now), now);
    expect(getCachedIndex(now)).toBe(index);

    expect(getCachedIndex(now + SEARCH_INDEX_TTL_MS + 1)).toBeNull();
    expect(getCachedIndex(now + SEARCH_INDEX_TTL_MS + 1)).toBeNull();

    clearIndexCache();
    expect(getCachedIndex(now)).toBeNull();
  });
});
