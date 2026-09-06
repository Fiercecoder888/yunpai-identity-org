import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../auth/useAuthStore';
import { renderWithApp } from '../tests/testUtils';
import { DatabaseTenantSwitcher } from './DatabaseTenantSwitcher';

const TEST_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCTION_TENANT_ID = '44444444-4444-4444-8444-444444444444';
const originalSwitchTenant = useAuthStore.getState().switchTenant;

const authConfig = {
  auth_mode: 'shared_anonymous' as const,
  oidc_enabled: false,
  shared_data: true,
  csrf_required: true,
  capabilities: {
    anonymous_session: true,
    oidc_login: false,
    session_management: true,
    user_isolation: false,
  },
  tenants: [
    { id: TEST_TENANT_ID, name: '测试库' },
    { id: PRODUCTION_TENANT_ID, name: '生产库' },
  ],
};

const authMe = {
  auth_mode: 'shared_anonymous' as const,
  principal_id: 'shared-principal',
  principal_type: 'shared_anonymous' as const,
  user: null,
  tenant: { id: TEST_TENANT_ID, name: '测试库' },
  shared_data: true as const,
  roles: [],
  permissions: [],
  session: {
    id: 'session',
    csrf_token: 'memory-only',
    idle_expires_at: 'later',
    absolute_expires_at: 'later',
  },
};

describe('DatabaseTenantSwitcher', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'ready',
      config: authConfig,
      me: authMe,
      error: undefined,
      switchTenant: originalSwitchTenant,
    });
  });

  it('shows the active database and lists the available databases', async () => {
    const user = userEvent.setup();
    renderWithApp(<DatabaseTenantSwitcher />);

    await user.click(screen.getByRole('button', { name: '当前数据库：测试库' }));

    expect(await screen.findByRole('menuitem', { name: '测试库' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '生产库' })).toBeInTheDocument();
  });

  it('confirms a switch, clears cached data, and reloads the page', async () => {
    const user = userEvent.setup();
    const switchTenant = vi.fn().mockResolvedValue(undefined);
    const reloadPage = vi.fn();
    useAuthStore.setState({ switchTenant });
    const { queryClient } = renderWithApp(<DatabaseTenantSwitcher reloadPage={reloadPage} />);
    queryClient.setQueryData(['m0', 'search'], { stale: true });

    await user.click(screen.getByRole('button', { name: '当前数据库：测试库' }));
    await user.click(await screen.findByRole('menuitem', { name: '生产库' }));

    expect(await screen.findByRole('dialog', { name: '切换数据库版本' })).toBeInTheDocument();
    expect(screen.getByText('切换到「生产库」？切换后清空本地缓存并刷新页面。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /切\s*换/ }));

    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith(PRODUCTION_TENANT_ID));
    expect(queryClient.getQueryData(['m0', 'search'])).toBeUndefined();
    expect(reloadPage).toHaveBeenCalledOnce();
  });
});
