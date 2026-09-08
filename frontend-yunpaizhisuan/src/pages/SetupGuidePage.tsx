import { SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Empty, Input, List, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeading } from '../components/PageHeading';
import { PermissionGate } from '../components/PermissionGate';
import {
  listGuidancePresets,
  sendGuidanceMessage,
  type GuidanceAssignment,
  type GuidancePlan,
  type GuidanceResponse,
} from '../features/org/guidanceApi';

type Bubble = { role: 'user' | 'ai'; text: string };

const SCALE_LABEL: Record<string, string> = {
  small: '小规模',
  medium: '中规模',
  large: '大规模',
};

/** 把扁平分配按 manager 串成层级列表（仅渲染，不落库）。 */
const buildHierarchy = (assignments: readonly GuidanceAssignment[]): Array<{ name: string; depth: number; assignment: GuidanceAssignment }> => {
  const byName = new Map(assignments.map((item) => [item.name, item]));
  const childrenOf = new Map<string, GuidanceAssignment[]>();
  const roots: GuidanceAssignment[] = [];
  for (const item of assignments) {
    const manager = item.manager && byName.has(item.manager) ? item.manager : '';
    if (!manager) {
      roots.push(item);
      continue;
    }
    const list = childrenOf.get(manager) ?? [];
    list.push(item);
    childrenOf.set(manager, list);
  }
  const rows: Array<{ name: string; depth: number; assignment: GuidanceAssignment }> = [];
  const walk = (item: GuidanceAssignment, depth: number) => {
    rows.push({ name: item.name, depth, assignment: item });
    for (const child of childrenOf.get(item.name) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // 环形 manager 兜底：未走到的补在末尾
  for (const item of assignments) {
    if (!rows.some((row) => row.name === item.name)) rows.push({ name: item.name, depth: 0, assignment: item });
  }
  return rows;
};

/**
 * 架构设计引导页（厂长角色页）。
 *
 * 与 PR #6 的 `/api/guidance/chat` 对话：先选规模 → 模型给三套部门名单 →
 * 选定后模型产出部门 + 人员分配（含汇报关系）→ 对话增删改 → 「就这样」才落地。
 * 红线：确认前不写库。
 */
export function SetupGuidePage() {
  const { message } = App.useApp();
  const presetsQuery = useQuery({ queryKey: ['guidance', 'presets'], queryFn: listGuidancePresets });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [guidanceState, setGuidanceState] = useState<unknown>(undefined);
  const [plan, setPlan] = useState<GuidancePlan | null>(null);
  const [scaleDepartments, setScaleDepartments] = useState<Record<string, string[]>>({});
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [applied, setApplied] = useState<GuidanceResponse['applied']>(null);
  const [input, setInput] = useState('');

  const sendMutation = useMutation({
    mutationFn: sendGuidanceMessage,
    onSuccess: (result, variables) => {
      setBubbles((prev) => [...prev, { role: 'ai', text: result.reply }]);
      setGuidanceState(result.state);
      setPlan(result.plan);
      setScaleDepartments(result.scale_departments ?? {});
      setOptions(result.options ?? []);
      if (result.applied) setApplied(result.applied);
      if (result.done) message.success('组织架构与账号分配已落地');
      if (!result.reply && !result.plan) {
        message.warning('引导模型没有返回内容，请检查 QWEN_BASE_URL/QWEN_MODEL 配置');
      }
      void variables;
    },
    onError: (error) => message.error(`引导对话失败：${error instanceof Error ? error.message : String(error)}`),
  });

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBubbles((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    sendMutation.mutate({ message: trimmed, state: guidanceState });
  };

  const hierarchy = plan ? buildHierarchy(plan.assignments) : [];

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <PageHeading path="/setup" />
      <PermissionGate permission="system:setup" auditModule="SetupGuide" targetId="setup-page">
        <Card
          title="架构设计引导"
          extra={
            <Typography.Text type="secondary">
              模型定内容 · 代码做模板 · 确认前不写库
            </Typography.Text>
          }
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Typography.Text type="secondary">1. 先选公司规模</Typography.Text>
              <Space wrap style={{ marginTop: 8 }}>
                {(presetsQuery.data?.presets ?? []).map((preset) => (
                  <Button
                    key={preset.value}
                    onClick={() => ask(preset.label)}
                    loading={sendMutation.isPending && sendMutation.variables?.message === preset.label}
                  >
                    {preset.label}
                  </Button>
                ))}
                {presetsQuery.isLoading ? <Typography.Text type="secondary">加载中…</Typography.Text> : null}
              </Space>
            </div>

            {Object.keys(scaleDepartments).length ? (
              <div>
                <Typography.Text type="secondary">2. 选一套部门名单（AI 按规模给的建议）</Typography.Text>
                <Space wrap style={{ marginTop: 8 }} data-testid="scale-departments">
                  {Object.entries(scaleDepartments).map(([scale, departments]) => (
                    <Card key={scale} size="small" style={{ width: 260 }}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Typography.Text strong>{SCALE_LABEL[scale] ?? scale}</Typography.Text>
                        <div>
                          {departments.map((department) => (
                            <Tag key={department}>{department}</Tag>
                          ))}
                        </div>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => ask(`${SCALE_LABEL[scale] ?? scale}：${departments.join('、')}`)}
                        >
                          用这套
                        </Button>
                      </Space>
                    </Card>
                  ))}
                </Space>
              </div>
            ) : null}

            <div>
              <Typography.Text type="secondary">3. 与 AI 对话调整（加/删部门、调角色、改汇报关系）</Typography.Text>
              <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                <Input
                  value={input}
                  placeholder="如：加一个品质部；把张三改成组长，汇报给李四"
                  onChange={(event) => setInput(event.target.value)}
                  onPressEnter={() => ask(input)}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sendMutation.isPending}
                  onClick={() => ask(input)}
                >
                  发送
                </Button>
              </Space.Compact>
            </div>

            {bubbles.length ? (
              <List
                data-testid="guidance-bubbles"
                size="small"
                bordered
                dataSource={bubbles}
                renderItem={(bubble) => (
                  <List.Item>
                    <Space align="start">
                      <Tag color={bubble.role === 'user' ? 'blue' : 'green'}>
                        {bubble.role === 'user' ? '你' : 'AI'}
                      </Tag>
                      <Typography.Text>{bubble.text}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : null}

            {plan ? (
              <Card
                size="small"
                title={`4. 当前方案（${plan.departments.length} 个部门 / ${plan.assignments.length} 人）`}
                extra={
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={() => ask('就这样')}
                    loading={sendMutation.isPending && sendMutation.variables?.message === '就这样'}
                  >
                    就这样，落地
                  </Button>
                }
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div>
                    {plan.departments.map((department) => (
                      <Tag key={department} color="blue">
                        {department}
                      </Tag>
                    ))}
                  </div>
                  {hierarchy.length ? (
                    <List
                      data-testid="guidance-hierarchy"
                      size="small"
                      dataSource={hierarchy}
                      renderItem={(row) => (
                        <List.Item>
                          <Space>
                            <span style={{ paddingLeft: row.depth * 18 }} />
                            <Typography.Text strong={row.depth === 0}>{row.name}</Typography.Text>
                            <Tag>{row.assignment.dept || '未分配部门'}</Tag>
                            {row.assignment.roles.map((role) => (
                              <Tag key={role} color="green">
                                {plan.role_names?.[role] ?? role}
                              </Tag>
                            ))}
                          </Space>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Typography.Text type="secondary">还没有分配人员</Typography.Text>
                  )}
                </Space>
              </Card>
            ) : (
              <Empty description="先选规模，再让 AI 生成部门与人员分配" />
            )}

            {applied ? (
              <Alert
                type="success"
                showIcon
                message={`已落地：${applied.departments} 个部门、${applied.bindings} 条人员分配`}
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text>部门：{applied.departments_list.join('、')}</Typography.Text>
                    <Typography.Text type="secondary">
                      落地后的结构标记为「手工」，花名册派生不会覆盖它。
                    </Typography.Text>
                  </Space>
                }
              />
            ) : null}

            {options.length ? (
              <Space wrap>
                {options.map((option) => (
                  <Button key={option.value} onClick={() => ask(option.value)}>
                    {option.label}
                  </Button>
                ))}
              </Space>
            ) : null}
          </Space>
        </Card>
      </PermissionGate>
    </Space>
  );
}
