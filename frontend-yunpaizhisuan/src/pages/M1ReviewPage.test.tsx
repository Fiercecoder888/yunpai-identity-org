import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { M1ReviewPage, validateM1UploadFile } from './M1ReviewPage';

describe('M1ReviewPage', () => {
  it('renders loading state before data resolves', () => {
    const { container } = renderWithApp(<M1ReviewPage />);

    expect(container.querySelector('.ant-spin')).toBeInTheDocument();
  });

  it('renders normal M1 tasks and review items', async () => {
    renderWithApp(<M1ReviewPage />);

    expect(await screen.findByText('M1-TASK-001')).toBeInTheDocument();
    expect(await screen.findByText('交付日期')).toBeInTheDocument();
  });

  it('filters tasks and review items by task ID', async () => {
    const user = userEvent.setup();
    renderWithApp(<M1ReviewPage />);

    expect(await screen.findByText('M1-TASK-001')).toBeInTheDocument();
    await user.type(screen.getByLabelText('按任务ID搜索'), 'not-present');
    expect(await screen.findByText('未找到匹配任务')).toBeInTheDocument();

    await user.type(screen.getByLabelText('按待审核任务ID搜索'), 'not-present');
    expect(await screen.findByText('未找到匹配审核任务')).toBeInTheDocument();
  });

  it('renders empty state for empty M1 endpoints', async () => {
    server.use(
      http.get('/api/m0/parser-compat/tasks', () => HttpResponse.json([])),
      http.get('/api/m0/parser-compat/review/queue', () => HttpResponse.json([])),
    );

    renderWithApp(<M1ReviewPage />);

    expect((await screen.findAllByText('暂无数据')).length).toBeGreaterThan(0);
  });

  it('renders error state for failed M1 endpoints', async () => {
    server.use(
      http.get('/api/m0/parser-compat/tasks', () => HttpResponse.json({ message: 'Mock server error' }, { status: 500 })),
      http.get('/api/m0/parser-compat/review/queue', () => HttpResponse.json({ message: 'Mock server error' }, { status: 500 })),
    );

    renderWithApp(<M1ReviewPage />);

    expect((await screen.findAllByText('数据加载失败')).length).toBeGreaterThan(0);
  });

  it('validates illegal and oversized upload files', () => {
    expect(validateM1UploadFile(new File(['demo'], 'demo.exe'))).toBe('文件类型不支持');
    expect(validateM1UploadFile(new File([new ArrayBuffer(101 * 1024 * 1024)], 'demo.pdf'))).toBe('文件过大');
    expect(validateM1UploadFile(new File(['demo'], 'demo.pdf'))).toBeNull();
  });

  it('shows partial failures when batch recognition returns failed files', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(<M1ReviewPage />);

    await screen.findByText('M1-TASK-001');
    const fileInputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const batchInput = fileInputs[0];
    expect(batchInput).toBeDefined();
    await user.upload(batchInput as HTMLInputElement, [
      new File(['demo'], '订单图纸-A102.pdf', { type: 'application/pdf' }),
      new File(['demo'], '结构图-损坏.dwg', { type: 'application/octet-stream' }),
    ]);
    await user.click(screen.getByRole('button', { name: '提交批量识别' }));

    expect(await screen.findByText('批量识别已创建 2 个任务')).toBeInTheDocument();
    expect((await screen.findAllByText(/结构图-损坏\.dwg/)).length).toBeGreaterThan(0);
  });

  it('keeps batch recognition successful when audit logging fails', async () => {
    const user = userEvent.setup();
    server.use(http.post('/api/audit/logs', () => HttpResponse.json({ message: 'Audit unavailable' }, { status: 500 })));
    const { container } = renderWithApp(<M1ReviewPage />);

    await screen.findByText('M1-TASK-001');
    const fileInputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    await user.upload(fileInputs[0] as HTMLInputElement, new File(['demo'], '订单图纸-A102.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: '提交批量识别' }));

    expect(await screen.findByText('批量识别已创建 2 个任务')).toBeInTheDocument();
    expect((await screen.findAllByText('日志同步失败')).length).toBeGreaterThan(0);
  });

  it('provides a ZIP import entry', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(<M1ReviewPage />);

    await screen.findByText('M1-TASK-001');
    const fileInputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const archiveInput = fileInputs[1];
    expect(archiveInput).toBeDefined();
    await user.upload(archiveInput as HTMLInputElement, new File(['demo'], '合同扫描件.zip', { type: 'application/zip' }));
    await user.click(screen.getByRole('button', { name: '导入 ZIP' }));

    expect(await screen.findByText('ZIP 导入已创建任务 M1-TASK-ZIP-001')).toBeInTheDocument();
    expect(await screen.findByText(/旧版工艺卡\.xls/)).toBeInTheDocument();
  });

  it('requires review fields and submits the exact corrected payload', async () => {
    const user = userEvent.setup();
    let submittedBody: unknown;
    let submittedUrl = '';
    server.use(
      http.post('/api/m0/parser-compat/review/:id', async ({ request }) => {
        submittedUrl = request.url;
        submittedBody = await request.json();
        return HttpResponse.json({
          id: 'M1-REV-1',
          taskId: 'M1-TASK-001',
          field: '交付日期',
          recognizedValue: '2026-07-08',
          correctedValue: '2026-07-09',
          confidence: 0.62,
          status: 'confirmed',
        });
      }),
    );

    renderWithApp(<M1ReviewPage />);

    await screen.findByText('交付日期');
    const openReviewButton = screen.getAllByRole('button', { name: '打开审核' })[0];
    expect(openReviewButton).toBeDefined();
    await user.click(openReviewButton as HTMLElement);
    await user.clear(screen.getByLabelText('审核说明'));
    await user.click(screen.getByRole('button', { name: '通过并完成任务' }));

    expect(await screen.findByText('请输入审核说明')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('修正值'));
    await user.type(screen.getByLabelText('修正值'), '2026-07-09');
    await user.type(screen.getByLabelText('审核说明'), '交付日期按合同附件修正');
    await user.click(screen.getByRole('button', { name: '通过并完成任务' }));

    await waitFor(() => expect(submittedBody).toEqual({ 交付日期: '2026-07-09' }));
    const url = new URL(submittedUrl);
    expect(url.pathname).toBe('/api/m0/parser-compat/review/M1-TASK-001');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      approve: 'true',
      reviewer: 'frontend-reviewer',
      comment: '交付日期按合同附件修正',
    });
  });
});
