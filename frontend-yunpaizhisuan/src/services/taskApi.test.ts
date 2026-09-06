import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { getAgentTasks, getTasks, updateAgentTaskReminder, updateTask } from './taskApi';

describe('taskApi', () => {
  it('maps M1 tasks without a timestamp to an undefined updatedAt (no 1970 placeholder)', async () => {
    server.use(
      http.get('/api/tasks', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.get('/api/m0/parser-compat/tasks', () =>
        HttpResponse.json([
          { task_id: 'no-ts-1', filename: '无时间戳图纸.pdf', status: 'completed' },
          { task_id: 'with-ts-1', filename: '有时间戳图纸.pdf', status: 'running', updated_at: '2026-07-14T08:00:00Z' },
        ]),
      ),
    );

    const tasks = await getTasks();

    expect(tasks[0]?.updatedAt).toBeUndefined();
    expect(JSON.stringify(tasks)).not.toContain('1970');
    expect(tasks[1]?.updatedAt).toBe('2026-07-14T08:00:00Z');
  });

  it('falls back to created_at when updated_at is missing', async () => {
    server.use(
      http.get('/api/tasks', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.get('/api/m0/parser-compat/tasks', () =>
        HttpResponse.json([{ task_id: 'created-only', filename: 'a.pdf', status: 'pending', created_at: '2026-07-01T09:00:00Z' }]),
      ),
    );

    const tasks = await getTasks();

    expect(tasks[0]?.updatedAt).toBe('2026-07-01T09:00:00Z');
  });

  it('leaves updatedAt undefined for a task with neither timestamp', async () => {
    server.use(
      http.get('/api/tasks', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.get('/api/m0/parser-compat/tasks', () => HttpResponse.json([{ task_id: 'bare', filename: 'b.pdf', status: 'failed' }])),
    );

    const tasks = await getTasks();

    expect(tasks[0]?.updatedAt).toBeUndefined();
    expect('updatedAt' in (tasks[0] ?? {})).toBe(false);
  });

  it('updates a task via PATCH /tasks/:id with a json body', async () => {
    const sent: Array<{ url: string; method: string; body: string }> = [];
    server.use(
      http.patch('/api/tasks/TASK-1', async ({ request }) => {
        sent.push({ url: request.url, method: request.method, body: await request.text() });
        return HttpResponse.json({
          id: 'TASK-1',
          title: '确认订单图纸低置信度字段',
          owner: '工艺员',
          status: 'completed',
          riskLevel: 'low',
        });
      }),
    );

    const result = await updateTask('TASK-1', { status: 'completed' });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toMatch(/\/api\/tasks\/TASK-1$/);
    expect(sent[0]?.method).toBe('PATCH');
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual({ status: 'completed' });
    expect(result).toMatchObject({ id: 'TASK-1', status: 'completed' });
  });

  it('reads projected Agent tasks and preserves business/reminder state separation', async () => {
    let includeDismissed = '';
    server.use(
      http.get('/api/orchestrator/tasks', ({ request }) => {
        includeDismissed = new URL(request.url).searchParams.get('include_dismissed') ?? '';
        return HttpResponse.json([
          {
            id: 'flow:R-1:resolve_or_generate_bom:1',
            title: '确认 BOM 生成问题',
            owner: 'M2 Agent',
            status: 'need_review',
            riskLevel: 'medium',
            agent: 'm2',
            kind: 'business_flow_attention',
            business_status: 'human_input_required',
            reminder_status: 'unread',
            detail: 'M2 requires human input',
            tracking_task_id: 'TASK-ROOT-1',
            run_id: 'R-1',
            order_id: 'SO-1',
            current_node: 'resolve_or_generate_bom',
            step_status: 'human_input_required',
            is_history: false,
            target: {
              type: 'business_flow',
              run_id: 'R-1',
              tracking_task_id: 'TASK-ROOT-1',
              order_id: 'SO-1',
              section: 'human_gate',
            },
          },
        ]);
      }),
    );

    const tasks = await getAgentTasks({ includeDismissed: true });

    expect(includeDismissed).toBe('true');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      agent: 'm2',
      business_status: 'human_input_required',
      reminder_status: 'unread',
      tracking_task_id: 'TASK-ROOT-1',
      is_history: false,
    });
  });

  it('requests one Agent history and keeps completed records separate from reminders', async () => {
    let query = new URLSearchParams();
    server.use(
      http.get('/api/orchestrator/tasks', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json([
          {
            id: 'flow:R-HISTORY:resolve_order_from_m1:1',
            title: '复核订单识别结果',
            owner: 'M1 Agent',
            status: 'completed',
            riskLevel: 'low',
            agent: 'm1',
            kind: 'business_flow_attention',
            business_status: 'completed',
            reminder_status: 'read',
            detail: '该 Agent 步骤已完成',
            tracking_task_id: 'TASK-HISTORY-1',
            run_id: 'R-HISTORY',
            order_id: 'SO-HISTORY-1',
            current_node: 'resolve_order_from_m1',
            step_status: 'completed',
            is_history: true,
            target: {
              type: 'business_flow',
              run_id: 'R-HISTORY',
              tracking_task_id: 'TASK-HISTORY-1',
              order_id: 'SO-HISTORY-1',
              section: 'human_gate',
            },
          },
        ]);
      }),
    );

    const tasks = await getAgentTasks({
      agent: 'm1',
      includeDismissed: true,
      includeHistory: true,
      historyLimit: 50,
    });

    expect(query.get('agent')).toBe('m1');
    expect(query.get('include_history')).toBe('true');
    expect(query.get('history_limit')).toBe('50');
    expect(tasks[0]).toMatchObject({ is_history: true, business_status: 'completed' });
  });

  it('updates only the Agent task reminder action', async () => {
    let body: unknown;
    server.use(
      http.patch('/api/orchestrator/tasks/:id', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: 'flow:R-1:solve_schedule:1',
          title: '补齐排程所需产能事实',
          owner: 'M5 Agent',
          status: 'need_review',
          riskLevel: 'medium',
          agent: 'm5',
          kind: 'business_flow_attention',
          business_status: 'human_input_required',
          reminder_status: 'dismissed',
          detail: 'M5 requires capacity facts',
          tracking_task_id: 'TASK-ROOT-5',
          run_id: 'R-1',
          current_node: 'solve_schedule',
          step_status: 'human_input_required',
          is_history: false,
          target: {
            type: 'business_flow',
            run_id: 'R-1',
            tracking_task_id: 'TASK-ROOT-5',
            section: 'human_gate',
          },
        });
      }),
    );

    const task = await updateAgentTaskReminder('flow:R-1:solve_schedule:1', 'dismiss');

    expect(body).toEqual({ action: 'dismiss' });
    expect(task.reminder_status).toBe('dismissed');
    expect(task.business_status).toBe('human_input_required');
  });
});
