import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  businessFlowRunProgress,
  getBusinessFlow,
  resumeBusinessFlow,
  resumeBusinessFlowRequest,
  runBusinessFlow,
} from './businessFlowRunApi';

const traceResponse = {
  tenant_id: 'tenant-1',
  order_id: 'SO-001',
  order: { order_id: 'SO-001', order_number: 'SO-001' },
  materials: [{ material_id: 'MAT-1' }],
  order_materials: [{ line_id: 'LINE-1' }],
  inventory_balances: [{ balance_id: 'BAL-1' }],
  inventory_movements: [],
  procurement_plans: [{ plan_id: 'PLAN-1' }],
  procurement_plan_lines: [{ line_id: 'PLAN-LINE-1' }],
  purchase_orders: [{ purchase_order_id: 'PO-1' }],
  schedule_versions: [{ schedule_id: 'SCHEDULE-1', source_schedule_id: 'SCHEDULE-V1' }],
  business_flow_runs: [{ run_id: 'FLOW-1' }],
  fact_versions: [],
  calculation_runs: [],
  validation_results: [],
  supply_allocations: [],
  recalculation_jobs: [],
};

describe('runBusinessFlow', () => {
  it('submits one root request and never calls the legacy invoke or direct M5 endpoints', async () => {
    let rootCalls = 0;
    let legacyCalls = 0;
    let directM5Calls = 0;
    let submittedBody: Record<string, unknown> | undefined;
    let submittedTaskId: string | null = null;

    server.use(
      http.post('/api/orchestrator/business-flows', async ({ request }) => {
        rootCalls += 1;
        submittedTaskId = request.headers.get('X-Yunpai-Task-ID');
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            run_id: 'FLOW-1',
            tracking_task_id: submittedTaskId,
            order_id: 'SO-001',
            mode: 'real',
            status: 'queued',
            current_node: 'intake',
          },
          { status: 202 },
        );
      }),
      http.get('/api/orchestrator/business-flows/FLOW-1', () =>
        HttpResponse.json({
          run_id: 'FLOW-1',
          tracking_task_id: submittedTaskId,
          requested_order_id: 'SO-001',
          order_id: 'SO-001',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
        }),
      ),
      http.get('/api/orchestrator/business-orders/SO-001/trace', () =>
        HttpResponse.json({
          ...traceResponse,
          schedule_versions: [{
            schedule_id: 'SCHEDULE-1',
            source_schedule_id: 'SCHEDULE-V1',
            tracking_task_id: submittedTaskId,
          }],
        }),
      ),
      http.post('/api/orchestrator/invoke', () => {
        legacyCalls += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.post('/api/m5/schedule-candidates', () => {
        directM5Calls += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    const progress = await runBusinessFlow(
      {
        catalogId: 'catalog-1',
        orderId: 'SO-001',
        orderNumber: 'SO-001',
        productName: 'Product 1',
        orderFile: new Blob(['order_id,quantity\nSO-001,2'], { type: 'text/csv' }),
        orderFilename: 'order.csv',
        mode: 'real',
      },
      { intervalMs: 0 },
    );

    expect(rootCalls).toBe(1);
    expect(legacyCalls).toBe(0);
    expect(directM5Calls).toBe(0);
    expect(submittedTaskId).toMatch(/^task_[0-9a-f]{32}$/);
    expect(submittedBody).toMatchObject({
      order_id: 'SO-001',
      order_number: 'SO-001',
      mode: 'real',
      m3_payload: null,
      m4_generate_payload: {},
      m5_payload: null,
      replace_m3_bom_with_m2: true,
    });
    expect(submittedBody?.m2_payload).toMatchObject({
      rule_package_path: '/app/m2_bom_sop_agent/bom',
      use_demo_sources: false,
      template_confirmation: { confirmed: true },
      customer_answers: { manual_message: '' },
    });
    expect(JSON.stringify(submittedBody)).not.toContain('模拟');
    expect(progress).toMatchObject({
      phase: 'done',
      trackingTaskId: submittedTaskId,
      runId: 'FLOW-1',
    });
    expect(progress.trace?.purchase_orders).toHaveLength(1);
    expect(progress.trace?.schedule_versions).toHaveLength(1);
    expect(progress.detail).toBe('排程版本：SCHEDULE-V1');
  });

  it('returns an explicit human gate instead of presenting a partial run as success', async () => {
    server.use(
      http.post('/api/orchestrator/business-flows', ({ request }) =>
        HttpResponse.json(
          {
            run_id: 'FLOW-HUMAN',
            tracking_task_id: request.headers.get('X-Yunpai-Task-ID'),
            order_id: 'SO-HUMAN',
            mode: 'real',
            status: 'queued',
            current_node: 'intake',
          },
          { status: 202 },
        ),
      ),
      http.get('/api/orchestrator/business-flows/FLOW-HUMAN', () =>
        HttpResponse.json({
          run_id: 'FLOW-HUMAN',
          tracking_task_id: 'task_human',
          requested_order_id: 'SO-HUMAN',
          order_id: 'SO-HUMAN',
          mode: 'real',
          status: 'human_input_required',
          current_node: 'resolve_or_generate_bom',
          blocked_reason: {
            code: 'HUMAN_INPUT_REQUIRED',
            message: '需要审核 BOM',
          },
          steps: [],
        }),
      ),
      http.get('/api/orchestrator/business-orders/SO-HUMAN/trace', () =>
        HttpResponse.json({
          ...traceResponse,
          order_id: 'SO-HUMAN',
          order: { order_id: 'SO-HUMAN' },
          materials: [],
          order_materials: [],
          inventory_balances: [],
          procurement_plans: [],
          procurement_plan_lines: [],
          purchase_orders: [],
          schedule_versions: [],
        }),
      ),
    );

    const progress = await runBusinessFlow(
      {
        catalogId: 'catalog-human',
        orderId: 'SO-HUMAN',
        productName: 'Needs review',
        mode: 'real',
      },
      { intervalMs: 0 },
    );

    expect(progress.phase).toBe('human_input_required');
    expect(progress.failed).not.toBe(true);
    expect(progress.detail).toBe('需要审核 BOM');
  });

  it('maps status data_incomplete to phase data_incomplete with missing list', async () => {
    server.use(
      http.post('/api/orchestrator/business-flows', ({ request }) =>
        HttpResponse.json(
          {
            run_id: 'FLOW-INCOMPLETE',
            tracking_task_id: request.headers.get('X-Yunpai-Task-ID'),
            order_id: 'SO-INCOMPLETE',
            mode: 'real',
            status: 'queued',
            current_node: 'intake',
          },
          { status: 202 },
        ),
      ),
      http.get('/api/orchestrator/business-flows/FLOW-INCOMPLETE', () =>
        HttpResponse.json({
          run_id: 'FLOW-INCOMPLETE',
          tracking_task_id: 'task_incomplete',
          requested_order_id: 'SO-INCOMPLETE',
          order_id: 'SO-INCOMPLETE',
          mode: 'real',
          status: 'data_incomplete',
          current_node: 'solve_schedule',
          blocked_reason: {
            code: 'DATA_INCOMPLETE',
            message: 'M5 权威产能事实未完善，等待补齐后恢复',
          },
          error: {
            code: 'DATA_INCOMPLETE',
            data_incomplete: {
              title: '数据未完善',
              production_eligible: false,
              missing: [
                {
                  module: 'm3',
                  capability: 'material_readiness_snapshot',
                  fields: ['material_availability', 'plan_lines'],
                  owner: 'm3',
                  resume_from: 'solve_schedule',
                },
              ],
            },
          },
          steps: [],
        }),
      ),
      http.get('/api/orchestrator/business-orders/SO-INCOMPLETE/trace', () =>
        HttpResponse.json({
          ...traceResponse,
          order_id: 'SO-INCOMPLETE',
          order: { order_id: 'SO-INCOMPLETE' },
          materials: [],
          order_materials: [],
          inventory_balances: [],
          procurement_plans: [],
          procurement_plan_lines: [],
          purchase_orders: [],
          schedule_versions: [],
        }),
      ),
    );

    const progress = await runBusinessFlow(
      {
        catalogId: 'catalog-incomplete',
        orderId: 'SO-INCOMPLETE',
        productName: 'Missing supply',
        mode: 'real',
      },
      { intervalMs: 0 },
    );

    expect(progress.phase).toBe('data_incomplete');
    expect(progress.title).toBe('数据未完善');
    expect(progress.detail).toContain('权威产能事实未完善');
    expect(progress.missing).toBeDefined();
    expect(progress.missing?.[0]?.module).toBe('m3');
    expect(progress.missing?.[0]?.resume_from).toBe('solve_schedule');
    expect(progress.failed).not.toBe(true);
  });

  it('creates a fresh root TaskID for each explicit run of the same file', async () => {
    const taskIds: string[] = [];
    let sequence = 0;
    server.use(
      http.post('/api/orchestrator/business-flows', ({ request }) => {
        sequence += 1;
        const taskId = request.headers.get('X-Yunpai-Task-ID') ?? '';
        taskIds.push(taskId);
        return HttpResponse.json({
          run_id: `FLOW-RERUN-${sequence}`,
          tracking_task_id: taskId,
          order_id: 'SO-RERUN',
          mode: 'real',
          status: 'queued',
          current_node: 'intake',
        }, { status: 202 });
      }),
      http.get('/api/orchestrator/business-flows/:runId', ({ params }) => HttpResponse.json({
        run_id: String(params.runId),
        tracking_task_id: taskIds.at(-1),
        requested_order_id: 'SO-RERUN',
        order_id: 'SO-RERUN',
        mode: 'real',
        status: 'completed',
        current_node: 'persist_trace',
        steps: [],
      })),
      http.get('/api/orchestrator/business-orders/SO-RERUN/trace', () => HttpResponse.json({
        ...traceResponse,
        order_id: 'SO-RERUN',
        order: { order_id: 'SO-RERUN' },
      })),
    );
    const input = {
      catalogId: 'catalog-rerun',
      orderId: 'SO-RERUN',
      productName: 'Product rerun',
      orderFile: new Blob(['same order'], { type: 'text/csv' }),
      orderFilename: 'same.csv',
      mode: 'real' as const,
    };

    await runBusinessFlow(input, { intervalMs: 0 });
    await runBusinessFlow(input, { intervalMs: 0 });

    expect(taskIds).toHaveLength(2);
    expect(taskIds[0]).toMatch(/^task_[0-9a-f]{32}$/);
    expect(taskIds[1]).not.toBe(taskIds[0]);
  });
});

describe('businessFlowRunProgress', () => {
  it('does not report another task historical schedule as the current completed run', () => {
    const progress = businessFlowRunProgress(
      {
        run_id: 'FLOW-CURRENT',
        tracking_task_id: 'task-current',
        mode: 'real',
        status: 'completed',
        current_node: 'persist_trace',
        steps: [],
      },
      {
        ...traceResponse,
        schedule_versions: [{
          schedule_id: 'SCHEDULE-HISTORICAL',
          source_schedule_id: 'SCHEDULE-HISTORICAL-V1',
          tracking_task_id: 'task-historical',
        }],
      },
    );

    expect(progress.phase).toBe('done');
    expect(progress.detail).toBe('');
  });
});

describe('resumeBusinessFlow', () => {
  it('posts the resume request and polls the same run to completion', async () => {
    let resumeCalls = 0;
    const resumeBodies: unknown[] = [];
    server.use(
      http.post('/api/orchestrator/business-flows/:runId/resume', async ({ params, request }) => {
        resumeCalls += 1;
        const body = await request.json();
        resumeBodies.push(body);
        expect(String(params.runId)).toBe('FLOW-RESUME-1');
        expect(body).toEqual({ action: 'continue' });
        return HttpResponse.json(
          {
            resumed: true,
            run_id: 'FLOW-RESUME-1',
            tracking_task_id: 'task_resume_1',
            order_id: 'SO-RESUME-1',
            status: 'queued',
            current_node: 'intake',
          },
          { status: 202 },
        );
      }),
      http.get('/api/orchestrator/business-flows/:runId', () =>
        HttpResponse.json({
          run_id: 'FLOW-RESUME-1',
          tracking_task_id: 'task_resume_1',
          requested_order_id: 'SO-RESUME-1',
          order_id: 'SO-RESUME-1',
          mode: 'real',
          status: 'completed',
          current_node: 'persist_trace',
          steps: [],
          result_summary: {},
        }),
      ),
      http.get('/api/orchestrator/business-orders/:orderId/trace', () =>
        HttpResponse.json(traceResponse),
      ),
    );

    const request = await resumeBusinessFlowRequest('FLOW-RESUME-1');
    expect(request.status).toBe('queued');
    expect(resumeCalls).toBe(1);

    const progress = await resumeBusinessFlow('FLOW-RESUME-1', {
      orderId: 'SO-RESUME-1',
      intervalMs: 0,
    });
    expect(progress.phase).toBe('done');
    expect(progress.runId).toBe('FLOW-RESUME-1');
    expect(progress.trackingTaskId).toBe('task_resume_1');
    expect(resumeBodies).toEqual([
      { action: 'continue' },
      { action: 'continue' },
    ]);
  });

  it('sends BOM approval as a dedicated command without a status supplement', async () => {
    let command: unknown;
    server.use(
      http.post('/api/orchestrator/business-flows/:runId/resume', async ({ request }) => {
        command = await request.json();
        return HttpResponse.json({
          resumed: true,
          run_id: 'FLOW-APPROVE-1',
          tracking_task_id: 'task_approve_1',
          order_id: 'SO-APPROVE-1',
          status: 'queued',
          current_node: 'intake',
        }, { status: 202 });
      }),
      http.get('/api/orchestrator/business-flows/:runId', () => HttpResponse.json({
        run_id: 'FLOW-APPROVE-1',
        tracking_task_id: 'task_approve_1',
        requested_order_id: 'SO-APPROVE-1',
        order_id: 'SO-APPROVE-1',
        mode: 'real',
        status: 'completed',
        current_node: 'persist_trace',
        steps: [],
        result_summary: {},
      })),
      http.get('/api/orchestrator/business-flows/:runId/trace', () =>
        HttpResponse.json(traceResponse),
      ),
    );

    await resumeBusinessFlow('FLOW-APPROVE-1', {
      action: 'approve_bom_for_m0_publication',
      orderId: 'SO-APPROVE-1',
      intervalMs: 0,
    });

    expect(command).toEqual({ action: 'approve_bom_for_m0_publication' });
  });

  it('binds an exception decision to the current gate evidence', async () => {
    let command: unknown;
    server.use(
      http.post('/api/orchestrator/business-flows/:runId/resume', async ({ request }) => {
        command = await request.json();
        return HttpResponse.json({ run_id: 'FLOW-GATE-1', status: 'queued', current_node: 'intake' }, { status: 202 });
      }),
    );

    await resumeBusinessFlowRequest('FLOW-GATE-1', undefined, {
      action: 'allow',
      gateCode: 'm3_material_shortage',
      evidenceDigest: 'a'.repeat(64),
      comment: '接受采购草案',
    });

    expect(command).toEqual({
      action: 'allow',
      gate_code: 'm3_material_shortage',
      evidence_digest: 'a'.repeat(64),
      comment: '接受采购草案',
    });
  });
});

describe('businessFlowRunProgress gate contract', () => {
  it('exposes a typed exception gate instead of requiring detail text parsing', () => {
    const progress = businessFlowRunProgress({
      run_id: 'FLOW-TYPED-GATE',
      tracking_task_id: 'task_typed_gate',
      mode: 'real',
      status: 'blocked',
      current_node: 'check_material_readiness',
      steps: [],
      blocked_reason: {
        code: 'MISSING_AUTHORITY_FACTS',
        message: '旧文案可变',
        gate_code: 'm3_material_shortage',
        gate_kind: 'exception',
        severity: 'warning',
        title: '物料短缺',
        default_action: 'allow',
        allowed_actions: ['allow', 'reject', 'pause_modify'],
        evidence_summary: '缺料 1 项（MAT-1）',
        evidence_digest: 'b'.repeat(64),
      },
    });

    expect(progress.gate).toEqual({
      gateCode: 'm3_material_shortage',
      gateKind: 'exception',
      severity: 'warning',
      title: '物料短缺',
      defaultAction: 'allow',
      allowedActions: ['allow', 'reject', 'pause_modify'],
      evidenceSummary: '缺料 1 项（MAT-1）',
      evidenceDigest: 'b'.repeat(64),
    });
  });
});

describe('getBusinessFlow normalization', () => {
  it('lifts execution_state.results to results and error to blocked_reason (postgres shape)', async () => {
    server.use(
      http.get('/api/orchestrator/business-flows/FLOW-NORM', () =>
        HttpResponse.json({
          run_id: 'FLOW-NORM',
          tracking_task_id: 'task_norm',
          requested_order_id: 'SO-NORM',
          order_id: 'SO-NORM',
          mode: 'real',
          status: 'blocked',
          current_node: 'persist_trace',
          error: { code: 'MISSING_AUTHORITY_FACTS', message: 'M3 缺料 3 项（CT028,JL002,XH001），补货后继续' },
          execution_state: {
            results: {
              m3: {
                success: true,
                data: {
                  status: 'requires_material_review',
                  shortage_lines: [{ material_code: 'CT028', shortage_qty: 5 }],
                },
                errors: [],
              },
            },
          },
          steps: [],
        }),
      ),
    );

    const run = await getBusinessFlow('FLOW-NORM');
    expect(run.status).toBe('blocked');
    // 归一化后人工门卡片能读到具体明细
    expect(run.results?.m3).toBeDefined();
    expect(run.blocked_reason?.message).toContain('缺料');
    expect(run.blocked_reason?.message).toContain('CT028');
  });

  it('keeps the in-memory shape unchanged when already normalized', async () => {
    server.use(
      http.get('/api/orchestrator/business-flows/FLOW-NORM2', () =>
        HttpResponse.json({
          run_id: 'FLOW-NORM2',
          tracking_task_id: 'task_norm2',
          requested_order_id: 'SO-NORM2',
          order_id: 'SO-NORM2',
          mode: 'real',
          status: 'blocked',
          current_node: 'persist_trace',
          blocked_reason: { code: 'MISSING_AUTHORITY_FACTS', message: 'M3 缺料 1 项（CT028）' },
          results: { m3: { data: { shortage_lines: [{ material_code: 'CT028' }] } } },
          steps: [],
        }),
      ),
    );

    const run = await getBusinessFlow('FLOW-NORM2');
    expect(run.blocked_reason?.message).toContain('CT028');
    expect(run.results?.m3).toBeDefined();
  });
});
