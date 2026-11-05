import { markedLines } from '../markedLines';

describe('markedLines', () => {
  it('splits a numbered message into rows and keeps the marker apart', () => {
    expect(markedLines('1. Open the wallet.\n2. Tap the three dots.')).toEqual([
      { marker: '1.', text: 'Open the wallet.' },
      { marker: '2.', text: 'Tap the three dots.' },
    ]);
  });

  it('reads every bullet character, and a closing bracket', () => {
    expect(markedLines('• one\n· two\n- three\n1) four')).toEqual([
      { marker: '•', text: 'one' },
      { marker: '·', text: 'two' },
      { marker: '-', text: 'three' },
      { marker: '1)', text: 'four' },
    ]);
  });

  it('leaves a plain message as one paragraph', () => {
    const text = 'This backup is locked. It opens with any one of the keys.';
    expect(markedLines(text)).toEqual([{ marker: null, text }]);
  });

  it('keeps a paragraph above its list, with the blank line as a spacer', () => {
    expect(markedLines('What happens next:\n\n1. We email you a link.\n2. You approve it.')).toEqual([
      { marker: null, text: 'What happens next:' },
      { marker: null, text: '' },
      { marker: '1.', text: 'We email you a link.' },
      { marker: '2.', text: 'You approve it.' },
    ]);
  });

  it('never treats a mid-sentence separator as a marker', () => {
    expect(markedLines('Heir · waiting for release')).toEqual([
      { marker: null, text: 'Heir · waiting for release' },
    ]);
    expect(markedLines('2 of 3. Several keys sign.')).toEqual([
      { marker: null, text: '2 of 3. Several keys sign.' },
    ]);
  });

  it('reads a leading hyphen as a bullet, which is why amounts use the minus sign', () => {
    // Documented on purpose: the app writes negative amounts with U+2212,
    // so no real string starts a line with "- " unless it means a bullet.
    expect(markedLines('- one\n- two')).toEqual([
      { marker: '-', text: 'one' },
      { marker: '-', text: 'two' },
    ]);
  });

  it('needs a space after the marker, so a decimal is not a list', () => {
    expect(markedLines('0.5 BTC is left.')).toEqual([{ marker: null, text: '0.5 BTC is left.' }]);
  });

  it('drops a trailing blank line rather than rendering a gap', () => {
    expect(markedLines('1. One\n\n')).toEqual([{ marker: '1.', text: 'One' }]);
  });

  it('keeps every line break the author typed', () => {
    expect(markedLines('One line\nAnother line.')).toEqual([
      { marker: null, text: 'One line' },
      { marker: null, text: 'Another line.' },
    ]);
  });

  it('collapses a run of blank lines into one spacer', () => {
    expect(markedLines('Top\n\n\n• row')).toEqual([
      { marker: null, text: 'Top' },
      { marker: null, text: '' },
      { marker: '•', text: 'row' },
    ]);
  });
});
