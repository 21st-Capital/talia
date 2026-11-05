/**
 * The Priority choice: High, Medium, Slow and the client's own rate, as the
 * `FeeSheet` rows of a screen that picks a fee from scratch. Send and the
 * Rescue's review step both use it, so the two read the same and neither
 * holds a copy (Speed up and Cancel have rows of their own: a minimum,
 * `replacementSheet`).
 *
 * The caller decides what a rate costs (`money`) and what a tap does.
 * Plain logic, no React Native.
 */
import { formatFeeRate, MAX_FEE_RATE, MIN_FEE_RATE } from '../../wallet/feeEstimates';
import type { FeePresets } from '../../wallet/feeEstimates';
import { TIER_ETA } from '../../wallet/txEta';
import type { FeeSheetCustom, FeeSheetRow } from '../components/FeeSheet';

export type Priority = 'fast' | 'medium' | 'slow' | 'custom';
/** The three tiers mempool.space gives us; 'custom' is the client's own. */
export type Tier = Exclude<Priority, 'custom'>;

/** The three choices, top to bottom; the waiting times are mempool.space's tiers. */
export const PRIORITIES: Array<{ key: Tier; label: string; eta: string }> = [
  { key: 'fast', label: 'High', eta: TIER_ETA.fast },
  { key: 'medium', label: 'Medium', eta: TIER_ETA.medium },
  { key: 'slow', label: 'Slow', eta: TIER_ETA.slow },
];

/** The typed rate, or null when it is not a usable number. Accepts a comma as
 *  the decimal mark, which is what a German keyboard offers. */
export function parseFeeRate(text: string): number | null {
  const n = parseFloat(text.replace(',', '.'));
  if (!Number.isFinite(n) || n < MIN_FEE_RATE || n > MAX_FEE_RATE) return null;
  return n;
}

/** The rate a choice stands for; a custom rate that cannot be used reads as Slow. */
export function priorityRate(presets: FeePresets, priority: Priority, customRate: string): number {
  if (priority !== 'custom') return presets[priority];
  return parseFeeRate(customRate) ?? presets.slow;
}

export function priorityLabel(priority: Priority): string {
  return priority === 'custom' ? 'Custom' : PRIORITIES.find((p) => p.key === priority)?.label ?? 'Medium';
}

type Money = (rate: number) => { main: string; sub: string | null };

export function priorityRows(args: {
  presets: FeePresets;
  priority: Priority;
  money: Money;
  onPick: (tier: Tier) => void;
}): FeeSheetRow[] {
  return PRIORITIES.map((p) => {
    const rate = args.presets[p.key];
    return {
      key: p.key,
      label: p.label,
      meta: `${p.eta} · ${formatFeeRate(rate)} sat/vB`,
      ...args.money(rate),
      on: args.priority === p.key,
      onPress: () => args.onPick(p.key),
    };
  });
}

/** Typing a usable number picks it; the sheet stays open, because the number
 *  is not finished until they stop typing. */
export function priorityCustom(args: {
  presets: FeePresets;
  priority: Priority;
  customRate: string;
  money: Money;
  onCustomRate: (text: string) => void;
  onPick: (priority: 'custom') => void;
}): FeeSheetCustom {
  const value = parseFeeRate(args.customRate);
  const figures = value != null ? args.money(value) : null;
  return {
    value: args.customRate,
    onChangeText: (t) => {
      args.onCustomRate(t);
      if (parseFeeRate(t) != null) args.onPick('custom');
    },
    onFocus: () => {
      if (value != null) args.onPick('custom');
    },
    placeholder: formatFeeRate(args.presets.slow),
    unitMeta: 'sat/vB',
    on: args.priority === 'custom',
    main: figures?.main ?? null,
    sub: figures?.sub ?? null,
    bad: args.customRate.trim() !== '' && value == null ? `${formatFeeRate(MIN_FEE_RATE)} to ${MAX_FEE_RATE}` : null,
  };
}
