/**
 * One authenticator step for every request to 21st Capital (decided 2026-10-05).
 *
 * The rescue request asks for the authenticator code when the account has
 * two-factor, with the SAME step co-signing shows, never a second copy that
 * drifts from it. And it sends the code only through the rescue service,
 * which leaves it out for a client without two-factor.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(UI, rel), 'utf8');
/** Comments out: a rule may be explained in words, never re-drawn. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the authenticator step', () => {
  it('co-signing and the rescue both render the one component', () => {
    expect(code(read('components/CosignRequestPanel.tsx'))).toMatch(/<AuthenticatorStep\b/);
    expect(code(read('screens/RescueScreen.tsx'))).toMatch(/<AuthenticatorStep\b/);
  });

  it('neither draws its own copy of it', () => {
    for (const file of ['components/CosignRequestPanel.tsx', 'screens/RescueScreen.tsx']) {
      const src = code(read(file));
      expect({ file, title: src.includes('Now a different code') }).toEqual({ file, title: false });
      expect({ file, label: src.includes('Code from your authenticator app') }).toEqual({ file, label: false });
    }
  });

  it('draws no button: the way back is the host page\'s pinned footer (decided 2026-10-05)', () => {
    const step = code(read('components/AuthenticatorStep.tsx'));
    expect(step).not.toMatch(/<Button\b/);
    expect(step).not.toMatch(/\bonBack\b/);
    // The rescue's two code steps each put Back in their Screen's footer.
    const rescue = code(read('screens/RescueScreen.tsx'));
    const totp = rescue.slice(rescue.indexOf("step === 'totp'"), rescue.indexOf('<AuthenticatorStep'));
    expect(totp).toMatch(/footer=\{\s*<Button\s+title="Back"/);
    // Co-signing's Back for that step is the panel's footer action.
    expect(code(read('components/CosignRequestPanel.tsx'))).toMatch(/codeStep === 'totp'\s*\?\s*\{ back: \{ onPress: toEmail/);
  });

  it('the rescue hands the code to the service and builds no body of its own', () => {
    const src = code(read('screens/RescueScreen.tsx'));
    expect(src).toMatch(/submitRescueRequest\(session, \{[\s\S]*?\btotp,\s*\}\)/);
    expect(src).not.toMatch(/\btotp:\s*['"`]/);
    expect(src).not.toMatch(/email_otp/);
  });
});
