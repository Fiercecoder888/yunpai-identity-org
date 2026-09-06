import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { M0Document } from '../../services/m0Api';
import { renderWithApp } from '../../tests/testUtils';
import { M0BatchOriginalPreviewModal } from './M0BatchOriginalPreviewModal';

vi.mock('../../services/m0Api', () => ({
  getM0BatchDetail: vi.fn(),
  m0BatchDocumentFileUrl: (batchId: string, documentId: number) =>
    `/api/m0/import/batch/${batchId}/documents/${documentId}/file`,
  m0BatchDocumentPreviewUrl: (batchId: string, documentId: number) =>
    `/api/m0/import/batch/${batchId}/documents/${documentId}/preview.html`,
}));

import { getM0BatchDetail } from '../../services/m0Api';

const mockGetDetail = vi.mocked(getM0BatchDetail);

const document = (overrides: Partial<M0Document> = {}): M0Document => ({
  id: 1,
  batch_id: 'B-1',
  original_name: '送货单.pdf',
  stored_name: 'stored.pdf',
  content_hash: 'hash',
  detected_format: 'pdf',
  declared_ext: 'pdf',
  domain: 'purchase_receipt',
  confidence: 0.75,
  status: 'needs_review',
  message: '',
  row_count: 2,
  extract_status: 'agent_needs_review',
  extract_task_id: 'M1-1',
  extract_content: '{}',
  ...overrides,
});

const detailPayload = (documents: M0Document[]) => ({
  batch: {
    id: 'B-1',
    status: 'awaiting_review',
    source_names: '["送货单.pdf"]',
    stats: {},
    tenant_id: 'default',
    created_by: 'tester',
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  },
  documents,
  stats: {},
});

describe('M0BatchOriginalPreviewModal', () => {
  beforeEach(() => mockGetDetail.mockReset());

  it('previews PDF through the original file endpoint', async () => {
    mockGetDetail.mockResolvedValue(detailPayload([document()]));
    renderWithApp(<M0BatchOriginalPreviewModal batchId="B-1" open onClose={vi.fn()} />);

    expect(await screen.findByText('送货单.pdf')).toBeInTheDocument();
    const frame = screen.getByTitle('原文件预览-送货单.pdf') as HTMLIFrameElement;
    expect(frame.src).toContain('/api/m0/import/batch/B-1/documents/1/file');
    expect(frame).not.toHaveAttribute('sandbox');
  });

  it('uses the table preview endpoint and switches between batch documents', async () => {
    mockGetDetail.mockResolvedValue(detailPayload([
      document({ original_name: '送货单.xlsx', detected_format: 'xlsx' }),
      document({ id: 2, original_name: '签字页.png', stored_name: 'sign.png', detected_format: 'png' }),
    ]));
    renderWithApp(<M0BatchOriginalPreviewModal batchId="B-1" open onClose={vi.fn()} />);

    const tableFrame = await screen.findByTitle('原文件预览-送货单.xlsx') as HTMLIFrameElement;
    expect(tableFrame.src).toContain('/api/m0/import/batch/B-1/documents/1/preview.html');
    expect(tableFrame.getAttribute('sandbox')).toBe('');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择要核对的原文件' }));
    fireEvent.click(await screen.findByText('签字页.png', { selector: '.ant-select-item-option-content' }));
    const imageFrame = await screen.findByTitle('原文件预览-签字页.png') as HTMLIFrameElement;
    expect(imageFrame.src).toContain('/api/m0/import/batch/B-1/documents/2/file');
    expect(imageFrame).not.toHaveAttribute('sandbox');
  });

  it('keeps uploaded HTML isolated from scripts', async () => {
    mockGetDetail.mockResolvedValue(detailPayload([
      document({ original_name: '送货单.html', detected_format: 'html', declared_ext: 'html' }),
    ]));
    renderWithApp(<M0BatchOriginalPreviewModal batchId="B-1" open onClose={vi.fn()} />);

    const frame = await screen.findByTitle('原文件预览-送货单.html') as HTMLIFrameElement;
    expect(frame.src).toContain('/api/m0/import/batch/B-1/documents/1/file');
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('falls back to downloading formats the browser cannot reliably preview', async () => {
    mockGetDetail.mockResolvedValue(detailPayload([
      document({ original_name: '送货单.docx', detected_format: 'docx', declared_ext: 'docx' }),
    ]));
    renderWithApp(<M0BatchOriginalPreviewModal batchId="B-1" open onClose={vi.fn()} />);

    expect(await screen.findByText(/不能在浏览器中可靠预览/)).toBeInTheDocument();
    expect(screen.getAllByText('下载原文件').length).toBeGreaterThan(0);
  });
});
