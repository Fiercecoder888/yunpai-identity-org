import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { WorkbenchBell } from './WorkbenchBell';
import { useNotificationStore, type AppNotification } from './useNotificationStore';

const makeItem = (id: string, overrides?: Partial<AppNotification>): AppNotification => ({
  id,
  type: 'test',
  title: `通知 ${id}`,
  severity: 'info',
  source: 'system',
  createdAt: '2026-08-10T00:00:00.000Z',
  ...overrides,
});

const renderBell = () =>
  renderWithApp(
    <MemoryRouter initialEntries={['/']}>
      <WorkbenchBell />
    </MemoryRouter>,
  );

describe('WorkbenchBell', () => {
  beforeEach(() => {
    useNotificationStore.getState().resetNotifications();
  });

  it('renders the notification button with the seeded unread badge', () => {
    useNotificationStore.getState().mergeItems([makeItem('n1')]);
    const { container } = renderBell();

    expect(screen.getByRole('button', { name: '通知中心' })).toBeInTheDocument();
    expect(container.querySelector('.ant-badge-count')?.textContent).toBe('1');
  });

  it('opens the notification drawer on click', async () => {
    renderBell();

    await userEvent.click(screen.getByRole('button', { name: '通知中心' }));
    expect(await screen.findByText('通知中心')).toBeInTheDocument();
  });

  it('merges notifications fetched from the polling mock on mount', async () => {
    renderBell();

    await waitFor(() => {
      expect(useNotificationStore.getState().items.length).toBeGreaterThanOrEqual(3);
    });
  });
});
