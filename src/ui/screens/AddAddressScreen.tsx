/**
 * Add an address to the address book (decided 2026-11-05, the design picked
 * for it: "its own page"). Opened from the book's + or from Send's "Save
 * address", which hands the address on Send over already in the field.
 *
 *   - the address is pasted or scanned, never typed (AddressField), and read
 *     as Send reads it, so an address of another network than the sending
 *     vault's is refused with Send's own title and OK;
 *   - a name, capped at MAX_NAME_LENGTH;
 *   - "Private Address" | "Exchange Address", Private Address preselected,
 *     so forgetting to choose keeps the check on;
 *   - VERIFY ADDRESS, and under it the spent-coins check for a Private
 *     Address, run as soon as the address is in and again when the choice
 *     comes back to Private Address, with Send's lines and gold notice. An
 *     address the book already holds is judged as it is saved: a saved
 *     Exchange Address is never looked up whatever is picked here, and
 *     nothing is asked until the book has been read (an unreadable book
 *     asks nothing: it cannot say what the address is saved as);
 *   - "Save address" once an address and a name are in. The check never
 *     blocks it; what it found is saved with the entry. An address already
 *     in the book is refused at Save, a title and OK. Saved, the page goes
 *     back to where it came from.
 *
 * With `editId` (Edit on a swiped card of the book, decided 2026-11-05) it
 * is that entry's own page, "Edit address": the address shown and held as
 * it is (a different address is a new entry), the name and the category
 * filled in to be changed, the check judged by the category chosen here,
 * and "Save" writing both at once. An entry gone meanwhile cannot be saved,
 * a title and OK.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import {
  AddressChunks,
  AddressField,
  AppDialog,
  AppModal,
  BookCheckLines,
  Button,
  Screen,
  SegmentedControl,
  TextField,
} from '../components';
import { useAddressBook } from '../hooks/useAddressBook';
import { useAddressBookCheck } from '../hooks/useAddressBookCheck';
import { QrScanner } from '../../platform/QrScanner';
import { readClipboard } from '../../platform/clipboard';
import { readSendAddress, refusedAddressTitle } from '../../bitcoin/scanParse';
import type { Network } from '../../bitcoin/descriptor/types';
import { ADDRESS_CATEGORIES, categoryOf, findBookEntry, MAX_NAME_LENGTH, saveAddress, updateEntry } from '../../wallet/addressBook';
import type { AddressCategory } from '../../wallet/addressBook';
import { ADDRESS_BOOK_WORDS as W, categoryName } from '../../wallet/addressBookWords';

type Props = NativeStackScreenProps<RootStackParamList, 'AddAddress'>;

const CHOICES: ReadonlyArray<{ value: AddressCategory; label: string }> = ADDRESS_CATEGORIES.map((value) => ({
  value,
  label: categoryName(value),
}));

/** The address handed over by Send, read again as a paste is; nothing when it does not read for this network. */
function handedOver(raw: string | undefined, network: Network): string {
  if (!raw) return '';
  const read = readSendAddress(raw, network);
  return read.kind === 'address' ? read.address : '';
}

export function AddAddressScreen({ navigation, route }: Props): React.JSX.Element {
  const { network, editId } = route.params;
  const editing = editId != null;
  const [address, setAddress] = useState(() => (editing ? '' : handedOver(route.params.address, network)));
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AddressCategory>('private');
  const [scanning, setScanning] = useState(false);
  const scanRefusal = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Kept whole while the dialog fades, so its title never empties on screen.
  const [told, setTold] = useState({ open: false, title: '' });
  const tell = (title: string) => setTold({ open: true, title });

  // An address already in the book is checked as saved (its category and what
  // was found before), never as the choice on this page; before the book is
  // read nothing is known about it, so nothing is asked.
  const book = useAddressBook();
  const edited = editing && book.entries ? book.entries.find((e) => e.id === editId) : undefined;
  // The entry's own page fills in what is saved, once, when the book is read.
  const filledIn = useRef(false);
  useEffect(() => {
    if (!edited || filledIn.current) return;
    filledIn.current = true;
    setAddress(edited.address);
    setName(edited.name);
    setCategory(categoryOf(edited));
  }, [edited]);
  useLayoutEffect(() => {
    if (editing) navigation.setOptions({ title: W.editAddress });
  }, [editing, navigation]);
  const known = book.entries && address ? findBookEntry(book.entries, address) : undefined;
  const check = useAddressBookCheck({
    address: address || null,
    // On the entry's own page the category is what is being chosen here.
    category: book.entries == null ? null : known && !editing ? categoryOf(known) : category,
    network,
    spentSeenAt: known?.spentSeenAt,
  });
  // What the check found stays with the address whichever category is picked
  // at Save: a spent address is never asked about again.
  const spentAt = useRef<{ address: string; at: number } | null>(null);
  if (check.state === 'spent' && check.spentSeenAt != null && address) spentAt.current = { address, at: check.spentSeenAt };

  const take = (raw: string): string | null => {
    const read = readSendAddress(raw, network);
    if (read.kind === 'address') {
      setAddress(read.address);
      return null;
    }
    return refusedAddressTitle(read.kind);
  };

  /** Pasted text, from the icon or from iOS's own bubble, reads the same. */
  const takePasted = (raw: string) => {
    const refused = take(raw);
    if (refused) tell(refused);
  };

  const pasteAddress = async () => {
    const raw = await readClipboard().catch(() => '');
    takePasted(raw ?? '');
  };

  // A refusal waits for the scanner to close: a dialog would open over it.
  const onScanned = (raw: string) => {
    setScanning(false);
    scanRefusal.current = take(raw);
  };
  const afterScanner = () => {
    if (scanRefusal.current) tell(scanRefusal.current);
    scanRefusal.current = null;
  };

  const ready = address.length > 0 && name.trim().length > 0;

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      if (editing) {
        const changed = editId ? await updateEntry(editId, { name, category }) : null;
        if (changed == null) {
          setSaving(false);
          tell(W.notSaved);
          return;
        }
        navigation.goBack();
        return;
      }
      const seen = spentAt.current?.address === address ? spentAt.current.at : undefined;
      const result = await saveAddress({ address, name, category, spentSeenAt: seen });
      if (result.kind === 'alreadySaved') {
        setSaving(false);
        tell(W.alreadySaved);
        return;
      }
      navigation.goBack();
    } catch {
      setSaving(false);
      tell(W.notSaved);
    }
  };

  return (
    <Screen
      scroll
      style={styles.content}
      footer={<Button title={editing ? W.save : W.saveAddress} onPress={() => void save()} disabled={!ready} loading={saving} />}>
      <AddressField
        address={address}
        // An entry's own page keeps its address as it is.
        locked={saving || editing}
        onPaste={() => void pasteAddress()}
        onPasted={takePasted}
        onScan={() => setScanning(true)}
        onReplace={() => setAddress('')}
      />
      <TextField
        label=""
        value={name}
        onChangeText={setName}
        placeholder={W.nameLabel}
        autoCapitalize="sentences"
        maxLength={MAX_NAME_LENGTH}
        hint={name.length >= MAX_NAME_LENGTH ? W.nameAtLimit : undefined}
      />
      <SegmentedControl options={CHOICES} value={category} onChange={setCategory} />

      {address.length > 0 && (
        <View style={styles.verifyBlock}>
          <Text style={styles.verifyLabel}>VERIFY ADDRESS</Text>
          <AddressChunks address={address} />
          <BookCheckLines check={check} />
        </View>
      )}

      <AppDialog
        visible={told.open}
        title={told.title}
        actions={[{ label: W.ok, variant: 'primary', onPress: () => {} }]}
        onClose={() => setTold((t) => ({ ...t, open: false }))}
      />

      <AppModal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)} onDismiss={afterScanner}>
        <QrScanner hint="Scan a Bitcoin address" onScanned={onScanned} onCancel={() => setScanning(false)} />
      </AppModal>
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // Send's address step, field for field.
    content: { gap: theme.spacing.md },
    verifyBlock: { marginTop: theme.spacing.xl, gap: theme.spacing.sm },
    verifyLabel: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.5 },
  }),
);
