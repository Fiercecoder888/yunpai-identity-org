import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPath } from './router';
import { getAuditLogs } from '../services/auditApi';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { RoleGuard } from './RoleGuard';

const renderRoute = (path: AppPath, content: string) =>
  renderWithApp(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/home" element={<div>角色首页落地</div>} />
        <Route path={path} element={<RoleGuard path={path}>{content}</RoleGuard>} />
      </Routes>
    </MemoryRouter>,
  );

describe('RoleGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('renders children when the current role holds the route permission', async () => {
    renderRoute('/dashboard', '受保护的 Dashboard');

    expect(await screen.findByText('受保护的 Dashboard')).toBeInTheDocument();
  });

  it('renders permission-free routes without a role requirement', async () => {
    renderRoute('/tasks', '任务看板内容');

    expect(await screen.findByText('任务看板内容')).toBeInTheDocument();
  });

  it('redirects to /home and writes a permission denied audit when the role lacks access', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    renderRoute('/dashboard', '不应渲染的 Dashboard');

    expect(await screen.findByText('角色首页落地')).toBeInTheDocument();
    expect(screen.queryByText('不应渲染的 Dashboard')).not.toBeInTheDocument();

    await waitFor(async () => {
      const logs = await getAuditLogs();
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: '生产工人',
            action: 'PERMISSION_DENIED',
            module: 'Dashboard',
            targetId: '/dashboard',
            result: 'blocked',
          }),
        ]),
      );
    });
  });

  it('fails closed when the role query errors', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ message: 'Auth unavailable' }, { status: 503 })));
    renderRoute('/dashboard', '不应渲染的 Dashboard');

    expect(await screen.findByText('角色首页落地')).toBeInTheDocument();
    expect(screen.queryByText('不应渲染的 Dashboard')).not.toBeInTheDocument();
  });
});
