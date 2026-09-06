import { afterEach, describe, expect, it } from 'vitest';
import { isDebugMode } from './debugMode';

afterEach(() => {
  window.localStorage.removeItem('yp-debug');
  window.history.replaceState({}, '', '/');
});

describe('debugMode', () => {
  it('is enabled when the dev-server flag is present', () => {
    expect(isDebugMode({ DEV: true })).toBe(true);
    expect(isDebugMode({ DEV: false })).toBe(false);
  });

  it('is enabled via the ?debug URL query flag', () => {
    window.history.replaceState({}, '', '/dashboard?debug=1');
    expect(isDebugMode({ DEV: false })).toBe(true);
  });

  it('is enabled via the yp-debug localStorage flag', () => {
    window.localStorage.setItem('yp-debug', '1');
    expect(isDebugMode({ DEV: false })).toBe(true);
  });

  it('is disabled by default in a production-like environment', () => {
    expect(isDebugMode({ DEV: false })).toBe(false);
  });
});
