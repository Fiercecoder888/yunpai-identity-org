import { m2ParsedSopSchema, m2ProductWorkflowSchema, type M2ProductWorkflow } from '../../schemas/m2';
import { readM2ArtifactJson } from '../../services/m2Api';

export const M2_WORKFLOW_QUERY_KEY = ['m2', 'latest-product-workflow'] as const;
export const M2_WORKFLOW_STORAGE_KEY = 'yunpai:m2:latest-product-workflow';

export type M2WorkflowFormValues = {
  productName: string;
  productCode: string;
  productFamily: string;
  specificationSummary: string;
  requirementText: string;
  station: string;
  documentNo: string;
  routingStepsText: string;
  machineHintsText: string;
  useModel: boolean;
};

export const defaultM2WorkflowValues: M2WorkflowFormValues = {
  productName: 'USB-C 1M 黑色零售数据线',
  productCode: 'FG-USBC-1M-BLK',
  productFamily: 'USB-C 数据线',
  specificationSummary: '1M 黑色 USB-C 数据线，PE 袋、标签和纸箱包装',
  requirementText: '生成受控 BOM 草稿和 80806-129 风格包装 SOP，缺失的现场事实保持待人工确认。',
  station: '包装工站',
  documentNo: 'SOP-USBC-1M-BLK-001',
  routingStepsText: '来料核对\n线材盘绕\n扎带固定\n装 PE 袋\n标签检查\n装箱',
  machineHintsText: '封口机; 标签打印机; 电子秤',
  useModel: false,
};

export function buildM2WorkflowPayload(values: M2WorkflowFormValues) {
  return {
    requirement_text: values.requirementText,
    product_profile: {
      product_name: values.productName,
      product_code: values.productCode,
      product_family: values.productFamily,
      specification_summary: values.specificationSummary,
      target_bom_type: 'EBOM',
    },
    use_demo_sources: true,
    template_confirmation: {
      confirmed: true,
      bom_template_id: 'source-style-product-component-v1',
      numbering_policy_id: 'cable-accessory-v1',
      confirmed_by: 'yunpai_frontend',
    },
    routing_steps_text: values.routingStepsText,
    station: values.station,
    document_no: values.documentNo,
    machine_hints_text: values.machineHintsText,
    enable_bom_model: values.useModel,
    enable_sop_model: values.useModel,
    strict_model: false,
    ingest_generated: true,
    run_id: `frontend-${values.productCode}-${Date.now()}`,
  };
}

export function parseM2Workflow(payload: unknown) {
  return m2ProductWorkflowSchema.parse(payload);
}

export function loadStoredM2Workflow(): M2ProductWorkflow | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(M2_WORKFLOW_STORAGE_KEY);
    return stored ? parseM2Workflow(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function storeM2Workflow(workflow: M2ProductWorkflow) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(M2_WORKFLOW_STORAGE_KEY, JSON.stringify(workflow));
  } catch {
    // The in-memory React Query result remains usable when storage is unavailable.
  }
}

export function getArtifactFileName(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? 'm2-artifact';
}

export async function loadM2ParsedSop(path: string) {
  return m2ParsedSopSchema.parse(await readM2ArtifactJson(path));
}
