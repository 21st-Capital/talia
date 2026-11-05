/**
 * The back button: the round glass button with the chosen bold rounded chevron
 * (the chevron decided 2026-07-18; decided 2026-09-14 to put it on the home's
 * glass circle like every other top-of-screen button). Identical on every
 * screen: the shared stack header and the pages that draw their own bar.
 */
import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme';
import { ChevronLeftIcon } from './TablerIcons';
import { HeaderIconButton } from './HeaderIconButton';

export function HeaderBackButton({ onPress }: { onPress?: () => void }): React.JSX.Element {
  const navigation = useNavigation();
  return (
    <HeaderIconButton label="Back" onPress={onPress ?? (() => navigation.goBack())}>
      <ChevronLeftIcon size={22} strokeWidth={2.75} color={theme.colors.offWhite} />
    </HeaderIconButton>
  );
}
