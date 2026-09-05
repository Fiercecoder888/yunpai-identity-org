// Stub: the real chatHistoryDevPlugin lives in the frontend developer's local
// `dev/` directory, which is NOT included in the shipped source package.
// It is only invoked in MSW demo mode (useMswDemo), which real-mode builds
// (VITE_API_BASE_URL set) never reach.  Provide a no-op plugin so the top-level
// import in vite.config.ts resolves.
import type { Plugin } from 'vite';

export function chatHistoryDevPlugin(): Plugin {
  return { name: 'yunpai-chat-history-dev-stub' };
}
