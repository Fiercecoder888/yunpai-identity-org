import { expect, test } from '@playwright/test';

test('opens enterprise assistant root and completes an NDJSON chat', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('云湃企业助手')).toBeVisible();
  await expect(page.getByTestId('chat-message-list')).toBeVisible();
  await expect(page.getByTestId('chat-composer')).toBeVisible();

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
