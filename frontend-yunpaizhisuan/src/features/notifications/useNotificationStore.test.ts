import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOTIFICATION_READ_STORAGE_KEY,
  useNotificationStore,
  type AppNotification,
} from './useNotificationStore';

const makeItem = (id: string, overrides?: Partial<AppNotification>): AppNotification => ({
  id,
  type: 'test',
  title: `通知 ${id}`,
  severity: 'info',
  source: 'system',
  createdAt: '2026-08-10T00:00:00.000Z',
  ...overrides,
});

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.getState().resetNotifications();
  });

  it('starts empty with polling transport', () => {
    expect(useNotificationStore.getState().items).toEqual([]);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
    expect(useNotificationStore.getState().transport).toBe('poll');
  });

  it('merges items, dedupes by id, and keeps the first arrival timestamp', () => {
    useNotificationStore.getState().mergeItems([
      makeItem('n1', { createdAt: '2026-08-10T01:00:00.000Z' }),
      makeItem('n2', { createdAt: '2026-08-10T02:00:00.000Z' }),
    ]);
    useNotificationStore.getState().mergeItems([makeItem('n1', { createdAt: '2026-08-10T03:00:00.000Z' })]);

    const items = useNotificationStore.getState().items;
    expect(items.map((item) => item.id)).toEqual(['n2', 'n1']);
    expect(items.find((item) => item.id === 'n1')?.createdAt).toBe('2026-08-10T01:00:00.000Z');
    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it('tracks unread count and persists read ids to localStorage', () => {
    useNotificationStore.getState().mergeItems([makeItem('n1'), makeItem('n2')]);
    useNotificationStore.getState().markRead('n1');

    expect(useNotificationStore.getState().unreadCount).toBe(1);
    const stored = JSON.parse(window.localStorage.getItem(NOTIFICATION_READ_STORAGE_KEY) ?? '[]') as string[];
    expect(stored).toContain('n1');
    expect(stored).not.toContain('n2');
  });

  it('marks all items as read and persists the full id set', () => {
    useNotificationStore.getState().mergeItems([makeItem('n1'), makeItem('n2'), makeItem('n3')]);
    useNotificationStore.getState().markAllRead();

    expect(useNotificationStore.getState().unreadCount).toBe(0);
    const stored = JSON.parse(window.localStorage.getItem(NOTIFICATION_READ_STORAGE_KEY) ?? '[]') as string[];
    expect(stored.sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('treats re-merged read items as still read', () => {
    useNotificationStore.getState().mergeItems([makeItem('n1')]);
    useNotificationStore.getState().markRead('n1');
    useNotificationStore.getState().mergeItems([makeItem('n1')]);

    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('switches the transport between poll and sse', () => {
    useNotificationStore.getState().setTransport('sse');
    expect(useNotificationStore.getState().transport).toBe('sse');
    useNotificationStore.getState().setTransport('poll');
    expect(useNotificationStore.getState().transport).toBe('poll');
  });
});
