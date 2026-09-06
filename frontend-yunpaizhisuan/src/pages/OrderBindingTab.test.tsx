import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductionTeam } from '../schemas/leader';
import { useAuthStore } from '../auth/useAuthStore';
import { renderWithApp } from '../tests/testUtils';
import * as leaderApi from '../services/leaderApi';
import { OrderBindingTab } from './OrderBindingTab';

const teams: ProductionTeam[] = [
  {
    team_id: 'team-leader-a1',
    team_code: 'TEAM-A1',
    team_name: '一车间 A 班',
    leader_user_id: 'leader-zhang',
    line_id: 'LINE-A',
    resource_ids: ['EQ-CUT', 'EQ-ASM'],
    shift_rule: { shift: 'day' },
    status: 'active',
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
  },
];

const renderTab = () => renderWithApp(<OrderBindingTab teams={teams} />);

const useLeaderPermissions = (permissions: string[]) => {
  vi.stubEnv('VITE_ENABLE_MSW', 'false');
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  useAuthStore.setState({
    status: 'ready',
    me: {
      auth_mode: 'shared_anonymous',
      principal_id: 'leader-test-user',
      principal_type: 'shared_anonymous',
      user: { name: '组长测试用户' },
      tenant: { id: 'tenant', name: 'Shared' },
      shared_data: true,
      roles: ['leader-test-role'],
      permissions,
      session: {
        id: 'session',
        csrf_token: 'test-only',
        idle_expires_at: 'later',
        absolute_expires_at: 'later',
      },
    },
    error: undefined,
  });
};

describe('OrderBindingTab', () => {
  beforeEach(() => {
    useLeaderPermissions(['leader:read', 'leader:write']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // restoreAllMocks 会清掉 setup 的 matchMedia 桩实现，这里补回，
    // 避免同文件后续用例里 antd Select/Modal 响应式观察器报错。
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    window.localStorage.clear();
    vi.unstubAllEnvs();
    act(() => {
      useAuthStore.setState({ status: 'idle', config: undefined, me: undefined, error: undefined });
    });
  });

  it('lets the leader search-pick a test worker and dispatch the order to them', async () => {
    const bindSpy = vi.spyOn(leaderApi, 'bindWorkersToOrder').mockResolvedValue([]);
    const addMemberSpy = vi.spyOn(leaderApi, 'addLeaderTeamMember').mockResolvedValue({
      id: 'member-new',
      team_id: 'team-leader-a1',
      worker_id: 'worker-zhangsan',
      worker_name: '张三',
      station: '押出机 01',
      role: 'worker',
      status: 'active',
      created_at: '2026-08-10T00:00:00Z',
      updated_at: '2026-08-10T00:00:00Z',
    });
    const user = userEvent.setup();
    renderTab();

    const orderInput = screen.getByRole('textbox', { name: '订单号' });
    await user.type(orderInput, 'SO-LEADER-002');

    // 用「测试工人快速选择」搜索并选中 工人-张三
    const quickSelect = screen.getByRole('combobox', { name: '测试工人快速选择' });
    await waitFor(() => expect(quickSelect).toBeEnabled());
    await user.click(quickSelect);
    await user.type(quickSelect, '张三');
    await user.click(await screen.findByText('工人-张三'));

    // 张三自动被勾选进工人池
    await waitFor(() => {
      const checked = document.querySelectorAll('.ant-checkbox-checked');
      expect(checked.length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole('button', { name: '绑定所选工人' }));

    // 派工：先补班组再绑定，携带选中工人与订单号
    await waitFor(() => expect(bindSpy).toHaveBeenCalledTimes(1));
    expect(bindSpy.mock.calls[0]![0]).toMatchObject({
      order_id: 'SO-LEADER-002',
      team_id: 'team-leader-a1',
      worker_ids: ['worker-zhangsan'],
    });
    expect(addMemberSpy).toHaveBeenCalledWith(
      'team-leader-a1',
      expect.objectContaining({ worker_id: 'worker-zhangsan', worker_name: '张三' }),
    );
  });

  it('offers the local test personnel list as a fallback worker pool', async () => {
    renderTab();

    expect(await screen.findByText(/测试工人快速选择/)).toBeInTheDocument();
    expect(screen.getByText(/工人池/)).toBeInTheDocument();
    // 本地测试名单回退提示（班组有成员时也提示测试名单逻辑）
    expect(screen.getByText('本地测试名单回退')).toBeInTheDocument();
  });

  it('does not issue binding writes when the role only has leader:read', async () => {
    useLeaderPermissions(['leader:read']);
    const addMemberSpy = vi.spyOn(leaderApi, 'addLeaderTeamMember');
    const bindSpy = vi.spyOn(leaderApi, 'bindWorkersToOrder');
    const unbindSpy = vi.spyOn(leaderApi, 'unbindWorkerFromOrder');
    const user = userEvent.setup();
    const { queryClient } = renderTab();

    const bindingQueryKey = ['leader', 'bindings', 'SO-LEADER-001'];
    queryClient.setQueryDefaults(bindingQueryKey, { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(bindingQueryKey, [
      {
        id: 'binding-read-only',
        worker_id: 'worker-wang',
        order_id: 'SO-LEADER-001',
        team_id: 'team-leader-a1',
        leader_user_id: 'leader-zhang',
        resource_id: 'EQ-CUT',
        station: '押出机 01',
        role: 'worker',
        status: 'active',
        created_at: '2026-08-10T00:00:00Z',
        updated_at: '2026-08-10T00:00:00Z',
      },
    ]);
    fireEvent.change(screen.getByRole('textbox', { name: '订单号' }), {
      target: { value: 'SO-LEADER-001' },
    });

    const bindButton = await screen.findByRole('button', { name: '绑定所选工人' });
    expect(bindButton).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '测试工人快速选择' })).toBeDisabled();

    const unbindButtons = await screen.findAllByRole('button', { name: /解\s*绑/ });
    expect(unbindButtons.length).toBeGreaterThan(0);
    unbindButtons.forEach((button) => expect(button).toBeDisabled());

    await user.click(bindButton);
    await user.click(unbindButtons[0]!);

    expect(addMemberSpy).not.toHaveBeenCalled();
    expect(bindSpy).not.toHaveBeenCalled();
    expect(unbindSpy).not.toHaveBeenCalled();
  });
});
