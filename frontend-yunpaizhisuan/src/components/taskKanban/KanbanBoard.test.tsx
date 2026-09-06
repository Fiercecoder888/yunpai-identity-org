import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { KanbanBoard, TASK_DISPATCH_UNAVAILABLE_MESSAGE } from './KanbanBoard';
import { groupTasksBy } from './groupTasksBy';
import type { TaskItem } from '../../types/api';

const task = (id: string, status: TaskItem['status'], owner: string, riskLevel: TaskItem['riskLevel']): TaskItem => ({
  id,
  title: `任务 ${id}`,
  owner,
  status,
  riskLevel,
  updatedAt: '2026-06-26T09:20:00+08:00',
});

describe('KanbanBoard', () => {
  it('renders a stable column per status with a count in the header', () => {
    const tasks = [
      task('a', 'need_review', '工艺员', 'high'),
      task('b', 'running', '采购员', 'medium'),
      task('c', 'completed', '计划员', 'low'),
    ];
    const groups = groupTasksBy(tasks, 'status');

    renderWithApp(<KanbanBoard groups={groups} />);

    const board = screen.getByTestId('task-kanban');
    expect(within(board).getByText('待审核 (1)')).toBeInTheDocument();
    expect(within(board).getByText('进行中 (1)')).toBeInTheDocument();
    expect(within(board).getByText('已完成 (1)')).toBeInTheDocument();
    expect(within(board).getByText('待处理 (0)')).toBeInTheDocument();
    expect(screen.getAllByTestId('task-kanban-card')).toHaveLength(3);
  });

  it('renders a combined risk/status tag on every card', () => {
    const tasks = [task('a', 'need_review', '工艺员', 'high'), task('b', 'running', '采购员', 'medium')];
    renderWithApp(<KanbanBoard groups={groupTasksBy(tasks, 'status')} />);

    const tags = screen.getAllByTestId('risk-status-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]).toHaveTextContent('高风险');
    expect(tags[0]).toHaveTextContent('待审核');
  });

  it('shows a placeholder date instead of a 1970 timestamp', () => {
    const tasks = [{ ...task('a', 'running', '工艺员', 'low'), updatedAt: undefined }];
    renderWithApp(<KanbanBoard groups={groupTasksBy(tasks, 'status')} />);

    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('highlights cards owned by the current user', () => {
    const tasks = [task('a', 'running', '工艺员', 'low'), task('b', 'running', '采购员', 'low')];
    const { container } = renderWithApp(<KanbanBoard groups={groupTasksBy(tasks, 'status')} currentUser="工艺员" />);

    const cards = container.querySelectorAll('.task-kanban-card');
    expect(cards[0]?.classList.contains('task-kanban-card-mine')).toBe(true);
    expect(cards[1]?.classList.contains('task-kanban-card-mine')).toBe(false);
  });

  it('renders a disabled dispatch button with an unavailable tooltip', async () => {
    const tasks = [task('a', 'running', '工艺员', 'low')];
    const { container } = renderWithApp(<KanbanBoard groups={groupTasksBy(tasks, 'status')} />);

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('分派');
    expect(buttons[0]).toBeDisabled();

    const dispatchWrapper = container.querySelector('.task-kanban-card-dispatch');
    fireEvent.mouseOver(dispatchWrapper as HTMLElement);
    expect(await screen.findByText(TASK_DISPATCH_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });

  it('renders an empty state when every column has no tasks', () => {
    renderWithApp(<KanbanBoard groups={groupTasksBy([], 'status')} />);
    expect(screen.getByTestId('task-kanban-empty')).toBeInTheDocument();
  });
});
