/**
 * Where an entry's bitcoin was bought or sold (decided 2026-10-22, a client's
 * request): the exchanges in the order `wallet/entrySources.ts` lists them,
 * then "Peer to peer", then "Other", which asks for a name. A search field on
 * top, because twenty-two rows are more than a phone shows at once.
 *
 * The rows are the device list's glass rows (name, chevron). No exchange
 * gets a logo: Talia has artwork for two of them, and a list where some rows
 * carry a mark and the rest do not reads as broken, while an invented logo
 * is never an option.
 *
 * The answer goes back to the entry form through its `picked` param, the
 * way the address check answers Receive.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { AppDialog, Button, DeviceListRow, Screen, TextField } from '../components';
import {
  MAX_SOURCE_NAME_LENGTH,
  OTHER_SOURCE,
  cleanSourceName,
  entrySourceName,
  sourceFieldsFor,
  sourcePickerRows,
} from '../../wallet';

type Props = NativeStackScreenProps<VirtualStackParamList, 'EntrySource'>;

/** A modal dismisses before a navigation happens, or iOS swallows it. */
const AFTER_MODAL_MS = 450;

export function EntrySourceScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId, entryId, source, sourceName } = route.params;
  const [query, setQuery] = useState('');
  const rows = useMemo(() => sourcePickerRows(query), [query]);
  const [askName, setAskName] = useState(false);
  const chosen = source ? entrySourceName({ id: '', source, sourceName }) : undefined;

  const answer = (picked: { source: string | null; sourceName?: string }) => {
    navigation.popTo('ManualEntry', { walletId, entryId, picked: { ...picked, at: Date.now() } }, { merge: true });
  };

  const pick = (key: string) => {
    if (key === OTHER_SOURCE.key) {
      setAskName(true);
      return;
    }
    const fields = sourceFieldsFor(key);
    if (fields) answer(fields);
  };

  // "Other" opens on what is already there: the name typed before, else
  // what the search was looking for (a source the list does not name).
  const otherStart = source === OTHER_SOURCE.key && sourceName ? sourceName : cleanSourceName(query);

  return (
    <Screen
      scroll
      footer={
        // Taking a source off is one tap, and only offered when there is one.
        chosen ? <Button title="No source" variant="ghost" onPress={() => answer({ source: null })} /> : undefined
      }>
      <View style={styles.body}>
        <TextField label="" value={query} onChangeText={setQuery} placeholder="Search" />
        <View style={styles.list}>
          {rows.map((r) => (
            <DeviceListRow
              key={r.key}
              name={r.name}
              // A name wraps at its spaces rather than cut at large text.
              wrap
              // The current pick says so on its row; "Other" shows the name
              // it was given.
              sub={
                source === r.key
                  ? r.key === OTHER_SOURCE.key && chosen
                    ? `Chosen: ${chosen}`
                    : 'Chosen'
                  : undefined
              }
              onPress={() => pick(r.key)}
            />
          ))}
        </View>
      </View>

      <AppDialog
        visible={askName}
        title="Other source"
        input={{
          label: '',
          placeholder: 'Name',
          autoCapitalize: 'sentences',
          defaultValue: otherStart,
          maxLength: MAX_SOURCE_NAME_LENGTH,
          hintAtLimit: `Up to ${MAX_SOURCE_NAME_LENGTH} characters`,
        }}
        actions={[
          {
            label: 'Save',
            variant: 'primary',
            requiresInput: true,
            onPress: (typed) => {
              const fields = sourceFieldsFor(OTHER_SOURCE.key, typed);
              // The dialog is a modal: let it close before the page goes back,
              // or iOS swallows the navigation (the known modal-stacking trap).
              if (fields) setTimeout(() => answer(fields), AFTER_MODAL_MS);
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => {} },
        ]}
        onClose={() => setAskName(false)}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    body: { gap: theme.spacing.lg },
    // The device list's pitch.
    list: { gap: theme.spacing.sm },
  }),
);
