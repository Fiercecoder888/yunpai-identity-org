import { CheckOutlined, CloseOutlined, HistoryOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Empty, Input, Space, Spin, Tag, Tooltip } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../auth/useAuthStore';
import {
  commitEvidenceBatch,
  evidenceModules,
  getEvidenceBatch,
  listEvidenceAudit,
  listEvidenceReviewQueue,
  resolveEvidenceRow,
  type EvidenceBatch,
  type EvidenceModule,
  type EvidenceRow,
} from '../../services/evidenceApi';
import { HttpClientError } from '../../services/httpClient';

const canResolve = (batch: EvidenceBatch, row: EvidenceRow, decision: 'accept' | 'reject') =>
  ['ready', 'awaiting_review'].includes(batch.state) && row.allowedActions.includes(decision);
const canCommit = (batch: EvidenceBatch) => batch.allowedActions?.includes('commit') === true;
const moduleLabel: Record<EvidenceModule, string> = { m3: 'M3', m4: 'M4', m5: 'M5' };

const formatError = (error: unknown) => {
  if (error instanceof HttpClientError) return `HTTP ${error.error.status ?? '网络'}：${error.error.message}`;
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
};

const jsonText = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '暂无';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

function JsonField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="evidence-json-field">
      <span>{label}</span>
      <pre>{jsonText(value)}</pre>
    </div>
  );
}

function DetailFields({ fields }: { fields: Array<[string, string | undefined]> }) {
  return (
    <dl className="evidence-detail-fields">
      {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '暂无'}</dd></div>)}
    </dl>
  );
}

function EvidenceModulePane({ module }: { module: EvidenceModule }) {
  const tenantId = useAuthStore((state) => state.me?.tenant.id);
  const sessionId = useAuthStore((state) => state.me?.session.id);
  const queryClient = useQueryClient();
  const [selectedBatchId, setSelectedBatchId] = useState<string>();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string>();
  const previousIdentity = useRef<string | undefined>(undefined);
  const queueKey = ['evidence-adjudication', tenantId, sessionId, module, 'queue'];
  const queue = useQuery({
    queryKey: queueKey,
    queryFn: () => listEvidenceReviewQueue(module),
    enabled: Boolean(tenantId && sessionId),
    gcTime: 0,
  });

  useEffect(() => {
    if (!selectedBatchId && queue.data?.[0]) setSelectedBatchId(queue.data[0].batchId);
  }, [queue.data, selectedBatchId]);

  useEffect(() => {
    const identity = `${tenantId ?? ''}:${sessionId ?? ''}`;
    if (previousIdentity.current && previousIdentity.current !== identity) {
      setSelectedBatchId(undefined);
      setNotes({});
      setActionError(undefined);
    }
    previousIdentity.current = identity;
  }, [sessionId, tenantId]);

  const detail = useQuery({
    queryKey: ['evidence-adjudication', tenantId, sessionId, module, 'detail', selectedBatchId],
    queryFn: () => getEvidenceBatch(module, selectedBatchId!),
    enabled: Boolean(tenantId && sessionId && selectedBatchId),
    gcTime: 0,
  });
  const audit = useQuery({
    queryKey: ['evidence-adjudication', tenantId, sessionId, module, 'audit', selectedBatchId],
    queryFn: () => listEvidenceAudit(module, selectedBatchId!),
    enabled: Boolean(tenantId && sessionId && selectedBatchId),
    gcTime: 0,
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['evidence-adjudication', tenantId, sessionId, module] });
  };
  const resolve = useMutation({
    mutationFn: ({ row, decision }: { row: EvidenceRow; decision: 'accept' | 'reject' }) =>
      resolveEvidenceRow(module, detail.data!.batchId, row.rowId, decision, notes[row.rowId]?.trim() ?? ''),
    onSuccess: async () => { setActionError(undefined); await invalidate(); },
    onError: (error) => setActionError(formatError(error)),
  });
  const commit = useMutation({
    mutationFn: () => commitEvidenceBatch(module, detail.data!.batchId),
    onSuccess: async () => { setActionError(undefined); await invalidate(); },
    onError: (error) => setActionError(formatError(error)),
  });
  const busy = resolve.isPending || commit.isPending;
  const batch = detail.data;
  const history = useMemo(() => audit.data ?? [], [audit.data]);

  if (!tenantId) return <Alert type="warning" showIcon message="当前会话未确认租户，无法读取证据批次。" />;

  return (
    <section className="evidence-adjudication-pane" aria-label={`${moduleLabel[module]} 证据与裁决`}>
      <div className="evidence-pane-toolbar">
        <span className="evidence-pane-title">{moduleLabel[module]} 待裁决批次</span>
        <Tooltip title="重新读取当前租户的待裁决批次">
          <Button aria-label="刷新证据批次" type="text" icon={<ReloadOutlined />} loading={queue.isFetching} onClick={() => void queue.refetch()} />
        </Tooltip>
      </div>
      {queue.isLoading ? <Spin size="small" /> : null}
      {queue.error ? <Alert type="error" showIcon message={formatError(queue.error)} /> : null}
      {!queue.isLoading && !queue.error && queue.data?.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前租户没有待裁决批次" /> : null}
      {queue.data?.length ? (
        <div className="evidence-batch-list">
          {queue.data.map((item) => (
            <div className="evidence-batch-list-item" key={item.batchId}>
              <Button
                className={item.batchId === selectedBatchId ? 'evidence-batch-select is-selected' : 'evidence-batch-select'}
                type="text"
                onClick={() => { setActionError(undefined); setSelectedBatchId(item.batchId); }}
              >
                <span>{item.batchId}</span><Tag>{item.state}</Tag><span>{item.sourceKind ?? '未标注来源'}</span>
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {detail.isLoading ? <Spin size="small" /> : null}
      {detail.error ? <Alert type="error" showIcon message={formatError(detail.error)} /> : null}
      {batch ? (
        <section className="evidence-batch-detail" aria-label={`${moduleLabel[module]} 批次详情`}>
          <div className="evidence-detail-heading">
            <Space wrap size={6}><strong>{batch.batchId}</strong><Tag color="blue">{batch.state}</Tag></Space>
            <Space wrap size={4}>
              {canCommit(batch) ? <Tooltip title="提交已接受的证据到正式业务记录"><Button aria-label={actionError ? '重试提交' : '提交证据'} icon={<SaveOutlined />} loading={commit.isPending} disabled={busy} onClick={() => commit.mutate()}>{actionError ? '重试提交' : '提交证据'}</Button></Tooltip> : null}
            </Space>
          </div>
          {actionError ? <Alert type="error" showIcon message={actionError} closable onClose={() => setActionError(undefined)} /> : null}
          <DetailFields fields={[
            ['模块', moduleLabel[module]], ['状态', batch.state], ['来源', batch.sourceRef], ['Tracking TaskID', batch.trackingTaskId],
            ['Fact ID', batch.factId], ['Source Fact ID', batch.sourceFactId], ['提交引用', batch.appliedRef],
          ]} />
          <div className="evidence-row-list">
            {batch.rows.map((row) => (
              <section className="evidence-row" key={row.rowId}>
                <div className="evidence-row-heading"><span>{row.domainRef ?? row.rowId}</span><Tag>{row.state}</Tag><span>置信度 {row.confidence ?? '暂无'}</span></div>
                <div className="evidence-json-grid">
                  <JsonField label="原始值" value={row.rawValue} /><JsonField label="Agent 候选值" value={row.agentCandidate} />
                  <JsonField label="修正项" value={row.corrections} /><JsonField label="待确认项" value={row.pendingItems} />
                  <JsonField label="Source refs" value={row.sourceRefs} />
                </div>
                <DetailFields fields={[
                  ['Fact ID', row.factId ?? batch.factId], ['裁决人', row.resolvedBy], ['裁决理由', row.resolveNote], ['应用引用', row.appliedRef],
                ]} />
                <Input.TextArea aria-label={`${row.rowId} 裁决理由`} value={notes[row.rowId] ?? ''} maxLength={500} autoSize={{ minRows: 2, maxRows: 4 }} disabled={(!canResolve(batch, row, 'accept') && !canResolve(batch, row, 'reject')) || busy} onChange={(event) => setNotes((current) => ({ ...current, [row.rowId]: event.target.value }))} placeholder="填写裁决理由" />
                <Space wrap>
                  {canResolve(batch, row, 'accept') ? <Tooltip title="接受标准化建议"><Button aria-label="接受建议" icon={<CheckOutlined />} disabled={busy || !notes[row.rowId]?.trim()} loading={resolve.isPending} onClick={() => resolve.mutate({ row, decision: 'accept' })}>接受建议</Button></Tooltip> : null}
                  {canResolve(batch, row, 'reject') ? <Tooltip title="拒绝当前建议，不会触发入库提交"><Button aria-label="拒绝建议" danger icon={<CloseOutlined />} disabled={busy || !notes[row.rowId]?.trim()} loading={resolve.isPending} onClick={() => resolve.mutate({ row, decision: 'reject' })}>拒绝建议</Button></Tooltip> : null}
                </Space>
                {row.acceptBlockedReason ? <span className="evidence-action-blocked">{row.acceptBlockedReason}</span> : null}
              </section>
            ))}
          </div>
          <section className="evidence-audit" aria-label="裁决审计记录">
            <div className="evidence-audit-heading"><HistoryOutlined /> 裁决审计记录</div>
            {audit.isLoading ? <Spin size="small" /> : null}
            {audit.error ? <Alert type="error" showIcon message={formatError(audit.error)} /> : null}
            {!audit.isLoading && !audit.error && !history.length ? <span>暂无</span> : null}
            {history.map((entry) => <div className="evidence-audit-entry" key={entry.id}>{entry.fromState} → {entry.toState} · {entry.actor ?? '系统'} · {entry.reason ?? '暂无理由'}</div>)}
          </section>
        </section>
      ) : null}
    </section>
  );
}

export function EvidenceAdjudicationPanel() {
  const tenantId = useAuthStore((state) => state.me?.tenant.id);
  const sessionId = useAuthStore((state) => state.me?.session.id);
  const queryClient = useQueryClient();
  const previousIdentity = useRef<{ tenantId?: string; sessionId?: string } | undefined>(undefined);
  useEffect(() => {
    const previous = previousIdentity.current;
    if (
      previous
      && (previous.tenantId !== tenantId || previous.sessionId !== sessionId)
    ) {
      const previousKey = ['evidence-adjudication', previous.tenantId, previous.sessionId];
      void queryClient.cancelQueries({ queryKey: previousKey }).then(() => {
        queryClient.removeQueries({ queryKey: previousKey });
      });
    }
    previousIdentity.current = { tenantId, sessionId };
  }, [queryClient, sessionId, tenantId]);
  useEffect(() => {
    return () => {
      // This review surface holds tenant-bound business evidence only while open.
      void queryClient.cancelQueries({ queryKey: ['evidence-adjudication'] }).then(() => {
        queryClient.removeQueries({ queryKey: ['evidence-adjudication'] });
      });
    };
  }, [queryClient]);
  return <div className="evidence-adjudication-panel">{evidenceModules.map((module) => <EvidenceModulePane key={module} module={module} />)}</div>;
}
