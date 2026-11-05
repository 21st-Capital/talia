import {
  coldcardWalletName,
  coldcardMultisigConfig,
  coldcardMiniscriptImport,
} from '../coldcardRegister';
import { TPUB_A, TPUB_B } from '../__fixtures__/descriptors';

const MULTI = `wsh(sortedmulti(2,[aaaa0001/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[bbbb0002/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
const LAYERED = `wsh(or_d(multi(2,[aaaa0001/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[bbbb0002/48'/1'/0'/2']${TPUB_B}/<0;1>/*),and_v(v:pkh([cccc0003/48'/1'/0'/2']${TPUB_A}/2/*),older(100))))`;

describe('coldcardWalletName', () => {
  it('keeps spaces, strips exotica, caps at 20 chars', () => {
    expect(coldcardWalletName('Family Vault')).toBe('Family Vault');
    expect(coldcardWalletName('Ünïcödé & Emoji 🎉 Vault Extended Name')).toBe('Unicode  Emoji  Vaul');
    expect(coldcardWalletName('   ')).toBe('Talia vault');
  });
});

describe('coldcardMultisigConfig', () => {
  it('renders the classic setup file with the vault name', () => {
    const cfg = coldcardMultisigConfig('Family Vault', MULTI)!;
    expect(cfg).toContain('Name: Family Vault');
    expect(cfg).toContain('Policy: 2 of 2');
    expect(cfg).toContain('Format: P2WSH');
    expect(cfg).toContain("Derivation: m/48'/1'/0'/2'");
    expect(cfg).toContain(`AAAA0001: ${TPUB_A}`);
    expect(cfg).toContain(`BBBB0002: ${TPUB_B}`);
  });

  it('returns null for miniscript (layered) descriptors', () => {
    expect(coldcardMultisigConfig('X', LAYERED)).toBeNull();
  });
});

describe('coldcardMiniscriptImport', () => {
  it('wraps name + descriptor as JSON', () => {
    const parsed = JSON.parse(coldcardMiniscriptImport('My Layered Vault', LAYERED));
    expect(parsed.name).toBe('My Layered Vault');
    expect(parsed.desc).toBe(LAYERED);
  });
});
