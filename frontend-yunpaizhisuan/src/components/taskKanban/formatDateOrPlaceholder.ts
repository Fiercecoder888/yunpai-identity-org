export function formatDateOrPlaceholder(value: string | null | undefined, fallback = '—'): string {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleString('zh-CN');
}
