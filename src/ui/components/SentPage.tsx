/**
 * THE page after a broadcast (decided 2026-10-02, design C "Sketch and ink", with
 * the sub line moved above Done as in design B). Every screen that sends a
 * transaction lands here and nowhere else: the signing screen, Pending
 * transactions (one, and Send all), the refresh session and the rescue. A
 * guard test (`ui/__tests__/sentPage.test.ts`) keeps it that way.
 *
 * Top to bottom: the drawn mark (`SentMark`), the title, the hero amount
 * (the 40pt hero with its unit in the same size and colour, FitText), the fiat line where the app shows
 * fiat, the card ("Receipt" with Share and Copy when someone outside the
 * vault was paid, "Details" with Copy otherwise), flexible space, the sub
 * line, the actions. What each case shows is decided in `sentPageModel.ts`;
 * the screen hands over what it really knows (`SentFacts`) and its words.
 *
 * The page arrives through StepTransition's slide, so the mark starts once
 * the slide has finished (`startAfterMs`). Done is visible as it rises but
 * not tappable until the timeline says so, and VoiceOver reads the title
 * then. Hidden balances read as dots, as on the transaction page.
 *
 * The parent gives the page its height: inside a scroll view, its content
 * container grows (`flexGrow: 1`) so the flexible space can push the sub
 * line and the actions to the foot. The mark takes what room is left, up to
 * the design's 220 box (decided 2026-10-02: on an iPhone SE, and with a
 * failures card on any phone, the full box pushed Done below the bottom
 * edge): the page is laid out once with the smallest mark while nothing on
 * it shows yet, and the clock starts once its size is settled
 * (`sentMarkBox`). With no room even then, the page scrolls.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { heroFigure, theme, themedStyles } from '../theme';
import { useWallets } from '../../wallet';
import { formatAmount } from '../../wallet/format';
import { formatFiat } from '../../wallet/price';
import { explorerTxUrl } from '../../wallet/explorer';
import type { WalletMeta } from '../../wallet/types';
import { copyToClipboard } from '../../platform/clipboard';
import { shareText } from '../../platform/files';
import { sentTick } from '../../platform/haptics';
import { useLiveRate } from '../hooks/useLiveRate';
import { Button } from './Button';
import { Card } from './Card';
import { FactRow } from './FactRow';
import { FitText } from './FitText';
import { InfoHeading } from './InfoDot';
import { STEP_SLIDE_MS } from './StepTransition';
import { CopyIcon, IosShareIcon } from './TablerIcons';
import { SentMark, useSentTimeline } from './SentMark';
import {
  fiatShown,
  heroParts,
  INK_BOX,
  MASK_HERO,
  MIN_INK_BOX,
  MASK_SMALL,
  SENT_TRACK_KEYS,
  sentCardTitle,
  sentCopyText,
  sentHeroSats,
  sentRows,
  sentMarkBox,
  sentShareSubject,
  sentShareText,
  sentTimeline,
} from './sentPageModel';
import type { SentFacts, SentRow, SentWords } from './sentPageModel';

export interface SentAction {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
}

interface Props {
  /** The vault it was sent from: its network and whether its balance is hidden. */
  wallet: WalletMeta;
  /** What was sent, as the screen knows it. */
  facts: SentFacts;
  /** The title (with its optional ⓘ) and the sub line. */
  words: SentWords;
  /** Done, or "Sign the next transaction" + "Stop here" mid-queue. */
  actions: SentAction[];
  /** A second card under the receipt (what did not go out). */
  extra?: React.ReactNode;
  /** When the mark starts: after the step's slide by default. */
  startAfterMs?: number;
}

/** A block that settles in: rises 12pt and fades, on one track (the "Vault built" page's too). */
export function Rise({
  v,
  style,
  onLayout,
  children,
}: {
  v: Animated.Value;
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const lift = useRef(v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] })).current;
  return (
    <Animated.View onLayout={onLayout} style={[style, { opacity: v, transform: [{ translateY: lift }] }]}>
      {children}
    </Animated.View>
  );
}

/**
 * The Sent page's card: its heading in the label style with the heading's
 * icons, its rows (label left, value right, a note under the row when it
 * has one) and a closing line. The receipt ("Receipt" / "Details") is one,
 * and so is any card under it (what did not go out, decided 2026-10-02: it
 * had its own caption-sized heading), so the two cannot look different.
 */
export function SentCard({
  title,
  icons,
  rows,
  foot,
}: {
  title: string;
  icons?: React.ReactNode;
  rows: ReadonlyArray<SentRow>;
  foot?: string;
}): React.JSX.Element {
  return (
    <Card style={styles.receipt}>
      <View style={styles.receiptHead}>
        <Text style={styles.label}>{title}</Text>
        <View style={styles.receiptIcons}>{icons}</View>
      </View>
      {rows.map((r, i) => (
        <View key={`${r.label}:${i}`} style={styles.rowBlock}>
          <FactRow label={r.label} value={r.value} mono={r.mono} />
          {r.note != null && <Text style={styles.note}>{r.note}</Text>}
        </View>
      ))}
      {foot != null && <Text style={styles.note}>{foot}</Text>}
    </Card>
  );
}

/** If the page's first layout never reports, it shows at the design's size anyway. */
const SIZE_FALLBACK_MS = 500;

export function SentPage({
  wallet,
  facts,
  words,
  actions,
  extra,
  startAfterMs = STEP_SLIDE_MS,
}: Props): React.JSX.Element {
  const { settings } = useWallets();
  const masked = settings.hideBalances || !!wallet.balanceHidden;

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

  // The mark's size: null while the page is laid out with the smallest one,
  // then the largest that lets Done end where the page ends. Settled once.
  const [box, setBox] = useState<number | null>(null);
  const settle = (b: number) => setBox((cur) => cur ?? b);
  const heights = useRef<{ page?: number; top?: number; foot?: number }>({});
  const measure = (part: 'page' | 'top' | 'foot') => (e: LayoutChangeEvent) => {
    heights.current[part] = e.nativeEvent.layout.height;
    const { page, top, foot } = heights.current;
    if (page != null && top != null && foot != null) settle(sentMarkBox(page, top + SPACER_MIN + foot));
  };
  useEffect(() => {
    const t = setTimeout(() => setBox((cur) => cur ?? INK_BOX), SIZE_FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);

  const [live, setLive] = useState(false);
  // Nothing on the page shows before its clock starts, so the measuring
  // layout is never seen. The clock starts once Reduce Motion is known and
  // the mark's size is settled.
  const sized = box != null;
  const timeline = useMemo(() => (sized && reduce != null ? sentTimeline(reduce) : null), [sized, reduce]);
  const values = useSentTimeline(SENT_TRACK_KEYS, timeline, startAfterMs, sentTick, () => {
    setLive(true);
    AccessibilityInfo.announceForAccessibility(words.title);
  });

  const heroSats = sentHeroSats(facts);
  const hero = heroSats != null ? heroParts(heroSats, settings.unit) : null;
  // The fiat line holds its place from the first frame, so a rate that
  // arrives late fills it instead of pushing the card down. A receipt does
  // not tick: the first rate is the one it keeps.
  const fiatOn = heroSats != null && fiatShown(wallet.network, settings.btcOnly);
  const liveRate = useLiveRate(settings.fiat, fiatOn);
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (rate == null && liveRate != null) setRate(liveRate);
  }, [rate, liveRate]);
  const fiat = fiatOn && rate != null && heroSats != null ? (masked ? MASK_SMALL : formatFiat(heroSats, rate, settings.fiat)) : ' ';

  // The explorer link for one transaction (`explorerTxUrl`): sharing asks no
  // server, so it is there whatever server the vault uses (decided 2026-10-22).
  const share = sentShareText(facts, facts.txids.length === 1 ? explorerTxUrl(wallet.network, facts.txids[0]) : null, (s) =>
    formatAmount(s, settings.unit),
  );
  const rows = sentRows(facts, masked);
  const several = facts.txids.length > 1;

  return (
    <View style={styles.page} onLayout={measure('page')}>
      <View style={styles.top} onLayout={measure('top')}>
        <SentMark values={values} reduce={reduce ?? false} box={box ?? MIN_INK_BOX} />
        <Rise v={values.text1} style={styles.centre}>
          {words.titleInfo ? (
            <InfoHeading style={[styles.title, styles.centreText]} title={words.titleInfo.title} text={words.titleInfo.text}>
              {words.title}
            </InfoHeading>
          ) : (
            <Text style={[styles.title, styles.centreText]} accessibilityRole="header">
              {words.title}
            </Text>
          )}
          {hero != null && (
            <FitText style={styles.hero}>
              {masked ? (
                MASK_HERO
              ) : (
                // The unit in the figure's own size and colour, as every
                // balance draws it (decided 2026-10-03: "Match the success page
                // with the balance design").
                `${hero.figure} ${hero.unit}`
              )}
            </FitText>
          )}
          {fiatOn && <Text style={styles.line}>{fiat}</Text>}
        </Rise>
        <Rise v={values.text2} style={styles.cardWrap}>
          <SentCard
            title={sentCardTitle(facts)}
            rows={rows}
            icons={
              <>
                {/* Share is offered with hidden balances too, and the text
                    carries the real amount: hiding balances keeps them off
                    the screen, while sharing is a deliberate act and the
                    recipient needs the amount (decided 2026-10-02). */}
                {share != null && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Share confirmation"
                    hitSlop={HIT}
                    style={styles.iconTap}
                    onPress={() => void shareText(share, sentShareSubject(facts)).catch(() => {})}>
                    <IosShareIcon size={18} strokeWidth={2} color={theme.colors.slate} />
                  </TouchableOpacity>
                )}
                {facts.txids.length > 0 && (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={several ? 'Copy transaction IDs' : 'Copy transaction ID'}
                    hitSlop={HIT}
                    style={styles.iconTap}
                    onPress={() => copyToClipboard(sentCopyText(facts))}>
                    <CopyIcon size={18} strokeWidth={2} color={theme.colors.slate} />
                  </TouchableOpacity>
                )}
              </>
            }
          />
          {extra}
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
          {actions.map((a) => (
            <Button
              key={a.title}
              title={a.title}
              variant={a.variant ?? 'primary'}
              loading={a.loading}
              disabled={a.disabled}
              onPress={a.onPress}
            />
          ))}
        </View>
      </Rise>
    </View>
  );
}

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };
/** The flexible space's minimum, between the card and the sub line. */
const SPACER_MIN = theme.spacing.xl;

const styles = themedStyles(() =>
  StyleSheet.create({
    page: { flex: 1 },
    top: { alignItems: 'center', gap: theme.spacing.lg, paddingTop: theme.spacing.xl },
    centre: { alignItems: 'center', alignSelf: 'stretch' },
    centreText: { textAlign: 'center' },
    title: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.sm },
    hero: heroFigure(),
    // One hero spacing: the next line sits 4pt under the hero's line box.
    line: { ...theme.typography.body, color: theme.colors.slate, marginTop: theme.spacing.xs, textAlign: 'center' },
    cardWrap: { alignSelf: 'stretch', gap: theme.spacing.md },
    receipt: { gap: theme.spacing.sm },
    receiptHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.xs,
    },
    receiptIcons: { flexDirection: 'row', gap: theme.spacing.md },
    iconTap: { padding: theme.spacing.xs, margin: -theme.spacing.xs },
    label: { ...theme.typography.label, color: theme.colors.slate },
    // A row and the note under it (a failed coin's reason) hold together.
    rowBlock: { gap: theme.spacing.xs },
    note: { ...theme.typography.body, color: theme.colors.slate },
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
