/**
 * Remit calculation engine – a line-by-line TypeScript port of the original app.
 * Everything (balances, balance sheet, profit, daily summary, ledger) is worked out from the Book.
 */
import { Book, Bill, BillRow, Jv, Posting, AccType, JTYPES, VM, CUR_ORDER } from './models';
import { r2, num, U, m } from './fmt';

/** stockOnly: each currency block shows only who holds that currency – the price side of deals is left out
 *  (INR: baseStockBalances, others: curStockBalances) */
export interface SheetFilter { to?: string; acct?: string; typ?: string; cur?: string; stockOnly?: boolean; }
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

  /** A name kept in Setup → Stock for each currency is a stock / wallet company even if it was saved as a party. */
  accType(n: string): AccType {
    const t = this.S.accounts[n]?.type || 'party';
    if (t === 'party' && n && Object.values(this.S.stockOf || {}).some(v => U(v) === n)) return 'stock';
    return t;
  }
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
  /** Base currency first, then the fixed order INR · SGD · USDT · USD · SR · MYR · AED, then any other currency in the order it was added. */
  allCurs() {
    const base = this.S.base, list = [base].concat(this.S.currencies.filter(c => c !== base));
    const rank = (c: string) => c === base ? -1 : CUR_ORDER.includes(c) ? CUR_ORDER.indexOf(c) : CUR_ORDER.length + list.indexOf(c);
    return list.sort((a, b) => rank(a) - rank(b));
  }
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
  /** The base currency (INR) as a traded currency: who holds the INR bought / sold on bill lines whose Currency is INR
   *  (e.g. INR priced in SGD, kept at INR COMPANY), and Cash Book INR moves of that INR between names (e.g. MOSI → INR COMPANY).
   *  Rupees paid / received for SGD, MYR… (bill prices, Pay / Receive, capital, expenses) are left out.
   *  A Cash Book INR line counts when one side already holds traded INR; the other side then holds it too
   *  (cash / bank never pass it on, so ordinary rupee payments stay out). */
  baseStockBalances(to?: string): Record<string, number> {
    const S = this.S, base = S.base, B: Record<string, number> = {}, add = (a: string, v: number) => { B[a] = (B[a] || 0) + v; };
    const holders = new Set<string>(), so = U((S.stockOf || {})[base] || '');
    if (so) holders.add(so);
    const passes = (n: string) => !['cash', 'bank', 'capital', 'expense'].includes(this.accType(n));
    type Ev = { date: string; k: number; run: () => void };
    const ev: Ev[] = [];
    S.bills.forEach(b => b.rows.forEach(r => {
      if (r.cur !== base || !r.desc || !num(r.qty)) return;
      const h = this.rowStock(r), q = num(r.qty);
      ev.push({ date: b.date, k: 0, run: () => { add(h, this.rowSide(r) === 'p' ? q : -q); holders.add(h); } });
    }));
    S.jv.forEach(j => {
      if (j.cur !== base || j.link) return;   // Pay / Receive of a bill line = the price side, not traded INR
      ev.push({ date: j.date, k: 1, run: () => {
        if (!holders.has(j.dr) && !holders.has(j.cr)) return;
        add(j.dr, j.amt); add(j.cr, -j.amt);
        [j.dr, j.cr].forEach(n => { if (passes(n)) holders.add(n); });
      } });
    });
    ev.filter(e => !to || e.date <= to).sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : x.k - y.k).forEach(e => e.run());
    return B;
  }
  /** Any other currency (SGD, USDT, MYR…) as held: who holds it from bill lines whose Currency it is, and Cash Book lines in it.
   *  The price side is left out – a line priced in SGD (e.g. INR priced in SGD) does not show "we owe BILAL SGD 1,250"
   *  (that is in Bills & payments). When such a price is paid / received with Pay / Receive, only our side counts:
   *  the Cash / Bank / stock place the SGD really left or came into. */
  curStockBalances(c: string, to?: string): Record<string, number> {
    const S = this.S, B: Record<string, number> = {}, add = (a: string, v: number) => { if (a) B[a] = (B[a] || 0) + v; };
    const inDate = (d: string) => !to || d <= to;
    S.bills.forEach(b => { if (inDate(b.date)) b.rows.forEach(r => {
      if (r.cur === c && r.desc && num(r.qty)) add(this.rowStock(r), this.rowSide(r) === 'p' ? num(r.qty) : -num(r.qty));
    }); });
    S.jv.forEach(j => {
      if (j.cur !== c || !inDate(j.date)) return;
      if (!j.link || j.link.comm) { add(j.dr, j.amt); add(j.cr, -j.amt); return; }
      const r = S.bills.find(b => b.id === j.link!.bill)?.rows[j.link.line], party = r ? this.rowAcct(r) : '';
      if (j.dr !== party) add(j.dr, j.amt);
      if (j.cr !== party) add(j.cr, -j.amt);
    });
    return B;
  }
  curOrder(B: Record<string, unknown>) { const o = this.allCurs().slice(); Object.keys(B).forEach(c => { if (o.indexOf(c) < 0) o.push(c); }); return o; }

  /** Rate (in base currency) used to value a currency up to a date = average cost of what we still hold (moving average).
   *  Day by day: a purchase adds to the holding at its rate, a sale takes out at the current average (so sold currency
   *  no longer counts). Within one day purchases are counted before sales, so the order lines are typed in does not matter.
   *  Selling more than we hold opens a short position at the sale rate. Lines priced in this currency (e.g. INR priced in USDT) count too. */
  costRate(cur: string, to?: string) { return this.avgCosts(to)[cur] || 0; }

  /** Moving average cost (in base currency) of every currency up to a date – one pass over all bill lines in date order.
   *  · Line priced in INR (SGD @ 80): SGD in / out at that rate.
   *  · INR bought / sold for another currency (INR priced in SGD): that currency out / in at the rupees it was worth.
   *  · Cross deal, no INR (SGD bought with USDT): the deal is worth the USDT paid at USDT's average cost (or the Balance-page
   *    rate if USDT has none yet) – SGD comes in at that cost and the USDT leaves at its own cost, so a cross deal by itself
   *    makes no profit; profit shows when the currency is later sold.
   *  Within one day: purchases first, then cross deals, then sales – so the order lines are typed in does not matter. */
  private avgMemo = new Map<string, Record<string, number>>();
  avgCosts(to?: string): Record<string, number> {
    const key = to || '';
    const hit = this.avgMemo.get(key); if (hit) return hit;
    const base = this.S.base, vr = this.S.valRate || {}, st: Record<string, { h: number; a: number }> = {};
    const g = (c: string) => st[c] = st[c] || { h: 0, a: 0 };
    const step = (c: string, q: number, rate: number) => {   // q > 0: we get the currency · q < 0: we give it
      const s = g(c);
      if (s.h === 0 || Math.sign(s.h) === Math.sign(q)) { s.a = (Math.abs(s.h) * s.a + Math.abs(q) * rate) / (Math.abs(s.h) + Math.abs(q)); s.h += q; }
      else if (Math.abs(q) <= Math.abs(s.h)) s.h += q;   // takes from the holding: average cost unchanged
      else { s.h += q; s.a = rate; }                      // goes past zero: the rest opens at this rate
      if (Math.abs(s.h) < 1e-9) s.h = 0;
    };
    const ev: { d: string; pr: number; run: () => void }[] = [];
    this.S.bills.forEach(b => { if (!to || b.date <= to) b.rows.forEach(r => {
      const rb = r.base || base, qty = num(r.qty), buy = this.rowSide(r) === 'p', rate = this.rowRate(r);
      if (!qty || !(rate > 0) || r.cur === rb) return;
      if (rb === base) ev.push({ d: b.date, pr: buy ? 0 : 2, run: () => step(r.cur, buy ? qty : -qty, rate) });
      else if (r.cur === base) { const amt = qty * rate; ev.push({ d: b.date, pr: buy ? 2 : 0, run: () => step(rb, buy ? -amt : amt, qty / amt) }); }
      else ev.push({ d: b.date, pr: 1, run: () => {
        const amt = qty * rate, ref = g(rb).a || num(vr[rb]) || 0;
        const worth = ref > 0 ? amt * ref : (g(r.cur).a || num(vr[r.cur]) || 0) * qty;   // the deal in rupees
        if (!(worth > 0)) return;   // neither currency has a rupee cost yet – cannot be valued
        step(r.cur, buy ? qty : -qty, worth / qty);
        step(rb, buy ? -amt : amt, worth / amt);
      } });
    }); });
    ev.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : x.pr - y.pr).forEach(e => e.run());
    const out: Record<string, number> = {};
    Object.keys(st).forEach(c => out[c] = st[c].a);
    this.avgMemo.set(key, out);
    return out;
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
    let B = this.balances(f.to); const out: SheetBlock[] = [], q = U(f.acct), typ = f.typ || 'all', curF = f.cur || 'all';
    if (f.stockOnly) B = Object.fromEntries(Object.keys(B).map(c => [c, c === this.S.base ? this.baseStockBalances(f.to) : this.curStockBalances(c, f.to)]));
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
    const allDays: Record<string, 1> = {};
    S.bills.forEach(b => allDays[b.date] = 1); S.jv.forEach(j => allDays[j.date] = 1);
    const ad = Object.keys(allDays).sort(), tpMap: Record<string, number> = {};
    ad.forEach(d => tpMap[d] = this.tpAsOf(d));
    // a day with no rupee line (e.g. only SGD bought with USDT, or INR priced in SGD) still gets a row when its profit changed,
    // so the Daily profits always add up to Total profit
    if (!P) ad.forEach((d, i) => { if (!days[d] && Math.abs(tpMap[d] - (i > 0 ? tpMap[ad[i - 1]] : 0)) > 0.004) g(d); });
    const keys = Object.keys(days).sort();
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
