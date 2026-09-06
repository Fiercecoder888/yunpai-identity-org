import { expect, test } from '@playwright/test';

test('opens the cockpit big-screen with its panels', async ({ page }) => {
  await page.goto('/cockpit');

  await expect(page.getByTestId('cockpit-page')).toBeVisible();
  await expect(page.getByText('云湃智算 · 生产运营驾驶舱')).toBeVisible();
  await expect(page.getByTestId('cockpit-kpi-panel')).toBeVisible();
  await expect(page.getByTestId('cockpit-gantt-preview')).toBeVisible();
  await expect(page.getByTestId('cockpit-alerts-panel')).toBeVisible();
  await expect(page.getByTestId('cockpit-activity-feed')).toBeVisible();
  await expect(page.getByText(/每 5 秒自动刷新/)).toBeVisible();
});

test('enters the cockpit from the dashboard and returns', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: '进入驾驶舱' }).click();
  await expect(page).toHaveURL(/\/cockpit/);
  await expect(page.getByTestId('cockpit-page')).toBeVisible();

  await page.getByRole('button', { name: '返回运营中心' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});
