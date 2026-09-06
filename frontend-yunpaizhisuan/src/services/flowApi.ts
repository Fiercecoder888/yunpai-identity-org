import { flowGraphSchema } from '../schemas/flow';
import { getJob } from './orchestratorApi';
import { orchestratorJobToFlowGraph } from '../features/agent-flow/flowTransforms';
import { getModuleHealthChecks, isHealthyModuleStatus } from './moduleHealth';

const flowDefinitions = {
  m1: {
    implementation: 'real',
    summary: '识别 PDF、图纸和业务文档，输出可审核的结构化字段。',
    input: 'PDF、图纸、ZIP',
    output: '结构化识别结果',
  },
  m2: {
    implementation: 'real',
    summary: '调用 M2 统一工作流生成受控 BOM 与 SOP 工程草稿，并提供制品下载和人工确认问题。',
    input: '识别结果、历史资料、模板',
    output: 'BOM、SOP 制品',
  },
  m3: {
    implementation: 'real',
    summary: '展开 BOM，结合库存和在途数量计算缺料及采购建议。',
    input: 'BOM、订单、库存、在途',
    output: '采购计划、审批任务',
  },
  m4: {
    implementation: 'real',
    summary: '接收审批后的采购建议，生成采购单并跟踪供应商和预警。',
    input: '已审批采购建议',
    output: '采购单、交期和预警',
  },
  m5: {
    implementation: 'real',
    summary: '结合订单、资源和工艺约束生成 PMC 排程。',
    input: '订单、物料就绪状态、资源',
    output: '排程版本、工序计划',
  },
} as const;

export async function getAgentFlow() {
  const checks = await getModuleHealthChecks();
  const nodes = checks.map(({ target, status, reachable }) => ({
    id: target.id,
    label: target.name,
    module: target.id.toUpperCase(),
    status: !reachable ? 'failed' as const : isHealthyModuleStatus(status) ? 'success' as const : 'waiting_human' as const,
    ...flowDefinitions[target.id],
  }));

  return flowGraphSchema.parse({
    nodes,
    edges: [
      { id: 'm1-m2', source: 'm1', target: 'm2', label: '识别结果与需求' },
      { id: 'm2-m3', source: 'm2', target: 'm3', label: '受控 BOM' },
      { id: 'm3-m4', source: 'm3', target: 'm4', label: '审批后采购建议' },
      { id: 'm4-m5', source: 'm4', target: 'm5', label: '物料与交期状态' },
    ],
  });
}

export async function getAgentFlowFromJob(jobId: string) {
  const job = await getJob(jobId);
  return orchestratorJobToFlowGraph(job);
}
