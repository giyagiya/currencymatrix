/**
 * Remit calculation engine – a line-by-line TypeScript port of the original app.
 * Everything (balances, balance sheet, profit, daily summary, ledger) is worked out from the Book.
 */
import { Book, Bill, BillRow, Jv, Posting, AccType, JTYPES, VM } from './models';
import { r2, num, U, m } from './fmt';

export interface SheetFilter { to?: string; acct?: string; typ?: string; cur?: string; }
export interface SheetRow { a: string; b: number; t: AccType; }
export interface SheetBlock {
  cur: string; rows: SheetRow[]; dr: number; cr: number; os: number; cash: number; bank: number;
  total: number; cos: number; exp: number; cap: number; net: number; profit: number;
}
export interface ProfitPart { cur: string; net: number; rate: number; inBase: number; }
export interface DayRow { d: string; bills: Record<string, 1>; pur: number; sale: number; paid: number; recv: number; comm: number; exp: number; profit: number | null; diff: number; }
export interface DayPerson { n: string; pur: number; sale: number; paid: number; recv: number; pq: string[]; sq: string[]; bal: number; }
export interface LedgerLine { date: string; ref: string; txt: string; dr: number; cr: number; run: number; }
export interface LedgerBlock { cur: string; open: number; lines: LedgerLine[]; td: number; tc: number; close: number; }
export interface JvView { desc: string; dir: 'in' | 'out' | 'exp'; mode: string; bank: string; other: string; rem: string; }

export class Engine {
  constructor(public S: Book) {}

  accType(n: string): AccType { return this.S.accounts[n]?.type || 'party'; }
  invCur(c: string) { return c === this.S.base; }
  rowSide(r: BillRow): 'p' | 's' { return num(r.prate) > 0 ? 'p' : 's'; }
  rowRate(r: BillRow) { return num(r.prate) || num(r.srate); }
  rowAmt(r: BillRow) { return r2(num(r.qty) * this.rowRate(r)); }
  rowComm(r: BillRow) { return r2(this.rowAmt(r) * num(r.comm) / 100000); }
  /** "Currency in whose hand": a bill line books two things.
   *  Rupees (the amount) – always the party (we owe them / they owe us); its Pay / Receive settles the party. */
  rowAcct(r: BillRow) { return r.desc; }
  /** The currency – in the hand of the Stock place (e.g. MY SGD COMPANY) when Stock is filled, otherwise the party's own hand. */
  rowStock(r: BillRow) { return r.stock || r.desc; }
  /** The currencies a stock company keeps (e.g. MY SGD COMPANY → SGD): from Setup → Stock for each currency, or else from
   *  the currencies of its bill lines. Empty = not tied to a currency (parties such as KUMAR can hold any currency). */
  stockCurs(name: string): string[] {
    const n = U(name); if (!n) return [];
    const so = this.S.stockOf || {}, set = Object.keys(so).filter(c => U(so[c]) === n);
    if (set.length) return set;
    if (this.accType(n) !== 'stock') return [];
    const curs = new Set<string>();
    this.S.bills.forEach(b => b.rows.forEach(r => { if (U(r.stock) === n) curs.add(r.cur); }));
    return [...curs];
  }
  rateShort(cur: string, rate: number) { rate = num(rate); return this.invCur(cur) ? '÷ ' + (+(1 / rate).toFixed(6)) : '@ ' + rate; }
  allCurs() { return [this.S.base].concat(this.S.currencies.filter(c => c !== this.S.base)); }
  allAccounts() { return Object.keys(this.S.accounts).sort(); }
  bankBy(n: string) { return this.S.banks.find(b => b.name === n); }
  dealerBy(n: string) { return this.S.dealers.find(d => d.name === n); }

  postings(): Posting[] {
    const P: Posting[] = [], S = this.S;
    S.bills.forEach(b => b.rows.forEach(r => {
      const q = num(r.qty); if (!r.desc || !q) return;
      const base = r.base || S.base, ref = 'Bill ' + b.no, acct = this.rowAcct(r), stk = this.rowStock(r), away = stk !== r.desc;
      if (num(r.prate) > 0) {
        P.push({ date: b.date, ref, acct, cur: base, dr: 0, cr: r2(q * num(r.prate)), txt: 'Purchase ' + r.cur + ' ' + m(q) + ' @ ' + num(r.prate) + (away ? ' · kept at ' + stk : '') });
        P.push({ date: b.date, ref, acct: stk, cur: r.cur, dr: q, cr: 0, txt: 'Purchase from ' + r.desc + ' @ ' + num(r.prate) });
      }
      if (num(r.srate) > 0) {
        P.push({ date: b.date, ref, acct, cur: base, dr: r2(q * num(r.srate)), cr: 0, txt: 'Sale ' + r.cur + ' ' + m(q) + ' @ ' + num(r.srate) + (away ? ' · from ' + stk : '') });
        P.push({ date: b.date, ref, acct: stk, cur: r.cur, dr: 0, cr: q, txt: 'Sale to ' + r.desc + ' @ ' + num(r.srate) });
      }
    }));
    S.jv.forEach(j => {
      const t = j.type === 'exp' ? 'Expense' : j.type === 'out' ? 'Paid' : j.type === 'in' ? 'Received' : JTYPES[j.type] || 'Journal';
      const ref = j.vno ? 'Voucher ' + j.vno : t + ' ' + (j.no || '');
      P.push({ date: j.date, ref, acct: j.dr, cur: j.cur, dr: j.amt, cr: 0, txt: t + (j.note ? ' – ' + j.note : '') + ' (Cr ' + j.cr + ')' });
      P.push({ date: j.date, ref, acct: j.cr, cur: j.cur, dr: 0, cr: j.amt, txt: t + (j.note ? ' – ' + j.note : '') + ' (Dr ' + j.dr + ')' });
    });
    return P;
  }

  /** balances()[currency][account] = debit − credit (positive = Dr = they owe us) */
  balances(to?: string): Record<string, Record<string, number>> {
    const B: Record<string, Record<string, number>> = {};
    this.postings().forEach(p => {
      if (to && p.date > to) return;
      B[p.cur] = B[p.cur] || {};
      B[p.cur][p.acct] = (B[p.cur][p.acct] || 0) + p.dr - p.cr;
    });
    return B;
  }
  curOrder(B: Record<string, unknown>) { const o = this.allCurs().slice(); Object.keys(B).forEach(c => { if (o.indexOf(c) < 0) o.push(c); }); return o; }

  /** Rate (in base currency) used to value a currency up to a date = average cost of what we still hold (moving average).
   *  Day by day: a purchase adds to the holding at its rate, a sale takes out at the current average (so sold currency
   *  no longer counts). Within one day purchases are counted before sales, so the order lines are typed in does not matter.
   *  Selling more than we hold opens a short position at the sale rate. Lines priced in this currency (e.g. INR priced in USDT) count too. */
  costRate(cur: string, to?: string) {
    const base = this.S.base, moves: { d: string; q: number; rate: number }[] = [];   // q > 0: we get the currency · q < 0: we give it
    this.S.bills.forEach(b => { if (!to || b.date <= to) b.rows.forEach(r => {
      const rb = r.base || base, qty = num(r.qty), buy = this.rowSide(r) === 'p', rate = this.rowRate(r);
      if (!qty || !(rate > 0)) return;
      if (r.cur === cur && rb === base) moves.push({ d: b.date, q: buy ? qty : -qty, rate });
      else if (rb === cur && r.cur === base) { const amt = qty * rate; moves.push({ d: b.date, q: buy ? -amt : amt, rate: qty / amt }); }
    }); });
    moves.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : (y.q > 0 ? 1 : 0) - (x.q > 0 ? 1 : 0));
    let h = 0, a = 0;
    moves.forEach(({ q, rate }) => {
      if (h === 0 || Math.sign(h) === Math.sign(q)) { a = (Math.abs(h) * a + Math.abs(q) * rate) / (Math.abs(h) + Math.abs(q)); h += q; }
      else if (Math.abs(q) <= Math.abs(h)) h += q;   // takes from the holding: average cost unchanged
      else { h += q; a = rate; }                      // goes past zero: the rest opens at this rate
      if (Math.abs(h) < 1e-9) h = 0;
    });
    return a;
  }
  /** Same rate for Total profit and Daily profit, unless a rate is set on the Balance page. */
  curRate(c: string) { return c === this.S.base ? 1 : (this.S.valRate && num(this.S.valRate[c]) ? num(this.S.valRate[c]) : this.costRate(c)); }

  /** Total profit in base currency = everything we hold (currency at its average cost) − capital. */
  totalProfit() {
    const B = this.balances(), res = { base: this.S.base, parts: [] as ProfitPart[], cap: 0, value: 0, total: 0 };
    this.curOrder(B).forEach(c => {
      const A = B[c] || {}; let net = 0, cap = 0;
      Object.keys(A).forEach(a => { const t = this.accType(a); if (t === 'capital') cap -= A[a]; else if (t !== 'expense') net += A[a]; });
      if (Math.abs(net) < 0.004 && Math.abs(cap) < 0.004) return;
      const rate = this.curRate(c);
      res.parts.push({ cur: c, net, rate, inBase: net * rate }); res.cap += cap * rate;
    });
    res.value = res.parts.reduce((x, p) => x + p.inBase, 0); res.total = res.value - res.cap;
    return res;
  }
  tpAsOf(d: string) {
    const B = this.balances(d); let tot = 0;
    Object.keys(B).forEach(c => {
      const A = B[c]; let net = 0, cap = 0;
      Object.keys(A).forEach(a => { const t = this.accType(a); if (t === 'capital') cap -= A[a]; else if (t !== 'expense') net += A[a]; });
      tot += (net - cap) * (c === this.S.base ? 1 : this.costRate(c, d));
    });
    return tot;
  }

  /** Bill lines booked to this account (in this currency) that are not fully paid yet. */
  pendingLines(acct: string, cur: string) {
    const out: { no: string; due: number }[] = [];
    this.S.bills.forEach(b => b.rows.forEach((r, i) => {
      if (this.rowAcct(r) !== acct || (r.base || this.S.base) !== cur) return;
      const ls = this.lineState(b, i); if (ls.st !== 'paid') out.push({ no: b.no, due: ls.due });
    }));
    return out;
  }
  /** All payments / receipts made against one bill line (commission entries left out), oldest first. */
  paysOf(bid: string, i: number) { return this.S.jv.filter(j => j.link && j.link.bill === bid && j.link.line === i && !j.link.comm); }
  /** Latest payment of a line (undefined = nothing paid yet). */
  payOf(bid: string, i: number) { const p = this.paysOf(bid, i); return p[p.length - 1]; }
  /** How much of a bill line is paid and what is still due. A line is settled when less than ₹1 is left. */
  lineState(b: Bill, i: number): { amt: number; paid: number; due: number; last?: Jv; st: 'pending' | 'part' | 'paid' } {
    const amt = this.rowAmt(b.rows[i]), pays = this.paysOf(b.id, i), paid = r2(pays.reduce((s, j) => s + num(j.amt), 0)), due = r2(Math.max(0, amt - paid));
    return { amt, paid, due, last: pays[pays.length - 1], st: !pays.length ? 'pending' : due < 1 ? 'paid' : 'part' };
  }
  jvKind(j: Jv): { k: string; p?: string } {
    const dt = this.accType(j.dr), ct = this.accType(j.cr), cb = (t: string) => t === 'cash' || t === 'bank', pt = (t: string) => t === 'party' || t === 'stock';
    if (j.link && j.link.comm) return { k: 'comm' };
    if (dt === 'expense') return { k: 'exp' };
    if (pt(dt) && (cb(ct) || ct === 'dealer')) return { k: 'paid', p: j.dr };
    if (pt(ct) && (cb(dt) || dt === 'dealer')) return { k: 'recv', p: j.cr };
    return { k: '' };
  }
  jvRow(j: Jv): JvView {
    const cb = (n: string) => { const t = this.accType(n); return t === 'cash' || t === 'bank'; };
    let desc: string, dir: 'in' | 'out' | 'exp', ctr: string, other = '';
    if (j.desc) { desc = j.desc; dir = j.type === 'in' ? 'in' : j.type === 'exp' ? 'exp' : 'out'; ctr = dir === 'in' ? j.dr : j.cr; }
    else if (cb(j.cr) && !cb(j.dr)) { desc = j.dr; dir = 'out'; ctr = j.cr; }
    else if (cb(j.dr) && !cb(j.cr)) { desc = j.cr; dir = 'in'; ctr = j.dr; }
    else { desc = j.dr; dir = 'out'; ctr = j.cr; }
    if (!cb(ctr)) other = ctr;
    if (dir === 'out' && this.accType(desc) === 'expense') dir = 'exp';
    const mode = j.mode && VM[j.mode] ? VM[j.mode] : (other ? 'Transfer' : this.accType(ctr) === 'bank' ? 'Bank' : 'Cash');
    const bank = this.accType(ctr) === 'bank' && !other ? ctr : '';
    const bill = j.link ? this.S.bills.find(b => b.id === j.link!.bill) : undefined;
    let rem = (j.link ? 'Bill ' + (bill ? bill.no : '') + (j.link.comm ? ' commission' : '') : '') + (j.note ? (j.link ? ' · ' : '') + j.note : '');
    rem = rem.replace(/^(Bill \S+) · \1/, '$1');
    return { desc, dir, mode, bank, other, rem };
  }

  partyBal(n: string) { return (this.balances()[this.S.base] || {})[n] || 0; }
  /** Cash in hand: cash accounts and stock / wallet companies (e.g. MY SGD COMPANY) – a wallet is cash in hand. */
  isCashLike(n: string) { const t = this.accType(n); return t === 'cash' || t === 'stock'; }
  cashNow(cur: string) { const B = this.balances()[cur] || {}; let t = 0; Object.keys(B).forEach(a => { if (this.isCashLike(a)) t += B[a]; }); return t; }
  lastRate(cur: string, base?: string) {
    let best: { d: string; r: number } | null = null;
    this.S.bills.forEach(b => b.rows.forEach(r => {
      if (r.cur === cur && (!base || (r.base || this.S.base) === base) && this.rowRate(r) > 0 && (!best || b.date >= best.d)) best = { d: b.date, r: this.rowRate(r) };
    }));
    return best ? (best as { r: number }).r : 0;
  }
  /** Rate of the latest purchase of this currency against the base currency (0 = never bought). */
  lastPRate(cur: string) {
    let d = '', rate = 0;
    this.S.bills.forEach(b => b.rows.forEach(r => {
      if (r.cur === cur && (r.base || this.S.base) === this.S.base && num(r.prate) > 0 && b.date >= d) { d = b.date; rate = num(r.prate); }
    }));
    return rate;
  }
  nextBillNo() { let mx = 0; this.S.bills.forEach(b => { const n = parseInt(b.no, 10); if (n > mx) mx = n; }); return mx + 1; }
  nextVno() { let mx = 0; this.S.jv.forEach(j => { const n = parseInt(j.vno, 10); if (n > mx) mx = n; }); return mx + 1; }
  /** paid = lines fully settled, part = lines partly paid (still pending). */
  billState(b: Bill) {
    let pd = 0, pt = 0;
    b.rows.forEach((_, i) => { const s = this.lineState(b, i).st; if (s === 'paid') pd++; else if (s === 'part') pt++; });
    return { n: b.rows.length, paid: pd, part: pt };
  }

  /** Balance sheet blocks, one per currency. */
  sheetData(f: SheetFilter = {}): SheetBlock[] {
    const B = this.balances(f.to), out: SheetBlock[] = [], q = U(f.acct), typ = f.typ || 'all', curF = f.cur || 'all';
    const typOk = (a: string) => { const t = this.accType(a); return typ === 'all' || (typ === 'cb' ? (t === 'cash' || t === 'bank') : t === typ); };
    this.curOrder(B).forEach(c => {
      if (curF !== 'all' && curF !== c) return;
      const A = B[c] || {};
      const rows = Object.keys(A).filter(a => Math.abs(A[a]) > 0.004 && (!q || a === q) && typOk(a)).map(a => ({ a, b: A[a], t: this.accType(a) }));
      if (!rows.length) return;
      rows.sort((x, y) => (Number(y.b > 0) - Number(x.b > 0)) || x.a.localeCompare(y.a));
      let dr = 0, cr = 0, os = 0, cash = 0, bank = 0, cos = 0, exp = 0, cap = 0;
      rows.forEach(r => {
        if (r.b > 0) dr += r.b; else cr -= r.b;
        if (r.t === 'cash' || r.t === 'stock') cash += r.b; else if (r.t === 'bank') bank += r.b; else if (r.t === 'expense') exp += r.b;
        else if (r.t === 'capital') cap -= r.b; else if (r.b > 0) os += r.b; else cos += r.b;
      });
      const total = os + cash + bank;
      out.push({ cur: c, rows, dr, cr, os, cash, bank, total, cos, exp, cap, net: total + cos, profit: total + cos - cap });
    });
    return out;
  }

  /** Day-wise summary (base currency). */
  dailyRows(f: { party?: string; from?: string; to?: string } = {}): DayRow[] {
    const S = this.S, days: Record<string, DayRow> = {}, P = U(f.party);
    const g = (d: string) => days[d] = days[d] || { d, bills: {}, pur: 0, sale: 0, paid: 0, recv: 0, comm: 0, exp: 0, profit: null, diff: 0 };
    S.bills.forEach(b => b.rows.forEach(r => {
      if ((r.base || S.base) !== S.base) return; if (P && this.rowAcct(r) !== P) return;
      const x = g(b.date); x.bills[b.no] = 1;
      if (num(r.prate) > 0) x.pur += r2(num(r.qty) * num(r.prate));
      if (num(r.srate) > 0) x.sale += r2(num(r.qty) * num(r.srate));
    }));
    S.jv.forEach(j => {
      if (j.cur !== S.base) return; const K = this.jvKind(j);
      if (K.k === 'paid') { if (P && K.p !== P) return; g(j.date).paid += j.amt; }
      else if (K.k === 'recv') { if (P && K.p !== P) return; g(j.date).recv += j.amt; }
      else if (K.k === 'comm' || K.k === 'exp') {
        if (P && !(j.link && S.bills.some(b => b.id === j.link!.bill && b.rows[j.link!.line] && this.rowAcct(b.rows[j.link!.line]) === P))) return;
        (g(j.date) as any)[K.k] += j.amt;
      }
    });
    const keys = Object.keys(days).sort(), allDays: Record<string, 1> = {};
    S.bills.forEach(b => allDays[b.date] = 1); S.jv.forEach(j => allDays[j.date] = 1);
    const ad = Object.keys(allDays).sort(), tpMap: Record<string, number> = {};
    ad.forEach(d => tpMap[d] = this.tpAsOf(d));
    return keys.map(d => {
      const x = days[d], i = ad.indexOf(d), before = i > 0 ? tpMap[ad[i - 1]] : 0;
      x.profit = P ? null : tpMap[d] - before; x.diff = x.sale - x.pur; return x;
    }).filter(x => (!f.from || x.d >= f.from) && (!f.to || x.d <= f.to));
  }
  dayPeople(d: string, party?: string): DayPerson[] {
    const S = this.S, P: Record<string, DayPerson> = {}, Pf = U(party);
    const g = (n: string) => P[n] = P[n] || { n, pur: 0, sale: 0, paid: 0, recv: 0, pq: [], sq: [], bal: 0 };
    S.bills.forEach(b => {
      if (b.date !== d) return;
      b.rows.forEach(r => {
        if ((r.base || S.base) !== S.base) return; if (Pf && this.rowAcct(r) !== Pf) return;
        const x = g(this.rowAcct(r)), a = r2(num(r.qty) * this.rowRate(r));
        const who = r.stock && r.stock !== r.desc ? (num(r.prate) > 0 ? ' · kept at ' : ' · from ') + r.stock : '';
        if (num(r.prate) > 0) { x.pur += a; x.pq.push(r.cur + ' ' + m(num(r.qty)) + ' ' + this.rateShort(r.cur, num(r.prate)) + who); }
        else { x.sale += a; x.sq.push(r.cur + ' ' + m(num(r.qty)) + ' ' + this.rateShort(r.cur, num(r.srate)) + who); }
      });
    });
    S.jv.forEach(j => {
      if (j.date !== d || j.cur !== S.base) return; const K = this.jvKind(j);
      if (K.k === 'paid' && (!Pf || K.p === Pf)) g(K.p!).paid += j.amt;
      else if (K.k === 'recv' && (!Pf || K.p === Pf)) g(K.p!).recv += j.amt;
    });
    const B = this.balances(d)[S.base] || {};
    return Object.keys(P).sort().map(n => { P[n].bal = B[n] || 0; return P[n]; });
  }

  /** Ledger of one account, one block per currency, with running balance. */
  ledger(acct: string, from?: string, to?: string): LedgerBlock[] {
    const a = U(acct), byC: Record<string, Posting[]> = {};
    this.postings().filter(p => p.acct === a).forEach(p => (byC[p.cur] = byC[p.cur] || []).push(p));
    return this.curOrder(byC).filter(c => byC[c]).map(c => {
      const L = byC[c].sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
      let open = 0, run: number | undefined, td = 0, tc = 0; const lines: LedgerLine[] = [];
      L.forEach(p => {
        if (from && p.date < from) { open += p.dr - p.cr; return; }
        if (to && p.date > to) return;
        run = (run === undefined ? open : run) + p.dr - p.cr; td += p.dr; tc += p.cr;
        lines.push({ date: p.date, ref: p.ref, txt: p.txt, dr: p.dr, cr: p.cr, run });
      });
      return { cur: c, open, lines, td, tc, close: run === undefined ? open : run };
    });
  }
}
