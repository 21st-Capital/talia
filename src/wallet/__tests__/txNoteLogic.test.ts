import {
  addMissingNotes,
  emptyNotes,
  noteFor,
  notesForWallet,
  readNotes,
  writeNote,
} from '../txNoteLogic';

const SENDER = 'vault-a';
const RECEIVER = 'vault-b';
const TX = 'abc123';

describe('a note belongs to a vault', () => {
  it('shows the sender vault note in the receiver vault', () => {
    const notes = writeNote(emptyNotes(), SENDER, TX, 'School fees');
    expect(noteFor(notes, RECEIVER, TX)).toBe('School fees');
    expect(notesForWallet(notes, RECEIVER)).toEqual({ [TX]: 'School fees' });
  });

  it('keeps the two apart once the receiver changes it (decided 2026-09-20)', () => {
    let notes = writeNote(emptyNotes(), SENDER, TX, 'School fees');
    notes = writeNote(notes, RECEIVER, TX, 'From dad');
    expect(noteFor(notes, RECEIVER, TX)).toBe('From dad');
    expect(noteFor(notes, SENDER, TX)).toBe('School fees');
  });

  it('leaves the receiver alone when the sender changes it afterwards', () => {
    let notes = writeNote(emptyNotes(), SENDER, TX, 'School fees');
    notes = writeNote(notes, RECEIVER, TX, 'From dad');
    notes = writeNote(notes, SENDER, TX, 'Q4 school fees');
    expect(noteFor(notes, SENDER, TX)).toBe('Q4 school fees');
    expect(noteFor(notes, RECEIVER, TX)).toBe('From dad');
  });

  it('clears one vault note without bringing the other one back', () => {
    let notes = writeNote(emptyNotes(), SENDER, TX, 'School fees');
    notes = writeNote(notes, RECEIVER, TX, '');
    expect(noteFor(notes, RECEIVER, TX)).toBeUndefined();
    expect(noteFor(notes, SENDER, TX)).toBe('School fees');
    expect(notesForWallet(notes, RECEIVER)).toEqual({});
  });

  it('trims what it stores and treats blanks as no note', () => {
    const notes = writeNote(emptyNotes(), SENDER, TX, '  Rent   ');
    expect(noteFor(notes, SENDER, TX)).toBe('Rent');
  });

  it('borrows the same note whichever vault asks first', () => {
    const notes = writeNote(emptyNotes(), RECEIVER, TX, 'Gift');
    expect(noteFor(notes, SENDER, TX)).toBe('Gift');
    expect(noteFor(notes, 'vault-c', TX)).toBe('Gift');
  });
});

describe('notes written before notes belonged to a vault', () => {
  const legacy = { [TX]: 'Old note', other: 'Another' };

  it('stay visible in every vault', () => {
    const notes = readNotes(legacy);
    expect(noteFor(notes, SENDER, TX)).toBe('Old note');
    expect(noteFor(notes, RECEIVER, TX)).toBe('Old note');
    expect(notesForWallet(notes, RECEIVER)).toEqual({ [TX]: 'Old note', other: 'Another' });
  });

  it('become that vault own note the moment it writes, and only there', () => {
    const notes = writeNote(readNotes(legacy), RECEIVER, TX, 'Mine now');
    expect(noteFor(notes, RECEIVER, TX)).toBe('Mine now');
    expect(noteFor(notes, SENDER, TX)).toBe('Old note');
  });

  it('are read back unchanged from the per vault shape', () => {
    const notes = writeNote(readNotes(legacy), RECEIVER, TX, 'Mine now');
    const round = readNotes(JSON.parse(JSON.stringify(notes)));
    expect(round).toEqual(notes);
  });

  it('survive junk in the store', () => {
    expect(readNotes(null)).toEqual(emptyNotes());
    expect(readNotes('nonsense')).toEqual(emptyNotes());
    expect(readNotes({ own: { [SENDER]: { [TX]: 7 } }, shared: { x: 1 } })).toEqual({
      own: { [SENDER]: {} },
      shared: {},
    });
  });
});

describe('notes from another wallet (decided 2026-11-05)', () => {
  const VAULT = 'imported';
  const OTHER_TX = 'def456';

  it('become the vault\'s own notes, and no other vault\'s', () => {
    const { notes, added } = addMissingNotes(emptyNotes(), VAULT, { [TX]: 'Rent', [OTHER_TX]: ' Salary ' });
    expect(added).toBe(2);
    expect(notes.own[VAULT]).toEqual({ [TX]: 'Rent', [OTHER_TX]: 'Salary' });
    expect(Object.keys(notes.own)).toEqual([VAULT]);
  });

  it('never replace a note the person wrote in this vault', () => {
    const before = writeNote(emptyNotes(), VAULT, TX, 'My own words');
    const { notes, added } = addMissingNotes(before, VAULT, { [TX]: 'Rent', [OTHER_TX]: 'Salary' });
    expect(added).toBe(1);
    expect(noteFor(notes, VAULT, TX)).toBe('My own words');
    expect(noteFor(notes, VAULT, OTHER_TX)).toBe('Salary');
  });

  it('never hide a note this vault borrows from another vault or the old store', () => {
    const borrowedFromVault = writeNote(emptyNotes(), SENDER, TX, 'School fees');
    expect(addMissingNotes(borrowedFromVault, VAULT, { [TX]: 'Rent' }).added).toBe(0);
    const legacy = readNotes({ [TX]: 'From the old store' });
    const kept = addMissingNotes(legacy, VAULT, { [TX]: 'Rent' });
    expect(kept.added).toBe(0);
    expect(noteFor(kept.notes, VAULT, TX)).toBe('From the old store');
  });

  it('respect a note the person cleared on purpose', () => {
    const cleared = writeNote(writeNote(emptyNotes(), VAULT, TX, 'Old'), VAULT, TX, '');
    const { notes, added } = addMissingNotes(cleared, VAULT, { [TX]: 'Rent' });
    expect(added).toBe(0);
    expect(noteFor(notes, VAULT, TX)).toBeUndefined();
  });

  it('skip blank notes and hand back the same object when nothing is added', () => {
    const start = emptyNotes();
    const result = addMissingNotes(start, VAULT, { [TX]: '   ' });
    expect(result.added).toBe(0);
    expect(result.notes).toBe(start);
  });

  it('leave the notes another vault holds untouched', () => {
    const before = writeNote(emptyNotes(), SENDER, OTHER_TX, 'Sent from here');
    const { notes } = addMissingNotes(before, VAULT, { [TX]: 'Rent' });
    expect(notes.own[SENDER]).toEqual({ [OTHER_TX]: 'Sent from here' });
    expect(noteFor(notes, SENDER, TX)).toBe('Rent');
  });
});
