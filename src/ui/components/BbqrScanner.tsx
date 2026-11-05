/**
 * QR scanner that understands multi-frame transfers, BBQr (COLDCARD Q) and
 * UR (Foundation Passport, Keystone and the rest of the industry, decided
 * 2026-09-08), as well as ordinary single QRs. Feeds frames to the right
 * joiner, shows live progress, and calls back exactly once with the
 * reassembled payload, in the shapes consumers already read: a PSBT as the
 * BBQr 'P' bytes, a key export or JSON as text. The transport is not the
 * consumer's business.
 */
import React, { useCallback, useRef, useState } from 'react';
import { QrScanner } from '../../platform/QrScanner';
import { BbqrJoiner, isBbqrFrame } from '../../bitcoin/bbqr';
import type { BbqrFileType } from '../../bitcoin/bbqr';
import { UrJoiner, descriptorFromUrAccountKey, isUrPart } from '../../bitcoin/ur';
import type { UrAccountKey, UrPayload } from '../../bitcoin/ur';

/** A UR payload in the shape the consumers already read. */
function fromUr(payload: UrPayload): BbqrScanResult {
  const keyText = (key: UrAccountKey): string => {
    try {
      return descriptorFromUrAccountKey(key);
    } catch {
      const origin = key.fingerprint ? `[${key.fingerprint}${key.originPath ? `/${key.originPath}` : ''}]` : '';
      return `${origin}${key.xpub}`;
    }
  };
  switch (payload.kind) {
    case 'psbt':
      return { kind: 'bbqr', fileType: 'P', bytes: payload.psbt };
    case 'bytes': {
      // The Passport wraps its key export (JSON) in ur:bytes; a binary PSBT
      // can travel the same way.
      const b = payload.bytes;
      const isPsbt = b.length > 5 && b[0] === 0x70 && b[1] === 0x73 && b[2] === 0x62 && b[3] === 0x74 && b[4] === 0xff;
      if (isPsbt) return { kind: 'bbqr', fileType: 'P', bytes: b };
      return { kind: 'text', text: payload.text ?? '', via: 'ur' };
    }
    case 'account': {
      const key = payload.keys.find((k) => k.scriptType === 'wpkh') ?? payload.keys[0];
      return { kind: 'text', text: key ? keyText(key) : '', via: 'ur' };
    }
    case 'hdkey':
      return { kind: 'text', text: keyText(payload.key), via: 'ur' };
    case 'output':
      return { kind: 'text', text: payload.descriptor, via: 'ur' };
    default:
      return { kind: 'text', text: '' };
  }
}

export type BbqrScanResult =
  | { kind: 'bbqr'; fileType: BbqrFileType; bytes: Uint8Array }
  /** `via: 'ur'`: the text came off a BC-UR code. Only the Foundation
   *  Passport speaks UR among the devices Talia knows, so a key export read
   *  this way names its device (decided 2026-09-08: an import from the device
   *  is already connected). */
  | { kind: 'text'; text: string; via?: 'ur' };

export function BbqrScanner({
  onComplete,
  onCancel,
  hint,
}: {
  onComplete: (result: BbqrScanResult) => void;
  onCancel: () => void;
  hint?: string;
}): React.JSX.Element {
  const joiner = useRef(new BbqrJoiner());
  const urJoiner = useRef(new UrJoiner());
  const done = useRef(false);
  const [progress, setProgress] = useState<{ have: number; total: number } | null>(null);

  const onScanned = useCallback(
    (value: string) => {
      if (done.current) return;
      if (isBbqrFrame(value)) {
        try {
          const p = joiner.current.addFrame(value);
          setProgress({ have: p.have, total: p.total });
          if (p.done) {
            done.current = true;
            onComplete({
              kind: 'bbqr',
              fileType: joiner.current.joinedFileType!,
              bytes: joiner.current.result(),
            });
          }
        } catch {
          // a frame from a different transfer / corrupt read — keep scanning
        }
        return;
      }
      if (isUrPart(value)) {
        try {
          const p = urJoiner.current.addPart(value);
          setProgress({ have: p.have, total: p.total });
          if (p.done) {
            done.current = true;
            onComplete(fromUr(urJoiner.current.result()));
          }
        } catch {
          // a part of another transfer, or an unreadable one — keep scanning
        }
        return;
      }
      // Plain single QR (descriptor, xpub, base64 PSBT, JSON…)
      done.current = true;
      onComplete({ kind: 'text', text: value });
    },
    [onComplete],
  );

  return (
    <QrScanner
      continuous
      onScanned={onScanned}
      onCancel={onCancel}
      hint={hint}
      status={
        progress
          ? `Scanned ${progress.have} of ${progress.total} frames`
          : undefined
      }
    />
  );
}
