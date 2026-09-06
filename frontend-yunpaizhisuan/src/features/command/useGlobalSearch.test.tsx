import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../mocks/server';
import { renderWithApp } from '../../tests/testUtils';
import { clearIndexCache } from './searchIndex';
import { useGlobalSearch } from './useGlobalSearch';

function Harness({ query }: { query: string }) {
  const { loading, error, groups, total } = useGlobalSearch(query);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{String(error)}</span>
      <span data-testid="total">{total}</span>
      {Object.entries(groups).map(([kind, items]) => (
        <div key={kind} data-testid={`group-${kind}`}>
          {items.map((item) => (
            <span key={item.id}>{item.label}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

const waitForGroups = async () => {
  await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'), { timeout: 5000 });
};

describe('useGlobalSearch', () => {
  beforeEach(() => {
    clearIndexCache();
  });

  it('debounces and groups results by entity type', async () => {
    const { rerender } = renderWithApp(<Harness query="" />);
    expect(screen.getByTestId('total').textContent).toBe('0');

    rerender(<Harness query="MAT" />);

    await waitForGroups();
    expect(Number(screen.getByTestId('total').textContent)).toBeGreaterThan(0);
    expect(screen.getByTestId('group-material').children.length).toBeGreaterThan(0);

    rerender(<Harness query="华南电子" />);
    await waitForGroups();
    expect(screen.getByTestId('group-supplier').children.length).toBeGreaterThan(0);
  });

  it('keeps an empty result for a blank query', async () => {
    renderWithApp(<Harness query="" />);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('total').textContent).toBe('0');
  });

  it('reuses the cached index within five minutes and does not refetch', async () => {
    let flowCalls = 0;
    server.use(
      http.get('/api/m5/ops/flow-dashboard', () => {
        flowCalls += 1;
        return HttpResponse.json({
          success: true,
          data: [],
          errors: [],
          trace_id: 'search-cache-trace',
        });
      }),
    );

    const { rerender } = renderWithApp(<Harness query="SO" />);
    await waitForGroups();

    const callsAfterFirst = flowCalls;
    expect(callsAfterFirst).toBe(1);

    rerender(<Harness query="轴承" />);
    await waitForGroups();
    expect(flowCalls).toBe(callsAfterFirst);
  });

  it('tolerates a failing source without blocking the others', async () => {
    server.use(http.get('/api/m4/suppliers', () => HttpResponse.json({ message: 'down' }, { status: 500 })));

    const { rerender } = renderWithApp(<Harness query="" />);
    rerender(<Harness query="MAT" />);

    await waitForGroups();
    expect(screen.getByTestId('group-supplier').children.length).toBe(0);
    expect(screen.getByTestId('group-material').children.length).toBeGreaterThan(0);
    expect(Number(screen.getByTestId('total').textContent)).toBeGreaterThan(0);
  });

  it('does not query order-scoped M3 readiness without an order', async () => {
    let readinessCalls = 0;
    server.use(
      http.get('/api/m3/material-readiness', () => {
        readinessCalls += 1;
        return HttpResponse.json({ success: true, data: { lines: [] }, errors: [] });
      }),
    );

    renderWithApp(<Harness query="MAT" />);

    await waitForGroups();
    expect(readinessCalls).toBe(0);
  });
});
