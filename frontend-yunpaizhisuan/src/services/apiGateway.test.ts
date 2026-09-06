import { describe, expect, it } from 'vitest';
import { toApiUrl, withQuery } from './apiGateway';

describe('apiGateway', () => {
  it('builds unified gateway paths from /api base', () => {
    expect(toApiUrl('/m4/alerts', { VITE_API_BASE_URL: '/api' })).toBe('/api/m4/alerts');
  });

  it('defaults empty base to /api for MSW demo mode', () => {
    expect(toApiUrl('/m0/parser-compat/tasks', { VITE_API_BASE_URL: '' })).toBe('/api/m0/parser-compat/tasks');
    expect(toApiUrl('m1/tasks', {})).toBe('/api/m1/tasks');
  });

  it('does not generate duplicate slashes', () => {
    expect(toApiUrl('/m4//alerts', { VITE_API_BASE_URL: '/api/' })).toBe('/api/m4/alerts');
  });

  it('rejects full hosts and legacy gateway-bypass paths', () => {
    expect(() => toApiUrl('http://m4:8000/api/m4/alerts')).toThrow(/gateway-relative/);
    expect(() => toApiUrl('//m4:8000/api/m4/alerts')).toThrow(/gateway-relative/);
    expect(() => toApiUrl('/api/v1/m3/orders')).toThrow(/bypasses/);
    expect(() => toApiUrl('/api/modules/m0/parser-compat/tasks')).toThrow(/bypasses/);
  });

  it('builds query strings without empty values', () => {
    expect(withQuery('/m4/alerts', { page: 1, status: 'open', empty: '', skip: undefined })).toBe('/m4/alerts?page=1&status=open');
    expect(withQuery('/m0/parser-compat/tasks', { status: 'need review' })).toBe('/m0/parser-compat/tasks?status=need+review');
    expect(withQuery('/m2/artifact', { path: 'bom/结果.xlsx' })).toBe('/m2/artifact?path=bom%2F%E7%BB%93%E6%9E%9C.xlsx');
  });

  it('preserves module-specific routes through the unified gateway', () => {
    expect(toApiUrl('/m3/procurement-plan:run-json', { VITE_API_BASE_URL: '/api' })).toBe('/api/m3/procurement-plan:run-json');
    expect(toApiUrl('/m4/suggestions/import-json', { VITE_API_BASE_URL: '/api' })).toBe('/api/m4/suggestions/import-json');
  });
});
