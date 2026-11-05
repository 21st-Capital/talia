/**
 * Whether a local pending record may be deleted on a refresh.
 *
 * This decides the fate of the ONLY copy of a client's signed transaction,
 * so it is a pure function with tests rather than a condition inside a
 * screen. Decided 2026-09-18: "The user should not lose his pending valid
 * signature even after we reject it! Maybe the first key is at home and he
 * has to travel to another place."
 */
export interface PruneInput {
  /** False for a spend parked on the client's own device: never ours to drop. */
  isCosignRequest: boolean;
  /** When the local record was written. */
  createdAt: number;
  /** The server's row for it, or undefined when the list does not carry it. */
  serverStatus?: string;
  /** The server returned a full page, so absence may only mean "scrolled off". */
  windowFull: boolean;
  /** Creation time of the oldest row still visible on the server. */
  oldestServerTs: number;
}

export function shouldDropPendingRecord(input: PruneInput): boolean {
  const { isCosignRequest, createdAt, serverStatus, windowFull, oldestServerTs } = input;
  // The client's own half-signed spend has no server record by design.
  if (!isCosignRequest) return false;
  if (serverStatus === undefined) {
    // Absence proves deletion only for records newer than what we can see.
    if (windowFull && createdAt < oldestServerTs) return false;
    return true;
  }
  // REJECTED is deliberately kept. It is the answer to something the client
  // asked for, and the record still carries their own signature: they may
  // finish the spend with another of their keys days later, which is the
  // whole point of holding more than one. They clear it themselves.
  return serverStatus === 'completed' || serverStatus === 'cancelled';
}
