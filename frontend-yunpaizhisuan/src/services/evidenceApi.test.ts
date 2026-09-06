import { describe, expect, it, vi } from 'vitest';
import {
  commitEvidenceBatch,
  getEvidenceBatch,
  listEvidenceAudit,
  listEvidenceReviewQueue,
  resolveEvidenceRow,
} from './evidenceApi';

const response = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
const envelope = (data: unknown) => ({ success: true, data, errors: [] });

describe('evidenceApi', () => {
  it('adapts the existing module route differences without sending a tenant override', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/history')) {
        return response(envelope([{ id: 'audit-1', batch_id: 'batch-m4', from_state: 'received', to_state: 'awaiting_review' }]));
      }
      if (url.includes('/resolve/')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ decision: 'accept', note: '已核对来源' }));
        return response(envelope({ row_id: 'row-1', row_state: 'ok', corrections: [], source_refs: [], allowed_actions: [] }));
      }
      if (url.includes('/batch/')) return response(envelope({ batch_id: 'batch-m4', state: 'awaiting_review', rows: [] }));
      return response(envelope([{ batch_id: 'batch-m4', state: 'awaiting_review', rows: [] }]));
    });
    try {
      await expect(listEvidenceReviewQueue('m4')).resolves.toMatchObject([{ batchId: 'batch-m4', module: 'm4' }]);
      await expect(getEvidenceBatch('m4', 'batch-m4')).resolves.toMatchObject({ batchId: 'batch-m4' });
      await expect(listEvidenceAudit('m4', 'batch-m4')).resolves.toMatchObject([{ batchId: 'batch-m4' }]);
      await expect(resolveEvidenceRow('m4', 'batch-m4', 'row-1', 'accept', '已核对来源')).resolves.toMatchObject({ state: 'ok' });
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        '/api/m4/evidence/batches?state=actionable&limit=50',
        '/api/m4/evidence/batch/batch-m4',
        '/api/m4/evidence/history?batch_id=batch-m4&limit=100',
        '/api/m4/evidence/batch/batch-m4/resolve/row-1',
      ]);
      expect(fetchSpy.mock.calls.every(([input]) => !String(input).includes('tenant'))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('uses every module real commit endpoint without a client business payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
      return response(envelope({ batch_id: 'batch-1', state: 'committed', applied_ref: 'APPLIED-1' }));
    });
    try {
      await expect(commitEvidenceBatch('m3', 'batch-1')).resolves.toMatchObject({ state: 'committed' });
      await expect(commitEvidenceBatch('m4', 'batch-1')).resolves.toMatchObject({ state: 'committed' });
      await expect(commitEvidenceBatch('m5', 'batch-1')).resolves.toMatchObject({ state: 'committed' });
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        '/api/m3/evidence/batch/batch-1/commit',
        '/api/m4/evidence/batch/batch-1/commit',
        '/api/m5/evidence/batch/batch-1/commit',
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps source facts separate from local applied Fact IDs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(envelope({
      batch_id: 'batch-m4', state: 'committed', source_fact_id: 'm3-source-fact', rows: [],
    })));
    try {
      await expect(getEvidenceBatch('m4', 'batch-m4')).resolves.toMatchObject({
        sourceFactId: 'm3-source-fact', factId: undefined,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('requests server-side batch history filtering for M3 and M5', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(envelope([])));
    try {
      await listEvidenceAudit('m3', 'old-batch');
      await listEvidenceAudit('m5', 'old-batch');
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
        '/api/m3/evidence/history?batch_id=old-batch&limit=100',
        '/api/m5/evidence/history?batch_id=old-batch&limit=100',
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

});
