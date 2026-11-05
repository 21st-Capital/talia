/**
 * A connected signing device, whatever its brand (decided 2026-09-22: "every part
 * of the app needs to automatically use the same library and look for all
 * available hardware we have adopted").
 *
 * The universal search (HwwConnectFlow) finds a device over Bluetooth and
 * runs its brand's own connection ceremony; a screen that asks for
 * `deviceTask` then gets THIS: one object with the same calls for every
 * brand. The brand-specific work (Ledger wallet policies and HMACs, BitBox
 * policies on the device) lives here, in one adapter per brand, and nowhere
 * in the screens. A brand added later is one more adapter.
 *
 * Signing and the address check still run brand-specific ceremonies inside
 * their screens' own tasks, but EVERY registration goes through
 * `registerVault` here (2026-10-04), so the moment the device asks for the
 * vault's approval reaches the flows from one place (the Ledger kit's
 * 'confirm-register', the BitBox's `setStep(…, 'register')`) WITH the facts
 * its pages are drawn from (`registerFacts`: the name, the policy, the keys
 * and which is the device's own; the phone-test videos of 2026-10-04).
 */
import type { LedgerTaskContext } from '../components/LedgerConnectFlow';
import type { BitboxTaskContext } from '../components/HwwConnectFlow';
import { getLedgerXpub, registerLedgerPolicy } from '../../platform/ledger';
import { descriptorToLedgerPolicy, isDefaultPolicy, ledgerPolicyBlocker } from '../../bitcoin/ledger';
import { bitboxAccountKeypath, bitboxPolicyBlocker, descriptorToBitboxPolicy } from '../../bitcoin/bitbox/policy';
import type { Network } from '../../bitcoin/descriptor';
import type { KeyDevice, WalletMeta } from '../../wallet/types';
import type { DeviceKind } from '../../wallet/deviceKinds';
import { deviceName, modelFromKit, recordOf } from '../../wallet/deviceKinds';
import { bitboxRegisteredName } from './signingDevice';
import { registerFacts } from './vaultRegistration';

/** What a registration leaves behind, to merge into the vault. */
export interface VaultRegistration {
  /** The brand's own record for this device (Ledger HMAC, BitBox marker). */
  patch: Pick<Partial<WalletMeta>, 'ledgerRegistrations' | 'bitboxRegistrations'>;
  /** A standard single-key vault: the device signs it with no ceremony. */
  standard: boolean;
  /** The device already knew the vault. */
  alreadyRegistered: boolean;
}

export interface ConnectedDevice {
  kind: DeviceKind;
  /** "Ledger", "BitBox". */
  brandName: string;
  /** The name the search showed for this device. */
  name: string;
  /** The device's master key fingerprint, lowercase hex. */
  fingerprint: string;
  /** The Bluetooth id the search found it under, to mark it as done. */
  deviceId: string;
  /** What `keyDevices` records for a key on this device. */
  record: KeyDevice;
  /** Narrate a step on the flow's status line. */
  setStep: (message: string) => void;
  /** False once the flow is gone: check before committing a result. */
  alive: () => boolean;
  /** The extended public key at an origin path such as "48'/1'/0'/2'". */
  xpub: (path: string, network: Network) => Promise<string>;
  /** Show the vault to the device and have it approve it, when the vault
   *  needs that. Throws a plain sentence when the device cannot take it. */
  registerVault: (wallet: WalletMeta) => Promise<VaultRegistration>;
}

/** A Ledger, from the Ledger ceremony's context. */
export function ledgerDevice(ctx: LedgerTaskContext): ConnectedDevice {
  const fp = ctx.deviceFingerprint.toLowerCase();
  // The model the kit reported, as the registry names it; a Ledger the
  // registry does not list keeps a bare record.
  const model = modelFromKit('ledger', ctx.device.model);
  return {
    kind: 'ledger',
    brandName: deviceName('ledger'),
    name: ctx.device.name || deviceName('ledger'),
    fingerprint: fp,
    deviceId: ctx.device.id,
    record: model ? recordOf(model) : { kind: 'ledger' },
    setStep: ctx.setStep,
    alive: ctx.alive,
    xpub: (path) => getLedgerXpub(ctx.sessionId, path, ctx.onPrompt),
    async registerVault(wallet) {
      const blocker = ledgerPolicyBlocker(wallet.descriptor);
      if (blocker) throw new Error(blocker);
      const policy = descriptorToLedgerPolicy(wallet.descriptor, wallet.label);
      if (isDefaultPolicy(policy)) return { patch: {}, standard: true, alreadyRegistered: false };
      // The device's turn: the vault shown for its approval, drawn from these
      // facts; the kit's own 'confirm-register' prompt that follows keeps them.
      ctx.setStep('Check each key on the device’s screen and approve it there.', 'register', registerFacts(wallet, fp) ?? undefined);
      const { hmacHex } = await registerLedgerPolicy(ctx.sessionId, policy, ctx.onPrompt);
      return {
        patch: {
          ledgerRegistrations: {
            ...(wallet.ledgerRegistrations ?? {}),
            [fp]: { ...policy, hmacHex, appVersion: ctx.appVersion, registeredAt: Date.now() },
          },
        },
        standard: false,
        alreadyRegistered: false,
      };
    },
  };
}

/** A BitBox, from the BitBox ceremony's context. */
export function bitboxDevice(ctx: BitboxTaskContext): ConnectedDevice {
  const fp = ctx.fingerprint.toLowerCase();
  return {
    kind: 'bitbox',
    brandName: deviceName('bitbox'),
    name: ctx.deviceName || deviceName('bitbox'),
    fingerprint: fp,
    deviceId: ctx.deviceId,
    record: recordOf('nova'),
    setStep: ctx.setStep,
    alive: ctx.alive,
    xpub: (path, network) =>
      ctx.session.xpub(`m/${path.replace(/^m\//, '')}`, network === 'bitcoin' ? 'xpub' : 'tpub', false),
    async registerVault(wallet) {
      // The Ledger's vault shapes (bitbox/policy.ts shares the translator)
      // less the ones the BitBox cannot take, a bare sh(multi) and any
      // sh(wsh(...)): its own blocker, before the device is asked anything
      // (decided 2026-10-17, and a BitBox02 simulator run: the shared one let
      // them through to signing or registration time).
      const blocker = bitboxPolicyBlocker(wallet.descriptor);
      if (blocker) throw new Error(blocker);
      if (isDefaultPolicy(descriptorToLedgerPolicy(wallet.descriptor, wallet.label))) {
        return { patch: {}, standard: true, alreadyRegistered: false };
      }
      const policy = descriptorToBitboxPolicy(wallet.descriptor, wallet.label);
      const account = bitboxAccountKeypath(policy.keys, fp);
      if (!account) throw new Error('This device holds no key of this vault.');
      const testnet = wallet.network !== 'bitcoin';
      ctx.setStep('Checking the device…');
      const already = await ctx.session.isPolicyRegistered(testnet, policy, account);
      if (!already) {
        // The device's turn: the vault shown for its approval, drawn from
        // these facts (deviceTurns 'register').
        ctx.setStep('Check the vault on the device’s screen and approve it there.', 'register', registerFacts(wallet, fp) ?? undefined);
        await ctx.session.registerPolicy(testnet, policy, account);
      }
      // The name the device stored: this one when it registers now; when it
      // already knew the vault, only a name Talia kept from its own earlier
      // registration (the device was not shown today's label).
      const name = already ? bitboxRegisteredName(wallet.bitboxRegistrations, fp) : policy.name;
      return {
        patch: {
          bitboxRegistrations: {
            ...(wallet.bitboxRegistrations ?? {}),
            [fp]: name ? { registeredAt: Date.now(), name } : { registeredAt: Date.now() },
          },
        },
        standard: false,
        alreadyRegistered: already,
      };
    },
  };
}
