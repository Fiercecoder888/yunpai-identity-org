import { expect, test } from '@playwright/test';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

const m4ScreenshotPaths: Record<string, string> = {
  'chromium-1366': 'archive/acceptance-evidence-20260706_12/screenshots/m4-1366x768.png',
  'chromium-1440': 'archive/acceptance-evidence-20260706_12/screenshots/m4-1440x900.png',
  'chromium-1920': 'archive/acceptance-evidence-20260706_12/screenshots/m4-1920x1080.png',
};

test('opens enterprise assistant root and completes an NDJSON chat', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('云湃企业助手')).toBeVisible();
  await expect(page.getByTestId('chat-message-list')).toBeVisible();
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByRole('link', { name: '调试工作台' })).toHaveAttribute('href', '/dashboard');

  const input = page.getByPlaceholder('询问订单、风险或排程状态');
  await input.fill('检查当前排程风险');
  await input.press('Enter');

  const messageList = page.getByTestId('chat-message-list');
  await expect(messageList.getByText('检查当前排程风险', { exact: true })).toBeVisible();
  await expect(messageList.getByText('当前风险主要集中在采购交期和库存齐套。', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('[data-testid="chat-message"][data-message-status="completed"]')
      .filter({ hasText: '当前风险主要集中在采购交期和库存齐套。' }),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
});

test('stops enterprise assistant generation from the root page', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder('询问订单、风险或排程状态');
  await input.fill('生成一份长报告');
  await input.press('Enter');

  const stopButton = page.getByRole('button', { name: '停止生成' });
  await expect(stopButton).toBeVisible();
  await stopButton.click();

  await expect(page.locator('[data-testid="chat-message"][data-message-status="cancelled"]')).toContainText('已停止生成。');
  await expect(stopButton).toHaveCount(0);
});

test('shows a safe enterprise assistant stream error without crashing', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder('询问订单、风险或排程状态');
  await input.fill('触发错误态');
  await input.press('Enter');

  await expect(page.locator('[data-testid="chat-message"][data-message-status="failed"]')).toContainText('企业助手服务暂不可用');
  await expect(page.getByTestId('chat-composer')).toBeVisible();
});

test('opens dashboard and navigates with persistent module tabs', async ({ page }, testInfo) => {
  await page.goto('/dashboard');

  await expect(page.getByText('云湃智算', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('最近 Agent 活动')).toBeVisible();
  await expect(page.getByText('订单到排程 协作流程')).toBeVisible();

  await page.getByRole('menuitem', { name: /任务看板/ }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('tab', { name: '任务看板' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: '任务看板' })).toBeVisible();

  await testInfo.attach('app-shell-1440', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('runs M1 batch import and review workflow', async ({ page }) => {
  await page.goto('/modules/m0-review');

  await expect(page.getByRole('tab', { name: 'M0 文档解析审核' })).toBeVisible();
  await expect(page.getByText('M1-TASK-001')).toBeVisible();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: '订单图纸-A102.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('demo'),
  });
  await page.getByRole('button', { name: '提交批量识别', exact: true }).click();
  await expect(page.getByText('批量识别已创建 2 个任务')).toBeVisible();

  await page.getByRole('button', { name: '打开审核' }).first().click();
  await page.getByLabel('审核说明').fill('');
  await page.getByRole('button', { name: '通过并完成任务' }).click();
  await expect(page.getByText('请输入审核说明')).toBeVisible();
});

test('opens Agent Flow node details from dashboard', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByTestId('agent-flow-canvas')).toBeVisible();
  await page.getByTestId('agent-flow-node-m1').getByText('M0 订单解析').click();
  await expect(page.getByText('节点详情')).toBeVisible();
  await expect(page.getByText('模块节点')).toBeVisible();
  await expect(page.getByText('PDF、图纸、ZIP')).toBeVisible();
});

test('blocks unauthorized dashboard access and records audit log', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('mockScenario', 'permissionDenied');
  });

  await page.goto('/dashboard');
  await expect(page.getByText('无权限访问')).toBeVisible();
  await expect(page.getByText('缺少权限：dashboard:read')).toBeVisible();

  await page.getByRole('menuitem', { name: /操作留痕/ }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByText('PERMISSION_DENIED')).toBeVisible();
  await expect(page.getByRole('row', { name: /PERMISSION_DENIED Dashboard dashboard/ })).toBeVisible();
});

test('runs M4 purchase tracking workflow and records audit logs', async ({ page }, testInfo) => {
  await page.goto('/modules/purchase-warnings');

  await expect(page.getByRole('heading', { name: 'M4 采购追踪' })).toBeVisible();
  await expect(page.getByText('轴承')).toBeVisible();
  await expect(page.getByText('供应商为当前页筛选')).toBeVisible();

  const screenshotPath = m4ScreenshotPaths[testInfo.project.name];
  if (screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true });
    const screenshot = await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(screenshotPath.split('/').at(-1) ?? 'm4-screenshot', {
      body: screenshot,
      contentType: 'image/png',
    });
  }

  await page.getByTestId('m4-supplier-filter').click();
  await page.getByTitle('华南电子供应商').click();
  await expect(page.getByText('传感器')).toBeVisible();

  await page.getByTestId('m4-supplier-filter').click();
  await page.getByTitle('全部供应商').click();
  await page.getByRole('button', { name: /查看预警/ }).first().click();
  await expect(page.getByText('预警详情')).toBeVisible();
  await page.locator('.ant-drawer-close').click();

  await page.getByRole('button', { name: /生成催单/ }).first().click();
  await expect(page.getByText('催单文本已生成')).toBeVisible();

  await page.getByRole('tab', { name: 'AI 解析' }).click();
  await expect(page.getByLabel('供应商回复')).toBeVisible();
  await page.getByRole('button', { name: /解析供应商回复/ }).click();
  await expect(page.getByText('需要人工确认')).toBeVisible();
  await page.getByRole('button', { name: /人工确认/ }).click();
  await expect(page.getByText('AI 解析已人工确认')).toBeVisible();

  await page.getByRole('menuitem', { name: /操作留痕/ }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByText('M4_ALERT_URGE_MESSAGE')).toBeVisible();
  await expect(page.getByText('M4_REPLY_PARSE_CONFIRM')).toBeVisible();
});

test('renders schedule gantt, filters resources and adjusts a task', async ({ page }) => {
  await page.goto('/modules/schedule');

  await expect(page.getByTestId('gantt-placeholder')).toBeVisible();
  await page.getByTitle('全部资源').first().click();
  await page.getByTitle('产线 2').click();
  await expect(page.getByRole('button', { name: /订单 B 表面处理/ })).toBeVisible();
  await page.getByTitle('产线 2').first().click();
  await page.getByTitle('全部资源').click();
  await page.getByRole('button', { name: /订单 A 粗加工/ }).click();
  await expect(page.getByText('任务详情')).toBeVisible();
  await page.getByRole('button', { name: '提交调整' }).click();
  await expect(page.getByText('排程调整已提交')).toBeVisible();
});

test('runs real M2 BOM generation and an isolated Legal Demo opinion', async ({ page }) => {
  await page.goto('/modules/bom-review');
  await page.getByRole('button', { name: /生成 BOM 工程草稿/ }).click();
  await expect(page.getByText('CBL-USBC-1M')).toBeVisible();
  await expect(page.getByText('请确认旧物料编号是正式主编号还是历史别名。')).toBeVisible();

  await page.goto('/modules/legal-final-review');
  await expect(page.getByText('仅供 Demo 演示')).toBeVisible();
  await expect(page.getByText(/不代表 M7 已交付/)).toBeVisible();
  await expect(page.getByText('CLA-2026-014')).toBeVisible();
  await page.getByRole('button', { name: '查看终审' }).first().click();
  await page.getByRole('textbox', { name: /终审意见/ }).fill('');
  await page.getByRole('button', { name: '终审通过' }).click();
  await expect(page.getByText('请输入终审意见')).toBeVisible();
  await page.getByRole('textbox', { name: /终审意见/ }).fill('风险可接受，补充条款后通过。');
  await page.getByRole('button', { name: '终审通过' }).click();
  await expect(page.getByText('演示终审意见已记录')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '合同风险终审演示' })).toBeHidden();
});
