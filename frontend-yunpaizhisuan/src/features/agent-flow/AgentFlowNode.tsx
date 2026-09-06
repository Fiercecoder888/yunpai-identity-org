import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Progress, Tag, Tooltip } from 'antd';
import { statusProgress, type AgentFlowReactNode } from './flowTransforms';
import styles from './AgentFlowPanel.module.css';

const statusColor: Record<AgentFlowReactNode['data']['status'], string> = {
  idle: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  waiting_human: 'warning',
};

const kindLabel: Record<AgentFlowReactNode['data']['nodeKind'], string> = {
  humanNode: '人工节点',
  riskNode: '风险节点',
  moduleNode: '模块节点',
};

const statusLabel: Record<AgentFlowReactNode['data']['status'], string> = {
  idle: '待启动',
  running: '运行中',
  success: '已接通',
  failed: '不可达',
  waiting_human: '需关注',
};

const implementationLabel = {
  real: { color: 'green', label: '真实接口' },
  hybrid: { color: 'gold', label: '部分 Mock' },
  mock: { color: 'default', label: 'Mock' },
} as const;

export function AgentFlowNode({ data, selected }: NodeProps<AgentFlowReactNode>) {
  const className = selected ? `${styles.node} ${styles.nodeSelected}` : styles.node;
  const implementation = data.implementation ? implementationLabel[data.implementation] : null;

  return (
    <Tooltip title={`${kindLabel[data.nodeKind]}：${data.module}`}>
      <div className={className} data-testid={`agent-flow-node-${data.module.toLowerCase()}`}>
        <Handle type="target" position={Position.Left} />
        <div className={styles.nodeHeader}>
          <span className={styles.nodeTitle}>{data.label}</span>
          <Tag color={statusColor[data.status]}>{statusLabel[data.status]}</Tag>
        </div>
        <div className={styles.nodeMeta}>
          {implementation ? <Tag color={implementation.color}>{implementation.label}</Tag> : null}
          <span>{data.summary}</span>
        </div>
        <Progress
          percent={statusProgress[data.status]}
          size="small"
          status={data.status === 'failed' ? 'exception' : data.status === 'success' ? 'success' : 'active'}
        />
        <Handle type="source" position={Position.Right} />
      </div>
    </Tooltip>
  );
}
