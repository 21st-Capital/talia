/**
 * Transaction detail — banking-style: big signed amount (+USD when available),
 * the status card, details card (fee, txid, explorer link, local note), and
 * the raw data under Advanced.
 *
 * Speed up and Cancel (decided 2026-09-28, design Option A): the status card is a
 * Card in every state (`TxStatusCard`, words in `txStatusModel`); a waiting
 * payment of this vault offers Speed up and "Cancel payment" where the core
 * says it can be replaced (`wallet/replacement.ts`) AND where Send is
 * offered. Both open the shared `FeeSheet` (words in `replacementSheet`); a
 * speed-up goes straight to the signing ceremony, a cancel through one
 * dialog first. A transaction the sync forgot because it was replaced, and a
 * replacement the phone has not picked up yet, open from Talia's own record
 * (`txRecordInfo`), never "Loading..." forever.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import {
  Screen,
  Card,
  TextField,
  Button,
  AppDialog,
  ChevronRightIcon,
  HeaderBackButton,
  HeaderIconButton,
  IosShareIcon,
  FactRow,
  FitText,
  FeeSheet,
  feeSheetStyles,
  InfoHeading,
  TxStatusCard,
} from '../components';
import { etaInfoText, standInTx, txNoun, txRecordInfo, txStatusView } from '../components/txStatusModel';
import type { TxRecordInfo } from '../components/txStatusModel';
import {
  CANCEL_INFO,
  CANCEL_LINE,
  CANCEL_TITLE,
  cancelFacts,
  defaultChoice,
  replacementBuildNotice,
  replacementSheet,
} from './replacementSheet';
import type { SheetChoice } from './replacementSheet';
import { getFeePresets, FALLBACK_PRESETS, formatFeeRate } from '../../wallet/feeEstimates';
import type { FeePresets } from '../../wallet/feeEstimates';
import { withTimeout } from '../../wallet/withTimeout';
import { theme, themedStyles } from '../theme';
import {
  useWallets,
  formatSats,
  formatAmount,
  getTxNote,
  setTxNote,
  loadTxCache,
  getBtcPrice,
  formatFiat,
  isSelfTransfer,
  sendAccess,
  providerKeysOf,
  explorerTxUrl,
  loadReplacementContext,
  replacementEligibility,
  originalOf,
  feeRateOf,
  replacementRows,
  buildReplacement,
  replacementRecord,
  ReplacementError,
  getTxEta,
  getTxReplacements,
  planTxReplacement,
  getSentAt,
  noteWaiting,
} from '../../wallet';
import type { OriginalTx, ReplacementEligibility, ReplacementKind, ReplacementRow } from '../../wallet';
import { minOlderBlocks } from '../../bitcoin/descriptor';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { parseRawTransaction } from '../../bitcoin/rawTx';
import { explorerApiFor, fetchSpentCoinAddresses } from '../../services/txPrevouts';
import type { RawTxInfo } from '../../bitcoin/rawTx';
import type { WalletTx } from '../../bitcoin/engine/types';
import { copyToClipboard } from '../../platform/clipboard';
import { shareText } from '../../platform/files';
import { HWW_ENABLED, LEDGER_PREVIEW, SIGNING_ENABLED } from '../../config';

/** Modals dismiss before the next one opens or a push happens, or iOS
 *  swallows it (the repo's known modal-stacking trap, found 2026-08-26). */
const AFTER_MODAL_MS = 450;

type Props = NativeStackScreenProps<RootStackParamList, 'TxDetail'>;

function formatBtcSigned(sats: number): string {
  const btc = sats / 1e8;
  return `${btc < 0 ? '-' : '+'}${Math.abs(btc).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
}

/** The replacement a sheet is choosing a fee for. */
interface SheetState {
  kind: ReplacementKind;
  orig: OriginalTx;
  presets: FeePresets;
}

/** An unsure page (the vault has not picked the transaction up yet) reads
 *  again every few seconds, for about two minutes at most. */
const UNSURE_RETRY_MS = 4000;
const UNSURE_RETRIES = 30;
/**
 * A replacement not picked up yet: the reads that ask the network, at once
 * and then after about 4, 12, 24, 40, 60, 84 and 112 seconds. The network
 * usually has it within seconds; a page left open should not keep a server
 * busy (every sync opens a connection of its own, decided 2026-09-28).
 */
const ASK_AT_READS = new Set([0, 1, 3, 6, 10, 15, 21, 28]);

export function TxDetailScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId, txid } = route.params;
  const { getWallet, getEngine, syncWallet, settings } = useWallets();
  const wallet = getWallet(walletId);
  const { providerFps: known21C } = useProviderFingerprints(wallet);
  /** Speed up and Cancel only where Send is (decided 2026-09-18: no spend screen
   *  unless Talia KNOWS the hardware), never on an heir's phone (the
   *  everyday path is the owner's to sign), and never for a hand-kept
   *  portfolio. */
  const canSend = useMemo(
    () =>
      !!wallet &&
      !wallet.manual &&
      !wallet.heirVault &&
      (SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED && sendAccess(wallet, known21C) === 'ready')),
    [wallet, known21C],
  );
  /** 21st Capital co-signs this vault's everyday path: a replacement goes
   *  through the ceremony again, and the sheet says so (decided 2026-09-28). The
   *  same rule Send uses for its limits line. */
  const cosigned = useMemo(() => {
    if (!wallet || wallet.heirVault || wallet.manual) return false;
    try {
      return providerKeysOf(wallet.descriptor, known21C).some((k) => k.role !== 'rescue');
    } catch {
      return false;
    }
  }, [wallet, known21C]);

  const [tx, setTx] = useState<WalletTx | null>(null);
  /** A read proved it missing (a synced engine, no record): not "Loading…". */
  const [loaded, setLoaded] = useState(false);
  /** What Talia's own records say about this transaction. */
  const [records, setRecords] = useState<TxRecordInfo | null>(null);
  /** When Talia broadcast it (ms), from its own stamp; null when unknown. */
  const [stampedSentAt, setStampedSentAt] = useState<number | null>(null);
  /** A waiting payment not sent from this phone: when this phone first saw it waiting. */
  const [firstSeenAt, setFirstSeenAt] = useState<number | null>(null);
  const [tip, setTip] = useState<number | undefined>(undefined);
  const [usd, setUsd] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Raw numbers stay behind a collapsed "Advanced" chevron (BlueWallet-style).
  const [advOpen, setAdvOpen] = useState(false);
  // Consensus-level details parsed from the raw transaction (BlueWallet parity).
  const [rawInfo, setRawInfo] = useState<RawTxInfo | null>(null);
  const [toAddress, setToAddress] = useState<string | null>(null);
  const [hexCopied, setHexCopied] = useState(false);
  /** Bumped to read everything again (after a check found the page stale). */
  const [reloadKey, setReloadKey] = useState(0);
  /** How many times an unsure page has read the vault again, and the timer. */
  const unsureRetries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // Speed up and Cancel.
  const [eligibility, setEligibility] = useState<ReplacementEligibility | null>(null);
  /** What the transaction pays per vB (its REAL size), for the ETA line. */
  const [feeRate, setFeeRate] = useState<number | null>(null);
  /** "about 3 hours"; null when there is nothing true to say. */
  const [etaPhrase, setEtaPhrase] = useState<string | null>(null);
  /** The card's Speed up or Cancel is checking or building. */
  const [busy, setBusy] = useState<ReplacementKind | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [choice, setChoice] = useState<SheetChoice>('fast');
  const [customText, setCustomText] = useState('');
  const [building, setBuilding] = useState(false);
  /** The cancel to confirm: the dialog's facts and the rate it builds at. */
  const [cancelAsk, setCancelAsk] = useState<{ orig: OriginalTx; row: ReplacementRow } | null>(null);
  /** A title and OK, never a paragraph (house rule). */
  const [notice, setNotice] = useState<{ title: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!wallet) return;
      const engine = await getEngine(wallet);
      const txs = await engine.listTransactions();
      const list = await getTxReplacements(walletId);
      // A cold engine (nothing synced yet this launch) lists nothing, and
      // read against nothing a cancel that came too late looks like one on
      // its way back: read the records against the vault's last known list
      // instead, the one its rows show (decided 2026-09-28).
      const known = engine.getTipHeight() == null ? (await loadTxCache(walletId)) ?? txs : txs;
      const info = txRecordInfo(list, walletId, txid, known);
      if (!alive) return;
      // A replacement whose original confirmed first will vanish: the
      // original's page says what happened ("The cancel came too late").
      if (info.showInstead) {
        // A page under another one waits: a screen's pop and replace act on
        // the page on TOP, and would close the one the client is reading.
        // It reads again when the client comes back to it (the focus
        // listener below), and moves then (decided 2026-09-28).
        if (!navigation.isFocused()) return;
        // Opened from the original's own page (its "See the return"): go
        // back to it, where it now reads again, rather than stack a second
        // copy of it over the first (decided 2026-09-28).
        const nav = navigation.getState();
        const here = nav.routes.findIndex((r) => r.key === route.key);
        const below = here > 0 ? nav.routes[here - 1] : undefined;
        const was = below?.params as { walletId?: string; txid?: string } | undefined;
        if (
          below?.name === 'TxDetail' &&
          was?.walletId === walletId &&
          was.txid?.toLowerCase() === info.showInstead.toLowerCase()
        ) {
          navigation.pop();
        } else {
          navigation.replace('TxDetail', { walletId, txid: info.showInstead });
        }
        return;
      }
      const listed = txs.find((t) => t.txid === txid) ?? null;
      // Replaced and already forgotten by the sync: drawn from the record.
      let found = listed ?? (info.replacedRecord ? standInTx(info.replacedRecord) : null);
      // "Not in this vault" is proven only by a synced engine with no record
      // of this txid. A cold engine (nothing synced yet this launch: the
      // vault screen paints its cached list first) or a replacement Talia
      // sent that the engine has not picked up yet is still loading: show
      // the vault's last known copy when it has one, else "Loading…" until
      // the vault's next sync gives the page a fresh wallet to read again.
      const unsure = engine.getTipHeight() == null || info.state.kind === 'replacement';
      if (!found && unsure) {
        const cached = await loadTxCache(walletId);
        found = cached?.find((t) => t.txid === txid) ?? null;
      }
      // A Speed up or a Cancel Talia sent that the phone has not picked up
      // yet: drawn from Talia's own record, so "See the return" opens on the
      // return and never on an empty "Loading…" (decided 2026-09-28).
      if (!found && info.standIn) found = info.standIn.tx;
      if (!alive) return;
      setTx(found);
      setRecords(info);
      setTip(engine.getTipHeight());
      setLoaded(!!found || !unsure);
      // Not in the vault's list yet: look again shortly, until it is. A
      // replacement Talia just sent is only picked up by a SYNC, and the one
      // right after its broadcast can come before the network reports it
      // (decided 2026-09-28: sent at 18:06, still "Loading…" at 18:08), so the
      // page asks the network itself, at once and then every few seconds.
      // A cold engine is being synced by the vault screen: reading it again
      // is enough. Bounded, so a page left open stops asking.
      if (!listed && unsure && unsureRetries.current < UNSURE_RETRIES) {
        const n = unsureRetries.current;
        const ask = info.state.kind === 'replacement' && engine.getTipHeight() != null && ASK_AT_READS.has(n);
        const first = n === 0;
        unsureRetries.current += 1;
        retryTimer.current = setTimeout(
          () =>
            void (async () => {
              if (ask) await syncWallet(wallet, { force: true }).catch(() => {});
              if (alive) setReloadKey((k) => k + 1);
            })(),
          ask && first ? 0 : UNSURE_RETRY_MS,
        );
      }
      if (!found) return;
      if (listed) unsureRetries.current = 0;
      const stamped = await getSentAt(walletId, txid);
      if (alive) setStampedSentAt(stamped);
      if (!found.confirmed) {
        const seen = await noteWaiting(walletId, [txid]);
        if (alive) setFirstSeenAt(seen[txid]?.firstSeen ?? null);
      }
      if (wallet.network === 'bitcoin' && !settings.btcOnly) {
        void getBtcPrice(settings.fiat).then((p) => alive && setUsd(p)).catch(() => {});
      }
      if (!listed && info.replacedRecord?.recipient) setToAddress(info.replacedRecord.recipient);
      if (!listed && info.standIn?.to) setToAddress(info.standIn.to);
      // BlueWallet-parity details from the raw transaction (best-effort).
      const raw = await engine.getRawTx(txid);
      if (raw) {
        try {
          const parsed = parseRawTransaction(raw, wallet.network);
          // A spent coin's address lives in the transaction that created
          // it. Every coin this vault spent was once received by it, so its
          // own history names it; the sender's coins of a received payment
          // are looked up only when Advanced is opened (see below).
          const inputs = await Promise.all(
            parsed.inputs.map(async (inp) => {
              if (inp.address) return inp;
              try {
                const prev = await engine.getRawTx(inp.txid);
                const address = prev ? parseRawTransaction(prev, wallet.network).outputs[inp.vout]?.address ?? null : null;
                return address ? { ...inp, address } : inp;
              } catch {
                return inp;
              }
            }),
          );
          const rawDetails = { ...parsed, inputs };
          if (!alive) return;
          setRawInfo(rawDetails);
          // "To": an outgoing tx pays the output we DON'T own; an incoming
          // one pays the output we do.
          let to: string | null = null;
          const outgoing = found.sent > 0;
          for (const o of rawDetails.outputs) {
            if (!o.address) continue;
            const mine = await engine.ownsAddress(o.address);
            if (outgoing ? !mine : mine) {
              to = o.address;
              break;
            }
          }
          if (alive) setToAddress(to ?? rawDetails.outputs.find((o) => o.address)?.address ?? null);
        } catch {
          // parsing is a display nicety only
        }
      }
      const saved = await getTxNote(walletId, txid);
      if (saved && alive) setNote(saved);

      // Speed up and Cancel: only a waiting payment of this vault that Talia
      // has not already replaced.
      if (!listed || listed.confirmed || listed.sent <= 0 || info.state.kind === 'replaced') {
        if (alive) setEligibility(null);
        return;
      }
      const ctx = await loadReplacementContext(engine, txid);
      const rate = feeRateOf(ctx);
      if (!alive) return;
      setEligibility(replacementEligibility(ctx, { isReturn: info.isReturn }));
      setFeeRate(rate);
      if (rate != null) {
        // Null on a test network: mainnet's mempool says nothing about it.
        const phrase = await getTxEta(rate, wallet.network);
        if (alive) setEtaPhrase(phrase);
      }
    })();
    return () => {
      alive = false;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [wallet, walletId, getEngine, syncWallet, txid, settings.fiat, settings.btcOnly, navigation, reloadKey]);

  // Read again on coming back to this page: the page above may have synced
  // the vault meanwhile (a return's page does), and the original's page
  // under it must not go on saying what is no longer true (decided
  // 2026-09-28). Only after the page was left, never on its first showing.
  useEffect(() => {
    let away = false;
    const offBlur = navigation.addListener('blur', () => {
      away = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!away) return;
      away = false;
      setReloadKey((k) => k + 1);
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);

  // The sender's coins of a received payment: asked of the block explorer
  // only once Advanced is open, and never past a client's own server
  // (services/txPrevouts.ts).
  const explorerAsked = useRef(false);
  useEffect(() => {
    if (!advOpen || !wallet || !rawInfo || explorerAsked.current) return;
    if (rawInfo.inputs.every((i) => i.address)) return;
    const api = explorerApiFor(wallet.network, settings);
    if (!api) return;
    explorerAsked.current = true;
    void fetchSpentCoinAddresses(api, txid)
      .then((addresses) =>
        setRawInfo((cur) =>
          cur
            ? { ...cur, inputs: cur.inputs.map((i, k) => (i.address ? i : { ...i, address: addresses[k] ?? null })) }
            : cur,
        ),
      )
      .catch(() => {
        // offline: the coin IDs stay
      });
  }, [advOpen, wallet, rawInfo, settings, txid]);

  /** Share the tracking link for this transaction (decided 2026-09-21).
   *  Nothing to share on a chain with no explorer (`explorerTxUrl`): the
   *  button is hidden there. */
  const onShare = useCallback(() => {
    if (!wallet || !tx) return;
    const url = explorerTxUrl(wallet.network, tx.txid);
    if (!url) return;
    void shareText(url).catch(() => {});
  }, [wallet, tx]);

  const onSaveNote = useCallback(async () => {
    if (noteDraft == null) return;
    await setTxNote(walletId, txid, noteDraft);
    setNote(noteDraft.trim());
    setNoteDraft(null);
  }, [noteDraft, txid, walletId]);

  /** The note field sits at the bottom of the Details card, and the keyboard
   *  inset alone left it half behind the keyboard (decided 2026-09-07; the same
   *  as the co-sign code boxes, 2026-08-31): while a note is being edited,
   *  scroll all the way down when the keyboard opens so the field and Save
   *  sit right above it. Not with Advanced open: its raw data below would
   *  push the note off the top instead. */
  const scrollRef = useRef<ScrollView | null>(null);
  const editingNote = noteDraft != null;
  useEffect(() => {
    if (!editingNote || advOpen) return;
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, [editingNote, advOpen]);

  /** A figure in the client's currency, or in sats when there is none. */
  const money = useCallback(
    (sats: number) => (usd != null ? formatFiat(sats, usd, settings.fiat) : formatSats(sats)),
    [usd, settings.fiat],
  );
  const amountText = useCallback((sats: number) => formatAmount(sats, settings.unit), [settings.unit]);

  /**
   * Speed up / Cancel on the card: read the transaction again first, since
   * the answer must be current. A tap that arrives after it confirmed says
   * so ("Already confirmed"); one the page no longer holds (replaced, or
   * gone) re-reads the page; otherwise the sheet opens on the fee tiers.
   */
  const openSheet = async (kind: ReplacementKind) => {
    if (!wallet || busy) return;
    setBusy(kind);
    try {
      let engine;
      try {
        engine = await withTimeout(syncWallet(wallet, { force: true }), 20_000, 'Sync');
      } catch {
        engine = await getEngine(wallet); // offline: judged on what the phone has
      }
      const txs = await engine.listTransactions();
      const info = txRecordInfo(await getTxReplacements(walletId), walletId, txid, txs);
      const now = txs.find((t) => t.txid === txid);
      if (now?.confirmed) {
        setTx(now);
        setReloadKey((k) => k + 1);
        if (info.state.kind !== 'too-late') setNotice({ title: 'Already confirmed' });
        return;
      }
      if (!now || info.state.kind === 'replaced') {
        setReloadKey((k) => k + 1);
        return;
      }
      const ctx = await loadReplacementContext(engine, txid);
      const verdict = replacementEligibility(ctx, { isReturn: info.isReturn });
      setEligibility(verdict);
      const orig = originalOf(ctx);
      // Not offered after all: the card now says why, or shows nothing.
      if (!orig || !(kind === 'speedup' ? verdict.speedUp : verdict.cancel)) return;
      const presets = await getFeePresets().catch(() => FALLBACK_PRESETS);
      setChoice(defaultChoice(replacementRows(orig, kind, presets)));
      setCustomText('');
      setSheet({ kind, orig, presets });
    } catch (e) {
      setNotice(replacementBuildNotice(e, kind));
    } finally {
      setBusy(null);
    }
  };

  /** Build the replacement and hand it to the signing ceremony. */
  const build = async (orig: OriginalTx, kind: ReplacementKind, rate: number) => {
    if (!wallet) return;
    const closeSheet = sheet != null;
    setBuilding(true);
    setBusy(kind);
    try {
      const engine = await getEngine(wallet);
      const result = await buildReplacement(engine, orig, kind, rate);
      const saved = await getTxNote(walletId, orig.txid);
      // `what` rides along, so a ceremony resumed from Pending transactions
      // still names a refresh or a return as one (replacementParamsFromPlan).
      const record = {
        ...replacementRecord(
          wallet.id,
          orig,
          kind,
          result.built.txid,
          result.feeSats,
          saved ?? undefined,
          result.sentSats,
        ),
        what: noun,
      };
      // Written now, so a co-signed replacement sent later from Pending
      // transactions is recorded too (txReplacements.recordIfReplacement).
      await planTxReplacement(record);
      const params = {
        walletId: wallet.id,
        psbtBase64: result.built.psbtBase64,
        replaces: {
          kind,
          txid: orig.txid,
          oldFeeSats: orig.feeSats,
          amountSats: orig.paymentSats,
          ...(sentAtMs ? { sentAt: Math.floor(sentAtMs / 1000) } : {}),
          what: noun,
          record,
        },
      };
      if (closeSheet) setSheet(null);
      setTimeout(() => navigation.navigate('SignPsbt', params), AFTER_MODAL_MS);
    } catch (e) {
      if (closeSheet) setSheet(null);
      if (e instanceof ReplacementError && e.code === 'not-eligible') setReloadKey((k) => k + 1);
      const failure = replacementBuildNotice(e, kind);
      setTimeout(() => setNotice(failure), AFTER_MODAL_MS);
    } finally {
      setBuilding(false);
      setBusy(null);
    }
  };

  /** When it was sent: a replacement's record, else Talia's own stamp at the broadcast. */
  const sentAtMs = records?.sentAt ?? stampedSentAt;

  const sheetText = useMemo(
    () =>
      sheet
        ? replacementSheet({
            kind: sheet.kind,
            orig: sheet.orig,
            presets: sheet.presets,
            choice,
            customText,
            etaPhrase,
            cosigned,
            money,
            moneySub: usd != null ? formatSats : null,
            amount: amountText,
          })
        : null,
    [sheet, choice, customText, etaPhrase, cosigned, money, usd, amountText],
  );

  /** What the transaction is called in the ceremony's words. */
  const noun = useMemo(() => {
    if (records?.isReturn) return 'return' as const;
    if (!wallet || !tx || tx.netAmount >= 0) return 'payment' as const;
    return minOlderBlocks(wallet.descriptor) != null && (isSelfTransfer(tx) || !!records?.refresh)
      ? ('refresh' as const)
      : ('payment' as const);
  }, [records, wallet, tx]);

  const onSheetPrimary = () => {
    const row = sheetText?.selected;
    if (!sheet || !row || building) return;
    if (!row.affordable) {
      setSheet(null);
      setTimeout(() => setNotice({ title: 'Not enough left for a higher fee' }), AFTER_MODAL_MS);
      return;
    }
    if (sheet.kind === 'cancel') {
      const orig = sheet.orig;
      setSheet(null);
      setTimeout(() => setCancelAsk({ orig, row }), AFTER_MODAL_MS);
      return;
    }
    void build(sheet.orig, 'speedup', row.buildRate);
  };

  if (!wallet || !tx) {
    return (
      <Screen style={styles.content}>
        <View style={styles.headRow}>
          <HeaderBackButton />
        </View>
        <Text style={styles.muted}>
          {!wallet ? 'Wallet not found.' : loaded ? 'This transaction is not in this vault.' : 'Loading…'}
        </Text>
      </Screen>
    );
  }

  const incoming = tx.netAmount >= 0;
  /** The one link this screen offers, for the header's share button and the
   *  Details card's explorer button alike (`explorerTxUrl`). Null only on a
   *  local chain, and both buttons go away rather than lead nowhere. They
   *  stay once the client chose their own Bitcoin server (decided
   *  2026-10-22): the app asks nothing for them, only the client's tap does. */
  const trackUrl = explorerTxUrl(wallet.network, tx.txid);
  /** Hidden on the vault: hidden here too (decided 2026-09-07). Unhide on the
   *  vault screen, the one place that asks for auth when it is required. */
  const masked = settings.hideBalances || !!wallet.balanceHidden;
  const isReturn = records?.isReturn ?? false;
  // Timelocked vault + pure self-spend → this was a "Refresh", not a send.
  // A cancel's return is a self-spend too, and says Return.
  const refreshTx =
    !incoming &&
    !isReturn &&
    minOlderBlocks(wallet.descriptor) != null &&
    (isSelfTransfer(tx) || !!records?.refresh);
  const confs =
    tx.confirmed && tx.blockHeight && tip && tip >= tx.blockHeight
      ? tip - tx.blockHeight + 1
      : tx.confirmed
        ? undefined
        : 0;
  const view = txStatusView({
    incoming,
    refresh: refreshTx,
    confirmed: tx.confirmed,
    confirmations: confs,
    record: records?.state ?? { kind: 'none' },
    isReturn,
    eligibility,
    canSend,
    etaPhrase,
    returnAmount:
      records?.returnAmountSats != null ? (masked ? '••••' : amountText(records.returnAmountSats)) : null,
  });
  const typeLabel = incoming ? 'Received' : isReturn ? 'Return' : refreshTx ? 'Refresh' : 'Sent';
  // A waiting transaction has no block time: Talia knows when it sent it
  // (a replacement's record, or the stamp taken at every broadcast).
  const whenMs = tx.timestamp ? tx.timestamp * 1000 : sentAtMs ?? null;
  const moment = (ms: number) =>
    new Date(ms).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  // Neither a block time nor a send stamp: when this phone first saw it
  // waiting, said as such (decided 2026-10-29), since it may have waited longer.
  const when = whenMs
    ? moment(whenMs)
    : !tx.confirmed && firstSeenAt != null
      ? `First seen ${moment(firstSeenAt)}`
      : undefined;
  const earlier = records?.earlier ?? null;
  const facts = cancelAsk
    ? cancelFacts(cancelAsk.orig, cancelAsk.row, amountText, (sats) =>
        usd != null ? `${formatSats(sats)} / ${formatFiat(sats, usd, settings.fiat)}` : formatSats(sats),
      )
    : [];

  return (
    <Screen scroll scrollRef={scrollRef} style={styles.content}>
      {/* BlueWallet-style head (decided 2026-09-12): the kind and the moment sit
          beside the back button instead of a "Transaction" title, which
          leaves the whole width to the amount below. The stack header is
          off for this screen. */}
      <View style={styles.headRow}>
        <HeaderBackButton />
        <View style={styles.headText}>
          <Text style={styles.kicker} numberOfLines={1}>{typeLabel}</Text>
          {/* Wraps at a space rather than cut at large text (decided
              2026-10-22); one line at the standard size. */}
          {when && <Text style={styles.when}>{when}</Text>}
        </View>
        {/* Decided 2026-09-21: share the tracking link from the top right corner.
            The link alone, nothing wrapped around it. */}
        {trackUrl != null && (
          <HeaderIconButton label="Share this transaction" onPress={onShare}>
            <IosShareIcon size={20} strokeWidth={2.25} color={theme.colors.offWhite} />
          </HeaderIconButton>
        )}
      </View>
      <View style={styles.amountBlock}>
        <FitText
          style={[styles.amount, { color: incoming ? theme.colors.positive : theme.colors.offWhite }]}>
          {masked ? '•••••' : (
            // The unit in the figure's own size and colour, as every balance
            // draws it (decided 2026-10-03).
            `${formatBtcSigned(tx.netAmount)} BTC`
          )}
        </FitText>
        {usd != null && (
          <Text style={styles.usd}>{masked ? '••••' : formatFiat(tx.netAmount, usd, settings.fiat)}</Text>
        )}
      </View>

      {/* One card in every state, so nothing moves when a payment is
          replaced, cancelled or confirmed (decided 2026-09-28, design A). */}
      <TxStatusCard
        view={view}
        etaInfo={etaInfoText(txNoun({ refresh: refreshTx, isReturn }), feeRate != null ? formatFeeRate(feeRate) : '')}
        busy={busy}
        onSpeedUp={() => void openSheet('speedup')}
        onCancel={() => void openSheet('cancel')}
        onLink={(next) => navigation.push('TxDetail', { walletId, txid: next })}
      />

      <Card style={styles.details}>
        {/* A tinted band, as BlueWallet draws it, so "Details" reads as a
            header and "explorer" as the button it is (decided 2026-09-12). */}
        <View style={styles.detailHeaderRow}>
          <Text style={styles.detailTitle}>Details</Text>
          {trackUrl != null && (
            <TouchableOpacity
              style={styles.explorerBtn}
              onPress={() => Linking.openURL(trackUrl)}>
              <Text style={styles.explorerText}>explorer</Text>
            </TouchableOpacity>
          )}
        </View>
        <FactRow label="Network fee" value={masked ? '••••' : tx.fee != null ? `${formatSats(tx.fee)}${usd != null ? ` / ${formatFiat(tx.fee, usd, settings.fiat)}` : ''}` : '-'} />
        {toAddress != null && (
          <FactRow
            label="To"
            mono
            value={`${toAddress.slice(0, 10)}…${toAddress.slice(-10)}`}
          />
        )}
        {tx.blockHeight != null && <FactRow label="Block" value={String(tx.blockHeight)} />}
        {/* The transaction this one replaced ("Replaces") or cancelled
            ("Cancels"), from Talia's record; a tap opens it. */}
        {earlier != null && (
          <TouchableOpacity onPress={() => navigation.push('TxDetail', { walletId, txid: earlier.txid })}>
            <FactRow
              label={earlier.label}
              mono
              value={`${earlier.txid.slice(0, 10)}…${earlier.txid.slice(-8)}`}
            />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => {
            copyToClipboard(tx.txid);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>
          <FactRow
            label="ID"
            value={copied ? 'Copied ✓' : `${tx.txid.slice(0, 10)}…${tx.txid.slice(-8)}`}
            mono
          />
        </TouchableOpacity>

        <View style={styles.noteBlock}>
          <View style={styles.noteHeaderRow}>
            <Text style={styles.rowLabel}>Note</Text>
            {noteDraft == null && (
              <TouchableOpacity style={styles.noteBtn} onPress={() => setNoteDraft(note)}>
                <Text style={styles.noteBtnText}>{note ? 'edit' : 'add'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {noteDraft != null ? (
            <>
              <TextField label="" value={noteDraft} onChangeText={setNoteDraft} placeholder="Only stored on this phone" autoCapitalize="sentences" />
              <Button title="Save note" onPress={onSaveNote} />
            </>
          ) : note ? (
            <Text style={styles.noteText}>{note}</Text>
          ) : null}
        </View>
      </Card>

      {/* BlueWallet's Advanced, row for row (decided 2026-09-22: "copy the exact
          same structure from blue wallet"): a header band with the chevron,
          Fee rate, Size, Virtual size and Tx Hex as divided rows, then the
          spent and created coins by ADDRESS. The coins keep the chosen plain labels
          (2026-07-19), and the transaction ID lives in Details above. */}
      <Card style={styles.advanced}>
        <TouchableOpacity
          style={styles.advHeader}
          activeOpacity={0.7}
          onPress={() => setAdvOpen((o) => !o)}
          accessibilityLabel={advOpen ? 'Collapse advanced details' : 'Expand advanced details'}>
          <Text style={styles.detailTitle}>Advanced</Text>
          <View style={{ transform: [{ rotate: advOpen ? '-90deg' : '90deg' }] }}>
            <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.slate} />
          </View>
        </TouchableOpacity>
        {advOpen && (
          <>
            <AdvRow
              label="Fee rate"
              value={rawInfo && tx.fee != null ? `${feeRateWords(tx.fee, rawInfo.vsize)} sats/vb` : '-'}
            />
            <AdvRow label="Size" value={rawInfo ? `${rawInfo.sizeBytes} B` : '-'} />
            <AdvRow label="Virtual size" value={rawInfo ? `${rawInfo.vsize} vB` : '-'} />
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={!rawInfo}
              onPress={() => {
                if (!rawInfo) return;
                copyToClipboard(rawInfo.hex);
                setHexCopied(true);
                setTimeout(() => setHexCopied(false), 1400);
              }}>
              <AdvRow label="Tx Hex" value={rawInfo ? (hexCopied ? 'Copied' : 'Copy') : '-'} />
            </TouchableOpacity>
            <View style={styles.advBlock}>
              {/* A count only when the transaction was read: a page drawn
                  from Talia's record has none, and "(0)" would be untrue. */}
              <Text style={styles.advLabel}>Coins spent{rawInfo ? ` (${rawInfo.inputs.length})` : ''}</Text>
              {(rawInfo?.inputs ?? []).map((inp, k) => (
                <Text key={`in-${k}`} style={inp.address ? styles.advAddress : styles.advCoinId} selectable>
                  {inp.address ?? `${inp.txid.slice(0, 16)}… : ${inp.vout}`}
                </Text>
              ))}
            </View>
            <View style={styles.advBlock}>
              <Text style={styles.advLabel}>Coins created{rawInfo ? ` (${rawInfo.outputs.length})` : ''}</Text>
              {(rawInfo?.outputs ?? []).map((o, k) => (
                <Text key={`out-${k}`} style={styles.advAddress} selectable>
                  {o.address ?? 'Unrecognised destination'}
                </Text>
              ))}
            </View>
          </>
        )}
      </Card>

      {/* Speed up / Cancel: Send's own sheet (one FeeSheet, never a copy). */}
      {sheet && sheetText && (
        <FeeSheet
          visible
          onClose={() => {
            if (!building) setSheet(null);
          }}
          title={sheetText.title}
          caption={sheetText.caption}
          rows={sheetText.rows.map((r) => ({
            key: r.key,
            label: r.label,
            meta: r.meta,
            main: r.main,
            sub: r.sub,
            muted: r.muted,
            on: r.on,
            onPress: () => setChoice(r.key),
          }))}
          custom={{
            value: customText,
            onChangeText: (t) => {
              setCustomText(t);
              setChoice('custom');
            },
            onFocus: () => setChoice('custom'),
            onPress: () => setChoice('custom'),
            placeholder: sheetText.custom.placeholder,
            unitMeta: sheetText.custom.unitMeta,
            on: sheetText.custom.on,
            main: sheetText.custom.main,
            sub: sheetText.custom.sub,
            bad: sheetText.custom.bad,
          }}
          footer={sheetText.footer.map((line) => (
            <InfoHeading key={line.text} style={feeSheetStyles.meta} title={line.infoTitle} text={line.info}>
              {line.text}
            </InfoHeading>
          ))}>
          <View style={styles.sheetGap} />
          <Button
            title={sheetText.button}
            onPress={onSheetPrimary}
            loading={building}
            disabled={!sheetText.selected}
          />
        </FeeSheet>
      )}

      {/* The one red control of the flow (decided 2026-09-28, design A): title,
          the two facts (the payment's amount first, decided 2026-09-28), the
          reasoning behind the dot, and the two answers. */}
      <AppDialog
        visible={cancelAsk != null}
        title="Cancel this payment?"
        actions={[
          {
            label: 'Cancel payment',
            destructive: true,
            onPress: () => {
              if (cancelAsk) void build(cancelAsk.orig, 'cancel', cancelAsk.row.buildRate);
            },
          },
          { label: 'Keep it', variant: 'ghost', onPress: () => {} },
        ]}
        onClose={() => setCancelAsk(null)}>
        <View style={styles.dialogFacts}>
          {facts.map((f) => (
            <FactRow key={f.label} label={f.label} value={f.value} />
          ))}
          <InfoHeading style={feeSheetStyles.meta} title={CANCEL_TITLE} text={CANCEL_INFO}>
            {CANCEL_LINE}
          </InfoHeading>
        </View>
      </AppDialog>
      <AppDialog
        visible={notice != null}
        title={notice?.title ?? ''}
        actions={[{ label: 'OK', variant: 'primary', onPress: () => {} }]}
        onClose={() => setNotice(null)}
      />
    </Screen>
  );
}

/** "2.3", "1": the fee rate with one decimal, as BlueWallet shows it. */
function feeRateWords(feeSats: number, vsize: number): string {
  if (vsize <= 0) return '-';
  return (feeSats / vsize).toFixed(1).replace(/\.0$/, '');
}

/** One divided row of the Advanced section, BlueWallet's shape. */
function AdvRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.advRow}>
      <FactRow label={label} value={value} />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  muted: { ...theme.typography.body, color: theme.colors.slate },
  content: { gap: theme.spacing.lg },

  // The back chevron hangs at the same x as on every other screen: the
  // header bar pads xs where this page pads lg.
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  headText: { flex: 1, minWidth: 0 },
  kicker: { ...theme.typography.screenTitle, color: theme.colors.offWhite },
  when: { ...theme.typography.screenSubtitle, color: theme.colors.slate, marginTop: 1 },

  amountBlock: { gap: theme.spacing.xs, marginTop: theme.spacing.xl },
  // The one hero size (decided 2026-09-12: every amount figure the same).
  amount: { ...theme.typography.hero },
  // The line under a figure, as the home and a vault draw their fiat line.
  usd: { ...theme.typography.heroCaption, color: theme.colors.slate },

  details: { gap: theme.spacing.md, overflow: 'hidden' },
  // Bleeds to the card's edges (the card pads lg) and takes its top corners.
  detailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    marginHorizontal: -theme.spacing.lg,
    marginTop: -theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderColor: theme.colors.hairline,
  },
  detailTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  explorerBtn: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  explorerText: { ...theme.typography.label, color: theme.colors.gold },

  rowLabel: { ...theme.typography.body, color: theme.colors.slate },

  noteBlock: { gap: theme.spacing.sm },
  noteHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  noteBtn: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  noteBtnText: { ...theme.typography.label, color: theme.colors.gold },
  noteText: { ...theme.typography.body, color: theme.colors.offWhite },

  // The card pads lg; the band and the dividers bleed to its edges, as the
  // Details card's band does.
  advanced: { overflow: 'hidden', paddingVertical: 0 },
  advHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    marginHorizontal: -theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  advRow: {
    marginHorizontal: -theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  advBlock: {
    gap: theme.spacing.xs,
    marginHorizontal: -theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  advLabel: { ...theme.typography.body, color: theme.colors.slate, marginBottom: theme.spacing.xs },
  advAddress: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
  advCoinId: { ...theme.typography.mono, color: theme.colors.slate },

  // The cancel dialog's facts, as the Details rows draw them.
  dialogFacts: { gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  sheetGap: { height: theme.spacing.md },
}));
