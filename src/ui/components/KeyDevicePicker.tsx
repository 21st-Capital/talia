/**
 * A known vault's keys, each with its recorded device (decided 2026-10-04: "the
 * address verification should only list KNOWN keys from the user. Currently,
 * it acts as if it doesnt know which hardware the user is using even though
 * the vault is already built!"; "Other than the above scenarios, the
 * Hardware and its associated key is KNOWN and we should list them instead
 * of guessing or asking").
 *
 * One row per key, in the rows of the "Which device?" list: the device's own
 * outline in its tile (`KeyDeviceTile`), the key's name, the device's model
 * under it, a chevron. A key whose device was never recorded shows the key
 * and "Not connected yet", and tapping it asks once which device holds it
 * (the caller shows that question); a Ledger kept as a bare brand shows the
 * brand's mark and asks among its models. The rows come from the registry's
 * `keyStep`, never written here.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { DeviceListRow } from './DevicePicker';
import { KeyDeviceTile } from './KeyDeviceTile';
import { keyRowSub } from './devicePickerModel';
import { recordOf } from '../../wallet/deviceKinds';
import type { KeyRow } from '../../wallet/deviceKinds';

export function KeyDevicePicker({
  rows,
  question,
  intro,
  onPick,
}: {
  rows: readonly KeyRow[];
  question?: string;
  intro?: string;
  onPick: (row: KeyRow) => void;
}): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      {!!question && <Text style={styles.question}>{question}</Text>}
      {!!intro && <Text style={styles.intro}>{intro}</Text>}
      {rows.map((r) => (
        <DeviceListRow
          key={r.id}
          mark={<KeyDeviceTile record={r.model != null ? recordOf(r.model) : r.kind != null ? { kind: r.kind } : null} />}
          name={r.name}
          sub={keyRowSub(r)}
          accessibilityLabel={`${r.name}, ${keyRowSub(r)}`}
          onPress={() => onPick(r)}
        />
      ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { gap: theme.spacing.sm },
    question: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.xs },
    intro: { ...theme.typography.body, color: theme.colors.slate, marginBottom: theme.spacing.sm },
  }),
);
