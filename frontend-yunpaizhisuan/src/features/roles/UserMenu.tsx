import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Dropdown, Modal, Tag, Space } from 'antd';
import { useState } from 'react';
import { useAuthStore } from '../../auth/useAuthStore';
import { ChangePasswordPage } from '../../pages/ChangePasswordPage';
import { useCurrentRole } from './useCurrentRole';

/**
 * 顶部用户菜单：当前账号 + 角色 + 改密 / 退出。
 *
 * 取代原来的 `RoleSwitcher`——身份由服务端会话决定，前端不再允许切角色。
 * 演示模式（`VITE_ENABLE_DEMO_ROLES=true`）下由 WorkbenchLayout 渲染
 * RoleSwitcher，本组件只在真实鉴权下出现。
 */
export function UserMenu() {
  const me = useAuthStore((state) => state.me);
  const logout = useAuthStore((state) => state.logout);
  const roleQuery = useCurrentRole();
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!me) return null;

  const displayName = me.display_name || me.user_id || '未登录';
  const roleName = me.role_names?.[0] ?? roleQuery.data?.name ?? me.roles[0] ?? '';

  return (
    <>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'account', label: `账号：${me.user_id ?? '-'}`, disabled: true },
            { key: 'org', label: `组织：${me.org_path?.join(' / ') || '未分配'}`, disabled: true },
            { type: 'divider' as const },
            { key: 'password', label: '修改密码' },
            { key: 'logout', label: '退出登录', icon: <LogoutOutlined /> },
          ],
          onClick: ({ key }) => {
            if (key === 'password') setPasswordOpen(true);
            if (key === 'logout') void logout().then(() => window.location.replace('/login'));
          },
        }}
      >
        <Button type="text" icon={<UserOutlined />} aria-label="用户菜单" data-testid="user-menu">
          <Space size={6}>
            {roleName ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>{roleName}</Tag> : null}
            {displayName}
          </Space>
        </Button>
      </Dropdown>
      <Modal
        open={passwordOpen}
        footer={null}
        title="修改密码"
        onCancel={() => setPasswordOpen(false)}
        destroyOnHidden
      >
        <ChangePasswordPage />
      </Modal>
    </>
  );
}
