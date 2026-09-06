import { Background, Controls, ReactFlow, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { useWorkbenchStore } from '../../store/useWorkbenchStore';
import type { FlowGraph } from '../../schemas/flow';
import { AgentFlowNode } from './AgentFlowNode';
import { toAgentFlowElements } from './flowTransforms';
import styles from './AgentFlowPanel.module.css';

const nodeTypes: NodeTypes = {
  humanNode: AgentFlowNode,
  riskNode: AgentFlowNode,
  moduleNode: AgentFlowNode,
};

type AgentFlowCanvasProps = {
  graph: FlowGraph;
};

export function AgentFlowCanvas({ graph }: AgentFlowCanvasProps) {
  const flowStatusFilter = useWorkbenchStore((state) => state.flowStatusFilter);
  const flowViewport = useWorkbenchStore((state) => state.flowViewport);
  const setFlowViewport = useWorkbenchStore((state) => state.setFlowViewport);
  const setSelectedFlowNodeId = useWorkbenchStore((state) => state.setSelectedFlowNodeId);
  const { nodes, edges } = useMemo(() => toAgentFlowElements(graph, flowStatusFilter), [graph, flowStatusFilter]);

  return (
    <div className={styles.canvas} data-testid="agent-flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={flowViewport}
        fitView
        onNodeClick={(_, node) => setSelectedFlowNodeId(node.id)}
        onMoveEnd={(_, viewport) => setFlowViewport(viewport)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
