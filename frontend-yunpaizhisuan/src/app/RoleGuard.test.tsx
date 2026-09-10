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
        {/* 被拒时回角色自己的落地页；为可能的目标各定义一个可识别页面 */}
        <Route path="/" element={<div>对话页落地</div>} />
        {path !== '/worker' ? <Route path="/worker" element={<div>工人落地页</div>} /> : null}
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
    renderRoute('/org', '受保护的组织架构');

    expect(await screen.findByText('受保护的组织架构')).toBeInTheDocument();
  });

  it('renders a route whose permission the current role holds', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    renderRoute('/worker', '工人工作台内容');

    expect(await screen.findByText('工人工作台内容')).toBeInTheDocument();
  });

  it('redirects to the role landing page and writes a permission denied audit when the role lacks access', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    // 工人角色无 role:manage → 拒绝 → 回工人自己的落地页 /worker
    renderRoute('/roles', '不应渲染的角色权限页');

    expect(await screen.findByText('工人落地页')).toBeInTheDocument();
    expect(screen.queryByText('不应渲染的角色权限页')).not.toBeInTheDocument();

    await waitFor(async () => {
      const logs = await getAuditLogs();
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: '生产工人',
            action: 'PERMISSION_DENIED',
            module: 'Roles',
            targetId: '/roles',
            result: 'blocked',
          }),
        ]),
      );
    });
  });

  it('fails closed when the role query errors', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ message: 'Auth unavailable' }, { status: 503 })));
    renderRoute('/roles', '不应渲染的角色权限页');

    // 角色未知 → 默认落地页（对话页），仍不放行目标页
    expect(await screen.findByText('对话页落地')).toBeInTheDocument();
    expect(screen.queryByText('不应渲染的角色权限页')).not.toBeInTheDocument();
  });
});
