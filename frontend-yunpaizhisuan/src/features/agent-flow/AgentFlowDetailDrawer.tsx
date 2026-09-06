import { Button, Descriptions, Drawer, Empty, Progress, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useWorkbenchStore } from '../../store/useWorkbenchStore';
import type { FlowGraph } from '../../schemas/flow';
import { deriveAgentFlowNodeKind, statusProgress } from './flowTransforms';
import styles from './AgentFlowPanel.module.css';

type AgentFlowDetailDrawerProps = {
  graph?: FlowGraph;
};

const moduleRoutes: Record<string, string> = {
  M1: '/modules/m0-review',
  M2: '/modules/bom-review',
  M3: '/modules/m3-procurement',
  M4: '/modules/purchase-warnings',
  M5: '/modules/schedule',
};

const implementationLabel = {
  real: '真实接口',
  hybrid: '真实后端 + Mock 页面',
  mock: 'Mock 演示',
} as const;

export function AgentFlowDetailDrawer({ graph }: AgentFlowDetailDrawerProps) {
  const navigate = useNavigate();
  const selectedFlowNodeId = useWorkbenchStore((state) => state.selectedFlowNodeId);
  const setSelectedFlowNodeId = useWorkbenchStore((state) => state.setSelectedFlowNodeId);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedFlowNodeId) ?? null;
  const nodeKind = selectedNode ? deriveAgentFlowNodeKind(selectedNode.status) : null;
  const moduleRoute = selectedNode ? moduleRoutes[selectedNode.module] : undefined;

  return (
    <Drawer title="节点详情" open={selectedFlowNodeId !== null} onClose={() => setSelectedFlowNodeId(null)} width={420}>
      {selectedNode && nodeKind ? (
        <Space direction="vertical" size={16} className={styles.drawerStack}>
          <Typography.Title level={4}>{selectedNode.label}</Typography.Title>
          <Space>
            <Tag>{selectedNode.module}</Tag>
            <Tag color={selectedNode.status === 'failed' ? 'error' : selectedNode.status === 'waiting_human' ? 'warning' : 'processing'}>
              {selectedNode.status}
            </Tag>
          </Space>
          <Progress percent={statusProgress[selectedNode.status]} status={selectedNode.status === 'failed' ? 'exception' : 'active'} />
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="节点类型">{nodeKind === 'humanNode' ? '人工节点' : nodeKind === 'riskNode' ? '风险节点' : '模块节点'}</Descriptions.Item>
            <Descriptions.Item label="节点 ID">{selectedNode.id}</Descriptions.Item>
            <Descriptions.Item label="模块">{selectedNode.module}</Descriptions.Item>
            <Descriptions.Item label="实现状态">
              {selectedNode.implementation ? implementationLabel[selectedNode.implementation] : '未标记'}
            </Descriptions.Item>
            <Descriptions.Item label="职责">{selectedNode.summary ?? '未提供'}</Descriptions.Item>
            <Descriptions.Item label="输入">{selectedNode.input ?? '未提供'}</Descriptions.Item>
            <Descriptions.Item label="输出">{selectedNode.output ?? '未提供'}</Descriptions.Item>
          </Descriptions>
          {moduleRoute ? (
            <Button
              type="primary"
              onClick={() => {
                navigate(moduleRoute);
                setSelectedFlowNodeId(null);
              }}
            >
              进入 {selectedNode.label}
            </Button>
          ) : null}
        </Space>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择节点" />
      )}
    </Drawer>
  );
}
