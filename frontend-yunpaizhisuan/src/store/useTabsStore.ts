import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type WorkbenchTab = {
  path: string;
  title: string;
  closable: boolean;
};

/**
 * 关闭最后一个标签页时的兜底落地页 = Agent 对话页。
 * 原固定标签页 `/dashboard` 已随业务模块页废稿删除（router 里不再有该路由）。
 */
const HOME_PATH = '/';

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
      tabs: [],
      recentPaths: [],
      openTab: (tab) =>
        set((state) => ({
          tabs: uniqueTabs([...state.tabs, tab]),
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
        const fallbackPath = recentPaths.find((item) => tabs.some((tabItem) => tabItem.path === item)) ?? HOME_PATH;

        set({ tabs, recentPaths });

        return fallbackPath;
      },
      resetTabs: () => set({ tabs: [], recentPaths: [] }),
    }),
    {
      // 存储键升版：旧的持久化状态里可能带着已下线的 /dashboard 固定标签页。
      name: 'yunpai-workbench-tabs-v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tabs: state.tabs, recentPaths: state.recentPaths }),
    },
  ),
);
