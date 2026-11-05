import {
  canReplaceDevice,
  deviceReplacementPatch,
  needsReRegistration,
  registersAfterReplacement,
  replaceableKeys,
  sameExtendedKey,
} from '../replaceDevice';
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';
import { singleSigDevice } from '../keyDevices';
import type { WalletMeta } from '../types';
import {
  MULTISIG_2_OF_3,
  SPARROW_SINGLE_SIG,
  TPUB_A,
  TPUB_B,
} from '../../bitcoin/descriptor/__fixtures__/descriptors';

const base58check = createBase58check(sha256);

const base: WalletMeta = {
  id: 'w1',
  label: 'Vault',
  descriptor: MULTISIG_2_OF_3,
  network: 'testnet',
  kind: 'multisig',
  source: 'generic',
  transport: 'paste',
  createdAt: 1,
};

describe('replaceableKeys', () => {
  // Found in a phone test (2026-09-18): a 21st Capital co-signer sitting in the descriptor as a
  // bare xpub has no fingerprint to match against our list, so it was offered
  // to the client as a key of theirs to move to new hardware.
  it('a shared vault never offers a key with no fingerprint', () => {
    const wallet = {
      id: 'w',
      label: 'V',
      network: 'bitcoin',
      kind: 'multisig',
      source: 'created',
      transport: 'created',
      createdAt: 0,
      descriptor: `wsh(multi(2,[73c5da0a/48'/0'/0'/2']${TPUB_A}/<0;1>/*,${TPUB_B}/<0;1>/*))`,
    } as unknown as WalletMeta;
    expect(replaceableKeys(wallet).map((r) => r.id)).toEqual(['73c5da0a']);
  });

  it('a one-key vault still offers its bare key, which is the client\'s own', () => {
    const wallet = {
      id: 'w',
      label: 'V',
      network: 'bitcoin',
      kind: 'single-sig',
      source: 'imported',
      transport: 'imported',
      createdAt: 0,
      descriptor: `wpkh(${TPUB_A}/<0;1>/*)`,
    } as unknown as WalletMeta;
    expect(replaceableKeys(wallet)).toHaveLength(1);
  });

  it('lists every key of a shared vault with the device it is on', () => {
    const wallet: WalletMeta = {
      ...base,
      keyLabels: { '73c5da0a': 'My Ledger', a1b2c3d4: 'Backup key' },
      keyDevices: { '73c5da0a': { kind: 'ledger', model: 'gen5' } },
    };
    const rows = replaceableKeys(wallet);
    expect(rows.map((r) => r.id)).toEqual(['73c5da0a', 'a1b2c3d4', 'deadbeef']);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({
      fingerprint: '73c5da0a',
      originPath: "48'/1'/0'/2'",
      label: 'My Ledger',
      device: { kind: 'ledger', model: 'gen5' },
    });
    expect(rows[1].device).toBeNull();
  });

  it('counts an old Ledger registration as the device it is on', () => {
    const wallet: WalletMeta = {
      ...base,
      ledgerRegistrations: {
        A1B2C3D4: { name: 'v', descriptorTemplate: 't', keys: [], hmacHex: 'ff', appVersion: '2.2.2', registeredAt: 1 },
      },
    };
    expect(replaceableKeys(wallet)[1].device).toEqual({ kind: 'ledger' });
  });

  it('leaves 21st Capital keys and heir keys out: their owners hold them', () => {
    const wallet: WalletMeta = { ...base, providerKeyFingerprints: ['deadbeef'] };
    expect(replaceableKeys(wallet).map((r) => r.id)).toEqual(['73c5da0a', 'a1b2c3d4']);
    expect(replaceableKeys(wallet, new Set(['a1b2c3d4'])).map((r) => r.id)).toEqual(['73c5da0a']);
    const withHeir: WalletMeta = { ...base, heirKeyFingerprint: 'a1b2c3d4' };
    const rows = replaceableKeys(withHeir);
    expect(rows.map((r) => r.id)).toEqual(['73c5da0a', 'deadbeef']);
    // Numbered by their place in the descriptor, so a skipped key does not
    // renumber the ones after it.
    expect(rows.map((r) => r.position)).toEqual([1, 3]);
  });

  it('names a bare key by its xpub, the way keyDevices does', () => {
    const wallet: WalletMeta = {
      ...base,
      descriptor: `wpkh(${TPUB_A}/<0;1>/*)`,
      kind: 'single-sig',
      keyDevices: { [TPUB_A]: { kind: 'passport' } },
    };
    const rows = replaceableKeys(wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: TPUB_A, fingerprint: null, originPath: null, device: { kind: 'passport' } });
  });

  it('has nothing to offer for a portfolio', () => {
    expect(replaceableKeys({ ...base, manual: true, descriptor: '' })).toEqual([]);
  });
});

describe('canReplaceDevice', () => {
  it('is false until some key of the vault is on a device', () => {
    expect(canReplaceDevice(base)).toBe(false);
    expect(canReplaceDevice({ ...base, keyDevices: { a1b2c3d4: { kind: 'bitbox' } } })).toBe(true);
  });

  it('never coexists with Connect to hardware on a one-key vault', () => {
    // Both read keyDevices, then an old Ledger registration, so the two
    // questions are exact opposites (decided 2026-09-09).
    const bare: WalletMeta = { ...base, descriptor: SPARROW_SINGLE_SIG, kind: 'single-sig' };
    expect(canReplaceDevice(bare)).toBe(singleSigDevice(bare) != null);
    const bound: WalletMeta = { ...bare, keyDevices: { '73c5da0a': { kind: 'ledger' } } };
    expect(canReplaceDevice(bound)).toBe(true);
    expect(singleSigDevice(bound)).not.toBeNull();
  });

  it('a bare key with no device offers nothing to replace', () => {
    const bareKey: WalletMeta = {
      ...base,
      descriptor: `wpkh(${TPUB_A}/<0;1>/*)`,
      kind: 'single-sig',
    };
    expect(canReplaceDevice(bareKey)).toBe(false);
  });
});

describe('deviceReplacementPatch', () => {
  const wallet: WalletMeta = {
    ...base,
    keyDevices: { '73C5DA0A': { kind: 'ledger' }, a1b2c3d4: { kind: 'bitbox', model: 'nova' } },
    ledgerRegistrations: {
      '73c5da0a': { name: 'v', descriptorTemplate: 't', keys: [], hmacHex: 'ff', appVersion: '2.2.2', registeredAt: 1 },
    },
    bitboxRegistrations: { '73c5da0a': { registeredAt: 5 }, a1b2c3d4: { registeredAt: 6 } },
    vaultRegisteredAt: 10,
    registrationAttestedAt: 11,
  };

  it('binds the key to the new hardware, whatever case the old entry used', () => {
    const patch = deviceReplacementPatch(wallet, '73c5da0a', { kind: 'bitbox', model: 'nova' });
    expect(patch.keyDevices).toEqual({
      '73c5da0a': { kind: 'bitbox', model: 'nova' },
      a1b2c3d4: { kind: 'bitbox', model: 'nova' },
    });
  });

  it('forgets what the OLD box proved, so signing never routes to it', () => {
    const patch = deviceReplacementPatch(wallet, '73c5da0a', { kind: 'bitbox', model: 'nova' });
    // A leftover Ledger registration would keep this key reading as
    // Ledger-held (ledgerFingerprintsOf counts records) and the signing
    // screen checks Ledger first.
    expect(patch.ledgerRegistrations).toEqual({});
    expect(patch.bitboxRegistrations).toEqual({ a1b2c3d4: { registeredAt: 6 } });
    expect(patch.vaultRegisteredAt).toBeUndefined();
    expect(patch.registrationAttestedAt).toBeUndefined();
  });

  it('renames the key to what the owner called it on the new device', () => {
    const labelled: WalletMeta = { ...wallet, keyLabels: { '73C5DA0A': 'old ledger', a1b2c3d4: 'bitbox' } };
    const patch = deviceReplacementPatch(labelled, '73c5da0a', { kind: 'bitbox', model: 'nova' }, {
      label: '  BitBox (desk)  ',
    });
    expect(patch.keyLabels).toEqual({ '73c5da0a': 'BitBox (desk)', a1b2c3d4: 'bitbox' });
    // No name given: the labels are left exactly as they were.
    expect(deviceReplacementPatch(labelled, '73c5da0a', { kind: 'bitbox' }).keyLabels).toBeUndefined();
    // A key filed under its xpub has no fingerprint to hang a label on.
    expect(deviceReplacementPatch(labelled, 'xpub6abc', { kind: 'ledger' }, { label: 'x' }).keyLabels).toBeUndefined();
  });

  it('leaves the other keys of a shared vault alone', () => {
    const patch = deviceReplacementPatch(wallet, 'a1b2c3d4', { kind: 'ledger', model: 'gen5' });
    expect(patch.keyDevices).toMatchObject({ '73C5DA0A': { kind: 'ledger' } });
    expect(patch.ledgerRegistrations).toEqual(wallet.ledgerRegistrations);
    expect(patch.bitboxRegistrations).toEqual({ '73c5da0a': { registeredAt: 5 } });
  });

  it('a single-key vault keeps its stamps: it is never registered on anything', () => {
    const single: WalletMeta = {
      ...base,
      descriptor: SPARROW_SINGLE_SIG,
      kind: 'single-sig',
      registrationAttestedAt: 11,
    };
    const patch = deviceReplacementPatch(single, '73c5da0a', { kind: 'passport' }, { sharedVault: false });
    expect(patch.keyDevices).toEqual({ '73c5da0a': { kind: 'passport' } });
    expect('registrationAttestedAt' in patch).toBe(false);
    expect('vaultRegisteredAt' in patch).toBe(false);
  });
});

describe('deviceReplacementPatch, re-keyed', () => {
  it('a bare key that learns its fingerprint leaves no entry under the xpub', () => {
    const bare: WalletMeta = {
      ...base,
      descriptor: `wpkh(${TPUB_A}/<0;1>/*)`,
      kind: 'single-sig',
      keyDevices: { [TPUB_A]: { kind: 'ledger' } },
    };
    const patch = deviceReplacementPatch(bare, TPUB_A, { kind: 'bitbox', model: 'nova' }, {
      sharedVault: false,
      newId: '73c5da0a',
      label: 'Desk BitBox',
    });
    expect(patch.keyDevices).toEqual({ '73c5da0a': { kind: 'bitbox', model: 'nova' } });
    // The name lands under the fingerprint the key just learned.
    expect(patch.keyLabels).toEqual({ '73c5da0a': 'Desk BitBox' });
  });
});

describe('sameExtendedKey', () => {
  it('says yes to the same key and no to a different one', () => {
    expect(sameExtendedKey(TPUB_A, TPUB_A)).toBe(true);
    expect(sameExtendedKey(TPUB_A, ` ${TPUB_A} `)).toBe(true);
    expect(sameExtendedKey(TPUB_A, TPUB_B)).toBe(false);
  });

  it('ignores the encoding, so a device handing back another prefix still matches', () => {
    // Same 74 bytes of key material, different version bytes (tpub vs vpub).
    const bytes = base58check.decode(TPUB_A);
    const vpub = new Uint8Array(bytes);
    vpub.set([0x04, 0x5f, 0x1c, 0xf6], 0);
    expect(sameExtendedKey(TPUB_A, base58check.encode(vpub))).toBe(true);
  });

  it('refuses anything that is not an extended key, never loosely', () => {
    expect(sameExtendedKey(TPUB_A, TPUB_A.slice(0, 40))).toBe(false);
    expect(sameExtendedKey('', '')).toBe(false);
    expect(sameExtendedKey(TPUB_A, 'not a key')).toBe(false);
  });
});

describe('needsReRegistration', () => {
  it('only a shared vault, and only on a device that registers', () => {
    expect(needsReRegistration(true, { kind: 'ledger' })).toBe(true);
    expect(needsReRegistration(true, { kind: 'bitbox', model: 'nova' })).toBe(true);
    expect(needsReRegistration(true, { kind: 'passport' })).toBe(false);
    expect(needsReRegistration(false, { kind: 'ledger' })).toBe(false);
  });
});

describe('registersAfterReplacement', () => {
  it('the vault the owner came from is shown to a Ledger or BitBox, nobody asked', () => {
    expect(registersAfterReplacement(base, { kind: 'ledger' })).toBe(true);
    expect(registersAfterReplacement(base, { kind: 'bitbox', model: 'nova' })).toBe(true);
  });

  it('never a vault the new device cannot sign: a BitBox and a bare sh(multi)', () => {
    // Decided 2026-10-17: no ceremony that can only fail.
    const shMulti: WalletMeta = { ...base, descriptor: base.descriptor.replace(/^wsh\(sortedmulti\(/, 'sh(multi(') };
    expect(shMulti.descriptor.startsWith('sh(multi(')).toBe(true);
    expect(registersAfterReplacement(shMulti, { kind: 'bitbox', model: 'nova' })).toBe(false);
    expect(registersAfterReplacement(shMulti, { kind: 'ledger' })).toBe(true);
  });

  it('never a vault the new device cannot sign: a BitBox and a P2SH-wrapped wsh (decided 2026-10-17)', () => {
    // A BitBox02 simulator run: the BitBox refuses to register sh(wsh(sortedmulti)).
    const shWsh: WalletMeta = { ...base, descriptor: `sh(${base.descriptor.split('#')[0]})` };
    expect(shWsh.descriptor.startsWith('sh(wsh(sortedmulti(')).toBe(true);
    expect(registersAfterReplacement(shWsh, { kind: 'bitbox', model: 'nova' })).toBe(false);
    expect(registersAfterReplacement(shWsh, { kind: 'ledger' })).toBe(true);
  });

  it('never a Passport, never a single-key vault', () => {
    expect(registersAfterReplacement(base, { kind: 'passport' })).toBe(false);
    const single: WalletMeta = { ...base, descriptor: SPARROW_SINGLE_SIG, kind: 'single-sig' };
    expect(registersAfterReplacement(single, { kind: 'ledger' })).toBe(false);
  });
});
