import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuthStore } from '../../auth/useAuthStore';
import { getM1ReviewItems } from '../../services/m1Api';
import { listPersistedM3Plans } from '../../services/m3Api';
import { listM4Alerts } from '../../services/m4Api';
import { getM5FlowDashboard } from '../../services/m5Api';
import type { PermissionCode } from '../../services/permissionApi';
import { aggregateTodoGroups, aggregateTodoItems, aggregateTodos, todoSourceCounts, todoTotal } from './todoAggregation';

const TODO_POLL_INTERVAL_MS = 30_000;

export const todoQueryKeys = {
  m1ReviewItems: ['todo', 'm1-review-items'] as const,
  m3Readiness: ['todo', 'm3-material-readiness'] as const,
  m4Alerts: ['todo', 'm4-alerts'] as const,
  m5Flows: ['todo', 'm5-flow-dashboard'] as const,
};

export function useTodoCenter(permissions?: PermissionCode[]) {
  const tenantId = useAuthStore((state) => state.me?.tenant?.id);
  const m1Query = useQuery({
    queryKey: todoQueryKeys.m1ReviewItems,
    queryFn: getM1ReviewItems,
    refetchInterval: TODO_POLL_INTERVAL_MS,
  });
  const m3Query = useQuery({
    queryKey: [...todoQueryKeys.m3Readiness, tenantId],
    queryFn: () => listPersistedM3Plans({ tenantId: tenantId ?? '', pageSize: 50 }),
    refetchInterval: TODO_POLL_INTERVAL_MS,
  });
  const m4Query = useQuery({
    queryKey: todoQueryKeys.m4Alerts,
    queryFn: () => listM4Alerts({ page: 1, pageSize: 100, status: 'open' }),
    refetchInterval: TODO_POLL_INTERVAL_MS,
  });
  const m5Query = useQuery({
    queryKey: todoQueryKeys.m5Flows,
    queryFn: () => getM5FlowDashboard({ limit: 50 }),
    refetchInterval: TODO_POLL_INTERVAL_MS,
  });

  const items = useMemo(
    () =>
      aggregateTodos({
        m1ReviewItems: m1Query.data ?? [],
        m3Plans: m3Query.data ?? [],
        m4Alerts: m4Query.data?.items ?? [],
        m5Flows: m5Query.data ?? [],
        permissions,
      }),
    [m1Query.data, m3Query.data, m4Query.data, m5Query.data, permissions],
  );

  const detailItems = useMemo(
    () =>
      aggregateTodoItems({
        m1ReviewItems: m1Query.data ?? [],
        m3Plans: m3Query.data ?? [],
        m4Alerts: m4Query.data?.items ?? [],
        m5Flows: m5Query.data ?? [],
        permissions,
      }),
    [m1Query.data, m3Query.data, m4Query.data, m5Query.data, permissions],
  );

  const groups = useMemo(() => aggregateTodoGroups(detailItems), [detailItems]);

  const loading =
    (m1Query.isLoading || m3Query.isLoading || m4Query.isLoading || m5Query.isLoading) && items.length === 0;
  const error = m1Query.error ?? m3Query.error ?? m4Query.error ?? m5Query.error;

  return {
    items,
    detailItems,
    groups,
    sourceCounts: todoSourceCounts(items),
    total: todoTotal(items),
    loading,
    error,
  };
}
