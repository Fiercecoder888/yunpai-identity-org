import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JsonRecord } from '../../services/businessTraceApi';
import { getBusinessFinishedGoods } from '../../services/businessTraceApi';
import { listM4Suggestions, listM4Suppliers } from '../../services/m4Api';
import { getM5FlowDashboard } from '../../services/m5Api';
import { buildIndex, cacheIndex, getCachedIndex, searchIndex, type SearchEntry, type SearchEntityType } from './searchIndex';

export type GlobalSearchGroups = Record<SearchEntityType, SearchEntry[]>;

export type GlobalSearchResult = {
  loading: boolean;
  error: boolean;
  groups: GlobalSearchGroups;
  total: number;
  refresh: () => void;
};

export const GLOBAL_SEARCH_DEBOUNCE_MS = 300;

const EMPTY_GROUPS: GlobalSearchGroups = { order: [], material: [], supplier: [], operation: [] };

/**
 * 并发拉取订单/物料/供应商/工序索引（Promise.allSettled，单源失败不阻塞其余），
 * 构建结果缓存 5 分钟；查询经过 300ms debounce。
 */
export async function loadSearchEntries(): Promise<SearchEntry[]> {
  const [flow, suggestions, finishedGoods, suppliers] = await Promise.allSettled([
    getM5FlowDashboard(),
    listM4Suggestions(),
    getBusinessFinishedGoods(),
    listM4Suppliers(),
  ]);

  const entries: SearchEntry[] = [];

  if (flow.status === 'fulfilled') {
    for (const item of flow.value) {
      for (const order of item.input.orders) {
        entries.push({
          id: `order-${order.order_id}`,
          type: 'order',
          label: order.order_id,
          keywords: [order.order_id, order.product_id, order.priority ?? '', order.status ?? ''],
          hint: `产品 ${order.product_id} · ${order.quantity}${order.unit}`,
          path: '/modules/m5-flow',
          payload: { planVersion: item.plan_version },
        });
      }
      for (const operation of item.output.operations ?? []) {
        entries.push({
          id: `operation-${item.plan_version}-${operation.operation_id}`,
          type: 'operation',
          label: operation.operation_name,
          keywords: [operation.operation_name, operation.operation_id, operation.order_id, operation.resource_id],
          hint: `订单 ${operation.order_id} · 资源 ${operation.resource_id}`,
          path: '/modules/schedule',
          payload: { planVersion: item.plan_version },
        });
      }
    }
  }

  if (suggestions.status === 'fulfilled') {
    for (const suggestion of suggestions.value.items) {
      const code = suggestion.item_code ?? '';
      const name = suggestion.item_name ?? '';
      if (!code && !name) {
        continue;
      }
      entries.push({
        id: `material-m4-${suggestion.id ?? code ?? suggestion.row_number}`,
        type: 'material',
        label: name || code,
        keywords: [code, name, suggestion.supplier_name ?? ''],
        hint: `${suggestion.supplier_name ?? '未指定供应商'} · ${suggestion.quantity ?? ''}${suggestion.unit ?? ''}`,
        path: '/modules/purchase-warnings',
      });
    }
  }

  if (finishedGoods.status === 'fulfilled') {
    const items = Array.isArray(finishedGoods.value.items) ? (finishedGoods.value.items as JsonRecord[]) : [];
    for (const item of items) {
      const code = String(item.material_code ?? item.material_id ?? '');
      const name = String(item.material_name ?? '');
      if (!code && !name) {
        continue;
      }
      entries.push({
        id: `material-fg-${code || name}`,
        type: 'material',
        label: name || code,
        keywords: [code, name],
        hint: `成品 · 良品 ${item.good_total ?? 0}/${item.produced_total ?? 0}`,
        path: '/modules/finished-goods',
      });
    }
  }

  if (suppliers.status === 'fulfilled') {
    for (const supplier of suppliers.value.items) {
      entries.push({
        id: `supplier-${supplier.id}`,
        type: 'supplier',
        label: supplier.supplier_name,
        keywords: [supplier.supplier_name, supplier.contact_name ?? ''],
        hint: supplier.remark ?? undefined,
        path: '/modules/purchase-warnings',
      });
    }
  }

  return entries;
}

export function useGlobalSearch(query: string): GlobalSearchResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [groups, setGroups] = useState<GlobalSearchGroups>(EMPTY_GROUPS);
  const [total, setTotal] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const applySearch = useCallback((needle: string) => {
    const index = getCachedIndex();
    if (!index) {
      setGroups(EMPTY_GROUPS);
      setTotal(0);
      return;
    }
    const entries = searchIndex(index, needle);
    const next: GlobalSearchGroups = { order: [], material: [], supplier: [], operation: [] };
    for (const entry of entries) {
      next[entry.type].push(entry);
    }
    setGroups(next);
    setTotal(entries.length);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setLoading(false);
      setError(false);
      setGroups(EMPTY_GROUPS);
      setTotal(0);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      const index = getCachedIndex();
      if (index) {
        setError(false);
        setLoading(false);
        applySearch(trimmed);
        return;
      }
      void loadSearchEntries()
        .then((entries) => {
          cacheIndex(buildIndex(entries));
          setError(false);
          setLoading(false);
          applySearch(trimmed);
        })
        .catch(() => {
          setError(true);
          setLoading(false);
        });
    }, GLOBAL_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, refreshToken, applySearch]);

  return useMemo(
    () => ({ loading, error, groups, total, refresh: () => setRefreshToken((token) => token + 1) }),
    [loading, error, groups, total],
  );
}
