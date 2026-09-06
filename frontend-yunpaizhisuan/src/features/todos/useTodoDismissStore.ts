import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const TODO_DISMISS_STORAGE_KEY = 'yunpai-todo-dismiss';

type TodoDismissState = {
  dismissed: string[];
  dismiss: (id: string) => void;
  undismiss: (id: string) => void;
  isDismissed: (id: string) => boolean;
  resetDismiss: () => void;
};

export const useTodoDismissStore = create<TodoDismissState>()(
  persist(
    (set, get) => ({
      dismissed: [],
      dismiss: (id) =>
        set((state) => (state.dismissed.includes(id) ? state : { dismissed: [...state.dismissed, id] })),
      undismiss: (id) => set((state) => ({ dismissed: state.dismissed.filter((item) => item !== id) })),
      isDismissed: (id) => get().dismissed.includes(id),
      resetDismiss: () => set({ dismissed: [] }),
    }),
    {
      name: TODO_DISMISS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ dismissed: state.dismissed }),
    },
  ),
);
