const GREGORIAN_EPOCH_OFFSET_100NS = 0x01b21dd213814000n;

type RandomBytes = (target: Uint8Array) => Uint8Array;

export const createUuid6Generator = (
  now: () => number = Date.now,
  randomBytes: RandomBytes = (target) => globalThis.crypto.getRandomValues(target),
) => {
  let previousTimestamp = 0n;

  return () => {
    const wallClockTimestamp = BigInt(now()) * 10_000n + GREGORIAN_EPOCH_OFFSET_100NS;
    const timestamp = wallClockTimestamp > previousTimestamp ? wallClockTimestamp : previousTimestamp + 1n;
    previousTimestamp = timestamp;

    const bytes = randomBytes(new Uint8Array(16));
    bytes[0] = Number((timestamp >> 52n) & 0xffn);
    bytes[1] = Number((timestamp >> 44n) & 0xffn);
    bytes[2] = Number((timestamp >> 36n) & 0xffn);
    bytes[3] = Number((timestamp >> 28n) & 0xffn);
    bytes[4] = Number((timestamp >> 20n) & 0xffn);
    bytes[5] = Number((timestamp >> 12n) & 0xffn);
    bytes[6] = 0x60 | Number((timestamp >> 8n) & 0x0fn);
    bytes[7] = Number(timestamp & 0xffn);
    bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
};

export const uuid6 = createUuid6Generator();
