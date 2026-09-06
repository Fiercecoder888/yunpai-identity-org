import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../todos/todoAggregation';
import { bridgeTodoItems } from './todoBridge';

const makeTodo = (id: string, overrides?: Partial<TodoItem>): TodoItem => ({
  id,
  source: 'm1',
  kind: 'review_pending',
  title: `待办 ${id}`,
  detail: `明细 ${id}`,
  severity: 'high',
  count: 1,
  link: '/modules/m0-review',
  ...overrides,
});

describe('bridgeTodoItems', () => {
  it('maps todo source fields onto notification fields', () => {
    const [notification] = bridgeTodoItems([
      makeTodo('m1-review', { severity: 'high', kind: 'review_pending', link: '/modules/m0-review' }),
    ]);
    expect(notification).toBeDefined();

    expect(notification!).toMatchObject({
      id: 'todo-m1-review',
      type: 'review_pending',
      title: '待办 m1-review',
      detail: '明细 m1-review',
      severity: 'high',
      link: '/modules/m0-review',
      source: 'todo',
    });
    expect(notification!.createdAt).toBeDefined();
  });

  it('maps low and medium severity onto notifications', () => {
    const items = bridgeTodoItems([
      makeTodo('low', { severity: 'low' }),
      makeTodo('medium', { severity: 'medium' }),
    ]);

    expect(items.map((item) => item.severity)).toEqual(['low', 'medium']);
  });

  it('dedupes duplicate todo ids', () => {
    const items = bridgeTodoItems([makeTodo('a'), makeTodo('a')]);

    expect(items).toHaveLength(1);
  });

  it('returns an empty list for no todos', () => {
    expect(bridgeTodoItems([])).toEqual([]);
  });
});
