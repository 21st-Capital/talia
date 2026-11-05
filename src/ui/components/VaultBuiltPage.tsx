/**
 * THE page after a vault is built in Talia (decided 2026-10-02, design B "Keys
 * into the lock", pace B2: "B2 is perfect. Time to build!"). Both builders
 * land here, and only they do: the vault wizard (LayeredVault) and Build
 * your vault (VaultBuilder). A guard test (`ui/__tests__/vaultBuilt.test.ts`)
 * keeps it that way.
 *
 * No header bar. Top to bottom: the drawn lock (`VaultBuiltMark`), "Vault
 * built" in Home's "Total Balance" style (the shared `heroLabel`), 4pt above
 * the vault's NAME as the 40pt hero (FitText), the shape line ("1 key",
 * "2 of 3 keys · 3 recovery paths"), the Keys card (the Sent page's own
 * `SentCard`; a recovery key says when its path opens), flexible space, the
 * sub line and the button. What each vault shows is decided in
 * `vaultBuiltModel.ts`, tested.
 *
 * It runs on the Sent page's clock (`useSentTimeline`, with this page's own
 * tracks), which starts once the page has arrived (`arrived`: its screen's
 * push is over) and the lock's size is settled. The haptic is `sentTick`, at
 * the final click. The button is visible as it rises but not tappable until
 * live, and VoiceOver hears "Vault built" and the vault's name then.
 *
 * The lock takes what room is left, up to the design's 220 box: the page is
 * laid out once with the smallest lock while nothing on it shows yet
 * (`vaultBuiltBox`, the Sent page's `sentMarkBox` rule), so the button ends
 * where the page ends on an iPhone SE. With no room even then, the page
 * scrolls.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { heroFigure, heroLabel, theme, themedStyles } from '../theme';
import { sentTick } from '../../platform/haptics';
import { Button } from './Button';
import { FitText } from './FitText';
import { useSentTimeline } from './SentMark';
import { Rise, SentCard } from './SentPage';
import { VaultBuiltMark } from './VaultBuiltMark';
import {
  LOCK_BOX,
  MIN_LOCK_BOX,
  VAULT_BUILT_TRACK_KEYS,
  vaultBuiltAnnouncement,
  vaultBuiltBox,
  vaultBuiltLine,
  vaultBuiltRows,
  vaultBuiltTimeline,
} from './vaultBuiltModel';
import type { VaultBuiltFacts, VaultBuiltWords } from './vaultBuiltModel';

interface Props {
  /** The vault as built: its name, its keys, its paths. */
  facts: VaultBuiltFacts;
  /** "Vault built", the sub line and the button's title. */
  words: VaultBuiltWords;
  /** The page has arrived on screen: its clock may start. */
  arrived: boolean;
  /** The button: register on hardware, or open the vault. */
  onNext: () => void;
}

/** If the page's first layout never reports, it shows at the design's size anyway. */
const SIZE_FALLBACK_MS = 500;
/** The flexible space's minimum, between the card and the sub line. */
const SPACER_MIN = theme.spacing.xl;

export function VaultBuiltPage({ facts, words, arrived, onNext }: Props): React.JSX.Element {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => on && setReduce(!!r))
      .catch(() => on && setReduce(false));
    return () => {
      on = false;
    };
  }, []);

  // The lock's size: null while the page is laid out with the smallest one,
  // then the largest that lets the button end where the page ends. Settled once.
  const [box, setBox] = useState<number | null>(null);
  const settle = (b: number) => setBox((cur) => cur ?? b);
  const heights = useRef<{ page?: number; top?: number; foot?: number }>({});
  const measure = (part: 'page' | 'top' | 'foot') => (e: LayoutChangeEvent) => {
    heights.current[part] = e.nativeEvent.layout.height;
    const { page, top, foot } = heights.current;
    if (page != null && top != null && foot != null) settle(vaultBuiltBox(page, top + SPACER_MIN + foot));
  };
  useEffect(() => {
    const t = setTimeout(() => setBox((cur) => cur ?? LOCK_BOX), SIZE_FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);

  const [live, setLive] = useState(false);
  // Nothing on the page shows before its clock starts, so the measuring
  // layout is never seen.
  const sized = box != null;
  const keyCount = facts.everyday.length;
  const timeline = useMemo(
    () => (sized && arrived && reduce != null ? vaultBuiltTimeline(reduce, keyCount) : null),
    [sized, arrived, reduce, keyCount],
  );
  const values = useSentTimeline(VAULT_BUILT_TRACK_KEYS, timeline, 0, sentTick, () => {
    setLive(true);
    AccessibilityInfo.announceForAccessibility(vaultBuiltAnnouncement(facts));
  });

  const names = useMemo(() => facts.everyday.map((k) => k.name), [facts]);
  const rows = useMemo(() => vaultBuiltRows(facts), [facts]);

  return (
    <View style={styles.page} onLayout={measure('page')}>
      <View style={styles.top} onLayout={measure('top')}>
        <VaultBuiltMark
          values={values}
          keys={names}
          recoveryPaths={facts.recoveryPaths}
          reduce={reduce ?? false}
          box={box ?? MIN_LOCK_BOX}
        />
        <Rise v={values.text1} style={styles.centre}>
          <Text style={styles.title} accessibilityRole="header">
            {words.title}
          </Text>
          <FitText style={styles.hero}>{facts.name}</FitText>
          <Text style={styles.line}>{vaultBuiltLine(facts)}</Text>
        </Rise>
        <Rise v={values.text2} style={styles.cardWrap}>
          <SentCard title="Keys" rows={rows} />
        </Rise>
      </View>
      <View style={styles.spacer} />
      <Rise v={values.text2} style={styles.foot} onLayout={measure('foot')}>
        <Text style={styles.sub}>{words.sub}</Text>
        {/* Visible as it rises, tappable once the timeline says so. */}
        <View
          style={styles.actions}
          pointerEvents={live ? 'auto' : 'none'}
          accessibilityElementsHidden={!live}
          importantForAccessibility={live ? 'auto' : 'no-hide-descendants'}>
          <Button title={words.action} onPress={onNext} />
        </View>
      </Rise>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    page: { flex: 1 },
    top: { alignItems: 'center', gap: theme.spacing.lg, paddingTop: theme.spacing.xl },
    // Home's total block: the label, 4pt, the hero, 4pt, the next line.
    centre: { alignItems: 'center', alignSelf: 'stretch', gap: 4 },
    // "Vault built" is Home's "Total Balance", through the one token.
    title: heroLabel(),
    hero: heroFigure(),
    line: { ...theme.typography.body, color: theme.colors.slate, textAlign: 'center' },
    cardWrap: { alignSelf: 'stretch' },
    spacer: { flex: 1, minHeight: SPACER_MIN },
    foot: { alignItems: 'center', alignSelf: 'stretch' },
    sub: {
      ...theme.typography.body,
      color: theme.colors.slate,
      textAlign: 'center',
      maxWidth: 300,
      marginBottom: theme.spacing.lg,
    },
    actions: { gap: theme.spacing.sm, alignSelf: 'stretch' },
  }),
);
