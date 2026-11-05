/**
 * What "Which device?" lists, two levels deep (decided 2026-10-04, on the grid of
 * tiles: "this looks terrible!! We have to use a list view with brands
 * instead. If the user selects 'Ledger' we show another list with all the
 * supported models. That is more scalable later!"; and "It doesnt look nice
 * to repeat the same logo repeatedly! try to avoid that").
 *
 * The rows are computed from the models a step offers (the registry's
 * `modelsFor` and `deviceStep`), so a new brand or model is one registry
 * entry and no list is written here. A brand appears ONCE, with its models in
 * this list under it; its mark is drawn on that row and nowhere else.
 *
 * Pure: no React Native. Tested in `__tests__/devicePickerModel.test.ts`.
 */
import { deviceName, kindsOf, modelInfo, modelName } from '../../wallet/deviceKinds';
import type { DeviceKind, DeviceModel, KeyRow } from '../../wallet/deviceKinds';

/** The grey line under a key's name in a known vault's key list (decided
 *  2026-10-04: "list them instead of guessing or asking"): the device's
 *  model in full, the brand alone when its model was never kept, or that the
 *  device holding this key has not been connected to this phone yet. */
export const NOT_CONNECTED_YET = 'Not connected yet';

export function keyRowSub(row: Pick<KeyRow, 'model' | 'kind'> & { id?: string | null }): string {
  const device = row.model != null ? modelName(row.model) : row.kind != null ? deviceName(row.kind) : NOT_CONNECTED_YET;
  return withFingerprint(device, row.id);
}

/** The separator every second line uses between its facts (the vault cards'
 *  "tBTC · Multisig"). */
export const LINE_DOT = ' \u00b7 ';

/**
 * A key's second line: what it lives on, then its fingerprint, as the vault
 * cards join their facts (decided 2026-10-04: "add the fingerprint AFTER the model
 * name with a '·' in between. Use the same '·' we use on the vault overview
 * page"): "Ledger Nano Gen5 · 3442193E". A key kept by a bare xpub has no
 * fingerprint to show and keeps the first fact alone.
 */
export function withFingerprint(first: string, keyId?: string | null): string {
  const fp = keyId != null && /^[0-9a-f]{8}$/i.test(keyId) ? keyId.toUpperCase() : null;
  return fp ? `${first}${LINE_DOT}${fp}` : first;
}

export interface BrandRow {
  kind: DeviceKind;
  /** The brand as the registry names it. */
  name: string;
  /** The brand's models in THIS list, in the list's order. */
  models: DeviceModel[];
  /** The grey line under the name: the one product in full ("BitBox02
   *  Nova", "Foundation Passport"), or the models by their short names
   *  ("Nano Gen5, Flex, Stax, Nano X"). True for this list, since it is
   *  read off it. */
  sub: string;
}

/** One row per brand behind these models, once each, in the registry's order. */
export function brandRows(models: readonly DeviceModel[]): BrandRow[] {
  return kindsOf(models).map((kind) => {
    const own = models.filter((m) => modelInfo(m).kind === kind);
    return {
      kind,
      name: deviceName(kind),
      models: own,
      sub: own.length === 1 ? modelInfo(own[0]).fullName : own.map((m) => modelInfo(m).name).join(', '),
    };
  });
}

/** The model a brand row stands for when it has exactly one in this list
 *  (tapping it goes straight on); null when it has several (tapping it opens
 *  the list of its models). */
export function singleModelOf(row: BrandRow): DeviceModel | null {
  return row.models.length === 1 ? row.models[0] : null;
}

/**
 * The brand whose models the list opens on, skipping the brands level: the
 * one brand offered, when it has several models and nothing else sits in
 * the list (a Ledger kept as a bare brand asks among the Ledgers; a list of
 * one row to tap first would be a step for nothing). Null for every other
 * list: it opens on the brands.
 */
export function openingBrand(rows: readonly BrandRow[], hasAnother: boolean): BrandRow | null {
  if (hasAnother || rows.length !== 1) return null;
  return rows[0].models.length > 1 ? rows[0] : null;
}

/** Over Reconnect once a waiting page has stayed a while (decided 2026-10-05:
 *  "Still not connecting after already typing your pin?"): the BitBox asks
 *  for a password, a Ledger for a PIN. The ONE sentence on a slow wait (decided
 *  2026-10-15: the BitBox's own "Still working" line said it a second time),
 *  so the BitBox's advice to plug it in again lives here. */
export function reconnectHint(kind: string): string {
  return kind === 'bitbox'
    ? 'Still not connecting after typing your password? Unplug the device, plug it back in, then tap Reconnect.'
    : 'Still not connecting after typing your PIN? Tap Reconnect.';
}
