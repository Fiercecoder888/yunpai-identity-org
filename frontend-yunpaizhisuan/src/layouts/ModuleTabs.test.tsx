import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routeMeta } from '../app/router';
import { AppProviders } from '../app/providers';
import { WorkbenchLayout } from './WorkbenchLayout';
import { useTabsStore } from '../store/useTabsStore';

const renderRouter = (initialEntries = ['/org']) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <WorkbenchLayout />,
        children: [
          { path: 'org', element: <div>org-page</div> },
          { path: 'accounts', element: <div>accounts-page</div> },
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

  it('opens a tab for the current route', async () => {
    renderRouter(['/org']);

    expect(await screen.findByRole('tab', { name: routeMeta['/org'].title })).toBeInTheDocument();
    await waitFor(() => expect(useTabsStore.getState().tabs.some((tab) => tab.path === '/org')).toBe(true));
  });

  it('keeps a tab for every visited route', async () => {
    useTabsStore.getState().openTab({ path: '/accounts', title: routeMeta['/accounts'].title, closable: true });

    renderRouter(['/org']);

    expect(await screen.findByRole('tab', { name: routeMeta['/org'].title })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: routeMeta['/accounts'].title })).toBeInTheDocument();
    await waitFor(() =>
      expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual(['/accounts', '/org']),
    );
  });
});
