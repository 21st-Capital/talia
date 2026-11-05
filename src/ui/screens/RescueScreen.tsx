/**
 * Rescue ceremony (decided 2026-07-23): when a vault's recovery timelock has
 * expired, the client asks 21st Capital to recover the funds via the rescue key.
 *
 * Flow: the first page lists every vault with a rescue key and checks each one
 * as it opens (decided 2026-09-21): a vault is tappable only once the rescue path has
 * opened for EVERY coin, and the others are greyed with the time left, so there
 * is no second page to say "not yet" → the whole vault moves (no partial amount,
 * this is an emergency) → destination → a MANDATORY disclaimer that consents to
 * sharing the full descriptor → request. 21C builds + signs the
 * recovery spend on air-gapped hardware and returns it for the client to
 * broadcast.
 *
 * The client chooses the fee on the review step (decided 2026-10-31), the same
 * Priority choice as Send, High preselected. It is set then, and the payment
 * goes out at least one waiting period later, so a rescue can still get stuck:
 * while one waits, its card offers Speed up, the same coins to the same address
 * at a higher fee, through the same email link and codes, signed again by 21st
 * Capital and broadcast from here (wallet/rescueReplacement.ts).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { Screen, Card, Button, ConsentCheckbox, ChevronRightIcon, AddressChunks, AppDialog, AppModal, FactRow, FeeSheet, feeSheetStyles, InfoHeading, PageHead, RescueRequestSheet, SentPage, StepTransition, BookingSheet, CodeField, AuthenticatorStep, sentWords } from '../components';
import type { DialogAction, SentFacts } from '../components';
import { AddressField } from '../components/AddressField';
import { ParachuteIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import { useWallets, formatAmount, formatBtc, formatFiat, formatSats, getBtcPrice } from '../../wallet';
import { getFeePresets, FALLBACK_PRESETS, formatFeeRate } from '../../wallet/feeEstimates';
import type { FeePresets } from '../../wallet/feeEstimates';
import { isInsufficientFunds, replacementBroadcastFailure, replacementRows } from '../../wallet/replacement';
import type { OriginalTx } from '../../wallet/replacement';
import { buildRescueSpeedUp, rescueOnChain } from '../../wallet/rescueReplacement';
import type { RescueOnChain } from '../../wallet/rescueReplacement';
import { rescueFeeAt } from '../../wallet/rescueFee';
import type { RescueFeeBuild } from '../../wallet/rescueFee';
import { factsNeedEngine, rescueRequestFacts, serverRequestTx } from '../../wallet/rescueRequestFacts';
import type { KnownCoin, RescueRequestFacts } from '../../wallet/rescueRequestFacts';
import { ownOutputIndicesOf } from '../../wallet/ownOutputs';
import { priorityCustom, priorityLabel, priorityRate, priorityRows } from './priorityFee';
import type { Priority } from './priorityFee';
import { defaultChoice, replacementBuildNotice, replacementSheet, RESCUE_SIGNED_AGAIN } from './replacementSheet';
import type { SheetChoice } from './replacementSheet';
import { broadcastWithWatchdog } from '../../wallet/chainServers';
import { answerMayBeLost, expectedTxidOf, findWalletTx, networkTx } from '../../wallet/broadcastAnswer';
import { assertRescueOnChain } from '../../bitcoin/engine/engineShared';
import { withTimeout } from '../../wallet/withTimeout';
import type { WalletMeta } from '../../wallet/types';
import { parsePolicy } from '../../bitcoin/descriptor';
import {
  BroadcastRefusedError,
  decodeHexOrBase64,
  encodeBase64,
  looksLikePsbt,
  psbtTxShape,
  rawTxShape,
  refusalMessage,
  scriptToAddress,
  unsignedTxid,
} from '../../bitcoin/psbt';
import type { Network } from '../../bitcoin/descriptor/types';
import type { WalletEngine } from '../../bitcoin/engine/types';
import type { RescueExpectation, TxShape } from '../../bitcoin/psbt';
import { addressFamily, addressFitsNetwork, addressToScriptHex } from '../../bitcoin/addressNetwork';
import { readSendAddress, refusedAddressTitle } from '../../bitcoin/scanParse';
import { QrScanner } from '../../platform/QrScanner';
import { readClipboard } from '../../platform/clipboard';
import { utxoExpiries, formatBlocksDuration } from '../../wallet/timelock';
import { cachedRescueReadiness, oldestCoinArrival, rescueModeLapsed, rescueReadiness } from '../../wallet/rescueReadiness';
import { sendTooEarly, tooEarlyTitle } from '../../wallet/sendTooEarly';
import { networkNote } from '../../wallet/networkNote';
import { rescueModeCovers, rescueModeVaultName } from '../../wallet/rescueModeVault';
import { agedTipHeight, loadUtxoCache } from '../../wallet/utxoCache';
import { loadTxCache } from '../../wallet/txCache';
import type { RescueReadiness } from '../../wallet/rescueReadiness';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { fetchProfile } from '../../services/settingsApi';
import {
  sendRescueOtp,
  submitRescueRequest,
  fetchMyRescues,
  reportSentRescues,
  settleSentRescue,
  RESCUE_SERVER_MS,
  cancelRescue,
  savePendingRescue,
  loadPendingRescues,
  removePendingRescue,
  fetchRescueMode,
  markRescueMeetingScheduled,
  closeRescueMode,
  rescueRefusal,
  signableLine,
  forgetAfterCancel,
  loadRefusedVaults,
  rememberRefusedVault,
  refusedUnder,
  otherVaultLine,
  RESCUE_MODE_ENDED_TITLE,
  RESCUE_NOT_REPLACED_TITLE,
  RESCUE_ALREADY_OPEN_TITLE,
  RESCUE_ALREADY_SIGNED_TITLE,
  requestLapsed,
  vaultsWithOpenRequest,
  rescueWhen,
  sentRecordExpired,
} from '../../services/rescue';
import type { PendingRescue, RefusedVault, RescueModeStatus, RescueServerRequest } from '../../services/rescue';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Rescue'>;

type Step = 'select' | 'review' | 'code' | 'totp' | 'done' | 'sent';

/**
 * The title when a broadcast got no answer and the chain does not show the
 * rescue either (2026-10-19). Title and buttons only; true whether the
 * servers could not be reached, did not answer in time, or the look on the
 * chain could not be made. Try again sends the same signed transaction,
 * which is harmless if it did go out.
 */
export const NO_ANSWER_TITLE = 'No answer from the network';

/**
 * The Broadcast button while the chain is asked whether a broadcast that
 * got no answer went out (decided 2026-10-19): up to `CHAIN_CHECK_MS` more
 * after the watchdog, and a spinner that says nothing new for that long
 * reads as stuck.
 */
export const CHECKING_TITLE = 'Checking the network…';

/** The row and the card of a rescue that went out and waits for a block. */
export const RESCUE_WAITING_LINE = 'Rescue sent, waiting for a block';

/** What a rescue's broadcast or Speed up's tap can end on. Title and OK. */
export const RESCUE_ALREADY_CONFIRMED_TITLE = 'Already confirmed';
export const RESCUE_NETWORK_WANTS_MORE_TITLE = 'The network wants a higher fee';
export const RESCUE_COINS_CANNOT_PAY_TITLE = 'The coins cannot pay this fee';

/** Wait for a sheet to slide away before a dialog opens over the page. */
const AFTER_MODAL_MS = 450;

/** A speed-up that went out takes the place of the rescue it replaced, once
 *  21st Capital has heard that one went out: the report is read from its
 *  record (`reportSentRescues`). */
const forgetReplaced = async (item: { pending?: PendingRescue }): Promise<void> => {
  const replaced = item.pending?.replaces?.id;
  if (!replaced) return;
  const record = (await loadPendingRescues().catch(() => [])).find((p) => p.id === replaced);
  if (record?.reported) await removePendingRescue(replaced).catch(() => {});
};

/** Our keys' fingerprints in this vault, as the vault recorded them. */
const providerFpsOf = (w: WalletMeta): Set<string> =>
  new Set((w.providerKeyFingerprints ?? []).map((f) => f.toLowerCase()));

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** The signed rescue reduced to what the checks compare: a PSBT's
 *  unsigned transaction, or the raw one as it is. Null when unreadable. */
const signedShape = (signed: Uint8Array, network: Network): TxShape | null =>
  looksLikePsbt(signed) ? psbtTxShape(encodeBase64(signed)) : rawTxShape(signed, network);

/**
 * What the Sent page reports for a rescue, read off the signed transaction
 * before it goes out, while the coins it spends are still listed: what it
 * pays outside the vault and what comes back (BDK's isMine), and the fee
 * when every coin's value is known. Never throws: a figure it cannot read is
 * left off the page.
 */
async function rescueFacts(
  engine: WalletEngine,
  signed: Uint8Array,
  network: Network,
  /** A speed-up's coins: spent, so the vault no longer lists them. */
  replaced: ReadonlyArray<{ txid: string; vout: number; valueSats: number }> = [],
): Promise<SentFacts> {
  const unknown: SentFacts = { kind: 'rescue', txids: [], recipients: null, movedSats: null, feeSats: null };
  try {
    const shape = signedShape(signed, network);
    if (!shape) return unknown;
    const recipients: Array<{ address: string | null; amountSats: number }> = [];
    let moved = 0;
    for (const o of shape.outputs) {
      const address = scriptToAddress(hexBytes(o.scriptHex), network);
      const own = address ? await engine.ownsAddress(address).catch(() => false) : false;
      if (own) moved += o.valueSats;
      else recipients.push({ address, amountSats: o.valueSats });
    }
    const coins = new Map(
      [...(await engine.listUtxos()), ...replaced].map((u) => [`${u.txid.toLowerCase()}:${u.vout}`, u.valueSats]),
    );
    const spent = shape.inputs.map((i) => coins.get(`${i.txid.toLowerCase()}:${i.vout}`));
    const fee = spent.every((v) => v != null)
      ? (spent as number[]).reduce((a, v) => a + v, 0) - shape.outputs.reduce((a, o) => a + o.valueSats, 0)
      : null;
    return { ...unknown, recipients, movedSats: moved, feeSats: fee != null && fee >= 0 ? fee : null };
  } catch {
    return unknown;
  }
}

/**
 * The timelock (blocks) of the RESCUE path specifically — the recovery path that
 * a 21st Capital key can spend. NOT the descriptor-wide minimum: inheritance
 * heir paths sit at a SMALLER older() than the 15-month rescue key, so using the
 * minimum would show coins as rescuable months before the rescue key can spend
 * (and prematurely disclose the descriptor). Returns null when no 21C-key
 * recovery path exists (i.e. this vault has no rescue key).
 */
function rescuePath(
  descriptor: string,
  providerFps: Set<string>,
): { olderBlocks: number; fingerprint: string } | null {
  try {
    const policy = parsePolicy(descriptor);
    let best: { olderBlocks: number; fingerprint: string } | null = null;
    for (const path of policy.paths) {
      if (path.olderBlocks == null) continue; // only timelocked recovery paths
      for (const g of path.groups) {
        for (const k of g.keys) {
          const fp = k.fingerprint?.toLowerCase();
          if (fp && providerFps.has(fp) && (!best || path.olderBlocks < best.olderBlocks)) {
            best = { olderBlocks: path.olderBlocks, fingerprint: fp };
          }
        }
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** What the first page knows about one vault with a rescue key. */
type VaultCheck =
  | { state: 'checking' }
  | { state: 'error'; message: string }
  | RescueReadiness;

interface Availability {
  count: number;
  sats: number;
  /** Blocks until MORE coins open (null = everything is already available). */
  lockedBlocks: number | null;
  /** Total UTXOs in the vault — a rescue needs EVERY one at the rescue path. */
  total: number;
  /** The expired coins themselves — what the rescue transaction spends. */
  coins: Array<{ txid: string; vout: number }>;
  /** The 21C rescue key's fingerprint (the branch the PSBT must spend). */
  rescueFingerprint: string;
}

/** A rescue request on the list: the phone's record and the server's word. */
type ActiveItem = { id: string; walletId: string; pending?: PendingRescue; server?: RescueServerRequest };

/** A rescue this phone sent: its record, the server's word and the chain's. */
type SentItem = { id: string; walletId: string; pending: PendingRescue; server?: RescueServerRequest };

/** How long an opened request waits on the vault's engine (it may be busy
 *  with the page's syncs) before it shows what it has without it. */
const REQUEST_ENGINE_WAIT_MS = 20_000;

/**
 * What an opened request pays (decided 2026-11-03), from the phone's own
 * transaction: `wallet/rescueRequestFacts.ts`, which reads the PSBT while
 * the request waits and the signed transaction once it is signed (the
 * server wipes the PSBT then). The coins' values come from this phone, the
 * cached coin list first, so the sheet answers at once; the engine is asked
 * only when that is not enough (a coin the list lacks, or an output that may
 * be the vault's own, which only BDK decides). Never throws.
 */
async function requestFactsOf(
  item: ActiveItem,
  w: WalletMeta | undefined,
  engineOf: (w: WalletMeta) => Promise<WalletEngine>,
): Promise<RescueRequestFacts> {
  const record = item.pending;
  // A vault no longer on this phone: its network from the address recorded.
  const network: Network = w?.network ?? (addressFamily(record?.destination ?? '') === 'bitcoin' ? 'bitcoin' : 'testnet');
  const tx = serverRequestTx(item.server, network);
  const known: KnownCoin[] = [...(record?.replaces?.coins ?? [])];
  if (w) known.push(...((await loadUtxoCache(w.id).catch(() => null))?.utxos ?? []));
  const first = rescueRequestFacts({ record, tx, network, knownCoins: known });
  const need = factsNeedEngine(first);
  if (!w || typeof tx === 'string' || (!need.own && !need.coins)) return first;
  try {
    return await withTimeout(
      (async () => {
        const engine = await engineOf(w);
        const live = await engine.listUtxos();
        const own = await ownOutputIndicesOf(engine, tx.outputs);
        return rescueRequestFacts({ record, tx, network, knownCoins: [...known, ...live], ownOutputs: own });
      })(),
      REQUEST_ENGINE_WAIT_MS,
      'Reading the vault',
    );
  } catch {
    return first;
  }
}

/** The speed-up being chosen, or being filed through the code steps. */
interface SpeedUpPlan {
  item: SentItem;
  orig: OriginalTx;
  destination: string;
  path: { olderBlocks: number; fingerprint: string };
  /** The chosen rate and the fee the sheet showed for it, once it closed on one. */
  rate: number;
  feeSats: number;
}

export function RescueScreen({ navigation, route }: Props): React.JSX.Element {
  const { wallets, syncWallet, getWallet, getEngine, settings } = useWallets();
  const [active, setActive] = useState<ActiveItem[]>([]);
  const [broadcasting, setBroadcasting] = useState<string | null>(null);
  /** The rescue whose broadcast got no answer and is now looked for on the
   *  chain: its button says so, so the wait reads as progress. */
  const [checkingChain, setCheckingChain] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('select');
  /** The rescue that just went out, as the Sent page shows it. */
  const [rescueSent, setRescueSent] = useState<{ walletId: string; facts: SentFacts } | null>(null);
  const [vault, setVault] = useState<WalletMeta | null>(null);
  /** Each rescue-key vault's answer, checked as the page opens. */
  const [checks, setChecks] = useState<Record<string, VaultCheck>>({});
  const [avail, setAvail] = useState<Availability | null>(null);
  const [destination, setDestination] = useState('');
  const [scanning, setScanning] = useState(false);
  /** A refused scan's title, held until the scanner has closed: the dialog
   *  would otherwise open while the scanner slides away. */
  const scanRefusal = useRef<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  /** The fee of a first request (decided 2026-10-31): Send's choice, High
   *  preselected. */
  const [presets, setPresets] = useState<FeePresets>(FALLBACK_PRESETS);
  const [priority, setPriority] = useState<Priority>('fast');
  const [customRate, setCustomRate] = useState('');
  const [feeOpen, setFeeOpen] = useState(false);
  /** The price for the fee's first figure; null shows sats alone. */
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  /** What the chosen rate pays, from a build of these coins (`feePreview`
   *  effect). `size` is that build's fee over its rate; `cannotPay` the coins
   *  are too small for it. Null until the first build answers. */
  const [feePreview, setFeePreview] = useState<RescueFeeBuild | null>(null);
  /** The consent-gated email code (decided 2026-08-28): the emailed link's page
   *  reveals it only after the client confirms they checked the destination. */
  const [emailOtp, setEmailOtp] = useState('');
  /** The authenticator code, asked for when the account has two-factor
   *  (decided 2026-10-05), on co-signing's own step. */
  const [totpCode, setTotpCode] = useState('');
  /** A refused code, said under the field of its step as co-signing does. */
  const [codeError, setCodeError] = useState<string | null>(null);
  /** The rescues this phone sent, and where each stands on the chain. */
  const [sentItems, setSentItems] = useState<SentItem[]>([]);
  const [onChain, setOnChain] = useState<Record<string, RescueOnChain>>({});
  /** The sent rescue whose Speed up is checking the chain. */
  const [speedBusy, setSpeedBusy] = useState<string | null>(null);
  /** The Speed up sheet that is open, with what it was opened on. */
  const [speedSheet, setSpeedSheet] = useState<{ plan: SpeedUpPlan; presets: FeePresets } | null>(null);
  const [speedChoice, setSpeedChoice] = useState<SheetChoice>('fast');
  const [speedCustom, setSpeedCustom] = useState('');
  /** Set while a speed-up goes through the code steps: the steps are a first
   *  request's own, and this is what they file. */
  const [speedUp, setSpeedUp] = useState<SpeedUpPlan | null>(null);
  /** The done page closes a speed-up. */
  const [speedUpFiled, setSpeedUpFiled] = useState(false);
  /** Whether this account has two-factor, learned while the client reads
   *  the email (as co-signing does). null = not known: the request goes
   *  without the code and the server asks for it (TOTP_REQUIRED) before it
   *  looks at the email code, so nothing is used up. */
  const has2fa = useRef<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message: string; actions: DialogAction[] } | null>(null);
  // Meeting-gated rescue mode (decided 2026-07-24): 'none' → schedule the meeting;
  // 'scheduled' → wait for staff to activate during the call; 'active' → the
  // actual ceremony unlocks.
  const [mode, setMode] = useState<'loading' | 'none' | 'scheduled' | 'active'>('loading');
  const [bookingToken, setBookingToken] = useState('');
  /** Fallback when the backend has no in-app scheduler token: open the
   *  booking page in the browser rather than dead-ending on a disabled
   *  button (decided 2026-08-26). */
  const [bookingUrl, setBookingUrl] = useState('');
  const [booking, setBooking] = useState(false); // the in-app scheduler sheet
  const [session, setSession] = useState<CompanySession | null>(null);
  /** The server's last answer, null when it could not be asked. Carries the
   *  ONE vault rescue mode is on for and its times (decided 2026-10-05). */
  const [modeInfo, setModeInfo] = useState<RescueModeStatus | null>(null);
  /** The request opened from its card (decided 2026-11-03): the card's own
   *  words for its title, and what it pays once read (null until then). */
  const [opened, setOpened] = useState<{ item: ActiveItem; title: string; facts: RescueRequestFacts | null } | null>(
    null,
  );
  /** The vaults of this phone's requests not yet sent, as read from the
   *  phone before the server answers; null until read (decided 2026-11-04). */
  const [heldVaults, setHeldVaults] = useState<Set<string> | null>(null);
  /** The request list has been read with the server's answer at least once. */
  const [activeRead, setActiveRead] = useState(false);
  /** The request being cancelled. */
  const [cancelling, setCancelling] = useState<string | null>(null);
  /** The same, for the dialog's action, which holds the render it opened in. */
  const cancellingNow = useRef(false);
  /** Vaults the server answered RESCUE_ALREADY_OPEN for on this visit: a
   *  request for them this phone holds no record of (another phone, or
   *  another of the vault's people). Greyed with that title, not offered. */
  const [openElsewhere, setOpenElsewhere] = useState<ReadonlySet<string>>(new Set());

  /** The rate a first request is built at. */
  const chosenRate = priorityRate(presets, priority, customRate);

  /** Reads the mode again; returns the server's answer, null when it could
   *  not be asked. */
  const refreshMode = useCallback(async (): Promise<RescueModeStatus | null> => {
    try {
      const s = await loadSession();
      setSession(s);
      if (!s) {
        setModeInfo(null);
        setMode('none');
        return null;
      }
      const m = await fetchRescueMode(s);
      setModeInfo(m);
      setMode(m.status);
      setBookingToken(m.bookingToken);
      setBookingUrl(m.bookingUrl);
      return m;
    } catch {
      setModeInfo(null);
      setMode('none');
      return null;
    }
  }, []);

  /** Vaults the server refused (RESCUE_WRONG_VAULT) under the current
   *  activation, kept on this phone (decided 2026-10-05). */
  const [refused, setRefused] = useState<RefusedVault[]>([]);
  useEffect(() => {
    let alive = true;
    void loadRefusedVaults().then((r) => {
      if (alive) setRefused(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void refreshMode();
    const unsub = navigation.addListener('focus', () => void refreshMode());
    return unsub;
  }, [navigation, refreshMode]);

  /** The in-app booking succeeded → tell the backend, enter the holding state. */
  const onMeetingBooked = async () => {
    try {
      const s = session ?? (await loadSession());
      if (s) await markRescueMeetingScheduled(s);
    } catch {
      // the booking itself succeeded; staff sees it in the calendar either way
    }
    setMode('scheduled');
  };

  /** Every vault on this phone that holds a 21st Capital rescue key, with
   *  that key's path. A vault without one cannot be rescued and is not
   *  listed (decided 2026-09-21: no page just to say so). */
  const rescueVaults = useMemo(
    () =>
      wallets
        .filter((w) => (w.providerKeyFingerprints?.length ?? 0) > 0)
        .map((w) => ({
          w,
          rp: rescuePath(w.descriptor, new Set((w.providerKeyFingerprints ?? []).map((f) => f.toLowerCase()))),
        }))
        .filter((x): x is { w: WalletMeta; rp: { olderBlocks: number; fingerprint: string } } => x.rp != null),
    [wallets],
  );
  const rescueIds = rescueVaults.map((x) => x.w.id).join(',');

  /**
   * Rescue mode is switched on for ONE vault (decided 2026-10-05), named by the
   * account number of our key in it; only that vault is offered a rescue.
   * The server refuses any other before the email code is used.
   */
  const boundVault = modeInfo?.vault ?? null;
  const activatedAt = modeInfo?.activatedAt ?? null;
  /** A vault the server already refused under this activation is not
   *  offered again, whatever the phone reads (decided 2026-10-05). */
  const coversVault = useCallback(
    (w: WalletMeta): boolean =>
      !refusedUnder(refused, w.id, activatedAt) && rescueModeCovers(boundVault, w.descriptor, providerFpsOf(w)),
    [refused, activatedAt, boundVault],
  );
  /** The ids of the vaults on this phone rescue mode is on for, as a key. */
  const coveredIds = useMemo(
    () =>
      rescueVaults
        .filter(({ w }) => coversVault(w))
        .map(({ w }) => w.id)
        .join(','),
    [rescueVaults, coversVault],
  );

  /**
   * The vaults with a rescue request on its way, waiting for 21st Capital or
   * signed and not yet sent (decided 2026-11-04: one rescue per vault at a
   * time). They are not offered for another until it is cancelled, ends or
   * goes out; the request's card says where it stands. Null until the
   * phone's own records are read, so no vault is offered before then.
   */
  const openVaultIds = useMemo(
    () =>
      activeRead
        ? vaultsWithOpenRequest(active, modeInfo, (id) => {
            const w = getWallet(id);
            return !!w && coversVault(w);
          })
        : heldVaults,
    [activeRead, active, modeInfo, heldVaults, getWallet, coversVault],
  );

  /** One vault's check, and when its oldest coin arrived (to tell a
   *  refresh from a deposit, for the reset below). */
  const checkVault = useCallback(
    async (w: WalletMeta, olderBlocks: number): Promise<{ check: VaultCheck; oldestArrival: number | null }> => {
      try {
        const engine = await syncWallet(w);
        const [utxos, history] = await Promise.all([engine.listUtxos(), engine.listTransactions()]);
        const expiries = utxoExpiries(utxos, history, engine.getTipHeight(), olderBlocks);
        return { check: rescueReadiness(utxos, expiries, olderBlocks), oldestArrival: oldestCoinArrival(utxos, history) };
      } catch (e) {
        return { check: { state: 'error', message: (e as Error).message }, oldestArrival: null };
      }
    },
    [syncWallet],
  );

  const recheck = useCallback(
    async (w: WalletMeta, olderBlocks: number) => {
      setChecks((c) => ({ ...c, [w.id]: { state: 'checking' } }));
      const { check } = await checkVault(w, olderBlocks);
      setChecks((c) => ({ ...c, [w.id]: check }));
    },
    [checkVault],
  );

  // Every vault is checked as the page opens, side by side. Keyed on the
  // vaults alone: syncWallet is rebuilt whenever the engine list changes, and
  // following it would start the checks over after every sync.
  const checkVaultRef = useRef(checkVault);
  checkVaultRef.current = checkVault;
  const [checksDone, setChecksDone] = useState<Array<{
    walletId: string;
    result: RescueReadiness | null;
    oldestArrival: number | null;
  }> | null>(null);
  useEffect(() => {
    let alive = true;
    setChecks(Object.fromEntries(rescueVaults.map(({ w }) => [w.id, { state: 'checking' } as VaultCheck])));
    setChecksDone(null);
    // What this phone already knows, before anything is asked of the chain
    // (reported 2026-09-23: "it should not take that long to know the timelock is
    // expired"). Six vaults used to mean six full syncs before the first
    // answer. The cached answer is last-known, so the live check below still
    // runs and replaces it; it only ever fills a row that is still checking.
    void Promise.all(
      rescueVaults.map(async ({ w, rp }) => {
        const [cache, txs] = await Promise.all([loadUtxoCache(w.id), loadTxCache(w.id)]);
        const known = cachedRescueReadiness(
          cache?.utxos,
          txs,
          cache ? agedTipHeight(cache) : undefined,
          rp.olderBlocks,
        );
        if (alive && known) {
          setChecks((c) => (c[w.id]?.state === 'checking' ? { ...c, [w.id]: known } : c));
        }
      }),
    );
    void Promise.all(
      rescueVaults.map(async ({ w, rp }) => {
        const { check: result, oldestArrival } = await checkVaultRef.current(w, rp.olderBlocks);
        if (alive) setChecks((c) => ({ ...c, [w.id]: result }));
        return {
          walletId: w.id,
          result: result.state === 'checking' || result.state === 'error' ? null : result,
          oldestArrival,
        };
      }),
    ).then((results) => {
      if (alive) setChecksDone(results);
    });
    return () => {
      alive = false;
    };
    // The ids, not the array: a wallet list re-render must not re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescueIds]);

  // Coins refreshed while rescue mode is on: the emergency is over (decided
  // 2026-07-24). Since rescue mode is on for ONE vault (decided 2026-10-05),
  // only that vault's check counts: another vault being refreshed says
  // nothing about it, and a phone that does not hold it judges nothing (the
  // mode ends by itself after 7 days). And only a REAL refresh counts:
  // every coin of that vault arrived after activation (decided 2026-10-05).
  // A deposit or a stranger's small payment leaves the old coins in place;
  // resetting on it would cost the client the 48 hours and the pending
  // request, as only an administrator can switch it on again. Title only
  // (decided 2026-09-22).
  const resetting = useRef(false);
  useEffect(() => {
    if (mode !== 'active' || !checksDone || resetting.current) return;
    const covered = new Set(coveredIds.split(',').filter(Boolean));
    const bound = checksDone.filter((c) => covered.has(c.walletId));
    if (!rescueModeLapsed(bound, activatedAt)) return;
    resetting.current = true;
    void (async () => {
      try {
        const s = await loadSession();
        const closed = s ? await closeRescueMode(s) : false;
        // The server's word on where the mode stands, never the phone's
        // guess (decided 2026-10-05): a close that did not reach the server
        // changed nothing, and a request must not read as ended because of it.
        const m = await refreshMode();
        if (closed && m && m.status !== 'active') {
          setDialog({
            title: 'Rescue mode reset',
            message: '',
            actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
          });
        }
      } finally {
        resetting.current = false;
      }
    })();
  }, [mode, checksDone, coveredIds, activatedAt, refreshMode]);

  /** Rescues this screen saw go out, kept off the list at once, before the
   *  phone's record says so (2026-10-19). The first word that one went
   *  out wins; a later one for the same rescue changes nothing. */
  const sentHere = useRef(new Set<string>());

  /** What the screen shows right now, for an answer that comes after the
   *  client has moved on (`lateAnswer`). */
  const now = useRef({ step, broadcasting, dialog, busy, vault });
  now.current = { step, broadcasting, dialog, busy, vault };
  /** The dialog each rescue's last broadcast ended on ("No answer from the
   *  network", a refusal), which a late answer replaces with its Sent page. */
  const failureShown = useRef(new Map<string, object>());
  /** The vault calls, as they are now: `refreshActive` is made once. */
  const walletCalls = useRef({ getWallet, getEngine });
  walletCalls.current = { getWallet, getEngine };

  /**
   * A signed rescue the vault's last sync already lists went out, although
   * this screen never heard (decided 2026-10-19): a broadcast the watchdog
   * gave up on still runs natively and can send it after "No answer from
   * the network", and the app may have closed before that answer came.
   * Read from the vault as last synced, no network. Checked by the same
   * rule as a broadcast (`assertRescueOnChain`), then marked sent, reported
   * to 21st Capital and off the list, as after a broadcast. One that fails
   * the rule stays on the list, where Broadcast says why. Answers whether it
   * settled one, so the list is read again and it shows as sent.
   */
  const settleIfOnChain = useCallback(async (item: ActiveItem): Promise<boolean> => {
    try {
      if (sentHere.current.has(item.id) || now.current.broadcasting === item.id) return false;
      const w = walletCalls.current.getWallet(item.walletId);
      const bytes = item.server?.signed_tx ? decodeHexOrBase64(item.server.signed_tx) : null;
      if (!w || !bytes) return false;
      const txid = expectedTxidOf(bytes, w.network);
      if (!txid) return false;
      const engine = await walletCalls.current.getEngine(w);
      const tx = await findWalletTx(engine, txid);
      if (!tx) return false;
      await assertRescueOnChain(engine, signedShape(bytes, w.network), tx, {
        destinationScriptHex: item.pending?.destination
          ? addressToScriptHex(item.pending.destination) ?? undefined
          : undefined,
        requestTxid: item.pending?.requestTxid,
      });
      if (sentHere.current.has(item.id) || now.current.broadcasting === item.id) return false;
      sentHere.current.add(item.id);
      setActive((a) => a.filter((x) => x.id !== item.id));
      await settleSentRescue(item.id, tx.txid);
      await forgetReplaced(item);
      return true;
    } catch {
      // stays on the list: Broadcast asks the chain again and says why
      return false;
    }
  }, []);

  // Active rescue requests (local record + live server status) so a SIGNED
  // rescue can be broadcast from here, and finished ones drop off. One that
  // went out (`sentTxid`, or seen here) is never offered again; 21st Capital
  // is told about it again if it has not heard (`reportSentRescues`).
  const refreshActive = useCallback(async () => {
    let local = await loadPendingRescues();
    // A vault with a request on its way is not offered for another (decided
    // 2026-11-04): what the phone holds counts until the server has spoken.
    setHeldVaults(new Set(local.filter((p) => !p.sentTxid).map((p) => p.walletId)));
    if (local.length === 0) {
      setActive([]);
      setSentItems([]);
      setActiveRead(true);
      return;
    }
    // What this phone knows, before the server is asked: a rescue that went
    // out reads as sent from the first moment, whatever the server answers.
    const heard = new Map(sentNow.current.map((s) => [s.id, s.server]));
    setSentItems(
      local
        .filter((p) => p.sentTxid)
        .map((p) => ({ id: p.id, walletId: p.walletId, pending: p, server: heard.get(p.id) })),
    );
    // null = we could NOT ask the server (offline / logged out) — never prune.
    // Bounded (2026-10-19): a session refresh or a list that never
    // answers leaves the list as the phone knows it, never a spinner.
    let server: RescueServerRequest[] | null = null;
    try {
      const s = await withTimeout(loadSession(), RESCUE_SERVER_MS, 'Signing in');
      if (s) {
        if (local.some((p) => p.sentTxid && !p.reported)) {
          await reportSentRescues(s);
          local = await loadPendingRescues();
        }
        server = await fetchMyRescues(s);
      }
    } catch {
      server = null;
    }
    if (server != null) {
      // Forget records that are finished — or GONE server-side (staff deleted
      // the request): they'd show "Waiting for 21st Capital…" forever
      // (decided 2026-07-24).
      for (const p of local) {
        // One that went out stays until it is in a block: it can be sped up.
        if (p.sentTxid) continue;
        const st = server.find((x) => x.id === p.id)?.status;
        // 'rejected' is deliberately NOT here (decided 2026-08-29): dropping the
        // record would leave the client waiting on an answer that has
        // already been given. They clear it once they have read it.
        if (!st || st === 'completed' || st === 'cancelled') {
          await removePendingRescue(p.id);
        }
      }
      local = await loadPendingRescues();
    }
    const items: ActiveItem[] = local
      .filter((p) => !p.sentTxid && !sentHere.current.has(p.id))
      .map((p) => ({
        id: p.id,
        walletId: p.walletId,
        pending: p,
        server: server?.find((s) => s.id === p.id),
      }));
    setActive(items);
    setActiveRead(true);
    setSentItems(
      local
        .filter((p) => p.sentTxid)
        .map((p) => ({ id: p.id, walletId: p.walletId, pending: p, server: server?.find((s) => s.id === p.id) })),
    );
    // Behind the list, never in its way: a signed one already on the chain.
    for (const item of items) {
      if (item.server?.status === 'signed' && item.server.signed_tx) {
        void settleIfOnChain(item).then((settled) => {
          if (settled) void refreshActive();
        });
      }
    }
  }, [settleIfOnChain]);

  useEffect(() => {
    void refreshActive();
    const unsub = navigation.addListener('focus', () => void refreshActive());
    return unsub;
  }, [navigation, refreshActive]);

  /** The rescue path of a vault on this phone, by the vault's id. */
  const pathOf = useCallback(
    (walletId: string) => rescueVaults.find((x) => x.w.id === walletId)?.rp,
    [rescueVaults],
  );

  // Where each sent rescue stands, read from the vault after its sync (the
  // same sync the page's vault checks ran, `checksDone`). One in a block is
  // done with. One the vault does not list may simply not have reached the
  // server this vault asks, so it stays until it is long gone.
  const sentKey = sentItems.map((s) => `${s.id}:${s.pending.sentTxid}:${!!s.pending.reported}`).join(',');
  const sentNow = useRef(sentItems);
  sentNow.current = sentItems;
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const item of sentNow.current) {
        const w = walletCalls.current.getWallet(item.walletId);
        const path = pathOf(item.walletId);
        if (!w || !path) continue;
        try {
          const engine = await syncWallet(w);
          const chain = await rescueOnChain(engine, item.pending.sentTxid as string, {
            destination: item.pending.destination ?? '',
            olderBlocks: path.olderBlocks,
          });
          if (!alive) return;
          const replaced = sentNow.current.some((s) => s.pending.replaces?.id === item.id);
          const over =
            chain.state === 'confirmed' ||
            (chain.state === 'not-listed' && (replaced || sentRecordExpired(item.pending)));
          // Kept until 21st Capital has heard: the report is read from this
          // record, and without it the staff row stays Signed.
          if (over && item.pending.reported) {
            await removePendingRescue(item.id);
            setSentItems((list) => list.filter((x) => x.id !== item.id));
          }
          setOnChain((map) => ({ ...map, [item.id]: chain }));
        } catch {
          // the next look answers: nothing is offered until one does
        }
      }
    })();
    return () => {
      alive = false;
    };
    // The ids and the page's checks, not the arrays: syncWallet is rebuilt
    // after every sync, and following it would look again after every look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentKey, checksDone, pathOf]);

  /** The vault has a rescue that went out and waits for a block, as far as
   *  this phone knows: the chain says so, or has not answered yet. */
  const waitingRescue = (walletId: string): boolean =>
    sentItems.some((s) => {
      const state = onChain[s.id]?.state;
      return s.walletId === walletId && (state === undefined || state === 'waiting');
    });

  /** The speed-up of this rescue that is with 21st Capital, or signed and
   *  not sent yet: there is one at a time. */
  const speedUpUnderWay = (id: string): boolean =>
    active.some(
      (a) => a.pending?.replaces?.id === id && a.server?.status !== 'rejected' && a.server?.status !== 'cancelled',
    );

  /**
   * Speed up on the card: read the rescue again first, since the answer must
   * be current. One that confirmed meanwhile says so; otherwise the sheet
   * opens on the fee tiers, as Speed up does on a transaction's page.
   */
  const openSpeedUp = async (item: SentItem) => {
    const w = getWallet(item.walletId);
    const path = pathOf(item.walletId);
    if (!w || !path || !item.pending.destination || speedBusy) return;
    setSpeedBusy(item.id);
    try {
      let engine;
      try {
        engine = await withTimeout(syncWallet(w, { force: true }), RESCUE_SERVER_MS, 'Sync');
      } catch {
        engine = await getEngine(w); // offline: judged on what the phone has
      }
      const chain = await rescueOnChain(engine, item.pending.sentTxid as string, {
        destination: item.pending.destination,
        olderBlocks: path.olderBlocks,
      });
      setOnChain((map) => ({ ...map, [item.id]: chain }));
      if (chain.state === 'confirmed') {
        tell(RESCUE_ALREADY_CONFIRMED_TITLE);
        return;
      }
      if (chain.state !== 'waiting' || !chain.orig) {
        tell(RESCUE_NOT_REPLACED_TITLE);
        return;
      }
      const tiers = await getFeePresets().catch(() => FALLBACK_PRESETS);
      setSpeedChoice(defaultChoice(replacementRows(chain.orig, 'speedup', tiers)));
      setSpeedCustom('');
      setSpeedSheet({
        plan: { item, orig: chain.orig, destination: item.pending.destination, path, rate: 0, feeSats: 0 },
        presets: tiers,
      });
    } catch (e) {
      tell(replacementBuildNotice(e, 'speedup').title);
    } finally {
      setSpeedBusy(null);
    }
  };

  /**
   * Withdraw a waiting request (decided 2026-11-04: a client who changed
   * their mind, or sent the wrong address, can take it back). Asked first,
   * a title and buttons. The phone forgets its record only on the server's
   * word that nothing will be signed (`forgetAfterCancel`); one signed
   * meanwhile stays, and says so. Once withdrawn the vault is offered again.
   */
  const askCancel = (item: ActiveItem) =>
    setDialog({
      title: item.pending?.replaces ? 'Cancel this speed-up?' : 'Cancel this rescue request?',
      message: '',
      actions: [
        { label: 'Cancel request', destructive: true, onPress: () => void cancelRequest(item) },
        { label: 'Keep it', variant: 'ghost', onPress: () => {} },
      ],
    });

  const cancelRequest = async (item: ActiveItem) => {
    if (cancellingNow.current) return;
    cancellingNow.current = true;
    setCancelling(item.id);
    // The confirmation is still closing: iOS drops a dialog opened over a
    // closing one, so what follows waits for it.
    const closed = new Promise((res) => setTimeout(res, AFTER_MODAL_MS));
    try {
      const s = await withTimeout(loadSession(), RESCUE_SERVER_MS, 'Signing in').catch(() => null);
      const outcome = s ? await cancelRescue(s, item.id) : null;
      if (forgetAfterCancel(outcome)) await removePendingRescue(item.id);
      // Signed meanwhile closed rescue mode: both are read again, or the
      // list would judge the signed one against the mode as it was.
      await Promise.all([refreshActive(), refreshMode()]);
      if (outcome === 'signed' || outcome === 'completed') {
        await closed;
        tell(RESCUE_ALREADY_SIGNED_TITLE);
      } else if (outcome == null) {
        await closed;
        tell('Could not reach 21st Capital');
      }
      // 'not_found': the list has forgotten a request the server no longer has.
    } finally {
      cancellingNow.current = false;
      setCancelling(null);
    }
  };

  /** Open a request from its card: its rows at once, its figures once read. */
  const openRequest = (item: ActiveItem, title: string) => {
    setOpened({ item, title, facts: null });
    void requestFactsOf(item, getWallet(item.walletId), getEngine).then((facts) =>
      setOpened((o) => (o && o.item.id === item.id && o.facts == null ? { ...o, facts } : o)),
    );
  };
  // The sheet belongs to the list: a step that moves on (a late broadcast
  // answer's Sent page) closes it.
  useEffect(() => {
    if (step !== 'select') setOpened(null);
  }, [step]);

  const money = (sats: number) => (btcPrice ? formatFiat(sats, btcPrice, settings.fiat) : formatSats(sats));
  const moneySub = btcPrice ? formatSats : null;
  const amountText = (sats: number) => formatAmount(sats, settings.unit);

  const speedText = speedSheet
    ? replacementSheet({
        kind: 'speedup',
        orig: speedSheet.plan.orig,
        presets: speedSheet.presets,
        choice: speedChoice,
        customText: speedCustom,
        etaPhrase: null,
        cosigned: false,
        signedAgain: RESCUE_SIGNED_AGAIN,
        money,
        moneySub,
        amount: amountText,
      })
    : null;

  /** The sheet's button: the rate is chosen, so the email link goes out and
   *  the steps of a first request take over. */
  const onSpeedPrimary = () => {
    const row = speedText?.selected;
    if (!speedSheet || !row) return;
    const w = getWallet(speedSheet.plan.item.walletId);
    setSpeedSheet(null);
    if (!w) return;
    if (!row.affordable) {
      setTimeout(() => tell('Not enough left for a higher fee'), AFTER_MODAL_MS);
      return;
    }
    const plan = { ...speedSheet.plan, rate: row.buildRate, feeSats: row.feeSats };
    const coins = plan.orig.coins.map(({ txid, vout }) => ({ txid, vout }));
    setVault(w);
    setAvail({
      count: coins.length,
      sats: plan.orig.totalInSats,
      lockedBlocks: null,
      total: coins.length,
      coins,
      rescueFingerprint: plan.path.fingerprint,
    });
    setDestination(plan.destination);
    setAgreed(true);
    setSpeedUp(plan);
    // Busy from here, not from the email: a second tap would send another,
    // which retires the first code.
    setSpeedBusy(plan.item.id);
    setTimeout(() => void emailCode(plan).finally(() => setSpeedBusy(null)), AFTER_MODAL_MS);
  };

  /** Off the code steps, back to the list. */
  const leaveSpeedUp = () => {
    setSpeedUp(null);
    setVault(null);
    setAvail(null);
    setDestination('');
    setAgreed(false);
    setEmailOtp('');
    setTotpCode('');
    setStep('select');
  };

  /**
   * Broadcast 21st Capital's signed rescue, but only once the engine has
   * proven it is the rescue this phone filed (decided 2026-09-26):
   * this vault's coins, paid to the destination recorded HERE at filing (or
   * back to the vault), the very transaction requested when a PSBT was
   * sent, and a sane fee. A request filed before the destination was kept
   * asks the client to confirm the address first. `answers` carries what
   * the client confirmed on the way.
   *
   * Once the network has it, the Sent page shows AT ONCE (2026-10-19:
   * a rescue went out and the screen kept spinning with no success
   * message): telling 21st Capital, the list and the sync all
   * follow it and none of them can hold the screen (`landOnSent`). A
   * broadcast whose answer never comes ends with the watchdog, and the
   * chain is asked whether the rescue is there before anything is said.
   */
  const broadcast = async (
    item: ActiveItem,
    answers: { confirmedScripts?: string[]; acceptHighFee?: boolean } = {},
  ) => {
    const w = getWallet(item.walletId);
    if (!w || !item.server?.signed_tx) return;
    setBroadcasting(item.id);
    /** How this broadcast ends when it does not end on the Sent page. */
    const say = (d: { title: string; message: string; actions: DialogAction[] }) => {
      failureShown.current.set(item.id, d);
      setDialog(d);
    };
    /** The network did not answer: the same title and buttons whichever
     *  step it was (the sync before, the broadcast, the look after). Try
     *  again sends the same signed transaction, harmless if it did go out. */
    const sayNoAnswer = () =>
      say({
        title: NO_ANSWER_TITLE,
        message: '',
        actions: [
          { label: 'Try again', variant: 'primary', onPress: () => void broadcast(item, answers) },
          { label: 'Later', variant: 'ghost', onPress: () => {} },
        ],
      });
    try {
      // Synced, not just loaded: the check below asks which coins are this
      // vault's, and a fresh engine knows none until it has synced.
      const engine = await syncWallet(w, { force: true });
      const bytes = decodeHexOrBase64(item.server.signed_tx);
      if (!bytes) throw new Error('The signed transaction from 21st Capital could not be read.');
      // The txid the network will know it by, from the signed bytes.
      const txid = expectedTxidOf(bytes, w.network);
      const destinationScriptHex = item.pending?.destination
        ? addressToScriptHex(item.pending.destination) ?? undefined
        : undefined;
      const replaced = item.pending?.replaces;
      const expect: RescueExpectation = {
        destinationScriptHex,
        requestTxid: item.pending?.requestTxid,
        confirmedScripts: answers.confirmedScripts,
        acceptHighFee: answers.acceptHighFee,
        replacedCoins: replaced?.coins,
      };
      // Already out (sent from here before, and the answer or the report
      // to 21st Capital was lost): the Sent page, nothing sent twice. But
      // only once it passes the rescue rule as a broadcast would (decided
      // 2026-10-19): the very transaction requested, the destination filed
      // here, a sane fee. Its coins are spent, so the vault's record of the
      // transaction says what they held. A refusal is the same alarm as
      // before it went out, never Sent, never reported Completed.
      const onChain = txid ? await findWalletTx(engine, txid) : null;
      if (onChain) {
        await assertRescueOnChain(engine, signedShape(bytes, w.network), onChain, expect);
        // Its spent coins are no longer listed, so the fee comes from the
        // vault's record of it: the same Sent page as the first time.
        const facts = await rescueFacts(engine, bytes, w.network, replaced?.coins);
        landOnSent(item, w, onChain.txid, { ...facts, feeSats: facts.feeSats ?? onChain.fee ?? null });
        return;
      }
      // A speed-up comes too late once the rescue it replaces is in a block.
      if (replaced && (await findWalletTx(engine, replaced.txid))?.confirmed) {
        forgetTooLateSpeedUp(item);
        tell(RESCUE_ALREADY_CONFIRMED_TITLE);
        return;
      }
      // A rescue whose coins have not waited long enough still assembles,
      // and the network refuses it (decided 2026-10-07): say when
      // it can go instead. The engine was synced just above.
      const wait = await sendTooEarly(engine, bytes, w.network);
      if (wait != null) {
        setDialog({
          title: tooEarlyTitle(wait),
          message: '',
          actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
        });
        return;
      }
      // The signer returns a signed PSBT for script-path spends and the
      // engine finishes it; a raw final transaction goes as it is (the
      // live test 2026-07-24). Either way it is checked first.
      const facts = await rescueFacts(engine, bytes, w.network, replaced?.coins);
      let sent: string;
      /** Every attempt started, one per server tried. */
      const attempts: Array<Promise<string>> = [];
      try {
        // The vault's servers, each with the broadcast watchdog.
        sent = await broadcastWithWatchdog(w.network, settings, (backend) => {
          const attempt = engine.broadcastRescue(bytes, expect, backend);
          attempts.push(attempt);
          return attempt;
        });
      } catch (e) {
        // An attempt the watchdog gave up on still runs natively (it
        // cannot be stopped) and may answer later with the txid: the
        // rescue went out then, whatever was said meanwhile (decided
        // 2026-10-19). The engine checked it before it sent it. Also when
        // the next Testnet4 server then answered with a refusal.
        for (const attempt of attempts) attempt.then((t) => lateAnswer(item, w, t, facts), () => {});
        if (!answerMayBeLost(e)) throw e;
        // No answer, or no server reached: it may be out all the same.
        // The chain says, through the vault's own servers.
        setCheckingChain(item.id);
        const found = txid ? await networkTx(() => syncWallet(w, { force: true }), txid) : null;
        // A late answer came first: its Sent page stands.
        if (sentHere.current.has(item.id)) return;
        if (!found) {
          sayNoAnswer();
          return;
        }
        // On the chain, and the watchdog may have given up before the
        // engine checked it: the same rule before it is called sent.
        await assertRescueOnChain(found.view, signedShape(bytes, w.network), found.tx, expect);
        sent = found.tx.txid;
      }
      landOnSent(item, w, sent, facts);
    } catch (e) {
      // It went out meanwhile (a late answer): nothing else to say.
      if (sentHere.current.has(item.id)) return;
      // The network did not answer before anything was sent (the sync
      // first, the look for it): the same words as when the broadcast's
      // answer was lost, never the servers' own sentence (decided
      // 2026-10-19: Try again while still offline used to turn "No answer
      // from the network" into "Could not broadcast" with a paragraph).
      if (answerMayBeLost(e)) {
        sayNoAnswer();
        return;
      }
      if (e instanceof BroadcastRefusedError && e.refusal.code === 'unconfirmed-destination') {
        // Title and buttons only: the address IS the question.
        const scripts = e.refusal.scripts;
        const addresses = scripts
          .map((h) => scriptToAddress(Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16))), w.network))
          .map((a) => a ?? 'an address Talia cannot read');
        say({
          title: `Send the rescue to ${addresses.join(' and ')}?`,
          message: '',
          actions: [
            {
              label: 'Send',
              variant: 'primary',
              onPress: () => void broadcast(item, { ...answers, confirmedScripts: [...(answers.confirmedScripts ?? []), ...scripts] }),
            },
            { label: 'Cancel', variant: 'ghost', onPress: () => {} },
          ],
        });
        return;
      }
      if (e instanceof BroadcastRefusedError && e.refusal.code === 'high-fee') {
        say({
          title: `The network fee is unusually high: ${formatSats(e.refusal.feeSats)}`,
          message: '',
          actions: [
            { label: 'Send anyway', variant: 'primary', onPress: () => void broadcast(item, { ...answers, acceptHighFee: true }) },
            { label: 'Cancel', variant: 'ghost', onPress: () => {} },
          ],
        });
        return;
      }
      // The network turned it down, in the page's words (as a replacement's
      // broadcast reads at Pending): title and OK. Spent coins say a speed-up
      // came too late, and say nothing so simple of a first rescue.
      if (!(e instanceof BroadcastRefusedError)) {
        const why = replacementBroadcastFailure(e);
        if (why === 'already-confirmed' && item.pending?.replaces) {
          forgetTooLateSpeedUp(item);
          say({
            title: RESCUE_ALREADY_CONFIRMED_TITLE,
            message: '',
            actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
          });
          return;
        }
        if (why === 'fee-too-low') {
          say({
            title: RESCUE_NETWORK_WANTS_MORE_TITLE,
            message: '',
            actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
          });
          return;
        }
      }
      say({
        title: 'Could not broadcast',
        message:
          e instanceof BroadcastRefusedError
            ? `${refusalMessage(e.refusal)} Please contact the recovery team.`
            : (e as Error).message,
        actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
      });
    } finally {
      setBroadcasting(null);
      setCheckingChain(null);
    }
  };

  /**
   * The rescue is on the network: the Sent page now (the same Sent page as
   * every other broadcast, decided 2026-10-02), and everything else after it,
   * none of it awaited (2026-10-19). The request leaves the list at
   * once; the phone's record is marked sent and 21st Capital told
   * (`settleSentRescue`, retried by `reportSentRescues` until it lands);
   * then the list and the vault are read again.
   */
  const landOnSent = (item: ActiveItem, w: WalletMeta, txid: string, facts: SentFacts, show = true) => {
    if (sentHere.current.has(item.id)) return;
    sentHere.current.add(item.id);
    setActive((a) => a.filter((x) => x.id !== item.id));
    if (show) {
      setRescueSent({ walletId: w.id, facts: { ...facts, txids: [txid] } });
      setStep('sent');
    }
    void settleSentRescue(item.id, txid)
      .then(() => forgetReplaced(item))
      .then(() => refreshActive());
    // The coins have left: the vault's row is read again behind the page.
    void syncWallet(w, { force: true })
      .catch(() => {})
      .then(() => {
        const path = pathOf(w.id);
        if (path) void recheck(w, path.olderBlocks);
      });
  };

  /**
   * The answer of a broadcast the watchdog gave up on, come late with its
   * txid (decided 2026-10-19): the rescue went out. Settled as any other
   * (`landOnSent`): marked, reported, off the list. Its Sent page shows
   * when the client is still with this rescue: the dialog its broadcast
   * ended on still open ("No answer from the network", closed for it),
   * its own broadcast running again, or the list with nothing else open.
   * Anywhere else (filing another rescue) the card simply leaves the list.
   */
  const lateAnswer = (item: ActiveItem, w: WalletMeta, txid: string, facts: SentFacts) => {
    if (sentHere.current.has(item.id)) return;
    const shown = now.current;
    const ours = failureShown.current.get(item.id);
    const waiting = ours != null && shown.dialog === ours;
    if (waiting) setDialog((d) => (d === ours ? null : d));
    const show =
      waiting ||
      shown.broadcasting === item.id ||
      (shown.step === 'select' && shown.broadcasting == null && shown.dialog == null);
    landOnSent(item, w, txid, facts, show);
  };

  /**
   * The rescue a speed-up replaces is in a block, so the speed-up can never go
   * out. Its record goes, unawaited like the rest of a broadcast's
   * bookkeeping; 21st Capital's copy of it ends by itself with the 14 days
   * every signed rescue has.
   */
  const forgetTooLateSpeedUp = (item: ActiveItem) => {
    sentHere.current.add(item.id);
    setActive((a) => a.filter((x) => x.id !== item.id));
    void removePendingRescue(item.id).then(() => refreshActive());
  };

  /** A ready vault opens straight into the rescue: the meeting, or the
   *  destination once rescue mode is on. */
  /** Asked for from a vault's own Spending policy (decided 2026-09-23): open it
   *  as soon as its check comes back ready, instead of asking which vault.
   *  A vault that is not ready stays on this step, which says why. */
  const askedFor = route.params?.walletId;
  const openedAsked = useRef(false);
  /**
   * Sent here from ONE vault's Spending policy (decided 2026-09-23: "I want the
   * user to go to the rescue screen of the vault he clicked the rescue from!
   * no need to make him make another section among all vaults again").
   *
   * So this step shows that vault alone, whatever its state. A vault that is
   * ready opens by itself; one that is not stays here and says why, which is
   * the answer to the question the person actually asked. Only someone who
   * arrived with no vault in mind is shown the list.
   */
  const askedVault = askedFor ? rescueVaults.find((x) => x.w.id === askedFor) : undefined;
  const onlyThisVault = !!askedFor && !!askedVault;

  const openVault = (w: WalletMeta, rescueFingerprint: string, ready: Extract<RescueReadiness, { state: 'ready' }>) => {
    setFeePreview(null);
    setVault(w);
    setAvail({
      count: ready.coins.length,
      sats: ready.sats,
      lockedBlocks: null,
      total: ready.coins.length,
      coins: ready.coins,
      rescueFingerprint,
    });
    setStep('review');
  };

  // The vault the Spending policy sent us to opens by itself the moment its
  // own check comes back ready (decided 2026-09-23), once, and never after the
  // person has moved on or gone back to choose another.
  useEffect(() => {
    if (!askedFor || openedAsked.current || step !== 'select') return;
    const row = rescueVaults.find((x) => x.w.id === askedFor);
    const check = row ? checks[row.w.id] : undefined;
    if (!row || !check || check.state !== 'ready') return;
    // Not before the request list is read; and never over a request of this
    // vault, on its way or not (decided 2026-11-04): its card says where it
    // stands, and a cancel or a rejection there does not start a new rescue
    // by itself. The vault's row offers one.
    if (!activeRead) return;
    if (openElsewhere.has(row.w.id) || active.some((a) => a.walletId === row.w.id)) {
      openedAsked.current = true;
      return;
    }
    // Rescue mode is on for another vault: its row says so instead.
    if (mode === 'active' && !coversVault(row.w)) return;
    openedAsked.current = true;
    openVault(row.w, row.rp.fingerprint, check);
  }, [askedFor, checks, step, rescueVaults, mode, coversVault, activeRead, active, openElsewhere]);

  // The fee tiers and the price, read once the page opens, as Send reads them.
  const showsMoney = !settings.btcOnly;
  useEffect(() => {
    let alive = true;
    void getFeePresets().then((p) => {
      if (alive) setPresets(p);
    });
    if (showsMoney) {
      void getBtcPrice(settings.fiat)
        .then((p) => {
          if (alive) setBtcPrice(p);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [settings.fiat, showsMoney]);

  // What the chosen rate pays these coins, from a real build: BDK prices a
  // rescue at the largest witness the coins could need, so the fee cannot be
  // worked out from a rate alone. Until the destination is known the vault's
  // first address stands in for it. Nothing is kept of the build.
  const coinKey = avail?.coins.map((c) => `${c.txid}:${c.vout}`).join(',') ?? '';
  useEffect(() => {
    if (step !== 'review' || !vault || !avail || mode !== 'active' || speedUp) return;
    let alive = true;
    void (async () => {
      try {
        const engine = await walletCalls.current.getEngine(vault);
        const typed = destination.trim();
        const to = addressFitsNetwork(typed, vault.network) ? typed : (await engine.getReceiveAddress(0)).address;
        const built = await engine.buildRescuePsbt({
          utxos: avail.coins,
          destination: to,
          feeRate: chosenRate,
          branchFingerprint: avail.rescueFingerprint,
        });
        if (alive) setFeePreview({ rate: chosenRate, sats: built.feeSats, size: built.feeSats / chosenRate });
      } catch {
        if (alive) setFeePreview({ rate: chosenRate, sats: null, size: null });
      }
    })();
    return () => {
      alive = false;
    };
    // The coins by their ids: `avail` is a new object on every opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, vault, coinKey, mode, destination, chosenRate, speedUp]);

  /** A rate's fee on these coins: the last build's own figure at its rate,
   *  its size standing in at any other (`rescueFeeAt`). */
  const feeAt = (rate: number): number => rescueFeeAt(rate, feePreview, avail?.count ?? 0);

  /**
   * The destination must be a readable address of the vault's own network
   * before anything is filed (decided 2026-09-26): the request used
   * to go out even when the PSBT could not be built for it, and a testnet
   * address pays nobody on mainnet. Title and a button only.
   */
  const refuseDestination = (v: WalletMeta): boolean => {
    const d = destination.trim();
    if (addressFitsNetwork(d, v.network)) return false;
    setDialog({
      title: addressFamily(d) == null ? 'This address could not be read' : 'This address is for another network',
      message: '',
      actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
    });
    return true;
  };

  /** The server said this vault already has a request on its way. */
  const refuseAsOpen = (walletId: string) => setOpenElsewhere((set) => new Set(set).add(walletId));

  /** A title-only dialog with OK (the dialog rule: title and buttons). */
  const tell = (title: string) =>
    setDialog({ title, message: '', actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }] });

  /** Whether an address arriving now may still land: the code step never
   *  shows the address, so one that lands behind it would be filed unseen. */
  const askingFor = (v: WalletMeta) => {
    const shown = now.current;
    return shown.step === 'review' && !shown.busy && shown.vault?.id === v.id;
  };

  /** The destination is pasted or scanned, never typed (decided 2026-10-31
   *  after a phone test), read as Send reads an address, and pasted text reads
   *  the same from the icon or from iOS's own bubble. */
  const takePasted = (raw: string) => {
    if (!vault || !askingFor(vault)) return;
    const read = readSendAddress(raw, vault.network);
    if (read.kind === 'address') setDestination(read.address);
    else tell(refusedAddressTitle(read.kind));
  };

  const pasteDestination = async () => {
    if (!vault) return;
    const raw = await readClipboard().catch(() => '');
    takePasted(raw ?? '');
  };

  const onScannedDestination = (raw: string) => {
    setScanning(false);
    if (!vault || !askingFor(vault)) return;
    const read = readSendAddress(raw, vault.network);
    if (read.kind === 'address') setDestination(read.address);
    else scanRefusal.current = refusedAddressTitle(read.kind);
  };

  const afterScanner = () => {
    if (scanRefusal.current) tell(scanRefusal.current);
    scanRefusal.current = null;
  };

  // The scanner is a window of its own, so it does not leave with the step.
  useEffect(() => {
    if (step !== 'review') setScanning(false);
  }, [step]);

  /** Review step's button: email the consent link, then collect the code.
   *  The page it opens is where the client confirms the destination check —
   *  the rescue cannot be submitted without the code it reveals. */
  const sendCode = async () => {
    if (speedUp) {
      await emailCode(speedUp);
      return;
    }
    if (!vault || !avail || avail.count === 0 || avail.count < avail.total || !destination.trim() || !agreed) return;
    // Only the vault rescue mode is on for (decided 2026-10-05); the review
    // page says which one it is.
    if (!coversVault(vault)) {
      setStep('review');
      return;
    }
    if (refuseDestination(vault)) return;
    // Built now, at the fee on the page: a preview may be of another rate.
    // Coins that cannot pay it stop here, before the email; any other failed
    // build carries on (a rescue is never blocked here).
    setBusy(true);
    try {
      await buildRescue(vault, avail);
    } catch (e) {
      if (isInsufficientFunds(e)) {
        setBusy(false);
        refuseFee();
        return;
      }
    }
    await emailCode(null);
  };

  /** A first request's transaction: exactly the expired coins, on the rescue
   *  key's branch (engine policy-path build), at the fee on the page. */
  const buildRescue = async (w: WalletMeta, coins: NonNullable<typeof avail>) => {
    const engine = await getEngine(w);
    return engine.buildRescuePsbt({
      utxos: coins.coins,
      destination: destination.trim(),
      feeRate: chosenRate,
      branchFingerprint: coins.rescueFingerprint,
    });
  };

  /** The coins cannot pay the fee on the page: a title, back where a lower
   *  one can be chosen. */
  const refuseFee = () => {
    setEmailOtp('');
    setTotpCode('');
    setStep('review');
    tell(RESCUE_COINS_CANNOT_PAY_TITLE);
  };

  /** Email the consent link and go to the code step. A speed-up names the
   *  rescue it replaces: that rescue's signature closed the mode. */
  const emailCode = async (plan: SpeedUpPlan | null) => {
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) {
        if (plan) leaveSpeedUp();
        setDialog({
          title: 'Please log in',
          message: 'Log in to your 21st Capital account to request a rescue.',
          actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
        });
        return;
      }
      await sendRescueOtp(session, plan?.item.id);
      // A new email retires the code before it, and an authenticator code
      // typed against it is no use either.
      setEmailOtp('');
      setTotpCode('');
      setCodeError(null);
      setStep('code');
      // Ask in the background, so the answer is in hand by the time the
      // client has read the email (co-signing does the same).
      has2fa.current = null;
      void fetchProfile(session)
        .then((p) => {
          has2fa.current = p.twoFactorEnabled;
        })
        .catch(() => {
          has2fa.current = null;
        });
    } catch (e) {
      if ((e as Error & { code?: string }).code === 'RESCUE_ALREADY_OPEN') {
        // This vault already has a request on its way (decided 2026-11-04)
        // that this phone holds no record of: back to the list, where the
        // vault is greyed with this title for the rest of the visit.
        if (plan) leaveSpeedUp();
        else if (vault) refuseAsOpen(vault.id);
        setStep('select');
        tell(RESCUE_ALREADY_OPEN_TITLE);
        void refreshActive();
        return;
      }
      if ((e as Error & { code?: string }).code === 'RESCUE_MODE_REQUIRED') {
        // The activation ended (7 days, cancelled from the email, or closed
        // by our team): back to where the page says what to do next.
        if (plan) leaveSpeedUp();
        else setStep('review');
        tell(RESCUE_MODE_ENDED_TITLE);
        void refreshMode();
        return;
      }
      // Off the list only: Resend on the code step keeps the step.
      if (plan && step !== 'code') leaveSpeedUp();
      setDialog({
        title: 'Could not send the email',
        message: (e as Error).message,
        actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
      });
    } finally {
      setBusy(false);
    }
  };

  /** The email code is in. With two-factor on, the authenticator code comes
   *  next on its own step; without it, the request goes now. */
  const afterEmailCode = (code: string) => {
    setCodeError(null);
    if (has2fa.current === true) {
      setTotpCode('');
      setStep('totp');
      return;
    }
    void request('email', { email: code });
  };

  /**
   * File the request. `at` is the step it goes from: the email step (no
   * authenticator code, or two-factor not known yet) or the authenticator
   * step (both codes). Refusals are handled as co-signing handles them
   * (rescueRefusal): a code problem is said under its own field.
   */
  const request = async (at: 'email' | 'totp', typed: { email?: string; totp?: string } = {}) => {
    const code = (typed.email ?? emailOtp).trim();
    const totp = at === 'totp' ? (typed.totp ?? totpCode).trim() : undefined;
    if (!vault || !avail || avail.count === 0 || avail.count < avail.total || !destination.trim() || !agreed || code.length < 6) return;
    // A speed-up's mode closed with the signature; the server judges it.
    if (!speedUp && !coversVault(vault)) {
      setStep('review');
      return;
    }
    if (refuseDestination(vault)) return;
    // Cleared first, so the same refusal twice still clears the boxes.
    setCodeError(null);
    setBusy(true);
    try {
      const session = await loadSession();
      if (!session) {
        setDialog({
          title: 'Please log in',
          message: 'Log in to your 21st Capital account to request a rescue.',
          actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
        });
        return;
      }
      const descriptor = vault.changeDescriptor
        ? `${vault.descriptor}\n${vault.changeDescriptor}`
        : vault.descriptor;
      // Build the UNSIGNED rescue transaction here — the app knows the coins;
      // the signer should only have to sign, not rebuild the wallet. Spends
      // EXACTLY the expired coins via the rescue key's timelocked branch
      // (engine policy-path build). Best-effort: short of a fee the coins
      // cannot pay, a build failure must never block a rescue — 21C can still
      // construct it from the descriptor.
      let requestPsbt: string | undefined;
      if (speedUp) {
        // A speed-up IS its transaction: no build, no request. Refused here,
        // before 21st Capital hears of it, when it is not the same rescue.
        try {
          const engine = await getEngine(vault);
          const result = await buildRescueSpeedUp(engine, speedUp.orig, {
            destination: speedUp.destination,
            path: speedUp.path,
            chosenRate: speedUp.rate,
            feeSats: speedUp.feeSats,
          });
          requestPsbt = result.built.psbtBase64;
        } catch (e) {
          leaveSpeedUp();
          tell(replacementBuildNotice(e, 'speedup').title);
          return;
        }
      } else {
        try {
          requestPsbt = (await buildRescue(vault, avail)).psbtBase64;
        } catch (e) {
          if (isInsufficientFunds(e)) {
            refuseFee();
            return;
          }
          // The independent address check's pause refuses this build too
          // (guardedEngine, ADDRESS_CHECK_FAILED): the vault's own engine never
          // hands over a PSBT the check doubts, and the request still goes,
          // without it, as after any failed build (a rescue is never blocked here).
          requestPsbt = undefined;
        }
      }
      const { id } = await submitRescueRequest(session, {
        descriptor,
        destination: destination.trim(),
        amountSats: avail.sats,
        vaultLabel: vault.label,
        requestPsbt,
        emailOtp: code,
        replaces: speedUp?.item.id,
        // Only when asked for: a client without two-factor sends none.
        totp,
      });
      // The destination and the request's own txid stay on this phone: the
      // signed rescue is checked against THEM before it goes out (decided
      // 2026-09-26), never against the server's copy.
      await savePendingRescue({
        id,
        walletId: vault.id,
        vaultLabel: vault.label,
        createdAt: Date.now(),
        destination: destination.trim(),
        requestTxid: requestPsbt ? unsignedTxid(requestPsbt) ?? undefined : undefined,
        ...(speedUp
          ? {
              replaces: {
                id: speedUp.item.id,
                txid: speedUp.orig.txid,
                coins: speedUp.orig.coins.map(({ txid, vout, valueSats }) => ({ txid, vout, valueSats })),
              },
            }
          : {}),
      });
      setEmailOtp('');
      setTotpCode('');
      setSpeedUpFiled(speedUp != null);
      setSpeedUp(null);
      void refreshActive();
      setStep('done');
    } catch (e) {
      const refusal = rescueRefusal(e as Error & { code?: string }, at);
      if (refusal.kind === 'totp') {
        // Two-factor is on: the email code was not used, so it stays.
        has2fa.current = true;
        setTotpCode('');
        setStep('totp');
        return;
      }
      if (refusal.kind === 'code') {
        // Said under the field of its own step, which clears for another
        // try. A wrong email code takes the client back to it; the
        // authenticator code they typed with it is retired too.
        if (refusal.step === 'email') {
          setEmailOtp('');
          setTotpCode('');
          setStep('code');
        } else {
          setTotpCode('');
          setStep('totp');
        }
        setCodeError(refusal.message);
        return;
      }
      // The code steps submit themselves once six digits land, so a refused
      // code must be CLEARED or the client is left staring at digits that
      // will never resubmit (decided 2026-08-29, when the confirm buttons went).
      setEmailOtp('');
      setTotpCode('');
      // A speed-up has no page of its own to go back to: the list.
      if (speedUp && refusal.kind !== 'other') {
        leaveSpeedUp();
        tell(refusal.title);
        void refreshActive();
        return;
      }
      if (refusal.kind === 'fee' || refusal.kind === 'speed-up') {
        // Back where the fee is chosen. Nothing was filed, and the code was
        // not used, but a new try starts with a new email.
        setStep('review');
        tell(refusal.title);
        return;
      }
      if (refusal.kind === 'open') {
        // Another request for this vault is on its way, of which this phone
        // holds no record: nothing was filed and the code was not used. The
        // vault is greyed with this title for the rest of the visit.
        refuseAsOpen(vault.id);
        setStep('select');
        tell(refusal.title);
        void refreshActive();
        return;
      }
      if (refusal.kind === 'mode') {
        // Rescue mode is on for another vault, or it ended: back to the
        // page that says so, with the server's answer read again.
        setStep('review');
        tell(refusal.title);
        const m = await refreshMode();
        if (refusal.wrongVault) {
          // The server's word on THIS vault, kept for the activation, so
          // the page shows whom rescue mode is on for instead of the same
          // request again (decided 2026-10-05).
          setAgreed(false);
          setRefused(await rememberRefusedVault(vault.id, m ? m.activatedAt : activatedAt));
        }
        return;
      }
      setStep('code');
      setDialog({
        title: 'Could not request rescue',
        message: refusal.message,
        actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
      });
    } finally {
      setBusy(false);
    }
  };

  const dialogNode = dialog ? (
    <AppDialog
      visible
      title={dialog.title}
      message={dialog.message}
      actions={dialog.actions}
      onClose={() => setDialog(null)}
    />
  ) : null;

  /** The review step's first button while rescue mode is off: the in-app
   *  scheduler, the booking page in the browser as the fallback, and a
   *  dialog where neither can be reached. */
  const scheduleMeeting = () => {
    if (!session) {
      setDialog({
        title: 'Please log in',
        message:
          'Log in to your 21st Capital account first (Settings → 21st Capital Account).',
        actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
      });
      return;
    }
    if (bookingToken) {
      setBooking(true);
      return;
    }
    if (bookingUrl) {
      void Linking.openURL(bookingUrl).catch(() => {});
      return;
    }
    setDialog({
      title: 'Booking is not available yet',
      message:
        'The recovery team’s scheduler could not be reached. Please contact 21st Capital and we will arrange the meeting with you.',
      actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
    });
  };

  // All steps render through ONE StepTransition (bottom of the component) so
  // each ceremony step slides like a screen push (decided 2026-07-24).
  /** The vault the rescue went out from; gone from the phone = the list again. */
  const sentVault = rescueSent ? getWallet(rescueSent.walletId) : undefined;
  /** The vault rescue mode is on for, by the client's own name for it when
   *  this phone holds it. */
  const boundName = rescueModeVaultName(
    boundVault,
    // A vault the server refused is not the one, whatever it reads like.
    wallets.filter((w) => !refusedUnder(refused, w.id, activatedAt)),
  );
  /** When 21st Capital can sign the request just filed: the 48 hours. */
  const doneLine = signableLine(modeInfo);
  /** The sent rescues to show: those still waiting, on this page's vault
   *  when the client came from one. */
  const waitingCards = sentItems.filter(
    (s) => onChain[s.id]?.state === 'waiting' && (!onlyThisVault || s.walletId === askedFor),
  );
  /** The requests to show: every one, or this page's vault's alone, where a
   *  request on its way stands in for the vault (decided 2026-11-04). */
  const requestCards = active.filter((item) => !onlyThisVault || item.walletId === askedFor);
  /** The vaults offered: none with a request on its way, and none until the
   *  phone's records are read. */
  const listedVaults = (onlyThisVault ? [askedVault!] : rescueVaults).filter(
    ({ w }) => openVaultIds != null && !openVaultIds.has(w.id),
  );
  const renderStep = (): React.JSX.Element => {

  // ——— Sent: the rescue went out ——————————————————————————————————————
  if (step === 'sent' && rescueSent && sentVault) {
    return (
      // Right under the header, where the signing screen's Sent page sits.
      <Screen scroll underHeader style={styles.sentContent}>
        <SentPage
          wallet={sentVault}
          facts={rescueSent.facts}
          words={sentWords('rescue')}
          actions={[
            {
              // Back to the rescue list, where the OK of the old dialog left it.
              title: 'Done',
              onPress: () => {
                setRescueSent(null);
                setStep('select');
              },
            },
          ]}
        />
      </Screen>
    );
  }

  // ——— Select a vault ————————————————————————————————————————————————
  if (step === 'select' || step === 'sent') {
    return (
      // A list page: nothing of the page's own to tap, so no footer. The
      // request cards keep their own Broadcast and Remove.
      <Screen scroll style={styles.content}>
        {/* Centred, like every page head with an icon over its title (decided
            2026-10-05): PageHead is the one piece. */}
        <PageHead
          icon={<ParachuteIcon size={40} color={theme.colors.gold} />}
          title="Rescue a vault"
          info={{
            title: 'When a rescue is possible',
            // Per coin, like the rows below (decided 2026-09-22): a vault is
            // ready only once the path is open for EVERY coin.
            text: 'A vault with a 21st Capital rescue key has a recovery path for that key, the rescue path. Each coin has its own clock. Once the rescue path is open for every coin, you can ask us to move the whole vault for you with the rescue key. The request shares the vault’s descriptor with us; without it we cannot move anything.',
          }}
          line={
            onlyThisVault
              ? askedVault!.w.label
              : listedVaults.length > 0 || openVaultIds == null
                ? 'Choose the vault to rescue.'
                : undefined
          }
        />
        {(waitingCards.length > 0 || requestCards.length > 0) && (
          <View style={styles.activeWrap}>
            <Text style={styles.sectionLabel}>YOUR RESCUE REQUESTS</Text>
            {waitingCards.map((item) => {
              const chain = onChain[item.id];
              const orig = chain?.state === 'waiting' ? chain.orig : null;
              const w = getWallet(item.walletId);
              return (
                <Card key={item.id} style={styles.card}>
                  <Text style={[styles.state, styles.waiting]}>{RESCUE_WAITING_LINE}</Text>
                  <Text style={styles.rowSub}>{w?.label ?? item.pending.vaultLabel}</Text>
                  {orig && (
                    <Text style={styles.rowSub}>
                      {formatAmount(orig.paymentSats, settings.unit)} · fee {formatSats(orig.feeSats)} ·{' '}
                      {formatFeeRate(orig.feeRate)} sat/vB
                    </Text>
                  )}
                  {orig && item.server?.can_speed_up === true && !speedUpUnderWay(item.id) && (
                    <Button
                      title={speedBusy === item.id && speedUp ? 'Sending…' : 'Speed up'}
                      onPress={() => void openSpeedUp(item)}
                      loading={speedBusy === item.id}
                      disabled={speedBusy != null}
                    />
                  )}
                </Card>
              );
            })}
            {requestCards.map((item) => {
              const ready = item.server?.status === 'signed';
              const done = item.server?.status === 'completed';
              const rejected = item.server?.status === 'rejected';
              const w = getWallet(item.walletId);
              // A request still waiting while rescue mode is no longer on
              // (7 days passed, or our team closed it) can never be signed:
              // it is said, and the client can clear it. Only on the
              // server's word, never because it could not be asked.
              // A speed-up outlives the mode its rescue's signature closed,
              // so the server says for that one.
              const isSpeedUp = !!item.pending?.replaces;
              const lapsed = requestLapsed(item, modeInfo);
              // Still waiting for us: the client can withdraw it (decided
              // 2026-11-04).
              const cancellable = item.server?.status === 'pending' && !lapsed;
              // While it waits out the 48 hours, the one line on when we can
              // sign (decided 2026-10-05).
              const waitLine =
                item.server?.status === 'pending' && !lapsed && w && coversVault(w) ? signableLine(modeInfo) : null;
              const stateText = rejected
                ? 'Rejected by 21st Capital'
                : ready
                  ? 'Signed and ready to broadcast'
                  : done
                    ? 'Sent'
                    : lapsed
                      ? RESCUE_MODE_ENDED_TITLE
                      : 'Waiting for 21st Capital…';
              const vaultName = w?.label ?? item.server?.vault_label ?? 'Vault';
              const head = (
                <>
                  <Text
                    style={[
                      styles.state,
                      rejected ? styles.rejected : ready ? styles.ready : styles.waiting,
                    ]}>
                    {stateText}
                  </Text>
                  <Text style={styles.rowSub}>{vaultName}</Text>
                  {isSpeedUp && <Text style={styles.rowSub}>Speed-up of your rescue</Text>}
                  {waitLine && <Text style={styles.rowSub}>{waitLine}</Text>}
                </>
              );
              // A request still to be signed or broadcast opens, so the client
              // can read its address, amount and fee back on the call
              // (decided 2026-11-03). Only its words are the tap: the card's
              // buttons sit outside it, so a tap on one, enabled or not,
              // never opens the sheet.
              const opens = !rejected && !done && item.server?.status !== 'cancelled';
              // With no button under it, the tap reaches the card's foot too.
              const buttonsBelow = lapsed || ready || cancellable;
              return (
                <Card key={item.id} style={styles.card}>
                  {opens ? (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => openRequest(item, stateText)}
                      style={[styles.requestTap, !buttonsBelow && styles.requestTapLast]}
                      accessibilityRole="button"
                      accessibilityHint="Shows its address, amount and fee">
                      <View style={styles.requestLines}>{head}</View>
                      <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                    </TouchableOpacity>
                  ) : (
                    head
                  )}
                  {cancellable && (
                    <Button
                      title={cancelling === item.id ? 'Cancelling…' : 'Cancel request'}
                      variant="ghost"
                      onPress={() => askCancel(item)}
                      loading={cancelling === item.id}
                      disabled={cancelling != null}
                    />
                  )}
                  {lapsed && (
                    <Button
                      title="Remove from this list"
                      variant="ghost"
                      onPress={() => {
                        void (async () => {
                          // Withdrawn at 21st Capital first, and forgotten
                          // here only on the server's word that nothing
                          // will be signed (decided 2026-10-05). A request
                          // signed meanwhile keeps its record: the signed
                          // rescue is checked against it before it goes out
                          // (decided 2026-09-26), and the refresh shows it ready.
                          const s = await loadSession();
                          const outcome = s ? await cancelRescue(s, item.id) : null;
                          if (forgetAfterCancel(outcome)) await removePendingRescue(item.id);
                          else if (outcome == null) tell('Could not reach 21st Capital');
                          await refreshActive();
                        })();
                      }}
                    />
                  )}
                  {rejected && (
                    <>
                      <Text style={styles.emptySub}>
                        {isSpeedUp
                          ? 'Nothing new was signed. The rescue you already sent is not affected.'
                          : 'Nothing was signed and no money has moved. Your coins are where they were. You can start a new rescue whenever you need to.'}
                      </Text>
                      {!!item.server?.rejection_reason && (
                        <Text style={styles.emptySub}>{item.server.rejection_reason}</Text>
                      )}
                      <Button
                        title="Remove from this list"
                        variant="ghost"
                        onPress={() => {
                          void (async () => {
                            await removePendingRescue(item.id);
                            await refreshActive();
                          })();
                        }}
                      />
                    </>
                  )}
                  {ready && (
                    <Button
                      title={
                        broadcasting !== item.id
                          ? 'Broadcast rescue'
                          : checkingChain === item.id
                            ? CHECKING_TITLE
                            : 'Broadcasting…'
                      }
                      onPress={() => void broadcast(item)}
                      loading={broadcasting === item.id}
                      disabled={broadcasting != null}
                    />
                  )}
                </Card>
              );
            })}
          </View>
        )}
        {rescueVaults.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.emptySub}>None of the vaults on this phone has a 21st Capital rescue key.</Text>
          </Card>
        ) : (
          listedVaults.map(({ w, rp }) => {
            const check = checks[w.id] ?? { state: 'checking' };
            // Nothing at all for the real network (decided 2026-09-23: "I dont
            // want client to see mainnet written anywhere"); a rehearsal
            // vault says so.
            const net = networkNote(w.network);
            const lead = net ? `${net} · ` : '';
            // A rescue on its way is what this row says, whatever the coins
            // read: they empty the vault, or a look may not have caught up.
            if (waitingRescue(w.id)) {
              return (
                <Card key={w.id} style={styles.vaultRow}>
                  <View style={styles.vaultBody}>
                    <Text style={[styles.vaultName, styles.vaultNameOff]}>{w.label}</Text>
                    <Text style={[styles.rowSub, styles.rowSubOff]}>
                      {lead}{RESCUE_WAITING_LINE}
                    </Text>
                  </View>
                </Card>
              );
            }
            // The server holds a request for it this phone has no record of
            // (decided 2026-11-04): said, and not a button.
            if (openElsewhere.has(w.id)) {
              return (
                <Card key={w.id} style={styles.vaultRow}>
                  <View style={styles.vaultBody}>
                    <Text style={[styles.vaultName, styles.vaultNameOff]}>{w.label}</Text>
                    <Text style={[styles.rowSub, styles.rowSubOff]}>
                      {lead}{RESCUE_ALREADY_OPEN_TITLE}
                    </Text>
                  </View>
                </Card>
              );
            }
            // Only a vault whose rescue path has opened for EVERY coin can
            // go on (decided 2026-09-21). The rest are greyed IN COLOUR, never with
            // opacity, and are not buttons at all.
            // While rescue mode is on for another vault, a ready vault is
            // not offered (decided 2026-10-05): greyed, saying which one it is on
            // for, and not a button (decided 2026-10-05).
            if (check.state === 'ready' && mode === 'active' && !coversVault(w)) {
              return (
                <Card key={w.id} style={styles.vaultRow}>
                  <View style={styles.vaultBody}>
                    <Text style={[styles.vaultName, styles.vaultNameOff]}>{w.label}</Text>
                    <Text style={[styles.rowSub, styles.rowSubOff]}>
                      {lead}{otherVaultLine(boundName)}
                    </Text>
                  </View>
                </Card>
              );
            }
            if (check.state === 'ready') {
              return (
                <TouchableOpacity key={w.id} activeOpacity={0.7} onPress={() => openVault(w, rp.fingerprint, check)}>
                  <Card style={styles.vaultRow}>
                    <View style={styles.vaultBody}>
                      <Text style={styles.vaultName}>{w.label}</Text>
                      <Text style={styles.rowSub}>
                        {lead}<Text style={styles.readyWord}>Ready to rescue</Text>
                      </Text>
                    </View>
                    <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                  </Card>
                </TouchableOpacity>
              );
            }
            if (check.state === 'error') {
              return (
                <TouchableOpacity key={w.id} activeOpacity={0.7} onPress={() => void recheck(w, rp.olderBlocks)}>
                  <Card style={styles.vaultRow}>
                    <View style={styles.vaultBody}>
                      <Text style={styles.vaultName}>{w.label}</Text>
                      <Text style={styles.rowSub}>{lead}Could not check. Tap to try again.</Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            }
            const sub =
              check.state === 'checking'
                ? 'Checking…'
                : check.state === 'empty'
                  ? 'No coins in this vault'
                  : // A rescue needs every coin, so this is the LAST coin's
                    // opening, not a path's first: its own words, never
                    // "Opens in" (decided 2026-09-22).
                    `Ready to rescue in \u2248 ${formatBlocksDuration(check.blocks)}`;
            return (
              <Card key={w.id} style={styles.vaultRow}>
                <View style={styles.vaultBody}>
                  <Text style={[styles.vaultName, styles.vaultNameOff]}>{w.label}</Text>
                  <Text style={[styles.rowSub, styles.rowSubOff]}>
                    {lead}{sub}
                  </Text>
                </View>
                {check.state === 'checking' && <ActivityIndicator color={theme.colors.gold} />}
              </Card>
            );
          })
        )}
        {dialogNode}
      </Screen>
    );
  }

  // ——— Review + request ——————————————————————————————————————————————
  if (step === 'review' && vault && avail) {
    /** A rate's fee as the sheet's two figures. */
    const feeMoney = (rate: number) => ({ main: money(feeAt(rate)), sub: moneySub?.(feeAt(rate)) ?? null });
    // Only a vault whose rescue path has opened for EVERY coin gets here (the
    // first page greys the rest, decided 2026-09-21), so this step never has to
    // say "not yet" or count coins.
    return (
      // The step's actions in the pinned footer (decided 2026-10-05): what the
      // mode allows first (Request rescue, the meeting, or the recovery
      // team's address while the meeting is booked), Back last.
      <Screen
        scroll
        style={styles.content}
        footer={
          <>
            {mode === 'active' ? (
              <Button
                title={busy ? 'Sending…' : 'Request rescue'}
                onPress={() => void sendCode()}
                loading={busy}
                disabled={busy || !destination.trim() || !agreed}
              />
            ) : mode !== 'scheduled' ? (
              <Button title="Schedule the rescue meeting" onPress={scheduleMeeting} />
            ) : (
              <Button
                title="Email recovery@21stcapital.com"
                variant="ghost"
                onPress={() => void Linking.openURL('mailto:recovery@21stcapital.com')}
              />
            )}
            <Button title="Back" variant="ghost" onPress={() => setStep('select')} disabled={busy} />
          </>
        }>
        <Text style={styles.title}>{vault.label}</Text>

        {mode !== 'active' ? (
          <>
            {mode === 'scheduled' ? (
              <Card style={styles.card}>
                <Text style={styles.gateTitle}>Rescue Mode is activated</Text>
                <Text style={styles.body}>
                  Please follow our team’s instructions in your scheduled
                  meeting.
                </Text>
              </Card>
            ) : (
              <Card style={styles.card}>
                <InfoHeading
                  title="Why a meeting first"
                  text="In the meeting our recovery team tries every other way to restore your access. They activate rescue mode with you only if nothing else works."
                  style={styles.gateTitle}>
                  A rescue starts with a meeting
                </InfoHeading>
                <Text style={styles.body}>
                  The rescue path is open for every coin in this vault. A rescue
                  is still the last resort.
                </Text>
              </Card>
            )}
          </>
        ) : !coversVault(vault) ? (
          // Rescue mode is on for ONE vault, and it is not this one (decided
          // 2026-10-05): nothing to request here.
          <Card style={styles.card}>
            <Text style={styles.gateTitle}>{otherVaultLine(boundName)}</Text>
            <Text style={styles.body}>Only that vault can be rescued now.</Text>
            <Button
              title="Email recovery@21stcapital.com"
              variant="ghost"
              onPress={() => void Linking.openURL('mailto:recovery@21stcapital.com')}
            />
          </Card>
        ) : (
          <>
            <Card style={styles.amountCard}>
              <Text style={styles.detailLabel}>The whole vault moves</Text>
              <Text style={styles.amount}>{formatBtc(avail.sats)}</Text>
              <Text style={styles.amountSats}>{formatSats(avail.sats)}</Text>
            </Card>

            <Text style={styles.sectionLabel}>SEND ALL RESCUED COINS TO</Text>
            <AddressField
              address={destination}
              locked={busy}
              onPaste={() => void pasteDestination()}
              onPasted={takePasted}
              onScan={() => setScanning(true)}
              onReplace={() => setDestination('')}
            />
            {/* The field cuts a long address in the middle; this is the
                whole of it, as on Send. */}
            {!!destination && (
              <View style={styles.verifyBlock}>
                <Text style={styles.verifyLabel}>VERIFY ADDRESS</Text>
                <AddressChunks address={destination} />
              </View>
            )}
            <InfoHeading
              title="When the fee is set"
              text="The fee is set now, and the rescue goes out later. If it is slow to confirm then, a speed-up may be offered on this page."
              style={styles.sectionLabel}>
              PRIORITY
            </InfoHeading>
            <TouchableOpacity
              style={styles.selectField}
              onPress={() => setFeeOpen(true)}
              disabled={busy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Change the priority">
              <Text style={styles.selectText}>
                {priorityLabel(priority)} ≈ {money(feeAt(chosenRate))}
              </Text>
              <View style={styles.chevronDown}>
                <ChevronRightIcon size={20} color={theme.colors.slate} />
              </View>
            </TouchableOpacity>
            <View style={styles.payRows}>
              <FactRow
                label="Network fee"
                value={formatSats(feeAt(chosenRate))}
                sub={`${formatFeeRate(chosenRate)} sat/vB`}
              />
              <FactRow label="Arrives" value={formatBtc(Math.max(0, avail.sats - feeAt(chosenRate)))} />
            </View>
            <Text style={styles.warn}>
              This moves the whole vault to this address and cannot be reversed.
              Make absolutely sure you control it. Once sent, the funds are out of
              the rescue service.
            </Text>

            <ConsentCheckbox
              checked={agreed}
              onChange={setAgreed}
              label="I understand that requesting a rescue shares my vault’s full descriptor with 21st Capital. That is part of the rescue procedure: 21st Capital only signs on air-gapped, highly secure hardware, which requires the full descriptor to be registered."
            />
            {/* The Priority choice: Send's own sheet, High preselected. */}
            <FeeSheet
              visible={feeOpen}
              onClose={() => setFeeOpen(false)}
              title="Priority"
              rows={priorityRows({
                presets,
                priority,
                money: feeMoney,
                onPick: (tier) => {
                  setPriority(tier);
                  setFeeOpen(false);
                },
              })}
              custom={priorityCustom({
                presets,
                priority,
                customRate,
                money: feeMoney,
                onCustomRate: setCustomRate,
                onPick: setPriority,
              })}
            />
          </>
        )}
        {dialogNode}
      </Screen>
    );
  }

  // ——— Consent-gated code ————————————————————————————————————————————
  if (step === 'code' && vault && avail) {
    return (
      // The code submits itself (CodeField); Back is the one button, in the footer.
      <Screen
        scroll
        style={styles.content}
        footer={
          <Button
            title="Back"
            variant="ghost"
            onPress={() => {
              setCodeError(null);
              if (speedUp) leaveSpeedUp();
              else setStep('review');
            }}
            disabled={busy}
          />
        }>
        {/* Not "one confirmation left": with two-factor on, the
            authenticator code still follows (decided 2026-10-05). */}
        <Text style={styles.title}>Check your email</Text>
        {speedUp ? (
          <>
            <Text style={styles.body}>
              We emailed you a secure link. Open it and confirm you have checked the
              destination address below. This speed-up sends the same coins there at
              a higher fee. The page then shows your 6-digit code.
            </Text>
            <View style={styles.verifyBlock}>
              <Text style={styles.verifyLabel}>VERIFY ADDRESS</Text>
              <AddressChunks address={speedUp.destination} />
            </View>
          </>
        ) : (
          <Text style={styles.body}>
            We emailed you a secure link. Open it and confirm you have checked the
            destination address. The rescue sends everything this vault holds there.
            The page then shows your 6-digit code.
          </Text>
        )}
        <CodeField
          label="Code from the confirmation page"
          // Read off the page, never emailed: nothing for the phone to offer,
          // and the Paste button belongs here.
          oneTimeCode={false}
          value={emailOtp}
          onChange={setEmailOtp}
          onComplete={(c) => afterEmailCode(c)}
          onAlternative={() => void sendCode()}
          alternativeLabel="Resend the email"
          busy={busy}
          busyLabel="Requesting…"
          error={codeError ?? undefined}
        />
        {dialogNode}
      </Screen>
    );
  }

  // ——— Authenticator code: co-signing's own step ——————————————————————
  if (step === 'totp' && vault && avail) {
    return (
      <Screen
        scroll
        style={styles.content}
        footer={
          <Button
            title="Back"
            variant="ghost"
            onPress={() => {
              setCodeError(null);
              setStep('code');
            }}
            disabled={busy}
          />
        }>
        <AuthenticatorStep
          tag="STEP 2 OF 2 · AUTHENTICATOR"
          value={totpCode}
          onChange={setTotpCode}
          // The completed value, not the not-yet-applied state.
          onComplete={(c) => void request('totp', { totp: c })}
          busy={busy}
          busyLabel="Requesting…"
          error={codeError ?? undefined}
        />
        {dialogNode}
      </Screen>
    );
  }

  // ——— Done ——————————————————————————————————————————————————————————
  return (
    // A result page: centred, like the Sent page; Done in the footer.
    <Screen scroll style={styles.content} footer={<Button title="Done" onPress={() => navigation.goBack()} />}>
      {speedUpFiled ? (
        <PageHead
          icon={<ParachuteIcon size={40} color={theme.colors.positive} />}
          title="Speed-up requested"
          line="We’ll email you when the new rescue transaction is signed and ready to broadcast."
        />
      ) : (
        <PageHead
          icon={<ParachuteIcon size={40} color={theme.colors.positive} />}
          title="Rescue requested"
          line="We’ll email you when the rescue transaction is signed and ready to broadcast."
        />
      )}
      {doneLine && <Text style={styles.doneLine}>{doneLine}</Text>}
      {dialogNode}
    </Screen>
  );
  };

  const stepKey =
    step === 'sent' && rescueSent && sentVault
      ? 'sent'
      : step === 'select' || step === 'sent'
        ? 'select'
        : step === 'review' && vault && avail
          ? 'review'
          : step === 'code' && vault && avail
            ? 'code'
            : step === 'totp' && vault && avail
              ? 'totp'
              : 'done';
  const emailLocal = (session?.email ?? '').split('@')[0] || 'Talia';
  const openedVault = opened ? getWallet(opened.item.walletId) : undefined;
  return (
    <>
      <StepTransition stepKey={stepKey} order={['select', 'review', 'code', 'totp', 'done', 'sent']} style={styles.flexOne}>
        {renderStep()}
      </StepTransition>
      <BookingSheet
        visible={booking}
        token={bookingToken}
        title="Rescue meeting"
        subtitle="Our recovery team will go through every other option with you first."
        contact={{
          firstName: session?.firstName || emailLocal,
          lastName: session?.lastName || '(Talia app)',
          email: session?.email ?? '',
        }}
        details={vault ? `Rescue meeting for vault "${vault.label}" (booked in-app)` : 'Rescue meeting (booked in-app)'}
        onClose={() => setBooking(false)}
        onBooked={() => void onMeetingBooked()}
      />
      {/* Speed up: Send's own sheet (one FeeSheet, never a copy). */}
      {speedSheet && speedText && (
        <FeeSheet
          visible
          onClose={() => setSpeedSheet(null)}
          title={speedText.title}
          caption={speedText.caption}
          rows={speedText.rows.map((r) => ({ ...r, onPress: () => setSpeedChoice(r.key) }))}
          custom={{
            value: speedCustom,
            onChangeText: (t) => {
              setSpeedCustom(t);
              setSpeedChoice('custom');
            },
            onFocus: () => setSpeedChoice('custom'),
            onPress: () => setSpeedChoice('custom'),
            ...speedText.custom,
          }}
          footer={speedText.footer.map((line) => (
            <InfoHeading key={line.text} style={feeSheetStyles.meta} title={line.infoTitle} text={line.info}>
              {line.text}
            </InfoHeading>
          ))}>
          <View style={styles.sheetGap} />
          <Button title={speedText.button} onPress={onSpeedPrimary} disabled={!speedText.selected} />
        </FeeSheet>
      )}
      {opened && (
        <RescueRequestSheet
          visible
          title={opened.title}
          vaultName={openedVault?.label ?? opened.item.server?.vault_label ?? 'Vault'}
          destination={opened.item.pending?.destination?.trim() || null}
          askedOn={
            opened.item.pending?.createdAt
              ? rescueWhen(new Date(opened.item.pending.createdAt).toISOString())
              : rescueWhen(opened.item.server?.created_at)
          }
          facts={opened.facts}
          unit={settings.unit}
          masked={settings.hideBalances || !!openedVault?.balanceHidden}
          onClose={() => setOpened(null)}
        />
      )}
      <AppModal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)} onDismiss={afterScanner}>
        <QrScanner hint="Scan a Bitcoin address" onScanned={onScannedDestination} onCancel={() => setScanning(false)} />
      </AppModal>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // No bottom padding of its own: the Screen pads for its footer, or the
    // safe area on the list.
    content: { gap: theme.spacing.md },
    // The Sent page fills the screen: its sub line and actions sit at the foot.
    sentContent: { flexGrow: 1 },
    flexOne: { flex: 1 },
    gateTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
    // The page head (the parachute over the title and its line) is
    // PageHead's, centred (decided 2026-10-05); `title` and `body` serve the steps.
    title: { ...theme.typography.title, color: theme.colors.offWhite },
    body: { ...theme.typography.body, color: theme.colors.slate },
    // The done page's second line, centred under its PageHead.
    doneLine: { ...theme.typography.body, color: theme.colors.slate, textAlign: 'center' },
    card: { gap: theme.spacing.sm },
    // A request card's words as one tap, out to the card's edges: the card's
    // padding is part of it, so the whole top of the card answers.
    requestTap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginTop: -theme.spacing.lg,
      marginHorizontal: -theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingHorizontal: theme.spacing.lg,
    },
    requestTapLast: { marginBottom: -theme.spacing.lg, paddingBottom: theme.spacing.lg },
    requestLines: { flex: 1, gap: theme.spacing.sm },
    amountCard: { gap: theme.spacing.xs },
    rowSub: { ...theme.typography.caption, color: theme.colors.slate },
    emptySub: { ...theme.typography.body, color: theme.colors.slate },
    activeWrap: { gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
    state: { ...theme.typography.label },
    ready: { color: theme.colors.positive },
    rejected: { color: theme.colors.negative },
  waiting: { color: theme.colors.slate },
    vaultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    vaultBody: { gap: 2, flexShrink: 1 },
    vaultName: { ...theme.typography.heading, color: theme.colors.offWhite },
    vaultNameOff: { color: theme.colors.faint },
    rowSubOff: { color: theme.colors.faint },
    readyWord: { color: theme.colors.positive },
    detailLabel: { ...theme.typography.caption, color: theme.colors.slate },
    amount: { ...theme.typography.heading, color: theme.colors.offWhite },
    amountSats: { ...theme.typography.caption, color: theme.colors.slate },
    sectionLabel: {
      ...theme.typography.label,
      color: theme.colors.slate,
      letterSpacing: 1,
      marginTop: theme.spacing.md,
    },
    // Send's Verify block, measure for measure.
    verifyBlock: { marginTop: theme.spacing.xl, gap: theme.spacing.sm },
    verifyLabel: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.5 },
    warn: { ...theme.typography.caption, color: theme.colors.negative },
    // Send's Priority field, measure for measure.
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
    selectText: { ...theme.typography.heading, color: theme.colors.offWhite, flexShrink: 1 },
    chevronDown: { transform: [{ rotate: '90deg' }] },
    payRows: { gap: theme.spacing.xs },
    sheetGap: { height: theme.spacing.md },
  }),
);
