import { describe, expect, it } from 'vitest';
import { formatAbsoluteTime, parseTimestamp, relativeTime } from './relativeTime';

const NOW = new Date(2026, 7, 9, 12, 0).getTime();

describe('parseTimestamp', () => {
  it('returns undefined for empty, null, invalid, and the 1970 epoch', () => {
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp(null)).toBeUndefined();
    expect(parseTimestamp('')).toBeUndefined();
    expect(parseTimestamp('not-a-date')).toBeUndefined();
    expect(parseTimestamp(0)).toBeUndefined();
    expect(parseTimestamp('1970-01-01T00:00:00Z')).toBeUndefined();
  });

  it('parses dates, timestamps, and date strings', () => {
    expect(parseTimestamp(new Date(NOW))).toBe(NOW);
    expect(parseTimestamp(NOW)).toBe(NOW);
    expect(parseTimestamp('2026-08-09T12:00:00+08:00')).toBe(Date.parse('2026-08-09T12:00:00+08:00'));
  });
});

describe('relativeTime', () => {
  it('shows the em dash for invalid or epoch timestamps', () => {
    expect(relativeTime(undefined, NOW)).toBe('—');
    expect(relativeTime(0, NOW)).toBe('—');
    expect(relativeTime('1970-01-01T00:00:00Z', NOW)).toBe('—');
  });

  it('shows 刚刚 within the first minute', () => {
    expect(relativeTime(new Date(NOW - 30 * 1000), NOW)).toBe('刚刚');
    expect(relativeTime(new Date(NOW + 10 * 1000), NOW)).toBe('刚刚');
  });

  it('shows N 分钟前 within the hour', () => {
    expect(relativeTime(NOW - 5 * 60 * 1000, NOW)).toBe('5 分钟前');
    expect(relativeTime(NOW - 59 * 60 * 1000, NOW)).toBe('59 分钟前');
  });

  it('shows N 小时前 within the day', () => {
    expect(relativeTime(NOW - 3 * 3600 * 1000, NOW)).toBe('3 小时前');
  });

  it('shows N 天前 within 30 days', () => {
    expect(relativeTime(NOW - 2 * 24 * 3600 * 1000, NOW)).toBe('2 天前');
    expect(relativeTime(NOW - 29 * 24 * 3600 * 1000, NOW)).toBe('29 天前');
  });

  it('falls back to an absolute time beyond 30 days', () => {
    expect(relativeTime(NOW - 40 * 24 * 3600 * 1000, NOW)).toBe(formatAbsoluteTime(NOW - 40 * 24 * 3600 * 1000));
  });
});

describe('formatAbsoluteTime', () => {
  it('formats as YYYY-MM-DD HH:mm', () => {
    expect(formatAbsoluteTime(NOW)).toBe('2026-08-09 12:00');
  });
});
