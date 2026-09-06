import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../auth/useAuthStore';
import type { EvidenceBatch, EvidenceModule } from '../../services/evidenceApi';
import * as evidenceApi from '../../services/evidenceApi';
import { HttpClientError } from '../../services/httpClient';
import { renderWithApp } from '../../tests/testUtils';
import { EvidenceAdjudicationPanel } from './EvidenceAdjudicationPanel';

vi.mock('../../services/evidenceApi', async (importActual) => ({
  ...(await importActual<typeof import('../../services/evidenceApi')>()),
  listEvidenceReviewQueue: vi.fn(),
  getEvidenceBatch: vi.fn(),
  listEvidenceAudit: vi.fn(),
  resolveEvidenceRow: vi.fn(),
  commitEvidenceBatch: vi.fn(),
}));

const batch = (module: EvidenceModule, state = 'awaiting_review'): EvidenceBatch => ({
  batchId: `${module}-batch-1`,
  module,
  sourceKind: 'standardized_input',
  sourceRef: 'SRC-1',
  trackingTaskId: 'task-evidence-1',
  state,
  allowedActions: state === 'ready' ? ['commit'] : [],
  factId: 'fact-1',
  rows: [{
    rowId: `${module}-row-1`, domainRef: 'ORDER-1', confidence: 0.72, state: 'needs_review',
    rawValue: { quantity: '8米' }, agentCandidate: { quantity: 8, unit: 'm' }, corrections: [{ field: 'quantity' }],
    pendingItems: { issues: ['unit requires confirmation'] }, sourceRefs: [{ source_id: 'source-1' }], factId: 'fact-row-1',
    allowedActions: ['accept', 'reject'],
  }],
});

const setTenant = (id: string, sessionId = 'session') => useAuthStore.setState({
  status: 'ready',
  me: {
    auth_mode: 'shared_anonymous', principal_id: 'evidence-reviewer', principal_type: 'shared_anonymous', user: { name: '审核员' },
    tenant: { id, name: id }, shared_data: true, roles: [], permissions: [],
    session: { id: sessionId, csrf_token: 'csrf', idle_expires_at: 'later', absolute_expires_at: 'later' },
  },
  error: undefined,
});

describe('EvidenceAdjudicationPanel', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.resetAllMocks();
    setTenant('tenant-a');
    vi.mocked(evidenceApi.listEvidenceReviewQueue).mockImplementation(async (module) => module === 'm3' ? [batch('m3')] : []);
    vi.mocked(evidenceApi.getEvidenceBatch).mockImplementation(async (module) => batch(module));
    vi.mocked(evidenceApi.listEvidenceAudit).mockResolvedValue([{ id: 'audit-1', batchId: 'm3-batch-1', fromState: 'received', toState: 'awaiting_review', actor: 'agent' }]);
    vi.mocked(evidenceApi.resolveEvidenceRow).mockResolvedValue({ ...batch('m3').rows[0]!, state: 'ok' });
    vi.mocked(evidenceApi.commitEvidenceBatch).mockResolvedValue({ batchId: 'm5-batch-1', state: 'committed', appliedRef: 'M5-APPLIED-1' });
  });

  it('renders the safe evidence detail and resolves through the real adapter before refreshing', async () => {
    const user = userEvent.setup();
    renderWithApp(<EvidenceAdjudicationPanel />);
    expect(await screen.findByText('ORDER-1')).toBeInTheDocument();
    expect(screen.getByText('Agent 候选值')).toBeInTheDocument();
    await user.type(screen.getByLabelText('m3-row-1 裁决理由'), '单位已按工艺确认');
    await user.click(screen.getByRole('button', { name: '接受建议' }));
    await waitFor(() => expect(evidenceApi.resolveEvidenceRow).toHaveBeenCalledWith('m3', 'm3-batch-1', 'm3-row-1', 'accept', '单位已按工艺确认'));
    await waitFor(() => expect(vi.mocked(evidenceApi.getEvidenceBatch).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('keeps an accepted M5 batch selected after queue refresh and commits it separately', async () => {
    let m5Batch = batch('m5');
    vi.mocked(evidenceApi.listEvidenceReviewQueue).mockImplementation(async (module) => (
      module === 'm5' && m5Batch.state === 'awaiting_review' ? [m5Batch] : []
    ));
    vi.mocked(evidenceApi.getEvidenceBatch).mockImplementation(async (module) => module === 'm5' ? m5Batch : batch(module));
    vi.mocked(evidenceApi.resolveEvidenceRow).mockImplementation(async () => {
      m5Batch = {
        ...m5Batch,
        state: 'ready',
        allowedActions: ['commit'],
        rows: [{ ...m5Batch.rows[0]!, state: 'ok', allowedActions: [] }],
      };
      return m5Batch.rows[0]!;
    });
    vi.mocked(evidenceApi.commitEvidenceBatch).mockImplementation(async () => {
      m5Batch = { ...m5Batch, state: 'committed', allowedActions: [], appliedRef: 'M5-APPLIED-1' };
      return { batchId: m5Batch.batchId, state: m5Batch.state, appliedRef: m5Batch.appliedRef };
    });
    const user = userEvent.setup();
    renderWithApp(<EvidenceAdjudicationPanel />);
    await user.type(await screen.findByLabelText('m5-row-1 裁决理由'), '质量门已确认');
    await user.click(screen.getByRole('button', { name: '接受建议' }));
    await waitFor(() => expect(evidenceApi.resolveEvidenceRow).toHaveBeenCalledWith('m5', 'm5-batch-1', 'm5-row-1', 'accept', '质量门已确认'));
    const commit = await screen.findByRole('button', { name: '提交证据' });
    await user.click(commit);
    await waitFor(() => expect(evidenceApi.commitEvidenceBatch).toHaveBeenCalledWith('m5', 'm5-batch-1'));
    expect(await screen.findByText('M5-APPLIED-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交证据' })).not.toBeInTheDocument();
  });

  it('refreshes the local Fact ID after commit without relabeling its source fact', async () => {
    let m4Batch: EvidenceBatch = {
      ...batch('m4', 'ready'),
      factId: undefined,
      sourceFactId: 'm3-source-fact-1',
    };
    vi.mocked(evidenceApi.listEvidenceReviewQueue).mockImplementation(async (module) => (
      module === 'm4' && m4Batch.state === 'ready' ? [m4Batch] : []
    ));
    vi.mocked(evidenceApi.getEvidenceBatch).mockImplementation(async (module) => module === 'm4' ? m4Batch : batch(module));
    vi.mocked(evidenceApi.commitEvidenceBatch).mockImplementation(async () => {
      m4Batch = { ...m4Batch, state: 'committed', factId: 'm4-local-fact-1', allowedActions: [] };
      return { batchId: m4Batch.batchId, state: m4Batch.state, appliedRef: 'M4-APPLIED-1' };
    });
    const user = userEvent.setup();
    renderWithApp(<EvidenceAdjudicationPanel />);
    const commit = await screen.findByRole('button', { name: '提交证据' });
    await user.click(commit);
    await waitFor(() => expect(screen.getAllByText('m4-local-fact-1').length).toBeGreaterThan(0));
    expect(screen.getAllByText('m3-source-fact-1').length).toBeGreaterThan(0);
  });

  it('hides accept when the server says re-standardization is required but keeps reject available', async () => {
    vi.mocked(evidenceApi.getEvidenceBatch).mockResolvedValue({
      ...batch('m3'),
      rows: [{ ...batch('m3').rows[0]!, allowedActions: ['reject'], acceptBlockedReason: '质量门未就绪；请修正后提交新的 Agent 标准化任务' }],
    });
    const user = userEvent.setup();
    renderWithApp(<EvidenceAdjudicationPanel />);
    await screen.findByText('质量门未就绪；请修正后提交新的 Agent 标准化任务');
    expect(screen.queryByRole('button', { name: '接受建议' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('m3-row-1 裁决理由'), '拒绝并重新标准化');
    await user.click(screen.getByRole('button', { name: '拒绝建议' }));
    await waitFor(() => expect(evidenceApi.resolveEvidenceRow).toHaveBeenCalledWith('m3', 'm3-batch-1', 'm3-row-1', 'reject', '拒绝并重新标准化'));
  });

  it('shows explicit API errors and never reuses evidence after a tenant switch', async () => {
    vi.mocked(evidenceApi.resolveEvidenceRow).mockRejectedValue(new HttpClientError({ status: 409, code: 'server_error', message: '批次状态已变化' }));
    const user = userEvent.setup();
    renderWithApp(<EvidenceAdjudicationPanel />);
    await user.type(await screen.findByLabelText('m3-row-1 裁决理由'), '状态冲突');
    await user.click(screen.getByRole('button', { name: '拒绝建议' }));
    expect(await screen.findByText('HTTP 409：批次状态已变化')).toBeInTheDocument();
    const callsBeforeSwitch = vi.mocked(evidenceApi.listEvidenceReviewQueue).mock.calls.filter(([module]) => module === 'm3').length;
    act(() => setTenant('tenant-b'));
    await waitFor(() => expect(vi.mocked(evidenceApi.listEvidenceReviewQueue).mock.calls.filter(([module]) => module === 'm3').length).toBeGreaterThan(callsBeforeSwitch));
    expect(screen.queryByText('HTTP 409：批次状态已变化')).not.toBeInTheDocument();
  });

  it('clears local notes and errors when the same tenant gets a new session', async () => {
    vi.mocked(evidenceApi.resolveEvidenceRow).mockRejectedValue(new HttpClientError({ status: 409, code: 'server_error', message: '会话前的错误' }));
    const user = userEvent.setup();
    renderWithApp(<EvidenceAdjudicationPanel />);
    const note = await screen.findByLabelText('m3-row-1 裁决理由');
    await user.type(note, '旧会话的裁决理由');
    await user.click(screen.getByRole('button', { name: '拒绝建议' }));
    expect(await screen.findByText('HTTP 409：会话前的错误')).toBeInTheDocument();

    act(() => setTenant('tenant-a', 'session-new'));

    await waitFor(() => expect(screen.getByLabelText('m3-row-1 裁决理由')).toHaveValue(''));
    expect(screen.queryByText('HTTP 409：会话前的错误')).not.toBeInTheDocument();
  });

  it('does not render a late tenant A queue response after switching to tenant B', async () => {
    let releaseTenantA: ((value: EvidenceBatch[]) => void) | undefined;
    const tenantAQueue = new Promise<EvidenceBatch[]>((resolve) => { releaseTenantA = resolve; });
    let m3Calls = 0;
    vi.mocked(evidenceApi.listEvidenceReviewQueue).mockImplementation(async (module) => {
      if (module !== 'm3') return [];
      m3Calls += 1;
      return m3Calls === 1 ? tenantAQueue : [];
    });
    renderWithApp(<EvidenceAdjudicationPanel />);
    await waitFor(() => expect(m3Calls).toBe(1));
    act(() => setTenant('tenant-b'));
    await waitFor(() => expect(m3Calls).toBe(2));
    await act(async () => { releaseTenantA?.([batch('m3')]); });
    await waitFor(() => expect(screen.queryByText('ORDER-1')).not.toBeInTheDocument());
  });

  it('does not reuse a late response after a tenant session is replaced and restored', async () => {
    let releaseA: ((value: EvidenceBatch[]) => void) | undefined;
    const pendingA = new Promise<EvidenceBatch[]>((resolve) => { releaseA = resolve; });
    let calls = 0;
    vi.mocked(evidenceApi.listEvidenceReviewQueue).mockImplementation(async (module) => {
      if (module !== 'm3') return [];
      calls += 1;
      return calls === 1 ? pendingA : [];
    });
    renderWithApp(<EvidenceAdjudicationPanel />);
    await waitFor(() => expect(calls).toBe(1));
    act(() => setTenant('tenant-b', 'session-b'));
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => { releaseA?.([batch('m3')]); });
    expect(screen.queryByText('ORDER-1')).not.toBeInTheDocument();
    act(() => setTenant('tenant-a', 'session-a-new'));
    await waitFor(() => expect(calls).toBe(3));
    expect(screen.queryByText('ORDER-1')).not.toBeInTheDocument();
  });
});
