import { create } from 'zustand';
import type {
  BusinessFlowRun,
  BusinessFlowRunProgress,
  BusinessOrderTrace,
} from '../../services/businessFlowRunApi';

export type BusinessRunMeta = {
  orderId?: string;
  productName?: string;
  orderQty?: number;
  unit?: string;
  dueDate?: string;
  mode?: 'real' | 'pressure_only';
};

type BusinessRunState = {
  active: boolean;
  running: boolean;
  m5FixtureLoaded: boolean;
  meta: BusinessRunMeta;
  conversationId?: string;
  selectedCatalogId?: string;
  taskId?: string;
  runId?: string;
  phase?: BusinessFlowRunProgress['phase'];
  title?: string;
  detail?: string;
  error?: string;
  missing?: BusinessFlowRunProgress['missing'];
  missingDocuments?: BusinessFlowRunProgress['missingDocuments'];
  gate?: BusinessFlowRunProgress['gate'];
  run?: BusinessFlowRun;
  trace?: BusinessOrderTrace;
  begin: (meta: BusinessRunMeta, conversationId?: string) => void;
  update: (progress: BusinessFlowRunProgress) => void;
  preview: (trace: BusinessOrderTrace, meta?: BusinessRunMeta, run?: BusinessFlowRun, conversationId?: string) => void;
  setSelectedCatalogId: (catalogId?: string) => void;
  markM5FixtureLoaded: () => void;
  reset: () => void;
};

const terminalPhases = new Set<BusinessFlowRunProgress['phase']>(['done', 'failed']);

export const useBusinessRunStore = create<BusinessRunState>((set) => ({
  active: false,
  running: false,
  m5FixtureLoaded: false,
  meta: {},
  begin: (meta, conversationId) =>
    set({
      active: true,
      running: true,
      m5FixtureLoaded: false,
      meta,
      conversationId,
      // 新一次运行必须清空上一次运行/预览的残留，避免旧订单的 trace 继续显示。
      phase: undefined,
      title: undefined,
      detail: undefined,
      error: undefined,
      missing: undefined,
      missingDocuments: undefined,
      gate: undefined,
      taskId: undefined,
      runId: undefined,
      run: undefined,
      trace: undefined,
    }),
  update: (progress) =>
    set((state) => ({
      active: true,
      running:
        !terminalPhases.has(progress.phase) &&
        progress.phase !== 'human_input_required' &&
        progress.phase !== 'blocked' &&
        progress.phase !== 'data_incomplete',
      phase: progress.phase,
      title: progress.title,
      detail: progress.detail,
      error: progress.error,
      missing: progress.missing,
      missingDocuments: progress.missingDocuments,
      gate: progress.gate,
      taskId: progress.trackingTaskId ?? state.taskId,
      runId: progress.runId ?? state.runId,
      run: progress.run ?? state.run,
      trace: progress.trace ?? state.trace,
      meta: progress.trace?.order
        ? {
            ...state.meta,
            orderId: String(progress.trace.order.order_id ?? state.meta.orderId ?? ''),
            productName: String(progress.trace.order.product_name ?? state.meta.productName ?? ''),
            orderQty: Number(progress.trace.order.order_qty ?? state.meta.orderQty ?? 0) || undefined,
            dueDate: String(progress.trace.order.due_date ?? state.meta.dueDate ?? '') || undefined,
          }
        : state.meta,
    })),
  preview: (trace, meta, run, conversationId) =>
    set((state) => ({
      active: true,
      running: false,
      phase: undefined,
      title: '订单链路预览',
      detail: `订单 ${String(trace.order?.order_id ?? '')} 的历史业务数据（只读）`,
      trace,
      run: run ?? state.run,
      conversationId: conversationId ?? state.conversationId,
      meta: {
        ...state.meta,
        ...meta,
        orderId: String(trace.order?.order_id ?? meta?.orderId ?? ''),
        productName: String(trace.order?.product_name ?? meta?.productName ?? ''),
      },
    })),
  setSelectedCatalogId: (selectedCatalogId) => set({ selectedCatalogId }),
  markM5FixtureLoaded: () => set({ m5FixtureLoaded: true }),
  reset: () =>
    set({
      active: false,
      running: false,
      m5FixtureLoaded: false,
      meta: {},
      taskId: undefined,
      runId: undefined,
      phase: undefined,
      title: undefined,
      detail: undefined,
      error: undefined,
      missing: undefined,
      missingDocuments: undefined,
      gate: undefined,
      run: undefined,
      trace: undefined,
      conversationId: undefined,
    }),
}));
