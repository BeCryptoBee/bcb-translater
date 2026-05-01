import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import { buildProjection, locateInProjection } from '~/lib/highlight/projection';

let win: Window;

beforeEach(() => {
  win = new Window();
  // The projection module touches `document.createTreeWalker` only for the
  // Range case; for HTMLElement input it walks childNodes directly. To keep
  // both paths testable we install happy-dom's globals.
  vi.stubGlobal('document', win.document);
  vi.stubGlobal('Node', win.Node);
  vi.stubGlobal('NodeFilter', win.NodeFilter);
  vi.stubGlobal('Range', win.Range);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function makeDiv(html: string): HTMLElement {
  const div = win.document.createElement('div') as unknown as HTMLElement;
  (div as unknown as { innerHTML: string }).innerHTML = html;
  return div;
}

describe('buildProjection', () => {
  it('flat text node', () => {
    const div = makeDiv('Hello world.');
    const p = buildProjection(div);
    expect(p.text).toBe('Hello world.');
    expect(p.map).toHaveLength(1);
  });

  it('mixed inline elements: text, mention, text', () => {
    const div = makeDiv('Hi <a>@user</a>, welcome.');
    const p = buildProjection(div);
    expect(p.text).toBe('Hi @user, welcome.');
    // Three text nodes: "Hi ", "@user", ", welcome."
    expect(p.map).toHaveLength(3);
  });

  it('skips script/style', () => {
    const div = makeDiv('Hi <script>x=1</script>there.');
    const p = buildProjection(div);
    expect(p.text).toBe('Hi there.');
    // Verify the script's text content was excluded (only 2 surrounding text nodes).
    expect(p.map).toHaveLength(2);
  });

  it('normalize callback applied (1:1 length)', () => {
    const div = makeDiv('a\nb');
    const p = buildProjection(div, (s) => s.replace(/\n/g, ' '));
    expect(p.text).toBe('a b');
  });
});

describe('locateInProjection', () => {
  it('finds substring spanning multiple text nodes', () => {
    const div = makeDiv('Hi <a>@user</a>, ok.');
    const p = buildProjection(div);
    const found = locateInProjection(p, '@user, ok.', 0);
    expect(found).not.toBeNull();
    expect(found!.covers.length).toBeGreaterThan(1);
    expect(found!.startProjected).toBe(3); // "Hi " is 3 chars
  });

  it('returns null when not found', () => {
    const div = makeDiv('Hello world.');
    const p = buildProjection(div);
    expect(locateInProjection(p, 'missing', 0)).toBeNull();
  });

  it('respects fromProjectedOffset (forward search only)', () => {
    const div = makeDiv('hello hello');
    const p = buildProjection(div);
    const a = locateInProjection(p, 'hello', 0)!;
    expect(a.startProjected).toBe(0);
    const b = locateInProjection(p, 'hello', 1)!;
    expect(b.startProjected).toBe(6);
  });
});
