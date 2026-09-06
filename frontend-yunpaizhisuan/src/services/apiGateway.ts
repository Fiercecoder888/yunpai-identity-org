type ApiGatewayEnv = {
  readonly VITE_API_BASE_URL?: string;
};

const blockedPrefixes = ['/api/v1/', '/api/modules/', '/modules/'];

const normalizeBase = (base: string | undefined) => {
  const trimmed = base?.trim().replace(/\/+$/, '');
  return trimmed && trimmed.length > 0 ? trimmed : '/api';
};

const normalizePath = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('API path must not be empty');
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error(`API path must be gateway-relative: ${path}`);
  }
  if (blockedPrefixes.some((prefix) => trimmed === prefix.slice(0, -1) || trimmed.startsWith(prefix))) {
    throw new Error(`API path bypasses the unified gateway: ${path}`);
  }

  const withoutLeadingApi = trimmed.replace(/^\/api(?=\/|$)/, '');
  return withoutLeadingApi.startsWith('/') ? withoutLeadingApi : `/${withoutLeadingApi}`;
};

export function toApiUrl(path: string, env: ApiGatewayEnv = import.meta.env as ApiGatewayEnv) {
  const base = normalizeBase(env.VITE_API_BASE_URL);
  const relativePath = normalizePath(path);
  return `${base}${relativePath}`.replace(/([^:]\/)\/+/g, '$1');
}

export function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined> = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });

  const query = search.toString();
  return query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path;
}
