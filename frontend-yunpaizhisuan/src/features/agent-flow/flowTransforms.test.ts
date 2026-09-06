import { describe, expect, it } from 'vitest';
import { deriveAgentFlowNodeKind, orchestratorJobToFlowGraph, toAgentFlowElements } from './flowTransforms';
import type { FlowGraph } from '../../schemas/flow';

const graph: FlowGraph = {
  nodes: [
    { id: 'm1', label: 'M1 多模态识别', module: 'M1', status: 'waiting_human' },
    { id: 'processor', label: '通用处理节点', module: 'Test', status: 'running' },
    { id: 'review', label: '通用复核节点', module: 'Test', status: 'failed' },
  ],
  edges: [
    { id: 'input-processor', source: 'm1', target: 'processor' },
    { id: 'processor-review', source: 'processor', target: 'review' },
  ],
};

describe('flowTransforms', () => {
  it('derives custom node kinds from status', () => {
    expect(deriveAgentFlowNodeKind('waiting_human')).toBe('humanNode');
    expect(deriveAgentFlowNodeKind('failed')).toBe('riskNode');
    expect(deriveAgentFlowNodeKind('running')).toBe('moduleNode');
  });

  it('maps graph schema into React Flow nodes and filtered edges', () => {
    const elements = toAgentFlowElements(graph, 'running');

    expect(elements.nodes).toEqual([
      expect.objectContaining({
        id: 'processor',
        type: 'moduleNode',
        data: expect.objectContaining({ status: 'running' }),
      }),
    ]);
    expect(elements.edges).toEqual([]);
  });

  it('maps orchestrator job steps into a flow graph', () => {
    const flow = orchestratorJobToFlowGraph({
      job_id: 'job-1',
      status: 'partial',
      tools: ['list_m5_schedules', 'solve_scheduling'],
      tools_to_use: ['list_m5_schedules', 'solve_scheduling'],
      session_id: 'session-1',
      steps: [
        { tool: 'list_m5_schedules', status: 'ok', duration_ms: 12 },
        { tool: 'solve_scheduling', status: 'partial', duration_ms: 20 },
      ],
    });

    expect(flow.nodes).toEqual([
      expect.objectContaining({
        id: 'list_m5_schedules-0',
        label: 'list_m5_schedules',
        status: 'success',
      }),
      expect.objectContaining({
        id: 'solve_scheduling-1',
        label: 'solve_scheduling',
        status: 'waiting_human',
      }),
    ]);
    expect(flow.edges).toEqual([{
      id: 'list_m5_schedules-0-solve_scheduling-1',
      source: 'list_m5_schedules-0',
      target: 'solve_scheduling-1',
    }]);
  });
});
