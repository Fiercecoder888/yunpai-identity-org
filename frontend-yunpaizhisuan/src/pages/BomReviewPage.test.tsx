import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import m2WorkflowResult from '../mocks/fixtures/m2WorkflowResult.json';
import { server } from '../mocks/server';
import { M2_WORKFLOW_STORAGE_KEY } from '../features/m2/m2Workflow';
import { renderWithApp } from '../tests/testUtils';
import { BomReviewPage } from './BomReviewPage';

describe('BomReviewPage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(M2_WORKFLOW_STORAGE_KEY);
  });

  it('runs the real M2 workflow and renders standard BOM output', async () => {
    const user = userEvent.setup();
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/m2/run', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ result: m2WorkflowResult });
      }),
    );

    renderWithApp(<BomReviewPage />);

    await user.click(screen.getByRole('button', { name: /生成 BOM 工程草稿/ }));

    expect(await screen.findByText('CBL-USBC-1M')).toBeInTheDocument();
    expect(screen.getByText('USB-C cable assembly')).toBeInTheDocument();
    expect(screen.getByText('请确认旧物料编号是正式主编号还是历史别名。')).toBeInTheDocument();
    expect(screen.queryByText('当前展示模拟 BOM 数据')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成 SOP 工程草稿/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(submittedBody).toMatchObject({
        use_demo_sources: true,
        enable_bom_model: false,
        enable_sop_model: false,
        template_confirmation: { confirmed: true },
      }),
    );
  });

  it('restores the latest real M2 result from browser storage', async () => {
    window.localStorage.setItem(M2_WORKFLOW_STORAGE_KEY, JSON.stringify(m2WorkflowResult));

    renderWithApp(<BomReviewPage />);

    expect(await screen.findByText('FG-USBC-1M-BLK-DRAFT-EBOM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下载 BOM Excel/ })).toBeInTheDocument();
  });
});
