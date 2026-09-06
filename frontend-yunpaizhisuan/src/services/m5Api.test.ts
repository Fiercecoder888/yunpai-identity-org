import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { adjustScheduleTask, getScheduleBoard, getScheduleDependencies } from './scheduleApi';
import {
  adaptM5OperationToTask,
  adaptM5ScheduleToBoard,
  createM5ExecutionEvent,
  createM5IntelligentSchedule,
  createM5MaterialProcurementPlan,
  createM5Schedule,
  createM5ScheduleJob,
  dispatchM5Schedule,
  getM5ExecutionSummary,
  getM5Job,
  getM5PmcProgress,
  getM5Schedule,
  getM5SnapshotReadiness,
  listM5Schedules,
  lockM5Operation,
  unlockM5Operation,
} from './m5Api';

describe('m5Api and schedule facade', () => {
  it('loads a schedule board and safely returns no dependencies when the dependency endpoint fails', async () => {
    server.use(http.get('/api/m5/schedules/:planVersion/dependencies', () => HttpResponse.json({ message: 'no endpoint' }, { status: 404 })));
    await expect(getScheduleBoard()).resolves.toMatchObject({ resources: expect.any(Array), tasks: expect.any(Array) });
    await expect(getScheduleDependencies()).resolves.toEqual([]);
  });

  it('adjusts operations through the M5 operation endpoint', async () => {
    await expect(
      adjustScheduleTask({
        taskId: 'SCH-1',
        planVersion: 'PV-001',
        orderId: 'SCH-1',
        operationId: 'SCH-1',
        startAt: '2026-07-09T08:00:00+08:00',
        endAt: '2026-07-10T18:00:00+08:00',
        reason: '测试调整',
      }),
    ).resolves.toMatchObject({ id: 'SCH-1', status: 'adjusted' });
  });

  it('tolerates nullable resource_name/end_time from persisted M5 operations', async () => {
    server.use(
      http.get('/api/m5/schedules', () =>
        HttpResponse.json({
          success: true,
          data: [{ plan_version: 'pv-null-fields', scenario_purpose: 'production', solver_status: 'optimal', validation_passed: true, lifecycle_status: 'draft', created_at: '2026-08-09T00:00:00Z' }],
        }),
      ),
      http.get('/api/m5/schedules/pv-null-fields', () =>
        HttpResponse.json({
          success: true,
          data: {
            plan_version: 'pv-null-fields',
            operations: [
              {
                plan_version: 'pv-null-fields',
                order_id: 'SO-1',
                product_id: 'HDMI',
                operation_id: 'OP-1',
                operation_name: '裁线工位',
                resource_id: 'WC-CUT',
                resource_name: null,
                start_time: '2026-08-09T00:00:00Z',
                end_time: null,
                status: 'scheduled',
              },
            ],
          },
        }),
      ),
    );

    await expect(getScheduleBoard()).resolves.toMatchObject({
      tasks: [{ resourceId: 'WC-CUT', title: '裁线工位' }],
    });
    await expect(getM5Schedule('pv-null-fields')).resolves.toMatchObject({
      plan_version: 'pv-null-fields',
    });
  });

  it('carries the head schedule lifecycle into the board for the Gantt lifecycle strip', async () => {
    server.use(
      http.get('/api/m5/schedules', () =>
        HttpResponse.json({
          success: true,
          data: [
            {
              plan_version: 'cp-sat-release-001',
              scenario_purpose: 'production',
              solver_status: 'optimal',
              validation_passed: true,
              lifecycle_status: 'released',
              approved_at: '2026-08-09T01:00:00Z',
              released_at: '2026-08-09T02:00:00Z',
              created_at: '2026-08-09T00:00:00Z',
            },
          ],
        }),
      ),
      http.get('/api/m5/schedules/cp-sat-release-001', () =>
        HttpResponse.json({
          success: true,
          data: { plan_version: 'cp-sat-release-001', operations: [] },
        }),
      ),
    );

    await expect(getScheduleBoard()).resolves.toMatchObject({
      planVersion: 'cp-sat-release-001',
      lifecycleStatus: 'released',
      validationPassed: true,
      scenarioPurpose: 'production',
      approvedAt: '2026-08-09T01:00:00Z',
      releasedAt: '2026-08-09T02:00:00Z',
    });
  });

  it('rejects adjustments without a concrete plan version instead of falling back to current', async () => {
    await expect(
      adjustScheduleTask({
        taskId: 'SCH-1',
        startAt: '2026-07-09T08:00:00+08:00',
        endAt: '2026-07-10T18:00:00+08:00',
        reason: '测试调整',
      }),
    ).rejects.toThrow('排程调整缺少计划版本');
  });

  it('unwraps the real M5 envelope before parsing list responses', async () => {
    server.use(
      http.get('/api/m5/schedules', () =>
        HttpResponse.json({ success: true, data: [{ plan_version: 'envelope-pv' }], errors: [], trace_id: 'trace-1' }),
      ),
    );

    await expect(listM5Schedules()).resolves.toEqual([expect.objectContaining({ plan_version: 'envelope-pv' })]);
  });

  it('surfaces the backend error code and trace id from failed envelopes', async () => {
    server.use(
      http.get('/api/m5/schedules', () =>
        HttpResponse.json(
          { success: false, data: null, errors: [{ code: 'M5_SCENARIO_CONFLICT', message: 'scenario head conflict' }], trace_id: 'trace-2' },
          { status: 409 },
        ),
      ),
    );

    await expect(listM5Schedules()).rejects.toMatchObject({
      error: { code: 'M5_SCENARIO_CONFLICT', status: 409, traceId: 'trace-2' },
    });
  });

  it('accepts bare schedule arrays and async job APIs', async () => {
    await expect(listM5Schedules()).resolves.toEqual([expect.objectContaining({ plan_version: 'current' })]);
    const job = await createM5ScheduleJob({ scenario_id: 'S-1' });
    await expect(getM5Job(job.job_id)).resolves.toMatchObject({ status: 'done' });
  });

  it('accepts paged schedule lists and covers the M5 operation command surface through MSW', async () => {
    server.use(http.get('/api/m5/schedules', () => HttpResponse.json({ items: [{ plan_version: 'paged' }], total: 1 })));

    await expect(listM5Schedules()).resolves.toEqual([expect.objectContaining({ plan_version: 'paged' })]);
    await expect(createM5Schedule({ scenario_id: 'S-1' })).resolves.toMatchObject({ plan_version: 'current' });
    await expect(getM5Schedule('current')).resolves.toMatchObject({ resources: expect.any(Array), tasks: expect.any(Array) });
    await expect(createM5IntelligentSchedule({ scenario_id: 'S-1' })).resolves.toMatchObject({ plan_version: 'current' });
    await expect(lockM5Operation('current', 'SCH-1', 'SCH-1')).resolves.toMatchObject({ locked: true });
    await expect(unlockM5Operation('current', 'SCH-1', 'SCH-1')).resolves.toMatchObject({ locked: false });
    await expect(dispatchM5Schedule('current', { operator: 'tester' })).resolves.toMatchObject({ status: 'dispatched' });
    await expect(createM5ExecutionEvent('current', { event: 'started' })).resolves.toMatchObject({ accepted: true });
    await expect(getM5ExecutionSummary('current')).resolves.toMatchObject({
      planned_operation_count: 4,
      started_operation_count: 2,
      completed_operation_count: 1,
      paused_operation_count: 1,
      exception_operation_count: 0,
      completion_rate_percent: 25,
      source_event_counts: { mes: 2 },
    });
    await expect(getM5PmcProgress('current')).resolves.toMatchObject({
      plan_version: 'current',
      summary: { wip_order_count: 1, on_time_rate_percent: undefined },
      orders: [{ order_id: 'SO-PMC-001', actual_qty: 35, on_time: undefined }],
    });
    await expect(getM5SnapshotReadiness('scenario-001')).resolves.toMatchObject({ items: [] });
    await expect(createM5MaterialProcurementPlan({ material_id: 'MAT-001' })).resolves.toMatchObject({ plan_id: 'mat-plan-001' });
  });

  it('rejects execution summaries that omit the distinct operation and source aggregates', async () => {
    server.use(http.get('/api/m5/schedules/incomplete/execution-summary', () => HttpResponse.json({
      plan_version: 'incomplete',
      event_count: 0,
      late_operation_count: 0,
      exception_count: 0,
      scrap_quantity: 0,
    })));

    await expect(getM5ExecutionSummary('incomplete')).rejects.toThrow();
  });

  it('adapts backend operations into the existing ScheduleBoard model', () => {
    expect(
      adaptM5ScheduleToBoard({
        operations: [
          {
            operation_id: 'OP-1',
            operation_name: '切割',
            resource_id: 'line-1',
            resource_name: '产线 1',
            start_day: 2,
            duration_days: 3,
            status: 'solved',
          },
        ],
      }),
    ).toMatchObject({
      resources: [{ id: 'line-1', name: '产线 1' }],
      tasks: [{ id: 'OP-1', title: '切割', resourceId: 'line-1', startDay: 2, durationDays: 3, status: 'solved' }],
    });
  });

  it('passes schedule lifecycle fields through the board adapter', () => {
    expect(
      adaptM5ScheduleToBoard({
        plan_version: 'pv-lifecycle',
        lifecycle_status: 'approved',
        validation_passed: false,
        scenario_purpose: 'pressure_only',
        operations: [],
      }),
    ).toMatchObject({
      planVersion: 'pv-lifecycle',
      lifecycleStatus: 'approved',
      validationPassed: false,
      scenarioPurpose: 'pressure_only',
    });
  });

  it('builds stable unique task ids when orders reuse an operation id', () => {
    const board = adaptM5ScheduleToBoard({
      operations: [
        { order_id: 'SO-A', product_id: 'SKU-A', operation_id: 'OP-10', operation_name: 'A 裁线', resource_id: 'WC-A' },
        { order_id: 'SO-B', product_id: 'SKU-B', operation_id: 'OP-10', operation_name: 'B 裁线', resource_id: 'WC-B' },
      ],
    });

    expect(board.tasks).toMatchObject([
      { id: 'SO-A::OP-10', orderId: 'SO-A', operationId: 'OP-10' },
      { id: 'SO-B::OP-10', orderId: 'SO-B', operationId: 'OP-10' },
    ]);
    expect(new Set(board.tasks.map((task) => task.id)).size).toBe(2);
  });

  it('handles missing fields, empty operations and locked backend state without breaking the board model', () => {
    expect(adaptM5ScheduleToBoard({ operations: [] })).toEqual({ resources: [], tasks: [], conflicts: [] });
    expect(
      adaptM5ScheduleToBoard({
        operations: [{ operation_name: '缺省字段工序' }],
      }),
    ).toMatchObject({
      resources: [{ id: 'unassigned', name: 'unassigned' }],
      tasks: [{ id: 'operation-1', resourceId: 'unassigned', startDay: 0, durationDays: 1, status: 'solving' }],
    });
    expect(adaptM5OperationToTask({ operation_id: 'LOCK-1', operation_name: '锁定工序', status: 'locked' })).toMatchObject({
      id: 'LOCK-1',
      title: '锁定工序',
      status: 'adjusted',
    });
  });

  it('passes exact operation start_time/end_time through both adapters for hour-level precision', () => {
    expect(
      adaptM5ScheduleToBoard({
        operations: [
          {
            operation_id: 'OP-1',
            operation_name: '小时级工序',
            resource_id: 'line-1',
            start_time: '2026-06-29T00:00:00Z',
            end_time: '2026-06-29T01:45:00Z',
            status: 'solved',
          },
        ],
      }),
    ).toMatchObject({
      tasks: [{ id: 'OP-1', startAt: '2026-06-29T00:00:00Z', endAt: '2026-06-29T01:45:00Z' }],
    });
    expect(
      adaptM5OperationToTask({
        operation_id: 'OP-2',
        operation_name: '小时级工序 2',
        start_time: '2026-06-29T00:00:00Z',
        end_time: '2026-06-29T01:45:00Z',
        status: 'solved',
      }),
    ).toMatchObject({ id: 'OP-2', startAt: '2026-06-29T00:00:00Z', endAt: '2026-06-29T01:45:00Z' });
  });

  it('carries actual projection fields and renders an open-ended actual duration', () => {
    const board = adaptM5ScheduleToBoard({
      operations: [{
        operation_id: 'OP-ACTUAL',
        operation_name: '实际工序',
        resource_id: 'line-1',
        start_time: '2026-08-20T08:00:00Z',
        end_time: '2026-08-20T09:00:00Z',
        actual_start_time: '2026-08-20T07:00:00Z',
        actual_end_time: null,
        actual_qty: 12,
        actual_status: 'running',
      }],
    });

    expect(board.tasks[0]).toMatchObject({
      actualStartDay: -1,
      actualStartAt: '2026-08-20T07:00:00Z',
      actualEndAt: undefined,
      actualQty: 12,
      actualStatus: 'running',
      actualDurationDays: expect.any(Number),
    });
  });
});
