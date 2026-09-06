import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMe } from '../auth/authApi';
import { useAuthStore } from '../auth/useAuthStore';
import { PERMISSION_CODES } from '../features/roles/permissionCatalog';
import { getCurrentRole, hasPermission } from './permissionApi';

const authenticatedMe = (overrides: Partial<AuthMe> = {}): AuthMe => ({
  auth_mode: 'shared_anonymous',
  principal_id: 'shared-user',
  principal_type: 'shared_anonymous',
  user: null,
  tenant: { id: 'tenant-a', name: '测试租户' },
  shared_data: true,
  roles: ['shared_developer'],
  permissions: ['dashboard:read'],
  session: { id: 'session-a', csrf_token: 'test-only', idle_expires_at: 'later', absolute_expires_at: 'later' },
  ...overrides,
});

const resetAuthStore = () => {
  useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
};

describe('permissionApi', () => {
  beforeEach(resetAuthStore);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    resetAuthStore();
  });

  it('uses demo fixture permissions in MSW demo mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');
    window.localStorage.setItem('mockRoleId', 'worker');

    await expect(getCurrentRole()).resolves.toMatchObject({
      id: 'worker',
      permissions: ['worker:read', 'worker:report', 'chat:read', 'chat:write'],
    });
  });

  it('calls /api/auth/me in real mode', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          role: { id: 'operator', name: '业务操作员', permissions: ['dashboard:read', 'm4:read'] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(getCurrentRole()).resolves.toMatchObject({ id: 'operator', name: '业务操作员' });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/auth/me');
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it('keeps the Lenovo integration identity aligned with the full test permission catalog', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_LENOVO_TEST_IDENTITY', 'true');

    await expect(getCurrentRole()).resolves.toEqual({
      id: 'lenovo-test-operator',
      name: 'Lenovo 联调操作员',
      permissions: [...PERMISSION_CODES],
    });
  });

  it('maps only a shared anonymous developer to the factory-director view without granting permissions', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    useAuthStore.setState({
      status: 'ready',
      me: authenticatedMe({ permissions: ['m4:read'] }),
      error: undefined,
    });

    await expect(getCurrentRole()).resolves.toEqual({
      id: 'factory-director',
      name: '共享开发者',
      permissions: ['m4:read'],
    });
  });

  it.each([
    ['an OIDC developer', authenticatedMe({ principal_type: 'oidc_federated' })],
    ['a non-developer anonymous session', authenticatedMe({ roles: ['worker'], permissions: ['worker:read'] })],
  ])('does not map %s to the factory-director view', async (_label, me) => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    useAuthStore.setState({ status: 'ready', me, error: undefined });

    await expect(getCurrentRole()).resolves.not.toMatchObject({ id: 'factory-director' });
  });

  it('fails closed when real permission backend is unavailable', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('auth unavailable'));

    await expect(getCurrentRole()).rejects.toMatchObject({
      error: { code: 'network_error' },
    });
  });

  it('checks permissions from the resolved role only', () => {
    expect(hasPermission({ id: 'reader', name: 'reader', permissions: ['m4:read'] }, 'm4:operate')).toBe(false);
    expect(hasPermission({ id: 'operator', name: 'operator', permissions: ['m4:operate'] }, 'm4:operate')).toBe(true);
  });
});
