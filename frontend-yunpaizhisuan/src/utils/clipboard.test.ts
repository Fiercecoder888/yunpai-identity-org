import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

type ClipboardDescriptor = PropertyDescriptor | undefined;

const originalClipboard: ClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommand: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(document, 'execCommand');

const setClipboard = (value: unknown) => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value });
};

const setExecCommand = (value: unknown) => {
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value });
};

const restore = (target: object, key: string, descriptor: ClipboardDescriptor) => {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
};

describe('copyText', () => {
  afterEach(() => {
    // 不要用 vi.restoreAllMocks()：它会把 setup.ts 里 matchMedia/ResizeObserver 的
    // vi.fn 实现一起清空，后续 antd 组件渲染会直接崩。这里只还原本文件改过的属性。
    restore(navigator, 'clipboard', originalClipboard);
    restore(document, 'execCommand', originalExecCommand);
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const execCommand = vi.fn().mockReturnValue(true);
    setExecCommand(execCommand);

    await expect(copyText('Worker@2026')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('Worker@2026');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to document.execCommand when navigator.clipboard is undefined', async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    setExecCommand(execCommand);

    await expect(copyText('Worker@2026')).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith('copy');
    // 临时 textarea 用完即移除，不留在页面上
    expect(document.querySelector('textarea[readonly]')).toBeNull();
  });

  it('falls back to execCommand when writeText rejects (insecure context)', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    setClipboard({ writeText });
    const execCommand = vi.fn().mockReturnValue(true);
    setExecCommand(execCommand);

    await expect(copyText('Worker@2026')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false without throwing when both paths fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    setClipboard({ writeText });
    setExecCommand(vi.fn().mockImplementation(() => {
      throw new Error('execCommand not supported');
    }));

    await expect(copyText('Worker@2026')).resolves.toBe(false);
  });

  it('returns false for empty text without touching the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    setExecCommand(vi.fn().mockReturnValue(true));

    await expect(copyText('')).resolves.toBe(false);

    expect(writeText).not.toHaveBeenCalled();
  });
});
