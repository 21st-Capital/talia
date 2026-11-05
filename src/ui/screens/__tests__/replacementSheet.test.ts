/**
 * The Speed up and Cancel sheet's words (decided 2026-09-28, design Option A),
 * over the core's figures.
 */
import {
  BELOW_MINIMUM,
  CANCEL_LINE,
  SEND_ALL_INFO,
  SIGNED_AGAIN_LINE,
  cancelFacts,
  defaultChoice,
  readRate,
  replacementBuildNotice,
  replacementSheet,
} from '../replacementSheet';
import type { SheetChoice } from '../replacementSheet';
import { replacementBuildFailure, replacementRows, ReplacementError } from '../../../wallet/replacement';
import { EngineError } from '../../../bitcoin/engine/engineError';
import type { OriginalTx } from '../../../wallet/replacement';

const PAYEE = 'bc1qpayee';
const CHANGE = 'bc1pchange';

const withChange: OriginalTx = {
  txid: 'a'.repeat(64),
  coins: [{ txid: '1'.repeat(64), vout: 0, valueSats: 8_000_000 }],
  outputs: [
    { vout: 0, address: PAYEE, valueSats: 5_000_000, scriptLength: 22, change: false },
    { vout: 1, address: CHANGE, valueSats: 2_999_854, scriptLength: 34, change: true },
  ],
  totalInSats: 8_000_000,
  feeSats: 146,
  vsize: 146,
  weight: 584,
  feeRate: 1,
  recipients: [{ address: PAYEE, amountSats: 5_000_000 }],
  paymentSats: 5_000_000,
  changeSats: 2_999_854,
  ownScriptLength: 34,
};

const sendAll: OriginalTx = {
  ...withChange,
  outputs: [{ vout: 0, address: PAYEE, valueSats: 7_999_890, scriptLength: 22, change: false }],
  feeSats: 110,
  vsize: 110,
  weight: 440,
  recipients: [{ address: PAYEE, amountSats: 7_999_890 }],
  paymentSats: 7_999_890,
  changeSats: 0,
};

const LIVE = { fast: 12, medium: 8.5, slow: 4.2 };
const QUIET = { fast: 1.5, medium: 1.2, slow: 1 };

const btc = (s: number) => `${(s / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`;

function sheet(over: Partial<Parameters<typeof replacementSheet>[0]> = {}) {
  return replacementSheet({
    kind: 'speedup',
    orig: withChange,
    presets: LIVE,
    choice: 'fast' as SheetChoice,
    customText: '',
    etaPhrase: 'about 3 hours',
    cosigned: false,
    money: (s) => `€${s}`,
    moneySub: (s) => `${s} sats`,
    amount: btc,
    ...over,
  });
}

describe('the Speed up sheet', () => {
  it('says what the payment pays now and how long it waits', () => {
    const s = sheet();
    expect(s.title).toBe('Speed up');
    expect(s.caption).toBe('Now 1 sat/vB · about 3 hours');
    expect(sheet({ etaPhrase: null }).caption).toBe('Now 1 sat/vB');
  });

  it('shows each tier with its wait and rate, and the EXTRA fee on the right', () => {
    const s = sheet();
    expect(s.rows.map((r) => r.meta)).toEqual([
      'about 10 minutes · 12 sat/vB',
      'about 30 minutes · 8.5 sat/vB',
      'about an hour · 4.2 sat/vB',
    ]);
    const extra = replacementRows(withChange, 'speedup', LIVE)[0].extraSats;
    expect(s.rows[0]).toMatchObject({ label: 'High', main: `+ €${extra}`, sub: `+ ${extra} sats`, on: true, muted: false });
    expect(s.button).toBe(`Speed up · + €${extra}`);
    expect(s.selected?.key).toBe('fast');
  });

  it('shows sats alone when there is no currency to show', () => {
    const s = sheet({ money: (x) => `${x} sats`, moneySub: null });
    expect(s.rows[0].sub).toBeNull();
    expect(s.rows[0].main).toMatch(/^\+ \d+ sats$/);
  });

  it('leaves the Custom figures out until it is picked or typed', () => {
    expect(sheet().custom).toMatchObject({ main: null, sub: null, on: false });
    expect(sheet({ choice: 'custom' }).custom.main).toMatch(/^\+ €\d+$/);
    expect(sheet({ customText: '3' }).custom.main).toMatch(/^\+ €\d+$/);
  });

  it('keeps the recipient and the amount, and says so', () => {
    expect(sheet().footer[0]).toMatchObject({ text: 'Recipient still receives 0.05 BTC', infoTitle: 'Same payment, higher fee' });
  });

  it('a send-all: the recipient receives less, and the sheet says how much (decided 2026-09-28)', () => {
    const s = sheet({ orig: sendAll });
    const row = replacementRows(sendAll, 'speedup', LIVE)[0];
    expect(row.recipientSats).toBeLessThan(sendAll.paymentSats);
    expect(s.footer[0].text).toBe(`Recipient receives ${btc(row.recipientSats)} instead of 0.0799989 BTC`);
  });

  it('a send-all never says the recipient still receives it all, even while the typed rate is unusable', () => {
    const atMin = replacementRows(sendAll, 'speedup', { fast: 2, medium: 2, slow: 2 })[0];
    for (const customText of ['1', 'x', '2001']) {
      const s = sheet({ orig: sendAll, choice: 'custom', customText });
      expect(s.selected).toBeNull();
      expect(s.footer[0].text).toBe(`Recipient receives ${btc(atMin.recipientSats)} instead of 0.0799989 BTC`);
      expect(s.footer[0].info).toBe(SEND_ALL_INFO);
      expect(s.footer.some((l) => /still receives/.test(l.text))).toBe(false);
    }
  });

  it('mutes every tier at or under the minimum, in words, and opens on Custom at the minimum', () => {
    const rows = replacementRows(withChange, 'speedup', QUIET);
    expect(defaultChoice(rows)).toBe('custom');
    const s = sheet({ presets: QUIET, choice: 'custom' });
    for (const r of s.rows) {
      expect(r).toMatchObject({ muted: true, meta: BELOW_MINIMUM, main: null, sub: null, on: false });
    }
    expect(s.custom).toMatchObject({ placeholder: '2', unitMeta: 'sat/vB · at least 2', on: true, bad: null });
    expect(s.selected?.buildRate).toBe(2);
    expect(s.button).toBe(`Speed up · + €${s.selected?.extraSats}`);
  });

  it('never picks a muted tier', () => {
    const s = sheet({ presets: QUIET, choice: 'fast' });
    expect(s.selected).toBeNull();
    expect(s.rows[0].on).toBe(false);
    expect(s.button).toBe('Speed up');
  });

  it('refuses a typed rate under the minimum or past the ceiling, and says the range', () => {
    const low = sheet({ choice: 'custom', customText: '1.5' });
    expect(low.custom.bad).toBe('At least 2');
    expect(low.selected).toBeNull();
    expect(low.button).toBe('Speed up');
    expect(sheet({ choice: 'custom', customText: 'x' }).custom.bad).toBe('2 to 2000');
    expect(sheet({ choice: 'custom', customText: '2001' }).custom.bad).toBe('2 to 2000');
  });

  it('takes a typed rate, a comma for the decimal included', () => {
    expect(readRate('2,5')).toBe(2.5);
    expect(readRate(' 3 ')).toBe(3);
    expect(readRate('')).toBeNaN();
    expect(readRate('1.2.3')).toBeNaN();
    const s = sheet({ choice: 'custom', customText: '6,5' });
    expect(s.selected).toMatchObject({ key: 'custom', rate: 6.5 });
    expect(s.custom.main).toBe(`+ €${s.selected?.costSats}`);
  });

  it('a co-signed vault is told it signs again (decided 2026-09-28)', () => {
    expect(sheet().footer.map((l) => l.text)).not.toContain(SIGNED_AGAIN_LINE);
    const s = sheet({ cosigned: true });
    expect(s.footer.map((l) => l.text)).toContain(SIGNED_AGAIN_LINE);
    expect(s.footer[s.footer.length - 1].info).toMatch(/^A speed-up is a new transaction/);
  });
});

describe('the Cancel sheet', () => {
  it('leads with the payment, shows the whole fee, and continues to the dialog (decided 2026-09-28)', () => {
    const s = sheet({ kind: 'cancel' });
    expect(s.title).toBe('Cancel payment');
    expect(s.caption).toBe('0.05 BTC comes back to this vault');
    const fee = replacementRows(withChange, 'cancel', LIVE)[0].feeSats;
    expect(s.rows[0]).toMatchObject({ main: `€${fee}`, sub: `${fee} sats` });
    expect(s.footer[0].text).toBe(CANCEL_LINE);
    expect(s.button).toBe('Continue');
  });

  it('the dialog: what comes back, then the fee', () => {
    const row = replacementRows(withChange, 'cancel', LIVE)[0];
    expect(cancelFacts(withChange, row, btc, (s) => `${s} sats`)).toEqual([
      { label: 'Comes back to this vault', value: '0.05 BTC' },
      { label: 'Network fee', value: `${row.feeSats} sats` },
    ]);
  });
});

describe('a failed rebuild', () => {
  it('is a title and OK, never the engine’s own words', () => {
    const raw = new Error('SpendingPolicyRequired: inputs 0, 1 need a policy path (UTXO)');
    expect(replacementBuildNotice(raw, 'speedup')).toEqual({ title: 'Could not speed it up' });
    expect(replacementBuildNotice(raw, 'cancel')).toEqual({ title: 'Could not cancel it' });
    expect(replacementBuildNotice('offline', 'cancel')).toEqual({ title: 'Could not cancel it' });
  });

  it('names what Talia knows in plain words', () => {
    const e = (code: ConstructorParameters<typeof ReplacementError>[0]) => new ReplacementError(code, 'raw words');
    expect(replacementBuildNotice(e('insufficient-funds'), 'speedup')).toEqual({ title: 'Not enough left for a higher fee' });
    expect(replacementBuildNotice(e('coins-unavailable'), 'cancel')).toEqual({
      title: 'Talia could not use the coins of this payment',
    });
    expect(replacementBuildNotice(e('not-eligible'), 'speedup')).toEqual({ title: 'This cannot be sped up' });
    expect(replacementBuildNotice(e('not-eligible'), 'cancel')).toEqual({ title: 'This cannot be cancelled' });
    expect(replacementBuildNotice(e('wrong-shape'), 'cancel')).toEqual({ title: 'Could not rebuild this payment' });
  });

  it('the address check\'s pause: Speed up and Cancel say what Send says (decided 2026-10-17)', () => {
    // What guardedEngine throws, passed through replacementBuildFailure untouched.
    const paused = new EngineError('ADDRESS_CHECK_FAILED', 'Sending is paused for this vault');
    expect(replacementBuildFailure(paused, withChange, 'speedup', 5)).toBe(paused);
    expect(replacementBuildNotice(paused, 'speedup')).toEqual({ title: 'Sending is paused for this vault' });
    expect(replacementBuildNotice(paused, 'cancel')).toEqual({ title: 'Sending is paused for this vault' });
  });
});

describe('the words', () => {
  it('never an em dash, never the jargon', () => {
    const all = [
      sheet(),
      sheet({ orig: sendAll }),
      sheet({ presets: QUIET, choice: 'custom', cosigned: true }),
      sheet({ kind: 'cancel', cosigned: true }),
      sheet({ choice: 'custom', customText: '1' }),
    ].flatMap((s) => [
      s.title,
      s.caption,
      s.button,
      ...s.rows.flatMap((r) => [r.label, r.meta]),
      s.custom.unitMeta,
      s.custom.bad ?? '',
      ...s.footer.flatMap((l) => [l.text, l.infoTitle, l.info]),
    ]);
    for (const w of all) {
      expect(w).not.toMatch(/—/);
      expect(w).not.toMatch(/\b(RBF|UTXO|utxo|inputs?|outputs?|outpoint)\b/);
    }
  });
});
