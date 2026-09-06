import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MiniSparkline } from './MiniSparkline';

describe('MiniSparkline', () => {
  it('renders an SVG polyline from the values', () => {
    const { container } = render(<MiniSparkline values={[1, 3, 2, 5, 4]} label="订单趋势" />);
    const svg = container.querySelector('svg.yp-sparkline');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('polyline')).not.toBeNull();
    expect(screen.getByRole('img', { name: '订单趋势' })).toBeInTheDocument();
  });

  it('renders an area polygon for multiple points', () => {
    const { container } = render(<MiniSparkline values={[1, 3, 2, 5, 4]} />);
    expect(container.querySelector('polygon')).not.toBeNull();
  });

  it('renders nothing for an empty value list', () => {
    const { container } = render(<MiniSparkline values={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('handles a single value without crashing', () => {
    const { container } = render(<MiniSparkline values={[5]} />);
    expect(container.querySelector('svg.yp-sparkline')).not.toBeNull();
    expect(container.querySelector('polyline')).not.toBeNull();
  });
});
