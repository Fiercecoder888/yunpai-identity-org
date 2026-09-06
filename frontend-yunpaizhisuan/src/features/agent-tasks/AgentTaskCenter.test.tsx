import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../auth/useAuthStore';
import { server } from '../../mocks/server';
import { renderWithApp } from '../../tests/testUtils';
import { useBusinessRunStore } from '../business-flow/useBusinessRunStore';
import { AgentTaskCenter } from './AgentTaskCenter';

const task = {
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
  updated_at: '2026-08-20T06:00:00Z',
  target: {
    type: 'business_flow',
    run_id: 'R-1',
    tracking_task_id: 'TASK-ROOT-1',
    order_id: 'SO-1',
    section: 'human_gate',
  },
};

const historyTask = {
  ...task,
  id: 'flow:R-HISTORY:resolve_order_from_m1:1',
  title: '复核订单识别结果',
  owner: 'M1 Agent',
  status: 'completed',
  riskLevel: 'low',
  agent: 'm1',
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
    ...task.target,
    run_id: 'R-HISTORY',
    tracking_task_id: 'TASK-HISTORY-1',
    order_id: 'SO-HISTORY-1',
  },
};

describe('AgentTaskCenter', () => {
  beforeEach(() => {
    sessionStorage.setItem('yunpai.agent-tasks.notified', JSON.stringify([task.id]));
    useBusinessRunStore.getState().reset();
    useAuthStore.setState({
      status: 'ready',
      config: undefined,
      error: undefined,
      me: {
        auth_mode: 'shared_anonymous',
        principal_id: 'principal-1',
        principal_type: 'shared_anonymous',
        user: null,
        tenant: { id: 'tenant-1', name: 'Shared' },
        shared_data: true,
        roles: [],
        permissions: [],
        session: {
          id: 'session-1',
          csrf_token: 'test',
          idle_expires_at: 'later',
          absolute_expires_at: 'later',
        },
      },
    });
  });

  it('keeps the unfinished badge after reading and restores the business-flow context', async () => {
    const reminderActions: unknown[] = [];
    server.use(
      http.get('/api/orchestrator/tasks', () => HttpResponse.json([task])),
      http.patch('/api/orchestrator/tasks/:id', async ({ request }) => {
        reminderActions.push(await request.json());
        return HttpResponse.json({ ...task, reminder_status: 'read' });
      }),
      http.get('/api/orchestrator/business-flows/R-1', () =>
        HttpResponse.json({
          run_id: 'R-1',
          tracking_task_id: 'TASK-ROOT-1',
          requested_order_id: 'SO-1',
          order_id: 'SO-1',
          mode: 'real',
          status: 'human_input_required',
          current_node: 'resolve_or_generate_bom',
          error: { code: 'HUMAN_INPUT_REQUIRED', message: 'M2 requires human input' },
          steps: [],
        }),
      ),
      http.get('/api/orchestrator/business-flows/R-1/trace', () =>
        HttpResponse.json({
          tenant_id: 'tenant-1',
          order_id: 'SO-1',
          order: { order_id: 'SO-1', product_name: '产品 A' },
          materials: [],
          order_materials: [],
          inventory_balances: [],
          inventory_movements: [],
          procurement_plans: [],
          procurement_plan_lines: [],
          purchase_orders: [],
          schedule_versions: [],
          business_flow_runs: [],
        }),
      ),
    );

    renderWithApp(<AgentTaskCenter />);
    fireEvent.click(await screen.findByRole('button', { name: '打开 Agent 任务' }));
    expect(await screen.findByText('确认 BOM 生成问题')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /定位处理/ }));

    await waitFor(() => expect(useBusinessRunStore.getState().runId).toBe('R-1'));
    expect(reminderActions).toEqual([{ action: 'read' }]);
    expect(useBusinessRunStore.getState()).toMatchObject({
      active: true,
      phase: 'human_input_required',
      taskId: 'TASK-ROOT-1',
    });
  });

  it('opens the requested Agent drawer from a flow card and shows history', async () => {
    server.use(
      http.get('/api/orchestrator/tasks', ({ request }) => {
        const includeHistory = new URL(request.url).searchParams.get('include_history') === 'true';
        return HttpResponse.json(includeHistory ? [historyTask] : [task]);
      }),
    );
    renderWithApp(<AgentTaskCenter />);

    act(() => {
      window.dispatchEvent(new CustomEvent('yunpai:open-agent-tasks', { detail: 'm1' }));
    });

    expect(await screen.findByText('M1 Agent 任务')).toBeInTheDocument();
    fireEvent.click(screen.getByText('历史记录'));
    expect(await screen.findByText('复核订单识别结果')).toBeInTheDocument();
    expect(screen.getByText('历史')).toBeInTheDocument();
  });

  it('uses supervision wording for the quality assurance task entry', async () => {
    server.use(http.get('/api/orchestrator/tasks', () => HttpResponse.json([task])));

    renderWithApp(<AgentTaskCenter supervision />);

    fireEvent.click(await screen.findByRole('button', { name: '打开流程任务' }));
    expect(await screen.findByText('M2 流程任务')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /查看进度/ })).toBeInTheDocument();
  });
});
