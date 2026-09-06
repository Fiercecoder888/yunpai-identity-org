import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../tests/testUtils';
import { buildM7InventoryAllocationRequest, buildM7MaterialIssueItem, M7WarehousePanel } from './M7WarehousePanel';
import type { M7InventoryBalance } from '../services/m7Api';

vi.mock('../app/runtimeMode', () => ({ isMswDemoMode: () => true }));

vi.mock('../auth/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ me: { roles: ['warehouse_operator'] } }),
}));

vi.mock('./roles/useCurrentRole', () => ({
  useCurrentRole: () => ({ data: { id: 'warehouse_operator' } }),
}));

vi.mock('./m0/M0BurstCaptureModal', () => ({
  M0BurstCaptureModal: ({ onRecognized }: { onRecognized?: (batchId: string) => void }) => (
    <button type="button" onClick={() => onRecognized?.('B-REVIEW-1')}>模拟完成识别</button>
  ),
}));

vi.mock('./m0/M0BatchOriginalPreviewModal', () => ({
  M0BatchOriginalPreviewModal: ({ batchId, open }: { batchId: string | null; open: boolean }) =>
    open ? <div>正在预览批次 {batchId}</div> : null,
}));

vi.mock('../services/m7Api', () => ({
  approveM7OverIssue: vi.fn(),
  confirmM7Inspection: vi.fn(),
  createM7DeliveryNote: vi.fn(),
  createM7MaterialIssue: vi.fn(),
  createM7OverIssue: vi.fn(),
  listM7DeliveryNotes: vi.fn().mockResolvedValue([]),
  listM7MaterialIssues: vi.fn().mockResolvedValue([]),
  listM7PendingInspections: vi.fn().mockResolvedValue([]),
  queryM7Inventory: vi.fn().mockResolvedValue([]),
  sampleM7Inspection: vi.fn(),
  scanM7DeliveryNote: vi.fn().mockResolvedValue({
    m0_batch_id: 'B-REVIEW-1',
    suggested: { delivery_note_number: 'DN-1', warehouse_id: 'WH-01' },
    items: [],
    missing_fields: ['supplier_id'],
    warnings: [],
    recognized_document_types: ['purchase_receipt_ledger'],
    reference_fields: {},
    source_documents: [{ document_id: 1, original_name: '送货单.pdf' }],
    requires_human_review: true,
  }),
  signM7DeliveryNote: vi.fn(),
  upsertM7OrderMaterialRequirement: vi.fn(),
}));

describe('M7WarehousePanel 人工复核', () => {
  it('uses the selected inventory unit instead of stale form values', () => {
    const balance: M7InventoryBalance = {
      inventory_balance_id: 'balance-demo', warehouse_id: 'WH-01', material_id: 'MAT-DEMO-001',
      material_code: 'MAT-DEMO-001', batch_no: 'BATCH-DEMO-1', uom: 'pcs', quantity_on_hand: '10',
      quantity_available: '10', quantity_blocked: '0', quantity_reserved: '0', allocations: [],
    };

    expect(buildM7InventoryAllocationRequest(balance, { order_id: 'SO-DEMO-1', quantity: 2 })).toMatchObject({
      material_code: 'MAT-DEMO-001', uom: 'pcs',
    });
  });

  it('uses the selected inventory identity for material issues', () => {
    const balance: M7InventoryBalance = {
      inventory_balance_id: 'balance-filetype', warehouse_id: 'WH-01', material_id: 'MAT-FILETYPE-002',
      material_code: 'MAT-FILETYPE-002', batch_no: 'BATCH-FILETYPE-2', uom: 'pcs', quantity_on_hand: '10',
      quantity_available: '10', quantity_blocked: '0', quantity_reserved: '0', allocations: [],
    };

    expect(buildM7MaterialIssueItem(balance, 1)).toEqual({
      warehouse_id: 'WH-01', material_id: 'MAT-FILETYPE-002', material_code: 'MAT-FILETYPE-002',
      batch_no: 'BATCH-FILETYPE-2', requested_quantity: 1, uom: 'pcs',
    });
  });

  it.each([
    ['delivery', '送货签收'],
    ['qc', '品保待检 (0)'],
    ['issue', '领料/超领'],
    ['inventory', '库存'],
  ] as const)('opens the requested %s workflow tab', async (initialTab, tabLabel) => {
    renderWithApp(<M7WarehousePanel initialTab={initialTab} />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: tabLabel })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('shows an original-file preview action for the recognized batch', async () => {
    const user = userEvent.setup();
    renderWithApp(<M7WarehousePanel />);

    await user.click(screen.getByRole('button', { name: '模拟完成识别' }));
    expect(await screen.findByText('识别结果需要人工补充')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /预览原文件/ }));
    expect(await screen.findByText('正在预览批次 B-REVIEW-1')).toBeInTheDocument();
  });
});
