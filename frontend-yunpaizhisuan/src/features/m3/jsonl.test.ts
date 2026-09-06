import { describe, expect, it } from 'vitest';
import { HttpClientError } from '../../services/httpClient';
import {
  parseM3Jsonl,
  runM3JsonlBatch,
  serializeM3Jsonl,
  type M3JsonlEnvelope,
} from './jsonl';

const successEnvelope = (orderId: string): M3JsonlEnvelope => ({
  success: true,
  data: { order_id: orderId },
  errors: [],
  trace_id: `trace-${orderId}`,
});

describe('M3 JSONL helpers', () => {
  it('parses non-empty object lines and reports the original invalid line numbers', () => {
    const entries = parseM3Jsonl(
      [
        '{"order":{"order_id":"ORD-001"}}',
        '',
        '[1,2,3]',
        '{"order":',
        '{"order":{"order_id":"ORD-004"}}',
      ].join('\n'),
    );

    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ lineNumber: 1, orderId: 'ORD-001' });
    expect(entries[1]).toMatchObject({ lineNumber: 3, parseError: '每行必须是一个 JSON 对象' });
    expect(entries[2]).toMatchObject({ lineNumber: 4, payload: null });
    expect(entries[3]).toMatchObject({ lineNumber: 5, orderId: 'ORD-004' });
  });

  it('preserves input order while continuing after parse and request failures', async () => {
    const serverFailure: M3JsonlEnvelope = {
      success: false,
      data: null,
      errors: [{ code: 'NEXT_GENERATION_INPUT_INCOMPLETE', message: 'missing inventory' }],
      trace_id: 'trace-server-failure',
    };
    const entries = parseM3Jsonl(
      [
        '{"order":{"order_id":"ORD-001"}}',
        'not-json',
        '{"order":{"order_id":"ORD-003"}}',
      ].join('\n'),
    );

    const results = await runM3JsonlBatch(entries, async (payload) => {
      const order = payload.order as { order_id: string };
      if (order.order_id === 'ORD-003') {
        throw new HttpClientError({
          code: 'server_error',
          status: 422,
          message: 'Request failed with status 422',
          detail: serverFailure,
        });
      }
      return successEnvelope(order.order_id);
    });

    expect(results.map((result) => result.lineNumber)).toEqual([1, 2, 3]);
    expect(results.map((result) => result.envelope.success)).toEqual([true, false, false]);
    expect(results[1]!.envelope.errors[0]).toMatchObject({ code: 'JSONL_PARSE_ERROR' });
    expect(results[2]!.envelope).toEqual(serverFailure);
  });

  it('serializes one response envelope per line with a trailing newline', () => {
    const output = serializeM3Jsonl([successEnvelope('ORD-001'), successEnvelope('ORD-002')]);

    expect(output.split('\n')).toHaveLength(3);
    const firstLine = output.split('\n')[0];
    expect(firstLine).toBeDefined();
    expect(JSON.parse(firstLine!)).toMatchObject({
      success: true,
      data: { order_id: 'ORD-001' },
    });
    expect(output.endsWith('\n')).toBe(true);
  });
});
