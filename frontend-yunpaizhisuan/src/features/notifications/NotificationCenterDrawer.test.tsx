import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { NotificationCenterDrawer } from './NotificationCenterDrawer';
import { useNotificationStore, type AppNotification } from './useNotificationStore';

const makeItem = (id: string, overrides?: Partial<AppNotification>): AppNotification => ({
  id,
  type: 'test',
  title: `通知标题 ${id}`,
  detail: `明细 ${id}`,
  severity: 'high',
  link: '/dashboard',
  source: 'system',
  createdAt: '2026-08-10T00:00:00.000Z',
  ...overrides,
});

const renderDrawer = (open = true) =>
  renderWithApp(
    <MemoryRouter initialEntries={['/']}>
      <NotificationCenterDrawer open={open} onClose={() => undefined} />
    </MemoryRouter>,
  );

describe('NotificationCenterDrawer', () => {
  beforeEach(() => {
    useNotificationStore.getState().resetNotifications();
  });

  it('renders the unread tab first and switches to the all tab', async () => {
    useNotificationStore.getState().mergeItems([
      makeItem('n1'),
      makeItem('n2', { createdAt: '2026-08-10T01:00:00.000Z' }),
    ]);
    useNotificationStore.getState().markRead('n2');
    renderDrawer();

    expect(await screen.findByText('通知标题 n1')).toBeInTheDocument();
    expect(screen.queryByText('通知标题 n2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '全部' }));
    expect(await screen.findByText('通知标题 n2')).toBeInTheDocument();
  });

  it('marks a single notification as read', async () => {
    useNotificationStore.getState().mergeItems([makeItem('n1')]);
    renderDrawer();

    const title = await screen.findByText('通知标题 n1');
    const listItem = title.closest('.ant-list-item') as HTMLElement;
    fireEvent.click(within(listItem).getAllByRole('button', { name: '标记已读' })[0]!);

    await waitFor(() => {
      expect(useNotificationStore.getState().readIds.has('n1')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText('通知标题 n1')).not.toBeInTheDocument();
    });
  });

  it('bridges todo items into the notification center', async () => {
    renderDrawer();

    expect(await screen.findByText(/M0 文档解析待确认/)).toBeInTheDocument();
    expect(useNotificationStore.getState().items.some((item) => item.source === 'todo')).toBe(true);
  });

  it('marks everything read from the drawer header action', async () => {
    useNotificationStore.getState().mergeItems([makeItem('n1'), makeItem('n2')]);
    renderDrawer();

    await screen.findByText('通知标题 n1');
    // Wait for the todo bridge merge so the "mark all" covers every present item.
    await screen.findByText(/M0 文档解析待确认/);
    fireEvent.click(screen.getByRole('button', { name: '全部已读' }));

    await waitFor(() => {
      const state = useNotificationStore.getState();
      expect(state.readIds.has('n1')).toBe(true);
      expect(state.readIds.has('n2')).toBe(true);
      expect(state.unreadCount).toBe(0);
    });
  });

  it('shows the polling transport line', async () => {
    renderDrawer();

    expect(await screen.findByText(/通知传输：轮询/)).toBeInTheDocument();
    expect(screen.getByTestId('notification-center')).toBeInTheDocument();
  });
});
