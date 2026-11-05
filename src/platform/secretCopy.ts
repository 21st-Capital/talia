/**
 * How long each kind of secret stays on the pasteboard, and whether it may
 * travel to the owner's other Apple devices (decided 2026-09-26). Pure, tested.
 *
 * Account secrets and invite codes never leave the phone: the two-factor key
 * and the recovery codes are pasted into an app on this phone, and an invite
 * code travels in the message the owner writes here. A vault's descriptor or
 * account key is often pasted into Liana or Sparrow on a computer, so it may
 * use Universal Clipboard, but it expires like the rest.
 */
export type SecretKind = 'accountSecret' | 'inviteCode' | 'vaultKeys';

export const SECRET_COPY_POLICY: Record<SecretKind, { localOnly: boolean; expiresInSeconds: number }> = {
  accountSecret: { localOnly: true, expiresInSeconds: 120 },
  inviteCode: { localOnly: true, expiresInSeconds: 120 },
  vaultKeys: { localOnly: false, expiresInSeconds: 120 },
};
