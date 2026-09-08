import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/providers';
import { useAuthStore } from '../../auth/useAuthStore';
import type { AuthMe } from '../../auth/authApi';
import { UserMenu } from './UserMenu';

const me: AuthMe = {
  tenant_id: 'default',
  user_id: 'boss',
  display_name: '陈厂长',
  roles: ['factory-director', 'org-admin'],
  role_names: ['厂长', '组织管理员'],
  permissions: ['order.view', 'identity.admin'],
  org_path: ['company', 'dept:prod'],
  must_change_password: false,
};

const renderMenu = () =>
  render(
    <AppProviders>
      <UserMenu />
    </AppProviders>,
  );

describe('UserMenu', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'ready', me, error: undefined });
  });

  it('shows the logged-in account and role without offering a role switch', async () => {
    renderMenu();

    expect(await screen.findByRole('button', { name: '用户菜单' })).toBeInTheDocument();
    expect(screen.getByText('陈厂长')).toBeInTheDocument();
    expect(screen.getByText('厂长')).toBeInTheDocument();
    // 顶部不再有角色切换下拉
    expect(screen.queryByTestId('role-switcher')).not.toBeInTheDocument();
  });

  it('renders nothing without a session', () => {
    useAuthStore.setState({ status: 'ready', me: undefined });
    const { container } = renderMenu();
    expect(container.querySelector('[data-testid="user-menu"]')).toBeNull();
  });
});
