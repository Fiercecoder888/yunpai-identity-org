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
        {path !== '/dashboard' ? <Route path="/dashboard" element={<div>Dashboard 落地页</div>} /> : null}
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
    renderRoute('/dashboard', '受保护的 Dashboard');

    expect(await screen.findByText('受保护的 Dashboard')).toBeInTheDocument();
  });

  it('renders permission-free routes without a role requirement', async () => {
    renderRoute('/tasks', '任务看板内容');

    expect(await screen.findByText('任务看板内容')).toBeInTheDocument();
  });

  it('redirects to the role landing page and writes a permission denied audit when the role lacks access', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    // 工人角色无 quality:supervise → 拒绝 → 回工人自己的落地页 /worker（不是 /dashboard）
    renderRoute('/quality', '不应渲染的 Quality');

    expect(await screen.findByText('工人落地页')).toBeInTheDocument();
    expect(screen.queryByText('不应渲染的 Quality')).not.toBeInTheDocument();

    await waitFor(async () => {
      const logs = await getAuditLogs();
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: '生产工人',
            action: 'PERMISSION_DENIED',
            module: 'QualitySupervision',
            targetId: '/quality',
            result: 'blocked',
          }),
        ]),
      );
    });
  });

  it('fails closed when the role query errors', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ message: 'Auth unavailable' }, { status: 503 })));
    renderRoute('/quality', '不应渲染的 Quality');

    // 角色未知 → 默认落地页（对话页），仍不放行目标页
    expect(await screen.findByText('对话页落地')).toBeInTheDocument();
    expect(screen.queryByText('不应渲染的 Quality')).not.toBeInTheDocument();
  });
});
