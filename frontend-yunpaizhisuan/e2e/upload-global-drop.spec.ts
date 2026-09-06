import { expect, test } from '@playwright/test';

const fileDataTransfer = (files: Array<{ name: string; mimeType?: string }>) =>
  files.map((file) => ({
    name: file.name,
    type: file.mimeType ?? 'application/octet-stream',
  }));

const dragEnter = async (
  page: import('@playwright/test').Page,
  files: Array<{ name: string; mimeType?: string }>,
) =>
  page.evaluate((list) => {
    const dataTransfer = new DataTransfer();
    for (const file of list) {
      dataTransfer.items.add(new File(['order'], file.name, { type: file.type }));
    }
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true, cancelable: true }));
  }, fileDataTransfer(files));

const dragEnterText = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'hello');
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true, cancelable: true }));
  });

const dropFiles = async (
  page: import('@playwright/test').Page,
  files: Array<{ name: string; mimeType?: string }>,
) =>
  page.evaluate((list) => {
    const dataTransfer = new DataTransfer();
    for (const file of list) {
      dataTransfer.items.add(new File(['order'], file.name, { type: file.type }));
    }
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  }, fileDataTransfer(files));

const openAssistant = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await expect(page.getByText('云湃企业助手')).toBeVisible();
};

test('shows the chat drop overlay while a file drag hovers the window', async ({ page }) => {
  await openAssistant(page);

  await dragEnter(page, [{ name: 'hover-order.csv' }]);
  await expect(page.getByTestId('chat-drop-overlay')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '拖拽文件上传' })).toBeVisible();
});

test('does not show the overlay when dragging text or links', async ({ page }) => {
  await openAssistant(page);

  await dragEnterText(page);
  await expect(page.getByTestId('chat-drop-overlay')).toHaveCount(0);
});

test('closes the drop overlay with Escape', async ({ page }) => {
  await openAssistant(page);
  await dragEnter(page, [{ name: 'esc-order.csv' }]);
  await expect(page.getByTestId('chat-drop-overlay')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chat-drop-overlay')).toHaveCount(0);
});

test('prefills the order upload modal through the file input chain', async ({ page }) => {
  await openAssistant(page);
  await page.getByRole('button', { name: '上传或导入' }).click();
  await page.getByRole('menuitem', { name: '上传订单文件（订单到排程）' }).click();
  await expect(page.getByRole('dialog', { name: /上传订单文件/ })).toBeVisible();

  await page.locator('.order-upload-panel input[type="file"]').setInputFiles({
    name: 'sample-order.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('order,1\n'),
  });
  await expect(page.getByText('sample-order.csv')).toBeVisible();
});

test('opens the order upload modal prefilled after pasting an order file', async ({ page }) => {
  await openAssistant(page);

  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['order'], 'paste-order.csv', { type: 'text/csv' }));
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true }),
    );
  });

  await expect(page.getByRole('dialog', { name: /上传订单文件/ })).toBeVisible();
  await expect(page.getByText('paste-order.csv')).toBeVisible();
});

test('opens the order upload modal prefilled after dropping an order file', async ({ page }) => {
  await openAssistant(page);

  await dropFiles(page, [{ name: 'drop-order.csv' }]);

  await expect(page.getByRole('dialog', { name: /上传订单文件/ })).toBeVisible();
  await expect(page.getByText('drop-order.csv')).toBeVisible();
});
