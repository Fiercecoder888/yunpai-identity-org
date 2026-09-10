import { ThunderboltOutlined } from '@ant-design/icons';
import { Alert, App, Button, Empty, Input, Modal, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../auth/useAuthStore';
import {
  clearOrgGuidePending,
  isOrgGuidePending,
  listGuidancePresets,
  sendGuidanceMessage,
  type GuidancePlan,
  type GuidanceResponse,
} from './guidanceApi';

type Bubble = { role: 'user' | 'ai'; text: string };

const SCALE_LABEL: Record<string, string> = {
  small: '小规模',
  medium: '中规模',
  large: '大规模',
};

/**
 * 挂在 `AuthBoundary` 上的组织推荐闸：登录态就绪且满足以下任一条件时弹出
 * 1. localStorage 有待办标记（注册成功那一次）；
 * 2. URL 带 `?org-guide=1`（测试/演示用，可随时重开，不需要空库）。
 *
 * 注意不能挂在 `WorkbenchLayout`——厂长落地页是对话页，它不在 WorkbenchLayout 里。
 */
export function OrgGuideGate() {
  const me = useAuthStore((state) => state.me);
  const [open, setOpen] = useState(false);
  const canManageIdentity = (me?.permissions ?? []).includes('identity.admin');
  useEffect(() => {
    if (!canManageIdentity) return;
    const params = new URLSearchParams(window.location.search);
    const forced = params.get('org-guide') === '1';
    if (!forced && !isOrgGuidePending()) return;
    setOpen(true);
    if (forced) {
      // 清掉参数，避免每次刷新都弹；想再开就再加一次 ?org-guide=1
      params.delete('org-guide');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
  }, [canManageIdentity]);
  if (!canManageIdentity) return null;
  return <OrgRecommendationModal open={open} onDone={() => setOpen(false)} />;
}

/**
 * 注册完成后的「组织架构推荐」步骤（可跳过）。
 *
 * 流程：厂长注册成功 → 弹出本步骤 → 选公司规模 → AI 给出部门清单与人员分配
 * → 可继续对话增删改 → 点「就这样，落地」才写库；点「跳过」或关闭则直接进会话页。
 * 红线：未点落地前不写库。
 */
export function OrgRecommendationModal({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { message } = App.useApp();
  const presetsQuery = useQuery({
    queryKey: ['guidance', 'presets'],
    queryFn: listGuidancePresets,
    enabled: open,
    retry: false,
  });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [guidanceState, setGuidanceState] = useState<unknown>(undefined);
  const [plan, setPlan] = useState<GuidancePlan | null>(null);
  const [scaleDepartments, setScaleDepartments] = useState<Record<string, string[]>>({});
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [applied, setApplied] = useState<GuidanceResponse['applied']>(null);
  const [input, setInput] = useState('');

  const close = () => {
    clearOrgGuidePending();
    onDone();
  };

  const sendMutation = useMutation({
    mutationFn: sendGuidanceMessage,
    onSuccess: (result) => {
      if (result.reply) setBubbles((prev) => [...prev, { role: 'ai', text: result.reply }]);
      setGuidanceState(result.state);
      setPlan(result.plan);
      setScaleDepartments(result.scale_departments ?? {});
      setOptions(result.options ?? []);
      if (result.applied) setApplied(result.applied);
      if (result.done) {
        message.success('组织架构已落地');
      }
      if (!result.reply && !result.plan) {
        message.warning('引导模型没有返回内容，请检查后端 QWEN_BASE_URL / QWEN_MODEL 配置');
      }
    },
    onError: (error) =>
      message.error(`引导对话失败：${error instanceof Error ? error.message : String(error)}`),
  });

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBubbles((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    sendMutation.mutate({ message: trimmed, state: guidanceState });
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      width={720}
      title="要不要让 AI 推荐一套组织架构？"
      data-testid="org-recommendation-modal"
      footer={[
        <Button key="skip" onClick={close} data-testid="org-guide-skip">
          跳过，直接进对话
        </Button>,
        applied ? (
          <Button key="done" type="primary" onClick={close}>
            进入对话
          </Button>
        ) : null,
      ]}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          先选公司规模，AI 会给出部门清单与人员分配建议；你可以继续对话增删改，
          确认后才会写进组织架构。不选也没关系，直接跳过即可。
        </Typography.Text>

        {applied ? (
          <Alert
            type="success"
            showIcon
            message={`已落地：${applied.departments} 个部门、${applied.bindings} 条人员分配`}
            description={
              <Typography.Text type="secondary">
                部门：{applied.departments_list.join('、')}。后续可在「管理 → 组织架构」里继续调整。
              </Typography.Text>
            }
          />
        ) : (
          <>
            <div>
              <Typography.Text type="secondary">1. 公司规模</Typography.Text>
              <Space wrap style={{ marginTop: 8 }}>
                {(presetsQuery.data?.presets ?? []).map((preset) => (
                  <Button
                    key={preset.value}
                    data-testid={`org-guide-scale-${preset.value}`}
                    loading={sendMutation.isPending && sendMutation.variables?.message === preset.label}
                    onClick={() => ask(preset.label)}
                  >
                    {preset.label}
                  </Button>
                ))}
                {presetsQuery.isLoading ? <Typography.Text type="secondary">加载中…</Typography.Text> : null}
              </Space>
            </div>

            {Object.keys(scaleDepartments).length ? (
              <div>
                <Typography.Text type="secondary">2. 选一套部门名单</Typography.Text>
                <Space wrap style={{ marginTop: 8 }}>
                  {Object.entries(scaleDepartments).map(([scale, departments]) => (
                    <Space key={scale} direction="vertical" size={6}>
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
                  ))}
                </Space>
              </div>
            ) : null}

            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={input}
                placeholder="如：加一个品质部；把张伟改成组长"
                onChange={(event) => setInput(event.target.value)}
                onPressEnter={() => ask(input)}
              />
              <Button type="primary" loading={sendMutation.isPending} onClick={() => ask(input)}>
                发送
              </Button>
            </Space.Compact>

            {bubbles.length ? (
              <Space direction="vertical" size={6} style={{ width: '100%' }} data-testid="org-guide-bubbles">
                {bubbles.map((bubble, index) => (
                  <Space key={`${bubble.role}-${index}`} align="start">
                    <Tag color={bubble.role === 'user' ? 'blue' : 'green'}>
                      {bubble.role === 'user' ? '你' : 'AI'}
                    </Tag>
                    <Typography.Text>{bubble.text}</Typography.Text>
                  </Space>
                ))}
              </Space>
            ) : null}

            {plan ? (
              <div>
                <Space wrap>
                  {plan.departments.map((department) => (
                    <Tag key={department} color="blue">
                      {department}
                    </Tag>
                  ))}
                </Space>
                <div style={{ marginTop: 10 }}>
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    data-testid="org-guide-apply"
                    loading={sendMutation.isPending && sendMutation.variables?.message === '就这样'}
                    onClick={() => ask('就这样')}
                  >
                    就这样，落地
                  </Button>
                </div>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选一个规模，或直接跳过" />
            )}

            {options.length ? (
              <Space wrap>
                {options.map((option) => (
                  <Button key={option.value} onClick={() => ask(option.value)}>
                    {option.label}
                  </Button>
                ))}
              </Space>
            ) : null}
          </>
        )}
      </Space>
    </Modal>
  );
}
