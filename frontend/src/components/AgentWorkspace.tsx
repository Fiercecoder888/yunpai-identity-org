import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Check, ChevronRight, CircleDot, FileBox, FileSpreadsheet, Menu, Paperclip, Plus, RefreshCw, Send, ShieldCheck, Square, Upload, X, Zap } from 'lucide-react';
import { getRun, getRuns, streamResume, streamRun } from '../lib/agentApi';
import { applyEvent, emptyAgentState, mergeRunState, moduleName, moduleProgress, summarizeResult, type AgentUiState } from '../lib/agentState';
import { formatBytes, isAllowedFile, toAttachment } from '../lib/upload';
import type { Attachment, AttachmentKind, Gate, RunState } from '../lib/types';
import { MODULES } from '../lib/types';

const labelForStatus: Record<string, string> = { idle: '待启动', running: '执行中', completed: '已完成', waiting: '待确认', failed: '失败' };
const gateTitle: Record<string, string> = { candidate: '候选数据确认', engineering: '工程草稿确认', procurement: '采购信息确认', apply: '排程发布确认', review: '识别结果复核', data: '补充权威数据' };

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
  const visible = result.shortage !== undefined || result.purchaseCount !== undefined || result.scheduleMinutes !== undefined;
  if (!visible) return null;
  return <div className="result-summary" data-testid="result-summary"><div className="result-summary-heading"><ShieldCheck size={16} /><strong>结果摘要</strong><span>来源：LangGraph 输出</span></div><div className="metric-grid">{result.shortage !== undefined && <div><span>缺料数量</span><strong>{result.shortage}</strong><small>件</small></div>}{result.purchaseCount !== undefined && <div><span>采购建议</span><strong>{result.purchaseCount}</strong><small>条</small></div>}{result.scheduleMinutes !== undefined && <div><span>排程总时长</span><strong>{result.scheduleMinutes}</strong><small>分钟</small></div>}{result.lifecycle && <div><span>计划生命周期</span><strong className="metric-state">{result.lifecycle === 'released' ? '已发布' : result.lifecycle}</strong></div>}</div></div>;
}

function GateCard({ gate, onDecision, busy }: { gate: Gate; onDecision: (decision: string, supplement?: Record<string, unknown>) => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const submitEdit = () => {
    try {
      const value = draft.trim() ? JSON.parse(draft) : {};
      onDecision('retry', value);
      setEditing(false);
    } catch {
      setDraft(`${draft}\n// 请输入有效 JSON`);
    }
  };
  return <section className="gate-card" data-testid="gate-card"><div className="gate-ribbon"><AlertTriangle size={16} /><span>需要人工确认</span><span className="gate-type">{gateTitle[gate.type] ?? gate.type}</span></div><div className="gate-card-content"><h3>{gate.message}</h3><p>模块：{moduleName(gate.module)} · 工具：<code>{gate.tool}</code></p>{editing ? <div className="gate-editor"><label htmlFor="gate-supplement">补充或修改数据</label><textarea id="gate-supplement" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder='例如：{"supplier_by_material":{"MAT-1":"SUP-1"}}' /><div className="gate-actions"><button type="button" className="button-secondary" onClick={() => setEditing(false)}>取消</button><button type="button" className="button-primary" onClick={submitEdit} disabled={busy}><Check size={15} />提交修改</button></div></div> : <div className="gate-actions"><button type="button" className="button-primary" onClick={() => onDecision('approve')} disabled={busy}><Check size={15} />接收</button><button type="button" className="button-danger" onClick={() => onDecision('reject')} disabled={busy}><X size={15} />拒绝</button><button type="button" className="button-secondary" onClick={() => setEditing(true)} disabled={busy}><RefreshCw size={15} />修改</button></div>}</div></section>;
}

function Conversation({ state, onDecision, busy }: { state: AgentUiState; onDecision: (decision: string, supplement?: Record<string, unknown>) => void; busy: boolean }) {
  const lastRequest = state.messages.find((message) => message.role === 'user');
  const assistant = state.messages.find((message) => message.id === 'assistant-live');
  return <div className="conversation-scroll" data-testid="conversation-scroll"><div className="conversation-intro"><span className="eyebrow">YUNPAI / CONTROL ROOM</span><h1>把业务目标交给 Agent</h1><p>订单、工程、物料、采购和排程，在同一个可恢复任务里完成。</p></div>{lastRequest && <div className="message-row message-user"><div className="avatar avatar-user">你</div><div className="message-bubble"><div className="message-meta">用户 <span>{timeLabel()}</span></div><p>{lastRequest.content}</p>{lastRequest.attachments?.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />)}</div></div>}{assistant && <div className="message-row message-agent"><div className="avatar avatar-agent"><Zap size={16} /></div><div className="message-bubble agent-bubble"><div className="message-meta">总 Agent <RunStatusPill status={state.status} /></div><p className="agent-stream-text">{assistant.content}{state.status === 'running' && <span className="typing-cursor" />}</p></div></div>}{state.activity.length > 0 && <div className="activity-feed" data-testid="activity-feed"><div className="feed-title"><Activity size={15} />执行记录</div>{state.activity.map((item) => <div className={`activity-item activity-${item.status}`} key={item.id}><span className="activity-icon">{item.status === 'completed' ? <Check size={13} /> : item.status === 'failed' ? <X size={13} /> : item.status === 'waiting' ? <AlertTriangle size={13} /> : <span className="spinner" />}</span><span className="activity-label">{item.label}</span><code>{item.detail}</code><span className="activity-state">{labelForStatus[item.status]}</span></div>)}</div>}{state.pendingGate && <GateCard gate={state.pendingGate} onDecision={onDecision} busy={busy} />}{state.status === 'failed' && !state.pendingGate && <div className="failure-card"><AlertTriangle size={18} /><div><strong>任务已停止</strong><p>{state.error ?? state.response ?? '后端返回失败状态'}</p></div></div>}{state.status === 'completed' && <div className="complete-card"><Check size={18} /><div><strong>任务已完成</strong><p>{state.response ?? '计划内工具已执行并通过审查。'}</p><small>运行ID：{state.runId}</small></div></div>}<ResultSummary state={state} /></div>;
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

  const consume = async (events: AsyncGenerator<any>) => {
    for await (const event of events) setState((current) => applyEvent(current, event));
  };

  const startRun = async () => {
    const message = draft.trim() || (attachments.some((item) => item.kind === 'order') ? '请根据订单附件执行订单到排程' : '请导入并审核这些基础资料');
    if (!message || busy) return;
    const next = emptyAgentState();
    next.messages = [{ id: `user-${Date.now()}`, role: 'user', content: message, attachments }];
    setState(next); setDraft(''); setError(''); setBusy(true); abortRef.current = new AbortController();
    const request = { message, ...(attachments.some((item) => item.kind === 'order') ? { workflow: 'm0_m5' } : {}), attachments };
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
    <section className="main-column" data-testid="main-column"><header className="main-header"><div><span className="eyebrow">AGENT CONVERSATION</span><h2>业务执行对话</h2></div><div className="header-actions"><span className="connection-state"><span className="connection-dot" />LangGraph 已连接</span>{state.runId && <code className="header-run-id">{state.runId.slice(0, 18)}</code>}</div></header><Conversation state={state} onDecision={decide} busy={busy} /><div className="composer-area" data-testid="composer"><div className="composer-attachments">{attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} />)}</div><div className="composer-box"><div className="upload-control"><button type="button" className="composer-plus" aria-label="上传或导入" aria-expanded={uploadMenuOpen} onClick={() => setUploadMenuOpen((open) => !open)}><Plus size={20} /></button>{uploadMenuOpen && <div className="upload-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setUploadMenuOpen(false); openUpload('order'); }}><Upload size={15} /><span>上传订单</span><small>订单到排程</small></button><button type="button" role="menuitem" onClick={() => { setUploadMenuOpen(false); openUpload('master_data'); }}><FileBox size={15} /><span>上传基础资料</span><small>建立数据候选</small></button></div>}</div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void startRun(); } }} placeholder="描述你要完成的制造业务目标…" disabled={busy} /><button type="button" className="send-button" aria-label={busy ? '停止生成' : '发送'} onClick={() => busy ? abortRef.current?.abort() : void startRun()}>{busy ? <Square size={17} /> : <Send size={17} />}</button></div><div className="composer-footer"><span><Paperclip size={13} />附件会随本次任务提交</span><span>Enter 发送 · Shift + Enter 换行</span></div></div>{error && <div className="toast-error" role="alert"><AlertTriangle size={16} />{error}<button type="button" onClick={() => setError('')}><X size={14} /></button></div>}</section>
    <div className={`panel-wrap right-panel-wrap ${mobilePanel === 'right' ? 'panel-open' : ''}`}><ProgressRail state={state} onClose={() => setMobilePanel(null)} /></div>
  </main>;
}
