import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithApp } from '../../tests/testUtils';
import { useUploadSessionStore } from '../../store/useUploadSessionStore';
import { server } from '../../mocks/server';
import { uploadM0FilesWithProgress } from '../../services/uploadWithProgress';
import type { M0Batch } from '../../services/m0Api';
import { M0ChatPanel } from './M0ChatPanel';

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

// 默认走真实实现（MSW 拦截 XHR）；个别用例用 mockImplementationOnce 控制
// onProgress 与响应时机，验证「传输完成 → 服务端处理中」的中间状态。
vi.mock('../../services/uploadWithProgress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/uploadWithProgress')>();
  return {
    ...actual,
    uploadM0FilesWithProgress: vi.fn(actual.uploadM0FilesWithProgress),
  };
});

const m0Envelope = (batch: Record<string, unknown>) => ({
  success: true,
  data: batch,
  errors: [],
  trace_id: 'msw-m0',
});

const m0BatchBody = (id: string, status: string) => ({
  id,
  status,
  source_names: 'mock-files',
  stats: {},
  tenant_id: 'mock-tenant',
  created_by: 'mock',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const m0PreviewBody = (id: string, status: string) => ({
  success: true,
  data: {
    batch: m0BatchBody(id, status),
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

describe('M0ChatPanel extract result panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useUploadSessionStore.getState().reset();
  });

  it('shows extract results after uploading files from the chat page', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], '订单-CAND-088.pdf');
    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel initialFiles={[file]} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /开始导入/ }));

    expect(await screen.findByText('提取结果（上传后自动刷新）')).toBeInTheDocument();
    expect(await screen.findByText('CAND-088')).toBeInTheDocument();
    expect(screen.getByText(/1 个文档提取结果待确认/)).toBeInTheDocument();
  });

  it('resumes polling the latest persisted M0 batch after a page reload', async () => {
    useUploadSessionStore.getState().upsert('m0-M0-BATCH-001', {
      filename: '订单-CAND-088.pdf',
      kind: 'm0',
      taskId: 'M0-BATCH-001',
      status: 'processing',
      progress: 100,
    });

    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel />
      </MemoryRouter>,
    );

    expect(await screen.findByText('批次 M0-BATCH-001 · 已入库')).toBeInTheDocument();
    expect(await screen.findByText('CAND-088')).toBeInTheDocument();
    await waitFor(() => {
      expect(useUploadSessionStore.getState().sessions['m0-M0-BATCH-001']?.status).toBe('success');
    });
  });

  it('warns and skips the upload when the total file size exceeds the gateway limit', async () => {
    const user = userEvent.setup();
    const oversized = new File(['x'], '超大.xlsx');
    Object.defineProperty(oversized, 'size', { value: 200 * 1024 * 1024 });
    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel initialFiles={[oversized]} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /开始导入/ }));

    await waitFor(() => {
      expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('超过网关单请求上限'));
    });
    // 未发起上传：不出现批次/提取结果，文件仍保留在待上传列表。
    expect(message.success).not.toHaveBeenCalled();
    expect(screen.queryByText('提取结果（上传后自动刷新）')).not.toBeInTheDocument();
    expect(screen.getByText('超大.xlsx')).toBeInTheDocument();
  });

  it('switches to a server-processing hint after the transfer reaches 100% and reports completion', async () => {
    const user = userEvent.setup();
    // 40MB > 30MB 大文件阈值，应附加大文件说明。
    const bigFile = new File(['x'], '世全水晶头承认书.zip');
    Object.defineProperty(bigFile, 'size', { value: 40 * 1024 * 1024 });

    let resolveUpload!: (batch: M0Batch) => void;
    const pending = new Promise<M0Batch>((resolve) => {
      resolveUpload = resolve;
    });
    vi.mocked(uploadM0FilesWithProgress).mockImplementationOnce(async (_files, options) => {
      // 传输完成：客户端已把全部字节发给服务端，但 HTTP 响应仍在等待（服务端处理中）。
      options?.onProgress?.(100);
      return pending;
    });

    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel initialFiles={[bigFile]} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /开始导入/ }));

    // ① 传输完成 → 「服务端处理中（大文件解压/识别可能需要几分钟）」提示。
    expect(await screen.findByText(/传输完成，服务端处理中（大文件解压\/识别可能需要几分钟/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /取消上传/ })).toBeInTheDocument();

    // 服务端最终返回：批次已建好并进入待审核。
    resolveUpload(m0BatchBody('M0-BATCH-BIG', 'awaiting_review') as M0Batch);
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith(
        expect.stringContaining('已上传，批次 M0-BATCH-BIG 处理完成，待审核'),
      );
    });
  });

  it('shows a completion message when a processing batch finishes (awaiting_review)', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], '订单-CAND-088.pdf');
    let previewCalls = 0;
    server.use(
      http.post('/api/m0/import/upload', () =>
        HttpResponse.json(m0Envelope(m0BatchBody('M0-BATCH-POLL', 'received')), { status: 202 }),
      ),
      http.get('/api/m0/import/batch/:batchId/preview', () => {
        previewCalls += 1;
        return HttpResponse.json(m0PreviewBody('M0-BATCH-POLL', previewCalls >= 2 ? 'awaiting_review' : 'received'));
      }),
    );

    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel initialFiles={[file]} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /开始导入/ }));

    // 上传返回「处理中」，随后轮询到待审核 → 明确完成提示。
    await waitFor(
      () => {
        expect(message.success).toHaveBeenCalledWith(
          expect.stringContaining('已上传，批次 M0-BATCH-POLL 处理完成，待审核'),
        );
      },
      { timeout: 6000 },
    );
    // 面板同步进入待审核状态。
    expect(screen.getByText('批次 M0-BATCH-POLL · 待人工确认')).toBeInTheDocument();
  });

  it('shows a failure message when a processing batch fails', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], '订单-CAND-088.pdf');
    let previewCalls = 0;
    server.use(
      http.post('/api/m0/import/upload', () =>
        HttpResponse.json(m0Envelope(m0BatchBody('M0-BATCH-FAIL', 'received')), { status: 202 }),
      ),
      http.get('/api/m0/import/batch/:batchId/preview', () => {
        previewCalls += 1;
        return HttpResponse.json(m0PreviewBody('M0-BATCH-FAIL', previewCalls >= 2 ? 'failed' : 'received'));
      }),
    );

    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel initialFiles={[file]} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /开始导入/ }));

    await waitFor(
      () => {
        expect(message.error).toHaveBeenCalledWith(
          expect.stringContaining('批次 M0-BATCH-FAIL 处理失败'),
        );
      },
      { timeout: 6000 },
    );
  });

  it('keeps a large-file processing hint while a big batch is being processed', async () => {
    const user = userEvent.setup();
    const bigFile = new File(['x'], '世全水晶头承认书.zip');
    Object.defineProperty(bigFile, 'size', { value: 40 * 1024 * 1024 });
    server.use(
      http.post('/api/m0/import/upload', () =>
        HttpResponse.json(m0Envelope(m0BatchBody('M0-BATCH-BIG', 'received')), { status: 202 }),
      ),
      http.get('/api/m0/import/batch/:batchId/preview', () =>
        HttpResponse.json(m0PreviewBody('M0-BATCH-BIG', 'received')),
      ),
    );

    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel initialFiles={[bigFile]} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /开始导入/ }));

    // ② 轮询期间持续提示：后台处理中 + 大文件说明。
    expect(await screen.findByText(/后台处理中：/)).toBeInTheDocument();
    expect(screen.getByText(/大文件解压\/识别可能需要几分钟/)).toBeInTheDocument();
  });
});

describe('M0ChatPanel master data modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useUploadSessionStore.getState().reset();
  });

  it('opens the master data management modal from the card extra button', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /管理主数据/ }));
    expect(await screen.findByRole('dialog', { name: /基础数据管理/ })).toBeInTheDocument();
    // 弹窗内嵌主数据表 CRUD：默认第一个表（机器）数据加载出来。
    expect(await screen.findByText('M-001')).toBeInTheDocument();

    // 关闭后弹窗消失。
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /基础数据管理/ })).not.toBeInTheDocument();
    });
  });
});

describe('M0ChatPanel camera capture upload（拍照上传 + 连拍扫描）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useUploadSessionStore.getState().reset();
  });

  it('renders the camera capture upload entry with accept and capture attributes', () => {
    const { container } = renderWithApp(
      <MemoryRouter>
        <M0ChatPanel />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /拍照上传/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /连拍扫描/ })).toBeInTheDocument();

    // 拍照入口是原生 file input：accept 只允许图片，capture=environment 在移动端调起后置相机。
    const cameraInput = container.querySelector<HTMLInputElement>(
      'input[data-testid="m0-camera-input"]',
    );
    expect(cameraInput).not.toBeNull();
    expect(cameraInput?.getAttribute('accept')).toBe('image/*');
    expect(cameraInput?.getAttribute('capture')).toBe('environment');
    expect(cameraInput?.multiple).toBe(true);
  });

  it('uploads camera photos immediately after selection through the m0 upload API', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(
      <MemoryRouter>
        <M0ChatPanel />
      </MemoryRouter>,
    );
    const cameraInput = container.querySelector<HTMLInputElement>('input[data-testid="m0-camera-input"]');
    expect(cameraInput).not.toBeNull();

    const photo = new File(['fake-image-bytes'], 'scan-001.jpg', { type: 'image/jpeg' });
    await user.upload(cameraInput as HTMLInputElement, photo);

    // 选择后立即走现有 uploadMutation：创建批次并提示处理完成（待审核）。
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith(expect.stringContaining('已上传，批次'));
    });
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('待审核'));
    expect(screen.getByText(/批次 M0-BATCH-/)).toBeInTheDocument();
  });

  it('keeps camera photos in the upload list when selection is invalid (too large)', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApp(
      <MemoryRouter>
        <M0ChatPanel />
      </MemoryRouter>,
    );
    const cameraInput = container.querySelector<HTMLInputElement>('input[data-testid="m0-camera-input"]');
    expect(cameraInput).not.toBeNull();

    const oversized = new File(['x'], 'huge-photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(oversized, 'size', { value: 600 * 1024 * 1024 });
    await user.upload(cameraInput as HTMLInputElement, oversized);

    await waitFor(() => {
      expect(message.error).toHaveBeenCalledWith(expect.stringContaining('文件过大'));
    });
    // 未发起上传：不出现批次提示。
    expect(message.success).not.toHaveBeenCalled();
  });

  it('opens the burst capture modal and falls back to system camera when getUserMedia is unavailable', async () => {
    const user = userEvent.setup();
    renderWithApp(
      <MemoryRouter>
        <M0ChatPanel />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /连拍扫描/ }));
    expect(await screen.findByRole('dialog', { name: /连拍扫描/ })).toBeInTheDocument();

    // jsdom 无 getUserMedia → 组件渲染不报错，展示降级入口（方案 B input capture）。
    // antd Modal 渲染在 body portal，用 screen/document.body 查询。
    expect(await screen.findByText(/getUserMedia 不可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /改用系统相机拍照/ })).toBeInTheDocument();

    const fallbackInput = document.body.querySelector<HTMLInputElement>('input[data-testid="m0-burst-fallback-input"]');
    expect(fallbackInput).not.toBeNull();
    expect(fallbackInput?.getAttribute('accept')).toBe('image/*');
    expect(fallbackInput?.getAttribute('capture')).toBe('environment');
    expect(fallbackInput?.multiple).toBe(true);

    // 「完成」关闭取景。
    await user.click(screen.getByRole('button', { name: /完成/ }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /连拍扫描/ })).not.toBeInTheDocument();
    });
  });
});
