import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type WorkbenchTab = {
  path: string;
  title: string;
  closable: boolean;
};

const dashboardTab: WorkbenchTab = {
  path: '/dashboard',
  title: 'Dashboard',
  closable: false,
};

type TabsState = {
  tabs: WorkbenchTab[];
  recentPaths: string[];
  openTab: (tab: WorkbenchTab) => void;
  closeTab: (path: string) => string;
  resetTabs: () => void;
};

const uniqueTabs = (tabs: WorkbenchTab[]) => {
  const byPath = new Map<string, WorkbenchTab>();
  tabs.forEach((tab) => byPath.set(tab.path, tab));
  return Array.from(byPath.values());
};

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [dashboardTab],
      recentPaths: ['/dashboard'],
      openTab: (tab) =>
        set((state) => ({
          tabs: uniqueTabs([dashboardTab, ...state.tabs, tab]),
          recentPaths: [tab.path, ...state.recentPaths.filter((path) => path !== tab.path)].slice(0, 10),
        })),
      closeTab: (path) => {
        const state = get();
        const tab = state.tabs.find((item) => item.path === path);
        if (!tab?.closable) {
          return path;
        }

        const tabs = state.tabs.filter((item) => item.path !== path);
        const recentPaths = state.recentPaths.filter((item) => item !== path);
        const fallbackPath = recentPaths.find((item) => tabs.some((tabItem) => tabItem.path === item)) ?? '/dashboard';

        set({
          tabs: uniqueTabs([dashboardTab, ...tabs]),
          recentPaths: recentPaths.length > 0 ? recentPaths : ['/dashboard'],
        });

        return fallbackPath;
      },
      resetTabs: () => set({ tabs: [dashboardTab], recentPaths: ['/dashboard'] }),
    }),
    {
      name: 'yunpai-workbench-tabs',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tabs: state.tabs, recentPaths: state.recentPaths }),
    },
  ),
);
