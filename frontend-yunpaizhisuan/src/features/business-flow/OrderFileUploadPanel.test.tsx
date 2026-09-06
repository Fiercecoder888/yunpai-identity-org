import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderFileUploadPanel } from './OrderFileUploadPanel';
import { runBusinessFlow, type BusinessFlowRunProgress } from '../../services/businessFlowRunApi';
import { HttpClientError } from '../../services/httpClient';
import { uploadOrderFile } from '../../services/m1IngestApi';
import { useBusinessRunStore } from './useBusinessRunStore';
import { renderWithApp } from '../../tests/testUtils';
import { MAX_ORDER_FILE_MB } from '../upload/uploadConstants';

vi.mock('../../services/businessFlowRunApi', () => ({
  runBusinessFlow: vi.fn(async () => ({
    phase: 'done',
    title: 'done',
    detail: 'done',
  })),
  getCatalogRunConfigs: vi.fn(async () => []),
}));

vi.mock('../../services/m1IngestApi', () => ({
  uploadOrderFile: vi.fn(async ({ file }: { file: File }) => ({
    task_id: `task-${file.name}`,
    filename: file.name,
    status: 'done',
    needs_review: false,
    document: {
      lines: [
        {
          name_raw: 'HDMI-HDMI扁平 20M',
          quantity: 100,
          customer_order_number: 'SO-HIST-CAND-20260724-091',
        },
      ],
    },
  })),
  waitForM1Task: vi.fn(async (taskId: string) => ({
    task_id: taskId,
    filename: 'mock.pdf',
    status: 'done',
    needs_review: false,
    document: {
      lines: [
        {
          name_raw: 'HDMI-HDMI扁平 20M',
          quantity: 100,
          customer_order_number: 'SO-HIST-CAND-20260724-091',
        },
      ],
    },
  })),
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    message: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
  };
});

describe('OrderFileUploadPanel order type selection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useBusinessRunStore.getState().reset();
  });

  it('renders the three order type options and defaults to normal', () => {
    renderWithApp(<OrderFileUploadPanel />);
    expect(screen.getByText('正式订单')).toBeTruthy();
    expect(screen.getByText('预订单')).toBeTruthy();
    expect(screen.getByText('样品单')).toBeTruthy();
  });

  it('passes the selected orderType to runBusinessFlow', async () => {
    const runBusinessFlowMock = vi.mocked(runBusinessFlow);
    const user = userEvent.setup();
    renderWithApp(<OrderFileUploadPanel />);

    fireEvent.click(screen.getByText('样品单'));

    const file = new File(['sample'], 'sample-order.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    fireEvent.change(screen.getByLabelText('订单数量'), { target: { value: '1' } });
    fireEvent.click(await screen.findByText('提交受治理流程'));

    await waitFor(() => expect(runBusinessFlowMock).toHaveBeenCalled());
    const firstCall = runBusinessFlowMock.mock.calls[0]?.[0];
    expect(firstCall?.orderType).toBe('sample');
    expect(firstCall?.orderId).toBe('sample-order.pdf');
  });

  it('publishes submission failures to the shared flow panel after the modal closes', async () => {
    vi.mocked(runBusinessFlow).mockRejectedValueOnce(new Error('Forbidden'));
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<OrderFileUploadPanel onClose={onClose} />);

    const file = new File(['order'], 'failed-order.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    fireEvent.change(screen.getByLabelText('订单数量'), { target: { value: '1' } });
    fireEvent.click(await screen.findByText('提交受治理流程'));

    await waitFor(() => expect(useBusinessRunStore.getState()).toMatchObject({
      running: false,
      phase: 'failed',
      error: 'Forbidden',
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('persists the run under the same upload catalog selected by the shared flow panel', async () => {
    const progress: BusinessFlowRunProgress = {
      phase: 'human_input_required',
      title: '流程等待人工补充',
      detail: 'M1 订单识别需人工复核',
      trackingTaskId: 'task-upload-recovery',
      runId: 'run-upload-recovery',
    };
    vi.mocked(runBusinessFlow).mockImplementationOnce(async (_input, options) => {
      options?.onProgress?.(progress);
      return progress;
    });
    const user = userEvent.setup();
    renderWithApp(<OrderFileUploadPanel />);

    const file = new File(['recoverable-order'], 'recoverable-order.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    fireEvent.click(await screen.findByText('提交受治理流程'));

    const catalogId = `upload-${file.name}-${file.size}`;
    await waitFor(() => expect(useBusinessRunStore.getState().selectedCatalogId).toBe(catalogId));
    const persisted = JSON.parse(localStorage.getItem('yunpai-candidate-runs') ?? '{}') as Record<
      string,
      { task_id?: string; run_id?: string }
    >;
    expect(persisted[catalogId]).toEqual({
      task_id: 'task-upload-recovery',
      run_id: 'run-upload-recovery',
    });
    expect(persisted[`upload-${file.name}`]).toBeUndefined();
  });

  it('rejects an oversized zip arriving through initialFiles (global drop/paste) with a clear message', async () => {
    const { message } = await import('antd');
    const messageError = vi.mocked(message.error);
    const runBusinessFlowMock = vi.mocked(runBusinessFlow);
    runBusinessFlowMock.mockClear();
    messageError.mockClear();
    // 压缩包超过 100MB：全局拖拽/粘贴绕过 beforeUpload，必须在 initialFiles 路径被拦下
    const oversizeZip = new File(
      [new Uint8Array((MAX_ORDER_FILE_MB + 1) * 1024 * 1024)],
      'orders.zip',
      { type: 'application/zip' },
    );
    renderWithApp(<OrderFileUploadPanel initialFiles={[oversizeZip]} />);

    await waitFor(() =>
      expect(messageError).toHaveBeenCalledWith(expect.stringContaining('订单文件过大')),
    );
    // 文件被拒绝：不出现提交按钮，也不会触发业务流程
    expect(screen.queryByText('提交受治理流程')).toBeNull();
    expect(runBusinessFlowMock).not.toHaveBeenCalled();
  });

  it('accepts a zip within the 100MB limit arriving through initialFiles', async () => {
    const runBusinessFlowMock = vi.mocked(runBusinessFlow);
    runBusinessFlowMock.mockClear();
    const boundaryZip = new File(
      [new Uint8Array(MAX_ORDER_FILE_MB * 1024 * 1024)],
      'orders.zip',
      { type: 'application/zip' },
    );
    renderWithApp(<OrderFileUploadPanel initialFiles={[boundaryZip]} />);

    const submit = await screen.findByText('提交受治理流程');
    expect(submit).toBeTruthy();
    fireEvent.click(submit);
    await waitFor(() => expect(runBusinessFlowMock).toHaveBeenCalled());
  });

  it('surfaces a 409 idempotency conflict to the global store with a clear message (no eternal spinner)', async () => {
    const runBusinessFlowMock = vi.mocked(runBusinessFlow);
    const { message } = await import('antd');
    const messageError = vi.mocked(message.error);
    runBusinessFlowMock.mockClear();
    messageError.mockClear();
    useBusinessRunStore.getState().reset();
    // 同一文件以不同订单类型（如正式→预订单）重复提交时，服务端按幂等规则返回 409。
    runBusinessFlowMock.mockRejectedValueOnce(
      new HttpClientError({
        code: 'server_error',
        status: 409,
        message: 'Request failed with status 409',
        detail: {
          code: 'business_flow_idempotency_conflict',
          message: 'Tracking TaskID already belongs to a different business flow payload',
        },
      }),
    );

    const user = userEvent.setup();
    renderWithApp(<OrderFileUploadPanel />);
    fireEvent.click(screen.getByText('预订单'));
    const file = new File(['order'], 'formal-order.xlsx', { type: 'application/vnd.ms-excel' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    fireEvent.click(await screen.findByText('提交受治理流程'));

    await waitFor(() => {
      expect(useBusinessRunStore.getState().phase).toBe('failed');
    });
    expect(useBusinessRunStore.getState().running).toBe(false);
    // 明确的用户提示，而不是停留在“运行中”假象
    expect(messageError).toHaveBeenCalledWith(expect.stringContaining('已提交过'));
    expect(useBusinessRunStore.getState().error).toContain('预订单/样品单');
  });

  it('surfaces a generic run failure to the global store', async () => {
    const runBusinessFlowMock = vi.mocked(runBusinessFlow);
    const { message } = await import('antd');
    const messageError = vi.mocked(message.error);
    runBusinessFlowMock.mockClear();
    messageError.mockClear();
    useBusinessRunStore.getState().reset();
    runBusinessFlowMock.mockRejectedValueOnce(new Error('业务流程超时：flow_stuck'));

    const user = userEvent.setup();
    renderWithApp(<OrderFileUploadPanel />);
    const file = new File(['order'], 'formal-order.xlsx', { type: 'application/vnd.ms-excel' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    fireEvent.click(await screen.findByText('提交受治理流程'));

    await waitFor(() => {
      expect(useBusinessRunStore.getState().phase).toBe('failed');
    });
    expect(useBusinessRunStore.getState().error).toContain('业务流程超时');
    expect(messageError).toHaveBeenCalled();
  });

  it('pre-recognizes a PDF order via M1 and backfills product name/qty/BOM path', async () => {
    const user = userEvent.setup();
    renderWithApp(<OrderFileUploadPanel />);

    // PDF 订单上传后自动触发 M1 预识别（mock 返回 HDMI-HDMI扁平 20M / 100 / 091）
    const file = new File(['pdf-bytes'], 'CAND-091_订单.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    // 识别完成提示出现
    await waitFor(() => expect(screen.getByText(/已识别订单内容/)).toBeTruthy());
    // 产品名回填（AutoComplete 渲染为 type=search 的 input，用 value 定位）
    await waitFor(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const productInput = inputs.find((el) => el.value === 'HDMI-HDMI扁平 20M');
      expect(productInput).toBeTruthy();
    });
    // 数量回填
    const qtyInput = screen.getByPlaceholderText(/订单数量/) as HTMLInputElement;
    expect(qtyInput.value).toBe('100');
    // 历史 BOM 路径从识别订单号 SO-HIST-CAND-20260724-091 推断 CAND-091
    const bomInput = screen.getByPlaceholderText(/历史 BOM 路径/) as HTMLInputElement;
    expect(bomInput.value).toContain('CAND-091_历史BOM.xlsx');
  });

  it('requires a positive quantity when M1 cannot recognize any order lines', async () => {
    const { message } = await import('antd');
    const warning = vi.mocked(message.warning);
    const runBusinessFlowMock = vi.mocked(runBusinessFlow);
    warning.mockClear();
    runBusinessFlowMock.mockClear();
    vi.mocked(uploadOrderFile).mockResolvedValueOnce({
      task_id: 'task-no-quantity',
      filename: 'no-quantity.pdf',
      status: 'needs_review',
      needs_review: true,
      document: { lines: [] },
    });
    const user = userEvent.setup();
    renderWithApp(<OrderFileUploadPanel />);

    const file = new File(['pdf-bytes'], 'no-quantity.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await screen.findByText(/已识别订单内容/);

    fireEvent.click(screen.getByText('提交受治理流程'));
    expect(runBusinessFlowMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('请填写大于 0 的数量'));

    await user.type(screen.getByLabelText('订单数量'), '6');
    fireEvent.click(screen.getByText('提交受治理流程'));
    await waitFor(() => expect(runBusinessFlowMock).toHaveBeenCalled());
    expect(runBusinessFlowMock.mock.calls[0]?.[0].orderQty).toBe(6);
  });
});
