/**
 * Pending transactions — the co-sign return leg + the user's parked spends.
 * Lists any transaction the user has a co-sign request out for (per vault):
 *   - waiting for 21st Capital,
 *   - co-signed and ready to broadcast, or
 *   - co-signed but still needing the user's OWN signature (they requested the
 *     co-sign before signing) — we hand that straight to the signing ceremony.
 * Nothing here signs; BDK just combines signatures and finalises (decided 2026-07-22).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { landOverTab } from '../navigation/landOverTab';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { minOlderBlocks } from '../../bitcoin/descriptor';
import type { WalletEngine } from '../../bitcoin/engine/types';
import {
  Screen,
  Card,
  Button,
  AppDialog,
  ChevronRightIcon,
  FitText,
  SentCard,
  SentPage,
  StepTransition,
  FAILURES_TITLE,
  batchSentWords,
  mergeSentFacts,
  sentFailureRows,
  sentWords,
} from '../components';
import type { SentFacts, SentFailure, SentKind } from '../components';
import { theme, themedStyles } from '../theme';
import { useWatchWhileWaiting } from '../hooks/useWatchWhileWaiting';
import {
  useWallets,
  broadcastThroughChainServers,
  formatBtc,
  formatSats,
  ownKeysLeftToSign,
  plannedReplacement,
  recordIfReplacement,
  replacementBroadcastFailure,
  replacementSendCheck,
  returnedPayment,
  saveSentAt,
} from '../../wallet';
import type { TxReplacement, WalletMeta } from '../../wallet';
import { withTimeout } from '../../wallet/withTimeout';
import { sendTooEarly, tooEarlyTitle } from '../../wallet/sendTooEarly';
import { notReachedWords } from '../../wallet/broadcastAnswer';
import { shouldDropPendingRecord } from '../../services/pendingPrune';
import { SpendReview } from '../components/SpendReview';
import { parsePsbt } from '../../bitcoin/psbt';
import { psbtAbsurdFee, psbtSignatureStatus } from '../../bitcoin/psbt';
import { loadSession } from '../../services/companyAuth';
import { ownOutputIndices } from '../../wallet/ownOutputs';
import { parkedProgress } from '../../wallet/signingProgress';
import { notifyCosignOutcome } from '../../platform/notifications';
import { shareText } from '../../platform/files';
import {
  fetchMyCosigns,
  loadPendingCosigns,
  isCosignRequest,
  removePendingCosign,
  recordServerStatuses,
  removePendingCosignsForTxid,
  completeCosign,
  cancelCosign,
  withdrawPendingForTxids,
  type CosignServerRequest,
  COMPLETE_COSIGN_MS,
  type PendingCosign,
} from '../../services/cosign';
import { fetchKnown21CFingerprints } from '../../services/providerKeys';

type Props = NativeStackScreenProps<RootStackParamList, 'PendingCosign'>;

interface Row {
  pending: PendingCosign;
  server?: CosignServerRequest;
}

interface DialogState {
  title: string;
  message: string;
  actions?: { label: string; variant?: 'primary' | 'ghost'; destructive?: boolean; onPress: () => void }[];
}

/**
 * What the Sent page reports for one co-signed transaction, read off what
 * went out: who it paid outside the vault (BDK's isMine, the same answer the
 * signing screen's review rows give), what came back to the vault, and the
 * fee. A cancel leads with the payment it cancels (decided 2026-09-28), from the plan
 * written when it was built, and so does the speed-up of one (a return),
 * from Talia's records as the transaction page reads them. Paying nobody
 * else is a refresh only on a vault with a timelock, as the transaction page
 * names it; elsewhere it is a send. Read right after the broadcast, before
 * the sync that follows it: BDK answers one call at a time, and isMine must
 * not wait behind a whole sync. Never throws: the payment is already out,
 * and a figure it cannot read is left off the page.
 */
async function sentFactsFor(
  engine: WalletEngine,
  wallet: WalletMeta,
  psbt: string,
  txid: string,
  plan: Pick<TxReplacement, 'kind' | 'amount' | 'oldTxid' | 'what'> | null,
): Promise<SentFacts> {
  const returned = plan?.kind === 'speedup' ? await returnedPayment(wallet.id, plan.oldTxid).catch(() => null) : null;
  const isReturn = plan?.kind === 'speedup' && (plan.what === 'return' || returned != null);
  const cancelledSats = plan?.kind === 'cancel' ? plan.amount : isReturn ? returned : null;
  try {
    const parsed = parsePsbt(psbt, wallet.network);
    const own = new Set(await ownOutputIndices(engine, psbt));
    const outputs = parsed.outputs.map((o, i) => ({ ...o, isOwn: own.has(i) }));
    const recipients = outputs.filter((o) => !o.isOwn).map((o) => ({ address: o.address, amountSats: o.amountSats }));
    const timelocked = minOlderBlocks(wallet.descriptor) != null;
    const kind: SentKind = plan ? plan.kind : recipients.length === 0 && timelocked ? 'refresh' : 'payment';
    return {
      kind,
      isReturn,
      txids: [txid],
      recipients,
      movedSats: outputs.filter((o) => o.isOwn).reduce((sum, o) => sum + o.amountSats, 0),
      cancelledSats,
      feeSats: parsed.feeSats,
    };
  } catch {
    return {
      kind: plan?.kind ?? 'payment',
      isReturn,
      txids: [txid],
      recipients: null,
      movedSats: null,
      cancelledSats,
      feeSats: null,
    };
  }
}

export function PendingCosignScreen({ navigation, route }: Props): React.JSX.Element {
  const walletFilter = route.params?.walletId;
  const { getWallet, getEngine, settings, syncWallet } = useWallets();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  /** The single transaction that just went out, as the Sent page shows it. */
  const [sent, setSent] = useState<{ walletId: string; facts: SentFacts } | null>(null);
  // Refresh-session batches (decided 2026-08-27): grouped display + one-button
  // sequential broadcast once every transaction is co-signed.
  const [batchDetail, setBatchDetail] = useState<string | null>(null);
  const [batchSending, setBatchSending] = useState<{ done: number; total: number } | null>(null);
  /** Per-row outcome of the CURRENT batch run — 'Sent'/'Failed' labels must
   *  track ids, not assume successes are a prefix (decided 2026-08-27). */
  const [batchOutcome, setBatchOutcome] = useState<Record<string, 'sent' | 'failed'>>({});
  const [sentBatch, setSentBatch] = useState<{
    count: number;
    /** What did not go out: each coin, its amount and what went wrong. */
    failures: SentFailure[];
    walletId: string;
    /** What went out, every transaction together; null when none did. */
    facts: SentFacts | null;
  } | null>(null);
  const [knownProviderFps, setKnownProviderFps] = useState<Set<string>>(new Set());
  useEffect(() => {
    void fetchKnown21CFingerprints().then(setKnownProviderFps).catch(() => {});
  }, []);

  /** The spends (unsigned txids) that are a Cancel, by the plan written when
   *  each was built. Their record carries the PAYMENT's amount (decided 2026-09-28)
   *  and pays an address of the vault's own, so the page says "Back to this
   *  vault", never "To" that address (decided 2026-09-28). */
  const [cancelTxids, setCancelTxids] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    void (async () => {
      const found = new Set<string>();
      for (const r of rows) {
        const t = r.pending.txid;
        if (!t) continue;
        const plan = await plannedReplacement(r.pending.walletId, t).catch(() => null);
        if (plan?.kind === 'cancel') found.add(t);
      }
      if (live) setCancelTxids(found);
    })();
    return () => {
      live = false;
    };
  }, [rows]);

  /** Which fingerprints actually signed this PSBT, split into the client's own
   *  keys and 21st Capital's. Never assume — a co-sign flow has three different
   *  PSBT copies and each carries different key metadata, so the only honest
   *  answer comes from reading the bytes in front of us (decided 2026-07-24). */
  const inventory = useCallback(
    (psbtB64: string, walletId: string): { client: string[]; provider: string[] } | null => {
      try {
        const w = getWallet(walletId);
        const provider = new Set<string>([
          ...(w?.providerKeyFingerprints ?? []).map((f) => f.toLowerCase()),
          ...knownProviderFps,
        ]);
        const signed = psbtSignatureStatus(psbtB64).signedFingerprints.map((f) =>
          f.toLowerCase(),
        );
        return {
          client: signed.filter((f) => !provider.has(f)),
          provider: signed.filter((f) => provider.has(f)),
        };
      } catch {
        return null; // unreadable
      }
    },
    [getWallet, knownProviderFps],
  );

  /** Does this PSBT carry a signature from one of the CLIENT'S OWN keys?
   *  (Not just any signature — 21C's shared key must not count.) */
  const clientHasSigned = useCallback(
    (psbtB64: string, walletId: string): boolean => {
      const inv = inventory(psbtB64, walletId);
      return inv ? inv.client.length > 0 : true; // unreadable → don't block
    },
    [inventory],
  );

  /**
   * The client's own keys on this vault's everyday path that have NOT signed
   * this spend yet. Talia is self-custodial: wherever a screen mentions us,
   * it has to offer these first (decided 2026-09-18). A check found four places
   * here that did not, so once a request was out the second key of a 2-of-3
   * was nowhere on screen and the client could only wait for us or cancel.
   */
  const ownKeysLeft = useCallback(
    (psbtB64: string, walletId: string): string[] =>
      ownKeysLeftToSign(getWallet(walletId), psbtB64, knownProviderFps),
    [getWallet, knownProviderFps],
  );

  /** Hand a parked spend back to the ceremony so another of the client's own
   *  keys can sign it. No signOnly: if that key completes the spend, the
   *  ceremony sends it and clears our request on the way out. */
  const signWithOwnKey = useCallback(
    (walletId: string, psbtB64: string, pendingId: string) => {
      navigation.navigate('SignPsbt', {
        walletId,
        psbtBase64: psbtB64,
        pendingCosignId: pendingId,
      });
    },
    [navigation],
  );

  /** What we have already told the client about, so a poll every 15 seconds
   *  does not announce the same answer again. */
  const announced = useRef(new Map<string, 'signed' | 'rejected'>());
  const firstLoadDone = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const session = await loadSession();
      // fetchMyCosigns THROWS on failure (caught below) — so an empty list
      // here truthfully means "the server says none".
      const server = session ? await fetchMyCosigns(session) : [];
      const byId = new Map(server.map((s) => [s.id, s]));
      // Forget anything finished server-side — or GONE (staff deleted it):
      // an orphaned record would show "Waiting for 21st Capital…" forever.
      if (session) {
        // The server lists at most 200 recent requests. When that window is
        // FULL, a record missing from it may simply have scrolled past the
        // end — absence is only proof of deletion for records NEWER than the
        // oldest row we can still see (decided 2026-08-27).
        const windowFull = server.length >= 200;
        const oldestServerTs = windowFull
          ? Math.min(...server.map((s2) => Date.parse(s2.created_at) || Infinity))
          : 0;
        for (const p of await loadPendingCosigns()) {
          // The rule lives in shouldDropPendingRecord, with tests: this
          // decides the fate of the only copy of a client's signed
          // transaction, including a REJECTED request they may still finish
          // days later with another of their own keys.
          if (
            shouldDropPendingRecord({
              isCosignRequest: isCosignRequest(p),
              createdAt: p.createdAt,
              serverStatus: byId.get(p.id)?.status,
              windowFull,
              oldestServerTs,
            })
          ) {
            await removePendingCosign(p.id);
          }
        }
        // What decides whether a request still holds its coins on Send.
        await recordServerStatuses(server);
      }
      const fresh = await loadPendingCosigns();
      const scoped = walletFilter ? fresh.filter((p) => p.walletId === walletFilter) : fresh;
      // The answer arriving is news, so tell the client even if they are
      // looking at another screen (decided 2026-08-29). Local notification: push
      // would need Apple's paid programme, so this fires when the app itself
      // sees the change. Only on the TRANSITION, never on a status we have
      // already announced.
      for (const p of scoped) {
        const now = byId.get(p.id)?.status;
        if (now !== 'signed' && now !== 'rejected') continue;
        if (announced.current.get(p.id) === now) continue;
        const seenBefore = announced.current.has(p.id);
        announced.current.set(p.id, now);
        // First sight of a request is not news: only a CHANGE is.
        if (!seenBefore && !firstLoadDone.current) continue;
        void notifyCosignOutcome(p.id, now, byId.get(p.id)?.amount_sats ?? null);
      }
      firstLoadDone.current = true;
      setRows(scoped.map((p) => ({ pending: p, server: byId.get(p.id) })));
    } catch {
      // leave whatever we had
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [walletFilter]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => void refresh());
    void refresh();
    return unsub;
  }, [navigation, refresh]);

  /**
   * Watch for the co-signature instead of making the client leave and come
   * back (decided 2026-08-28). Two triggers, both cheap:
   *
   *   · a poll while this screen is open AND something is still waiting, so
   *     a signature that lands while they watch flips the row by itself;
   *   · a check the moment the app returns to the foreground, which is what
   *     happens when they read our email and come straight back.
   *
   * It stops on its own once nothing is waiting, so a screen full of ready
   * transactions costs nothing.
   */
  const waiting = useMemo(
    () => rows.some((r) => isCosignRequest(r.pending) && r.server?.status === 'pending'),
    [rows],
  );

  const checkForCosignature = useCallback(() => void refresh(true), [refresh]);
  useWatchWhileWaiting(waiting, checkForCosignature, navigation);

  /** Batch rows grouped by session; singles stay a flat list. */
  const { batches, singleRows } = useMemo(() => {
    const grouped = new Map<string, Row[]>();
    const singles: Row[] = [];
    for (const row of rows) {
      const b = row.pending.batchId;
      if (b) {
        const list = grouped.get(b) ?? [];
        list.push(row);
        grouped.set(b, list);
      } else {
        singles.push(row);
      }
    }
    return { batches: grouped, singleRows: singles };
  }, [rows]);

  /** An absurd fee goes out only on the client's word (decided
   *  2026-09-26). Title and buttons; true when it asked. */
  const askAbsurdFee = (psbts: string[], onConfirm: () => void): boolean => {
    const fee = psbts.map(psbtAbsurdFee).find((f) => f != null);
    if (fee == null) return false;
    setDialog({
      title: `The network fee is unusually high: ${formatSats(fee)}`,
      message: '',
      actions: [
        { label: 'Send anyway', variant: 'primary', onPress: onConfirm },
        { label: 'Cancel', variant: 'ghost', onPress: () => {} },
      ],
    });
    return true;
  };

  const send = async (row: Row, feeConfirmed = false) => {
    const wallet = getWallet(row.pending.walletId);
    if (!wallet || !row.server?.signed_psbt) return;
    if (!feeConfirmed && askAbsurdFee([row.pending.originalPsbt], () => void send(row, true))) return;
    setBusyId(row.pending.id);
    try {
      const engine = await getEngine(wallet);
      const result = await engine.completePsbt(row.server.signed_psbt, row.pending.originalPsbt);
      if (!result.finalized) {
        // Read what is ACTUALLY on each copy before saying anything about it.
        const combinedInv = inventory(result.psbtBase64, wallet.id);
        const serverInv = inventory(row.server.signed_psbt, wallet.id);
        const fmt = (v: string[]) => (v.length ? v.join(', ').toUpperCase() : 'none');
        const report = () => {
          const lines = [
            'Talia diagnostic: co-signed transaction could not be finalized',
            `Vault: ${wallet.label}`,
            `Request: ${row.pending.id}`,
            `Amount: ${row.pending.amountSats ?? 'unknown'} sats`,
            `To: ${row.pending.destination ?? 'unknown'}`,
            '',
            'Signatures found:',
            `- combined: client=${fmt(combinedInv?.client ?? [])} 21C=${fmt(combinedInv?.provider ?? [])}`,
            `- 21C copy: client=${fmt(serverInv?.client ?? [])} 21C=${fmt(serverInv?.provider ?? [])}`,
            '',
            'Routes tried:',
            ...(result.finalizeNotes ?? ['(none recorded)']).map((n) => `- ${n}`),
            '',
            'Co-signed PSBT (from 21st Capital):',
            row.server?.signed_psbt ?? '(none)',
            '',
            'Local PSBT (with the client signature):',
            row.pending.originalPsbt,
          ];
          void shareText(lines.join('\n'), 'Talia diagnostic').catch(() => {});
        };

        // 21C's signature genuinely absent from what came back → that is the
        // problem, and it is THEIR side to fix. Don't blame assembly.
        if (combinedInv && combinedInv.provider.length === 0) {
          // It used to say "do not sign again, ask the recovery team", which
          // told a client holding another key of their own to wait on us for
          // no reason (decided 2026-09-18). Their key comes first here too.
          const mine = ownKeysLeft(result.psbtBase64, wallet.id);
          setDialog({
            title: '21st Capital’s signature is missing',
            message:
              'The transaction that came back carries no 21st Capital signature, so it cannot be sent as it is. ' +
              'Your own signature is safe on it.' +
              (mine.length > 0
                ? ' You hold another key on this vault, and signing with it finishes the transaction without us.'
                : ''),
            actions: [
              ...(mine.length > 0
                ? [
                    {
                      label: 'Sign with another key',
                      variant: 'primary' as const,
                      onPress: () =>
                        signWithOwnKey(wallet.id, result.psbtBase64, row.pending.id),
                    },
                  ]
                : []),
              {
                label: 'Send this report to support',
                variant: mine.length > 0 ? ('ghost' as const) : ('primary' as const),
                onPress: report,
              },
              { label: 'Close', variant: 'ghost' as const, onPress: () => {} },
            ],
          });
          return;
        }

        if (clientHasSigned(result.psbtBase64, wallet.id)) {
          // Both signatures are on the transaction yet it could not be
          // assembled — never ask the client to sign AGAIN (decided 2026-07-24).
          // Show WHY each route failed and let them send it to us: without the
          // detail a stuck spend is an unreportable dead end.
          const why = result.finalizeNotes?.length
            ? `\n\nDetails:\n· ${result.finalizeNotes.join('\n· ')}`
            : '';
          setDialog({
            title: 'Could not complete the transaction',
            message:
              `Your signatures: ${fmt(combinedInv?.client ?? [])}. ` +
              `21st Capital: ${fmt(combinedInv?.provider ?? [])}. ` +
              'It could not be assembled for sending. Do not sign again.' +
              why,
            actions: [
              { label: 'Send this report to support', variant: 'primary', onPress: report },
              { label: 'Close', variant: 'ghost', onPress: () => {} },
            ],
          });
          return;
        }
        // The user requested the co-sign BEFORE signing their own key, so the
        // combined PSBT still needs their signature. Hand it to the ceremony —
        // it already has 21st Capital's signature attached.
        setDialog({
          title: 'Add your signature',
          message:
            'Your 21st Capital co-signature is attached. Sign with your device to finish and send.',
          actions: [
            {
              label: 'Sign with device',
              variant: 'primary',
              onPress: () =>
                navigation.navigate('SignPsbt', {
                  walletId: wallet.id,
                  psbtBase64: result.psbtBase64,
                  pendingCosignId: row.pending.id,
                }),
            },
            { label: 'Later', variant: 'ghost', onPress: () => {} },
          ],
        });
        return;
      }
      // A Speed up or a Cancel asks again right before it goes out (decided
      // 2026-09-28): it may have waited hours for us. Nothing waiting may now
      // spend from the original (it would be thrown away without a word),
      // and no other version of the payment may have gone out meanwhile
      // (this one could undo it). Title and OK; the row stays to cancel,
      // except a version that can never go out again.
      const plan = row.pending.txid
        ? await plannedReplacement(wallet.id, row.pending.txid).catch(() => null)
        : null;
      if (plan) {
        let fresh = engine;
        try {
          fresh = await withTimeout(syncWallet(wallet, { force: true }), 20_000, 'Sync');
        } catch {
          // offline: judged on what the phone has, as the sheet is
        }
        const verdict = await replacementSendCheck(fresh, wallet.id, plan.oldTxid, plan.newTxid);
        if (verdict === 'already-replaced') {
          await withdrawPendingForTxids([plan.newTxid]);
          setDetail(null);
          await refresh(true);
          setDialog({ title: 'Already replaced', message: '' });
          return;
        }
        if (verdict !== 'ok') {
          setDialog({ title: verdict === 'has-child' ? 'Cannot be sped up or cancelled' : 'Could not send', message: '' });
          return;
        }
      }
      // A co-signed spend on a path with a wait assembles whatever the age
      // of its coins, and the network refuses it (decided
      // 2026-10-07): say when it can go instead. The row stays.
      const wait = await sendTooEarly(engine, result.psbtBase64, wallet.network, () =>
        withTimeout(syncWallet(wallet, { force: true }), 20_000, 'Sync'),
      );
      if (wait != null) {
        setDialog({ title: tooEarlyTitle(wait), message: '' });
        return;
      }
      let txid: string;
      try {
        txid = await broadcastThroughChainServers(wallet.network, settings, (backend) =>
          engine.broadcastPsbt(result.psbtBase64, backend),
        );
      } catch (e) {
        // A co-signed Speed up or Cancel whose original confirmed while it
        // waited for us: the plain state, never the server's words (decided
        // 2026-09-28). The request stays in the list to cancel.
        const why = plan ? replacementBroadcastFailure(e) : 'other';
        if (plan && why === 'already-confirmed') {
          setDialog({ title: plan.kind === 'cancel' ? 'The cancel came too late' : 'Already confirmed', message: '' });
          return;
        }
        if (plan && why === 'fee-too-low') {
          setDialog({ title: 'The network wants a higher fee', message: '' });
          return;
        }
        throw e;
      }
      // What went out, for the Sent page: read now, while nothing else is
      // asking BDK (decided 2026-10-02: behind the sync started below, the
      // page waited for the whole sync with the payment already out).
      const facts = await sentFactsFor(engine, wallet, result.psbtBase64, txid, plan);
      // When it went out (a waiting transaction has no block time), and,
      // for a Speed up or a Cancel sent from here, Talia's own record of it.
      // Every OTHER unsent version of the same payment leaves Pending before
      // the done page shows, so none can be sent over this one (decided
      // 2026-09-28). Local and quick, and none of it throws.
      void saveSentAt(wallet.id, txid);
      const { siblings } = await recordIfReplacement(wallet.id, txid);
      if (siblings.length > 0) await withdrawPendingForTxids(siblings);
      // It is out: the Sent page now, and the bookkeeping after it, never
      // in its way (2026-10-19: a rescue's report to 21st Capital whose
      // answer never came left its screen spinning with the coins sent).
      setSent({ walletId: wallet.id, facts });
      const pendingId = row.pending.id;
      const spendTxid = row.pending.txid;
      void (async () => {
        try {
          await removePendingCosign(pendingId);
          // Any sibling record for the same spend goes too — otherwise the
          // other half of a merged pair survives as a row for money already sent.
          if (spendTxid) await removePendingCosignsForTxid(spendTxid);
          const session = await loadSession();
          if (session) await completeCosign(session, pendingId);
        } catch {
          // best effort: the next refresh prunes what is left
        }
      })();
      void syncWallet(wallet, { force: true }).catch(() => {});
    } catch (e) {
      const notReached = notReachedWords(e);
      setDialog(notReached ? { title: notReached, message: '' } : { title: 'Could not send', message: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * The one button for a whole refresh session (decided 2026-08-27): finalize and
   * broadcast every co-signed transaction IN TURN, a few seconds apart. A
   * transaction that fails is reported and KEPT — its record stays pending so
   * nothing silently disappears; the rest continue.
   */
  const sendBatch = async (batchRows: Row[], feeConfirmed = false) => {
    const wallet = getWallet(batchRows[0]?.pending.walletId ?? '');
    if (!wallet) return;
    if (
      !feeConfirmed &&
      askAbsurdFee(batchRows.map((r) => r.pending.originalPsbt), () => void sendBatch(batchRows, true))
    ) {
      return;
    }
    setBatchSending({ done: 0, total: batchRows.length });
    setBatchOutcome({});
    const failures: SentFailure[] = [];
    /** What went out, one entry per transaction, for the Sent page. */
    const wentOut: SentFacts[] = [];
    /** Each sent coin's report to 21st Capital and record cleanup. */
    const bookkeeping: Array<Promise<void>> = [];
    try {
      const engine = await getEngine(wallet);
      // The session is for the reports alone, which follow the broadcasts:
      // asked for now and awaited only by them, bounded (decided 2026-10-19:
      // a token refresh that never answered held every coin of the session,
      // and with it the Sent page, before anything went out).
      const session = withTimeout(loadSession(), COMPLETE_COSIGN_MS, 'Signing in').catch(() => null);
      // At most one fresh look at the chain for the whole batch, and only
      // when a coin seems too early to go.
      let fresh: Promise<WalletEngine> | null = null;
      const refreshOnce = () => {
        if (!fresh) fresh = withTimeout(syncWallet(wallet, { force: true }), 20_000, 'Sync');
        return fresh;
      };
      for (let i = 0; i < batchRows.length; i++) {
        const row = batchRows[i];
        try {
          if (!row.server?.signed_psbt) throw new Error('not co-signed yet');
          const result = await engine.completePsbt(row.server.signed_psbt, row.pending.originalPsbt);
          if (!result.finalized) {
            throw new Error(
              result.finalizeNotes?.length
                ? result.finalizeNotes.join('; ')
                : 'could not be assembled for sending',
            );
          }
          // Too early is this coin's failure, in the one sentence; the others go.
          const wait = await sendTooEarly(engine, result.psbtBase64, wallet.network, refreshOnce);
          if (wait != null) throw new Error(tooEarlyTitle(wait));
          const sentTxid = await broadcastThroughChainServers(wallet.network, settings, (backend) =>
            engine.broadcastPsbt(result.psbtBase64, backend),
          );
          void saveSentAt(wallet.id, sentTxid);
          wentOut.push(await sentFactsFor(engine, wallet, result.psbtBase64, sentTxid, null));
          // BROADCAST SUCCEEDED — the coin is sent no matter what the
          // bookkeeping below does. A cleanup hiccup must not book it as
          // failed and invite a re-send (decided 2026-08-27), nor hold the
          // next coin or the Sent page while 21st Capital answers
          // (2026-10-19): it runs beside them, and the list is read once it
          // is done.
          const pendingId = row.pending.id;
          const spendTxid = row.pending.txid;
          bookkeeping.push(
            (async () => {
              try {
                const signedIn = await session;
                if (signedIn) await completeCosign(signedIn, pendingId);
                await removePendingCosign(pendingId);
                if (spendTxid) await removePendingCosignsForTxid(spendTxid);
              } catch {
                // record cleanup is best-effort; the next refresh prunes it
              }
            })(),
          );
          setBatchOutcome((prev) => ({ ...prev, [row.pending.id]: 'sent' }));
          setBatchSending({ done: i + 1, total: batchRows.length });
          // A breath between broadcasts (decided 2026-08-27) — never a burst.
          if (i < batchRows.length - 1) await delay(3000);
        } catch (e) {
          setBatchOutcome((prev) => ({ ...prev, [row.pending.id]: 'failed' }));
          setBatchSending({ done: i + 1, total: batchRows.length });
          // Its amount is drawn in the owner's unit on the card, never
          // written into the sentence here (decided 2026-10-02).
          failures.push({ coin: i + 1, amountSats: row.pending.amountSats ?? null, reason: notReachedWords(e) ?? (e as Error).message });
        }
      }
      void syncWallet(wallet, { force: true }).catch(() => {});
      setBatchDetail(null);
      setSentBatch({
        count: batchRows.length - failures.length,
        failures,
        walletId: wallet.id,
        facts: mergeSentFacts(wentOut),
      });
      // The page is up and nothing below holds it, nor this run (decided
      // 2026-10-19): each report is bounded (completeCosign), and the list
      // is read once they are done.
      setBatchSending(null);
      setBatchOutcome({});
      void Promise.all(bookkeeping).then(() => refresh(true));
    } catch (e) {
      // Setup failed before any broadcast (engine/session) — say so instead
      // of aborting silently (decided 2026-08-27).
      setDialog({ title: 'Could not send', message: (e as Error).message });
    } finally {
      setBatchSending(null);
      setBatchOutcome({});
    }
  };

  const askCancelBatch = (batchRows: Row[]) => {
    const someSigned = batchRows.some((r) => r.server?.status === 'signed');
    setDialog({
      // A co-signed transaction is complete: it exists at 21st Capital as
      // well as here, and anyone holding it could still send it until those
      // coins move again. Never "your coins are untouched" for it (decided
      // 2026-09-26). Said in the title: dialogs are a title and
      // buttons (decided 2026-09-02).
      title: someSigned
        ? 'Cancel the session? Signed ones can still be sent.'
        : 'Cancel the whole session?',
      message: someSigned
        ? ''
        : 'Every request of this refresh session is withdrawn. Nothing has been sent and your coins are untouched. You can start the refresh again any time.',
      actions: [
        {
          label: 'Cancel session',
          variant: 'primary',
          destructive: true,
          onPress: () => {
            void (async () => {
              const session = await loadSession();
              if (!session) {
                // Removing only the local rows would leave the server-side
                // requests live and the two views out of step (decided
                // 2026-08-27).
                setDialog({
                  title: 'Please log in',
                  message:
                    'Cancelling the session also withdraws the requests at 21st Capital, which needs your account. Log in and try again.',
                });
                return;
              }
              // A row stays when its withdrawal did not reach 21st Capital
              // (cancelCosign keeps it), and the client is told.
              let failed = 0;
              for (const row of batchRows) {
                try {
                  await cancelCosign(session, row.pending.id);
                } catch {
                  failed += 1;
                }
              }
              setBatchDetail(null);
              await refresh();
              if (failed > 0) setDialog({ title: 'Could not withdraw every request', message: '' });
            })();
          },
        },
        { label: 'Keep it', variant: 'ghost', onPress: () => {} },
      ],
    });
  };

  const askCancel = (row: Row) => {
    const ready = row.server?.status === 'signed';
    const deviceOnly = row.pending.awaiting === 'device';
    // A co-sign request is everyday co-signing, never a recovery: it names
    // 21st Capital, as the "already co-signed" branch does (decided
    // 2026-09-22: it said "the recovery team", the rescue team's name).
    setDialog({
      // Decided 2026-09-26: co-signed means complete. It still exists and could be
      // sent until these coins move again; the title says so (dialogs are
      // a title and buttons, decided 2026-09-02).
      title: deviceOnly
        ? 'Discard this transaction?'
        : ready
          ? 'Remove this signed transaction? It can still be sent.'
          : 'Cancel this request?',
      message: deviceOnly
        ? 'The signatures collected so far are thrown away. Nothing has been sent and your coins are untouched. You can start the payment again any time.'
        : ready
          ? ''
          : 'This withdraws the request, so 21st Capital will not co-sign it.',
      actions: [
        {
          label: deviceOnly ? 'Discard' : ready ? 'Remove' : 'Cancel request',
          variant: 'primary',
          destructive: true,
          onPress: () => {
            void (async () => {
              // A device-parked partial exists only on this phone.
              if (deviceOnly) {
                await removePendingCosign(row.pending.id);
                setDetail(null);
                await refresh();
                return;
              }
              const session = await loadSession();
              if (!session) {
                // Removing only the local row would leave the server-side
                // request live and 21C signing a withdrawn spend (decided
                // 2026-08-27) — same rule as cancelling a session.
                setDialog({
                  title: 'Please log in',
                  message:
                    'Cancelling also withdraws the request at 21st Capital, which needs your account. Log in and try again.',
                });
                return;
              }
              try {
                await cancelCosign(session, row.pending.id);
              } catch {
                // The record stays: the request is still live at 21st Capital.
                setDialog({ title: 'Could not cancel. Please try again.', message: '' });
                return;
              }
              // Don't lean on the prune: a request older than a full server
              // window is deliberately never pruned, which left a phantom
              // "Waiting…" row after cancel (decided 2026-08-27).
              await removePendingCosign(row.pending.id);
              setDetail(null);
              await refresh();
            })();
          },
        },
        { label: 'Keep it', variant: 'ghost', onPress: () => {} },
      ],
    });
  };

  const dialogNode = dialog ? (
    <AppDialog
      visible
      title={dialog.title}
      message={dialog.message}
      actions={dialog.actions ?? [{ label: 'OK', variant: 'primary', onPress: () => {} }]}
      onClose={() => setDialog(null)}
    />
  ) : null;

  // list → detail → sent all render through ONE StepTransition (bottom of the
  // component) so opening a request and the sent confirmation slide like
  // screen pushes (decided 2026-07-24).
  const renderBody = (): React.JSX.Element => {

  if (sentBatch) {
    const batchWallet = getWallet(sentBatch.walletId);
    const toVault = () =>
      landOverTab('VaultsTab', [
        { name: 'WalletDetail', params: { walletId: sentBatch.walletId } },
      ]);
    // The Sent page's own card (decided 2026-10-02): the Details card's
    // heading and look, each coin's amount in the owner's unit, dots when
    // the balance is hidden, as everything else on the page.
    const failuresMasked = settings.hideBalances || !!batchWallet?.balanceHidden;
    const failuresCard =
      sentBatch.failures.length > 0 ? (
        <SentCard
          title={FAILURES_TITLE}
          rows={sentFailureRows(sentBatch.failures, failuresMasked, settings.unit)}
          foot="These stay in your pending list. Try them again in a moment, and contact us if one keeps failing."
        />
      ) : null;
    const words = batchSentWords(sentBatch.count, sentBatch.failures.length);
    // Nothing went out: not a Sent page, no tick. What failed, and Done.
    if (sentBatch.count === 0 || !sentBatch.facts || !batchWallet) {
      return (
        <Screen scroll style={styles.content} footer={<Button title="Done" onPress={toVault} />}>
          <Text style={styles.doneTitle}>{words.title}</Text>
          {failuresCard}
        </Screen>
      );
    }
    // Right under the header, where the signing screen's Sent page sits.
    return (
      <Screen scroll underHeader style={styles.sentContent}>
        <SentPage
          wallet={batchWallet}
          facts={sentBatch.facts}
          words={words}
          extra={failuresCard}
          actions={[{ title: 'Done', onPress: toVault }]}
        />
      </Screen>
    );
  }

  const sentWallet = sent ? getWallet(sent.walletId) : undefined;
  if (sent && sentWallet) {
    return (
      <Screen scroll underHeader style={styles.sentContent}>
        <SentPage
          wallet={sentWallet}
          facts={sent.facts}
          words={sentWords(sent.facts.kind, undefined, sent.facts.isReturn)}
          actions={[
            {
              title: 'Done',
              // Land on the vault with a CLEAN stack (home → vault), so the
              // vault's back/swipe returns home, not to this page underneath.
              onPress: () =>
                landOverTab('VaultsTab', [
                  { name: 'WalletDetail', params: { walletId: sent.walletId } },
                ]),
            },
          ]}
        />
      </Screen>
    );
  }

  if (batchDetail) {
    const batchRows = batches.get(batchDetail) ?? [];
    const readyRows = batchRows.filter((r) => r.server?.status === 'signed');
    const allReady = batchRows.length > 0 && readyRows.length === batchRows.length;
    const total = batchRows.reduce((a, r) => a + (r.pending.amountSats ?? 0), 0);
    return (
      <Screen
        scroll
        style={styles.content}
        // The page's actions at the foot (decided 2026-10-05): the refresh once
        // every coin is co-signed, then the session's cancel (not while a
        // refresh runs, as before), Back last.
        footer={
          <>
            {allReady && (
              <Button
                title={
                  batchSending
                    ? `Refreshing ${Math.min(batchSending.done + 1, batchSending.total)} of ${batchSending.total}…`
                    : 'Refresh all coins'
                }
                onPress={() => void sendBatch(batchRows)}
                loading={batchSending != null}
                disabled={batchSending != null}
              />
            )}
            {!batchSending && (
              <Button title="Cancel the session" variant="ghost" onPress={() => askCancelBatch(batchRows)} />
            )}
            <Button
              title="Back"
              variant="ghost"
              onPress={() => setBatchDetail(null)}
              disabled={batchSending != null}
            />
          </>
        }>
        <Text style={[styles.state, allReady ? styles.ready : styles.waiting]}>
          {allReady
            ? 'All co-signed · ready to refresh'
            : `${readyRows.length} of ${batchRows.length} co-signed. We'll email you when the rest are ready.`}
        </Text>
        <View>
          <Text style={styles.amount}>{formatBtc(total)}</Text>
          <Text style={styles.amountSats}>{formatSats(total)}</Text>
        </View>
        <Card style={styles.detailCard}>
          {batchRows.map((r, i) => (
            <TouchableOpacity
              key={r.pending.id}
              style={styles.itemHead}
              disabled={batchSending != null}
              onPress={() => {
                // The single-request view carries the full triage (diagnostic
                // report, cancel one, sign-while-waiting) — a stuck coin needs
                // it (decided 2026-08-27).
                setBatchDetail(null);
                setDetail(r);
              }}>
              <Text style={styles.muted}>
                Coin {i + 1}
                {r.pending.amountSats != null ? ` · ${formatSats(r.pending.amountSats)}` : ''}
              </Text>
              <Text
                style={[
                  styles.state,
                  batchOutcome[r.pending.id] === 'failed'
                    ? styles.waiting
                    : r.server?.status === 'signed' || batchOutcome[r.pending.id] === 'sent'
                      ? styles.ready
                      : styles.waiting,
                ]}>
                {batchOutcome[r.pending.id] === 'sent'
                  ? 'Refreshed'
                  : batchOutcome[r.pending.id] === 'failed'
                    ? 'Failed'
                    : r.server?.status === 'signed'
                      ? 'Co-signed'
                      : r.server?.status === 'rejected'
                        ? 'Rejected'
                        : 'Waiting…'}
              </Text>
            </TouchableOpacity>
          ))}
          {(() => {
            const originally = batchRows[0]?.pending.batchTotal;
            return originally && batchRows.length < originally ? (
              <Text style={styles.muted}>
                Started as {originally} transactions. The rest were already sent or
                removed.
              </Text>
            ) : null;
          })()}
        </Card>
        {!allReady && (
          <Text style={styles.muted}>
            Once 21st Capital has co-signed them all, one tap here sends the whole
            session.
          </Text>
        )}
        {dialogNode}
      </Screen>
    );
  }

  if (detail) {
    // Re-read from the live list so the status stays fresh while it's open.
    const dRow = rows.find((r) => r.pending.id === detail.pending.id) ?? detail;
    const ready = dRow.server?.status === 'signed';
    const rejected = dRow.server?.status === 'rejected';
    /** Parked mid-ceremony, waiting for the client's OWN next key
     *  (decided 2026-07-28) — nothing to do with 21st Capital. */
    const awaitingDevice = dRow.pending.awaiting === 'device';
    // A parked spend that already holds every signature is not waiting for
    // a device any more, it is waiting to be SENT (decided 2026-09-01). Read off
    // the copy itself (the leaf hazard, decided 2026-10-17): the path it is on, met and opened
    // by the transaction, never a stored count that took one device's two
    // signatures for two keys.
    const dProgress = parkedProgress(getWallet(dRow.pending.walletId)?.descriptor, dRow.pending);
    const fullysigned = awaitingDevice && dProgress.complete;
    // Did the client already sign with their OWN key? (co-sign-first requests
    // are submitted before the client signs; 21C's shared key doesn't count.)
    const clientSigned = clientHasSigned(dRow.pending.originalPsbt, dRow.pending.walletId);
    const toLabel = dRow.pending.txid && cancelTxids.has(dRow.pending.txid) ? 'Back to this vault' : 'To';
    /** Their own keys first, always (decided 2026-09-18): another key of
     *  theirs on this vault that has not signed this spend yet. */
    const ownLeft = ownKeysLeft(dRow.pending.originalPsbt, dRow.pending.walletId).length > 0;
    /** The ceremony for this spend; `signOnly` adds the client's signature
     *  without sending, for a request 21st Capital still has to co-sign. */
    const toCeremony = (signOnly?: boolean) =>
      navigation.navigate('SignPsbt', {
        walletId: dRow.pending.walletId,
        psbtBase64: dRow.pending.originalPsbt,
        pendingCosignId: dRow.pending.id,
        ...(signOnly ? { signOnly: true } : {}),
      });
    const signWithOwn = () => signWithOwnKey(dRow.pending.walletId, dRow.pending.originalPsbt, dRow.pending.id);
    return (
      <Screen
        scroll
        style={styles.content}
        // The page's actions at the foot (decided 2026-10-05), the primary for the
        // request's state first, then the request's cancel, Back last.
        // "Remove from this list" belongs to the rejected request's own card
        // and stays with it.
        footer={
          <>
            {rejected ? (
              ownLeft && <Button title="Sign with another key" onPress={signWithOwn} />
            ) : awaitingDevice ? (
              <Button title={fullysigned ? 'Review and send' : 'Continue signing'} onPress={() => toCeremony()} />
            ) : ready ? (
              <Button
                title={busyId === dRow.pending.id ? 'Sending…' : 'Send'}
                onPress={() => void send(dRow)}
                loading={busyId === dRow.pending.id}
                disabled={busyId != null}
              />
            ) : clientSigned ? (
              ownLeft && <Button title="Sign with another key" onPress={signWithOwn} />
            ) : (
              <Button title="Sign with your key" onPress={() => toCeremony(true)} />
            )}
            <Button
              title={dRow.pending.awaiting === 'device' ? 'Discard this transaction' : 'Cancel request'}
              variant="ghost"
              onPress={() => askCancel(dRow)}
            />
            <Button title="Back" variant="ghost" onPress={() => setDetail(null)} />
          </>
        }>
        <Text style={[styles.state, ready ? styles.ready : styles.waiting]}>
          {awaitingDevice
            ? fullysigned
              ? `Signed with ${dProgress.signatures} keys · ready to send`
              : `Signed with ${dProgress.signatures ?? 1} of ${
                  dProgress.needed ?? '?'
                } required keys · continue with the next key`
            : rejected
              ? 'Rejected by 21st Capital'
              : ready
                ? 'Co-signed · ready to send'
                : 'Waiting for 21st Capital…'}
        </Text>
        {ready && !rejected && !awaitingDevice ? (
          /* THE final look before money moves, identical to the
             self-signed send screen (decided 2026-09-01). */
          <SpendReview
            vaultLabel={getWallet(dRow.pending.walletId)?.label ?? 'Vault'}
            signaturesLine="Complete, co-signed by 21st Capital"
            feeSats={(() => {
              try {
                return parsePsbt(
                  dRow.pending.originalPsbt,
                  getWallet(dRow.pending.walletId)?.network,
                ).feeSats;
              } catch {
                return null;
              }
            })()}
            outputs={
              dRow.pending.amountSats != null && dRow.pending.destination
                ? [
                    {
                      label: toLabel,
                      address: dRow.pending.destination,
                      amountLine: formatBtc(dRow.pending.amountSats),
                      amountSats: dRow.pending.amountSats,
                    },
                  ]
                : []
            }
            refreshNote="Every coin returns to this vault at fresh addresses."
          />
        ) : (
          <>
        {dRow.pending.amountSats != null && (
              <View>
                <Text style={styles.amount}>{formatBtc(dRow.pending.amountSats)}</Text>
                <Text style={styles.amountSats}>{formatSats(dRow.pending.amountSats)}</Text>
              </View>
            )}
            {!!dRow.pending.destination && (
              <Card style={styles.detailCard}>
                <Text style={styles.detailLabel}>{toLabel}</Text>
                <Text style={[styles.detailValue, styles.mono]}>{dRow.pending.destination}</Text>
              </Card>
            )}
          </>
        )}
        {rejected ? (
          <>
            <Text style={styles.muted}>
              21st Capital did not approve this request, so it was not co-signed.
              No money has moved and your coins are where they were.
            </Text>
            {/* Their own keys, not another request (decided 2026-09-18): this
                page used to send a refused client straight back to us. */}
            {ownLeft && (
              <Text style={styles.muted}>
                You hold another key on this vault. You can sign with it and send
                this transaction yourself.
              </Text>
            )}
            {!!dRow.server?.rejection_reason && (
              <Card style={styles.detailCard}>
                <Text style={styles.detailLabel}>Reason</Text>
                <Text style={styles.detailValue}>{dRow.server.rejection_reason}</Text>
              </Card>
            )}
            <Button
              title="Remove from this list"
              variant="ghost"
              onPress={() => {
                void (async () => {
                  await removePendingCosign(dRow.pending.id);
                  setDetail(null);
                  await refresh();
                })();
              }}
            />
          </>
        ) : awaitingDevice ? (
          <>
            <Text style={styles.muted}>
              {fullysigned
                ? 'Every signature is in. Send it whenever you are ready. Nothing expires.'
                : 'Your signatures are saved here. Continue with the next key whenever you are ready. Nothing expires.'}
            </Text>
          </>
        ) : ready ? null : clientSigned ? (
          <>
            {/* Their own key first, always: waiting for us is a choice here,
                not the only road (decided 2026-09-18). */}
            {ownLeft && (
              <Text style={styles.muted}>
                You hold another key on this vault. Signing with it finishes this
                transaction now, with nothing to wait for.
              </Text>
            )}
            <Text style={styles.muted}>
              You&apos;ve signed. We&apos;ll email you once 21st Capital has co-signed.
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>
            You haven&apos;t signed with your own key yet. Sign now and it will be ready
            to send the moment 21st Capital co-signs.
          </Text>
        )}
        {dialogNode}
      </Screen>
    );
  }

  return (
    <Screen scroll style={styles.content}>
      <Text style={styles.body}>
        Transactions still waiting for a signature.
      </Text>

      {loading && rows.length === 0 ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : rows.length === 0 ? (
        <Card style={styles.empty}>
          <Text style={styles.muted}>No pending transactions.</Text>
        </Card>
      ) : (
        <>
        {[...batches.entries()].map(([batchId, batchRows]) => {
          const readyCount = batchRows.filter((r) => r.server?.status === 'signed').length;
          const allReady = readyCount === batchRows.length;
          const total = batchRows.reduce((a, r) => a + (r.pending.amountSats ?? 0), 0);
          return (
            <TouchableOpacity key={batchId} activeOpacity={0.7} onPress={() => setBatchDetail(batchId)}>
              <Card style={styles.item}>
                <View style={styles.itemHead}>
                  <Text style={[styles.state, allReady ? styles.ready : styles.waiting]}>
                    {allReady
                      ? 'Refresh session · ready to refresh'
                      : `Refresh session · ${readyCount} of ${batchRows.length} co-signed`}
                  </Text>
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                </View>
                <Text style={styles.amount}>{formatBtc(total)}</Text>
                <Text style={styles.amountSats}>{formatSats(total)}</Text>
                <Text style={styles.dest} numberOfLines={1}>
                  {batchRows.length} transaction{batchRows.length === 1 ? '' : 's'} back to this vault
                </Text>
              </Card>
            </TouchableOpacity>
          );
        })}
        {singleRows.map((row) => {
          const ready = row.server?.status === 'signed';
          // A spend that already holds EVERY signature has exactly one next
          // step: the send screen. Straight there, no detail stop (decided
          // 2026-09-01); the ceremony entry jumps to Signed and ready.
          // Read off the copy itself (the leaf hazard), as the detail page does.
          const progress = parkedProgress(getWallet(row.pending.walletId)?.descriptor, row.pending);
          const fullySigned = row.pending.awaiting === 'device' && progress.complete;
          return (
            <TouchableOpacity
              key={row.pending.id}
              activeOpacity={0.7}
              onPress={() =>
                fullySigned
                  ? navigation.navigate('SignPsbt', {
                      walletId: row.pending.walletId,
                      psbtBase64: row.pending.originalPsbt,
                      pendingCosignId: row.pending.id,
                    })
                  : setDetail(row)
              }>
              <Card style={styles.item}>
                <View style={styles.itemHead}>
                  <Text
                    style={[
                      styles.state,
                      row.server?.status === 'rejected'
                        ? styles.rejected
                        : ready
                          ? styles.ready
                          : styles.waiting,
                    ]}>
                    {row.pending.awaiting === 'device'
                      ? fullySigned
                        ? `Signed with ${progress.signatures} keys · ready to send`
                        : `Signed ${progress.signatures ?? 1} of ${
                            progress.needed ?? '?'
                          } required · needs the next key`
                      : row.server?.status === 'rejected'
                        ? 'Rejected by 21st Capital'
                        : ready
                          ? 'Co-signed · ready'
                          : 'Waiting for 21st Capital…'}
                  </Text>
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                </View>
                {row.pending.amountSats != null && (
                  <>
                    <Text style={styles.amount}>{formatBtc(row.pending.amountSats)}</Text>
                    <Text style={styles.amountSats}>{formatSats(row.pending.amountSats)}</Text>
                  </>
                )}
                {!!row.pending.destination && (
                  <FitText style={styles.dest}>
                    → {row.pending.destination.slice(0, 16)}…{row.pending.destination.slice(-8)}
                  </FitText>
                )}
              </Card>
            </TouchableOpacity>
          );
        })}
        </>
      )}

      {dialogNode}
    </Screen>
  );
  };

  return (
    <StepTransition
      stepKey={
        sentBatch ? 'sentBatch' : sent ? 'sent' : batchDetail ? 'batch' : detail ? 'detail' : 'list'
      }
      order={['list', 'batch', 'detail', 'sent', 'sentBatch']}
      style={styles.flexOne}>
      {renderBody()}
    </StepTransition>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { gap: theme.spacing.md },
  flexOne: { flex: 1 },
  body: { ...theme.typography.body, color: theme.colors.slate },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  empty: { alignItems: 'center', paddingVertical: theme.spacing.xl },
  item: { gap: theme.spacing.xs },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  state: { ...theme.typography.label },
  ready: { color: theme.colors.positive },
  rejected: { color: theme.colors.negative },
  waiting: { color: theme.colors.slate },
  detailCard: { gap: theme.spacing.xs },
  detailLabel: { ...theme.typography.caption, color: theme.colors.slate },
  detailValue: { ...theme.typography.body, color: theme.colors.offWhite, flexShrink: 1 },
  amount: { ...theme.typography.heading, color: theme.colors.offWhite },
  amountSats: { ...theme.typography.caption, color: theme.colors.slate },
  dest: { ...theme.typography.caption, color: theme.colors.slate },
  // The Sent page fills the screen: its sub line and actions sit at the foot.
  sentContent: { flexGrow: 1 },
  // "Send all" when nothing went out (no Sent page); its failures card is
  // the Sent page's own (SentCard).
  doneTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  // Family and size only: this style is layered over detailValue, whose
  // leading keeps the label and the value on one baseline.
  mono: {
    fontFamily: theme.typography.mono.fontFamily,
    fontSize: theme.typography.mono.fontSize,
  },
}));
