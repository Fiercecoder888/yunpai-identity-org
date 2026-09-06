import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { TaskBoardStatsRow } from './TaskBoardStatsRow';
import type { TaskItem } from '../../types/api';

const task = (id: string, status: TaskItem['status'], owner: string, riskLevel: TaskItem['riskLevel']): TaskItem => ({
  id,
  title: `任务 ${id}`,
  owner,
  status,
  riskLevel,
});

describe('TaskBoardStatsRow', () => {
  const tasks = [
    task('a', 'need_review', '工艺员', 'high'),
    task('b', 'running', '采购员', 'medium'),
    task('c', 'failed', '计划员', 'high'),
  ];

  it('shows total, pending-review, high-risk, and my-task counts', () => {
    renderWithApp(<TaskBoardStatsRow tasks={tasks} currentUser="采购员" />);

    expect(screen.getByTestId('task-board-stats-row')).toBeInTheDocument();
    expect(screen.getByText('任务总数')).toBeInTheDocument();
    expect(screen.getByText('待审核')).toBeInTheDocument();
    expect(screen.getByText('高风险')).toBeInTheDocument();
    expect(screen.getByText('我的任务')).toBeInTheDocument();
  });

  it('counts my tasks by the current user owner', () => {
    renderWithApp(<TaskBoardStatsRow tasks={tasks} currentUser="采购员" />);

    const cards = screen.getByTestId('task-board-stats-row');
    const values = cards.querySelectorAll('.ant-statistic-content-value');
    expect(values[0]?.textContent).toBe('3');
    expect(values[1]?.textContent).toBe('1');
    expect(values[2]?.textContent).toBe('2');
    expect(values[3]?.textContent).toBe('1');
  });

  it('reports zero my tasks when no current user matches', () => {
    renderWithApp(<TaskBoardStatsRow tasks={tasks} currentUser="质检员" />);

    const cards = screen.getByTestId('task-board-stats-row');
    const values = cards.querySelectorAll('.ant-statistic-content-value');
    expect(values[3]?.textContent).toBe('0');
  });
});
