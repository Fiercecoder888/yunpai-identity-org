import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { getBusinessFinishedGoods } from '../../services/businessTraceApi';
import { getDashboardSummary } from '../../services/dashboardApi';
import { getM3MaterialReadiness } from '../../services/m3Api';
import { listM4Alerts, listM4Tracking } from '../../services/m4Api';
import { getM5FlowDashboard } from '../../services/m5Api';
import type { M3MaterialReadinessLine } from '../../schemas/m3';
import type { M4Alert, M4Tracking } from '../../schemas/m4';
import type { M5FlowDashboardItem } from '../../schemas/m5';
import type { JsonRecord } from '../../services/businessTraceApi';
import type { DashboardSummary } from '../../types/api';
import { buildKpiRow, buildRiskBuckets, type DashboardKpiCard, type RiskBucket } from './dashboardKpis';

export type DashboardQueryKey =
  | 'summary'
  | 'm4-tracking'
  | 'm4-alerts'
  | 'm3-readiness'
  | 'm5-flow-dashboard'
  | 'finished-goods';

export type DashboardChartSources = {
  flow: M5FlowDashboardItem[];
  trackingItems: M4Tracking[];
  alertItems: M4Alert[];
  readinessLines: M3MaterialReadinessLine[];
  finished?: JsonRecord;
};

export const dashboardQueryKeys = {
  summary: ['dashboard', 'summary'],
  'm4-tracking': ['dashboard', 'kpi', 'm4-tracking'],
  'm4-alerts': ['dashboard', 'kpi', 'm4-alerts'],
  'm3-readiness': ['dashboard', 'kpi', 'm3-readiness'],
  'm5-flow-dashboard': ['dashboard', 'kpi', 'm5-flow-dashboard'],
  'finished-goods': ['dashboard', 'kpi', 'finished-goods'],
} satisfies Record<DashboardQueryKey, readonly string[]>;

const kpiSourceKey: Record<string, DashboardQueryKey> = {
  orders: 'm5-flow-dashboard',
  onTime: 'm4-tracking',
  shortage: 'm3-readiness',
  overdueAmount: 'm4-tracking',
  wip: 'm5-flow-dashboard',
  yield: 'finished-goods',
};

export type DashboardKpiData = {
  kpis: DashboardKpiCard[];
  buckets: RiskBucket[];
  loading: boolean;
  summary: DashboardSummary | undefined;
  summaryLoading: boolean;
  summaryError: Error | null;
  refresh: () => void;
  refreshKey: (key: DashboardQueryKey) => void;
  sources: DashboardChartSources;
};

export function useDashboardKpis(orderId?: string): DashboardKpiData {
  const queryClient = useQueryClient();
  const readinessOrderId = orderId?.trim() ?? '';
  const trackingQuery = useQuery({
    queryKey: dashboardQueryKeys['m4-tracking'],
    queryFn: () => listM4Tracking(),
    retry: false,
    staleTime: 30_000,
  });
  const alertsQuery = useQuery({
    queryKey: dashboardQueryKeys['m4-alerts'],
    queryFn: () => listM4Alerts(),
    retry: false,
    staleTime: 30_000,
  });
  const readinessQuery = useQuery({
    queryKey: [...dashboardQueryKeys['m3-readiness'], readinessOrderId || 'no-order'],
    queryFn: () => getM3MaterialReadiness(readinessOrderId),
    enabled: Boolean(readinessOrderId),
    retry: false,
    staleTime: 60_000,
  });
  const flowQuery = useQuery({
    queryKey: dashboardQueryKeys['m5-flow-dashboard'],
    queryFn: () => getM5FlowDashboard(),
    retry: false,
    staleTime: 60_000,
  });
  const finishedGoodsQuery = useQuery({
    queryKey: dashboardQueryKeys['finished-goods'],
    queryFn: () => getBusinessFinishedGoods(),
    retry: false,
    staleTime: 60_000,
  });
  const summaryQuery = useQuery({
    queryKey: dashboardQueryKeys.summary,
    queryFn: getDashboardSummary,
    retry: false,
    staleTime: 15_000,
  });

  const refreshKey = useCallback(
    (key: DashboardQueryKey) => {
      void queryClient.refetchQueries({ queryKey: dashboardQueryKeys[key] });
    },
    [queryClient],
  );

  const refresh = useCallback(() => {
    for (const key of Object.keys(dashboardQueryKeys) as DashboardQueryKey[]) {
      void queryClient.refetchQueries({ queryKey: dashboardQueryKeys[key] });
    }
  }, [queryClient]);

  const loading =
    trackingQuery.isLoading ||
    alertsQuery.isLoading ||
    readinessQuery.isLoading ||
    flowQuery.isLoading ||
    finishedGoodsQuery.isLoading ||
    summaryQuery.isLoading;

  const data = useMemo(
    () => {
      const kpis = buildKpiRow({
        trackingItems: trackingQuery.data?.items ?? [],
        trackingError: trackingQuery.isError,
        alertItems: alertsQuery.data?.items ?? [],
        readinessLines: readinessQuery.data?.lines ?? [],
        readinessError: readinessQuery.isError,
        readinessAvailable: Boolean(readinessOrderId),
        flow: flowQuery.data ?? [],
        flowError: flowQuery.isError,
        finished: finishedGoodsQuery.data,
        finishedError: finishedGoodsQuery.isError,
        loading,
      });
      const buckets = buildRiskBuckets({
        alertItems: alertsQuery.data?.items ?? [],
        readinessLines: readinessQuery.data?.lines ?? [],
        flow: flowQuery.data ?? [],
        dashboardRisks: summaryQuery.data?.risks ?? [],
        healthyModuleCount:
          summaryQuery.data?.modules.filter((module) => module.status === 'normal').length ?? 0,
      });
      return {
        kpis: kpis.map((card) =>
          card.status === 'error' ? { ...card, onRetry: () => refreshKey(kpiSourceKey[card.key] ?? 'summary') } : card,
        ),
        buckets,
      };
    },
    // loading 为各查询 isLoading 的派生值，其翻转必然伴随 data/isError 变化
    // 触发重算，故不加入依赖；error 优先级状态在卡内保留。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      trackingQuery.data,
      trackingQuery.isError,
      alertsQuery.data,
      readinessQuery.data,
      readinessQuery.isError,
      readinessOrderId,
      flowQuery.data,
      flowQuery.isError,
      finishedGoodsQuery.data,
      finishedGoodsQuery.isError,
      summaryQuery.data,
      refreshKey,
    ],
  );

  return {
    kpis: data.kpis,
    buckets: data.buckets,
    loading,
    summary: summaryQuery.data,
    summaryLoading: summaryQuery.isLoading,
    summaryError: summaryQuery.error ?? null,
    refresh,
    refreshKey,
    sources: {
      flow: flowQuery.data ?? [],
      trackingItems: trackingQuery.data?.items ?? [],
      alertItems: alertsQuery.data?.items ?? [],
      readinessLines: readinessQuery.data?.lines ?? [],
      finished: finishedGoodsQuery.data,
    },
  };
}
