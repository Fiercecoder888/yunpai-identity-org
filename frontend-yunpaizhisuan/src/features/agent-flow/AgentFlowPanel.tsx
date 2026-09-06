import { Alert, Card, Select, Space, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getAgentFlow } from '../../services/flowApi';
import { PageState } from '../../components/PageState';
import { useWorkbenchStore, type FlowStatusFilter } from '../../store/useWorkbenchStore';
import { AgentFlowCanvas } from './AgentFlowCanvas';
import { AgentFlowDetailDrawer } from './AgentFlowDetailDrawer';
import styles from './AgentFlowPanel.module.css';

const filterOptions: Array<{ label: string; value: FlowStatusFilter }> = [
  { label: '全部状态', value: 'all' },
  { label: '等待人工', value: 'waiting_human' },
  { label: '运行中', value: 'running' },
  { label: '已成功', value: 'success' },
  { label: '失败风险', value: 'failed' },
  { label: '空闲', value: 'idle' },
];

export function AgentFlowPanel() {
  const query = useQuery({ queryKey: ['agent-flow'], queryFn: getAgentFlow });
  const flowStatusFilter = useWorkbenchStore((state) => state.flowStatusFilter);
  const setFlowStatusFilter = useWorkbenchStore((state) => state.setFlowStatusFilter);

  return (
    <Card
      title="订单到排程 协作流程"
      extra={
        <Space size={4}>
          <Tag color="green">真实接口</Tag>
          <Tag color="gold">部分 Mock</Tag>
        </Space>
      }
    >
      <div className={styles.toolbar}>
        <Select<FlowStatusFilter>
          aria-label="流程状态筛选"
          value={flowStatusFilter}
          options={filterOptions}
          onChange={setFlowStatusFilter}
          style={{ width: 160 }}
        />
      </div>
      <PageState loading={query.isLoading} error={query.error} empty={query.data?.nodes.length === 0}>
        {query.data ? <AgentFlowCanvas graph={query.data} /> : null}
        <Alert
          type="info"
          showIcon
          message="流程展示模块间的数据交接方式"
          description="节点状态来自 订单到排程 实时健康接口，不代表单个订单的执行进度；点击节点可查看输入、输出和实现状态。"
        />
      </PageState>
      <AgentFlowDetailDrawer graph={query.data} />
    </Card>
  );
}
