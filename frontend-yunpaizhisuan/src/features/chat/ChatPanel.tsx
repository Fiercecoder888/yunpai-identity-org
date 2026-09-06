import { EditOutlined, FolderOpenOutlined, LoadingOutlined, PlusOutlined, RobotOutlined, StopOutlined, ToolOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble, Sender } from '@ant-design/x/lib';
import { Alert, Button, Dropdown, Empty, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { requestFollowUps, type ChatStreamItem, type ChatStreamOptions } from '../../services/chatApi';
import { useChatStore } from '../../store/useChatStore';
import { M2RunArtifacts } from '../m2/M2RunArtifacts';
import { M0DocArtifacts } from '../m0/M0DocArtifacts';
import type { M7WarehouseTab } from '../M7WarehousePanel';
import {
  m7DeliveryDraftContext,
  type M7DeliveryDraft,
} from '../m7/m7RecognitionMessages';
import { ToolDataRefPreview } from './ToolDataRefPreview';

type ChatStreamFactory = (prompt: string, options?: ChatStreamOptions) => AsyncGenerator<ChatStreamItem>;
export type ChatToolAction = 'order-upload' | 'm0-import' | 'master-data-upload' | 'm7-warehouse' | 'pmc-progress' | 'piece-wage' | 'evidence-adjudication';
export type ChatToolActionOptions = {
  m7Tab?: M7WarehouseTab;
  m7Panel?: 'file-recognition';
  trackingTaskId?: string;
};

export const SUGGESTED_PROMPTS = ['检查采购预警与物料齐套风险', '排查本周排程冲突', '查看最近订单全链路', '有一批供应商的货要入库了'];
const EMPTY_REPLY_FALLBACK = '未获取到有效回答，请重试或换一种问法';
const M7_PREPARE_WORKFLOW_TABS = {
  prepare_m7_inbound_workflow: 'delivery',
  prepare_m7_quality_inspection_workflow: 'qc',
  prepare_m7_material_issue_workflow: 'issue',
  prepare_m7_inventory_query_workflow: 'inventory',
} as const satisfies Record<string, M7WarehouseTab>;
const M7_WORKFLOW_LABELS: Record<M7WarehouseTab, string> = {
  delivery: 'M7 送货签收流程',
  qc: 'M7 品保待检流程',
  issue: 'M7 领料/超领流程',
  inventory: 'M7 库存流程',
};

const m7WorkflowTab = (tool: string): M7WarehouseTab | undefined =>
  M7_PREPARE_WORKFLOW_TABS[tool as keyof typeof M7_PREPARE_WORKFLOW_TABS];

const m7WorkflowOptions = (tool: string, result: unknown): ChatToolActionOptions | undefined => {
  const tab = m7WorkflowTab(tool);
  if (!tab) return undefined;
  const envelope = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data as Record<string, unknown> : {};
  const uiAction = data.ui_action && typeof data.ui_action === 'object' ? data.ui_action as Record<string, unknown> : {};
  const panel = uiAction.panel === 'file-recognition' || tool === 'prepare_m7_inbound_workflow'
    ? 'file-recognition'
    : undefined;
  return {
    m7Tab: tab,
    ...(panel ? { m7Panel: panel } : {}),
    ...(typeof envelope.trace_id === 'string' ? { trackingTaskId: envelope.trace_id } : {}),
  };
};

const formatToolResult = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
const gateTypeLabels: Record<string, string> = {
  authorization: '执行授权', candidate: '订单候选审核', review: '订单解析复核', engineering: 'BOM/SOP 工程确认',
  data: '业务数据补充', procurement: '采购建议确认', apply: '排程发布确认',
};

function LocalGateInlineCard({ messageId, runId, gate, status }: { messageId: string; runId: string; gate: Record<string, unknown>; status?: 'pending' | 'approved' | 'retrying' | 'rejected' | 'error' }) {
  const recommendation = gate.recommendation ?? gate.suggestion ?? gate.advice;
  const risk = gate.risk ?? gate.impact;
  const evidence = Array.isArray(gate.evidence) ? gate.evidence : [];
  const pending = !status || status === 'pending' || status === 'error';
  const statusLabel = status === 'approved' ? '已批准，Agent 已继续' : status === 'retrying' ? '已补充，Agent 正在重新评估' : status === 'rejected' ? '已终止' : status === 'error' ? '提交失败，可重新处理' : '等待你的判断';

  return <section className={`chat-gate-inline ${pending ? 'chat-gate-inline-pending' : 'chat-gate-inline-resolved'}`} role="group" aria-labelledby={`chat-gate-title-${messageId}`} data-testid="chat-gate-record" tabIndex={-1}>
    <div className="chat-gate-inline-header"><Tag color={pending ? 'error' : 'default'}>{pending ? '需要人工处理' : '人工处理记录'}</Tag><span className="chat-gate-inline-status">{statusLabel}</span></div>
    <h3 id={`chat-gate-title-${messageId}`}>{String(gate.title || gateTypeLabels[String(gate.type)] || '需要人工判断')}</h3>
    <p className="chat-gate-inline-reason">{String(gate.reason || gate.message || 'Agent 发现一个需要人工判断的事项。')}</p>
    <div className="chat-gate-inline-meta"><span>运行 {runId.slice(0, 18)}</span><span>步骤 {String(gate.step_index ?? '-')}</span>{gate.module ? <span>模块 {String(gate.module).toUpperCase()}</span> : null}{gate.tool ? <span>工具 {String(gate.tool)}</span> : null}</div>
    <details className="chat-gate-inline-details" open={pending}><summary>查看 AI 分析与依据</summary>
      <div className="local-gate-insight"><div className="local-gate-insight-title">AI 分析</div><p>{String(gate.analysis || gate.finding || gate.reason || gate.message || 'Agent 已暂停执行，等待你的业务判断。')}</p></div>
      {recommendation ? <div className="local-gate-insight local-gate-recommendation"><div className="local-gate-insight-title">AI 建议</div><p>{String(recommendation)}</p></div> : <div className="local-gate-insight local-gate-recommendation"><div className="local-gate-insight-title">AI 建议</div><p>当前后端未提供建议，Agent 不会替你做决定，请从下方动作中选择。</p></div>}
      {risk ? <div className="local-gate-risk"><b>潜在影响</b><span>{String(risk)}</span></div> : null}
      {evidence.length ? <ul className="local-gate-evidence"><li>依据（{evidence.length}）</li>{evidence.slice(0, 6).map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul> : null}
    </details>
  </section>;
}

export function ChatPanel({
  streamFactory,
  compact = false,
  onToolAction,
  m7DeliveryDraft,
  onM7DraftSupplement,
}: {
  streamFactory?: ChatStreamFactory;
  compact?: boolean;
  onToolAction?: (action: ChatToolAction, options?: ChatToolActionOptions) => void;
  m7DeliveryDraft?: M7DeliveryDraft | null;
  onM7DraftSupplement?: (result: unknown) => void;
}) {
  const draft = useChatStore((state) => state.draft);
  const sending = useChatStore((state) => state.sending);
  const messages = useChatStore((state) => state.messages);
  const selectedConversationId = useChatStore((state) => state.selectedConversationId);
  const nextCursor = useChatStore((state) => selectedConversationId ? state.messageNextCursors[selectedConversationId] : undefined);
  const loadingMore = useChatStore((state) => state.historyLoadingMore);
  const loadMoreMessages = useChatStore((state) => state.loadMoreMessages);
  const setDraft = useChatStore((state) => state.setDraft);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const stopStreaming = useChatStore((state) => state.stopStreaming);
  const listRef = useRef<HTMLDivElement>(null);
  const observedM7WorkflowSteps = useRef(new Set<string>());
  const openedM7WorkflowSteps = useRef(new Set<string>());
  const appliedM7SupplementSteps = useRef(new Set<string>());
  // followUps: null=加载中；[]=无可用追问（失败/空结果，不显示失败态）；非空=候选 chips
  const [followUps, setFollowUps] = useState<string[] | null>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const localLangGraph = import.meta.env.VITE_LOCAL_LANGGRAPH === 'true';

  useEffect(() => {
    const focusGate = () => {
      const record = document.querySelector<HTMLElement>('[data-testid="chat-gate-record"]');
      record?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      record?.querySelector<HTMLElement>('textarea, button')?.focus();
    };
    window.addEventListener('yunpai:focus-chat-gate', focusGate);
    return () => window.removeEventListener('yunpai:focus-chat-gate', focusGate);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    let actionToOpen: ChatToolActionOptions | undefined;
    for (const message of messages) {
      for (const step of message.tools ?? []) {
        const workflowOptions = m7WorkflowOptions(step.tool, step.result);
        const isSupplement = step.tool === 'parse_m7_delivery_note_supplement';
        if (!workflowOptions && !isSupplement) continue;
        if (step.status === 'running') {
          observedM7WorkflowSteps.current.add(step.id);
          continue;
        }
        const liveCompletion = step.status === 'ok' && (
          observedM7WorkflowSteps.current.has(step.id) || message.status === 'streaming'
        );
        if (isSupplement && liveCompletion && !appliedM7SupplementSteps.current.has(step.id)) {
          appliedM7SupplementSteps.current.add(step.id);
          observedM7WorkflowSteps.current.delete(step.id);
          onM7DraftSupplement?.(step.result);
        } else if (workflowOptions && liveCompletion && !openedM7WorkflowSteps.current.has(step.id)) {
          openedM7WorkflowSteps.current.add(step.id);
          observedM7WorkflowSteps.current.delete(step.id);
          actionToOpen = workflowOptions;
        }
      }
    }
    if (actionToOpen) onToolAction?.('m7-warehouse', actionToOpen);
  }, [messages, onM7DraftSupplement, onToolAction]);

  useEffect(() => {
    setFollowUps(null);
    const lastAssistant = [...messages].reverse().find(
      (message) => message.role === 'assistant' && message.status === 'completed' && message.content.trim().length > 0,
    );
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastAssistant || !lastUser) return;
    let cancelled = false;
    // 过滤空 content 轮次（工具型回复/流式中断可能留下空文本），避免后端 422 校验失败
    const conversation = messages
      .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim().length > 0)
      .slice(-8)
      .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));
    requestFollowUps({ message: lastUser.content, conversation })
      .then((result) => {
        if (cancelled) return;
        setFollowUps(result.questions);
      })
      .catch(() => {
        if (!cancelled) setFollowUps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [messages]);

  const toolMenu = {
    items: localLangGraph
      ? [
          { key: 'order-upload', label: '上传订单文件并运行 Agent' },
          { key: 'master-data-upload', label: '基础资料识别落库（agent 理解）' },
          { key: 'pmc-progress', label: '查看本地 M5 排程输出' },
        ]
      : [
          { key: 'order-upload', label: '上传订单文件（订单到排程）' },
          { key: 'master-data-upload', label: '基础资料识别落库（agent 理解）' },
          { key: 'm0-import', label: 'M0 数据导入（基础数据库建设）' },
          { key: 'm7-warehouse', label: 'M7 仓库（送货、抽检、领料）' },
          { key: 'pmc-progress', label: '查看 PMC 实际进度' },
          { key: 'evidence-adjudication', label: 'M3/M4/M5 证据与裁决' },
          { key: 'piece-wage', label: '计件工资报表' },
        ],
  };

  const hasCompletedReply = messages.some(
    (message) => message.role === 'assistant' && message.status === 'completed' && message.content.trim().length > 0,
  );

  const resend = (messageId: string) => {
    const index = messages.findIndex((item) => item.id === messageId);
    const previousUserMessage = messages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === 'user');
    if (previousUserMessage?.content) {
      void sendMessage(previousUserMessage.content, streamFactory, m7DeliveryDraft ? m7DeliveryDraftContext(m7DeliveryDraft) : undefined);
    }
  };

  const sendPrompt = (prompt: string) => {
    void sendMessage(prompt, streamFactory, m7DeliveryDraft ? m7DeliveryDraftContext(m7DeliveryDraft) : undefined);
  };

  return (
    <section className={compact ? 'chat-panel chat-panel-compact' : 'chat-panel'}>
      <div className="chat-list" data-testid="chat-message-list" ref={listRef}>
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今天要处理什么？" />
            <div className="chat-suggestion-chips" aria-label="建议提问">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <Button key={prompt} size="small" className="chat-suggestion-chip" onClick={() => sendPrompt(prompt)}>
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <Bubble.List
            items={messages.map((message) => {
              const emptyReply = message.role === 'assistant' && message.status === 'completed' && message.content.trim().length === 0;
              return {
                key: message.id,
                placement: message.role === 'user' ? 'end' : 'start',
                avatar: { icon: message.role === 'user' ? <UserOutlined /> : <RobotOutlined /> },
                loading: message.status === 'streaming' && message.content.length === 0 && !(message.tools?.length),
                content: (
                  <Space
                    direction="vertical"
                    size={8}
                    className="chat-bubble-content"
                    data-testid="chat-message"
                    data-message-status={message.status}
                  >
                    {emptyReply ? (
                      <Alert
                        type="warning"
                        showIcon
                        className="chat-empty-reply"
                        message={EMPTY_REPLY_FALLBACK}
                        action={
                          <Button type="link" size="small" onClick={() => resend(message.id)}>
                            重新发送
                          </Button>
                        }
                      />
                    ) : (
                      <span>{message.content || (message.status === 'streaming' ? '生成中...' : '')}</span>
                    )}
                    {message.attachments?.length ? (
                      <div className="chat-attachments" aria-label={`附件 ${message.attachments.map((item) => item.name).join('、')}`}>
                        {message.attachments.map((attachment) => (
                          <Tag key={attachment.id} color="blue" className="chat-attachment-tag">
                            {attachment.name}
                            {attachment.kind ? ` · ${attachment.kind.toUpperCase()}` : ''}
                            {attachment.taskId ? ` · ${attachment.taskId.slice(0, 16)}` : ''}
                          </Tag>
                        ))}
                      </div>
                    ) : null}
                    {message.gate ? <LocalGateInlineCard messageId={message.id} runId={message.gate.runId} gate={message.gate.gate} status={message.gate.status} /> : null}
                    {message.error ? <Tag color="error">{message.error}</Tag> : null}
                    {message.status === 'cancelled' ? <Tag>已停止</Tag> : null}
                    {message.tools?.length ? (
                      <div className="chat-tools" data-testid="chat-tool-steps">
                        {message.tools.map((step) => {
                          const running = step.status === 'running';
                          const waitingHuman = step.status === 'waiting_human';
                          const hasResult = step.result !== undefined && step.result !== null;
                          const showLabel = Boolean(step.label) && step.label !== step.tool;
                          const workflowOptions = m7WorkflowOptions(step.tool, step.result);
                          const workflowTab = workflowOptions?.m7Tab;
                          return (
                            <div
                              className={running ? 'chat-tool-step chat-tool-step-running' : waitingHuman ? 'chat-tool-step chat-tool-step-waiting' : 'chat-tool-step'}
                              key={step.id}
                              data-tool-status={step.status}
                            >
                              <div className="chat-tool-step-header">
                                {running ? <LoadingOutlined spin /> : <ToolOutlined />}
                                <code className="chat-tool-step-tool">{step.tool}</code>
                                <Tag color={step.status === 'failed' ? 'error' : step.status === 'ok' ? 'success' : waitingHuman ? 'warning' : 'processing'}>
                                  {running ? '运行中' : waitingHuman ? '等待人工' : step.status === 'ok' ? '完成' : '失败'}
                                </Tag>
                                {step.durationMs !== undefined ? <span className="chat-tool-step-meta">{step.durationMs} ms</span> : null}
                              </div>
                              {showLabel ? <span className="chat-tool-step-label">{step.label}</span> : null}
                              {step.error ? <span className="chat-tool-step-error">{step.error}</span> : null}
                              {workflowTab && step.status === 'ok' ? (
                                <Button
                                  size="small"
                                  icon={workflowOptions?.m7Panel === 'file-recognition'
                                    ? <UploadOutlined aria-hidden />
                                    : <FolderOpenOutlined aria-hidden />}
                                  onClick={() => onToolAction?.('m7-warehouse', workflowOptions)}
                                >
                                  {workflowOptions?.m7Panel === 'file-recognition'
                                    ? '上传送货单文件'
                                    : `打开 ${M7_WORKFLOW_LABELS[workflowTab]}`}
                                </Button>
                              ) : null}
                              {step.dataRef ? <ToolDataRefPreview dataRef={step.dataRef} /> : null}
                              {!step.error && hasResult ? <M2RunArtifacts result={step.result} /> : null}
                              {!step.error && hasResult ? <M0DocArtifacts result={step.result} /> : null}
                              {!step.error && hasResult ? (
                                <details className="chat-tool-step-result">
                                  <summary className="chat-tool-step-result-summary">
                                    查看返回结果{step.resultTruncated ? '（已截断）' : ''}
                                  </summary>
                                  <pre className="chat-tool-step-result-pre">{formatToolResult(step.result)}</pre>
                                </details>
                              ) : null}
                              {!step.error && !hasResult && step.summary ? (
                                <span className="chat-tool-step-summary">{step.summary}</span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </Space>
                ),
                variant: message.role === 'user' ? 'filled' : 'outlined',
              };
            })}
          />
        )}
        {hasCompletedReply ? (
          <div className="chat-followups" data-testid="chat-followups">
            <span className="chat-followups-label">你可能还想问：</span>
            {followUps === null ? (
              <span className="chat-followups-loading">正在生成追问…</span>
            ) : followUps.length ? (
              <div className="chat-followups-chips">
                {followUps.map((prompt) => (
                  <Button key={prompt} size="small" className="chat-followup-chip" onClick={() => sendPrompt(prompt)}>
                    {prompt}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {nextCursor ? <Button className="chat-load-more" type="text" block loading={loadingMore}
          onClick={() => void loadMoreMessages(selectedConversationId)}>加载更多消息</Button> : null}
      </div>
      {m7DeliveryDraft ? (
        <div className="chat-m7-draft-bar" data-testid="chat-m7-draft-bar">
          <span>
            {m7DeliveryDraft.missing_fields.length > 0
              ? `送货单草稿还缺 ${m7DeliveryDraft.missing_fields.length} 项，可直接在下方补充`
              : '送货单草稿必填信息已齐，请核对后提交'}
          </span>
          <Button
            size="small"
            icon={<EditOutlined aria-hidden />}
            onClick={() => onToolAction?.('m7-warehouse', { m7Tab: 'delivery' })}
          >
            手动补录
          </Button>
        </div>
      ) : null}
      <div className="chat-composer" data-testid="chat-composer">
        <Sender
          className="chat-sender-opaque"
          value={draft}
          loading={sending}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder="询问订单、风险或排程状态"
          onChange={setDraft}
          onSubmit={(value) => void sendMessage(
            value,
            streamFactory,
            m7DeliveryDraft ? m7DeliveryDraftContext(m7DeliveryDraft) : undefined,
          )}
          prefix={
            <Dropdown
              open={toolMenuOpen}
              onOpenChange={setToolMenuOpen}
              menu={{
                ...toolMenu,
                onClick: ({ key }) => {
                  setToolMenuOpen(false);
                  if (key === 'order-upload' || key === 'm0-import' || key === 'master-data-upload' || key === 'm7-warehouse' || key === 'pmc-progress' || key === 'piece-wage' || key === 'evidence-adjudication') {
                    onToolAction?.(key);
                  }
                },
              }}
              trigger={['click']}
            >
              <Button
                className="chat-tool-menu-button"
                type="text"
                aria-label="上传或导入"
                aria-expanded={toolMenuOpen}
                icon={<PlusOutlined />}
              />
            </Dropdown>
          }
        />
        {sending ? (
          <Button icon={<StopOutlined />} onClick={stopStreaming}>
            停止生成
          </Button>
        ) : null}
      </div>
    </section>
  );
}
