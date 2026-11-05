/**
 * The Address book page, opened from Send (decided 2026-11-05, the design
 * picked for it: "its own page"). Two sections headed "Private Address" and
 * "Exchange Address", a section with no entries left out, each entry its
 * own card: the name, the address's start and end (`shortBookAddress`), and
 * for a Private Address known to have spent coins the gold line "Has spent
 * coins before". Only the entries the sending vault's network can pay are
 * listed; with none, one centred quiet line that is true for this vault
 * ("No saved addresses yet", or none for its network).
 *
 *   - a tap puts that address on Send and goes back, exactly as a tap on a
 *     row of Send's card (Send reads it as a paste);
 *   - a card swiped to the left shows Edit and Remove, as in Google's
 *     authenticator app (decided 2026-11-05 after a phone test, in place of
 *     a long press): Edit opens the entry's own page (its name and category;
 *     the address never changes), Remove asks first, "Remove <name>?". A
 *     card swiped all the way runs Remove, which still asks. One card is
 *     open at a time; while one is, the page does not scroll and a tap on
 *     any card closes it (as in Google's app), and VoiceOver offers both as
 *     the card's own actions. While a card is open the page's own
 *     swipe back is off, so a swipe to the right closes the card instead of
 *     leaving the page (decided 2026-11-05 after a phone test: it went back
 *     to Send);
 *   - the round + in the bar opens Add address.
 *
 * Every word comes from wallet/addressBookWords.ts; an entry's category is
 * read through `categoryOf` only. Nothing here asks a server.
 */
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AccessibilityActionEvent } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { AppDialog, Card, HeaderIconButton, Screen, SwipeRow, entrySpokenName } from '../components';
import type { SwipeAction } from '../components';
import { PencilIcon, PlusIcon, TrashIcon, WarningIcon } from '../components/TablerIcons';
import { useAddressBook } from '../hooks/useAddressBook';
import { bookSections, removeEntry, shortBookAddress, showsSpentMark } from '../../wallet/addressBook';
import type { AddressBookEntry } from '../../wallet/addressBook';
import { ADDRESS_BOOK_WORDS as W, emptyForNetwork, removeTitle } from '../../wallet/addressBookWords';

type Props = NativeStackScreenProps<RootStackParamList, 'AddressBook'>;

/** A dialog closes before the next one opens, or iOS swallows it (the modal-stacking trap). */
const AFTER_MODAL_MS = 450;

/** A dialog about one entry, kept whole while it fades, so its title never empties on screen. */
interface Shown {
  open: boolean;
  entry: AddressBookEntry | null;
}
const CLOSED: Shown = { open: false, entry: null };

export function AddressBookScreen({ navigation, route }: Props): React.JSX.Element {
  const { walletId, network } = route.params;
  const book = useAddressBook();
  const sections = useMemo(() => (book.entries ? bookSections(book.entries, network) : []), [book.entries, network]);

  /** The one card swiped open, if any. */
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * A finger is swiping a card. The page holds still under it, and for as
   * long as a card shows Edit and Remove, as Google's authenticator app does
   * (decided 2026-11-05 after a phone test).
   */
  const [swiping, setSwiping] = useState(false);
  const holdStill = swiping || openId != null;
  const [removing, setRemoving] = useState<Shown>(CLOSED);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderIconButton label={W.addAddress} onPress={() => navigation.navigate('AddAddress', { network })}>
          <PlusIcon size={20} strokeWidth={2.5} />
        </HeaderIconButton>
      ),
    });
  }, [navigation, network]);

  // An open card owns the sideways swipe: the page's swipe back waits.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: openId == null });
  }, [navigation, openId]);

  /** Back to Send with this address on it, as Send's own rows do. */
  const pick = (entry: AddressBookEntry) => {
    navigation.popTo('Send', { walletId, picked: { address: entry.address, at: Date.now() } }, { merge: true });
  };

  const edit = (entry: AddressBookEntry) => {
    setOpenId(null);
    navigation.navigate('AddAddress', { network, editId: entry.id });
  };

  const askRemove = (entry: AddressBookEntry) => {
    setOpenId(null);
    setRemoving({ open: true, entry });
  };

  /** A removal that could not be written says so, title and OK, once its confirm has closed. */
  const write = (change: Promise<unknown>) => {
    change.catch(() => setTimeout(() => setFailed(true), AFTER_MODAL_MS));
  };

  const actionsFor = (entry: AddressBookEntry): SwipeAction[] => [
    { label: W.edit, icon: <PencilIcon size={22} color={theme.colors.offWhite} />, onPress: () => edit(entry) },
    {
      label: W.remove,
      icon: <TrashIcon size={22} color={theme.colors.white} />,
      destructive: true,
      onPress: () => askRemove(entry),
    },
  ];

  const onCardAction = (entry: AddressBookEntry) => (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'edit') edit(entry);
    if (e.nativeEvent.actionName === 'remove') askRemove(entry);
  };

  const removeEntryShown = removing.entry;

  return (
    <Screen scroll style={styles.content} scrollEnabled={!holdStill}>
      {book.unreadable ? (
        <Text style={styles.quiet}>{W.unreadable}</Text>
      ) : book.entries && sections.length === 0 ? (
        <Text style={styles.quiet}>{book.entries.length === 0 ? W.empty : emptyForNetwork(network)}</Text>
      ) : (
        sections.map((section) => (
          <View key={section.group} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.entries.map((entry) => (
              <SwipeRow
                key={entry.id}
                open={openId === entry.id}
                onOpen={() => setOpenId(entry.id)}
                onClose={() => setOpenId((id) => (id === entry.id ? null : id))}
                actions={actionsFor(entry)}
                fullSwipe
                onSwipeStart={() => setSwiping(true)}
                onSwipeEnd={() => setSwiping(false)}>
                <TouchableOpacity
                  // While a card is open, a tap on any card closes it; only
                  // then does a tap pick.
                  onPress={() => (openId != null ? setOpenId(null) : pick(entry))}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={entrySpokenName(entry)}
                  accessibilityActions={[
                    { name: 'edit', label: W.edit },
                    { name: 'remove', label: W.remove },
                  ]}
                  onAccessibilityAction={onCardAction(entry)}>
                  <Card style={styles.card}>
                    <Text style={styles.name}>{entry.name}</Text>
                    <Text style={styles.address}>{shortBookAddress(entry.address)}</Text>
                    {showsSpentMark(entry) && (
                      <View style={styles.spentRow}>
                        <WarningIcon size={18} color={theme.colors.gold} />
                        <Text style={styles.spentText}>{W.hasSpentCoins}</Text>
                      </View>
                    )}
                  </Card>
                </TouchableOpacity>
              </SwipeRow>
            ))}
          </View>
        ))
      )}

      <AppDialog
        visible={removing.open}
        title={removeEntryShown ? removeTitle(removeEntryShown.name) : ''}
        actions={[
          {
            label: W.remove,
            destructive: true,
            onPress: () => {
              if (removeEntryShown) write(removeEntry(removeEntryShown.id));
            },
          },
          { label: W.cancel, variant: 'ghost', onPress: () => {} },
        ]}
        onClose={() => setRemoving((r) => ({ ...r, open: false }))}
      />

      <AppDialog
        visible={failed}
        title={W.notSaved}
        actions={[{ label: W.ok, variant: 'primary', onPress: () => {} }]}
        onClose={() => setFailed(false)}
      />
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.xl },
    section: { gap: theme.spacing.sm },
    sectionTitle: { ...theme.typography.heading, color: theme.colors.offWhite, marginBottom: theme.spacing.xs },
    card: { gap: 2 },
    // A name is never cut; the address shows its start and end (`shortBookAddress`).
    name: { ...theme.typography.heading, color: theme.colors.offWhite },
    address: { ...theme.typography.mono, color: theme.colors.slate },
    spentRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    spentText: { ...theme.typography.bodyStrong, color: theme.colors.gold, flex: 1 },
    // An empty or unreadable book: centred with room above, as the app's other empty states.
    quiet: { ...theme.typography.body, color: theme.colors.slate, textAlign: 'center', paddingVertical: theme.spacing.xxl },
  }),
);
