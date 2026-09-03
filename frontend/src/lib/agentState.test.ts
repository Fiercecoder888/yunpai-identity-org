import { describe, expect, it } from 'vitest';
import { applyEvent, emptyAgentState, moduleProgress, summarizeResult } from './agentState';

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
});
