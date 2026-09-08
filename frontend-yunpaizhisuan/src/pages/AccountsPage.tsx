import { DeleteOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeading } from '../components/PageHeading';
import { PermissionGate } from '../components/PermissionGate';
import {
  ORG_TYPE_LABEL,
  createUser,
  deleteUser,
  listOrgTree,
  listRoles,
  listUsers,
  orgPathLabel,
  resetUserPassword,
  updateUser,
  type IdentityUser,
} from '../features/org/orgApi';

const usersQueryKey = ['identity', 'users'] as const;
const orgQueryKey = ['identity', 'org'] as const;
const rolesQueryKey = ['identity', 'roles'] as const;

const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 账号管理（厂长角色页）：给员工分配账号、重置密码、启用停用。
 *
 * 初始密码只在创建/重置时回显一次（服务端只存 scrypt 哈希）。
 */
export function AccountsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{
    user_id: string;
    display_name: string;
    org_id?: string;
    role_codes: string[];
  }>();
  const [issued, setIssued] = useState<{ userId: string; password: string } | null>(null);

  const usersQuery = useQuery({ queryKey: usersQueryKey, queryFn: listUsers });
  const orgQuery = useQuery({ queryKey: orgQueryKey, queryFn: listOrgTree });
  const rolesQuery = useQuery({ queryKey: rolesQueryKey, queryFn: listRoles });

  const nodes = orgQuery.data?.org ?? [];
  const roles = rolesQuery.data?.roles ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: usersQueryKey });
  };

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: async (result) => {
      setCreateOpen(false);
      form.resetFields();
      setIssued({ userId: result.user_id, password: result.initial_password });
      await refresh();
    },
    onError: (error) => message.error(`创建失败：${errText(error)}`),
  });

  const resetMutation = useMutation({
    mutationFn: resetUserPassword,
    onSuccess: async (result, userId) => {
      setIssued({ userId, password: result.initial_password });
      await refresh();
    },
    onError: (error) => message.error(`重置失败：${errText(error)}`),
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: 'active' | 'disabled' }) =>
      updateUser(userId, { status }),
    onSuccess: async (_result, variables) => {
      message.success(variables.status === 'disabled' ? '账号已停用（其会话下一请求即失效）' : '账号已启用');
      await refresh();
    },
    onError: (error) => message.error(`操作失败：${errText(error)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: async () => {
      message.success('账号已删除');
      await refresh();
    },
    onError: (error) => message.error(`删除失败：${errText(error)}`),
  });

  const columns: ColumnsType<IdentityUser> = [
    { title: '账号', dataIndex: 'user_id', key: 'user_id', width: 140 },
    { title: '姓名', dataIndex: 'display_name', key: 'display_name', width: 140 },
    {
      title: '组织',
      key: 'org',
      render: (_value, record) => orgPathLabel(nodes, record.org_id),
    },
    {
      title: '角色',
      key: 'roles',
      render: (_value, record) =>
        record.role_codes.length
          ? record.role_codes.map((code) => (
              <Tag key={code}>{roles.find((role) => role.role_code === code)?.name ?? code}</Tag>
            ))
          : <Typography.Text type="secondary">未分配</Typography.Text>,
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_value, record) => (
        <Space size={4}>
          <Tag color={record.status === 'active' ? 'green' : 'default'}>
            {record.status === 'active' ? '启用' : '停用'}
          </Tag>
          {record.must_change_password ? <Tag color="orange">待改密</Tag> : null}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button
            size="small"
            icon={<KeyOutlined />}
            onClick={() => resetMutation.mutate(record.user_id)}
            loading={resetMutation.isPending && resetMutation.variables === record.user_id}
          >
            重置密码
          </Button>
          <Button
            size="small"
            onClick={() =>
              statusMutation.mutate({
                userId: record.user_id,
                status: record.status === 'active' ? 'disabled' : 'active',
              })
            }
          >
            {record.status === 'active' ? '停用' : '启用'}
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              modal.confirm({
                title: `删除账号「${record.user_id}」？`,
                content: '删除后该账号立即无法登录。',
                okText: '删除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: () => deleteMutation.mutateAsync(record.user_id),
              })
            }
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <PageHeading path="/accounts" />
      <PermissionGate permission="account:write" auditModule="Accounts" targetId="accounts-page">
        <Card
          title="账号"
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => void usersQuery.refetch()}>
                刷新
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                新建账号
              </Button>
            </Space>
          }
        >
          <Table<IdentityUser>
            rowKey="user_id"
            data-testid="accounts-table"
            loading={usersQuery.isLoading}
            dataSource={usersQuery.data?.users ?? []}
            columns={columns}
            pagination={false}
            locale={{ emptyText: '还没有员工账号。点右上角「新建账号」分配。' }}
          />
        </Card>
      </PermissionGate>

      <Modal
        title="新建员工账号"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建并生成初始密码"
        confirmLoading={createMutation.isPending}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            createMutation.mutate({
              user_id: values.user_id.trim(),
              display_name: values.display_name.trim(),
              org_id: values.org_id ?? null,
              role_codes: values.role_codes,
            })
          }
        >
          <Form.Item
            name="user_id"
            label="登录账号"
            rules={[
              { required: true, message: '请输入账号' },
              { pattern: /^[A-Za-z0-9_.@-]{3,64}$/, message: '字母/数字/_ . @ -，长度 3~64' },
            ]}
          >
            <Input placeholder="如 worker01" />
          </Form.Item>
          <Form.Item name="display_name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如 张三" />
          </Form.Item>
          <Form.Item name="org_id" label="所属部门 / 班组">
            <Select
              allowClear
              placeholder="可稍后再分配"
              options={nodes.map((node) => ({
                value: node.org_id,
                label: `${node.name}（${ORG_TYPE_LABEL[node.org_type] ?? node.org_type}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="role_codes" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select
              mode="multiple"
              placeholder="如 工人 / 组长"
              options={roles.map((role) => ({ value: role.role_code, label: role.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="初始密码（只显示这一次）"
        open={issued !== null}
        onCancel={() => setIssued(null)}
        onOk={() => setIssued(null)}
        okText="我已记录"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="请把密码交给本人，关闭后无法再次查看"
            description="员工首次登录会被要求立即修改密码。"
          />
          <Typography.Paragraph copyable style={{ marginBottom: 0 }}>
            <Typography.Text strong>{issued?.userId}</Typography.Text>
            <br />
            <Typography.Text code>{issued?.password}</Typography.Text>
          </Typography.Paragraph>
        </Space>
      </Modal>
    </Space>
  );
}
