/**
 * The device in the client's hand, drawn (design A "The courier", decided
 * 2026-10-03): which drawing comes from the model the device reported at
 * discovery (`ui/hww/signingDevice.ts` `drawingFor`), what its screen shows
 * from the ceremony's leg. One component per device family:
 *
 *   gen5, flex, stax   LedgerTouchArt (one E Ink, one set of pages)
 *   nanoX              NanoXArt
 *   nova               NovaArt
 *   slab               LedgerSlabArt (a Ledger of unknown model)
 */
import React from 'react';
import type { DeviceDrawing, DeviceScreen } from '../hww/signingDevice';
import { FlexArt, Gen5Art, StaxArt, flexAnchors, flexSize, gen5Anchors, gen5Size, staxAnchors, staxSize } from './LedgerTouchArt';
import type { TouchAnchors, TouchProgress } from './LedgerTouchArt';
import { NanoXArt, nanoXAnchors, nanoXHeight, nanoXRise } from './NanoXArt';
import type { NanoXAnchors } from './NanoXArt';
import { NovaArt, novaAnchors, novaSize } from './NovaArt';
import type { NovaAnchors, NovaProgress, NovaScrollProgress, NovaUnlockProgress } from './NovaArt';
import { LedgerSlabArt, slabHeight } from './LedgerSlabArt';

/** The width each device is drawn at beside the phone (the design's sizes). */
export const DEVICE_ART_WIDTH: Record<DeviceDrawing, number> = {
  gen5: 176,
  flex: 176,
  stax: 176,
  slab: 176,
  nanoX: 250,
  nova: 205,
};

/** The room a drawing takes at `width`, side buttons and plugs included. */
export function deviceArtBox(d: DeviceDrawing, width: number): { w: number; h: number; rise: number } {
  switch (d) {
    case 'gen5':
      return { ...gen5Size(width), rise: 0 };
    case 'flex':
      return { ...flexSize(width), rise: 0 };
    case 'stax':
      return { ...staxSize(width), rise: 0 };
    case 'nanoX':
      // The open cover rises above the stick; the row leaves it that room.
      return { w: width, h: nanoXHeight(width), rise: nanoXRise(width) };
    case 'nova':
      return { ...novaSize(width), rise: 0 };
    default:
      return { w: width, h: slabHeight(width), rise: 0 };
  }
}

/**
 * The body width that fits beside the phone in `room` points: the design's
 * size where it fits, smaller on a narrow phone, never wider than the room.
 */
export function deviceArtWidth(d: DeviceDrawing, room: number): number {
  const design = DEVICE_ART_WIDTH[d];
  const total = deviceArtBox(d, design).w;
  return total <= room ? design : Math.max(80, Math.floor((design * room) / total));
}

/** The device's own progress from the press hint's clock: the touch Ledgers'
 *  line on their last page, the Nova's arrows on Total, and the Nova's
 *  turning arrow, sliding arrows and opening lock after it is plugged in. */
export type DeviceProgress = TouchProgress | NovaProgress | NovaUnlockProgress;

export function DeviceArt({
  drawing,
  width,
  screen,
  lit,
  progress,
  scrolls,
}: {
  drawing: DeviceDrawing;
  width: number;
  screen: DeviceScreen;
  lit: boolean;
  progress?: DeviceProgress;
  /** The Nova's lines carried along as its lower edge is swiped, by frame
   *  (the address check's address, the review's amount pages); the Ledgers
   *  scroll nothing. */
  scrolls?: readonly NovaScrollProgress[];
}): React.JSX.Element {
  const touch = progress?.kind === 'touch' ? progress : undefined;
  switch (drawing) {
    case 'gen5':
      return <Gen5Art width={width} screen={screen} lit={lit} progress={touch} />;
    case 'flex':
      return <FlexArt width={width} screen={screen} lit={lit} progress={touch} />;
    case 'stax':
      return <StaxArt width={width} screen={screen} lit={lit} progress={touch} />;
    case 'nanoX':
      return <NanoXArt width={width} screen={screen} lit={lit} />;
    case 'nova':
      return <NovaArt width={width} screen={screen} lit={lit} progress={progress?.kind === 'nova' || progress?.kind === 'nova-unlock' ? progress : undefined} scrolls={scrolls} />;
    default:
      return <LedgerSlabArt width={width} screen={screen} lit={lit} />;
  }
}

/**
 * Where the client touches each drawing, in the drawing's box (the press
 * hint lights these): a touch Ledger's footer ">" and "Hold to sign" tile, the
 * Nano X's two buttons, the Nova's top and bottom right edges; each with the
 * screen whose words the hint never covers. A Ledger of unknown model has no
 * spot the app can vouch for: none.
 */
export type DeviceAnchors =
  | { kind: 'touch'; a: TouchAnchors }
  | { kind: 'nanoX'; a: NanoXAnchors }
  | { kind: 'nova'; a: NovaAnchors }
  | { kind: 'none' };

export function deviceAnchors(d: DeviceDrawing, width: number): DeviceAnchors {
  switch (d) {
    case 'gen5':
      return { kind: 'touch', a: gen5Anchors(width) };
    case 'flex':
      return { kind: 'touch', a: flexAnchors(width) };
    case 'stax':
      return { kind: 'touch', a: staxAnchors(width) };
    case 'nanoX':
      return { kind: 'nanoX', a: nanoXAnchors(width) };
    case 'nova':
      return { kind: 'nova', a: novaAnchors(width) };
    default:
      return { kind: 'none' };
  }
}
