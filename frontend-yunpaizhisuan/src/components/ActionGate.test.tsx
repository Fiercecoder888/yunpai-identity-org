import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthMe } from '../auth/authApi';
import { useAuthStore } from '../auth/useAuthStore';
import type { PermissionCode } from '../services/permissionApi';
import { getAuditLogs } from '../services/auditApi';
import { renderWithApp } from '../tests/testUtils';
import { ActionGate } from './ActionGate';

const roleQueryKey = ['permissions', 'current-role'] as const;

const authenticatedMe = (overrides: Partial<AuthMe> = {}): AuthMe => ({
  auth_mode: 'shared_anonymous',
  principal_id: 'privileged-user',
  principal_type: 'shared_anonymous',
  user: { name: '高权限用户' },
  tenant: { id: 'tenant-a', name: '测试租户' },
  shared_data: true,
  roles: ['factory-director'],
  permissions: ['m4:read', 'm4:operate'],
  session: {
    id: 'session-a',
    csrf_token: 'test-only',
    idle_expires_at: 'later',
    absolute_expires_at: 'later',
  },
  ...overrides,
});

const renderGate = (permission: PermissionCode, onClick: () => void = () => undefined) =>
  renderWithApp(
    <ActionGate permission={permission} auditModule="M4" targetId="op-1">
      <button type="button" onClick={onClick}>
        执行操作
      </button>
    </ActionGate>,
  );

const waitForRoleResolved = async (queryClient: ReturnType<typeof renderWithApp>['queryClient']) => {
  await waitFor(() => {
    expect(queryClient.getQueryCache().findAll({ queryKey: roleQueryKey }).some((query) => query.state.status === 'success')).toBe(true);
  });
};

describe('ActionGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
  });

  it('renders the child enabled when the current role holds the permission', async () => {
    const onClick = vi.fn();
    const { queryClient } = renderGate('m4:operate', onClick);

    await waitForRoleResolved(queryClient);
    const button = screen.getByRole('button', { name: '执行操作' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the child and explains the missing permission when the role lacks it', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    const { queryClient } = renderGate('m4:operate');

    await waitForRoleResolved(queryClient);
    const button = screen.getByRole('button', { name: '执行操作' });
    expect(button).toBeDisabled();

    fireEvent.mouseEnter(screen.getByTestId('action-gate-blocked'));
    expect(await screen.findByText('缺少权限：m4:operate')).toBeInTheDocument();
  });

  it('writes a PERMISSION_DENIED audit when a blocked action is attempted', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    const { queryClient } = renderGate('m4:operate');

    await waitForRoleResolved(queryClient);
    fireEvent.click(screen.getByTestId('action-gate-blocked'));

    await waitFor(async () => {
      const logs = await getAuditLogs();
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: '生产工人',
            action: 'PERMISSION_DENIED',
            module: 'M4',
            targetId: 'op-1',
            result: 'blocked',
          }),
        ]),
      );
    });
  });

  it('does not write an audit when the action is allowed', async () => {
    const { queryClient } = renderGate('m4:operate');

    await waitForRoleResolved(queryClient);
    fireEvent.click(screen.getByRole('button', { name: '执行操作' }));

    await waitFor(async () => {
      const logs = await getAuditLogs();
      expect(logs.some((log) => log.action === 'PERMISSION_DENIED')).toBe(false);
    });
  });

  it('drops cached privileged access when the authenticated identity becomes read-only', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    useAuthStore.setState({ status: 'ready', me: authenticatedMe(), error: undefined });
    const onClick = vi.fn();
    const { queryClient } = renderGate('m4:operate', onClick);

    await waitFor(() => expect(screen.getByRole('button', { name: '执行操作' })).not.toBeDisabled());
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: roleQueryKey })
        .some((query) => query.queryKey.slice(2, 5).join('|') === 'privileged-user|tenant-a|session-a'),
    ).toBe(true);
    await act(async () => {
      queryClient.setQueryData(
        [...roleQueryKey, 'read-only-user', 'tenant-a', 'session-b', ['read-only'], ['m4:read']],
        { id: 'read-only', name: '只读用户', permissions: ['m4:read'] },
      );
      useAuthStore.setState({
        me: authenticatedMe({
          principal_id: 'read-only-user',
          user: { name: '只读用户' },
          roles: ['read-only'],
          permissions: ['m4:read'],
          session: {
            id: 'session-b',
            csrf_token: 'test-only-b',
            idle_expires_at: 'later',
            absolute_expires_at: 'later',
          },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '执行操作' })).toBeDisabled());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fails closed when authentication errors while stale identity data remains', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    useAuthStore.setState({ status: 'ready', me: authenticatedMe(), error: undefined });
    renderGate('m4:operate');

    await waitFor(() => expect(screen.getByRole('button', { name: '执行操作' })).not.toBeDisabled());
    act(() => {
      useAuthStore.setState({ status: 'error', error: 'Session expired' });
    });

    await waitFor(() => expect(screen.getByRole('button', { name: '执行操作' })).toBeDisabled());
    fireEvent.mouseEnter(screen.getByTestId('action-gate-blocked'));
    expect(await screen.findByText('权限后端未就绪')).toBeInTheDocument();
  });

  it('records a new denial when the protected target changes', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    const view = renderWithApp(
      <ActionGate permission="m4:operate" auditModule="M4" targetId="op-1">
        <button type="button">执行操作</button>
      </ActionGate>,
    );

    await waitForRoleResolved(view.queryClient);
    fireEvent.click(screen.getByTestId('action-gate-blocked'));
    view.rerender(
      <ActionGate permission="m4:operate" auditModule="M4" targetId="op-2">
        <button type="button">执行操作</button>
      </ActionGate>,
    );
    fireEvent.click(screen.getByTestId('action-gate-blocked'));

    await waitFor(async () => {
      const logs = await getAuditLogs();
      expect(logs.filter((log) => log.action === 'PERMISSION_DENIED').map((log) => log.targetId)).toEqual(
        expect.arrayContaining(['op-1', 'op-2']),
      );
    });
  });
});
