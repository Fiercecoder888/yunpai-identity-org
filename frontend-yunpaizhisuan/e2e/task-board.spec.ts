import { expect, test } from '@playwright/test';

test('renders the P6 task kanban with stats and status columns', async ({ page }) => {
  await page.goto('/tasks');

  await expect(page.getByTestId('task-board-stats-row')).toBeVisible();
  await expect(page.getByText('任务总数')).toBeVisible();
  await expect(page.getByTestId('task-kanban')).toBeVisible();

  await expect(page.getByTestId('task-kanban-column-need_review')).toContainText('待审核 (1)');
  await expect(page.getByTestId('task-kanban-column-running')).toContainText('进行中 (1)');
  await expect(page.getByTestId('task-kanban-column-failed')).toContainText('失败 (1)');

  const cards = page.getByTestId('task-kanban-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: '确认订单图纸低置信度字段' })).toBeVisible();
  await expect(cards.filter({ hasText: '复核 BOM 草稿异常物料' })).toBeVisible();
  await expect(cards.filter({ hasText: '跟进供应商交期回复' })).toBeVisible();
});

test('switches the task board to the table view with disabled dispatch', async ({ page }) => {
  await page.goto('/tasks');

  await expect(page.getByTestId('task-kanban')).toBeVisible();
  await page.getByText('表格').click();

  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByTestId('task-kanban')).toHaveCount(0);

  await expect(page.getByRole('button', { name: '分派' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: '分派' })).toHaveCount(3);
  await expect(page.getByText('2026/6/26').first()).toBeVisible();
});

test('filters the board to my tasks and never shows 1970', async ({ page }) => {
  await page.goto('/tasks');

  await expect(page.getByTestId('task-kanban')).toBeVisible();
  await expect(page.locator('text=/1970/')).toHaveCount(0);

  await page.getByRole('checkbox', { name: '我的任务' }).check();
  const cards = page.getByTestId('task-kanban-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.filter({ hasText: '确认订单图纸低置信度字段' })).toBeVisible();
});
