import { describe, it, expect } from 'vitest';
import { validateSegments, normalizeForMatch } from '~/lib/segments-validate';

describe('normalizeForMatch', () => {
  it('NFC-normalizes', () => {
    const decomposed = 'café'; // "café" in NFD
    expect(normalizeForMatch(decomposed)).toBe('café');
  });
  it('replaces curly double quotes with straight', () => {
    expect(normalizeForMatch('“hi”')).toBe('"hi"');
  });
  it('replaces curly single quotes / apostrophes with straight', () => {
    expect(normalizeForMatch("it’s")).toBe("it's");
  });
  it('NBSP and other Unicode spaces -> regular space', () => {
    expect(normalizeForMatch('a b c')).toBe('a b c');
  });
  it('ellipsis variant collapses to three dots', () => {
    expect(normalizeForMatch('wait…')).toBe('wait...');
  });
});

describe('validateSegments', () => {
  it('happy path: 3 segments matching source verbatim', () => {
    const src = 'Hello. World. End.';
    const r = validateSegments(
      [
        { src: 'Hello.', tgt: 'Привіт.' },
        { src: 'World.', tgt: 'Світ.' },
        { src: 'End.', tgt: 'Кінець.' },
      ],
      src,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.derivedFlat).toBe('Привіт. Світ. Кінець.');
      expect(r.separators).toEqual(['', ' ', ' ']);
    }
  });

  it('typographic drift on src is tolerated', () => {
    const src = 'It’s “fine.” Right…';
    const r = validateSegments(
      [
        { src: "It's \"fine.\"", tgt: 'Це "ок."' },
        { src: 'Right...', tgt: 'Так...' },
      ],
      src,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects empty array', () => {
    expect(validateSegments([], 'x').ok).toBe(false);
  });

  it('rejects non-string src/tgt', () => {
    expect(validateSegments([{ src: 123 as unknown as string, tgt: 'y' }], 'x').ok).toBe(false);
  });

  it('rejects out-of-order src', () => {
    const src = 'A. B.';
    const r = validateSegments(
      [
        { src: 'B.', tgt: 'Б.' },
        { src: 'A.', tgt: 'А.' },
      ],
      src,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects src that is not a substring at all', () => {
    const r = validateSegments([{ src: 'Z', tgt: 'З' }], 'A B C');
    expect(r.ok).toBe(false);
  });

  it('preserves source whitespace in derivedFlat', () => {
    const src = 'A.\n\nB.';
    const r = validateSegments(
      [
        { src: 'A.', tgt: 'А.' },
        { src: 'B.', tgt: 'Б.' },
      ],
      src,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.derivedFlat).toBe('А.\n\nБ.');
      expect(r.separators).toEqual(['', '\n\n']);
    }
  });

  it('handles source containing ellipsis when src uses three dots', () => {
    const src = 'Wait… What?';
    const r = validateSegments(
      [
        { src: 'Wait...', tgt: 'Чекай...' },
        { src: 'What?', tgt: 'Що?' },
      ],
      src,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.derivedFlat).toBe('Чекай... Що?');
      expect(r.separators).toEqual(['', ' ']);
    }
  });
});
