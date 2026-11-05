/**
 * Globals Hermes doesn't ship but our crypto dependencies expect.
 *
 * `@scure/btc-signer` reads a PSBT's magic bytes through `TextDecoder`, which
 * iOS's JS engine has no implementation of. In Talia that library is reached
 * only via the FALLBACK finalizer (`psbt/finalize.ts`), so the gap stayed
 * hidden: BDK finalized every spend tested on a phone. It surfaced immediately on the
 * phone co-signer, which uses the library directly (2026-07-26):
 *
 *     Reader(magic): ReferenceError: Property 'TextDecoder' doesn't exist
 *
 * Left unfixed, a co-sign that BDK can't finalize would throw this instead of
 * falling through to the working finalizer — exactly the case the fallback
 * exists for.
 *
 * The UTF-8 conversion reuses `bbqr.ts`'s helpers, written for this same
 * Hermes gap and verified byte-for-byte against Node's own TextEncoder /
 * TextDecoder in bbqr/__tests__/utf8.test.ts — no new codec, and no new
 * dependency on the wallet's critical path.
 */
// FIRST: a real CSPRNG (iOS SecRandomCopyBytes). Heir-invite codes and
// envelope nonces draw from crypto.getRandomValues — Hermes has none.
import 'react-native-get-random-values';

import { bytesToUtf8, utf8ToBytes } from './bitcoin/bbqr/bbqr';

// Omit the lib declarations first: the Ledger kits' type graph pulls in
// @types/node, whose global TextEncoder/TextDecoder/Buffer declarations would
// otherwise make our minimal Hermes shims unassignable.
type Global = Omit<typeof globalThis, 'TextEncoder' | 'TextDecoder' | 'Buffer'> & {
  TextEncoder?: unknown;
  TextDecoder?: unknown;
  Buffer?: unknown;
};

const g = globalThis as Global;

// The Ledger signer kit runtime-imports bitcoinjs-lib, whose transaction.js
// reads the GLOBAL Buffer at module-evaluation time — without this shim the
// app crashes at startup the moment any @ledgerhq module is imported, not
// when a Ledger is used. `buffer` is the npm package bitcoinjs itself targets.
if (typeof g.Buffer === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  g.Buffer = require('buffer').Buffer;
}

if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = class TextEncoder {
    get encoding(): string {
      return 'utf-8';
    }

    encode(text = ''): Uint8Array {
      return utf8ToBytes(String(text));
    }
  };
}

if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = class TextDecoder {
    private readonly label: string;

    constructor(label = 'utf-8') {
      this.label = String(label).toLowerCase();
    }

    get encoding(): string {
      return this.label;
    }

    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (input == null) return '';
      const bytes =
        input instanceof Uint8Array
          ? input
          : ArrayBuffer.isView(input)
            ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            : new Uint8Array(input);
      return bytesToUtf8(bytes);
    }
  };
}
