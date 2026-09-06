import { beforeEach, describe, expect, it } from 'vitest';
import { RECENT_VISITS_STORAGE_KEY, useRecentVisitsStore } from './useRecentVisitsStore';

describe('useRecentVisitsStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useRecentVisitsStore.getState().resetVisits();
  });

  it('records recent visits most-recent-first and deduplicates by path', () => {
    useRecentVisitsStore.getState().recordVisit('/dashboard', 'Dashboard');
    useRecentVisitsStore.getState().recordVisit('/modules/m0-review', 'M0 文档解析审核');
    useRecentVisitsStore.getState().recordVisit('/dashboard', 'Dashboard');

    const recent = useRecentVisitsStore.getState().recent;
    expect(recent).toHaveLength(2);
    expect(recent.map((visit) => visit.path)).toEqual(['/dashboard', '/modules/m0-review']);
    expect(recent[0]).toMatchObject({ title: 'Dashboard', visitedAt: expect.any(Number) });
  });

  it('caps recent visits to eight entries', () => {
    for (let index = 0; index < 12; index += 1) {
      useRecentVisitsStore.getState().recordVisit(`/page-${index}`, `页面 ${index}`);
    }

    expect(useRecentVisitsStore.getState().recent).toHaveLength(8);
    expect(useRecentVisitsStore.getState().recent[0]?.path).toBe('/page-11');
  });

  it('toggles pinned paths and removes recent entries', () => {
    useRecentVisitsStore.getState().recordVisit('/dashboard', 'Dashboard');
    useRecentVisitsStore.getState().recordVisit('/audit', '审计');

    useRecentVisitsStore.getState().togglePin('/dashboard');
    expect(useRecentVisitsStore.getState().pinned).toEqual(['/dashboard']);

    useRecentVisitsStore.getState().togglePin('/dashboard');
    expect(useRecentVisitsStore.getState().pinned).toEqual([]);

    useRecentVisitsStore.getState().removeRecent('/audit');
    expect(useRecentVisitsStore.getState().recent.map((visit) => visit.path)).toEqual(['/dashboard']);
  });

  it('persists recent and pinned under the yunpai-recent-visits key', () => {
    useRecentVisitsStore.getState().recordVisit('/home', '角色首页');
    useRecentVisitsStore.getState().togglePin('/home');

    const stored = window.localStorage.getItem(RECENT_VISITS_STORAGE_KEY);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored ?? '{}');
    expect(parsed.state.recent).toHaveLength(1);
    expect(parsed.state.pinned).toEqual(['/home']);
  });
});
