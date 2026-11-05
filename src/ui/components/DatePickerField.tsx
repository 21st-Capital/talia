/**
 * Pick a date without typing it: YEAR → MONTH → DAY.
 *
 * Generalised out of BirthDatePicker (decided 2026-08-25) after a hand-typed date
 * field shipped in the manual wallet: it asked for YYYY-MM-DD behind a NUMERIC
 * keyboard, which has no "-" key — the field was literally impossible to fill
 * in. Dates are picked here, never typed.
 *
 * Displays DD/MM/YYYY; emits ISO (YYYY-MM-DD) so storage and comparison stay
 * unambiguous whatever the display format.
 */
import React, { useMemo, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from './AppModal';
import { theme, themedStyles } from '../theme';
import { Button } from './Button';
import { FADE_EDGE_H } from './FadeEdge';
import { GlassPanel } from './GlassPanel';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** ISO (YYYY-MM-DD) → DD/MM/YYYY. Empty string for anything unparseable. */
export function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function DatePickerField({
  label,
  value,
  onChange,
  minYear = 1920,
  maxYear,
  disallowFuture = false,
  yearTitle = 'Year',
}: {
  label: string;
  /** ISO date (YYYY-MM-DD) or ''. */
  value: string;
  onChange: (iso: string) => void;
  minYear?: number;
  /** Defaults to the current year. */
  maxYear?: number;
  /** Grey out days after today (a purchase cannot happen tomorrow). */
  disallowFuture?: boolean;
  /** Heading over the year grid, e.g. "Year of birth". */
  yearTitle?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null); // 0-based

  const today = new Date();
  const topYear = maxYear ?? today.getFullYear();
  const years = useMemo(
    () => Array.from({ length: Math.max(1, topYear - minYear + 1) }, (_, i) => topYear - i),
    [topYear, minYear],
  );
  const daysInMonth = (y: number, m: number): number => new Date(y, m + 1, 0).getDate();

  const start = (): void => {
    // Dismiss any focused field first: on iOS a TextInput still holding
    // first-responder when this Modal opens gets its focus RESTORED on close,
    // which yanks the user back to that field and reopens the keyboard.
    Keyboard.dismiss();
    setYear(null);
    setMonth(null);
    setOpen(true);
  };

  const isFuture = (y: number, m: number, d: number): boolean =>
    disallowFuture && new Date(y, m, d, 12).getTime() > today.getTime();

  const pickDay = (d: number): void => {
    if (year == null || month == null) return;
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    onChange(iso);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.field} onPress={start} activeOpacity={0.8}>
        <Text style={value ? styles.value : styles.placeholder}>
          {value ? formatIsoDate(value) : 'DD/MM/YYYY'}
        </Text>
      </TouchableOpacity>

      <AppModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <GlassPanel style={styles.card} radius={theme.radius.lg}>
            <Text style={styles.title}>
              {year == null
                ? yearTitle
                : month == null
                  ? `Month in ${year}`
                  : `Day in ${MONTHS[month]} ${year}`}
            </Text>
            <View style={styles.scrollWrap}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
              {year == null &&
                years.map((y) => (
                  <TouchableOpacity key={y} style={[styles.cell, styles.cellYear]} onPress={() => setYear(y)}>
                    <Text style={styles.cellText}>{y}</Text>
                  </TouchableOpacity>
                ))}
              {year != null &&
                month == null &&
                MONTHS.map((m, i) => {
                  const disabled = isFuture(year, i, 1);
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.cell, styles.cellMonth]}
                      disabled={disabled}
                      onPress={() => setMonth(i)}>
                      <Text style={[styles.cellText, disabled && styles.cellTextDisabled]}>{m}</Text>
                    </TouchableOpacity>
                  );
                })}
              {year != null &&
                month != null &&
                Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1).map((d) => {
                  const disabled = isFuture(year, month, d);
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[styles.cell, styles.cellDay]}
                      disabled={disabled}
                      onPress={() => pickDay(d)}>
                      <Text style={[styles.cellText, disabled && styles.cellTextDisabled]}>{d}</Text>
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>
            {/* NO fade here (decided 2026-09-14: "the shadowly lower part should
                not have edges"). A dissolve has to paint a solid ground, and
                over a translucent glass panel any solid reads as an opaque
                band with hard left and right edges, because it is inset by
                the card's padding. Inside a bordered panel the grid simply
                clips at the panel's own edge, and the padding below the last
                row lets it scroll clear. */}
            </View>
            {/* The sheet's own foot: Back, then Cancel, both quiet. */}
            <View style={styles.footerRow}>
              {(year != null || month != null) && (
                <Button
                  title="Back"
                  variant="ghost"
                  onPress={() => (month != null ? setMonth(null) : setYear(null))}
                />
              )}
              <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
            </View>
          </GlassPanel>
        </View>
      </AppModal>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { gap: theme.spacing.xs },
  label: { ...theme.typography.label, color: theme.colors.slate },
  // The same box as TextField's, so a date sits level with the fields around it.
  field: {
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  value: { ...theme.typography.body, color: theme.colors.offWhite },
  placeholder: { ...theme.typography.body, color: theme.colors.faint },
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  card: {
    alignSelf: 'stretch',
    maxHeight: '75%',
    // No ground of its own: GlassPanel's blur sits behind this style, so a
    // ground here is all the blur has to sample (decided 2026-09-14).
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  // A popup title, the same size as every dialog's (decided 2026-09-14).
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  scrollWrap: { flexShrink: 1 },
  scroll: { flexGrow: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, paddingBottom: FADE_EDGE_H },
  // One cell, three widths: four years, two months or eight days to a row.
  cell: {
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
  },
  cellYear: { width: '22%' },
  cellMonth: { width: '47%' },
  cellDay: { width: '12.5%' },
  // No `opacity` on a touchable: it paints that from its own native press
  // animation, so a dim can outlive the state that asked for it. A cell that
  // cannot be picked says so with its TEXT colour, which re-renders (the year
  // changes under these cells, so they do flip while mounted).
  cellText: { ...theme.typography.body, color: theme.colors.offWhite },
  cellTextDisabled: { color: theme.colors.faint },
  footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm },
}));
