/**
 * The address book's pieces on Send and on the Add address page (decided
 * 2026-11-05, from the designs picked per screen):
 *
 *   - `SendBookCard`: Send's card while the address field is empty, under
 *     the Note to Self: the "ADDRESS BOOK" eyebrow, up to five saved
 *     addresses (name, the address cut in the middle, its category tag and
 *     the spent tag), and "Address book" as its last row.
 *   - `SavedNameRow`: once a saved address is in Send's field, its name and
 *     category in a row under the field, which opens the Address book page.
 *   - `SaveAddressLink`: the small "Save address" link under the field for
 *     an address that is not saved.
 *   - `BookCheckLines`: the spent-coins check under VERIFY ADDRESS, on Send
 *     and on the Add address page: a quiet line while the server is asked,
 *     the gold notice when the address has spent coins (its tap opens the
 *     reason, the info pattern), a quiet line with Try again when the server
 *     could not be asked, and nothing at all when nothing was found (never a
 *     "safe" claim). Nothing here disables or delays anything.
 *
 * Every word comes from wallet/addressBookWords.ts. An entry's category is
 * read through `categoryOf` and the words helpers only.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { categoryOf, showsSpentMark } from '../../wallet/addressBook';
import type { AddressBookEntry } from '../../wallet/addressBook';
import { ADDRESS_BOOK_WORDS as W, categoryName } from '../../wallet/addressBookWords';
import type { AddressBookCheck } from '../hooks/useAddressBookCheck';
import { theme, themedStyles } from '../theme';
import { Card } from './Card';
import { GoldChip } from './GoldChip';
import { InfoDialog } from './InfoDot';
import { NoticeBanner } from './NoticeBanner';
import { ChevronRightIcon, PlusIcon, WarningIcon } from './TablerIcons';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/** What VoiceOver reads for a saved entry: its name, its category, and the spent mark when it shows. */
export function entrySpokenName(entry: AddressBookEntry): string {
  const parts = [entry.name, categoryName(categoryOf(entry))];
  if (showsSpentMark(entry)) parts.push(W.hasSpentCoins);
  return parts.join(', ');
}

/** The entry's tags: its category, quiet, and the gold spent tag for a Private Address found spent. */
export function BookEntryTags({ entry }: { entry: AddressBookEntry }): React.JSX.Element {
  return (
    <View style={styles.tags}>
      <GoldChip tone="quiet" label={categoryName(categoryOf(entry)).toUpperCase()} />
      {showsSpentMark(entry) && <GoldChip label={W.hasSpentCoins.toUpperCase()} />}
    </View>
  );
}

/**
 * Send's card while the field is empty: `entries` already chosen for the
 * sending vault's network and cut to Send's limit (`sendListFor`). With
 * none, the card holds only the "Address book" row.
 */
export function SendBookCard({
  entries,
  onPick,
  onOpenBook,
}: {
  entries: readonly AddressBookEntry[];
  onPick: (entry: AddressBookEntry) => void;
  onOpenBook: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>{W.addressBookEyebrow}</Text>
      <Card style={styles.card}>
        {entries.map((entry) => (
          <TouchableOpacity
            key={entry.id}
            style={[styles.row, styles.rowDivided]}
            onPress={() => onPick(entry)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={entrySpokenName(entry)}>
            <View style={styles.rowBody}>
              <Text style={styles.name}>{entry.name}</Text>
              <Text style={styles.address} numberOfLines={1} ellipsizeMode="middle">
                {entry.address}
              </Text>
              <BookEntryTags entry={entry} />
            </View>
            <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenBook}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={W.addressBook}>
          <Text style={styles.openBook}>{W.addressBook}</Text>
          <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
        </TouchableOpacity>
      </Card>
    </View>
  );
}

/** The saved address's name and category under Send's field; opens the Address book page. */
export function SavedNameRow({ entry, onPress }: { entry: AddressBookEntry; onPress: () => void }): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.nameRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={entrySpokenName(entry)}>
      <View style={styles.nameBody}>
        <Text style={styles.name}>{entry.name}</Text>
        <Text style={styles.nameSub}>{categoryName(categoryOf(entry))}</Text>
      </View>
      <ChevronRightIcon size={20} color={theme.colors.slate} />
    </TouchableOpacity>
  );
}

/** "Save address" under Send's field, for an address that is not saved. */
export function SaveAddressLink({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.saveLink}
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={W.saveAddress}>
      <PlusIcon size={16} color={theme.colors.accentText} />
      <Text style={styles.link}>{W.saveAddress}</Text>
    </TouchableOpacity>
  );
}

/** The check's lines, under VERIFY ADDRESS. Nothing for 'idle' and 'notFound'. */
export function BookCheckLines({ check }: { check: AddressBookCheck }): React.JSX.Element | null {
  const [why, setWhy] = useState(false);
  if (check.state === 'checking') return <Text style={styles.quiet}>{W.checking}</Text>;
  if (check.state === 'unknown') {
    return (
      <View style={styles.quietRow}>
        <Text style={[styles.quiet, styles.grow]}>{W.couldNotCheck}</Text>
        <TouchableOpacity onPress={check.retry} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel={W.tryAgain}>
          <Text style={styles.link}>{W.tryAgain}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (check.state !== 'spent') return null;
  return (
    <>
      {/* The home screen's notice; gold for a warning, never red. Said, never a block. */}
      <NoticeBanner
        icon={<WarningIcon size={20} color={theme.colors.gold} />}
        onPress={() => setWhy(true)}
        style={styles.notice}>
        {W.spentNotice}
      </NoticeBanner>
      {why && <InfoDialog title={W.spentReasonTitle} text={W.spentReason} onClose={() => setWhy(false)} />}
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // Send's VERIFY ADDRESS block, as the card's own block.
    block: { marginTop: theme.spacing.xl, gap: theme.spacing.sm },
    eyebrow: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.5 },
    card: { padding: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    // Every saved row has the "Address book" row under it.
    rowDivided: { borderBottomWidth: 1, borderBottomColor: theme.colors.hairline },
    rowBody: { flex: 1, minWidth: 0, gap: theme.spacing.xs },
    // The row headline, as every row in the app; a name is never cut.
    name: { ...theme.typography.heading, color: theme.colors.offWhite },
    address: { ...theme.typography.mono, color: theme.colors.slate },
    tags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.sm },
    openBook: { ...theme.typography.bodyStrong, color: theme.colors.accentText, flex: 1 },
    // TextField's box, as the address field above it and the Note to Self under it.
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.hairline,
      borderRadius: theme.radius.md,
      paddingLeft: theme.spacing.md,
      paddingRight: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    nameBody: { flex: 1, minWidth: 0 },
    nameSub: { ...theme.typography.caption, color: theme.colors.slate },
    // A text link that belongs to what it sits under (Send's "Clear selection").
    saveLink: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
    link: { ...theme.typography.bodyStrong, color: theme.colors.accentText },
    quiet: { ...theme.typography.body, color: theme.colors.slate },
    quietRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.md },
    grow: { flexShrink: 1 },
    notice: { marginTop: theme.spacing.sm },
  }),
);
