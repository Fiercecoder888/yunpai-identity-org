import { beforeEach, describe, expect, it } from 'vitest';
import { useTabsStore } from './useTabsStore';

describe('useTabsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.getState().resetTabs();
  });

  it('keeps Dashboard fixed when closeTab is called for it', () => {
    const fallback = useTabsStore.getState().closeTab('/dashboard');

    expect(fallback).toBe('/dashboard');
    expect(useTabsStore.getState().tabs).toEqual([
      { path: '/dashboard', title: 'Dashboard', closable: false },
    ]);
  });

  it('returns the most recent remaining tab when closing the current tab', () => {
    useTabsStore.getState().openTab({ path: '/tasks', title: '任务看板', closable: true });
    useTabsStore.getState().openTab({ path: '/audit', title: '权限和操作留痕', closable: true });

    const fallback = useTabsStore.getState().closeTab('/audit');

    expect(fallback).toBe('/tasks');
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual(['/dashboard', '/tasks']);
  });
});
