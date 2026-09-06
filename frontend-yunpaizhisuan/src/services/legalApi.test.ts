import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLegalRisks } from './legalApi';

describe('legalApi', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads demo-only M7 data when MSW demo mode is active', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');

    await expect(getLegalRisks()).resolves.toHaveLength(2);
  });

  it('reports not implemented in real backend mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_ENABLE_MSW', 'false');

    await expect(getLegalRisks()).rejects.toMatchObject({ error: { code: 'not_implemented' } });
  });
});
