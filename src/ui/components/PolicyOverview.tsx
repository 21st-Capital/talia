/**
 * The spending-policy picture, shared wherever a vault must explain itself
 * (decided 2026-09-01: the Estate Plan wizard shows this instead of a prose
 * summary). A timeline graphic with one lane per path showing when each
 * opens, then one card per path with a plain-English requirement and the
 * keys as chips. Extracted verbatim from PolicyScreen so the two surfaces
 * can never drift.
 *
 * It draws the picture and nothing a page acts on: the Policy screen's "Ask
 * 21st Capital to rescue this vault" is that page's own action and sits in
 * its pinned footer (decided 2026-10-05), not in a path's card.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path as SvgPath } from 'react-native-svg';

import { Card } from './Card';
import { InfoHeading } from './InfoDot';
import { KeyIcon } from './KeyIcon';
import { ClockIcon } from './TablerIcons';
import { theme, themedStyles } from '../theme';
import { formatBlocksDuration, formatWaitMonths } from '../../wallet/timelock';
import { ownKeysFirst } from '../../wallet/keyOrder';
import { keyDisplayName } from '../../wallet/keyNames';
import { pathStillShut } from '../../wallet/policyPathState';
import {
  parseKeyOrigins,
  parsePolicy,
  pathRequirement,
  stripChecksum,
} from '../../bitcoin/descriptor';
import type { PolicyGroup, PolicyPath } from '../../bitcoin/descriptor';
import { pathTitle } from './policyTitles';

const pathWhen = (p: PolicyPath): string => {
  if (p.olderBlocks !== undefined) {
    return `Opens after a coin sits untouched for ≈ ${monthsLabel(p.olderBlocks)}`;
  }
  if (p.afterHeight !== undefined && p.afterIsTime) {
    return `Opens on ${new Date(p.afterHeight * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
  }
  if (p.afterHeight !== undefined) return `Opens at block ${p.afterHeight.toLocaleString('en-US')}`;
  return 'Available now';
};

/**
 * The live countdown under a timelocked path's "Opens after" line: the full
 * time left until it opens on the soonest coin, always visible here even
 * while the vault screen keeps quiet about it (decided 2026-09-12). `null` means
 * no coin's clock has started.
 */
const nextOpeningLabel = (blocks: number | null, refreshAdvised: boolean): string => {
  if (blocks == null) return 'Starts when the first coin confirms.';
  // The vault notice's words (decided 2026-09-22: one sentence, true in any
  // scenario); the refresh advice only where the vault's owner reads it.
  if (blocks <= 0) return `Open now for at least one coin.${refreshAdvised ? ' Refresh recommended.' : ''}`;
  return `Opens in ≈ ${formatBlocksDuration(blocks)}.`;
};

/** The clocks ⓘ: true for every vault; how a refresh resets them only where
 *  a refresh is advised. A clock starts at CONFIRMATION, as the coin chip
 *  and the countdown line say (decided 2026-09-22: "when the coin arrives"
 *  was false for a coin still unconfirmed), and "a recovery path" holds for
 *  a vault with one path or several. */
const clocksInfo = (refreshAdvised: boolean): string =>
  'Every coin has its own clock. It starts once the coin confirms and starts again whenever that coin moves. Once a coin has sat untouched for as long as a recovery path shows here, that path opens for the coin.' +
  (refreshAdvised
    ? ' A refresh moves the coins to new addresses of this same vault, and each coin’s clock starts again once its transaction confirms.'
    : '');

/** The owner's footnote under the timeline: true whether a path is still
 *  closed or already open, for one path or several (decided 2026-09-22: "to
 *  keep the recovery paths closed" sat under "Open now for at least one
 *  coin"). */
const REFRESH_FOOTNOTE = 'Refreshing your coins starts their clocks again.';

/**
 * What this path actually demands, in one phrase.
 *
 * Joining each group with " + " read as a list of alternatives: a 3-of-3
 * written as an AND-chain (three groups of one key) said "1 key + 1 key + 1
 * key", which is exactly the vault that could not be identified (2026-07-28). The
 * headline now speaks for the whole path — "ALL 3 keys" is the phrase that
 * makes a dead end obvious.
 */
const groupHeadline = (groups: PolicyGroup[]): string => {
  const { needed, keys } = pathRequirement({ groups });
  if (keys.length === 1) return '1 key';
  if (needed >= keys.length) return `ALL ${keys.length} keys`;
  return `${needed} of ${keys.length} keys`;
};

/** One lane of the timeline: who, and after how long (none = spend now). */
export interface TimelineLane {
  label: string;
  olderBlocks?: number;
}

function laneLabel(p: PolicyPath, keyLabels?: Record<string, string>): string {
  const { needed, keys } = pathRequirement(p);
  if (keys.length === 1) {
    const fp = keys[0].fingerprint?.toLowerCase();
    return (fp && keyLabels?.[fp]) || (p.olderBlocks !== undefined ? 'Recovery key' : '1 key');
  }
  // Never "Your keys": the everyday path can hold an heir's key or 21st
  // Capital's co-signer, and on an heir's phone none of the others are
  // theirs (decided 2026-09-22, a label true in any scenario).
  return `${needed} of ${keys.length} keys`;
}

export function PolicyOverview({
  wallet,
  isProviderKey,
  onPressKey,
  nextOpening,
  pendingKeys,
  refreshAdvised = true,
}: {
  wallet: { label: string; descriptor: string; keyLabels?: Record<string, string> };
  isProviderKey: (fingerprint?: string) => boolean;
  /** Omit to render the key chips inert (no label editing). */
  onPressKey?: (fingerprint: string) => void;
  /** Blocks until each timelocked path opens on the soonest coin, keyed by
   *  the path's `olderBlocks` (null = no clock running yet). Omit to leave
   *  the countdown lines out, as the Estate Plan wizard does. */
  nextOpening?: Record<number, number | null>;
  /** Fingerprints of stand-ins for 21st Capital keys not fetched yet (the
   *  vault builder's summary). Their chip says the key comes at creation
   *  instead of showing a made-up fingerprint. */
  pendingKeys?: ReadonlySet<string>;
  /** Advise a refresh (the owner's phone). False on an heir's phone, where a
   *  refresh can restart the lock their access waits on. */
  refreshAdvised?: boolean;
}): React.JSX.Element | null {
  const policy = useMemo(() => {
    try {
      return parsePolicy(wallet.descriptor);
    } catch {
      return null;
    }
  }, [wallet.descriptor]);
  /** A vault built on ONE key is named by the vault, not by a number and
   *  never by its fingerprint (the same rule the Sign screen follows). */
  const oneKeyVault = useMemo(() => {
    try {
      const keys = parseKeyOrigins(stripChecksum(wallet.descriptor).body);
      return new Set(keys.map((k) => k.fingerprint?.toLowerCase() ?? k.xpub)).size <= 1;
    } catch {
      return false;
    }
  }, [wallet.descriptor]);
  if (!policy || policy.paths.length === 0) return null;

  const locked = policy.paths.filter((p) => p.olderBlocks !== undefined);

  // Grey while the clock runs (every timelocked path, heirs' included), kept
  // pure and tested in wallet/policyPathState.ts.
  const stillShut = (p: (typeof policy.paths)[number]) => pathStillShut(p, nextOpening);

  return (
    <>
      {locked.length > 0 && (
        <PolicyTimeline
          refreshAdvised={refreshAdvised}
          lanes={policy.paths
            .filter((p) => p.olderBlocks !== undefined || p.afterHeight === undefined)
            .map((p) => ({ label: laneLabel(p, wallet.keyLabels), olderBlocks: p.olderBlocks }))}
        />
      )}

      {policy.paths.map((p, i) => {
        const shut = stillShut(p);
        return (
        <Card key={i} style={styles.pathCard}>
          <View style={styles.pathHeader}>
            <Text style={[styles.pathTitle, shut && styles.shutText]}>
              {pathTitle(p, policy.paths)}
            </Text>
            <View
              style={[
                styles.badge,
                p.olderBlocks === undefined && p.afterHeight === undefined
                  ? styles.badgeNow
                  : styles.badgeLocked,
              ]}>
              <Text
                style={[
                  styles.badgeText,
                  p.olderBlocks === undefined && p.afterHeight === undefined
                    ? styles.badgeTextNow
                    : styles.badgeTextLocked,
                ]}>
                {p.olderBlocks === undefined && p.afterHeight === undefined ? 'ACTIVE' : 'TIMELOCKED'}
              </Text>
            </View>
          </View>
          <Text style={styles.when}>{pathWhen(p)}</Text>
          {nextOpening !== undefined && p.olderBlocks !== undefined && (
            <View style={styles.nextRow}>
              <ClockIcon size={14} color={theme.colors.gold} />
              <Text style={styles.nextText}>
                {nextOpeningLabel(nextOpening[p.olderBlocks] ?? null, refreshAdvised)}
              </Text>
            </View>
          )}
          <Text style={[styles.needs, shut && styles.shutText]}>
            Needs{' '}
            <Text style={[styles.needsBold, shut && styles.shutBold]}>{groupHeadline(p.groups)}</Text>{' '}
            to sign
          </Text>
          {p.groups.map((g, gi) => (
            <View key={gi} style={styles.chipWrap}>
              {/* 21st Capital's keys last, the client's own first (decided
                  2026-09-21): the descriptor's byte order said nothing. */}
              {ownKeysFirst(g.keys, (k) => isProviderKey(k.fingerprint)).map((k, ki) => {
                // The vault's own name for this key, else the number every
                // other screen gives it: a chip used to print the raw
                // fingerprint as if it were a name (decided 2026-09-26).
                const label = keyDisplayName(wallet, k.fingerprint, (fp) => isProviderKey(fp));
                const pending = !!k.fingerprint && !!pendingKeys?.has(k.fingerprint.toLowerCase());
                const editable =
                  !!onPressKey && !!k.fingerprint && !isProviderKey(k.fingerprint);
                return (
                  <TouchableOpacity
                    key={ki}
                    style={styles.chip}
                    activeOpacity={0.8}
                    disabled={!editable}
                    onPress={() => editable && onPressKey(k.fingerprint!)}>
                    <KeyIcon />
                    <Text style={[styles.chipName, shut && styles.shutText]} numberOfLines={2}>
                      {label ??
                        (isProviderKey(k.fingerprint)
                          ? '21st Capital'
                          : oneKeyVault
                            ? wallet.label
                            : k.fingerprint ?? 'key')}
                    </Text>
                    <Text style={styles.chipTail} numberOfLines={1}>
                      {pending
                        ? 'added at creation'
                        : (k.fingerprint ?? `…${k.xpub.slice(-6)}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </Card>
        );
      })}
    </>
  );
}

/**
 * Vault timeline — one LANE per spending path, like the Estate Plan PDF's
 * "Vault Overview" (decided 2026-07-28). The old single-line version could only
 * say "recovery unlocks here"; a lane per path shows WHO can spend and WHEN,
 * side by side, which is the thing clients actually ask.
 *
 * Three adaptations for a phone, none of them cosmetic:
 *   • The columns are the vault's OWN unlock points, not the PDF's fixed
 *     8/12/15 — a phone has room for two or three, and inventing months this
 *     vault does not have would be worse than fewer lines.
 *   • Columns are evenly spaced rather than proportional. A 3-block test lock
 *     beside a 15-month rescue would otherwise collapse onto the origin; the
 *     label under each column carries the real duration.
 *   • The label column is fixed and narrow, and its text wraps to two lines,
 *     so a long key name can never push the track off the card.
 */
export function PolicyTimeline({
  lanes: input,
  refreshAdvised = true,
}: {
  lanes: TimelineLane[];
  refreshAdvised?: boolean;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  // The open lane leads; timelocked lanes follow by ascending lock, which is
  // also the order they open.
  const primary = input.find((l) => l.olderBlocks === undefined);
  const locked = input
    .filter((l): l is TimelineLane & { olderBlocks: number } => l.olderBlocks !== undefined)
    .sort((a, b) => a.olderBlocks - b.olderBlocks);
  // Card content width: screen − the page gutter − the card's padding.
  const trackW = Math.max(
    140,
    width - PAGE_GUTTER * 2 - CARD_PAD * 2 - LABEL_W,
  );
  const lanes = [
    ...(primary ? [{ lane: primary, unlockAt: null as number | null }] : []),
    ...locked.map((l, i) => ({ lane: l, unlockAt: i })),
  ];
  // Evenly spaced columns, the last one short of the arrow.
  const colX = (i: number) => ((i + 1) * (trackW - ARROW - 6)) / (locked.length + 1);
  const midY = LANE_H / 2;

  /**
   * Fall back to a STACKED timeline when the columns would crowd (decided
   * 2026-07-28). Measured, not a layer count: three layers already collide
   * on a 6.1" phone while a Pro Max just fits them (MIN_COLUMN_GAP).
   *
   * The fallback is the same timeline turned on its side rather than a
   * generic picture — a stock image would look tidy and tell the client
   * nothing about THEIR vault, which is the one thing this card is for.
   */
  const columnGap = (trackW - ARROW - 6) / (locked.length + 1);
  if (columnGap < MIN_COLUMN_GAP) {
    return (
      <Card style={timelineStyles.card}>
        <InfoHeading
          style={timelineStyles.title}
          title="How the clocks work"
          text={clocksInfo(refreshAdvised)}>
          WHEN EACH PATH OPENS
        </InfoHeading>
        <View style={timelineStyles.stack}>
          {lanes.map((lane, i) => {
            const open = lane.unlockAt === null;
            const last = i === lanes.length - 1;
            return (
              <View key={i} style={timelineStyles.stackRow}>
                <View style={timelineStyles.stackRail}>
                  <View style={[timelineStyles.stackDot, !open && timelineStyles.stackDotLocked]} />
                  {!last && <View style={timelineStyles.stackLine} />}
                </View>
                <View style={timelineStyles.stackBody}>
                  <View style={timelineStyles.stackHead}>
                    <KeyIcon size={15} color={theme.colors.gold} />
                    <Text style={timelineStyles.stackName}>{lane.lane.label}</Text>
                  </View>
                  <Text style={timelineStyles.stackWhen}>
                    {open
                      ? 'can spend at any time'
                      : `opens after ${monthsLabel(lane.lane.olderBlocks ?? 0)}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        {refreshAdvised && (
          <Text style={timelineStyles.footnote}>{REFRESH_FOOTNOTE}</Text>
        )}
      </Card>
    );
  }

  return (
    <Card style={timelineStyles.card}>
      <InfoHeading
        style={timelineStyles.title}
        title="How the clocks work"
        text={clocksInfo(refreshAdvised)}>
        WHEN EACH PATH OPENS
      </InfoHeading>

      {/* Column headers, centred on their rule. The offset includes LABEL_W:
          an absolutely positioned child measures from the parent's padding
          EDGE, so padding would not move it (decided 2026-07-28). */}
      <View style={timelineStyles.headerRow}>
        {locked.map((p, i) => (
          <Text
            key={i}
            numberOfLines={1}
            style={[
              timelineStyles.colLabel,
              { left: LABEL_W + colX(i) - COL_LABEL_W / 2, width: COL_LABEL_W },
            ]}>
            {monthsLabel(p.olderBlocks ?? 0)}
          </Text>
        ))}
      </View>

      <View>
        {/* Column rules behind every lane. */}
        <View style={[timelineStyles.rules, { left: LABEL_W }]} pointerEvents="none">
          {locked.map((_, i) => (
            <View key={i} style={[timelineStyles.rule, { left: colX(i) }]} />
          ))}
        </View>

        {lanes.map((lane, i) => {
          const x = lane.unlockAt === null ? 0 : colX(lane.unlockAt);
          const open = lane.unlockAt === null;
          return (
            <View key={i} style={[timelineStyles.lane, { height: LANE_H }]}>
              <View style={[timelineStyles.laneLabel, { width: LABEL_W }]}>
                <KeyIcon size={15} color={theme.colors.gold} />
                <Text numberOfLines={2} style={timelineStyles.laneName}>
                  {lane.lane.label}
                </Text>
              </View>
              <Svg width={trackW} height={LANE_H}>
                {/* Closed stretch: dashed until this path opens. */}
                {!open && (
                  <Line
                    x1={OPEN_DOT_CX}
                    y1={midY}
                    x2={x}
                    y2={midY}
                    stroke={theme.colors.hairline}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                )}
                {/* Open stretch, running off to the right. */}
                <Line
                  x1={open ? OPEN_DOT_CX : x}
                  y1={midY}
                  x2={trackW - ARROW}
                  y2={midY}
                  stroke={theme.colors.gold}
                  strokeWidth={3}
                />
                <SvgPath
                  d={`M ${trackW - ARROW - 5} ${midY - 5} L ${trackW - 1} ${midY} L ${
                    trackW - ARROW - 5
                  } ${midY + 5}`}
                  stroke={theme.colors.gold}
                  strokeWidth={3}
                  fill="none"
                />
                {/* The moment it opens. */}
                <Circle
                  cx={open ? OPEN_DOT_CX : x}
                  cy={midY}
                  r={open ? OPEN_DOT_R : 6}
                  fill={open ? theme.colors.gold : theme.colors.hull}
                  stroke={theme.colors.gold}
                  strokeWidth={open ? 0 : 3}
                />
              </Svg>
            </View>
          );
        })}
      </View>

      {refreshAdvised && (
        <Text style={timelineStyles.footnote}>{REFRESH_FOOTNOTE}</Text>
      )}
    </Card>
  );
}

/**
 * Timelocks are spoken in MONTHS on this screen (decided 2026-07-28): the wording
 * is `formatWaitMonths`, shared with the "Vault built" page.
 */
const monthsLabel = formatWaitMonths;

/**
 * The drawing's measures. The page gutter and the card's padding are the
 * ones every page and every card use (decided 2026-10-05: the track was still
 * measured against the old `xl` gutter, so it stopped a gutter short of the
 * card's edge wherever the page had moved to `lg`).
 */
const PAGE_GUTTER = theme.spacing.lg;
const CARD_PAD = theme.spacing.lg;
/** The fixed label column, the lane's height and the arrowhead. */
const LABEL_W = 108;
const LANE_H = 46;
const ARROW = 9;
/** A column header's box, centred on its rule. */
const COL_LABEL_W = 74;
/**
 * Columns closer than this crowd: "15 months" in the caption face is about
 * 59pt wide and needs a breath on each side. Three layers already collide on
 * a 6.1" phone while a Pro Max just fits them.
 */
const MIN_COLUMN_GAP = 66;
/** The stacked fallback's rail: its width, its dots. */
const STACK_RAIL_W = 12;
const STACK_DOT = 11;
const STACK_DOT_LOCKED = 13;
/** The badge tints: the state colour at 16% (open) and 14% (timelocked). */
const BADGE_TINT_NOW = '29';
const BADGE_TINT_LOCKED = '24';

/**
 * The "available now" dot sits at the very start of its lane, so its CENTRE
 * must be at least its own radius from x=0 or SVG clips the left of it: it was
 * drawn at cx 3 with r 5, which put its left edge at -2 and shaved it flat
 * (decided 2026-08-29). One more point of inset keeps it clear of the edge.
 */
const OPEN_DOT_R = 5;
const OPEN_DOT_CX = OPEN_DOT_R + 1;

const timelineStyles = themedStyles(() => StyleSheet.create({
  card: { gap: theme.spacing.xs },
  title: { ...theme.typography.label, color: theme.colors.slate },

  // Column headers sit ABOVE the lanes and are absolutely placed, so a long
  // duration can never shove the next one along (decided 2026-07-28). Centred on
  // their rule: that is the drawing's geometry, not a text alignment.
  headerRow: { height: theme.typography.caption.lineHeight, marginTop: theme.spacing.xs },
  colLabel: {
    position: 'absolute',
    ...theme.typography.caption,
    color: theme.colors.slate,
    textAlign: 'center',
  },
  // Faint vertical rules, one per unlock point, behind every lane.
  rules: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  rule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.colors.hairline,
  },
  lane: { flexDirection: 'row', alignItems: 'center' },

  // Stacked fallback — the same timeline on its side, for vaults with more
  // recovery layers than the columns can hold (decided 2026-07-28).
  stack: { marginTop: theme.spacing.sm },
  stackRow: { flexDirection: 'row', gap: theme.spacing.md },
  stackRail: { width: STACK_RAIL_W, alignItems: 'center' },
  stackDot: {
    width: STACK_DOT,
    height: STACK_DOT,
    borderRadius: STACK_DOT / 2,
    marginTop: theme.spacing.xs,
    backgroundColor: theme.colors.gold,
  },
  stackDotLocked: {
    backgroundColor: theme.colors.hull,
    borderWidth: 3,
    borderColor: theme.colors.gold,
    width: STACK_DOT_LOCKED,
    height: STACK_DOT_LOCKED,
    borderRadius: STACK_DOT_LOCKED / 2,
  },
  stackLine: { flex: 1, width: 2, backgroundColor: theme.colors.hairline, marginVertical: 2 },
  stackBody: { flex: 1, paddingBottom: theme.spacing.lg },
  stackHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  stackName: { ...theme.typography.label, color: theme.colors.offWhite, flex: 1 },
  stackWhen: { ...theme.typography.caption, color: theme.colors.slate },
  laneLabel: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingRight: theme.spacing.sm },
  laneName: { ...theme.typography.caption, color: theme.colors.offWhite, flexShrink: 1 },
  footnote: { ...theme.typography.caption, color: theme.colors.slate, marginTop: theme.spacing.sm },
}));

const styles = themedStyles(() => StyleSheet.create({
  pathCard: { gap: theme.spacing.sm },
  pathHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  pathTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  badge: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  badgeNow: { backgroundColor: theme.colors.positive + BADGE_TINT_NOW },
  badgeLocked: { backgroundColor: theme.colors.gold + BADGE_TINT_LOCKED },
  // The badge's own 11pt: a sanctioned chip size, like GoldChip's.
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  badgeTextNow: { color: theme.colors.positive },
  badgeTextLocked: { color: theme.colors.gold },

  when: { ...theme.typography.body, color: theme.colors.slate },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  nextText: { ...theme.typography.caption, color: theme.colors.slate, flex: 1 },
  needs: { ...theme.typography.body, color: theme.colors.offWhite },
  needsBold: { ...theme.typography.bodyStrong, color: theme.colors.gold },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    // A long key name used to run past the card's right edge. Cap the chip
    // at the row width and let the NAME WRAP to a second line — the chip
    // grows taller rather than hiding characters (decided 2026-07-27).
    maxWidth: '100%',
    flexShrink: 1,
    // A stadium radius looks wrong on a two-line chip; a generous corner
    // reads the same at one line and stays right at two.
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  // The key's NAME (Key 1, the vault's own label for it): a label, not a
  // code. Its fingerprint beside it is the code and keeps the mono face.
  chipName: { ...theme.typography.label, color: theme.colors.offWhite, flexShrink: 1 },
  chipTail: { ...theme.typography.mono, color: theme.colors.slate, flexShrink: 0 },

  // A path whose clock is still running, in the signing screen's own greys.
  shutText: { color: theme.colors.slate },
  shutBold: { color: theme.colors.slate },
}));
