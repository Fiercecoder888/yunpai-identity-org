import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../auth/useAuthStore';
import { getAuditLogs } from '../services/auditApi';
import { currentRoleQueryKey } from '../services/permissionApi';
import { setServerMockScenario, server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { ActionGate } from './ActionGate';
import { PermissionGate } from './PermissionGate';

describe('PermissionGate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
  });

  it('renders children when the current role has permission', async () => {
    renderWithApp(
      <PermissionGate permission="dashboard:read" auditModule="Dashboard" targetId="dashboard">
        <div>受保护内容</div>
      </PermissionGate>,
    );

    expect(await screen.findByText('受保护内容')).toBeInTheDocument();
  });

  it('stays open when protected content mounts an action gate using the same role query', async () => {
    renderWithApp(
      <PermissionGate permission="dashboard:read" auditModule="Dashboard" targetId="dashboard">
        <ActionGate permission="dashboard:read" auditModule="Dashboard" targetId="dashboard-action">
          <button type="button">受保护操作</button>
        </ActionGate>
      </PermissionGate>,
    );

    expect(await screen.findByRole('button', { name: '受保护操作' })).not.toBeDisabled();
  });

  it('blocks missing permissions and writes a permission denied audit log', async () => {
    window.localStorage.setItem('mockScenario', 'permissionDenied');
    setServerMockScenario('permissionDenied');

    renderWithApp(
      <PermissionGate permission="dashboard:read" auditModule="Dashboard" targetId="dashboard">
        <div>受保护内容</div>
      </PermissionGate>,
    );

    expect(await screen.findByText('无权限访问')).toBeInTheDocument();
    expect(screen.getByText('缺少权限：dashboard:read')).toBeInTheDocument();

    await waitFor(async () => {
      const logs = await getAuditLogs();
      expect(logs[0]).toMatchObject({
        actor: '生产工人',
        action: 'PERMISSION_DENIED',
        module: 'Dashboard',
        targetId: 'dashboard',
        result: 'blocked',
      });
    });
  });

  it('shows a warning when permission denial audit logging fails', async () => {
    window.localStorage.setItem('mockScenario', 'permissionDenied');
    setServerMockScenario('permissionDenied');
    server.use(http.post('/api/audit/logs', () => HttpResponse.json({ message: 'Audit unavailable' }, { status: 500 })));

    renderWithApp(
      <PermissionGate permission="m1:read" auditModule="M1" targetId="m1-review">
        <div>受保护内容</div>
      </PermissionGate>,
    );

    expect(await screen.findByText('无权限访问')).toBeInTheDocument();
    expect(await screen.findByText('日志同步失败')).toBeInTheDocument();
  });

  it('fails closed when the real permission backend is unavailable', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ message: 'Auth unavailable' }, { status: 503 })));

    renderWithApp(
      <PermissionGate permission="dashboard:read" auditModule="Dashboard" targetId="dashboard">
        <div>受保护内容</div>
      </PermissionGate>,
    );

    expect(await screen.findByText('权限后端未就绪')).toBeInTheDocument();
    expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  });

  it('hides cached privileged content while refetching and after the refetch fails', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    let requestCount = 0;
    let finishRefetch: (() => void) | undefined;
    let markRefetchStarted: (() => void) | undefined;
    const refetchStarted = new Promise<void>((resolve) => {
      markRefetchStarted = resolve;
    });
    server.use(
      http.get('/api/auth/me', () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json({
            role: { id: 'factory-director', name: '厂长', permissions: ['dashboard:read'] },
          });
        }
        markRefetchStarted?.();
        return new Promise((resolve) => {
          finishRefetch = () => resolve(HttpResponse.json({ message: 'Auth unavailable' }, { status: 503 }));
        });
      }),
    );

    const { queryClient } = renderWithApp(
      <PermissionGate permission="dashboard:read" auditModule="Dashboard" targetId="dashboard">
        <div>受保护内容</div>
      </PermissionGate>,
    );

    expect(await screen.findByText('受保护内容')).toBeInTheDocument();
    const refetchPromise = queryClient.refetchQueries({ queryKey: currentRoleQueryKey });
    await refetchStarted;
    await waitFor(() => expect(screen.queryByText('受保护内容')).not.toBeInTheDocument());

    act(() => finishRefetch?.());
    await refetchPromise;

    expect(await screen.findByText('权限后端未就绪')).toBeInTheDocument();
    expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  });
});
