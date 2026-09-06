import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex, sha256HexSync } from './sha256';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['云派制造', '9a147c2b07638f74d92a03429a230453d5a34922094192d0d5ebd6ab3bbf344d'],
  ])('matches the SHA-256 reference vector for %j', async (value, expected) => {
    const bytes = new TextEncoder().encode(value);
    expect(sha256HexSync(bytes)).toBe(expected);
    expect(await sha256Hex(value)).toBe(expected);
  });

  it('uses the exact SHA-256 fallback when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', {});

    await expect(sha256Hex('business:catalog-1:SO-1')).resolves.toBe(
      '337f09e978d4aa8f198e669e79bcd024445ada723dd0945a4a25bbb05b489329',
    );
  });

  it('uses the exact fallback when a partial WebCrypto implementation rejects digest', async () => {
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn().mockRejectedValue(new Error('not available in this context')) },
    });

    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
