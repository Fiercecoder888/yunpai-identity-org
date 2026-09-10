import { expect, test } from '@playwright/test';

const outputRoot = 'C:/tmp/yunpai-auth-chat-screenshots';

test('renders shared history sidebar without browser-persisted auth or chat data', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('云湃企业助手')).toBeVisible();
  await expect(page.getByText(/共享数据/)).toBeVisible();

  if (testInfo.project.name === 'chromium-mobile') {
    await page.getByRole('button', { name: '打开会话历史' }).click();
    const drawer = page.getByRole('dialog', { name: '会话历史' });
    await expect(drawer).toBeVisible();
    await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
    await page.screenshot({ path: `${outputRoot}/assistant-mobile-drawer-390x844.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '会话历史' })).toBeHidden();
    return;
  }

  await expect(page.locator('.desktop-sidebar')).toBeVisible();
  const viewport = page.viewportSize();
  await page.screenshot({ path: `${outputRoot}/assistant-shared-expanded-${viewport?.width}x${viewport?.height}.png`, fullPage: true });
  if (testInfo.project.name === 'chromium-1440') {
    await page.getByRole('button', { name: '打开会话历史' }).click();
    await expect(page.locator('.desktop-sidebar')).toHaveCount(0);
    await page.screenshot({ path: `${outputRoot}/assistant-collapsed-1440x900.png`, fullPage: true });
  }

  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((key) => /token|csrf|message|history|session/i.test(key))).toEqual([]);
});

test('preserves, switches and renames distinct server conversations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1440', 'The full history workflow runs once; viewport coverage is handled above.');

  await page.goto('/');
  const newConversation = page.getByRole('button', { name: '新建会话' });
  const input = page.getByPlaceholder('询问订单、风险或排程状态');
  const suffix = Date.now().toString(36);
  const firstPrompt = `第一段历史 ${suffix}`;
  const secondPrompt = `第二段历史 ${suffix}`;
  const renamedTitle = `首个会话 ${suffix}`;

  await newConversation.click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]+$/);
  const firstId = page.url().split('/').at(-1)!;
  expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect(page.locator(`[data-conversation-id="${firstId}"]`)).toHaveCount(1);
  await input.fill(firstPrompt);
  await input.press('Enter');
  await expect(page.getByText(firstPrompt, { exact: true })).toBeVisible();

  await newConversation.click();
  await expect(page).not.toHaveURL(new RegExp(`/c/${firstId}$`));
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]+$/);
  const secondId = page.url().split('/').at(-1)!;
  expect(secondId).not.toBe(firstId);
  expect(secondId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect(page.locator(`[data-conversation-id="${firstId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-conversation-id="${secondId}"]`)).toHaveCount(1);
  await input.fill(secondPrompt);
  await input.press('Enter');
  await expect(page.getByText(secondPrompt, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/c/${secondId}$`));
  await expect(page.getByText(secondPrompt, { exact: true })).toBeVisible();
  await expect(page.locator(`[data-conversation-id="${firstId}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-conversation-id="${secondId}"]`)).toHaveCount(1);

  await expect(page.getByText('云湃企业助手')).toBeVisible();

  const firstConversation = page.locator(`[data-conversation-id="${firstId}"]`);
  await firstConversation.locator('.conversation-select').click();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}$`));
  await expect(page.getByText(firstPrompt, { exact: true })).toBeVisible();
  await expect(page.getByText(secondPrompt, { exact: true })).toHaveCount(0);

  await firstConversation.locator('button[aria-label$=" 操作"]').click();
  await page.getByText('重命名', { exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: '重命名会话' });
  await renameDialog.getByRole('textbox').fill(renamedTitle);
  await renameDialog.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.locator('.conversation-select', { hasText: renamedTitle })).toHaveCount(1);

  await expect(page).toHaveURL(new RegExp(`/c/${firstId}$`));
  await expect(page.locator('.conversation-select', { hasText: renamedTitle })).toHaveCount(1);
});

test('keeps canonical conversation routes synchronized across navigation and deletion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1440', 'The route lifecycle runs once; viewport coverage is handled above.');

  await page.goto('/');
  const input = page.getByPlaceholder('询问订单、风险或排程状态');
  const prompt = `路由生命周期 ${Date.now().toString(36)}`;
  await input.fill(prompt);
  await input.press('Enter');

  await expect(page).toHaveURL(/\/c\/[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const firstId = page.url().split('/').at(-1)!;
  await expect(page.getByTestId('chat-message-list').getByText(prompt, { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-message-list').getByText('当前风险主要集中在采购交期和库存齐套。', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新建会话' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/c/${firstId}$`));
  const secondId = page.url().split('/').at(-1)!;
  expect(secondId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect(page.getByTestId('chat-message')).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}$`));
  await expect(page.getByTestId('chat-message-list').getByText(prompt, { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/c/${secondId}$`));
  await expect(page.getByTestId('chat-message')).toHaveCount(0);

  await page.goto(`/c/${firstId}`);
  await expect(page.getByTestId('chat-message-list').getByText(prompt, { exact: true })).toBeVisible();
  const firstConversation = page.locator(`[data-conversation-id="${firstId}"]`);
  await firstConversation.locator('button[aria-label$=" 操作"]').click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const deleteDialog = page.getByRole('dialog', { name: '删除此会话？' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: /删\s*除/ }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(`[data-conversation-id="${firstId}"]`)).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(`[data-conversation-id="${firstId}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-conversation-id="${secondId}"]`)).toHaveCount(1);
});

test('finishes a background stream without overwriting a newly selected conversation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1440', 'The background-stream workflow runs once.');

  await page.goto('/');
  const input = page.getByPlaceholder('询问订单、风险或排程状态');
  await input.fill('生成一份长报告');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();

  await page.getByRole('button', { name: '新建会话' }).click();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]+$/);
  const foregroundId = page.url().split('/').at(-1)!;
  await expect(page.getByTestId('chat-message')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);

  const backgroundItem = page.locator('.conversation-item').filter({ has: page.locator('.conversation-select', { hasText: '生成一份长报告' }) }).first();
  await expect(backgroundItem).toBeVisible({ timeout: 5_000 });
  const backgroundId = await backgroundItem.getAttribute('data-conversation-id');
  expect(backgroundId).toBeTruthy();
  expect(backgroundId).not.toBe(foregroundId);
  await backgroundItem.locator('.conversation-select').click();

  await expect(page).toHaveURL(new RegExp(`/c/${backgroundId}$`));
  const messages = page.getByTestId('chat-message-list');
  await expect(messages.getByText('生成一份长报告', { exact: true })).toBeVisible();
  await expect(messages.getByText('当前风险主要集中在采购交期和库存齐套。', { exact: true })).toBeVisible();
});
