const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DAYS_ABSOLUTE_THRESHOLD = 30;

export function parseTimestamp(value: Date | string | number | null | undefined): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  let timestamp: number;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === 'number') {
    timestamp = value;
  } else {
    timestamp = Date.parse(value);
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }
  return timestamp;
}

export function formatAbsoluteTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function relativeTime(value: Date | string | number | null | undefined, now = Date.now()): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === undefined) {
    return '—';
  }
  const diff = now - timestamp;
  if (diff < MINUTE_MS) {
    return '刚刚';
  }
  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS)} 分钟前`;
  }
  if (diff < DAY_MS) {
    return `${Math.floor(diff / HOUR_MS)} 小时前`;
  }
  if (diff < DAYS_ABSOLUTE_THRESHOLD * DAY_MS) {
    return `${Math.floor(diff / DAY_MS)} 天前`;
  }
  return formatAbsoluteTime(timestamp);
}
