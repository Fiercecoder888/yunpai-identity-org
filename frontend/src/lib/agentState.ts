import type { Activity, ChatMessage, Gate, RunState, Step, StreamEvent } from './types';
import { MODULES } from './types';

export type AgentUiState = {
  runId: string;
  taskId: string;
  status: RunState['status'];
  route: string;
  plan: RunState['plan'];
  nextStepIndex: number;
  currentStep: string;
  steps: RunState['steps'];
  outputs: RunState['outputs'];
  pendingGate: Gate | null;
  response: string;
  error?: string;
  uploadSummary?: Record<string, any>;
  messages: ChatMessage[];
  activity: Activity[];
};

export const emptyAgentState = (): AgentUiState => ({
  runId: '', taskId: '', status: 'queued', route: '', plan: [], nextStepIndex: 0, currentStep: '', steps: [], outputs: {},
  pendingGate: null, response: '', messages: [], activity: [],
});

function asArray<T>(value: unknown, fallback: T[]): T[] { return Array.isArray(value) ? value as T[] : fallback; }
function asObject<T extends Record<string, unknown>>(value: unknown, fallback: T): T { return value && typeof value === 'object' && !Array.isArray(value) ? value as T : fallback; }

export function mergeRunState(current: AgentUiState, state: RunState): AgentUiState {
  return {
    ...current,
    runId: state.run_id || current.runId,
    taskId: state.task_id || current.taskId,
    status: state.status ?? current.status,
    route: state.route ?? current.route,
    plan: asArray<Step>(state.plan, current.plan ?? []),
    nextStepIndex: state.next_step_index ?? current.nextStepIndex,
    currentStep: state.current_step ?? current.currentStep,
    steps: asArray<Step>(state.steps, current.steps ?? []),
    outputs: asObject<Record<string, any>>(state.outputs, current.outputs ?? {}),
    pendingGate: state.pending_gate && typeof state.pending_gate === 'object' && !Array.isArray(state.pending_gate) ? state.pending_gate : null,
    response: state.response ?? current.response,
    uploadSummary: state.upload_summary && typeof state.upload_summary === 'object' ? state.upload_summary as Record<string, any> : current.uploadSummary,
    error: Array.isArray(state.errors) && state.errors.at(-1)?.message ? String(state.errors.at(-1)?.message) : current.error,
  };
}

export function applyEvent(current: AgentUiState, event: StreamEvent): AgentUiState {
  let next = { ...current, runId: event.run_id || current.runId, taskId: event.task_id || current.taskId };
  if (event.state) next = mergeRunState(next, event.state);
  switch (event.type) {
    case 'assistant_delta': {
      const existing = next.messages.find((message) => message.id === 'assistant-live');
      const content = `${existing?.content ? `${existing.content}\n` : ''}${event.content ?? ''}`;
      next.messages = existing
        ? next.messages.map((message) => message.id === 'assistant-live' ? { ...message, content } : message)
        : [...next.messages, { id: 'assistant-live', role: 'assistant', content }];
      next.activity = [...next.activity, { id: `${event.at}-assistant`, kind: 'planner', label: 'Agent 状态', detail: event.content ?? '', status: 'running' }];
      break;
    }
    case 'step_start':
      if (event.step) {
        next.currentStep = event.step.tool;
        next.activity = [...next.activity, { id: event.step.id, kind: 'step', label: `${event.step.module.toUpperCase()} 执行`, detail: event.step.tool, status: 'running', module: event.step.module }];
      }
      break;
    case 'step_result':
      if (event.step) {
        const steps = next.steps ?? [];
        next.steps = steps.some((step) => step.id === event.step?.id)
          ? steps.map((step) => step.id === event.step?.id ? event.step! : step)
          : [...steps, event.step];
        next.activity = next.activity.map((item) => item.id === event.step?.id ? { ...item, status: event.step?.status === 'failed' ? 'failed' : 'completed' } : item);
      }
      break;
    case 'gate_opened':
      next.pendingGate = event.gate ?? null;
      next.status = 'waiting_human';
      if (event.gate) next.activity = [...next.activity, { id: `${event.at}-gate`, kind: 'gate', label: '等待人工确认', detail: event.gate.message, status: 'waiting', module: event.gate.module }];
      break;
    case 'run_error':
      next.status = 'failed';
      next.error = event.message ?? event.code ?? '运行失败';
      break;
    case 'run_done':
      if (event.state) next = mergeRunState(next, event.state);
      next.activity = next.activity.map((item) => item.status === 'running' ? { ...item, status: next.status === 'failed' ? 'failed' : 'completed' } : item);
      break;
    default:
      break;
  }
  return next;
}

export function moduleProgress(state: AgentUiState, moduleId: string) {
  const plan = state.plan ?? [];
  const moduleSteps = plan.filter((step) => step.module === moduleId);
  const completed = moduleSteps.filter((step) => state.steps?.some((runStep) => runStep.id === step.id && runStep.status === 'completed')).length;
  const current = moduleSteps.findIndex((step) => step.tool === state.currentStep);
  const gate = state.pendingGate?.module === moduleId;
  const failed = state.status === 'failed' && (state.currentStep === moduleSteps[current]?.tool || state.steps?.some((step) => step.module === moduleId && step.status === 'failed'));
  const status = gate ? 'waiting' : failed ? 'failed' : moduleSteps.length > 0 && completed === moduleSteps.length ? 'completed' : current >= 0 ? 'running' : completed > 0 ? 'running' : 'idle';
  const percent = status === 'completed' ? 100 : status === 'running' ? Math.max(12, Math.round((completed / moduleSteps.length) * 100)) : status === 'waiting' || status === 'failed' ? Math.max(16, Math.round((completed / Math.max(moduleSteps.length, 1)) * 100)) : 0;
  const detail = gate ? state.pendingGate?.message : state.currentStep && moduleSteps.some((step) => step.tool === state.currentStep) ? state.currentStep : status === 'completed' ? '模块任务已完成' : '等待前置步骤';
  return { status, percent, detail };
}

export function summarizeResult(state: AgentUiState) {
  const m3 = asObject<Record<string, any>>(state.outputs?.run_m3_procurement_requirements?.data, {});
  const m4 = asObject<Record<string, any>>(state.outputs?.import_m4_purchase_suggestions_json, {});
  const m5 = asObject<Record<string, any>>(state.outputs?.solve_scheduling?.data, {});
  const schedule = asObject<Record<string, any>>(m5.schedule, {});
  const metrics = asObject<Record<string, any>>(schedule.metrics, {});
  const m0run = asObject<Record<string, any>>(state.outputs?.data_import_run, {});
  return {
    shortage: Array.isArray(m3?.shortage_lines) ? m3.shortage_lines.reduce((sum: number, line: any) => sum + Number(line.shortage_qty || 0), 0) : undefined,
    purchaseCount: Array.isArray(m4?.suggestions) ? m4.suggestions.length : undefined,
    scheduleMinutes: typeof metrics.makespan_minutes === 'number' ? metrics.makespan_minutes : undefined,
    lifecycle: typeof m5.lifecycle_status === 'string' ? m5.lifecycle_status : undefined,
    onTimeRate: metrics.on_time_rate != null ? Number(metrics.on_time_rate) : undefined,
    tardinessMinutes: metrics.total_tardiness_minutes != null ? Number(metrics.total_tardiness_minutes) : undefined,
    resourceLoadMinutes: metrics.resource_load_minutes != null ? Number(metrics.resource_load_minutes) : undefined,
    m0BatchId: typeof m0run.batch_id === 'string' ? m0run.batch_id : undefined,
    m0Environment: m0run.environment || m0run.provider || undefined,
    m0Canonical: typeof m0run.canonical === 'boolean' ? m0run.canonical : undefined,
  };
}

export function deriveUploadSummary(state: AgentUiState): Record<string, any> | undefined {
  // /runs/upload/batch 返回顶层 upload_summary；Skill 输出也可能带 upload_summary。
  const skillSummary = asObject<Record<string, any>>(state.outputs?.['business-data-identification']?.upload_summary, {});
  return state.uploadSummary ?? (Object.keys(skillSummary).length ? skillSummary : undefined);
}

export function moduleName(id: string) {
  return MODULES.find((module) => module.id === id)?.name ?? id.toUpperCase();
}
