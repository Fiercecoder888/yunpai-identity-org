import { expect, test } from '@playwright/test';

const expectSamePosition = (
  before: { x: number; y: number },
  after: { x: number; y: number },
) => {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
};

test('expanded order flow overlays chat without moving its prompt or composer', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('yunpai.data-flow-panel.expanded');
    const timestamps = [
      '2026-08-13T12:00:00.000Z',
      '2026-08-13T12:01:00.000Z',
      '2026-08-13T12:02:00.000Z',
      '2026-08-13T12:03:00.000Z',
    ];
    const sessions = Object.fromEntries(timestamps.map((updatedAt, index) => {
      const id = `upload-${index + 1}`;
      return [id, {
        id,
        filename: `2026年8月受控生产订单与物料清单第${index + 1}批次.xlsx`,
        kind: index % 2 === 0 ? 'order' : 'm0',
        progress: 25 + index * 20,
        status: 'processing',
        createdAt: updatedAt,
        updatedAt,
      }];
    }));
    window.localStorage.setItem('yunpai-upload-sessions', JSON.stringify({ state: { sessions }, version: 0 }));
  });
  await page.goto('/');

  const prompt = page.getByText('今天要处理什么？');
  const composer = page.getByTestId('chat-composer');
  const sender = page.locator('.chat-sender-opaque');
  await expect(prompt).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(sender).toBeVisible();
  await expect(page.locator('.upload-context-bar')).toBeVisible();
  await expect(page.locator('.upload-context-item')).toHaveCount(4);

  const promptBefore = await prompt.boundingBox();
  const composerBefore = await composer.boundingBox();
  expect(promptBefore).not.toBeNull();
  expect(composerBefore).not.toBeNull();

  await page.getByRole('button', { name: '展开订单流程大屏' }).click();
  const overlay = page.getByTestId('data-flow-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.getByRole('button', { name: '收起订单流程大屏' })).toHaveAttribute('aria-expanded', 'true');

  const promptAfter = await prompt.boundingBox();
  const composerAfter = await composer.boundingBox();
  expect(promptAfter).not.toBeNull();
  expect(composerAfter).not.toBeNull();
  expectSamePosition(promptBefore!, promptAfter!);
  expectSamePosition(composerBefore!, composerAfter!);

  await overlay.evaluate((element) => {
    const filler = document.createElement('div');
    filler.dataset.testid = 'overlay-scroll-filler';
    filler.style.height = '1200px';
    element.append(filler);
  });

  const overlayMetrics = await overlay.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    const style = getComputedStyle(element);
    return {
      position: style.position,
      overflowY: style.overflowY,
      backgroundColor: style.backgroundColor,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  expect(overlayMetrics.position).toBe('absolute');
  expect(overlayMetrics.overflowY).toBe('auto');
  expect(overlayMetrics.backgroundColor).toBe('rgb(255, 255, 255)');
  expect(overlayMetrics.scrollHeight).toBeGreaterThan(overlayMetrics.clientHeight);
  expect(overlayMetrics.scrollTop).toBeGreaterThan(0);

  const overlayBox = await overlay.boundingBox();
  const finalComposerBox = await composer.boundingBox();
  expect(overlayBox).not.toBeNull();
  expect(finalComposerBox).not.toBeNull();
  expect(overlayBox!.y + overlayBox!.height).toBeLessThanOrEqual(finalComposerBox!.y + 0.5);
  await expect(sender).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('session countdown flashes as a banner and expiry keeps the existing modal', async ({ page }) => {
  test.skip(!process.env.SESSION_EXPIRY_E2E, 'Run with real-mode Vite and SESSION_EXPIRY_E2E=1.');

  let expired = false;
  await page.route('**/api/auth/config', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      auth_mode: 'shared_anonymous',
      oidc_enabled: false,
      shared_data: true,
      csrf_required: true,
      capabilities: {
        anonymous_session: true,
        oidc_login: false,
        session_management: true,
        user_isolation: false,
      },
    }),
  }));
  await page.route('**/api/auth/me', (route) => {
    const now = Date.now();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        auth_mode: 'shared_anonymous',
        principal_type: 'shared_anonymous',
        user: null,
        tenant: { id: 'e2e-tenant', name: 'E2E' },
        shared_data: true,
        roles: [],
        permissions: [],
        session: {
          id: 'e2e-session',
          csrf_token: 'e2e-csrf',
          idle_expires_at: new Date(now + 4 * 60_000).toISOString(),
          absolute_expires_at: new Date(expired ? now - 1_000 : now + 60 * 60_000).toISOString(),
        },
      }),
    });
  });
  await page.route('**/api/orchestrator/chat/conversations**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: [], next_cursor: null }),
  }));
  await page.route('**/historical-order-catalog.json', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/run-config/candidate-run-manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));

  await page.goto('/');
  const warning = page.getByRole('alert').filter({ hasText: '会话即将过期' });
  await expect(warning).toBeVisible();
  await expect(page.getByRole('dialog', { name: '会话即将过期' })).toHaveCount(0);

  const viewport = page.viewportSize();
  const warningBox = await warning.boundingBox();
  expect(viewport).not.toBeNull();
  expect(warningBox).not.toBeNull();
  expect(warningBox!.x).toBe(0);
  expect(warningBox!.width).toBe(viewport!.width);

  const animation = await warning.evaluate((element) => {
    const style = getComputedStyle(element);
    const cssAnimation = element.getAnimations().find((item) => item instanceof CSSAnimation);
    if (!cssAnimation) throw new Error('Session warning CSS animation is missing');
    cssAnimation.pause();
    cssAnimation.currentTime = 0;
    const fromColor = getComputedStyle(element).backgroundColor;
    cssAnimation.currentTime = 1_400;
    const toColor = getComputedStyle(element).backgroundColor;
    return {
      name: style.animationName,
      duration: style.animationDuration,
      iterationCount: style.animationIterationCount,
      direction: style.animationDirection,
      fromColor,
      toColor,
    };
  });
  expect(animation.name).toContain('session-expiry-pulse');
  expect(animation.duration).toBe('1.4s');
  expect(animation.iterationCount).toBe('infinite');
  expect(animation.direction).toBe('alternate');
  expect(animation.fromColor).toBe('rgb(255, 255, 255)');
  expect(animation.toColor).toBe('rgb(255, 247, 204)');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(warning).toHaveCSS('animation-name', 'none');
  await expect(warning).toHaveCSS('background-color', 'rgb(255, 247, 204)');

  expired = true;
  await page.reload();
  await expect(page.getByRole('dialog', { name: '会话已过期' })).toBeVisible();
  await expect(page.locator('.session-expiry-mask')).toHaveCount(0);
});
