/**
 * At start, before the first engine or connection test (App.tsx): hand the
 * engine provider this build's wallet library module (iOS links
 * TaliaBdkWalletModule; anything else links none), delete the
 * records the removed engine features left on the phone
 * (wallet/retiredEngineRecords.ts), and, in Talia Test and TestFlight,
 * note in the engine report every connection test and a known-answer test
 * the library failed.
 *
 * One engine since the old engine's removal (decided 2026-11-04): there
 * is no engine to choose, no phone switch to read and nothing to compare,
 * so the launch writes no engine choice into the report, sets up no shadow
 * or report-only check, and the App Store app sends nothing (the counts
 * sender went with the preflight it counted). The App Store app
 * keeps no report file and writes nothing to it; Talia Test and TestFlight
 * write counts and fixed words only. A failed known-answer test opens no
 * vault (bitcoin/engine/engineProvider.ts), so it is counted once a launch
 * (`withKnownAnswerFailure`): a report pulled from the phone or shared
 * from Diagnostics then says why no vault opened, as the old preflight's did.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { BUILD_FLAVOUR } from '../config';
import { configureEngine, onConnectionAnswer, onKnownAnswer } from '../bitcoin/engine/engineProvider';
import { withConnectionTest, withKnownAnswerFailure } from './engineReport';
import { updateEngineReport } from '../platform/engineReportFile';
import { nativeBdkWallet } from '../platform/bdkWalletModule';
import { forgetRetiredEngineRecords } from './retiredEngineRecords';

let configured = false;

export function configureEngineLaunch(): void {
  if (configured) return;
  configured = true;
  configureEngine({ native: Platform.OS === 'ios' ? nativeBdkWallet() : undefined });
  void forgetRetiredEngineRecords(AsyncStorage).catch(() => 0);
  if (BUILD_FLAVOUR === 'store') return;
  onConnectionAnswer((answer) => {
    void updateEngineReport((r, app) => withConnectionTest(r, answer, app, new Date())).catch(() => null);
  });
  onKnownAnswer((known, ranFor) => {
    if (known.state !== 'failed') return;
    void updateEngineReport((r, app) => withKnownAnswerFailure(r, ranFor, app, new Date())).catch(() => null);
  });
}

/** Tests only: configure again from scratch. */
export function resetEngineLaunchForTests(): void {
  configured = false;
}
