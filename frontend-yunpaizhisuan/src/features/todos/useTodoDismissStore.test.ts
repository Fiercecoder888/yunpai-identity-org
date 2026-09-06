import { beforeEach, describe, expect, it } from 'vitest';
import { TODO_DISMISS_STORAGE_KEY, useTodoDismissStore } from './useTodoDismissStore';

describe('useTodoDismissStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useTodoDismissStore.getState().resetDismiss();
  });

  it('tracks dismissed todo ids and deduplicates', () => {
    const store = useTodoDismissStore.getState();
    store.dismiss('m1-review-A');
    store.dismiss('m1-review-A');
    store.dismiss('m4-alert-501');

    expect(useTodoDismissStore.getState().dismissed).toEqual(['m1-review-A', 'm4-alert-501']);
    expect(useTodoDismissStore.getState().isDismissed('m1-review-A')).toBe(true);
    expect(useTodoDismissStore.getState().isDismissed('m5-flow-V1')).toBe(false);
  });

  it('restores a dismissed todo', () => {
    const store = useTodoDismissStore.getState();
    store.dismiss('m3-shortage-PROC-001');
    store.undismiss('m3-shortage-PROC-001');

    expect(useTodoDismissStore.getState().isDismissed('m3-shortage-PROC-001')).toBe(false);
    expect(useTodoDismissStore.getState().dismissed).toEqual([]);
  });

  it('persists dismissed ids under the yunpai-todo-dismiss key', () => {
    useTodoDismissStore.getState().dismiss('m5-flow-V1');
    const stored = window.localStorage.getItem(TODO_DISMISS_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? '{}')).toMatchObject({ state: { dismissed: ['m5-flow-V1'] } });
  });
});
