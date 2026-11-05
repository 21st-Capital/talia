/**
 * The mark of a key in a list of a vault's keys (decided 2026-10-04: "since we
 * now know which device the user is using, why not use the same icons during
 * the signing ceremony instead of a bare key icon (except the cosigner, which
 * cannot have a HWW icon)"): the recorded device's own outline in the glossy
 * tile the "Which device?" list draws (`ModelTile`), the brand's mark when
 * the record names a brand but no model (a Ledger from before models were
 * kept), and the key itself in the same tile when the vault knows no device
 * for it. 21st Capital's keys are handed no record and keep the key.
 *
 * A state's colour (a key that has signed) re-inks the outline or the key;
 * the brand's mark is another company's artwork and cannot be re-inked, so
 * the colour washes over its tile instead (decided 2026-10-04: a signed key
 * on a brand-only record kept its everyday mark). The wash is the state's
 * colour at its own translucency, a colour and never an opacity on the tile
 * (decided 2026-10-05).
 *
 * One tile per record, drawn here alone, so the signing screen's rows, the
 * key picker of Replace signing device and the known-keys list of every
 * hardware step show the same mark for the same key.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { themedStyles } from '../theme';
import { DEVICE_ROW_MARK, GlyphTile, ModelTile } from './DeviceModelGlyph';
import { KeyIcon } from './KeyIcon';
import { ProviderTile } from './ProviderLogo';
import { deviceKindInfo, modelOfRecord } from '../../wallet/deviceKinds';
import type { KeyDevice } from '../../wallet/types';

const KEY_GLYPH = 22;

/** The wash's translucency as a colour's alpha byte (45%). */
const WASH_ALPHA = '73';

/** The state's colour as the wash over a brand's mark: a six-digit hex gets
 *  the wash's alpha; any other form is laid on as it is. */
const washOf = (color: string): string => (/^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${WASH_ALPHA}` : color);

export function KeyDeviceTile({ record, color }: { record: KeyDevice | null | undefined; color?: string }): React.JSX.Element {
  const model = modelOfRecord(record);
  if (model != null) return <ModelTile model={model} color={color} />;
  if (record && deviceKindInfo(record.kind)) {
    return <BrandMark record={record} color={color != null ? washOf(color) : null} />;
  }
  return (
    <GlyphTile>
      <KeyIcon size={KEY_GLYPH} color={color} />
    </GlyphTile>
  );
}

/** A brand's own mark, with the state's wash over it when there is a state. */
function BrandMark({ record, color }: { record: KeyDevice; color: string | null }): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <ProviderTile provider={record.kind} size={DEVICE_ROW_MARK} />
      {color != null && <View style={[styles.wash, { backgroundColor: color }]} pointerEvents="none" />}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { width: DEVICE_ROW_MARK, height: DEVICE_ROW_MARK },
    // The brand tile's own corner radius, so the wash ends where it ends.
    wash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: DEVICE_ROW_MARK * 0.22 },
  }),
);
