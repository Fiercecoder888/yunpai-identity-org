import { createUuid6Generator } from './uuid6';

describe('uuid6', () => {
  it('emits RFC 9562 version 6 identifiers with the RFC variant', () => {
    const uuid6 = createUuid6Generator(() => 1_700_000_000_000, (target) => target.fill(0xff));

    expect(uuid6()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('keeps identifiers ordered and unique within the same millisecond', () => {
    const uuid6 = createUuid6Generator(() => 1_700_000_000_000, (target) => target.fill(0));
    const first = uuid6();
    const second = uuid6();

    expect(second > first).toBe(true);
    expect(second).not.toBe(first);
  });
});
