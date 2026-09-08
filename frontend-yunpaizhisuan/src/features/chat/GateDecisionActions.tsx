import { Space } from 'antd';
import { Button } from 'antd';
import { useState } from 'react';
import { useChatStore } from '../../store/useChatStore';

/**
 * 会话内「计划确认」：Agent 在人工 Gate 暂停后，把决策动作直接嵌入会话消息，
 * 用户在对话流里选择「批准执行 / 补充后重试 / 终止」，无需跳出到右侧弹窗。
 * 交互对齐 Claude Code / codex 的计划模式：先看分析与建议，再在会话中点选。
 */

const gateActionKind = (label: string): 'approve' | 'retry' | 'reject' => {
  if (/终止|拒绝|停止|取消|reject|deny|abort/i.test(label)) return 'reject';
  if (/补充|修改|重试|重排|修正|retry|revise/i.test(label)) return 'retry';
  return 'approve';
};

export function GateDecisionActions({
  messageId,
  runId,
  gate,
  compact = false,
}: {
  messageId: string;
  runId: string;
  gate: Record<string, unknown>;
  /** 紧凑模式：用于会话内消息卡片（Gate 记录下方）。 */
  compact?: boolean;
}) {
  const resumeGate = useChatStore((state) => state.resumeGate);
  const [supplementText, setSupplementText] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const actions = Array.isArray(gate.actions) ? gate.actions.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
  const visibleActions = actions.length ? actions : ['终止', '补充后重试', '批准执行'];
  const isM2DataGate = String(gate.module ?? '').toLowerCase() === 'm2' && String(gate.type ?? '').toLowerCase() === 'data';

  const decide = async (decision: 'approve' | 'retry' | 'reject') => {
    setError('');
    const text = supplementText.trim();
    if (decision === 'retry' && gate.type === 'data' && !text) {
      setError(isM2DataGate ? 'M2 需要产品编码和至少一条已确认 BOM 行。' : '请先补充信息后再重试。');
      return;
    }
    let supplement: Record<string, unknown> | undefined;
    if (decision === 'retry' && text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (isM2DataGate) {
          const value = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
          const product = value.product && typeof value.product === 'object' && !Array.isArray(value.product) ? value.product as Record<string, unknown> : {};
          const productCode = String(product.product_code ?? value.product_code ?? '').trim();
          const bomLines = value.bom_lines ?? (value.bom && typeof value.bom === 'object' && !Array.isArray(value.bom) ? (value.bom as Record<string, unknown>).lines : undefined);
          if (!productCode || !Array.isArray(bomLines) || bomLines.length === 0) {
            setError('M2 输入格式不完整：需要 product_code 和非空 bom_lines。');
            return;
          }
          supplement = { ...value, product: { ...product, product_code: productCode }, bom_lines: bomLines };
        } else {
          supplement = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : { human_message: text };
        }
      } catch {
        if (isM2DataGate) {
          setError('M2 请使用 JSON 提供 product_code 和 bom_lines，例如 {"product_code":"P-100","bom_lines":[{"material_code":"MAT-1","quantity":1}]}。');
          return;
        }
        supplement = { human_message: text };
      }
    }
    setSubmitting(true);
    try {
      await resumeGate(messageId, runId, decision, supplement);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '人工决定提交失败');
      setSubmitting(false);
    }
  };

  return (
    <div className={compact ? 'chat-gate-actions chat-gate-actions-compact' : 'chat-gate-actions'}>
      <label className="local-gate-label">你的决定（补充信息可选，重试时必填）：</label>
      <textarea
        aria-label="给 AI 的补充或追问"
        value={supplementText}
        onChange={(event) => setSupplementText(event.target.value)}
        placeholder={isM2DataGate ? '{"product_code":"P-100","bom_lines":[{"material_code":"MAT-1","quantity":1}]}' : '补充信息（可选）'}
        rows={2}
        disabled={submitting}
      />
      {error ? <div className="local-gate-error" role="alert">{error}</div> : null}
      <Space wrap className="local-gate-actions">
        {visibleActions.map((label) => {
          const kind = gateActionKind(label);
          return (
            <Button
              key={label}
              size="small"
              danger={kind === 'reject'}
              type={kind === 'approve' ? 'primary' : 'default'}
              loading={submitting}
              disabled={submitting}
              onClick={() => void decide(kind)}
            >
              {label}
            </Button>
          );
        })}
      </Space>
    </div>
  );
}
