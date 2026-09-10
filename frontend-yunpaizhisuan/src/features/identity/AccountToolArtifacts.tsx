import { CheckCircleOutlined, CopyOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getLocalRun } from '../../services/localRunApi';
import { copyText } from '../../utils/clipboard';

const IDENTITY_TOOLS = new Set(['create_identity_user', 'assign_identity_account', 'list_identity_users']);

type Envelope = Record<string, unknown>;

const asRecord = (value: unknown): Envelope | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Envelope) : null;

/** 本地 handler 直接返回扁平结果；HTTP adapter 会包一层 data。两种都兼容。 */
const unwrap = (result: unknown): Envelope | null => {
  const record = asRecord(result);
  if (!record) return null;
  const data = asRecord(record.data);
  if (data && ('user_id' in data || 'users' in data || 'created' in data)) return data;
  return record;
};

const hasText = (value: unknown): boolean =>
  value !== undefined && value !== null && String(value).trim().length > 0;

/** 只保留真正能渲染成卡片的行（必须有 user_id）；空对象/空数组都不算成功数据。 */
const renderableRows = (value: unknown): Envelope[] =>
  (Array.isArray(value) ? value : []).filter(
    (row): row is Envelope => Boolean(asRecord(row) && hasText((row as Envelope).user_id)),
  );

const roleLabels: Record<string, string> = {
  'factory-director': '厂长',
  'org-admin': '组织管理员',
  'data-steward': '主数据管理员',
  engineer: '工程审批',
  planner: '计划员',
  'release-manager': '发布负责人',
  'quality-assurance': '品保监督',
  'team-leader': '组长',
  worker: '工人',
};

const roleTag = (code: string) => (
  <Tag key={code} color="green">
    {roleLabels[code] ?? code}
  </Tag>
);

function CreatedAccountCard({ data }: { data: Envelope }) {
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);
  const password = String(data.initial_password ?? '');
  const copy = async () => {
    // 纯 HTTP 非 localhost 下 navigator.clipboard 不可用，copyText 会退化为
    // execCommand 兜底；都失败才提示手动复制（密码仍留在卡片上可见）。
    if (await copyText(password)) {
      setCopied(true);
      message.success('初始密码已复制');
    } else {
      message.warning('浏览器不允许自动复制，请手动选中页面上的密码复制');
    }
  };
  return (
    <Card
      size="small"
      className="account-created-card"
      data-testid="account-created-card"
      title={
        <Space>
          <CheckCircleOutlined style={{ color: '#389e0d' }} />
          账号已创建
        </Space>
      }
    >
      <Descriptions size="small" column={1} items={[
        { key: 'user', label: '账号', children: <code>{String(data.user_id ?? '')}</code> },
        { key: 'name', label: '姓名', children: String(data.display_name ?? '-') },
        { key: 'org', label: '组织', children: String(data.org_id ?? '公司根') },
        {
          key: 'roles',
          label: '角色',
          children: (Array.isArray(data.role_codes) ? data.role_codes : []).map((code) => roleTag(String(code))),
        },
      ]} />
      {password ? (
        <Alert
          style={{ marginTop: 10 }}
          type="warning"
          showIcon
          message={
            <Space wrap>
              <span>一次性初始密码：</span>
              <code data-testid="account-initial-password">{password}</code>
              <Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>
                {copied ? '已复制' : '复制'}
              </Button>
            </Space>
          }
          description="只显示这一次；员工首次登录会被要求修改密码。"
        />
      ) : null}
    </Card>
  );
}

function AssignedAccountCard({ data }: { data: Envelope }) {
  return (
    <Card
      size="small"
      data-testid="account-assigned-card"
      title={
        <Space>
          <TeamOutlined />
          账号已调整
        </Space>
      }
    >
      <Descriptions size="small" column={1} items={[
        { key: 'user', label: '账号', children: <code>{String(data.user_id ?? '')}</code> },
        { key: 'name', label: '姓名', children: String(data.display_name ?? '-') },
        { key: 'org', label: '组织', children: String(data.org_id ?? '未变更') },
        {
          key: 'roles',
          label: '角色',
          children: (Array.isArray(data.role_codes) ? data.role_codes : []).map((code) => roleTag(String(code))),
        },
      ]} />
    </Card>
  );
}

function BatchCreatedCard({ data }: { data: Envelope }) {
  const { message } = App.useApp();
  const rows = (Array.isArray(data.created) ? data.created : []) as Envelope[];
  const copyAll = async () => {
    const text = rows
      .map((row) => `${String(row.user_id)}  ${String(row.display_name)}  密码 ${String(row.initial_password)}`)
      .join('\n');
    if (await copyText(text)) {
      message.success('账号与初始密码已复制');
    } else {
      message.warning('浏览器不允许自动复制，请手动选中页面上的密码复制');
    }
  };
  return (
    <Card
      size="small"
      data-testid="account-created-batch-card"
      title={
        <Space>
          <CheckCircleOutlined style={{ color: '#389e0d' }} />
          已创建 {rows.length} 个账号
          <Button size="small" icon={<CopyOutlined />} onClick={() => void copyAll()}>
            复制全部
          </Button>
        </Space>
      }
    >
      <Table
        size="small"
        rowKey={(row) => String(row.user_id)}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '账号', dataIndex: 'user_id', render: (value: unknown) => <code>{String(value)}</code> },
          { title: '姓名', dataIndex: 'display_name' },
          {
            title: '角色',
            dataIndex: 'role_codes',
            render: (value: unknown) => (Array.isArray(value) ? value : []).map((code) => roleTag(String(code))),
          },
          {
            title: '一次性初始密码',
            dataIndex: 'initial_password',
            render: (value: unknown) => <code data-testid="account-initial-password">{String(value)}</code>,
          },
        ]}
      />
      <Alert
        style={{ marginTop: 10 }}
        type="warning"
        showIcon
        message="初始密码只显示这一次；员工首次登录会被要求修改密码。"
      />
    </Card>
  );
}

function AccountListCard({ data }: { data: Envelope }) {
  const users = Array.isArray(data.users) ? (data.users as Envelope[]) : [];
  return (
    <Card size="small" data-testid="account-list-card" title={<Space><TeamOutlined />本租户账号（{users.length}）</Space>}>
      <Table
        size="small"
        rowKey={(row) => String(row.user_id)}
        pagination={false}
        dataSource={users}
        columns={[
          { title: '账号', dataIndex: 'user_id', render: (value: unknown) => <code>{String(value)}</code> },
          { title: '姓名', dataIndex: 'display_name' },
          { title: '组织', dataIndex: 'org_id', render: (value: unknown) => String(value ?? '-') },
          {
            title: '角色',
            dataIndex: 'role_codes',
            render: (value: unknown) =>
              (Array.isArray(value) ? value : []).map((code) => roleTag(String(code))),
          },
        ]}
      />
    </Card>
  );
}

/**
 * 会话内渲染身份/账号工具结果（对话建账号、分配账号、账号列表）。
 *
 * 失败态由 ChatPanel 负责：失败的步骤（`status==='failed'` 或带 `error`）在 ChatPanel
 * 里整条走失败分支，本组件不会被挂载，也不会渲染原始 JSON。
 * 这里只渲染成功结果；一旦入参里没有可渲染的成功数据（created/users/user_id 都缺失，
 * 或只有失败原因），一律返回 null —— 绝不渲染空卡片、也不把失败伪装成成功。
 *
 * 流式事件里的 step.result 被后端 `summarize()` 裁掉了数组字段（role_codes/users），
 * 所以身份类工具改用 run_id 拉 `GET /runs/{id}` 读完整 outputs；其它工具用传入结果兜底。
 */
export function AccountToolArtifacts({
  result,
  runId,
  tool,
}: {
  result: unknown;
  runId?: string;
  tool?: string;
}) {
  const isIdentityTool = Boolean(tool && IDENTITY_TOOLS.has(tool));
  const runQuery = useQuery({
    queryKey: ['identity-account', runId, tool],
    queryFn: () => getLocalRun(runId as string),
    enabled: Boolean(isIdentityTool && runId),
    staleTime: 5 * 60 * 1000,
  });
  const fullResult = isIdentityTool && runId ? runQuery.data?.outputs?.[tool as string] : undefined;
  const data = unwrap(fullResult ?? result);
  if (!data) return null;
  const created = renderableRows(data.created);
  if (created.length > 1) return <BatchCreatedCard data={{ ...data, created }} />;
  const first = created[0];
  if (first) return <CreatedAccountCard data={first} />;
  if (hasText(data.user_id) && hasText(data.initial_password)) return <CreatedAccountCard data={data} />;
  if (renderableRows(data.users).length > 0) return <AccountListCard data={data} />;
  if (hasText(data.user_id) && Array.isArray(data.role_codes)) return <AssignedAccountCard data={data} />;
  return null;
}

export const ACCOUNT_ARTIFACT_HINT = (
  <Typography.Text type="secondary">
    厂长可以在会话里直接说「给张伟建一个工人账号」「把 worker001 调到装配班组」。
  </Typography.Text>
);
