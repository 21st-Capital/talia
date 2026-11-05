/**
 * The hand-rolled UTF-8 codec that stands in for Hermes's missing
 * TextEncoder/TextDecoder (see src/polyfills.ts). @scure/btc-signer decodes a
 * PSBT's magic bytes through it, so a wrong byte here breaks signing on device
 * — checked against Node's own implementation rather than against itself.
 */
import { bytesToUtf8, utf8ToBytes } from '../bbqr';

// Node provides these; RN's tsconfig has no DOM lib, so declare what we use.
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } };
declare const TextDecoder: { new (): { decode(b: Uint8Array): string } };

const CASES = [
  '',
  'psbt',                       // what actually flows through it
  'PSBT\xff magic',
  'ASCII only, 123',
  'café münchen',               // 2-byte
  '中文字符 € ∑',               // 3-byte
  '🔑 🧊 𝄞',                    // 4-byte (surrogate pairs)
  'mixed: a·é·中·🔑 end',
];

describe('utf8 codec (Hermes TextEncoder/TextDecoder stand-in)', () => {
  it.each(CASES)('encodes exactly like Node: %j', (text) => {
    const expected = new TextEncoder().encode(text);
    expect(Array.from(utf8ToBytes(text))).toEqual(Array.from(expected));
  });

  it.each(CASES)('decodes exactly like Node: %j', (text) => {
    const bytes = new TextEncoder().encode(text);
    expect(bytesToUtf8(bytes)).toBe(new TextDecoder().decode(bytes));
  });

  it.each(CASES)('round-trips: %j', (text) => {
    expect(bytesToUtf8(utf8ToBytes(text))).toBe(text);
  });

  it('decodes an empty buffer', () => {
    expect(bytesToUtf8(new Uint8Array())).toBe('');
  });
});
