/**
 * Profile — native General info (decided 2026-07-21: settings parity, no website
 * bounces). Name, phone, country; email is read-only (it is the account id).
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { Button, Card, Screen, TextField } from '../components';
import { theme, themedStyles } from '../theme';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { fetchProfile, updateProfile } from '../../services/settingsApi';
import { isKnownCountry, matchCountries } from '../../services/countries';

type Props = NativeStackScreenProps<SettingsStackParamList, 'GeneralInfo'>;

export function GeneralInfoScreen({ navigation }: Props): React.JSX.Element {
  const [session, setSession] = useState<CompanySession | null>(null);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [countryPicked, setCountryPicked] = useState(true);
  const [loading, setLoading] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const s = await loadSession();
        if (!s) {
          navigation.goBack();
          return;
        }
        setSession(s);
        const p = await fetchProfile(s);
        setEmail(p.email);
        setFirstName(p.firstName);
        setLastName(p.lastName);
        setPhone(p.phoneNumber);
        setCountry(p.country);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [navigation]);

  const suggestions = !countryPicked ? matchCountries(country) : [];
  const countryOk = country === '' || isKnownCountry(country);

  // While the client types a country, the suggestion card appears under the
  // field. The pinned Save rises above the keys on its own, and the reveal
  // hook lifts only the FIELD clear of the footer's fade, so the card under
  // it would sit under the fade and the keys. Before the footer, the hook
  // scrolled to the Save button under the card, which showed it; the card is
  // the page's last block, so scrolling to the end does the same and keeps
  // the field on screen (five suggestions at most).
  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    if (suggestions.length === 0) return;
    // After the card has laid out, so the end measured is the new one.
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [suggestions.length]);

  const save = async () => {
    if (!session) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await updateProfile(session, { firstName, lastName, phoneNumber: phone, country });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The page's one action, pinned (decided 2026-10-05). Screen's footer rises
  // with the keyboard and scrolls the field being typed in clear of its
  // fade, so the field AND Save sit above the keys (decided 2026-09-18); no
  // footer while the profile is still loading.
  return (
    <Screen
      scroll
      underHeader
      scrollRef={scrollRef}
      style={styles.content}
      footer={
        loading ? undefined : (
          <Button
            title={busy ? 'Saving…' : 'Save changes'}
            onPress={() => void save()}
            loading={busy}
            disabled={busy || !firstName.trim() || !lastName.trim() || !countryOk}
          />
        )
      }>
      {loading ? (
        <Text style={styles.muted}>Loading your profile…</Text>
      ) : (
        <>
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <TextField label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="sentences" placeholder="Sofia" />
            </View>
            <View style={styles.rowItem}>
              <TextField label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="sentences" placeholder="Ramos" />
            </View>
          </View>
          <TextField label="Account email (cannot be changed)" value={email} onChangeText={() => {}} placeholder="" />
          <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+1 202 555 0100" />
          <TextField
            label="Country"
            value={country}
            onChangeText={(t) => {
              setCountry(t);
              setCountryPicked(false);
            }}
            autoCapitalize="sentences"
            placeholder="Start typing, e.g. Germany"
          />
          {suggestions.length > 0 && (
            <Card style={styles.suggestions}>
              {suggestions.map((c) => (
                <Text
                  key={c}
                  style={styles.suggestion}
                  onPress={() => {
                    setCountry(c);
                    setCountryPicked(true);
                  }}>
                  {c}
                </Text>
              ))}
            </Card>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          {saved && <Text style={styles.savedNote}>Saved.</Text>}
        </>
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { gap: theme.spacing.md },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  row: { flexDirection: 'row', gap: theme.spacing.md },
  rowItem: { flex: 1 },
  suggestions: { gap: theme.spacing.sm },
  suggestion: { ...theme.typography.body, color: theme.colors.offWhite, paddingVertical: theme.spacing.xs },
  error: { ...theme.typography.caption, color: theme.colors.negative },
  savedNote: { ...theme.typography.caption, color: theme.colors.positive },
}));
