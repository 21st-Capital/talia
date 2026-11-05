/**
 * Receive — Bitkey-inspired:
 *  - QR on a rounded light tile with the Keel mark centered in it,
 *  - the address below in 4-char chunks, alternating off-white/gold so it's
 *    easy to read and verify against a hardware wallet,
 *  - tap ANYWHERE on the QR or address to copy (with an "Address copied" toast),
 *  - ↻ in the header derives the next address with a hash-scramble animation,
 *  - share row: system sheet · Telegram · WhatsApp,
 *  - "Verify on Hardware" opens the address check on a screen of its own
 *    (VerifyAddress, decided 2026-10-04: "the QR is taking a lot of space, it
 *    forces the user to scroll down to find his device ... open a temporary
 *    new verification screen and jump back once its done"), which pops back
 *    here with its verdict in the params, pinned to the address it judged.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { AddressChunks, BrandedQr, HeaderIconButton, ShareRow, CopiedFlash, AppDialog, ConsentCheckbox, Screen, CopyIcon, InfoHeading, RefreshIcon, Button, Gloss, cardGlow } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, loadAddrCache, saveAddrCache, addressCheckOffered, ADDRESSES_NOT_CHECKED, ADDRESS_CHECK_PATIENCE_MS } from '../../wallet';
import { deviceName } from '../../wallet/deviceKinds';
import type { AddressVerdict } from '../hww/addressCheck';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { HWW_ENABLED, LEDGER_PREVIEW, SIGNING_ENABLED } from '../../config';
import type { AddressCache, CachedAddress } from '../../wallet';
import type { ReceiveAddress } from '../../bitcoin/engine/types';
import { copyToClipboard } from '../../platform/clipboard';
import { loadSession } from '../../services/companyAuth';
import { recordUntestedVaultAck } from '../../services/cosign';
import { checkVaultTested, vaultTestingQuery } from '../../services/vaultTesting';
import { withTimeout } from '../../wallet/withTimeout';
import { addressCheckVerdict, onAddressCheck, reportAddressMismatch } from '../../wallet/addressCheckStore';
import {
  blocksReceive,
  RECEIVE_PAUSED_TITLE,
  shownCheckShows,
  verifyPinnedAddress,
  verifyShownAddress,
} from '../../bitcoin/engine/addressCheck';
import type { AddressCheckVerdict, ShownAddressCheck } from '../../bitcoin/engine/addressCheck';
import { shareVia } from '../../platform/files';

type Props = NativeStackScreenProps<RootStackParamList, 'Receive'>;

/** bech32 charset — what the scramble animation shuffles through. */
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function randomChar(): string {
  return BECH32[Math.floor(Math.random() * BECH32.length)];
}

export function ReceiveScreen({ navigation, route }: Props): React.JSX.Element {
  const { getWallet, getEngine, syncWallet, updateWallet } = useWallets();
  const wallet = getWallet(route.params.walletId);

  /**
   * The independent address check (BDK upgrade, decided
   * 2026-10-15): it runs in the background from the moment the vault's engine is
   * made, and a verdict that scure and the engine disagree blocks this
   * screen, whatever address it was about to show.
   */
  const [scureVerdict, setScureVerdict] = useState<AddressCheckVerdict | null>(() =>
    wallet ? addressCheckVerdict(wallet.id) : null,
  );
  useEffect(() => {
    if (!wallet) return;
    setScureVerdict(addressCheckVerdict(wallet.id));
    return onAddressCheck((id, v) => {
      if (id === wallet.id) setScureVerdict(v);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id]);

  /**
   * An UNTESTED vault holding 21st Capital keys (decided 2026-07-28). The plan
   * covers tested vaults, so until the testing session happens this one is
   * outside it — and the moment that matters is when coins are about to
   * arrive. Gated HERE rather than on the Receive button because three
   * screens can reach this one.
   *
   * Never shown for a self-custodial vault (no plan, nothing to be outside
   * of), for an inherited vault (the heir is not the plan holder), or for a
   * locked one (it cannot be used at all yet).
   */
  const needsRiskAck =
    !!wallet &&
    (wallet.providerKeyFingerprints?.length ?? 0) > 0 &&
    !wallet.vaultTestedAt &&
    !wallet.heirVault &&
    !wallet.locked;
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [riskChecked, setRiskChecked] = useState(false);
  /**
   * The server is asked once as the screen opens, before the warning is
   * drawn (decided 2026-09-28). On the testing call the client reaches Receive
   * with the vault page still open underneath, so the cached state predates
   * the mark staff made a minute ago. Until the answer comes (or a few
   * seconds pass) the screen shows its spinner: never a warning that then
   * vanishes under the finger.
   */
  const [askingServer, setAskingServer] = useState(
    () => needsRiskAck && !!wallet && vaultTestingQuery(wallet) != null,
  );
  useEffect(() => {
    if (!askingServer || !wallet) return;
    let live = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        const patch = await withTimeout(checkVaultTested(session, wallet), 4_000, 'Vault testing status');
        // The vault's cache outlives this screen: an answer that lands
        // after Back is still the truth.
        if (patch) await updateWallet(wallet.id, patch);
      } catch {
        // unreachable or slow: the cached state stands, and so does the warning
      } finally {
        if (live) setAskingServer(false);
      }
    })();
    return () => {
      live = false;
    };
    // Once per opening; the answer lands in the cache the warning reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const acceptRisk = () => {
    setRiskAccepted(true);
    if (!wallet) return;
    // Recorded, not just displayed — an acknowledgement asked for every time
    // is only meaningful if there is a trail of it.
    void updateWallet(wallet.id, {
      untestedRiskAccepted: [...(wallet.untestedRiskAccepted ?? []), Date.now()].slice(-50),
    });
    // …and on OUR side too: a record a reinstall erases is no use as
    // evidence (decided 2026-07-28). Best-effort — never blocks the address.
    void (async () => {
      const session = await loadSession();
      if (session) {
        await recordUntestedVaultAck(session, {
          portfolioId: wallet.portfolioId,
          vaultLabel: wallet.label,
        });
      }
    })();
  };

  const [addr, setAddr] = useState<ReceiveAddress | null>(null);
  const [display, setDisplay] = useState<string>(''); // what's shown (may be scrambling)
  const [scrambling, setScrambling] = useState(false);
  /**
   * The ↻ is waiting on a sync for a new address. The address on show stays
   * as it is, whole and usable, but it is about to change, so the hardware
   * check waits with it.
   */
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  /**
   * The exact address on show, derived again by scure at its own index
   * before its QR, its Copy or its Share appear (decided 2026-10-17: the
   * background sweep covers indexes 0..9 and a used vault shows, say, 37,
   * and a vault opened straight into Receive showed its address before the
   * sweep reported). One derivation per address, after the paint. A
   * mismatch pauses the vault (`reportAddressMismatch`) and blocks the screen
   * like the sweep's; an address with no index (a coin's, from the coin
   * list) is first found among the vault's own addresses; a shape scure does
   * not read is shown as before (`ShownAddressCheck`).
   */
  const [shownCheck, setShownCheck] = useState<{ address: string; result: ShownAddressCheck } | null>(null);
  /** 21C's keys from both the vault tag and the live endpoint. */
  const { providerFps: known21C } = useProviderFingerprints(wallet);
  /**
   * The address check's verdict (decided 2026-08-26), pinned to the address it
   * judged. The check runs on its own screen (VerifyAddress, decided 2026-10-04)
   * and pops back here with the verdict in the params; it is read once and
   * taken out of them, so a later focus never replays it. A match is shown
   * for its own address only, and a new address clears it: a match left
   * under a fresh address would bless an address the device never showed. A
   * MISMATCH is shown whatever address is on show (decided 2026-10-04): the
   * device derived differently from this app, which condemns every address
   * of this vault, not the one it was asked about.
   */
  const [verdict, setVerdict] = useState<AddressVerdict | null>(null);
  useEffect(() => {
    const v = route.params.verdict;
    if (!v) return;
    setVerdict(v);
    navigation.setParams({ verdict: undefined });
  }, [route.params.verdict, navigation]);
  /**
   * The check is offered only once this screen can no longer swap the
   * address under it (decided 2026-10-04). The first load asks the engine
   * after a finished sync, and a saved address shown because that took too
   * long can still be swapped for a LATER one (it was paid meanwhile); until
   * that answer the button waits. A pinned address is never re-derived and
   * needs no confirming. The ↻'s swap is covered by `asking` and `scrambling`,
   * which hide the button from the tap until the new address has landed.
   */
  const [confirmed, setConfirmed] = useState(false);
  /**
   * No saved address and a failed sync: nothing on this screen can be shown
   * as checked, so there is no address, one line and Try again (decided
   * 2026-10-30). `attempt` runs the first load again.
   */
  const [notChecked, setNotChecked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /**
   * While the check's screen is over this one, the ↻ in this header cannot
   * be reached, and it does nothing either way: with the two holds above,
   * the address the check was given is still the one on show when the
   * verdict comes back.
   */
  const focused = useIsFocused();
  const scrambleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Counts the ↻'s scrambles: the first load can end one that is still running. */
  const scrambleRun = useRef(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pre-derived unused addresses (instant ↻): step through the cache instead
  // of deriving through the engine, which can queue behind background syncs.
  const cacheRef = useRef<AddressCache | null>(null);
  const cacheIdx = useRef(0);
  /** Counts the pool's refills: only the last one started may write the pool. */
  const refillRun = useRef(0);
  /** The address on show now, for code that runs later than the render it read. */
  const onShow = useRef<ReceiveAddress | null>(null);

  const show = useCallback((a: ReceiveAddress) => {
    onShow.current = a;
    setAddr(a);
    setDisplay(a.address);
  }, []);

  /** Where the address on show stands in the pool, so the ↻ goes on from it. */
  const poolPosition = () =>
    Math.max(0, (cacheRef.current?.unused ?? []).findIndex((a) => a.address === onShow.current?.address));

  const stopScramble = useCallback(() => {
    if (scrambleTimer.current) {
      clearInterval(scrambleTimer.current);
      scrambleTimer.current = null;
    }
  }, []);

  useEffect(() => stopScramble, [stopScramble]);

  /**
   * An address from an engine that has finished a sync, and only from one
   * (decided 2026-10-30). The engine's database is in memory, so before the
   * vault's first sync of a launch, or after a failed one, a vault with
   * history answers index 0, an address already paid. Failing derives nothing
   * and says nothing here, whichever step failed: the new engine can run a
   * sync of its own inside the address call. The caller keeps what it has.
   */
  const derive = useCallback(
    async (which: 'new' | 'lastUnused'): Promise<ReceiveAddress | undefined> => {
      if (!wallet) return undefined;
      try {
        const engine = await syncWallet(wallet);
        return await engine.getReceiveAddress(which);
      } catch {
        return undefined;
      }
    },
    [wallet, syncWallet],
  );

  /**
   * Pre-derive a pool of upcoming addresses into the cache so ↻ is INSTANT.
   * Previously only the Addresses screen filled this cache — open Receive
   * directly (or on a fresh vault) and every ↻ hit the engine live, queueing
   * behind background syncs (decided 2026-07-18, second report of this).
   * Peeking by index never advances BDK's reveal counter, and a pool of 10
   * stays well inside the stop-gap of 20.
   */
  const prefillPool = useCallback(
    async (fromIndex: number) => {
      if (!wallet || fromIndex < 0) return;
      const run = (refillRun.current += 1);
      try {
        const engine = await getEngine(wallet);
        const unused: CachedAddress[] = [];
        for (let i = 0; i < 10; i++) {
          const a = await engine.getReceiveAddress(fromIndex + i);
          unused.push({ address: a.address, index: a.index });
        }
        // A later refill stands for what is known now: the first load's, once
        // its check has proved this one's start paid, comes after a tap's.
        if (run !== refillRun.current) return;
        const cache: AddressCache = {
          firstUnused: fromIndex,
          unused,
          used: cacheRef.current?.used ?? [],
          updatedAt: Date.now(),
        };
        cacheRef.current = cache;
        cacheIdx.current = poolPosition();
        void saveAddrCache(wallet.id, cache);
      } catch {
        // pool stays as-is; live derivation remains the fallback
      }
    },
    [wallet, getEngine],
  );

  /** The pool's next address, or nothing if the pool has no other. */
  const stepPool = useCallback((): ReceiveAddress | undefined => {
    const unused = cacheRef.current?.unused ?? [];
    if (unused.length === 0) return undefined;
    const at = (cacheIdx.current + 1) % unused.length;
    const c = unused[at];
    if (c.address === onShow.current?.address) return undefined;
    cacheIdx.current = at;
    return { address: c.address, index: c.index, uri: `bitcoin:${c.address}` };
  }, []);

  /**
   * Another address when the pool has none to give. Addresses after the one
   * on show come from the keys alone, so they ask no server, only the native
   * queue, and whatever put this address here covers them. A pinned page asks
   * a synced engine first, and with no server takes the saved pool. A pinned
   * address can be any address, a paid one too, so nothing is counted on from
   * it unless the saved pool holds it as unused.
   */
  const anotherAddress = useCallback(async (): Promise<ReceiveAddress | undefined> => {
    const pinned = route.params.address;
    if (pinned) {
      const derived = await derive('new');
      if (derived || !wallet) return derived;
      if (!cacheRef.current) {
        cacheRef.current = await loadAddrCache(wallet.id);
        cacheIdx.current = (cacheRef.current?.unused ?? []).findIndex((a) => a.address === onShow.current?.address);
      }
    }
    const stepped = stepPool();
    if (stepped) return stepped;
    const current = onShow.current;
    const saved = cacheRef.current?.unused.some((a) => a.address === current?.address);
    if (current && (current.address !== pinned || saved)) {
      await prefillPool(current.index);
      const counted = stepPool();
      if (counted) return counted;
    }
    return pinned ? undefined : derive('new');
  }, [wallet, route.params.address, prefillPool, stepPool, derive]);

  // First load. When a SPECIFIC address was requested (tapping a row on the
  // Addresses screen), show exactly that one — no deriving. Otherwise a spinner
  // until the engine answers after a finished sync, which is at once when
  // anything synced in the last minute: the saved address may have been paid
  // since (decided 2026-10-30 after a phone test). A failed sync shows the saved
  // address, and neither it nor the pool is touched; so does a check that takes
  // longer than ADDRESS_CHECK_PATIENCE_MS, which can still swap it if it was
  // paid. KNOWN LIMIT: a saved address paid since the last sync that reached a
  // server stays on show until one does; no address can be checked without
  // one. The same goes for a pool an earlier build saved from an engine that
  // had not synced, as far as its used list cannot rule the address out
  // (`loadAddrCache`).
  useEffect(() => {
    let cancelled = false;
    let patience: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const pinned = route.params.address;
      if (pinned) {
        show({ address: pinned, index: route.params.index ?? -1, uri: `bitcoin:${pinned}` });
        setConfirmed(true);
        return;
      }
      if (wallet) {
        const cache = await loadAddrCache(wallet.id);
        if (cache) cacheRef.current = cache;
      }
      if (cancelled) return;
      const showSaved = () => {
        const saved = cacheRef.current?.unused[0];
        if (saved && !onShow.current) show({ address: saved.address, index: saved.index, uri: `bitcoin:${saved.address}` });
      };
      patience = setTimeout(showSaved, ADDRESS_CHECK_PATIENCE_MS);
      const first = await derive('lastUnused');
      clearTimeout(patience);
      if (cancelled) return;
      // Settled either way: from here only the ↻ changes the address.
      setConfirmed(true);
      if (first) {
        // The sync just proved everything below `first` paid, and the ↻ is
        // live from here while the refill can queue behind another vault's
        // sync, or fail: the pool loses those addresses now, not then.
        const kept = cacheRef.current;
        const proven: AddressCache = {
          firstUnused: first.index,
          unused: [
            { address: first.address, index: first.index },
            ...(kept?.unused ?? []).filter((a) => a.index > first.index),
          ],
          used: kept?.used ?? [],
          updatedAt: Date.now(),
        };
        cacheRef.current = proven;
        if (wallet) void saveAddrCache(wallet.id, proven);
        // What the ↻ brought while the check ran stays, unless the check says
        // it was paid: then it goes at once, a scramble under way included.
        const current = onShow.current;
        if (!current || current.index < first.index) {
          scrambleRun.current += 1;
          stopScramble();
          setScrambling(false);
          show(first);
        }
        cacheIdx.current = poolPosition();
        // Refill the instant-↻ pool from the CONFIRMED first-unused index.
        void prefillPool(first.index);
      } else {
        showSaved();
        if (!onShow.current) setNotChecked(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(patience);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const tryAgain = useCallback(() => {
    setNotChecked(false);
    setConfirmed(false);
    setAttempt((n) => n + 1);
  }, []);

  /**
   * ↻ — the NEXT address behind a hash-scramble, budgeted at ~1 second: 350ms
   * so it reads as intentional, then a fast ~200ms left-to-right settle. It
   * works whenever an address is on show, with no server and while the first
   * load is still checking (decided 2026-10-30 after a phone test): the pool
   * first, then `anotherAddress`. The scramble starts once the address is
   * known, because asking the engine can take a finished sync, which can run
   * for a minute and more. Until then the address stays on show as it is, its
   * QR under it, and finding no address changes nothing at all, its hardware
   * match included.
   */
  const onRegenerate = useCallback(async () => {
    if (scrambling || asking) return;
    // Mid-check the device is displaying the CURRENT address: swapping the
    // one on this screen would make the side-by-side compare meaningless.
    if (!focused) return;
    // No address on this page, so none to step on from.
    if (notChecked) {
      tryAgain();
      return;
    }
    // Still the first check's spinner: nothing to step on from yet.
    if (!onShow.current) return;

    // INSTANT path: the next pre-derived unused address from the cache. Not on
    // a pinned page, which never ran the first load's check.
    let next = route.params.address ? undefined : stepPool();
    if (!next) {
      setAsking(true);
      next = await anotherAddress();
      setAsking(false);
      if (!next) return;
    }
    const target = next.address;

    // A verdict belongs to the address it judged.
    setVerdict(null);
    onShow.current = next;
    setAddr(next);
    setScrambling(true);
    const run = (scrambleRun.current += 1);
    const length = Math.max(display.length, 42);
    const prefix = display.startsWith('bc1') ? display.slice(0, 4) : '';

    stopScramble();
    scrambleTimer.current = setInterval(() => {
      let out = prefix;
      for (let i = prefix.length; i < length; i++) out += randomChar();
      setDisplay(out);
    }, 45);
    await new Promise<void>((r) => setTimeout(() => r(), 350));
    if (run !== scrambleRun.current) return;
    stopScramble();

    // Fast settle: reveal left → right in ~5 frames (~200ms).
    let revealed = prefix.length;
    scrambleTimer.current = setInterval(() => {
      revealed = Math.min(target.length, revealed + Math.ceil(target.length / 5));
      let out = target.slice(0, revealed);
      for (let i = revealed; i < target.length; i++) out += randomChar();
      setDisplay(out);
      if (revealed >= target.length) {
        stopScramble();
        setDisplay(target);
        setScrambling(false);
      }
    }, 40);
  }, [scrambling, asking, display, route.params.address, stepPool, anotherAddress, stopScramble, focused, notChecked, tryAgain]);

  // Faint while it has nothing to do: asking, or the first check's spinner.
  const refreshIdle = asking || (!addr && !notChecked);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderIconButton label="New address" onPress={onRegenerate} disabled={refreshIdle}>
          {/* The circular-arrow refresh chosen 2026-07-18: drawn, not a glyph. */}
          <RefreshIcon size={20} strokeWidth={2.25} color={refreshIdle ? theme.colors.faint : theme.colors.offWhite} />
        </HeaderIconButton>
      ),
    });
  }, [navigation, onRegenerate, refreshIdle]);

  useEffect(() => {
    if (!wallet || !addr) return;
    const params = { descriptor: wallet.descriptor, changeDescriptor: wallet.changeDescriptor, network: wallet.network };
    let cancelled = false;
    // The pinned search stops when the screen goes (decided 2026-10-17: up to
    // two thousand peeks kept queueing on the engine after it closed).
    const signal = { aborted: false };
    const settle = (result: ShownAddressCheck) => {
      if (cancelled) return;
      // A real disagreement pauses the VAULT (Send and every build too), so
      // the title the screen then shows is true.
      if (result.kind === 'mismatch') reportAddressMismatch({ id: wallet.id, ...params }, result.keychain, result.index);
      setShownCheck({ address: addr.address, result });
    };
    const task = InteractionManager.runAfterInteractions(() => {
      if (addr.index < 0) {
        // Opened on an address with no index (the coin list's "Show coin
        // address", decided 2026-10-17): its keychain and index are
        // found among the vault's own addresses, then it is derived again
        // there. Until then nothing of it is shown but the text.
        void (async () => {
          let result: ShownAddressCheck = { kind: 'error' };
          try {
            const engine = await getEngine(wallet);
            result = await verifyPinnedAddress(params, engine, addr.address, route.params.keychain, { signal });
          } catch {
            result = { kind: 'error' };
          }
          settle(result);
        })();
        return;
      }
      // A change coin's keychain is for that coin's address alone: what the ↻
      // brings on the same page is always a receive address.
      const keychain = addr.address === route.params.address ? route.params.keychain : undefined;
      settle(verifyShownAddress(params, keychain ?? 'external', addr.index, addr.address));
    });
    return () => {
      cancelled = true;
      signal.aborted = true;
      task.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr?.address, addr?.index, wallet?.id]);
  const shownResult = addr && shownCheck?.address === addr.address ? shownCheck.result : null;
  // Not found among the vault's addresses as far as the engine reaches, or
  // the second derivation could not run: nothing DISAGREED, so the address
  // is shown as it always was, in every build (decided 2026-10-22). Only a
  // mismatch pauses Receive (decided 2026-10-15, below); an address that cannot be
  // checked never hides or closes the screen.
  const shownUnchecked = shownResult?.kind === 'not-found' || shownResult?.kind === 'error';
  const shownVerified = shownCheckShows(shownResult) || shownUnchecked;

  const onCopy = useCallback(() => {
    if (!addr || scrambling || !shownVerified) return;
    copyToClipboard(addr.address);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    // Gone quickly (decided 2026-09-14: "make the effect disappear quicker").
    copiedTimer.current = setTimeout(() => setCopied(false), 900);
  }, [addr, scrambling, shownVerified]);

  if (!wallet) {
    return (
      <Screen style={styles.centered}>
        <Text style={styles.muted}>Wallet not found.</Text>
      </Screen>
    );
  }

  // The check is offered where a device can do it: a shared vault bound to a
  // Bluetooth device, or a one-key vault whose FINGERPRINTED key sits on a
  // device that shows a single account's address (decided 2026-10-04: a key
  // kept by its bare xpub was offered the check and failed on every device).
  const canVerifyOnHardware = addressCheckOffered(wallet, known21C);

  // Two derivations of this vault's addresses disagree, in the sweep or at
  // the address about to be shown: no address of it is shown (decided 2026-10-15).
  // A title and a button, nothing to read around.
  if (blocksReceive(scureVerdict) || shownResult?.kind === 'mismatch') {
    return (
      <Screen scroll style={styles.content}>
        <AppDialog
          visible
          title={RECEIVE_PAUSED_TITLE}
          actions={[{ label: 'OK', variant: 'primary', onPress: () => navigation.goBack() }]}
          onClose={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  // The address is not rendered at all until the risk is accepted — a warning
  // the user can read AROUND is not a warning (decided 2026-07-28).
  if (needsRiskAck && !riskAccepted && askingServer) {
    return (
      <Screen scroll style={styles.content}>
        <ActivityIndicator color={theme.colors.gold} style={styles.spinner} />
      </Screen>
    );
  }
  if (needsRiskAck && !riskAccepted) {
    return (
      // The gate's two ways out sit in the pinned footer (decided 2026-10-05):
      // the address first, disabled in colour until the box is ticked, and
      // Not now last.
      <Screen
        scroll
        style={styles.content}
        footer={
          <>
            <Button title="Show the receive address" onPress={acceptRisk} disabled={!riskChecked} />
            <Button title="Not now" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        }>
        <View style={styles.riskCard}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <InfoHeading
            title="What testing means"
            // Every spending path, not "your recovery paths" (decided
            // 2026-09-22): a plain 2-of-3 with our co-signer has none.
            text="Testing is a session we do together. We check that every key can sign, that every spending path works, and that you can get your coins back. Until we have done that with you, we cannot stand behind this vault."
            style={styles.riskTitle}>
            This vault has not been tested yet
          </InfoHeading>
          <Text style={styles.riskBody}>
            Your plan does NOT cover this vault until we have tested it with
            you.
          </Text>
          <Text style={styles.riskBody}>
            You can still use it, entirely at your own risk. 21st Capital
            accepts no responsibility for funds lost from a vault that has not
            been tested.
          </Text>
          <ConsentCheckbox
            checked={riskChecked}
            onChange={setRiskChecked}
            label="I understand this vault is not covered and I accept the risk."
          />
        </View>
      </Screen>
    );
  }

  // Two independent machines deriving the same address is the whole check:
  // the device computes it from its own key and shows it on its own screen
  // (decided 2026-08-26). The check has a screen of its own (decided 2026-10-04) and
  // pops back here with its verdict. Offered once the address is settled
  // (confirmed, no ↻ in flight), and never hidden by a verdict for
  // ANOTHER address. It is the page's one action, so it sits in the pinned
  // footer (decided 2026-10-05); while it is not offered the page has no footer,
  // unless no address could be checked, when Try again is its one action.
  const verifyButton =
    addr != null && shownVerified && (SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED)) && canVerifyOnHardware && addr.index >= 0 && confirmed && !asking && !scrambling && verdict?.address !== addr.address && (
      <Button
        title="Verify on Hardware"
        variant="ghost"
        onPress={() => navigation.navigate('VerifyAddress', { walletId: wallet.id, address: addr.address, index: addr.index })}
      />
    );

  return (
    <Screen
      scroll
      style={styles.content}
      footer={notChecked ? <Button title="Try again" variant="ghost" onPress={tryAgain} /> : verifyButton || undefined}
      overlay={<CopiedFlash visible={copied} label="Address copied" />}>
      {needsRiskAck && (
        // Still visible while they copy the address, not only before it.
        <Text style={styles.riskStrip}>
          NOT TESTED. This vault is not covered by your plan. You use it at your
          own risk.
        </Text>
      )}
      {notChecked ? (
        <Text style={styles.muted}>{ADDRESSES_NOT_CHECKED}</Text>
      ) : !addr || !shownVerified ? (
        <ActivityIndicator color={theme.colors.gold} style={styles.spinner} />
      ) : (
        <>
          {/* Tap anywhere on the QR or the address to copy. */}
          <TouchableOpacity activeOpacity={0.9} onPress={onCopy}>
            {/* The shared QR tile (BrandedQr), starting right under the
                bar (decided 2026-09-14: "give a bit more room to the QR code"). */}
            <BrandedQr value={addr.uri} />

            <View style={styles.addressBlock}>
              <View style={styles.addressLabelRow}>
                <Text style={styles.addressLabel}>YOUR ADDRESS</Text>
                <CopyIcon size={18} strokeWidth={2} color={theme.colors.slate} />
              </View>
              <AddressChunks address={display} />
            </View>
          </TouchableOpacity>

          <View style={styles.middle}>
          {verdict?.kind === 'match' && verdict.address === addr.address && (
            <Text style={styles.ledgerMatch}>
              {`The ${deviceName(verdict.device)} shows the same address. It belongs to this vault and is safe to use.`}
            </Text>
          )}
          {verdict?.kind === 'mismatch' && (
            <>
              <Text style={styles.ledgerMismatch}>
                {`The ${deviceName(verdict.device)} shows a DIFFERENT address. Do not send anything to the address above. Close this screen and contact 21st Capital.`}
              </Text>
              {/* A quiet caption is not enough for the one verdict that
                  means "something is deeply wrong" — block the screen,
                  whatever address is on show: the device disagreed with the
                  app's own derivation, so no address of this vault is safe. */}
              <AppDialog
                visible
                title="Do not use this address"
                message="Your device computed a different address than the one on this screen. Do not send anything here. Close this screen and contact 21st Capital."
                actions={[{ label: 'I understand', variant: 'primary', onPress: () => navigation.goBack() }]}
                onClose={() => navigation.goBack()}
              />
            </>
          )}

          <Text style={styles.notice}>
            A fresh address for each payer improves your privacy.
          </Text>
          </View>

          <View style={styles.shareBlock}>
            <ShareRow onShare={(target) => void shareVia(target, addr.address)} />
          </View>

        </>
      )}

    </Screen>
  );
}


const styles = themedStyles(() => StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // The sections follow each other a breath apart; the share row follows
  // the note, not the bottom of the screen (decided 2026-09-14: "bring the
  // share icons back up again they are now too far down").
  content: { gap: theme.spacing.lg },
  // The verdict and the note travel together as the middle group.
  middle: { gap: theme.spacing.md },
  shareBlock: {},

  // Untested-vault gate (decided 2026-07-28) — deliberately loud: a gold-bordered
  // card in place of the address, and the same gold on the strip that stays
  // above it afterwards.
  riskCard: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: theme.colors.gold,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  riskTitle: { ...theme.typography.title, color: theme.colors.gold },
  riskBody: { ...theme.typography.body, color: theme.colors.offWhite },
  riskStrip: {
    ...theme.typography.caption,
    color: theme.colors.gold,
    borderWidth: 1,
    borderColor: theme.colors.gold,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  muted: { ...theme.typography.body, color: theme.colors.slate },
  spinner: { marginTop: theme.spacing.xxl },


  // Well clear of the code (reported 2026-09-14: "the distance between the
  // address and the QR code ... its too tight!!").
  addressBlock: { marginTop: theme.spacing.xxl + theme.spacing.md, gap: theme.spacing.xs },
  addressLabelRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  addressLabel: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.5 },

  notice: {
    ...theme.typography.caption,
    color: theme.colors.faint,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.spacing.md,
  },

  ledgerMatch: { ...theme.typography.caption, color: theme.colors.accentText },
  // The one verdict that means something is wrong: the bold body token, gold.
  ledgerMismatch: { ...theme.typography.bodyStrong, color: theme.colors.gold },
}));
