import { describe, expect, it } from 'vitest';
import { m1MetadataSchema, m1ReviewSubmitSchema } from './m1';

describe('m1 schemas', () => {
  it('accepts valid upload metadata', () => {
    expect(
      m1MetadataSchema.parse({
        source: 'manual',
        documentType: 'drawing',
        priority: 'high',
        operatorNote: '订单图纸优先识别',
      }),
    ).toMatchObject({ source: 'manual', documentType: 'drawing' });
  });

  it('rejects invalid metadata enum values', () => {
    expect(() => m1MetadataSchema.parse({ source: 'ftp' })).toThrow();
  });

  it('requires corrected value and reason for review submit', () => {
    expect(() => m1ReviewSubmitSchema.parse({ correctedValue: '', reason: '' })).toThrow();
  });
});
