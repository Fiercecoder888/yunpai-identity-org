import {
  AuditOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'antd';
import type { ButtonProps, UploadFile } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeading } from '../components/PageHeading';
import { PageState } from '../components/PageState';
import { PermissionGate } from '../components/PermissionGate';
import { ActionGate } from '../components/ActionGate';
import { StatusTag } from '../components/StatusTag';
import { OverdueBar } from '../components/status/OverdueBar';
import { DataTableToolbar } from '../components/table/DataTableToolbar';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { statusColors } from '../components/statusColors';
import {
  confirmM4ReplyParse,
  createM4SupplierReply,
  approveM4PurchaseOrder,
  exportM4AlertsCsv,
  exportM4TrackingCsv,
  generateM4AlertUrgeMessage,
  generateM4PurchaseInquiryMessage,
  generateM4PurchaseOrders,
  getM4ImportBatch,
  listM4Alerts,
  listM4PurchaseOrders,
  listM4Suggestions,
  listM4Suppliers,
  listM4Tracking,
  parseM4SupplierReply,
  rejectM4PurchaseOrder,
  scanM4Alerts,
  sendM4PurchaseOrder,
  simulateM4SupplierConfirmation,
  submitM4PurchaseOrderReview,
  updateM4AlertStatus,
  uploadM4ImportBatch,
} from '../services/m4Api';
import { AUDIT_LOG_SYNC_FAILURE_MESSAGE, createAuditLog, writeAuditLogSafely } from '../services/auditLogger';
import { hasPermission } from '../services/permissionApi';
import type {
  M4Alert,
  M4AlertStatus,
  M4AlertType,
  M4PurchaseInquiryMessage,
  M4PurchaseOrder,
  M4PurchaseOrderStatus,
  M4ReplyParseResult,
  M4SuggestionItem,
  M4SupplierReply,
  M4Tracking,
} from '../schemas/m4';

type DrawerState =
  | { type: 'alert'; data: M4Alert }
  | { type: 'tracking'; data: M4Tracking }
  | { type: 'order'; data: M4PurchaseOrder }
  | null;

type ConfirmParseFields = {
  delivery_date?: string;
  unit_price?: string;
  exception_description?: string;
};

type OperationNotice = {
  type: 'success' | 'error' | 'warning';
  message: string;
};

type PurchaseOrderAction = 'submit-review' | 'approve' | 'reject';

const replyEligibleStatuses = new Set<M4PurchaseOrderStatus>(['sent', 'replied', 'parse_pending_review', 'tracking', 'alerted']);

const alertStatusOptions: Array<{ value: M4AlertStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'open', label: '未处理' },
  { value: 'processing', label: '处理中' },
  { value: 'closed', label: '已关闭' },
];

const alertTypeOptions: Array<{ value: M4AlertType | 'all'; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'overdue', label: '已超期' },
  { value: 'due_soon', label: '即将到期' },
  { value: 'supplier_exception', label: '供应商异常' },
];

const downloadText = (filename: string, content: string) => {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }

  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export function PurchaseWarningsPage() {
  return (
    <PermissionGate permission="m4:read" auditModule="M4" targetId="m4-purchase-tracking">
      <PurchaseWarningsContent />
    </PermissionGate>
  );
}

function PurchaseWarningsContent() {
  const queryClient = useQueryClient();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const canOperate = hasPermission(role, 'm4:operate');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [alertStatus, setAlertStatus] = useState<M4AlertStatus | 'all'>('all');
  const [alertType, setAlertType] = useState<M4AlertType | 'all'>('all');
  const [alertsPage, setAlertsPage] = useState(1);
  const [suggestionsPage, setSuggestionsPage] = useState(1);
  const [ordersPage, setOrdersPage] = useState(1);
  const [trackingPage, setTrackingPage] = useState(1);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [suggestionFileList, setSuggestionFileList] = useState<UploadFile[]>([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<number[]>([]);
  const [parseOrderId, setParseOrderId] = useState<number>();
  const [replyContent, setReplyContent] = useState('不确定能否按期交付，预计 2026-07-25 到货，单价 12.50 元，含税。');
  const [activeReply, setActiveReply] = useState<M4SupplierReply | null>(null);
  const [parseResult, setParseResult] = useState<M4ReplyParseResult | null>(null);
  const [inquiryPreview, setInquiryPreview] = useState<M4PurchaseInquiryMessage | null>(null);
  const [operationNotice, setOperationNotice] = useState<OperationNotice | null>(null);
  const [auditWarning, setAuditWarning] = useState(false);
  const [confirmForm] = Form.useForm<ConfirmParseFields>();

  const suppliersQuery = useQuery({ queryKey: ['m4-suppliers'], queryFn: () => listM4Suppliers({ page: 1, pageSize: 50 }) });
  const suggestionsQuery = useQuery({
    queryKey: ['m4-suggestions', suggestionsPage],
    queryFn: () => listM4Suggestions({ page: suggestionsPage, pageSize: 10 }),
  });
  const alertsQuery = useQuery({
    queryKey: ['m4-alerts', alertsPage, alertStatus, alertType],
    queryFn: () => listM4Alerts({ page: alertsPage, pageSize: 10, status: alertStatus, alertType }),
  });
  const trackingQuery = useQuery({
    queryKey: ['m4-tracking', trackingPage],
    queryFn: () => listM4Tracking({ page: trackingPage, pageSize: 10 }),
  });
  const purchaseOrdersQuery = useQuery({
    queryKey: ['m4-purchase-orders', ordersPage],
    queryFn: () => listM4PurchaseOrders({ page: ordersPage, pageSize: 10 }),
  });
  const replyEligibleQuery = useQuery({
    queryKey: ['m4-reply-eligible-orders'],
    queryFn: () => listM4PurchaseOrders({ page: 1, pageSize: 200 }),
  });

  const alertRows = useMemo(
    () => (alertsQuery.data?.items ?? []).filter((item) => supplierFilter === 'all' || item.supplier_name === supplierFilter),
    [alertsQuery.data?.items, supplierFilter],
  );
  const replyEligibleOrders = useMemo(
    () => (replyEligibleQuery.data?.items ?? []).filter((item) => replyEligibleStatuses.has(item.status)),
    [replyEligibleQuery.data?.items],
  );
  const parseOrder = useMemo(
    () =>
      replyEligibleOrders.find((item) => item.id === parseOrderId) ??
      replyEligibleOrders.find((item) => item.status === 'parse_pending_review') ??
      replyEligibleOrders[0] ??
      null,
    [parseOrderId, replyEligibleOrders],
  );

  const auditM4Operation = async (action: string, targetId: string, detail: string) => {
    const result = await writeAuditLogSafely(
      createAuditLog({
        actor: role?.name ?? '权限服务未就绪',
        action,
        module: 'M4',
        targetId,
        result: 'success',
        detail,
      }),
    );

    if (!result.ok) {
      setAuditWarning(true);
      void message.warning(AUDIT_LOG_SYNC_FAILURE_MESSAGE);
    }
  };

  const urgeMutation = useMutation({
    mutationFn: (alert: M4Alert) => generateM4AlertUrgeMessage(alert.id, { channel: 'wechat', language: 'zh-CN' }),
  });
  const alertStatusMutation = useMutation({
    mutationFn: ({ alert, status }: { alert: M4Alert; status: M4AlertStatus }) => updateM4AlertStatus(alert.id, status),
  });
  const scanAlertsMutation = useMutation({
    mutationFn: scanM4Alerts,
  });
  const importSuggestionsMutation = useMutation({
    mutationFn: uploadM4ImportBatch,
  });
  const generateOrdersMutation = useMutation({
    mutationFn: async (suggestionIds: number[]) => {
      const selectedItems = (suggestionsQuery.data?.items ?? []).filter(
        (item) => item.id != null && suggestionIds.includes(item.id),
      );
      if (selectedItems.length !== suggestionIds.length) {
        throw new Error('Selected suggestions must be visible on the current page');
      }
      const batchIds = [...new Set(selectedItems.map((item) => item.batch_id).filter((id): id is number => id != null))];
      if (batchIds.length > 1) {
        throw new Error('Selected suggestions must come from the same import batch');
      }
      const batch = batchIds[0] == null ? null : await getM4ImportBatch(batchIds[0]);
      return generateM4PurchaseOrders(suggestionIds, batch?.tracking_task_id ?? undefined);
    },
  });
  const orderStateMutation = useMutation({
    mutationFn: ({ order, action }: { order: M4PurchaseOrder; action: PurchaseOrderAction }) => {
      const payload = {
        operated_by: role?.name ?? 'M4 前端操作员',
        comment: action === 'submit-review' ? '前端提交审核' : action === 'approve' ? '前端审核通过' : '前端审核驳回',
      };
      if (action === 'submit-review') {
        return submitM4PurchaseOrderReview(order.id, payload);
      }
      if (action === 'approve') {
        return approveM4PurchaseOrder(order.id, payload);
      }
      return rejectM4PurchaseOrder(order.id, payload);
    },
  });
  const inquiryMutation = useMutation({
    mutationFn: (order: M4PurchaseOrder) => generateM4PurchaseInquiryMessage(order.id, { channel: 'email', language: 'zh-CN' }),
  });
  const sendMutation = useMutation({
    mutationFn: (order: M4PurchaseOrder) => sendM4PurchaseOrder(order.id),
  });
  const simulateConfirmMutation = useMutation({
    mutationFn: async ({ order, promisedDate: date }: { order: M4PurchaseOrder; promisedDate: string }) =>
      simulateM4SupplierConfirmation(order.id, { promised_date: date, note: '模拟供应商确认（演示）' }),
    onSuccess: (_updated, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['m4-purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['m4-reply-eligible-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['m4-tracking'] });
      setOperationNotice({ type: 'success', message: `供应商已确认，承诺交期 ${variables.promisedDate}，已按交期计入预期库存` });
      void message.success('模拟确认成功，已按交期计入预期库存');
    },
    onError: (error) => {
      setOperationNotice({ type: 'error', message: `模拟确认失败：${error instanceof Error ? error.message : String(error)}` });
      void message.error('模拟确认失败');
    },
  });
  const parseMutation = useMutation({
    mutationFn: async () => {
      if (!parseOrder) {
        throw new Error('No purchase order available for reply parsing');
      }

      const reply = await createM4SupplierReply({
        purchase_order_id: parseOrder.id,
        purchase_order_no: parseOrder.purchase_order_no,
        supplier_name: parseOrder.supplier_name,
        reply_content: replyContent,
        received_at: new Date().toISOString(),
      });
      const result = await parseM4SupplierReply(reply.id);
      return { reply, result };
    },
  });
  const confirmMutation = useMutation({
    mutationFn: async (values: ConfirmParseFields) => {
      if (!activeReply || !parseResult) {
        throw new Error('No parse result available for confirmation');
      }

      return confirmM4ReplyParse(activeReply.id, {
        ...parseResult,
        ...values,
        currency: parseResult.currency ?? 'CNY',
        confidence: 1,
        need_human_review: false,
        confirmed_by: role?.name ?? '权限服务未就绪',
      });
    },
  });

  const operationButton = (button: ButtonProps, disabledReason?: string) => (
    <ActionGate
      permission="m4:operate"
      auditModule="M4"
      targetId={`m4-operate-${String(button.children ?? 'action')}`}
      deniedTitle="缺少权限：m4:operate"
    >
      <Button
        {...button}
        disabled={!canOperate || button.disabled}
        title={canOperate && button.disabled ? disabledReason : button.title}
      />
    </ActionGate>
  );

  const handleGenerateUrge = async (alert: M4Alert) => {
    try {
      const result = await urgeMutation.mutateAsync(alert);
      await queryClient.invalidateQueries({ queryKey: ['m4-alerts'] });
      await auditM4Operation('M4_ALERT_URGE_MESSAGE', String(alert.id), `生成催单文本：${alert.purchase_order_no}`);
      if (drawer?.type === 'alert' && drawer.data.id === alert.id) {
        setDrawer({ type: 'alert', data: { ...drawer.data, urge_message: result.urge_message } });
      }
      setOperationNotice({ type: 'success', message: '催单文本已生成' });
      void message.success('催单文本已生成');
    } catch {
      setOperationNotice({ type: 'error', message: '催单文本生成失败' });
      void message.error('催单文本生成失败');
    }
  };

  const handleAlertStatus = async (alert: M4Alert, status: M4AlertStatus) => {
    try {
      await alertStatusMutation.mutateAsync({ alert, status });
      await queryClient.invalidateQueries({ queryKey: ['m4-alerts'] });
      const closing = status === 'closed';
      await auditM4Operation(
        closing ? 'M4_ALERT_CLOSED' : 'M4_ALERT_FOLLOW_UP',
        String(alert.id),
        closing ? `关闭采购预警：${alert.purchase_order_no}` : `标记预警处理中：${alert.purchase_order_no}`,
      );
      setOperationNotice({ type: 'success', message: closing ? '预警已关闭' : '已标记跟进' });
      void message.success(closing ? '预警已关闭' : '已标记跟进');
    } catch {
      setOperationNotice({ type: 'error', message: status === 'closed' ? '关闭预警失败' : '跟进操作失败' });
      void message.error(status === 'closed' ? '关闭预警失败' : '跟进操作失败');
    }
  };

  const handleScanAlerts = async () => {
    try {
      const result = await scanAlertsMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ['m4-alerts'] });
      await auditM4Operation('M4_ALERT_SCAN', 'm4-alerts', `扫描 ${result.scanned} 项，新增 ${result.created} 条预警`);
      setOperationNotice({ type: 'success', message: `预警扫描完成，新增 ${result.created} 条` });
      void message.success(`预警扫描完成，新增 ${result.created} 条`);
    } catch {
      setOperationNotice({ type: 'error', message: '预警扫描失败' });
      void message.error('预警扫描失败');
    }
  };

  const handleImportSuggestions = async () => {
    const file = suggestionFileList[0]?.originFileObj;
    if (!file) {
      return;
    }
    try {
      const result = await importSuggestionsMutation.mutateAsync(file);
      setSuggestionFileList([]);
      await queryClient.invalidateQueries({ queryKey: ['m4-suggestions'] });
      await auditM4Operation('M4_SUGGESTION_IMPORT', String(result.id ?? result.filename), `导入采购建议：${result.filename}`);
      setOperationNotice({ type: 'success', message: `采购建议已导入，有效 ${result.valid_rows} 条` });
      void message.success(`采购建议已导入，有效 ${result.valid_rows} 条`);
    } catch {
      setOperationNotice({ type: 'error', message: '采购建议导入失败' });
      void message.error('采购建议导入失败');
    }
  };

  const handleGenerateOrders = async () => {
    try {
      const orders = await generateOrdersMutation.mutateAsync(selectedSuggestionIds);
      setSelectedSuggestionIds([]);
      await queryClient.invalidateQueries({ queryKey: ['m4-purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['m4-reply-eligible-orders'] });
      await auditM4Operation('M4_PURCHASE_ORDER_GENERATE', orders.map((item) => item.purchase_order_no).join(','), `生成 ${orders.length} 张采购单`);
      setOperationNotice({ type: 'success', message: `已生成 ${orders.length} 张采购单` });
      void message.success(`已生成 ${orders.length} 张采购单`);
    } catch {
      setOperationNotice({ type: 'error', message: '采购单生成失败' });
      void message.error('采购单生成失败');
    }
  };

  const handleOrderState = async (order: M4PurchaseOrder, action: PurchaseOrderAction) => {
    const labels = {
      'submit-review': '采购单已提交审核',
      approve: '采购单审核通过',
      reject: '采购单已驳回',
    };
    try {
      const updatedOrder = await orderStateMutation.mutateAsync({ order, action });
      queryClient.setQueryData(['m4-purchase-orders', ordersPage], (current: typeof purchaseOrdersQuery.data) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updatedOrder.id ? updatedOrder : item)),
            }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: ['m4-purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['m4-reply-eligible-orders'] });
      await auditM4Operation(`M4_PURCHASE_ORDER_${action.replace('-', '_').toUpperCase()}`, String(order.id), `${labels[action]}：${order.purchase_order_no}`);
      setOperationNotice({ type: 'success', message: labels[action] });
      void message.success(labels[action]);
    } catch {
      setOperationNotice({ type: 'error', message: `${labels[action]}失败` });
      void message.error(`${labels[action]}失败`);
    }
  };

  const handleExportAlerts = async () => {
    const csv = await exportM4AlertsCsv();
    downloadText('m4_alerts.csv', csv);
    setOperationNotice({ type: 'success', message: '预警 CSV 已生成' });
    void message.success('预警 CSV 已生成');
  };

  const handleExportTracking = async () => {
    const csv = await exportM4TrackingCsv();
    downloadText('m4_tracking.csv', csv);
    setOperationNotice({ type: 'success', message: '追踪 CSV 已生成' });
    void message.success('追踪 CSV 已生成');
  };

  const handleGenerateInquiry = async (order: M4PurchaseOrder) => {
    try {
      const result = await inquiryMutation.mutateAsync(order);
      setInquiryPreview(result);
      await auditM4Operation('M4_PURCHASE_INQUIRY_MESSAGE', String(order.id), `生成询价文本：${order.purchase_order_no}`);
      setOperationNotice({ type: 'success', message: '询价文本已生成' });
      void message.success('询价文本已生成');
    } catch {
      setOperationNotice({ type: 'error', message: '询价文本生成失败' });
      void message.error('询价文本生成失败');
    }
  };

  const handleSendOrder = async (order: M4PurchaseOrder) => {
    try {
      await sendMutation.mutateAsync(order);
      await queryClient.invalidateQueries({ queryKey: ['m4-purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['m4-reply-eligible-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['m4-tracking'] });
      await auditM4Operation('M4_PURCHASE_ORDER_SEND', String(order.id), `记录发送供应商：${order.purchase_order_no}`);
      setOperationNotice({ type: 'success', message: '采购单已记录发送' });
      void message.success('采购单已记录发送');
    } catch {
      setOperationNotice({ type: 'error', message: '采购单发送失败' });
      void message.error('采购单发送失败');
    }
  };

  const handleParseReply = async () => {
    try {
      const { reply, result } = await parseMutation.mutateAsync();
      setActiveReply(reply);
      setParseResult(result);
      confirmForm.setFieldsValue({
        delivery_date: result.delivery_date ?? undefined,
        unit_price: result.unit_price ?? undefined,
        exception_description: result.exception_description ?? undefined,
      });
      await auditM4Operation('M4_REPLY_PARSE', String(reply.id), `AI 解析供应商回复：${reply.purchase_order_no}`);
      setOperationNotice({ type: 'success', message: 'AI 解析完成' });
      void message.success('AI 解析完成');
    } catch {
      setOperationNotice({ type: 'error', message: 'AI 解析失败' });
      void message.error('AI 解析失败');
    }
  };

  const handleConfirmParse = async () => {
    try {
      const values = await confirmForm.validateFields();
      const result = await confirmMutation.mutateAsync(values);
      setParseResult(result);
      await queryClient.invalidateQueries({ queryKey: ['m4-purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['m4-reply-eligible-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['m4-tracking'] });
      await auditM4Operation('M4_REPLY_PARSE_CONFIRM', String(activeReply?.id ?? ''), '人工确认 AI 解析结果');
      setOperationNotice({ type: 'success', message: 'AI 解析已人工确认' });
      void message.success('AI 解析已人工确认');
    } catch {
      setOperationNotice({ type: 'error', message: '人工确认失败' });
      void message.error('人工确认失败');
    }
  };

  const alertColumns: ColumnsType<M4Alert> = [
    { title: '供应商', dataIndex: 'supplier_name', width: 180 },
    { title: '采购单', dataIndex: 'purchase_order_no', width: 160 },
    { title: '物料', dataIndex: 'item_name', width: 120 },
    { title: '承诺日期', dataIndex: 'promised_date', width: 120 },
    { title: '超期天数', dataIndex: 'days_overdue', width: 140, render: (value: number) => <OverdueBar days={value} /> },
    { title: '类型', dataIndex: 'alert_type', width: 130, render: (value: string) => <StatusTag value={value} /> },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: string) => <StatusTag value={value} /> },
    {
      title: '操作',
      width: 260,
      render: (_, alert) => (
        <Space size={8}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDrawer({ type: 'alert', data: alert })}>
            查看预警
          </Button>
          {operationButton({
            size: 'small',
            icon: <MessageOutlined />,
            loading: urgeMutation.isPending,
            disabled: alert.status !== 'open',
            onClick: () => void handleGenerateUrge(alert),
            children: '生成催单',
          }, '只有未处理预警可以生成催单')}
          {alert.status === 'open'
            ? operationButton({
                size: 'small',
                icon: <SyncOutlined />,
                loading: alertStatusMutation.isPending,
                onClick: () => void handleAlertStatus(alert, 'processing'),
                children: '标记跟进',
              })
            : null}
          {alert.status === 'processing'
            ? operationButton({
                size: 'small',
                icon: <CheckOutlined />,
                loading: alertStatusMutation.isPending,
                onClick: () => void handleAlertStatus(alert, 'closed'),
                children: '关闭预警',
              })
            : null}
        </Space>
      ),
    },
  ];

  const trackingColumns: ColumnsType<M4Tracking> = [
    { title: '追踪 ID', dataIndex: 'id', width: 100 },
    { title: '采购单项', dataIndex: 'purchase_order_item_id', width: 120 },
    { title: '承诺交期', dataIndex: 'promised_date', width: 120 },
    { title: '单价', dataIndex: 'unit_price', width: 100 },
    { title: '币种', dataIndex: 'currency', width: 90 },
    { title: '异常', dataIndex: 'exception_description' },
    { title: '到货状态', dataIndex: 'arrival_status', width: 120, render: (value: string) => <StatusTag value={value} /> },
    {
      title: '操作',
      width: 120,
      render: (_, tracking) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setDrawer({ type: 'tracking', data: tracking })}>
          查看追踪
        </Button>
      ),
    },
  ];

  const orderColumns: ColumnsType<M4PurchaseOrder> = [
    { title: '采购单', dataIndex: 'purchase_order_no', width: 170 },
    { title: '供应商', dataIndex: 'supplier_name', width: 180 },
    { title: '需求日期', dataIndex: 'required_date', width: 120 },
    { title: '状态', dataIndex: 'status', width: 140, render: (value: string) => <StatusTag value={value} /> },
    {
      title: '操作',
      width: 420,
      render: (_, order) => (
        <Space size={8} wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDrawer({ type: 'order', data: order })}>
            查看采购单
          </Button>
          {order.status === 'draft' || order.status === 'rejected'
            ? operationButton({
                size: 'small',
                icon: <AuditOutlined />,
                loading: orderStateMutation.isPending,
                onClick: () => void handleOrderState(order, 'submit-review'),
                children: '提交审核',
              })
            : null}
          {order.status === 'pending_review'
            ? operationButton({
                size: 'small',
                icon: <CheckOutlined />,
                loading: orderStateMutation.isPending,
                onClick: () => void handleOrderState(order, 'approve'),
                children: '批准',
              })
            : null}
          {order.status === 'pending_review'
            ? operationButton({
                size: 'small',
                danger: true,
                icon: <CloseCircleOutlined />,
                loading: orderStateMutation.isPending,
                onClick: () => void handleOrderState(order, 'reject'),
                children: '驳回',
              })
            : null}
          {order.status === 'pending_send'
            ? operationButton({
                size: 'small',
                icon: <MessageOutlined />,
                loading: inquiryMutation.isPending,
                onClick: () => void handleGenerateInquiry(order),
                children: '生成询价',
              })
            : null}
          {order.status === 'pending_send'
            ? operationButton({
                size: 'small',
                icon: <SendOutlined />,
                loading: sendMutation.isPending,
                onClick: () => void handleSendOrder(order),
                children: '发送供应商',
              })
            : null}
        </Space>
      ),
    },
  ];

  const suggestionColumns: ColumnsType<M4SuggestionItem> = [
    { title: '物料编码', dataIndex: 'item_code', width: 130 },
    { title: '物料名称', dataIndex: 'item_name', width: 140 },
    { title: '数量', dataIndex: 'quantity', width: 90 },
    { title: '单位', dataIndex: 'unit', width: 80 },
    { title: '供应商', dataIndex: 'supplier_name', width: 180 },
    { title: '需求日期', dataIndex: 'required_date', width: 120 },
    { title: '校验状态', dataIndex: 'validation_status', width: 110, render: (value: string) => <StatusTag value={value} /> },
    { title: '错误信息', dataIndex: 'error_message' },
  ];

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <PageHeading path="/modules/purchase-warnings" />
      {operationNotice ? <Alert type={operationNotice.type} showIcon message={operationNotice.message} /> : null}
      {roleQuery.error ? (
        <Alert type="error" showIcon message="权限后端未就绪" description="无法获取当前用户操作权限，M4 写操作已按 fail closed 禁用。" />
      ) : null}
      {auditWarning ? <Alert type="warning" showIcon message={AUDIT_LOG_SYNC_FAILURE_MESSAGE} description="主操作已完成，日志稍后补偿同步。" /> : null}
      <Tabs
        defaultActiveKey="alerts"
        items={[
          {
            key: 'suggestions',
            label: '采购建议',
            children: (
              <Card>
                <DataTableToolbar
                  title="采购建议"
                  selectedCount={selectedSuggestionIds.length}
                  batch={
                    <Space wrap>
                      <span className="data-table-toolbar-selection">已选 {selectedSuggestionIds.length} 项</span>
                      {operationButton({
                        type: 'primary',
                        icon: <SendOutlined />,
                        loading: generateOrdersMutation.isPending,
                        disabled: selectedSuggestionIds.length === 0,
                        onClick: () => void handleGenerateOrders(),
                        children: '生成采购单',
                      }, '请选择有效采购建议')}
                    </Space>
                  }
                  extra={
                    <Space wrap>
                      <Upload
                        accept=".csv"
                        maxCount={1}
                        beforeUpload={() => false}
                        fileList={suggestionFileList}
                        onChange={({ fileList }) => setSuggestionFileList(fileList.slice(-1))}
                      >
                        <Button icon={<UploadOutlined />}>选择 CSV</Button>
                      </Upload>
                      {operationButton({
                        icon: <UploadOutlined />,
                        loading: importSuggestionsMutation.isPending,
                        disabled: suggestionFileList.length === 0,
                        onClick: () => void handleImportSuggestions(),
                        children: '导入采购建议',
                      }, '请先选择 CSV 文件')}
                    </Space>
                  }
                />
                <PageState
                  loading={suggestionsQuery.isLoading}
                  error={suggestionsQuery.error}
                  empty={(suggestionsQuery.data?.items.length ?? 0) === 0 && !suggestionsQuery.isLoading}
                  onRetry={() => void suggestionsQuery.refetch()}
                >
                  <Table
                    rowKey={(item) => item.id ?? `row-${item.row_number}`}
                    scroll={{ x: 'max-content' }}
                    dataSource={suggestionsQuery.data?.items}
                    columns={suggestionColumns}
                    pagination={{
                      current: suggestionsQuery.data?.page ?? suggestionsPage,
                      pageSize: suggestionsQuery.data?.page_size ?? 10,
                      total: suggestionsQuery.data?.total ?? 0,
                      showSizeChanger: false,
                      onChange: (page) => {
                        setSuggestionsPage(page);
                        setSelectedSuggestionIds([]);
                      },
                    }}
                    rowSelection={{
                      selectedRowKeys: selectedSuggestionIds,
                      onChange: (keys) => setSelectedSuggestionIds(keys.map(Number)),
                      getCheckboxProps: (item) => ({
                        disabled: item.id == null || item.validation_status !== 'valid',
                      }),
                    }}
                  />
                </PageState>
              </Card>
            ),
          },
          {
            key: 'alerts',
            label: '采购预警',
            children: (
              <Card
                extra={
                  <Space wrap>
                    <Select
                      aria-label="供应商筛选"
                      data-testid="m4-supplier-filter"
                      value={supplierFilter}
                      style={{ width: 180 }}
                      onChange={(value) => {
                        setSupplierFilter(value);
                        setAlertsPage(1);
                      }}
                      options={[
                        { value: 'all', label: '全部供应商' },
                        ...(suppliersQuery.data?.items.map((item) => ({ value: item.supplier_name, label: item.supplier_name })) ?? []),
                      ]}
                    />
                    <Select
                      aria-label="预警状态筛选"
                      value={alertStatus}
                      style={{ width: 140 }}
                      onChange={(value) => {
                        setAlertStatus(value);
                        setAlertsPage(1);
                      }}
                      options={alertStatusOptions}
                    />
                    <Select
                      aria-label="预警类型筛选"
                      value={alertType}
                      style={{ width: 150 }}
                      onChange={(value) => {
                        setAlertType(value);
                        setAlertsPage(1);
                      }}
                      options={alertTypeOptions}
                    />
                    <Divider type="vertical" />
                    {operationButton({
                      type: 'primary',
                      icon: <ReloadOutlined />,
                      loading: scanAlertsMutation.isPending,
                      onClick: () => void handleScanAlerts(),
                      children: '扫描预警',
                    })}
                    <Button icon={<DownloadOutlined />} onClick={() => void handleExportAlerts()}>
                      导出预警 CSV
                    </Button>
                  </Space>
                }
              >
                <PageState
                  loading={alertsQuery.isLoading || suppliersQuery.isLoading}
                  error={alertsQuery.error ?? suppliersQuery.error}
                  empty={Boolean(alertsQuery.data) && alertRows.length === 0}
                  onRetry={() => {
                    void alertsQuery.refetch();
                    void suppliersQuery.refetch();
                  }}
                >
                  <Table
                    rowKey="id"
                    scroll={{ x: 'max-content' }}
                    dataSource={alertRows}
                    columns={alertColumns}
                    pagination={{
                      current: alertsQuery.data?.page ?? alertsPage,
                      pageSize: alertsQuery.data?.page_size ?? 10,
                      total: alertsQuery.data?.total ?? 0,
                      showSizeChanger: false,
                      onChange: setAlertsPage,
                    }}
                  />
                </PageState>
              </Card>
            ),
          },
          {
            key: 'tracking',
            label: '采购追踪',
            children: (
              <Card
                extra={
                  <Button icon={<DownloadOutlined />} onClick={() => void handleExportTracking()}>
                    导出追踪 CSV
                  </Button>
                }
              >
                <PageState
                  loading={trackingQuery.isLoading}
                  error={trackingQuery.error}
                  empty={Boolean(trackingQuery.data) && trackingQuery.data?.items.length === 0}
                  onRetry={() => void trackingQuery.refetch()}
                >
                  <Table
                    rowKey="id"
                    scroll={{ x: 'max-content' }}
                    dataSource={trackingQuery.data?.items}
                    columns={trackingColumns}
                    pagination={{
                      current: trackingQuery.data?.page ?? trackingPage,
                      pageSize: trackingQuery.data?.page_size ?? 10,
                      total: trackingQuery.data?.total ?? 0,
                      showSizeChanger: false,
                      onChange: setTrackingPage,
                    }}
                  />
                </PageState>
              </Card>
            ),
          },
          {
            key: 'orders',
            label: '采购单',
            children: (
              <Card>
                <PageState
                  loading={purchaseOrdersQuery.isLoading}
                  error={purchaseOrdersQuery.error}
                  empty={Boolean(purchaseOrdersQuery.data) && purchaseOrdersQuery.data?.items.length === 0}
                  onRetry={() => void purchaseOrdersQuery.refetch()}
                >
                  <Space direction="vertical" size={12} className="page-stack">
                    <Table
                      rowKey="id"
                      dataSource={purchaseOrdersQuery.data?.items}
                      columns={orderColumns}
                      scroll={{ x: 1100 }}
                      pagination={{
                        current: purchaseOrdersQuery.data?.page ?? ordersPage,
                        pageSize: purchaseOrdersQuery.data?.page_size ?? 10,
                        total: purchaseOrdersQuery.data?.total ?? 0,
                        showSizeChanger: false,
                        onChange: setOrdersPage,
                      }}
                    />
                    {inquiryPreview ? (
                      <Descriptions bordered size="small" title="询价文本预览" column={1}>
                        <Descriptions.Item label="主题">{inquiryPreview.subject}</Descriptions.Item>
                        <Descriptions.Item label="渠道">{inquiryPreview.channel}</Descriptions.Item>
                        <Descriptions.Item label="内容">{inquiryPreview.content}</Descriptions.Item>
                      </Descriptions>
                    ) : null}
                  </Space>
                </PageState>
              </Card>
            ),
          },
          {
            key: 'ai-parse',
            label: 'AI 解析',
            children: (
              <Card>
                <PageState
                  loading={replyEligibleQuery.isLoading}
                  error={replyEligibleQuery.error}
                  empty={Boolean(replyEligibleQuery.data) && !parseOrder}
                  onRetry={() => void replyEligibleQuery.refetch()}
                >
                  <Space direction="vertical" size={12} className="page-stack">
                    <Descriptions bordered size="small" column={3}>
                      <Descriptions.Item label="采购单">{parseOrder?.purchase_order_no}</Descriptions.Item>
                      <Descriptions.Item label="供应商">{parseOrder?.supplier_name}</Descriptions.Item>
                      <Descriptions.Item label="状态">{parseOrder ? <StatusTag value={parseOrder.status} /> : null}</Descriptions.Item>
                    </Descriptions>
                    <Select
                      aria-label="选择采购单"
                      value={parseOrder?.id}
                      style={{ width: 320 }}
                      onChange={setParseOrderId}
                      options={replyEligibleOrders.map((order) => ({
                        value: order.id,
                        label: `${order.purchase_order_no} · ${order.supplier_name}`,
                      }))}
                    />
                    <Input.TextArea
                      aria-label="供应商回复"
                      rows={4}
                      value={replyContent}
                      onChange={(event) => setReplyContent(event.target.value)}
                    />
                    {operationButton({
                      icon: <MessageOutlined />,
                      loading: parseMutation.isPending,
                      onClick: () => void handleParseReply(),
                      children: '解析供应商回复',
                    })}

                    {parseResult ? (
                      <>
                        <Descriptions bordered size="small" title="AI 解析" column={2}>
                          <Descriptions.Item label="预计交期">{parseResult.delivery_date}</Descriptions.Item>
                          <Descriptions.Item label="单价">{parseResult.unit_price}</Descriptions.Item>
                          <Descriptions.Item label="币种">{parseResult.currency}</Descriptions.Item>
                          <Descriptions.Item label="置信度">{Math.round(parseResult.confidence * 100)}%</Descriptions.Item>
                          <Descriptions.Item label="异常类型">{parseResult.exception_type}</Descriptions.Item>
                          <Descriptions.Item label="人工确认">
                            {parseResult.need_human_review ? <Tag color={statusColors.warning}>需要人工确认</Tag> : <Tag color={statusColors.success}>已确认</Tag>}
                          </Descriptions.Item>
                          <Descriptions.Item label="异常说明" span={2}>
                            {parseResult.exception_description}
                          </Descriptions.Item>
                        </Descriptions>

                        {parseResult.need_human_review ? (
                          <Form form={confirmForm} layout="vertical">
                            <Row gutter={12}>
                              <Form.Item name="delivery_date" label="确认交期" rules={[{ required: true, message: '请输入确认交期' }]}>
                                <Input />
                              </Form.Item>
                              <Form.Item name="unit_price" label="确认单价" rules={[{ required: true, message: '请输入确认单价' }]}>
                                <Input />
                              </Form.Item>
                              <Form.Item name="exception_description" label="异常说明">
                                <Input />
                              </Form.Item>
                            </Row>
                            {operationButton({
                              icon: <CheckOutlined />,
                              loading: confirmMutation.isPending,
                              onClick: () => void handleConfirmParse(),
                              children: '人工确认',
                            })}
                          </Form>
                        ) : null}
                      </>
                    ) : null}
                  </Space>
                </PageState>
              </Card>
            ),
          },
        ]}
      />

      <M4DetailDrawer
        drawer={drawer}
        onClose={() => setDrawer(null)}
        inquiryPending={inquiryMutation.isPending}
        onGenerateInquiry={inquiryMutation.mutateAsync}
        confirmPending={simulateConfirmMutation.isPending}
        onSimulateConfirm={(order, promisedDate) => simulateConfirmMutation.mutateAsync({ order, promisedDate })}
      />
    </Space>
  );
}

function M4DetailDrawer({
  drawer,
  onClose,
  inquiryPending,
  onGenerateInquiry,
  confirmPending,
  onSimulateConfirm,
}: {
  drawer: DrawerState;
  onClose: () => void;
  inquiryPending: boolean;
  onGenerateInquiry: (order: M4PurchaseOrder) => Promise<M4PurchaseInquiryMessage>;
  confirmPending: boolean;
  onSimulateConfirm: (order: M4PurchaseOrder, promisedDate: string) => Promise<unknown>;
}) {
  const [drawerInquiry, setDrawerInquiry] = useState<M4PurchaseInquiryMessage | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<M4PurchaseOrder | null>(null);
  const [promisedDate, setPromisedDate] = useState<string>();
  const title = drawer?.type === 'alert' ? '预警详情' : drawer?.type === 'tracking' ? '追踪详情' : '采购单详情';
  const closeDrawer = () => {
    setDrawerInquiry(null);
    setConfirmOrder(null);
    setPromisedDate(undefined);
    onClose();
  };
  const loadInquiry = async () => {
    if (!drawer || drawer.type !== 'order') return;
    try {
      setDrawerInquiry(await onGenerateInquiry(drawer.data));
    } catch {
      void message.error('采购函生成失败');
    }
  };
  const submitConfirm = async () => {
    if (!confirmOrder || !promisedDate) return;
    try {
      await onSimulateConfirm(confirmOrder, promisedDate);
      setConfirmOrder(null);
      setPromisedDate(undefined);
    } catch {
      // 父组件通过 mutation onError 展示错误。
    }
  };

  return (
    <>
    <Drawer title={title} width={560} open={Boolean(drawer)} onClose={closeDrawer}>
      {drawer?.type === 'alert' ? (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="供应商">{drawer.data.supplier_name}</Descriptions.Item>
          <Descriptions.Item label="采购单">{drawer.data.purchase_order_no}</Descriptions.Item>
          <Descriptions.Item label="物料">{`${drawer.data.item_code} ${drawer.data.item_name}`}</Descriptions.Item>
          <Descriptions.Item label="承诺日期">{drawer.data.promised_date}</Descriptions.Item>
          <Descriptions.Item label="预警类型">
            <StatusTag value={drawer.data.alert_type} />
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <StatusTag value={drawer.data.status} />
          </Descriptions.Item>
          <Descriptions.Item label="催单文本">{drawer.data.urge_message ?? '未生成'}</Descriptions.Item>
        </Descriptions>
      ) : null}

      {drawer?.type === 'tracking' ? (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="追踪 ID">{drawer.data.id}</Descriptions.Item>
          <Descriptions.Item label="采购单项">{drawer.data.purchase_order_item_id}</Descriptions.Item>
          <Descriptions.Item label="承诺交期">{drawer.data.promised_date}</Descriptions.Item>
          <Descriptions.Item label="单价">{drawer.data.unit_price}</Descriptions.Item>
          <Descriptions.Item label="到货状态">
            <StatusTag value={drawer.data.arrival_status} />
          </Descriptions.Item>
          <Descriptions.Item label="是否超期">{drawer.data.is_overdue ? '是' : '否'}</Descriptions.Item>
          <Descriptions.Item label="异常说明">{drawer.data.exception_description ?? '无'}</Descriptions.Item>
        </Descriptions>
      ) : null}

      {drawer?.type === 'order' ? (
        <Space direction="vertical" size={12} className="page-stack">
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="采购单">{drawer.data.purchase_order_no}</Descriptions.Item>
            <Descriptions.Item label="供应商">{drawer.data.supplier_name}</Descriptions.Item>
            <Descriptions.Item label="需求日期">{drawer.data.required_date}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <StatusTag value={drawer.data.status} />
            </Descriptions.Item>
          </Descriptions>
          {['pending_send', 'sent', 'replied', 'parse_pending_review', 'tracking', 'alerted'].includes(drawer.data.status) ? (
            <Card size="small" title={(
              <Space size={8}>
                采购函
                <Tag color={drawer.data.status === 'pending_send' ? statusColors.warning : statusColors.info}>
                  {drawer.data.status === 'pending_send' ? '预发布' : '已发出'}
                </Tag>
              </Space>
            )}>
              <Space direction="vertical" size={8} className="page-stack">
                <Button size="small" icon={<MessageOutlined />} loading={inquiryPending}
                  onClick={() => void loadInquiry()}>
                  {drawerInquiry ? '重新生成采购函' : '生成/查看采购函'}
                </Button>
                {drawerInquiry ? (
                  <Descriptions bordered size="small" column={1}>
                    <Descriptions.Item label="主题">{drawerInquiry.subject}</Descriptions.Item>
                    <Descriptions.Item label="内容">{drawerInquiry.content}</Descriptions.Item>
                  </Descriptions>
                ) : null}
              </Space>
            </Card>
          ) : null}
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={drawer.data.items}
            columns={[
              { title: '物料', dataIndex: 'item_name' },
              { title: '数量', dataIndex: 'quantity', width: 90 },
              { title: '单位', dataIndex: 'unit', width: 80 },
              { title: '状态', dataIndex: 'status', width: 110, render: (value: string) => <StatusTag value={value} /> },
            ]}
          />
          {replyEligibleStatuses.has(drawer.data.status as M4PurchaseOrderStatus) ? (
            <Button type="primary" icon={<CheckOutlined />} onClick={() => setConfirmOrder(drawer.data)}>
              模拟供应商确认（承诺交期）
            </Button>
          ) : null}
        </Space>
      ) : null}
    </Drawer>
    <Modal
      title="模拟供应商确认"
      open={Boolean(confirmOrder)}
      okText="确认并计入预期库存"
      cancelText="取消"
      confirmLoading={confirmPending}
      okButtonProps={{ disabled: !promisedDate }}
      onOk={() => void submitConfirm()}
      onCancel={() => setConfirmOrder(null)}
    >
      {confirmOrder ? (
        <Space direction="vertical" size={12} className="page-stack">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="采购单">{confirmOrder.purchase_order_no}</Descriptions.Item>
            <Descriptions.Item label="供应商">{confirmOrder.supplier_name}</Descriptions.Item>
            <Descriptions.Item label="状态"><StatusTag value={confirmOrder.status} /></Descriptions.Item>
          </Descriptions>
          <div className="page-hint">选择供应商承诺交期；确认后采购单进入追踪状态，并按交期增加预期库存（open PO 供应）。</div>
          <DatePicker
            format="YYYY-MM-DD"
            style={{ width: '100%' }}
            placeholder="选择承诺交期"
            disabledDate={(current) => current && current.valueOf() < Date.now() - 86_400_000}
            onChange={(_, dateString) => setPromisedDate(String(dateString || ''))}
          />
        </Space>
      ) : null}
    </Modal>
    </>
  );
}
