import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Form, Input, Modal, Select, Space, Tag, Tree, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { PageHeading } from '../components/PageHeading';
import { PermissionGate } from '../components/PermissionGate';
import {
  ORG_TYPE_LABEL,
  buildOrgTree,
  deleteOrgNode,
  listOrgTree,
  upsertOrgNode,
  type OrgNode,
  type OrgTreeNode,
} from '../features/org/orgApi';

const orgQueryKey = ['identity', 'org'] as const;

const slugify = (name: string, prefix: string) =>
  `${prefix}:${name.trim().toLowerCase().replace(/\s+/g, '-') || Date.now().toString(36)}`;

type AntdTreeNode = { key: string; title: ReactNode; children: AntdTreeNode[] };

const toAntdNodes = (
  nodes: readonly OrgTreeNode[],
  renderTitle: (node: OrgTreeNode) => ReactNode,
): AntdTreeNode[] =>
  nodes.map((node) => ({
    key: node.key,
    title: renderTitle(node),
    children: toAntdNodes(node.children, renderTitle),
  }));

/**
 * 组织架构页（厂长角色页）：公司 → 部门 → 班组 三层，可增删。
 *
 * 形态对齐 `/leader`（角色页），不另起后台；底层是 PR #6 的 `/api/identity/org`。
 */
export function OrgStructurePage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ name: string; org_type: string; parent_id?: string }>();

  const orgQuery = useQuery({ queryKey: orgQueryKey, queryFn: listOrgTree });
  const nodes: OrgNode[] = useMemo(() => orgQuery.data?.org ?? [], [orgQuery.data]);
  const tree = useMemo(() => buildOrgTree(nodes), [nodes]);
  const selectedNode = nodes.find((node) => node.org_id === selected);

  const createMutation = useMutation({
    mutationFn: upsertOrgNode,
    onSuccess: async () => {
      message.success('组织节点已创建');
      setCreateOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: orgQueryKey });
    },
    onError: (error) => message.error(`创建失败：${error instanceof Error ? error.message : String(error)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteOrgNode,
    onSuccess: async () => {
      message.success('组织节点已删除');
      setSelected(undefined);
      await queryClient.invalidateQueries({ queryKey: orgQueryKey });
    },
    onError: (error) => message.error(`删除失败：${error instanceof Error ? error.message : String(error)}`),
  });

  const renderTitle = (node: OrgTreeNode) => (
    <Space size={6}>
      <span>{node.title}</span>
      <Tag color={node.orgType === 'company' ? 'gold' : node.orgType === 'dept' ? 'blue' : 'green'}>
        {ORG_TYPE_LABEL[node.orgType] ?? node.orgType}
      </Tag>
      {node.source === 'derived' ? <Tag>花名册派生</Tag> : null}
    </Space>
  );

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <PageHeading path="/org" />
      <PermissionGate permission="org:write" auditModule="OrgStructure" targetId="org-page">
        <Card
          title="组织架构"
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => void orgQuery.refetch()}>
                刷新
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  form.setFieldsValue({ org_type: 'dept', parent_id: selected ?? 'company' });
                  setCreateOpen(true);
                }}
              >
                新建部门 / 班组
              </Button>
            </Space>
          }
        >
          {orgQuery.isLoading ? (
            <Typography.Text type="secondary">加载中…</Typography.Text>
          ) : tree.length === 0 ? (
            <Empty description="还没有组织架构。可以先新建部门，再用「架构设计引导页」让 AI 生成。" />
          ) : (
            <Tree
              data-testid="org-tree"
              treeData={toAntdNodes(tree, renderTitle)}
              defaultExpandAll
              selectedKeys={selected ? [selected] : []}
              onSelect={(keys) => setSelected((keys[0] as string | undefined) ?? undefined)}
            />
          )}
          {selectedNode ? (
            <Space style={{ marginTop: 16 }}>
              <Typography.Text type="secondary">
                已选：{selectedNode.name}（{ORG_TYPE_LABEL[selectedNode.org_type] ?? selectedNode.org_type}）
              </Typography.Text>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  modal.confirm({
                    title: `删除「${selectedNode.name}」？`,
                    content: '如果节点下还有子节点或已挂账号，后端会拒绝删除。',
                    okText: '删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: () => deleteMutation.mutateAsync(selectedNode.org_id),
                  })
                }
              >
                删除节点
              </Button>
            </Space>
          ) : null}
        </Card>
      </PermissionGate>

      <Modal
        title="新建组织节点"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        confirmLoading={createMutation.isPending}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            const orgType = values.org_type;
            const prefix = orgType === 'company' ? 'company' : orgType === 'team' ? 'team' : 'dept';
            createMutation.mutate({
              org_id: orgType === 'company' ? 'company' : slugify(values.name, prefix),
              name: values.name.trim(),
              org_type: orgType,
              parent_id: values.parent_id ?? null,
            });
          }}
        >
          <Form.Item name="org_type" label="类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'dept', label: '部门' },
                { value: 'team', label: '班组' },
              ]}
            />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 生产部 / 生产A班" />
          </Form.Item>
          <Form.Item name="parent_id" label="上级节点" rules={[{ required: true, message: '请选择上级' }]}>
            <Select
              options={nodes.map((node) => ({
                value: node.org_id,
                label: `${node.name}（${ORG_TYPE_LABEL[node.org_type] ?? node.org_type}）`,
              }))}
              placeholder="选择上级"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
