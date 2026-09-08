import { AppstoreOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { AppPath } from '../../app/router';
import { hasPermission, type PermissionCode } from '../../services/permissionApi';
import { useCurrentRole } from './useCurrentRole';

const ENTRIES: Array<{ path: AppPath; label: string; permission: PermissionCode }> = [
  { path: '/setup', label: '架构设计引导', permission: 'system:setup' },
  { path: '/org', label: '组织架构', permission: 'org:write' },
  { path: '/accounts', label: '账号管理', permission: 'account:write' },
  { path: '/roles', label: '角色与权限', permission: 'role:manage' },
];

/**
 * Agent 对话页（厂长/品保落地页）上的管理入口。
 *
 * 对话页不在 WorkbenchLayout 里、没有侧栏，若不在此给入口，厂长注册后无法进入
 * 组织架构/账号/角色/引导四个页面。按权限过滤；无任何管理权限时返回 null。
 */
export function AdminNavMenu() {
  const navigate = useNavigate();
  const roleQuery = useCurrentRole();
  const items = ENTRIES.filter((entry) => hasPermission(roleQuery.data, entry.permission));
  if (!items.length) return null;

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: items.map((entry) => ({ key: entry.path, label: entry.label })),
        onClick: ({ key }) => navigate(key),
      }}
    >
      <Button type="text" icon={<AppstoreOutlined />} data-testid="admin-nav-menu">
        管理
      </Button>
    </Dropdown>
  );
}
