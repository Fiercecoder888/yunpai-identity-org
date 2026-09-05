import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Check, ChevronRight, CircleDot, FileBox, FileSpreadsheet, Menu, Paperclip, Plus, RefreshCw, Send, ShieldCheck, Square, Upload, X, Zap } from 'lucide-react';
import { getRun, getRuns, streamResume, streamRun } from '../lib/agentApi';
import { applyEvent, deriveUploadSummary, emptyAgentState, mergeRunState, moduleName, moduleProgress, summarizeResult, type AgentUiState } from '../lib/agentState';
import { formatBytes, isAllowedFile, toAttachment } from '../lib/upload';
import type { Attachment, AttachmentKind, Gate, RunState } from '../lib/types';
import { MODULES } from '../lib/types';

const labelForStatus: Record<string, string> = { idle: '待启动', running: '执行中', completed: '已完成', waiting: '待确认', failed: '失败' };
const gateTitle: Record<string, string> = { candidate: '候选数据确认', sensitive_data: '敏感资料授权复核', engineering: '工程草稿确认', procurement: '采购信息确认', apply: '排程发布确认', review: '识别结果复核', data: '补充权威数据' };

function timeLabel(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function RunStatusPill({ status }: { status: string }) {
  const text = status === 'waiting_human' ? '等待人工' : status === 'completed' ? '已完成' : status === 'failed' ? '已失败' : status === 'running' ? '执行中' : '新任务';
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{text}</span>;
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  return <div className="attachment-chip"><FileSpreadsheet size={16} /><span title={attachment.filename}>{attachment.filename}</span><small>{formatBytes(attachment.size)}</small>{onRemove && <button type="button" aria-label={`移除 ${attachment.filename}`} onClick={onRemove}><X size={14} /></button>}</div>;
}

function LeftRail({ runs, activeId, attachments, onSelect, onNew, onUpload }: { runs: RunState[]; activeId: string; attachments: Attachment[]; onSelect: (run: RunState) => void; onNew: () => void; onUpload: (kind: AttachmentKind) => void }) {
  return <aside className="left-rail" data-testid="left-rail">
    <div className="brand-lockup"><div className="brand-mark"><Zap size={18} /></div><div><strong>云湃 Agent</strong><span>制造业务工作台</span></div></div>
    <button type="button" className="new-run-button" onClick={onNew}><Plus size={17} />新建任务</button>
    <div className="rail-section-heading"><span>运行任务</span><span className="count-badge">{runs.length}</span></div>
    <div className="run-list" data-testid="run-list">
      {runs.length === 0 ? <div className="empty-rail"><CircleDot size={18} /><span>还没有运行任务</span><small>从中间输入目标开始</small></div> : runs.map((run) => <button type="button" key={run.run_id} className={`run-item ${run.run_id === activeId ? 'is-active' : ''}`} onClick={() => onSelect(run)}>
        <div className="run-item-title"><span>{String(run.request?.message ?? '未命名任务').slice(0, 24)}</span><ChevronRight size={15} /></div><div className="run-item-meta"><span>{run.task_id.slice(0, 16)}</span><RunStatusPill status={run.status} /></div>
      </button>)}
    </div>
    <div className="rail-bottom">
      <div className="rail-section-heading"><span>附件上下文</span><span className="count-badge">{attachments.length}</span></div>
      <div className="rail-attachments">{attachments.length ? attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />) : <p className="muted-copy">从对话框加号上传订单或基础资料</p>}</div>
      <div className="rail-upload-actions"><button type="button" onClick={() => onUpload('order')}><Upload size={15} />订单文件</button><button type="button" onClick={() => onUpload('master_data')}><FileBox size={15} />基础资料</button></div>
    </div>
  </aside>;
}

function ProgressRail({ state, onClose }: { state: AgentUiState; onClose?: () => void }) {
  return <aside className="progress-rail" data-testid="progress-rail">
    <div className="progress-header"><div><span className="eyebrow">LIVE EXECUTION</span><h2>执行进度</h2></div>{onClose && <button type="button" className="icon-button mobile-only" aria-label="关闭执行进度" onClick={onClose}><X size={18} /></button>}</div>
    <div className="task-identity"><span>当前 TaskID</span><code>{state.taskId || '等待创建'}</code></div>
    <div className="module-progress-list">
      {MODULES.map((module) => {
        const progress = moduleProgress(state, module.id);
        return <div className={`module-progress module-${progress.status}`} key={module.id} data-testid={`module-progress-${module.id}`}>
          <div className="progress-node"><span className="module-node">{progress.status === 'completed' ? <Check size={14} /> : progress.status === 'failed' ? <X size={14} /> : <span>{module.id.toUpperCase()}</span>}</span><span className="progress-line" /></div>
          <div className="module-progress-body"><div className="module-title-row"><strong>{module.name}</strong><span>{labelForStatus[progress.status]}</span></div><p>{module.description}</p><div className="progress-track"><span style={{ width: `${progress.percent}%` }} /></div><small>{progress.detail}</small></div>
        </div>;
      })}
    </div>
    <div className="current-agent-box"><div className="current-agent-heading"><Activity size={15} /><span>当前 Agent 动作</span></div><strong>{state.currentStep ? state.currentStep : state.status === 'completed' ? '全部步骤已完成' : '等待用户输入'}</strong><small>{state.status === 'waiting_human' ? '流程已暂停，等待你的决定' : state.status === 'failed' ? state.error ?? '执行失败' : '所有执行记录均来自后端状态快照'}</small></div>
  </aside>;
}

function ResultSummary({ state }: { state: AgentUiState }) {
  const result = summarizeResult(state);
  const upload = deriveUploadSummary(state);
  const visible = result.shortage !== undefined || result.purchaseCount !== undefined || result.scheduleMinutes !== undefined || Boolean(upload) || Boolean(result.m0BatchId);
  if (!visible) return null;
  return <div className="result-summary" data-testid="result-summary"><div className="result-summary-heading"><ShieldCheck size={16} /><strong>结果摘要</strong><span>来源：LangGraph 输出</span></div><div className="metric-grid">{result.m0BatchId && <div className="metric-span"><span>M0 批次</span><strong>{result.m0BatchId}</strong><small>{result.m0Environment === 'sandbox' || result.m0Canonical === false ? 'sandbox 候选 · 非 canonical' : result.m0Environment ?? 'M0'} · 未发布 canonical</small></div>}{upload && <div className="metric-span"><span>文件上传</span><strong>{upload.accepted ?? 0} 成功 · {upload.needs_review ?? 0} 复核 · {upload.skipped ?? 0} 跳过 · {upload.parse_failed ?? 0} 失败</strong><small>共 {upload.total ?? 0} 个文件 · 模式 {String(upload.mode ?? '-')}</small></div>}{result.shortage !== undefined && <div><span>缺料数量</span><strong>{result.shortage}</strong><small>件</small></div>}{result.purchaseCount !== undefined && <div><span>采购建议</span><strong>{result.purchaseCount}</strong><small>条</small></div>}{result.scheduleMinutes !== undefined && <div><span>排程总时长</span><strong>{result.scheduleMinutes}</strong><small>分钟</small></div>}{result.lifecycle && <div><span>计划生命周期</span><strong className="metric-state">{result.lifecycle === 'released' ? '已发布' : result.lifecycle}</strong></div>}</div></div>;
}

function PmcSchedulePanel({ state }: { state: AgentUiState }) {
  const data: any = state.outputs?.solve_scheduling?.data;
  const schedule = data?.schedule;
  const operations = Array.isArray(schedule?.operations) ? schedule.operations : [];
  if (!operations.length) return null;
  const startMs = Math.min(...operations.map((op: any) => Date.parse(op.plan_start)));
  const endMs = Math.max(...operations.map((op: any) => Date.parse(op.plan_end)));
  const span = Math.max(endMs - startMs, 60000);
  const fmt = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const metrics = schedule.metrics ?? {};
  const summary = schedule.summary_metrics ?? {};
  const workers = Array.isArray(schedule.worker_utilization) ? schedule.worker_utilization : [];
  const ganttGroups = operations.reduce((groups: Record<string, any[]>, op: any) => {
    const key = String(op.op_code || op.operation_name || op.schedule_operation_id);
    (groups[key] ||= []).push(op);
    return groups;
  }, {});
  const stations = Array.isArray(schedule.station_utilization) ? schedule.station_utilization : [];
  const wipEdges = Array.isArray(schedule.wip_edges) ? schedule.wip_edges : [];
  const stateSegments = Array.isArray(schedule.state_segments) ? schedule.state_segments : [];
  return <section className="pmc-panel" data-testid="pmc-schedule-panel">
    <div className="pmc-panel-heading"><div><span className="eyebrow">PMC / WIP V2</span><h3>可执行排程明细</h3><p>{schedule.algorithm_version ?? data.algorithm_version ?? 'pmc-v2'} · {schedule.solver_status ?? 'feasible'} · {schedule.plan_version}</p></div><ShieldCheck size={20} /></div>
    <div className="pmc-metrics"><span><b>{metrics.operation_count ?? operations.length}</b> 道工序</span><span><b>{metrics.makespan_minutes ?? 0}</b> 分钟跨度</span><span><b>{metrics.processing_minutes ?? 0}</b> 分钟加工</span><span><b>{metrics.setup_minutes ?? 0}</b> 分钟换型</span><span><b>{wipEdges.length || metrics.wip_deferred_count || 0}</b> 条 WIP 边</span><span><b>{summary.average_wip_wait_minutes ?? 0}</b> 分钟平均 WIP</span><span><b>{summary.selected_worker_average_planned_occupancy_rate != null ? `${(Number(summary.selected_worker_average_planned_occupancy_rate) * 100).toFixed(1)}%` : '-'}</b> 人工占用</span></div>
    {schedule.production_blocked && <div className="pmc-data-gate"><strong>当前仅可检查，禁止投产</strong><span>WIP PMC 需要真实工位、人员和日历绑定；缺失项已在后端 blocks 中保留，不能用设备编码代替。</span></div>}
    <div className="pmc-table-wrap"><table className="pmc-table"><thead><tr><th>序</th><th>工序 / 编码</th><th>真实工位</th><th>人员</th><th>机器</th><th>开始</th><th>结束</th><th>工时</th><th>良率</th><th>状态</th></tr></thead><tbody>{operations.map((op: any, index: number) => <tr key={op.schedule_operation_id}><td>{op.sequence_no ?? index + 1}</td><td><strong>{op.operation_name ?? op.op_code}</strong><small>{op.op_code}</small></td><td>{op.station_code || '未绑定'}</td><td>{op.person_code || '未绑定'}</td><td>{op.equipment_code || '未绑定'}</td><td>{fmt(op.plan_start)}</td><td>{fmt(op.plan_end)}</td><td>{op.processing_minutes} min</td><td>{op.yield_rate != null ? `${(Number(op.yield_rate) * 100).toFixed(1)}%` : '-'}</td><td><span className="pmc-state">{op.wip_state ?? 'released'}</span></td></tr>)}</tbody></table></div>
    <div className="pmc-gantt" aria-label="PMC 工序甘特图"><div className="pmc-gantt-axis"><span>{fmt(new Date(startMs).toISOString())}</span><span>{fmt(new Date(startMs + span / 2).toISOString())}</span><span>{fmt(new Date(endMs).toISOString())}</span></div>{(Object.entries(ganttGroups) as Array<[string, any[]]>).map(([key, group], index) => <div className="pmc-gantt-row" key={`gantt-${key}`}><div className="pmc-gantt-label"><span>{String(index + 1).padStart(2, '0')}</span>{group[0].operation_name ?? key}<small>{group.length > 1 ? `${group.length} 个转移批次` : key}</small></div><div className="pmc-gantt-track">{group.map((op: any) => { const left = ((Date.parse(op.plan_start) - startMs) / span) * 100; const width = Math.max(1.2, ((Date.parse(op.plan_end) - Date.parse(op.plan_start)) / span) * 100); return <span className="pmc-gantt-bar" key={`gantt-bar-${op.schedule_operation_id}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${op.operation_name ?? op.op_code} B${op.batch_index ?? 1} ${fmt(op.plan_start)} - ${fmt(op.plan_end)}`}><b>{op.batch_index ? `B${op.batch_index}` : (op.equipment_code || op.station_code || '')}</b></span>; })}</div></div>)}</div>
    <div className="pmc-detail-grid"><div><h4>工位利用率</h4><div className="pmc-table-wrap"><table className="pmc-table"><thead><tr><th>工位</th><th>已分配</th><th>可用</th><th>利用率</th></tr></thead><tbody>{stations.map((item: any) => <tr key={item.station_id}><td><strong>{item.station_name}</strong><small>{item.station_id}</small></td><td>{item.assigned_minutes} min</td><td>{item.available_minutes} min</td><td>{(Number(item.utilization || 0) * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></div><div><h4>人工利用率</h4><div className="pmc-table-wrap"><table className="pmc-table"><thead><tr><th>人员</th><th>已分配 / 可用</th><th>占用</th><th>有效运行</th></tr></thead><tbody>{workers.map((item: any) => <tr key={item.worker_id}><td><strong>{item.worker_name}</strong><small>{item.worker_id} · {item.station_id || '未绑定工位'}</small></td><td>{item.assigned_minutes} / {item.available_minutes} min</td><td>{(Number(item.planned_occupancy_rate || 0) * 100).toFixed(1)}%</td><td>{(Number(item.effective_running_rate || 0) * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></div></div>
    <div><h4>工位间 WIP</h4><div className="pmc-table-wrap"><table className="pmc-table"><thead><tr><th>衔接</th><th>上游工位 → 下游工位</th><th>等待</th><th>目标</th><th>状态</th></tr></thead><tbody>{wipEdges.map((edge: any) => <tr key={edge.edge_id}><td>{edge.from_operation_id} → {edge.to_operation_id}</td><td>{edge.from_station_id || '-'} → {edge.to_station_id || '-'}</td><td>{edge.current_wip_minutes} min</td><td>{edge.target_wip_minutes} min</td><td><span className="pmc-state">{edge.current_wip_minutes ? '有 WIP 等待' : '无等待'}</span></td></tr>)}</tbody></table></div></div>
    <div><h4>工位状态段 <small>{stateSegments.length} 段</small></h4><div className="pmc-state-strip">{stateSegments.slice(0, 24).map((segment: any, index: number) => <span key={`${segment.operation_id}-${segment.start}-${index}`} className={`pmc-state-segment pmc-state-${segment.state}`} title={`${segment.operation_id} · ${segment.station_id} · ${segment.reason_code}`}>{segment.operation_id} · {segment.station_id} · {segment.state} · {segment.duration_minutes}m</span>)}</div></div>
  </section>;
}

function GateCard({ gate, onDecision, busy }: { gate: Gate; onDecision: (decision: string, supplement?: Record<string, unknown>) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState('');
  const bomInput = useRef<HTMLInputElement>(null);
  const sopInput = useRef<HTMLInputElement>(null);
  const submitEdit = () => {
    try {
      const value = draft.trim() ? JSON.parse(draft) : {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('补充数据必须是 JSON 对象，不能是数组、字符串、数字或 null');
      onDecision('retry', value);
      setEditError('');
      setEditing(false);
    } catch (caught) {
      setEditError(caught instanceof SyntaxError ? 'JSON 格式无效，请检查引号、逗号和括号' : (caught as Error).message);
    }
  };
  const uploadSupplement = async (file: File | undefined, kind: 'bom' | 'sop') => {
    if (!file) return;
    try {
      const attachment = await toAttachment(file, 'master_data');
      onDecision('retry', kind === 'bom' ? { bom_files: [attachment] } : { sop_files: [attachment] });
      setEditError('');
    } catch (caught) {
      setEditError((caught as Error).message);
    } finally {
      if (bomInput.current) bomInput.current.value = '';
      if (sopInput.current) sopInput.current.value = '';
    }
  };
  return <section className="gate-card" data-testid="gate-card"><div className="gate-ribbon"><AlertTriangle size={16} /><span>需要人工确认</span><span className="gate-type">{gateTitle[gate.type] ?? gate.type}</span></div><div className="gate-card-content"><h3>{gate.message}</h3><p>模块：{moduleName(gate.module)} · 工具：<code>{gate.tool}</code></p><input ref={bomInput} className="hidden-file-input" type="file" accept=".xlsx,.xls,.xlsm,.csv" onChange={(event) => { void uploadSupplement(event.target.files?.[0], 'bom'); }} /><input ref={sopInput} className="hidden-file-input" type="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf,.docx,.doc,.png,.jpg,.jpeg" onChange={(event) => { void uploadSupplement(event.target.files?.[0], 'sop'); }} />{editing ? <div className="gate-editor"><label htmlFor="gate-supplement">补充或修改数据</label><textarea id="gate-supplement" value={draft} aria-invalid={Boolean(editError)} onChange={(event) => { setDraft(event.target.value); setEditError(''); }} placeholder='例如：{"bom_lines":[{"material_code":"MAT-1","quantity_per":1}]}' />{editError && <p className="field-error" role="alert">{editError}</p>}<div className="gate-actions"><button type="button" className="button-secondary" onClick={() => { setEditing(false); setEditError(''); }}>取消</button><button type="button" className="button-primary" onClick={submitEdit} disabled={busy}><Check size={15} />提交修改</button></div></div> : <div className="gate-actions"><button type="button" className="button-primary" onClick={() => onDecision('approve')} disabled={busy}><Check size={15} />接收</button><button type="button" className="button-danger" onClick={() => onDecision('reject')} disabled={busy}><X size={15} />拒绝</button><button type="button" className="button-secondary" onClick={() => { setDraft(''); setEditError(''); setEditing(true); }} disabled={busy}><RefreshCw size={15} />修改</button><button type="button" className="button-secondary" onClick={() => bomInput.current?.click()} disabled={busy}><Upload size={15} />上传 BOM</button><button type="button" className="button-secondary" onClick={() => sopInput.current?.click()} disabled={busy}><Upload size={15} />上传 SOP/工时</button></div>}</div></section>;
}

function Conversation({ state, onDecision, busy }: { state: AgentUiState; onDecision: (decision: string, supplement?: Record<string, unknown>) => void; busy: boolean }) {
  const lastRequest = state.messages.find((message) => message.role === 'user');
  const assistant = state.messages.find((message) => message.id === 'assistant-live');
  return <div className="conversation-scroll" data-testid="conversation-scroll"><div className="conversation-intro"><span className="eyebrow">YUNPAI / CONTROL ROOM</span><h1>把业务目标交给 Agent</h1><p>订单、工程、物料、采购和排程，在同一个可恢复任务里完成。</p></div>{lastRequest && <div className="message-row message-user"><div className="avatar avatar-user">你</div><div className="message-bubble"><div className="message-meta">用户 <span>{timeLabel()}</span></div><p>{lastRequest.content}</p>{lastRequest.attachments?.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />)}</div></div>}{assistant && <div className="message-row message-agent"><div className="avatar avatar-agent"><Zap size={16} /></div><div className="message-bubble agent-bubble"><div className="message-meta">总 Agent <RunStatusPill status={state.status} /></div><p className="agent-stream-text">{assistant.content}{state.status === 'running' && <span className="typing-cursor" />}</p></div></div>}{state.activity.length > 0 && <div className="activity-feed" data-testid="activity-feed"><div className="feed-title"><Activity size={15} />执行记录</div>{state.activity.map((item) => <div className={`activity-item activity-${item.status}`} key={item.id}><span className="activity-icon">{item.status === 'completed' ? <Check size={13} /> : item.status === 'failed' ? <X size={13} /> : item.status === 'waiting' ? <AlertTriangle size={13} /> : <span className="spinner" />}</span><span className="activity-label">{item.label}</span><code>{item.detail}</code><span className="activity-state">{labelForStatus[item.status]}</span></div>)}</div>}{state.pendingGate && <GateCard gate={state.pendingGate} onDecision={onDecision} busy={busy} />}{state.status === 'failed' && !state.pendingGate && <div className="failure-card"><AlertTriangle size={18} /><div><strong>任务已停止</strong><p>{state.error ?? state.response ?? '后端返回失败状态'}</p></div></div>}{state.status === 'completed' && <div className="complete-card"><Check size={18} /><div><strong>任务已完成</strong><p>{state.response ?? '计划内工具已执行并通过审查。'}</p><small>运行ID：{state.runId}</small></div></div>}<ResultSummary state={state} /><PmcSchedulePanel state={state} /></div>;
}

export function AgentWorkspace() {
  const [state, setState] = useState<AgentUiState>(emptyAgentState);
  const [runs, setRuns] = useState<RunState[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'left' | 'right' | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const orderInput = useRef<HTMLInputElement>(null);
  const masterInput = useRef<HTMLInputElement>(null);

  const refreshRuns = () => getRuns().then(setRuns).catch(() => undefined);
  useEffect(() => { refreshRuns(); }, []);

  const canSubmit = Boolean(draft.trim() || attachments.length);

  const consume = async (events: AsyncGenerator<any>) => {
    for await (const event of events) setState((current) => applyEvent(current, event));
  };

  const startRun = async () => {
    if (!canSubmit) return;
    const message = draft.trim() || (attachments.some((item) => item.kind === 'order') ? '请根据订单附件执行订单到排程' : '请导入并审核这些基础资料');
    if (!message || busy) return;
    const next = emptyAgentState();
    next.messages = [{ id: `user-${Date.now()}`, role: 'user', content: message, attachments }];
    setState(next); setDraft(''); setError(''); setBusy(true); abortRef.current = new AbortController();
    const request = {
      message,
      ...(attachments.some((item) => item.kind === 'order') ? { workflow: 'm1_m5_document_to_plan' } : {}),
      attachments,
    };
    try { await consume(streamRun(request, abortRef.current.signal)); } catch (caught) { if ((caught as Error).name !== 'AbortError') setError((caught as Error).message); } finally { setBusy(false); abortRef.current = null; refreshRuns(); }
  };

  const decide = async (decision: string, supplement?: Record<string, unknown>) => {
    if (!state.runId || busy) return;
    setBusy(true); setError(''); abortRef.current = new AbortController();
    try { await consume(streamResume(state.runId, decision, supplement, abortRef.current.signal)); } catch (caught) { if ((caught as Error).name !== 'AbortError') setError((caught as Error).message); } finally { setBusy(false); abortRef.current = null; refreshRuns(); }
  };

  const selectRun = async (run: RunState) => {
    if (busy) return;
    try { const loaded = await getRun(run.run_id); const next = mergeRunState(emptyAgentState(), loaded); const message = String(loaded.request?.message ?? ''); next.messages = message ? [{ id: `user-${loaded.run_id}`, role: 'user', content: message }] : []; if (loaded.response) next.messages.push({ id: 'assistant-live', role: 'assistant', content: loaded.response }); setState(next); setMobilePanel(null); } catch (caught) { setError((caught as Error).message); }
  };

  const openUpload = (kind: AttachmentKind) => (kind === 'order' ? orderInput : masterInput).current?.click();
  const onFiles = async (kind: AttachmentKind, files?: FileList | null) => {
    if (!files?.length) return;
    try {
      const selected = Array.from(files);
      const supported = selected.filter((file) => isAllowedFile(file.name, kind));
      if (!supported.length) throw new Error(`所选${kind === 'order' ? '订单' : '基础资料'}文件夹中没有可识别文件`);
      const next = await Promise.all(supported.map((file) => toAttachment(file, kind, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)));
      setAttachments((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        next.forEach((item) => byId.set(item.id, item));
        return [...byId.values()];
      });
      setError(supported.length < selected.length ? `已跳过 ${selected.length - supported.length} 个不支持的文件，其余文件已加入附件` : '');
    } catch (caught) { setError((caught as Error).message); }
  };
  const clearRun = () => { abortRef.current?.abort(); setState(emptyAgentState()); setAttachments([]); setDraft(''); setError(''); };

  return <main className="app-shell">
    <input ref={orderInput} className="hidden-file-input" type="file" accept=".csv,.xlsx,.xls,.zip,.pdf,.png,.jpg,.jpeg,.json" multiple onChange={(event) => { void onFiles('order', event.target.files); event.currentTarget.value = ''; }} />
    <input ref={masterInput} className="hidden-file-input" type="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf,.docx,.doc,.pptx,.dwg,.dxf,.png,.jpg,.jpeg,.zip,.rar,.7z,.json" multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => { void onFiles('master_data', event.target.files); event.currentTarget.value = ''; }} />
    <button className="mobile-panel-trigger left-trigger" type="button" aria-label="打开任务列表" onClick={() => setMobilePanel('left')}><Menu size={18} /></button>
    <button className="mobile-panel-trigger right-trigger" type="button" aria-label="打开执行进度" onClick={() => setMobilePanel('right')}><Activity size={18} /></button>
    {mobilePanel && <div className="mobile-scrim" onClick={() => setMobilePanel(null)} />}
    <div className={`panel-wrap left-panel-wrap ${mobilePanel === 'left' ? 'panel-open' : ''}`}><LeftRail runs={runs} activeId={state.runId} attachments={attachments} onSelect={selectRun} onNew={clearRun} onUpload={openUpload} /></div>
    <section className="main-column" data-testid="main-column"><header className="main-header"><div><span className="eyebrow">AGENT CONVERSATION</span><h2>业务执行对话</h2></div><div className="header-actions"><span className="connection-state"><span className="connection-dot" />LangGraph 已连接</span>{state.runId && <code className="header-run-id">{state.runId.slice(0, 18)}</code>}</div></header><Conversation state={state} onDecision={decide} busy={busy} /><div className="composer-area" data-testid="composer"><div className="composer-attachments">{attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} />)}</div><div className="composer-box"><div className="upload-control"><button type="button" className="composer-plus" aria-label="上传或导入" aria-expanded={uploadMenuOpen} onClick={() => setUploadMenuOpen((open) => !open)}><Plus size={20} /></button>{uploadMenuOpen && <div className="upload-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setUploadMenuOpen(false); openUpload('order'); }}><Upload size={15} /><span>上传订单</span><small>订单到排程</small></button><button type="button" role="menuitem" onClick={() => { setUploadMenuOpen(false); openUpload('master_data'); }}><FileBox size={15} /><span>上传基础资料</span><small>建立数据候选</small></button></div>}</div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void startRun(); } }} placeholder="描述你要完成的制造业务目标…" disabled={busy} /><button type="button" className="send-button" aria-label={busy ? '停止生成' : '发送'} disabled={!busy && !canSubmit} onClick={() => busy ? abortRef.current?.abort() : void startRun()}>{busy ? <Square size={17} /> : <Send size={17} />}</button></div><div className="composer-footer"><span><Paperclip size={13} />附件会随本次任务提交</span><span>Enter 发送 · Shift + Enter 换行</span></div></div>{error && <div className="toast-error" role="alert"><AlertTriangle size={16} />{error}<button type="button" onClick={() => setError('')}><X size={14} /></button></div>}</section>
    <div className={`panel-wrap right-panel-wrap ${mobilePanel === 'right' ? 'panel-open' : ''}`}><ProgressRail state={state} onClose={() => setMobilePanel(null)} /></div>
  </main>;
}
