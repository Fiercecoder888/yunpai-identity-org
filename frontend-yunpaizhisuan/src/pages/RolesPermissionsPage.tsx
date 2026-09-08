import { Card, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import { PageHeading } from '../components/PageHeading';
import { PermissionGate } from '../components/PermissionGate';
import { getIdentityCatalog, type IdentityRole, type PermissionEntry } from '../features/org/orgApi';

const catalogQueryKey = ['identity', 'catalog'] as const;

/**
 * 角色与权限矩阵（只读）。
 *
 * 数据源是 PR #6 的 `/api/identity/catalog`（13 项权限 + 9 个种子角色）；
 * 内置角色只读，避免客户把厂长权限改坏（改权限走后端 `upsert_role`）。
 */
export function RolesPermissionsPage() {
  const catalogQuery = useQuery({ queryKey: catalogQueryKey, queryFn: getIdentityCatalog });
  const permissions: PermissionEntry[] = catalogQuery.data?.permissions ?? [];
  const roles: IdentityRole[] = catalogQuery.data?.roles ?? [];

  const columns: ColumnsType<PermissionEntry> = [
    { title: '权限码', dataIndex: 'code', key: 'code', width: 220 },
    { title: '含义', dataIndex: 'label', key: 'label', width: 240 },
    {
      title: '对应 Gate',
      dataIndex: 'gate',
      key: 'gate',
      width: 140,
      render: (gate?: string) => (gate && gate !== '-' ? <Tag color="blue">{gate}</Tag> : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: '数据范围',
      key: 'scopes',
      render: (_value, record) =>
        record.scopes?.length ? record.scopes.map((scope) => <Tag key={scope}>{scope}</Tag>) : <Typography.Text type="secondary">租户全量</Typography.Text>,
    },
    ...roles.map((role) => ({
      title: role.name,
      key: role.role_code,
      width: 120,
      render: (_value: unknown, record: PermissionEntry) => {
        const granted = role.permissions.some(
          (spec) => spec === record.code || spec.startsWith(`${record.code}@`),
        );
        return granted ? <Tag color="green">✓</Tag> : <Typography.Text type="secondary">—</Typography.Text>;
      },
    })),
  ];

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <PageHeading path="/roles" />
      <PermissionGate permission="role:manage" auditModule="Roles" targetId="roles-page">
        <Card
          title="角色与权限矩阵"
          extra={
            <Typography.Text type="secondary">
              {permissions.length} 项权限 · {roles.length} 个角色
            </Typography.Text>
          }
        >
          <Table<PermissionEntry>
            rowKey="code"
            data-testid="roles-matrix"
            loading={catalogQuery.isLoading}
            dataSource={permissions}
            columns={columns}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: '权限目录暂不可用（需要登录且具备 identity.admin）' }}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            厂长 = 厂长角色 + 组织管理员角色（业务总控 + 组织/账号管理）；内置角色只读，
            调整权限请走后端 <Typography.Text code>upsert_role</Typography.Text> 并留审计。
          </Typography.Paragraph>
        </Card>
      </PermissionGate>
    </Space>
  );
}
