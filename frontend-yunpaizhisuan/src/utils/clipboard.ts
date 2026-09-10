/**
 * 复制文本到剪贴板。
 *
 * 优先用异步 Clipboard API；但在**纯 HTTP + 非 localhost**（例如
 * `http://192.168.x.x:18003`）下浏览器不把页面视为安全上下文，
 * `navigator.clipboard` 为 undefined 或 `writeText` 直接抛 `NotAllowedError`
 * ——一次性初始密码因此“复制不进去”。此时退化为临时 `<textarea>` +
 * `document.execCommand('copy')`（在用户点击手势内仍然有效）。
 *
 * @returns 复制成功 true；两种方式都不可用 false（调用方需提示手动复制，且不要把明文藏起来）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 非安全上下文 / 权限被拒 → 走下面的兜底
    }
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(0, textarea.value.length);
    }
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(textarea);
    return Boolean(ok);
  } catch {
    return false;
  }
}
