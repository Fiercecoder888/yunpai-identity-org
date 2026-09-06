import { describe, expect, it } from 'vitest';
import { formatDateOrPlaceholder } from './formatDateOrPlaceholder';

describe('formatDateOrPlaceholder', () => {
  it('returns the fallback for undefined / null / empty input', () => {
    expect(formatDateOrPlaceholder(undefined)).toBe('—');
    expect(formatDateOrPlaceholder(null)).toBe('—');
    expect(formatDateOrPlaceholder('')).toBe('—');
  });

  it('returns a custom fallback when provided', () => {
    expect(formatDateOrPlaceholder(undefined, 'N/A')).toBe('N/A');
  });

  it('returns the fallback for an invalid date string instead of a 1970 timestamp', () => {
    expect(formatDateOrPlaceholder('not-a-date')).toBe('—');
  });

  it('formats a valid date using zh-CN locale', () => {
    const value = formatDateOrPlaceholder('2026-06-26T09:20:00+08:00');
    expect(value).toContain('2026');
    expect(value).not.toContain('1970');
  });

  it('never leaks the epoch placeholder for missing timestamps', () => {
    expect(formatDateOrPlaceholder(undefined)).not.toContain('1970');
    expect(formatDateOrPlaceholder('not-a-date')).not.toContain('1970');
  });
});
