/**
 * Arrange mode (long-press a wallet on home): drag categories up/down and
 * drag wallets between categories. Hand-rolled with PanResponder — every row
 * carries a ≡ handle; the lifted row follows the finger as a ghost while a
 * gold indicator marks the drop slot. "Done" persists category order, wallet
 * order, and any category moves.
 *
 * Two modes, one screen (decided 2026-09-02: "the exact same arrange/delete and
 * label category structure we have for vaults, also for portfolios"):
 * 'vaults' lists on-chain vaults under Single-sig/Multisig/custom/Other and
 * persists `categoryOrder`; 'portfolios' lists manual wallets under
 * custom/My Portfolios only and persists `portfolioCategoryOrder`. A portfolio's
 * section and order are PER DEVICE: the encrypted sync payload carries label
 * and icon only (crypto/vaultSync.ts), and that is deliberate.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from './AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import { cardGlow, Gloss } from './Gloss';
import { getColorScheme, theme, themedStyles } from '../theme';
import { Button } from './Button';
import { FadeEdge } from './FadeEdge';
import { PageGlow } from './PageGlow';
import { TextField } from './TextField';
import { WalletIconTile, WALLET_ICON_KEYS, walletIconFor, walletIconInSection } from './walletIcons';
import { MenuIcon, TrashIcon } from './TablerIcons';
import { isSharedViewer,
  useWallets,
  sectionsForWallets,
  categoryTitleFor,
  portfolioSectionsFor,
  portfolioSectionTitleFor,
  PORTFOLIO_DEFAULT_SECTION_TITLE,
  clearManualEntries,
  isBuiltinCategory,
  isBuiltinPortfolioCategory,
  storedCategoryFor,
  vaultSectionChoices,
  portfolioSectionChoices,
} from '../../wallet';
import type { WalletMeta } from '../../wallet';
import { MAX_NAME_LENGTH } from '../../wallet';
import { applyArrangeDrop, rowsForBlocks } from './arrangeLogic';
import type { ArrangeBlock as Block, ArrangeRow as Row } from './arrangeLogic';
import { loadSession } from '../../services/companyAuth';
import { deleteShare, leaveShare } from '../../services/sharedPortfolio';

/** What deleting a SHARED portfolio does about the share (decided 2026-09-12). */
type ShareChoice = 'leave' | 'stopAll' | 'local';

const HEADER_H = 52;
const WALLET_H = 64;
// The row's on-screen pitch is its height PLUS its bottom margin; the drag
// model compares against real finger travel, so it must use the pitch.
const WALLET_GAP = theme.spacing.sm; // 8 — same gap as the home list cards
const WALLET_PITCH = WALLET_H + WALLET_GAP;
const pitchFor = (r: Row): number => (r.type === 'header' ? HEADER_H : WALLET_PITCH);
/** The drag handle's three lines, drawn (decided 2026-10-05), not a "≡" glyph. */
const HANDLE_MARK = 22;

export type ArrangeMode = 'vaults' | 'portfolios';

// Titles the built-in sections show under, so a custom section cannot be
// named to look like one of them (lower-cased for the comparison). A title
// that is its own key (Single-sig, Multisig, Virtual) is refused by the
// built-in key check in sectionNameFree.
const VAULT_RESERVED_NAMES = ['other', 'savings', 'spending'];
const PORTFOLIO_RESERVED_NAMES = [PORTFOLIO_DEFAULT_SECTION_TITLE.toLowerCase(), 'other', 'virtual'];

export function ArrangeModal({
  visible,
  onClose,
  mode = 'vaults',
}: {
  visible: boolean;
  onClose: () => void;
  mode?: ArrangeMode;
}): React.JSX.Element {
  const { wallets: allWallets, settings, updateSettings, arrangeWallets, updateWallet, removeWallet, touchManualVault } = useWallets();
  const portfolios = mode === 'portfolios';
  // Each tab arranges ONLY its own wallets: portfolios live on the Portfolio
  // tab, so the on-chain sheet must not list them (dragging one here leaked
  // the 'virtual' category around), and the portfolio sheet lists nothing else.
  const wallets = React.useMemo(
    () => allWallets.filter((w) => (portfolios ? !!w.manual : !w.manual)),
    [allWallets, portfolios],
  );
  // The built-in sections, as categories.ts defines them: never a typed
  // name, never renamed, never a chip of their own, kept when emptied.
  const isBuiltin = portfolios ? isBuiltinPortfolioCategory : isBuiltinCategory;
  const sectionChoicesFor = portfolios ? portfolioSectionChoices : vaultSectionChoices;
  const RESERVED_NAMES = portfolios ? PORTFOLIO_RESERVED_NAMES : VAULT_RESERVED_NAMES;
  /** A name a user may give a section: not empty, not a built-in's, not taken. */
  const sectionNameFree = (name: string, exceptBlock?: number): boolean =>
    !!name &&
    !isBuiltin(name.toLowerCase()) &&
    !RESERVED_NAMES.includes(name.toLowerCase()) &&
    !blocks.some((b, i) => i !== exceptBlock && b.key === name);
  const noun = portfolios ? 'portfolio' : 'vault';
  const insets = useSafeAreaInsets();

  const walletById = useMemo(() => new Map(wallets.map((w) => [w.id, w])), [wallets]);

  const [blocks, setBlocks] = useState<Block[]>([]);
  useEffect(() => {
    if (!visible) return;
    const sections = portfolios
      ? portfolioSectionsFor(wallets, settings.portfolioCategoryOrder)
      : sectionsForWallets(wallets, settings.categoryOrder);
    setBlocks(sections.map((s) => ({ key: s.key, walletIds: s.data.map((w) => w.id) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Flat row model in render order — drop math runs on fixed row heights.
  const rows = useMemo<Row[]>(() => rowsForBlocks(blocks), [blocks]);

  const rowTops = useMemo(() => {
    let y = 0;
    return rows.map((r) => {
      const top = y;
      y += pitchFor(r);
      return top;
    });
  }, [rows]);

  // Icon change + custom-category rename live HERE now (decided 2026-07-19:
  // the arrange screen owns everything about how the home screen looks).
  const [iconPickFor, setIconPickFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Delete lives here now (decided 2026-07-21): the arrange screen lists EVERY
  // vault — including locked, not-yet-activated ones that can't be opened —
  // so it's the one place any vault can be removed.
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const [deleteDraft, setDeleteDraft] = useState('');
  // A SHARED portfolio asks first (decided 2026-09-12): a member leaves and
  // removes, an owner stops sharing for everyone or removes their own copy
  // only. The answer is carried into the typed-DELETE step and acted on
  // there, so nothing on the server changes before DELETE is typed.
  const [shareAskFor, setShareAskFor] = useState<string | null>(null);
  const [shareChoice, setShareChoice] = useState<ShareChoice | null>(null);
  const [shareFailedFor, setShareFailedFor] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  // Renaming a WALLET lives here too (decided 2026-08-28): the vault's own menu
  // was getting long, and this screen is already where a vault is arranged,
  // re-sectioned and deleted. Tap the name to open it.
  const [walletRenameFor, setWalletRenameFor] = useState<string | null>(null);
  const [walletRenameDraft, setWalletRenameDraft] = useState('');
  // Two ways in: from a vault's name dialog (`newSectionFor` = that vault,
  // which moves in as the section is made) and from the "New section" button
  // under the list (decided 2026-09-07: a portfolio owner saw only "Other" and no
  // way to add a section; the chip inside the name dialog was not found).
  const [newSectionFor, setNewSectionFor] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionDraft, setNewSectionDraft] = useState('');

  /** Move a vault between sections in the LOCAL block model — the same model
   *  dragging edits and Done persists. Writing the category straight to the
   *  wallet would be overwritten by Done a moment later. */
  const moveWalletToBlock = React.useCallback((walletId: string, blockKey: string) => {
    setBlocks((prev) => {
      const without = prev.map((b) => ({ ...b, walletIds: b.walletIds.filter((id) => id !== walletId) }));
      const target = without.find((b) => b.key === blockKey);
      if (target) target.walletIds = [...target.walletIds, walletId];
      else without.push({ key: blockKey, walletIds: [walletId] });
      // An emptied custom section disappears; the built-ins always stay, and
      // so does a section just made with "New section" (see ArrangeBlock.fresh).
      return without.filter((b) => b.walletIds.length > 0 || b.fresh || isBuiltin(b.key));
    });
  }, [isBuiltin]);
  // One rule for both modes: the helper reads the manual flag, which is what
  // each mode filters its list on anyway. A row's default follows the section
  // it sits in on THIS screen, not the one saved: a move here is saved only at
  // Done, and the icon lagged the move until then (decided 2026-10-15).
  const iconFor = (w: WalletMeta) => {
    const block = blocks.find((b) => b.walletIds.includes(w.id));
    return block ? walletIconInSection(w, block.key) : walletIconFor(w);
  };

  const [dragging, setDragging] = useState<Row | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number>(-1); // insert BEFORE rows[hoverSlot]
  const dragY = useRef(new Animated.Value(0)).current;
  const draggingRef = useRef<Row | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const topsRef = useRef(rowTops);
  topsRef.current = rowTops;

  const slotForY = useCallback((centerY: number): number => {
    const tops = topsRef.current;
    const rws = rowsRef.current;
    for (let i = 0; i < rws.length; i++) {
      if (centerY < tops[i] + pitchFor(rws[i]) / 2) return i;
    }
    return rws.length;
  }, []);

  const applyDrop = useCallback((row: Row, slot: number) => {
    setBlocks((prev) => applyArrangeDrop(prev, rowsRef.current, row, slot));
  }, []);

  // Drag ONLY from the ≡ handle (decided 2026-07-21: whole-row drag made long
  // lists unusable — every touch grabbed a row instead of scrolling). The
  // rows carry no responder now, so the ScrollView scrolls normally; the
  // handle on the left drags, the trash on the right deletes.
  const cancelArm = useCallback(() => {}, []);

  const finishDrag = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
    setHoverSlot(-1);
  }, []);

  // One responder per row id, created ONCE and cached — recreating them on
  // re-render (hoverSlot updates re-render mid-drag) dropped the gesture,
  // which is why arrange mode didn't work on device. All callbacks read
  // current state through refs. The responder also claims moves and refuses
  // termination so the ScrollView can't steal the drag.
  const panCache = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());
  const makePan = useCallback(
    (row: Row, immediate: boolean) => {
      const key = `${immediate ? 'handle' : 'row'}:${row.id}`;
      const existing = panCache.current.get(key);
      if (existing) return existing;
      const findRow = () => rowsRef.current.find((r) => r.id === row.id);
      const centerYFor = (g: { dy: number }) => {
        const r = findRow();
        const i = rowsRef.current.findIndex((x) => x.id === row.id);
        if (!r || i < 0) return null;
        return topsRef.current[i] + pitchFor(r) / 2 + g.dy;
      };
      const pan = PanResponder.create({
        // Everything claims at touch-down — dragging must work from any
        // part of the row, not just the handle.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Only the ≡ handle mounts this responder now — see the render.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          const r = findRow();
          if (!r) return;
          draggingRef.current = r;
          setDragging(r);
          dragY.setValue(0);
        },
        onPanResponderMove: (_e, g) => {
          dragY.setValue(g.dy);
          const cy = centerYFor(g);
          if (cy != null) setHoverSlot(slotForY(cy));
        },
        onPanResponderRelease: (_e, g) => {
          const r = findRow();
          const cy = centerYFor(g);
          if (r && cy != null) applyDrop(r, slotForY(cy));
          finishDrag();
        },
        onPanResponderTerminate: finishDrag,
      });
      panCache.current.set(key, pan);
      return pan;
    },
    [applyDrop, slotForY, dragY, finishDrag],
  );

  const onDone = useCallback(async () => {
    // A "New section" nothing was moved into is not a section.
    const kept = blocks.filter((b) => b.walletIds.length > 0 || isBuiltin(b.key));
    const order = kept.map((b) => b.key);
    await updateSettings(portfolios ? { portfolioCategoryOrder: order } : { categoryOrder: order });
    const categoryById: Record<string, string | undefined> = {};
    for (const b of kept) {
      for (const wid of b.walletIds) {
        // Other is keyed '' on screen and cannot be STORED as '': an unset
        // category means "no choice was made", so a vault moved to Other came
        // straight back under its shape (decided 2026-10-07). categories.ts owns
        // that round trip for both modes.
        categoryById[wid] = storedCategoryFor(b.key, mode);
      }
    }
    await arrangeWallets(kept.flatMap((b) => b.walletIds), categoryById);
    // Sections and order stay on THIS device (the sync payload carries
    // label + icon + entries only), so a re-filed portfolio is NOT stamped
    // for sync: bumping its stamp with nothing new in the payload would
    // beat a concurrent rename on the other phone and resurrect a
    // portfolio deleted there (decided 2026-09-03).
    onClose();
  }, [blocks, isBuiltin, mode, portfolios, updateSettings, arrangeWallets, onClose]);

  return (
    <AppModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + theme.spacing.md }]}>
        {/* A full-screen Modal sits outside the navigator's page layout, so it paints its own ground and glow. */}
        <PageGlow />
        <Text style={styles.title}>Arrange</Text>
        <Text style={styles.hint}>
          Drag ≡ to reorder. Tap a name or icon to change it, the trash to delete.
        </Text>

        <View style={styles.listWrap}>
        <ScrollView
          style={styles.list}
          scrollEnabled={!dragging}
          onScrollBeginDrag={cancelArm}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}>
          {rows.map((row, i) => {
            const isDragged = dragging?.id === row.id;
            const indicator = hoverSlot === i && dragging != null;
            const handlePan = makePan(row, true);
            if (row.type === 'header') {
              const b = blocks[row.blockIdx];
              return (
                <Animated.View
                  key={row.id}
                  style={[
                    styles.headerRow,
                    isDragged && [styles.lifted, { transform: [{ translateY: dragY }] }],
                    indicator && styles.slotLine,
                  ]}>
                  <View {...handlePan.panHandlers} style={styles.handle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <MenuIcon size={HANDLE_MARK} color={theme.colors.slate} />
                  </View>
                  <Text style={styles.headerText}>
                    {portfolios
                      ? portfolioSectionTitleFor(b.key)
                      : categoryTitleFor(b.key, b.walletIds.length)}
                  </Text>
                  {b.walletIds.length === 0 && !isBuiltin(b.key) && (
                    <Text style={styles.emptyHint}>{`Drag a ${noun} here`}</Text>
                  )}
                  {!isBuiltin(b.key) && (
                    <TouchableOpacity
                      onPress={() => {
                        cancelArm();
                        setRenameDraft(b.key);
                        setRenameFor(row.blockIdx);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Text style={styles.renameLink}>Rename</Text>
                    </TouchableOpacity>
                  )}
                </Animated.View>
              );
            }
            const w = walletById.get(row.walletId) as WalletMeta | undefined;
            if (!w) return null;
            return (
              <Animated.View
                key={row.id}
                style={[
                  styles.walletRow,
                  isDragged && [styles.lifted, styles.walletLifted, { transform: [{ translateY: dragY }] }],
                  indicator && styles.slotLine,
                ]}>
                <Gloss radius={theme.radius.md} strength={cardGlow()} />
                <View {...handlePan.panHandlers} style={styles.handle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <MenuIcon size={HANDLE_MARK} color={theme.colors.slate} />
                </View>
                {/* A portfolio shared WITH this phone keeps the owner's name and
                    icon (decided 2026-09-14): the name says so in colour, never
                    an opacity on the row. */}
                <TouchableOpacity
                  disabled={isSharedViewer(w)}
                  onPress={() => {
                    cancelArm();
                    setIconPickFor(w.id);
                  }}>
                  <WalletIconTile icon={iconFor(w)} size={38} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.walletNameBtn}
                  disabled={isSharedViewer(w)}
                  onPress={() => {
                    cancelArm();
                    setWalletRenameDraft(w.label);
                    setWalletRenameFor(w.id);
                  }}>
                  <Text style={[styles.walletText, isSharedViewer(w) && styles.textReadOnly]} numberOfLines={1}>
                    {w.label}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    cancelArm();
                    setDeleteDraft('');
                    setShareChoice(null);
                    if (w.sharedPortfolio && !w.sharedPortfolio.ended) setShareAskFor(w.id);
                    else setDeleteFor(w.id);
                  }}
                  style={styles.trashBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <TrashIcon size={20} color={theme.colors.slate} />
                </TouchableOpacity>
              </Animated.View>
            );
          })}
          <Button
            title="New section"
            variant="ghost"
            onPress={() => {
              cancelArm();
              setNewSectionDraft('');
              setAddingSection(true);
            }}
          />
        </ScrollView>
        {/* Rows running under Done dissolve (decided 2026-09-12). */}
        <FadeEdge />
        </View>

        <View style={styles.footer}>
          <Button title="Done" onPress={onDone} />
        </View>

        {/* Inline overlays (never nested Modals — iOS can't stack them). */}
        {iconPickFor != null && (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              <Text style={styles.overlayTitle}>Choose an icon</Text>
              <View style={styles.iconGrid}>
                {WALLET_ICON_KEYS.map((k) => {
                  const w = walletById.get(iconPickFor);
                  const current = w && iconFor(w);
                  return (
                    <TouchableOpacity
                      key={k}
                      activeOpacity={0.8}
                      onPress={() => {
                        // The icon DOES travel through sync, so a portfolio's
                        // change is stamped like a rename (decided 2026-09-03).
                        const manual = !!walletById.get(iconPickFor)?.manual;
                        void updateWallet(iconPickFor, { icon: k }).then(() => {
                          if (manual) touchManualVault(iconPickFor);
                        });
                        setIconPickFor(null);
                      }}>
                      <WalletIconTile icon={k} size={52} selected={current === k} />
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Button title="Cancel" variant="ghost" onPress={() => setIconPickFor(null)} />
            </View>
          </View>
        )}
        {renameFor != null && (
          <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.overlayCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              <Text style={styles.overlayTitle}>Rename section</Text>
              <TextField
                label=""
                value={renameDraft}
                onChangeText={setRenameDraft}
                autoCapitalize="sentences"
                placeholder="e.g. Family fund"
                maxLength={MAX_NAME_LENGTH}
                hint={renameDraft.length >= MAX_NAME_LENGTH ? `Up to ${MAX_NAME_LENGTH} characters` : undefined}
              />
              <Button
                title="Save"
                disabled={!sectionNameFree(renameDraft.trim(), renameFor)}
                onPress={() => {
                  const name = renameDraft.trim();
                  setBlocks((prev) => prev.map((b, i) => (i === renameFor ? { ...b, key: name } : b)));
                  setRenameFor(null);
                }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setRenameFor(null)} />
            </View>
          </KeyboardAvoidingView>
        )}
        {walletRenameFor != null && (
          <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.overlayCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              <Text style={styles.overlayTitle}>{`Rename this ${noun}`}</Text>
              <TextField
                label=""
                value={walletRenameDraft}
                onChangeText={setWalletRenameDraft}
                autoCapitalize="sentences"
                maxLength={MAX_NAME_LENGTH}
                hint={walletRenameDraft.length >= MAX_NAME_LENGTH ? `Up to ${MAX_NAME_LENGTH} characters` : undefined}
              />
              <Text style={styles.overlayLabel}>{`SHOW THIS ${noun.toUpperCase()} UNDER`}</Text>
              <View style={styles.sectionChips}>
                {/* One chip per section, built-ins first (categories.ts). */}
                {sectionChoicesFor(
                  blocks.map((b) => b.key),
                  blocks.find((b) => b.walletIds.includes(walletRenameFor))?.key ?? '',
                ).map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.sectionChip, c.selected && styles.sectionChipOn]}
                    onPress={() => moveWalletToBlock(walletRenameFor, c.key)}>
                    <Text style={[styles.sectionChipText, c.selected && styles.sectionChipTextOn]}>
                      {c.title}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.sectionChip}
                  onPress={() => {
                    setNewSectionDraft('');
                    setNewSectionFor(walletRenameFor);
                  }}>
                  <Text style={styles.sectionChipText}>New section…</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.overlayHint}>
                {`Or drag the ${noun} into another section on the list behind this.`}
              </Text>
              <Button
                title="Save"
                disabled={!walletRenameDraft.trim()}
                onPress={() => {
                  const id = walletRenameFor;
                  const manual = !!walletById.get(id)?.manual;
                  void updateWallet(id, { label: walletRenameDraft.trim() }).then(() => {
                    // A portfolio's name travels through sync: stamp it, the
                    // same way its own screen's rename does.
                    if (manual) touchManualVault(id);
                  });
                  setWalletRenameFor(null);
                }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setWalletRenameFor(null)} />
            </View>
          </KeyboardAvoidingView>
        )}
        {(newSectionFor != null || addingSection) && (
          <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.overlayCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              <Text style={styles.overlayTitle}>New section</Text>
              <TextField
                label=""
                value={newSectionDraft}
                onChangeText={setNewSectionDraft}
                autoCapitalize="sentences"
                placeholder="e.g. Inheritance, Business, Cold storage"
              />
              <Button
                title={newSectionFor != null ? 'Create and move here' : 'Create'}
                disabled={!sectionNameFree(newSectionDraft.trim())}
                onPress={() => {
                  const name = newSectionDraft.trim();
                  if (newSectionFor != null) {
                    moveWalletToBlock(newSectionFor, name);
                  } else {
                    // Empty on purpose: it sits at the bottom of the list,
                    // right where the button was, ready to be dragged into
                    // or picked from a name dialog's chips.
                    setBlocks((prev) => [...prev, { key: name, walletIds: [], fresh: true }]);
                  }
                  setNewSectionFor(null);
                  setAddingSection(false);
                }}
              />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => {
                  setNewSectionFor(null);
                  setAddingSection(false);
                }}
              />
            </View>
          </KeyboardAvoidingView>
        )}
        {deleteFor != null && (
          <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.overlayCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              <Text style={styles.overlayTitle}>
                {isSharedViewer(walletById.get(deleteFor))
                  ? 'Leave this portfolio?'
                  : walletById.get(deleteFor)?.manual
                    ? 'Delete this portfolio?'
                    : 'Delete this vault?'}
              </Text>
              <Text style={styles.deleteBody}>
                {isSharedViewer(walletById.get(deleteFor)) ? (
                  <>
                    This removes “{walletById.get(deleteFor)?.label ?? 'this portfolio'}”
                    from this phone. The owner's portfolio is untouched, and a new
                    invite brings it back.
                  </>
                ) : walletById.get(deleteFor)?.manual ? (
                  <>
                    {/* A manual wallet's entries exist NOWHERE else — no chain
                        can give them back. The reassurance used for a watch-only
                        vault ("your funds are untouched") would be a lie here. */}
                    This removes “{walletById.get(deleteFor)?.label ?? 'this vault'}”
                    and every buy and sell you recorded in it. They cannot be recovered.
                  </>
                ) : (
                  <>
                    This removes “{walletById.get(deleteFor)?.label ?? 'this vault'}”
                    from Talia. Your coins on-chain are untouched.
                  </>
                )}
              </Text>
              <TextField
                label="Type DELETE to confirm"
                value={deleteDraft}
                onChangeText={setDeleteDraft}
                autoCapitalize="characters"
                placeholder="DELETE"
              />
              <Button
                title={isSharedViewer(walletById.get(deleteFor)) ? 'Leave' : walletById.get(deleteFor)?.manual ? 'Delete portfolio' : 'Delete vault'}
                disabled={deleteDraft.trim() !== 'DELETE' || shareBusy}
                loading={shareBusy}
                onPress={() => {
                  const id = deleteFor;
                  const w = walletById.get(id);
                  const manual = !!w?.manual;
                  const finish = () => {
                    setDeleteFor(null);
                    setDeleteDraft('');
                    setShareChoice(null);
                    // Drop it from the in-progress arrangement too, so the row
                    // disappears immediately and Done doesn't re-order a ghost.
                    setBlocks((prev) =>
                      prev.map((b) => ({ ...b, walletIds: b.walletIds.filter((x) => x !== id) })),
                    );
                    // A portfolio's entries exist nowhere else: the same two
                    // calls the Portfolio tab's own delete made, in this order.
                    // removeWallet also drops a shared portfolio's key.
                    if (manual) void clearManualEntries(id);
                    void removeWallet(id);
                  };
                  const share = w?.sharedPortfolio;
                  if (!share || share.ended || !shareChoice || shareChoice === 'local') {
                    finish();
                    return;
                  }
                  // The share changes on the server ONLY now, after DELETE.
                  setShareBusy(true);
                  void (async () => {
                    try {
                      const session = await loadSession();
                      if (!session) throw new Error('logged out');
                      if (shareChoice === 'stopAll') await deleteShare(session, share.shareId);
                      else await leaveShare(session, share.shareId);
                      finish();
                    } catch {
                      setShareFailedFor(id);
                    } finally {
                      setShareBusy(false);
                    }
                  })();
                }}
              />
              <Button
                title="Cancel"
                variant="ghost"
                disabled={shareBusy}
                onPress={() => {
                  setDeleteFor(null);
                  setDeleteDraft('');
                  setShareChoice(null);
                }}
              />
            </View>
          </KeyboardAvoidingView>
        )}
        {shareAskFor != null && (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              <Text style={styles.overlayTitle}>
                {walletById.get(shareAskFor)?.sharedPortfolio?.role === 'owner'
                  ? `“${walletById.get(shareAskFor)?.label ?? 'This portfolio'}” is shared`
                  : `Leave “${walletById.get(shareAskFor)?.label ?? 'this portfolio'}”?`}
              </Text>
              {walletById.get(shareAskFor)?.sharedPortfolio?.role === 'owner' ? (
                <>
                  <Button
                    title="Stop sharing for everyone"
                    onPress={() => {
                      const id = shareAskFor;
                      setShareAskFor(null);
                      setShareChoice('stopAll');
                      setDeleteFor(id);
                    }}
                  />
                  <Button
                    title="Remove from this phone only"
                    variant="ghost"
                    onPress={() => {
                      const id = shareAskFor;
                      setShareAskFor(null);
                      setShareChoice('local');
                      setDeleteFor(id);
                    }}
                  />
                </>
              ) : (
                <Button
                  title="Leave and remove"
                  onPress={() => {
                    const id = shareAskFor;
                    setShareAskFor(null);
                    setShareChoice('leave');
                    setDeleteFor(id);
                  }}
                />
              )}
              <Button title="Cancel" variant="ghost" onPress={() => setShareAskFor(null)} />
            </View>
          </View>
        )}
        {shareFailedFor != null && (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              <Text style={styles.overlayTitle}>Could not reach 21st Capital</Text>
              <Button
                title="Remove from this phone anyway"
                onPress={() => {
                  const id = shareFailedFor;
                  setShareFailedFor(null);
                  setDeleteFor(null);
                  setDeleteDraft('');
                  setShareChoice(null);
                  setBlocks((prev) =>
                    prev.map((b) => ({ ...b, walletIds: b.walletIds.filter((x) => x !== id) })),
                  );
                  if (walletById.get(id)?.manual) void clearManualEntries(id);
                  void removeWallet(id);
                }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setShareFailedFor(null)} />
            </View>
          </View>
        )}
      </View>
    </AppModal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.hull, paddingHorizontal: theme.spacing.lg },
  listWrap: { flex: 1 },
  // Left-aligned like every page title (decided 2026-10-05).
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  hint: {
    ...theme.typography.caption,
    color: theme.colors.slate,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  list: { flex: 1 },

  headerRow: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  headerText: { ...theme.typography.heading, color: theme.colors.offWhite },
  emptyHint: { ...theme.typography.caption, color: theme.colors.faint },
  walletRow: {
    height: WALLET_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: WALLET_GAP,
  },
  handle: {
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  walletNameBtn: { flex: 1 },
  // A portfolio shared WITH this phone: its name and icon are the owner's.
  textReadOnly: { color: theme.colors.faint },
  overlayLabel: {
    ...theme.typography.label,
    color: theme.colors.slate,
    marginTop: theme.spacing.xs,
  },
  sectionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  sectionChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  sectionChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  sectionChipText: { ...theme.typography.body, color: theme.colors.offWhite },
  sectionChipTextOn: { ...theme.typography.bodyStrong, color: theme.colors.accentInk },
  overlayHint: { ...theme.typography.caption, color: theme.colors.faint },
  walletText: { ...theme.typography.heading, color: theme.colors.offWhite },
  trashBtn: { paddingHorizontal: theme.spacing.xs, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  deleteBody: { ...theme.typography.body, color: theme.colors.slate },
  // The row under the finger: above the rest, with a shadow; a wallet row
  // also lifts to the raised surface. In colour, never an opacity (which a
  // native drag can leave behind on a later frame).
  lifted: {
    zIndex: 10,
    elevation: 10,
    shadowColor: theme.colors.black,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  walletLifted: { backgroundColor: theme.colors.surfaceRaised },
  slotLine: { borderTopWidth: 2, borderTopColor: theme.colors.accent },
  footer: { paddingVertical: theme.spacing.lg },
  renameLink: { ...theme.typography.label, color: theme.colors.slate },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  glassTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
  overlayCard: {
    overflow: 'hidden',
    alignSelf: 'stretch',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  // A dialog title, the same size as every other dialog's (decided 2026-09-14).
  overlayTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    justifyContent: 'center',
  },
}));
