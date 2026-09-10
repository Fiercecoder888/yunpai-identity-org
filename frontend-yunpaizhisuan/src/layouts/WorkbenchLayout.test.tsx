import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppProviders } from '../app/providers';
import { WorkbenchLayout } from './WorkbenchLayout';
import { useTabsStore } from '../store/useTabsStore';
import { useAuthStore } from '../auth/useAuthStore';

const renderLayout = () => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <WorkbenchLayout />,
        children: [{ path: 'org', element: <div>org-page</div> }],
      },
    ],
    { initialEntries: ['/org'] },
  );

  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
};

describe('WorkbenchLayout header', () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.getState().resetTabs();
    useAuthStore.setState({
      status: 'ready',
      config: {
        auth_mode: 'shared_anonymous',
        oidc_enabled: false,
        shared_data: true,
        csrf_required: true,
        capabilities: {
          anonymous_session: true,
          oidc_login: false,
          session_management: true,
          user_isolation: false,
        },
        tenants: [
          { id: '11111111-1111-4111-8111-111111111111', name: '测试库' },
          { id: '44444444-4444-4444-8444-444444444444', name: '生产库' },
        ],
      },
      me: {
        auth_mode: 'shared_anonymous',
        principal_id: 'shared-principal',
        principal_type: 'shared_anonymous',
        user: null,
        tenant: { id: '11111111-1111-4111-8111-111111111111', name: '测试库' },
        shared_data: true,
        roles: [],
        permissions: [],
        session: {
          id: 'session',
          csrf_token: 'memory-only',
          idle_expires_at: 'later',
          absolute_expires_at: 'later',
        },
      },
    });
  });

  it('renders the branded header copy and right-side actions', async () => {
    renderLayout();

    expect(await screen.findByText('云湃智造运营中心')).toBeInTheDocument();
    expect(screen.getByText('订单识别·任务协同·生产排程·操作留痕')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的待办' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '当前数据库：测试库' })).toBeInTheDocument();
    // 演示模式（VITE_ENABLE_DEMO_ROLES 默认开）显示角色切换；真实鉴权下换成 UserMenu。
    expect(screen.getByTestId('role-switcher')).toBeInTheDocument();
  });
});
