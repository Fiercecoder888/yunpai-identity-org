import { expect, test } from '@playwright/test';

test('renders gantt dependency links with legend swatches', async ({ page }) => {
  await page.goto('/modules/schedule');

  await expect(page.getByTestId('gantt-placeholder')).toBeVisible();
  await expect(page.getByTestId('gantt-links-svg')).toBeVisible();
  await expect(page.getByTestId('gantt-link-DEP-1')).toBeVisible();
  await expect(page.getByText('完成-开始依赖')).toBeVisible();
  await expect(page.getByText('开始-开始依赖')).toBeVisible();
  await expect(page.getByText('依赖端点未提供')).toHaveCount(0);
});

test('zooms with today and focus task buttons and switches to the month scale', async ({ page }) => {
  await page.goto('/modules/schedule');

  await expect(page.getByTestId('gantt-placeholder')).toBeVisible();
  await page.getByRole('button', { name: '今天' }).click();
  await page.getByRole('button', { name: /订单 A 粗加工/ }).click();
  await page.getByRole('button', { name: '聚焦任务' }).click();
  await expect(page.getByRole('button', { name: '清除时间窗' })).toBeVisible();
  await page.getByRole('button', { name: '清除时间窗' }).click();
  await expect(page.getByRole('button', { name: '清除时间窗' })).toHaveCount(0);

  await page.getByText('月').click();
  await expect(page.getByText('2026-06')).toBeVisible();
});

test('exports the schedule task CSV', async ({ page }) => {
  await page.goto('/modules/schedule');

  await expect(page.getByTestId('gantt-placeholder')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出任务 CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('排程任务');
});

test('locks a task from the drawer and refetches the board', async ({ page }) => {
  await page.goto('/modules/schedule');

  await expect(page.getByTestId('gantt-placeholder')).toBeVisible();
  await page.getByRole('button', { name: /订单 A 粗加工/ }).click();

  const lockRequest = page.waitForRequest((request) => request.url().includes('/lock'));
  await page.getByRole('button', { name: '锁定工序' }).click();
  await lockRequest;
  await expect(page.getByText('锁定后该工序将禁拖拽')).toBeVisible();
});
