import { expect, test } from '@playwright/test';
import path from 'node:path';

const plan = [
  ['m0-ingest', 'm0', 'data_import_run'], ['m0-publish', 'm0', 'data_import_commit'], ['m1-parse', 'm1', 'ingest_document'],
  ['m2-engineering', 'm2', 'run_bom_sop_workflow'], ['m3-mrp', 'm3', 'run_m3_procurement_requirements'], ['m4-procurement', 'm4', 'import_m4_purchase_suggestions_json'], ['m5-schedule', 'm5', 'solve_scheduling'],
].map(([id, module, tool]) => ({ id, module, tool, mode: 'workflow' }));

const state = (overrides: Record<string, unknown> = {}) => ({ run_id: 'run-e2e-001', task_id: 'task-e2e-001', status: 'waiting_human', route: 'workflow', plan, steps: [], outputs: {}, next_step_index: 0, current_step: 'data_import_run', pending_gate: { type: 'candidate', module: 'm0', tool: 'data_import_run', message: 'M0 候选必须审核后才能发布 canonical 事实', step_index: 0 }, ...overrides });
const ndjson = (events: unknown[]) => events.map((item) => JSON.stringify(item)).join('\n') + '\n';
const screenshotPath = (name: string, project: string) => path.resolve(process.cwd(), `../docs/frontend-acceptance-screenshots/${name}-${project}.png`);

async function mockApi(page: import('@playwright/test').Page) {
  await page.route('**/api/runs?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [] }) }));
  await page.route('**/api/runs/stream', async (route) => {
    const current = state();
    await route.fulfill({ contentType: 'application/x-ndjson', body: ndjson([
      { type: 'run_start', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), state: { ...current, pending_gate: null } },
      { type: 'assistant_delta', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), content: '识别为 M0→M5 受控业务目标' },
      { type: 'step_start', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), step: plan[0] },
      { type: 'gate_opened', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), gate: current.pending_gate },
      { type: 'state_snapshot', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), state: current },
    ]) });
  });
  await page.route('**/api/runs/run-e2e-001/resume/stream', async (route) => {
    const current = state({ status: 'completed', pending_gate: null, next_step_index: 7, current_step: 'solve_scheduling', outputs: { run_m3_procurement_requirements: { data: { shortage_lines: [{ shortage_qty: 4 }] } }, import_m4_purchase_suggestions_json: { suggestions: [{ item_code: 'MAT-1' }] }, solve_scheduling: { data: { lifecycle_status: 'released', schedule: { metrics: { makespan_minutes: 10 } } } } }, response: '计划内工具已执行并通过审查。' });
    await route.fulfill({ contentType: 'application/x-ndjson', body: ndjson([{ type: 'state_snapshot', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), state: current }, { type: 'run_done', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), state: current }]) });
  });
}

test('renders three-column workspace and upload menu', async ({ page }, testInfo) => {
  await mockApi(page); await page.goto('/');
  await expect(page.getByText('把业务目标交给 Agent')).toBeVisible();
  await expect(page.getByTestId('left-rail')).toBeVisible(); await expect(page.getByTestId('progress-rail')).toBeVisible();
  await page.getByRole('button', { name: '上传或导入' }).click();
  await expect(page.getByRole('menuitem', { name: /上传订单/ })).toBeVisible(); await expect(page.getByRole('menuitem', { name: /上传基础资料/ })).toBeVisible();
  await page.screenshot({ path: screenshotPath('01-initial', testInfo.project.name), fullPage: true });
});

test('preserves the compact progress rail visual structure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Desktop geometry checks run in the desktop project.');
  await mockApi(page); await page.goto('/');
  const metrics = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-testid="progress-rail"]');
    const wrap = document.querySelector<HTMLElement>('.right-panel-wrap');
    const module = document.querySelector<HTMLElement>('.module-progress');
    const node = document.querySelector<HTMLElement>('.module-node');
    const line = document.querySelector<HTMLElement>('.progress-line');
    const current = document.querySelector<HTMLElement>('.current-agent-box');
    if (!rail || !wrap || !module || !node || !line || !current) throw new Error('progress rail DOM is incomplete');
    const railRect = rail.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      railTop: railRect.top,
      railBottom: railRect.bottom,
      wrapTop: wrapRect.top,
      wrapBottom: wrapRect.bottom,
      railOverflow: getComputedStyle(rail).overflowY,
      moduleDisplay: getComputedStyle(module).display,
      nodeDisplay: getComputedStyle(node).display,
      nodeWidth: nodeRect.width,
      nodeHeight: nodeRect.height,
      nodeRadius: getComputedStyle(node).borderRadius,
      lineHeight: lineRect.height,
      currentVisible: getComputedStyle(current).display !== 'none',
    };
  });
  expect(Math.abs(metrics.railTop)).toBeLessThan(1);
  expect(Math.abs(metrics.railBottom - metrics.viewportHeight)).toBeLessThan(1);
  expect(Math.abs(metrics.wrapTop)).toBeLessThan(1);
  expect(Math.abs(metrics.wrapBottom - metrics.viewportHeight)).toBeLessThan(1);
  expect(metrics.railOverflow).toBe('auto');
  expect(metrics.moduleDisplay).toBe('grid');
  expect(metrics.nodeDisplay).toBe('grid');
  expect(metrics.nodeWidth).toBe(25);
  expect(metrics.nodeHeight).toBe(25);
  expect(metrics.nodeRadius).toBe('50%');
  expect(metrics.lineHeight).toBeGreaterThan(0);
  expect(metrics.currentVisible).toBe(true);
});

test('uploads an order, streams the gate and renders the completed result', async ({ page }, testInfo) => {
  await mockApi(page); await page.goto('/');
  await page.getByRole('button', { name: '上传或导入' }).click(); await page.getByRole('menuitem', { name: /上传订单/ }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'order.json', mimeType: 'application/json', buffer: Buffer.from('{"order_id":"SO-001"}') });
  await expect(page.getByTestId('composer').getByText('order.json')).toBeVisible();
  await page.getByPlaceholder('描述你要完成的制造业务目标…').fill('请根据订单附件执行订单到排程'); await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByTestId('gate-card')).toBeVisible(); await expect(page.getByTestId('gate-card').getByRole('heading', { name: 'M0 候选必须审核后才能发布 canonical 事实' })).toBeVisible();
  await expect(page.getByTestId('module-progress-m0')).toContainText('待确认');
  await page.getByRole('button', { name: '接收' }).click();
  await expect(page.getByTestId('result-summary')).toBeVisible(); await expect(page.getByTestId('result-summary')).toContainText('10');
  await page.screenshot({ path: screenshotPath('02-completed-result', testInfo.project.name), fullPage: true });
});

test('keeps the conversation scrollable as streamed output grows', async ({ page }) => {
  await page.route('**/api/runs?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: [] }) }));
  await page.route('**/api/runs/stream', async (route) => {
    const current = state({ status: 'running', pending_gate: null, current_step: 'data_import_run' });
    await route.fulfill({ contentType: 'application/x-ndjson', body: ndjson([
      { type: 'run_start', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), state: current },
      { type: 'assistant_delta', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), content: `${'正在读取订单文件并校验字段。'.repeat(260)}\n识别仍在进行中。` },
      { type: 'state_snapshot', run_id: current.run_id, task_id: current.task_id, at: new Date().toISOString(), state: current },
    ]) });
  });
  await page.goto('/');
  await page.getByPlaceholder('描述你要完成的制造业务目标…').fill('请持续输出识别进度');
  await page.getByRole('button', { name: '发送' }).click();
  const conversation = page.getByTestId('conversation-scroll');
  await expect(conversation.locator('.agent-stream-text')).toContainText('识别仍在进行中。');
  const metrics = await conversation.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.overflowY).toBe('scroll');
});

test('keeps panels usable on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Mobile drawer checks run in the mobile project.');
  await mockApi(page); await page.goto('/');
  await page.getByRole('button', { name: '打开任务列表' }).click(); await expect(page.getByTestId('left-rail')).toBeVisible();
  const scrim = page.locator('.mobile-scrim');
  await expect(scrim).toBeVisible();
  await scrim.click({ position: { x: 195, y: 400 } });
  await expect(scrim).toBeHidden();
  await page.getByRole('button', { name: '打开执行进度' }).click();
  await expect(page.locator('.right-panel-wrap')).toHaveClass(/panel-open/);
  await expect(page.getByTestId('progress-rail')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: screenshotPath('03-mobile', testInfo.project.name), fullPage: true });
});
