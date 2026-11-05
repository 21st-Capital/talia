/**
 * Elite Services (decided 2026-09-21): the page the Settings row opens. It lists
 * the services, each opening its own screen: co-signing limits, vault owners
 * when the client's plan has vaults to give, and the setup meeting when there
 * is one to book. Nothing else: no intro, no second section.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { Gloss, MenuDivider, MenuRow, Screen, WalletIconGlyph, cardGlow, menuStyles } from '../components';
import { LimitGaugeIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import { OWNERS_COPY } from '../../services/vaultHolders';
import { SETUP_MEETING_COPY, setupMeetingBookedLine } from '../../services/setupMeeting';
import { useEliteServices } from '../hooks/useEliteServices';
import { ELITE_COPY } from './eliteServicesCopy';

type Props = NativeStackScreenProps<RootStackParamList, 'EliteServices'>;

export function EliteServicesScreen({ navigation }: Props): React.JSX.Element {
  const elite = useEliteServices(navigation);
  const rows: Array<{ key: string; node: React.ReactNode }> = [];
  if (elite.limits) {
    rows.push({
      key: 'limits',
      node: (
        <MenuRow
          icon={<LimitGaugeIcon size={20} color={theme.colors.gold} />}
          label={ELITE_COPY.limits}
          sub={ELITE_COPY.limitsSub}
          onPress={() => navigation.navigate('CosignLimits')}
        />
      ),
    });
  }
  if (elite.owners) {
    rows.push({
      key: 'owners',
      node: (
        <MenuRow
          icon={<WalletIconGlyph icon="users-group" size={20} />}
          label={OWNERS_COPY.title}
          sub={OWNERS_COPY.settingsSub}
          onPress={() => navigation.navigate('VaultHolders')}
        />
      ),
    });
  }
  if (elite.meeting) {
    rows.push({
      key: 'meeting',
      node: (
        <MenuRow
          icon={<WalletIconGlyph icon="users-group" size={20} />}
          label={SETUP_MEETING_COPY.title}
          sub={
            elite.meetingBookedMs != null
              ? setupMeetingBookedLine(elite.meetingBookedMs)
              : SETUP_MEETING_COPY.settingsSub
          }
          onPress={elite.meetingBookedMs != null ? undefined : elite.openMeeting}
        />
      ),
    });
  }

  return (
    <Screen scroll>
      {rows.length === 0 ? (
        <Text style={styles.empty}>
          {elite.session ? 'Nothing to show here yet.' : 'Sign in to 21st Capital in Settings first.'}
        </Text>
      ) : (
        <View style={menuStyles.group}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          {rows.map((row, i) => (
            <React.Fragment key={row.key}>
              {i > 0 && <MenuDivider />}
              {row.node}
            </React.Fragment>
          ))}
        </View>
      )}
      {elite.sheet}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    empty: { ...theme.typography.body, color: theme.colors.slate },
  }),
);
