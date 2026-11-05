/**
 * Whether the floating dock shows its names (decided 2026-09-12): the names sit
 * under the icons while a screen rests at the top, and fold away as soon as
 * the user scrolls down, leaving the icons. One shared switch, because only
 * one dock is ever on screen (the tab bar on the home screens, the
 * Receive/Send bar on a vault) and both must behave the same.
 */
import { useEffect, useState } from 'react';

/** Scroll past this and the names fold away... */
const FOLD_AT = 48;
/** ...and come back only this close to the top, so a bounce never flickers. */
const UNFOLD_AT = 16;

let folded = false;
const listeners = new Set<(next: boolean) => void>();

export function setDockFolded(next: boolean): void {
  if (next === folded) return;
  folded = next;
  listeners.forEach((l) => l(next));
}

/** Feed a list's scroll offset while it scrolls. */
export function dockFollowScroll(offsetY: number): void {
  if (offsetY > FOLD_AT) setDockFolded(true);
  else if (offsetY < UNFOLD_AT) setDockFolded(false);
}

/** A screen coming into focus states its own resting position outright. */
export function dockSyncScroll(offsetY: number): void {
  setDockFolded(offsetY > FOLD_AT);
}

export function useDockFolded(): boolean {
  const [state, setState] = useState(folded);
  useEffect(() => {
    listeners.add(setState);
    setState(folded);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
