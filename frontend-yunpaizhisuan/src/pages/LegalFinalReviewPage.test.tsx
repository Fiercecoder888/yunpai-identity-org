import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { LegalFinalReviewPage } from './LegalFinalReviewPage';

describe('LegalFinalReviewPage', () => {
  const enableDemoMode = () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps a permanent Demo boundary banner above the sample workflow', async () => {
    enableDemoMode();
    renderWithApp(<LegalFinalReviewPage />);

    expect(screen.getByText('法务高风险终审演示')).toBeInTheDocument();
    expect(screen.getByText('仅供 Demo 演示')).toBeInTheDocument();
    expect(screen.getByText(/不代表 M7 已交付/)).toBeInTheDocument();
    expect(screen.getByText(/不会改变 M5 订单或排程/)).toBeInTheDocument();
    expect(await screen.findByText('CLA-2026-014')).toBeInTheDocument();
  });

  it('requires an opinion and isolates the successful Demo audit and cache invalidation', async () => {
    enableDemoMode();
    const user = userEvent.setup();
    const successSpy = vi.spyOn(message, 'success');
    let submittedBody: unknown;
    let auditBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/demo/legal/risks/:id/final-review', async ({ request }) => {
        submittedBody = await request.json();
        return HttpResponse.json({
          id: 'CLA-2026-014',
          title: '年度框架合同',
          riskLevel: 'high',
          reviewRound: '终审',
          summary: '风险条款待确认',
          status: 'approved',
        });
      }),
      http.post('/api/audit/logs', async ({ request }) => {
        auditBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(auditBody);
      }),
    );
    const { queryClient } = renderWithApp(<LegalFinalReviewPage />);
    queryClient.setQueryData(['m5', 'schedule'], { untouched: true });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('CLA-2026-014');
    await user.click(screen.getAllByRole('button', { name: '查看终审' })[0] as HTMLElement);
    await user.clear(screen.getByLabelText('终审意见'));
    await user.click(screen.getByRole('button', { name: '终审通过' }));
    expect(await screen.findByText('请输入终审意见')).toBeInTheDocument();

    await user.type(screen.getByLabelText('终审意见'), '风险可接受，补充条款后通过。');
    await user.click(screen.getByRole('button', { name: '终审通过' }));

    await waitFor(() => expect(submittedBody).toEqual({ status: 'approved', opinion: '风险可接受，补充条款后通过。' }));
    expect(auditBody).toMatchObject({
      actor: 'demo-legal-reviewer',
      action: 'DEMO_LEGAL_FINAL_REVIEW_RECORDED',
      module: 'LegalDemo',
    });
    expect(auditBody?.detail).toMatch(/^\[DEMO\]/);
    expect(successSpy).toHaveBeenCalledWith('演示终审意见已记录');
    expect(screen.getByText('演示终审意见已记录')).toBeInTheDocument();
    successSpy.mockRestore();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['demo', 'legal-risks'], exact: true });
    expect(queryClient.getQueryData(['m5', 'schedule'])).toEqual({ untouched: true });
  });

  it.each([
    ['终审通过', 'approved'],
    ['驳回', 'rejected'],
    ['升级', 'escalated'],
  ] as const)('supports the %s Demo action', async (buttonName, status) => {
    enableDemoMode();
    const user = userEvent.setup();
    let submittedStatus: unknown;
    server.use(
      http.post('/api/demo/legal/risks/:id/final-review', async ({ request }) => {
        submittedStatus = ((await request.json()) as { status: unknown }).status;
        return HttpResponse.json({
          id: 'CLA-2026-014',
          title: '年度框架合同',
          riskLevel: 'high',
          reviewRound: '终审',
          summary: '风险条款待确认',
          status,
        });
      }),
    );
    renderWithApp(<LegalFinalReviewPage />);

    await screen.findByText('CLA-2026-014');
    await user.click(screen.getAllByRole('button', { name: '查看终审' })[0] as HTMLElement);
    const accessibleName = buttonName === '终审通过' ? buttonName : new RegExp(buttonName.split('').join('\\s*'));
    await user.click(screen.getByRole('button', { name: accessibleName }));

    await waitFor(() => expect(submittedStatus).toBe(status));
  });

  it('keeps the Demo result successful when audit logging fails', async () => {
    enableDemoMode();
    const user = userEvent.setup();
    server.use(http.post('/api/audit/logs', () => HttpResponse.json({ message: 'Audit unavailable' }, { status: 500 })));
    renderWithApp(<LegalFinalReviewPage />);

    await screen.findByText('CLA-2026-014');
    await user.click(screen.getAllByRole('button', { name: '查看终审' })[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: '终审通过' }));

    expect((await screen.findAllByText('日志同步失败')).length).toBeGreaterThan(0);
  });

  it('renders only the current_none boundary and sends no legal or audit request in real mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    let legalRequests = 0;
    let auditRequests = 0;
    server.use(
      http.get('/api/demo/legal/risks', () => {
        legalRequests += 1;
        return HttpResponse.json([]);
      }),
      http.post('/api/audit/logs', () => {
        auditRequests += 1;
        return HttpResponse.json({});
      }),
    );

    renderWithApp(<LegalFinalReviewPage />);

    expect(screen.getByText('M7 法务终审未交付')).toBeInTheDocument();
    expect(screen.getByText(/M5→M7 与 M7→M5 均为 current_none/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终审通过' })).not.toBeInTheDocument();
    await waitFor(() => expect(legalRequests).toBe(0));
    expect(auditRequests).toBe(0);
  });
});
