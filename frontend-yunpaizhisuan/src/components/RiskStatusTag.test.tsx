import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskStatusTag } from './RiskStatusTag';

describe('RiskStatusTag', () => {
  it('renders risk and status labels as two colored segments', () => {
    render(<RiskStatusTag risk="high" status="need_review" />);

    const tag = screen.getByTestId('risk-status-tag');
    expect(tag).toHaveTextContent('高风险');
    expect(tag).toHaveTextContent('待审核');
    expect(tag.querySelectorAll('.risk-status-tag-segment')).toHaveLength(2);
  });

  it('falls back to raw values for unknown risk and status', () => {
    render(<RiskStatusTag risk="critical" status="unknown" />);

    const tag = screen.getByTestId('risk-status-tag');
    expect(tag).toHaveTextContent('critical');
    expect(tag).toHaveTextContent('unknown');
  });
});
