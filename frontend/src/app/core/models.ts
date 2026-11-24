export type AccType = 'party' | 'dealer' | 'stock' | 'cash' | 'bank' | 'expense' | 'capital';
export type PayMode = 'bank' | 'shop' | 'home';
export type Role = 'super' | 'master' | 'user';
export type Page = 'bill' | 'pay' | 'jv' | 'sheet' | 'daily' | 'ledger';

export interface Account { type: AccType; phone?: string; }
export interface Bank { name: string; acno: string; ifsc: string; comm: number; }
export interface Dealer { name: string; comm: number; }

/** One line of a bill. Purchase: prate>0, srate=0. Sale: srate>0, prate=0. */
export interface BillRow {
  desc: string; cur: string; base: string; qty: number;
  prate: number; srate: number; stock: string;
  mode: PayMode; bank: string; dealer: string; comm: number;
}
export interface Bill { id: string; no: string; date: string; rows: BillRow[]; }

export interface JvLink { bill: string; line: number; comm?: boolean; }
/** Every money movement (voucher line, payment, receipt, commission, capital). */
export interface Jv {
  id: string; no: number; vno: string; date: string; type: string;
  desc: string; dr: string; cr: string; cur: string; amt: number;
  note: string; mode: string; bank: string; dealer?: string; person?: string; ref?: string;
  link?: JvLink;
}

export interface UserRow { id: number; name: string; role: Role; pages: Page[]; }

export interface Book {
  base: string; currencies: string[]; stockOf: Record<string, string>;
  payComm: { bank: number; shop: number; home: number }; lastMode: PayMode;
  valRate: Record<string, number>; hasDelPin: boolean; nextBill: number;
  accounts: Record<string, Account>; banks: Bank[]; dealers: Dealer[];
  bills: Bill[]; jv: Jv[]; users?: UserRow[];
}

export interface Posting { date: string; ref: string; acct: string; cur: string; dr: number; cr: number; txt: string; }

export const TYPES: Record<AccType, string> = {
  party: 'Party', dealer: 'Delivery dealer', stock: 'Stock / wallet', cash: 'Cash in hand',
  bank: 'Bank', expense: 'Expense', capital: 'Capital',
};
export const PMODES: Record<string, string> = { bank: 'Bank', shop: 'Shop cash', home: 'Home delivery' };
export const MIC: Record<string, string> = { bank: '🏦', shop: '🏪', home: '🏠' };
export const VM: Record<string, string> = { cash: 'Cash', hand: 'Hand cash', bank: 'Bank', shop: 'Shop cash', home: 'Home delivery' };
/** Cash Book modes: Cash → CASH, Hand cash → HAND CASH (its own cash account), Bank → the chosen bank. */
export type CbMode = 'cash' | 'hand' | 'bank';
export const HAND_CASH = 'HAND CASH';
export const JTYPES: Record<string, string> = {
  receipt: 'Receipt', payment: 'Payment', transfer: 'Transfer', expense: 'Expense',
  journal: 'Journal', capital: 'Capital', out: 'OUT', in: 'IN',
};
export const PAGES: [Page, string][] = [
  ['bill', '🧾 Bill entry'], ['pay', '💳 Bills & payments'], ['jv', '💵 Cash Book'],
  ['sheet', '⚖️ Balance'], ['daily', '📅 Daily'], ['ledger', '📒 Ledger'],
];
