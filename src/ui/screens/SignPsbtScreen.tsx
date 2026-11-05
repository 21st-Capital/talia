/**
 * The signing ceremony. The app is watch-only — private keys never leave the
 * hardware. This screen hands the unsigned PSBT to the signer, takes the
 * signatures back, finalizes via BDK, and broadcasts:
 *
 *   COLDCARD Q    animated BBQr out → device signs → scan BBQr back
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppModal, FactRow, Gloss, cardGlow, StackHeader } from '../components';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { landOverTab } from '../navigation/landOverTab';
import type { RootStackParamList } from '../navigation/types';
import { SpendReview } from '../components/SpendReview';
import {
  ChevronRightIcon,
  ClockIcon,
  AnimatedQr,
  AppDialog,
  BbqrScanner,
  Button,
  Card,
  DrawnIcon,
  FileIcon,
  FOOTER_ROOM,
  InfoHeading,
  LockIcon,
  PageFooter,
  ScanIcon,
  Screen,
  SentPage,
  StepTransition,
  UNDER_HEADER_TOP,
  sentWords,
} from '../components';
import type { BbqrScanResult, SentFacts, SentKind } from '../components';
import { theme, themedStyles } from '../theme';
import {
  useWallets,
  broadcastThroughChainServers,
  formatAmount,
  formatSats,
  loadTxCache,
  loadUtxoCache,
  agedTipHeight,
  formatBlocksDuration,
  heirFingerprintsOf,
  deviceOfKey,
  isSingleSigVault,
  singleSigDevice,
  vaultShapeOf,
  ownKeysFirst,
  keyDisplayName,
  plannedReplacement,
  recordIfReplacement,
  replacementBroadcastFailure,
  replacementParamsFromPlan,
  replacementSendCheck,
  dropSiblingPlans,
  getSentAt,
  returnedPayment,
  saveSentAt,
  saveTxReplacement,
} from '../../wallet';
import type { ReplacementParams, ReplacementSendVerdict, WalletMeta } from '../../wallet';
import { withTimeout } from '../../wallet/withTimeout';
import { sendTooEarly, tooEarlyTitle } from '../../wallet/sendTooEarly';
import { notReachedWords } from '../../wallet/broadcastAnswer';
import { cosignAmount, isSpedUpReturn } from './cosignAmount';
import { ledgerWalletSpecFor } from '../../bitcoin/ledger';
import { ledgerPolicyBlocker } from '../../bitcoin/ledger/policy';
import { bitboxPolicyBlocker } from '../../bitcoin/bitbox/policy';
import { HardwareConnect } from '../components/HardwareConnect';
import type { StepBack } from '../components/HardwareConnect';
import { DevicePicker } from '../components/DevicePicker';
import { KeyDeviceTile } from '../components/KeyDeviceTile';
import { keyRowSub } from '../components/devicePickerModel';
import { bitboxDevice, ledgerDevice } from '../hww/connectedDevice';
import type { DeviceAsk } from '../hww/deviceTurns';
import { bitboxSigningSpec, useSigningCourier } from '../hooks/useSigningCourier';
import { keyStep, modelOfRecord, modelsFor, recordFromDiscovery, recordedDevice, registeredFingerprintsOf } from '../../wallet/deviceKinds';
import type { DeviceModel, StepKey } from '../../wallet/deviceKinds';
import type { KeyDevice } from '../../wallet/types';
import { HWW_ENABLED, SIGNING_ENABLED } from '../../config';
import { encodeBbqr } from '../../bitcoin/bbqr';
import { encodePsbtUrParts } from '../../bitcoin/ur';
import { loadSession } from '../../services/companyAuth';
import {
  completeCosign,
  removePendingCosign,
  removePendingCosignsForTxid,
  savePendingCosign,
  updatePendingCosignPsbt,
  withdrawPendingForTxids,
} from '../../services/cosign';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { keyboardInsets } from '../hooks/keyboardInsets';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import {
  decodeBase64,
  decodeHexOrBase64,
  encodeBase64,
  looksLikePsbt,
  looksLikeRawTx,
  rawTxMatchesPsbt,
  psbtAbsurdFee,
  makePsbtExport,
  parsePsbt,
  psbtInputsFinalized,
  psbtSignatureStatus,
  txLocksOf,
  unsignedTxid,
} from '../../bitcoin/psbt';
import { minOlderBlocks, parsePolicy, pathInPlay, pathRequirement } from '../../bitcoin/descriptor';
import { progressOf, signingProgress } from '../../wallet/signingProgress';
import { exportPsbtToFile, pickBinaryFile } from '../../platform/files';
import type { CompletedPsbt } from '../../bitcoin/engine/types';
import { isSendPaused, SEND_PAUSED_TITLE } from '../../bitcoin/engine/addressCheck';
import { coinNotAvailable, COIN_NOT_AVAILABLE } from '../../bitcoin/engine/engineError';
import { CosignRequestFooterButtons, CosignRequestPanel } from '../components/CosignRequestPanel';
import type { CosignRequestActions } from '../components/CosignRequestPanel';
import { markOwnOutputs, ownOutputIndices } from '../../wallet/ownOutputs';

type Props = NativeStackScreenProps<RootStackParamList, 'SignPsbt'>;

type Phase =
  | 'choose'
  | 'method'
  | 'qr'
  | 'file'
  | 'bluetooth'
  | 'passport'
  | 'cosign'
  | 'requested'
  | 'signedWaiting'
  | 'ready'
  | 'done';
/** Forward order of phases, for the step slide direction. */
const PHASE_ORDER = ['choose', 'method', 'cosign', 'requested', 'qr', 'file', 'bluetooth', 'passport', 'signedWaiting', 'ready', 'done'];

/** Where the top-left back button steps to (mirrors the in-flow "Back" button).
 *  null = first step / no target → let the screen actually leave. */
/**
 * `solo` = a one-key vault, whose key list is never shown (decided 2026-09-08:
 * "this page is only needed if more than 1 key is part of a wallet"), so
 * back from the first real page leaves the ceremony instead of landing on
 * a page the owner never saw.
 */
function backTarget(p: Phase, solo: boolean): Phase | null {
  switch (p) {
    case 'method':
    case 'cosign':
    case 'ready':
      return solo ? null : 'choose';
    case 'qr':
    case 'file':
      return 'method';
    case 'bluetooth':
    case 'passport':
      return solo ? null : 'choose';
    default:
      return null;
  }
}

const METHODS = [
  {
    id: 'camera' as const,
    name: 'Camera',
    how: 'Animated QR, both directions',
    Icon: ScanIcon,
  },
  {
    id: 'file' as const,
    name: 'File',
    how: 'Export the PSBT, import the signed file',
    Icon: FileIcon,
  },
];

/**
 * The one node error a user can act on gets a sentence; everything else
 * shows as the node said it. Since fee tiers may sit under 1 sat/vB
 * (decided 2026-09-12), a server still on the old 1 sat/vB relay floor answers
 * "min relay fee not met" and the fix is a higher priority, not a retry.
 */
function plainFailure(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  if (/min relay fee not met|mempool min fee not met|fee.*too low/i.test(raw)) {
    return 'The network server refused the fee rate as too low. Start the payment again and choose a higher priority.';
  }
  return coinNotAvailable(e) ? COIN_NOT_AVAILABLE : raw;
}

/** "13:55" today, "27 Sep, 13:55" another day. */
function sentTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
}

export function SignPsbtScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, getEngine, syncWallet, settings, updateWallet } = useWallets();
  const wallet = getWallet(route.params.walletId);
  /**
   * A Speed up or a Cancel (decided 2026-09-28, design A): the same ceremony,
   * entered with the rebuilt transaction. Only the words change (the head,
   * the Replaces or Cancels row, "{new} sats, was {old} sats") and what
   * happens after the broadcast (Talia's record, the note carried across).
   */
  /**
   * A Speed up or a Cancel resumed from Pending transactions (a parked
   * half-signed spend, "Sign with another key", a request 21st Capital
   * turned down) arrives without the route's `replaces`: it is rebuilt from
   * the plan written when the replacement was built, keyed by the unsigned
   * txid every signed copy shares. Without it a cancel, whose every coin is
   * the vault's, would read as a refresh (decided 2026-09-28).
   */
  const [fromPlan, setFromPlan] = useState<ReplacementParams | null>(null);
  /** Until the plan lookup has answered, the screen does not know whether an
   *  all-own spend is a refresh or a cancel, so it says neither: a resumed
   *  cancel used to open on "Refresh these coins" for a frame or two
   *  (decided 2026-09-28). Nothing to look up means it is known at once. */
  const [planSettled, setPlanSettled] = useState(
    () => !!route.params.replaces || !unsignedTxid(route.params.psbtBase64),
  );
  useEffect(() => {
    if (route.params.replaces) return;
    const id = unsignedTxid(route.params.psbtBase64);
    if (!id) return;
    let live = true;
    void (async () => {
      const plan = await plannedReplacement(route.params.walletId, id).catch(() => null);
      if (!live) return;
      if (!plan) {
        setPlanSettled(true);
        return;
      }
      const sentMs = await getSentAt(route.params.walletId, plan.oldTxid).catch(() => null);
      if (!live) return;
      setFromPlan(replacementParamsFromPlan(plan, sentMs));
      setPlanSettled(true);
    })();
    return () => {
      live = false;
    };
  }, [route.params.replaces, route.params.psbtBase64, route.params.walletId]);
  const replaces = route.params.replaces ?? fromPlan ?? undefined;
  const replacesWhat = replaces?.what ?? 'payment';
  /** "The payment of 13:55", else "of 0.05 BTC", else "The waiting refresh". */
  const replacesLine = replaces
    ? replaces.sentAt
      ? `The ${replacesWhat} of ${sentTime(replaces.sentAt)}`
      : replaces.amountSats > 0
        ? `The ${replacesWhat} of ${formatAmount(replaces.amountSats, settings.unit)}`
        : `The waiting ${replacesWhat}`
    : null;
  useLayoutEffect(() => {
    if (!replaces) return;
    const kicker = replaces.kind === 'cancel' ? 'Cancel payment' : 'Speed up';
    navigation.setOptions({
      title: kicker,
      header: ({ navigation: nav }) => (
        <StackHeader title={kicker} subtitle={wallet?.label} canGoBack={nav.canGoBack()} />
      ),
    });
  }, [navigation, replaces, wallet?.label]);

  const [phase, setPhase] = useState<Phase>('choose');
  /** A LAYER is the unit of recovery signing (decided 2026-09-01): each
   *  timelocked path spends under its own quorum, so its keys live on
   *  their own screen, never mixed into the primary list. Index into
   *  vaultPaths.locked; null = the primary view. */
  const [activeLayer, setActiveLayer] = useState<number | null>(null);
  /** Set when the co-sign request reached 21C but recording it locally
   *  failed — shown on the 'requested' confirmation (decided 2026-08-27). */
  const [cosignWarning, setCosignWarning] = useState<string | null>(null);
  /** Set when 21st Capital rejected the request the moment it arrived (a
   *  send over the co-signing limit, decided 2026-09-22): the reason, as the
   *  rejection email words it. */
  const [cosignRejected, setCosignRejected] = useState<string | null>(null);
  /** The key the user picked to sign with next (fingerprint, lowercase). */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Separate-transactions refresh: several PSBTs signed + broadcast in turn.
  // Stateful: signing with an unlocked recovery/heir key REBUILDS the spend
  // on that key's branch and swaps the queue (decided 2026-07-27).
  const [queue, setQueue] = useState<string[]>(
    route.params.psbtQueue ?? [route.params.psbtBase64],
  );
  const [queueIndex, setQueueIndex] = useState(0);
  // Multisig ceremony: the PSBT accumulates signatures round by round —
  // this is the CURRENT working copy (starts as the unsigned build).
  const [workingPsbt, setWorkingPsbt] = useState(queue[0]);
  // The Bluetooth task runs async while renders continue — it reads the
  // working copy through this ref so a branch rebuild can't hand the Ledger
  // a stale transaction.
  const workingPsbtRef = useRef(workingPsbt);
  workingPsbtRef.current = workingPsbt;
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedPsbt | null>(null);
  const [rawTx, setRawTx] = useState<Uint8Array | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  /** A sped-up return: what the payment its cancel cancelled paid, from
   *  Talia's records (null when it is not a return or they cannot say).
   *  Read as soon as the ceremony knows what it replaces (decided
   *  2026-10-02), so the co-sign request, the parked record and the Sent
   *  page all lead with the same figure. Local and quick; never throws. */
  const [returnSats, setReturnSats] = useState<number | null>(null);
  const replacesKind = replaces?.kind;
  const replacesTxid = replaces?.txid;
  useEffect(() => {
    if (replacesKind !== 'speedup' || !replacesTxid) return;
    let live = true;
    void returnedPayment(route.params.walletId, replacesTxid)
      .catch(() => null)
      .then((sats) => {
        if (live) setReturnSats(sats);
      });
    return () => {
      live = false;
    };
  }, [route.params.walletId, replacesKind, replacesTxid]);
  /** Decided 2026-08-31: the explicit Cancel button on a ceremony that already
   *  carries a signature asks first, and a confirmed cancel lands on the
   *  vault screen. The back chevron keeps its step-back behavior. */
  const [confirmCancel, setConfirmCancel] = useState(false);
  /**
   * Signing on the hardware, design A "The courier" (decided 2026-10-03), wired
   * by the one hook every signing screen uses (`useSigningCourier`): its feed
   * carries the device's signals to the drawn screens without re-rendering
   * this screen; `signing.courier` is set once a device has answered and the
   * transaction starts on its way, and cleared on a retry or when the step is
   * left. Null = the connection flow's own pages and lines.
   */
  const signing = useSigningCourier(wallet);
  const { feed, reset: resetSigning } = signing;
  /** The hardware step's ONE Back, handed to this page's pinned footer by
   *  the step (decided 2026-10-05): to the device list when there is one, else
   *  to the key list; null while the device is at work. */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);
  /** The device's turn before the transaction (a Ledger's PIN or app to
   *  open, the BitBox's unlock, decided 2026-10-04): the flow draws it as
   *  `DeviceTurn`, and this screen drops its own heading while it is up. */
  const [turn, setTurn] = useState<DeviceAsk | null>(null);
  /** The device picked in the "Which device?" list for a key the vault has
   *  no record of (decided 2026-10-04, device first): the search draws it. */
  const [picked, setPicked] = useState<DeviceModel | null>(null);
  /** "Another device" in that list: the ferries (a code, a file). */
  const [ferries, setFerries] = useState(false);
  /** The co-sign panel's step actions, for this page's pinned footer. */
  const [cosignActions, setCosignActions] = useState<CosignRequestActions | null>(null);
  /** The safe area is the content's floor where no footer takes it. */
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (phase === 'bluetooth') return;
    resetSigning();
    setTurn(null);
    setPicked(null);
    setFerries(false);
  }, [phase, resetSigning]);
  const [dialog, setDialog] = useState<{
    title: string;
    /** None for a title-only dialog (the minimal-dialog rule). */
    message?: string;
    actions?: Array<{ label: string; variant?: 'primary' | 'ghost'; onPress: () => void }>;
  } | null>(null);

  const psbtBytes = useMemo(() => decodeBase64(workingPsbt), [workingPsbt]);
  const qrFrames = useMemo(
    () => (psbtBytes ? encodeBbqr(psbtBytes, 'P') : []),
    [psbtBytes],
  );
  /** The Passport speaks UR, not BBQr (decided 2026-09-08): the same PSBT as a
   *  moving ur:crypto-psbt code. */
  const urFrames = useMemo(
    () => (psbtBytes ? encodePsbtUrParts(psbtBytes) : []),
    [psbtBytes],
  );
  /**
   * Which outputs come back to this vault: BDK's answer against the vault's
   * descriptor, never the PSBT's own derivation entries (decided
   * 2026-09-26). Keyed by the unsigned txid, which signatures never change,
   * so it is asked again only when the transaction itself is rebuilt.
   */
  const unsignedKey = useMemo(() => unsignedTxid(workingPsbt) ?? '', [workingPsbt]);
  const [ownership, setOwnership] = useState<{ key: string; own: number[] } | null>(null);
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    const psbt = workingPsbt;
    const key = unsignedKey;
    void (async () => {
      let own: number[] = [];
      try {
        own = await ownOutputIndices(await getEngine(wallet), psbt);
      } catch {
        // unknown = leaving: nothing is labelled the vault's own on a guess
      }
      if (live) setOwnership({ key, own });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsignedKey, wallet?.id]);
  const parsed = useMemo(() => {
    // Nothing is summarised until the ownership answer for THIS transaction
    // is in: a row must never read "change" or "to" on a guess.
    if (!ownership || ownership.key !== unsignedKey) return null;
    try {
      return markOwnOutputs(parsePsbt(workingPsbt, wallet?.network), ownership.own);
    } catch {
      return null;
    }
  }, [workingPsbt, wallet?.network, ownership, unsignedKey]);
  /** Who has signed so far (multisig progress). */
  const sigStatus = useMemo(() => psbtSignatureStatus(workingPsbt), [workingPsbt]);
  /** 21st Capital's issued keys (co-signer / rescue) — signed online, not on a
   *  device. Recognized from BOTH the vault's creation-time tag AND the live
   *  known-fingerprints endpoint, so an imported vault whose tag is missing still
   *  routes 21C keys to co-signing and never sends the SHARED co-signer
   *  fingerprint as a client fingerprint (decided 2026-07-23). The key rows wait
   *  for the fetch to settle, as every other hardware screen does (decided
   *  2026-10-04): until it lands, our key on an imported vault reads as a key
   *  of the owner's with no record, and a tap on it asked "Which device?"
   *  for a key no device holds. */
  const { providerFps, settled: fpsSettled } = useProviderFingerprints(wallet);
  /** Has the CLIENT signed with one of their OWN keys yet? 21st Capital only
   *  co-signs AFTER the client's own signature — holding the device proves the
   *  request really comes from them, even if the fingerprint registration is
   *  incomplete (decided 2026-07-23). */
  const clientHasSigned = useMemo(
    () => sigStatus.signedFingerprints.some((fp) => !providerFps.has(fp.toLowerCase())),
    [sigStatus.signedFingerprints, providerFps],
  );
  /** The recipient output (for the co-sign request summary). */
  const cosignOut = useMemo(() => parsed?.outputs.find((o) => !o.isOwn), [parsed]);
  /** Every output is ours = a timelock REFRESH (self-spend), not a payment.
   *  The last screens must say "refresh", never "send" — nothing leaves the
   *  vault and "send" reads like money going out (decided 2026-07-26). */
  const isSelfRefresh = useMemo(
    () =>
      !!parsed &&
      parsed.outputs.length > 0 &&
      parsed.outputs.every((o) => o.isOwn),
    [parsed],
  );
  /** Say "refresh" only for a real one: never a Speed up or Cancel, not
   *  before the plan lookup has said which it is, and only on a vault with
   *  a timelock, the way the transaction page and the vault list name it.
   *  A self-send on a vault with no clock is a send (decided 2026-10-02: the
   *  Sent page's "What a refresh does" says each coin's clock starts again). */
  const refreshWording =
    isSelfRefresh && planSettled && !replaces && wallet != null && minOlderBlocks(wallet.descriptor) != null;
  /** A Speed up of a return: the cancel it speeds up, in every figure and
   *  word (decided 2026-09-28), before it goes out and on the Sent page alike. */
  const spedUpReturn = isSpedUpReturn(replaces, returnSats);
  /** Amount to show in the co-sign summary, the pending record and so the
   *  Pending row: the recipient's amount, a refresh's total, and for a
   *  cancel and a sped-up return the PAYMENT it cancels, never every coin
   *  coming back (decided 2026-09-28 and 2026-10-02). */
  const cosignAmountSats = useMemo(
    () => cosignAmount({ replaces, returnSats, outputs: parsed?.outputs ?? null }),
    [parsed, replaces, returnSats],
  );
  /** Destination for the co-sign summary/relay: the recipient, or — for a
   *  refresh — our own fresh address (already in the blind PSBT). */
  const cosignDestination = useMemo(() => {
    if (cosignOut?.address) return cosignOut.address;
    return parsed?.outputs.find((o) => o.isOwn && o.address)?.address ?? '';
  }, [cosignOut, parsed]);
  /**
   * The vault's spending structure: who can sign NOW (primary path) and
   * which keys sit behind a timelock (layered vaults) — paths come from
   * parsePolicy pre-sorted, primary first.
   */
  const vaultPaths = useMemo(() => {
    if (!wallet) return null;
    try {
      const policy = parsePolicy(wallet.descriptor);
      const primary =
        policy.paths.find((p) => p.olderBlocks === undefined && p.afterHeight === undefined) ??
        policy.paths[0];
      if (!primary) return null;
      // Imported bare-xpub wallets have NO origin fingerprint — the key must
      // still get a row (keyed by xpub), or the screen renders empty
      // (decided 2026-07-19).
      const keysOf = (groups: typeof primary.groups) => {
        const seen = new Map<string, { id: string; fp: string | null }>();
        for (const g of groups) {
          for (const k of g.keys) {
            const fp = k.fingerprint?.toLowerCase() ?? null;
            const id = fp ?? k.xpub;
            if (!seen.has(id)) seen.set(id, { id, fp });
          }
        }
        // The client's own keys first, 21st Capital's last (decided 2026-09-21:
        // "the users key should always be prioritised to be used first").
        // The descriptor lists keys in byte order, which offered our
        // co-signer second.
        return ownKeysFirst([...seen.values()], (k) => !!k.fp && providerFps.has(k.fp));
      };
      return {
        primary,
        // Group-AWARE: an and_v chain is N groups of threshold 1, so reading
        // groups[0] understated a 3-of-3 as needing ONE signature
        // (decided 2026-07-28).
        threshold: pathRequirement(primary).needed,
        keys: keysOf(primary.groups),
        fingerprints: keysOf(primary.groups)
          .map((k) => k.fp)
          .filter((f): f is string => !!f),
        locked: policy.paths
          .filter((p) => p !== primary && p.olderBlocks !== undefined)
          .map((p) => ({
            olderBlocks: p.olderBlocks!,
            keys: keysOf(p.groups),
            needed: pathRequirement(p).needed,
            path: p,
          })),
      };
    } catch {
      return null;
    }
  }, [wallet, providerFps]);
  /**
   * The ONE key of a single-key vault, or null. Its picker page has nothing
   * to pick (decided 2026-09-08: "you can go straight to the last page for
   * signing"), so the ceremony opens on the device itself. A 21st Capital
   * co-signer key is never solo: that path asks for the client's own
   * signature first.
   */
  const soloKey = useMemo(() => {
    if (!wallet || !isSingleSigVault(wallet)) return null;
    const keys = vaultPaths?.keys ?? [];
    if (keys.length !== 1) return null;
    const only = keys[0];
    if (only.fp && providerFps.has(only.fp.toLowerCase())) return null;
    return only;
  }, [wallet, vaultPaths, providerFps]);
  /**
   * Has the primary path's THRESHOLD already been met? (decided 2026-07-28: a
   * 2-of-3 signed by two of the client's own keys still demanded the 21st
   * Capital co-signer.) The finalizer's verdict is not the same question:
   * enough keys can have signed while the witness still fails to assemble,
   * and in that case the answer is to say so — never to ask for a signature
   * the vault does not require.
   */
  /**
   * ANY spending path, not just the primary one (decided 2026-07-28). An imported
   * vault can have a multi-key recovery layer — a 2-of-2 primary behind a
   * 2-of-3 recovery, say — and a spend on that branch is complete when the
   * RECOVERY path is satisfied. Every AND-ed group must reach its own
   * threshold either way.
   */
  /**
   * The path this spend is on, and how far along it (the leaf hazard,
   * decided 2026-10-17). Only a path the TRANSACTION opens can complete it: a device
   * holding keys on the everyday path and on a recovery path signs both, the
   * coins may be old enough, yet an everyday spend (nSequence 0xFFFFFFFD,
   * version 1) carries no wait, so the recovery signature never finishes it.
   * This screen used to call that path satisfied by fingerprint, said
   * "Enough signatures collected", parked the spend as ready and never asked
   * for the second device, while the library (rightly) left it open. Per
   * input and per tapleaf (decided 2026-09-26), each signature counted for the KEY
   * that made it, and the satisfied path if there is one, else the open path
   * closest to it: that is the path the client hears about.
   */
  const txLocks = useMemo(() => txLocksOf(workingPsbt), [workingPsbt]);
  const inPlay = useMemo(() => {
    if (!wallet) return null;
    try {
      return pathInPlay(parsePolicy(wallet.descriptor), sigStatus, txLocks);
    } catch {
      return null;
    }
  }, [wallet, sigStatus, txLocks]);
  /** A copy that already carries every final witness needs nothing more. */
  const finalCopy = useMemo(() => psbtInputsFinalized(workingPsbt), [workingPsbt]);
  const progress = inPlay ? progressOf(inPlay, finalCopy) : null;
  const satisfiedPath = inPlay?.satisfied ? inPlay.path : null;
  const thresholdMet = finalCopy || satisfiedPath !== null;
  /** What the count on screen says: the keys of the path in play that
   *  signed, never the raw number of signatures (a device holding two of the
   *  vault's keys leaves two). */
  const shownSignatures = progress?.signatures ?? sigStatus.signatureCount;

  /** The requirement of the path actually in play — a recovery spend needs
   *  ITS keys, not the primary path's, and announcing "2 signatures" during
   *  a one-key recovery spend is simply wrong (decided 2026-08-26). */
  /** What a timelocked layer is called on screen: the rescue layer by the
   *  21st Capital key it holds, an inheritance layer by its heir key, and
   *  anything else a plain recovery layer. */
  const layerName = (layer: { keys: Array<{ fp: string | null }> }): string => {
    const fps = layer.keys.flatMap((k) => (k.fp ? [k.fp.toLowerCase()] : []));
    if (fps.some((f) => providerFps.has(f))) return '21st Capital rescue layer';
    const heirs = wallet ? heirFingerprintsOf(wallet) : new Set<string>();
    // On the heir's own phone their key is left out of heirFingerprintsOf
    // (it is the phone owner's), yet its layer is still the inheritance one.
    if (wallet?.heirVault && wallet.heirKeyFingerprint) heirs.add(wallet.heirKeyFingerprint.toLowerCase());
    if (fps.some((f) => heirs.has(f))) return 'Inheritance layer';
    return 'Recovery layer';
  };

  const activeRequirement = useMemo(() => {
    const layerPath = activeLayer != null ? vaultPaths?.locked[activeLayer]?.path : null;
    const path = layerPath ?? inPlay?.path ?? vaultPaths?.primary ?? null;
    if (!path) return null;
    const { needed, keys } = pathRequirement(path);
    const fps = keys.flatMap((k) => (k.fingerprint ? [k.fingerprint.toLowerCase()] : []));
    // needed = the quorum's requirement; totalKeys = how many keys the
    // path holds. A 2-of-3 signed by two is "2 of 3 keys", never "2 of 2"
    // (decided 2026-09-01).
    return { needed, totalKeys: keys.length, fingerprints: [...new Set(fps)] };
  }, [activeLayer, inPlay, vaultPaths]);
  /** Unsigned keys left on the active path. When every one of them is a
   *  21st Capital key, the next step is a co-signing REQUEST, not another
   *  device (reported 2026-08-31: "21st capital cosigning is not the next
   *  device"). */
  const remainingUnsigned = useMemo(
    () =>
      activeRequirement
        ? activeRequirement.fingerprints.filter(
            (fp) => !sigStatus.signedFingerprints.includes(fp),
          )
        : [],
    [activeRequirement, sigStatus.signedFingerprints],
  );
  const nextIs21C =
    remainingUnsigned.length > 0 &&
    remainingUnsigned.every((fp) => providerFps.has(fp.toLowerCase()));
  /** Every key of the path in play has signed SOMETHING, yet the path is not
   *  met: a device signed with its key on another path (a BitBox picks its
   *  own key; the leaf hazard). No key is left to pick, so the screen says so. */
  const signedOffPath =
    !thresholdMet &&
    activeLayer == null &&
    inPlay != null &&
    inPlay.missing > 0 &&
    inPlay.keys.every((k) => !!k.fingerprint) &&
    remainingUnsigned.length === 0;

  /**
   * Per-locked-path countdown for THIS transaction's coins: a recovery key
   * can only sign once EVERY input has sat still for the path's timelock, so
   * the binding number is the worst input. Null = heights unknown (unsynced).
   */
  const [lockCountdowns, setLockCountdowns] = useState<Record<number, number | null>>({});
  /** Confirmations on the YOUNGEST coin being spent — undefined when unknown.
   *  The fallback finaliser needs it to tell an OPEN timelocked path from one
   *  whose wait is not over; without it, it assembles a witness the network
   *  then rejects (2026-07-29). */
  const [minInputConfs, setMinInputConfs] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const locked = vaultPaths?.locked ?? [];
    const refs = parsed?.inputRefs ?? [];
    if (!wallet || locked.length === 0 || refs.length === 0) return;
    void (async () => {
      try {
        const [txs, cache] = await Promise.all([
          loadTxCache(wallet.id),
          loadUtxoCache(wallet.id),
        ]);
        const tip = cache ? agedTipHeight(cache) : undefined;
        const heightByTxid = new Map((txs ?? []).map((t) => [t.txid, t.blockHeight]));
        const out: Record<number, number | null> = {};
        for (const path of locked) {
          let worst: number | null = 0;
          for (const ref of refs) {
            const h = heightByTxid.get(ref.txid);
            if (h == null || tip == null) {
              worst = null;
              break;
            }
            worst = Math.max(worst, h + path.olderBlocks - tip);
          }
          out[path.olderBlocks] = worst;
        }
        // Youngest coin's age, for the finaliser's maturity guard.
        let youngest: number | undefined;
        for (const ref of refs) {
          const h = heightByTxid.get(ref.txid);
          if (h == null || tip == null) {
            youngest = undefined;
            break;
          }
          const confs = tip - h + 1; // a coin in the tip block has 1
          youngest = youngest === undefined ? confs : Math.min(youngest, confs);
        }
        if (live) {
          setLockCountdowns(out);
          setMinInputConfs(youngest);
        }
      } catch {
        // countdowns stay unknown — rows still render as locked
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id, parsed, vaultPaths]);


  /**
   * Human name for a key row. Fallback order: the user's label → for a
   * one-key vault the WALLET name (imported single-sigs have no per-key
   * label, found 2026-07-19) → the fingerprint.
   */
  const singleKeyVault = (vaultPaths?.keys.length ?? 0) <= 1 && !vaultPaths?.locked.length;
  const labelFor = useCallback(
    (id: string, fp?: string | null) => {
      const f = fp ?? (id.length === 8 ? id : null);
      // The name the vault carries, else the number every screen gives this
      // key (decided 2026-09-26): a fingerprint is not a name to anybody.
      const named = keyDisplayName(wallet, f, providerFps);
      if (named) return named;
      // Our own keys are named by their holder, never numbered and never
      // after the vault (the policy chips and the Advanced card say the same).
      if (f && providerFps.has(f.toLowerCase())) return '21st Capital';
      if (singleKeyVault && wallet) return wallet.label;
      return wallet?.label ?? 'Vault key';
    },
    // providerFps grows when the live fingerprint check lands: without it here
    // the rows keep the set from before the fetch and number our key as one of
    // the client's (decided 2026-09-26).
    [wallet, singleKeyVault, providerFps],
  );

  /** After broadcast, EVERY way out leads Home — back included. */
  const goHome = useCallback(() => {
    landOverTab('VaultsTab');
  }, []);

  /** After a co-sign request is sent, EVERY way out leads to the vault (decided
   *  2026-07-24): the client's part is done — 21C is always the LAST signer —
   *  so stepping back through the spend screens serves nothing. Clean stack:
   *  home → vault, so the vault's own back still goes home. */
  /** The code boxes on the co-sign step sit at the bottom of the page, and
   *  the inset alone left them half behind the keyboard (decided 2026-08-31,
   *  twice): when the keyboard opens on that step, scroll all the way down
   *  so the boxes sit right above it. */
  // Entering with a transaction that ALREADY holds every signature (a
  // resumed 2-of-2 from Pending) goes straight to the send screen: the key
  // list must never even flash, or a stray tap could collect an extra
  // signature or start a co-sign request nothing needs any more (decided
  // 2026-09-01). While the jump finalizes, only a spinner shows. Entry
  // only, so stepping BACK from the send screen still reaches the list.
  // Complete means the path in play is met AND the transaction opens it
  // (the leaf hazard): an everyday spend signed only by the device holding two keys
  // jumped straight into "Could not assemble the signatures".
  const [entryJumping, setEntryJumping] = useState<boolean>(() =>
    wallet ? signingProgress(wallet.descriptor, route.params.psbtBase64)?.complete === true : false,
  );
  useEffect(() => {
    if (!entryJumping) return;
    void (async () => {
      try {
        await retryFinalize();
      } finally {
        setEntryJumping(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Forward from the key list: a one-key vault never stops there. */
  const openSigning = useCallback(() => {
    if (!soloKey) {
      setPhase('choose');
      return;
    }
    setSelectedKey(soloKey.id);
    setPhase(phaseForKey(soloKey.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloKey]);
  /** Back from a device page: a one-key vault leaves, since the list it
   *  would return to is the page we skipped. */
  const backFromDevice = useCallback(() => {
    if (soloKey) navigation.goBack();
    else setPhase('choose');
  }, [soloKey, navigation]);
  const soloOpened = useRef(false);
  useEffect(() => {
    // Not before our fingerprints have settled: a solo key is judged on them.
    if (soloOpened.current || !fpsSettled || entryJumping || !soloKey || phase !== 'choose') return;
    if (soloKey.fp && sigStatus.signedFingerprints.includes(soloKey.fp)) return;
    soloOpened.current = true;
    openSigning();
  }, [fpsSettled, entryJumping, soloKey, phase, sigStatus.signedFingerprints, openSigning]);

  // The co-signing codes above the keyboard (reported 2026-10-18: "The
  // authenticator code request moves all the way up beyond the screen when
  // the key pad spaces are clicked"). The page used to scroll to its END on
  // every keyboard, and with the keyboard inset React Native left behind when
  // the authenticator step's footer arrived (hooks/keyboardInsets.ts) the end
  // lay a keyboard's height past the last line: the boxes went off the top.
  // Now the shared scroller lifts the code field, its Paste and its error
  // clear of the footer and the keys, and never takes the boxes off the top.
  // Every action of this page is in its footer, so nothing in the flow of the
  // page is a confirm to reveal. The co-signing request is the page's only
  // field; a dialog's keyboard elsewhere leaves the page where it is.
  const rootScrollRef = useRef<ScrollView | null>(null);
  const rootOffsetY = useRef(0);
  const { reveal } = useRevealFocusedField(rootScrollRef, rootOffsetY, phase === 'cosign', { confirmPinned: true });

  /** The pending list, with the vault beneath it — where a parked
   *  half-signed spend lives and can be resumed. */
  const goPending = useCallback(() => {
    landOverTab('VaultsTab', [
      { name: 'WalletDetail', params: { walletId: route.params.walletId } },
      { name: 'PendingCosign', params: { walletId: route.params.walletId } },
    ]);
  }, [route.params.walletId]);

  const goVault = useCallback(() => {
    landOverTab('VaultsTab', [
      { name: 'WalletDetail', params: { walletId: route.params.walletId } },
    ]);
  }, [route.params.walletId]);

  /** Next transaction of a separate-refresh queue: full ceremony reset. */
  const nextInQueue = () => {
    const next = queueIndex + 1;
    if (next >= queue.length) return;
    setQueueIndex(next);
    setWorkingPsbt(queue[next]);
    setCompleted(null);
    setRawTx(null);
    setTxid(null);
    setSelectedKey(null);
    setActiveLayer(null);
    setCosignWarning(null);
    soloOpened.current = false;
    openSigning();
  };

  /** How many coins of this refresh still have no ceremony behind them. */
  const queueLeft = queue.length > 0 ? queue.length - (queueIndex + 1) : 0;

  // The top-left back button steps ONE phase back (like the in-flow "Back"),
  // instead of leaving the whole ceremony. Exceptions: 'done' → Home (the tx is
  // already sent), and the first step ('choose') → let the screen leave.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      // The signed transaction is on its way to the network: leaving could no
      // longer stop it, so the screen stays until the network answers.
      if (phase === 'bluetooth' && feed.get()?.sending) {
        e.preventDefault();
        return;
      }
      if (phase === 'done') {
        e.preventDefault();
        landOverTab('VaultsTab');
        return;
      }
      if (phase === 'requested') {
        e.preventDefault();
        // Mid-refresh, back must not quietly bin the coins nobody has signed
        // yet: they live in this screen alone (decided 2026-09-18).
        if (queue.length > 0 && queueIndex + 1 < queue.length) {
          const left = queue.length - (queueIndex + 1);
          setDialog({
            title: 'Leave the rest of the refresh?',
            // "clock", the word every other screen uses for this state
            // (decided 2026-09-22).
            message: `${left} of your ${queue.length} coins have not been signed yet. Leaving now stops the refresh there, and those coins keep their current clocks.`,
            actions: [
              { label: 'Sign the next one', variant: 'primary', onPress: () => { setDialog(null); nextInQueue(); } },
              { label: 'Leave', variant: 'ghost', onPress: () => { setDialog(null); goVault(); } },
            ],
          });
          return;
        }
        goVault();
        return;
      }
      const target = backTarget(phase, soloKey != null);
      if (!target) {
        // 'choose' — with no signature yet, back returns to the transaction
        // the owner started, still editable. With one or more signatures,
        // the spend can no longer be modified and is already parked in
        // Pending (parkPartial runs on every accepted signature), so back
        // goes THERE: the place it can be resumed from (decided 2026-08-31).
        // Discarding is the Cancel button's job, never back's.
        if (sigStatus.signedFingerprints.length > 0) {
          e.preventDefault();
          goPending();
        }
        return;
      }
      e.preventDefault();
      setPhase(target);
    });
    return sub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, navigation, goVault, goPending, sigStatus.signedFingerprints.length, soloKey, queue, queueIndex]);

  /** The id `parkPartial` saves this spend under in Pending. Every hook sits
   *  above the early return below: one under it runs only once the vault and
   *  the PSBT are readable, and React throws on the render that adds it
   *  (signPsbtHooksOrder.test.ts). */
  const partialIdRef = useRef<string>(
    route.params.pendingCosignId ?? `partial-${route.params.walletId}-${Date.now()}`,
  );

  if (!wallet || !psbtBytes) {
    return (
      <Screen scroll underHeader>
        <Text style={styles.muted}>Could not read this PSBT.</Text>
      </Screen>
    );
  }

  const fail = (title: string, e: unknown) => setDialog({ title, message: plainFailure(e) });

  /** Warn ONCE before the first hardware signature on an unregistered
   *  multisig vault: the device will refuse a vault it doesn't know (found
   *  2026-07-27).
   *
   *  It asked a yes/no question and offered no way to say YES (decided 2026-07-29,
   *  after it fired on every send of a mainnet test). "Continue anyway" only
   *  set a ref that died with the screen, and the single persistent silencer —
   *  `vaultRegisteredAt` — is written ONLY at the end of the register wizard.
   *  A vault registered on the hardware BEFORE that flag existed, or one whose
   *  wizard was left by the "invite your heirs" exit, could never stop asking.
   *
   *  So: the second action now answers the question and PERSISTS it. Once per
   *  vault, ever — which is what the copy always implied. */
  const maybeWarnRegistration = (selectedKeyPending: string | null, proceed: () => void) => {
    // The owner of an imported vault already said its devices know it (decided
    // 2026-09-15): asking again at every send is the question they answered.
    if (!wallet || wallet.kind === 'single-sig' || wallet.vaultRegisteredAt || wallet.registrationAttestedAt) {
      proceed();
      return;
    }
    // Registration is per DEVICE, not per vault: a 2-of-3 whose first
    // device registered must still prompt for the second one. Skip the
    // warning only when THIS key's device has its own registration — in
    // EITHER brand's records: checking only the Ledger's made a registered
    // BitBox key warn again on the first send (decided 2026-09-01).
    if (selectedKeyPending != null && registeredFingerprintsOf(wallet).has(selectedKeyPending.toLowerCase())) {
      proceed();
      return;
    }
    setDialog({
      title: 'Is this vault on your hardware?',
      message:
        'Your device can only sign for a vault it knows. If you skipped that ' +
        'step, register it now. It takes a minute and you come right back here.',
      actions: [
        {
          label: 'Register vault on hardware',
          variant: 'primary',
          onPress: () => {
            setDialog(null);
            // The one registration screen, for every adopted device (decided
            // 2026-09-22); never a brand screen picked by a guess.
            navigation.navigate('RegisterHardware', {
              walletId: wallet.id,
              fingerprint: selectedKeyPending ?? undefined,
            });
          },
        },
        {
          // Answering YES is the point. Persisted, so it is asked once per
          // vault rather than once per screen. Wrong tap costs nothing
          // dangerous — the device simply refuses to sign — and "Register on
          // hardware" stays in the vault menu.
          label: 'Yes, the vault is registered',
          variant: 'ghost',
          onPress: () => {
            void updateWallet(wallet.id, { vaultRegisteredAt: Date.now() });
            setDialog(null);
            proceed();
          },
        },
      ],
    });
  };

  /** An UNLOCKED timelocked key was chosen. The on-screen PSBT was built for
   *  the primary path, which this key cannot sign — rebuild the same spend
   *  on this key's branch (the fork's policy_path; the rescue ceremony's
   *  plumbing) and continue the ceremony as usual (decided 2026-07-27). */
  const signViaUnlockedKey = async (fp: string) => {
    if (!wallet) return;
    // The MERGED set (vault tag + the live known-21C endpoint) — an
    // imported vault carries no tag, and routing 21C's rescue key into a
    // device ceremony would dead-end (decided 2026-08-26).
    if (providerFps.has(fp.toLowerCase())) {
      // 21C's rescue key never signs in this ceremony — rescue is its own
      // staff-guided protocol and moves ALL coins.
      setDialog({
        title: 'This is the rescue key',
        message:
          'This key is held by 21st Capital and only signs in a rescue. That ' +
          'is a staff-guided ceremony which moves all coins at once.',
        actions: [
          {
            label: 'Open Rescue',
            variant: 'primary',
            onPress: () => {
              setDialog(null);
              // Rescue opens over the ceremony, which is still there on Back.
              navigation.navigate('Rescue');
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setDialog(null) },
        ],
      });
      return;
    }
    // Already on this key's branch — carrying signatures or not, rebuilding
    // would DISCARD what the ceremony has collected and hand the device a
    // different transaction (decided 2026-08-26). Just continue.
    if (sigStatus.signatureCount > 0 || selectedKey?.toLowerCase() === fp.toLowerCase()) {
      maybeWarnRegistration(fp.toLowerCase(), () => {
        setSelectedKey(fp);
        setPhase(phaseForKey(fp));
      });
      return;
    }
    const rebuild = route.params.rebuild;
    if (!rebuild) {
      setDialog({
        title: 'Start this spend from Send',
        message:
          // The Spending policy's own name for that path (decided 2026-09-22).
          'This transaction was prepared for the vault’s primary path. Go back ' +
          'and start the send again, and Talia will build it for this key.',
      });
      return;
    }
    setBusy('Preparing for this key…');
    try {
      const engine = await getEngine(wallet);
      const built = await engine.buildPsbt({ ...rebuild, branchFingerprint: fp });
      setQueue([built.psbtBase64]);
      setQueueIndex(0);
      setWorkingPsbt(built.psbtBase64);
      maybeWarnRegistration(fp.toLowerCase(), () => {
        setSelectedKey(fp);
        setPhase(phaseForKey(fp));
      });
    } catch (e) {
      // The independent address check found the vault's addresses differ:
      // the rebuild pauses with Send, a title and a button (decided 2026-10-17).
      if (isSendPaused(e)) setDialog({ title: SEND_PAUSED_TITLE });
      else fail('Could not prepare the transaction for this key', e);
    } finally {
      setBusy(null);
    }
  };

  /** Signed PSBT arrived (QR or file) → combine + finalize via BDK. */
  /** Returns true when the ceremony ADVANCED (finalized, new signature, or
   *  parked while waiting) — false when nothing changed. The QR/file
   *  transports ignore the return; the Bluetooth flow uses it to land its
   *  retryable error state instead of an empty box. */
  const acceptSignedPsbt = async (
    bytes: Uint8Array,
    /** The Bluetooth ceremony sends a finished spend itself (design A): it
     *  takes the result here instead of the review page. */
    opts?: { onFinal?: (result: CompletedPsbt) => void },
  ): Promise<boolean> => {
    setBusy('Finalizing…');
    try {
      const engine = await getEngine(wallet);
      const result = await engine.completePsbt(encodeBase64(bytes), workingPsbt, {
        inputConfirmations: minInputConfs,
      });
      const before = sigStatus.signatureCount;
      const after = psbtSignatureStatus(result.psbtBase64).signatureCount;

      // Sign-only: the client signed their OWN key while WAITING for 21C. Save
      // the partial PSBT back to the pending record and stop — do NOT broadcast
      // (21C hasn't co-signed yet). They finish from the Pending screen later.
      if (route.params.signOnly) {
        if (after <= before && !result.finalized) {
          setDialog({
            title: 'No new signature',
            message:
              'The device sent it back without a signature. Check that it holds one of this vault’s keys and that you approved on it, then try again.',
          });
          return false;
        }
        if (route.params.pendingCosignId) {
          await updatePendingCosignPsbt(route.params.pendingCosignId, result.psbtBase64);
        }
        setWorkingPsbt(result.psbtBase64);
        setPhase('signedWaiting');
        return true;
      }

      if (result.finalized) {
        // The working copy must carry the FINAL signature too: stepping
        // back from the ready screen re-reads it, and it still showed one
        // key signed (decided 2026-09-01, same family as the pending count).
        setWorkingPsbt(result.psbtBase64);
        setCompleted(result);
        if (opts?.onFinal) opts.onFinal(result);
        else setPhase('ready');
        // The FINAL signature must reach the parked record too: pending
        // kept saying "1 of 2" after the second key signed because only
        // the below-threshold branch parked (decided 2026-09-01).
        void parkPartial(result.psbtBase64, after);
        return true;
      }
      // Not finalizable yet — a multisig needs more devices. Continue the
      // ceremony only if this round actually ADDED a signature.
      if (after > before) {
        setWorkingPsbt(result.psbtBase64);
        // Straight back to the key list: it already shows Signed/Waiting
        // per key, and a separate "Signature added" stop repeated it
        // word for word (decided 2026-08-31: "get rid of the second screen").
        setSelectedKey(null);
        setPhase('choose');
        // Parked immediately: the next key may be in another place, and the
        // work done so far must survive leaving this screen.
        void parkPartial(result.psbtBase64, after);
        return true;
      }
      setDialog({
        title: 'No new signature',
        message:
          'The device sent it back without a signature. Check that it holds one of this vault’s keys and that you approved on it, then try again.',
      });
      return false;
    } catch (e) {
      fail('Could not finalize', e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** The device finalized on its side and returned a raw transaction. */
  const acceptRawTx = (bytes: Uint8Array) => {
    // It must BE the transaction on this screen (decided
    // 2026-09-26): an older signed payment left on a card, or any other file, used
    // to be accepted here while the screen still named this one.
    if (!rawTxMatchesPsbt(bytes, workingPsbt, wallet?.network ?? 'bitcoin')) {
      setDialog({ title: 'This is a different transaction', message: '' });
      return;
    }
    setRawTx(bytes);
    setCompleted(null);
    setPhase('ready');
  };

  /**
   * Route a signer's output by CONTENT, never by declared type: the COLDCARD
   * returns a finalized TRANSACTION (BBQr `T`, or plain hex in a single QR)
   * for fully-signed spends, and a PSBT otherwise. Trusting labels here is
   * what produced the "Impossible to parse PSBT" failure (decided 2026-07-18).
   */
  const acceptSignedBytes = (bytes: Uint8Array) => {
    if (looksLikePsbt(bytes)) {
      void acceptSignedPsbt(bytes);
    } else if (looksLikeRawTx(bytes)) {
      acceptRawTx(bytes);
    } else {
      setDialog({
        title: 'Not a signed transaction',
        message:
          'That code held no signed transaction. On your device, finish signing and show the result QR.',
      });
    }
  };

  const onScan = (result: BbqrScanResult) => {
    setScanning(false);
    if (result.kind === 'bbqr') {
      acceptSignedBytes(result.bytes);
      return;
    }
    const bytes = decodeHexOrBase64(result.text);
    if (bytes) {
      acceptSignedBytes(bytes);
    } else {
      setDialog({
        title: 'Not a signed transaction',
        message: 'That QR held no transaction. On your device, finish signing and show the result QR.',
      });
    }
  };

  /**
   * Park a half-signed spend in Pending transactions (decided 2026-07-28).
   *
   * Only 21C co-sign requests used to be saved, so once a client signed with
   * one device they were trapped in the ceremony — their other key might be
   * in another place entirely. Every partially-signed PSBT is now saved, and
   * removed again when it broadcasts.
   */
  const parkPartial = async (psbtBase64: string, signatures: number) => {
    if (!wallet) return;
    try {
      // The count of the path this spend is on (the leaf hazard, decided 2026-10-17): its own
      // keys that signed, never the raw number of signatures, which counted a
      // device holding two of the vault's keys twice and parked an everyday
      // spend signed by ONE device as "2 of 2 · ready to send". A timelocked
      // layer the owner opened is that path; otherwise the path the
      // transaction is on (`signingProgress`).
      const layer = activeLayer != null ? (vaultPaths?.locked[activeLayer]?.path ?? null) : null;
      const progress = signingProgress(wallet.descriptor, psbtBase64, layer);
      // Finishing a REAL co-sign request? Update that record in place —-
      // stamping it as a device partial would strip its identity, hide it from
      // the co-sign banner and make it un-cancellable (decided 2026-07-28).
      if (route.params.pendingCosignId) {
        await updatePendingCosignPsbt(
          route.params.pendingCosignId,
          psbtBase64,
          progress?.signatures ?? signatures,
          progress?.needed,
        );
        return;
      }
      await savePendingCosign({
        id: partialIdRef.current,
        walletId: wallet.id,
        originalPsbt: psbtBase64,
        // The stable name for this spend, so a co-sign request for the SAME
        // payment merges with this record instead of appearing beside it.
        txid: unsignedTxid(psbtBase64) ?? undefined,
        amountSats: cosignAmountSats,
        // A cancel names where the payment comes back to, as its co-sign
        // request does, so Pending says "Back to this vault" beside it.
        destination: cosignOut?.address ?? (replaces?.kind === 'cancel' ? cosignDestination : ''),
        createdAt: Date.now(),
        awaiting: 'device',
        signatures: progress?.signatures ?? signatures,
        // The count of the path this spend is on: a timelocked layer the
        // owner opened needs its own number, not the primary path's
        // (decided 2026-09-22: a finished one-key heir spend read "1 of 2").
        signaturesNeeded:
          progress?.needed ??
          (activeLayer != null ? (vaultPaths?.locked[activeLayer]?.needed ?? vaultPaths?.threshold) : vaultPaths?.threshold),
      });
    } catch {
      // Best-effort: never block the ceremony on a storage hiccup.
    }
  };

  /**
   * Enough keys have signed but the witness would not assemble. Try again on
   * the CURRENT working copy (no combine) and, if it still fails, show why —
   * a dead end with no explanation was the worst part of a phone test's report.
   */
  const retryFinalize = async () => {
    // Hard pre-flight: never attempt this below threshold, and never let a
    // "missing signatures" refusal read as an assembly failure
    // (found in a phone test, 2026-07-28: a 3-of-3 reported four cryptic empty-witness lines
    // when the real answer was "two more keys must sign").
    if (inPlay && !thresholdMet) {
      // The path's own signers (the leaf hazard): a key that signed only another path
      // is still to sign here.
      const signed = new Set(inPlay.signers);
      const missing = inPlay.keys
        .filter((k) => !k.fingerprint || !signed.has(k.fingerprint.toLowerCase()))
        .map((k) => labelFor(k.fingerprint ?? k.xpub, k.fingerprint ?? null));
      setDialog({
        title: 'More signatures needed',
        message:
          `This spend needs ${inPlay.needed} signature${
            inPlay.needed === 1 ? '' : 's'
          } and has ${inPlay.signers.length}. Still to sign: ${missing.join(', ')}.`,
      });
      return;
    }
    setBusy('Finalizing…');
    try {
      const engine = await getEngine(wallet);
      const result = await engine.completePsbt(workingPsbt, workingPsbt, {
        inputConfirmations: minInputConfs,
      });
      if (result.finalized) {
        setCompleted(result);
        setPhase('ready');
        return;
      }
      // No count: the vault's threshold is the PRIMARY path's, and a
      // recovery spend is complete with its own path's keys, often fewer
      // (decided 2026-09-22: "All 2 signatures" over one heir signature).
      setDialog({
        title: 'Could not assemble the signatures',
        message:
          'Every signature this spend needs is present, but the transaction ' +
          'could not be completed. Nothing is ' +
          'lost. It is saved under Pending transactions. Please send us this ' +
          `detail:\n\nsigned: ${sigStatus.signedFingerprints
            .map((f) => f.toUpperCase())
            .join(', ')}\n` +
          (result.finalizeNotes?.map((n) => `• ${n}`).join('\n') ?? 'no diagnostic available'),
      });
    } catch (e) {
      fail('Could not finalize', e);
    } finally {
      setBusy(null);
    }
  };

  /** A Speed up or a Cancel that must not go out after all: the plain
   *  state, title and OK (house rule). A payment that now has a child, or
   *  one another version already replaced, lands on the original, whose
   *  card says why; a check that could not read is simply tried again. */
  const refuseReplacement = (verdict: Exclude<ReplacementSendVerdict, 'ok'>, oldTxid: string) => {
    if (verdict === 'unknown') {
      setDialog({ title: 'Could not send', message: '' });
      return;
    }
    setDialog({
      title: verdict === 'has-child' ? 'Cannot be sped up or cancelled' : 'Already replaced',
      message: '',
      actions: [
        {
          label: 'OK',
          variant: 'primary',
          onPress: () => {
            setDialog(null);
            landOverTab('VaultsTab', [
              { name: 'WalletDetail', params: { walletId: wallet.id } },
              { name: 'TxDetail', params: { walletId: wallet.id, txid: oldTxid } },
            ]);
          },
        },
      ],
    });
  };

  /** Send the finished transaction. `given` is the ceremony's own result,
   *  for a caller whose render predates it (the Bluetooth task). True once it
   *  went out and the Sent page is up. */
  const onBroadcast = async (feeConfirmed = false, given?: CompletedPsbt): Promise<boolean> => {
    const final = given ?? completed;
    // A fee out of all proportion is sent only on the client's word (decided
    // 2026-09-26): the build caps the rate, but this screen also sends
    // PSBTs it did not build a moment ago (parked, imported, returned).
    const absurdFee = feeConfirmed ? null : psbtAbsurdFee(workingPsbt);
    if (absurdFee != null) {
      setDialog({
        title: `The network fee is unusually high: ${formatSats(absurdFee)}`,
        message: '',
        actions: [
          { label: 'Send anyway', variant: 'primary', onPress: () => void onBroadcast(true, given) },
          { label: 'Cancel', variant: 'ghost', onPress: () => {} },
        ],
      });
      return false;
    }
    setBusy('Sending…');
    try {
      let engine = await getEngine(wallet);
      // A Speed up or a Cancel asks again right before it goes out (decided
      // 2026-09-28): the sheet's answer can be hours old on a co-signed
      // vault. Nothing waiting may now spend from the original (it would be
      // thrown away without a word), and no other version of the payment
      // may have gone out meanwhile (this one could undo it).
      const spentId = unsignedTxid(workingPsbt);
      const replacedTxid =
        replaces?.txid ??
        (spentId ? (await plannedReplacement(wallet.id, spentId).catch(() => null))?.oldTxid : undefined);
      if (replacedTxid) {
        try {
          engine = await withTimeout(syncWallet(wallet, { force: true }), 20_000, 'Sync');
        } catch {
          // offline: judged on what the phone has, as the sheet is
        }
        const verdict = await replacementSendCheck(engine, wallet.id, replacedTxid, spentId);
        if (verdict !== 'ok') {
          // A version that can never go out again leaves Pending too.
          if (verdict === 'already-replaced' && spentId) await withdrawPendingForTxids([spentId]);
          refuseReplacement(verdict, replacedTxid);
          return false;
        }
      }
      // A spend on a path with a wait assembles whatever the age of its
      // coins, and the network refuses it (decided 2026-10-07): say
      // when it can go instead, after asking the chain again.
      const wait = await sendTooEarly(engine, final ? final.psbtBase64 : rawTx!, wallet.network, () =>
        withTimeout(syncWallet(wallet, { force: true }), 20_000, 'Sync'),
      );
      if (wait != null) {
        setDialog({ title: tooEarlyTitle(wait), message: '' });
        return false;
      }
      // Through the vault's servers: a Bitcoin vault's one server, never
      // another in its place; a Testnet4 vault's next server only when one
      // could not be reached (wallet/chainServers.ts).
      const sending = engine;
      const id = await broadcastThroughChainServers(wallet.network, settings, (backend) =>
        final
          ? sending.broadcastPsbt(final.psbtBase64, backend)
          : sending.broadcastRawTx(rawTx!, backend, spentId ?? ''),
      );
      setTxid(id);
      // When it went out: a waiting transaction has no block time, and a
      // later Speed up names it by this ("The payment of 13:55").
      void saveSentAt(wallet.id, id);
      // A Speed up or a Cancel: Talia's own record, so the replaced
      // transaction still opens after the sync forgets it, and its note
      // moves across. The planned record covers a replacement resumed from
      // Pending transactions, the route's own covers this ceremony. Every
      // OTHER unsent version of the same payment leaves Pending before the
      // done page shows, so none can be sent over this one (decided
      // 2026-09-28). All of it local and quick, and none of it throws: never
      // in the way of "sent", the payment is already out.
      try {
        const { record: recorded, siblings } = await recordIfReplacement(wallet.id, id);
        let others = siblings;
        if (!recorded && replaces) {
          await saveTxReplacement({ ...replaces.record, newTxid: id.toLowerCase() }).catch(() => {});
          others = await dropSiblingPlans(wallet.id, replaces.txid, id);
        }
        if (others.length > 0) await withdrawPendingForTxids(others);
      } catch {
        // bookkeeping only: it went out
      }
      // A speed-up of a return leads with the payment its cancel cancelled
      // (decided 2026-09-28): `returnSats`, read from the records when the ceremony
      // opened, the figure its co-sign request carried too.
      setPhase('done');
      // If this ceremony finished a co-sign-first request, clear its pending
      // record (and mark it completed server-side) so it stops showing.
      // The parked partial (if any) is done with either way.
      void removePendingCosign(partialIdRef.current).catch(() => {});
      // Removing only the id that happened to do the sending is what left a
      // permanent "needs your next key" row for money that had already gone.
      // Clear every record for this spend, however it was named.
      if (spentId) void removePendingCosignsForTxid(spentId).catch(() => {});
      const pendingId = route.params.pendingCosignId;
      if (pendingId) {
        void (async () => {
          try {
            const session = await loadSession();
            if (session) await completeCosign(session, pendingId);
          } catch {
            // best-effort — the local record is still removed below
          }
          await removePendingCosign(pendingId);
        })();
      }
      // Pick the new pending tx up right away.
      void syncWallet(wallet, { force: true }).catch(() => {});
      return true;
    } catch (e) {
      // A replacement whose original confirmed while it was being signed or
      // co-signed: the plain state, never the server's words (decided 2026-09-28).
      const spentId = unsignedTxid(workingPsbt);
      const plan = replaces
        ? { kind: replaces.kind, oldTxid: replaces.txid }
        : spentId
          ? await plannedReplacement(wallet.id, spentId).catch(() => null)
          : null;
      const why = plan ? replacementBroadcastFailure(e) : 'other';
      if (plan && why === 'already-confirmed') {
        setDialog({
          title: plan.kind === 'cancel' ? 'The cancel came too late' : 'Already confirmed',
          message: '',
          actions: [
            {
              label: 'OK',
              variant: 'primary',
              onPress: () => {
                setDialog(null);
                landOverTab('VaultsTab', [
                  { name: 'WalletDetail', params: { walletId: wallet.id } },
                  { name: 'TxDetail', params: { walletId: wallet.id, txid: plan.oldTxid } },
                ]);
              },
            },
          ],
        });
      } else if (plan && why === 'fee-too-low') {
        setDialog({ title: 'The network wants a higher fee', message: '' });
      } else {
        const notReached = notReachedWords(e);
        if (notReached) setDialog({ title: notReached, message: '' });
        else fail('Could not send', e);
      }
      return false;
    } finally {
      setBusy(null);
    }
  };

  /**
   * What the Sent page reports, read off the transaction that went out: who
   * it paid outside the vault (BDK's isMine, the same answer the review rows
   * gave), what came back to the vault, and the fee. A cancel, and the
   * speed-up of one (a return), leads with the payment it cancels (decision
   * 5), a refresh with what it moved.
   */
  const sentKind: SentKind = replaces ? replaces.kind : refreshWording ? 'refresh' : 'payment';
  const sentFacts = (): SentFacts => ({
    kind: sentKind,
    isReturn: spedUpReturn,
    txids: txid ? [txid] : [],
    recipients: parsed
      ? parsed.outputs.filter((o) => !o.isOwn).map((o) => ({ address: o.address, amountSats: o.amountSats }))
      : null,
    movedSats: parsed ? parsed.outputs.filter((o) => o.isOwn).reduce((sum, o) => sum + o.amountSats, 0) : null,
    cancelledSats: replaces?.kind === 'cancel' ? replaces.amountSats : spedUpReturn ? returnSats : null,
    feeSats: parsed?.feeSats ?? null,
  });

  /** The courier's title on the travelling screens: the key being signed with. */
  const courierKeyName = selectedKey ? labelFor(selectedKey) : wallet.label;

  /**
   * The device's signed copy is back (design A, decided 2026-10-03). It is merged
   * as before; when it completes the spend, the ceremony sends it from right
   * here, the courier's bar holding near its end until the network answers,
   * and lands on the Sent page. A spend that needs another signature goes
   * back to the key list, one that waits for 21st Capital to its waiting
   * page, exactly as before. Whatever stops the send (a fee to confirm, a
   * replacement refused, the network) lands on the review page with its Send
   * button, under the dialog that says why. Leaving before the send started
   * sends nothing: the finished transaction then waits on the key list.
   */
  const finishFromDevice = async (bytes: Uint8Array, alive: () => boolean): Promise<void> => {
    const got: { final: CompletedPsbt | null } = { final: null };
    const advanced = await acceptSignedPsbt(bytes, {
      onFinal: (result) => {
        got.final = result;
      },
    });
    if (!advanced) {
      throw new Error('The signature could not be used. The message on screen says why.');
    }
    if (got.final == null || !alive()) return;
    feed.push({ type: 'sending' });
    const sent = await onBroadcast(false, got.final);
    if (!sent) setPhase('ready');
  };

  /** What this vault knows for a key: its record, a Ledger registration made
   *  before records were kept, or nothing. A single-sig vault knows its ONE
   *  device (decided 2026-09-08), by fingerprint or, for a bare key, by the key. */
  const recordFor = (fp: string | null): KeyDevice | null => {
    if (wallet == null || fp == null) return null;
    return isSingleSigVault(wallet) ? singleSigDevice(wallet) : deviceOfKey(wallet, fp);
  };
  /** A key row's second line (decided 2026-10-04: "Name of the key that the user
   *  chose as the main header and under that comes the model name +
   *  fingerprint with a '·' in between"): the recorded device, then the
   *  fingerprint; a key with no device recorded shows its fingerprint alone. */
  const signLine = (fp: string): string => {
    const rec = recordFor(fp);
    if (rec == null) return fp.toUpperCase();
    return keyRowSub({ model: modelOfRecord(rec), kind: rec.kind, id: fp });
  };
  /** The key picked, as the hardware step meets it: its name and record. */
  const stepKeyFor = (fp: string | null): StepKey[] => (wallet == null || fp == null ? [] : [{ id: fp, name: labelFor(fp), record: recordFor(fp) }]);
  /** The models that can sign THIS vault, from the registry (a Passport only
   *  where the vault's script is standard). */
  const signingModels = wallet
    ? modelsFor(vaultShapeOf(wallet), 'sign', { descriptor: wallet.descriptor, hardwareSurface: HWW_ENABLED || SIGNING_ENABLED })
    : [];
  /** A key the vault KNOWS lives on a device goes straight to that device's
   *  ceremony, drawn unlocking while the search runs (decided 2026-08-26: "we
   *  know that bluetooth is the only option"; 2026-10-04: "if we know the
   *  device that the user is already using we will directly try to connect
   *  to that KNOWN device"). A key with NO recorded model, a real heir's
   *  living in another household or a Ledger kept as a bare brand, is asked
   *  which device, once: the first connection records the model. The
   *  ferries (a code, a file) sit behind "Another device" on that question. */
  const phaseForKey = (fp: string | null): Phase => {
    if (wallet == null || fp == null) return 'method';
    const step = keyStep(stepKeyFor(fp), signingModels);
    if (step.kind !== 'connect') return 'method';
    return step.model === 'passport' ? 'passport' : 'bluetooth';
  };
  const chooseDevice = (m: DeviceModel) => {
    setPicked(m);
    setPhase(m === 'passport' ? 'passport' : 'bluetooth');
  };
  const chooseMethod = (id: (typeof METHODS)[number]['id']) => {
    setPhase(id === 'camera' ? 'qr' : 'file');
  };

  /** Signed PSBT / transaction FILE from the device (SD card, AirDrop…). */
  const onImportSignedFile = async () => {
    try {
      const file = await pickBinaryFile();
      if (!file) return;
      const bytes = decodeBase64(file.base64);
      if (bytes && (looksLikePsbt(bytes) || looksLikeRawTx(bytes))) {
        acceptSignedBytes(bytes);
        return;
      }
      // Some tools write TEXT files holding base64 or hex instead of raw bytes.
      if (bytes) {
        let text = '';
        for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
        const inner = decodeHexOrBase64(text.trim());
        if (inner && (looksLikePsbt(inner) || looksLikeRawTx(inner))) {
          acceptSignedBytes(inner);
          return;
        }
      }
      setDialog({
        title: 'Not a signed transaction',
        message:
          'That file held no signed transaction. Sign the exported file on your device, then pick the signed file it writes.',
      });
    } catch (e) {
      fail('Import failed', e);
    }
  };

  // The Bluetooth step's actions sit in the page's pinned footer (decided
  // 2026-10-05): the step's ONE Back under the lists, the search and the
  // device's turn pages (the step decides where it goes and hands it here),
  // the courier's own buttons once the transaction is on its way (the hook's,
  // null while the client's turn leaves nothing to tap). The content keeps
  // FOOTER_ROOM clear so its last line scrolls past the footer's fade.
  const footed = phase === 'bluetooth' && wallet != null;
  const courierFoot = footed ? signing.footer(backFromDevice) : null;

  /**
   * Every other step's actions, pinned at the foot the same way (decided
   * 2026-10-05) and computed from the step OUTSIDE the transition, so the
   * footer never slides with the step: the primary first, a second choice
   * under it, Back/Cancel last. Null where the step has nothing to tap (a key
   * list with nothing decided yet; the Sent page brings its own foot). The
   * co-sign panel tells this page its step's actions.
   */
  const stepFooter = ((): React.ReactNode => {
    if (footed) return null;
    switch (phase) {
      case 'choose': {
        if (entryJumping) return null;
        // Back to the whole key list from a layer's, before anything is signed.
        const layerOpen = fpsSettled && activeLayer != null && !!vaultPaths?.locked[activeLayer] && sigStatus.signatureCount === 0;
        const cancel = sigStatus.signedFingerprints.length > 0 && !thresholdMet;
        if (!thresholdMet && !layerOpen && !cancel) return null;
        return (
          <>
            {thresholdMet && <Button title="Complete and send" onPress={() => void retryFinalize()} loading={!!busy} />}
            {layerOpen && <Button title="Back to all keys" variant="ghost" onPress={() => setActiveLayer(null)} />}
            {cancel && <Button title="Cancel" variant="ghost" onPress={() => setConfirmCancel(true)} />}
          </>
        );
      }
      case 'method':
        // One Back (decided 2026-10-05): out of the ferries to the device list
        // first, then to the key list.
        return selectedKey != null ? <Button title="Back" variant="ghost" onPress={ferries ? () => setFerries(false) : backFromDevice} /> : null;
      case 'cosign':
        return selectedKey && cosignActions != null ? <CosignRequestFooterButtons actions={cosignActions} /> : null;
      case 'file':
        return (
          <>
            <Button
              title="Export unsigned PSBT"
              onPress={() => {
                const exp = makePsbtExport(workingPsbt, wallet.label);
                void exportPsbtToFile(exp.filename, exp.base64).catch(() => {});
              }}
            />
            <Button title="Import the signed file" variant="ghost" onPress={() => void onImportSignedFile()} />
            <Button title="Back" variant="ghost" onPress={() => setPhase('method')} />
          </>
        );
      case 'qr':
        return (
          <>
            <Button title="Scan the signed result" onPress={() => setScanning(true)} />
            <Button title="Back" variant="ghost" onPress={() => setPhase('method')} />
          </>
        );
      case 'passport':
        return (
          <>
            <Button title="Scan the signed result" onPress={() => setScanning(true)} />
            <Button title="Back" variant="ghost" onPress={backFromDevice} />
          </>
        );
      case 'ready':
        return (
          <>
            <Button
              title={
                replaces?.kind === 'cancel'
                  ? 'Send the cancel'
                  : replaces?.kind === 'speedup'
                    ? 'Send the speed-up'
                    : refreshWording
                      ? 'Refresh these coins'
                      : 'Send transaction'
              }
              onPress={() => void onBroadcast()}
              loading={busy === 'Sending…'}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setConfirmCancel(true)} />
          </>
        );
      case 'requested':
        if (cosignRejected != null) {
          return (
            <>
              <Button title="View pending transactions" onPress={() => navigation.navigate('PendingCosign', { walletId: wallet.id })} />
              <Button title="Return to vault" variant="ghost" onPress={goVault} />
            </>
          );
        }
        // A refresh does NOT end here (decided 2026-09-18): the next coin first.
        return queueLeft > 0 ? (
          <>
            <Button title="Sign the next transaction" onPress={nextInQueue} />
            <Button title="Stop here" variant="ghost" onPress={goVault} />
          </>
        ) : (
          <>
            <Button title="Return to vault" onPress={goVault} />
            <Button title="View pending transactions" variant="ghost" onPress={() => navigation.navigate('PendingCosign', { walletId: wallet.id })} />
          </>
        );
      case 'signedWaiting':
        return queueLeft > 0 ? (
          <>
            <Button title="Sign the next transaction" onPress={nextInQueue} />
            <Button title="Stop here" variant="ghost" onPress={() => navigation.navigate('PendingCosign', { walletId: wallet.id })} />
          </>
        ) : (
          <Button title="Back to pending" onPress={() => navigation.navigate('PendingCosign', { walletId: wallet.id })} />
        );
      default:
        // 'bluetooth' is footed above; the Sent page ('done') has its own foot.
        return null;
    }
  })();

  return (
    <View style={styles.frame}>
    <ScrollView
      ref={rootScrollRef}
      // With a footer its own rise shortens the scroll area by the keyboard
      // (the co-sign codes); an inset on top of that would leave a keyboard's
      // worth of blank under the last row. The emailed code has no footer and
      // the authenticator code under it has Back: the inset React Native kept
      // when that footer arrived with the keys up was what took the boxes off
      // the top (decided 2026-10-18), and the footer's arrival now takes it back.
      {...keyboardInsets(footed || stepFooter != null)}
      onScroll={(e) => {
        rootOffsetY.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={32}
      // An error under the code, or a step that grows, after the keys came up.
      onContentSizeChange={reveal}
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        // The safe area is the content's floor until a footer takes it.
        { paddingBottom: insets.bottom + theme.spacing.lg },
        phase === 'done' && styles.contentFill,
        // Above a pinned footer the content ends at the footer's fade: the
        // Bluetooth step's (the courier's) and every other step's alike.
        footed && styles.contentFooted,
        stepFooter != null && styles.contentFooted,
      ]}
      keyboardShouldPersistTaps="handled">
      <StepTransition
        stepKey={phase}
        order={PHASE_ORDER}
        style={[styles.stepWrap, phase === 'done' && styles.stepFill]}>
      {phase === 'choose' && entryJumping && (
        <Text style={styles.sub}>Every signature is in. Preparing to send\u2026</Text>
      )}
      {phase === 'choose' && !entryJumping && (
        <>
          {queue.length > 1 && (
            <Text style={styles.kicker}>
              Transaction {queueIndex + 1} of {queue.length}
            </Text>
          )}
          {/* "the next key", never "your next device" (decided 2026-09-22):
              on an heir's phone the key still to sign is the owner's, and
              when it is 21st Capital's it is no device at all. */}
          <InfoHeading
            style={styles.title}
            title="How signing works"
            text="Talia never holds your keys. It passes the transaction to your device, the device signs it, and Talia sends it on. In a vault with several keys, each one signs in its own turn.">
            {sigStatus.signatureCount === 0 && !finalCopy
              ? 'Sign with your device'
              : thresholdMet
                ? 'Enough signatures collected'
                : 'Sign with the next key'}
          </InfoHeading>
          <Text style={styles.sub}>
            {sigStatus.signatureCount === 0 && !finalCopy
              ? 'Pick the key you want to sign with.'
              : thresholdMet
                ? // Decided 2026-07-28: never imply another key is needed once the
                  // vault's threshold is met — a 2-of-3 signed by two keys is
                  // complete, whatever the co-signer row might suggest.
                  // No "of N" (decided 2026-09-22): the vault's threshold is
                  // the PRIMARY path's, and a one-key recovery spend read
                  // "1 of 2 signatures. This vault needs no more."
                  `${shownSignatures} signature${
                    shownSignatures === 1 ? '' : 's'
                  }. This spend needs no more.`
                : signedOffPath
                  ? 'The keys that signed cannot complete this spend.'
                  : // A signature that counts for no key of this path (a
                    // device that signed its key on another path) is no
                    // progress here, so no "0 signatures so far".
                    `${
                      shownSignatures > 0
                        ? `${shownSignatures} signature${shownSignatures === 1 ? '' : 's'} so far. `
                        : ''
                    }${nextIs21C ? '21st Capital signs next.' : 'Pick which key signs next.'}`}
          </Text>
          {parsed && (
            <Card style={styles.card}>
              {replaces?.kind === 'cancel' ? (
                // A cancel pays everything back to this vault: it names the
                // payment it cancels, never "Refresh" (decided 2026-09-28).
                <View style={styles.row}>
                  <Text style={styles.label}>Cancels</Text>
                  <Text style={styles.value}>
                    {`The payment of ${formatAmount(replaces.amountSats, settings.unit)}`}
                  </Text>
                </View>
              ) : replaces != null && parsed.outputs.every((o) => o.isOwn) ? null : parsed.outputs.every((o) => o.isOwn) ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Refresh</Text>
                  <Text style={styles.value}>
                    {parsed.numInputs} coin{parsed.numInputs === 1 ? '' : 's'} → fresh addresses
                  </Text>
                </View>
              ) : (
                parsed.outputs
                  .filter((o) => !o.isOwn)
                  .map((o, i) => (
                    <FactRow
                      key={i}
                      label="To"
                      mono
                      value={`${o.address ? `${o.address.slice(0, 12)}…${o.address.slice(-6)}` : 'unrecognised destination'} · ${formatAmount(o.amountSats, settings.unit)}`}
                    />
                  ))
              )}
              {parsed.feeSats != null && (
                <View style={styles.row}>
                  <Text style={styles.label}>Network fee</Text>
                  <Text style={styles.value}>
                    {replaces && replaces.oldFeeSats > 0
                      ? `${formatSats(parsed.feeSats)}, was ${formatSats(replaces.oldFeeSats)}`
                      : formatSats(parsed.feeSats)}
                  </Text>
                </View>
              )}
              {replaces?.kind === 'speedup' && replacesLine != null && (
                <View style={styles.row}>
                  <Text style={styles.label}>Replaces</Text>
                  <Text style={styles.value}>{replacesLine}</Text>
                </View>
              )}
            </Card>
          )}
          {/* The rows wait for 21st Capital's fingerprints (decided 2026-10-04),
              in the words the other hardware screens use. */}
          {!fpsSettled && <Text style={styles.sub}>Reading this vault&apos;s keys…</Text>}
          {fpsSettled && activeLayer != null && vaultPaths?.locked[activeLayer] && (
            <>
              <Text style={styles.kicker}>
                {layerName(vaultPaths.locked[activeLayer]).toUpperCase()}
              </Text>
              <Text style={styles.sub}>
                {`This layer spends on its own: ${
                  vaultPaths.locked[activeLayer].keys.length === 1
                    ? 'its key alone signs'
                    : `any ${vaultPaths.locked[activeLayer].needed} of its ${vaultPaths.locked[activeLayer].keys.length} keys sign`
                }.`}
              </Text>
              {vaultPaths.locked[activeLayer].keys.map(({ id, fp }) => {
                const signed = fp != null && sigStatus.signedFingerprints.includes(fp);
                return (
                  <TouchableOpacity
                    key={`layer-${id}`}
                    style={styles.deviceRow}
                    activeOpacity={0.85}
                    disabled={signed || !fp}
                    onPress={() => void signViaUnlockedKey(fp!)}>
                    <Gloss radius={theme.radius.lg} strength={cardGlow()} />
                    {/* The key's recorded device, as the device list draws it
                        (decided 2026-10-04); our keys keep the key. A key that has
                        signed is said in colour, never by dimming its row. */}
                    <KeyDeviceTile record={fp != null && providerFps.has(fp.toLowerCase()) ? null : recordFor(fp ?? null)} color={signed ? theme.colors.accent : undefined} />
                    <View style={styles.deviceBody}>
                      <Text style={[styles.deviceName, signed && styles.rowTextOff]}>{labelFor(id, fp)}</Text>
                      <Text style={[styles.deviceHow, signed && styles.rowTextOff]}>
                        {fp ? signLine(fp) : 'This layer\u2019s key'}
                      </Text>
                    </View>
                    {signed ? (
                      <Text style={styles.signerStateOn}>Signed</Text>
                    ) : (
                      <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
          {fpsSettled && activeLayer == null && (vaultPaths?.keys ?? []).map(({ id, fp }) => {
            const signed = fp != null && sigStatus.signedFingerprints.includes(fp);
            const isCoSigner = fp != null && providerFps.has(fp.toLowerCase());
            return (
              <TouchableOpacity
                key={id}
                style={styles.deviceRow}
                activeOpacity={0.85}
                disabled={signed}
                onPress={() => {
                  // 21C co-signs only AFTER the client's own signature — it
                  // proves the request really comes from them (decided 2026-07-23).
                  if (isCoSigner && !clientHasSigned) {
                    setDialog({
                      title: 'Sign with your own key first',
                      message:
                        'Sign with your own device first. Your signature is what proves the request really comes from you.',
                    });
                    return;
                  }
                  if (isCoSigner) {
                    setSelectedKey(id);
                    setPhase('cosign');
                    return;
                  }
                  maybeWarnRegistration(fp?.toLowerCase() ?? null, () => {
                    setSelectedKey(id);
                    setPhase(phaseForKey(id));
                  });
                }}>
                {/* The device the vault knows for this key, in the tile the
                    device list draws (decided 2026-10-04: "why not use the same
                    icons during the signing ceremony instead of a bare key
                    icon"); the co-signer cannot have one and keeps the key. */}
                <KeyDeviceTile record={isCoSigner ? null : recordFor(fp ?? id)} color={signed ? theme.colors.accent : undefined} />
                <View style={styles.deviceBody}>
                  <Text style={[styles.deviceName, signed && styles.rowTextOff]}>{labelFor(id, fp)}</Text>
                  <Text style={[styles.deviceHow, signed && styles.rowTextOff]}>
                    {isCoSigner
                      ? clientHasSigned
                        ? '21st Capital · request online'
                        : '21st Capital · sign your own key first'
                      : fp
                        ? signLine(fp)
                        : 'This vault’s key'}
                  </Text>
                </View>
                {signed ? (
                  <Text style={styles.signerStateOn}>Signed</Text>
                ) : (
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                )}
              </TouchableOpacity>
            );
          })}
          {/* A Speed up or a Cancel replaces an everyday payment and is
              signed on the everyday path alone (decided 2026-09-28): no layer. */}
          {fpsSettled && activeLayer == null && !replaces && (vaultPaths?.locked ?? []).length > 0 && (
            <Text style={styles.kicker}>TIMELOCKED LAYERS</Text>
          )}
          {fpsSettled && activeLayer == null && !replaces && (vaultPaths?.locked ?? []).map((layer, li) => {
            const left = lockCountdowns[layer.olderBlocks];
            const unlocked = left != null && left <= 0;
            // The notice's words for the same state (decided 2026-09-22).
            const state =
              left == null
                ? `Opens after ${formatBlocksDuration(layer.olderBlocks)}`
                : left <= 0
                  ? 'Open. Tap to use this path.'
                  : `Opens for these coins in \u2248 ${formatBlocksDuration(left)}`;
            return (
              <TouchableOpacity
                key={`layer-${layer.olderBlocks}-${li}`}
                style={styles.deviceRow}
                activeOpacity={0.85}
                disabled={!unlocked}
                onPress={() => setActiveLayer(li)}>
                <Gloss radius={theme.radius.lg} strength={cardGlow()} />
                {/* A layer still locked is said in colour (faint text, the
                    lock), never by dimming its row. */}
                {unlocked ? (
                  <ClockIcon size={26} color={theme.colors.accent} />
                ) : (
                  <LockIcon size={26} color={theme.colors.faint} />
                )}
                <View style={styles.deviceBody}>
                  <Text style={[styles.deviceName, !unlocked && styles.rowTextOff]}>
                    {layerName(layer)}
                  </Text>
                  <Text style={[styles.deviceHow, !unlocked && styles.rowTextOff]}>
                    {layer.keys.length === 1
                      ? `Signs with ${labelFor(layer.keys[0].id, layer.keys[0].fp)} alone`
                      : `Any ${layer.needed} of ${layer.keys.length} keys sign`}
                  </Text>
                  <Text style={unlocked ? styles.unlockState : styles.lockState}>{state}</Text>
                </View>
                {unlocked && (
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                )}
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {phase === 'method' && selectedKey != null && (
        <>
          <Text style={styles.title}>{labelFor(selectedKey)}</Text>
          {/* Which device (decided 2026-10-04, device first): the models that can
              sign this vault, as a list of brands then models; a bare Ledger asks
              among the Ledgers. The pick steers the drawing alone: the
              search still finds every adopted device, and the one found
              proves it holds THIS key and is recorded then. "Another
              device" holds the ferries, for the heir who lives elsewhere. */}
          {!ferries ? (
            <DevicePicker
              models={((step) => (step.kind === 'ask' ? step.models : signingModels))(keyStep(stepKeyFor(selectedKey), signingModels))}
              question="Which device are you using?"
              onPick={chooseDevice}
              another={selectedKey.length === 8 ? () => setFerries(true) : undefined}
            />
          ) : (
            <>
              <Text style={styles.sub}>How should the transaction reach this device?</Text>
              {METHODS.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.deviceRow}
                  activeOpacity={0.85}
                  onPress={() => void chooseMethod(m.id)}>
                  <Gloss radius={theme.radius.lg} strength={cardGlow()} />
                  <m.Icon size={26} strokeWidth={1.7} color={theme.colors.offWhite} />
                  <View style={styles.deviceBody}>
                    <Text style={styles.deviceName}>{m.name}</Text>
                    <Text style={styles.deviceHow}>{m.how}</Text>
                  </View>
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </>
      )}

      {phase === 'cosign' && selectedKey && (
        <CosignRequestPanel
          walletId={wallet.id}
          psbt={workingPsbt}
          cosignFingerprint={selectedKey}
          amountSats={cosignAmountSats}
          destination={cosignDestination}
          isRefresh={!cosignOut && !!cosignDestination}
          // A sped-up return reads as the cancel it is: its amount is the
          // cancelled payment's, never "Refresh to" beside it.
          destinationLabel={replaces?.kind === 'cancel' || spedUpReturn ? 'Back to this vault' : undefined}
          onRequested={(warning, rejected) => {
            setCosignWarning(warning ?? null);
            setCosignRejected(rejected ?? null);
            setPhase('requested');
          }}
          onBack={() => setPhase('choose')}
          onActions={setCosignActions}
        />
      )}

      {phase === 'bluetooth' && wallet != null && (
        <>
          {/* Once the transaction is on its way the courier draws the whole
              page (design A, decided 2026-10-03): its own title; its buttons are
              the footer's. */}
          {signing.courier == null && turn == null && (
            <>
              <Text style={styles.title}>
                {selectedKey ? labelFor(selectedKey) : 'Sign over Bluetooth'}
              </Text>
              <Text style={styles.sub}>
                Check the amount and address on your device, then approve there.
              </Text>
            </>
          )}
          {/* The device this key is recorded on, or the one just picked,
              drawn turning on and unlocking while the search runs (decided
              2026-10-04); the search still finds EVERY adopted device (decided
              2026-09-22), and each brand's own signing ceremony runs once
              its device answers. */}
          <HardwareConnect
            key={selectedKey ?? 'none'}
            shape={vaultShapeOf(wallet)}
            purpose="sign"
            network={wallet.network}
            descriptor={wallet.descriptor}
            keys={stepKeyFor(selectedKey)}
            model={picked}
            question="Which device are you using?"
            locked={signing.courier != null}
            // The step decides the one Back: to the device list, else the
            // key list; this page's footer draws it, never the step.
            onBack={backFromDevice}
            onFooterBack={setStepBack}
            onTurn={setTurn}
            ceremony={signing.ceremony}
            ledgerTask={async (ctx) => {
              // The wrong Ledger of a household must fail by NAME, never
              // with a misleading "register this vault first".
              // The device must hold the key the owner PICKED — a vault-wide
              // check passes the other Ledger of a multisig and then fails
              // obscurely at signing (decided 2026-08-26).
              // A bare-key single-sig names its key by the key itself, not
              // a fingerprint: nothing to compare a device's fingerprint to.
              const keyedByFp = selectedKey != null && selectedKey.length === 8;
              if (keyedByFp && ctx.deviceFingerprint !== selectedKey.toLowerCase()) {
                throw new Error(
                  `This Ledger holds a different key (${ctx.deviceFingerprint.toUpperCase()}). Connect the one holding ${selectedKey.toUpperCase()}. If it uses a passphrase, use the same passphrase.`,
                );
              }
              // The key was picked from THIS vault's list and the check above
              // proved the device holds it. A vault that never recorded which
              // device holds that key (an imported vault its owner says is
              // registered, found in a phone test 2026-09-15: "it even doesnt offer bluetooth as
              // an option") learns it here instead of refusing.
              const patch: Partial<Pick<WalletMeta, 'keyDevices' | 'ledgerRegistrations'>> = {};
              // The model is kept too, and learnt when the record never had it,
              // so the next search draws this Ledger unlocking (decided 2026-10-04).
              const ledgerRec = keyedByFp
                ? recordFromDiscovery(recordedDevice(wallet, ctx.deviceFingerprint), ledgerDevice(ctx).record)
                : null;
              if (ledgerRec) {
                patch.keyDevices = { ...(wallet.keyDevices ?? {}), [ctx.deviceFingerprint]: ledgerRec };
              }
              // The vault is new to THIS phone, not to the Ledger: the device
              // shows it once and hands back the record signing needs, the same
              // ceremony as the setup screen. A plain one-key vault needs none.
              // Through the one device layer (2026-10-04), so the moment the
              // Ledger asks for the vault's approval reaches the flow from one
              // place. A blocked descriptor is left for ledgerWalletSpecFor to
              // refuse below, as before.
              let registration = wallet.ledgerRegistrations?.[ctx.deviceFingerprint];
              if (!registration && ledgerPolicyBlocker(wallet.descriptor) == null) {
                const reg = await ledgerDevice(ctx).registerVault(wallet);
                if (!ctx.alive()) return;
                registration = reg.patch.ledgerRegistrations?.[ctx.deviceFingerprint];
                if (reg.patch.ledgerRegistrations) patch.ledgerRegistrations = reg.patch.ledgerRegistrations;
              }
              if (Object.keys(patch).length > 0) void updateWallet(wallet.id, patch);
              const spec = ledgerWalletSpecFor(wallet.descriptor, wallet.label, registration);
              if ('blocker' in spec) throw new Error(spec.blocker);
              // The courier (design A, decided 2026-10-03), through the one hook:
              // the transaction on its way, the client's turn, the signed copy
              // back and held a beat, then sent from right here when it
              // completes the spend. Locked, the wrong app, the wrong device
              // and the registration were all settled above, on the flow's
              // own pages.
              await signing.signOnLedger(
                ctx,
                spec.spec,
                { psbt: workingPsbtRef.current, parsed, keyName: courierKeyName },
                (signed) => finishFromDevice(signed.bytes, ctx.alive),
              );
            }}
            bitboxTask={async (ctx) => {
              // The wrong device must fail BY NAME, never with a misleading
              // "register this vault first" — the same rule the Ledger
              // ceremony learned on 2026-08-26.
              const keyedByFp = selectedKey != null && selectedKey.length === 8;
              if (keyedByFp && ctx.fingerprint !== selectedKey.toLowerCase()) {
                throw new Error(
                  `This BitBox holds a different key (${ctx.fingerprint.toUpperCase()}). Connect the one holding ${selectedKey.toUpperCase()}.`,
                );
              }
              // Picked from THIS vault's list and just proved on the device: a
              // vault that did not know which device holds the key learns it
              // (decided 2026-09-15). Registration, if the device lacks it, follows.
              const bitboxRec = keyedByFp
                ? recordFromDiscovery(recordedDevice(wallet, ctx.fingerprint), bitboxDevice(ctx).record)
                : null;
              if (bitboxRec) {
                void updateWallet(wallet.id, {
                  keyDevices: { ...(wallet.keyDevices ?? {}), [ctx.fingerprint]: bitboxRec },
                });
              }
              const blocker = bitboxPolicyBlocker(wallet.descriptor);
              if (blocker) throw new Error(blocker);
              // Registration is idempotent to check and the device keeps it
              // on itself; a vault that skipped the setup screen registers
              // right here, with the approval on the device, through the one
              // device layer (2026-10-04), so the moment it asks reaches the
              // flow from one place. What the device then signs with (the
              // registered policy, its own account, the name it STORED,
              // never today's label) is read off that answer in one place
              // for every screen (`bitboxSigningSpec`).
              const reg = await bitboxDevice(ctx).registerVault(wallet);
              if (!ctx.alive()) return;
              const bitboxSpec = bitboxSigningSpec(wallet, ctx.fingerprint, reg);
              // Remember that the ceremony happened, so the setup screen's
              // badge speaks the truth (keyDevices only says where the key
              // lives; a review caught the conflation).
              if (!reg.standard && !reg.alreadyRegistered) void updateWallet(wallet.id, reg.patch);
              // The courier, BitBox style, through the one hook: the hand-over
              // beat, the client's turn until the one signing call answers,
              // the signed copy held a beat, then sent from right here when
              // it completes the spend.
              await signing.signOnBitbox(
                ctx,
                bitboxSpec,
                { psbt: workingPsbtRef.current, parsed, keyName: courierKeyName },
                (signed) => finishFromDevice(signed.bytes, ctx.alive),
              );
            }}
          />
        </>
      )}


      {phase === 'file' && (
        <>
          <Text style={styles.title}>
            {selectedKey ? labelFor(selectedKey) : 'Sign by file'}
          </Text>
          <Text style={styles.sub}>
            Export the file, sign it on your device, then import the signed file.
          </Text>
        </>
      )}

      {phase === 'qr' && (
        <>
          <Text style={styles.title}>{selectedKey ? labelFor(selectedKey) : 'Scan to sign'}</Text>
          <Text style={styles.sub}>
            Scan this code on your device, approve there, then show its result QR
            to this phone.
          </Text>
          <AnimatedQr frames={qrFrames} />
        </>
      )}

      {phase === 'passport' && (
        <>
          <Text style={styles.title}>{selectedKey ? labelFor(selectedKey) : 'Sign with your Passport'}</Text>
          <Text style={styles.sub}>
            On the Passport choose Sign with QR and scan this code. Approve there, then
            show its result to this phone.
          </Text>
          <AnimatedQr frames={urFrames} />
        </>
      )}

      {phase === 'ready' && (
        <>
          <Text style={styles.title}>
            {refreshWording ? 'Signed and ready to refresh' : 'Signed and ready'}
          </Text>
          <SpendReview
            vaultLabel={wallet.label}
            signaturesLine={`${shownSignatures} of ${activeRequirement?.totalKeys ?? shownSignatures} keys, complete`}
            feeSats={parsed?.feeSats ?? null}
            outputs={(parsed?.outputs ?? [])
              .filter((o) => !o.isOwn)
              .map((o) => ({
                address: o.address ?? null,
                amountLine: formatAmount(o.amountSats, settings.unit),
                amountSats: o.amountSats,
              }))}
            refreshNote={
              replaces?.kind === 'cancel'
                ? 'The coins of the payment come back to this vault.'
                : 'Every coin returns to this vault at fresh addresses.'
            }
          />
        </>
      )}

      {phase === 'requested' && cosignRejected != null && (
        <>
          <View style={styles.doneHead}>
            <DrawnIcon kind="cross" size={30} strokeWidth={5} />
            <Text style={styles.title}>Request rejected</Text>
          </View>
          <Text style={styles.sub}>{cosignRejected}</Text>
          {cosignWarning != null && <Text style={styles.sub}>{cosignWarning}</Text>}
        </>
      )}

      {phase === 'requested' && cosignRejected == null && (
        <>
          <View style={styles.doneHead}>
            <DrawnIcon kind="tick" size={30} strokeWidth={5} />
            <Text style={styles.title}>Request sent</Text>
          </View>
          {cosignWarning != null && <Text style={styles.sub}>{cosignWarning}</Text>}
          <Text style={styles.sub}>
            21st Capital co-signs next and emails you. You then send it from{' '}
            <Text style={styles.strongText}>Pending transactions</Text> in the vault.
          </Text>
          {/* A refresh does NOT end here (decided 2026-09-18: "the user should
              never get stuck on 1 transaction if he selected to refresh
              all"). This screen used to offer only the two ways out, and the
              remaining coins lived in this screen's memory alone, so leaving
              threw them away without saying so. */}
          {queueLeft > 0 && (
            <Text style={styles.sub}>
              {`Coin ${queueIndex + 1} of ${queue.length} is with 21st Capital. ` +
                `${queueLeft} still to sign.`}
            </Text>
          )}
        </>
      )}

      {phase === 'signedWaiting' && (
        <>
          <Text style={styles.title}>Signed and waiting for 21st Capital</Text>
          <Text style={styles.sub}>
            Your signature is saved. Send it from Pending transactions once 21st
            Capital has co-signed.
          </Text>
          {queueLeft > 0 && (
            <Text style={styles.sub}>
              {`Coin ${queueIndex + 1} of ${queue.length} is signed and parked. ` +
                `${queueLeft} still to sign.`}
            </Text>
          )}
        </>
      )}

      {phase === 'done' && (
        <SentPage
          wallet={wallet}
          facts={sentFacts()}
          words={sentWords(sentKind, { index: queueIndex, total: queue.length }, spedUpReturn)}
          actions={
            queueIndex + 1 < queue.length
              ? [
                  { title: 'Sign the next transaction', onPress: nextInQueue },
                  { title: 'Stop here', variant: 'ghost', onPress: goHome },
                ]
              : [{ title: 'Done', onPress: goHome }]
          }
        />
      )}

      </StepTransition>

      {!!busy && phase !== 'ready' && signing.courier == null && <Text style={styles.busy}>{busy}</Text>}

      <AppModal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <BbqrScanner
          onComplete={onScan}
          onCancel={() => setScanning(false)}
          hint="Scan the device's result QR"
        />
      </AppModal>

      <AppDialog
        visible={dialog != null}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        actions={
          dialog?.actions ?? [{ label: 'OK', variant: 'primary', onPress: () => setDialog(null) }]
        }
        onClose={() => setDialog(null)}
      />
      <AppDialog
        visible={confirmCancel}
        title="Cancel this transaction?"
        message="The signatures you have collected will be discarded. Your coins stay in the vault, untouched."
        actions={[
          {
            label: 'Yes, cancel it',
            destructive: true,
            onPress: () => {
              setConfirmCancel(false);
              // The parked copy goes with it: a cancelled spend must not
              // linger in Pending. A ceremony resumed FROM a pending
              // co-sign request keeps its record — cancelling a submitted
              // request is a different act than abandoning a local draft.
              if (!route.params.pendingCosignId) {
                void removePendingCosign(partialIdRef.current);
              }
              goVault();
            },
          },
          { label: 'Keep going', variant: 'ghost', onPress: () => setConfirmCancel(false) },
        ]}
        onClose={() => setConfirmCancel(false)}
      />
    </ScrollView>
    {footed &&
      (signing.courier == null
        ? stepBack != null && (
            <PageFooter>
              <Button title="Back" variant="ghost" onPress={stepBack.onPress} />
            </PageFooter>
          )
        : courierFoot != null && <PageFooter>{courierFoot}</PageFooter>)}
    {stepFooter != null && <PageFooter>{stepFooter}</PageFooter>}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  frame: { flex: 1 },
  root: { flex: 1 },
  // The top is the one every page under the stack header starts at, so the
  // Sent page sits at the same height here as in a Screen `underHeader`.
  content: { padding: theme.spacing.lg, paddingTop: UNDER_HEADER_TOP, gap: theme.spacing.md },
  // Above a pinned footer the content ends at the footer's fade, not the page's edge.
  contentFooted: { paddingBottom: FOOTER_ROOM },
  stepWrap: { gap: theme.spacing.md, overflow: 'hidden' },
  // The Sent page pushes its sub line and actions to the foot.
  contentFill: { flexGrow: 1 },
  // The Sent page's foot rises 12pt into place from the step's bottom edge:
  // no clip here, or the button's lower edge is cut while it rises (decided
  // 2026-10-02). Nothing else on the page shows before its clock starts.
  stepFill: { flex: 1, overflow: 'visible' },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  title: { ...theme.typography.title, color: theme.colors.offWhite, flexShrink: 1 },
  kicker: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1 },

  sub: { ...theme.typography.body, color: theme.colors.slate },
  // The emphasised words in a line of body copy.
  strongText: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  deviceBody: { flex: 1 },
  deviceName: { ...theme.typography.heading, color: theme.colors.offWhite },
  deviceHow: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2 },
  // A row's text once the row is spent or still locked: a colour, never opacity.
  rowTextOff: { color: theme.colors.faint },
  lockState: {
    ...theme.typography.caption,
    color: theme.colors.faint,
    marginTop: 2,
  },
  unlockState: {
    ...theme.typography.caption,
    color: theme.colors.accentText,
    marginTop: 2,
  },
  card: { gap: theme.spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
  label: { ...theme.typography.body, color: theme.colors.slate },
  value: { ...theme.typography.body, color: theme.colors.offWhite, flexShrink: 1 },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  // A key row's trailing "Signed": the row's state word, in the verified colour.
  signerStateOn: { ...theme.typography.label, color: theme.colors.accentText },
  busy: { ...theme.typography.label, color: theme.colors.accentText },
}));
