import { describe, expect, it } from 'vitest';
import { groupTasksBy, TASK_STATUS_LABEL, TASK_STATUS_ORDER } from './groupTasksBy';
import type { TaskItem } from '../../types/api';

const task = (id: string, status: TaskItem['status'], owner: string): TaskItem => ({
  id,
  title: `任务 ${id}`,
  owner,
  status,
  riskLevel: 'low',
});

describe('groupTasksBy', () => {
  it('groups tasks by status in a stable canonical column order', () => {
    const tasks = [
      task('a', 'running', '工艺员'),
      task('b', 'need_review', '计划员'),
      task('c', 'completed', '采购员'),
      task('d', 'running', '采购员'),
    ];

    const groups = groupTasksBy(tasks, 'status');

    expect(groups.map((group) => group.key)).toEqual(TASK_STATUS_ORDER);
    expect(groups.map((group) => group.label)).toEqual(TASK_STATUS_ORDER.map((status) => TASK_STATUS_LABEL[status]));
    expect(groups.map((group) => group.tasks.length)).toEqual([1, 0, 2, 1, 0, 0]);
    expect(groups[0]?.tasks.map((item) => item.id)).toEqual(['b']);
    expect(groups[2]?.tasks.map((item) => item.id)).toEqual(['a', 'd']);
  });

  it('keeps empty status columns so the board is stable', () => {
    const groups = groupTasksBy([], 'status');
    expect(groups).toHaveLength(TASK_STATUS_ORDER.length);
    expect(groups.every((group) => group.tasks.length === 0)).toBe(true);
  });

  it('accepts a custom order override', () => {
    const tasks = [task('a', 'failed', '工艺员'), task('b', 'running', '工艺员')];
    const groups = groupTasksBy(tasks, 'status', ['failed', 'running']);
    expect(groups.map((group) => group.key)).toEqual(['failed', 'running']);
  });

  it('groups tasks by owner preserving first-appearance order', () => {
    const tasks = [
      task('a', 'running', '采购员'),
      task('b', 'need_review', '工艺员'),
      task('c', 'completed', '采购员'),
      task('d', 'failed', '计划员'),
    ];

    const groups = groupTasksBy(tasks, 'owner');

    expect(groups.map((group) => group.key)).toEqual(['采购员', '工艺员', '计划员']);
    expect(groups[0]?.tasks.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('groups by owner with an explicit order', () => {
    const tasks = [task('a', 'running', '计划员'), task('b', 'running', '工艺员')];
    const groups = groupTasksBy(tasks, 'owner', ['工艺员', '计划员']);
    expect(groups.map((group) => group.key)).toEqual(['工艺员', '计划员']);
  });

  it('returns no owner columns for an empty task list', () => {
    expect(groupTasksBy([], 'owner')).toEqual([]);
  });
});
