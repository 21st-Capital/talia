/**
 * iOS's own Paste bubble (decided 2026-11-01 after a phone test: a tap on the
 * address field did nothing). What matters: a build whose native module lacks
 * the method answers null and never throws, so the field stays as it was, and
 * the bubble stays iOS's own, which is what spares the client "Allow Paste?".
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mockNative: { module: Record<string, unknown> | undefined } = { module: undefined };

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: {
    get TaliaPasteboard() {
      return mockNative.module;
    },
  },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ __esModule: true, default: {} }));
jest.mock('../secretCopy', () => ({ SECRET_COPY_POLICY: {} }));

/** The module reads the native side once, as it loads. */
function clipboardWith(module: Record<string, unknown> | undefined): typeof import('../clipboard') {
  mockNative.module = module;
  let loaded!: typeof import('../clipboard');
  jest.isolateModules(() => {
    loaded = require('../clipboard');
  });
  return loaded;
}

describe('the Paste bubble', () => {
  it('asks the native side at the point it was given and hands back the text', async () => {
    const presentPasteMenu = jest.fn(async () => 'tb1qaddress');
    const { pasteBubble } = clipboardWith({ presentPasteMenu });
    await expect(pasteBubble(120, 240)).resolves.toBe('tb1qaddress');
    expect(presentPasteMenu).toHaveBeenCalledWith(120, 240);
  });

  it('answers null when no bubble showed or it closed with no paste', async () => {
    const { pasteBubble } = clipboardWith({ presentPasteMenu: async () => null });
    await expect(pasteBubble(1, 2)).resolves.toBeNull();
  });

  it('answers null on a build whose native module has no such method, or no module', async () => {
    await expect(clipboardWith({ setSecretString: () => undefined }).pasteBubble(1, 2)).resolves.toBeNull();
    await expect(clipboardWith(undefined).pasteBubble(1, 2)).resolves.toBeNull();
  });

  it('answers null when the native side fails', async () => {
    const { pasteBubble } = clipboardWith({
      presentPasteMenu: async () => {
        throw new Error('no window');
      },
    });
    await expect(pasteBubble(1, 2)).resolves.toBeNull();
  });

  it('offers iOS\'s own Paste alone and never builds an action of its own', () => {
    const native = readFileSync(join(__dirname, '..', '..', '..', 'native', 'taliapasteboard', 'TaliaPasteboard.m'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(native).toMatch(/return action == @selector\(paste:\);/);
    expect(native).toMatch(/UIPasteboard\.generalPasteboard\.hasStrings/);
    expect(native).not.toMatch(/\bUIAction\b|\bUICommand\b|actionWithTitle/);
    expect(native).not.toMatch(/menuForConfiguration/);
  });
});
