import { describe, expect, it } from 'vitest';
import { isDemoRoleEnabled, isMswDemoMode } from './runtimeMode';

describe('runtimeMode', () => {
  it('enables MSW demo mode when no API base URL is configured', () => {
    expect(isMswDemoMode({})).toBe(true);
    expect(isMswDemoMode({ VITE_ENABLE_MSW: 'true', VITE_API_BASE_URL: '' })).toBe(true);
  });

  it('disables MSW demo mode for real API settings', () => {
    expect(isMswDemoMode({ VITE_API_BASE_URL: 'http://127.0.0.1:8000' })).toBe(false);
    expect(isMswDemoMode({ VITE_API_BASE_URL: '/api', VITE_ENABLE_MSW: 'false' })).toBe(false);
    expect(isMswDemoMode({ VITE_ENABLE_MSW: 'false' })).toBe(false);
  });

  it('enables demo role switching in MSW mode or with the explicit flag', () => {
    expect(isDemoRoleEnabled({})).toBe(true);
    expect(
      isDemoRoleEnabled({ VITE_ENABLE_DEMO_ROLES: 'true', VITE_API_BASE_URL: '/api', VITE_ENABLE_MSW: 'false' }),
    ).toBe(true);
  });

  it('disables demo role switching for a real build without the flag', () => {
    expect(isDemoRoleEnabled({ VITE_API_BASE_URL: '/api', VITE_ENABLE_MSW: 'false' })).toBe(false);
  });
});
