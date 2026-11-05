/**
 * An in-memory stand-in for @react-native-async-storage/async-storage, for
 * Jest only. Use it as
 *   jest.mock('@react-native-async-storage/async-storage', () => require('<path>/testing/memoryAsyncStorage'));
 * It carries what wallet/sealedStore needs (getAllKeys, multiGet) besides
 * the single-value calls.
 */
const store = new Map<string, string>();

export async function getItem(k: string): Promise<string | null> {
  return store.get(k) ?? null;
}
export async function setItem(k: string, v: string): Promise<void> {
  store.set(k, v);
}
export async function removeItem(k: string): Promise<void> {
  store.delete(k);
}
export async function getAllKeys(): Promise<string[]> {
  return [...store.keys()];
}
export async function multiGet(keys: readonly string[]): Promise<[string, string | null][]> {
  return keys.map((k) => [k, store.get(k) ?? null]);
}
export const __store = store;
export function __clear(): void {
  store.clear();
}
export default { getItem, setItem, removeItem, getAllKeys, multiGet, __store, __clear };
