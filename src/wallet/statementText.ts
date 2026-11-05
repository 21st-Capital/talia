/**
 * What the account statement says, in English and German (decided 2026-08-28).
 *
 * The app itself is English only; this covers the STATEMENT, because that is
 * the document a client hands to an accountant or a bank. The choice is made
 * per statement on the create screen, so a German client can file German
 * paperwork without the whole app changing language.
 *
 * The issuer block is not copy: those are 21st Capital's published legal
 * details, taken from the company's own legal page. Never invent them.
 */

export type StatementLang = 'en' | 'de';

/** The company behind Talia, as published on 21stcapital.com/legal. */
export const ISSUER = {
  brand: 'Talia',
  poweredBy: 'powered by 21st Capital',
  legalName: 'Twenty First Capital Cyber Security Consultancy L.L.C',
  addressLine1: '36 Al Hamiriya St - Abu Hail',
  addressLine2: 'Al Aber Real Estate Building 01 - 1F-01 Office A-19',
  country: 'Dubai, UAE',
  licenseNo: '1466284',
  email: 'contact@21stcapital.com',
  web: '21stcapital.com',
} as const;

interface StatementStrings {
  title: string;
  generatedOn: string;
  licenseLabel: string;
  vault: string;
  policy: string;
  network: string;
  accountNumber: string;
  balanceOn: string;
  summaryTitle: string;
  openingBalance: string;
  closingBalance: string;
  moneyIn: string;
  moneyOut: string;
  fees: string;
  transactions: string;
  colDate: string;
  colType: string;
  colAmount: string;
  colFee: string;
  colBalance: string;
  colTxid: string;
  colTime: string;
  colStatus: string;
  colNote: string;
  colAmountSats: string;
  colFeeSats: string;
  colBalanceSats: string;
  received: string;
  sent: string;
  refresh: string;
  pending: string;
  confirmed: string;
  refreshDay: (n: number) => string;
  noTransactions: string;
  from: string;
  until: string;
  // ─ Portfolio statement ─
  portfolioTitle: string;
  portfolio: string;
  currency: string;
  costBasis: string;
  costBasisAverage: string;
  bought: string;
  sold: string;
  totalBought: string;
  totalSold: string;
  totalPaid: string;
  totalReceived: string;
  entries: string;
  colValue: string;
  /** Where an entry's bitcoin was bought or sold (decided 2026-10-22). */
  colSource: string;
  /** The "Peer to peer" source, in the statement's language. */
  peerToPeer: string;
  noEntries: string;
  /** Said when some entries were recorded in another currency. */
  otherCurrencyNote: (n: number, currency: string) => string;
  keptByHand: string;
  /** Said on the document itself: this is not a vault Talia watches. */
  virtualNotice: string;
  virtualPortfolio: string;
  kind: string;
  footerNote: string;
  legalLine: string;
  /** The same line for a portfolio, which is kept by hand, not on-chain. */
  legalLinePortfolio: string;
  help: string;
  page: (n: number, total: number) => string;
  /** Long-form date, e.g. "28 August 2026" / "28. August 2026". */
  longDate: (iso: string) => string;
  allTime: string;
}

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** ISO (YYYY-MM-DD) → long form. Falls back to the input when unparseable so
 *  a statement never prints an empty period. */
function longDate(iso: string, months: readonly string[], german: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const day = Number(m[3]);
  const month = months[Number(m[2]) - 1] ?? m[2];
  return german ? `${day}. ${month} ${m[1]}` : `${day} ${month} ${m[1]}`;
}

const EN: StatementStrings = {
  title: 'Vault account statement',
  generatedOn: 'Generated on',
  licenseLabel: 'Commercial License No.',
  vault: 'Vault',
  policy: 'Signing policy',
  network: 'Network',
  accountNumber: 'Account number',
  balanceOn: 'Balance on',
  summaryTitle: 'STATEMENT SUMMARY',
  openingBalance: 'Opening balance',
  closingBalance: 'Closing balance',
  moneyIn: 'Total received',
  moneyOut: 'Total sent',
  fees: 'Network fees paid',
  transactions: 'Transactions',
  colDate: 'DATE',
  colType: 'TYPE',
  colAmount: 'AMOUNT',
  colFee: 'FEE',
  colBalance: 'BALANCE',
  colTxid: 'TRANSACTION ID',
  colTime: 'Time',
  colStatus: 'Status',
  colNote: 'Note',
  colAmountSats: 'Amount (sats)',
  colFeeSats: 'Fee (sats)',
  colBalanceSats: 'Balance (sats)',
  received: 'Received',
  sent: 'Sent',
  refresh: 'Refresh',
  pending: 'Pending',
  confirmed: 'Confirmed',
  refreshDay: (n) => `${n} refresh ${n === 1 ? 'transaction' : 'transactions'}, fees combined`,
  noTransactions: 'No transactions in this period.',
  from: 'From',
  until: 'Until',
  portfolioTitle: 'Portfolio statement',
  portfolio: 'Portfolio',
  currency: 'Currency',
  costBasis: 'Cost basis',
  costBasisAverage: 'Average cost',
  bought: 'Bought',
  sold: 'Sold',
  totalBought: 'Total bought',
  totalSold: 'Total sold',
  totalPaid: 'Total paid',
  totalReceived: 'Total received',
  entries: 'Entries',
  colValue: 'VALUE',
  colSource: 'Source',
  peerToPeer: 'Peer to peer',
  noEntries: 'No entries in this period.',
  otherCurrencyNote: (n, currency) =>
    `${n} ${n === 1 ? 'entry was' : 'entries were'} recorded in another currency and converted to ${currency} at that day's rate.`,
  keptByHand:
    'Kept by hand in Talia. VALUE is the total paid or received for that entry, in the currency it was recorded in.',
  virtualNotice:
    'This is a virtual portfolio, not an on-chain vault. The balance is a record kept by hand and is not held or verified by Talia on the Bitcoin blockchain.',
  virtualPortfolio: 'Virtual portfolio',
  kind: 'Type',
  footerNote:
    'All amounts in BTC and shown as the vault’s own net change. A refresh moves coins back to itself.',
  legalLine: `Talia is a self-custodial Bitcoin wallet by ${ISSUER.legalName}, ${ISSUER.country}, Commercial License No. ${ISSUER.licenseNo}. 21st Capital never holds your coins and never has your vault’s descriptor, so it cannot move them. Only if you request a rescue and share the descriptor with us can we help move them. This statement is generated from the Bitcoin blockchain and is not tax advice.`,
  legalLinePortfolio: `Talia is a self-custodial Bitcoin wallet by ${ISSUER.legalName}, ${ISSUER.country}, Commercial License No. ${ISSUER.licenseNo}. A portfolio is a record the owner keeps by hand: the figures are what was entered, not what was verified on the Bitcoin blockchain. This statement is not tax advice.`,
  help: `Need help? Write to ${ISSUER.email} or visit ${ISSUER.web}`,
  page: (n, total) => `Page ${n} of ${total}`,
  longDate: (iso) => longDate(iso, MONTHS_EN, false),
  allTime: 'All time',
};

const DE: StatementStrings = {
  title: 'Kontoauszug des Vaults',
  generatedOn: 'Erstellt am',
  licenseLabel: 'Gewerbelizenz-Nr.',
  vault: 'Vault',
  policy: 'Signaturregel',
  network: 'Netzwerk',
  accountNumber: 'Kontonummer',
  balanceOn: 'Kontostand am',
  summaryTitle: 'ZUSAMMENFASSUNG',
  openingBalance: 'Anfangsbestand',
  closingBalance: 'Endbestand',
  moneyIn: 'Erhalten insgesamt',
  moneyOut: 'Gesendet insgesamt',
  fees: 'Gezahlte Netzwerkgebühren',
  transactions: 'Transaktionen',
  colDate: 'DATUM',
  colType: 'ART',
  colAmount: 'BETRAG',
  colFee: 'GEBÜHR',
  colBalance: 'SALDO',
  colTxid: 'TRANSAKTIONS-ID',
  colTime: 'Uhrzeit',
  colStatus: 'Status',
  colNote: 'Notiz',
  colAmountSats: 'Betrag (Sats)',
  colFeeSats: 'Gebühr (Sats)',
  colBalanceSats: 'Saldo (Sats)',
  received: 'Erhalten',
  sent: 'Gesendet',
  refresh: 'Auffrischung',
  pending: 'Ausstehend',
  confirmed: 'Bestätigt',
  refreshDay: (n) => `${n} ${n === 1 ? 'Auffrischung' : 'Auffrischungen'}, Gebühren zusammengefasst`,
  noTransactions: 'Keine Transaktionen in diesem Zeitraum.',
  from: 'Ab',
  until: 'Bis',
  portfolioTitle: 'Portfolio-Kontoauszug',
  portfolio: 'Portfolio',
  currency: 'Währung',
  costBasis: 'Kostenbasis',
  costBasisAverage: 'Durchschnittskosten',
  bought: 'Gekauft',
  sold: 'Verkauft',
  totalBought: 'Gekauft insgesamt',
  totalSold: 'Verkauft insgesamt',
  totalPaid: 'Gezahlt insgesamt',
  totalReceived: 'Erhalten insgesamt',
  entries: 'Einträge',
  colValue: 'WERT',
  colSource: 'Quelle',
  peerToPeer: 'Peer-to-Peer',
  noEntries: 'Keine Einträge in diesem Zeitraum.',
  otherCurrencyNote: (n, currency) =>
    `${n} ${n === 1 ? 'Eintrag wurde' : 'Einträge wurden'} in einer anderen Währung erfasst und zum Kurs des jeweiligen Tages in ${currency} umgerechnet.`,
  keptByHand:
    'Von Hand in Talia geführt. WERT ist der für diesen Eintrag gezahlte oder erhaltene Gesamtbetrag, in der erfassten Währung.',
  virtualNotice:
    'Dies ist ein virtuelles Portfolio, kein On-Chain-Vault. Der Bestand ist eine von Hand geführte Aufzeichnung und wird von Talia nicht auf der Bitcoin-Blockchain gehalten oder geprüft.',
  virtualPortfolio: 'Virtuelles Portfolio',
  kind: 'Art',
  footerNote:
    'Alle Beträge in BTC und als eigene Bestandsänderung des Vaults dargestellt. Eine Auffrischung sendet die Coins an den Vault selbst zurück.',
  legalLine: `Talia ist eine selbstverwahrende Bitcoin-Wallet von ${ISSUER.legalName}, ${ISSUER.country}, Gewerbelizenz-Nr. ${ISSUER.licenseNo}. 21st Capital verwahrt Ihre Coins nicht und hat den Deskriptor Ihres Vaults nie, kann sie also nicht bewegen. Nur wenn Sie eine Rettung anfordern und uns den Deskriptor mitteilen, können wir beim Bewegen helfen. Dieser Auszug wird aus der Bitcoin-Blockchain erstellt und ist keine Steuerberatung.`,
  legalLinePortfolio: `Talia ist eine selbstverwahrende Bitcoin-Wallet von ${ISSUER.legalName}, ${ISSUER.country}, Gewerbelizenz-Nr. ${ISSUER.licenseNo}. Ein Portfolio wird vom Eigentümer von Hand geführt: die Zahlen sind die erfassten Angaben, nicht auf der Bitcoin-Blockchain geprüfte Werte. Dieser Auszug ist keine Steuerberatung.`,
  help: `Fragen? Schreiben Sie an ${ISSUER.email} oder besuchen Sie ${ISSUER.web}`,
  page: (n, total) => `Seite ${n} von ${total}`,
  longDate: (iso) => longDate(iso, MONTHS_DE, true),
  allTime: 'Gesamter Zeitraum',
};

export function statementStrings(lang: StatementLang): StatementStrings {
  return lang === 'de' ? DE : EN;
}

export type { StatementStrings };
