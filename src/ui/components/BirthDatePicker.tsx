/**
 * Birthdate picker (decided 2026-07-21): typing dates is error-prone, so pick
 * YEAR first, then MONTH, then DAY — the fastest way to land on a birthdate.
 * Displays DD/MM/YYYY; emits ISO (YYYY-MM-DD) so the backend/PDF pipeline
 * stays consistent with the website tool.
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

export function formatDob(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function BirthDatePicker({
  label,
  value,
  onChange,
  minAgeYears = 0,
}: {
  label: string;
  /** ISO date (YYYY-MM-DD) or ''. */
  value: string;
  onChange: (iso: string) => void;
  /** e.g. 18 for the vault owner; 0 for heirs (children can inherit). */
  minAgeYears?: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null); // 0-based

  const maxYear = new Date().getFullYear() - minAgeYears;
  const years = useMemo(
    () => Array.from({ length: maxYear - 1920 + 1 }, (_, i) => maxYear - i),
    [maxYear],
  );
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

  const start = () => {
    // Dismiss any focused field first: on iOS a TextInput that still holds
    // first-responder when this Modal opens gets its focus RESTORED when the
    // modal closes, which yanked the user back to the name field + reopened the
    // keyboard after picking a date.
    Keyboard.dismiss();
    setYear(null);
    setMonth(null);
    setOpen(true);
  };

  const pickDay = (d: number) => {
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
          {value ? formatDob(value) : 'DD/MM/YYYY'}
        </Text>
      </TouchableOpacity>

      <AppModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <GlassPanel style={styles.card} radius={theme.radius.lg}>
            <Text style={styles.title}>
              {year == null
                ? 'Year of birth'
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
                MONTHS.map((m, i) => (
                  <TouchableOpacity key={m} style={[styles.cell, styles.cellMonth]} onPress={() => setMonth(i)}>
                    <Text style={styles.cellText}>{m}</Text>
                  </TouchableOpacity>
                ))}
              {year != null &&
                month != null &&
                Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1).map((d) => (
                  <TouchableOpacity key={d} style={[styles.cell, styles.cellDay]} onPress={() => pickDay(d)}>
                    <Text style={styles.cellText}>{d}</Text>
                  </TouchableOpacity>
                ))}
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
  cellText: { ...theme.typography.body, color: theme.colors.offWhite },
  footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm },
}));
