/**
 * "Which device?": the one list every hardware step starts from (decided
 * 2026-10-04: "The moment the user creates a vault on Talia, we simply ASK him
 * which device he will be using for each key ... we know which device
 * connects how. That way we actually dont need to ask 'How does your device
 * connect?' instead we ask, which device he will use, and based on that
 * selection we show him all the animations we built for each device both
 * during SETUP and during signing! As we add more and more signing devices,
 * that list grows. We no longer need to ask how to connect!").
 *
 * A LIST, two levels deep (decided 2026-10-04, on the first grid of tiles: "this
 * looks terrible!! We have to use a list view with brands instead. If the
 * user selects 'Ledger' we show another list with all the supported models.
 * That is more scalable later!"; the reference is Sparrow's hardware list:
 * one row per product, the logo on the left, the name, a grey line under it,
 * the action on the right, rows stacked full width):
 *
 *   brands   one row per brand behind the models the caller got from the
 *            registry (`devicePickerModel.ts`): the brand's mark, its name,
 *            a grey line naming its models in this list, a chevron. A brand
 *            with ONE model here goes straight on when tapped.
 *   models   for a brand with several: its name as the way back, then one
 *            row per model with the model's OWN outline (`DeviceModelGlyph`)
 *            and its name. The brand's mark is never drawn again (as decided: "It
 *            doesnt look nice to repeat the same logo repeatedly!").
 *
 * A list of one brand with several models opens on its models. The rows are
 * the app's glass rows (surface, `radius.lg`, `Gloss` at `cardGlow()`), the
 * Settings rows' look, never tiles. "Another device" is the last brand row,
 * only where the caller serves hardware Talia cannot reach itself.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Gloss, cardGlow } from './Gloss';
import { ProviderTile } from './ProviderLogo';
import { DEVICE_ROW_MARK, ModelTile } from './DeviceModelGlyph';
import { ChevronLeftIcon, ChevronRightIcon } from './TablerIcons';
import { brandRows, openingBrand, singleModelOf } from './devicePickerModel';
import type { BrandRow } from './devicePickerModel';
import { modelInfo } from '../../wallet/deviceKinds';
import type { DeviceKind, DeviceModel } from '../../wallet/deviceKinds';

export const ANOTHER_DEVICE = 'Another device';

export function DevicePicker({
  models,
  question,
  intro,
  onPick,
  another,
  back,
}: {
  /** The models the step offers, from the registry. */
  models: readonly DeviceModel[];
  /** The question over the list; none where the screen asks it itself. */
  question?: string;
  intro?: string;
  onPick: (model: DeviceModel) => void;
  /** Hardware Talia cannot reach itself (an heir's own device, a wallet
   *  never adopted): the row that leads to the caller's own ways in. */
  another?: () => void;
  /** The list this question was opened from (a known vault's key list: the
   *  key tapped, whose device is asked once): its name as the way back,
   *  over the brands, in the idiom a brand's models use. */
  back?: { name: string; onBack: () => void };
}): React.JSX.Element {
  const rows = useMemo(() => brandRows(models), [models]);
  // The one brand the list opens on, when there is no brands level to show.
  const auto = openingBrand(rows, another != null);
  const [opened, setOpened] = useState<DeviceKind | null>(null);
  const found = rows.find((r) => r.kind === (opened ?? auto?.kind));
  /** The brand whose models are listed, or null while the brands are. */
  const open = found != null && found.models.length > 1 ? found : null;
  const tapBrand = (row: BrandRow) => {
    const one = singleModelOf(row);
    if (one) onPick(one);
    else setOpened(row.kind);
  };
  return (
    <View style={styles.wrap}>
      {!!question && <Text style={styles.question}>{question}</Text>}
      {!!intro && <Text style={styles.intro}>{intro}</Text>}
      {rows.length === 0 && !another ? (
        <Text style={styles.none}>No hardware Talia supports can do this for this vault yet.</Text>
      ) : open ? (
        <>
          {auto != null && back ? (
            // Opened straight on a bare brand's models from a key row: the
            // key's name is the way back, and the brand stands over its
            // models (decided 2026-10-04: the header read "< Ledger" and the
            // key's name never appeared).
            <>
              <BrandHeader name={back.name} onBack={back.onBack} />
              <BrandHeader name={open.name} />
            </>
          ) : (
            <BrandHeader name={open.name} onBack={auto == null ? () => setOpened(null) : undefined} />
          )}
          {open.models.map((m) => (
            <DeviceListRow
              key={m}
              mark={<ModelTile model={m} />}
              name={modelInfo(m).name}
              accessibilityLabel={modelInfo(m).fullName}
              onPress={() => onPick(m)}
            />
          ))}
        </>
      ) : (
        <>
          {back && <BrandHeader name={back.name} onBack={back.onBack} />}
          {rows.map((r) => (
            <DeviceListRow
              key={r.kind}
              mark={<ProviderTile provider={r.kind} size={DEVICE_ROW_MARK} />}
              name={r.name}
              sub={r.sub}
              onPress={() => tapBrand(r)}
            />
          ))}
          {another && <DeviceListRow key="another" mark={<ProviderTile provider="other" size={DEVICE_ROW_MARK} />} name={ANOTHER_DEVICE} onPress={another} />}
        </>
      )}
    </View>
  );
}

/** The brand over its models: its name, and the way back to the brands when
 *  there is a brands level under it (a bare chevron, the iOS back idiom). */
function BrandHeader({ name, onBack }: { name: string; onBack?: () => void }): React.JSX.Element {
  if (!onBack) {
    return (
      <Text style={styles.brand} accessibilityRole="header">
        {name}
      </Text>
    );
  }
  return (
    <TouchableOpacity
      style={styles.back}
      onPress={onBack}
      activeOpacity={0.7}
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Back">
      <ChevronLeftIcon size={22} strokeWidth={2.75} color={theme.colors.offWhite} />
      <Text style={styles.brand}>{name}</Text>
    </TouchableOpacity>
  );
}

/** One row of the list: the mark, the name with its grey line, the chevron.
 *  The known-keys list (`KeyDevicePicker`) draws its rows with it too, and
 *  so does a portfolio entry's source list, which has no marks: an
 *  exchange's logo is never drawn without its own artwork (decided
 *  2026-10-22). Device rows keep their name to one line; `wrap` lets a row
 *  whose name a client typed wrap at its spaces instead, so a larger text
 *  size never cuts it ("Peer to…", decided 2026-10-22). */
export function DeviceListRow({
  mark,
  name,
  sub,
  onPress,
  accessibilityLabel,
  wrap,
}: {
  mark?: React.ReactNode;
  name: string;
  sub?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  wrap?: boolean;
}): React.JSX.Element {
  const lines = wrap ? undefined : 1;
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.85} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? name}>
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      {mark}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={lines}>
          {name}
        </Text>
        {!!sub && (
          <Text style={styles.sub} numberOfLines={lines}>
            {sub}
          </Text>
        )}
      </View>
      <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
    </TouchableOpacity>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { gap: theme.spacing.sm },
    question: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.xs },
    intro: { ...theme.typography.body, color: theme.colors.slate, marginBottom: theme.spacing.sm },
    none: { ...theme.typography.body, color: theme.colors.slate },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
    },
    body: { flex: 1, minWidth: 0 },
    name: { ...theme.typography.heading, color: theme.colors.offWhite },
    sub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2 },
    back: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, alignSelf: 'flex-start', minHeight: 40 },
    brand: { ...theme.typography.heading, color: theme.colors.offWhite },
  }),
);
