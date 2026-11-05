/**
 * The co-signing limit control, shared by the Estate Plan wizard and the
 * Co-signing limits screen (decided 2026-09-19: amounts to pick, a typed amount
 * only behind "Custom"). Each limit is a dropdown (decided 2026-09-21: chips made
 * the screen "way too full"). Limits are in BTC only, monthly and yearly (decided
 * 2026-09-21), so there is no unit to choose.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SelectField } from './SelectField';
import { TextField } from './TextField';
import { theme, themedStyles } from '../theme';
import { LIMIT_PRESETS, LIMIT_UNIT, limitInput, limitText, matchingPreset, presetLabel } from '../../services/limitPresets';

/** The dropdown's own value for "type an amount instead". */
const CUSTOM = '__custom';

/**
 * One limit: pick an amount, or "Custom amount" to type one (decided 2026-09-19:
 * options first, typing only if the client insists, so no typing mistakes).
 * "No limit" clears it.
 *
 * The typed field opens ONLY when the client picks "Custom amount" (decided
 * 2026-09-21: "why are you showing the amount twice even if the user has
 * picked a selection?"). A saved amount shows in the dropdown itself: a
 * preset as that preset, matched by value because the server may keep
 * "0.50" where the list reads "0.5", and any other amount as written.
 */
export function LimitField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
}): React.JSX.Element {
  const presets = LIMIT_PRESETS.map(presetLabel);
  const preset = matchingPreset(value);
  const empty = value.trim() === '';
  const [typing, setTyping] = useState(false);
  const pick = (v: string) => {
    setTyping(false);
    onChangeText(v);
  };
  const options = [
    { value: '', label: 'No limit' },
    ...presets.map((v) => ({ value: v, label: `${v} ${LIMIT_UNIT}` })),
    { value: CUSTOM, label: 'Custom amount' },
  ];
  return (
    <View style={limitStyles.wrap}>
      <Text style={limitStyles.label}>{label}</Text>
      <SelectField
        title={label}
        value={typing ? CUSTOM : empty ? '' : preset ?? CUSTOM}
        shown={typing ? 'Custom amount' : empty || preset ? undefined : limitText(value) || value}
        options={options}
        onChange={(v) => (v === CUSTOM ? setTyping(true) : pick(v))}
      />
      {typing && (
        <TextField
          label={`Amount in ${LIMIT_UNIT}`}
          value={value}
          onChangeText={(t) => onChangeText(limitInput(t))}
          keyboardType="numeric"
          placeholder="e.g. 0.75"
        />
      )}
    </View>
  );
}

export const limitStyles = themedStyles(() =>
  StyleSheet.create({
    wrap: { gap: theme.spacing.sm },
    label: { ...theme.typography.caption, color: theme.colors.slate },
    problem: { ...theme.typography.caption, color: theme.colors.negative },
  }),
);
