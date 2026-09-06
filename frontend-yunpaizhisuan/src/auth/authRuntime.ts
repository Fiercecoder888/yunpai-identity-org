let csrfToken: string | undefined;
let recoverSession: (() => Promise<boolean>) | undefined;

export const authRuntime = {
  getCsrfToken: () => csrfToken,
  setCsrfToken: (value: string | undefined) => {
    csrfToken = value;
  },
  setRecovery: (callback: () => Promise<boolean>) => {
    recoverSession = callback;
  },
  recover: async () => recoverSession?.() ?? false,
};

export const isUnsafeMethod = (method?: string) =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes((method ?? 'GET').toUpperCase());
