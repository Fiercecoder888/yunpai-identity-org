import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import type { M0Document } from '../../services/m0Api';
import { ExtractResultPanel } from './ExtractResultPanel';

vi.mock('../../services/m0Api', () => ({
  getM0BatchDetail: vi.fn(),
  retryM0Extraction: vi.fn(),
  m0BatchDocumentFileUrl: (batchId: string, documentId: number) =>
    `/api/m0/import/batch/${batchId}/documents/${documentId}/file`,
  m0BatchDocumentPreviewUrl: (batchId: string, documentId: number) =>
    `/api/m0/import/batch/${batchId}/documents/${documentId}/preview.html`,
}));

import { getM0BatchDetail, retryM0Extraction } from '../../services/m0Api';

const mockGetDetail = vi.mocked(getM0BatchDetail);
const mockRetry = vi.mocked(retryM0Extraction);

const document = (overrides: Partial<M0Document>): M0Document => ({
  id: 1,
  batch_id: 'B-1',
  original_name: '文件.pdf',
  stored_name: 'f.pdf',
  content_hash: 'h',
  detected_format: 'pdf',
  declared_ext: 'pdf',
  domain: 'drawing',
  confidence: 0.9,
  status: 'ok',
  message: '',
  row_count: 0,
  extract_status: 'done',
  extract_task_id: '',
  extract_content: '',
  document_kind: '',
  agent_state: '{}',
  agent_trace: '[]',
  proposed_schema: '{}',
  ...overrides,
});

const detailPayload = (documents: M0Document[]) => ({
  batch: {
    id: 'B-1',
    status: 'ready',
    source_names: 'a.pdf',
    stats: {},
    tenant_id: 'default',
    created_by: 't',
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
  },
  documents,
  stats: {},
});

describe('ExtractResultPanel', () => {
  beforeEach(() => {
    mockGetDetail.mockReset();
    mockRetry.mockReset();
    mockRetry.mockResolvedValue({ batch_id: 'B-1', retried: 1, document_ids: [1] });
  });

  it('shows extracting status while documents are still being processed', async () => {
    mockGetDetail.mockResolvedValue(detailPayload([document({ extract_status: 'extracting' })]));
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText(/提取中：1 个文档/)).toBeInTheDocument();
  });

  it('shows completed status when all documents are done', async () => {
    mockGetDetail.mockResolvedValue(detailPayload([document({ domain: 'drawing' })]));
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText(/提取完成：1 个文档/)).toBeInTheDocument();
  });

  it('renders order card fields', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: '订单.pdf',
          domain: 'order',
          extract_content: JSON.stringify({
            header: { doc_no: 'CAND-088', customer: 'CANDELIGHT', due_date: '2026-09-20' },
            lines: [{ model: 'HDMI 线', qty: 5000 }],
          }),
        }),
      ]),
    );
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('订单.pdf')).toBeInTheDocument();
    expect(screen.getByText('CAND-088')).toBeInTheDocument();
    expect(screen.getByText('HDMI 线')).toBeInTheDocument();
    expect(screen.getByText('5000')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20')).toBeInTheDocument();
    expect(screen.getByText('CANDELIGHT')).toBeInTheDocument();
  });

  it('renders BOM table with material rows', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: 'BOM.xlsx',
          domain: 'bom',
          extract_content: JSON.stringify({
            model: '成品A-2080',
            items: [{ material_code: '110200M', material_name: '锌合金外壳', qty: 1, loss_rate: 0.05 }],
          }),
        }),
      ]),
    );
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('成品A-2080')).toBeInTheDocument();
    expect(screen.getByText('110200M')).toBeInTheDocument();
    expect(screen.getByText('锌合金外壳')).toBeInTheDocument();
    expect(screen.getByText('0.05')).toBeInTheDocument();
  });

  it('renders drawing card fields', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: '图纸.pdf',
          extract_content: JSON.stringify({ header: { drawing_no: 'ABC-123', part_no: 'PN-001' }, lines: [] }),
        }),
      ]),
    );
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('ABC-123')).toBeInTheDocument();
    expect(screen.getByText('PN-001')).toBeInTheDocument();
  });

  it('renders SOP rows', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: 'SOP.pdf',
          domain: 'sop',
          extract_content: JSON.stringify({ header: {}, lines: [{ step: '步骤1', content: '穿线，拉力 ≥ 5N' }] }),
        }),
      ]),
    );
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('步骤1')).toBeInTheDocument();
    expect(screen.getByText('穿线，拉力 ≥ 5N')).toBeInTheDocument();
  });

  it('renders specification params table', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: '规格书.pdf',
          domain: 'specification',
          extract_content: JSON.stringify({ header: { product_spec: 'HDMI 线材 1.5M', core_count: '4C' }, lines: [] }),
        }),
      ]),
    );
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('品名规格')).toBeInTheDocument();
    expect(screen.getByText('HDMI 线材 1.5M')).toBeInTheDocument();
    expect(screen.getByText('芯线数')).toBeInTheDocument();
    expect(screen.getByText('4C')).toBeInTheDocument();
  });

  it('renders PO fields and rows', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: 'PO.pdf',
          domain: 'po',
          extract_content: JSON.stringify({
            header: { doc_no: 'PO-20260801', supplier: '华东供应商' },
            lines: [{ model: '锌合金外壳', qty: 2000 }],
          }),
        }),
      ]),
    );
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('PO-20260801')).toBeInTheDocument();
    expect(screen.getByText('华东供应商')).toBeInTheDocument();
    expect(screen.getByText('锌合金外壳')).toBeInTheDocument();
    expect(screen.getByText('2000')).toBeInTheDocument();
  });

  it('shows failure reason and retries via the API', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([document({ extract_status: 'failed:TimeoutError', extract_content: '' })]),
    );
    const user = userEvent.setup();
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText(/提取失败：TimeoutError/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /重新提取/ })[0]!);
    await waitFor(() => expect(mockRetry.mock.calls[0]?.[0]).toBe('B-1'));
  });

  it('shows empty-content hint when extraction produced nothing', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([document({ extract_status: 'done', extract_content: '' })]),
    );
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('未识别到内容')).toBeInTheDocument();
  });

  it('opens preview modal with recognized type, details and file iframe', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: 'PO-20260703.pdf',
          domain: 'po',
          extract_content: JSON.stringify({
            document_type: 'po',
            header: { doc_no: 'PO-20260703-007', supplier: '广西桐曦' },
            lines: [{ material: 'ATZ-HW-10', qty: 180 }],
          }),
        }),
      ]),
    );
    const user = userEvent.setup();
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    await screen.findByText('PO-20260703.pdf');
    await user.click(screen.getByRole('button', { name: /预览/ }));
    expect(await screen.findByText('原始文件预览')).toBeInTheDocument();
    // 卡片与弹窗都会展示类型/字段（弹窗内再次出现即证明弹窗含详情）
    expect(screen.getAllByText('采购订单').length).toBeGreaterThan(1);
    expect(screen.getAllByText('广西桐曦').length).toBeGreaterThan(1);
    const iframe = screen.getByTitle('预览-PO-20260703.pdf') as HTMLIFrameElement;
    expect(iframe.src).toContain('/api/m0/import/batch/B-1/documents/1/file');
  });

  it('shows download link for non-previewable formats', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: 'BOM.docx',
          domain: 'bom',
          detected_format: 'docx',
          extract_content: JSON.stringify({
            document_type: 'bom',
            header: { product_name: '成品A' },
            lines: [],
          }),
        }),
      ]),
    );
    const user = userEvent.setup();
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    await screen.findByText('BOM.docx');
    await user.click(screen.getByRole('button', { name: /预览/ }));
    expect(await screen.findByText(/不支持浏览器内嵌预览/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /下载原始文件查看/ })).toBeInTheDocument();
  });

  it('opens table documents through the HTML preview endpoint', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: 'BOM.xlsx',
          domain: 'bom',
          detected_format: 'xlsx',
          extract_content: JSON.stringify({
            document_type: 'bom',
            header: { product_name: '成品A' },
            lines: [],
          }),
        }),
      ]),
    );
    const user = userEvent.setup();
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    await screen.findByText('BOM.xlsx');
    await user.click(screen.getByRole('button', { name: /预览/ }));
    const iframe = await screen.findByTitle('预览-BOM.xlsx') as HTMLIFrameElement;
    expect(iframe.src).toContain('/api/m0/import/batch/B-1/documents/1/preview.html');
  });

  it('shows error fallback with retry and download link when the preview iframe fails to load', async () => {
    vi.useFakeTimers();
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: 'BOM.pdf',
          domain: 'bom',
          detected_format: 'pdf',
          extract_content: JSON.stringify({
            document_type: 'bom',
            header: { product_name: '成品A' },
            lines: [],
          }),
        }),
      ]),
    );
    try {
      renderWithApp(<ExtractResultPanel batchId="B-1" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('BOM.pdf')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /预览/ }));
      const iframe = screen.getByTitle('预览-BOM.pdf') as HTMLIFrameElement;
      expect(iframe.src).toContain('/api/m0/import/batch/B-1/documents/1/file');

      act(() => {
        vi.advanceTimersByTime(16_000);
      });

      expect(screen.getByText('原始文件预览加载失败')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '下载原始文件' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the Agent evidence trace and dynamic schema', async () => {
    mockGetDetail.mockResolvedValue(
      detailPayload([
        document({
          original_name: '未知内容.xlsx',
          detected_format: 'xlsx',
          domain: 'unclassified',
          document_kind: '项目里程碑计划',
          extract_status: 'agent_complete',
          agent_state: JSON.stringify({
            document_kind: '项目里程碑计划',
            document_summary: '包含打样节点、负责人和计划日期。',
            confidence: 0.91,
            model_level: 1,
            model_name: 'primary:deepseek-v4-flash',
            status: 'complete',
            content_hypotheses: [{ kind: '项目里程碑计划', evidence_ids: ['ev-002'] }],
            known_facts: [{ name: '负责人', value: '李工', evidence_ids: ['ev-002'] }],
            unknowns: [],
            uncertainties: [],
            evidence: [
              {
                id: 'ev-002',
                tool: 'content.preview',
                kind: 'minimal_content_preview',
                summary: '读取首行和数据样本',
                payload: { rows: [['阶段', '负责人'], ['打样', '李工']] },
              },
            ],
            tool_history: [{ step: 1, action: 'finish', reason: '预览证据充分', status: 'ok' }],
          }),
          agent_trace: JSON.stringify([{ step: 1, action: 'finish', reason: '预览证据充分', status: 'ok' }]),
          proposed_schema: JSON.stringify({ type: 'object', properties: { milestone: { type: 'string' } } }),
        }),
      ]),
    );
    const user = userEvent.setup();
    renderWithApp(<ExtractResultPanel batchId="B-1" />);
    expect(await screen.findByText('项目里程碑计划')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Agent轨迹/ }));
    expect(await screen.findByText('包含打样节点、负责人和计划日期。')).toBeInTheDocument();
    expect(screen.getByText('primary:deepseek-v4-flash')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /证据/ }));
    expect(await screen.findByText('content.preview')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '动态 Schema' }));
    expect(await screen.findByText(/milestone/)).toBeInTheDocument();
  });

  it('renders nothing without a batch id', () => {
    renderWithApp(<ExtractResultPanel batchId={null} />);
    expect(screen.queryByText('提取结果')).not.toBeInTheDocument();
  });
});
