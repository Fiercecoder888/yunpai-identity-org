import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type RecentVisit = {
  path: string;
  title: string;
  visitedAt: number;
};

export const RECENT_VISITS_STORAGE_KEY = 'yunpai-recent-visits';
const MAX_RECENT = 8;

type RecentVisitsState = {
  recent: RecentVisit[];
  pinned: string[];
  recordVisit: (path: string, title: string) => void;
  togglePin: (path: string) => void;
  removeRecent: (path: string) => void;
  resetVisits: () => void;
};

export const useRecentVisitsStore = create<RecentVisitsState>()(
  persist(
    (set) => ({
      recent: [],
      pinned: [],
      recordVisit: (path, title) =>
        set((state) => ({
          recent: [
            { path, title, visitedAt: Date.now() },
            ...state.recent.filter((item) => item.path !== path),
          ].slice(0, MAX_RECENT),
        })),
      togglePin: (path) =>
        set((state) => ({
          pinned: state.pinned.includes(path)
            ? state.pinned.filter((item) => item !== path)
            : [...state.pinned, path],
        })),
      removeRecent: (path) =>
        set((state) => ({ recent: state.recent.filter((item) => item.path !== path) })),
      resetVisits: () => set({ recent: [], pinned: [] }),
    }),
    {
      name: RECENT_VISITS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ recent: state.recent, pinned: state.pinned }),
    },
  ),
);

export function useRecentVisitPaths(): { recent: RecentVisit[]; pinned: string[] } {
  const recent = useRecentVisitsStore((state) => state.recent);
  const pinned = useRecentVisitsStore((state) => state.pinned);
  return { recent, pinned };
}
