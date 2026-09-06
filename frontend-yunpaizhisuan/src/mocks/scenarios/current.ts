export type MockScenario = 'normal' | 'empty' | 'error' | 'permissionDenied' | 'timeout';

const scenarios: MockScenario[] = ['normal', 'empty', 'error', 'permissionDenied', 'timeout'];

export const getMockScenario = (): MockScenario => {
  if (typeof window === 'undefined') {
    return 'normal';
  }

  const value = new URLSearchParams(window.location.search).get('mockScenario') ?? localStorage.getItem('mockScenario') ?? 'normal';
  return scenarios.includes(value as MockScenario) ? (value as MockScenario) : 'normal';
};
