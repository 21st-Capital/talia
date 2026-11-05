import {
  addressCheckKeysOf,
  addressCheckOffered,
  customerFingerprintsOf,
  hardwareRegistrationChecklist,
  primaryPathCustomerFingerprints,
  heirFingerprintsOf,
  knownDevicesFor,
  ledgerFingerprintsOf,
  ownKeysOnThisPhone,
  ownKeysToRegister,
  primaryPathFullyRegistered,
  registrationWalk,
  stepKeyOf,
  stepKeysOf,
  signingReach,
  signingDeviceFingerprintsOf,
  sendAccess,
  singleSigDevice,
  singleSigKeyId,
  vaultIsLedgerBound,
  vaultWasImported,
} from '../keyDevices';
import type { WalletMeta } from '../types';

/** BIP-341's NUMS point in a tpub: a provably unspendable internal key. */
const NUMS_KEY =
  'tpubD6NzVbkrYhZ4X6BRkDMxFyZxfUCQdjpK27dNgqwDqsQ2PUbMmjjPPFxfcTJiGEjeNz2zLbZ1PRmgCAzXn4pE6tEuQPScXyUbuAgdcec6pMN';

const TPUB_A = 'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';
const TPUB_B = 'tpubDCDuqEgbT3rnSzcJZC94rWJqBUyVbEgigqW9NkNkzyLYQCsNbTJVEWuLNfYzRe4EGkMK9ARxBDeHfxecFFrBAztDsZLYNiBB1uD86ZLpuXn';

function vault(over: Partial<WalletMeta>): WalletMeta {
  return {
    id: 'w1',
    label: 'Vault',
    descriptor: `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)`,
    network: 'testnet',
    kind: 'single-sig',
    source: 'created',
    transport: 'created',
    createdAt: 0,
    ...over,
  } as WalletMeta;
}

describe('ledgerFingerprintsOf', () => {
  it('merges keyDevices with registration records (legacy vaults)', () => {
    const w = vault({
      keyDevices: { '73c5da0a': { kind: 'ledger', model: 'gen5' } },
      ledgerRegistrations: {
        DEADBEEF: { name: 'V', descriptorTemplate: 't', keys: [], hmacHex: '00', appVersion: '2.5.0', registeredAt: 1 },
      },
    });
    expect(ledgerFingerprintsOf(w)).toEqual(new Set(['73c5da0a', 'deadbeef']));
  });
});

describe('signingDeviceFingerprintsOf', () => {
  // Decided 2026-09-18: the refresh session asked for a Ledger, so BitBox vaults
  // silently took the old one-at-a-time ceremony and it broke at the first
  // co-sign. Every capability gate goes through this helper now, and a new
  // brand has to appear here or this test fails.
  it('counts every brand the phone can drive, not just the Ledger', () => {
    const w = vault({
      keyDevices: {
        '73c5da0a': { kind: 'ledger', model: 'gen5' },
        '4a290600': { kind: 'bitbox' },
      },
      ledgerRegistrations: {
        DEADBEEF: { name: 'V', descriptorTemplate: 't', keys: [], hmacHex: '00', appVersion: '2.5.0', registeredAt: 1 },
      },
    });
    expect(signingDeviceFingerprintsOf(w)).toEqual(
      new Set(['73c5da0a', '4a290600', 'deadbeef']),
    );
  });

  it('a BitBox-only vault is never empty', () => {
    const w = vault({ keyDevices: { '4a290600': { kind: 'bitbox' } } });
    expect(signingDeviceFingerprintsOf(w).has('4a290600')).toBe(true);
  });

  it('leaves a key held on no device out', () => {
    expect(signingDeviceFingerprintsOf(vault({}))).toEqual(new Set());
  });
});

describe('customerFingerprintsOf', () => {
  it('excludes 21C keys and heir keys; the NUMS key never appears', () => {
    const w = vault({
      descriptor: `tr(${NUMS_KEY}/<0;1>/*,multi_a(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[0c21c051/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`,
      providerKeyFingerprints: ['0c21c051'],
    });
    expect(customerFingerprintsOf(w)).toEqual(['73c5da0a']);
  });

  it('is empty for manual portfolios', () => {
    expect(customerFingerprintsOf(vault({ manual: true, descriptor: '' }))).toEqual([]);
  });
});

describe('vaultIsLedgerBound', () => {
  it('true when the only customer key is Ledger-bound', () => {
    const w = vault({ keyDevices: { '73c5da0a': { kind: 'ledger' } } });
    expect(vaultIsLedgerBound(w)).toBe(true);
  });

  it('false when the bound keys cannot meet the threshold', () => {
    const w = vault({
      descriptor: `tr(${NUMS_KEY}/<0;1>/*,multi_a(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`,
      keyDevices: { '73c5da0a': { kind: 'ledger' } },
    });
    expect(vaultIsLedgerBound(w)).toBe(false);
  });

  it('true when the THRESHOLD is met by Ledger keys (1-of-2 with a hot key)', () => {
    const w = vault({
      descriptor: `wsh(sortedmulti(1,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`,
      keyDevices: { '73c5da0a': { kind: 'ledger' } },
    });
    expect(vaultIsLedgerBound(w)).toBe(true);
  });

  it('layered vault: ANY path the Ledger keys satisfy earns Send', () => {
    const layered = `tr(${NUMS_KEY}/<0;1>/*,{pk([73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*),and_v(v:pk([deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*),older(4320))})`;
    // The primary key is on the Ledger; the recovery key lives elsewhere.
    expect(
      vaultIsLedgerBound(vault({ descriptor: layered, keyDevices: { '73c5da0a': { kind: 'ledger' } } })),
    ).toBe(true);
    // Only the RECOVERY key is Ledger-held: the owner can still spend from
    // the phone once that layer's timelock opens — the ceremony rebuilds on
    // that branch and the countdown decides when. (Hiding Send here would
    // strand a heir/recovery holder whose only device is a Ledger.)
    expect(
      vaultIsLedgerBound(vault({ descriptor: layered, keyDevices: { deadbeef: { kind: 'ledger' } } })),
    ).toBe(true);
    // No key bound at all: nothing to sign with.
    expect(vaultIsLedgerBound(vault({ descriptor: layered }))).toBe(false);
  });

  it('heir-tagged key is excluded from the customer set, so the remaining key passes strictly', () => {
    const w = vault({
      descriptor: `wsh(sortedmulti(1,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`,
      keyDevices: { '73c5da0a': { kind: 'ledger' } },
      heirs: [{ email: 'heir@example.com', fingerprint: 'deadbeef' }],
    });
    expect(vaultIsLedgerBound(w)).toBe(true);
  });

  describe('21C and heir vaults: only the PRIMARY path needs registering (decided 2026-09-05)', () => {
    // The shape proven on-chain the same day: 2-of-2 primary with 21C,
    // one timelocked recovery key. The old strict rule demanded the recovery
    // key be registered too — a key a client may have handed to an heir.
    const LAYERED_21C = `tr(${NUMS_KEY}/<0;1>/*,{multi_a(2,[73c5da0a/48'/1'/1122'/2']${TPUB_A}/<0;1>/*,[0c21c051/48'/1'/1122'/2']${TPUB_B}/<0;1>/*),and_v(v:pk([deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*),older(52596))})`;

    it('primary customer key bound, timelocked key NOT bound → Send', () => {
      const w = vault({
        descriptor: LAYERED_21C,
        keyDevices: { '73c5da0a': { kind: 'ledger', model: 'gen5' } },
        providerKeyFingerprints: ['0c21c051'],
      });
      expect(vaultIsLedgerBound(w)).toBe(true);
    });

    it('only the timelocked key bound → no Send (the phone spends the primary path)', () => {
      const w = vault({
        descriptor: LAYERED_21C,
        keyDevices: { deadbeef: { kind: 'ledger' } },
        providerKeyFingerprints: ['0c21c051'],
      });
      expect(vaultIsLedgerBound(w)).toBe(false);
    });

    it('a BitBox-held primary key counts the same as a Ledger one', () => {
      const w = vault({
        descriptor: LAYERED_21C,
        keyDevices: { '73c5da0a': { kind: 'bitbox' } },
        providerKeyFingerprints: ['0c21c051'],
      });
      expect(vaultIsLedgerBound(w)).toBe(true);
    });

    it('imported vault: 21C key known only through providerFps → Send', () => {
      // An imported descriptor carries no providerKeyFingerprints tag; the
      // caller passes the live 21C set instead. Same verdict either way.
      const w = vault({ descriptor: LAYERED_21C, keyDevices: { '73c5da0a': { kind: 'ledger' } } });
      expect(vaultIsLedgerBound(w, new Set(['0c21c051']))).toBe(true);
    });

    it('nothing bound → no Send', () => {
      const w = vault({ descriptor: LAYERED_21C, providerKeyFingerprints: ['0c21c051'] });
      expect(vaultIsLedgerBound(w)).toBe(false);
    });

    it('our keys alone never make a vault "known", however many of them the path takes', () => {
      // Decided 2026-09-18: 21st Capital's key completes a spend, it never stands
      // in for hardware the client has. A 1-of-2 that OUR key satisfies on
      // its own, with no client device recorded, is watch only.
      const ours1of2 = `wsh(sortedmulti(1,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[0c21c051/48'/1'/1122'/2']${TPUB_B}/<0;1>/*))`;
      const w = vault({ descriptor: ours1of2, providerKeyFingerprints: ['0c21c051'] });
      expect(vaultIsLedgerBound(w)).toBe(false);
      expect(vaultIsLedgerBound(w, new Set(['0c21c051']))).toBe(false);
      // ...and the moment the client's own key is on a device we have seen, it is not.
      expect(
        vaultIsLedgerBound(vault({ descriptor: ours1of2, providerKeyFingerprints: ['0c21c051'], keyDevices: { '73c5da0a': { kind: 'bitbox' } } })),
      ).toBe(true);
    });

    it('heir vault with a 2-of-2 primary: one primary key bound is not enough', () => {
      // The relaxation is about WHICH path, never about the threshold within it.
      const twoKeyPrimary = `tr(${NUMS_KEY}/<0;1>/*,{multi_a(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[cafef00d/48'/1'/0'/2']${TPUB_B}/<0;1>/*),and_v(v:pk([deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*),older(4320))})`;
      const w = vault({
        descriptor: twoKeyPrimary,
        keyDevices: { '73c5da0a': { kind: 'ledger' } },
        heirs: [{ email: 'heir@example.com', fingerprint: 'deadbeef' }],
      });
      expect(vaultIsLedgerBound(w)).toBe(false);
      expect(
        vaultIsLedgerBound(vault({ ...w, keyDevices: { '73c5da0a': { kind: 'ledger' }, cafef00d: { kind: 'ledger' } } })),
      ).toBe(true);
    });
  });

  it('false when the vault records no customer keys at all', () => {
    expect(vaultIsLedgerBound(vault({ descriptor: `wpkh(${TPUB_A}/<0;1>/*)` }))).toBe(false);
  });

  it('a registration alone binds the key (pre-keyDevices vaults)', () => {
    const w = vault({
      ledgerRegistrations: {
        '73c5da0a': { name: 'V', descriptorTemplate: 't', keys: [], hmacHex: '00', appVersion: '2.5.0', registeredAt: 1 },
      },
    });
    expect(vaultIsLedgerBound(w)).toBe(true);
  });
});

describe('hardwareRegistrationChecklist', () => {
  const ledgerReg = {
    '73c5da0a': { name: 'V', descriptorTemplate: 't', keys: [], hmacHex: '00', appVersion: '2.5.0', registeredAt: 1 },
  };
  const TWO_KEY = `tr(${NUMS_KEY}/<0;1>/*,multi_a(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
  // Registration is a SHARED-vault matter (decided 2026-09-08): these rows only
  // exist for a vault with more than one key.
  const PAIR = `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
  const shared = (over: Partial<WalletMeta>) => vault({ kind: 'multisig', descriptor: PAIR, ...over });

  it('one row per device, unregistered until each proof record exists', () => {
    const w = shared({
      keyDevices: {
        '73c5da0a': { kind: 'ledger', model: 'gen5' },
        '4a290600': { kind: 'bitbox', model: 'nova' },
      },
      keyLabels: { '4a290600': 'BBNOVA TEST' },
    });
    expect(hardwareRegistrationChecklist(w)).toEqual([
      { kind: 'ledger', label: null, fingerprint: '73c5da0a', registered: false, heir: false },
      { kind: 'bitbox', label: 'BBNOVA TEST', fingerprint: '4a290600', registered: false, heir: false },
    ]);
  });

  it('ticks each device independently as its registration lands', () => {
    const w = shared({
      keyDevices: {
        '73c5da0a': { kind: 'ledger' },
        '4a290600': { kind: 'bitbox', model: 'nova' },
      },
      ledgerRegistrations: ledgerReg,
    });
    expect(hardwareRegistrationChecklist(w).map((i) => i.registered)).toEqual([true, false]);
    const done = vault({
      ...w,
      bitboxRegistrations: { '4a290600': { registeredAt: 2 } },
    });
    expect(hardwareRegistrationChecklist(done).every((i) => i.registered)).toBe(true);
  });

  it('never infers BitBox registration from keyDevices (the badge lied once)', () => {
    const w = shared({ keyDevices: { '4a290600': { kind: 'bitbox', model: 'nova' } } });
    // The descriptor key 73c5da0a sits on no recorded device, so it gets
    // the brand-neutral row, which searches for every adopted device.
    expect(hardwareRegistrationChecklist(w)).toEqual([
      { kind: 'unknown', label: null, fingerprint: '73c5da0a', registered: false, heir: false },
      { kind: 'bitbox', label: null, fingerprint: '4a290600', registered: false, heir: false },
    ]);
  });

  it("a registration for a DIFFERENT key than a device's own stays unticked", () => {
    const w = vault({
      descriptor: TWO_KEY,
      keyDevices: { deadbeef: { kind: 'ledger' } },
      ledgerRegistrations: ledgerReg, // 73c5da0a, not deadbeef
    });
    expect(hardwareRegistrationChecklist(w)).toEqual([
      // 73c5da0a has no recorded device: the brand-neutral row, already registered.
      { kind: 'unknown', label: null, fingerprint: '73c5da0a', registered: true, heir: false },
      { kind: 'ledger', label: null, fingerprint: 'deadbeef', registered: false, heir: false },
    ]);
  });

  it("the brand-neutral row for ONE key carries that key's name; for several keys none", () => {
    // Decided 2026-11-05 after a phone test: an imported vault whose keys
    // came with names offered "Your hardware" for a named key with no device.
    const one = shared({
      keyDevices: { '4a290600': { kind: 'bitbox', model: 'nova' } },
      keyLabels: { '73C5DA0A': 'Office Ledger', '4a290600': 'Desk BitBox' },
    });
    expect(hardwareRegistrationChecklist(one)).toEqual([
      { kind: 'unknown', label: 'Office Ledger', fingerprint: '73c5da0a', registered: false, heir: false },
      { kind: 'bitbox', label: 'Desk BitBox', fingerprint: '4a290600', registered: false, heir: false },
    ]);
    const unnamed = shared({ keyDevices: { '4a290600': { kind: 'bitbox', model: 'nova' } } });
    expect(hardwareRegistrationChecklist(unnamed)[0].label).toBeNull();
    const two = vault({
      descriptor: TWO_KEY,
      keyLabels: { '73c5da0a': 'Office Ledger', deadbeef: 'Bank Ledger' },
    });
    expect(hardwareRegistrationChecklist(two)).toEqual([
      { kind: 'unknown', label: null, fingerprint: null, registered: false, heir: false },
    ]);
  });

  it('two Ledgers are two rows, each named by its own key and ticked alone', () => {
    const w = vault({
      descriptor: TWO_KEY,
      keyDevices: { '73c5da0a': { kind: 'ledger' }, deadbeef: { kind: 'ledger' } },
      keyLabels: { '73c5da0a': 'Office Ledger', deadbeef: 'Bank Ledger' },
      ledgerRegistrations: ledgerReg,
    });
    expect(hardwareRegistrationChecklist(w)).toEqual([
      { kind: 'ledger', label: 'Office Ledger', fingerprint: '73c5da0a', registered: true, heir: false },
      { kind: 'ledger', label: 'Bank Ledger', fingerprint: 'deadbeef', registered: false, heir: false },
    ]);
  });

  it('a two-key legacy vault is NOT registered after one ceremony', () => {
    // The demand is the descriptor's customer keys, not the registrations
    // themselves — the self-satisfying set read fully registered here
    // (decided 2026-08-31).
    const w = vault({ descriptor: TWO_KEY, ledgerRegistrations: ledgerReg });
    expect(hardwareRegistrationChecklist(w)).toEqual([
      { kind: 'unknown', label: null, fingerprint: null, registered: false, heir: false },
    ]);
    const done = vault({
      descriptor: TWO_KEY,
      ledgerRegistrations: {
        ...ledgerReg,
        deadbeef: { ...ledgerReg['73c5da0a'] },
      },
    });
    expect(hardwareRegistrationChecklist(done)[0].registered).toBe(true);
  });

  it("excludes 21C keys from the legacy demand: they are not the owner's to register", () => {
    const w = vault({ descriptor: TWO_KEY, ledgerRegistrations: ledgerReg });
    expect(
      hardwareRegistrationChecklist(w, new Set(['deadbeef']))[0].registered,
    ).toBe(true);
  });

  it("flags a row whose key belongs to an heir, so nags can skip what the owner cannot finish", () => {
    const w = vault({
      descriptor: TWO_KEY,
      keyDevices: { '73c5da0a': { kind: 'ledger' }, deadbeef: { kind: 'ledger' } },
      heirs: [{ id: 'h1', fingerprint: 'DEADBEEF' }],
    });
    expect(hardwareRegistrationChecklist(w).map((i) => i.heir)).toEqual([false, true]);
  });

  it('a vault with no device memory gets ONE brand-neutral row, ticked by its registration', () => {
    const legacy = vault({ kind: 'multisig', descriptor: TWO_KEY });
    expect(hardwareRegistrationChecklist(legacy)).toEqual([
      { kind: 'unknown', label: null, fingerprint: null, registered: false, heir: false },
    ]);
    const bothRegistered = { ...ledgerReg, deadbeef: ledgerReg['73c5da0a'] };
    expect(
      hardwareRegistrationChecklist(vault({ ...legacy, ledgerRegistrations: bothRegistered }))[0].registered,
    ).toBe(true);
  });
});

describe('imported vaults and the Send gate (decided 2026-09-07)', () => {
  it('imported = brought in by paste, file, QR or NFC; created and portfolios are not', () => {
    expect(vaultWasImported(vault({ transport: 'paste' }))).toBe(true);
    expect(vaultWasImported(vault({ transport: 'file' }))).toBe(true);
    expect(vaultWasImported(vault({ transport: 'qr' }))).toBe(true);
    expect(vaultWasImported(vault({ transport: 'nfc' }))).toBe(true);
    expect(vaultWasImported(vault({ transport: 'created' }))).toBe(false);
    expect(vaultWasImported(vault({ transport: 'qr', manual: true }))).toBe(false);
  });

  it('a single-sig created in Talia: Send disabled until its key has a device, never hidden', () => {
    expect(sendAccess(vault({ transport: 'created' }))).toBe('disabled');
    expect(
      sendAccess(
        vault({
          transport: 'created',
          keyDevices: { '73c5da0a': { kind: 'ledger', model: 'gen5' } },
          ledgerRegistrations: { '73c5da0a': { hmacHex: 'aa', name: 'v', descriptorTemplate: 't', keys: [], appVersion: '2.2.1', registeredAt: 1 } },
        }),
      ),
    ).toBe('ready');
  });

  // Decided 2026-09-18: "No user should be able to even get to any send screen
  // unless we KNOW the hardware and we can support signing with the
  // hardware. If the user imports a vault and chooses watch only, that means
  // that it is WATCH ONLY." The client's word is not knowledge, and it used
  // to be enough.
  it('an imported single-sig stays watch only until a device is connected, whatever the owner says', () => {
    expect(sendAccess(vault({ transport: 'paste' }))).toBe('disabled');
    expect(sendAccess(vault({ transport: 'paste', registrationAttestedAt: 1 }))).toBe('disabled');
    expect(
      sendAccess(vault({ transport: 'paste', keyDevices: { '73c5da0a': { kind: 'bitbox' } } })),
    ).toBe('ready');
  });

  it('an attestation never opens Send anywhere, and a portfolio never sends', () => {
    expect(sendAccess(vault({ transport: 'created', registrationAttestedAt: 1 }))).toBe('disabled');
    expect(sendAccess(vault({ transport: 'paste', manual: true, registrationAttestedAt: 1 }))).toBe('hidden');
  });
});

describe('single-sig vaults and their one device (decided 2026-09-08)', () => {
  it('names the key by fingerprint, or by the key itself for a bare xpub', () => {
    expect(singleSigKeyId(vault({}))).toBe('73c5da0a');
    expect(singleSigKeyId(vault({ descriptor: `wpkh(${TPUB_A}/0/*)` }))).toBe(TPUB_A);
    expect(singleSigKeyId(vault({ kind: 'multisig' }))).toBeNull();
    expect(singleSigKeyId(vault({ manual: true }))).toBeNull();
  });

  it('Send is ready on any device kind, Passport included, with no registration', () => {
    for (const kind of ['ledger', 'bitbox', 'passport'] as const) {
      const w = vault({ transport: 'paste', keyDevices: { '73c5da0a': { kind } } });
      expect(singleSigDevice(w)?.kind).toBe(kind);
      expect(sendAccess(w)).toBe('ready');
      expect(hardwareRegistrationChecklist(w)).toEqual([]);
    }
  });

  it('a bare xpub remembers its device under the key itself', () => {
    const w = vault({ descriptor: `wpkh(${TPUB_A}/0/*)`, keyDevices: { [TPUB_A]: { kind: 'passport' } } });
    expect(singleSigDevice(w)?.kind).toBe('passport');
    expect(sendAccess(w)).toBe('ready');
  });

  it('only Bluetooth devices count as Ledger-bound; a Passport key does not', () => {
    expect(vaultIsLedgerBound(vault({ keyDevices: { '73c5da0a': { kind: 'passport' } } }))).toBe(false);
    expect(vaultIsLedgerBound(vault({ keyDevices: { '73c5da0a': { kind: 'bitbox' } } }))).toBe(true);
  });

  it('a Ledger registration from before the rule still names the device', () => {
    const w = vault({
      ledgerRegistrations: { '73C5DA0A': { hmacHex: 'aa', name: 'v', descriptorTemplate: 't', keys: [], appVersion: '2.2.1', registeredAt: 1 } },
    });
    expect(singleSigDevice(w)?.kind).toBe('ledger');
  });

  it('a multisig keeps its registration rows', () => {
    const w = vault({
      kind: 'multisig',
      descriptor: `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`,
      keyDevices: { '73c5da0a': { kind: 'ledger' }, deadbeef: { kind: 'bitbox' } },
    });
    expect(hardwareRegistrationChecklist(w).length).toBe(2);
  });
});

/**
 * THE THRESHOLD RULE (decided 2026-09-26): Send opens as soon as this phone can
 * reach a broadcast, not when every key has been registered.
 *
 * The rule: a 2-of-2 without us needs both devices registered; a 2-of-3
 * with us as co-signer reaches its threshold without the second device; a
 * 2-of-3 without us needs at least two devices.
 *
 * The case behind the rule: a Liana vault with a Ledger Nano X, a Ledger
 * Nano S and our co-signer, where the Nano S cannot be shown the vault at
 * all. Talia used to refuse such a vault, though the Nano X plus our
 * co-signature can spend from it.
 */
describe('Send opens when a broadcast is reachable (decided 2026-09-26)', () => {
  const reg = { hmacHex: 'aa', name: 'v', descriptorTemplate: 't', keys: [], appVersion: '2.2.1', registeredAt: 1 };
  const key = (fp: string, xpub: string) => `[${fp}/48'/1'/0'/2']${xpub}/<0;1>/*`;
  // A third key, so a trio names three distinct ones (BIP-32 test vector 3's seed at m/48'/1'/0'/2').
  const TPUB_3 =
    'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr';
  const OURS = '21c0c051';
  const known21C = new Set([OURS]);

  const shared = (descriptor: string, over: Partial<WalletMeta> = {}) =>
    vault({ transport: 'paste', kind: 'multisig', descriptor, ...over });

  const TWO_OF_TWO = `wsh(sortedmulti(2,${key('73c5da0a', TPUB_A)},${key('aabbccdd', TPUB_B)}))`;
  const ONE_OF_TWO = `wsh(sortedmulti(1,${key('73c5da0a', TPUB_A)},${key('aabbccdd', TPUB_B)}))`;
  const TWO_OF_THREE_OWN = `wsh(sortedmulti(2,${key('73c5da0a', TPUB_A)},${key('aabbccdd', TPUB_B)},${key('4a290600', TPUB_3)}))`;
  // Our co-signer is a key of the vault like any other; the descriptor a
  // client holds names it with our fingerprint and nothing else.
  const TWO_OF_THREE_WITH_US = `wsh(sortedmulti(2,${key('73c5da0a', TPUB_A)},${key('aabbccdd', TPUB_B)},${key(OURS, TPUB_3)}))`;
  const TWO_OF_TWO_WITH_US = `wsh(sortedmulti(2,${key('73c5da0a', TPUB_A)},${key(OURS, TPUB_B)}))`;

  const ledger = (...fps: string[]) =>
    Object.fromEntries(fps.map((fp) => [fp, { kind: 'ledger' as const, model: 'gen5' as const }]));

  it('2 of 2, no 21st Capital key: one device is not enough, two are', () => {
    const one = shared(TWO_OF_TWO, { keyDevices: ledger('73c5da0a') });
    expect(sendAccess(one)).toBe('disabled');
    expect(signingReach(one).shortBy).toBe(1);
    const both = shared(TWO_OF_TWO, { keyDevices: ledger('73c5da0a', 'aabbccdd') });
    expect(sendAccess(both)).toBe('ready');
    expect(signingReach(both)).toMatchObject({ needed: 2, shortBy: 0, canBroadcast: true });
  });

  it('2 of 3 with us as co-signer: ONE device reaches the threshold', () => {
    const w = shared(TWO_OF_THREE_WITH_US, { keyDevices: ledger('73c5da0a') });
    expect(sendAccess(w, known21C)).toBe('ready');
    expect(signingReach(w, known21C)).toMatchObject({
      needed: 2,
      ready: ['73c5da0a'],
      missing: ['aabbccdd'],
      ours: [OURS],
      canBroadcast: true,
    });
  });

  it("the client's Nano X alone, when the Nano S refuses the vault", () => {
    // What he actually has on the phone: one device met, one key it could
    // never be shown, our co-signer waiting.
    const w = shared(TWO_OF_THREE_WITH_US, {
      keyDevices: ledger('73c5da0a'),
      ledgerRegistrations: { '73c5da0a': reg },
    });
    expect(sendAccess(w, known21C)).toBe('ready');
    // And Talia keeps asking for the other device (the rule: "still ask them the
    // usual next steps").
    expect(hardwareRegistrationChecklist(w, known21C).some((i) => !i.registered)).toBe(true);
  });

  it('2 of 2 where the second key is ours: one device is the whole spend', () => {
    const w = shared(TWO_OF_TWO_WITH_US, { keyDevices: ledger('73c5da0a') });
    expect(sendAccess(w, known21C)).toBe('ready');
  });

  it('2 of 3 without us: one device is not enough, two are', () => {
    const one = shared(TWO_OF_THREE_OWN, { keyDevices: ledger('73c5da0a') });
    expect(sendAccess(one)).toBe('disabled');
    expect(signingReach(one).shortBy).toBe(1);
    const two = shared(TWO_OF_THREE_OWN, { keyDevices: ledger('73c5da0a', '4a290600') });
    expect(sendAccess(two)).toBe('ready');
  });

  it('1 of 2: the one device that can sign opens Send', () => {
    const w = shared(ONE_OF_TWO, { keyDevices: ledger('73c5da0a') });
    expect(sendAccess(w)).toBe('ready');
  });

  it('our key alone never opens Send', () => {
    const w = shared(TWO_OF_TWO_WITH_US);
    expect(sendAccess(w, known21C)).toBe('disabled');
    expect(signingReach(w, known21C).canBroadcast).toBe(false);
    const three = shared(TWO_OF_THREE_WITH_US);
    expect(sendAccess(three, known21C)).toBe('disabled');
  });

  it('a registration counts as knowing the device, with no keyDevices row', () => {
    const w = shared(TWO_OF_THREE_WITH_US, { ledgerRegistrations: { '73c5da0a': reg } });
    expect(sendAccess(w, known21C)).toBe('ready');
  });

  it('a bare sh(multi) key on a BitBox opens nothing; on a Ledger it does', () => {
    // The BitBox cannot sign a legacy P2SH multisig (decided
    // 2026-10-17): its key never counts toward Send there.
    const SH_MULTI = `sh(multi(1,${key('73c5da0a', TPUB_A)},${key('aabbccdd', TPUB_B)}))`;
    const onBitbox = shared(SH_MULTI, { keyDevices: { '73c5da0a': { kind: 'bitbox', model: 'nova' } } });
    expect(signingReach(onBitbox).canBroadcast).toBe(false);
    expect(sendAccess(onBitbox)).toBe('disabled');
    expect(sendAccess(shared(SH_MULTI, { keyDevices: ledger('73c5da0a') }))).toBe('ready');
  });

  it('a P2SH-wrapped wsh key on a BitBox opens nothing; on a Ledger it does (decided 2026-10-17)', () => {
    // The BitBox cannot register an sh(wsh(...)) (a BitBox02 simulator run): its
    // key never counts toward Send there, the plain wsh still does.
    const keys = `${key('73c5da0a', TPUB_A)},${key('aabbccdd', TPUB_B)}`;
    const nova = { '73c5da0a': { kind: 'bitbox' as const, model: 'nova' as const } };
    for (const d of [`sh(wsh(sortedmulti(1,${keys})))`, `sh(wsh(multi(1,${keys})))`]) {
      const onBitbox = shared(d, { keyDevices: nova });
      expect({ d, reach: signingReach(onBitbox).canBroadcast, send: sendAccess(onBitbox) }).toEqual({ d, reach: false, send: 'disabled' });
      expect({ d, send: sendAccess(shared(d, { keyDevices: ledger('73c5da0a') })) }).toEqual({ d, send: 'ready' });
    }
    expect(sendAccess(shared(`wsh(sortedmulti(1,${keys}))`, { keyDevices: nova }))).toBe('ready');
  });

  it('a Passport key can never carry a multisig', () => {
    const w = shared(TWO_OF_THREE_WITH_US, { keyDevices: { '73c5da0a': { kind: 'passport' } } });
    expect(sendAccess(w, known21C)).toBe('disabled');
  });

  it('a vault built in Talia hides Send until a device is met, rather than dimming it', () => {
    const built = shared(TWO_OF_THREE_WITH_US, { transport: 'created' });
    expect(sendAccess(built, known21C)).toBe('hidden');
    expect(sendAccess({ ...built, keyDevices: ledger('73c5da0a') }, known21C)).toBe('ready');
  });

  it('a policy Talia cannot read reaches nothing', () => {
    const w = shared('wsh(thresh(2,pk(A),s:pk(B),sln:older(144)))', { keyDevices: ledger('73c5da0a') });
    expect(signingReach(w).canBroadcast).toBe(false);
    expect(sendAccess(w)).toBe('disabled');
  });
});

describe('every adopted device, never one brand by default (decided 2026-09-22)', () => {
  const PAIR = `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;

  it('a BitBox registration ticks a key whose device was never recorded', () => {
    const w = vault({
      kind: 'multisig',
      descriptor: PAIR,
      transport: 'qr',
      bitboxRegistrations: { '73c5da0a': { registeredAt: 1 }, '4a290600': { registeredAt: 1 } },
    });
    expect(hardwareRegistrationChecklist(w)).toEqual([
      { kind: 'unknown', label: null, fingerprint: null, registered: true, heir: false },
    ]);
    expect(primaryPathFullyRegistered(w)).toBe(true);
  });
});

describe("the heir's own phone (decided 2026-09-22)", () => {
  // A 2-of-3 whose first layer holds the owner (73c5da0a), the heir
  // (4a290600) and 21st Capital (deadbeef); the heir key has no timelock.
  const TRIO = `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB_A}/<0;1>/*))`;
  const heirPhone = (over: Partial<WalletMeta> = {}) =>
    vault({
      kind: 'multisig',
      descriptor: TRIO,
      transport: 'qr',
      heirVault: true,
      heirKeyFingerprint: '4a290600',
      providerKeyFingerprints: ['deadbeef'],
      ...over,
    });

  it("asks the heir about their own key only, never the owner's", () => {
    expect(ownKeysOnThisPhone(heirPhone())).toEqual(['4a290600']);
    expect(hardwareRegistrationChecklist(heirPhone())).toEqual([
      { kind: 'unknown', label: null, fingerprint: '4a290600', registered: false, heir: false },
    ]);
  });

  it("the heir's key is not an heir key on their own phone", () => {
    expect(heirFingerprintsOf(heirPhone()).has('4a290600')).toBe(false);
    // On the OWNER's phone it still is.
    expect(heirFingerprintsOf(heirPhone({ heirVault: false })).has('4a290600')).toBe(true);
  });

  it('their device, once recorded and registered, clears the list', () => {
    const w = heirPhone({
      keyDevices: { '4a290600': { kind: 'bitbox', model: 'nova' } },
      bitboxRegistrations: { '4a290600': { registeredAt: 1 } },
    });
    expect(hardwareRegistrationChecklist(w)).toEqual([
      { kind: 'bitbox', label: null, fingerprint: '4a290600', registered: true, heir: false },
    ]);
  });

  // After the unseal the heir holds an ordinary vault whose key spends on its
  // branch (decided 2026-07-24/27). Send opens on the heir's OWN key, registered
  // on this phone; the owner's key never counts there (decided 2026-09-22:
  // Send stayed dimmed and the tap looped back to a finished registration).
  it('opens Send once the heir registered their own device here', () => {
    const w = heirPhone({
      keyDevices: { '4a290600': { kind: 'bitbox', model: 'nova' } },
      bitboxRegistrations: { '4a290600': { registeredAt: 1 } },
    });
    expect(sendAccess(w)).toBe('ready');
    expect(vaultIsLedgerBound(w)).toBe(true);
  });

  // The heir is judged by the same threshold rule as an owner (decided
  // 2026-09-26): the device on record is what Talia knows, and the signing
  // ceremony shows the vault to a device that has not seen it yet. Before
  // that, an heir whose device was recorded but not yet registered here was
  // sent back to a registration they could only finish at signing time.
  it('their device on record opens Send, and registering is still asked for', () => {
    const w = heirPhone({ keyDevices: { '4a290600': { kind: 'bitbox', model: 'nova' } } });
    expect(sendAccess(w)).toBe('ready');
    expect(vaultIsLedgerBound(w)).toBe(true);
    expect(hardwareRegistrationChecklist(w).some((i) => !i.registered)).toBe(true);
  });

  it('nothing on record: watch only', () => {
    expect(sendAccess(heirPhone())).toBe('disabled');
    expect(vaultIsLedgerBound(heirPhone())).toBe(false);
  });

  it("the OWNER's registration on the heir's phone opens nothing", () => {
    const w = heirPhone({
      keyDevices: { '73c5da0a': { kind: 'ledger' } },
      ledgerRegistrations: { '73c5da0a': {} as never },
    });
    expect(sendAccess(w)).toBe('disabled');
  });

  it('a keyless heir holds nothing that signs', () => {
    expect(sendAccess(heirPhone({ heirKeyFingerprint: undefined }))).toBe('hidden');
  });
});

describe('knownDevicesFor', () => {
  it('finds a device another vault already proved for the key, whatever the case', () => {
    const others: Array<Pick<WalletMeta, 'keyDevices'>> = [
      { keyDevices: { '4A290600': { kind: 'bitbox', model: 'nova' } } },
      { keyDevices: {} },
    ];
    expect(knownDevicesFor(['4a290600', 'ffffffff'], others)).toEqual({ '4a290600': { kind: 'bitbox', model: 'nova' } });
  });
});

describe('an imported 2-of-2 with our co-signer asks about ONE device (decided 2026-09-23)', () => {
  // "When you register a 2/2 where the second key is a cosigner on a
  // hardware, the app asks the user to register the next device even though
  // there is only one key from the client... This happens only if you import
  // a vault." An imported vault carries no providerKeyFingerprints tag, so
  // the primary-path filter read it as plain self custody, kept every key of
  // the descriptor and asked for the recovery key's device too.
  const MINE = '3442193e';
  const OURS = '49578625';
  const RECOVERY = 'cc000006';
  /** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
  const TPUB_MINE =
    'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg';
  /** Stand-ins for our key and the recovery key: BIP-32 test vectors 2 and 3's seeds at m/48'/1'/0'/2'. */
  const TPUB_OURS =
    'tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ';
  const TPUB_C =
    'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr';
  /** The vault's internal key: the unspendable one Liana derives from its three keys, in tree order. */
  const NUMS =
    'tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ';

  /** The reported vault: everyday 2 of 2 with us, recovery on a third key. */
  const imported = () =>
    vault({
      kind: 'multisig',
      transport: 'file',
      // No providerKeyFingerprints: nothing on an import says which key is ours.
      descriptor:
        `tr(${NUMS}/<0;1>/*,{multi_a(2,[${MINE}/48'/1'/0'/2']${TPUB_MINE}/<0;1>/*,` +
        `[${OURS}/48'/1'/1122'/2']${TPUB_OURS}/<0;1>/*),` +
        `and_v(v:pk([${RECOVERY}/48'/1'/0'/2']${TPUB_C}/<0;1>/*),older(52596))})`,
    });

  it('asks for the primary path key only, once it knows which key is ours', () => {
    const live = new Set([OURS]);
    const rows = hardwareRegistrationChecklist(imported(), live);
    expect(rows).toHaveLength(1);
    expect(rows[0].fingerprint).toBe(MINE);
  });

  it('never asks about the key we issued', () => {
    const rows = hardwareRegistrationChecklist(imported(), new Set([OURS]));
    expect(rows.map((r) => r.fingerprint)).not.toContain(OURS);
  });

  it('and the recovery key is not a device the owner must produce today', () => {
    const rows = hardwareRegistrationChecklist(imported(), new Set([OURS]));
    expect(rows.map((r) => r.fingerprint)).not.toContain(RECOVERY);
  });

  it('is the same answer Send asks for, so the two can never disagree', () => {
    const live = new Set([OURS]);
    expect(primaryPathCustomerFingerprints(imported(), live)).toEqual([MINE]);
  });

  it('still asks for every key when nothing says a key is ours', () => {
    // No tag and no live set: the vault reads as plain self custody, and
    // failing closed means asking rather than skipping a real device.
    const rows = hardwareRegistrationChecklist(imported());
    expect(rows[0].fingerprint).toBeNull();
  });
});

describe('a vault\u2019s own keys as a hardware step meets them (decided 2026-10-04: list the KNOWN keys with their devices)', () => {
  const PAIR = `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
  const ledgerReg = {
    '73c5da0a': { name: 'V', descriptorTemplate: 't', keys: [], hmacHex: '00', appVersion: '2.5.0', registeredAt: 1 },
  };

  it('the name every screen gives the key (the owner\u2019s label, else its number), never its fingerprint, with the device the vault knows', () => {
    const w = vault({
      kind: 'multisig',
      descriptor: PAIR,
      keyLabels: { '4a290600': 'BBNOVA TEST' },
      keyDevices: { '4A290600': { kind: 'bitbox', model: 'nova' } },
      ledgerRegistrations: ledgerReg,
    });
    expect(stepKeyOf(w, '4A290600')).toEqual({ id: '4a290600', name: 'BBNOVA TEST', record: { kind: 'bitbox', model: 'nova' } });
    // A Ledger registration from before records were kept still names the brand.
    expect(stepKeyOf(w, '73c5da0a')).toEqual({ id: '73c5da0a', name: 'Key 1', record: { kind: 'ledger' } });
    expect(stepKeysOf(w, ['73c5da0a', '4a290600']).map((k) => k.name)).toEqual(['Key 1', 'BBNOVA TEST']);
    for (const k of stepKeysOf(w, ['73c5da0a', '4a290600'])) expect(k.name).not.toMatch(/^[0-9a-f]{8}$/i);
  });

  it('a single-sig vault\u2019s one key is named after the vault, as the signing screen names it; a bare key keeps its xpub as its id', () => {
    const w = vault({ label: 'Savings' });
    expect(stepKeyOf(w, '73c5da0a')).toEqual({ id: '73c5da0a', name: 'Savings', record: null });
    const bare = vault({ label: 'Bare', descriptor: `wpkh(${TPUB_A}/<0;1>/*)`, keyDevices: { [TPUB_A]: { kind: 'ledger', model: 'nanoX' } } });
    expect(stepKeyOf(bare, TPUB_A)).toEqual({ id: TPUB_A.toLowerCase(), name: 'Bare', record: { kind: 'ledger', model: 'nanoX' } });
  });

  it('our own key is numbered by nobody: handed our fingerprints, the name falls back and the record is null', () => {
    const w = vault({ kind: 'multisig', descriptor: PAIR });
    expect(stepKeyOf(w, '4a290600', new Set(['4a290600'])).record).toBeNull();
    expect(stepKeyOf(w, '73c5da0a', new Set(['4a290600'])).name).toBe('Key 1');
  });

  it('the keys still to register, one per key: the everyday keys in the descriptor\u2019s order, recorded ones after, registered ones gone; none on a single-sig', () => {
    const w = vault({ kind: 'multisig', descriptor: PAIR });
    expect(ownKeysToRegister(w)).toEqual(['73c5da0a', '4a290600']);
    expect(ownKeysToRegister(vault({ ...w, ledgerRegistrations: ledgerReg }))).toEqual(['4a290600']);
    expect(ownKeysToRegister(vault({ ...w, ledgerRegistrations: ledgerReg, bitboxRegistrations: { '4a290600': { registeredAt: 2 } } }))).toEqual([]);
    expect(ownKeysToRegister(vault({}))).toEqual([]);
    // Our co-signer is never the owner's to register.
    expect(ownKeysToRegister(w, new Set(['4a290600']))).toEqual(['73c5da0a']);
    // Not even with a device on record under its fingerprint (the address
    // check records any vault key a device proves; decided 2026-10-04): by
    // the live set, or by the vault's own tag.
    const oursRecorded = { keyDevices: { '4a290600': { kind: 'ledger', model: 'gen5' } } } as Partial<WalletMeta>;
    expect(ownKeysToRegister(vault({ ...w, ...oursRecorded }), new Set(['4a290600']))).toEqual(['73c5da0a']);
    expect(ownKeysToRegister(vault({ ...w, ...oursRecorded, providerKeyFingerprints: ['4A290600'] }))).toEqual(['73c5da0a']);
    // What it lists is exactly what the checklist asks about, key by key.
    for (const v of [w, vault({ ...w, ledgerRegistrations: ledgerReg }), vault({ ...w, keyDevices: { '4a290600': { kind: 'bitbox', model: 'nova' } } })]) {
      const asked = hardwareRegistrationChecklist(v).filter((i) => !i.registered && !i.heir);
      const named = asked.flatMap((i) => (i.fingerprint ? [i.fingerprint] : []));
      for (const fp of named) expect(ownKeysToRegister(v)).toContain(fp);
      expect(ownKeysToRegister(v).length >= asked.length).toBe(true);
    }
  });

  it('a recorded Passport is no row to register (it is shown no vault), an heir\u2019s recorded key is never the owner\u2019s', () => {
    const w = vault({
      kind: 'multisig',
      descriptor: PAIR,
      keyDevices: { '73c5da0a': { kind: 'passport' }, deadbeef: { kind: 'ledger', model: 'gen5' } },
      heirs: [{ id: 'h1', name: 'Alex Example', fingerprint: 'deadbeef' }] as WalletMeta['heirs'],
    });
    expect(ownKeysToRegister(w)).toEqual(['73c5da0a', '4a290600']);
  });
});

describe('the address check lists only keys a device can show it for (decided 2026-10-04)', () => {
  const PAIR = `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
  const ledgerReg = {
    '73c5da0a': { name: 'V', descriptorTemplate: 't', keys: [], hmacHex: '00', appVersion: '2.5.0', registeredAt: 1 },
  };

  it('a Ledger key of a shared vault the Ledger was never shown is left out; a registered one, a BitBox key and a key with no record stay', () => {
    const w = vault({
      kind: 'multisig',
      descriptor: PAIR,
      keyDevices: { '73c5da0a': { kind: 'ledger', model: 'flex' }, '4a290600': { kind: 'bitbox', model: 'nova' } },
    });
    expect(addressCheckKeysOf(w, ['73c5da0a', '4a290600'])).toEqual(['4a290600']);
    expect(addressCheckKeysOf(vault({ ...w, ledgerRegistrations: ledgerReg }), ['73c5da0a', '4a290600'])).toEqual(['73c5da0a', '4a290600']);
    // The registration record is looked up whatever case it was filed in.
    expect(addressCheckKeysOf(vault({ ...w, ledgerRegistrations: { '73C5DA0A': ledgerReg['73c5da0a'] } }), ['73C5DA0A'])).toEqual(['73C5DA0A']);
    // A key with no record is asked which device, and stays.
    expect(addressCheckKeysOf(vault({ kind: 'multisig', descriptor: PAIR }), ['73c5da0a', '4a290600'])).toEqual(['73c5da0a', '4a290600']);
    // A Ledger registration from before records were kept IS the registration.
    expect(addressCheckKeysOf(vault({ kind: 'multisig', descriptor: PAIR, ledgerRegistrations: ledgerReg }), ['73c5da0a'])).toEqual(['73c5da0a']);
  });

  it('a one-key vault is never registered: its Ledger key stays', () => {
    expect(addressCheckKeysOf(vault({ keyDevices: { '73c5da0a': { kind: 'ledger', model: 'gen5' } } }), ['73c5da0a'])).toEqual(['73c5da0a']);
  });
});

describe('Receive offers the hardware address check only where a device can do it (decided 2026-10-04)', () => {
  const PAIR = `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[4a290600/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;

  it('a single key kept by its bare xpub is bound but never offered: a Ledger cannot verify a key with no origin', () => {
    const bare = vault({ descriptor: `wpkh(${TPUB_A}/<0;1>/*)`, keyDevices: { [TPUB_A]: { kind: 'ledger', model: 'gen5' } } });
    expect(vaultIsLedgerBound(bare)).toBe(true);
    expect(addressCheckOffered(bare)).toBe(false);
  });

  it('a fingerprinted single key on a Ledger is offered; on a BitBox not yet; a shared vault on any Bluetooth device; an unbound vault never', () => {
    expect(addressCheckOffered(vault({ keyDevices: { '73c5da0a': { kind: 'ledger', model: 'gen5' } } }))).toBe(true);
    expect(addressCheckOffered(vault({ keyDevices: { '73c5da0a': { kind: 'bitbox', model: 'nova' } } }))).toBe(false);
    expect(addressCheckOffered(vault({ keyDevices: { '73c5da0a': { kind: 'passport' } } }))).toBe(false);
    expect(addressCheckOffered(vault({}))).toBe(false);
    const shared = vault({ kind: 'multisig', descriptor: PAIR, keyDevices: { '73c5da0a': { kind: 'ledger' }, '4a290600': { kind: 'bitbox' } } });
    expect(addressCheckOffered(shared)).toBe(true);
    expect(addressCheckOffered(vault({ kind: 'multisig', descriptor: PAIR }))).toBe(false);
  });
});

describe('a non-ranged vault opens nothing on a Ledger or a BitBox (decided 2026-10-17)', () => {
  // The library corpus's shapes i-nonranged-wpkh and i-nonranged-wsh-multi: one
  // fixed address, which no BIP-388 device can be shown. A record of the key
  // on such a device (carried over from another vault at import, or written
  // by a refused signing attempt) is where the key lives, never a way to sign.
  const FIXED_ONE = `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/0/7)`;
  const RANGED_ONE = `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)`;
  const fixedMulti = (k: number) => `wsh(multi(${k},[73c5da0a/48'/1'/0'/2']${TPUB_A}/0/5,[aabbccdd/48'/1'/0'/2']${TPUB_B}/0/5))`;
  const rangedMulti = (k: number) => `wsh(multi(${k},[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[aabbccdd/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
  const ledgers = { '73c5da0a': { kind: 'ledger' as const, model: 'gen5' as const }, aabbccdd: { kind: 'ledger' as const, model: 'flex' as const } };
  const boxes = { '73c5da0a': { kind: 'bitbox' as const, model: 'nova' as const }, aabbccdd: { kind: 'bitbox' as const, model: 'nova' as const } };

  it('one key on a Ledger: watch only, no address check (the ranged vault opens both)', () => {
    const w = (descriptor: string) => vault({ descriptor, transport: 'paste', keyDevices: { '73c5da0a': ledgers['73c5da0a'] } });
    expect(sendAccess(w(FIXED_ONE))).toBe('disabled');
    expect(signingReach(w(FIXED_ONE)).canBroadcast).toBe(false);
    expect(vaultIsLedgerBound(w(FIXED_ONE))).toBe(false);
    expect(addressCheckOffered(w(FIXED_ONE))).toBe(false);
    expect(sendAccess(w(RANGED_ONE))).toBe('ready');
    expect(addressCheckOffered(w(RANGED_ONE))).toBe(true);
  });

  it('one key on a BitBox: watch only', () => {
    const w = (descriptor: string) => vault({ descriptor, transport: 'paste', keyDevices: { '73c5da0a': boxes['73c5da0a'] } });
    expect(sendAccess(w(FIXED_ONE))).toBe('disabled');
    expect(sendAccess(w(RANGED_ONE))).toBe('ready');
  });

  it('a shared vault with every key on a Ledger or a BitBox: watch only, no address check', () => {
    for (const keyDevices of [ledgers, boxes]) {
      for (const k of [1, 2]) {
        const fixed = vault({ kind: 'multisig', transport: 'paste', descriptor: fixedMulti(k), keyDevices });
        expect({ k, send: sendAccess(fixed), reach: signingReach(fixed).canBroadcast, bound: vaultIsLedgerBound(fixed), check: addressCheckOffered(fixed) }).toEqual({
          k,
          send: 'disabled',
          reach: false,
          bound: false,
          check: false,
        });
        const ranged = vault({ kind: 'multisig', transport: 'paste', descriptor: rangedMulti(k), keyDevices });
        expect({ k, send: sendAccess(ranged), check: addressCheckOffered(ranged) }).toEqual({ k, send: 'ready', check: true });
      }
    }
  });

  it("an old Ledger registration under the key counts for nothing either", () => {
    const reg = { hmacHex: 'aa', name: 'v', descriptorTemplate: 't', keys: [], appVersion: '2.2.1', registeredAt: 1 };
    const w = vault({ kind: 'multisig', transport: 'paste', descriptor: fixedMulti(1), ledgerRegistrations: { '73c5da0a': reg } });
    expect(sendAccess(w)).toBe('disabled');
    expect(addressCheckOffered(w)).toBe(false);
  });

  it("on an heir's phone, the heir's key on a Ledger opens nothing", () => {
    const heir = (descriptor: string) =>
      vault({
        kind: 'multisig',
        descriptor,
        transport: 'qr',
        heirVault: true,
        heirKeyFingerprint: 'aabbccdd',
        keyDevices: { aabbccdd: ledgers.aabbccdd },
      });
    expect(sendAccess(heir(fixedMulti(1)))).toBe('disabled');
    expect(vaultIsLedgerBound(heir(fixedMulti(1)))).toBe(false);
    expect(sendAccess(heir(rangedMulti(1)))).toBe('ready');
  });
});

describe('a bare sh(multi) never asks a BitBox to register it (decided 2026-10-17)', () => {
  // The case: 73c5da0a was recorded as a BitBox in another vault
  // and the import carried the record over. The BitBox cannot be shown a
  // legacy P2SH multisig, so its row could never be ticked, and "Register
  // now" opened an empty device list.
  const KEY_A = `[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*`;
  const KEY_B = `[aabbccdd/48'/1'/0'/2']${TPUB_B}/<0;1>/*`;
  const SH_MULTI = `sh(multi(1,${KEY_A},${KEY_B}))`;
  const WSH_MULTI = `wsh(multi(1,${KEY_A},${KEY_B}))`;
  const nova = { kind: 'bitbox' as const, model: 'nova' as const };
  const w = (descriptor: string, keyDevices: WalletMeta['keyDevices']) =>
    vault({ kind: 'multisig', transport: 'paste', descriptor, keyDevices });

  it('no BitBox row, and the key is not asked about as a key of unknown device either', () => {
    const shMulti = w(SH_MULTI, { '73c5da0a': nova });
    expect(registrationWalk(shMulti).some((i) => i.kind === 'bitbox')).toBe(false);
    expect(registrationWalk(shMulti)).toEqual([{ kind: 'unknown', label: null, fingerprint: 'aabbccdd', registered: false, heir: false }]);
    expect(hardwareRegistrationChecklist(shMulti).some((i) => i.fingerprint === '73c5da0a')).toBe(false);
    expect(ownKeysToRegister(shMulti)).toEqual(['aabbccdd']);
    // Both keys on BitBoxes: nothing to register, so no card at all.
    expect(registrationWalk(w(SH_MULTI, { '73c5da0a': nova, aabbccdd: nova }))).toEqual([]);
    expect(ownKeysToRegister(w(SH_MULTI, { '73c5da0a': nova, aabbccdd: nova }))).toEqual([]);
  });

  it('the same keys in a wsh(multi) still ask the BitBox, and a Ledger still takes the sh(multi)', () => {
    const wshMulti = w(WSH_MULTI, { '73c5da0a': nova });
    expect(registrationWalk(wshMulti).filter((i) => i.kind === 'bitbox').map((i) => i.fingerprint)).toEqual(['73c5da0a']);
    expect(ownKeysToRegister(wshMulti)).toEqual(['73c5da0a', 'aabbccdd']);
    const onLedger = w(SH_MULTI, { '73c5da0a': { kind: 'ledger', model: 'gen5' } });
    expect(registrationWalk(onLedger).filter((i) => i.kind === 'ledger').map((i) => i.fingerprint)).toEqual(['73c5da0a']);
    expect(ownKeysToRegister(onLedger)).toEqual(['73c5da0a', 'aabbccdd']);
  });

  it('the address check does not list the BitBox key; a key with no record and a Ledger key stay', () => {
    const shMulti = w(SH_MULTI, { '73c5da0a': nova });
    expect(addressCheckKeysOf(shMulti, ['73c5da0a', 'aabbccdd'])).toEqual(['aabbccdd']);
    expect(addressCheckKeysOf(w(WSH_MULTI, { '73c5da0a': nova }), ['73c5da0a', 'aabbccdd'])).toEqual(['73c5da0a', 'aabbccdd']);
  });
});

describe('a P2SH-wrapped wsh never asks a BitBox to register it (decided 2026-10-17)', () => {
  // A BitBox02 simulator run: the BitBox refused all seven
  // sh(wsh(sortedmulti)) registrations ("invalid input"), the BitBox bridge
  // sending them as a policy the device has no sh-wrapped form of. Same
  // case as the bare sh(multi): a BitBox record carried over at import.
  const KEY_A = `[73c5da0a/48'/1'/0'/1']${TPUB_A}/<0;1>/*`;
  const KEY_B = `[aabbccdd/48'/1'/0'/1']${TPUB_B}/<0;1>/*`;
  const SH_WSH = `sh(wsh(sortedmulti(1,${KEY_A},${KEY_B})))`;
  const WSH = `wsh(sortedmulti(1,${KEY_A},${KEY_B}))`;
  const nova = { kind: 'bitbox' as const, model: 'nova' as const };
  const w = (descriptor: string, keyDevices: WalletMeta['keyDevices']) =>
    vault({ kind: 'multisig', transport: 'paste', descriptor, keyDevices });

  it('no BitBox row, and the key is not asked about as a key of unknown device either', () => {
    const shWsh = w(SH_WSH, { '73c5da0a': nova });
    expect(registrationWalk(shWsh)).toEqual([{ kind: 'unknown', label: null, fingerprint: 'aabbccdd', registered: false, heir: false }]);
    expect(hardwareRegistrationChecklist(shWsh).some((i) => i.fingerprint === '73c5da0a')).toBe(false);
    expect(ownKeysToRegister(shWsh)).toEqual(['aabbccdd']);
    expect(registrationWalk(w(SH_WSH, { '73c5da0a': nova, aabbccdd: nova }))).toEqual([]);
    expect(ownKeysToRegister(w(SH_WSH, { '73c5da0a': nova, aabbccdd: nova }))).toEqual([]);
  });

  it('the same keys in a plain wsh still ask the BitBox, and a Ledger still takes the sh(wsh)', () => {
    expect(registrationWalk(w(WSH, { '73c5da0a': nova })).filter((i) => i.kind === 'bitbox').map((i) => i.fingerprint)).toEqual(['73c5da0a']);
    expect(ownKeysToRegister(w(WSH, { '73c5da0a': nova }))).toEqual(['73c5da0a', 'aabbccdd']);
    const onLedger = w(SH_WSH, { '73c5da0a': { kind: 'ledger', model: 'gen5' } });
    expect(registrationWalk(onLedger).filter((i) => i.kind === 'ledger').map((i) => i.fingerprint)).toEqual(['73c5da0a']);
    expect(ownKeysToRegister(onLedger)).toEqual(['73c5da0a', 'aabbccdd']);
  });

  it('the address check does not list the BitBox key; a key with no record stays', () => {
    expect(addressCheckKeysOf(w(SH_WSH, { '73c5da0a': nova }), ['73c5da0a', 'aabbccdd'])).toEqual(['aabbccdd']);
    expect(addressCheckKeysOf(w(WSH, { '73c5da0a': nova }), ['73c5da0a', 'aabbccdd'])).toEqual(['73c5da0a', 'aabbccdd']);
  });
});

describe('a vault no device can be shown asks for no registration (decided 2026-10-17)', () => {
  it('a non-ranged vault (one fixed address) gets no registration walk', () => {
    const fixed = `wsh(multi(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/0/5,[aabbccdd/48'/1'/0'/2']${TPUB_B}/0/5))`;
    const ranged = `wsh(multi(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[aabbccdd/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
    const w = (descriptor: string) => vault({ kind: 'multisig', transport: 'paste', descriptor });
    expect(registrationWalk(w(fixed))).toEqual([]);
    expect(registrationWalk(w(ranged)).length).toBeGreaterThan(0);
  });
});
