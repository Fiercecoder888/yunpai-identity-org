export type RecentSearchItem = {
  key: string;
  kind: 'page' | SearchEntityKind;
  label: string;
  path?: string;
  hint?: string;
};

export type SearchEntityKind = 'order' | 'material' | 'supplier' | 'operation';

const RECENT_KEY = 'yunpai.command.recent';
export const RECENT_LIMIT = 10;

const isRecentItem = (value: unknown): value is RecentSearchItem => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.key === 'string' && typeof candidate.label === 'string';
};

export function readRecent(): RecentSearchItem[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentItem).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: RecentSearchItem): RecentSearchItem[] {
  const next = [item, ...readRecent().filter((entry) => entry.key !== item.key)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable（隐私模式/受限环境）时静默失败，不影响搜索。
  }
  return next;
}
