import { useCallback, useMemo, useState } from 'react';

export type SearchFilters = Record<string, string | undefined>;

export type TableSearchParamsIO = {
  read: () => URLSearchParams;
  write: (params: URLSearchParams) => void;
};

const defaultParamsIO = (): TableSearchParamsIO => ({
  read: () => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)),
  write: (params) => {
    if (typeof window === 'undefined') {
      return;
    }
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  },
});

type UseTableSearchOptions<TFilters extends SearchFilters> = {
  defaultFilters: TFilters;
  pageSize?: number;
  pageKey?: string;
  paramsIO?: TableSearchParamsIO;
  deserialize?: (params: URLSearchParams) => TFilters;
};

export type UseTableSearchResult<TFilters extends SearchFilters> = {
  filters: TFilters;
  page: number;
  pageSize: number;
  hasActiveFilters: boolean;
  applyFilters: (filters: TFilters) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  toPageParams: () => { page: number; page_size: number };
};

export function useTableSearch<TFilters extends SearchFilters>(options: UseTableSearchOptions<TFilters>): UseTableSearchResult<TFilters> {
  const {
    defaultFilters,
    pageSize = 10,
    pageKey = 'page',
    paramsIO = defaultParamsIO(),
    deserialize,
  } = options;

  const readFilters = useCallback(
    (): TFilters => {
      const params = paramsIO.read();
      if (deserialize) {
        return deserialize(params);
      }
      const result: SearchFilters = {};
      params.forEach((value, key) => {
        if (key !== pageKey) {
          result[key] = value;
        }
      });
      return result as TFilters;
    },
    [deserialize, pageKey, paramsIO],
  );

  const [filters, setFilters] = useState<TFilters>(() => ({ ...defaultFilters, ...readFilters() }));
  const [page, setPageState] = useState<number>(() => {
    const raw = paramsIO.read().get(pageKey);
    const parsed = raw ? Number(raw) : 1;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  });

  const hasActiveFilters = useMemo(() => Object.values(filters).some((value) => Boolean(value)), [filters]);

  const writeParams = useCallback(
    (nextFilters: TFilters, nextPage: number) => {
      const params = new URLSearchParams();
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          params.set(key, value);
        }
      });
      if (nextPage > 1) {
        params.set(pageKey, String(nextPage));
      }
      paramsIO.write(params);
    },
    [pageKey, paramsIO],
  );

  const applyFilters = useCallback(
    (nextFilters: TFilters) => {
      setFilters(nextFilters);
      setPageState(1);
      writeParams(nextFilters, 1);
    },
    [writeParams],
  );

  const resetFilters = useCallback(() => {
    setFilters({ ...defaultFilters });
    setPageState(1);
    writeParams({ ...defaultFilters }, 1);
  }, [defaultFilters, writeParams]);

  const setPage = useCallback(
    (nextPage: number) => {
      setPageState(nextPage);
      writeParams(filters, nextPage);
    },
    [filters, writeParams],
  );

  const toPageParams = useCallback(() => ({ page, page_size: pageSize }), [page, pageSize]);

  return { filters, page, pageSize, hasActiveFilters, applyFilters, resetFilters, setPage, toPageParams };
}
