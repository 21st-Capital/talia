/**
 * Estate Plan — instant PDF + per-heir delivery (decided 2026-07-26).
 *
 * Staff approval is retired: the plan is the client's own data rendered
 * back to them, so the PDF is downloadable the moment the form is
 * submitted. Sharing it with an heir opens a drafted email in the owner's
 * DEFAULT mail app (decided 2026-08-28: Apple's attachment composer is
 * hard-wired to Apple Mail and ignored a Gmail default, so the draft now
 * goes through a mailto: link, which iOS routes to whatever the owner
 * chose). mailto: cannot carry an attachment; the owner adds the saved PDF
 * in the draft, and the success screen says so. Nothing is emailed by
 * 21st Capital on the client's behalf.
 */
import { Linking } from 'react-native';

import { INHERITANCE_PDF_URL, authHeaders } from './companyAuth';
import type { CompanySession } from './companyAuth';
import { downloadAndShareFile } from '../platform/files';

const FILENAME = '21st-Capital-Estate-Plan.pdf';

/** Save / AirDrop / print the plan via the system share sheet. */
export async function shareEstatePlanPdf(session: CompanySession): Promise<void> {
  await downloadAndShareFile(
    INHERITANCE_PDF_URL,
    authHeaders(session),
    FILENAME,
    'application/pdf',
  );
}

/**
 * NOT WIRED since 2026-08-29. The Estate Plan success page used to draft one
 * of these per heir; that was replaced with the heir INVITE, which is what
 * actually lets an heir reach the vault. Kept because it works and because
 * "send my plan to someone" is a reasonable thing to want back; delete it if
 * that day does not come.
 */
/**
 * Open a drafted email to ONE heir in the owner's DEFAULT mail app.
 * `sent` here means the draft opened; mailto: cannot report an actual send.
 */
export async function emailEstatePlanToHeir(
  _session: CompanySession,
  heir: { name?: string; email: string },
  ownerName?: string,
): Promise<{ sent: boolean }> {
  const from = (ownerName ?? '').trim();
  const greeting = heir.name?.trim() ? `Hello ${heir.name.trim()},` : 'Hello,';
  const body =
    `${greeting}\n\n` +
    `${from ? `${from} has` : 'I have'} named you in a comprehensive Estate ` +
    `Plan for a Bitcoin vault held with 21st Capital. The plan document (a ` +
    `PDF) comes with this email or follows separately.\n\n` +
    `Please keep it somewhere safe. It explains, step by step, what you are ` +
    `entitled to and exactly how to get access when the time comes. The ` +
    `document holds no keys and cannot move any funds on its own.\n\n` +
    `Tip: searching your mailbox for "Bitcoin Estate Plan" will find this ` +
    `again years from now.\n`;
  const url =
    `mailto:${encodeURIComponent(heir.email)}` +
    `?subject=${encodeURIComponent('Your Bitcoin Estate Plan from 21st Capital')}` +
    `&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
  try {
    await Linking.openURL(url);
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
