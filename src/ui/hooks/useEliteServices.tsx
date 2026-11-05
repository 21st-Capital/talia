/**
 * What Elite Services holds for this client (decided 2026-09-21), read in one
 * place for the two screens that ask: the Settings list decides whether to
 * show its Elite Services row and what its line says, and the Elite Services
 * page lists the services themselves.
 *
 * Co-signing limits: every build that co-signs. Vault owners: the PAYER's
 * row (decided 2026-09-20), only once the backend lists vaults of a plan of the
 * client's own; unknown = hidden. The setup meeting: a vault somebody else
 * pays for, where the vault list's first-run card is not already offering
 * it (the same rule Settings used before this moved here).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HWW_ENABLED, LEDGER_PREVIEW, SIGNING_ENABLED } from '../../config';
import { fetchKeyEntitlement, loadSession } from '../../services/companyAuth';
import type { CompanySession, KeyEntitlement } from '../../services/companyAuth';
import { OWNERS_COPY, fetchVaultHolders, hasOwnPlanSlots } from '../../services/vaultHolders';
import {
  SETUP_MEETING_COPY,
  bookedMomentFor,
  firstRunCardShows,
  setupMeetingFor,
} from '../../services/setupMeeting';
import type { SetupMeetingOffer } from '../../services/setupMeeting';
import { loadVisibleClaimedInvites, maybeReconcileClaimedInvites } from '../../services/heirInvite';
import { useWallets } from '../../wallet';
import { useSetupMeetingSheet } from './useSetupMeetingSheet';
import { ELITE_COPY, eliteSummary } from '../screens/eliteServicesCopy';

type Focusable = { addListener: (type: 'focus', cb: () => void) => () => void };

export interface EliteServices {
  session: CompanySession | null;
  /** Co-signing limits (every build that co-signs). */
  limits: boolean;
  /** Vault owners: the client's plan has vaults to give. */
  owners: boolean;
  /** The setup meeting to book, or null. */
  meeting: SetupMeetingOffer | null;
  /** A meeting booked right here, until the backend reports it. */
  meetingBookedMs: number | null;
  openMeeting: () => void;
  /** The booking sheet; the screen that opens it renders it. */
  sheet: React.JSX.Element | null;
  /** How many services the page holds; 0 hides the Settings row. */
  count: number;
  /** "Co-signing limits, vault owners and setup meeting". */
  summary: string;
  /** Ask again (after a sign-in or a sign-out). */
  reload: () => void;
}

export function useEliteServices(navigation: Focusable): EliteServices {
  const [session, setSession] = useState<CompanySession | null>(null);
  const [ownPlanSlots, setOwnPlanSlots] = useState(false);
  const [entitlement, setEntitlement] = useState<KeyEntitlement | null>(null);
  const [sealedInvites, setSealedInvites] = useState(0);
  const live = useRef(true);

  const reload = useCallback(() => {
    void loadSession().then((s) => {
      if (!live.current) return;
      setSession(s);
      if (!s) {
        setOwnPlanSlots(false);
        setEntitlement(null);
        setSealedInvites(0);
        return;
      }
      fetchVaultHolders(s)
        .then((page) => live.current && setOwnPlanSlots(hasOwnPlanSlots(page)))
        .catch(() => {
          // offline or an older backend: keep what the last answer said
        });
      fetchKeyEntitlement(s)
        .then((ent) => live.current && setEntitlement(ent))
        .catch(() => {
          // offline: the row simply stays as the last answer left it
        });
      // Local first, then the same throttled server reconcile the vault list
      // runs, so the two screens agree on whether the first-run card shows.
      loadVisibleClaimedInvites(s.email)
        .then((rows) => live.current && setSealedInvites(rows.length))
        .catch(() => {});
      maybeReconcileClaimedInvites()
        .then((fresh) => {
          if (live.current && fresh) setSealedInvites(fresh.length);
        })
        .catch(() => {});
    });
  }, []);

  useEffect(() => {
    live.current = true;
    const unsub = navigation.addListener('focus', reload);
    reload();
    return () => {
      live.current = false;
      unsub();
    };
  }, [navigation, reload]);

  const { wallets } = useWallets();
  const setupSheet = useSetupMeetingSheet();
  const onChainWallets = useMemo(() => wallets.filter((w) => !w.manual), [wallets]);
  const meeting = useMemo(() => {
    if (!session) return null;
    if (
      firstRunCardShows({
        canBuild: SIGNING_ENABLED || HWW_ENABLED,
        vaultsOnPhone: onChainWallets.length,
        sealedInvites,
        heirSurface: SIGNING_ENABLED || LEDGER_PREVIEW,
      })
    ) {
      return null;
    }
    return setupMeetingFor(entitlement);
  }, [session, entitlement, onChainWallets, sealedInvites]);

  const limits = !!session && (SIGNING_ENABLED || LEDGER_PREVIEW);
  const owners = limits && ownPlanSlots;
  const labels = [
    ...(limits ? [ELITE_COPY.limits] : []),
    ...(owners ? [OWNERS_COPY.title] : []),
    ...(meeting ? [SETUP_MEETING_COPY.title] : []),
  ];
  return {
    session,
    limits,
    owners,
    meeting,
    meetingBookedMs: bookedMomentFor(meeting, setupSheet.justBooked),
    openMeeting: () => {
      if (meeting) setupSheet.open(meeting);
    },
    sheet: setupSheet.sheet,
    count: labels.length,
    summary: eliteSummary(labels),
    reload,
  };
}
