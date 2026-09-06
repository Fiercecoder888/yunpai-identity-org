import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageProgressBar } from './StageProgressBar';
import type { M5FlowStage } from '../../schemas/m5';

const stages = [
  { key: 'input', label: '输入持久化', status: 'succeeded', completed: 1, total: 1, message: 'ok' },
  { key: 'scheduling', label: '排程生成', status: 'running', completed: 2, total: 4, message: 'busy' },
  { key: 'execution', label: '执行回传', status: 'blocked', completed: 0, total: 2, message: 'stuck' },
  { key: 'approval', label: '计划审批', status: 'not_started', completed: 0, total: 0, message: 'idle' },
] as M5FlowStage[];

describe('StageProgressBar', () => {
  it('renders one colored segment per stage with completed/total in the aria label', () => {
    render(<StageProgressBar stages={stages} />);

    const bar = screen.getByRole('img', { name: /进度阶段/ });
    expect(bar.textContent).toBe('');
    expect(bar).toHaveAccessibleName(/输入持久化 1\/1/);
    expect(bar).toHaveAccessibleName(/排程生成 2\/4/);
    expect(bar).toHaveAccessibleName(/执行回传 0\/2/);
    expect(bar.querySelectorAll('.stage-progress-segment')).toHaveLength(4);
  });

  it('renders a placeholder when there are no stages', () => {
    render(<StageProgressBar stages={[]} />);

    expect(screen.getByRole('img', { name: '进度阶段：无' })).toBeInTheDocument();
  });
});
