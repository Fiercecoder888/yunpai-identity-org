import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { M3ProcurementPage } from './M3ProcurementPage';

describe('M3ProcurementPage', () => {
  it('uploads JSONL, runs every input through the official endpoint and renders the result', async () => {
    const user = userEvent.setup();
    const submittedOrders: string[] = [];
    const submittedTaskIds: string[] = [];

    server.use(
      http.post('/api/m3/procurement-requirements:run-json', async ({ request }) => {
        const payload = (await request.json()) as { order: { order_id: string; procurement_plan_id: string } };
        submittedOrders.push(payload.order.order_id);
        submittedTaskIds.push(request.headers.get('X-Yunpai-Task-ID') ?? '');
        return HttpResponse.json({
          success: true,
          data: {
            procurement_plan_id: payload.order.procurement_plan_id,
            order_id: payload.order.order_id,
            status: 'ready_for_m4',
            availability_status: 'partial_shortage',
            lines: [
              {
                line_id: 'BOML-REAL-001.1',
                material_code: 'MAT-CHILD-001',
                material_name: '子物料一',
                uom: 'PCS',
                qty_per: 2,
                loss_rate: 0,
                gross_required_qty: 20,
                available_qty: 4,
                locked_qty: 1,
                base_stock_reserved: 2,
                open_po_qty: 3,
                net_required_qty: 15,
                shortage_qty: 15,
                suggest_purchase_qty: 15,
                readiness: 'shortage',
              },
            ],
            warnings: ['MAT-CHILD-001 safety stock uses configured reserve.'],
          },
          errors: [],
          trace_id: `trace-${payload.order.order_id}`,
        });
      }),
    );

    const { container } = renderWithApp(<M3ProcurementPage />);
    expect(screen.queryByText('Legacy 订单与计划')).not.toBeInTheDocument();
    const content = [
      JSON.stringify({
        order: {
          project_id: 'PRJ-REAL-001',
          order_id: 'ORD-REAL-001',
          bom_id: 'BOM-REAL-001',
          procurement_plan_id: 'PROC-REAL-001',
          customer_name: '真实客户A',
          product_name: '真实测试产品A',
          order_qty: 10,
          due_date: '2026-09-30',
        },
        bom: {
          bom_id: 'BOM-REAL-001',
          product_name: '真实测试产品A',
          lines: [
            {
              line_id: 'BOML-REAL-001',
              material_code: 'SUB-REAL-001',
              material_name: '测试组件',
              qty_raw: 2,
              qty_per: 2,
              uom: 'SET',
              loss_rate: 0,
              requires_procurement: false,
            },
          ],
        },
        component_bom: [
          {
            parent_material_code: 'SUB-REAL-001',
            child_material_code: 'MAT-CHILD-001',
            child_material_name: '子物料一',
            qty_per_parent: 1,
            uom: 'PCS',
            loss_rate: 0,
          },
        ],
        inventory_snapshot: [
          {
            material_code: 'MAT-CHILD-001',
            material_name: '子物料一',
            warehouse: 'WH-REAL-A',
            lot_no: 'LOT-REAL-001',
            available_qty: 5,
            locked_qty: 1,
            base_stock_reserved: 2,
            qc_status: 'passed',
            received_at: '2026-07-01',
          },
        ],
        open_purchase_orders: [
          {
            material_code: 'MAT-CHILD-001',
            open_po_qty: 3,
            promise_date: '2026-09-20',
            supplier_id: 'SUP-REAL-001',
          },
        ],
        historical_usage: [
          {
            material_code: 'MAT-CHILD-001',
            days: 30,
            total_usage_qty: 60,
            safety_stock_ratio: 0.2,
          },
        ],
      }),
      JSON.stringify({
        order: { order_id: 'ORD-REAL-002', procurement_plan_id: 'PROC-REAL-002' },
        bom: { lines: [] },
        component_bom: [],
        inventory_snapshot: [],
        open_purchase_orders: [],
        historical_usage: [],
      }),
    ].join('\n');
    const file = new File([content], 'real-orders.jsonl', { type: 'application/x-ndjson' });
    Object.defineProperty(file, 'text', { value: async () => content });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');

    expect(fileInput).not.toBeNull();
    await user.upload(fileInput!, file);
    expect(await screen.findByText('real-orders.jsonl')).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('button', { name: /执行全部/ }));

    await waitFor(() => expect(submittedOrders).toEqual(['ORD-REAL-001', 'ORD-REAL-002']));
    expect(submittedTaskIds).toHaveLength(2);
    expect(submittedTaskIds[0]).toMatch(/^task_[a-f0-9]{32}$/);
    expect(submittedTaskIds[1]).toBe(submittedTaskIds[0]);

    await user.click(screen.getByRole('button', { name: /执行全部/ }));
    await waitFor(() => expect(submittedTaskIds).toHaveLength(4));
    expect(submittedTaskIds[2]).toMatch(/^task_[a-f0-9]{32}$/);
    expect(submittedTaskIds[3]).toBe(submittedTaskIds[2]);
    expect(submittedTaskIds[2]).not.toBe(submittedTaskIds[0]);

    expect(await screen.findByText('ORD-REAL-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-REAL-002')).toBeInTheDocument();
    expect(screen.getByText('PROC-REAL-001')).toBeInTheDocument();
    expect(screen.getByText('PROC-REAL-002')).toBeInTheDocument();
    expect(screen.getByText('trace-ORD-REAL-001')).toBeInTheDocument();
    expect(screen.getAllByText('15')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /下载输出 JSONL/ })).toBeEnabled();

    await user.click(screen.getAllByRole('button', { name: /查看详情/ })[0]!);
    expect(await screen.findByText('M3 计算详情 · ORD-REAL-001')).toBeInTheDocument();
    expect(screen.getByText('真实测试产品A')).toBeInTheDocument();
    expect(screen.getAllByText('SUB-REAL-001').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('MAT-CHILD-001').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('tab', { name: '库存与在途' }));
    expect(await screen.findByText('LOT-REAL-001')).toBeInTheDocument();
    expect(screen.getByText('SUP-REAL-001')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '历史用量' }));
    expect(await screen.findByText('0.2')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '采购计算结果' }));
    expect(await screen.findByText('partial_shortage')).toBeInTheDocument();
    expect(screen.getByText('shortage')).toBeInTheDocument();
    expect(screen.getByText('MAT-CHILD-001 safety stock uses configured reserve.')).toBeInTheDocument();
  });

  it('keeps invalid JSONL lines in the batch result without sending them to M3', async () => {
    const user = userEvent.setup();
    let requestCount = 0;
    server.use(
      http.post('/api/m3/procurement-requirements:run-json', async () => {
        requestCount += 1;
        return HttpResponse.json({
          success: true,
          data: { procurement_plan_id: 'PROC-VALID', lines: [] },
          errors: [],
          trace_id: 'trace-valid',
        });
      }),
    );

    const { container } = renderWithApp(<M3ProcurementPage />);
    const content = '{"order":{"order_id":"ORD-VALID"}}\nnot-json';
    const file = new File([content], 'mixed.jsonl', { type: 'application/x-ndjson' });
    Object.defineProperty(file, 'text', { value: async () => content });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');

    await user.upload(fileInput!, file);
    expect(await screen.findByText('1 行无法解析')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /执行全部/ }));

    await waitFor(() => expect(requestCount).toBe(1));
    expect(
      (await screen.findAllByText((text) => text.includes('Unexpected token'))).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
  });
});
