import { FolderOpenOutlined, LoginOutlined, MenuOutlined } from '@ant-design/icons';
import { App as AntdApp, Badge, Button, Drawer, Modal, Tag, Tooltip, message } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChatPanel, type ChatToolAction, type ChatToolActionOptions } from '../features/chat/ChatPanel';
import { ConversationSidebar } from '../features/chat/ConversationSidebar';
import { DataFlowPanel } from '../features/business-flow/DataFlowPanel';
import { LocalAgentRunPanel } from '../features/business-flow/LocalAgentRunPanel';
import { OrderFileUploadPanel } from '../features/business-flow/OrderFileUploadPanel';
import { useBusinessRunStore } from '../features/business-flow/useBusinessRunStore';
import { AgentTaskCenter } from '../features/agent-tasks/AgentTaskCenter';
import { M0ChatPanel } from '../features/m0/M0ChatPanel';
import { M0BurstCaptureModal } from '../features/m0/M0BurstCaptureModal';
import { M7WarehousePanel, type M7WarehouseTab } from '../features/M7WarehousePanel';
import {
  applyM7DeliverySupplement,
  latestM7DeliveryDraft,
  m7DeliveryDraftChatMessage,
  m7DeliveryDraftStructuredData,
  type M7DeliveryDraft,
} from '../features/m7/m7RecognitionMessages';
import { lastSelectedConversationId, useChatStore } from '../store/useChatStore';
import { useAuthStore } from '../auth/useAuthStore';
import { oidcLoginUrl } from '../auth/authApi';
import { isDemoRoleEnabled } from '../app/runtimeMode';
import { CommandPalette } from '../components/CommandPalette';
import { DatabaseTenantSwitcher } from '../components/DatabaseTenantSwitcher';
import { VersionBadge } from '../components/VersionBadge';
import { RoleSwitcher } from '../features/roles/RoleSwitcher';
import { AdminNavMenu } from '../features/roles/AdminNavMenu';
import { UserMenu } from '../features/roles/UserMenu';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { PieceWageReportCard } from '../features/wage/PieceWageReportCard';
import { createM7TrackingTaskId, listM7PendingInspections, scanM7DeliveryNote } from '../services/m7Api';
import { EvidenceAdjudicationPanel } from '../features/chat/EvidenceAdjudicationPanel';
import { DropOverlay } from '../features/upload/DropOverlay';
import { extractFilesFromClipboard } from '../features/upload/pasteFiles';
import { handleDropFiles, useGlobalFileDrop } from '../features/upload/useGlobalFileDrop';
import { describeM0UploadError, uploadM0FilesWithProgress } from '../services/uploadWithProgress';

export function EnterpriseAssistantPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useChatStore((state) => state.sidebarCollapsed);
  const setCollapsed = useChatStore((state) => state.setSidebarCollapsed);
  const selectedConversationId = useChatStore((state) => state.selectedConversationId);
  const chatMessages = useChatStore((state) => state.messages);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const persistAssistantMessage = useChatStore((state) => state.persistAssistantMessage);
  const me = useAuthStore((state) => state.me);
  const authConfig = useAuthStore((state) => state.config);
  // 演示角色模式保留旧共享标记；真实鉴权下顶部显示账号/角色/退出。
  const demoRoles = isDemoRoleEnabled();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const roleQuery = useCurrentRole();
  const [toolModal, setToolModal] = useState<Exclude<ChatToolAction, 'pmc-progress'> | null>(null);
  const [pmcProgressRequest, setPmcProgressRequest] = useState(0);
  const [m7Tab, setM7Tab] = useState<M7WarehouseTab>('delivery');
  const [m7DeliveryUploadOpen, setM7DeliveryUploadOpen] = useState(false);
  const [m7WorkflowTaskId, setM7WorkflowTaskId] = useState<string>();
  const [m7DeliveryDraft, setM7DeliveryDraft] = useState<M7DeliveryDraft | null>(null);
  const [m7DraftConversationId, setM7DraftConversationId] = useState<string>();
  const [dropFiles, setDropFiles] = useState<{ order?: File[]; m0?: File[] }>({});
  const m0FolderInputRef = useRef<HTMLInputElement>(null);
  const [m0FolderUploading, setM0FolderUploading] = useState(false);
  const { notification: appNotification } = AntdApp.useApp();
  const recognizedM7Batches = useRef(new Set<string>());
  const menuButton = useRef<HTMLButtonElement>(null);
  const localLangGraph = import.meta.env.VITE_LOCAL_LANGGRAPH === 'true';
  // M1–M5 订单全链路面板（「订单管理 / 选择订单查看 M1-M5 / 重新运行」）需要 order.ingest
  // （上传/导入订单）才渲染：种子角色里只有 厂长 与 主数据管理员 拥有该权限；
  // 品保（order.view/order.review/report.view）、组长、工人看不到这个框。
  // 品保的对话功能与厂长完全一致——这里只摘掉面板本身，ChatPanel 照常渲染并独占宽度。
  // 用权限码判断而不是写死角色 id，后续调整角色授权时无需改前端。
  const canRunOrderFlow = me?.permissions?.includes('order.ingest') ?? false;
  const shellClassName = [
    'assistant-shell',
    collapsed ? 'sidebar-collapsed' : '',
    canRunOrderFlow ? '' : 'assistant-shell-no-flow',
  ].filter(Boolean).join(' ');
  const orderFlowPanel = localLangGraph
    ? <LocalAgentRunPanel pmcProgressRequest={pmcProgressRequest} />
    : <DataFlowPanel pmcProgressRequest={pmcProgressRequest} />;
  const toolModalRef = useRef(toolModal);
  useEffect(() => {
    toolModalRef.current = toolModal;
  }, [toolModal]);
  const closeDrawer = () => { setDrawerOpen(false); window.setTimeout(() => menuButton.current?.focus(), 0); };

  const closeToolModal = useCallback(() => {
    setDropFiles({});
    setToolModal(null);
  }, []);

  const openToolModal = useCallback((action: ChatToolAction, options?: ChatToolActionOptions) => {
    setDropFiles({});
    if (action === 'pmc-progress') {
      setPmcProgressRequest((value) => value + 1);
      return;
    }
    if (action === 'm7-warehouse') {
      setM7Tab(options?.m7Tab ?? 'delivery');
      if (options?.m7Panel === 'file-recognition') {
        setM7WorkflowTaskId(options.trackingTaskId ?? createM7TrackingTaskId());
        setToolModal(null);
        setM7DeliveryUploadOpen(true);
        return;
      }
    }
    setToolModal(action);
  }, []);

  const currentM7Draft = m7DraftConversationId === selectedConversationId ? m7DeliveryDraft : null;

  const handleM7Recognized = useCallback(async (batchId: string) => {
    if (recognizedM7Batches.current.has(batchId)) return;
    recognizedM7Batches.current.add(batchId);
    try {
      const taskId = m7WorkflowTaskId ?? createM7TrackingTaskId();
      const preview = await scanM7DeliveryNote(batchId, taskId);
      const draft: M7DeliveryDraft = { ...preview, tracking_task_id: taskId };
      await persistAssistantMessage(
        m7DeliveryDraftChatMessage(draft),
        m7DeliveryDraftStructuredData(draft),
      );
      setM7DeliveryDraft(draft);
      setM7DraftConversationId(useChatStore.getState().selectedConversationId);
      setM7DeliveryUploadOpen(false);
    } catch (error) {
      recognizedM7Batches.current.delete(batchId);
      void message.error(error instanceof Error ? error.message : '送货单识别结果读取失败');
    }
  }, [m7WorkflowTaskId, persistAssistantMessage]);

  const handleM7DraftSupplement = useCallback(async (result: unknown) => {
    if (!currentM7Draft) return;
    const merged = applyM7DeliverySupplement(currentM7Draft, result);
    if (!merged) return;
    try {
      await persistAssistantMessage(
        m7DeliveryDraftChatMessage(merged),
        m7DeliveryDraftStructuredData(merged),
      );
      setM7DeliveryDraft(merged);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '送货单补充信息保存失败');
    }
  }, [currentM7Draft, persistAssistantMessage]);

  const handleM7DeliveryCreated = useCallback(async () => {
    if (!currentM7Draft) return;
    await persistAssistantMessage(
      '送货单已创建，当前识别补录草稿已结束。',
      m7DeliveryDraftStructuredData(null),
    );
    setM7DeliveryDraft(null);
  }, [currentM7Draft, persistAssistantMessage]);

  const openFromFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    // 用户已显式打开「订单上传」或「M0 数据导入」弹窗时，从外部拖入/粘贴的文件
    // 应进入当前弹窗，而不是按扩展名重新判定——xlsx/pdf/zip 等同时属于订单与 M0，
    // 若按订单优先判定会误把 M0 弹窗切换成订单上传。
    const activeModal = toolModalRef.current;
    if (activeModal === 'm0-import' || activeModal === 'order-upload') {
      const key = activeModal === 'order-upload' ? 'order' : 'm0';
      setDropFiles((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...files] }));
      setToolModal(activeModal);
      return;
    }
    const { destination, orderFiles, m0Files } = handleDropFiles(files);
    if (destination === 'order-upload') {
      setDropFiles({ order: orderFiles });
      setToolModal('order-upload');
    } else if (destination === 'm0-import') {
      setDropFiles({ m0: m0Files });
      setToolModal('m0-import');
    }
  }, []);

  const { isDragging, cancelDrag } = useGlobalFileDrop({ onFiles: openFromFiles });

  useEffect(() => {
    const onWindowPaste = (event: ClipboardEvent) => {
      const files = extractFilesFromClipboard(event.clipboardData ?? null);
      if (files.length > 0) {
        event.preventDefault();
        openFromFiles(files);
      }
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [openFromFiles]);

  // 切换对话（新建/侧栏切换/回到首页）时，重置 订单到排程 业务流面板：
  // 避免上一个对话的订单流程状态残留在新对话页面上。
  useEffect(() => {
    // 业务流面板（DataFlowPanel）在人工门缺资料时，通过全局事件请求打开
    // M0 基础数据上传弹窗（历史 BOM/SOP/工艺/物料/设备等资料补录）。
    const onOpenM0 = () => openToolModal('m0-import');
    window.addEventListener('yunpai:open-m0-upload', onOpenM0);
    return () => window.removeEventListener('yunpai:open-m0-upload', onOpenM0);
  }, [openToolModal]);

  // 「M0 上传文件夹」：选择整个文件夹，把其中所有文件批量导入 M0 批次。
  // 部分浏览器/React 版本对非标准 directory 属性渲染不可靠，挂载后强制以
  // DOM API 设置，确保点击按钮弹出的是「选择文件夹」而不是「选文件」。
  useEffect(() => {
    const el = m0FolderInputRef.current;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
      el.setAttribute('multiple', '');
    }
  }, []);

  const handleM0FolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setM0FolderUploading(true);
    try {
      const batch = await uploadM0FilesWithProgress(files, {});
      // 上传成功后给出明显的「数据上传成功」通知（右上角，带批次号与后续入口），
      // 不自动打开空的 M0 面板，避免误以为未上传。
      appNotification.success({
        message: 'M0 数据上传成功',
        description: `已上传 ${files.length} 个文件，批次 ${batch.id ?? '已创建'} 已建立，正在处理中。可在「M0 数据建设」页查看批次详情。`,
        placement: 'topRight',
        duration: 8,
      });
    } catch (error) {
      message.error(describeM0UploadError(error));
    } finally {
      setM0FolderUploading(false);
    }
  };

  useEffect(() => {
    if (roleQuery.data?.id !== 'quality-assurance') return;
    let disposed = false;
    let notifiedSignature = '';
    const poll = async () => {
      try {
        const pending = await listM7PendingInspections();
        const signature = pending.map((item) => item.inspection_lot_id).sort().join(',');
        if (!disposed && pending.length > 0 && signature !== notifiedSignature) {
          notifiedSignature = signature;
          setM7Tab('qc');
          setToolModal('m7-warehouse');
        }
      } catch {
        // 轮询失败由下一轮恢复，不遮断对话页。
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [roleQuery.data?.id]);

  useEffect(() => {
    useBusinessRunStore.getState().reset();
  }, [conversationId]);

  useLayoutEffect(() => {
    const targetConversationId = conversationId ?? lastSelectedConversationId();
    if (!targetConversationId) return;
    if (selectedConversationId !== targetConversationId) {
      void selectConversation(targetConversationId);
    }
    if (!conversationId) navigate(`/c/${targetConversationId}`, { replace: true });
  }, [conversationId, navigate, selectConversation, selectedConversationId]);

  useEffect(() => {
    setM7DeliveryDraft(latestM7DeliveryDraft(chatMessages));
    setM7DraftConversationId(selectedConversationId);
  }, [chatMessages, selectedConversationId]);

  useEffect(() => {
    if (!conversationId && selectedConversationId && !selectedConversationId.startsWith('draft-')) {
      navigate(`/c/${selectedConversationId}`, { replace: true });
    }
  }, [conversationId, navigate, selectedConversationId]);

  return (
    <main className={shellClassName}>
      {!collapsed ? <aside className="conversation-sidebar desktop-sidebar"><ConversationSidebar /></aside> : null}
      <header className="assistant-header">
        <div className="assistant-header-left">
          <Tooltip title="会话历史">
            <Button ref={menuButton} className="assistant-menu" type="text" icon={<MenuOutlined />}
              aria-label="打开会话历史" onClick={() => { if (window.matchMedia('(max-width: 1180px)').matches) setDrawerOpen(true); else setCollapsed(!collapsed); }} />
          </Tooltip>
        </div>
        <div className="assistant-header-center">
          <div className="assistant-title">云湃企业助手</div>
          <div className="assistant-subtitle">工业智造 Agent</div>
        </div>
        <div className="assistant-header-right">
          <AgentTaskCenter />
          {demoRoles ? <RoleSwitcher /> : null}
          <input
            ref={m0FolderInputRef}
            type="file"
            multiple
            style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleM0FolderSelect}
            {...({ webkitdirectory: '', directory: '' } as Record<string, unknown>)}
          />
          <Button
            icon={<FolderOpenOutlined />}
            loading={m0FolderUploading}
            onClick={() => m0FolderInputRef.current?.click()}
          >
            M0 上传文件夹
          </Button>
          <div className="assistant-header-version">
            <VersionBadge />
          </div>
          {demoRoles ? (
            <>
              <Tag color="gold" className="assistant-shared-tag" title="只读共享业务数据">
                <Badge status="success" />
                共享数据{me?.user?.name ? ` · ${me.user.name}` : ''}
              </Tag>
              <DatabaseTenantSwitcher />
              {authConfig?.capabilities.oidc_login && me?.principal_type !== 'oidc_federated'
                ? <Button aria-label="登录" icon={<LoginOutlined />} href={oidcLoginUrl(`${location.pathname}${location.search}`)}>登录</Button>
                : null}
            </>
          ) : (
            <>
              <AdminNavMenu />
              <UserMenu />
            </>
          )}
        </div>
      </header>
      {/* M1–M5 订单全链路面板：仅 order.ingest（上传/导入订单）可见，其余角色完全不渲染
          （不占位、不留空白右栏），对话区由 .assistant-shell-no-flow 铺满。 */}
      {canRunOrderFlow ? orderFlowPanel : null}
      <ChatPanel
        onToolAction={openToolModal}
        m7DeliveryDraft={currentM7Draft}
        onM7DraftSupplement={handleM7DraftSupplement}
      />
      <M0BurstCaptureModal
        allowDocuments
        fileUploadOnly
        open={m7DeliveryUploadOpen}
        onClose={() => setM7DeliveryUploadOpen(false)}
        onRecognized={handleM7Recognized}
      />
      <Modal
        title={localLangGraph ? '上传订单文件 · 本地 Agent 运行' : '上传订单文件 · 服务器执行 订单到排程 受治理流程'}
        open={toolModal === 'order-upload'}
        footer={null}
        width="min(94vw, 720px)"
        onCancel={closeToolModal}
        destroyOnHidden
        styles={{ body: { overflowX: 'hidden' } }}
      >
        <OrderFileUploadPanel onClose={closeToolModal} initialFiles={dropFiles.order} />
      </Modal>
      <Modal
        title="M0 数据导入 · 基础数据库建设"
        open={toolModal === 'm0-import'}
        footer={null}
        width={820}
        className="m0-import-modal"
        onCancel={closeToolModal}
        destroyOnHidden
      >
        <M0ChatPanel initialFiles={dropFiles.m0} />
      </Modal>
      <Modal
        title="M7 仓库 · 送货签收 / 品保抽检 / 领料超领"
        open={toolModal === 'm7-warehouse'}
        footer={null}
        width="min(96vw, 1180px)"
        onCancel={closeToolModal}
        destroyOnHidden
      >
        <M7WarehousePanel
          initialTab={m7Tab}
          initialDeliveryScan={currentM7Draft}
          deliveryTaskId={currentM7Draft?.tracking_task_id}
          onDeliveryCreated={handleM7DeliveryCreated}
        />
      </Modal>
      <Modal
        title="计件工资报表"
        open={toolModal === 'piece-wage'}
        footer={null}
        width="min(94vw, 980px)"
        onCancel={closeToolModal}
        destroyOnHidden
        styles={{ body: { overflowX: 'auto' } }}
      >
        <PieceWageReportCard />
      </Modal>
      <Modal
        title="M3/M4/M5 证据与裁决"
        open={toolModal === 'evidence-adjudication'}
        footer={null}
        width="min(96vw, 1120px)"
        className="evidence-adjudication-modal"
        onCancel={closeToolModal}
        destroyOnHidden
        styles={{ body: { overflowX: 'hidden' } }}
      >
        <EvidenceAdjudicationPanel />
      </Modal>
      <DropOverlay visible={isDragging} onCancel={cancelDrag} />
      <Drawer className="conversation-drawer" rootClassName="conversation-drawer" title="会话历史" placement="left" width="min(85vw, 320px)"
        open={drawerOpen} onClose={closeDrawer} afterOpenChange={(open) => { if (!open) menuButton.current?.focus(); }}>
        <ConversationSidebar onSelected={closeDrawer} />
      </Drawer>
      <CommandPalette />
    </main>
  );
}
