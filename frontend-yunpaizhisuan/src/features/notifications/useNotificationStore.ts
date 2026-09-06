import { create } from 'zustand';

export type NotificationTransport = 'poll' | 'sse';
export type NotificationSeverity = 'info' | 'low' | 'medium' | 'high';
export type NotificationSource = 'todo' | 'system' | 'api';

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  detail?: string;
  severity: NotificationSeverity;
  link?: string;
  source: NotificationSource;
  createdAt: string;
};

type NotificationState = {
  items: AppNotification[];
  unreadCount: number;
  transport: NotificationTransport;
  readIds: Set<string>;
  mergeItems: (items: AppNotification[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setTransport: (transport: NotificationTransport) => void;
  resetNotifications: () => void;
};

export const NOTIFICATION_READ_STORAGE_KEY = 'yunpai.notifications.read';

const readStoredIds = (): Set<string> => {
  if (typeof window === 'undefined') {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_READ_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
};

const persistReadIds = (ids: Set<string>) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(NOTIFICATION_READ_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // The in-memory read set still applies when storage is unavailable.
  }
};

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,
  transport: 'poll',
  readIds: readStoredIds(),
  mergeItems: (incoming) =>
    set((state) => {
      const byId = new Map<string, AppNotification>();
      state.items.forEach((item) => byId.set(item.id, item));
      incoming.forEach((item) => {
        if (!byId.has(item.id)) {
          byId.set(item.id, item);
        }
      });
      const items = [...byId.values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
      return { items, unreadCount: items.filter((item) => !state.readIds.has(item.id)).length };
    }),
  markRead: (id) =>
    set((state) => {
      const readIds = new Set(state.readIds);
      readIds.add(id);
      persistReadIds(readIds);
      return { readIds, unreadCount: state.items.filter((item) => !readIds.has(item.id)).length };
    }),
  markAllRead: () =>
    set((state) => {
      const readIds = new Set(state.readIds);
      state.items.forEach((item) => readIds.add(item.id));
      persistReadIds(readIds);
      return { readIds, unreadCount: 0 };
    }),
  setTransport: (transport) => set({ transport }),
  resetNotifications: () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(NOTIFICATION_READ_STORAGE_KEY);
      } catch {
        // ignore storage failures during reset
      }
    }
    set({ items: [], unreadCount: 0, transport: 'poll', readIds: new Set() });
  },
}));
