import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMe } from '../auth/authApi';
import { useAuthStore } from '../auth/useAuthStore';
import { PERMISSION_CODES } from '../features/roles/permissionCatalog';
import { currentRoleQueryKey } from '../services/permissionApi';
import { SideNav } from './SideNav';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const authenticatedMe = (overrides: Partial<AuthMe> = {}): AuthMe => ({
  auth_mode: 'shared_anonymous',
  principal_id: 'factory-user',
  principal_type: 'shared_anonymous',
  user: { name: '厂长' },
  tenant: { id: 'tenant-a', name: '测试租户' },
  shared_data: true,
  roles: ['shared_developer'],
  permissions: [...PERMISSION_CODES],
  session: { id: 'session-a', csrf_token: 'test-only', idle_expires_at: 'later', absolute_expires_at: 'later' },
  ...overrides,
});

const resetAuthStore = () => {
  useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
};

const restrictedNavigationLabels = [
  'Dashboard',
  '驾驶舱',
  '任务看板',
  'M0 文档解析审核',
  'BOM 审核',
  'SOP 查看',
  'M3 物料计划',
  'M4 采购追踪',
  '小组长工作台',
  '工人工作台',
  '排程甘特图',
  'M5 流程看板',
  '品控看板',
  '打样组看板',
  '业务追溯工作台',
  '成品库',
  '仓库出库对账',
  '法务终审',
  'M0 数据建设',
  'M0 知识 Wiki',
  '操作留痕',
] as const;

const renderSideNav = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/modules/legal-final-review']}>
        <SideNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('SideNav legal delivery state', () => {
  beforeEach(() => {
    queryClient.clear();
    resetAuthStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    queryClient.clear();
    act(() => {
      resetAuthStore();
    });
  });

  it('labels legal final review as a demo in MSW mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');
    renderSideNav();

    expect(await screen.findByText('法务终审')).toBeInTheDocument();
    expect(screen.getByText('演示')).toBeInTheDocument();
  });

  it('labels legal final review as not delivered in real mode', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    renderSideNav();

    expect(await screen.findByText('法务终审')).toBeInTheDocument();
    expect(screen.getByText('未交付')).toBeInTheDocument();
  });

  it('shows every restricted entry for a shared developer and removes it after downgrade', async () => {
    vi.stubEnv('VITE_ENABLE_MSW', 'false');
    vi.stubEnv('VITE_ENABLE_DEMO_ROLES', 'false');
    useAuthStore.setState({ status: 'ready', me: authenticatedMe(), error: undefined });
    renderSideNav();

    for (const label of restrictedNavigationLabels) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }

    await act(async () => {
      queryClient.setQueryData(
        [...currentRoleQueryKey, 'worker-user', 'tenant-a', 'session-b', ['worker'], ['worker:read']],
        { id: 'worker', name: '生产工人', permissions: ['worker:read'] },
      );
      useAuthStore.setState({
        me: authenticatedMe({
          principal_id: 'worker-user',
          user: { name: '生产工人' },
          roles: ['worker'],
          permissions: ['worker:read'],
          session: { id: 'session-b', csrf_token: 'test-only-b', idle_expires_at: 'later', absolute_expires_at: 'later' },
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await screen.findByText('工人工作台')).toBeInTheDocument();
    expect(screen.queryByText('M4 采购追踪')).not.toBeInTheDocument();
    expect(screen.queryByText('排程甘特图')).not.toBeInTheDocument();
    expect(screen.queryByText('任务看板')).not.toBeInTheDocument();
    expect(screen.queryByText('品控看板')).not.toBeInTheDocument();
    expect(screen.queryByText('法务终审')).not.toBeInTheDocument();
    expect(screen.queryByText('M0 数据建设')).not.toBeInTheDocument();
  });
});
