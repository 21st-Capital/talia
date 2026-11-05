import { parseScannedAddress, readSendAddress, refusedAddressTitle } from '../scanParse';

const SEGWIT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LEGACY = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const TAPROOT = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
const INVOICE = 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq';

describe('parseScannedAddress', () => {
  it('accepts a raw bech32 address', () => {
    expect(parseScannedAddress(SEGWIT)).toEqual({ address: SEGWIT });
  });

  it('accepts a raw legacy address', () => {
    expect(parseScannedAddress(LEGACY)).toEqual({ address: LEGACY });
  });

  it('accepts testnet bech32', () => {
    expect(parseScannedAddress(TESTNET)).toEqual({ address: TESTNET });
  });

  it('parses a BIP-21 URI with amount, exactly in satoshis', () => {
    expect(parseScannedAddress(`bitcoin:${SEGWIT}?amount=0.5&label=x`)).toEqual({
      address: SEGWIT,
      amountSats: 50_000_000,
    });
    expect(parseScannedAddress(`bitcoin:${SEGWIT}?amount=0.29`)?.amountSats).toBe(29_000_000);
  });

  it('holds no address in a link BIP-21 calls invalid, or in a Lightning request', () => {
    expect(parseScannedAddress(`bitcoin:${SEGWIT}?req-pop=1`)).toBeNull();
    expect(parseScannedAddress(`bitcoin:${SEGWIT}?amount=0,5`)).toBeNull();
    expect(parseScannedAddress(`bitcoin:?lightning=${INVOICE}`)).toBeNull();
    expect(parseScannedAddress(INVOICE)).toBeNull();
  });

  it('parses a plain BIP-21 URI', () => {
    expect(parseScannedAddress(`bitcoin:${SEGWIT}`)).toEqual({ address: SEGWIT });
  });

  it('lowercases uppercase bech32 (QR alphanumeric mode)', () => {
    expect(parseScannedAddress(SEGWIT.toUpperCase())?.address).toBe(SEGWIT);
  });

  it('rejects mixed-case bech32', () => {
    expect(parseScannedAddress('bc1Qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBeNull();
  });

  it('rejects descriptors and junk', () => {
    expect(parseScannedAddress('wpkh([73c5da0a/84h/0h/0h]xpub.../0/*)')).toBeNull();
    expect(parseScannedAddress('hello world')).toBeNull();
    expect(parseScannedAddress('')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseScannedAddress(`  ${SEGWIT}\n`)).toEqual({ address: SEGWIT });
  });
});

describe('readSendAddress', () => {
  it('takes an address, and the address out of a bitcoin: link', () => {
    expect(readSendAddress(SEGWIT, 'bitcoin')).toEqual({ kind: 'address', address: SEGWIT });
    expect(readSendAddress(LEGACY, 'bitcoin')).toEqual({ kind: 'address', address: LEGACY });
    expect(readSendAddress(`bitcoin:${SEGWIT}?label=x`, 'bitcoin')).toEqual({
      kind: 'address',
      address: SEGWIT,
    });
    expect(readSendAddress(TESTNET, 'testnet')).toEqual({ kind: 'address', address: TESTNET });
  });

  describe('a payment request (decided 2026-11-04: scan a checkout and pay its amount)', () => {
    it('brings the amount with the address, exactly, pasted or scanned alike', () => {
      expect(readSendAddress(`bitcoin:${SEGWIT}?amount=0.5&label=x`, 'bitcoin')).toEqual({
        kind: 'address',
        address: SEGWIT,
        amountSats: 50_000_000,
      });
      expect(readSendAddress(`bitcoin:${TESTNET}?amount=0.00012345`, 'testnet')).toEqual({
        kind: 'address',
        address: TESTNET,
        amountSats: 12_345,
      });
    });

    it('reads a QR code in capitals, as an alphanumeric one is', () => {
      expect(readSendAddress(`BITCOIN:${SEGWIT.toUpperCase()}?AMOUNT=0.0015`, 'bitcoin')).toEqual({
        kind: 'address',
        address: SEGWIT,
        amountSats: 150_000,
      });
    });

    it('keeps the amount through the line breaks an email adds', () => {
      const wrapped = `bitcoin:${SEGWIT.slice(0, 25)}\n${SEGWIT.slice(25)}?amount=0.\n001`;
      expect(readSendAddress(wrapped, 'bitcoin')).toEqual({ kind: 'address', address: SEGWIT, amountSats: 100_000 });
    });

    it('pays on chain when a Lightning invoice rides beside the address', () => {
      expect(readSendAddress(`bitcoin:${SEGWIT}?amount=0.001&lightning=${INVOICE}`, 'bitcoin')).toEqual({
        kind: 'address',
        address: SEGWIT,
        amountSats: 100_000,
      });
    });

    it.each([
      ['a bare invoice', INVOICE],
      ['an invoice in capitals', INVOICE.toUpperCase()],
      ['a lightning: link', `lightning:${INVOICE}`],
      ['a bitcoin: link with Lightning alone', `bitcoin:?lightning=${INVOICE}`],
    ])('refuses %s as Lightning', (_name, raw) => {
      expect(readSendAddress(raw, 'bitcoin')).toEqual({ kind: 'lightning' });
    });

    it.each([
      ['a req- parameter', `bitcoin:${SEGWIT}?amount=1&req-pop=x`],
      ['a req- parameter in capitals', `BITCOIN:${SEGWIT.toUpperCase()}?REQ-POP=X`],
    ])('refuses %s, as BIP-21 says', (_name, raw) => {
      expect(readSendAddress(raw, 'bitcoin')).toEqual({ kind: 'unsupported' });
    });

    it.each([
      ['a comma', '0,5'],
      ['less than a satoshi', '0.000000001'],
      ['zero', '0'],
      ['a sign', '-1'],
      ['more than exists', '21000001'],
    ])('refuses an amount with %s', (_name, amount) => {
      expect(readSendAddress(`bitcoin:${SEGWIT}?amount=${amount}`, 'bitcoin')).toEqual({ kind: 'badAmount' });
    });

    it('names the address first when the address and the amount are both wrong', () => {
      expect(readSendAddress(`bitcoin:${TESTNET}?amount=0,5`, 'bitcoin')).toEqual({ kind: 'wrongNetwork' });
      expect(readSendAddress(`bitcoin:${SEGWIT.slice(0, -1)}p?amount=0,5`, 'bitcoin')).toEqual({ kind: 'invalid' });
    });

    it('refuses the wrong network with an amount as without one', () => {
      expect(readSendAddress(`bitcoin:${TESTNET}?amount=0.5`, 'bitcoin')).toEqual({ kind: 'wrongNetwork' });
      expect(readSendAddress(`bitcoin:${SEGWIT}?amount=0.5`, 'testnet')).toEqual({ kind: 'wrongNetwork' });
    });

    it('finds no address in a link that has none', () => {
      expect(readSendAddress('bitcoin:?amount=0.5', 'bitcoin')).toEqual({ kind: 'invalid' });
    });
  });

  it('drops the spaces and line breaks an email or a chat adds', () => {
    const wrapped = `  ${SEGWIT.slice(0, 20)}\n${SEGWIT.slice(20, 32)} ${SEGWIT.slice(32)}\n`;
    expect(readSendAddress(wrapped, 'bitcoin')).toEqual({ kind: 'address', address: SEGWIT });
  });

  it('calls an address of the other network what it is, in both directions', () => {
    expect(readSendAddress(TESTNET, 'bitcoin')).toEqual({ kind: 'wrongNetwork' });
    expect(readSendAddress(`bitcoin:${TESTNET}`, 'bitcoin')).toEqual({ kind: 'wrongNetwork' });
    expect(readSendAddress(SEGWIT, 'testnet')).toEqual({ kind: 'wrongNetwork' });
    expect(readSendAddress(LEGACY, 'testnet')).toEqual({ kind: 'wrongNetwork' });
  });

  it('refuses what is no address, a failed checksum included', () => {
    const lastChar = SEGWIT.endsWith('q') ? 'p' : 'q';
    for (const raw of ['', '   ', 'hello', `${SEGWIT.slice(0, -1)}${lastChar}`, SEGWIT.slice(0, -4), `${LEGACY.slice(0, -1)}3`]) {
      expect(readSendAddress(raw, 'bitcoin')).toEqual({ kind: 'invalid' });
    }
  });

  it('refuses an address whose checksum passes and whose program does not', () => {
    const excessPadding = 'bc1qwjqcaxagkhpvlh8f7cp3q8f2xaz9zhntptysaqp';
    expect(readSendAddress(excessPadding, 'bitcoin')).toEqual({ kind: 'invalid' });
    expect(readSendAddress(`bitcoin:${excessPadding}?amount=1`, 'bitcoin')).toEqual({ kind: 'invalid' });
  });

  describe('a link with more after it', () => {
    const wrap = (text: string, at: number) => `${text.slice(0, at)}\n${text.slice(at)}`;

    it.each([
      ['a second link', `bitcoin:${SEGWIT}?amount=1\nbitcoin:${TAPROOT}?amount=2`],
      ['a second link in capitals', `bitcoin:${SEGWIT}?amount=1\nBITCOIN:${TAPROOT.toUpperCase()}`],
      ['the same link again', `bitcoin:${SEGWIT}?amount=1\nbitcoin:${SEGWIT}?amount=2`],
      ['a second link an email wrapped', `bitcoin:${SEGWIT}?amount=1\n${wrap(`bitcoin:${TAPROOT}?amount=2`, 30)}`],
      ['a second link wrapped in its own name', `bitcoin:${SEGWIT}?amount=1\n${wrap(`bitcoin:${TAPROOT}`, 3)}`],
      ['a second link on the same line', `bitcoin:${SEGWIT}?amount=1 bitcoin:${TAPROOT}`],
      ['a second link with no space before it', `bitcoin:${SEGWIT}?amount=1,bitcoin:${TAPROOT}`],
      ['a second address', `bitcoin:${SEGWIT}?amount=1\n${TAPROOT}`],
      ['a second legacy address', `bitcoin:${SEGWIT}?amount=1\n${LEGACY}`],
      ['a second address after a comma', `bitcoin:${SEGWIT}?amount=1,${TAPROOT}`],
      ['a second address an email wrapped', `bitcoin:${SEGWIT}?amount=1\n${wrap(TAPROOT, 30)}`],
      ['a second address in a label', `bitcoin:${SEGWIT}?label=pay ${TAPROOT} first`],
      ['an address of another network', `bitcoin:${SEGWIT}?amount=1\n${TESTNET}`],
    ])('refuses %s', (_name, raw) => {
      expect(readSendAddress(raw, 'bitcoin')).toEqual({ kind: 'several' });
      expect(parseScannedAddress(raw)).toBeNull();
    });

    it.each([
      ['an unencoded label', `bitcoin:${SEGWIT}?label=My Shop`],
      ['a label before the amount', `bitcoin:${SEGWIT}?label=My Shop&amount=0.5`],
      ['a link an email wrapped in the address', wrap(`bitcoin:${SEGWIT}?amount=1`, 30)],
      ['a link an email wrapped in the label', `bitcoin:${SEGWIT}?amount=1&label=My\nShop`],
      ['a wrapped link with a space at the fold', `bitcoin:${SEGWIT.slice(0, 30)} ${SEGWIT.slice(30)}?amount=1`],
      ['a question mark in a label', `bitcoin:${SEGWIT}?label=Lunch? Yes&amount=1`],
      ['numbers in a label', `bitcoin:${SEGWIT}?label=Order 12345 of 67890`],
      ['a lightning invoice beside it', `bitcoin:${SEGWIT}?amount=1&lightning=${INVOICE}`],
      ['a payjoin link beside it', `bitcoin:${SEGWIT}?amount=1&pj=https://example.com/pay?id=1`],
      ['an encoded address in a label', `bitcoin:${SEGWIT}?label=bitcoin%3A${TAPROOT}`],
    ])('takes %s', (_name, raw) => {
      expect(readSendAddress(raw, 'bitcoin')).toMatchObject({ kind: 'address', address: SEGWIT });
    });

    it('leaves text that holds no link to the checks it always had', () => {
      expect(readSendAddress(`${SEGWIT} ${TAPROOT}`, 'bitcoin')).toEqual({ kind: 'invalid' });
      expect(readSendAddress(`pay this? ${SEGWIT}`, 'bitcoin')).toEqual({ kind: 'invalid' });
    });
  });
});

describe('refusedAddressTitle', () => {
  it('names each refusal in one title', () => {
    expect(refusedAddressTitle('invalid')).toBe('No Bitcoin address found');
    expect(refusedAddressTitle('wrongNetwork')).toBe('This address is for another network');
    expect(refusedAddressTitle('several')).toBe('More than one address found');
    expect(refusedAddressTitle('lightning')).toBe('Lightning payments are not supported');
    expect(refusedAddressTitle('unsupported')).toBe('This payment request is not supported');
    expect(refusedAddressTitle('badAmount')).toBe('The amount in this request is not valid');
  });
});
