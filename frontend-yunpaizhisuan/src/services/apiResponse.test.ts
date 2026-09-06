import { describe, expect, it } from 'vitest';
import { parsePage, unwrapEnvelope } from './apiResponse';

describe('apiResponse', () => {
  it('unwraps successful envelopes and leaves bare payloads intact', () => {
    expect(unwrapEnvelope<{ id: string }>({ success: true, data: { id: 'A' }, errors: [] })).toEqual({ id: 'A' });
    expect(unwrapEnvelope<string[]>(['A', 'B'])).toEqual(['A', 'B']);
    expect(unwrapEnvelope<{ ok: boolean }>({ ok: true })).toEqual({ ok: true });
  });

  it('throws business errors for failed envelopes', () => {
    expect(() => unwrapEnvelope({ success: false, data: null, errors: [{ code: 'bad_request', message: '审批失败' }] })).toThrow(
      '审批失败',
    );
    expect(() => unwrapEnvelope({ success: false, data: null })).toThrow('Business request failed');
    expect(() =>
      unwrapEnvelope({
        success: false,
        data: null,
        errors: [{ message: 'first' }, { message: 'second' }],
      }),
    ).toThrow('first');
    expect(() => unwrapEnvelope({ success: false, data: null, errors: [] })).toThrow('Business request failed');
  });

  it('parses M4 style page payloads', () => {
    expect(parsePage({ items: [{ id: 1 }], page: 1, page_size: 20, total: 1 }, (value) => value as { id: number })).toEqual({
      items: [{ id: 1 }],
      page: 1,
      page_size: 20,
      total: 1,
    });
  });

  it('rejects malformed page payloads', () => {
    expect(() => parsePage([{ id: 1 }], (value) => value)).toThrow('Invalid page response');
    expect(() => parsePage({ items: [{ id: 1 }], page: 1, page_size: 20 }, (value) => value)).toThrow('Invalid page response');
    expect(() => parsePage({ items: [{ id: 1 }], page: 1, page_size: 'x', total: 1 }, (value) => value)).toThrow(
      'Invalid page response',
    );
  });
});
