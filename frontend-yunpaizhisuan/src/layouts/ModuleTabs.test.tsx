import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routeMeta } from '../app/router';
import { AppProviders } from '../app/providers';
import { WorkbenchLayout } from './WorkbenchLayout';
import { DashboardPage } from '../pages/DashboardPage';
import { TaskBoardPage } from '../pages/TaskBoardPage';
import { useTabsStore } from '../store/useTabsStore';

const renderRouter = (initialEntries = ['/dashboard']) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <WorkbenchLayout />,
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'tasks', element: <TaskBoardPage /> },
        ],
      },
    ],
    { initialEntries },
  );

  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return router;
};

describe('ModuleTabs', () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.getState().resetTabs();
  });

  it('keeps Dashboard as the fixed tab', async () => {
    renderRouter(['/dashboard']);

    expect(await screen.findByRole('tab', { name: routeMeta['/dashboard'].title })).toBeInTheDocument();
    expect(screen.queryByLabelText('remove')).not.toBeInTheDocument();
  });

  it('opens a tab for the current route', async () => {
    renderRouter(['/tasks']);

    expect(await screen.findByRole('tab', { name: '任务看板' })).toBeInTheDocument();
    await waitFor(() => expect(useTabsStore.getState().tabs.some((tab) => tab.path === '/tasks')).toBe(true));
  });
});
