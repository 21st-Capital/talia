/**
 * Refresh SESSION — the whole private refresh as one sitting (decided 2026-08-27).
 *
 * A separate-transactions refresh on a co-signer vault used to mean: for
 * EVERY coin, a full signing ceremony, a fresh email OTP, a fresh
 * authenticator code — and the queue died after the first co-sign request.
 * This screen replaces that with three steps for the whole set:
 *
 *   1. ONE device pass — the device asks once per transaction (that check is
 *      the hardware's whole point), but the app never gets in between. Any
 *      signing device Talia speaks, not just a Ledger (decided 2026-09-18).
 *   2. ONE step-up round — a single email code + authenticator code submits
 *      every co-sign request as one batch (server groups them by batch_id).
 *   3. ONE button later — when 21st Capital has co-signed, the Pending screen
 *      broadcasts the whole session, one transaction at a time.
 *
 * Deliberately refresh-only: every transaction returns coins to the vault's
 * own fresh addresses. Batched sends to OTHER addresses are a Talia Desktop
 * feature; mobile never builds them.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { landOverTab } from '../navigation/landOverTab';
import type { RootStackParamList } from '../navigation/types';
import {
  AppDialog,
  Button,
  Card,
  DrawnIcon,
  InfoHeading,
  Screen,
  SentCard,
  SentPage,
  StepTransition,
  FAILURES_TITLE,
  mergeSentFacts,
  sentFailureRows,
  sessionNothingSent,
  sessionSentWords,
} from '../components';
import type { SentFacts, SentFailure } from '../components';
import { HardwareConnect } from '../components/HardwareConnect';
import type { StepBack } from '../components/HardwareConnect';
import { CosignRequestFooterButtons, CosignRequestPanel } from '../components/CosignRequestPanel';
import type { CosignRequestActions } from '../components/CosignRequestPanel';
import { theme, themedStyles } from '../theme';
import { useWallets, formatAmount, formatSats, broadcastThroughChainServers, keyDisplayName, vaultShapeOf, saveSentAt, stepKeysOf } from '../../wallet';
import { recordFromDiscovery, recordedDevice } from '../../wallet/deviceKinds';
import { markOwnOutputs, ownOutputIndices } from '../../wallet/ownOutputs';
import { bitboxDevice, ledgerDevice } from '../hww/connectedDevice';
import type { DeviceAsk } from '../hww/deviceTurns';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { bitboxSigningSpec, useSigningCourier } from '../hooks/useSigningCourier';
import type { CourierJob, SignedCopy } from '../hooks/useSigningCourier';
import { parsePolicy, pathRequirement } from '../../bitcoin/descriptor';
import { ledgerWalletSpecFor } from '../../bitcoin/ledger';
import { bitboxPolicyBlocker } from '../../bitcoin/bitbox/policy';
import type { WalletEngine } from '../../bitcoin/engine/types';
import { parsePsbt, psbtAbsurdFee } from '../../bitcoin/psbt';
import type { ParsedPsbt } from '../../bitcoin/psbt';
import { COSIGN_BATCH_MAX, refreshPlan } from './refreshSessionPlan';
import { sendTooEarly, tooEarlyTitle } from '../../wallet/sendTooEarly';
import { withTimeout } from '../../wallet/withTimeout';
import { notReachedWords } from '../../wallet/broadcastAnswer';

/** The same wording SignPsbt uses, so a refused fee reads the same here. */
function plainError(e: unknown): string {
  const notReached = notReachedWords(e);
  if (notReached) return notReached;
  const raw = String((e as Error)?.message ?? e);
  if (/min relay fee not met|mempool min fee not met|fee.*too low/i.test(raw)) {
    return 'The network server refused the fee rate as too low. Start the refresh again and choose a higher priority.';
  }
  return raw;
}

type Props = NativeStackScreenProps<RootStackParamList, 'RefreshSession'>;

type Phase = 'summary' | 'sign' | 'choose' | 'cosign' | 'requested' | 'sending' | 'sent';

/** One coin's refresh as it moves through the session. */
interface Leg {
  /** The working copy: every signature collected so far is merged into it. */
  psbt: string;
  destination: string;
  amountSats: number;
  feeSats: number;
  /** BDK says this one can be broadcast as it stands. */
  finalized: boolean;
  /** Set once it is on the network. */
  txid?: string;
  /** Set when broadcasting this one failed, so the client is told which. */
  error?: string;
}

export function RefreshSessionScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId, items } = route.params;
  const { getWallet, getEngine, settings, updateWallet, syncWallet } = useWallets();
  const wallet = getWallet(walletId);
  const { providerFps, settled: fpsSettled } = useProviderFingerprints(wallet);

  const [phase, setPhase] = useState<Phase>('summary');
  /** A turn page on the drawn device is up: the heading gives way to its. */
  const [turn, setTurn] = useState<DeviceAsk | null>(null);
  /** The co-sign panel's step actions, for this page's footer. */
  const [cosignActions, setCosignActions] = useState<CosignRequestActions | null>(null);
  /**
   * The courier (design A), the same as the signing screen's, through the
   * one hook (decided 2026-10-05: "build the courier for refresh session too"):
   * once the device has answered, every transaction of the pass travels to
   * it, is signed as "3. Sign the transaction" and comes back, counted
   * "transaction N of M" on the lines; `signing.courier` is set while it is
   * up, and the heading gives way to its pages.
   */
  const signing = useSigningCourier(wallet);
  const { reset: resetSigning } = signing;
  /** The hardware step's ONE Back, handed to this page's footer by the step
   *  (decided 2026-10-05): to the device list when there is one, else to the
   *  summary; null while the device is at work. */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);
  /**
   * The pass under way on ONE device: the legs it has signed so far, kept
   * across the courier's Try again on the same device, so a decline or a
   * dropped link on the third transaction never asks for the first two
   * again. It goes with the device (another key starts afresh), once the
   * pass is absorbed, and when the step is left.
   */
  const passRef = useRef<{ fp: string; signed: (string | undefined)[] } | null>(null);
  const passFor = (fp: string): { fp: string; signed: (string | undefined)[] } => {
    if (passRef.current?.fp !== fp) passRef.current = { fp, signed: [] };
    return passRef.current;
  };
  useEffect(() => {
    if (phase === 'sign') return;
    passRef.current = null;
    resetSigning();
  }, [phase, resetSigning]);
  /**
   * Talia is self-custodial: a client whose own keys can satisfy the policy
   * must be able to finish here with no request to us at all (decided 2026-09-18,
   * after this screen sent a client who holds two of three keys to us
   * anyway). So the session tracks every leg's working copy and asks BDK
   * after each device pass whether it can already be broadcast. Co-signing is
   * offered only when their own keys have not finished the job, and even then
   * only as one of the two ways on.
   */
  const [legs, setLegs] = useState<Leg[]>(() =>
    items.map((i) => ({
      psbt: i.psbt,
      destination: i.destination,
      amountSats: i.amountSats,
      feeSats: i.feeSats,
      finalized: false,
    })),
  );
  /** Client fingerprints that have signed every leg they can. */
  const [signedFps, setSignedFps] = useState<string[]>([]);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
    // The submit can succeed while the leave dialog sits open — its "nothing
    // has been sent" message is false the moment the batch lands (decided
    // 2026-08-27). Close it; the beforeRemove guard then routes any
    // further back-press to the vault.
    if (phase === 'requested') setLeaveConfirm(false);
  }, [phase]);
  const allowLeaveRef = useRef(false);
  /** The cosign panel is mid-network-call. While a SUBMIT may be in flight,
   *  leaving must be refused outright — the batch could land at 21st
   *  Capital seconds after a dialog promised "nothing has been sent". */
  const panelBusyRef = useRef(false);
  const [busyNotice, setBusyNotice] = useState(false);
  /** Set when the batch reached 21C but some local records failed to save. */
  const [requestWarning, setRequestWarning] = useState<string | null>(null);
  /** The reason when the session was rejected the moment it arrived (over
   *  the co-signing limit, decided 2026-09-22). A refresh moves nothing out, so
   *  this is a backstop, never the ordinary path. */
  const [requestRejected, setRequestRejected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** An unusually high fee waiting for the client's word (decided 2026-09-26). */
  const [feeAsk, setFeeAsk] = useState<number | null>(null);

  /** The primary spending path's cast: which 21C key co-signs, and which
   *  keys are the client's own (any of their own devices may sign). Send only
   *  routes here when this resolves, but the vault can change under us —
   *  recompute rather than trusting stale route params. */
  const cast = useMemo(() => {
    if (!wallet) return null;
    try {
      const policy = parsePolicy(wallet.descriptor);
      const primary =
        policy.paths.find((p) => p.olderBlocks == null && p.afterHeight == null) ??
        policy.paths[0];
      if (!primary) return null;
      const fps = pathRequirement(primary)
        .keys.map((k) => k.fingerprint?.toLowerCase())
        .filter((f): f is string => !!f);
      // A 21st Capital key on this path is OPTIONAL (decided 2026-09-18). A vault
      // that holds none is pure self-custody and belongs here too: one device
      // pass for every coin, then straight to sending.
      const cosignFp = fps.find((fp) => providerFps.has(fp)) ?? null;
      const customerFps = new Set(fps.filter((fp) => !providerFps.has(fp)));
      if (customerFps.size === 0) return null;
      return { cosignFp, customerFps, primary, exact: policy.exact };
    } catch {
      return null;
    }
  }, [wallet, providerFps]);

  /**
   * Take one device's output for every leg, merge it into the working copies
   * and ask BDK which legs are now complete. Returns where the session should
   * go next: straight to broadcast when the client's own keys have finished
   * the job, otherwise the choice between another of their keys and us.
   */
  const absorbPass = async (
    signed: string[],
    deviceFp: string,
  ): Promise<void> => {
    const engine = await getEngine(wallet!);
    const next: Leg[] = [];
    for (let i = 0; i < legs.length; i++) {
      const result = await engine.completePsbt(signed[i], legs[i].psbt);
      next.push({ ...legs[i], psbt: result.psbtBase64, finalized: result.finalized });
    }
    setLegs(next);
    setSignedFps((prev) => (prev.includes(deviceFp) ? prev : [...prev, deviceFp]));
    setPhase(
      refreshPlan({
        finalized: next.map((l) => l.finalized),
        customerFps: [...(cast?.customerFps ?? [])],
        signedFps: signedFps.includes(deviceFp) ? signedFps : [...signedFps, deviceFp],
        cosignFp: cast?.cosignFp ?? null,
      }).canSend
        ? 'sending'
        : 'choose',
    );
  };

  /**
   * One leg as the courier gets it: the transaction read with every output's
   * `isOwn` from BDK (never the PSBT's own word), so the card
   * shows what the device prints (a refresh pays the vault's change branch:
   * no amount and no address on the device, the fee alone, and the name
   * where the device prints one), the key's name for the travelling screens,
   * and its place in the pass for the count. A leg that cannot be read
   * leaves the card empty rather than guess.
   */
  const legJob = async (engine: WalletEngine, i: number, keyName: string): Promise<CourierJob> => {
    const psbt = legs[i].psbt;
    let parsed: ParsedPsbt | null = null;
    try {
      parsed = markOwnOutputs(parsePsbt(psbt, wallet!.network), await ownOutputIndices(engine, psbt));
    } catch {
      // unreadable: nothing to compare, never a guess
    }
    return { psbt, parsed, keyName, batch: { index: i + 1, count: legs.length } };
  };

  /** Every leg of a finished pass, in order; a gap is a bug, never absorbed. */
  const collected = (pass: { signed: (string | undefined)[] }): string[] =>
    legs.map((_, i) => {
      const s = pass.signed[i];
      if (s == null) throw new Error('A signed transaction is missing. Please try again.');
      return s;
    });

  /**
   * What follows a signed leg, run INSIDE the courier's own try as the
   * signing screen's broadcast is (decided 2026-10-05): the copy kept for the
   * pass, and after the LAST leg the pass collected and absorbed, so an
   * engine that cannot read a device's copy back lands on the Not signed
   * page with its sentence and Try again. Absorbed after the loop, as it
   * was, that failure reached no feed: the courier stayed on "Receiving
   * signed transaction 3 of 3." with nothing to tap. The pass is dropped
   * before the absorb, so Try again signs it afresh (the copies it held are
   * the ones that could not be read) and the last leg, which carries the
   * absorb, runs again: the legs left to sign are always the end of the pass.
   */
  const legDone =
    (pass: { signed: (string | undefined)[] }, i: number, fp: string) =>
    async (signed: SignedCopy): Promise<void> => {
      pass.signed[i] = signed.base64;
      if (i < legs.length - 1) return;
      const copies = collected(pass);
      passRef.current = null;
      await absorbPass(copies, fp);
    };

  /** Broadcast every leg. One failure never stops the others: each coin is
   *  its own transaction and the client must not lose the rest. */
  const sendAll = async (feeConfirmed = false): Promise<void> => {
    // An absurd fee goes out only on the client's word (decided
    // 2026-09-26), whoever built the legs.
    const fee = feeConfirmed
      ? null
      : legs.filter((l) => !l.txid).map((l) => psbtAbsurdFee(l.psbt)).find((f) => f != null) ?? null;
    if (fee != null) {
      setFeeAsk(fee);
      return;
    }
    const engine = await getEngine(wallet!);
    const next = legs.slice();
    // At most one fresh look at the chain for all the legs, and only when a
    // leg seems too early to go (decided 2026-10-07).
    let fresh: Promise<WalletEngine> | null = null;
    const refreshOnce = () => {
      if (!fresh) fresh = withTimeout(syncWallet(wallet!, { force: true }), 20_000, 'Sync');
      return fresh;
    };
    for (let i = 0; i < next.length; i++) {
      if (next[i].txid) continue;
      try {
        const wait = await sendTooEarly(engine, next[i].psbt, wallet!.network, refreshOnce);
        if (wait != null) {
          next[i] = { ...next[i], error: tooEarlyTitle(wait) };
          continue;
        }
        const psbt = next[i].psbt;
        const txid = await broadcastThroughChainServers(wallet!.network, settings, (backend) =>
          engine.broadcastPsbt(psbt, backend),
        );
        next[i] = { ...next[i], txid, error: undefined };
        // When it went out: a waiting refresh has no block time.
        void saveSentAt(wallet!.id, txid);
      } catch (e) {
        next[i] = { ...next[i], error: plainError(e) };
      }
    }
    setLegs(next);
    setPhase('sent');
  };

  /** What this session can still do, by the one tested rule. */
  const plan = useMemo(
    () =>
      refreshPlan({
        finalized: legs.map((l) => l.finalized),
        customerFps: [...(cast?.customerFps ?? [])],
        signedFps,
        cosignFp: cast?.cosignFp ?? null,
      }),
    [legs, cast, signedFps],
  );
  const unsignedOwnFps = plan.ownKeysLeft;
  /** Signatures the primary path still wants, group by group (decided
   *  2026-09-22: "One more signature to go" was wrong on a 3-of-5 after one
   *  device). At least 1 on the choose step, which BDK only sends us to
   *  while a transaction is incomplete; null when the policy could not be
   *  read faithfully, so no number is claimed. */
  const stillNeeded = useMemo(() => {
    if (!cast || !cast.exact) return null;
    const signed = new Set(signedFps.map((f) => f.toLowerCase()));
    const left = cast.primary.groups.reduce(
      (n, g) =>
        n +
        Math.max(
          0,
          g.threshold - g.keys.filter((k) => !!k.fingerprint && signed.has(k.fingerprint.toLowerCase())).length,
        ),
      0,
    );
    return Math.max(1, left);
  }, [cast, signedFps]);

  const totalAmount = useMemo(() => items.reduce((a, i) => a + i.amountSats, 0), [items]);
  const totalFee = useMemo(() => items.reduce((a, i) => a + i.feeSats, 0), [items]);

  const goVault = () => {
    allowLeaveRef.current = true;
    landOverTab('VaultsTab', [{ name: 'WalletDetail', params: { walletId } }]);
  };

  // Header back must never silently discard a signed session (decided
  // 2026-08-27): mid-sign/mid-codes it asks first, and after the batch is
  // submitted every way out leads to the vault — never back to the live
  // Send form underneath, which would invite a duplicate batch.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current) return;
      const p = phaseRef.current;
      if (p === 'requested' || p === 'sent') {
        e.preventDefault();
        goVault();
      } else if (p === 'cosign' && panelBusyRef.current) {
        e.preventDefault();
        setBusyNotice(true);
      } else if (p === 'sending') {
        // Signed by their own keys and not yet sent: leaving here would throw
        // away real signatures, so it asks like the other live phases.
        e.preventDefault();
        setLeaveConfirm(true);
      } else if (p === 'sign' || p === 'cosign' || p === 'choose') {
        e.preventDefault();
        setLeaveConfirm(true);
      }
    });
    return sub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  if (!wallet || !cast) {
    return (
      <Screen scroll style={styles.content} footer={!wallet || fpsSettled ? <Button title="Back" variant="ghost" onPress={() => navigation.goBack()} /> : undefined}>
        <Text style={styles.body}>
          {!wallet
            ? 'This vault is no longer on this device.'
            : !fpsSettled
              ? 'Preparing the session…'
              : // "Primary path", the Spending policy's own name for it
                // (decided 2026-09-22: this path had three names).
                'This vault has no key of yours on its primary path, so a refresh session does not apply here.'}
        </Text>
      </Screen>
    );
  }

  /** What went out, for the Sent page: every leg is a refresh by
   *  construction (each pays one fresh address of this vault), so what it
   *  moved is what its leg carries. */
  const sentLegs = legs.filter((l): l is Leg & { txid: string } => !!l.txid);
  const sentCount = sentLegs.length;
  const sessionFacts: SentFacts = mergeSentFacts(
    sentLegs.map((l) => ({
      kind: 'refresh' as const,
      txids: [l.txid],
      recipients: [],
      movedSats: l.amountSats,
      feeSats: l.feeSats,
    })),
  ) ?? { kind: 'refresh', txids: [], recipients: [], movedSats: null, feeSats: null };
  /** The coins that did not go out, with what the network said: the Sent
   *  page's own card, as Pending's Send all draws it (decided 2026-10-02),
   *  each coin's amount in the owner's unit and dots when it is hidden. */
  const failed: SentFailure[] = legs.flatMap((l, i) =>
    l.txid ? [] : [{ coin: i + 1, amountSats: l.amountSats, reason: l.error ?? 'Not sent' }],
  );
  const failedCard =
    failed.length > 0 ? (
      <SentCard
        title={FAILURES_TITLE}
        rows={sentFailureRows(failed, settings.hideBalances || !!wallet.balanceHidden, settings.unit)}
      />
    ) : null;
  const retryRest = () => {
    setSending(true);
    void sendAll().finally(() => setSending(false));
  };

  /**
   * The step's actions, pinned at the foot of the page (decided 2026-10-05) and
   * computed from the step OUTSIDE the transition, so they never slide with
   * it: the primary first, a second choice under it, Back/Cancel/Done last.
   * The Sent page brings its own foot; the co-sign panel tells this page its
   * step's actions.
   */
  const footer = ((): React.ReactNode => {
    switch (phase) {
      case 'summary':
        return (
          <>
            <Button title="Sign all on your device" onPress={() => setPhase('sign')} />
            <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        );
      case 'sign':
        // The step's ONE Back, which the step decides and hands here; the
        // courier's own buttons once a transaction is on its way (null while
        // the client's turn on the device leaves nothing to tap).
        if (signing.courier != null) return signing.footer(() => setPhase('summary'));
        return stepBack != null ? <Button title="Back" variant="ghost" onPress={stepBack.onPress} /> : null;
      case 'choose':
        // The client's OWN key first, always (decided 2026-09-18); co-signing is
        // the primary only when they hold no other key on this path.
        return (
          <>
            {unsignedOwnFps.length > 0 && <Button title="Sign with another key" onPress={() => setPhase('sign')} />}
            {plan.canCosign && (
              <Button
                title="Ask 21st Capital to co-sign"
                variant={unsignedOwnFps.length > 0 ? 'ghost' : 'primary'}
                onPress={() => setPhase('cosign')}
              />
            )}
            <Button title="Cancel" variant="ghost" onPress={() => setLeaveConfirm(true)} />
          </>
        );
      case 'sending':
        return (
          <Button
            title={sending ? 'Sending…' : `Send all ${legs.length}`}
            disabled={sending}
            onPress={() => {
              setSending(true);
              void sendAll().finally(() => setSending(false));
            }}
          />
        );
      case 'sent':
        // Nothing went out: Try again, then Done. The Sent page has its own foot.
        return sentCount === 0 ? (
          <>
            <Button title={sending ? 'Sending…' : 'Try again'} disabled={sending} onPress={retryRest} />
            <Button title="Done" variant="ghost" onPress={goVault} />
          </>
        ) : null;
      case 'cosign':
        return cast.cosignFp != null && cosignActions != null ? <CosignRequestFooterButtons actions={cosignActions} /> : null;
      case 'requested':
        return <Button title="Done" onPress={goVault} />;
    }
  })();

  return (
    <Screen
      scroll
      // The Sent page sits where the signing screen's does, right under the
      // header; every other step keeps the Screen's own top.
      underHeader={phase === 'sent' && sentCount > 0}
      style={phase === 'sent' && sentCount > 0 ? { ...styles.content, ...styles.contentFill } : styles.content}
      footer={footer ?? undefined}>
      <StepTransition
        stepKey={phase}
        order={['summary', 'sign', 'choose', 'sending', 'cosign', 'requested', 'sent']}
        style={[styles.stepWrap, phase === 'sent' && sentCount > 0 && styles.stepFill]}>
        {phase === 'summary' && (
          <>
            <InfoHeading
              style={styles.title}
              title="Why one transaction per coin"
              text="Each coin gets its own small transaction back to a fresh address of this vault. Sending them separately means nothing on the public chain ties your coins together.">
              Refresh {items.length} coin{items.length === 1 ? '' : 's'} in one session
            </InfoHeading>
            {/* Nothing here names where the next signature comes from
                (decided 2026-09-22): a self-custody vault has no co-signer
                of ours, a 2-of-2 with us has no other key of the client's,
                and the heir's key on the owner's phone is not the owner's.
                The next step lists what this vault actually allows. */}
            <Text style={styles.body}>
              Your device signs all of them in one go. If this vault needs more
              signatures after that, the next step shows what it takes.
            </Text>
            <Card style={styles.card}>
              {items.map((it, i) => (
                <View key={`${it.destination}:${i}`} style={styles.row}>
                  <Text style={styles.rowLabel}>Coin {i + 1}</Text>
                  <Text style={styles.rowValue}>{formatAmount(it.amountSats, settings.unit)}</Text>
                </View>
              ))}
              <View style={[styles.row, styles.totalRow]}>
                <Text style={styles.rowLabel}>Total refreshed</Text>
                <Text style={styles.rowValue}>{formatAmount(totalAmount, settings.unit)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Total fees</Text>
                <Text style={styles.rowValue}>{formatAmount(totalFee, settings.unit)}</Text>
              </View>
            </Card>
          </>
        )}

        {phase === 'sign' && (
          <>
            {/* The heading gives way while a turn page carries its own, and
                once the courier draws the whole page (design A, decided
                2026-10-05): its own title; its buttons are the footer's. */}
            {signing.courier == null && turn == null && (
              <>
                <InfoHeading
                  style={styles.title}
                  title="What your device shows"
                  text="Your signing device recognizes each of these as a transfer back to this vault, so it shows only the network fee. It verifies every destination itself. If the connection drops, tap Try again: the transactions already approved are kept, and nothing has been sent.">
                  Sign the whole session on one device
                </InfoHeading>
                <Text style={styles.body}>
                  If the device shows a full address, do NOT approve. That would mean the
                  coins are leaving the vault.
                </Text>
              </>
            )}
            {/* ONE pass per device, whatever the brand (decided 2026-09-18). This
                used to be a Ledger-only flow, so a BitBox vault never reached
                the session at all and fell back to a fresh ceremony and fresh
                codes for every single coin. The device the vault recorded
                for the keys still to sign is drawn unlocking while the
                search runs; with none, the owner is asked which device they
                are using (decided 2026-10-04, device first). */}
            <HardwareConnect
              shape={vaultShapeOf(wallet)}
              purpose="sign"
              network={wallet.network}
              descriptor={wallet.descriptor}
              keys={stepKeysOf(wallet, [...cast.customerFps].filter((fp) => !signedFps.includes(fp)), providerFps)}
              question="Which device are you using?"
              onTurn={setTurn}
              // The step decides the one Back: to the device list, else the
              // summary; this page's footer draws it, never the step.
              onBack={() => setPhase('summary')}
              onFooterBack={setStepBack}
              // The device is at work on the transactions: no Reconnect, no
              // way back to the list until it answers.
              locked={signing.courier != null}
              ceremony={signing.ceremony}
              ledgerTask={async (ctx) => {
                if (!cast.customerFps.has(ctx.deviceFingerprint)) {
                  throw new Error(
                    `This Ledger holds a different key (${ctx.deviceFingerprint.toUpperCase()}). Connect the one holding this vault's own key. If it uses a passphrase, use the same passphrase.`,
                  );
                }
                if (signedFps.includes(ctx.deviceFingerprint)) {
                  throw new Error(
                    'This key has already signed this refresh. Connect the other key of this vault.',
                  );
                }
                // The device proved it holds a key of this vault: remember
                // where the key lives, and show the vault to a Ledger this
                // phone has not registered it on yet (the device approves it
                // once, as on the registration screen) instead of refusing.
                const device = ledgerDevice(ctx);
                const fp = device.fingerprint;
                let registration = wallet.ledgerRegistrations?.[fp];
                let patch: Partial<typeof wallet> = {};
                const rec = recordFromDiscovery(recordedDevice(wallet, fp), device.record);
                if (rec) patch.keyDevices = { ...(wallet.keyDevices ?? {}), [fp]: rec };
                if (!registration) {
                  const reg = await device.registerVault(wallet);
                  if (!ctx.alive()) return;
                  patch = { ...patch, ...reg.patch };
                  registration = reg.patch.ledgerRegistrations?.[fp];
                }
                if (Object.keys(patch).length > 0) await updateWallet(wallet.id, patch);
                if (!ctx.alive()) return;
                const spec = ledgerWalletSpecFor(wallet.descriptor, wallet.label, registration);
                if ('blocker' in spec) throw new Error(spec.blocker);
                // The courier for every transaction of the pass (decided
                // 2026-10-05), through the one hook: each slides in as its
                // own "transaction N of M", the device asks once per
                // transaction, and the client's turn is "3. Sign the
                // transaction" on every one (decided: "keep 3"). A leg already
                // signed on THIS device (Try again after a decline or a
                // dropped link) is not asked again. The pass is absorbed
                // as the last leg's follow-up, inside the run (legDone).
                const engine = await getEngine(wallet);
                const keyName = keyDisplayName(wallet, ctx.deviceFingerprint, providerFps) ?? wallet.label;
                const pass = passFor(ctx.deviceFingerprint);
                for (let i = 0; i < legs.length; i++) {
                  if (!ctx.alive()) return;
                  if (pass.signed[i] != null) continue;
                  const signed = await signing.signOnLedger(ctx, spec.spec, await legJob(engine, i, keyName), legDone(pass, i, ctx.deviceFingerprint));
                  if (signed == null) return;
                }
              }}
              bitboxTask={async (ctx) => {
                if (!cast.customerFps.has(ctx.fingerprint)) {
                  throw new Error(
                    `This BitBox holds a different key (${ctx.fingerprint.toUpperCase()}). Connect the one holding this vault's own key.`,
                  );
                }
                if (signedFps.includes(ctx.fingerprint)) {
                  throw new Error(
                    'This key has already signed this refresh. Connect the other key of this vault.',
                  );
                }
                const bitboxRec = recordFromDiscovery(recordedDevice(wallet, ctx.fingerprint), bitboxDevice(ctx).record);
                if (bitboxRec) {
                  void updateWallet(wallet.id, {
                    keyDevices: { ...(wallet.keyDevices ?? {}), [ctx.fingerprint]: bitboxRec },
                  });
                }
                const blocker = bitboxPolicyBlocker(wallet.descriptor);
                if (blocker) throw new Error(blocker);
                // Registered through the one device layer (2026-10-04), so
                // the moment the device asks for the vault's approval reaches
                // the flow from one place; what it then signs with (the
                // registered policy, its own account, the name it STORED) is
                // read off that answer in one place for every screen.
                const reg = await bitboxDevice(ctx).registerVault(wallet);
                if (!ctx.alive()) return;
                const bitboxSpec = bitboxSigningSpec(wallet, ctx.fingerprint, reg);
                if (!reg.standard && !reg.alreadyRegistered) void updateWallet(wallet.id, reg.patch);
                // The courier for every transaction of the pass, as on the
                // Ledger: each its own "transaction N of M", the client's
                // turn "3. Sign the transaction" on every one; a leg already
                // signed on this device is not asked again, and the pass is
                // absorbed as the last leg's follow-up, inside the run.
                const engine = await getEngine(wallet);
                const keyName = keyDisplayName(wallet, ctx.fingerprint, providerFps) ?? wallet.label;
                const pass = passFor(ctx.fingerprint);
                for (let i = 0; i < legs.length; i++) {
                  if (!ctx.alive()) return;
                  if (pass.signed[i] != null) continue;
                  const signed = await signing.signOnBitbox(ctx, bitboxSpec, await legJob(engine, i, keyName), legDone(pass, i, ctx.fingerprint));
                  if (signed == null) return;
                }
              }}
            />
          </>
        )}

        {phase === 'choose' && (
          <>
            {/* True for every vault that reaches this step (decided
                2026-09-22): it no longer counts what was given or names
                where the next signature comes from. The ways on are the
                rows below, and only the ones this vault allows. */}
            <InfoHeading
              style={styles.title}
              title="Why more than one signature"
              text="This refresh needs more than one signature, and the ones given so far are not enough yet.">
              {stillNeeded == null
                ? 'More signatures to go'
                : stillNeeded === 1
                  ? 'One more signature to go'
                  : `${stillNeeded} more signatures to go`}
            </InfoHeading>
            {/* The client's OWN key first, always (decided 2026-09-18). Talia is
                self-custodial: nobody is sent to us while a key of theirs can
                finish the job. Only when they hold no other key on this path
                is co-signing the one way on. */}
            {unsignedOwnFps.length > 0 && (
              <>
                <Text style={styles.body}>
                  Another key of this vault can sign here. Nothing is sent to us and
                  there is nothing to wait for.
                </Text>
              </>
            )}
            {plan.canCosign && (
              <>
                <Text style={styles.body}>
                  {unsignedOwnFps.length > 0
                    ? 'Or ask us to co-sign. We co-sign and email you, and you send the refresh afterwards.'
                    : 'This vault holds no other key of yours on its primary path, so the next signature comes from us. We co-sign and email you, and you send the refresh afterwards.'}
                </Text>
              </>
            )}
            {plan.cosignOverBatchLimit && unsignedOwnFps.length > 0 && (
              <Text style={styles.body}>
                {`A co-sign round covers up to ${COSIGN_BATCH_MAX} transactions, and this refresh has ${legs.length}. Sign with another of your own keys instead.`}
              </Text>
            )}
            {/* Nothing left that finishes this set (decided 2026-09-18: signing
                them individually "doesn't solve ANY problem", so it is not
                offered). The client is told what WILL work instead. */}
            {plan.stuck && (
              <Text style={styles.body}>
                {plan.cosignOverBatchLimit
                  ? `One co-sign round covers up to ${COSIGN_BATCH_MAX} transactions and this refresh has ${legs.length}. Go back and pick fewer coins, then refresh the rest afterwards.`
                  : 'This vault needs a signature that is not available on this phone.'}
              </Text>
            )}
          </>
        )}

        {phase === 'sending' && (
          <>
            <InfoHeading
              style={styles.title}
              title="What happens now"
              text="Each coin is its own transaction, so they are sent one after another. If one is refused, the others still go.">
              Ready to send
            </InfoHeading>
            <Text style={styles.body}>
              Your own keys have signed every transaction. Nothing goes to 21st Capital.
            </Text>
            <Card style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Transactions</Text>
                <Text style={styles.rowValue}>{legs.length}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Total refreshed</Text>
                <Text style={styles.rowValue}>{formatAmount(totalAmount, settings.unit)}</Text>
              </View>
            </Card>
          </>
        )}

        {phase === 'sent' && sentCount > 0 && (
          <SentPage
            wallet={wallet}
            facts={sessionFacts}
            words={sessionSentWords(sentCount, legs.length)}
            extra={failedCard}
            actions={
              sentCount < legs.length
                ? [
                    { title: sending ? 'Sending…' : 'Try the rest again', onPress: retryRest, disabled: sending },
                    { title: 'Done', variant: 'ghost', onPress: goVault },
                  ]
                : [{ title: 'Done', onPress: goVault }]
            }
          />
        )}

        {/* Nothing went out: not a Sent page, no tick. */}
        {phase === 'sent' && sentCount === 0 && (
          <>
            <Text style={styles.title}>{sessionNothingSent(legs.length).title}</Text>
            <Text style={styles.body}>{sessionNothingSent(legs.length).sub}</Text>
            {failedCard}
          </>
        )}

        {phase === 'cosign' && cast.cosignFp != null && (
          <CosignRequestPanel
            walletId={walletId}
            psbt={legs[0].psbt}
            cosignFingerprint={cast.cosignFp}
            amountSats={totalAmount}
            destination=""
            isRefresh
            batch={legs.map((l) => ({
              psbt: l.psbt,
              amountSats: l.amountSats,
              destination: l.destination,
            }))}
            onBusyChange={(b) => {
              panelBusyRef.current = b;
            }}
            onRequested={(warning, rejected) => {
              setRequestWarning(warning ?? null);
              setRequestRejected(rejected ?? null);
              setPhase('requested');
            }}
            onBack={() => setPhase('choose')}
            onActions={setCosignActions}
          />
        )}

        {phase === 'requested' && requestRejected != null && (
          <>
            <View style={styles.doneHead}>
              <DrawnIcon kind="cross" size={30} strokeWidth={5} />
              <Text style={styles.title}>The session was rejected</Text>
            </View>
            <Text style={styles.body}>{requestRejected}</Text>
          </>
        )}

        {phase === 'requested' && requestRejected == null && (
          <>
            <View style={styles.doneHead}>
              <DrawnIcon kind="tick" size={30} strokeWidth={5} />
              <Text style={styles.title}>The session is with 21st Capital</Text>
            </View>
            <Text style={styles.body}>
              All {legs.length} requests are submitted. We&apos;ll email you when
              they are co-signed, and you then send the whole refresh from Pending
              transactions.
            </Text>
            {requestWarning != null && (
              <Card style={styles.card}>
                <Text style={styles.body}>{requestWarning}</Text>
              </Card>
            )}
          </>
        )}
      </StepTransition>

      {feeAsk != null && (
        <AppDialog
          visible
          title={`The network fee is unusually high: ${formatSats(feeAsk)}`}
          actions={[
            {
              label: 'Send anyway',
              variant: 'primary',
              onPress: () => {
                setSending(true);
                void sendAll(true).finally(() => setSending(false));
              },
            },
            { label: 'Cancel', variant: 'ghost', onPress: () => {} },
          ]}
          onClose={() => setFeeAsk(null)}
        />
      )}

      {busyNotice && (
        <AppDialog
          visible
          title="One moment"
          message="The co-sign requests are going to 21st Capital right now. It takes a few seconds, then you can leave."
          actions={[{ label: 'OK', variant: 'primary', onPress: () => {} }]}
          onClose={() => setBusyNotice(false)}
        />
      )}

      {leaveConfirm && (
        <AppDialog
          visible
          title="Leave the refresh session?"
          message="The signatures collected so far are discarded. Nothing has been sent and your coins are untouched. You can start the refresh again any time."
          actions={[
            { label: 'Stay', variant: 'ghost', onPress: () => {} },
            {
              label: 'Leave',
              variant: 'primary',
              destructive: true,
              onPress: () => {
                // Race guards: if the batch was submitted while this dialog
                // was open, "leave" must mean the vault — and while a submit
                // is still IN FLIGHT, leaving is refused (the server may be
                // accepting the batch this very second). Decided 2026-08-27.
                if (phaseRef.current === 'requested') {
                  goVault();
                  return;
                }
                if (phaseRef.current === 'cosign' && panelBusyRef.current) {
                  setBusyNotice(true);
                  return;
                }
                allowLeaveRef.current = true;
                navigation.goBack();
              },
            },
          ]}
          onClose={() => setLeaveConfirm(false)}
        />
      )}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // The page gutter and the safe area are the Screen's; `lg` between the blocks.
    content: { gap: theme.spacing.lg },
    title: { ...theme.typography.title, color: theme.colors.offWhite, flexShrink: 1 },
    body: { ...theme.typography.body, color: theme.colors.slate },
    card: { gap: theme.spacing.md },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing.lg,
    },
    totalRow: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.hairline,
      paddingTop: theme.spacing.sm,
    },
    rowLabel: { ...theme.typography.body, color: theme.colors.slate },
    rowValue: { ...theme.typography.body, color: theme.colors.offWhite },
    stepWrap: { gap: theme.spacing.lg },
    // The Sent page pushes its sub line and actions to the foot.
    contentFill: { flexGrow: 1 },
    stepFill: { flex: 1 },
    doneHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  }),
);
