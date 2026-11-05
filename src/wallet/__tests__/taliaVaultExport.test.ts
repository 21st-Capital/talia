import {
  TALIA_VAULT_EXPORT_TYPE,
  descriptorFingerprints,
  importedVaultPatch,
  parseTaliaVaultExport,
  serializeTaliaVaultExport,
  taliaExportDescriptorText,
  taliaVaultExportOf,
} from '../taliaVaultExport';
import { MAX_NAME_LENGTH } from '../vaultNames';
import type { WalletMeta } from '../types';

/** The vault's internal key: the unspendable one Liana derives from K1, K2 and K3, in tree order. */
const NUMS =
  'tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ';
/** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
const K1 =
  'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg';
/** Stand-ins for a co-signer and a rescue key, derived from BIP-32 test vectors 2 and 3's seeds at m/48'/1'/0'/2'. */
const K2 =
  'tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ';
const K3 =
  'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr';
/** A testnet vault (the same one the encrypted-backup tests use). */
const DESCRIPTOR = `tr(${NUMS}/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']${K1}/<0;1>/*,[bd16bee5/48'/1'/0'/2']${K2}/<0;1>/*),and_v(v:pk([41d63b50/48'/1'/0'/2']${K3}/<0;1>/*),older(65535))})#ffpaesuq`;

const REGISTRATION = {
  name: 'Family vault',
  descriptorTemplate: 'tr(@0/**,{multi_a(2,@1/**,@2/**),and_v(v:pk(@3/**),older(65535))})',
  keys: [NUMS, `[3442193e/48'/1'/0'/2']${K1}`, `[bd16bee5/48'/1'/0'/2']${K2}`, `[41d63b50/48'/1'/0'/2']${K3}`],
  hmacHex: 'ab'.repeat(32),
  appVersion: '2.2.3',
  registeredAt: 1757900000000,
};

const wallet = (patch: Partial<WalletMeta> = {}): WalletMeta =>
  ({
    id: 'w1',
    label: 'Family vault',
    descriptor: DESCRIPTOR,
    network: 'testnet',
    kind: 'multisig',
    source: 'generic',
    transport: 'created',
    createdAt: 1,
    keyLabels: { '3442193e': 'My Ledger', bd16bee5: 'My BitBox', '41d63b50': '21st Capital' },
    keyDevices: { '3442193e': { kind: 'ledger', model: 'gen5' }, bd16bee5: { kind: 'bitbox' } },
    ledgerRegistrations: { '3442193e': REGISTRATION },
    bitboxRegistrations: { bd16bee5: { registeredAt: 1757900001000 } },
    vaultRegisteredAt: 1757900002000,
    ...patch,
  }) as WalletMeta;

describe('a Talia vault export', () => {
  it('reads the vault’s own key fingerprints, not the unspendable internal key', () => {
    expect([...descriptorFingerprints(DESCRIPTOR)].sort()).toEqual(['3442193e', '41d63b50', 'bd16bee5']);
  });

  it('carries the name, the key names, the devices and the registrations, and reads them back', () => {
    const back = parseTaliaVaultExport(serializeTaliaVaultExport(taliaVaultExportOf(wallet())));
    expect(back).not.toBeNull();
    expect(back!.type).toBe(TALIA_VAULT_EXPORT_TYPE);
    expect(back!.name).toBe('Family vault');
    expect(back!.descriptor).toBe(DESCRIPTOR);
    expect(back!.keyLabels).toEqual({ '3442193e': 'My Ledger', bd16bee5: 'My BitBox', '41d63b50': '21st Capital' });
    expect(back!.keyDevices).toEqual({ '3442193e': { kind: 'ledger', model: 'gen5' }, bd16bee5: { kind: 'bitbox' } });
    expect(back!.ledgerRegistrations).toEqual({ '3442193e': REGISTRATION });
    expect(back!.bitboxRegistrations).toEqual({ bd16bee5: { registeredAt: 1757900001000 } });
    expect(back!.registered).toBe(true);
  });

  it('keeps the change descriptor on its own line for the importer', () => {
    const x = taliaVaultExportOf(wallet({ changeDescriptor: 'wpkh(xpub-change)' }));
    expect(taliaExportDescriptorText(x)).toBe(`${DESCRIPTOR}\nwpkh(xpub-change)`);
  });

  it('says registered when the owner vouched for it on an imported vault, and not otherwise', () => {
    expect(taliaVaultExportOf(wallet({ vaultRegisteredAt: undefined, registrationAttestedAt: 5 })).registered).toBe(true);
    expect(
      taliaVaultExportOf(wallet({ vaultRegisteredAt: undefined, registrationAttestedAt: undefined })).registered,
    ).toBeUndefined();
  });

  it('is not mistaken for anything else, and nothing else is mistaken for it', () => {
    expect(parseTaliaVaultExport(DESCRIPTOR)).toBeNull();
    expect(parseTaliaVaultExport('{"type":"talia-virtual-vault","version":1}')).toBeNull();
    expect(parseTaliaVaultExport('{not json')).toBeNull();
    expect(parseTaliaVaultExport('[]')).toBeNull();
  });

  it('refuses a newer version and an empty vault with a message a person can act on', () => {
    expect(() => parseTaliaVaultExport(JSON.stringify({ type: 'talia-vault', version: 99, descriptor: DESCRIPTOR }))).toThrow(
      /newer Talia/,
    );
    expect(() => parseTaliaVaultExport(JSON.stringify({ type: 'talia-vault', version: 1, descriptor: '' }))).toThrow(
      /no vault in it/,
    );
  });

  it('drops anything about keys the vault does not hold', () => {
    const back = parseTaliaVaultExport(
      JSON.stringify({
        type: 'talia-vault',
        version: 1,
        name: 'x',
        descriptor: DESCRIPTOR,
        keyLabels: { '3442193e': 'Mine', deadbeef: 'Someone else' },
        keyDevices: { deadbeef: { kind: 'ledger' } },
        ledgerRegistrations: { deadbeef: REGISTRATION },
        bitboxRegistrations: { deadbeef: { registeredAt: 1 } },
      }),
    );
    expect(back!.keyLabels).toEqual({ '3442193e': 'Mine' });
    expect(back!.keyDevices).toBeUndefined();
    expect(back!.ledgerRegistrations).toBeUndefined();
    expect(back!.bitboxRegistrations).toBeUndefined();
  });

  it('carries the name a BitBox stored, and drops a bad one without dropping the record', () => {
    const named = taliaVaultExportOf(wallet({ bitboxRegistrations: { bd16bee5: { registeredAt: 5, name: 'Test 2/3 Oct' } } }));
    const back = parseTaliaVaultExport(serializeTaliaVaultExport(named));
    expect(back!.bitboxRegistrations).toEqual({ bd16bee5: { registeredAt: 5, name: 'Test 2/3 Oct' } });
    for (const name of ['', 'A name far longer than a device shows', 42]) {
      const bad = parseTaliaVaultExport(
        JSON.stringify({
          type: 'talia-vault',
          version: 1,
          name: 'x',
          descriptor: DESCRIPTOR,
          bitboxRegistrations: { bd16bee5: { registeredAt: 5, name } },
        }),
      );
      expect(bad!.bitboxRegistrations).toEqual({ bd16bee5: { registeredAt: 5 } });
    }
  });

  it('drops a Ledger registration made for some other vault', () => {
    const foreign = { ...REGISTRATION, keys: [...REGISTRATION.keys.slice(0, 3), "[41d63b50/48'/1'/0'/2']tpubSOMEONEELSE"] };
    const back = parseTaliaVaultExport(
      JSON.stringify({ type: 'talia-vault', version: 1, name: 'x', descriptor: DESCRIPTOR, ledgerRegistrations: { '3442193e': foreign } }),
    );
    expect(back!.ledgerRegistrations).toBeUndefined();
  });

  it('drops malformed entries one by one rather than the whole vault', () => {
    const back = parseTaliaVaultExport(
      JSON.stringify({
        type: 'talia-vault',
        version: 1,
        name: 'x',
        descriptor: DESCRIPTOR,
        keyLabels: { '3442193e': 42, bd16bee5: '   ', '41d63b50': 'Fine' },
        keyDevices: { '3442193e': { kind: 'toaster' }, bd16bee5: { kind: 'bitbox', model: 7 } },
        ledgerRegistrations: {
          '3442193e': { ...REGISTRATION, hmacHex: 'nothex' },
          bd16bee5: { ...REGISTRATION, name: 'A name far longer than a Ledger shows' },
        },
        bitboxRegistrations: { bd16bee5: { registeredAt: 'yesterday' } },
        registered: 'yes',
      }),
    );
    expect(back!.keyLabels).toEqual({ '41d63b50': 'Fine' });
    expect(back!.keyDevices).toEqual({ bd16bee5: { kind: 'bitbox' } });
    expect(back!.ledgerRegistrations).toBeUndefined();
    expect(back!.bitboxRegistrations).toBeUndefined();
    expect(back!.registered).toBeUndefined();
  });

  it('keeps the VAULT name within the app’s own limit', () => {
    const long = 'A vault name that goes on and on';
    const back = parseTaliaVaultExport(
      JSON.stringify({ type: 'talia-vault', version: 1, name: long, descriptor: DESCRIPTOR }),
    );
    expect(back!.name).toHaveLength(MAX_NAME_LENGTH);
  });

  it('carries a KEY name whole, out and back in', () => {
    // Found in a phone test (2026-09-23): a vault exported from one phone arrived on the other
    // reading "Ledger (PPH: t". The vault name's limit of 14 was being
    // applied to key names, on BOTH sides, so fixing one would not show.
    const labels = {
      bd16bee5: 'BB (PPH: test1)',
      '3442193e': 'Ledger (PPH: test1)',
      '41d63b50': '21st Capital co-signer',
    };
    const wire = serializeTaliaVaultExport(taliaVaultExportOf(wallet({ keyLabels: labels })));
    expect(JSON.parse(wire).keyLabels).toEqual(labels);
    expect(parseTaliaVaultExport(wire)!.keyLabels).toEqual(labels);
  });

  it('lands "registered" as the owner’s word, and NO device or registration record', () => {
    // Decided 2026-09-18: a claim in a file is never knowledge. The export still
    // carries the other phone's records (parsed above), but the new vault
    // must not inherit them, or a pasted payload could open Send for
    // hardware this phone has never seen.
    const x = taliaVaultExportOf(wallet());
    expect(x.ledgerRegistrations).toEqual({ '3442193e': REGISTRATION });
    const patch = importedVaultPatch(x, 1234);
    expect(patch).toEqual({ registrationAttestedAt: 1234 });
    expect(patch).not.toHaveProperty('keyDevices');
    expect(patch).not.toHaveProperty('ledgerRegistrations');
    expect(patch).not.toHaveProperty('bitboxRegistrations');
    expect(importedVaultPatch({ ...x, registered: undefined }, 1234)).toEqual({});
  });

  it('writes no em dash into anything a person reads', () => {
    const messages: string[] = [];
    for (const bad of [
      { type: 'talia-vault', version: 99, descriptor: DESCRIPTOR },
      { type: 'talia-vault', version: 1, descriptor: '' },
    ]) {
      try {
        parseTaliaVaultExport(JSON.stringify(bad));
      } catch (e) {
        messages.push((e as Error).message);
      }
    }
    expect(messages).toHaveLength(2);
    for (const m of messages) expect(m).not.toMatch(/[—–]/);
  });
});
