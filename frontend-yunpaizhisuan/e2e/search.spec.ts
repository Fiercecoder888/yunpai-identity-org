import { expect, test } from '@playwright/test';

test('searches entities from the command palette and switches tabs', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');

  const input = page.getByTestId('command-palette-input');
  await expect(input).toBeVisible();
  await input.fill('MAT');

  await expect(page.getByRole('tab', { name: /物料/ })).toBeVisible();
  await expect(page.getByText('轴承', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: /物料/ }).click();
  await expect(page.getByTestId('command-palette-list').getByText('轴承', { exact: true }).first()).toBeVisible();
});

test('opens a supplier entity result from the palette', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');

  const input = page.getByTestId('command-palette-input');
  await input.fill('华南电子');

  await expect(page.getByRole('tab', { name: /供应商 \(\d+\)/ })).toBeVisible();
  await page.getByRole('tab', { name: /供应商/ }).click();
  await expect(page.getByRole('button', { name: /华南电子供应商/ })).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/modules\/purchase-warnings/);
});
