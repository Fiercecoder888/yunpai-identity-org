import type { Edge, Node } from '@xyflow/react';
import type { FlowGraph } from '../../schemas/flow';
import type { OrchestratorJob } from '../../schemas/orchestrator';
import type { FlowStatusFilter } from '../../store/useWorkbenchStore';

export type AgentNodeStatus = FlowGraph['nodes'][number]['status'];
export type AgentFlowNodeKind = 'humanNode' | 'riskNode' | 'moduleNode';

export type AgentFlowNodeData = {
  label: string;
  module: string;
  status: AgentNodeStatus;
  nodeKind: AgentFlowNodeKind;
  implementation?: FlowGraph['nodes'][number]['implementation'];
  summary?: string;
};

export type AgentFlowReactNode = Node<AgentFlowNodeData, AgentFlowNodeKind>;

export const statusProgress: Record<AgentNodeStatus, number> = {
  idle: 0,
  running: 56,
  success: 100,
  failed: 100,
  waiting_human: 72,
};

export const deriveAgentFlowNodeKind = (status: AgentNodeStatus): AgentFlowNodeKind => {
  if (status === 'waiting_human') {
    return 'humanNode';
  }
  if (status === 'failed') {
    return 'riskNode';
  }
  return 'moduleNode';
};

export const toAgentFlowElements = (graph: FlowGraph, statusFilter: FlowStatusFilter = 'all') => {
  const visibleNodes = graph.nodes.filter((node) => statusFilter === 'all' || node.status === statusFilter);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  const nodes: AgentFlowReactNode[] = visibleNodes.map((node, index) => {
    const nodeKind = deriveAgentFlowNodeKind(node.status);
    return {
      id: node.id,
      type: nodeKind,
      position: { x: index * 250, y: 80 },
      data: {
        label: node.label,
        module: node.module,
        status: node.status,
        nodeKind,
        implementation: node.implementation,
        summary: node.summary,
      },
    };
  });

  const edges: Edge[] = graph.edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: true,
      label: edge.label,
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 4,
      style: { strokeWidth: 2 },
    }));

  return { nodes, edges };
};

const toFlowStatus = (status: OrchestratorJob['steps'][number]['status']): AgentNodeStatus => {
  if (status === 'done' || status === 'ok' || status === 'success') {
    return 'success';
  }
  if (status === 'queued' || status === 'idle') {
    return 'idle';
  }
  if (status === 'partial') {
    return 'waiting_human';
  }
  if (status === 'cancelled') {
    return 'failed';
  }
  return status;
};

export const orchestratorJobToFlowGraph = (job: OrchestratorJob): FlowGraph => {
  const nodes = job.steps.map((step, index) => ({
    id: step.id ?? `${step.tool ?? 'step'}-${index}`,
    label: step.name ?? step.tool ?? step.module ?? `Step ${index + 1}`,
    module: step.module ?? 'orchestrator',
    status: toFlowStatus(step.status),
  }));

  const edges = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index]!.id}-${node.id}`,
    source: nodes[index]!.id,
    target: node.id,
  }));

  return { nodes, edges };
};
