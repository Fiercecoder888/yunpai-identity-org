import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { AuditLogPage } from './AuditLogPage';

describe('AuditLogPage', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('renders loading state before data resolves', () => {
    const { container } = renderWithApp(<AuditLogPage />);

    expect(container.querySelector('.ant-spin')).toBeInTheDocument();
  });

  it('renders normal audit logs', async () => {
    renderWithApp(<AuditLogPage />);

    expect(await screen.findByText('M1_UPLOAD_CREATED')).toBeInTheDocument();
  });

  it('filters audit logs by search keyword', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/audit/logs', () =>
        HttpResponse.json([
          { id: 'LOG-1', time: '2026-06-26 16:45', actor: 'demo-user', action: 'M1_UPLOAD_CREATED', module: 'M1', targetId: 'TASK-001', result: 'success', detail: '创建 M1 上传任务' },
          { id: 'LOG-2', time: '2026-06-26 17:00', actor: 'audit-user', action: 'M4_ALERT_SCAN', module: 'M4', targetId: 'm4-alerts', result: 'success', detail: '扫描采购预警' },
        ]),
      ),
    );

    renderWithApp(<AuditLogPage />);

    await screen.findByText('M1_UPLOAD_CREATED');
    await user.type(screen.getByRole('textbox', { name: '审计搜索' }), 'M4_ALERT_SCAN');
    await user.click(screen.getByRole('button', { name: /查询/ }));

    expect(await screen.findByText('M4_ALERT_SCAN')).toBeInTheDocument();
    expect(screen.queryByText('M1_UPLOAD_CREATED')).not.toBeInTheDocument();
  });

  it('renders empty state for empty mock scenario', async () => {
    server.use(http.get('/api/audit/logs', () => HttpResponse.json([])));

    renderWithApp(<AuditLogPage />);

    expect((await screen.findAllByText('暂无数据')).length).toBeGreaterThan(0);
  });

  it('renders error state for error mock scenario', async () => {
    server.use(http.get('/api/audit/logs', () => HttpResponse.json({ message: 'Mock server error' }, { status: 500 })));

    renderWithApp(<AuditLogPage />);

    expect((await screen.findAllByText('数据加载失败')).length).toBeGreaterThan(0);
  });

  it('falls back to M1 task events when the audit endpoint is not implemented', async () => {
    server.use(
      http.get('/api/audit/logs', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.get('/api/m0/parser-compat/tasks', () =>
        HttpResponse.json([
          {
            task_id: 'm1-review-001',
            filename: '真实订单图纸.pdf',
            status: 'needs_review',
            needs_review: true,
            updated_at: '2026-07-14T08:00:00Z',
          },
        ]),
      ),
    );

    renderWithApp(<AuditLogPage />);

    expect(await screen.findByText('M1_REVIEW_REQUIRED')).toBeInTheDocument();
    expect(screen.getByText('m1-review-001')).toBeInTheDocument();
    expect(screen.getByText('文档 真实订单图纸.pdf 需要人工复核')).toBeInTheDocument();
  });
});
