type DebugModeEnv = {
  readonly DEV?: boolean;
};

const isDevServer = (env: DebugModeEnv) => Boolean(env.DEV);

const isUrlDebugFlag = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).has('debug');
};

const isLocalStorageDebugFlag = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem('yp-debug') === '1';
  } catch {
    return false;
  }
};

export const isDebugMode = (env: DebugModeEnv = import.meta.env as DebugModeEnv) =>
  isDevServer(env) || isUrlDebugFlag() || isLocalStorageDebugFlag();
