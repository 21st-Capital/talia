/**
 * Send — Exodus-style 3-step flow (build an UNSIGNED PSBT; Phase 1 is
 * watch-only, signing happens on the user's hardware wallet). The recipient
 * comes first (decided 2026-11-04: scan a checkout's QR code and pay the
 * exact amount it asks for, in one go), so a payment request's amount is
 * already in the amount step when the client reaches it.
 *
 *   1/3 Address — pasted or scanned, never typed; the Note to Self. A
 *                 `bitcoin:` link's amount comes along with its address.
 *   2/3 Amount  — Xapo-style form (decided 2026-09-12): a labelled amount card
 *                 with the unit badge (tap to switch BTC/fiat), "Use all",
 *                 the equivalent value, a Priority field that opens the
 *                 sheet, Continue pinned above the system keyboard, the
 *                 folded Coin Control.
 *   3/3 Confirm — summary → Sign (builds the PSBT and enters the ceremony).
 *                 A refresh starts here, so its Priority field is here too.
 *
 * Priority sheet (from the Network Fee row): High, Medium or Slow, each
 * with its fee and waiting time, no dial (decided 2026-09-12). The rates come
 * from mempool.space's projected blocks and may sit under 1 sat/vB. All
 * Bitcoin math stays in BDK — the fee shown pre-build is an estimate
 * (~140 vB); BDK computes the real one.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { AppModal, cardGlow, holdKeyboard, NoticeBanner, FitText, FeeSheet, feeSheetStyles } from '../components';
import { FactRow } from '../components/FactRow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AddressChunks, AppDialog, Button, Gloss, TextField, InfoHeading, MarkedText, HeaderBackButton, HEADER_BTN, PageFooter, FOOTER_ROOM } from '../components';
import { AddressField } from '../components/AddressField';
import { slideStarted } from '../components/stepSlides';
import { SLIDE_SETTLE_MS } from '../components/StepTransition';
import { BookCheckLines, SaveAddressLink, SavedNameRow, SendBookCard } from '../components/AddressBookParts';
import { useAddressBook } from '../hooks/useAddressBook';
import { useAddressBookCheck } from '../hooks/useAddressBookCheck';
import { categoryOf, findBookEntry, markEntryUsed, sendListFor } from '../../wallet/addressBook';

/** Behind the info dot beside "Acceleration (RBF)" in the fee window. */
const RBF_INFO =
  'Talia marks every payment as replaceable. If one is slow to confirm, you can speed it up later by paying a higher fee.';
import { ArrowsSortIcon, ChevronRightIcon, CurrencyBitcoinIcon, WarningIcon } from '../components/TablerIcons';
import { QrScanner } from '../../platform/QrScanner';
import { readClipboard } from '../../platform/clipboard';
import { readSendAddress, refusedAddressTitle } from '../../bitcoin/scanParse';
import type { SendAddress } from '../../bitcoin/scanParse';
import { satsToBtcText } from '../../bitcoin/bip21';
import { wrongNetworkMessage } from '../../bitcoin/addressNetwork';
import { getFeePresets, FALLBACK_PRESETS, formatFeeRate } from '../../wallet/feeEstimates';
import { priorityCustom, priorityLabel, priorityRate, priorityRows } from './priorityFee';
import type { Priority } from './priorityFee';
import {
  HELD_ALL,
  HELD_SHORT,
  reservedOutpoints,
  reservedSats,
} from '../../wallet/pendingReservations';
import {
  isCosignRequest,
  loadPendingCosigns,
  refreshPendingServerStatuses,
} from '../../services/cosign';
import { balanceDecimalsFor } from '../../wallet/vaultNames';
import type { FeePresets } from '../../wallet/feeEstimates';
import { theme, themedStyles } from '../theme';
import { useWallets, formatAmount, formatSats, getBtcPrice, formatFiat, setTxNote, fiatSymbol, loadUtxoCache, saveUtxoCache, sendAccess, providerKeysOf, vaultNumberOf, REFRESH_EXPLAINER } from '../../wallet';
import { SIGNING_ENABLED } from '../../config';
import { amountFontSize } from './amountFontSize';
import { buildUnsignedPsbt, validateBuildRequest } from '../../bitcoin/psbt';
import { parsePolicy, pathRequirement } from '../../bitcoin/descriptor';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { loadSession } from '../../services/companyAuth';
import { fetchRemainingLimits, limitRows } from '../../services/cosignLimits';
import type { RemainingLimits } from '../../services/cosignLimits';
import type { BuildPsbtRequest, Utxo } from '../../bitcoin/engine/types';
import {
  classifyEngineError,
  coinNotAvailable,
  coinsHeldByPendingTx,
  COIN_NOT_AVAILABLE,
  engineErrorMessage,
} from '../../bitcoin/engine/engineError';
import { blocksBuilding, isSendPaused, SEND_PAUSED_TITLE } from '../../bitcoin/engine/addressCheck';
import { addressCheckVerdict, onAddressCheck } from '../../wallet/addressCheckStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Send'>;

/** Display-only estimate: 1-in / 2-out P2WPKH ≈ 140 vB. BDK owns the truth. */
const EST_VBYTES = 140;

/**
 * The balance beside "Use all": four decimals, rounded DOWN so it never
 * claims more than there is (decided 2026-09-12: short enough that the vault
 * name beside it stays whole). Under 0.0001 BTC four decimals would read
 * zero, so a dust balance shows in sats.
 */
function shortBtc(sats: number, decimals = 4): string {
  if (sats <= 0) return '0 BTC';
  if (sats < 10_000) return formatSats(sats);
  // Rounded DOWN so it never claims more than there is, and never to so few
  // decimals that a real balance reads as zero: a long name buys a decimal,
  // not a wrong figure (decided 2026-09-16).
  let d = Math.min(4, Math.max(2, decimals));
  while (d < 4 && Math.floor(sats / 10 ** (8 - d)) === 0) d += 1;
  return `${(Math.floor(sats / 10 ** (8 - d)) / 10 ** d).toFixed(d)} BTC`;
}

function coinCount(n: number): string {
  return n === 1 ? '1 coin' : `${n} coins`;
}

export function SendScreen({ navigation, route }: Props): React.JSX.Element {
  const { getWallet, getEngine, syncWallet, settings } = useWallets();
  const wallet = getWallet(route.params.walletId);
  const insets = useSafeAreaInsets();
  const { width: screenW, fontScale } = useWindowDimensions();
  const { providerFps: gate21C } = useProviderFingerprints(wallet);
  /**
   * How much of the co-signing limit is left (decided 2026-09-19: "show how much
   * of the limit is left before the client builds a request, so the refusal
   * never comes as a surprise"). Only where 21st Capital CO-SIGNS the
   * everyday path, on the owner's phone; read once per visit, best-effort.
   */
  const [remaining, setRemaining] = useState<RemainingLimits | null>(null);
  // Decided 2026-09-22: "any 21C fingerprint in the descriptor" also counted
  // a rescue key, which sits on a recovery path where no limit exists, and
  // on an heir's phone the session's limits are the heir's own account's,
  // not the owner's plan. So: our key must be the co-signer, and never here
  // on an heir's phone.
  const cosigned = useMemo(() => {
    if (!wallet || wallet.heirVault) return false;
    // Hidden only where we KNOW our key is the rescue key: a policy Talia
    // cannot read ('unknown' role) keeps the limits, as the backend still
    // checks them.
    return providerKeysOf(wallet.descriptor, gate21C).some((k) => k.role !== 'rescue');
  }, [wallet, gate21C]);
  // Which vault to ask about. Both of our keys sit at the same number, so
  // either answers; when they disagree or cannot be read we name no vault
  // and the server answers for the client, rather than show another vault's
  // limits (decided 2026-09-23).
  const askAbout = useMemo(
    () => (wallet ? vaultNumberOf(wallet.descriptor, gate21C) : null),
    [wallet, gate21C],
  );
  useEffect(() => {
    if (!cosigned) return;
    let alive = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        const r = await fetchRemainingLimits(session, askAbout);
        if (alive) setRemaining(r);
      } catch {
        // no line rather than a wrong one
      }
    })();
    return () => {
      alive = false;
    };
  }, [cosigned, askAbout]);
  // One row per limit, as the share already used and what is left (decided
  // 2026-09-22). Placed below the amount's own memo: it needs this send.
  // Watch only means watch only (decided 2026-09-18). This screen builds a
  // transaction, so it refuses to open for a vault whose hardware Talia has
  // not seen, whichever route led here: the coin list's Refresh, a scanned
  // address, a link, a future caller. A check found Refresh walking
  // around a dimmed Send button; one check here closes every door.
  const watchOnly = !SIGNING_ENABLED && !!wallet && sendAccess(wallet, gate21C) !== 'ready';
  useEffect(() => {
    if (watchOnly) navigation.goBack();
  }, [watchOnly, navigation]);

  // Refresh mode: a self-spend that resets Liana timelocks. Jumps straight
  // to confirm — amounts and destinations are already decided. The fee is
  // not, so Confirm carries the Priority field (decided 2026-11-01 after a
  // phone test: skipping the amount step left every refresh on Medium).
  const refresh = route.params.refresh;
  // Backstop: an heir never refreshes (it restarts their own timelock).
  const isRefresh = !!refresh && (route.params.utxos?.length ?? 0) > 0 && !wallet?.heirVault;

  const [step, setStep] = useState<1 | 2 | 3>(isRefresh ? 3 : 1);
  const [amountWidth, setAmountWidth] = useState(0);

  // An address handed in by the route (the global scanner) lands on the
  // address step too, read only with Replace, so the client checks it under
  // VERIFY ADDRESS exactly as after a scan here; Next then opens the amount.

  // The native pop gesture is DISABLED for this screen (it can't be
  // intercepted reliably once it commits) — this edge swipe replaces it and
  // walks the steps: 3→2→1→leave. The header ← does the same.
  const goBackStep = useCallback(() => {
    if (isRefresh) {
      // Refresh has no earlier steps — back leaves the flow.
      navigation.goBack();
      return;
    }
    setStep((s0) => {
      if (s0 > 1) return (s0 - 1) as 1 | 2;
      navigation.goBack();
      return s0;
    });
  }, [navigation, isRefresh]);

  const edgePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.moveX - g.dx < 40 && g.dx > 16 && Math.abs(g.dy) < 32,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 64) goBackStepRef.current();
      },
    }),
  ).current;
  const goBackStepRef = useRef(goBackStep);
  goBackStepRef.current = goBackStep;

  // Steps slide in like pushed screens: forward from the right, back from
  // the left. The slide runs on the native driver, so the keyboard must wait
  // for it, as it does for StepTransition's (components/stepSlides.ts):
  // decided 2026-11-05 after a phone test, the amount step, whose field opens
  // the keyboard as it slides in, sometimes stayed blank with only Continue
  // on screen, the keyboard's layout animation having caught the step's
  // change and left it at the slide's start. Applied before the step first
  // paints (useLayoutEffect), so it never shows one settled frame first.
  const slide = useRef(new Animated.Value(0)).current;
  const prevStep = useRef(step);
  /** The running slide's "landed", for a page left mid-slide. */
  const slideLanded = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (prevStep.current === step) return;
    const dir = step > prevStep.current ? 1 : -1;
    prevStep.current = step;
    // Counted BEFORE the value moves: moving it stops a slide still running,
    // whose own end must not let the keyboard through in between.
    const done = slideStarted();
    slideLanded.current = done;
    slide.setValue(dir * screenW);
    Animated.timing(slide, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      // Landed, or stopped by the next step (counted already): over once
      // React's copy of the step's place has caught up.
      setTimeout(done, SLIDE_SETTLE_MS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  // A page left mid-slide never holds the keyboard.
  useEffect(() => () => slideLanded.current?.(), []);

  // -- amount state (entered in fiat or BTC, Exodus-style toggle).
  // Bitcoin Only display: BTC entry, no fiat anywhere in the flow.
  const btcOnly = !!settings.btcOnly;
  const [entry, setEntry] = useState('');
  /**
   * A payment request's own amount in satoshis, exact (decided 2026-11-04).
   * It is what gets sent until the client types an amount or picks Use all,
   * so no unit on screen can round it: the field SHOWS it, in bitcoin or
   * converted to fiat, and never holds it.
   */
  const [requested, setRequested] = useState<number | null>(
    route.params.address && route.params.amountSats != null ? route.params.amountSats : null,
  );

  // Starts in the fiat currency unless Bitcoin Only is on (decided 2026-09-12);
  // the unit badge switches. A payment request's amount opens in bitcoin, the
  // unit it was asked in, figure for figure.
  const [unit, setUnit] = useState<'fiat' | 'btc'>(btcOnly || requested != null ? 'btc' : 'fiat');
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (btcOnly) setUnit('btc');
  }, [btcOnly]);
  // Arriving from "Send selected" (or Refresh) defaults to draining the
  // selection.
  const [drain, setDrain] = useState((route.params.utxos?.length ?? 0) > 0 && requested == null);

  // -- coin control: the selected outpoints define the spendable set
  const [selectedUtxos, setSelectedUtxos] = useState<
    Array<{ txid: string; vout: number; valueSats: number }>
  >(route.params.utxos ?? []);
  // Coin Control sits folded on the amount step (decided 2026-09-12); it used to
  // be its own page behind a ⋯ button, which is gone.
  const [advOpen, setAdvOpen] = useState(false);
  const [allUtxos, setAllUtxos] = useState<Utxo[] | null>(null);

  const loadCoins = useCallback(async () => {
    if (!wallet || allUtxos) return;
    // Instant-first: cached coins paint immediately; the live engine result
    // (which can queue behind an in-flight sync) replaces them silently. A
    // failed live read keeps the cache instead of claiming "no coins".
    const cache = await loadUtxoCache(wallet.id);
    if (cache) setAllUtxos((prev) => prev ?? cache.utxos);
    try {
      const engine = await getEngine(wallet);
      const live = await engine.listUtxos();
      if (live.length === 0 && engine.getTipHeight() == null) {
        // Unsynced engine — an empty answer means "don't know", not "no
        // coins"; keep the cache and never persist the emptiness.
        setAllUtxos((prev) => prev ?? []);
        return;
      }
      setAllUtxos(live);
      void saveUtxoCache(wallet.id, live, engine.getTipHeight());
    } catch {
      setAllUtxos((prev) => prev ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, allUtxos, getEngine]);

  // Coins held for a co-sign request 21st Capital may still sign, or has
  // (decided 2026-09-26): a new spend leaves them alone, so the amount on
  // offer leaves them out too, and the client is told why in plain words
  // instead of meeting the build's "insufficient funds".
  const [reserved, setReserved] = useState<Array<{ txid: string; vout: number }>>([]);
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    void (async () => {
      const held = () =>
        loadPendingCosigns()
          .then((all) => reservedOutpoints(all.filter(isCosignRequest), wallet.id))
          .catch(() => []);
      // What the phone knows now, then what the server says (a request
      // rejected since the Pending list was last opened frees its coins).
      const first = await held();
      if (cancelled) return;
      setReserved(first);
      if (first.length === 0) return;
      await refreshPendingServerStatuses();
      const fresh = await held();
      if (!cancelled) setReserved(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);
  useEffect(() => {
    if (reserved.length > 0) void loadCoins();
  }, [reserved, loadCoins]);
  const heldSats = reservedSats(reserved, allUtxos ?? []);

  const toggleUtxo = useCallback((u: Utxo) => {
    setSelectedUtxos((prev) => {
      const i = prev.findIndex((p) => p.txid === u.txid && p.vout === u.vout);
      if (i >= 0) return prev.filter((_, idx) => idx !== i);
      return [...prev, { txid: u.txid, vout: u.vout, valueSats: u.valueSats }];
    });
  }, []);

  // -- recipient
  const [address, setAddress] = useState(route.params.address ?? '');
  const [scanning, setScanning] = useState(false);
  // Kept whole while the dialog fades, so its title never empties on screen.
  const [pasteRefused, setPasteRefused] = useState({ open: false, title: '' });

  // -- the address book (decided 2026-11-05). Whatever is in the field, a
  // row, the book, a paste or a scan, is looked up in it by its normalised
  // address; a saved Private Address is checked for spent coins, an
  // Exchange Address never. The check decides nothing: Next stays as it is.
  const book = useAddressBook();
  const saved = useMemo(
    () => (book.entries && address.trim() ? findBookEntry(book.entries, address) : undefined),
    [book.entries, address],
  );
  const bookCheck = useAddressBookCheck({
    address: saved ? saved.address : null,
    category: saved ? categoryOf(saved) : null,
    network: wallet?.network,
    spentSeenAt: saved?.spentSeenAt,
  });

  // -- fee page
  const [presets, setPresets] = useState<FeePresets>(FALLBACK_PRESETS);
  const [feeOpen, setFeeOpen] = useState(false);
  const [priority, setPriority] = useState<Priority>('medium');
  /** The client's own rate, as typed (decided 2026-09-16). */
  const [customRate, setCustomRate] = useState('');
  const [note, setNote] = useState('');

  // -- build
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The independent address check found this vault's addresses differ
  // (decided 2026-10-15 and 2026-10-17): Send and Refresh pause,
  // a title and a button. Known at open from this launch's check, or from a
  // build the check refused (ADDRESS_CHECK_FAILED, wallet/addressCheckStore).
  const [paused, setPaused] = useState(() => (wallet ? blocksBuilding(addressCheckVerdict(wallet.id)) : false));
  useEffect(() => {
    if (!wallet) return;
    if (blocksBuilding(addressCheckVerdict(wallet.id))) setPaused(true);
    return onAddressCheck((id, v) => {
      if (id === wallet.id && blocksBuilding(v)) setPaused(true);
    });
  }, [wallet?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Separate-refresh: coins that couldn't get their own transaction wait for
  // the user's OK before the ceremony starts with the rest.
  const [separatePlan, setSeparatePlan] = useState<{
    psbts: string[];
    items: Array<{ psbt: string; destination: string; amountSats: number; feeSats: number }>;
    skipped: string[];
    totalCoins: number;
  } | null>(null);
  const { providerFps } = useProviderFingerprints(wallet);
  /**
   * A separate-transactions refresh on a vault whose everyday path includes a
   * 21C co-signer AND a client key on a signing device we can drive goes to
   * the refresh SESSION (decided 2026-08-27): one device pass, ONE OTP round for
   * the whole batch, one broadcast button later — instead of a full ceremony
   * + fresh codes per coin. Only paths one client signature + 21C's can
   * complete qualify; everything else keeps the per-transaction ceremony
   * queue.
   *
   * Asks which DEVICES hold the keys, never which brand (decided 2026-09-18):
   * this gate read `ledgerFingerprintsOf` and quietly dropped every BitBox
   * vault back to the old one-at-a-time ceremony, which then broke at the
   * first co-sign request.
   */
  const refreshSessionReady = useMemo(() => {
    if (!wallet) return false;
    try {
      const policy = parsePolicy(wallet.descriptor);
      const primary =
        policy.paths.find((p) => p.olderBlocks == null && p.afterHeight == null) ??
        policy.paths[0];
      if (!primary) return false;
      // No cap on how many signatures the path wants (decided 2026-09-18): the
      // session walks one device at a time through every transaction and asks
      // for the next key until the spend is complete.
      const fps = pathRequirement(primary)
        .keys
        .map((k) => k.fingerprint?.toLowerCase())
        .filter((f): f is string => !!f);
      // The ONE condition: this path uses a key of the client's. Not which
      // brand holds it, not whether a device was ever recorded, not whether
      // 21st Capital co-signs (decided 2026-09-18: the app must work completely
      // independent of our co-signing). Asking for a recorded device used to
      // send three ordinary setups down the one-at-a-time queue: a key pasted
      // or scanned rather than read over Bluetooth, a vault imported from
      // Liana, Electrum or another phone, and a vault whose key record
      // predates keyDevices. The session checks the fingerprint of whatever
      // device turns up, and offers the one-at-a-time path under the device
      // search for a key this phone cannot reach at all.
      return fps.some((fp) => !providerFps.has(fp));
    } catch {
      return false;
    }
  }, [wallet, providerFps]);

  useEffect(() => {
    let cancelled = false;
    getFeePresets().then((p) => !cancelled && setPresets(p));
    if (!btcOnly) getBtcPrice(settings.fiat).then((r) => !cancelled && setRate(r));
    return () => {
      cancelled = true;
    };
  }, [settings.fiat, btcOnly]);

  // A custom rate that is not a usable number falls back to the slowest tier,
  // so the amounts on screen and the transaction that gets built are never
  // computed from an empty or half-typed field.
  const feeRate = priorityRate(presets, priority, customRate);
  const chosenLabel = priorityLabel(priority);

  const selectionSats = selectedUtxos.reduce((sum, u) => sum + u.valueSats, 0);
  // Coins picked by hand are the client's explicit choice and may include
  // held ones; otherwise the held coins are not on offer.
  const coinsHeld = selectedUtxos.length === 0 && heldSats > 0;
  const balanceSats =
    selectedUtxos.length > 0
      ? selectionSats
      : Math.max(0, (wallet?.cachedBalanceSats ?? 0) - heldSats);
  const feeEstSats = Math.ceil(feeRate * EST_VBYTES);

  const amountSats = useMemo(() => {
    if (drain) return Math.max(0, balanceSats - feeEstSats);
    if (requested != null) return requested;
    const n = parseFloat(entry) || 0;
    if (unit === 'btc') return Math.round(n * 1e8);
    return rate ? Math.round((n / rate) * 1e8) : 0;
  }, [entry, unit, rate, drain, balanceSats, feeEstSats, requested]);

  const amountBtc = amountSats / 1e8;
  // A refresh sends everything back to the vault and counts as nothing
  // against a limit, so it shows none.
  const limitSummary = useMemo(
    () => (remaining && !isRefresh ? limitRows(remaining, amountSats) : []),
    [remaining, isRefresh, amountSats],
  );
  const overLimit = limitSummary.some((r) => r.over);
  const insufficient = !drain && amountSats > 0 && amountSats + feeEstSats > balanceSats;

  const fmtFiat = useCallback(
    (sats: number) => (rate ? formatFiat(sats, rate, settings.fiat) : '-'),
    [rate, settings.fiat],
  );
  /** A rate's estimated fee, as the sheet's two figures. */
  const feeMoney = (feeRateSatVb: number) => {
    const sats = Math.ceil(feeRateSatVb * EST_VBYTES);
    return { main: btcOnly ? formatSats(sats) : fmtFiat(sats), sub: btcOnly ? null : formatSats(sats) };
  };

  /** The Confirm card's amount, the way it was entered, the other unit under it. */
  const sendingFact = (): { value: string; sub?: string } => {
    if (drain && selectedUtxos.length === 0) return { value: 'Max (drain)' };
    const btc = `${amountBtc.toFixed(8)} BTC`;
    if (settings.unit === 'sats') return { value: formatSats(amountSats), sub: btcOnly ? undefined : fmtFiat(amountSats) };
    if (unit === 'fiat') return { value: fmtFiat(amountSats), sub: btc };
    return { value: btc, sub: btcOnly ? undefined : fmtFiat(amountSats) };
  };

  /** The amount field takes digits and one point; decimals stop at the unit's precision. */
  const onAmountChange = useCallback(
    (raw: string) => {
      setDrain(false);
      // Typing takes over from a payment request's amount, as from Use all.
      setRequested(null);
      let t = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
      const dot = t.indexOf('.');
      if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '');
      if (t.startsWith('.')) t = '0' + t;
      const [whole, dec] = t.split('.');
      const maxDec = unit === 'fiat' ? 2 : 8;
      if (dec != null && dec.length > maxDec) t = `${whole}.${dec.slice(0, maxDec)}`;
      if (t.length > 14) return;
      setEntry(t);
    },
    [unit],
  );

  const toggleUnit = useCallback(() => {
    setUnit((u) => {
      // Carry the value across so the toggle doesn't clear the entry. A
      // request's amount needs no carrying: it is kept in satoshis.
      if (rate && entry && requested == null) {
        const n = parseFloat(entry) || 0;
        const converted = u === 'fiat' ? n / rate : n * rate;
        setEntry(
          converted > 0
            ? converted.toFixed(u === 'fiat' ? 8 : 2).replace(/\.?0+$/, '')
            : '',
        );
      }
      return u === 'fiat' ? 'btc' : 'fiat';
    });
  }, [rate, entry, requested]);

  /**
   * An address that passed the reader lands, and a payment request's amount
   * with it (decided 2026-11-04), shown in bitcoin as it was asked. An amount
   * typed earlier goes, so no figure typed in one unit is read in another. A
   * plain address leaves the amount alone: Replace already took an earlier
   * request's amount away with its address.
   */
  const land = (read: Extract<SendAddress, { kind: 'address' }>) => {
    setAddress(read.address);
    setError(null);
    if (read.amountSats != null) {
      setRequested(read.amountSats);
      setEntry('');
      setDrain(false);
      setUnit('btc');
    }
  };

  const onScannedAddress = (raw: string) => {
    setScanning(false);
    if (!wallet) return;
    const read = readSendAddress(raw, wallet.network);
    if (read.kind === 'address') {
      land(read);
    } else {
      setError(
        read.kind === 'wrongNetwork'
          ? wrongNetworkMessage(wallet.network)
          : read.kind === 'invalid'
            ? 'The scanned QR code is not a Bitcoin address.'
            : refusedAddressTitle(read.kind),
      );
    }
  };

  /** Pasted text, from the icon or from iOS's own bubble, reads the same. */
  const takePasted = (raw: string) => {
    if (!wallet) return;
    const read = readSendAddress(raw, wallet.network);
    if (read.kind === 'address') {
      land(read);
    } else {
      setPasteRefused({ open: true, title: refusedAddressTitle(read.kind) });
    }
  };

  const pasteAddress = async () => {
    if (!wallet) return;
    const raw = await readClipboard().catch(() => '');
    takePasted(raw ?? '');
  };

  /**
   * A saved address put on Send, from a row of the card or a card of the
   * Address book page (decided 2026-11-05): read exactly as a paste is, so a
   * wrong network or a broken address is refused the same way. It takes the
   * place of an address already in, as Replace and a paste would, and moves
   * to the top of the card.
   */
  const takeSaved = (raw: string) => {
    if (!wallet) return;
    const read = readSendAddress(raw, wallet.network);
    if (read.kind !== 'address') {
      setPasteRefused({ open: true, title: refusedAddressTitle(read.kind) });
      return;
    }
    replaceAddress();
    land(read);
    void markEntryUsed(read.address).catch(() => undefined);
  };

  // The Address book page's answer: a card tapped there comes back here.
  // `at` is new for every pick, the same address picked twice too.
  const picked = route.params.picked;
  useEffect(() => {
    if (picked) takeSaved(picked.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.at]);

  const openBook = () => {
    if (wallet) navigation.navigate('AddressBook', { walletId: wallet.id, network: wallet.network });
  };
  const saveShownAddress = () => {
    if (wallet) navigation.navigate('AddAddress', { network: wallet.network, address: address.trim() });
  };

  // A request's amount belongs to its address, so it goes with it, and the
  // amount step starts again as an empty send does.
  const replaceAddress = () => {
    setAddress('');
    setError(null);
    if (requested != null) {
      setRequested(null);
      setUnit(btcOnly ? 'btc' : 'fiat');
    }
  };

  const onBuild = async () => {
    if (!wallet) return;
    setError(null);
    setBuilding(true);
    try {
      let request: BuildPsbtRequest;
      if (isRefresh && refresh?.separate) {
        // MOST PRIVATE: one small transaction PER coin — nothing shared, so
        // nothing on-chain ties the coins together. Each transaction moves
        // its coin to its own fresh address; BDK computes each fee. Coins
        // that can't get their own transaction (already being spent by a
        // pending payment, or too small to pay a fee) are SKIPPED with an
        // explanation instead of blocking the rest (a phone test hit this when a
        // freshly-refreshed coin was still in the on-screen list).
        const engine = await syncWallet(wallet, { force: true });
        const psbts: string[] = [];
        const items: Array<{ psbt: string; destination: string; amountSats: number; feeSats: number }> = [];
        const skipped: string[] = [];
        for (const u of selectedUtxos) {
          // CHANGE branch, deliberately (decided 2026-08-28): a registered signing
          // device recognizes its own change addresses and shows the whole
          // transaction as a SELF-TRANSFER — the device verifies the
          // destination cryptographically. A receive address would render as
          // an unverifiable string on the device instead.
          const addr = (await engine.getInternalAddress('new')).address;
          const req: BuildPsbtRequest = {
            recipients: [{ address: addr, amountSats: 0 }],
            feeRate,
            drain: true,
            utxos: [{ txid: u.txid, vout: u.vout }],
          };
          try {
            const built = await buildUnsignedPsbt(engine, req);
            psbts.push(built.psbtBase64);
            items.push({
              psbt: built.psbtBase64,
              destination: addr,
              // A drain build reports sentSats 0 — what actually arrives is
              // the coin minus this transaction's fee.
              amountSats: Math.max(0, u.valueSats - built.feeSats),
              feeSats: built.feeSats,
            });
            if (note.trim()) void setTxNote(wallet.id, built.txid, note.trim());
          } catch (e) {
            // The address check's pause stops the whole refresh, never one coin.
            if (isSendPaused(e)) throw e;
            // Sorted by the engine's code (engineError.ts), which for 0.28 reads
            // the message exactly as this list always did.
            const msg = engineErrorMessage(e);
            const short = `${u.txid.slice(0, 8)}… (${formatAmount(u.valueSats, settings.unit)})`;
            skipped.push(
              coinsHeldByPendingTx(e)
                ? `${short}: already part of a pending transaction`
                : classifyEngineError(e) === 'INSUFFICIENT_FUNDS'
                  ? `${short}: too small to pay its own network fee`
                  : `${short}: ${msg}`,
            );
          }
        }
        if (psbts.length === 0) {
          setError(
            'None of these coins can be refreshed right now:\n' +
              skipped.map((line) => `• ${line}`).join('\n'),
          );
          return;
        }
        if (skipped.length > 0) {
          setSeparatePlan({ psbts, items, skipped, totalCoins: selectedUtxos.length });
          return;
        }
        // No size cap here any more (decided 2026-09-18). The 50 was the co-sign
        // server's limit for ONE code round, and a refresh no longer has to
        // reach us at all: the session signs with the client's own keys and
        // sends itself. It only mentions the limit if they choose to ask us.
        if (refreshSessionReady) {
          navigation.navigate('RefreshSession', { walletId: wallet.id, items });
          return;
        }
        navigation.navigate('SignPsbt', {
          walletId: wallet.id,
          psbtBase64: psbts[0],
          psbtQueue: psbts,
        });
        return;
      }
      if (isRefresh && refresh) {
        // A SINGLE coin: drain it to one fresh address. Several coins never
        // reach here any more — they each get their own transaction in the
        // branch above (decided 2026-09-18: the many-outputs-in-one-transaction
        // build is gone, it linked the coins publicly and made the signing
        // device warn about several change outputs).
        //
        // The fresh own address is derived HERE, under the build spinner —
        // not at navigation time — because the derivation can queue behind an
        // in-flight wallet sync for many seconds. Change branch on purpose:
        // see the separate-mode note above.
        const engine = await getEngine(wallet);
        const addr = (await engine.getInternalAddress('new')).address;
        request = {
          recipients: [{ address: addr, amountSats: 0 }],
          feeRate,
          drain: true,
          utxos: selectedUtxos.map(({ txid, vout }) => ({ txid, vout })),
        };
      } else {
        // Frozen coins are untouchable — but only when BDK does the picking;
        // an explicit coin-control selection cannot contain them (the picker
        // hides frozen coins).
        // So are coins a co-sign request already spends (decided
        // 2026-09-26): it carries the client's signature and lives at 21st
        // Capital too, so a second spend of them would race it. A partial
        // parked on this phone alone reserves nothing. Picking coins by hand
        // is still possible.
        const reservedNow =
          selectedUtxos.length === 0
            ? reservedOutpoints((await loadPendingCosigns()).filter(isCosignRequest), wallet.id)
            : [];
        const frozenList =
          selectedUtxos.length === 0
            ? [
                ...(wallet.frozenUtxos ?? []).map((k) => {
                  const [txid, vout] = k.split(':');
                  return { txid, vout: Number(vout) };
                }),
                ...reservedNow,
              ]
            : undefined;
        request = {
          recipients: [{ address: address.trim(), amountSats: drain ? 0 : amountSats }],
          feeRate,
          drain,
          utxos:
            selectedUtxos.length > 0
              ? selectedUtxos.map(({ txid, vout }) => ({ txid, vout }))
              : undefined,
          excludeUtxos: frozenList && frozenList.length > 0 ? frozenList : undefined,
        };
      }
      const issues = validateBuildRequest(request, wallet.network);
      if (issues.length > 0) {
        setError(
          issues.length > 1
            ? issues.map((i) => `• ${i.message}`).join('\n')
            : issues[0].message,
        );
        return;
      }
      const engine = await syncWallet(wallet);
      const built = await buildUnsignedPsbt(engine, request);
      if (note.trim()) void setTxNote(wallet.id, built.txid, note.trim());
      // Straight into the signing ceremony — the confirm and sign steps are
      // ONE page now (decided 2026-07-19); the ceremony's file method covers the
      // old "Export file" action.
      navigation.navigate('SignPsbt', {
        walletId: wallet.id,
        psbtBase64: built.psbtBase64,
        // Lets the ceremony REBUILD the spend on a timelocked branch when
        // the user signs with an unlocked recovery/heir key (decided 2026-07-27)
        // — the primary-path build can't be signed by those keys.
        rebuild: request,
      });
    } catch (e) {
      if (isSendPaused(e)) {
        setPaused(true);
        return;
      }
      const msg = engineErrorMessage(e);
      setError(
        selectedUtxos.length === 0 && reserved.length > 0 && classifyEngineError(e) === 'INSUFFICIENT_FUNDS'
          ? HELD_SHORT
          : coinNotAvailable(e)
            ? COIN_NOT_AVAILABLE
            : msg,
      );
    } finally {
      setBuilding(false);
    }
  };

  // Leaving; draw nothing rather than a build form for a watch-only vault.
  if (watchOnly) return <View style={styles.flex} />;
  if (!wallet) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.muted}>Wallet not found.</Text>
      </View>
    );
  }

  const amountReady = drain ? balanceSats > 0 : amountSats > 0 && !insufficient;
  // "Use all" fills the field with what would go, and a payment request with
  // what it asks for; typing takes over again. With no rate yet a request's
  // amount shows in bitcoin rather than as an empty field.
  const shownEntry = drain
    ? unit === 'btc'
      ? amountBtc.toFixed(8).replace(/\.?0+$/, '')
      : rate
        ? (amountBtc * rate).toFixed(2)
        : ''
    : requested != null
      ? unit === 'fiat' && rate
        ? ((requested / 1e8) * rate).toFixed(2)
        : satsToBtcText(requested)
      : entry;
  const addressReady = address.trim().length > 8;
  // Frozen coins never appear in the picker; manage them from the vault's coin list.
  const pickableUtxos = (allUtxos ?? []).filter(
    (u) => !(wallet.frozenUtxos ?? []).includes(`${u.txid}:${u.vout}`),
  );
  const toggleAdvanced = () => {
    const next = !advOpen;
    setAdvOpen(next);
    if (next) void loadCoins();
  };

  // One field for the amount step and a refresh's Confirm, which has no amount
  // step before it. Off while Sign builds: a choice made then would change the
  // page and not the transaction.
  const priorityField = (
    <>
      <Text style={styles.formLabel}>Priority</Text>
      <TouchableOpacity
        style={styles.selectField}
        onPress={() => setFeeOpen(true)}
        disabled={building}
        activeOpacity={0.7}
        accessibilityRole="button">
        <Text style={styles.selectText}>
          {chosenLabel} ≈ {btcOnly ? formatSats(feeEstSats) : fmtFiat(feeEstSats)}
        </Text>
        <View style={styles.chevronDown}>
          <ChevronRightIcon size={20} color={theme.colors.slate} />
        </View>
      </TouchableOpacity>
    </>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} {...edgePan.panHandlers}>
      {/* Header: back · step · scan + fee dots */}
      <View style={styles.header}>
        <HeaderBackButton onPress={goBackStep} />
        {/* "Refresh", as the coin list, the signing screen and the
            transaction page call it (decided 2026-09-22: this bar said
            "Self-Transfer" for the same thing). */}
        <Text style={styles.stepText}>{isRefresh ? 'Refresh' : 'Send BTC'}</Text>
        <View style={styles.headerRight}>
          {/* The address scanner sits INSIDE the address field now (decided
              2026-09-07, after the Kraken key fields), not up here. */}
          {/* Coin Control lives ONLY on the amount step:
              changing the coin set later (confirm page, or refresh mode
              where addresses map one-per-coin) invites sending more than
              intended. */}
        </View>
      </View>

      <Animated.View style={[styles.slideWrap, { transform: [{ translateX: slide }] }]}>
      {/* Step 2, the amount. The address step (1) comes first on screen
          and follows here in the source. */}
      {step === 2 && (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.formLabel}>Amount you would like to send</Text>
          {/* The same card as the home screen's (decided 2026-09-12). */}
          <View style={styles.amountCard}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            <View style={styles.amountTop}>
              <TouchableOpacity
                style={styles.unitBadge}
                onPress={toggleUnit}
                // The switch belongs to the amount field: switching the
                // unit must not put the keyboard away (decided 2026-09-20).
                onPressIn={holdKeyboard}
                disabled={btcOnly}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Switch unit">
                <View style={styles.unitCircle}>
                  <Gloss size={34} radius={17} />
                  {unit === 'btc' ? (
                    <CurrencyBitcoinIcon size={18} color={theme.colors.gold} />
                  ) : (
                    <Text style={styles.unitSymbol}>{fiatSymbol(settings.fiat)}</Text>
                  )}
                </View>
                <Text style={styles.unitText}>{unit === 'btc' ? 'BTC' : settings.fiat}</Text>
                {!btcOnly && <ArrowsSortIcon size={16} color={theme.colors.slate} />}
              </TouchableOpacity>
              <TextInput
                // Shrinks as digits are added so the whole figure stays on
                // screen (decided 2026-09-19), at the phone's text size too; the
                // row reports its width below.
                style={[styles.amountInput, { fontSize: amountFontSize(shownEntry || '0', amountWidth, fontScale) }]}
                onLayout={(e) => setAmountWidth(e.nativeEvent.layout.width)}
                value={shownEntry}
                onChangeText={onAmountChange}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.colors.faint}
                textAlign="right"
                // The keyboard opens for an amount to type; a payment
                // request's amount is already in, and Priority and Continue
                // stay in view under it.
                autoFocus={requested == null}
                selectionColor={theme.colors.accentText}
                accessibilityLabel="Amount"
              />
            </View>
            <View style={styles.amountBottom}>
              {/* The name shrinks before it would be cut (decided 2026-09-12). */}
              <FitText style={styles.fromText} minimumFontScale={0.7}>
                From: {wallet.label}
              </FitText>
              <TouchableOpacity
                style={styles.useAllBtn}
                onPress={() => {
                  setDrain((d) => !d);
                  setEntry('');
                  setRequested(null);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button">
                <Text style={[styles.useAll, drain && styles.useAllOn]}>
                  {drain ? 'Using all' : 'Use all'} {shortBtc(balanceSats, balanceDecimalsFor(wallet.label))}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {!btcOnly && (
            <View style={styles.valueRow}>
              <FactRow
                label="Equivalent value"
                value={`≈ ${unit === 'fiat' ? `${amountBtc.toFixed(8)} BTC` : fmtFiat(amountSats)}`}
                valueStyle={styles.valueText}
              />
            </View>
          )}

          <View style={styles.formLabelLater}>{priorityField}</View>

          {/* Coin Control, folded on this same screen. One title: no
              "Advanced" wrapper, no inner heading (decided 2026-09-12). */}
          <View style={styles.advCard}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            <TouchableOpacity
              style={styles.advHeader}
              onPress={toggleAdvanced}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: advOpen }}>
              <Text style={styles.advTitle}>Coin Control</Text>
              <View style={styles.advRight}>
                {!advOpen && selectedUtxos.length > 0 && (
                  <Text style={styles.advSummary}>{coinCount(selectedUtxos.length)} chosen</Text>
                )}
                <View style={advOpen ? styles.chevronUp : styles.chevronDown}>
                  <ChevronRightIcon size={20} color={theme.colors.slate} />
                </View>
              </View>
            </TouchableOpacity>
            {advOpen && (
              <View style={styles.advBody}>
                <Text style={styles.coinHint}>
                  {selectedUtxos.length === 0
                    ? 'No coins chosen. The wallet picks them for you.'
                    : `${coinCount(selectedUtxos.length)} chosen · ${formatAmount(selectionSats, settings.unit)}`}
                </Text>
                {allUtxos == null ? (
                  <Text style={styles.coinHint}>Loading coins…</Text>
                ) : pickableUtxos.length === 0 ? (
                  <Text style={styles.coinHint}>No coins found in this vault.</Text>
                ) : (
                  pickableUtxos.map((u) => {
                    const on = selectedUtxos.some((p) => p.txid === u.txid && p.vout === u.vout);
                    return (
                      <TouchableOpacity
                        key={`${u.txid}:${u.vout}`}
                        style={styles.coinRow}
                        onPress={() => toggleUtxo(u)}
                        activeOpacity={0.8}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}>
                        <View style={[styles.coinCheck, on && styles.coinCheckOn]}>
                          {on && <View style={styles.coinCheckDot} />}
                        </View>
                        <View style={styles.coinBody}>
                          <Text style={styles.coinSats}>{formatAmount(u.valueSats, settings.unit)}</Text>
                          {!!u.address && (
                            <Text style={styles.coinAddr} numberOfLines={1} ellipsizeMode="middle">
                              {u.address}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
                {selectedUtxos.length > 0 && (
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={() => setSelectedUtxos([])}
                    accessibilityRole="button">
                    <Text style={styles.clearText}>Clear selection</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* Step 1, the recipient, where Send opens (decided 2026-11-04). */}
      {step === 1 && (
        <ScrollView style={styles.flex} contentContainerStyle={styles.stepBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepTitle}>Send to</Text>
          <AddressField
            address={address.trim()}
            onPaste={() => void pasteAddress()}
            onPasted={takePasted}
            onScan={() => setScanning(true)}
            onReplace={replaceAddress}
          />
          {/* A saved address names itself under the field and opens the
              book; one that is not saved offers to be (decided 2026-11-05). */}
          {!!address.trim() && saved && <SavedNameRow entry={saved} onPress={openBook} />}
          {!!address.trim() && !saved && book.entries && <SaveAddressLink onPress={saveShownAddress} />}
          {/* Same note that TxDetail shows later — saved onto the tx after
              building. The only place to write it (decided 2026-09-12). */}
          <TextField
            label=""
            value={note}
            onChangeText={setNote}
            placeholder="Note to Self"
            autoCapitalize="sentences"
          />
          {error && <MarkedText text={error} style={styles.errorText} />}

          {/* The saved addresses this vault can pay, while the field is
              empty, and the way to the whole book (decided 2026-11-05). */}
          {!address.trim() && (book.entries || book.unreadable) && (
            <SendBookCard
              entries={book.entries ? sendListFor(book.entries, wallet.network) : []}
              onPick={(row) => takeSaved(row.address)}
              onOpenBook={openBook}
            />
          )}

          {/* Verification view: the address in big 4-char chunks, alternating
              colors, the one component Receive and the address check read
              from too (decided 2026-10-05). Under it, the address book's
              check of a saved Private Address. */}
          {address.trim().length > 8 && (
            <View style={styles.verifyBlock}>
              <Text style={styles.verifyLabel}>VERIFY ADDRESS</Text>
              <AddressChunks address={address.trim()} />
              <BookCheckLines check={bookCheck} />
            </View>
          )}
        </ScrollView>
      )}

      {step === 3 && (
        <ScrollView style={styles.flex} contentContainerStyle={styles.stepBody} keyboardShouldPersistTaps="handled">
          {/* "Confirm" on both, as the send flow's last step; the bar
              above already says "Refresh" (decided 2026-09-22). */}
          {isRefresh ? (
            <InfoHeading
              title="What a refresh does"
              text={REFRESH_EXPLAINER}
              style={styles.stepTitle}>
              Confirm
            </InfoHeading>
          ) : (
            <Text style={styles.stepTitle}>Confirm</Text>
          )}
          {/* The explainer's own last sentence, word for word (decided
              2026-09-22: this line said "recovery timers start over", as if
              at once; the clock restarts only once the transaction
              confirms). Where the coins go is the To row's job. */}
          {isRefresh && (
            <Text style={styles.refreshHint}>
              {'Each coin’s clock starts again once its transaction confirms.'}
            </Text>
          )}
          {isRefresh && <View>{priorityField}</View>}
          <View style={[styles.infoCard, styles.confirmCard]}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            <View style={styles.infoFact}>
              <FactRow label={isRefresh ? 'Refreshing' : 'Sending'} {...sendingFact()} valueStyle={styles.infoValue} />
            </View>
            {isRefresh && refresh ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>To</Text>
                {/* Prose values WRAP instead of truncating — an ellipsis
                    hides exactly the words the user needs (decided 2026-07-19).
                    "Vault", never "wallet", for the thing being refreshed
                    (decided 2026-09-22). */}
                <Text style={[styles.infoValue, styles.infoValueWrap]}>
                  {refresh.separate
                    ? `${refresh.count} separate transactions, all back to this vault`
                    : 'a new address of this vault'}
                </Text>
              </View>
            ) : (
              <View style={styles.infoFact}>
                <FactRow
                  label="To"
                  value={`${address.slice(0, 12)}…${address.slice(-6)}`}
                  valueStyle={[styles.infoValue, styles.infoMono]}
                />
              </View>
            )}
            <View style={styles.infoFact}>
              <FactRow
                label="Network fee"
                value={btcOnly ? formatSats(feeEstSats) : `${fmtFiat(feeEstSats)} / ${formatSats(feeEstSats)}`}
                sub={`${priority === 'custom' ? 'Your own rate' : `${chosenLabel} priority`} · ${formatFeeRate(feeRate)} sat/vB`}
                valueStyle={styles.infoValue}
              />
            </View>
            {limitSummary.map((row) => (
              <View key={row.label} style={styles.infoFact}>
                <FactRow
                  label={row.label}
                  value={row.value}
                  sub={row.sub}
                  valueStyle={[styles.infoValue, row.over && styles.overLimit]}
                />
              </View>
            ))}
            {!!note.trim() && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Note</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {note.trim()}
                </Text>
              </View>
            )}
          </View>

          {/* 21st Capital rejects a co-sign request over the limit (decided
              2026-09-22). Said before the client signs, never as a block:
              their own keys may not need us at all. */}
          {/* The home screen's notice, with the warning sign (decided 2026-09-22:
              "use the same container we use on the home page"). */}
          {overLimit && (
            <NoticeBanner icon={<WarningIcon size={20} color={theme.colors.gold} />}>
              This send is over your co-signing limit, so 21st Capital will reject a co-sign request for it.
            </NoticeBanner>
          )}
          {error && <MarkedText text={error} style={styles.errorText} />}
        </ScrollView>
      )}

      </Animated.View>

      {/* The step's action, pinned at the foot and OUTSIDE the slide (decided
          2026-10-05): Next, then Continue, then Sign; the footer rises with
          the keyboard and dissolves whatever scrolls under it (the Coin
          Control card behind Continue, decided 2026-09-12). On the amount step
          the app's one notice takes the button's place while there is
          nothing to continue with (decided 2026-09-22). */}
      <PageFooter>
        {step === 1 && <Button title="Next" onPress={() => setStep(2)} disabled={!addressReady} />}
        {step === 2 &&
          (insufficient || balanceSats === 0 ? (
            <NoticeBanner icon={<WarningIcon size={20} color={theme.colors.gold} />}>
              {balanceSats === 0
                ? coinsHeld
                  ? HELD_ALL
                  : "You don't have any BTC in this wallet."
                : coinsHeld
                  ? HELD_SHORT
                  : 'Not enough BTC to cover the amount plus the network fee.'}
            </NoticeBanner>
          ) : (
            <Button title="Continue" onPress={() => setStep(3)} disabled={!amountReady} />
          ))}
        {step === 3 && (
          <Button
            title={isRefresh ? 'Sign refresh' : 'Sign transaction'}
            onPress={onBuild}
            loading={building}
          />
        )}
      </PageFooter>

      {/* The address check's pause (decided 2026-10-17): a title and a button. */}
      <AppDialog
        visible={paused}
        title={SEND_PAUSED_TITLE}
        actions={[{ label: 'OK', variant: 'primary', onPress: () => navigation.goBack() }]}
        onClose={() => navigation.goBack()}
      />

      {/* A paste that gave no address for this vault: a title and OK. A
          refused scan keeps its line under the note: this dialog would open
          over the scanner while that closes. */}
      <AppDialog
        visible={pasteRefused.open}
        title={pasteRefused.title}
        actions={[{ label: 'OK', variant: 'primary', onPress: () => {} }]}
        onClose={() => setPasteRefused((r) => ({ ...r, open: false }))}
      />

      {/* Scanner */}
      <AppDialog
        visible={separatePlan != null}
        title="Some coins were skipped"
        message={
          separatePlan
            ? `${separatePlan.skipped.length} of ${separatePlan.totalCoins} coins can't get their own transaction right now:\n\n${separatePlan.skipped
                .map((line) => `• ${line}`)
                .join('\n')}\n\nA coin in a pending transaction can be refreshed once that transaction confirms. Continue with the other ${separatePlan.psbts.length}?`
            : ''
        }
        actions={[
          {
            label: 'Continue',
            onPress: () => {
              if (!separatePlan || !wallet) return;
              if (refreshSessionReady) {
                navigation.navigate('RefreshSession', {
                  walletId: wallet.id,
                  items: separatePlan.items,
                });
                return;
              }
              navigation.navigate('SignPsbt', {
                walletId: wallet.id,
                psbtBase64: separatePlan.psbts[0],
                psbtQueue: separatePlan.psbts,
              });
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => {} },
        ]}
        onClose={() => setSeparatePlan(null)}
      />

      <AppModal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <QrScanner hint="Scan a Bitcoin address" onScanned={onScannedAddress} onCancel={() => setScanning(false)} />
      </AppModal>

      {/* Priority: three choices, each with its fee and waiting time; no
          dial (decided 2026-09-12). Choosing one closes the sheet. The sheet is
          the shared FeeSheet, the same one Speed up and Cancel open. */}
      <FeeSheet
        visible={feeOpen}
        onClose={() => setFeeOpen(false)}
        title="Priority"
        rows={priorityRows({
          presets,
          priority,
          money: feeMoney,
          onPick: (key) => {
            setPriority(key);
            setFeeOpen(false);
          },
        })}
        // The client's own rate, for when even the slowest tier is more than
        // they want to pay (decided 2026-09-16: "if the user wants to add a fee
        // rate on his own, he can just say 1 sat for example instead of 1.5
        // as per the slowest suggestion"). Typing a usable number picks it;
        // the sheet stays open, because the number is not finished until
        // they stop typing.
        custom={priorityCustom({
          presets,
          priority,
          customRate,
          money: feeMoney,
          onCustomRate: setCustomRate,
          onPick: setPriority,
        })}
        // Always on: the engine enables RBF unless a caller opts out and Send
        // never does, so this is information, not a control (decided 2026-09-12).
        footer={
          <View style={feeSheetStyles.footerRow}>
            <InfoHeading style={feeSheetStyles.meta} title="Acceleration (RBF)" text={RBF_INFO}>
              Acceleration (RBF)
            </InfoHeading>
            <Text style={feeSheetStyles.meta}>Always on</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  slideWrap: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  stepText: { ...theme.typography.screenTitle, flex: 1, textAlign: 'center', color: theme.colors.offWhite },
  // Mirrors the back button's width (HEADER_BTN) so the centred title stays
  // truly centred even when no right-side action renders (decided 2026-07-19:
  // "Self-Transfer" sat off-centre on the refresh confirm page).
  headerRight: { flexDirection: 'row', minWidth: HEADER_BTN, justifyContent: 'flex-end' },

  // The amount step after Xapo (decided 2026-09-12). Figures use the one hero size.
  // The page gutter every page has; the content ends at the pinned footer's
  // fade, so the last card can scroll clear of it.
  form: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: FOOTER_ROOM },
  formLabel: { ...theme.typography.body, color: theme.colors.offWhite, marginBottom: theme.spacing.sm },
  formLabelLater: { marginTop: theme.spacing.xl },
  // Exactly the home screen's card: surface, 20pt corners, 1pt hairline, no
  // focus colour (decided 2026-09-12: the green focus border read as darker).
  amountCard: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  amountTop: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  unitBadge: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  unitCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitSymbol: { ...theme.typography.heading, color: theme.colors.gold },
  unitText: { ...theme.typography.title, color: theme.colors.offWhite },
  // No lineHeight on an input (theme/index.ts): iOS crops the glyphs.
  amountInput: {
    ...theme.typography.hero,
    lineHeight: undefined,
    flex: 1,
    minWidth: 60,
    color: theme.colors.offWhite,
    padding: 0,
    // Tabular figures: every digit takes the same room, so the figure holds
    // its place while typing and is never wider than amountFontSize measured
    // it (decided 2026-09-20). The same figures the portfolio balance uses.
    fontVariant: ['tabular-nums'],
  },
  amountBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  fromText: { ...theme.typography.body, color: theme.colors.slate, flex: 1 },
  useAllBtn: { flexShrink: 0 },
  useAll: { ...theme.typography.bodyStrong, color: theme.colors.accentText },
  useAllOn: { color: theme.colors.gold },
  valueRow: { paddingVertical: theme.spacing.md },
  valueText: { ...theme.typography.heading },
  selectField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md + 2,
  },
  selectText: { ...theme.typography.heading, color: theme.colors.offWhite },
  chevronDown: { transform: [{ rotate: '90deg' }] },
  chevronUp: { transform: [{ rotate: '-90deg' }] },

  // Coin Control on the same screen, folded by default.
  advCard: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  advHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md + 2,
  },
  advTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  advRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  advSummary: { ...theme.typography.caption, color: theme.colors.slate },
  advBody: { paddingBottom: theme.spacing.md },
  coinHint: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2, marginBottom: theme.spacing.sm },
  clearBtn: { alignSelf: 'flex-start', paddingTop: theme.spacing.md },
  clearText: { ...theme.typography.bodyStrong, color: theme.colors.accentText },

  infoCard: {
    marginHorizontal: theme.spacing.xl,
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  confirmCard: { marginHorizontal: 0, marginTop: 0 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Label sits on the FIRST line of its value, not centred against the
    // block (decided 2026-08-28: a wrapped "To" value floated above its label).
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  infoFact: { paddingVertical: theme.spacing.sm },
  // On the body token's own leading (decided 2026-10-05: a token's line
  // height is overridden only to sit level with a FitText figure).
  infoLabel: { ...theme.typography.body, color: theme.colors.slate },
  infoValue: {
    ...theme.typography.heading,
    color: theme.colors.offWhite,
    flexShrink: 1,
  },
  infoValueWrap: { textAlign: 'right', flex: 1 },
  overLimit: { color: theme.colors.negative },
  // The address in the same size as every other value in the card (decided
  // 2026-09-22: "the font sizes are not consistent"); only the face is mono.
  infoMono: { fontFamily: 'Menlo', fontSize: theme.typography.heading.fontSize, lineHeight: theme.typography.heading.lineHeight },

  // The address and confirm steps: the page gutter, the content ending at
  // the pinned footer's fade.
  stepBody: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: FOOTER_ROOM,
  },
  stepTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  refreshHint: { ...theme.typography.body, color: theme.colors.slate },
  verifyBlock: { marginTop: theme.spacing.xl, gap: theme.spacing.sm },
  verifyLabel: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.5 },
  errorText: { ...theme.typography.body, color: theme.colors.negative },

  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderTopWidth: 1,
    borderColor: theme.colors.hairline,
  },
  coinCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinCheckOn: { borderColor: theme.colors.accent },
  coinCheckDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent },
  coinBody: { flex: 1, minWidth: 0 },
  coinSats: { ...theme.typography.heading, color: theme.colors.offWhite },
  // A coin's address is a code: the mono token.
  coinAddr: { ...theme.typography.mono, color: theme.colors.slate },
}));
