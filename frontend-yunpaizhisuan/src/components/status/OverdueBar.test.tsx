import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverdueBar } from './OverdueBar';

describe('OverdueBar', () => {
  it('renders the day count with the default test id', () => {
    render(<OverdueBar days={4} />);
    expect(screen.getByTestId('overdue-bar')).toBeInTheDocument();
    expect(screen.getByText('4 天')).toBeInTheDocument();
  });

  it('classifies by overdue level', () => {
    const { rerender } = render(<OverdueBar days={4} />);
    expect(screen.getByTestId('overdue-bar')).toHaveClass('is-warning');

    rerender(<OverdueBar days={12} />);
    expect(screen.getByTestId('overdue-bar')).toHaveClass('is-risk');

    rerender(<OverdueBar days={0} />);
    expect(screen.getByTestId('overdue-bar')).toHaveClass('is-ok');
  });

  it('suppresses the day label when requested', () => {
    render(<OverdueBar days={3} showDays={false} />);
    expect(screen.getByTestId('overdue-bar')).toBeInTheDocument();
    expect(screen.queryByText('3 天')).not.toBeInTheDocument();
  });
});
