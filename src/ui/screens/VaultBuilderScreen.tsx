/**
 * Vault builder (Phase 2 groundwork): collect PUBLIC keys, set the policy
 * parameters, preview the resulting descriptor + spending paths, create the
 * vault watch-only. One screen serves all three shapes:
 *
 *   single    1 key                          → wpkh(...)
 *   multi     k of n keys                    → wsh(sortedmulti(...))
 *   timelock  primary k/n + recovery + lock  → wsh(or_d(...,and_v(...,older(N))))
 *
 * Keys arrive via Coldcard Generic-JSON file, QR (single or BBQr animated,
 * as the COLDCARD Q exports), or paste.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from '../components';
import { SUPPORT } from '../../config';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { landOverTab } from '../navigation/landOverTab';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import type { RootStackParamList } from '../navigation/types';
import { ArrowRightIcon, CloseIcon, AppDialog, BbqrScanner, Button, Card, ChoiceSheet, HeaderIconButton, InfoHeading, KeySlotRow, PencilIcon, PolicyOverview, TextField, GlassPanel, PageFooter, FOOTER_ROOM } from '../components';
import type { BbqrScanResult } from '../components';
import { isPassportScan } from '../hww/passportBinding';
import { bytesToUtf8 } from '../../bitcoin/bbqr';
import { pickTextFile } from '../../platform/files';
import { theme, themedStyles } from '../theme';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { AuthSheet, BookingSheet } from '../components';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import type { KeyPurpose } from '../components/hwwDevices';
import { useWallets, findDuplicateWallet, duplicateVaultMessage } from '../../wallet';
import { MAX_NAME_LENGTH } from '../../wallet';
import type { KeyDevice } from '../../wallet/types';
import { HardwareConnect } from '../components/HardwareConnect';
import type { StepBack } from '../components/HardwareConnect';
import { LEDGER_PREVIEW, PURCHASES_ENABLED, SIGNING_ENABLED } from '../../config';
import { STORE_COPY } from './storeCopy';
import { formatBlocksDuration } from '../../wallet/timelock';
import { MULTI_MIN_KEYS, multiThreshold as multiThresholdFor, thresholdChoices } from './multisigRules';
import {
  composeSinglesig,
  composeMultisig,
  composeLayeredVault,
  parseColdcardExport,
  parseKeyOrigins,
  normalizeBareKey,
  parsePolicy,
  validateForImport,
  BLOCKS_PER_MONTH,
  MAX_OLDER_BLOCKS,
} from '../../bitcoin/descriptor';
import type { KeyOrigin } from '../../bitcoin/descriptor';
import type { Network } from '../../bitcoin/descriptor/types';
import { testNetworkFor } from '../../bitcoin/network';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

type Props = NativeStackScreenProps<RootStackParamList, 'VaultBuilder'>;

/** 'primary' or a recovery-layer index (Liana-style: any number of layers). */
type Section = 'primary' | number;

interface RecoveryLayer {
  keys: KeyOrigin[];
  threshold: number;
  /** Coin-inactivity blocks before this layer opens. */
  blocks: number;
}

const MAX_RECOVERY_LAYERS = 5;

/** The add-key sheet's foot above the home indicator at rest. With the
 *  keyboard up the keys are the floor and the content sits one `md` above
 *  them, the pinned footer's measure (as KeyEntrySheet). */
const SHEET_FOOT = 40;

const TITLES = {
  single: 'Single-sig vault',
  multi: 'Multisig vault',
  timelock: 'Layered vault',
} as const;

const LOCK_PRESETS = [
  { label: '3 months', blocks: 3 * BLOCKS_PER_MONTH },
  { label: '6 months', blocks: 6 * BLOCKS_PER_MONTH },
  { label: '1 year', blocks: 12 * BLOCKS_PER_MONTH },
  { label: 'Max (≈15 mo)', blocks: MAX_OLDER_BLOCKS },
];

/** Space the key into 4-char groups (address-verification style read-back). */
function chunkKey(xpub: string): string {
  const groups = xpub.match(/.{1,4}/g) ?? [xpub];
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 6) {
    lines.push(groups.slice(i, i + 6).join(' '));
  }
  return lines.join('\n');
}

/** Paste/QR input → one key. Accepts xpub, zpub/ypub (converted), [origin]xpub. */
function parseKeyInput(text: string): { key: KeyOrigin; warnings: string[] } | null {
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
    return { key: { fingerprint: k.fingerprint, originPath: k.originPath, xpub: k.xpub }, warnings: [] };
  }
  return null;
}

export function VaultBuilderScreen({ navigation, route }: Props): React.JSX.Element {
  const kb = useKeyboardHeight();
  const { vaultType } = route.params;
  const { addWallet, settings, updateWallet, wallets } = useWallets();
  /** The key sheet's hardware step and its one Back (to the device list),
   *  while the step has one: the sheet's foot draws it (decided 2026-10-05). */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);

  const [name, setName] = useState('');
  const [primaryKeys, setPrimaryKeys] = useState<KeyOrigin[]>([]);
  const [primaryThreshold, setPrimaryThreshold] = useState(1);
  /** Multisig (decided 2026-09-21): at least three keys, and 2-of-N until the owner
   *  picks another number ("As soon as all three are added, make the default
   *  policy a 2/3. Let the user edit the policy as he adds more than 3 keys"). */
  const [pickedThreshold, setPickedThreshold] = useState<number | null>(null);
  const multiThreshold = multiThresholdFor(pickedThreshold, primaryKeys.length);
  /** Which section's "Signatures required" sheet is open. */
  const [thresholdSheet, setThresholdSheet] = useState<Section | null>(null);
  // Liana-parity: ANY number of timelocked recovery layers, each with its
  // own keys, threshold, and inactivity timelock.
  const [layers, setLayers] = useState<RecoveryLayer[]>([
    { keys: [], threshold: 1, blocks: 12 * BLOCKS_PER_MONTH },
  ]);
  const mutateLayer = (i: number, patch: Partial<RecoveryLayer>) =>
    setLayers((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Add-key sheet state: which section it feeds, and its paste/scan modes.
  const [addTarget, setAddTarget] = useState<Section | null>(null);
  // Which key the sheet is REPLACING, when it was opened by tapping a filled
  // row. Every opening goes through `openAdd`, so a stale one cannot survive
  // into the next add.
  const [replaceXpub, setReplaceXpub] = useState<string | null>(null);
  // "Book a meeting" is booked IN THE APP (decided 2026-07-27) — same scheduler as
  // support and rescue. Signing in is required first (the booking is made
  // in the client's name), so an unauthenticated tap opens the auth sheet
  // and the scheduler follows automatically.
  const [booking, setBooking] = useState(false);
  const [bookingSession, setBookingSession] = useState<CompanySession | null>(null);
  const [bookingAuthOpen, setBookingAuthOpen] = useState(false);
  const [bookedAt, setBookedAt] = useState<string | null>(null);
  // The field being typed in stays above the keyboard (decided 2026-09-18); the
  // page's buttons sit in the pinned footer, which rises on its own, so
  // only the field has to clear the footer's fade.
  const revealScrollRef = useRef<ScrollView | null>(null);
  const revealOffsetY = useRef(0);
  useRevealFocusedField(revealScrollRef, revealOffsetY, true, { confirmPinned: true });
  // The add-key sheet's own scroll view, so its paste field and Add key
  // come up above the keys as well.
  const sheetScrollRef = useRef<ScrollView | null>(null);
  const sheetOffsetY = useRef(0);
  useRevealFocusedField(sheetScrollRef, sheetOffsetY);

  const bookingToken = useMemo(() => {
    const m = /\/book-appointment\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i.exec(
      SUPPORT.scheduleCallUrl,
    );
    return m ? m[1] : null;
  }, []);
  const openBooking = async () => {
    const s = await loadSession();
    if (!s) {
      setBookingAuthOpen(true);
      return;
    }
    setBookingSession(s);
    if (bookingToken) setBooking(true);
    else void Linking.openURL(SUPPORT.scheduleCallUrl).catch(() => {});
  };
  /** 21st Capital's own fingerprints — a vault holding one must stay taproot. */
  const { providerFps: builderProviderFps, isProviderKey } = useProviderFingerprints(undefined);
  const guidePurpose: KeyPurpose = vaultType === 'single' ? 'single' : 'multisig';
  /** A plain one-key vault takes the BIP-84 native-segwit account — the
   *  standard among single-sig apps (BlueWallet, Sparrow) and what gives
   *  wallet discovery later. Taproot is for layered/multisig shapes, which
   *  use 48'/2' (decided 2026-07-27). */
  const builderAccount: 'bip84' | 'bip86' | 'bip48_2' =
    guidePurpose === 'multisig' ? 'bip48_2' : 'bip84';
  const [pasteOpen, setPasteOpen] = useState(false);
  /** Key fingerprints proven to live on a Ledger DURING this build — written
   *  to the vault as keyDevices after creation so Bluetooth actions light up
   *  without a separate linking step. */
  const bleBoundRef = useRef<Record<string, KeyDevice>>({});
  /** WHICH physical device (BLE id) each fetched key came from, so the
   *  search list can mark devices already spent on this build (decided
   *  2026-08-31). Session-only; never persisted. */
  const bleIdsRef = useRef<Record<string, string>>({});
  const usedDeviceIds = (): ReadonlySet<string> => {
    const placedFps = new Set(
      [...primaryKeys, ...layers.flatMap((l) => l.keys)]
        .map((k) => k.fingerprint?.toLowerCase())
        .filter((fp): fp is string => !!fp),
    );
    return new Set(
      Object.entries(bleIdsRef.current)
        .filter(([fp]) => placedFps.has(fp))
        .map(([, id]) => id),
    );
  };
  const [pasteText, setPasteText] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  // iOS cannot present the camera modal while the add-key sheet modal is
  // still up — the sheet must CLOSE first, so the scan target is remembered
  // separately from the sheet's own `addTarget`.
  const [scanTarget, setScanTarget] = useState<Section>('primary');
  // Pasted key awaiting the user's read-back confirmation.
  const [verifyKey, setVerifyKey] = useState<{
    target: Section;
    key: KeyOrigin;
    warnings: string[];
  } | null>(null);
  // MANDATORY key labels (decided 2026-07-18): every key gets a human name at add
  // time; the signing ceremony then talks in labels, never fingerprints.
  const [keyLabels, setKeyLabels] = useState<Record<string, string>>({});
  const [pendingLabel, setPendingLabel] = useState<{
    target: Section;
    key: KeyOrigin;
    warnings: string[];
  } | null>(null);
  /** What each device called itself when it handed its key over, by
   *  fingerprint, so the label prompt opens with it (decided 2026-09-09). */
  const deviceNamesRef = useRef<Record<string, string>>({});

  /** Close any open modal first (iOS can't stack them), then ask for a label. */
  const queueLabelPrompt = (target: Section, key: KeyOrigin, warnings: string[]) => {
    // A Passport is never bound to a vault built HERE (decided 2026-09-24: "the
    // app should not let the user create a layered vault that involves the
    // foundation passport ... make sure he cant accidently create one").
    //
    // This builder can still turn a one-key vault into a layered one on the
    // next step, and a Passport speaks standard scripts only. The device
    // list already leaves it out (`building`), so a Passport key cannot
    // arrive here at all; binding nothing is the second lock, and it fails
    // the safe way: an unbound key is watch only, never a vault that looks
    // signable and is not.
    const modalUp = addTarget != null;
    setAddTarget(null);
    setPasteOpen(false);
    setTimeout(() => setPendingLabel({ target, key, warnings }), modalUp ? 450 : 50);
  };

  const commitLabeledKey = (label: string) => {
    if (!pendingLabel) return;
    const fp = pendingLabel.key.fingerprint?.toLowerCase();
    if (fp) setKeyLabels((prev) => ({ ...prev, [fp]: label.trim() }));
    addKey(pendingLabel.target, pendingLabel.key, pendingLabel.warnings);
    setPendingLabel(null);
  };

  const keysOf = (s: Section) => (s === 'primary' ? primaryKeys : layers[s]?.keys ?? []);

  const addKey = (section: Section, key: KeyOrigin, warnings: string[] = []) => {
    setError(null);
    const all = [...primaryKeys, ...layers.flatMap((l) => l.keys)].filter(
      (k) => k.xpub !== replaceXpub,
    );
    if (all.some((k) => k.xpub === key.xpub)) {
      setError('That key is already part of this vault.');
      return;
    }
    if (vaultType === 'single' && section === 'primary' && primaryKeys.length >= 1 && !replaceXpub) {
      setError('A single-sig vault has exactly one key.');
      return;
    }
    // Replacing puts the new key where the old one stood, so the vault's key
    // order (and so its addresses) does not shuffle under the client.
    const put = (prev: KeyOrigin[]) =>
      replaceXpub ? prev.map((k) => (k.xpub === replaceXpub ? key : k)) : [...prev, key];
    if (section === 'primary') setPrimaryKeys(put);
    else setLayers((prev) => prev.map((l, j) => (j === section ? { ...l, keys: put(l.keys) } : l)));
    if (warnings.length > 0) setNotice(warnings.join('\n\n'));
    setReplaceXpub(null);
    setAddTarget(null);
    setPasteOpen(false);
    setPasteText('');
  };

  /**
   * THE one way the add-key sheet opens. Passing an xpub means the sheet is
   * replacing that key rather than adding beside it.
   */
  const openAdd = (section: Section, replacing?: string) => {
    setReplaceXpub(replacing ?? null);
    setAddTarget(section);
  };

  const removeKey = (section: Section, xpub: string) => {
    if (section === 'primary') {
      setPrimaryKeys((prev) => {
        const next = prev.filter((k) => k.xpub !== xpub);
        setPrimaryThreshold((t) => Math.max(1, Math.min(t, Math.max(1, next.length))));
        return next;
      });
    } else {
      setLayers((prev) =>
        prev.map((l, j) => {
          if (j !== section) return l;
          const keys = l.keys.filter((k) => k.xpub !== xpub);
          return { ...l, keys, threshold: Math.max(1, Math.min(l.threshold, Math.max(1, keys.length))) };
        }),
      );
    }
  };

  /** Coldcard Generic-JSON (file or BBQr from a Q) → the right account. */
  const addColdcardJson = (section: Section, content: string): boolean => {
    const cc = parseColdcardExport(content);
    if (!cc) return false;
    // Single-sig watches the BIP-84 native-segwit account (decided 2026-07-27);
    // multisig shapes use BIP-48/2' with NO fallback — a multi-key vault on
    // the wrong account is silently unsignable.
    const account =
      builderAccount === 'bip48_2'
        ? cc.bip48_2
        : builderAccount === 'bip84'
          ? cc.bip84 ?? cc.bip86
          : cc.bip86 ?? cc.bip84;
    if (!account) {
      setError('The export is missing the account this vault needs. Export the Generic JSON again.');
      setAddTarget(null);
      return true;
    }
    const warnings =
      vaultType !== 'single' && !cc.bip48_2
        ? ['This export had no multisig (BIP-48) account. Its BIP-84 key was used instead.']
        : [];
    queueLabelPrompt(
      section,
      { fingerprint: cc.fingerprint, originPath: account.originPath, xpub: account.xpub },
      warnings,
    );
    return true;
  };

  const onColdcardFile = async (section: Section) => {
    try {
      const file = await pickTextFile();
      if (!file) return;
      if (!addColdcardJson(section, file.content)) {
        setError("That file doesn't contain a usable key export.");
        setAddTarget(null);
      }
    } catch (e) {
      setError(`Could not read the file: ${(e as Error).message}`);
      setAddTarget(null);
    }
  };

  /** A key payload arrived (QR text or BBQr transfer). */
  const acceptKeyPayload = (target: Section, raw: string) => {
    const parsed = parseKeyInput(raw);
    if (parsed) {
      // A SHARED vault needs each key WITH its origin (fingerprint + the
      // BIP-48 path): without them the key cannot register on hardware or
      // sign later, and the bare-key importer's single-sig assumption
      // (BIP-84) is simply the wrong story here (decided 2026-08-26).
      if (guidePurpose === 'multisig' && (!parsed.key.fingerprint || !parsed.key.originPath)) {
        setError(
          'A shared vault needs each key together with its origin details. ' +
            'Connect over Bluetooth and Talia reads them from the device ' +
            "itself. You can also paste the full key that starts with " +
            "[fingerprint/48'/…].",
        );
        setAddTarget(null);
        return;
      }
      queueLabelPrompt(target, parsed.key, parsed.warnings);
      return;
    }
    if (addColdcardJson(target, raw)) return;
    setError("That doesn't contain a usable public key export.");
    setAddTarget(null);
  };

  /** A key arrived over Bluetooth: the Ledger read it itself — format it as
   *  the standard [fingerprint/path]xpub string and walk the SAME ritual as
   *  every other source (label prompt, dedupe, warnings). */
  /** The account the Bluetooth read asks the device for. */
  const builderBlePath = (): string => {
    const coin = (settings.defaultNetwork ?? 'bitcoin') === 'bitcoin' ? "0'" : "1'";
    return builderAccount === 'bip48_2'
      ? `48'/${coin}/0'/2'`
      : builderAccount === 'bip84'
        ? `84'/${coin}/0'`
        : `86'/${coin}/0'`;
  };

  const acceptBleKey = (
    target: Section,
    fingerprint: string,
    originPath: string,
    xpub: string,
    device: KeyDevice,
    deviceId: string,
    /** What the device calls itself, offered as the key's label. */
    deviceName?: string,
  ) => {
    bleBoundRef.current[fingerprint] = device;
    bleIdsRef.current[fingerprint.toLowerCase()] = deviceId;
    if (deviceName) deviceNamesRef.current[fingerprint.toLowerCase()] = deviceName;
    acceptKeyPayload(target, `[${fingerprint}/${originPath}]${xpub}`);
  };

  /** True only while a BC-UR scan is being accepted. */
  const passportScanRef = useRef(false);
  const onScanResult = (result: BbqrScanResult) => {
    setScanOpen(false);
    passportScanRef.current = isPassportScan(result);
    try {
      acceptKeyPayload(
        scanTarget,
        result.kind === 'text' ? result.text : bytesToUtf8(result.bytes),
      );
    } finally {
      passportScanRef.current = false;
    }
  };

  // Live preview: compose → validate → policy summary. Null until buildable.
  const preview = useMemo(() => {
    try {
      let descriptor: string;
      if (vaultType === 'single') {
        if (primaryKeys.length !== 1) return null;
        descriptor = composeSinglesig(primaryKeys[0]);
      } else if (vaultType === 'multi') {
        // No policy until the three keys are in (decided 2026-09-21).
        if (primaryKeys.length < MULTI_MIN_KEYS) return null;
        // This tab builds SELF-CUSTODIAL multisig, so it takes the industry
        // standard wsh(sortedmulti) that Sparrow, Nunchuk and the COLDCARD
        // read natively (decided 2026-07-28). If one of OUR keys was pasted in
        // anyway, the composer refuses wsh — a vault holding our key must be
        // taproot or we could not co-sign it — so fall back to taproot rather
        // than dead-ending the build.
        const ours = [...builderProviderFps].some((fp) =>
          primaryKeys.some((k) => k.fingerprint?.toLowerCase() === fp),
        );
        descriptor = composeMultisig(multiThreshold, primaryKeys, {
          script: ours ? 'tr' : 'wsh',
          providerFingerprints: builderProviderFps,
        });
      } else {
        if (primaryKeys.length < 1 || layers.some((l) => l.keys.length < 1)) return null;
        descriptor = composeLayeredVault(
          { threshold: primaryThreshold, keys: primaryKeys },
          layers.map((l) => ({ threshold: l.threshold, keys: l.keys, olderBlocks: l.blocks })),
        );
      }
      const policy = parsePolicy(descriptor);
      return { descriptor, policy };
    } catch (e) {
      return { descriptor: null as string | null, policy: null, issue: (e as Error).message };
    }
  }, [vaultType, primaryKeys, primaryThreshold, multiThreshold, layers]);

  // 2-of-2 has no redundancy: lose either key and the funds are gone forever.
  // Not allowed on the traditional multisig tab (decided 2026-07-21) — for a
  // both-keys-required setup use the layered vault, which forces a rescue key.
  const twoOfTwoBlocked =
    vaultType === 'multi' && primaryKeys.length === 2 && primaryThreshold === 2;

  const onCreate = async () => {
    if (!preview?.descriptor || !name.trim() || twoOfTwoBlocked) return;
    setError(null);
    setCreating(true);
    try {
      // Mainnet keys → mainnet; test keys (tpub…) → Testnet4, the one test
      // network Talia offers.
      const detected = validateForImport(preview.descriptor, {});
      const net: Network =
        detected.ok && detected.network !== 'bitcoin' ? testNetworkFor(settings.defaultNetwork) : 'bitcoin';
      const validated = validateForImport(preview.descriptor, { network: net });
      if (!validated.ok) throw new Error(validated.message);
      const dup = findDuplicateWallet(validated.parsed.raw, wallets);
      if (dup) throw new Error(duplicateVaultMessage(dup));
      const wallet = await addWallet({
        label: name.trim(),
        descriptor: validated.parsed.raw,
        network: validated.network,
        kind: validated.parsed.kind,
        source: validated.source,
        transport: 'created',
        // No category at creation (decided 2026-09-09): a vault's section
        // follows its own shape, and a stored label means the owner chose
        // one on the Arrange screen.
        keyLabels,
      });
      // Keys fetched over Bluetooth carry proof of WHICH Ledger holds them —
      // persist the binding so Send/address checks light up immediately.
      // Compared against PARSED key fingerprints — never substring-scan a
      // descriptor: hex fits inside base58, so an 8-char scan can match
      // xpub payload (the repo's standing base58 rule).
      const finalFps = new Set(
        parseKeyOrigins(validated.parsed.raw).flatMap((k) =>
          k.fingerprint ? [k.fingerprint.toLowerCase()] : [],
        ),
      );
      const bleBound = Object.fromEntries(
        Object.entries(bleBoundRef.current).filter(([fp]) => finalFps.has(fp)),
      );
      if (Object.keys(bleBound).length > 0) {
        await updateWallet(wallet.id, { keyDevices: bleBound });
      }
      // Land on "Vault built" (decided 2026-10-02, design B at pace B2), with the
      // new vault directly beneath it and Home beneath that: back must go to
      // the wallet list, not the creation wizard (decided 2026-07-18). The page's
      // button takes the next step: a vault every device must learn first
      // (several keys, or a timelock) goes on to Register on your hardware,
      // one device at a time, whatever brand each one is; a plain single key
      // opens the vault (VaultBuiltScreen decides, with the vault page's own
      // rule).
      landOverTab('VaultsTab', [
        { name: 'WalletDetail', params: { walletId: wallet.id } },
        { name: 'VaultBuilt', params: { walletId: wallet.id } },
      ]);
    } catch (e) {
      setError(`Could not create the vault: ${(e as Error).message}`);
      setCreating(false);
    }
  };

  const sections: Section[] =
    vaultType === 'timelock' ? ['primary', ...layers.map((_, i) => i)] : ['primary'];

  // The 2-of-3 pitch routes into the configurator, which only exists under
  // the full signing surface: a dead button under the preview would be worse
  // than no pitch. And it is gone once the first key is in (decided 2026-10-05).
  const offerCosign = (SIGNING_ENABLED || LEDGER_PREVIEW) && vaultType === 'multi' && primaryKeys.length === 0;

  return (
    <View style={styles.root}>
    <ScrollView
      ref={revealScrollRef}
      onScroll={(e) => {
        revealOffsetY.current = e.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={32}
      style={styles.fill}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // No keyboard inset: the footer's own rise shortens the scroll area by
      // the keyboard, and an inset on top of it would leave a keyboard's
      // worth of blank under the last row.
      keyboardDismissMode="on-drag">
      <TextField
        label="Vault name (required)"
        value={name}
        onChangeText={setName}
        placeholder={vaultType === 'timelock' ? 'e.g. Family vault' : 'e.g. Cold savings'}
        autoCapitalize="sentences"
        maxLength={MAX_NAME_LENGTH}
        hint={name.length >= MAX_NAME_LENGTH ? `Up to ${MAX_NAME_LENGTH} characters` : undefined}
      />

      {sections.map((section) => {
        const keys = keysOf(section);
        const layer = section === 'primary' ? null : layers[section];
        const multiPrimary = section === 'primary' && vaultType === 'multi';
        const threshold = multiPrimary
          ? multiThreshold
          : section === 'primary'
            ? primaryThreshold
            : layer?.threshold ?? 1;
        const showThreshold = multiPrimary
          ? keys.length >= MULTI_MIN_KEYS
          : keys.length >= 2 && vaultType === 'timelock';
        // Empty slots up to the three a multisig needs, so the owner sees how
        // many keys to bring (decided 2026-09-21: "Show space for 3 keys").
        const emptySlots = multiPrimary ? Math.max(0, MULTI_MIN_KEYS - keys.length) : 0;
        return (
          <Card key={String(section)} style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, styles.sectionHeadTitle]}>
                {vaultType === 'timelock'
                  ? section === 'primary'
                    ? 'PRIMARY KEYS · SPEND ANYTIME'
                    : `RECOVERY LAYER ${section + 1} · AFTER ITS TIMELOCK`
                  : vaultType === 'multi'
                    ? 'VAULT KEYS'
                    : 'VAULT KEY'}
              </Text>
              {layer != null && layers.length > 1 && (
                <TouchableOpacity
                  onPress={() => setLayers((prev) => prev.filter((_, j) => j !== section))}
                  accessibilityLabel="Remove this layer"
                  style={styles.keyRemove}>
                  <CloseIcon size={18} strokeWidth={2.5} color={theme.colors.negative} />
                </TouchableOpacity>
              )}
            </View>

            {/* The app's ONE key container (decided 2026-09-26: "Please match
                the key container to our new key container standard we
                chose"). The row is the control and a tap CHANGES the key,
                as on the vault wizard's key step; taking a key out is the
                sheet's own last row, so a stray tap can never drop one. */}
            {keys.map((k, i) => (
              <KeySlotRow
                key={k.xpub}
                name={(k.fingerprint && keyLabels[k.fingerprint.toLowerCase()]) || `Key ${i + 1}`}
                trailing={k.fingerprint ?? 'no origin'}
                filled
                onPress={() => openAdd(section, k.xpub)}
                accessibilityLabel={`Replace key ${i + 1}`}
              />
            ))}

            {Array.from({ length: emptySlots }, (_, i) => (
              <KeySlotRow
                key={`slot-${i}`}
                name={`Key ${keys.length + i + 1}`}
                addable
                onPress={() => openAdd(section)}
                accessibilityLabel={`Add key ${keys.length + i + 1}`}
              />
            ))}

            {emptySlots === 0 && (vaultType !== 'single' || section !== 'primary' || keys.length < 1) && (
              <Button
                title={keys.length === 0 ? 'Add a key' : 'Add another key'}
                variant="ghost"
                onPress={() => openAdd(section)}
              />
            )}

            {/* How many must sign: a pencil opens the choice. Never a + and
                a −, which read as adding or removing key spaces (decided
                2026-09-21). */}
            {showThreshold && (
              <TouchableOpacity
                style={styles.thresholdRow}
                activeOpacity={0.8}
                onPress={() => setThresholdSheet(section)}
                accessibilityLabel="Change how many signatures are required">
                <Text style={styles.thresholdLabel}>
                  Signatures required: {threshold} of {keys.length}
                </Text>
                <HeaderIconButton label="Change how many signatures are required" onPress={() => setThresholdSheet(section)}>
                  <PencilIcon size={20} color={theme.colors.offWhite} />
                </HeaderIconButton>
              </TouchableOpacity>
            )}


            {layer != null && (
              <>
                <InfoHeading
                  title="How the wait is counted"
                  text="Every coin has its own clock, and moving or refreshing a coin starts it again, so this layer opens only for a coin left untouched that long."
                  style={styles.lockLabel}>
                  This layer opens after
                </InfoHeading>
                <View style={styles.lockRow}>
                  {LOCK_PRESETS.map((pr) => (
                    <TouchableOpacity
                      key={pr.blocks}
                      style={[styles.lockChip, layer.blocks === pr.blocks && styles.lockChipOn]}
                      onPress={() => mutateLayer(section as number, { blocks: pr.blocks })}>
                      <Text
                        style={[
                          styles.lockChipText,
                          layer.blocks === pr.blocks && styles.lockChipTextOn,
                        ]}>
                        {pr.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.lockHint}>
                  ≈ {formatBlocksDuration(layer.blocks)} ({layer.blocks.toLocaleString('en-US')}{' '}
                  blocks) of untouched coins.
                </Text>
              </>
            )}
          </Card>
        );
      })}

      {vaultType === 'timelock' && layers.length < MAX_RECOVERY_LAYERS && (
        <Button
          title="Add another recovery layer"
          variant="ghost"
          onPress={() =>
            setLayers((prev) => [
              ...prev,
              { keys: [], threshold: 1, blocks: Math.min(MAX_OLDER_BLOCKS, (prev.length + 2) * 6 * BLOCKS_PER_MONTH) },
            ])
          }
        />
      )}

      {/* A 2-of-2 is warned about once, in red inside the keys card (decided
          2026-09-21: "the text warning for a 2/2 is repeated! one warning
          message is enough"). */}
      {!twoOfTwoBlocked && preview && 'issue' in preview && preview.issue ? (
        <Text style={styles.errorText}>{preview.issue}</Text>
      ) : null}

      {/* The spending policy as the configurator's last page and the
          Spending policy screen draw it, not bullets over the raw descriptor
          (decided 2026-09-21). */}
      {preview?.descriptor && preview.policy && (
        <PolicyOverview
          wallet={{ label: name.trim() || 'New vault', descriptor: preview.descriptor, keyLabels }}
          isProviderKey={isProviderKey}
        />
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Text style={styles.footnote}>
        The vault is watch-only. Your keys never leave your hardware.
      </Text>

      {/* At the bottom of the screen, under the self-held builder (decided
          2026-09-21: "move Vault Keys to the top and put the 2/3 with 21st
          Capital question down that screen").
          21st Capital co-signer (decided 2026-07-21): the traditional multisig tab
          now offers a 2-of-3 where 21C holds one key — set up through the
          same activation as a layered vault (Premium). A "customized
          configuration" books a meeting for anything else. Adding your own keys
          below stays available for a fully self-held multisig. Its button
          stays in the card, beside the words that explain it (decided 2026-10-05:
          "move the 2-of-3 offer button back into its card"); the pinned
          footer holds Create alone. */}
      {/* Gone once the first key is in (decided 2026-10-05: "Once the user has
          added one key in the self custody multisig wizard, please do not
          show the container with the 21st capital promotion"): he has
          decided, and the page must not crowd the Create button. */}
      {offerCosign && (
        <Card style={styles.coSignerCard}>
          <InfoHeading
            title="21st Capital co-signing"
            text={
              // The builds that sell nothing leave out the plan sentence.
              PURCHASES_ENABLED
                ? 'You hold two of the three keys, so your own two can always spend without us. We hold the third and co-sign when you need us. It runs on the same Premium plan and activation as a layered vault.'
                : STORE_COPY.coSignInfo
            }
            style={styles.coSignerTitle}>
            Want 21st Capital to co-sign?
          </InfoHeading>
          <Text style={styles.coSignerBody}>
            A 2-of-3 vault: you hold two keys, we hold one. Any two signatures
            spend.
          </Text>
          <Button
            title="Set up a 2-of-3 with 21st Capital"
            // The client just chose a 2-of-3 with us, so the configurator
            // opens on its key step with that scheme picked (and 21st
            // Capital holding the third key, its default) instead of asking
            // again on step 1 (reported 2026-09-21: "he has to make that choice
            // twice").
            onPress={() => navigation.navigate('LayeredVault', { scheme: 'multi-2-3' })}
          />
          <TouchableOpacity
            onPress={() => void openBooking()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.coSignerLinkRow}>
            <Text style={styles.coSignerLink}>Need help? Book a meeting</Text>
            <ArrowRightIcon size={16} strokeWidth={2.5} color={theme.colors.accentText} />
          </TouchableOpacity>
        </Card>
      )}

      <ChoiceSheet
        visible={thresholdSheet !== null}
        title="Signatures required"
        options={(() => {
          const n = thresholdSheet === null ? 0 : keysOf(thresholdSheet).length;
          // A plain multisig never offers every key (multisigRules); a
          // timelocked layer may, its recovery path being the spare.
          const counts =
            thresholdSheet === 'primary' && vaultType === 'multi'
              ? thresholdChoices(n)
              : Array.from({ length: n }, (_, i) => i + 1);
          return counts.map((t) => ({ value: String(t), label: `${t} of ${n}` }));
        })()}
        value={
          thresholdSheet === null
            ? undefined
            : String(
                thresholdSheet === 'primary'
                  ? vaultType === 'multi'
                    ? multiThreshold
                    : primaryThreshold
                  : layers[thresholdSheet]?.threshold ?? 1,
              )
        }
        onPick={(v) => {
          const t = Number(v);
          if (thresholdSheet === 'primary') {
            if (vaultType === 'multi') setPickedThreshold(t);
            else setPrimaryThreshold(t);
          } else if (thresholdSheet !== null) {
            mutateLayer(thresholdSheet, { threshold: t });
          }
          setThresholdSheet(null);
        }}
        onClose={() => setThresholdSheet(null)}
      />

      <AuthSheet
        visible={bookingAuthOpen}
        onClose={() => setBookingAuthOpen(false)}
        onAuthed={(s) => {
          setBookingAuthOpen(false);
          setBookingSession(s);
          // Let the auth sheet finish dismissing before the next modal.
          setTimeout(() => {
            if (bookingToken) setBooking(true);
            else void Linking.openURL(SUPPORT.scheduleCallUrl).catch(() => {});
          }, 350);
        }}
      />
      <BookingSheet
        visible={booking}
        token={bookingToken ?? ''}
        title="Talk to 21st Capital"
        subtitle="Tell us what your setup needs. We'll design it with you."
        contact={{
          firstName:
            bookingSession?.firstName || (bookingSession?.email ?? '').split('@')[0] || 'Talia',
          lastName: bookingSession?.lastName || '(Talia app)',
          email: bookingSession?.email ?? '',
        }}
        details="Custom vault configuration meeting (booked in the Talia app)"
        onClose={() => setBooking(false)}
        onBooked={(iso) => {
          setBooking(false);
          setBookedAt(iso);
        }}
      />
      {!!bookedAt && (
        <Text style={styles.footnote}>
          Your meeting is booked for {new Date(bookedAt).toLocaleString()}. We'll
          email you the details.
        </Text>
      )}

      {/* Add-key sheet. Row order as decided: QR, paste, file. The keyboard's
          height is padding inside the sheet, which keeps the paste field
          above the keys while the glass runs on behind them. */}
      <AppModal
        visible={addTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setAddTarget(null);
          setReplaceXpub(null);
        }}>
        {/* The sheet stays on the bottom of the screen and its OWN glass runs on
   behind the keyboard (reported 2026-09-21: "sharp edges at the corner of the
   lower part of the screen every time the keyboard is active"). A
   KeyboardAvoidingView lifted the whole sheet, so its square bottom edge
   sat on the keyboard's rounded corners. The keyboard's height is padding
   INSIDE the sheet instead, the way the Send screen's Priority sheet does. */}
        <View style={styles.sheetKav}>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            activeOpacity={1}
            onPress={() => {
              setAddTarget(null);
              setReplaceXpub(null);
            }}>
            <TouchableOpacity activeOpacity={1} style={[styles.sheet, kb > 0 && { paddingBottom: theme.spacing.md + kb }]}>
              {/* The same glass, tint and finish as every other sheet: this
                  one had only a translucent ground (decided 2026-09-14). */}
              <GlassPanel style={StyleSheet.absoluteFill} radius={theme.radius.lg} />
              <ScrollView
                ref={sheetScrollRef}
                onScroll={(e) => {
                  sheetOffsetY.current = e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={32}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.sheetScrollContent}>
              {/* Which device will hold this key, first (decided 2026-10-04): the
                  registry's list, then the search with that device drawn
                  turning on and unlocking. Building keeps to devices Talia can
                  come back to, a Ledger or a BitBox, because this vault can
                  still gain a rescue key or a timelocked heir key on the next
                  step (decided 2026-09-24): no "Another device" here. */}
              <HardwareConnect
                key={addTarget ?? 'none'}
                shape={guidePurpose === 'multisig' ? 'multi' : 'single'}
                purpose="build"
                network={settings.defaultNetwork ?? 'bitcoin'}
                keys={[]}
                question="Which device will hold this key?"
                intro="We'll show you where to find it on your device. Talia only ever needs the PUBLIC key, never your seed words."
                usedDeviceIds={usedDeviceIds()}
                onFooterBack={setStepBack}
                deviceTask={async (device) => {
                  const path = builderBlePath();
                  device.setStep(`Reading the key from the ${device.brandName}…`);
                  const xpub = await device.xpub(path, settings.defaultNetwork ?? 'bitcoin');
                  if (!device.alive()) return;
                  acceptBleKey(addTarget ?? 'primary', device.fingerprint, path, xpub, device.record, device.deviceId, device.name);
                }}
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
                      // Pasted keys get a read-back check (same ritual as
                      // addresses) before they enter the vault. The sheet
                      // modal must close before the dialog can present.
                      if (parsed) {
                        const target = addTarget ?? 'primary';
                        setAddTarget(null);
                        setPasteOpen(false);
                        setTimeout(
                          () =>
                            setVerifyKey({
                              target,
                              key: parsed.key,
                              warnings: parsed.warnings,
                            }),
                          450,
                        );
                      }
                    }}
                  />
                </View>
              )}
              </ScrollView>
              {(replaceXpub != null || stepBack != null) && (
                // The sheet's foot (decided 2026-10-05: every button at the bottom),
                // under the scroll area so it never scrolls away or slides with
                // the step. Taking a key out lives here, not on the row (decided
                // 2026-09-26: the key container carries no ✕); it is reached
                // only by tapping the key itself, so it takes two deliberate
                // taps. A sheet action, so it sits at the sheet's foot, over the
                // step's one Back (decided 2026-10-05: it sat mid-sheet under the
                // device drawing, stacked over the foot's Back).
                <View style={styles.sheetFoot}>
                  {replaceXpub != null && (
                    <Button
                      title="Remove this key"
                      variant="ghost"
                      onPress={() => {
                        const target = addTarget ?? 'primary';
                        const xpub = replaceXpub;
                        setAddTarget(null);
                        setReplaceXpub(null);
                        removeKey(target, xpub);
                      }}
                    />
                  )}
                  {stepBack != null && <Button title="Back" variant="ghost" onPress={stepBack.onPress} />}
                </View>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </View>
      </AppModal>

      {/* Pasted-key read-back: fingerprint + full key, confirm before adding. */}
      <AppDialog
        visible={verifyKey !== null}
        title="Verify this key"
        message={
          verifyKey
            ? `Fingerprint  ${(verifyKey.key.fingerprint ?? 'unknown').toUpperCase()}\n` +
              (verifyKey.key.originPath ? `Path  ${verifyKey.key.originPath}\n` : '') +
              `\n${chunkKey(verifyKey.key.xpub)}\n\nCompare it against the source before adding.`
            : ''
        }
        actions={[
          {
            label: 'It matches, add key',
            variant: 'primary',
            onPress: () => {
              if (verifyKey) {
                const v = verifyKey;
                setTimeout(() => setPendingLabel(v), 450);
              }
              setVerifyKey(null);
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setVerifyKey(null) },
        ]}
        onClose={() => setVerifyKey(null)}
      />

      {/* Mandatory label: the ceremony speaks in these names, not hex. */}
      <AppDialog
        visible={pendingLabel !== null}
        title="Name this key"
        message={
          pendingLabel
            ? `Fingerprint ${(pendingLabel.key.fingerprint ?? 'unknown').toUpperCase()}. Pick a name you'll recognise when signing, like "Office device" or "Toni's device".`
            : ''
        }
        input={{
          label: 'Key label (required)',
          placeholder: 'e.g. Office device',
          autoCapitalize: 'sentences',
          defaultValue: pendingLabel?.key.fingerprint
            ? (deviceNamesRef.current[pendingLabel.key.fingerprint.toLowerCase()] ?? '')
            : '',
        }}
        actions={[
          {
            label: 'Save key',
            variant: 'primary',
            requiresInput: true,
            onPress: (label) => commitLabeledKey(label),
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setPendingLabel(null) },
        ]}
        onClose={() => setPendingLabel(null)}
      />

      {/* Key QR scanner — BBQr-aware (a COLDCARD Q exports its wallet JSON
          as an animated BBQr). */}
      <AppModal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <BbqrScanner
          onComplete={onScanResult}
          onCancel={() => setScanOpen(false)}
          hint="Scan a key QR or a wallet export"
        />
      </AppModal>

      <AppDialog
        visible={notice !== null}
        title="Heads up"
        message={notice ?? ''}
        actions={[{ label: 'OK', onPress: () => {} }]}
        onClose={() => setNotice(null)}
      />
    </ScrollView>
    {/* The page's action, pinned at the foot (decided 2026-10-05). The 2-of-3
        offer's button lives in its card with the words that explain it. */}
    <PageFooter>
      <Button
        title={creating ? 'Creating…' : 'Create watch-only vault'}
        variant="accent"
        onPress={() => void onCreate()}
        disabled={!preview?.descriptor || !name.trim() || creating || twoOfTwoBlocked}
        loading={creating}
      />
    </PageFooter>
    </View>
  );
}


const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  // The page gutter every page has; the content ends at the pinned
  // footer's fade, not the page's edge.
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: FOOTER_ROOM },

  sectionCard: { gap: theme.spacing.md },
  coSignerCard: { gap: theme.spacing.sm, borderColor: theme.colors.accent, borderWidth: 1 },
  coSignerTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  coSignerBody: { ...theme.typography.body, color: theme.colors.slate },
  // The link and its drawn arrow on one line (the → glyph retired).
  coSignerLinkRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingVertical: theme.spacing.xs },
  coSignerLink: { ...theme.typography.label, color: theme.colors.accentText },
  sectionHead: {
    flexDirection: 'row',
    // A long ALL-CAPS layer title must WRAP and keep the ✕ on its first
    // line, never run past the card's right edge.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  sectionHeadTitle: { flex: 1 },
  lockLabel: {
    ...theme.typography.label,
    color: theme.colors.slate,
    marginTop: theme.spacing.sm,
  },
  sectionTitle: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.1 },

  keyRemove: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },

  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  thresholdLabel: { ...theme.typography.body, color: theme.colors.offWhite },

  lockRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  lockChip: {
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surfaceRaised,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  lockChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  lockChipText: { ...theme.typography.body, color: theme.colors.offWhite },
  lockChipTextOn: { ...theme.typography.bodyStrong, color: theme.colors.accentInk },
  lockHint: { ...theme.typography.caption, color: theme.colors.slate },

  errorText: { ...theme.typography.body, color: theme.colors.negative },
  footnote: {
    ...theme.typography.caption,
    color: theme.colors.faint,
  },

  sheetKav: { flex: 1 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: SHEET_FOOT,
    // Five found devices plus the guide must scroll, not spill off the top
    // of a bottom-anchored sheet (decided 2026-08-31, same fix as KeyEntrySheet).
    maxHeight: '85%',
    borderTopWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
  },
  sheetScrollContent: { gap: theme.spacing.xs },
  // The buttons' gap, between the scroll area and the foot's buttons and
  // between them (Remove this key over the Back): the same foot as the key
  // sheet's.
  sheetFoot: { paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
  pasteBlock: { marginTop: theme.spacing.md, gap: theme.spacing.md },
}));
