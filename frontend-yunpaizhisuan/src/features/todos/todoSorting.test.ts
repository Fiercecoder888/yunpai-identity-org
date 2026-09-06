import { describe, expect, it } from 'vitest';
import type { TodoItem } from './todoAggregation';
import { sortTodos } from './todoSorting';

const item = (overrides: Partial<TodoItem>): TodoItem => ({
  id: `todo-${overrides.id ?? 'x'}`,
  source: 'm4',
  kind: 'alert_overdue',
  title: 'M4 逾期预警',
  link: '/modules/purchase-warnings',
  severity: 'high',
  count: 1,
  ...overrides,
});

describe('sortTodos', () => {
  const items: TodoItem[] = [
    item({ id: 'low', severity: 'low', source: 'm5', dueAt: '2026-08-10T00:00:00Z' }),
    item({ id: 'high', severity: 'high', source: 'm1', dueAt: '2026-08-12T00:00:00Z' }),
    item({ id: 'medium', severity: 'medium', source: 'm3', dueAt: '2026-08-08T00:00:00Z' }),
    item({ id: 'nodue', severity: 'high', source: 'm4', dueAt: undefined }),
  ];

  it('sorts by severity by default', () => {
    expect(sortTodos(items).map((item) => item.id)).toEqual(['high', 'nodue', 'medium', 'low']);
  });

  it('sorts by dueAt putting items without a due date last', () => {
    expect(sortTodos(items, 'dueAt').map((item) => item.id)).toEqual(['medium', 'low', 'high', 'nodue']);
  });

  it('treats the 1970 epoch timestamp as no due date', () => {
    const epoch = item({ id: 'epoch', severity: 'high', dueAt: '1970-01-01T00:00:00Z' });
    const dated = [
      item({ id: 'low', severity: 'low', dueAt: '2026-08-10T00:00:00Z' }),
      item({ id: 'high', severity: 'high', dueAt: '2026-08-12T00:00:00Z' }),
      item({ id: 'medium', severity: 'medium', dueAt: '2026-08-08T00:00:00Z' }),
    ];
    const result = sortTodos([epoch, ...dated], 'dueAt');

    expect(result.map((item) => item.id)).toEqual(['medium', 'low', 'high', 'epoch']);
  });

  it('sorts by source order m1/m3/m4/m5', () => {
    const result = sortTodos(items, 'source');
    const ids = result.map((item) => item.id);
    expect(ids).toEqual(['high', 'medium', 'nodue', 'low']);
  });

  it('does not mutate the input array', () => {
    const input = [...items];
    sortTodos(input, 'severity');
    expect(input.map((item) => item.id)).toEqual(['low', 'high', 'medium', 'nodue']);
  });
});
