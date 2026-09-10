import { beforeEach, describe, expect, it } from 'vitest';
import { useTabsStore } from './useTabsStore';

describe('useTabsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.getState().resetTabs();
  });

  it('starts without any fixed tab and falls back to the assistant page', () => {
    expect(useTabsStore.getState().tabs).toEqual([]);

    const fallback = useTabsStore.getState().closeTab('/org');

    expect(fallback).toBe('/org');
  });

  it('returns the most recent remaining tab when closing the current tab', () => {
    useTabsStore.getState().openTab({ path: '/org', title: '组织架构', closable: true });
    useTabsStore.getState().openTab({ path: '/accounts', title: '账号管理', closable: true });

    const fallback = useTabsStore.getState().closeTab('/accounts');

    expect(fallback).toBe('/org');
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual(['/org']);
  });

  it('falls back to the assistant page when the last closable tab is closed', () => {
    useTabsStore.getState().openTab({ path: '/roles', title: '角色与权限', closable: true });

    const fallback = useTabsStore.getState().closeTab('/roles');

    expect(fallback).toBe('/');
    expect(useTabsStore.getState().tabs).toEqual([]);
  });

  it('keeps a non-closable tab in place when closeTab is called for it', () => {
    useTabsStore.getState().openTab({ path: '/worker', title: '工人工作台', closable: false });

    const fallback = useTabsStore.getState().closeTab('/worker');

    expect(fallback).toBe('/worker');
    expect(useTabsStore.getState().tabs).toEqual([{ path: '/worker', title: '工人工作台', closable: false }]);
  });
});
