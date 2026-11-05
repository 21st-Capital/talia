/**
 * Shared "add a key" sheet for the vault builders and heir activation.
 *
 * Device first (decided 2026-10-04): the sheet asks WHICH device will hold the
 * key, as the registry's device list (`HardwareConnect`), and the pick
 * starts the search with that device drawn turning on and unlocking. The
 * device reads the key and proves it holds it. Behind "Another device" (an
 * heir's own hardware, a wallet never adopted, the App Store build) are the
 * ways in that need no adopted device: a key QR, a paste, an export file.
 * A vault being BUILT offers no "Another device": only a Ledger or a BitBox
 * can sign every shape the builder can still turn it into (decided 2026-09-24).
 */
import React, { useRef, useState } from 'react';
import { ChevronRightIcon } from './TablerIcons';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from './AppModal';
import { Button } from './Button';
import { TextField } from './TextField';
import { BbqrScanner } from './BbqrScanner';
import type { BbqrScanResult } from './BbqrScanner';
import { isPassportScan } from '../hww/passportBinding';
import { bytesToUtf8 } from '../../bitcoin/bbqr';
import { pickTextFile } from '../../platform/files';
import { BlurView } from '@react-native-community/blur';
import { Gloss } from './Gloss';
import { getColorScheme, theme, themedStyles } from '../theme';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import {
  parseColdcardExport,
  parseKeyOrigins,
  normalizeBareKey,
} from '../../bitcoin/descriptor';
import { OTHER_DEVICE_STEPS } from './hwwDevices';
import type { KeyPurpose } from './hwwDevices';
import { deviceName } from '../../wallet/deviceKinds';
import { HardwareConnect } from './HardwareConnect';
import type { StepBack } from './HardwareConnect';
import { StepList } from './MarkedText';
import type { ColdcardExport, KeyOrigin } from '../../bitcoin/descriptor';
import type { Network } from '../../bitcoin/descriptor/types';
import type { KeyDevice } from '../../wallet/types';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

/** The sheet's foot above the home indicator at rest. With the keyboard up
 *  the keys are the floor and the content sits one `md` above them, the
 *  pinned footer's measure. */
const SHEET_FOOT = 40;

/** Paste/QR input → one key. Accepts xpub, zpub/ypub (converted), [origin]xpub. */
export function parseKeyInput(text: string): { key: KeyOrigin; warnings: string[] } | null {
  const t = text.trim();
  if (!t) return null;
  // A standard key WITH its origin needs no normalization and NO assumptions
  // — the origin path already tells the true story. Routing these through
  // the bare-key machinery stamped its "assumed BIP-84" warning on
  // Bluetooth-fetched multisig keys whose path plainly said 48'/…/2'
  // (decided 2026-08-26). SLIP-132 keys (zpub…) still need the conversion below.
  if (/^\[[0-9a-fA-F]{8}[/\]]/.test(t) && /\][xt]pub/.test(t)) {
    const keys = parseKeyOrigins(t);
    if (keys.length === 1 && keys[0].fingerprint) {
      const k = keys[0];
      return {
        key: { fingerprint: k.fingerprint, originPath: k.originPath, xpub: k.xpub },
        warnings: [],
      };
    }
  }
  try {
    const norm = normalizeBareKey(t);
    if (norm) {
      const k = parseKeyOrigins(norm.descriptor)[0];
      if (!k) return null;
      return {
        key: { fingerprint: k.fingerprint, originPath: k.originPath, xpub: k.xpub },
        warnings: norm.warnings,
      };
    }
  } catch {
    return null; // bare-key-shaped but unusable (bad checksum / private key)
  }
  const keys = parseKeyOrigins(t);
  if (keys.length === 1) {
    const k = keys[0];
    return {
      key: { fingerprint: k.fingerprint, originPath: k.originPath, xpub: k.xpub },
      warnings: [],
    };
  }
  return null;
}

export function KeyEntrySheet({
  visible,
  /** Which Coldcard account to take: BIP-86 for single-sig, BIP-48/2' else. */
  coldcardAccount,
  question = 'Which device will hold this key?',
  intro,
  guideOriginPath,
  onAdd,
  onRaw,
  building,
  onLedgerKey,
  readBothAccounts,
  network = 'bitcoin',
  usedDeviceIds,
  onClose,
  onError,
}: {
  visible: boolean;
  coldcardAccount: 'bip84' | 'bip86' | 'bip48_2';
  /** Network the vault lives on — drives the Bluetooth fetch's coin type
   *  and which app the Ledger opens. */
  network?: Network;
  /** A key just arrived over Bluetooth: the device PROVED it holds this
   *  fingerprint — the host should remember the binding as keyDevices
   *  after the vault is created. */
  /** `name` is what the device calls itself: the Bluetooth search's own
   *  row, or "Passport" for a scanned export. The host offers it as the
   *  key's label instead of an empty field (decided 2026-09-09). */
  onLedgerKey?: (fingerprint: string, device: KeyDevice, deviceId: string, name?: string) => void;
  /** BLE ids of devices whose key is already in this build — the search
   *  list marks them instead of letting the same-key gate say no later. */
  usedDeviceIds?: ReadonlySet<string>;
  /** The question over the device list: a key being placed in a vault
   *  being built, or an heir's key that already sits on a device. */
  question?: string;
  /** Optional explainer under the question. */
  intro?: string;
  /** Origin path of the key we need — shown so an advanced user can
   *  confirm they picked the multisig account, e.g. "48'/1'/0'/2'". */
  guideOriginPath?: string;
  /** The third argument is the FULL Coldcard export when the key came from
   *  one: it carries every standard account, so the host can switch account
   *  later (single-sig → multisig) without asking for another export
   *  (decided 2026-07-27). */
  onAdd: (key: KeyOrigin, warnings: string[], fullExport?: ColdcardExport) => void;
  /** When set, the sheet hands over the RAW payload (Coldcard JSON, key
   *  text) instead of resolving one account itself — the heir
   *  flow must try every account in an export, because decrypting IS the
   *  proof of key (decided 2026-07-26). */
  onRaw?: (raw: string) => void;
  /** Talia is BUILDING this vault: only a device that can sign every shape
   *  the builder can still turn it into, which today means a Ledger or a
   *  BitBox (decided 2026-09-24). The heir flow does not set it: an heir's key
   *  may live on anything. */
  building?: boolean;
  /** Read BOTH accounts a vault built here can need in the one connection
   *  (decided 2026-09-22): the ordinary single-key account (BIP-84) and the
   *  multi-key account (48'/2') that any timelocked layer takes. The key for
   *  `coldcardAccount` is placed and the other rides along as the export, so
   *  adding a rescue key or an heir later never sends the owner back to the
   *  device for "one more read". */
  readBothAccounts?: boolean;
  onClose: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const kb = useKeyboardHeight();
  const [pasteOpen, setPasteOpen] = useState(false);
  // The paste field and its Add key button both come up above the keys
  // (decided 2026-09-18): the sheet lifts, but its own scroll view has to bring
  // the field into view as well.
  const revealScrollRef = useRef<ScrollView | null>(null);
  const revealOffsetY = useRef(0);
  useRevealFocusedField(revealScrollRef, revealOffsetY);
  const [pasteText, setPasteText] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  /** True only while a BC-UR scan is being accepted. */
  const passportScanRef = useRef(false);
  /** Remounts the connect step once a key is in: the sheet may stay up for
   *  another slot, and the search must not sit on a finished device. */
  const [round, setRound] = useState(0);
  /** The step's one Back (to its device list), while the step has one: the
   *  sheet's foot draws it, under the scroll area (decided 2026-10-05). */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);

  /** A multisig vault needs a different account than a single-sig one. */
  const guidePurpose: KeyPurpose = coldcardAccount === 'bip48_2' ? 'multisig' : 'single';

  const reset = () => {
    setPasteOpen(false);
    setPasteText('');
    setScanOpen(false);
    // Remounting the connect step stops the radio and drops the session: a
    // dismissed sheet must never keep a Ledger connection alive.
    setRound((r) => r + 1);
  };

  /** The account path this vault shape needs, on this network. */
  const bleDerivationPath = (): string => {
    // The vault names the account its key sits at (an heir's key in a vault
    // built elsewhere can be account 1 or 2): read THAT one, never a guess.
    const vaultPath = (guideOriginPath ?? '').trim().toLowerCase().replace(/h/g, "'").replace(/^m\//, '');
    if (/^\d+'?(\/\d+'?)*$/.test(vaultPath)) return vaultPath;
    const coin = network === 'bitcoin' ? "0'" : "1'";
    return coldcardAccount === 'bip48_2'
      ? `48'/${coin}/0'/2'`
      : coldcardAccount === 'bip84'
        ? `84'/${coin}/0'`
        : `86'/${coin}/0'`;
  };

  /**
   * A device's key is in hand over Bluetooth. With `readBothAccounts` the
   * second account is read in the same connection and handed up as the
   * export; otherwise the one account goes through the usual parser.
   */
  const acceptDeviceRead = async (
    fingerprint: string,
    read: (path: string) => Promise<string>,
    alive: () => boolean,
    /** The device just PROVED it holds this key: hand the binding up before
     *  the key is placed, so the host names it after the device. */
    bind: () => void,
  ): Promise<void> => {
    if (!readBothAccounts || onRaw) {
      const path = bleDerivationPath();
      const xpub = await read(path);
      if (!alive()) return;
      bind();
      acceptPayload(`[${fingerprint}/${path}]${xpub}`);
      return;
    }
    const coin = network === 'bitcoin' ? "0'" : "1'";
    const soloPath = `84'/${coin}/0'`;
    const multiPath = `48'/${coin}/0'/2'`;
    const solo = parseKeyInput(`[${fingerprint}/${soloPath}]${await read(soloPath)}`);
    if (!alive()) return;
    const multi = parseKeyInput(`[${fingerprint}/${multiPath}]${await read(multiPath)}`);
    if (!alive()) return;
    if (!solo || !multi) throw new Error('The device returned a key Talia could not read. Please try again.');
    const both: ColdcardExport = {
      fingerprint: fingerprint.toLowerCase(),
      bip84: { originPath: soloPath, xpub: solo.key.xpub },
      bip48_2: { originPath: multiPath, xpub: multi.key.xpub },
    };
    const chosen = coldcardAccount === 'bip48_2' ? multi : solo;
    bind();
    finish(chosen.key, chosen.warnings, both);
  };

  const finish = (key: KeyOrigin, warnings: string[], fullExport?: ColdcardExport) => {
    // A key scanned from a Passport is bound to it here (decided 2026-09-08):
    // no Bluetooth read proves the device, the scan is the proof. The host
    // remembers it as keyDevices once the vault exists, like a Ledger read.
    // Only a code that came off the Passport (a moving BC-UR code) binds it;
    // a flat QR, a paste or a file adds the key and binds nothing (decided
    // 2026-09-22).
    if (passportScanRef.current) {
      onLedgerKey?.(key.fingerprint ?? key.xpub, { kind: 'passport' }, '', deviceName('passport'));
    }
    reset();
    onAdd(key, warnings, fullExport);
  };

  const fail = (message: string) => {
    reset();
    onClose();
    onError(message);
  };

  /** Dismissal must clear the sheet's transient state too: a Bluetooth flow
   *  left armed would auto-connect into the NEXT key slot the moment it
   *  opens, reading a device's key into a slot the owner never aimed at
   *  (decided 2026-08-26). */
  const dismiss = () => {
    reset();
    onClose();
  };

  /** Coldcard JSON (Generic export OR Multisig Export-XPUB) → the account. */
  const acceptColdcardJson = (content: string): boolean => {
    const cc = parseColdcardExport(content);
    if (!cc) return false;
    const account =
      coldcardAccount === 'bip84'
        ? cc.bip84
        : coldcardAccount === 'bip86'
          ? // Taproot single-sig; older firmware without a BIP-86 section
            // falls back to BIP-84 (the composer then emits wpkh).
            cc.bip86 ?? cc.bip84
          : // NO fallback for the multisig account (the derivation rule decided
            // 2026-07-27): an 84' key in a timelocked taproot vault is
            // silently wrong. Fail loudly instead.
            cc.bip48_2;
    if (!account) {
      fail(
        coldcardAccount === 'bip48_2'
          ? 'This export has no multi-key account. Re-export it from your device with multisig accounts included.'
          : 'The export is missing the needed account. Re-export it from your device.',
      );
      return true;
    }
    const warnings: string[] = [];
    finish(
      { fingerprint: cc.fingerprint, originPath: account.originPath, xpub: account.xpub },
      warnings,
      cc,
    );
    return true;
  };

  /** Any key payload (QR text or BBQr bytes) → key or clear error. */
  const acceptPayload = (raw: string) => {
    if (onRaw) {
      reset();
      onRaw(raw);
      return;
    }
    const parsed = parseKeyInput(raw);
    if (parsed) {
      finish(parsed.key, parsed.warnings);
      return;
    }
    if (acceptColdcardJson(raw)) return;
    fail("That doesn't contain a usable public key export.");
  };

  const onColdcardFile = async () => {
    try {
      const file = await pickTextFile();
      if (!file) return;
      if (onRaw) {
        reset();
        onRaw(file.content);
        return;
      }
      if (!acceptColdcardJson(file.content)) {
        fail("That file doesn't contain a usable key export.");
      }
    } catch (e) {
      fail(`Could not read the file: ${(e as Error).message}`);
    }
  };

  const onScanResult = (result: BbqrScanResult) => {
    setScanOpen(false);
    passportScanRef.current = isPassportScan(result);
    try {
      acceptPayload(result.kind === 'text' ? result.text : bytesToUtf8(result.bytes));
    } finally {
      passportScanRef.current = false;
    }
  };

  return (
    <>
      <AppModal visible={visible && !scanOpen} transparent animationType="fade" onRequestClose={dismiss}>
        {/* The sheet stays on the bottom of the screen and its OWN glass runs on
   behind the keyboard (reported 2026-09-21: "sharp edges at the corner of the
   lower part of the screen every time the keyboard is active"). A
   KeyboardAvoidingView lifted the whole sheet, so its square bottom edge
   sat on the keyboard's rounded corners. The keyboard's height is padding
   INSIDE the sheet instead, the way the Send screen's Priority sheet does. */}
        <View style={styles.kav}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={dismiss}>
          <TouchableOpacity activeOpacity={1} style={[styles.sheet, kb > 0 && { paddingBottom: theme.spacing.md + kb }]}>
          {/* Frosted (decided 2026-09-12): the page blurs through the sheet. */}
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
            blurAmount={24}
            reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
          />
          <View style={styles.glassTint} pointerEvents="none" />
          <Gloss radius={theme.radius.lg} />
            <ScrollView
              ref={revealScrollRef}
              onScroll={(e) => {
                revealOffsetY.current = e.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={32}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.sheetScrollContent}>
            {/* Which device holds the key, first (decided 2026-10-04), as the
                registry's list (the brands, then a brand's models); a pick
                starts the search with that device drawn. The ways in that
                need no adopted device sit behind "Another device", never
                while a vault is being built. */}
            <HardwareConnect
              key={round}
              shape={guidePurpose === 'multisig' ? 'multi' : 'single'}
              purpose={building ? 'build' : 'key'}
              network={network}
              keys={[]}
              question={question}
              intro={intro}
              usedDeviceIds={usedDeviceIds}
              onFooterBack={setStepBack}
              deviceTask={async (device) => {
                device.setStep(`Reading the key from the ${device.brandName}…`);
                await acceptDeviceRead(device.fingerprint, (path) => device.xpub(path, network), device.alive, () =>
                  onLedgerKey?.(device.fingerprint, device.record, device.deviceId, device.name),
                );
              }}
              another={
                building
                  ? undefined
                  : (back) => (
                      <>
                        {/* Behind the tile, the rows are "Another device"
                            with a way back to the question, which is the
                            step's Back at the sheet's foot. With no tile
                            to offer (no hardware surface: the App Store
                            build) they are the whole step: the question
                            and the intro, which names the heir's key, head
                            them, and there is nothing to go back to. */}
                        {back ? (
                          <Text style={styles.title}>Another device</Text>
                        ) : (
                          <>
                            {!!question && <Text style={styles.title}>{question}</Text>}
                            {!!intro && <Text style={styles.intro}>{intro}</Text>}
                          </>
                        )}
                        <StepList steps={[...OTHER_DEVICE_STEPS[guidePurpose]]} style={styles.step} />
                        {!!guideOriginPath && (
                          <Text style={styles.pathHint}>The account we need: m/{guideOriginPath.replace(/^m\//, '')}</Text>
                        )}
                        <Row title="Scan a key QR" sub="xpub or [fingerprint/path]xpub…" onPress={() => setScanOpen(true)} />
                        <Row title="Paste a key" sub="xpub / zpub / [origin]xpub" onPress={() => setPasteOpen(true)} />
                        <Row title="Load the export file" sub="From microSD, Files, or a download" onPress={() => void onColdcardFile()} />
                      </>
                    )
              }
            />
            {pasteOpen && (
              <View style={styles.pasteBlock}>
                <TextField
                  label="Key"
                  value={pasteText}
                  onChangeText={setPasteText}
                  placeholder="[73c5da0a/48'/0'/0'/2']xpub…"
                  monospace
                  multiline
                />
                <Button
                  title="Add key"
                  variant="accent"
                  disabled={parseKeyInput(pasteText) == null}
                  onPress={() => {
                    const parsed = parseKeyInput(pasteText);
                    if (parsed) finish(parsed.key, parsed.warnings);
                  }}
                />
              </View>
            )}
            </ScrollView>
            {stepBack != null && (
              // The sheet's foot (decided 2026-10-05: every button at the bottom): the
              // step's one Back, under the scroll area so it never scrolls away or
              // slides with the step.
              <View style={styles.sheetFoot}>
                <Button title="Back" variant="ghost" onPress={stepBack.onPress} />
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
        </View>
      </AppModal>

      <AppModal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <BbqrScanner
          onComplete={onScanResult}
          onCancel={() => setScanOpen(false)}
          hint="Scan a key QR or a wallet export"
        />
      </AppModal>
    </>
  );
}

function Row({
  title,
  sub,
  onPress,
  disabled,
  icon,
}: {
  title: string;
  sub: string;
  onPress?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}>
      {icon}
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, disabled && styles.rowTitleDisabled]}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      {!disabled && <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />}
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: theme.colors.scrim, justifyContent: 'flex-end' },
  glassTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: SHEET_FOOT,
    // Five found devices plus the instructions must scroll, not spill off
    // the top of the screen (decided 2026-08-31).
    maxHeight: '85%',
  },
  sheetScrollContent: { gap: theme.spacing.xs },
  // The buttons' gap, between the scroll area and the foot's buttons and
  // between them: the same foot as the vault builder's sheet.
  sheetFoot: { paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
  title: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.sm },
  intro: {
    ...theme.typography.body,
    color: theme.colors.slate,
    marginBottom: theme.spacing.sm,
  },
  // The steps are the instruction to act on now: body, in the primary text.
  step: {
    ...theme.typography.body,
    color: theme.colors.offWhite,
    marginBottom: theme.spacing.sm,
  },
  // A derivation path is a code: the mono token.
  pathHint: {
    ...theme.typography.mono,
    color: theme.colors.slate,
    marginBottom: theme.spacing.sm,
  },
  backLink: { paddingVertical: theme.spacing.md },
  backLinkText: { ...theme.typography.body, color: theme.colors.slate },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  // No `opacity` on a touchable (see DatePickerField): the row that cannot be
  // used says so with its title colour and by dropping its chevron.
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  rowTitleDisabled: { color: theme.colors.slate },
  rowSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 1 },
  pasteBlock: { marginTop: theme.spacing.md, gap: theme.spacing.md },
}));
