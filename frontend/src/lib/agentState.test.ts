import { describe, expect, it } from 'vitest';
import { applyEvent, deriveUploadSummary, emptyAgentState, mergeRunState, moduleProgress, summarizeResult } from './agentState';

const event = (type: any, payload: any = {}) => ({ type, run_id: 'run-1', task_id: 'task-1', at: '2026-09-03T00:00:00Z', ...payload });

describe('agent state reducer', () => {
  it('merges streamed plan, steps and gate state', () => {
    let state = emptyAgentState();
    state = applyEvent(state, event('run_start', { state: { run_id: 'run-1', task_id: 'task-1', status: 'queued' } }));
    state = applyEvent(state, event('step_start', { step: { id: 'm0', module: 'm0', tool: 'data_import_run' } }));
    state = applyEvent(state, event('gate_opened', { gate: { type: 'candidate', module: 'm0', tool: 'data_import_run', message: '确认候选', step_index: 0 } }));
    expect(state.status).toBe('waiting_human');
    expect(state.pendingGate?.type).toBe('candidate');
    expect(moduleProgress(state, 'm0').status).toBe('waiting');
  });

  it('uses backend outputs for business result summaries', () => {
    const state = applyEvent(emptyAgentState(), event('run_done', { state: { run_id: 'run-1', task_id: 'task-1', status: 'completed', outputs: {
      run_m3_procurement_requirements: { data: { shortage_lines: [{ shortage_qty: 4 }] } },
      import_m4_purchase_suggestions_json: { suggestions: [{ item_code: 'MAT-1' }] },
      solve_scheduling: { data: { lifecycle_status: 'released', schedule: { metrics: { makespan_minutes: 10 } } } },
    } } }));
    expect(summarizeResult(state)).toEqual({ shortage: 4, purchaseCount: 1, scheduleMinutes: 10, lifecycle: 'released' });
  });

  it('merges upload summary and derives it from skill outputs', () => {
    let state = mergeRunState(emptyAgentState(), { run_id: 'run-1', task_id: 'task-1', status: 'completed', upload_summary: { mode: 'master_data', total: 3, accepted: 2, skipped: 1, needs_review: 0, parse_failed: 0 } });
    expect(state.uploadSummary?.total).toBe(3);
    expect(deriveUploadSummary(state)?.skipped).toBe(1);

    const fromOutputs = mergeRunState(emptyAgentState(), { run_id: 'run-2', task_id: 'task-2', status: 'completed', outputs: { 'business-data-identification': { upload_summary: { mode: 'directory', total: 1, accepted: 1 } } } });
    expect(deriveUploadSummary(fromOutputs)?.accepted).toBe(1);
  });

  it('summarizes M0 sandbox batch state without canonical claim', () => {
    const state = applyEvent(emptyAgentState(), event('run_done', { state: { run_id: 'run-1', task_id: 'task-1', status: 'waiting_human', outputs: {
      data_import_run: { batch_id: 'batch-TASK-M0-1', environment: 'sandbox', canonical: false },
    } } }));
    const result = summarizeResult(state);
    expect(result.m0BatchId).toBe('batch-TASK-M0-1');
    expect(result.m0Environment).toBe('sandbox');
    expect(result.m0Canonical).toBe(false);
  });
});
