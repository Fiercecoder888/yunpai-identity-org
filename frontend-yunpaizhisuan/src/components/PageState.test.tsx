import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../tests/testUtils';
import { PageState } from './PageState';

describe('PageState', () => {
  it('renders a friendly error card with a retry button when onRetry is provided', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithApp(
      <PageState error={new Error('boom')} onRetry={onRetry}>
        content
      </PageState>,
    );

    expect(screen.getByText('数据加载失败')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重试/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the friendly error card without a retry button when onRetry is absent', () => {
    renderWithApp(<PageState error={new Error('boom')}>content</PageState>);

    expect(screen.getByText('数据加载失败')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument();
  });

  it('renders children when there is no loading, error or empty state', () => {
    renderWithApp(<PageState>content</PageState>);

    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders the empty placeholder when empty is set', () => {
    renderWithApp(<PageState empty>content</PageState>);

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });
});
