import { expect, test } from '@playwright/test';

test.skip(!process.env.AUTH_CHAT_E2E, 'The full auth/chat stack is started by tests/auth-chat-e2e/run.ps1.');

const subjectFor = (page: import('@playwright/test').Page, subject: string) => {
  return page.route('**/authorize**', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('mock_subject', subject);
    await route.continue({ url: url.toString() });
  });
};

const loginWithOidc = async (page: import('@playwright/test').Page, subject: string) => {
  await page.unroute('**/authorize**');
  await subjectFor(page, subject);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '登录' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: '登录' }).click();
  await expect(page.getByText('共享数据 · Local Mock User')).toBeVisible({ timeout: 15_000 });
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    return response.json() as Promise<{ principal_type: string; session: { id: string }; tenant: { id: string } }>;
  });
};

test('two OIDC principals share PostgreSQL chat history after Redis recreation', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  try {
    const firstMe = await loginWithOidc(firstPage, 'local-mock-user-a');
    const secondMe = await loginWithOidc(secondPage, 'local-mock-user-b');
    expect(firstMe.principal_type).toBe('oidc_federated');
    expect(secondMe.principal_type).toBe('oidc_federated');
    expect(firstMe.session.id).not.toBe(secondMe.session.id);
    expect(firstMe.tenant.id).toBe(secondMe.tenant.id);

    const prompt = `OIDC shared history ${Date.now()}`;
    const created = firstPage.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/orchestrator/chat/conversations');
    const initialHistory = firstPage.waitForResponse((response) => response.request().method() === 'GET'
      && /\/api\/orchestrator\/chat\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname));
    await firstPage.getByRole('button', { name: '新建会话' }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const conversation = await createdResponse.json() as { id: string };
    const historyResponse = await initialHistory;
    expect(historyResponse.status()).toBe(200);
    expect(new URL(historyResponse.url()).pathname).toContain(conversation.id);
    await expect(firstPage).toHaveURL(new RegExp(`/c/${conversation.id}$`));

    await firstPage.getByPlaceholder('询问订单、风险或排程状态').fill(prompt);
    const streamed = firstPage.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/orchestrator/chat/stream');
    await firstPage.getByPlaceholder('询问订单、风险或排程状态').press('Enter');
    expect((await streamed).status()).toBe(200);
    const firstMessages = firstPage.getByTestId('chat-message-list');
    await expect(firstMessages.getByText(prompt, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(firstMessages.getByText(/已收到。/)).toBeVisible({ timeout: 20_000 });

    await secondPage.reload();
    const sharedConversation = secondPage.locator(`[data-conversation-id="${conversation.id}"] .conversation-select`);
    await expect(sharedConversation).toHaveCount(1, { timeout: 15_000 });
    await sharedConversation.click();
    await expect(secondPage.getByTestId('chat-message-list').getByText(prompt, { exact: true })).toBeVisible({ timeout: 15_000 });

    const redisContainer = process.env.AUTH_CHAT_E2E_REDIS_CONTAINER_ID;
    if (!redisContainer) throw new Error('AUTH_CHAT_E2E_REDIS_CONTAINER_ID is required');
    const { execFileSync } = await import('node:child_process');
    execFileSync('docker', ['exec', redisContainer, 'redis-cli', 'FLUSHALL'], { stdio: 'pipe' });

    const expired = await firstPage.request.get('/api/auth/me');
    expect(expired.status()).toBe(401);
    await firstPage.reload();
    await secondPage.reload();
    await loginWithOidc(firstPage, 'local-mock-user-a');
    await loginWithOidc(secondPage, 'local-mock-user-b');
    for (const page of [firstPage, secondPage]) {
      const conversationButton = page.locator(`[data-conversation-id="${conversation.id}"] .conversation-select`);
      await expect(conversationButton).toHaveCount(1, { timeout: 15_000 });
      await conversationButton.click();
      await expect(page.getByTestId('chat-message-list').getByText(prompt, { exact: true })).toBeVisible({ timeout: 15_000 });
    }
  } finally {
    await first.close();
    await second.close();
  }
});
