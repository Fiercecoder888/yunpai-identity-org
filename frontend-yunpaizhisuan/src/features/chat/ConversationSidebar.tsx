import {
  AlertOutlined,
  ContainerOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  FileTextOutlined,
  FileSearchOutlined,
  FundOutlined,
  MoreOutlined,
  PlusOutlined,
  RightOutlined,
  ScheduleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Alert, Button, Dropdown, Empty, Input, Modal, Spin, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ChatConversation } from '../../services/chatApi';
import {
  getCatalogRunConfigs,
  runCatalogBusinessFlow,
  runCatalogBusinessFlowForce,
  type BusinessCatalogRunConfig,
  type BusinessFlowRunProgress,
} from '../../services/businessFlowRunApi';
import { HttpClientError } from '../../services/httpClient';
import { useChatStore } from '../../store/useChatStore';
import { useBusinessRunStore } from '../business-flow/useBusinessRunStore';
import { readLocalOrders, type LocalOrderRecord } from '../business-flow/localOrderRegistry';
import { InventoryDrawer } from './InventoryDrawer';

const SELECTED_ORDER_KEY = 'yunpai-business-flow-selected-order';
const NO_CONVERSATION = '__no-conversation__';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const EXAMPLE_TASKS = [
  {
    key: 'order-trace',
    icon: <FileSearchOutlined />,
    title: '订单全链路',
    prompt: '请查询订单 SO-HIST-CAND-20260724-088 的全链路追溯：订单到排程 流程状态、物料、库存与采购排程情况。',
  },
  {
    key: 'material-trace',
    icon: <DatabaseOutlined />,
    title: '物料库存追踪',
    prompt: '请追踪物料 MAT-BROWSER-001 的库存：余额、收发流水、批次、领料消费与生产产出。',
  },
  {
    key: 'finished-goods',
    icon: <ContainerOutlined />,
    title: '成品库汇总',
    prompt: '请查看当前成品库汇总：现存、可用、待检、累计产出、报废与良率。',
  },
  {
    key: 'cost-variance',
    icon: <FundOutlined />,
    title: '成本差异',
    prompt: '请查询 2026-08 的订单成本差异：实际成本与标准成本对比。',
  },
  {
    key: 'purchase-alerts',
    icon: <AlertOutlined />,
    title: '采购预警',
    prompt: '请查看当前采购预警与采购追踪情况。',
  },
  {
    key: 'schedule-summary',
    icon: <ScheduleOutlined />,
    title: '排程与齐套',
    prompt: '请查看当前生产排程执行摘要与物料齐套情况。',
  },
  {
    key: 'bom-sop-artifacts',
    icon: <FileTextOutlined />,
    title: 'BOM/SOP 制品',
    prompt: '列出 M2 已生成的 BOM/SOP run，并用 get_m2_run 查看各 run 的制品清单（artifact_paths），回答中给出可下载/预览的制品链接。',
  },
  {
    key: 'm0-drawings',
    icon: <PictureOutlined />,
    title: '工程图纸',
    prompt: '列出 M0 已入库的工程文档（工程图/工艺方法/测试方法），用 list_m0_documents 查询，回答中给出可预览/下载的链接。',
  },
];

export function ConversationSidebar({ onSelected }: { onSelected?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const conversations = useChatStore((state) => state.conversations);
  const selected = useChatStore((state) => state.selectedConversationId);
  const selectedCatalogId = useBusinessRunStore((state) => state.selectedCatalogId);
  const loading = useChatStore((state) => state.historyLoading);
  const loadingMore = useChatStore((state) => state.historyLoadingMore);
  const nextCursor = useChatStore((state) => state.conversationNextCursor);
  const error = useChatStore((state) => state.historyError);
  const mutationPending = useChatStore((state) => state.historyMutationPending);
  const mutationError = useChatStore((state) => state.historyMutationError);
  const load = useChatStore((state) => state.loadConversations);
  const loadMore = useChatStore((state) => state.loadMoreConversations);
  const create = useChatStore((state) => state.newConversation);
  const send = useChatStore((state) => state.sendMessage);
  const sending = useChatStore((state) => state.sending);
  const rename = useChatStore((state) => state.renameConversation);
  const remove = useChatStore((state) => state.deleteConversation);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<ChatConversation>();
  const [deleting, setDeleting] = useState<ChatConversation>();
  const [title, setTitle] = useState('');
  const [renameError, setRenameError] = useState<string>();
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [localOrderRecords, setLocalOrderRecords] = useState<LocalOrderRecord[]>(() => readLocalOrders());
  const [collapsedOrderGroups, setCollapsedOrderGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query.trim() || undefined), query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    setLocalOrderRecords(readLocalOrders());
  }, [conversations]);

  const createConversation = async () => {
    setQuery('');
    try {
      const conversationId = await create();
      navigate(`/c/${conversationId}`, { flushSync: true });
      onSelected?.();
    } catch {
      // The store exposes the actionable error in the sidebar.
    }
  };

  // 方案2：点击「订单全链路」直接触发订单业务面板运行当前选中订单（M1→M5）
  const runSelectedOrderFlow = async () => {
    const catalogId =
      useBusinessRunStore.getState().selectedCatalogId ??
      globalThis.localStorage?.getItem(SELECTED_ORDER_KEY) ??
      undefined;
    if (!catalogId) {
      void message.info('请先在「订单业务流程」面板选择要运行的订单');
      return;
    }
    let config: BusinessCatalogRunConfig | undefined;
    try {
      config = (await getCatalogRunConfigs()).find((item) => item.catalog_id === catalogId);
    } catch {
      config = undefined;
    }
    if (!config) {
      void message.warning('当前订单缺少完整运行输入，只能查看');
      return;
    }
    const orderId = config.order?.order_id ?? '';
    const conversationId = useChatStore.getState().selectedConversationId ?? NO_CONVERSATION;
    const store = useBusinessRunStore.getState();
    store.begin({ orderId, productName: config.order?.product_name ?? orderId }, conversationId);
    const applyProgress = (next: BusinessFlowRunProgress) => {
      if ((useChatStore.getState().selectedConversationId ?? NO_CONVERSATION) === conversationId) {
        store.update(next);
      }
    };
    try {
      await runCatalogBusinessFlow(config, { onProgress: applyProgress });
    } catch (cause) {
      const isConflict = cause instanceof HttpClientError && cause.error?.status === 409;
      if (isConflict) {
        void message.info('检测到历史运行记录，已自动以新运行执行当前订单');
        try {
          await runCatalogBusinessFlowForce(config, { onProgress: applyProgress });
        } catch (forceCause) {
          applyProgress({ phase: 'failed', title: '业务流程运行失败', detail: errorText(forceCause), failed: true, error: errorText(forceCause) });
        }
      } else {
        applyProgress({ phase: 'failed', title: '业务流程运行失败', detail: errorText(cause), failed: true, error: errorText(cause) });
      }
    }
  };

  // BOM/SOP 制品：按当前选中订单（如有）动态构造查询，否则列出全部 M2 run
  const runBomSopArtifacts = async () => {
    if (mutationPending || sending) return;
    const catalogId =
      useBusinessRunStore.getState().selectedCatalogId ??
      globalThis.localStorage?.getItem(SELECTED_ORDER_KEY) ??
      undefined;
    let orderId = '';
    if (catalogId) {
      try {
        const config = (await getCatalogRunConfigs()).find((item) => item.catalog_id === catalogId);
        orderId = config?.order?.order_id ?? '';
      } catch {
        orderId = '';
      }
    }
    try {
      const conversationId = await create();
      navigate(`/c/${conversationId}`, { flushSync: true });
      onSelected?.();
      await send(
        orderId
          ? `查看订单 ${orderId} 的 BOM/SOP 制品：先用 list_m2_runs 按 order_id=${orderId} 查询已生成的 run；如果过滤结果为空，必须再次调用 list_m2_runs（不带 order_id）列出全部 run，不得直接回答无结果。然后用 get_m2_run 查看每个 run 的制品清单（artifact_paths），回答中给出可下载/预览的制品链接。`
          : '列出 M2 已生成的 BOM/SOP run（list_m2_runs 不带过滤），并用 get_m2_run 查看各 run 的制品清单（artifact_paths），回答中给出可下载/预览的制品链接。',
      );
    } catch {
      // The store exposes the actionable error in the sidebar.
    }
  };

  // 工程图纸：按当前选中订单（如有）动态构造查询，否则列出全部 M0 工程文档
  const runM0Drawings = async () => {
    if (mutationPending || sending) return;
    const catalogId =
      useBusinessRunStore.getState().selectedCatalogId ??
      globalThis.localStorage?.getItem(SELECTED_ORDER_KEY) ??
      undefined;
    let orderId = '';
    if (catalogId) {
      try {
        const config = (await getCatalogRunConfigs()).find((item) => item.catalog_id === catalogId);
        orderId = config?.order?.order_id ?? '';
      } catch {
        orderId = '';
      }
    }
    try {
      const conversationId = await create();
      navigate(`/c/${conversationId}`, { flushSync: true });
      onSelected?.();
      await send(
        orderId
          ? `查看订单 ${orderId} 的工程图纸：用 list_m0_documents 按 order=${orderId} 查询已入库的工程文档（工程图/工艺方法/测试方法等），列出 doc_id、标题、文档类型；如果为空，必须再调用一次不带 order 的 list_m0_documents 列出全部工程文档，不得直接回答无结果。回答中给出可预览/下载的链接。`
          : '列出 M0 已入库的工程文档（工程图/工艺方法/测试方法等），用 list_m0_documents 查询，回答中给出可预览/下载的链接。',
      );
    } catch {
      // The store exposes the actionable error in the sidebar.
    }
  };

  const runExample = async (task: (typeof EXAMPLE_TASKS)[number]) => {
    if (task.key === 'order-trace') {
      await runSelectedOrderFlow();
      return;
    }
    if (task.key === 'material-trace') {
      // 直接打开物料库存总览面板（读取 m0 已入库库存），不再发聊天查询订单全链路
      setInventoryOpen(true);
      return;
    }
    if (task.key === 'bom-sop-artifacts') {
      await runBomSopArtifacts();
      return;
    }
    if (task.key === 'm0-drawings') {
      await runM0Drawings();
      return;
    }
    if (mutationPending || sending) return;
    try {
      const conversationId = await create();
      navigate(`/c/${conversationId}`, { flushSync: true });
      onSelected?.();
      await send(task.prompt);
    } catch {
      // The store exposes the actionable error in the sidebar.
    }
  };

  const submitRename = async () => {
    if (!renaming || !title.trim()) return;
    setRenameError(undefined);
    try {
      await rename(renaming, title.trim());
      setRenaming(undefined);
    } catch (renameFailure) {
      setRenameError(renameFailure instanceof Error ? renameFailure.message : '重命名失败');
    }
  };

  const orderGroups = useMemo(() => {
    const conversationOrders = new Map<string, Set<string>>();
    const orderLabels = new Map<string, string>();
    localOrderRecords.forEach((record) => {
      orderLabels.set(record.orderId, record.orderId);
      if (record.conversationId) {
        const ids = conversationOrders.get(record.conversationId) ?? new Set<string>();
        ids.add(record.orderId);
        conversationOrders.set(record.conversationId, ids);
      }
      if (record.filename) orderLabels.set(record.filename, record.orderId);
    });
    const groups = new Map<string, { label: string; items: ChatConversation[]; latest: number }>();
    conversations.forEach((conversation) => {
      const linked = [...(conversationOrders.get(conversation.id) ?? [])];
      const titleHint = conversation.title.split('·').slice(1).join('·').trim();
      const inferred = localOrderRecords.find((record) => titleHint && (titleHint.includes(record.orderId) || titleHint.includes(record.filename ?? '')))?.orderId;
      // 只从明确的订单标识推断归属，避免“检查订单A”这类普通会话被误当成订单组。
      const explicitOrderId = titleHint?.match(/\b(?:SO|PO)[-_][A-Z0-9][A-Z0-9_-]*\b/i)?.[0];
      const inferredTitle = !inferred && explicitOrderId ? explicitOrderId : undefined;
      // 一个会话可能同时参与多个订单流程，但订单仍需各自拥有独立文件夹。
      // 之前把多订单会话折叠到 __multiple__，会导致不同订单混在同一个分组里。
      const keys = linked.length ? linked : inferred ? [inferred] : inferredTitle ? [`title:${inferredTitle}`] : ['__unlinked__'];
      keys.forEach((key) => {
        const label = key === '__multiple__' ? '多个订单' : key === '__unlinked__' ? '未关联订单' : key.startsWith('title:') ? key.slice(6) : orderLabels.get(key) ?? key;
        const group = groups.get(key) ?? { label, items: [], latest: 0 };
        if (!group.items.some((item) => item.id === conversation.id)) group.items.push(conversation);
        group.latest = Math.max(group.latest, Date.parse(conversation.last_message_at ?? conversation.updated_at ?? conversation.created_at) || 0);
        groups.set(key, group);
      });
    });
    return [...groups.entries()].sort(([, left], [, right]) => {
      if (left.label === '未关联订单') return 1;
      if (right.label === '未关联订单') return -1;
      return right.latest - left.latest;
    });
  }, [conversations, localOrderRecords]);

  const submitDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting);
      if (location.pathname === `/c/${deleting.id}`) navigate('/', { replace: true, flushSync: true });
      setDeleting(undefined);
    } catch {
      // The store keeps the actionable error visible while the confirmation stays open.
    }
  };

  return <div className="conversation-sidebar-content">
    <Button className="conversation-new" icon={<PlusOutlined />} loading={mutationPending} onClick={() => void createConversation()}>新建会话</Button>
    <section className="example-tasks" aria-label="示例任务">
      <div className="example-tasks-label">示例任务</div>
      {EXAMPLE_TASKS.map((task) => (
        <button className="example-task-item" key={task.key} disabled={mutationPending || sending}
          title={
            task.key === 'order-trace'
              ? `直接运行当前选中订单的 M1→M5 流程：${selectedCatalogId ?? '未选择'}`
              : task.key === 'material-trace'
                ? `追踪当前选中订单的物料库存：${selectedCatalogId ?? '未选择'}`
                : task.key === 'bom-sop-artifacts'
                  ? '查看 M2 已生成的 BOM/SOP 制品（可下载/预览）'
                  : task.key === 'm0-drawings'
                    ? '查看 M0 已入库工程图纸（可下载/预览）'
                : task.prompt
          }
          onClick={() => void runExample(task)}>
          <span className="example-task-icon" aria-hidden="true">{task.icon}</span>
          <span>{task.title}</span>
        </button>
      ))}
    </section>
    <Input allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" />
    <div className="conversation-list" aria-label="会话历史">
      {loading ? <Spin size="small" /> : null}
      {error ? <div className="conversation-error">{error}</div> : null}
      {mutationError ? <div className="conversation-error">{mutationError}</div> : null}
      {!loading && conversations.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query.trim() ? '未找到匹配会话' : '暂无会话'} />
        : null}
      {orderGroups.map(([groupKey, group]) => {
        const collapsed = collapsedOrderGroups.has(groupKey);
        return <section className="conversation-order-group" key={groupKey}>
          <button type="button" className="conversation-order-header" aria-expanded={!collapsed} onClick={() => setCollapsedOrderGroups((current) => {
            const next = new Set(current);
            if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
            return next;
          })}>
            {collapsed ? <RightOutlined aria-hidden /> : <DownOutlined aria-hidden />}
            <FolderOpenOutlined aria-hidden />
            <span className="conversation-order-name" title={group.label}>{group.label}</span>
            <span className="conversation-order-count">{group.items.length}</span>
          </button>
          {!collapsed ? group.items.map((conversation) => <div className={conversation.id === selected ? 'conversation-item is-active' : 'conversation-item'} data-conversation-id={conversation.id} key={conversation.id}>
          <button className="conversation-select" aria-current={conversation.id === selected ? 'page' : undefined} title={conversation.title} onClick={() => { navigate(`/c/${conversation.id}`, { flushSync: true }); onSelected?.(); }}>{conversation.title}</button>
          <Dropdown trigger={['click']} menu={{ items: [
            { key: 'rename', icon: <EditOutlined />, label: '重命名', onClick: () => { setRenameError(undefined); setRenaming(conversation); setTitle(conversation.title); } },
            { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true, onClick: () => setDeleting(conversation) },
          ] }}>
            <Button type="text" size="small" disabled={mutationPending} icon={<MoreOutlined />} aria-label={`${conversation.title} 操作`} />
          </Dropdown>
          </div>) : null}
        </section>;
      })}
      {nextCursor ? <Button className="conversation-load-more" type="text" block loading={loadingMore}
        onClick={() => void loadMore()}>加载更多会话</Button> : null}
    </div>
    <Modal title="重命名会话" open={Boolean(renaming)} okText="保存" cancelText="取消" confirmLoading={mutationPending}
      okButtonProps={{ disabled: !title.trim() }} onCancel={() => { setRenameError(undefined); setRenaming(undefined); }}
      onOk={() => void submitRename()}>
      <Input autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} onPressEnter={() => void submitRename()} />
      {renameError ? <Alert className="conversation-rename-error" type="error" showIcon message={renameError} /> : null}
    </Modal>
    <Modal title="删除此会话？" open={Boolean(deleting)} okText="删除" cancelText="取消" confirmLoading={mutationPending}
      okButtonProps={{ danger: true }} onCancel={() => setDeleting(undefined)} onOk={() => void submitDelete()}>
      共享模式下，删除会影响其他调试使用者。会话将被软删除且当前界面无法恢复。
    </Modal>
    <InventoryDrawer open={inventoryOpen} onClose={() => setInventoryOpen(false)} />
  </div>;
}
