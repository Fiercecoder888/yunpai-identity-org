import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressCell } from './ProgressCell';

describe('ProgressCell', () => {
  it('renders the clamped percent and suffix', () => {
    render(<ProgressCell percent={42} suffix="分钟" />);
    expect(screen.getByText('42% 分钟')).toBeInTheDocument();
  });

  it('clamps out-of-range percentages', () => {
    const { rerender } = render(<ProgressCell percent={120} />);
    expect(screen.getByText('100%')).toBeInTheDocument();

    rerender(<ProgressCell percent={-5} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders a fill bar sized to the percent', () => {
    const { container } = render(<ProgressCell percent={50} />);
    const fill = container.querySelector('.progress-cell-fill');
    expect(fill).not.toBeNull();
    expect((fill as HTMLElement).style.width).toBe('50%');
  });
});
