/**
 * Registering a vault as the devices show it (three videos of one
 * 2-of-3 testnet vault, 2026-10-04): the facts from a descriptor and the
 * device in hand, the pages per family in the firmware's own words and
 * order, which key each device calls its own, the device's word after the
 * approval, and what is drawn beyond the videos (a policy vault) marked so.
 */
import {
  NANO_KEY_LINES,
  ledgerPolicyWords,
  nanoKeyPages,
  nanoKeyTitle,
  novaKeyLine,
  novaOwnKey,
  registerFacts,
  registerPages,
  registeredWords,
  touchKeyTitle,
  unconfirmed,
} from '../vaultRegistration';
import type { RegisterFacts } from '../vaultRegistration';
import { nanoLines } from '../nanoFont';
import { DEVICE_DRAWINGS, isRegistrationPage, reviewPages } from '../signingDevice';
import type { DeviceDrawing, ReviewPage, TourFacts } from '../signingDevice';
import { LIANA_TAPROOT, MULTISIG_2_OF_3, SPARROW_SINGLE_SIG, TPUB_A, TPUB_B, TPUB_C } from '../../../bitcoin/descriptor/__fixtures__/descriptors';
import { NANO_X_KEYS } from '../__fixtures__/nanoXRegistration';

const VAULT = { descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' as const };
/** The device holding the SECOND key (a1b2c3d4), as the Nano X held key@1 in the video. */
const FACTS = registerFacts(VAULT, 'A1B2C3D4')!;
/** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
const MADE_UP_KEY = "[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg";
/** The same, with the two keys the filmed Nano X showed as key@0 and key@1, and the made-up key as key@2. */
const NANO_X_FACTS: RegisterFacts = { ...FACTS, keys: [...NANO_X_KEYS, MADE_UP_KEY] };
const POLICY = registerFacts({ descriptor: LIANA_TAPROOT, label: 'Family vault', network: 'testnet' }, '73c5da0a')!;
/** A classic multisig holding TWO keys of one seed (accounts 0 and 1): an
 *  imported vault, never one Talia builds. */
const TWO_OWN = registerFacts(
  {
    descriptor:
      `wsh(sortedmulti(2,` +
      `[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,` +
      `[73c5da0a/48'/1'/1'/2']${TPUB_B}/<0;1>/*,` +
      `[deadbeef/48'/1'/0'/2']${TPUB_C}/<0;1>/*))`,
    label: 'Two here',
    network: 'testnet',
  },
  '73c5da0a',
)!;

const kinds = (pages: ReviewPage[]) => pages.map((p) => p.kind);
const TOUCH: DeviceDrawing[] = ['gen5', 'flex', 'stax'];

describe('the facts', () => {
  it('the classic 2-of-3: the name as sent, the template, the three keys in order, the device’s own by fingerprint, its account keypath', () => {
    expect(FACTS.network).toBe('testnet');
    expect(FACTS.name).toBe('Test 2/3 Oct');
    expect(FACTS.template).toBe('wsh(sortedmulti(2,@0/**,@1/**,@2/**))');
    expect(FACTS.keys).toEqual([`[73c5da0a/48'/1'/0'/2']${TPUB_A}`, `[a1b2c3d4/48'/1'/0'/2']${TPUB_B}`, `[deadbeef/48'/1'/0'/2']${TPUB_C}`]);
    expect(FACTS.own).toEqual([1]);
    expect(FACTS.multisig).toEqual({ threshold: 2, keys: 3 });
    expect(FACTS.ownKeypath).toBe("m/48'/1'/0'/2'");
    expect(unconfirmed(FACTS)).toBe(false);
  });

  it('a device holding none of the keys owns none and has no account page; a one-key vault or a blocked one has no facts', () => {
    const other = registerFacts(VAULT, '00000000')!;
    expect(other.own).toEqual([]);
    expect(other.ownKeypath).toBeNull();
    expect(registerFacts({ descriptor: SPARROW_SINGLE_SIG, label: 'Mine', network: 'testnet' }, '73c5da0a')).toBeNull();
    expect(registerFacts({ descriptor: 'pkh(abc)', label: 'x', network: 'bitcoin' }, '73c5da0a')).toBeNull();
    expect(registerFacts({ descriptor: `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/0/*,[a1b2c3d4/48'/1'/0'/2']${TPUB_B}/0/*))`, label: 'x', network: 'testnet' }, '73c5da0a')).toBeNull();
  });

  it('two keys of one seed are both the device’s own, and its account keypath is the first’s', () => {
    expect(TWO_OWN.own).toEqual([0, 1]);
    expect(TWO_OWN.ownKeypath).toBe("m/48'/1'/0'/2'");
    expect(TWO_OWN.multisig).toEqual({ threshold: 2, keys: 3 });
  });

  it('a policy vault: no plain k-of-n, the template as the device checks it, marked unconfirmed', () => {
    expect(POLICY.multisig).toBeNull();
    expect(POLICY.template).toBe('tr(@0/**,and_v(v:pk(@1/**),older(4032)))');
    expect(POLICY.own).toEqual([0]);
    expect(POLICY.keys).toHaveLength(2);
    expect(unconfirmed(POLICY)).toBe(true);
  });

  it('the name is the one sent to the device: at most sixteen characters', () => {
    const long = registerFacts({ ...VAULT, label: 'A name far longer than the device shows' }, 'a1b2c3d4')!;
    expect(long.name).toBe('A name far longe');
    expect(long.name.length).toBeLessThanOrEqual(16);
  });
});

describe('the Ledgers’ words', () => {
  it('"Spending policy" is the sentence of the videos for a plain k-of-n, the template for anything else', () => {
    expect(ledgerPolicyWords(FACTS)).toBe('Any 2 of @0, @1 and @2 must sign');
    expect(ledgerPolicyWords({ ...FACTS, multisig: { threshold: 3, keys: 5 } })).toBe('Any 3 of @0, @1, @2, @3 and @4 must sign');
    expect(ledgerPolicyWords({ ...FACTS, multisig: { threshold: 2, keys: 2 } })).toBe('Any 2 of @0 and @1 must sign');
    expect(ledgerPolicyWords(POLICY)).toBe(POLICY.template);
  });

  it('each device calls the key whose fingerprint is its own "Internal" (the touchscreens) or "Our" (the Nano X), every other "External" or "Their"', () => {
    expect([0, 1, 2].map((i) => touchKeyTitle(FACTS, i))).toEqual(['External key@0', 'Internal key@1', 'External key@2']);
    expect(nanoKeyTitle(FACTS, 0, 1, 3)).toBe('Their key@0 (1/3)');
    expect(nanoKeyTitle(FACTS, 1, 2, 3)).toBe('Our key@1 (2/3)');
    expect(nanoKeyTitle(FACTS, 2, 3, 3)).toBe('Their key@2 (3/3)');
    // A key on one page carries no page count (NBGL numbers pages only past one).
    expect(nanoKeyTitle(FACTS, 1, 1, 1)).toBe('Our key@1');
    // The Ledgers mark EVERY key of the device's seed.
    expect([0, 1, 2].map((i) => touchKeyTitle(TWO_OWN, i))).toEqual(['Internal key@0', 'Internal key@1', 'External key@2']);
    expect(nanoKeyTitle(TWO_OWN, 1, 1, 3)).toBe('Our key@1 (1/3)');
  });

  it('the Nano X pages a key over three lines broken where its font breaks them: the two filmed keys over 56/56/22 and 57/50/27', () => {
    // Decided 2026-10-04: a fixed 56 characters a page held for key@0 alone;
    // "Our key@1" came out a character off, so a client comparing page by
    // page saw different text on the same page.
    expect(NANO_KEY_LINES).toBe(3);
    const pages = NANO_X_KEYS.map(nanoKeyPages);
    expect(pages.map((p) => p.map((c) => c.length))).toEqual([
      [56, 56, 22],
      [57, 50, 27],
    ]);
    pages.forEach((p, i) => expect(p.join('')).toBe(NANO_X_KEYS[i]));
    expect(pages[1][0].endsWith('LG79nZshm')).toBe(true);
    expect(pages[1][2]).toBe('xyjmGgLJp4JLMeuc9CWpd2AgU84');
    // Each page is at most three of the device's lines, whole.
    pages.forEach((p, i) => {
      const lines = nanoLines(NANO_X_KEYS[i]);
      p.forEach((page, n) => expect(page).toBe(lines.slice(n * NANO_KEY_LINES, (n + 1) * NANO_KEY_LINES).join('')));
    });
    // A bare key (a taproot vault's NUMS key, no origin) is paged by width
    // too: three pages, never two of 56.
    const bare = NANO_X_KEYS[0].slice(NANO_X_KEYS[0].indexOf(']') + 1);
    expect(bare).toHaveLength(111);
    expect(nanoKeyPages(bare)).toHaveLength(3);
    expect(nanoKeyPages(bare).join('')).toBe(bare);
    expect(nanoKeyPages('')).toEqual(['']);
  });
});

describe('the touchscreens’ pages (the Gen5 video; the Flex and the Stax share them)', () => {
  it('seven pages for a 2-of-3, in the video’s order and words', () => {
    for (const d of TOUCH) {
      const pages = registerPages(d, FACTS);
      expect(kinds(pages)).toEqual([
        'touch-register-intro',
        'touch-register-account',
        'touch-register-keys',
        'touch-register-key',
        'touch-register-key',
        'touch-register-key',
        'touch-register-approve',
      ]);
      expect(pages[1]).toEqual({ kind: 'touch-register-account', name: 'Test 2/3 Oct', policy: 'Any 2 of @0, @1 and @2 must sign' });
      expect(pages.slice(3, 6)).toEqual([
        { kind: 'touch-register-key', title: 'External key@0', key: FACTS.keys[0] },
        { kind: 'touch-register-key', title: 'Internal key@1', key: FACTS.keys[1] },
        { kind: 'touch-register-key', title: 'External key@2', key: FACTS.keys[2] },
      ]);
      expect(pages.every(isRegistrationPage)).toBe(true);
    }
    expect(registerPages('gen5', FACTS)).toEqual(registerPages('flex', FACTS));
    expect(registerPages('gen5', FACTS)).toEqual(registerPages('stax', FACTS));
  });

  it('a policy vault: one page per key still, the template on the account page', () => {
    const pages = registerPages('gen5', POLICY);
    expect(kinds(pages)).toEqual(['touch-register-intro', 'touch-register-account', 'touch-register-keys', 'touch-register-key', 'touch-register-key', 'touch-register-approve']);
    expect(pages[1]).toMatchObject({ policy: POLICY.template });
    expect(pages[3]).toMatchObject({ title: 'Internal key@0' });
  });
});

describe('the Nano X’s pages (the video)', () => {
  it('the intro, the name, the policy, the keys’ intro, each key over its pages, "Register account"', () => {
    const pages = registerPages('nanoX', NANO_X_FACTS);
    expect(kinds(pages)).toEqual([
      'nano-register-intro',
      'nano-item',
      'nano-item',
      'nano-register-keys',
      ...Array.from({ length: 9 }, () => 'nano-item'),
      'nano-register-approve',
    ]);
    expect(pages[1]).toEqual({ kind: 'nano-item', title: 'Account name', value: 'Test 2/3 Oct' });
    expect(pages[2]).toEqual({ kind: 'nano-item', title: 'Spending policy', value: 'Any 2 of @0, @1 and @2 must sign', long: true });
    const keyPages = pages.slice(4, 13) as { title: string; value: string; long?: boolean }[];
    expect(keyPages.map((p) => p.title)).toEqual([
      'Their key@0 (1/3)',
      'Their key@0 (2/3)',
      'Their key@0 (3/3)',
      'Our key@1 (1/3)',
      'Our key@1 (2/3)',
      'Our key@1 (3/3)',
      'Their key@2 (1/3)',
      'Their key@2 (2/3)',
      'Their key@2 (3/3)',
    ]);
    // The pages of each key; the filmed key@1's first page as the device showed it
    // (frames f20 and f22 of the video). Key@2 is the made-up key: its pages follow the font.
    expect(keyPages.map((p) => p.value)).toEqual(NANO_X_FACTS.keys.flatMap((k) => nanoKeyPages(k)));
    expect(keyPages[3].value).toBe("[abf931aa/48'/1'/0'/2']tpubDFA5xftNMV8GN6gvF65DcLG79nZshm");
    expect(keyPages.every((p) => p.long === true)).toBe(true);
    // Its name, policy and key pages are the review's own item page.
    expect(pages.filter((p) => !isRegistrationPage(p)).every((p) => p.kind === 'nano-item')).toBe(true);
  });
});

describe('the BitBox’s pages (the video for the classic multisig; a policy from the firmware’s source, unconfirmed)', () => {
  it('the classic 2-of-3: "Register" on every page, the kind, the name, the device’s own account, then one scrolling line per key, the last held', () => {
    const pages = registerPages('nova', FACTS);
    expect(pages).toEqual([
      { kind: 'nova-item', title: 'Register', body: '2-of-3\nBTC Testnet multisig' },
      { kind: 'nova-item', title: 'Register', body: 'Test 2/3 Oct' },
      { kind: 'nova-item', title: 'Register', body: "p2wsh\nat\nm/48'/1'/0'/2'" },
      { kind: 'nova-scroll', title: 'Register', body: `Cosigner 1/3: ${TPUB_A}`, hold: false },
      { kind: 'nova-scroll', title: 'Register', body: `Cosigner 2/3 (this device): ${TPUB_B}`, hold: false },
      { kind: 'nova-scroll', title: 'Register', body: `Cosigner 3/3: ${TPUB_C}`, hold: true },
    ]);
    // Its titled pages are the review's own item page; the keys its own.
    expect(pages.filter((p) => !isRegistrationPage(p)).every((p) => p.kind === 'nova-item')).toBe(true);
    // On the main network the coin reads "BTC".
    expect(registerPages('nova', { ...FACTS, network: 'bitcoin' })[0]).toMatchObject({ body: '2-of-3\nBTC multisig' });
    // A device holding none of the keys has no account page.
    expect(kinds(registerPages('nova', registerFacts(VAULT, '00000000')!))).toEqual(['nova-item', 'nova-item', 'nova-scroll', 'nova-scroll', 'nova-scroll']);
    expect(novaKeyLine(registerFacts(VAULT, '00000000')!, 1)).toBe(`Cosigner 2/3: ${TPUB_B}`);
  });

  it('"(this device)" marks ONE cosigner, the first of the device’s own at the account sent, as the bridge names one position', () => {
    // Decided 2026-10-04: the drawing marked every key of the device's seed,
    // while the BitBox bridge sends a single our_xpub_index (its first
    // match) and the firmware prints "(this device)" on that cosigner alone.
    expect(novaOwnKey(FACTS)).toBe(1);
    expect(novaOwnKey(TWO_OWN)).toBe(0);
    expect(novaOwnKey(registerFacts(VAULT, '00000000')!)).toBeNull();
    expect([0, 1, 2].map((i) => novaKeyLine(TWO_OWN, i))).toEqual([
      `Cosigner 1/3 (this device): ${TPUB_A}`,
      `Cosigner 2/3: ${TPUB_B}`,
      `Cosigner 3/3: ${TPUB_C}`,
    ]);
    const marked = registerPages('nova', TWO_OWN).filter((p) => p.kind === 'nova-scroll' && p.body.includes('(this device)'));
    expect(marked).toHaveLength(1);
    // A key of the seed at another account is not the one the device holds the vault at.
    expect(novaOwnKey({ ...TWO_OWN, ownKeypath: "m/48'/1'/1'/2'" })).toBe(1);
  });

  it('a policy: "policy with N keys", "Name", "Policy", then "Key i/n" with "This device: " before its own, the last held', () => {
    const pages = registerPages('nova', POLICY);
    expect(pages).toEqual([
      { kind: 'nova-item', title: 'Register', body: 'BTC Testnet\npolicy with\n2 keys' },
      { kind: 'nova-item', title: 'Name', body: 'Family vault' },
      { kind: 'nova-scroll', title: 'Policy', body: POLICY.template, hold: false },
      { kind: 'nova-scroll', title: 'Key 1/2', body: `This device: ${POLICY.keys[0]}`, hold: false },
      { kind: 'nova-scroll', title: 'Key 2/2', body: POLICY.keys[1], hold: true },
    ]);
    expect(registerPages('nova', { ...POLICY, keys: [POLICY.keys[0]], own: [0] })[0]).toMatchObject({ body: 'BTC Testnet\npolicy with\n1 key' });
  });

  it('exactly one page is held, and it is the last', () => {
    for (const f of [FACTS, POLICY, TWO_OWN, registerFacts(VAULT, '00000000')!]) {
      const pages = registerPages('nova', f);
      const held = pages.map((p) => p.kind === 'nova-scroll' && p.hold);
      expect(held.lastIndexOf(true)).toBe(pages.length - 1);
      expect(held.filter(Boolean)).toHaveLength(1);
    }
  });
});

describe('after the approval, and the slab', () => {
  it('"Account registered" on every Ledger; the BitBox’s "Multisig account registered", or "Policy registered"', () => {
    for (const d of [...TOUCH, 'nanoX', 'slab'] as DeviceDrawing[]) {
      expect(registeredWords(d, FACTS)).toBe('Account registered');
      expect(registeredWords(d, POLICY)).toBe('Account registered');
    }
    expect(registeredWords('nova', FACTS)).toBe('Multisig account registered');
    expect(registeredWords('nova', POLICY)).toBe('Policy registered');
  });

  it('a Ledger of unknown model gets one page in the words every model starts with', () => {
    expect(registerPages('slab', FACTS)).toEqual([{ kind: 'slab-register' }]);
    expect(isRegistrationPage({ kind: 'slab-register' })).toBe(true);
  });

  it('a registration page is never a review page, and no word of any page carries an em dash', () => {
    const review: TourFacts = { brand: 'ledger', network: 'bitcoin', registeredName: 'Family vault', nameFirst: false, bitboxKind: null, outputs: [], feeSats: 100, lockTime: null };
    for (const d of DEVICE_DRAWINGS) {
      for (const p of reviewPages(d, d === 'nova' ? { ...review, brand: 'bitbox', bitboxKind: { kind: 'multisig', threshold: 2, keys: 3 } } : review)) {
        expect({ d, p: p.kind, registration: isRegistrationPage(p) }).toEqual({ d, p: p.kind, registration: false });
      }
      for (const f of [FACTS, NANO_X_FACTS, POLICY, TWO_OWN]) {
        for (const p of registerPages(d, f)) {
          // The Nano X's and the Nova's name, policy and key pages are the review's own item page.
          const shared = p.kind === 'nano-item' || p.kind === 'nova-item';
          expect({ d, p, registration: isRegistrationPage(p) }).toEqual({ d, p, registration: !shared });
          for (const v of Object.values(p)) if (typeof v === 'string') expect(v).not.toMatch(/[—–]/);
        }
        expect(registeredWords(d, f)).not.toMatch(/[—–]/);
      }
    }
  });

  it('the facts are plain data a flow can keep', () => {
    const copy: RegisterFacts = JSON.parse(JSON.stringify(FACTS));
    expect(registerPages('nova', copy)).toEqual(registerPages('nova', FACTS));
    expect(registerPages('nanoX', JSON.parse(JSON.stringify(NANO_X_FACTS)))).toEqual(registerPages('nanoX', NANO_X_FACTS));
  });
});
