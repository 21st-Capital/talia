/**
 * An in-memory stand-in for react-native-keychain, for Jest only (the real
 * package is native and ships untranspiled ESM). Use it as
 *   jest.mock('react-native-keychain', () => require('<path>/testing/memoryKeychain'));
 * It records the options of every write so a test can check the protection
 * class, and `__failNextRead` simulates a Keychain that cannot answer.
 */
export const ACCESSIBLE = {
  WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly',
};

interface Item {
  username: string;
  password: string;
  options: Record<string, unknown>;
}

const items = new Map<string, Item>();
let failReads = 0;

export async function setGenericPassword(
  username: string,
  password: string,
  options: Record<string, unknown> = {},
): Promise<{ service: string; storage: string }> {
  const service = String(options.service ?? '');
  items.set(service, { username, password, options });
  return { service, storage: 'keychain' };
}

export async function getGenericPassword(
  options: Record<string, unknown> = {},
): Promise<false | { username: string; password: string; service: string; storage: string }> {
  if (failReads > 0) {
    failReads -= 1;
    throw new Error('User interaction is not allowed.');
  }
  const service = String(options.service ?? '');
  const item = items.get(service);
  return item ? { username: item.username, password: item.password, service, storage: 'keychain' } : false;
}

export async function resetGenericPassword(options: Record<string, unknown> = {}): Promise<boolean> {
  items.delete(String(options.service ?? ''));
  return true;
}

export function __items(): Map<string, Item> {
  return items;
}

export function __reset(): void {
  items.clear();
  failReads = 0;
}

export function __failNextRead(times = 1): void {
  failReads = times;
}
