import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../tests/testUtils';
import { server } from '../mocks/server';
import { DataConstructionPage } from './DataConstructionPage';

// antd 静态 message 在 jsdom 下不会挂载到 DOM，mock 掉以便断言上传提示。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
    },
  };
});

describe('DataConstructionPage extract result panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows per-document extract results after selecting a batch', async () => {
    const user = userEvent.setup();
    renderWithApp(<DataConstructionPage />);

    const batchRow = await screen.findByText('M0-BATCH-001');
    await user.click(batchRow);

    expect(await screen.findByText(/1 个文档提取结果待确认/)).toBeInTheDocument();
    expect((await screen.findAllByText('订单-CAND-088.pdf')).length).toBeGreaterThan(0);
    expect(screen.getByText('CAND-088')).toBeInTheDocument();
    expect((await screen.findAllByText('加工BOM-成品A.xlsx')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('图纸_ABC-123.pdf')).length).toBeGreaterThan(0);
    expect(screen.getByText('ABC-123')).toBeInTheDocument();
  });

  it('clears the controlled upload list after a successful batch creation', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(<DataConstructionPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(['first'], 'first.csv', { type: 'text/csv' }));
    expect(await screen.findByText('first.csv')).toBeInTheDocument();

    const uploadButton = container.querySelector('button.ant-btn-primary') as HTMLButtonElement;
    await user.click(uploadButton);
    await waitFor(() => expect(screen.queryByText('first.csv')).not.toBeInTheDocument());

    const nextInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(nextInput, new File(['second'], 'second.csv', { type: 'text/csv' }));
    expect(await screen.findByText('second.csv')).toBeInTheDocument();
    expect(screen.queryByText('first.csv')).not.toBeInTheDocument();
  });

  it('warns and keeps files when the total upload size exceeds the gateway limit', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(<DataConstructionPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    const oversized = new File(['x'], '超大.xlsx');
    Object.defineProperty(oversized, 'size', { value: 200 * 1024 * 1024 });
    await user.upload(input, oversized);
    expect(await screen.findByText('超大.xlsx')).toBeInTheDocument();

    const uploadButton = container.querySelector('button.ant-btn-primary') as HTMLButtonElement;
    await user.click(uploadButton);

    await waitFor(() => {
      expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('超过网关单请求上限'));
    });
    // 未发起上传：文件仍保留在待上传列表，且没有成功提示。
    expect(message.success).not.toHaveBeenCalled();
    expect(screen.getByText('超大.xlsx')).toBeInTheDocument();
  });

  it('shows a completion message when a selected processing batch finishes', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(<DataConstructionPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    let previewCalls = 0;
    server.use(
      http.post('/api/m0/import/upload', () =>
        HttpResponse.json(
          {
            success: true,
            data: {
              id: 'M0-BATCH-POLL',
              status: 'received',
              source_names: 'poll.csv',
              stats: {},
              tenant_id: 'mock-tenant',
              created_by: 'mock',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            errors: [],
            trace_id: 'msw-m0',
          },
          { status: 202 },
        ),
      ),
      http.get('/api/m0/import/batch/:batchId/preview', () => {
        previewCalls += 1;
        const status = previewCalls >= 2 ? 'awaiting_review' : 'received';
        return HttpResponse.json({
          success: true,
          data: {
            batch: {
              id: 'M0-BATCH-POLL',
              status,
              source_names: 'poll.csv',
              stats: {},
              tenant_id: 'mock-tenant',
              created_by: 'mock',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            documents: [],
            rows: [],
            entities: [],
            mappings: [],
            quarantine: [],
            ledger: [],
          },
          errors: [],
          trace_id: 'msw-m0',
        });
      }),
    );

    await user.upload(input, new File(['x'], 'poll.csv', { type: 'text/csv' }));
    const uploadButton = container.querySelector('button.ant-btn-primary') as HTMLButtonElement;
    await user.click(uploadButton);

    // 上传返回「处理中」，随后轮询到待审核 → 明确完成提示。
    await waitFor(
      () => {
        expect(message.success).toHaveBeenCalledWith(
          expect.stringContaining('已上传，批次 M0-BATCH-POLL 处理完成，待审核'),
        );
      },
      { timeout: 6000 },
    );
    // 面板同步进入待审核状态（有待人工确认项提示）。
    expect(screen.getByText(/有待人工确认项/)).toBeInTheDocument();
  });
});
