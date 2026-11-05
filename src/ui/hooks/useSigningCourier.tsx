/**
 * The courier, wired ONCE for every screen that signs on a Bluetooth device
 * (design A, decided 2026-10-03; the refresh session too, decided 2026-10-05: "keep 3
 * and build the courier for refresh session too"). The signing screen and
 * the refresh session used to differ here: the first drew the courier, the
 * second a spinner line under the device's last step. This hook holds what
 * the courier needs around a screen's own hardware step, so both draw the
 * same three screens, the same endings and the same Try again:
 *
 *   - the feed the device's signals land in (`ceremonyFeed`), and what the
 *     courier draws once a device has answered (`courier`: the drawing, the
 *     key's name, the facts of the transaction on its way), null until then
 *     so the connection flow keeps its own turn pages and lines;
 *   - the ceremony page for `HardwareConnect` (`ceremony`), and `locked` for
 *     the step while the device is at work;
 *   - the courier's buttons for the page's pinned footer (`footer`, decided
 *     2026-10-05: every page's actions at the bottom): the screen's Back,
 *     and a Try again that clears the courier and connects to the same
 *     device; null whenever the courier has nothing to tap, so the footer is
 *     never empty;
 *   - the signing run per brand (`signOnLedger`, `signOnBitbox`): the
 *     courier up, the device asked, the signals read (the Ledger's
 *     conversation and clock; the BitBox's hand-over beat), the signed
 *     transaction merged and read back, the device's signed page held a beat
 *     (`SIGNED_HOLD_MS`), the caller's own follow-up inside the same try (the
 *     signing screen's broadcast), and every failure pushed to the feed so
 *     the Not signed page says what happened, then rethrown for the flow.
 *
 * A batch (the refresh session's one pass per device over every coin) calls
 * a run once per transaction with its place (`CourierJob.batch`): each
 * transaction starts its own ceremony on the same feed, slides in as a new
 * page, and is counted on the lines ("transaction 2 of 3"); the client's
 * turn stays "3. Sign the transaction" on every one ("keep 3").
 *
 * What stays with the screens: the checks before the courier (the wrong
 * device by name, a key that already signed), the vault's records and its
 * registration, and what happens to the signed transaction (merged and sent,
 * or kept for the next key). The courier draws nothing of those.
 */
import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SigningCourier, SigningCourierFooter, courierFootShown } from '../components/SigningCourier';
import type { CeremonyPage, LedgerTaskContext } from '../components/LedgerConnectFlow';
import type { BitboxTaskContext } from '../components/HwwConnectFlow';
import { signLedgerPsbt, watchLedgerActivity } from '../../platform/ledger';
import { mergeLedgerSignatures } from '../../bitcoin/ledger';
import type { LedgerWalletSpec } from '../../bitcoin/ledger';
import { bitboxAccountKeypath, descriptorToBitboxPolicy } from '../../bitcoin/bitbox/policy';
import type { BitboxPolicy } from '../../bitcoin/bitbox/policy';
import { decodeBase64 } from '../../bitcoin/psbt';
import type { ParsedPsbt } from '../../bitcoin/psbt';
import type { WalletMeta } from '../../wallet/types';
import type { VaultRegistration } from '../hww/connectedDevice';
import {
  HANDOVER_MS,
  SIGNED_HOLD_MS,
  TICK_MS,
  asksNameFirst,
  ceremonyFeed,
  failureSignal,
  readEstimate,
  signEstimate,
} from '../hww/signingCeremony';
import type { BatchPosition, CeremonyConfig, CeremonyFeed } from '../hww/signingCeremony';
import { bitboxRegisteredName, drawingFor, tourFactsFor } from '../hww/signingDevice';
import type { DeviceDrawing, TourFacts } from '../hww/signingDevice';

/** What the courier draws once a device has answered and a transaction is
 *  on its way. */
export interface CourierSetup {
  drawing: DeviceDrawing;
  /** The key being signed with: the title of the travelling screens. */
  keyName: string;
  facts: TourFacts;
}

/** One transaction as a device gets it. */
export interface CourierJob {
  psbt: string;
  /** The transaction as read, every output's `isOwn` from BDK
   *  (`wallet/ownOutputs.markOwnOutputs`); null when it could not be read. */
  parsed: Pick<ParsedPsbt, 'outputs' | 'feeSats' | 'numInputs' | 'numOutputs'> | null;
  /** The key being signed with: the title of the travelling screens. */
  keyName: string;
  /** Its place in a batch signed in one visit (the refresh session),
   *  counted from 1; left out for the one transaction of a payment. */
  batch?: BatchPosition;
}

/** The device's signed copy, merged and read back. */
export interface SignedCopy {
  base64: string;
  bytes: Uint8Array;
}

/** What a BitBox signs with: the registered policy and the device's own
 *  account for a shared vault (null for a plain one-key vault, which it
 *  signs from the PSBT's own key origins), and the name it STORED for the
 *  vault, never today's label (`bitboxRegisteredName`). */
export interface BitboxSigningSpec {
  policy: BitboxPolicy | null;
  account: string | null;
  storedName: string | null;
}

/**
 * The BitBox's signing spec from what `registerVault` answered: a standard
 * one-key vault needs nothing; a shared vault sends the exact policy that was
 * registered, because the device refuses to guess a multisig arrangement
 * (force_script_config), with this device's own account keypath, and names
 * the vault as the device stored it (a vault registered just now: the policy's
 * name; one it already knew: the name Talia kept beside the registration,
 * null when Talia never saw it). Throws when the device holds no key of the
 * vault.
 */
export function bitboxSigningSpec(wallet: WalletMeta, fingerprint: string, reg: VaultRegistration): BitboxSigningSpec {
  if (reg.standard) return { policy: null, account: null, storedName: null };
  const policy = descriptorToBitboxPolicy(wallet.descriptor, wallet.label);
  const account = bitboxAccountKeypath(policy.keys, fingerprint);
  if (!account) throw new Error('This BitBox holds no key of this vault.');
  const storedName = reg.alreadyRegistered ? bitboxRegisteredName(wallet.bitboxRegistrations, fingerprint) : policy.name;
  return { policy, account, storedName };
}

export interface SigningCourierHandle {
  /** The ceremony's signals, pushed by the runs and read by the drawn screens. */
  feed: CeremonyFeed;
  /** The courier on screen (a device has answered and a transaction is on
   *  its way), or null: the connection flow's own pages and lines. The step
   *  is `locked` while this is set. */
  courier: CourierSetup | null;
  /** The ceremony page for `HardwareConnect`, once the courier is up. It
   *  draws no button: they are the page footer's (`footer`). */
  ceremony: CeremonyPage | undefined;
  /** The courier's buttons for the page's pinned footer, or null while it
   *  has none (no courier, the client's turn on the device): Back is the
   *  screen's (`onBack`), Try again clears the courier and connects to the
   *  same device. The page puts them in `Screen`'s `footer` or its own
   *  `PageFooter`. */
  footer: (onBack: () => void) => React.ReactNode;
  /** Leaving the step, or trying again: the courier and its feed go. */
  reset: () => void;
  /**
   * Sign one transaction on a Ledger session with the courier drawn. Returns
   * the merged copy, or null when the client left mid-way (nothing is then
   * committed). `after` runs inside the run, after the signed page's beat,
   * so what it does to the copy (the signing screen's broadcast) still lands
   * on the Not signed page should it fail.
   */
  signOnLedger: (ctx: LedgerTaskContext, spec: LedgerWalletSpec, job: CourierJob, after?: (signed: SignedCopy) => Promise<void>) => Promise<SignedCopy | null>;
  /** The same on a paired BitBox session. */
  signOnBitbox: (ctx: BitboxTaskContext, spec: BitboxSigningSpec, job: CourierJob, after?: (signed: SignedCopy) => Promise<void>) => Promise<SignedCopy | null>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const UNREADABLE = 'The signed transaction could not be read back. Please try again.';

export function useSigningCourier(wallet: WalletMeta | null | undefined): SigningCourierHandle {
  const feed = useRef(ceremonyFeed()).current;
  const [courier, setCourier] = useState<CourierSetup | null>(null);
  const reset = useCallback(() => {
    setCourier(null);
    feed.reset();
  }, [feed]);

  /** The connection flow's Try again (connect to the same device), kept as
   *  the ceremony page draws: the button that calls it sits in the page's
   *  footer, outside the flow's ceremony slot. */
  const flowRetry = useRef<() => void>(() => {});
  const retry = useCallback(() => {
    reset();
    flowRetry.current();
  }, [reset]);

  const ceremony = useMemo(
    (): CeremonyPage | undefined =>
      courier == null
        ? undefined
        : ({ failure, retry: again }) => {
            flowRetry.current = again;
            return <SigningCourier feed={feed} drawing={courier.drawing} keyName={courier.keyName} facts={courier.facts} failure={failure} />;
          },
    [courier, feed],
  );

  /** Whether the courier has buttons now: a yes or no read off the feed, so
   *  the screen redraws as its footer comes and goes, never with every
   *  message the device sends. */
  const footShown = useSyncExternalStore(feed.subscribe, () => courierFootShown(feed.get()));
  const footer = useCallback(
    (onBack: () => void): React.ReactNode =>
      courier == null || !footShown ? null : <SigningCourierFooter feed={feed} onBack={onBack} onRetry={retry} />,
    [courier, footShown, feed, retry],
  );

  const signOnLedger = useCallback(
    async (ctx: LedgerTaskContext, spec: LedgerWalletSpec, job: CourierJob, after?: (signed: SignedCopy) => Promise<void>): Promise<SignedCopy | null> => {
      if (wallet == null) throw new Error('This vault is no longer on this device.');
      // Screen 1 of the courier (design A, decided 2026-10-03): the transaction is
      // on its way. Locked, the wrong app, the wrong device and the
      // registration were all settled by the caller, on the flow's own
      // pages. From here the phone reads the conversation
      // (signingCeremony.ts): messages flowing are the way there, the device
      // gone quiet is the client's turn, messages again are the signatures on
      // their way back.
      const registered = spec.kind === 'registered';
      const nIn = job.parsed?.numInputs ?? 1;
      const cfg: CeremonyConfig = {
        brand: 'ledger',
        readEstimate: readEstimate(nIn, job.parsed?.numOutputs ?? 2),
        signEstimate: signEstimate(nIn),
        // Bitcoin app 2.2.1 to 2.4.1 ask for a registered vault's name before
        // the transaction; the version was read when the app opened.
        nameFirst: asksNameFirst(ctx.appVersion, registered),
        batch: job.batch ?? null,
      };
      // The drawing and the words first, the signal that moves the leg after:
      // the feed redraws the courier on its own, the setup rides the next render.
      setCourier({
        drawing: drawingFor('ledger', ctx.device.model),
        keyName: job.keyName,
        facts: tourFactsFor({
          brand: 'ledger',
          network: wallet.network,
          descriptor: wallet.descriptor,
          label: wallet.label,
          registeredName: spec.kind === 'registered' ? spec.name : null,
          nameFirst: cfg.nameFirst,
          parsed: job.parsed,
          psbt: job.psbt,
        }),
      });
      feed.start(cfg, Date.now());
      try {
        const unwatch = watchLedgerActivity((n) => feed.push({ type: 'messages', count: n, at: Date.now() }));
        const clock = setInterval(() => feed.push({ type: 'tick', at: Date.now() }), TICK_MS);
        let sigs;
        try {
          sigs = await signLedgerPsbt(
            ctx.sessionId,
            spec,
            job.psbt,
            (p) => {
              // The kit announces the approval interaction while the device
              // is still reading; the quiet times the client's turn instead.
              if (p !== 'confirm-sign') ctx.onPrompt(p);
            },
            ctx.deviceFingerprint,
            // The fuller form: the way there starts again, and screen 1 says so.
            () => feed.push({ type: 'restart' }),
          );
        } finally {
          clearInterval(clock);
          unwatch();
        }
        // The client may have backed out while the Ledger sat on its approval
        // screen: never mutate an abandoned ceremony.
        if (!ctx.alive()) return null;
        feed.push({ type: 'signed' });
        const merged = mergeLedgerSignatures(job.psbt, sigs);
        const bytes = decodeBase64(merged);
        if (!bytes) throw new Error(UNREADABLE);
        // The device's signed page stays a beat before anything moves on.
        await wait(SIGNED_HOLD_MS);
        if (!ctx.alive()) return null;
        const signed = { base64: merged, bytes };
        await after?.(signed);
        return signed;
      } catch (e) {
        // A decline is exact (6985); anything else lands on the Not signed
        // page with the flow's own sentence.
        feed.push(failureSignal(e));
        throw e;
      }
    },
    [feed, wallet],
  );

  const signOnBitbox = useCallback(
    async (ctx: BitboxTaskContext, spec: BitboxSigningSpec, job: CourierJob, after?: (signed: SignedCopy) => Promise<void>): Promise<SignedCopy | null> => {
      if (wallet == null) throw new Error('This vault is no longer on this device.');
      // The courier, BitBox style (design A, decided 2026-10-03: "the device sends
      // and receives the TX instantly"): no bars. A short handover beat, then
      // its turn with the drawn Nova stepping through its own pages, until
      // the one signing call answers: signed, refused ("aborted by the
      // user"), or the link failed. Those are the moments the phone can tell
      // apart.
      setCourier({
        drawing: drawingFor('bitbox'),
        keyName: job.keyName,
        facts: tourFactsFor({
          brand: 'bitbox',
          network: wallet.network,
          descriptor: wallet.descriptor,
          label: wallet.label,
          // The device names a policy or a multisig by the name it was
          // registered under; a one-key vault has none.
          registeredName: spec.storedName,
          nameFirst: false,
          parsed: job.parsed,
          psbt: job.psbt,
        }),
      });
      feed.start({ brand: 'bitbox', readEstimate: 0, signEstimate: 0, nameFirst: false, batch: job.batch ?? null }, Date.now());
      try {
        const beat = setTimeout(() => feed.push({ type: 'handedOver' }), HANDOVER_MS);
        let out: string;
        try {
          out = await ctx.session.signPsbt(wallet.network !== 'bitcoin', job.psbt, spec.policy, spec.account);
        } finally {
          clearTimeout(beat);
        }
        if (!ctx.alive()) return null;
        feed.push({ type: 'signed' });
        const bytes = decodeBase64(out);
        if (!bytes) throw new Error(UNREADABLE);
        await wait(SIGNED_HOLD_MS);
        if (!ctx.alive()) return null;
        const signed = { base64: out, bytes };
        await after?.(signed);
        return signed;
      } catch (e) {
        feed.push(failureSignal(e));
        throw e;
      }
    },
    [feed, wallet],
  );

  return useMemo(
    () => ({ feed, courier, ceremony, footer, reset, signOnLedger, signOnBitbox }),
    [feed, courier, ceremony, footer, reset, signOnLedger, signOnBitbox],
  );
}
