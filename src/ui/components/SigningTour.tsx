/**
 * A drawn device stepping through frames on a timer, round and round, with
 * the press hint over it (design A "The courier" with the press hint of
 * design C, decided 2026-10-03): the client's turn on the review (`SigningTour`:
 * the device's own review pages at a reading pace, started again from the
 * first once the last has been shown long enough, so someone who missed a
 * page sees it again) and the two turns before the transaction, the PIN and
 * the app to open (`DeviceTurn`, decided 2026-10-04). A guide: the phone cannot
 * see which page the device is on, and nothing on the screen says it can.
 *
 * ONE clock per pass (`DeviceLoop`): the frames turn on a timer set on the
 * turn's own clock, and at the start of every pass (the first frame again)
 * the hint's clock is started from where the pass stands, so the hint and the
 * frames never drift apart however long the turn lasts. The hint's clock runs
 * on the native driver; with Reduce Motion on it does not run and the hint
 * stands still for the frame on show. A pass may bring its own frames (the
 * touch Ledgers' keypad comes in a new order every pass).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { DeviceArt, deviceArtBox } from './DeviceArt';
import { PressHint, useHintMotion } from './PressHint';
import { hintPlan } from './pressHintScript';
import type { HintPlan } from './pressHintScript';
import { reviewPages, tourCycle, tourNextTurnIn, tourPageAt, tourStarts } from '../hww/signingDevice';
import type { DeviceDrawing, DeviceScreen, TourFacts } from '../hww/signingDevice';

/**
 * Asks once and hands the answer to `set`, unless the returned cancel ran
 * first: an answer that comes after the turn has closed sets nothing. A
 * failed ask answers false. (React no longer warns about a late update, so
 * this is tested here rather than seen; `signingTour.test.tsx`.)
 */
export function askOnce(ask: () => Promise<boolean>, set: (answer: boolean) => void): () => void {
  let live = true;
  void ask()
    .catch(() => false)
    .then((r) => {
      if (live) set(r);
    });
  return () => {
    live = false;
  };
}

/** Reduce Motion, read once as the turn opens (false until it answers). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => askOnce(() => AccessibilityInfo.isReduceMotionEnabled(), setReduce), []);
  return reduce;
}

/** What a guide plays: its frame times, its length, and each pass's frames
 *  and hint (`pass` counts from 0; a guide whose frames never change hands
 *  back the same ones). */
export interface LoopScript {
  starts: readonly number[];
  cycle: number;
  /** With Reduce Motion the still hint shows its second side from this frame on. */
  stillFrom: number;
  pass: (pass: number) => { screens: DeviceScreen[]; plan: HintPlan | null };
}

export function DeviceLoop({ drawing, width, script }: { drawing: DeviceDrawing; width: number; script: LoopScript }): React.JSX.Element {
  const { starts, cycle, stillFrom } = script;
  const reduce = useReduceMotion();
  const clock = useRef(new Animated.Value(0)).current;
  const [index, setIndex] = useState(0);
  // Which pass the guide is on: a new one starts the hint's clock again.
  const [pass, setPass] = useState(0);
  const t0 = useRef(0);

  useEffect(() => {
    t0.current = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // One timer at a time, each set for the next frame on the turn's own
    // clock, so a late timer never drifts the frames.
    const schedule = (elapsed: number) => {
      const wait = tourNextTurnIn(starts, elapsed, cycle);
      if (wait == null) return;
      timer = setTimeout(() => {
        const now = Date.now() - t0.current;
        setIndex(tourPageAt(starts, now, cycle));
        setPass(Math.floor(now / cycle));
        schedule(now);
      }, wait);
    };
    setIndex(0);
    setPass(0);
    schedule(0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [starts, cycle]);

  const { screens, plan } = useMemo(() => script.pass(pass), [script, pass]);

  // The hint's clock for this pass, started once the pass's first frame is
  // drawn, from where the pass stands on the turn's clock.
  useEffect(() => {
    if (reduce || cycle <= 0 || plan == null) return;
    const from = (Date.now() - t0.current) % cycle;
    clock.setValue(from);
    const run = Animated.timing(clock, { toValue: cycle, duration: Math.max(1, cycle - from), easing: Easing.linear, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [pass, reduce, cycle, plan, clock]);

  const at = Math.min(index, screens.length - 1);
  const motion = useHintMotion(plan, clock, drawing, width, reduce, at >= stillFrom);
  const box = deviceArtBox(drawing, width);
  return (
    <View style={{ width: box.w, height: box.h }}>
      <DeviceArt drawing={drawing} width={width} screen={screens[at]} lit progress={motion?.progress} scrolls={motion?.scrolls} />
      <PressHint drawing={drawing} width={width} motion={motion} />
    </View>
  );
}

/** The client's turn on the review: the device's own pages, round and round
 *  (the Nova's amount pages swiped to the address's end before the tap, decided
 *  2026-10-05, so the hint takes the pages). */
export function SigningTour({ drawing, width, facts }: { drawing: DeviceDrawing; width: number; facts: TourFacts }): React.JSX.Element {
  const script = useMemo((): LoopScript => {
    const pages = reviewPages(drawing, facts);
    const starts = tourStarts(pages);
    const cycle = tourCycle(pages);
    const plan = hintPlan(drawing, pages, starts, cycle);
    const screens: DeviceScreen[] = pages.map((page, index) => ({ kind: 'review', page, index, total: pages.length }));
    return { starts, cycle, stillFrom: pages.length - 1, pass: () => ({ screens, plan }) };
  }, [drawing, facts]);
  return <DeviceLoop drawing={drawing} width={width} script={script} />;
}
