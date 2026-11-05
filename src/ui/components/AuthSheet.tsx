/**
 * Inline 21st Capital auth — sign up OR sign in without leaving the current
 * screen (decided 2026-07-20: a new user must be able to create an account and
 * continue their vault setup in place, never bouncing to the website).
 *
 * Passwordless: email (+ name on sign-up) → 6-digit code → session. Sign-up
 * and sign-in share the same verify step; a sign-up on a known email quietly
 * becomes a sign-in. On success the session is persisted and handed back.
 */
import React, { useRef, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from './AppModal';
import { BlurView } from '@react-native-community/blur';
import { getColorScheme, theme, themedStyles } from '../theme';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import { Button } from './Button';
import { TextField } from './TextField';
import { CodeField } from './CodeField';
import { StepTransition } from './StepTransition';
import { CodeStepHead } from './CodeStepHead';
import { Gloss } from './Gloss';
import {
  requestOtp,
  requestSignupOtp,
  verifyOtp,
  verifyMfa,
  recoverMfa,
  saveSession,
} from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { isKnownCountry, matchCountries } from '../../services/countries';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

type Mode = 'signup' | 'signin';
type Step = 'details' | 'code' | 'mfa';

/** The website's referral choices, mirrored exactly (value → label). */
const REFERRAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'youtube-21st', label: '21st Capital YouTube' },
  { value: 'youtube-other', label: 'Other YouTube channel' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'google', label: 'Google' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'friend-family', label: 'Friend or family' },
  { value: 'other', label: 'Other' },
];

export function AuthSheet({
  visible,
  onClose,
  onAuthed,
  // Sign-in first (decided 2026-09-01): the person tapping a login entry most
  // often HAS an account; creating one stays a line below.
  defaultMode = 'signin',
}: {
  visible: boolean;
  onClose: () => void;
  onAuthed: (session: CompanySession) => void;
  /** 'signin' for flows where we KNOW the user has an account (co-sign,
   *  migration); 'signup' (default) for first-vault creation. Register/sign-in
   *  is always reachable via the small sub-link either way. */
  defaultMode?: Mode;
}): React.JSX.Element {
  const kb = useKeyboardHeight();
  const [mode, setMode] = useState<Mode>(defaultMode);
  // The sign-up form's Continue sits after several fields: the sheet lifts
  // above the keys, and its scroll view brings the field and Continue up.
  const revealScrollRef = useRef<ScrollView | null>(null);
  const revealOffsetY = useRef(0);
  // `reveal` again when the content grows under the keys: a refused code's
  // line arrives under the boxes after they were lifted (decided 2026-10-18).
  const { reveal } = useRevealFocusedField(revealScrollRef, revealOffsetY);
  const [step, setStep] = useState<Step>('details');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // Profile parity with the website registration (decided 2026-07-21): country is
  // REQUIRED (the website bounces incomplete profiles mid-checkout), phone is
  // optional, referral mirrors the website's dropdown.
  const [country, setCountry] = useState('');
  const [countryPicked, setCountryPicked] = useState(false);
  const [phone, setPhone] = useState('');
  const [referral, setReferral] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const countrySuggestions =
    mode === 'signup' && !countryPicked ? matchCountries(country) : [];

  const reset = () => {
    setStep('details');
    setCode('');
    setMfaCode('');
    setTempToken('');
    setUseRecovery(false);
    setError(null);
    setNote(null);
    setBusy(false);
  };

  /** Back to the caller's first page with nothing filled in. */
  const resetAll = () => {
    reset();
    setMode(defaultMode);
    setEmail('');
    setFirstName('');
    setLastName('');
    setCountry('');
    setCountryPicked(false);
    setPhone('');
    setReferral(null);
  };

  const close = () => {
    resetAll();
    onClose();
  };

  // Every OPEN starts fresh (decided 2026-09-05). The sheet lives inside a Modal
  // and stays mounted while hidden, so `useState(defaultMode)` only ever ran
  // once: a client who signed UP, logged out and tapped "Sign in" again was
  // handed the registration page. A successful login also bypasses `close()`
  // entirely — the caller just flips `visible` — so nothing else would reset
  // it. Resetting on open covers both roads and keeps ClaimInvite's
  // `defaultMode="signup"` intact.
  useEffect(() => {
    if (visible) resetAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultMode]);

  const phoneDigits = phone.replace(/\D/g, '');
  const phoneOk = phone.trim() === '' || (phoneDigits.length >= 7 && phoneDigits.length <= 15);
  const canContinue =
    mode === 'signin'
      ? email.trim().includes('@')
      : email.trim().includes('@') &&
        firstName.trim() &&
        lastName.trim() &&
        isKnownCountry(country) &&
        phoneOk &&
        referral != null;

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { existing } = await requestSignupOtp(
          email.trim(),
          firstName.trim(),
          lastName.trim(),
          {
            country: country.trim(),
            phoneNumber: phone.trim() || undefined,
            referralSource: referral ?? undefined,
          },
        );
        // The note must say something the field's own label does not, or the
        // step reads the same sentence twice (decided 2026-08-29). What it adds is
        // WHERE the code went.
        setNote(
          existing
            ? `You already have an account. The code went to ${email.trim()}.`
            : `Account created. The code went to ${email.trim()}.`,
        );
      } else {
        await requestOtp(email.trim());
        setNote(null); // the default already names the address
      }
      setStep('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // `codeArg` is threaded from CodeField.onComplete so auto-submit/paste uses the
  // just-completed value, not the not-yet-applied `code` state.
  const verify = async (codeArg?: string) => {
    const value = (codeArg ?? code).trim();
    setError(null);
    setBusy(true);
    try {
      const result = await verifyOtp(email.trim(), value);
      if (result.kind === 'mfaRequired') {
        setTempToken(result.tempToken);
        setStep('mfa');
        return;
      }
      await saveSession(result.session);
      onAuthed(result.session);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyMfaStep = async (codeArg?: string) => {
    const value = (codeArg ?? mfaCode).trim();
    setError(null);
    setBusy(true);
    try {
      const session = useRecovery
        ? await recoverMfa(email.trim(), tempToken, value)
        : await verifyMfa(email.trim(), tempToken, value);
      onAuthed(session);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {/* The sheet stays on the bottom of the screen and its OWN glass runs on
   behind the keyboard (reported 2026-09-21: "sharp edges at the corner of the
   lower part of the screen every time the keyboard is active"). A
   KeyboardAvoidingView lifted the whole sheet, so its square bottom edge
   sat on the keyboard's rounded corners. The keyboard's height is padding
   INSIDE the sheet instead, the way the Send screen's Priority sheet does. */}
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: kb }]}>
          {/* Frosted (decided 2026-09-12): the page blurs through the sheet. */}
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
            blurAmount={24}
            reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
          />
          <View style={styles.glassTint} pointerEvents="none" />
          <Gloss radius={theme.radius.lg} />
          <ScrollView
            ref={revealScrollRef}
            onScroll={(e) => {
              revealOffsetY.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={32}
            onContentSizeChange={reveal}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}>
            <View style={styles.handle} />
            <StepTransition
              stepKey={`${mode}:${step}`}
              order={[
                'signup:details',
                'signin:details',
                'signup:code',
                'signin:code',
                'signup:mfa',
                'signin:mfa',
              ]}
              style={styles.stepWrap}>
            {step === 'details' ? (
              <Text style={styles.title}>
                {mode === 'signup' ? 'Create your 21st Capital account' : 'Sign in to 21st Capital'}
              </Text>
            ) : step === 'code' ? (
              <CodeStepHead kind="email" title="Check your email" />
            ) : (
              <CodeStepHead kind="authenticator" title="Now a different code" />
            )}
            <View style={styles.stepHead}>
              <Text style={[styles.sub, styles.rowItem]}>
                {step === 'details'
                  ? 'No password. We email you a 6-digit code.'
                  : step === 'code'
                    ? (note ?? `We emailed a 6-digit code to ${email.trim() || 'your address'}.`)
                    : 'Not the emailed one. This account has two-factor sign-in.'}
              </Text>
            </View>

            {step === 'details' ? (
              <>
                {mode === 'signup' && (
                  <View style={styles.row}>
                    <View style={styles.rowItem}>
                      <TextField label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="sentences" placeholder="Sofia" />
                    </View>
                    <View style={styles.rowItem}>
                      <TextField label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="sentences" placeholder="Ramos" />
                    </View>
                  </View>
                )}
                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  placeholder="you@example.com"
                />
                {mode === 'signup' && (
                  <>
                    <TextField
                      label="Country"
                      value={country}
                      onChangeText={(t) => {
                        setCountry(t);
                        setCountryPicked(false);
                      }}
                      autoCapitalize="sentences"
                      placeholder="e.g. Germany"
                    />
                    {countrySuggestions.length > 0 && (
                      <View style={styles.suggestions}>
                        {countrySuggestions.map((c) => (
                          <TouchableOpacity
                            key={c}
                            style={styles.suggestionRow}
                            onPress={() => {
                              setCountry(c);
                              setCountryPicked(true);
                            }}>
                            <Text style={styles.suggestionText}>{c}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    <TextField
                      label="Phone (optional)"
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      placeholder="+1 202 555 0100"
                    />
                    <Text style={styles.fieldLabel}>How did you hear about 21st Capital?</Text>
                    <View style={styles.chips}>
                      {REFERRAL_OPTIONS.map((o) => (
                        <TouchableOpacity
                          key={o.value}
                          style={[styles.chip, referral === o.value && styles.chipOn]}
                          onPress={() => setReferral(o.value)}>
                          <Text
                            style={[styles.chipText, referral === o.value && styles.chipTextOn]}>
                            {o.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
                {error && <Text style={styles.error}>{error}</Text>}
                {/* The switch sits ABOVE the primary button, as the code
                    pages place their alternative link (decided 2026-09-02). The
                    terms line stays glued to the button it speaks about. */}
                <TouchableOpacity
                  onPress={() => {
                    setMode(mode === 'signup' ? 'signin' : 'signup');
                    setError(null);
                  }}
                  style={styles.toggle}>
                  <Text style={styles.toggleText}>
                    {mode === 'signup'
                      ? 'Already have an account? Sign in'
                      : 'New here? Create an account'}
                  </Text>
                </TouchableOpacity>
                {mode === 'signup' && (
                  <Text style={styles.terms}>
                    By continuing you agree to 21st Capital's terms of service.
                  </Text>
                )}
                <Button
                  title={busy ? 'Sending code…' : 'Continue'}
                  onPress={() => void sendCode()}
                  loading={busy}
                  disabled={!canContinue}
                  variant="accent"
                />
              </>
            ) : step === 'code' ? (
              <>
                <CodeField
                  label="Enter the code we emailed you"
                  value={code}
                  onChange={setCode}
                  onComplete={(c) => void verify(c)}
                  onAlternative={() => void sendCode()}
                  busy={busy}
                  busyLabel="Verifying…"
                  error={error ?? undefined}
                />
              </>
            ) : (
              <>
                <Text style={styles.sub}>
                  {useRecovery
                    ? 'Enter one of your saved recovery codes.'
                    : 'Enter the 6-digit code your authenticator app shows right now.'}
                </Text>
                {useRecovery ? (
                  <TextField
                    label="Recovery code"
                    value={mfaCode}
                    onChangeText={setMfaCode}
                    keyboardType="default"
                    autoCapitalize="none"
                    placeholder="xxxx-xxxx"
                  />
                ) : (
                  <CodeField
                    label="Code from your authenticator app"
                    value={mfaCode}
                    onChange={setMfaCode}
                    onComplete={(c) => void verifyMfaStep(c)}
                    oneTimeCode={false}
                    busy={busy}
                    busyLabel="Verifying…"
                    error={error ?? undefined}
                    onAlternative={() => {
                      setUseRecovery(true);
                      setMfaCode('');
                      setError(null);
                    }}
                    alternativeLabel="Use a recovery code"
                  />
                )}
                {/* A recovery code is free text, so it still needs a button.
                    The 6-digit path submits itself. */}
                {useRecovery && (
                  <>
                    {error && <Text style={styles.error}>{error}</Text>}
                    <Button
                      title={busy ? 'Verifying…' : 'Verify & sign in'}
                      onPress={() => void verifyMfaStep()}
                      loading={busy}
                      disabled={mfaCode.trim().length < 6}
                      variant="accent"
                    />
                  </>
                )}
                {useRecovery && (
                  <TouchableOpacity
                    onPress={() => { setUseRecovery(false); setMfaCode(''); setError(null); }}
                    style={styles.toggle}>
                    <Text style={styles.toggleText}>Use my authenticator instead</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            </StepTransition>

            <Button title="Cancel" variant="ghost" onPress={close} />
          </ScrollView>
        </View>
      </View>
    </AppModal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: theme.colors.scrim, justifyContent: 'flex-end' },
  glassTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
  sheet: {
    overflow: 'hidden',
    // No opaque ground here: it would be all the BlurView below has to
    // sample, and the sheet would not frost at all (decided 2026-09-14).
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '90%',
  },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  handle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: theme.colors.hairline, alignSelf: 'center', marginBottom: theme.spacing.sm,
  },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  sub: { ...theme.typography.body, color: theme.colors.slate },
  // The step swap slides via StepTransition; the wrapper takes over the
  // ScrollView's gap for its children.
  stepWrap: { gap: theme.spacing.md },
  // The code steps' badge, tag and title are CodeStepHead's; this row still
  // lays out the line under them.
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  row: { flexDirection: 'row', gap: theme.spacing.md },
  rowItem: { flex: 1 },
  error: { ...theme.typography.caption, color: theme.colors.negative },
  toggle: { alignSelf: 'center', paddingVertical: theme.spacing.sm },
  toggleText: { ...theme.typography.label, color: theme.colors.accentText },
  suggestions: {
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    marginTop: -theme.spacing.sm,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.hairline,
  },
  suggestionText: { ...theme.typography.body, color: theme.colors.offWhite },
  fieldLabel: { ...theme.typography.label, color: theme.colors.slate },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  chipOn: {
    borderColor: theme.colors.accent,
    backgroundColor: 'rgba(159,232,112,0.12)',
  },
  chipText: { ...theme.typography.caption, color: theme.colors.slate },
  chipTextOn: { color: theme.colors.accentText },
  terms: { ...theme.typography.caption, color: theme.colors.faint },
}));
