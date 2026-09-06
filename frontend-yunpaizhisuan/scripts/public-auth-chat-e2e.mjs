#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const baseUrl = (process.env.PUBLIC_E2E_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const existingConversationId =
  process.env.PUBLIC_E2E_EXISTING_CONVERSATION_ID ?? '1f18666d-6fdc-615a-b538-460ad0a58d9e';
const runTag = process.env.PUBLIC_E2E_RUN_TAG ?? `public-e2e-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const requestedPrompt = process.env.PUBLIC_E2E_PROMPT?.trim();
const expectedToolNames = (process.env.PUBLIC_E2E_EXPECTED_TOOLS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const evidenceDir =
  process.env.PUBLIC_E2E_EVIDENCE_DIR ?? path.join('C:/tmp', `yunpai-public-auth-chat-${runTag}`);
const navigationTimeoutMs = Number(process.env.PUBLIC_E2E_NAVIGATION_TIMEOUT_MS ?? 60_000);
const streamTimeoutMs = Number(process.env.PUBLIC_E2E_STREAM_TIMEOUT_MS ?? 300_000);
const headless = process.env.PUBLIC_E2E_HEADLESS !== '0';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apiRecords = [];
const consoleErrors = [];
const pageErrors = [];

const recordApiResponse = (response, client) => {
  const url = new URL(response.url());
  if (url.origin !== baseUrl || !url.pathname.startsWith('/api/')) return;
  apiRecords.push({
    client,
    method: response.request().method(),
    path: url.pathname,
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  });
};

const browserFetchSummary = async (page, requestPath) =>
  page.evaluate(async (target) => {
    const response = await fetch(target, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
    const count = Array.isArray(payload)
      ? payload.length
      : payload && typeof payload === 'object'
        ? ['items', 'tasks', 'results', 'data']
            .map((key) => (Array.isArray(payload[key]) ? payload[key].length : null))
            .find((value) => value !== null) ?? null
        : null;
    return {
      status: response.status,
      contentType,
      count,
      topLevelKeys: payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload).sort() : [],
    };
  }, requestPath);

const conversationSummary = async (page, conversationId) =>
  page.evaluate(async (id) => {
    const response = await fetch(`/api/orchestrator/chat/conversations/${encodeURIComponent(id)}/messages?limit=200`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const payload = response.headers.get('content-type')?.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return {
      status: response.status,
      messageCount: items.length,
      roles: items.reduce((counts, item) => {
        const role = typeof item?.role === 'string' ? item.role : 'unknown';
        counts[role] = (counts[role] ?? 0) + 1;
        return counts;
      }, {}),
      statuses: [...new Set(items.map((item) => item?.status).filter((value) => typeof value === 'string'))].sort(),
      assistantCompleted: items.some(
        (item) => item?.role === 'assistant' && item?.status === 'completed' && item?.run?.status === 'completed',
      ),
      assistantCharacters: items
        .filter((item) => item?.role === 'assistant' && typeof item?.content === 'string')
        .reduce((maximum, item) => Math.max(maximum, item.content.length), 0),
      finishReasons: [
        ...new Set(
          items
            .map((item) => item?.run?.finish_reason)
            .filter((value) => typeof value === 'string' && value.length > 0),
        ),
      ].sort(),
      toolSteps: items
        .filter((item) => item?.role === 'assistant' && Array.isArray(item?.run?.tool_steps))
        .flatMap((item) =>
          item.run.tool_steps.map((step) => ({
            tool: typeof step?.tool === 'string' ? step.tool : 'unknown',
            status: typeof step?.status === 'string' ? step.status : 'unknown',
            summary: typeof step?.safe_summary === 'string' ? step.safe_summary.slice(0, 500) : '',
          })),
        ),
    };
  }, conversationId);

const conversationMetadata = async (page, conversationId) =>
  page.evaluate(async (id) => {
    const response = await fetch('/api/orchestrator/chat/conversations', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const payload = response.headers.get('content-type')?.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    const item = Array.isArray(payload?.items) ? payload.items.find((entry) => entry?.id === id) : null;
    return {
      status: response.status,
      found: Boolean(item),
      title: typeof item?.title === 'string' ? item.title : null,
      titleSource: typeof item?.title_source === 'string' ? item.title_source : null,
      version: typeof item?.version === 'number' ? item.version : null,
    };
  }, conversationId);

const waitForConversationCompletion = async (page, conversationId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await conversationSummary(page, conversationId);
    if (latest.status === 200 && latest.messageCount >= 2 && latest.assistantCompleted) return latest;
    await sleep(2_000);
  }
  throw new Error(
    `conversation ${conversationId} did not complete within ${timeoutMs}ms; ` +
      `last status=${latest?.status ?? 'unknown'} messages=${latest?.messageCount ?? 'unknown'}`,
  );
};

const visibleAssistantSummary = async (page) => {
  const messages = page.getByTestId('chat-message');
  const count = await messages.count();
  if (count === 0) return { characters: 0, thinkingProcessVisible: false };
  const text = (await messages.last().textContent())?.trim() ?? '';
  return {
    characters: text.length,
    thinkingProcessVisible: /here's a thinking process|analyze user input|mental draft/i.test(text),
  };
};

await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless });
const primary = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
});
const primaryPage = await primary.newPage();
primaryPage.setDefaultTimeout(navigationTimeoutMs);
primaryPage.on('response', (response) => recordApiResponse(response, 'primary'));
primaryPage.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push({ client: 'primary', text: message.text().slice(0, 500) });
});
primaryPage.on('pageerror', (error) => pageErrors.push({ client: 'primary', text: error.message.slice(0, 500) }));

const summary = {
  baseUrl,
  runTag,
  startedAt: new Date().toISOString(),
  existingConversation: null,
  createdConversation: null,
  authentication: null,
  backendProbes: {},
  backendFailures: [],
  outOfScopeFindings: [],
  stream: null,
  freshSession: null,
  localStorageSensitiveKeys: [],
  apiRecords,
  consoleErrors,
  pageErrors,
};

try {
  await primaryPage.goto(`${baseUrl}/c/${existingConversationId}`, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  });
  await primaryPage.getByText('云湃企业助手').waitFor({ state: 'visible' });
  assert((await primaryPage.getByText('身份服务不可用').count()) === 0, 'Identity unavailable banner is visible');

  const authMe = await primaryPage.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const payload = await response.json().catch(() => null);
    return {
      status: response.status,
      authMode: payload?.auth_mode ?? null,
      principalType: payload?.principal_type ?? null,
      sharedData: payload?.shared_data ?? null,
      roleCount: Array.isArray(payload?.roles) ? payload.roles.length : null,
      permissionCount: Array.isArray(payload?.permissions) ? payload.permissions.length : null,
    };
  });
  assert(authMe.status === 200, `/api/auth/me expected 200, got ${authMe.status}`);
  assert(authMe.authMode === 'shared_anonymous', `unexpected auth mode: ${authMe.authMode}`);
  summary.authentication = authMe;

  const cookies = await primary.cookies(baseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === '__Host-yunpai_session');
  assert(sessionCookie, '__Host-yunpai_session cookie was not created');
  assert(sessionCookie.secure, 'session cookie is not Secure');
  assert(sessionCookie.httpOnly, 'session cookie is not HttpOnly');
  summary.authentication.cookie = {
    name: sessionCookie.name,
    secure: sessionCookie.secure,
    httpOnly: sessionCookie.httpOnly,
    sameSite: sessionCookie.sameSite,
    path: sessionCookie.path,
  };

  const existing = await conversationSummary(primaryPage, existingConversationId);
  summary.existingConversation = { id: existingConversationId, ...existing };
  if (existing.status === 200) {
    await primaryPage.screenshot({
      path: path.join(evidenceDir, '01-existing-conversation-desktop.png'),
      fullPage: true,
    });
  } else {
    assert(existing.status === 404, `existing conversation lookup returned unexpected HTTP ${existing.status}`);
  }

  summary.backendProbes.orchestratorHealth = await browserFetchSummary(primaryPage, '/api/orchestrator/health');
  summary.backendProbes.m1CompletedTasks = await browserFetchSummary(primaryPage, '/api/m0/parser-compat/tasks?status=done');
  summary.backendProbes.m4Health = await browserFetchSummary(primaryPage, '/api/m4/health');
  summary.backendProbes.m4PurchaseOrders = await browserFetchSummary(primaryPage, '/api/m4/purchase-orders');
  assert(summary.backendProbes.orchestratorHealth.status === 200, 'orchestrator health did not return 200');
  if (summary.backendProbes.m1CompletedTasks.status !== 200) {
    summary.outOfScopeFindings.push({
      probe: 'm1CompletedTasks',
      status: summary.backendProbes.m1CompletedTasks.status,
      reason: 'outside_frontend_orchestrator_scope',
    });
  }
  if (summary.backendProbes.m4Health.status !== 200) {
    summary.outOfScopeFindings.push({
      probe: 'm4Health',
      status: summary.backendProbes.m4Health.status,
      reason: 'outside_frontend_orchestrator_scope',
    });
  }
  if (summary.backendProbes.m4PurchaseOrders.status !== 200) {
    summary.outOfScopeFindings.push({
      probe: 'm4PurchaseOrders',
      status: summary.backendProbes.m4PurchaseOrders.status,
      reason: 'outside_frontend_orchestrator_scope',
    });
  }

  const createResponsePromise = primaryPage.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/orchestrator/chat/conversations',
    { timeout: navigationTimeoutMs },
  );
  await primaryPage.getByRole('button', { name: '新建会话' }).click();
  const createResponse = await createResponsePromise;
  assert(createResponse.status() === 201, `conversation creation expected 201, got ${createResponse.status()}`);
  const createdConversation = await createResponse.json();
  const createdConversationId = createdConversation?.id;
  assert(
    createdConversationId && /^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(createdConversationId),
    `invalid created conversation ID: ${createdConversationId}`,
  );
  await primaryPage.waitForURL(new RegExp(`/c/${createdConversationId}$`));

  const prompt =
    requestedPrompt ??
    `【${runTag}】请用一句话确认企业助手真实流式链路可用，并原样包含验收标识 ${runTag}。`;
  const input = primaryPage.getByPlaceholder('询问订单、风险或排程状态');
  const beforeMessages = await primaryPage.getByTestId('chat-message').count();
  await input.fill(prompt);
  const streamStartedAt = Date.now();
  const streamResponsePromise = primaryPage.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/orchestrator/chat/stream',
    { timeout: streamTimeoutMs },
  );
  await input.press('Enter');
  const streamResponse = await streamResponsePromise;
  assert(streamResponse.status() === 200, `chat stream expected 200, got ${streamResponse.status()}`);
  assert(
    (streamResponse.headers()['content-type'] ?? '').includes('application/x-ndjson'),
    `chat stream returned unexpected content type: ${streamResponse.headers()['content-type'] ?? ''}`,
  );
  const persistedStream = await waitForConversationCompletion(primaryPage, createdConversationId, streamTimeoutMs);
  for (const [index, expectedTool] of expectedToolNames.entries()) {
    assert(
      persistedStream.toolSteps[index]?.tool === expectedTool && persistedStream.toolSteps[index]?.status === 'ok',
      `expected successful tool call ${index + 1} was not persisted in order: ${expectedTool}`,
    );
  }
  const afterMessages = await primaryPage.getByTestId('chat-message').count();
  const livePromptVisible = await primaryPage.getByText(prompt, { exact: true }).isVisible();
  const liveAssistantCharacters =
    afterMessages > beforeMessages
      ? await primaryPage
          .getByTestId('chat-message')
          .last()
          .evaluate((element) => element.textContent?.trim().length ?? 0)
      : 0;
  if (!livePromptVisible || afterMessages < beforeMessages + 2 || liveAssistantCharacters === 0) {
    summary.backendFailures.push({
      probe: 'frontendLiveStreamRendering',
      status: 'messages_missing_after_stream',
    });
  }
  summary.stream = {
    status: streamResponse.status(),
    contentType: streamResponse.headers()['content-type'] ?? '',
    persistedCompleted: persistedStream.assistantCompleted,
    persistedAssistantCharacters: persistedStream.assistantCharacters,
    persistedFinishReasons: persistedStream.finishReasons,
    persistedToolSteps: persistedStream.toolSteps,
    expectedToolNames,
    completionMs: Date.now() - streamStartedAt,
    messageElementsAdded: afterMessages - beforeMessages,
    liveAssistantCharacters,
    livePromptVisible,
  };

  const autoConversation = await conversationMetadata(primaryPage, createdConversationId);
  assert(autoConversation.status === 200 && autoConversation.found, 'created conversation was not listed');
  assert(autoConversation.title && autoConversation.title !== '新对话', 'first message did not generate a conversation title');
  assert(autoConversation.titleSource === 'auto', `unexpected conversation title source: ${autoConversation.titleSource}`);
  await primaryPage
    .locator(`[data-conversation-id="${createdConversationId}"]`, { hasText: autoConversation.title })
    .waitFor({ state: 'visible' });

  await primaryPage.reload({ waitUntil: 'domcontentloaded' });
  await primaryPage.getByText(prompt, { exact: true }).waitFor({ state: 'visible' });
  const restoredAssistant = await visibleAssistantSummary(primaryPage);
  if (restoredAssistant.thinkingProcessVisible) {
    summary.backendFailures.push({
      probe: 'assistantThinkingProcessExposure',
      status: 'thinking_process_visible',
    });
  }
  summary.stream.restoredAssistant = restoredAssistant;
  await primaryPage
    .locator(`[data-conversation-id="${createdConversationId}"]`, { hasText: autoConversation.title })
    .waitFor({ state: 'visible' });
  if (expectedToolNames.length > 0) {
    assert(
      (await primaryPage.locator('.chat-tool-step').count()) >= expectedToolNames.length,
      'persisted tool steps are not visible after reload',
    );
  }
  await primaryPage.screenshot({
    path: path.join(evidenceDir, '02-created-conversation-desktop.png'),
    fullPage: true,
  });

  const createdMessages = await conversationSummary(primaryPage, createdConversationId);
  assert(createdMessages.status === 200, `created conversation messages expected 200, got ${createdMessages.status}`);
  assert(createdMessages.messageCount >= 2, 'created conversation did not persist both chat messages');
  summary.createdConversation = {
    id: createdConversationId,
    title: autoConversation.title,
    titleSource: autoConversation.titleSource,
    version: autoConversation.version,
    promptTag: runTag,
    ...createdMessages,
  };

  summary.localStorageSensitiveKeys = await primaryPage.evaluate(() =>
    Object.keys(globalThis.localStorage).filter((key) => /token|csrf|message|history|session/i.test(key)),
  );
  assert(summary.localStorageSensitiveKeys.length === 0, 'sensitive auth/chat data was stored in localStorage');

  const fresh = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  const freshPage = await fresh.newPage();
  freshPage.setDefaultTimeout(navigationTimeoutMs);
  freshPage.on('response', (response) => recordApiResponse(response, 'fresh'));
  freshPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ client: 'fresh', text: message.text().slice(0, 500) });
  });
  freshPage.on('pageerror', (error) => pageErrors.push({ client: 'fresh', text: error.message.slice(0, 500) }));
  try {
    await freshPage.goto(`${baseUrl}/c/${createdConversationId}`, {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeoutMs,
    });
    await freshPage.getByText('云湃企业助手').waitFor({ state: 'visible' });
    await freshPage.getByText(prompt, { exact: true }).waitFor({ state: 'visible' });
    assert((await freshPage.getByText('身份服务不可用').count()) === 0, 'fresh session showed identity unavailable');
    await freshPage.getByRole('button', { name: '打开会话历史' }).click();
    const drawer = freshPage.getByRole('dialog', { name: '会话历史' });
    await drawer.waitFor({ state: 'visible' });
    await sleep(500);
    const drawerBox = await drawer.boundingBox();
    assert(drawerBox && drawerBox.x <= 1 && drawerBox.width >= 250, 'mobile history drawer is not fully visible');
    await freshPage.screenshot({
      path: path.join(evidenceDir, '03-created-conversation-fresh-mobile.png'),
      fullPage: true,
    });
    const freshCookies = await fresh.cookies(baseUrl);
    const freshSessionCookie = freshCookies.find((cookie) => cookie.name === '__Host-yunpai_session');
    assert(freshSessionCookie?.secure && freshSessionCookie?.httpOnly, 'fresh session cookie flags are invalid');
    const freshMessages = await conversationSummary(freshPage, createdConversationId);
    assert(freshMessages.status === 200, `fresh session history expected 200, got ${freshMessages.status}`);
    const freshAssistant = await visibleAssistantSummary(freshPage);
    summary.freshSession = {
      newSessionCookieCreated: Boolean(freshSessionCookie),
      conversationVisible: true,
      messageCount: freshMessages.messageCount,
      roles: freshMessages.roles,
      assistant: freshAssistant,
      drawer: drawerBox,
    };
  } finally {
    await fresh.close();
  }

  assert(pageErrors.length === 0, `browser emitted ${pageErrors.length} page error(s)`);
  summary.completedAt = new Date().toISOString();
  summary.result =
    summary.backendFailures.length > 0
      ? 'completed_with_backend_failures'
      : summary.outOfScopeFindings.length > 0
        ? 'passed_with_out_of_scope_findings'
        : 'passed';
} catch (error) {
  summary.completedAt = new Date().toISOString();
  summary.result = 'failed';
  summary.failure = error instanceof Error ? error.message : String(error);
  try {
    await primaryPage.screenshot({
      path: path.join(evidenceDir, 'failure.png'),
      fullPage: true,
    });
  } catch {
    // Preserve the original failure if the page is already unavailable.
  }
  throw error;
} finally {
  await writeFile(path.join(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await primary.close();
  await browser.close();
}

console.log(`COMPLETE public auth/chat E2E: ${summary.createdConversation.id}`);
console.log(`Evidence: ${evidenceDir}`);
console.log(
  `Backend counts: M1 done=${summary.backendProbes.m1CompletedTasks.count ?? 'unknown'}, ` +
    `M4 purchase orders=${summary.backendProbes.m4PurchaseOrders.count ?? 'unknown'}`,
);
if (summary.backendFailures.length > 0) {
  console.error(`Backend failures: ${summary.backendFailures.map((failure) => `${failure.probe}=${failure.status}`).join(', ')}`);
  process.exitCode = 2;
}
if (summary.outOfScopeFindings.length > 0) {
  console.warn(
    `Out-of-scope findings: ${summary.outOfScopeFindings
      .map((finding) => `${finding.probe}=${finding.status}`)
      .join(', ')}`,
  );
}
