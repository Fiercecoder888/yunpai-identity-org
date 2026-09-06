import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type UploadSessionKind = 'order' | 'm0' | 'm1';
export type UploadSessionStatus = 'uploading' | 'processing' | 'success' | 'failed' | 'cancelled' | 'idle';

export type UploadSession = {
  id: string;
  filename: string;
  kind: UploadSessionKind;
  taskId?: string;
  runId?: string;
  conversationId?: string;
  status: UploadSessionStatus;
  progress: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type UploadSessionState = {
  sessions: Record<string, UploadSession>;
  upsert: (id: string, session: Omit<Partial<UploadSession>, 'id'> & { filename: string; kind: UploadSessionKind }) => void;
  remove: (id: string) => void;
  reset: () => void;
};

export const useUploadSessionStore = create<UploadSessionState>()(
  persist(
    (set, get) => ({
      sessions: {},
      upsert: (id, partial) => {
        const existing = get().sessions[id];
        const now = new Date().toISOString();
        set({
          sessions: {
            ...get().sessions,
            [id]: {
              id,
              filename: partial.filename,
              kind: partial.kind,
              taskId: partial.taskId,
              runId: partial.runId,
              conversationId: partial.conversationId,
              status: partial.status ?? existing?.status ?? 'idle',
              progress: partial.progress ?? existing?.progress ?? 0,
              error: partial.error,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            },
          },
        });
      },
      remove: (id) => {
        const sessions = { ...get().sessions };
        delete sessions[id];
        set({ sessions });
      },
      reset: () => set({ sessions: {} }),
    }),
    {
      name: 'yunpai-upload-sessions',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ sessions: state.sessions }),
    },
  ),
);
