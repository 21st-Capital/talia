/**
 * Add an existing vault.
 *
 * Redesigned 2026-09-08 ("a lot of things can go wrong during the
 * import and its hard for users to know what works and what doesnt"). The
 * screen asks before it takes anything:
 *
 *   1. Single-sig, or multisig? (the creation screen's own two words)
 *   2. (single key) Which product holds it: a hardware wallet (Ledger,
 *      BitBox, Foundation Passport) or a wallet app (Sparrow, BlueWallet,
 *      Electrum, another Talia)?
 *   3. That product's exact steps, and only the ways in it has.
 *
 * Each step is a push of this same route with more params, so back walks
 * the questions in reverse. A vault imported FROM a hardware wallet is
 * already connected (the device proved the key); one from a wallet app is
 * asked which device signs for it afterwards. A multisig vault takes the
 * three ways in it always had (QR, file, paste) with the texts made true:
 * Liana exports a file, Talia and Sparrow show a moving QR, and a single
 * xpub is never enough.
 *
 * The 2026-07-19 rules still hold: no Validate button, input validates the
 * moment it arrives, and a short dialog wizard collects the vault name and
 * key names. A payload from the global scanner (`prefill`) skips the
 * questions.
 */
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal, Gloss, GoldChip, cardGlow } from '../components';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { landOverTab } from '../navigation/landOverTab';
import type { RootStackParamList } from '../navigation/types';
import {
  Screen,
  Button,
  Card,
  TextField,
  AppDialog,
  AuthSheet,
  ChevronRightIcon,
  ClipboardIcon,
  DevicePicker,
  FileIcon,
  ScanIcon,
  ProviderTile,
  StepList,
} from '../components';
import { loadSession } from '../../services/companyAuth';
import { fetchKnown21CFingerprints } from '../../services/providerKeys';
import { theme, themedStyles } from '../theme';
import {
  validateForImport,
  extractImportPayload,
  unsupportedWalletFileReason,
  parsePolicy,
  composeSinglesig,
} from '../../bitcoin/descriptor';
import type { ValidationOk } from '../../bitcoin/descriptor';
import type { Network } from '../../bitcoin/descriptor/types';
import { testNetworkFor } from '../../bitcoin/network';
import { BbqrScanner, InfoHeading } from '../components';
import { base64 as b64codec } from '@scure/base';
import {
  importedVaultPatch,
  openBackup,
  parseBackup,
  parseTaliaVaultExport,
  readSealedBackup,
  taliaExportDescriptorText,
} from '../../wallet';
import type { TaliaVaultExport } from '../../wallet';
import { MAX_NAME_LENGTH, addTxNotes, defaultKeyNames } from '../../wallet';
import { isZip, unzip } from '../../wallet/zipArchive';
import { HWW_ENABLED, SIGNING_ENABLED } from '../../config';
import type { BbqrScanResult } from '../components';
import { isPassportScan } from '../hww/passportBinding';
import { bytesToUtf8 } from '../../bitcoin/bbqr';
import { pickBinaryFile } from '../../platform/files';
import { readClipboard } from '../../platform/clipboard';
import { useWallets, findDuplicateWallet, duplicateVaultMessage, uniqueVaultName } from '../../wallet';
import type { KeyDevice } from '../../wallet/types';
import type { ImportTransport } from '../../bitcoin/descriptor/types';
import { HardwareConnect } from '../components/HardwareConnect';
import type { StepBack } from '../components/HardwareConnect';
import { ProductGrid, PRODUCT_MARK_SIZE } from '../components/ProductGrid';
import { deviceName, deviceSuitsVault, modelInfo, modelName } from '../../wallet/deviceKinds';
import { importKindMismatch, importProvider, providerVariant, providersFor } from './importProviders';
import type { ImportProviderInfo } from './importProviders';

type Props = NativeStackScreenProps<RootStackParamList, 'Import'>;

/** The dialog wizard's current step. */
// One question, the vault's name (decided 2026-09-26: the keys are named Key 1,
// Key 2 and a device names its own key when the vault is registered on it;
// before that, "99% of people do not know which fingerprint belongs to which
// device"). No "Show under" step either (decided 2026-09-07): the vault lands
// under Other and moves on the Arrange screen.
type Wizard = { step: 'name' };

/** What the screen shows, decided by the route's params. */
type Stage = 'kind' | 'providers' | 'input';

/** The device that just proved the vault's key over Bluetooth. */
interface DeviceBinding {
  fingerprint: string;
  device: KeyDevice;
}

export function ImportScreen({ navigation, route }: Props): React.JSX.Element {
  const { addWallet, updateWallet, settings, wallets } = useWallets();
  const prefill = route.params?.prefill;
  const kind = route.params?.kind;
  const provider: ImportProviderInfo | null = route.params?.provider
    ? importProvider(route.params.provider)
    : null;
  /** The device picked in the hardware list (decided 2026-10-04, device first). */
  const model = route.params?.model ?? null;
  const stage: Stage = prefill
    ? 'input'
    : !kind
      ? 'kind'
      : !provider
        ? 'providers'
        : 'input';
  /** The kind the user chose; a scanner payload made no promise. */
  const expectedKind = prefill ? undefined : kind;
  /** What that product offers for THIS shape: its steps, its ways in, its
   *  own words for the paste field. */
  const variant = provider ? providerVariant(provider, kind ?? 'single') : null;

  const title =
    stage === 'kind'
      ? 'Add existing vault'
      : stage === 'providers'
        ? kind === 'multi'
          ? 'Multisig'
          : 'Single-sig'
        : provider
          ? model
            ? modelName(model)
            : provider.name
          : kind === 'multi'
            ? 'Multisig'
            : 'Add existing vault';
  React.useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const [descriptor, setDescriptor] = useState(prefill ?? '');
  // Mainnet keys always land on mainnet. Test keys (tpub…) land on Testnet4,
  // the one test network Talia offers.
  const network: Network = testNetworkFor(settings.defaultNetwork);
  const resolveNetwork = (payload: string): Network | undefined => {
    const detected = validateForImport(payload, {});
    if (!detected.ok) return undefined;
    return detected.network === 'bitcoin' ? 'bitcoin' : network;
  };
  const [transport, setTransport] = useState<ImportTransport>('paste');
  const [scanning, setScanning] = useState(false);
  /** A sealed backup waiting for one of its own keys (decided 2026-08-29). */
  const [sealed, setSealed] = useState<Uint8Array | null>(null);
  const [unlockKey, setUnlockKey] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [ledgerUnlock, setLedgerUnlock] = useState(false);
  const [validatedState, setValidated] = useState<ValidationOk | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  /** Key names the SOURCE knew, by lowercase fingerprint. Sparrow's
   *  "Electrum" export carries the device each key lives on (decided
   *  2026-09-09), which beats asking the owner to invent "Key 2", and
   *  Liana's wallet backup the name each key has there (decided 2026-11-05). */
  const sourceKeyLabelsRef = React.useRef<Record<string, string>>({});
  /** Transaction notes the source carried, by transaction id: Liana's
   *  wallet backup holds its labels (decided 2026-11-05). Written as the new
   *  vault's own notes once it is saved. */
  const sourceTxNotesRef = React.useRef<Record<string, string>>({});
  /** What another Talia's export says beyond the descriptor: the vault's
   *  name, its key names, which device holds each key and what those
   *  devices returned at registration (decided 2026-09-15). Null otherwise. */
  const taliaMetaRef = React.useRef<TaliaVaultExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** The name the DEVICE gave itself. A vault imported from hardware is
   *  named after it instead of asking (decided 2026-09-09: "he can always
   *  change that later"); only a wallet app's import still asks. Refs, not
   *  state: both are set in the same tick that starts the validation whose
   *  callback reads them. */
  const autoNameRef = React.useRef<string | null>(null);
  const deviceBindingRef = React.useRef<DeviceBinding | null>(null);
  /** The device whose key just opened an encrypted backup: it proved it
   *  holds that key, so the vault records it like any device read. */
  const unlockDeviceRef = React.useRef<DeviceBinding | null>(null);
  /** The key arrived as a BC-UR scan with the Passport chosen. */
  const passportScanRef = React.useRef(false);
  /** Set when a device just read the key: the vault is bound to it at
   *  creation and never asked to connect (decided 2026-09-08). */
  const [deviceBindingState, setDeviceBinding] = useState<DeviceBinding | null>(null);
  /** The Bluetooth search is up (hardware providers start it at once). */
  const [bleOpen, setBleOpen] = useState(
    provider != null && (providerVariant(provider, kind ?? 'single')?.methods.includes('ble') ?? false),
  );
  /** The hardware step's one Back (to its device list), while the step has
   *  one, from whichever of this page's two steps mounts it (a product's
   *  search, a locked backup's): the page's footer draws it (decided 2026-10-05). */
  const [stepBack, setStepBack] = useState<StepBack | null>(null);

  // Wizard-collected answers.
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [label, setLabel] = useState('');

  // 21C detection (decided 2026-07-23): if an imported descriptor carries one of our
  // keys, offer to connect the account (login) or skip (self-custodial). The
  // matched fingerprints tag the vault either way, for later re-connect.
  const [matched21CState, setMatched21C] = useState<string[]>([]);
  const [connectPrompt, setConnectPrompt] = useState(false);
  /** A taproot vault whose internal key is not proven unspendable: one key
   *  spends it alone (decided 2026-09-26). Asked before anything
   *  else happens; the ref survives AppDialog's onClose-before-onPress. */
  const [keyPathAsk, setKeyPathAsk] = useState(false);
  const keyPathPendingRef = React.useRef<{ result: ValidationOk; fromModal: boolean } | null>(null);
  /** The validation the client said "Import anyway" to. The "Add this
   *  vault" button asks again for any other (decided 2026-09-26: it
   *  used to continue past an unanswered question). */
  const keyPathAcceptedRef = React.useRef<ValidationOk | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  // AppDialog fires onClose BEFORE an action's onPress, so the connect dialog's
  // onClose schedules the name wizard even when the user chose "Log in". Keep
  // the timer cancelable so the Log in action can call it off (else the wizard
  // would stack on top of the sign-in sheet).
  const wizardTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Distinct key fingerprints in a descriptor (lowercase). */
  const fingerprintsOf = (raw: string): string[] => {
    try {
      const policy = parsePolicy(raw);
      const seen: string[] = [];
      for (const path of policy.paths) {
        for (const group of path.groups) {
          for (const k of group.keys) {
            const fp = k.fingerprint?.toLowerCase();
            if (fp && !seen.includes(fp)) seen.push(fp);
          }
        }
      }
      return seen;
    } catch {
      return [];
    }
  };

  /** An empty name map is left ABSENT, the way it always was: several places
   *  read "no labels at all" off the field's absence (the Talia export's own
   *  cleaning, the owner-side check in WalletProvider). */
  const emptyToUndefined = (labels: Record<string, string>): Record<string, string> | undefined =>
    Object.keys(labels).length > 0 ? labels : undefined;

  /**
   * Auto-labels for 21st Capital's OWN keys: one that sits inside a timelocked
   * recovery path is the rescue key, otherwise it's the co-signer. The user is
   * never asked to name our keys (decided 2026-07-23).
   */
  const providerKeyLabels = (raw: string, fps: string[]): Record<string, string> => {
    const out: Record<string, string> = {};
    try {
      const policy = parsePolicy(raw);
      for (const fp of fps) {
        const timelocked = policy.paths.some(
          (p) =>
            p.olderBlocks != null &&
            p.groups.some((g) => g.keys.some((k) => k.fingerprint?.toLowerCase() === fp)),
        );
        out[fp] = timelocked ? '21st Capital rescue key' : '21st Capital co-signer';
      }
    } catch {
      for (const fp of fps) out[fp] = '21st Capital key';
    }
    return out;
  };

  // Plain name for everything outside `save`, which shadows it with the value
  // handed forward when it saves in the same tick as the validation. The list
  // of keys to ask about went with the question (decided 2026-09-26).
  const validated = validatedState;

  /**
   * Validate `text`; on success start the wizard. `fromModal` delays the
   * first dialog until the scanner modal has fully dismissed (iOS cannot
   * stack modals). `quiet` suppresses errors while the user is mid-paste.
   */
  const runValidation = (text: string, fromModal = false, quiet = false) => {
    // An encrypted backup can be PASTED as easily as scanned, and it is not a
    // descriptor: it opens with a key first (decided 2026-08-29).
    const locked = readSealedBackup(text);
    if (locked) {
      setSealed(locked);
      setUnlockError(null);
      setError(null);
      setValidated(null);
      return;
    }
    let payload: string;
    taliaMetaRef.current = null;
    try {
      // Another Talia's export carries the vault's name, key names, devices
      // and registrations beside the descriptor (reported 2026-09-15: "it only
      // exported the naked vault without any labels or names").
      const talia = parseTaliaVaultExport(text);
      taliaMetaRef.current = talia;
      const extracted = extractImportPayload(talia ? taliaExportDescriptorText(talia) : text);
      payload = extracted.descriptor;
      setSourceWarnings(extracted.warnings);
      sourceKeyLabelsRef.current = talia?.keyLabels ?? extracted.keyLabels ?? {};
      sourceTxNotesRef.current = talia ? {} : (extracted.txNotes ?? {});
      // The name the source knew is offered at the name question, where it
      // can still be changed: another Talia's, or the one typed in Liana.
      if (talia?.name) autoNameRef.current = talia.name;
      else if (extracted.name) autoNameRef.current = extracted.name;
      if (payload !== text.trim()) setDescriptor(payload);
    } catch (e) {
      setValidated(null);
      setSourceWarnings([]);
      if (!quiet) setError((e as Error).message);
      return;
    }

    const result = validateForImport(payload, { network: resolveNetwork(payload) ?? network });
    if (result.ok) {
      // The user said which kind of vault this is; hold them to it, with
      // the way back (decided 2026-09-08: a single xpub is never a shared vault).
      const mismatch = importKindMismatch(expectedKind, result.parsed.keys.length);
      if (mismatch) {
        setValidated(null);
        if (!quiet) setError(mismatch);
        return;
      }
      // Same vault twice is never right (decided 2026-07-18).
      const dup = findDuplicateWallet(result.parsed.raw, wallets);
      if (dup) {
        setValidated(null);
        setError(duplicateVaultMessage(dup));
        return;
      }
      setValidated(result);
      setError(null);
      setLabel('');
      setMatched21C([]);
      if (result.keyPathSpender) {
        keyPathPendingRef.current = { result, fromModal };
        setTimeout(() => setKeyPathAsk(true), fromModal ? 450 : 100);
        return;
      }
      void checkProviderAndProceed(result, fromModal);
    } else {
      setValidated(null);
      if (!quiet) setError(result.message);
    }
  };

  const openNameWizard = (fromModal: boolean) => {
    if (wizardTimer.current) clearTimeout(wizardTimer.current);
    wizardTimer.current = setTimeout(() => setWizard({ step: 'name' }), fromModal ? 450 : 100);
  };
  const cancelPendingWizard = () => {
    if (wizardTimer.current) {
      clearTimeout(wizardTimer.current);
      wizardTimer.current = null;
    }
  };

  /**
   * If the descriptor carries a 21C key, offer to connect (already logged in →
   * just tag it; logged out → Log in / Skip). Otherwise go straight to naming.
   * The lookup is best-effort (cached/offline-safe) and never blocks import.
   */
  const checkProviderAndProceed = async (result: ValidationOk, fromModal: boolean) => {
    const fps = fingerprintsOf(result.parsed.raw);
    let matched: string[] = [];
    try {
      const known = await fetchKnown21CFingerprints();
      matched = fps.filter((fp) => known.has(fp));
    } catch {
      matched = [];
    }
    setMatched21C(matched);
    if (matched.length === 0) {
      openNameWizard(fromModal);
      return;
    }
    const session = await loadSession().catch(() => null);
    if (session) {
      // Already connected — proceed; the vault is tagged as a 21C vault.
      openNameWizard(fromModal);
      return;
    }
    setTimeout(() => setConnectPrompt(true), fromModal ? 450 : 100);
  };

  // Arriving from the global scanner with a payload: validate immediately.
  React.useEffect(() => {
    if (prefill) {
      setTransport('qr');
      runValidation(prefill, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScanResult = (result: BbqrScanResult) => {
    setScanning(false);
    setTransport('qr');
    passportScanRef.current = provider?.id === 'passport' && isPassportScan(result);
    // A Passport export names its vault after the device (decided 2026-09-09);
    // anything scanned from a wallet app still starts with an empty name.
    autoNameRef.current = provider?.id === 'passport' ? 'Passport' : null;
    const raw = result.kind === 'text' ? result.text : result.bytes;
    const locked = readSealedBackup(raw);
    if (locked) {
      // Encrypted: it opens with one of the vault's own keys, not here.
      setSealed(locked);
      setUnlockError(null);
      setError(null);
      return;
    }
    const text = result.kind === 'text' ? result.text : bytesToUtf8(result.bytes);
    setDescriptor(text);
    runValidation(text, true);
  };

  /** Where a device's key might sit for THIS backup: the paths the file
   *  records first, then the accounts a wallet normally uses. */
  const unlockPaths = (): string[] => {
    const parsed = sealed ? parseBackup(sealed) : null;
    const fromFile = (parsed?.paths ?? []).map((p) =>
      p.map((c) => (c >= 0x80000000 ? `${(c - 0x80000000).toString()}'` : c.toString())).join('/'),
    );
    const coin = settings.defaultNetwork === 'bitcoin' ? "0'" : "1'";
    const common = [
      `48'/${coin}/0'/2'`,
      `48'/${coin}/0'/1'`,
      `84'/${coin}/0'`,
      `86'/${coin}/0'`,
      `49'/${coin}/0'`,
      `44'/${coin}/0'`,
    ];
    // Liana's .bip138 leaves out the paths every reader tries anyway, the
    // vault's network included, so a file that records none can be a
    // testnet vault on a phone set to Bitcoin (or the reverse): the other
    // network's multisig accounts come last (decided 2026-11-05).
    const other = coin === "0'" ? "1'" : "0'";
    const otherNetwork = fromFile.length === 0 ? [`48'/${other}/0'/2'`, `48'/${other}/0'/1'`] : [];
    const seen = new Set<string>();
    return [...fromFile, ...common, ...otherNetwork].filter((p) =>
      seen.has(p) ? false : (seen.add(p), true),
    );
  };
  const unlockFailure =
    'That device holds no key for this backup. Try the one that does, or paste the account key.';

  /** Try one account key against the sealed backup. */
  const tryUnlock = (candidate: string): boolean => {
    if (!sealed) return false;
    const opened = openBackup(sealed, candidate);
    if (!opened) return false;
    // Another Talia's export opens to the whole vault, its name and
    // registrations included; any other backup opens to its descriptor.
    const content = opened.kind === 'talia' ? opened.json : opened.descriptor;
    setSealed(null);
    setUnlockKey('');
    setUnlockError(null);
    setDescriptor(content);
    runValidation(content, true);
    return true;
  };

  const onPickFile = async () => {
    try {
      // Read as BYTES, not text: an encrypted backup is binary, and reading it
      // as UTF-8 mangles it before we ever see the magic (decided 2026-08-29). A
      // descriptor export is text, and bytes decode back to exactly that.
      const file = await pickBinaryFile();
      if (!file) return;
      const unsupported = unsupportedWalletFileReason(file.name);
      if (unsupported) {
        setError(unsupported);
        return;
      }
      setTransport('file');
      passportScanRef.current = false;
      autoNameRef.current = null;
      const bytes = b64codec.decode(file.base64.replace(/\s+/g, ''));
      // The emailed backup arrives as a ZIP around the .bed (Gmail refuses a
      // bare .bed, found 2026-09-02); open it here so the restore is one pick.
      if (isZip(bytes)) {
        const inner = (unzip(bytes) ?? [])
          .map((e) => readSealedBackup(e.data))
          .find((b): b is Uint8Array => b != null);
        if (inner) {
          setSealed(inner);
          setUnlockError(null);
          setError(null);
          return;
        }
        setError(
          'This zip holds no Talia backup. Unzip it and open the .bed file inside, or pick the descriptor export itself.',
        );
        return;
      }
      const locked = readSealedBackup(bytes);
      if (locked) {
        setSealed(locked);
        setUnlockError(null);
        setError(null);
        return;
      }
      runValidation(new TextDecoder().decode(bytes));
    } catch (e) {
      setError(`Could not read file: ${(e as Error).message}`);
    }
  };

  /** Paste path: validate silently as text arrives; loud errors only for
   *  content long enough to plausibly be a whole key/descriptor. */
  const onChangeText = (t: string) => {
    setTransport('paste');
    passportScanRef.current = false;
    autoNameRef.current = null;
    sourceKeyLabelsRef.current = {};
    sourceTxNotesRef.current = {};
    setDescriptor(t);
    setValidated(null);
    setError(null);
    if (t.trim().length > 10) runValidation(t, false, true);
  };

  /** The Paste button (decided 2026-09-07): the same path as typing into the
   *  field, but LOUD, since the user asked for this paste and a bad
   *  clipboard must say so. A whole export file or a sealed backup on the
   *  clipboard goes through the same extraction as a typed one. */
  const pasteFromClipboard = async () => {
    const text = (await readClipboard()) ?? '';
    if (!text.trim()) {
      setError('Nothing to paste. Copy the descriptor or key first.');
      return;
    }
    setTransport('paste');
    passportScanRef.current = false;
    autoNameRef.current = null;
    setDescriptor(text);
    setValidated(null);
    setError(null);
    runValidation(text, false);
  };

  /**
   * A hardware wallet over Bluetooth (decided 2026-09-08): the device hands over
   * the public key of its native segwit account and PROVES it holds it, so
   * the vault is composed here and bound to the device at once. Nobody is
   * asked to connect it afterwards.
   */
  const acceptDeviceKey = (
    fingerprint: string,
    xpub: string,
    path: string,
    device: KeyDevice,
    /** What the device calls itself, which becomes the vault's name. */
    name?: string,
  ) => {
    setBleOpen(false);
    setTransport('qr');
    const binding = { fingerprint: fingerprint.toLowerCase(), device };
    setDeviceBinding(binding);
    deviceBindingRef.current = binding;
    autoNameRef.current = (name ?? '').trim() || deviceName(device.kind);
    const composed = composeSinglesig({ fingerprint: fingerprint.toLowerCase(), originPath: path, xpub });
    setDescriptor(composed);
    runValidation(composed);
  };
  /** The account a wallet app or device shows first: native segwit, account 0. */
  const deviceAccountPath = (): string => `84'/${settings.defaultNetwork === 'bitcoin' ? "0'" : "1'"}/0'`;

  /** `labels` and `name` carry what was typed a moment ago: state has not
   *  caught up when the dialog's action fires, and reading it would drop the
   *  last key name, or see an EMPTY vault name and save nothing (phone test of
   *  2026-09-08: a single-sig xpub only added on the second try, and with
   *  the first try's name). A dialog action passes its value forward; it
   *  never reads state the same handler just set. */
  const save = async (
    category: string | undefined,
    name: string = label,
    /** The auto-named path saves in the same tick that validated the
     *  descriptor and bound the device, so state has not caught up: it
     *  hands both forward rather than reading them back (the same rule as
     *  `labels` and `name`, decided 2026-09-08). */
    fresh?: { ok: ValidationOk; matched: string[]; binding: DeviceBinding | null },
  ) => {
    const validated = fresh?.ok ?? validatedState;
    const matched21C = fresh?.matched ?? matched21CState;
    const deviceBinding = fresh?.binding ?? deviceBindingState;
    const vaultName = name.trim();
    if (!validated || !vaultName) return;
    const taliaMeta = taliaMetaRef.current;
    // The key a device just handed over is labelled with the vault's name.
    const bindingFp =
      validated.parsed.keys.length === 1 ? validated.parsed.keys[0]?.fingerprint?.toLowerCase() : undefined;
    const deviceKeyLabel =
      bindingFp && (deviceBinding?.fingerprint === bindingFp || passportScanRef.current)
        ? { [bindingFp]: vaultName }
        : null;
    setWizard(null);
    setSaving(true);
    try {
      const wallet = await addWallet({
        label: vaultName,
        descriptor: validated.parsed.raw,
        network: validated.network,
        kind: validated.parsed.kind,
        source: validated.source,
        transport,
        category,
        // Nobody is asked to name a key (decided 2026-09-26). The names come from
        // what the import already KNOWS, and every key left over is numbered,
        // so no screen has to fall back to a fingerprint:
        //   1. another Talia's export, a Sparrow file that carries the
        //      device names, or a Liana wallet backup with the names its
        //      owner gave the keys there, which are names and not guesses;
        //   2. the name just confirmed for a vault imported FROM a device,
        //      so the device is called that everywhere Talia names it (decided
        //      2026-09-09, the name follows the device inside the app);
        //   3. 21st Capital's keys, named by their role;
        //   4. Key 1, Key 2 for the rest, replaced by the device's own name
        //      when the vault is registered on it.
        keyLabels: emptyToUndefined({
          ...defaultKeyNames(validated.parsed.raw, {
            providerFps: matched21C,
            known: { ...sourceKeyLabelsRef.current, ...(deviceKeyLabel ?? {}) },
          }),
          ...sourceKeyLabelsRef.current,
          ...(taliaMeta?.keyLabels ?? {}),
          ...(deviceKeyLabel ?? {}),
          ...providerKeyLabels(validated.parsed.raw, matched21C),
        }),
        // Tag a 21C key match so the vault is known to be ours (co-signing /
        // inheritance / re-connect). Imported vaults are never `locked`, so a
        // skipped (self-custodial) vault still works fully — no paywall.
        providerKeyFingerprints: matched21C.length > 0 ? matched21C : undefined,
      });
      // An import from a device is already connected (decided 2026-09-08: "we
      // have all the information we need and we know which device it came
      // from"). Three ways Talia knows: a Ledger or BitBox just read the
      // key over Bluetooth, the Passport showed it as a QR because the user
      // chose the Passport, or the same key (fingerprint) is already bound
      // to a device in another vault on this phone.
      const single =
        HWW_ENABLED && validated.parsed.kind === 'single-sig' && validated.parsed.keys.length === 1;
      const known: Record<string, KeyDevice> = {};
      for (const k of validated.parsed.keys) {
        const id = k.fingerprint?.toLowerCase();
        if (!id) continue;
        const device = wallets.map((w) => w.keyDevices?.[id]).find((d) => d != null);
        if (device) known[id] = device;
      }
      const singleFp = single ? validated.parsed.keys[0]?.fingerprint?.toLowerCase() : undefined;
      if (single && deviceBinding && singleFp === deviceBinding.fingerprint) {
        known[singleFp] = deviceBinding.device;
      }
      // Only a code that came off the Passport itself (a moving BC-UR code)
      // records one; a flat QR, a paste or a file leaves the vault watch
      // only (decided 2026-09-22).
      // And only for a vault a Passport can actually sign: standard scripts
      // only, never a layered vault or one holding a 21st Capital key (decided
      // 2026-09-24). `single` already excludes the layered shapes, and the
      // descriptor is the rule that does not depend on counting keys.
      if (
        single &&
        passportScanRef.current &&
        singleFp &&
        deviceSuitsVault('passport', validated.parsed.raw)
      ) {
        known[singleFp] = { kind: 'passport' };
      }
      // The notes Liana's backup carried. Only transactions this vault shows
      // no note for get one, and notes are display metadata: a write that
      // fails never undoes the import.
      if (Object.keys(sourceTxNotesRef.current).length > 0) {
        await addTxNotes(wallet.id, sourceTxNotesRef.current).catch(() => 0);
      }
      const unlockedBy = unlockDeviceRef.current;
      if (unlockedBy && validated.parsed.keys.some((k) => k.fingerprint?.toLowerCase() === unlockedBy.fingerprint)) {
        known[unlockedBy.fingerprint] = unlockedBy.device;
      }
      // Only what THIS phone has proved: a device it read the key from, or
      // one it already recorded for the same key in another vault. The other
      // Talia's device records used to land here too and bought Send for
      // hardware this phone had never seen (decided 2026-09-18: watch only means
      // watch only). Its word about registration only hides the reminder.
      const carried = taliaMeta ? importedVaultPatch(taliaMeta, Date.now()) : {};
      const devices = known;
      if (Object.keys(devices).length > 0 || Object.keys(carried).length > 0) {
        await updateWallet(wallet.id, {
          ...carried,
          ...(Object.keys(devices).length > 0 ? { keyDevices: devices } : {}),
        });
      }
      // Land INSIDE the new vault, with Home directly beneath it — back must
      // go to the wallet list, not the creation wizard (decided 2026-07-18).
      // A single-sig import from a wallet app is asked which device signs
      // for it, or watch only (decided 2026-09-08), unless its device is known.
      // Judged on the descriptor's one key; a bare xpub counts too and can
      // still name its device.
      const askHardware = single && !(singleFp && devices[singleFp]);
      landOverTab('VaultsTab', [
        { name: 'WalletDetail', params: { walletId: wallet.id, askHardware: askHardware || undefined } },
      ]);
    } catch (e) {
      setError(`Could not save wallet: ${(e as Error).message}`);
      setSaving(false);
    }
  };

  const afterName = (name: string) => {
    void save(undefined, name);
  };

  /**
   * The name Talia offers. A device import carries the name the hardware
   * calls itself; a second vault from the same device is numbered so the
   * two are told apart. Nothing is saved without the owner seeing it (decided
   * 2026-09-09: "show a prompt and ask the user to confirm the name and
   * let him change it if he wants to").
   */
  const suggestedName = (): string =>
    autoNameRef.current ? uniqueVaultName(autoNameRef.current, wallets.map((w) => w.label)) : '';

  /** The wizard dialog for the current step (remounted per step via `key`
   *  so the shared input field starts empty each time). */
  const wizardDialog = () => {
    if (!wizard || !validated) return null;
    if (wizard.step === 'name') {
      return (
        <AppDialog
          key="name"
          visible
          title="Name this vault"
          // Five lines at most (decided 2026-09-08): what was detected, and one
          // short line only when a bare key had to be given an address type.
          message={[
            `${validated.summary}.`,
            ...([...sourceWarnings, ...validated.warnings].some((w) => w.startsWith('Bare key imported'))
              ? ['Native segwit assumed. For a legacy or nested segwit wallet, import its full descriptor.']
              : []),
          ].join('\n\n')}
          input={{
            label: 'Vault name',
            placeholder: 'e.g. Family savings',
            autoCapitalize: 'sentences',
            defaultValue: suggestedName(),
            maxLength: MAX_NAME_LENGTH,
            hintAtLimit: `Up to ${MAX_NAME_LENGTH} characters`,
          }}
          actions={[
            {
              label: 'Continue',
              variant: 'primary',
              requiresInput: true,
              onPress: (v) => {
                setLabel(v);
                afterName(v);
              },
            },
            { label: 'Cancel', variant: 'ghost', onPress: () => setWizard(null) },
          ]}
          onClose={() => setWizard(null)}
        />
      );
    }
    return null;
  };

  const pasteTrailing = (
    <TouchableOpacity
      style={styles.pasteInField}
      onPress={() => void pasteFromClipboard()}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Paste from the clipboard">
      <ClipboardIcon size={22} color={theme.colors.accent} />
    </TouchableOpacity>
  );

  /** Step 1: single key or shared. */
  /** Step 1: single key or shared, in the cards the creation screen uses
   *  (decided 2026-09-08: "use the same containers we already have from the
   *  vault creation page and stay consistent"). */
  const KINDS: Array<{ key: 'single' | 'multi'; title: string; tagline: string; body: string }> = [
    {
      key: 'single',
      title: 'Single-sig',
      tagline: 'ONE DEVICE',
      body: 'One hardware wallet or wallet app signs for it.',
    },
    {
      key: 'multi',
      title: 'Multisig',
      tagline: 'K OF N DEVICES',
      body: 'Several keys share control. A set number of them must sign together.',
    },
  ];
  const kindStep = () => (
    <>
      <Text style={styles.question}>What kind of vault is it?</Text>
      {KINDS.map((k) => (
        <TouchableOpacity
          key={k.key}
          style={styles.kindCard}
          activeOpacity={0.85}
          onPress={() => navigation.push('Import', { kind: k.key })}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{k.title}</Text>
            <GoldChip label={k.tagline} style={styles.chipInRow} />
          </View>
          <Text style={styles.cardText}>{k.body}</Text>
        </TouchableOpacity>
      ))}
    </>
  );

  /** Step 2: which product holds it. Hardware appears for a single-sig
   *  vault only (a device holds a key, never the shared vault it belongs to,
   *  which lives in the software that built it), as the one device list
   *  (decided 2026-10-04, device first: the brands, then a brand's models;
   *  `DevicePicker`): the model picked is drawn by the search on the next
   *  page. The wallet apps keep their logo tiles, each a different mark. */
  const providersStep = () => {
    const forKind = kind ?? 'single';
    const { hardware, software } = providersFor(forKind, SIGNING_ENABLED || HWW_ENABLED);
    return (
      <>
        <Text style={styles.question}>Where is it now?</Text>
        {hardware.length > 0 && (
          <>
            <InfoHeading
              style={styles.sectionLabel}
              title="Hardware wallet"
              text="Talia reads only the public key. Your seed words never leave the device.">
              Hardware wallet
            </InfoHeading>
            <View style={styles.deviceList}>
              <DevicePicker models={hardware} onPick={(m) => navigation.push('Import', { kind: forKind, provider: modelInfo(m).kind, model: m })} />
            </View>
          </>
        )}
        <Text style={styles.sectionLabel}>{hardware.length > 0 ? 'Wallet app' : 'Where the vault was built'}</Text>
        <ProductGrid
          tiles={software.map((p) => ({
            key: p.id,
            mark: <ProviderTile provider={p.id} size={PRODUCT_MARK_SIZE} />,
            name: p.name,
            onPress: () => navigation.push('Import', { kind: forKind, provider: p.id }),
          }))}
        />
      </>
    );
  };

  /** The product's exact steps, above its ways in. */
  const providerHeader = (p: ImportProviderInfo) => (
    <View style={styles.providerHeader}>
      <View style={styles.providerHeaderRow}>
        <ProviderTile provider={p.id} size={44} />
        <View style={styles.tileBody}>
          <Text style={styles.tileTitle}>{model ? modelName(model) : p.name}</Text>
          <Text style={styles.tileSub}>{p.tagline}</Text>
        </View>
      </View>
      <StepList steps={providerVariant(p, kind ?? 'single')?.steps ?? []} style={styles.step} />
    </View>
  );

  /** Step 3: the ways in, for the chosen product or the shared vault. */
  const inputStep = () => {
    if (provider) {
      const p = provider;
      return (
        <>
          {providerHeader(p)}
          {variant?.methods.includes('ble') && bleOpen && (
            // The device picked in the list, drawn turning on and unlocking
            // while the search runs (decided 2026-10-04); the search still finds
            // every adopted device, and the one found proves the key.
            <HardwareConnect
              shape="single"
              purpose="key"
              network={settings.defaultNetwork}
              keys={[]}
              model={model}
              question="Which device are you using?"
              onFooterBack={setStepBack}
              deviceTask={async (device) => {
                const path = deviceAccountPath();
                device.setStep(`Reading the key from the ${device.brandName}…`);
                const xpub = await device.xpub(path, settings.defaultNetwork);
                if (!device.alive()) return;
                // What the device calls itself, which is the name its owner
                // gave it: the vault is named after it.
                acceptDeviceKey(device.fingerprint, xpub, path, device.record, device.name);
              }}
            />
          )}
          {/* The ways in are the page's actions: they sit in its footer. */}
          {variant?.methods.includes('paste') && (
            <>
              <Text style={styles.or}>or paste it</Text>
              <TextField
                label={variant?.pasteLabel ?? 'Descriptor'}
                value={descriptor}
                onChangeText={onChangeText}
                placeholder={variant?.placeholder}
                multiline
                monospace
                trailing={pasteTrailing}
              />
            </>
          )}
        </>
      );
    }
    // No product chosen: the global scanner handed us a payload, so the
    // page is just the ways in, in the app's plain words.
    const tiles = [
      { id: 'qr' as const, name: 'Scan the QR code', how: 'A moving code or a single one', Icon: ScanIcon },
      { id: 'file' as const, name: 'Open a file', how: 'A descriptor export or a Talia backup', Icon: FileIcon },
    ];
    return (
      <>
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={styles.tile}
            activeOpacity={0.85}
            onPress={() => {
              if (t.id === 'qr') setScanning(true);
              else void onPickFile();
            }}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            <t.Icon size={26} strokeWidth={1.7} color={theme.colors.offWhite} />
            <View style={styles.tileBody}>
              <Text style={styles.tileTitle}>{t.name}</Text>
              <Text style={styles.tileSub}>{t.how}</Text>
            </View>
            <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
          </TouchableOpacity>
        ))}
        <Text style={styles.or}>or paste it</Text>
        <TextField
          label={expectedKind === 'multi' ? 'Vault descriptor' : 'Descriptor or xpub'}
          value={descriptor}
          onChangeText={onChangeText}
          placeholder={expectedKind === 'multi' ? 'wsh(…) or tr(…)' : 'wsh(...), tr(...), wpkh(...) or xpub…'}
          multiline
          monospace
          trailing={pasteTrailing}
        />
      </>
    );
  };

  const scanHint =
    variant?.qrHint ??
    (expectedKind === 'multi' ? 'Scan the vault descriptor' : 'Scan a descriptor, xpub, or wallet export');

  /** A device is opening the locked backup: the search is on the page. */
  const hwwUnlocking = ledgerUnlock && (SIGNING_ENABLED || HWW_ENABLED);

  /** The page's actions, pinned at the foot (decided 2026-10-05), chosen by the
   *  step: a locked backup's own three; otherwise Add this vault once a
   *  descriptor checked out (no "Detected" card, decided 2026-09-08: the name
   *  dialog opens on top of it and says the same; what stays is the way back
   *  into the wizard after a Cancel), over a product's ways in. The kind and
   *  product steps are all cards: no footer. The hardware step's ONE way out
   *  comes last: its Back (to its device list) while the step has one, else
   *  Cancel, one button for one move (decided 2026-10-05). On the locked backup
   *  Cancel puts the backup away; on a product's search it leaves for the
   *  products the device was picked from (decided 2026-10-05: the list ended
   *  without a button). */
  const pageFooter = (): React.ReactNode => {
    if (sealed) {
      return (
        <>
          {/* No device pairing in the App Store build, so the account key
              is pasted. Any one of the vault's keys opens the backup. */}
          {!hwwUnlocking && (SIGNING_ENABLED || HWW_ENABLED) && (
            <Button title="Use my hardware wallet" onPress={() => setLedgerUnlock(true)} />
          )}
          {!hwwUnlocking && (
            <Button
              title="Unlock"
              variant="accent"
              disabled={unlockKey.trim().length < 10}
              onPress={() => {
                if (!tryUnlock(unlockKey)) {
                  setUnlockError(
                    'That key is not one of this vault’s keys, so it cannot open this backup.',
                  );
                }
              }}
            />
          )}
          {hwwUnlocking && stepBack != null ? (
            <Button title="Back" variant="ghost" onPress={stepBack.onPress} />
          ) : (
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setSealed(null);
                setLedgerUnlock(false);
                setUnlockKey('');
                setUnlockError(null);
              }}
            />
          )}
        </>
      );
    }
    const methods = stage === 'input' && provider ? variant?.methods ?? [] : [];
    const add = validated != null && !wizard;
    const search = methods.includes('ble') && !bleOpen && !validated;
    const scan = methods.includes('qr');
    const file = methods.includes('file');
    /** The hardware step is on the page: its Back, or Cancel without one. */
    const hwwStep = methods.includes('ble') && bleOpen;
    if (!add && !search && !scan && !file && !hwwStep) return undefined;
    return (
      <>
        {add && (
          <Button
            title="Add this vault"
            variant="accent"
            loading={saving}
            onPress={() => {
              // Never past the one-key question unanswered (decided 2026-09-26).
              if (validated.keyPathSpender && keyPathAcceptedRef.current !== validated) {
                keyPathPendingRef.current = { result: validated, fromModal: false };
                setKeyPathAsk(true);
                return;
              }
              setWizard({ step: 'name' });
            }}
          />
        )}
        {search && <Button title="Search again" onPress={() => setBleOpen(true)} />}
        {scan && <Button title="Scan the QR code" onPress={() => setScanning(true)} />}
        {file && <Button title="Open a file" variant="ghost" onPress={() => void onPickFile()} />}
        {hwwStep && (stepBack != null ? <Button title="Back" variant="ghost" onPress={stepBack.onPress} /> : <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />)}
      </>
    );
  };

  return (
    <Screen scroll footer={pageFooter()}>
      {/* A locked backup gets the page to itself (decided 2026-09-08): the ways
          in are for choosing a vault, and one has been chosen. */}
      {!sealed && stage === 'kind' && kindStep()}
      {!sealed && stage === 'providers' && providersStep()}
      {!sealed && stage === 'input' && inputStep()}

      {error && (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      )}

      {sealed && (
        <Card style={styles.sealedCard}>
          <InfoHeading
            title="Why a key is needed"
            text={
              'This backup is encrypted with the vault’s own keys, so a copy of it is no use to anyone who does not hold one. That is what makes it safe to keep in a cloud drive or email it to yourself.\n\nAny ONE of the vault’s keys opens it. Talia can read the account key from your hardware, or you can paste it: the account key is public and cannot spend.'
            }>
            This backup is locked
          </InfoHeading>
          <Text style={styles.sealedBody}>
            Open it with any one of this vault&apos;s keys. Nothing is sent anywhere and
            the key you use cannot spend.
          </Text>
          {hwwUnlocking ? (
            // Any adopted device opens it (decided 2026-09-09: the app assumed a
            // Ledger, "which might or might not be the case"; 2026-09-22:
            // the method first, then a search for every device). The
            // backup names the paths its keys came from, so those are tried
            // first, then the accounts a wallet normally uses.
            <HardwareConnect
              shape="multi"
              purpose="key"
              network={settings.defaultNetwork}
              keys={[]}
              question="Which device are you using?"
              onFooterBack={setStepBack}
              deviceTask={async (device) => {
                for (const path of unlockPaths()) {
                  if (!device.alive()) return;
                  device.setStep(`Trying the key at m/${path}…`);
                  let xpub: string;
                  try {
                    xpub = await device.xpub(path, settings.defaultNetwork);
                  } catch {
                    continue; // Some devices refuse a path outright.
                  }
                  if (!device.alive()) return;
                  if (tryUnlock(xpub)) {
                    unlockDeviceRef.current = { fingerprint: device.fingerprint, device: device.record };
                    setLedgerUnlock(false);
                    return;
                  }
                }
                throw new Error(unlockFailure);
              }}
            />
          ) : (
            <>
              <TextField
                label={
                  SIGNING_ENABLED || HWW_ENABLED
                    ? 'Or paste an account key'
                    : 'Paste an account key'
                }
                value={unlockKey}
                onChangeText={(t) => {
                  setUnlockKey(t);
                  setUnlockError(null);
                }}
                placeholder="xpub… or tpub…"
                autoCapitalize="none"
                monospace
                trailing={
                  <TouchableOpacity
                    style={styles.pasteInField}
                    onPress={() =>
                      void readClipboard().then((text) => {
                        const key = (text ?? '').trim();
                        if (!key) {
                          setUnlockError('Nothing to paste. Copy the account key first.');
                          return;
                        }
                        setUnlockKey(key);
                        setUnlockError(null);
                      })
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Paste the account key from the clipboard">
                    <ClipboardIcon size={22} color={theme.colors.accent} />
                  </TouchableOpacity>
                }
                multiline
              />
              {unlockError && <Text style={styles.sealedError}>{unlockError}</Text>}
            </>
          )}
        </Card>
      )}

      <AppModal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <BbqrScanner onComplete={onScanResult} onCancel={() => setScanning(false)} hint={scanHint} />
      </AppModal>

      {wizardDialog()}

      {keyPathAsk && (
        <AppDialog
          visible
          title="One key can spend this vault alone"
          // Title and buttons only (decided 2026-09-02). The key is shown as its
          // own path on the Spending policy once imported.
          actions={[
            {
              label: 'Import anyway',
              variant: 'primary',
              destructive: true,
              onPress: () => {
                const pending = keyPathPendingRef.current;
                keyPathPendingRef.current = null;
                if (pending) {
                  keyPathAcceptedRef.current = pending.result;
                  void checkProviderAndProceed(pending.result, true);
                }
              },
            },
            {
              label: 'Cancel',
              variant: 'ghost',
              onPress: () => {
                keyPathPendingRef.current = null;
                setValidated(null);
              },
            },
          ]}
          onClose={() => {
            setKeyPathAsk(false);
            // Dismissed without an answer (backdrop): a no, like Cancel.
            // onClose runs before an action's onPress, so this looks a tick
            // later, after any action has taken the pending import.
            setTimeout(() => {
              if (keyPathPendingRef.current) {
                keyPathPendingRef.current = null;
                setValidated(null);
              }
            }, 0);
          }}
        />
      )}

      {connectPrompt && (
        <AppDialog
          visible
          title="This vault uses 21st Capital"
          // Title and buttons only (decided 2026-09-22): "use it fully on your
          // own" was false for a 2-of-2 with our co-signer and for the owner
          // of a 2-of-3 owner, heir and 21st Capital, and the watch-only
          // build has no co-signing to enable.
          actions={[
            {
              label: 'Log in',
              variant: 'primary',
              // Runs AFTER onClose (which scheduled the wizard) — cancel it so
              // the sign-in sheet isn't buried under the naming dialog.
              onPress: () => {
                cancelPendingWizard();
                setAuthOpen(true);
              },
            },
            {
              // onClose already closed the dialog + scheduled the self-custodial
              // import, so Skip needs no extra work.
              label: 'Skip',
              variant: 'ghost',
              onPress: () => {},
            },
          ]}
          onClose={() => {
            setConnectPrompt(false);
            // Modal→modal: let the dialog dismiss before the wizard opens.
            openNameWizard(true);
          }}
        />
      )}

      <AuthSheet
        visible={authOpen}
        defaultMode="signin"
        onClose={() => {
          setAuthOpen(false);
          openNameWizard(true);
        }}
        onAuthed={() => {
          setAuthOpen(false);
          openNameWizard(true);
        }}
      />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  question: {
    ...theme.typography.title,
    color: theme.colors.offWhite,
    marginBottom: theme.spacing.lg,
  },
  /** The device list sits where the hardware tiles sat: the grid's own room under it. */
  deviceList: { marginBottom: theme.spacing.lg },
  sectionLabel: {
    ...theme.typography.label,
    color: theme.colors.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  // The vault creation screen's card, to the letter (decided 2026-09-08).
  kindCard: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  cardTitle: { ...theme.typography.heading, color: theme.colors.offWhite, flexShrink: 1 },
  chipInRow: { alignSelf: 'center' },
  cardText: { ...theme.typography.body, color: theme.colors.slate },
  providerHeader: { gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  providerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  step: { ...theme.typography.body, color: theme.colors.offWhite },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  tileBody: { flex: 1 },
  tileTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  tileSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2 },
  or: {
    ...theme.typography.label,
    color: theme.colors.faint,
    textAlign: 'center',
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  errorCard: { borderColor: theme.colors.negative, marginTop: theme.spacing.md },
  errorText: { ...theme.typography.body, color: theme.colors.negative },
  sealedCard: { gap: theme.spacing.md, marginBottom: theme.spacing.md },
  sealedBody: { ...theme.typography.body, color: theme.colors.slate },
  sealedError: { ...theme.typography.caption, color: theme.colors.negative },
  pasteInField: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
}));
