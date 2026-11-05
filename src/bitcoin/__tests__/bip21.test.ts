/**
 * BIP-21 payment requests (decided 2026-11-04: scan a checkout's QR code and
 * pay the exact amount it asks for). The first block is the examples BIP-21
 * itself gives, word for word; the rest pins what a client can meet in the
 * wild: capitals from an alphanumeric QR code, Lightning beside or instead of
 * an address, and amounts that are not bitcoin amounts.
 */
import { btcToSats, isLightningText, MAX_SATS, readPaymentRequest, satsToBtcText } from '../bip21';

const LUKE = '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W';
const SEGWIT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const INVOICE = 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq';

describe('the examples in BIP-21', () => {
  it('reads a bare address', () => {
    expect(readPaymentRequest(`bitcoin:${LUKE}`)).toEqual({ kind: 'request', address: LUKE });
  });

  it('reads a label', () => {
    expect(readPaymentRequest(`bitcoin:${LUKE}?label=Luke-Jr`)).toEqual({
      kind: 'request',
      address: LUKE,
      label: 'Luke-Jr',
    });
  });

  it('reads 20.30 BTC to Luke-Jr', () => {
    expect(readPaymentRequest(`bitcoin:${LUKE}?amount=20.3&label=Luke-Jr`)).toEqual({
      kind: 'request',
      address: LUKE,
      amountSats: 2_030_000_000,
      label: 'Luke-Jr',
    });
  });

  it('reads 50 BTC with a percent-encoded message', () => {
    expect(
      readPaymentRequest(`bitcoin:${LUKE}?amount=50&label=Luke-Jr&message=Donation%20for%20project%20xyz`),
    ).toEqual({
      kind: 'request',
      address: LUKE,
      amountSats: 5_000_000_000,
      label: 'Luke-Jr',
      message: 'Donation for project xyz',
    });
  });

  it('refuses the whole request for req- parameters it does not understand', () => {
    expect(
      readPaymentRequest(`bitcoin:${LUKE}?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999`),
    ).toEqual({ kind: 'unsupported', param: 'req-somethingyoudontunderstand' });
  });

  it('leaves other parameters it does not understand unused', () => {
    expect(
      readPaymentRequest(`bitcoin:${LUKE}?somethingyoudontunderstand=50&somethingelseyoudontget=999`),
    ).toEqual({ kind: 'request', address: LUKE });
  });
});

describe('readPaymentRequest', () => {
  it('is not asked about text that is no bitcoin: link', () => {
    expect(readPaymentRequest(SEGWIT)).toBeNull();
    expect(readPaymentRequest('bitcoin')).toBeNull();
    expect(readPaymentRequest(`lightning:${INVOICE}`)).toBeNull();
  });

  it('reads the scheme and the parameter names in any case', () => {
    expect(readPaymentRequest(`BITCOIN:${SEGWIT.toUpperCase()}?AMOUNT=0.0015&LABEL=SHOP`)).toEqual({
      kind: 'request',
      address: SEGWIT.toUpperCase(),
      amountSats: 150_000,
      label: 'SHOP',
    });
    expect(readPaymentRequest(`Bitcoin:${SEGWIT}?Amount=1`)).toMatchObject({ amountSats: 100_000_000 });
  });

  it('pays on chain when Lightning or payjoin is offered beside the address', () => {
    expect(readPaymentRequest(`bitcoin:${SEGWIT}?amount=0.0001&lightning=${INVOICE}`)).toEqual({
      kind: 'request',
      address: SEGWIT,
      amountSats: 10_000,
    });
    expect(readPaymentRequest(`bitcoin:${SEGWIT}?amount=0.0001&pj=https://example.com/pay?x=1&pjos=0`)).toEqual({
      kind: 'request',
      address: SEGWIT,
      amountSats: 10_000,
    });
  });

  it('calls a link with no address and only Lightning what it is', () => {
    expect(readPaymentRequest(`bitcoin:?lightning=${INVOICE}`)).toEqual({ kind: 'lightning' });
    expect(readPaymentRequest(`BITCOIN:?LIGHTNING=${INVOICE.toUpperCase()}&AMOUNT=0.001`)).toEqual({ kind: 'lightning' });
    expect(readPaymentRequest('bitcoin:?lno=lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283qfwdpl28qqmc78ymlvhmxcsywdk5wrjnj36jryg488qwlrnzyjczs')).toEqual({ kind: 'lightning' });
  });

  it('finds no address in a link without one', () => {
    expect(readPaymentRequest('bitcoin:')).toEqual({ kind: 'noAddress' });
    expect(readPaymentRequest('bitcoin:?amount=1')).toEqual({ kind: 'noAddress' });
  });

  it('refuses a req- parameter in capitals, before anything else', () => {
    expect(readPaymentRequest(`bitcoin:${SEGWIT}?amount=x&REQ-POP=1`)).toEqual({ kind: 'unsupported', param: 'req-pop' });
    expect(readPaymentRequest(`bitcoin:?req-pop=1&lightning=${INVOICE}`)).toEqual({ kind: 'unsupported', param: 'req-pop' });
  });

  it.each([
    ['a comma', '0,5'],
    ['a sign', '-1'],
    ['a plus', '+1'],
    ['an exponent', '1e-3'],
    ['a second point', '0.1.2'],
    ['nothing', ''],
    ['a point alone', '.'],
    ['zero', '0'],
    ['zero with decimals', '0.00000000'],
    ['less than a satoshi', '0.000000001'],
    ['more bitcoin than exists', '21000000.00000001'],
    ['a currency', '10USD'],
    ['a percent-encoded point', '0%2E5'],
  ])('refuses an amount with %s, and still names the address', (_name, amount) => {
    expect(readPaymentRequest(`bitcoin:${SEGWIT}?amount=${amount}`)).toEqual({ kind: 'badAmount', address: SEGWIT });
  });

  it('refuses two amounts, as neither can be the one meant', () => {
    expect(readPaymentRequest(`bitcoin:${SEGWIT}?amount=1&amount=1`)).toEqual({ kind: 'badAmount', address: SEGWIT });
    expect(readPaymentRequest(`bitcoin:${SEGWIT}?amount=1&AMOUNT=2`)).toEqual({ kind: 'badAmount', address: SEGWIT });
  });

  it('keeps a label it cannot decode as it was written', () => {
    expect(readPaymentRequest(`bitcoin:${SEGWIT}?label=100%`)).toMatchObject({ label: '100%' });
  });
});

describe('btcToSats', () => {
  it.each([
    ['1', 100_000_000],
    ['0.1', 10_000_000],
    ['0.00000001', 1],
    ['.5', 50_000_000],
    ['5.', 500_000_000],
    ['0005', 500_000_000],
    ['20.3', 2_030_000_000],
    ['0.12345678', 12_345_678],
    ['0.123456780', 12_345_678],
    ['21000000', MAX_SATS],
    ['20999999.99999999', MAX_SATS - 1],
  ])('reads %s as %d satoshis, exactly', (text, sats) => {
    expect(btcToSats(text)).toBe(sats);
  });

  it('gives every eight-place amount back exactly, where a float can miss by one', () => {
    // 0.29 * 1e8 is 28999999.999999996 in floating point.
    expect(0.29 * 1e8).not.toBe(29_000_000);
    expect(btcToSats('0.29')).toBe(29_000_000);
    for (let sats = 1; sats < 3_000_000; sats += 997) {
      expect(btcToSats(satsToBtcText(sats))).toBe(sats);
    }
  });

  it('refuses anything past 21 million', () => {
    expect(btcToSats('21000001')).toBeNull();
    expect(btcToSats('999999999')).toBeNull();
  });
});

describe('satsToBtcText', () => {
  it.each([
    [1, '0.00000001'],
    [150_000, '0.0015'],
    [100_000_000, '1'],
    [2_030_000_000, '20.3'],
    [MAX_SATS, '21000000'],
  ])('writes %d satoshis as %s', (sats, text) => {
    expect(satsToBtcText(sats)).toBe(text);
  });
});

describe('isLightningText', () => {
  it.each([
    INVOICE,
    INVOICE.toUpperCase(),
    `lightning:${INVOICE}`,
    `LIGHTNING:${INVOICE.toUpperCase()}`,
    'lntb20m1pvjluezhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqypq',
    'lntbs1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq',
    'lnbcrt1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq',
    'LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS',
    'lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283qfwdpl28qqmc78ymlvhmxcsywdk5wrjnj36jryg488qwlrnzyjczs',
  ])('knows %s for Lightning', (text) => {
    expect(isLightningText(text)).toBe(true);
  });

  it.each([SEGWIT, LUKE, 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', `bitcoin:${SEGWIT}?lightning=${INVOICE}`])(
    'leaves %s to the address reader',
    (text) => {
      expect(isLightningText(text)).toBe(false);
    },
  );
});
