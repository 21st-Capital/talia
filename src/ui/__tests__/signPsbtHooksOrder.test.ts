/**
 * The signing screen calls every hook before it can return early (2026-10-13).
 * Structural, like speedUpAndCancel: the repo has no component tests, and CI
 * runs typecheck and jest, not ESLint's rules-of-hooks.
 *
 * SignPsbtScreen returns "Could not read this PSBT." while it has no vault or
 * no readable PSBT. A hook below that return runs only once both arrive, so a
 * screen that first rendered without them and then got them made React throw
 * "Rendered more hooks than during the previous render", and the signing
 * screen crashed. `partialIdRef` sat there.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SCREEN = join(__dirname, '..', 'screens', 'SignPsbtScreen.tsx');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A hook call: `useX(`, `useX<T>(` or `React.useX(`, never `refuseX(`. */
const HOOK = /\buse[A-Z]\w*\s*[(<]/g;

/** The component's own body, from its signature to its closing brace at column 0. */
function componentBody(): string {
  const src = code(readFileSync(SCREEN, 'utf8'));
  const start = src.indexOf('export function SignPsbtScreen(');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('SignPsbtScreen hooks order', () => {
  it('calls no hook after its first early return', () => {
    const body = componentBody();
    // A return that renders (`return (` then JSX), never a cleanup's `return () =>`.
    const early = body.search(/\breturn\s*\(\s*</);
    expect(early).toBeGreaterThan(-1);

    const before = body.slice(0, early).match(HOOK) ?? [];
    const after = body.slice(early).match(HOOK) ?? [];
    // The search found the hooks at all, so an empty `after` means something.
    expect(before.length).toBeGreaterThan(10);
    expect(after).toEqual([]);
  });

  it('keeps the early return for a vault or PSBT it cannot read', () => {
    // The rule above is only as good as the return it measures from.
    const body = componentBody();
    expect(body).toMatch(/if \(!wallet \|\| !psbtBytes\) \{\s*return \(/);
  });
});
