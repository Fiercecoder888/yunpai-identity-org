import { Select, Space, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { isDemoRoleEnabled } from '../../app/runtimeMode';
import { currentRoleQueryKey, listDemoRoles } from '../../services/permissionApi';
import { demoRoleStorageKey, landingKindForRoleId } from './roleConfig';
import { useCurrentRole } from './useCurrentRole';

const rolesQueryKey = ['permissions', 'demo-roles'] as const;

export function RoleSwitcher({ navigateOnChange = true }: { navigateOnChange?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roleQuery = useCurrentRole();
  const rolesQuery = useQuery({ queryKey: rolesQueryKey, queryFn: listDemoRoles });

  if (!isDemoRoleEnabled()) {
    return (
      <span className="role-switcher role-switcher-readonly">
        <Tag color="blue">角色</Tag>
        <Typography.Text type="secondary">{roleQuery.data?.name ?? '—'}</Typography.Text>
      </span>
    );
  }

  const options = (rolesQuery.data ?? []).map((role) => ({ value: role.id, label: role.name }));

  return (
    <Space className="role-switcher" size={8}>
      <Tag color="blue">角色</Tag>
      <Select
        aria-label="切换角色（演示）"
        data-testid="role-switcher"
        value={roleQuery.data?.id}
        loading={rolesQuery.isLoading || roleQuery.isLoading}
        placeholder="选择角色"
        style={{ width: 160 }}
        options={options}
        optionRender={(option) => {
          const landing = landingKindForRoleId(String(option.value));
          return (
            <Space direction="vertical" size={0}>
              <span>{option.label}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                登陆页：{landing.landingPath}
              </Typography.Text>
            </Space>
          );
        }}
        onSelect={(roleId) => {
          // 用 onSelect 而非 onChange：重复选择当前角色（如工人已在 /home 再点「工人」）
          // 时 onChange 不触发，导致不跳转落地页；onSelect 每次显式选择都触发。
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(demoRoleStorageKey, roleId);
          }
          void (async () => {
            // 先等角色查询刷新完成再跳转，避免 RoleGuard 用旧角色误判并重定向。
            await queryClient.invalidateQueries({ queryKey: currentRoleQueryKey });
            await queryClient.invalidateQueries({ queryKey: rolesQueryKey });
            if (navigateOnChange) {
              navigate(landingKindForRoleId(roleId).landingPath);
            }
          })();
        }}
      />
    </Space>
  );
}
