import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTableSearch, type TableSearchParamsIO } from './useTableSearch';

const createIo = (initial: Record<string, string> = {}) => {
  let params = new URLSearchParams(initial);
  const io: TableSearchParamsIO = {
    read: vi.fn(() => new URLSearchParams(params)),
    write: vi.fn((next: URLSearchParams) => {
      params = next;
    }),
  };
  return { io, getParams: () => new URLSearchParams(params) };
};

describe('useTableSearch', () => {
  it('initializes filters and page from URL search params', () => {
    const { io } = createIo({ keyword: '轴承', page: '3' });
    const { result } = renderHook(() =>
      useTableSearch({
        defaultFilters: { keyword: '', status: '' },
        pageSize: 10,
        paramsIO: io,
      }),
    );

    expect(result.current.filters).toEqual({ keyword: '轴承', status: '' });
    expect(result.current.page).toBe(3);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('applies filters by writing params and resetting the page to 1', () => {
    const { io, getParams } = createIo({ page: '2' });
    const { result } = renderHook(() =>
      useTableSearch({
        defaultFilters: { keyword: '', status: '' },
        pageSize: 10,
        paramsIO: io,
      }),
    );

    act(() => {
      result.current.applyFilters({ keyword: '传感器', status: 'open' });
    });

    expect(result.current.page).toBe(1);
    expect(result.current.filters).toEqual({ keyword: '传感器', status: 'open' });
    const params = getParams();
    expect(params.get('keyword')).toBe('传感器');
    expect(params.get('status')).toBe('open');
    expect(params.has('page')).toBe(false);
  });

  it('drops empty filter values when writing params', () => {
    const { io, getParams } = createIo();
    const { result } = renderHook(() =>
      useTableSearch({
        defaultFilters: { keyword: '' },
        pageSize: 10,
        paramsIO: io,
      }),
    );

    act(() => {
      result.current.applyFilters({ keyword: '' });
    });

    expect(getParams().has('keyword')).toBe(false);
  });

  it('links page changes into the URL and toPageParams', () => {
    const { io, getParams } = createIo();
    const { result } = renderHook(() =>
      useTableSearch({
        defaultFilters: { keyword: '' },
        pageSize: 25,
        paramsIO: io,
      }),
    );

    act(() => {
      result.current.setPage(2);
    });

    expect(result.current.page).toBe(2);
    expect(getParams().get('page')).toBe('2');
    expect(result.current.toPageParams()).toEqual({ page: 2, page_size: 25 });
  });

  it('resets filters and page', () => {
    const { io, getParams } = createIo({ keyword: '轴承', page: '2' });
    const { result } = renderHook(() =>
      useTableSearch({
        defaultFilters: { keyword: '', status: '' },
        pageSize: 10,
        paramsIO: io,
      }),
    );

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.filters).toEqual({ keyword: '', status: '' });
    expect(result.current.page).toBe(1);
    expect(result.current.hasActiveFilters).toBe(false);
    expect(getParams().has('keyword')).toBe(false);
    expect(getParams().has('page')).toBe(false);
  });

  it('supports custom deserialization of URL params', () => {
    const { io } = createIo({ status: 'processing' });
    const { result } = renderHook(() =>
      useTableSearch({
        defaultFilters: { status: '' },
        pageSize: 10,
        paramsIO: io,
        deserialize: (params) => ({ status: params.get('status') ?? '' }),
      }),
    );

    expect(result.current.filters.status).toBe('processing');
  });
});
