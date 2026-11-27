import { Component, inject, computed, signal, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { UiService } from '../shared/ui.service';
import { SummaryComponent } from '../shared/summary.component';
import { Bill, BillRow, PayMode, PMODES, MIC } from '../core/models';
import { m, num, U, r2, today, dmy, last4 } from '../core/fmt';

/** One bill line = one row of the entry grid. bank / dealer hold the name (a new name is added on save). */
interface Line {
  desc: string; phone: string; side: 'p' | 's'; cur: string; base: string; qty: string; rate: string; inv: string;
  stock: string; mode: PayMode; bank: string; dealer: string; comm: string; orig?: number;
  /** what is saved for this line (row = as stored, sig = the boxes at save time) – set by "Save line?" and when a bill is opened */
  saved?: { row: BillRow; sig: string };
}
interface PayForm { date: string; amt: string; mode: PayMode; bank: string; dealer: string; comm: string; person: string; ref: string; nbName: string; nbAc: string; nbIfsc: string; ndName: string; }

@Component({
  standalone: true,
  imports: [FormsModule, SummaryComponent],
  templateUrl: './bill.component.html',
})
export class BillComponent implements AfterViewInit {
  store = inject(StoreService); auth = inject(AuthService); ui = inject(UiService);
  m = m; num = num; dmy = dmy; PMODES = PMODES; MIC = MIC; modes: PayMode[] = ['shop', 'bank', 'home'];   // Shop cash first
  E = computed(() => this.store.engine()!);
  S = computed(() => this.store.book()!);

  // bill being made / edited
  editId: string | null = null;
  date = today();
  no = '';
  rows: Line[] = [this.newLine()];   // entry grid; an empty row is always kept at the bottom
  /** Stock · Price in · WhatsApp columns: shown when the full grid fits without side scroll (laptops and up), hidden on small screens (they fill in by themselves); the choice is remembered. */
  more = (() => { try { const v = localStorage.getItem('remit.billMoreCols'); if (v !== null) return v === '1'; } catch {} return window.innerWidth >= 1280; })();
  toggleMore() { this.more = !this.more; try { localStorage.setItem('remit.billMoreCols', this.more ? '1' : '0'); } catch {} }
  // list
  BF: 'all' | 'pending' | 'paid' = 'all';
  q = '';
  payKey = signal<string | null>(null);
  PY: PayForm | null = null;
  phoneKey: string | null = null; phoneVal = '';

  constructor() { this.no = String(this.E().nextBillNo()); }

  /** A new row copies type, currency, price-in, pay-by, bank and dealer from the row above (the first row: Shop cash).
   *  Stock always starts empty – pick one only when needed. */
  newLine(p?: Line): Line {
    const S = this.store.book()!;
    const c = p?.cur || this.E().allCurs().find(x => x !== S.base) || 'USD';   // first currency in the fixed order (SGD)
    return { desc: '', phone: '', side: p?.side || 'p', cur: c, base: p?.base || S.base, qty: '', rate: '', inv: '', stock: '',
      mode: p?.mode || 'shop', bank: p?.bank || 'BANK', dealer: p?.dealer || '', comm: '' };   // a new bill starts on Shop cash
  }
  /** Stock drop-down: every stock account, any name kept in Setup → Stock for each currency, and any name that holds a
   *  foreign currency right now (e.g. KUMAR keeping SGD) – so a sale can be made FROM it. */
  stockNames = computed(() => {
    const S = this.S(), E = this.E(), n = new Set<string>(), B = E.balances();
    Object.keys(S.accounts).forEach(a => { if (S.accounts[a].type === 'stock') n.add(a); });
    Object.values(S.stockOf || {}).forEach(v => { if (v) n.add(v); });
    Object.keys(B).filter(c => c !== S.base).forEach(c => Object.keys(B[c]).forEach(a => {
      if (B[c][a] > 0.004 && ['party', 'dealer', 'stock'].includes(E.accType(a))) n.add(a);
    }));
    return [...n].sort();
  });
  /** Stock drop-down of one line – only names for the line's currency: its stock company (Setup → Stock for each currency, or a
   *  stock account that keeps that currency, e.g. SGD → SGD COMPANY). On a Sale also the people holding that currency now
   *  (e.g. KUMAR keeping our SGD), so it can be sold FROM them. Any other name can still be typed. */
  stockLists = computed(() => {
    const S = this.S(), E = this.E(), out: Record<string, string[]> = {};
    E.allCurs().forEach(c => {
      const co = new Set<string>(), so = U((S.stockOf || {})[c] || '');
      if (so) co.add(so);
      Object.keys(S.accounts).forEach(a => { if (E.accType(a) === 'stock' && E.stockCurs(a).includes(c)) co.add(a); });
      const held = c === S.base ? E.baseStockBalances() : E.curStockBalances(c);   // who holds the currency (not what they owe)
      const holders = Object.keys(held).filter(a => held[a] > 0.004 && ['party', 'dealer'].includes(E.accType(a)) && !co.has(a)).sort();
      out[c + ':p'] = [...co].sort(); out[c + ':s'] = [...co].sort().concat(holders);
    });
    return out;
  });
  stockFor(cur: string, side: string) { return this.stockLists()[cur + ':' + side] || []; }
  /** a Stock name never used before (an existing name such as KUMAR is not new) */
  isNewStock(n: string) { n = U(n); return !!n && !this.S().accounts[n] && !this.stockNames().includes(n); }
  filled(l: Line) { return !!(U(l.desc) || num(l.qty) || num(l.rate)); }
  trail() { const last = this.rows[this.rows.length - 1]; if (this.filled(last)) this.rows.push(this.newLine(last)); }
  removeRow(i: number) { this.rows.splice(i, 1); if (!this.rows.length || this.filled(this.rows[this.rows.length - 1])) this.rows.push(this.newLine(this.rows[this.rows.length - 1])); }
  invCur(c: string) { return this.E().invCur(c); }
  /** "1 SGD = 83 INR" typed for a line priced in SGD → rate per INR kept to 12 decimals (1 crore INR → SGD 1,20,481.93, exact to the cent) */
  invChanged(l: Line) { const v = num(l.inv); l.rate = v ? String(+(1 / v).toFixed(12)) : ''; }
  lineAmt(l: Line) { return num(l.qty) * num(l.rate); }
  /** ₹ for rupees, otherwise the currency code (a line priced in SGD shows "SGD 1,250.00") */
  symOf(c?: string) { return !c || c === this.S().base ? '₹' : c + ' '; }
  lineComm(l: Line) { return r2(this.lineAmt(l) * num(l.comm) / 100000); }
  lastRate(l: Line) { return this.E().lastRate(l.cur, l.base); }
  isNewBank(n: string) { n = U(n); return !!n && n !== 'BANK' && !this.S().banks.some(b => b.name === n); }
  isNewDealer(n: string) { n = U(n); return !!n && !this.S().dealers.some(d => d.name === n); }

  /** Enter in the grid: next box across the whole line (Rate → Pay by → Bank / Dealer → Comm. → Stock → Price in → WhatsApp);
   *  Enter on the line's last box asks "Save line N?" (like the Cash Book), then goes to the next line's Party.
   *  Boxes that are off (e.g. Bank for Shop cash) are skipped. */
  gridKey(e: Event) {
    const el = e.target as HTMLElement;
    if (el.tagName === 'BUTTON' || (e as KeyboardEvent).isComposing) return;   // Enter on a button still clicks it
    e.preventDefault();
    const tr = el.closest('tr'), mine = tr ? Array.from(tr.querySelectorAll<HTMLElement>('input:not([disabled]), select')) : [];
    const x = tr ? this.rows[Array.from(tr.parentElement!.children).indexOf(tr)] : undefined;
    if (x && mine[mine.length - 1] === el && this.filled(x)) { setTimeout(() => this.rowDone(x), 30); return; }   // let a picked name fill in first
    this.trail();
    setTimeout(() => {   // let a name picked from the party list fill in, and a new row appear
      const boxes = Array.from(document.querySelectorAll<HTMLElement>('table.bg input:not([disabled]), table.bg select'));
      boxes[boxes.indexOf(el) + 1]?.focus();
    }, 30);
  }

  /* ---------- save line by line: Enter on a line's last box asks "Save line N?" ---------- */
  /** the boxes of a line that are saved – used to tell a saved line from a changed one */
  sig(l: Line) {
    return JSON.stringify([U(l.desc), l.side, l.cur, l.base, num(l.qty), num(l.rate), U(l.stock), l.mode,
      l.mode === 'bank' ? U(l.bank) || 'BANK' : '', l.mode === 'home' ? U(l.dealer) : '', num(l.comm), String(l.phone || '').trim()]);
  }
  /** saved and not changed since */
  isSaved(l: Line) { return !!l.saved && this.sig(l) === l.saved.sig; }
  /** saved, then changed on screen (not saved yet) */
  isChanged(l: Line) { return !!l.saved && this.filled(l) && this.sig(l) !== l.saved.sig; }
  toRow(l: Line): BillRow {
    return { desc: U(l.desc), cur: l.cur, base: l.base, qty: num(l.qty), prate: l.side === 'p' ? num(l.rate) : 0, srate: l.side === 's' ? num(l.rate) : 0,
      stock: U(l.stock), mode: l.mode, bank: l.mode === 'bank' ? U(l.bank) || 'BANK' : '', dealer: l.mode === 'home' ? U(l.dealer) : '', comm: num(l.comm) };
  }
  /** What is wrong with a line ('' = fine) – the same checks as Save bill. */
  lineError(l: Line) {
    if (!U(l.desc)) return 'enter party name';
    if (!(num(l.qty) > 0)) return 'enter quantity';
    if (!(num(l.rate) > 0)) return 'enter rate';
    if (l.cur === l.base) return 'Currency and Price in are the same. Change one.';
    const sc = this.E().stockCurs(l.stock);   // a stock company keeps only its own currency (e.g. MY SGD COMPANY → SGD)
    if (sc.length && !sc.includes(l.cur)) return U(l.stock) + ' keeps only ' + sc.join(' / ') + ' – this line is ' + l.cur + '. Change the Stock or the Currency.';
    return '';
  }
  /** lines of the open bill that were taken off the grid with ✕ (they leave the bill on the next save) */
  private removedLines() {
    const old = this.editId ? this.S().bills.find(b => b.id === this.editId) : undefined;
    if (!old) return [];
    const kept = new Set(this.rows.filter(l => l.orig !== undefined).map(l => l.orig));
    return old.rows.filter((_, i) => !kept.has(i));
  }
  private asking = false;
  /** Enter on a line's last box: "Save line N?" → the bill is saved with its saved lines + this line (other lines typed but not
   *  saved stay on screen, not saved). The first saved line makes the bill; the next ones are added to it. */
  async rowDone(x: Line) {
    if (this.asking) return;
    const i = this.rows.indexOf(x), no = i + 1;
    if (i < 0) return;
    if (this.isSaved(x)) { this.trail(); this.focusRowParty(i + 1); return; }   // nothing new on this line – just move on
    const err = this.lineError(x);
    if (err) { this.ui.toast('Line ' + no + ': ' + err); return; }
    const upd = !!x.saved;
    this.asking = true;
    try {
      // the bill as it will be saved: lines already saved (as saved) + this line (as typed)
      const keep = this.rows.filter(l => l === x || l.saved);
      const rows = keep.map(l => l === x ? this.toRow(l) : l.saved!.row);
      const remap: Record<number, number> = {};
      keep.forEach((l, k) => { if (l.orig !== undefined) remap[l.orig] = k; });
      const notes: string[] = [];
      const lr = this.lastRate(x), rr = num(x.rate);
      if (lr && (rr > lr * 1.3 || rr < lr * 0.7)) notes.push(`⚠️ Rate <b>${rr}</b> is far from your usual ${x.cur} rate ${lr}`);
      notes.push(...this.shortNotes(keep.map(l => l === x ? l : this.fromRow(l.saved!.row, l)), keep.map(l => this.rows.indexOf(l) + 1)));
      const nb = x.mode === 'bank' && this.isNewBank(x.bank) ? U(x.bank) : '', nd = x.mode === 'home' && this.isNewDealer(x.dealer) ? U(x.dealer) : '';
      if (nb) notes.push(`➕ New bank <b>${nb}</b> will be added (A/c no. and IFSC can be added in Setup → Banks)`);
      if (nd) notes.push(`➕ New delivery dealer <b>${nd}</b> will be added`);
      if (this.isNewStock(x.stock)) notes.push(`➕ New stock <b>${U(x.stock)}</b> will be added`);
      this.removedLines().forEach(r => notes.push(`🗑 Removed line <b>${r.desc}</b> ${r.cur} ${m(r.qty)} will be taken out of the bill`));
      const other = this.rows.filter(l => l !== x && this.filled(l) && (!l.saved || this.isChanged(l))).map(l => this.rows.indexOf(l) + 1);
      if (other.length) notes.push(`ℹ️ Line${other.length > 1 ? 's' : ''} ${other.join(', ')} not saved yet – press Enter on ${other.length > 1 ? 'their' : 'its'} last box, or Save bill`);
      const title = (upd ? 'Update line ' : 'Save line ') + no + '? – Bill ' + (this.no || '');
      if (!(await this.ui.confirm(title, [...notes, this.sentence({ ...x, desc: U(x.desc), stock: U(x.stock) })], upd ? '✅ Yes, update' : undefined))) {
        this.focusRowParty(i); return;                                     // Go back → change this line
      }
      const accounts: any[] = [];
      const ph = String(x.phone || '').trim();
      if (ph) accounts.push({ name: U(x.desc), type: 'party', phone: ph });
      const r = await this.store.save('post', '/bills', {
        bill: { id: this.editId || undefined, no: this.no, date: this.date, rows }, remap, accounts,
        banks: nb ? [{ name: nb, acno: '', ifsc: '', comm: num(x.comm) }] : [], dealers: nd ? [{ name: nd, comm: num(x.comm) }] : [],
        settings: { lastMode: x.mode },
      }, '✓ Line ' + no + (upd ? ' updated' : ' saved') + ' – Bill ' + (this.no || ''));
      if (!r) { this.focusRowParty(i); return; }
      if (!this.editId) this.building = true;                            // a new bill made line by line (not an opened one)
      this.editId = r.id || this.editId; if (r.no) this.no = String(r.no);
      keep.forEach((l, k) => { l.orig = k; if (l === x) l.saved = { row: rows[k], sig: this.sig(l) }; });
      this.trail();
      this.focusRowParty(i + 1);                                           // next line's Party
    } finally { this.asking = false; }
  }
  /** a saved bill line back as grid boxes (only what the warnings need) */
  private fromRow(r: BillRow, l: Line): Line {
    return { ...l, side: this.E().rowSide(r), cur: r.cur, base: r.base || this.S().base, qty: String(r.qty), rate: String(this.E().rowRate(r)) };
  }
  focusRowParty(i: number) {
    setTimeout(() => document.querySelectorAll<HTMLElement>('table.bg tbody tr')[i]?.querySelector<HTMLInputElement>('td.desc input')?.focus(), 30);
  }
  /** true while a new bill is being saved line by line (header still says New bill) */
  building = false;
  /** something on screen that is not saved yet */
  pending() {
    const old = this.editId ? this.S().bills.find(b => b.id === this.editId) : undefined;
    return this.rows.some(l => this.filled(l) ? !this.isSaved(l) : !!l.saved) || this.removedLines().length > 0
      || (!!old && (old.date !== this.date || String(old.no).trim() !== String(this.no || '').trim()));
  }
  totals() {
    let p = 0, s = 0, c = 0;
    this.rows.filter(l => this.filled(l)).forEach(l => { if (l.base !== this.S().base) return; if (l.side === 'p') p += this.lineAmt(l); else s += this.lineAmt(l); c += this.lineComm(l); });
    return { p, s, c, diff: s - p, net: s - p - c };
  }
  payTxt(l: { mode: string; bank: string; dealer: string; nbName?: string; ndName?: string }) {
    if (l.mode === 'bank') { const b = l.bank === '__new' ? U(l.nbName) : l.bank; return 'by Bank' + (b && b !== 'BANK' ? ' (' + b + ')' : ''); }
    if (l.mode === 'home') { const d = l.dealer === '__new' ? U(l.ndName) : l.dealer; return 'by Home delivery' + (d ? ' (dealer ' + d + ')' : ''); }
    return 'by Shop cash';
  }
  sentence(l: Line) {
    const amt = this.symOf(l.base) + m(this.lineAmt(l)), q = l.cur + ' ' + m(num(l.qty)), r = this.E().rateShort(l.cur, num(l.rate)),
      c = num(l.comm) ? ' · commission ' + this.symOf(l.base) + m(this.lineComm(l)) : '',
      ac = l.desc,   // the price is always with the party
      st = U(l.stock) && U(l.stock) !== U(l.desc) ? (l.side === 'p' ? ` · ${l.cur} kept at <b>${U(l.stock)}</b>` : ` · ${l.cur} given from <b>${U(l.stock)}</b>`) : '';
    return l.side === 'p'
      ? `We <b>BUY</b> ${q} from <b>${l.desc}</b> ${r} → we must <b>PAY</b> <b>${ac}</b> ${amt} ${this.payTxt(l)}${c}${st}`
      : `We <b>SELL</b> ${q} to <b>${l.desc}</b> ${r} → <b>${ac}</b> must <b>PAY us</b> ${amt} ${this.payTxt(l)}${c}${st}`;
  }

  /** Warning when this bill sells more of a currency than you hold (what you hold + what the bill buys − what it sells < 0).
   *  "Hold" = the currency's total on the Balance sheet (all names except capital and expenses). When a bill is being edited,
   *  its saved version is taken out first. A line priced in another currency (e.g. INR priced in USDT) gives / gets that currency too.
   *  Only warns when the bill makes the position worse – a bill that buys back a short does not warn. */
  shortNotes(LL: Line[], nos = LL.map(l => this.rows.indexOf(l) + 1)): string[] {
    const E = this.E(), S = this.S(), base = S.base, B = E.balances();
    const held = (c: string) => Object.keys(B[c] || {}).reduce((s, a) => { const t = E.accType(a); return t === 'capital' || t === 'expense' ? s : s + B[c][a]; }, 0);
    // effect of one line on a currency: + we get it, − we give it
    const eff = (c: string, cur: string, lb: string, buy: boolean, q: number, amt: number) =>
      (cur === c ? (buy ? q : -q) : 0) + (lb === c && c !== base ? (buy ? -amt : amt) : 0);
    const old = this.editId ? S.bills.find(b => b.id === this.editId) : undefined;
    const curs = [...new Set(LL.flatMap(l => [l.cur, l.base]).filter(c => c && c !== base))];
    return curs.flatMap(c => {
      const was = old ? old.rows.reduce((s, r) => s + eff(c, r.cur, r.base || base, E.rowSide(r) === 'p', num(r.qty), E.rowAmt(r)), 0) : 0;
      const before = r2(held(c) - was);
      let buy = 0, sell = 0; const sellLines: number[] = [];
      LL.forEach((l, k) => { const e = eff(c, l.cur, l.base, l.side === 'p', num(l.qty), this.lineAmt(l)); if (e > 0) buy += e; else if (e < 0) { sell -= e; sellLines.push(nos[k]); } });
      const after = r2(before + buy - sell);
      if (after > -0.005 || after >= before) return [];
      return [`⚠️ <b>${c}</b>: this bill sells <b>${m(sell)}</b> but buys ${m(buy)} and you hold ${m(before)} → <b>${m(-after)} ${c} more than you have</b>`
        + ` (selling line${sellLines.length > 1 ? 's' : ''} ${sellLines.join(', ')}). Check the currency on these lines.`];
    });
  }

  async saveBill() {
    const LL = this.rows.filter(l => this.filled(l));
    if (this.editId && !this.pending()) {                                  // every line already saved one by one – nothing more to save
      this.ui.toast(this.building ? '✓ Bill ' + this.no + ' done' : '✓ No changes – Bill ' + this.no + ' is already saved'); this.newBill(); return;
    }
    if (!LL.length) { this.ui.toast('Type at least one line'); return; }
    for (let q = 0; q < LL.length; q++) {
      const err = this.lineError(LL[q]);
      if (err) { this.ui.toast('Line ' + (q + 1) + ': ' + err); return; }
    }
    const notes: string[] = [];
    LL.forEach((l, q) => {
      const lr = this.lastRate(l), rr = num(l.rate);
      if (lr && (rr > lr * 1.3 || rr < lr * 0.7)) notes.push(`⚠️ Line ${q + 1}: rate <b>${rr}</b> is far from your usual ${l.cur} rate ${lr}`);
    });
    notes.push(...this.shortNotes(LL));
    const nb = [...new Set(LL.filter(l => l.mode === 'bank' && this.isNewBank(l.bank)).map(l => U(l.bank)))];
    const nd = [...new Set(LL.filter(l => l.mode === 'home' && this.isNewDealer(l.dealer)).map(l => U(l.dealer)))];
    nb.forEach(b => notes.push(`➕ New bank <b>${b}</b> will be added (A/c no. and IFSC can be added in Setup → Banks)`));
    nd.forEach(d => notes.push(`➕ New delivery dealer <b>${d}</b> will be added`));
    [...new Set(LL.filter(l => this.isNewStock(l.stock)).map(l => U(l.stock)))].forEach(s => notes.push(`➕ New stock <b>${s}</b> will be added`));
    LL.forEach(l => { l.desc = U(l.desc); l.stock = U(l.stock); l.bank = U(l.bank) || 'BANK'; l.dealer = U(l.dealer); });
    if (!(await this.ui.confirm('Please check – Bill ' + (this.no || ''), [...notes, ...LL.map(l => this.sentence(l))]))) return;
    const accounts: any[] = [];
    const banks = nb.map(name => ({ name, acno: '', ifsc: '', comm: num(LL.find(l => l.mode === 'bank' && l.bank === name)!.comm) }));
    const dealers = nd.map(name => ({ name, comm: num(LL.find(l => l.mode === 'home' && l.dealer === name)!.comm) }));
    const rows: BillRow[] = LL.map(l => {
      if (l.phone) accounts.push({ name: l.desc, type: 'party', phone: l.phone });
      return { desc: l.desc, cur: l.cur, base: l.base, qty: num(l.qty), prate: l.side === 'p' ? num(l.rate) : 0, srate: l.side === 's' ? num(l.rate) : 0,
        stock: l.stock, mode: l.mode, bank: l.mode === 'bank' ? l.bank : '', dealer: l.mode === 'home' ? l.dealer : '', comm: num(l.comm) };
    });
    const remap: Record<number, number> = {};
    LL.forEach((l, i) => { if (l.orig !== undefined) remap[l.orig] = i; });
    const r = await this.store.save('post', '/bills', {
      bill: { id: this.editId || undefined, no: this.no, date: this.date, rows }, remap, accounts, banks, dealers,
      settings: { lastMode: LL[LL.length - 1].mode },
    });
    if (r) { this.ui.toast('Bill ' + r.no + ' saved'); this.newBill(); }
  }
  /** Cursor in the first row's Party – when the page opens and after a bill is saved / started.
   *  Skipped on touch phones so the keyboard does not pop up by itself. */
  focusParty() {
    try { if (window.matchMedia('(pointer: coarse)').matches) return; } catch {}
    setTimeout(() => document.querySelector<HTMLInputElement>('table.bg tbody tr:first-child td.desc input')?.focus(), 0);
  }
  ngAfterViewInit() { this.focusParty(); }
  newBill() {
    const last = this.rows.filter(l => this.filled(l)).pop() || this.rows[this.rows.length - 1];
    if (this.editId) this.date = today();   // leaving an old bill → new bills start today, not on the old bill's date
    // the next bill keeps the last line's type and currency, but always starts on Shop cash
    this.editId = null; this.building = false; this.rows = [{ ...this.newLine(last), mode: 'shop', bank: 'BANK', dealer: '' }]; this.no = String(this.E().nextBillNo()); this.focusParty();
  }

  /** Type an earlier Bill No. → that bill opens for editing (same as ✏️ Edit).
   *  While editing, a number that does not exist yet → start a new bill with it, or renumber the open bill. */
  private noBusy = false;
  async billNoChanged() {
    const v = String(this.no || '').trim();
    if (!v || this.noBusy) return;
    const open = this.editId ? this.S().bills.find(b => b.id === this.editId) : undefined;
    if (open && String(open.no).trim() === v) return;                       // already open
    const b = this.S().bills.find(x => String(x.no).trim() === v);
    const typed = this.rows.filter(l => this.filled(l)).length;
    this.noBusy = true;
    try {
      if (b) {
        if (typed && !(await this.ui.confirm('Open Bill ' + v + '?', [open
          ? 'Changes to <b>Bill ' + open.no + '</b> that are not saved will be lost.'
          : 'You have <b>' + typed + ' line' + (typed > 1 ? 's' : '') + ' not saved yet</b>. They will be cleared if you open Bill ' + v + '.'], '📂 Open Bill ' + v))) {
          this.no = open ? open.no : String(this.E().nextBillNo()); return;
        }
        this.openBill(b);
        this.ui.toast('📂 Bill ' + v + ' opened – ' + b.rows.length + ' line' + (b.rows.length > 1 ? 's' : '') + '. Change it and press Update bill.');
        this.focusLastParty();
        return;
      }
      if (open) {
        const k = await this.ui.choose('Bill No. ' + v, 'You are editing <b>Bill ' + open.no + '</b>. There is no Bill ' + v + ' yet.',
          [{ k: 'new', label: '➕ Start new Bill ' + v, cls: 'pr' }, { k: 'rename', label: '✏️ Change Bill ' + open.no + ' to No. ' + v }, { k: 'cancel', label: 'Cancel' }],
          '“Change” keeps editing this bill and saves it under the new number when you press Update bill.');
        if (k === 'new') { this.newBill(); this.no = v; }
        else if (k !== 'rename') this.no = open.no;
      }
    } finally { this.noBusy = false; }
  }
  focusLastParty() {
    try { if (window.matchMedia('(pointer: coarse)').matches) return; } catch {}
    setTimeout(() => { const tr = document.querySelectorAll<HTMLElement>('table.bg tbody tr'); tr[tr.length - 1]?.querySelector<HTMLInputElement>('td.desc input')?.focus(); }, 30);
  }
  openBill(b: Bill) {
    this.editId = b.id; this.building = false; this.no = b.no; this.date = b.date;
    // WhatsApp starts empty – only a number typed here is saved (an empty box keeps the number already saved)
    this.rows = b.rows.map((r, i) => {
      const l: Line = { desc: r.desc, phone: '', side: this.E().rowSide(r), cur: r.cur, base: r.base,
        qty: String(r.qty), rate: String(this.E().rowRate(r)), inv: this.invCur(r.cur) ? String(+(1 / this.E().rowRate(r)).toFixed(6)) : '',
        stock: r.stock, mode: r.mode, bank: r.bank || 'BANK', dealer: r.dealer, comm: r.comm ? String(r.comm) : '', orig: i };
      l.saved = { row: { ...r }, sig: this.sig(l) };   // opened lines count as saved – Enter on an unchanged line just moves on
      return l;
    });
    this.rows.push(this.newLine(this.rows[this.rows.length - 1]));
    window.scrollTo(0, 0);
  }

  /* ---------- saved bills & payments ---------- */
  billList = computed(() => {
    const E = this.E();
    return this.S().bills.slice().sort((a, b) => (b.date + this.p3(b.no)) > (a.date + this.p3(a.no)) ? 1 : -1);
  });
  p3(n: string) { return ('000000' + n).slice(-6); }
  /** User logins (staff) only see what we have to give: purchase lines – party, amount, how to pay, status.
   *  Rates, currency, stock, sale lines, Diff / Net and WhatsApp stay hidden. Super admin and Master see everything. */
  limited = computed(() => this.auth.user()?.role === 'user');
  lineVisible(r: BillRow) { return !this.limited() || this.E().rowSide(r) === 'p'; }
  /** Bill status counted over the lines this login can see. */
  visState(b: Bill) {
    if (!this.limited()) return this.E().billState(b);
    let n = 0, paid = 0, part = 0;
    b.rows.forEach((r, i) => { if (!this.lineVisible(r)) return; n++; const s = this.E().lineState(b, i).st; if (s === 'paid') paid++; else if (s === 'part') part++; });
    return { n, paid, part };
  }
  shown() {
    const q = U(this.q), lim = this.limited();
    return this.billList().filter(b => {
      const st = this.visState(b);
      if (!st.n) return false;                                  // nothing this login may see
      if (this.BF === 'pending' && st.paid === st.n) return false;
      if (this.BF === 'paid' && st.paid < st.n) return false;
      if (!q) return true;
      const rows = b.rows.filter(r => this.lineVisible(r));
      return ('BILL ' + b.no + ' ' + rows.map(r => lim ? r.desc : r.desc + ' ' + r.stock + ' ' + r.cur).join(' ')).toUpperCase().includes(q);
    });
  }
  pendingCount() { return this.S().bills.filter(b => { const s = this.visState(b); return s.n > 0 && s.paid < s.n; }).length; }
  billSums(b: Bill) {
    let bp = 0, bs = 0, bc = 0; const E = this.E();
    b.rows.forEach(r => { if ((r.base || this.S().base) !== this.S().base) return; if (E.rowSide(r) === 'p') bp += E.rowAmt(r); else bs += E.rowAmt(r); bc += E.rowComm(r); });
    return { diff: bs - bp, comm: bc, net: bs - bp - bc };
  }
  openPay(b: Bill, i: number) {
    const r = b.rows[i];
    // amount starts with what is still pending on the line
    this.PY = { date: today(), amt: String(this.E().lineState(b, i).due), mode: r.mode, bank: r.bank || 'BANK', dealer: r.dealer, comm: r.comm ? String(r.comm) : '',
      person: '', ref: '', nbName: '', nbAc: '', nbIfsc: '', ndName: '' };
    this.payKey.set(b.id + ':' + i);
  }
  async confirmPay(b: Bill, i: number) {
    const P = this.PY!, r = b.rows[i], sd = this.E().rowSide(r), amt = num(P.amt), cm = num(P.comm), bookTo = this.E().rowAcct(r);
    const cur = r.base || this.S().base, sym = cur === this.S().base ? '₹' : cur + ' ';   // a line priced in SGD is paid in SGD
    if (!(amt > 0)) { this.ui.toast('Enter amount'); return; }
    const ls = this.E().lineState(b, i), left = r2(ls.due - amt);
    if (left <= -1) { this.ui.toast('Only ' + sym + m(ls.due) + ' is pending on this line'); return; }
    const banks: any[] = [], dealers: any[] = [], accounts: any[] = [];
    let ac = 'CASH', accType = 'cash';
    if (P.mode === 'bank') {
      ac = P.bank === '__new' ? U(P.nbName) : (P.bank || 'BANK'); accType = 'bank';
      if (!ac) { this.ui.toast('Enter bank name'); return; }
      if (P.bank === '__new') banks.push({ name: ac, acno: P.nbAc, ifsc: P.nbIfsc, comm: cm });
    } else if (P.mode === 'home' && (P.dealer || P.ndName)) {
      ac = P.dealer === '__new' ? U(P.ndName) : P.dealer; accType = 'dealer';
      if (!ac) { this.ui.toast('Enter dealer name'); return; }
      if (P.dealer === '__new') dealers.push({ name: ac, comm: cm });
    }
    accounts.push({ name: ac, type: accType });
    const bk = P.mode === 'bank' ? this.E().bankBy(ac) : undefined, who = U(P.person);
    const note = 'Bill ' + b.no + ' · ' + PMODES[P.mode] + (accType === 'dealer' ? ' · dealer ' + ac : '') + (bk ? ' · ' + bk.name + (bk.acno ? ' ' + last4(bk.acno) : '') : '') + (who ? ' · ' + who : '') + (P.ref ? ' · Ref ' + P.ref : '');
    // warnings: the same money already entered in the Cash Book · paying a foreign currency the place does not hold
    const E = this.E(), commAmt = cm ? r2(amt * cm / 100000) : 0;
    const warn = [...E.similarPays(bookTo, cur, amt, sd === 'p', P.date || today(), 'bill'),
      ...(sd === 'p' && accType !== 'dealer' ? [E.shortOf(ac, cur, amt + commAmt)] : [])].filter(Boolean);
    const ok = await this.ui.confirm('Please check', [...warn, (sd === 'p' ? 'We <b>PAY</b> ' : 'We <b>GET</b> ') + sym + m(amt) + (sd === 'p' ? ' to <b>' : ' from <b>') + bookTo + '</b> ' + this.payTxt({ ...P, bank: ac, dealer: accType === 'dealer' ? ac : '' })
      + (cm ? ' · commission ' + sym + m(commAmt) : '')
      + (left >= 1 ? ' · <b>' + sym + m(left) + ' will still be pending</b>' : '')]);
    if (!ok) return;
    const pay: any = { date: P.date || today(), type: sd === 'p' ? 'payment' : 'receipt', desc: '', dr: sd === 'p' ? bookTo : ac, cr: sd === 'p' ? ac : bookTo,
      cur: r.base || this.S().base, amt: r2(amt), note, mode: P.mode, bank: bk ? bk.name : '', dealer: accType === 'dealer' ? ac : '', person: who, ref: P.ref, link: { bill: b.id, line: i } };
    const entries = [pay];
    if (cm > 0) {
      const cn = P.mode === 'bank' ? 'BANK COMMISSION' : 'DELIVERY COMMISSION';
      accounts.push({ name: cn, type: 'expense' });
      entries.push({ date: pay.date, type: 'expense', desc: '', dr: cn, cr: ac, cur: pay.cur, amt: r2(amt * cm / 100000), note: 'Commission ₹' + cm + '/lakh · ' + note, mode: '', bank: '', link: { bill: b.id, line: i, comm: true } });
    }
    const res = await this.store.save('post', '/jv', { entries, accounts, banks, dealers }, sd === 'p' ? 'Marked paid' : 'Marked received');
    if (res) this.payKey.set(null);
  }
  unpay(b: Bill, i: number) {
    const n = this.E().paysOf(b.id, i).length;
    this.store.remove('/payments/' + b.id + '/' + i, (n > 1 ? 'all ' + n + ' payments of this line' : 'this payment') + ' (back to pending)', 'Back to pending');
  }
  delBill(b: Bill) { this.store.remove('/bills/' + b.id, 'Bill ' + b.no, 'Bill deleted').then(ok => { if (ok && this.editId === b.id) this.newBill(); }); }

  /* ---------- 📤 Send bill (every login, paid lines): type a number → WhatsApp opens with the bill message ---------- */
  sendKey: string | null = null; sendPhone = '';
  openSend(b: Bill, i: number) {
    this.sendKey = b.id + ':' + i; this.sendPhone = '';
    setTimeout(() => document.getElementById('send-ph')?.focus(), 30);
  }
  /** Short bill message: bill no., date, party, amount and payment – no rates and no balance. */
  billMsg(b: Bill, i: number) {
    const E = this.E(), r = b.rows[i], ls = E.lineState(b, i), pj = ls.last, cur = r.base || this.S().base, done = E.rowSide(r) === 'p' ? 'PAID' : 'RECEIVED';
    const how = pj ? PMODES[pj.mode] + (pj.bank ? ' (' + pj.bank + ')' : '') + (pj.dealer ? ' (' + pj.dealer + ')' : '') : '';
    const o = ['*Bill ' + b.no + '* · ' + dmy(b.date), r.desc, 'Amount: ' + cur + ' ' + m(ls.amt)];
    if (ls.st === 'paid' && pj) o.push('✅ ' + done + ' ' + cur + ' ' + m(ls.paid) + ' via ' + how + ' on ' + dmy(pj.date) + (pj.ref ? ' · Ref ' + pj.ref : ''));
    else if (ls.st === 'part') o.push('🟡 PART ' + done + ' ' + cur + ' ' + m(ls.paid) + ' · PENDING ' + cur + ' ' + m(ls.due));
    else o.push('⏳ PENDING');
    return o.join('\n');
  }
  sendBill(b: Bill, i: number) {
    const intl = this.sendPhone.trim().startsWith('+');   // "+65 9123 4567" → kept as typed
    let d = this.sendPhone.replace(/\D/g, ''); if (!intl && d.length === 10) d = '91' + d;   // plain 10-digit Indian mobile → +91
    if (d.length < (intl ? 8 : 11) || d.length > 15) { this.ui.toast('Enter a valid WhatsApp number'); return; }
    window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(this.billMsg(b, i)), '_blank', 'noopener');
    this.sendKey = null;
  }

  phoneOf(n: string) { return this.S().accounts[n]?.phone || ''; }
  waText(b: Bill, party: string) {
    const E = this.E(), o: string[] = [];
    b.rows.forEach((r, i) => {
      if (r.desc !== party) return; const sd = E.rowSide(r), ls = E.lineState(b, i), pj = ls.last, cur = r.base || this.S().base;
      o.push('Amount: ' + cur + ' ' + m(E.rowAmt(r)));
      const pmd = pj ? pj.mode : r.mode, pbk = pj ? (pj.bank ? E.bankBy(pj.bank) : undefined) : (r.bank ? E.bankBy(r.bank) : undefined), pdl = pj ? pj.dealer : (r.mode === 'home' ? r.dealer : '');
      o.push((sd === 'p' ? 'Pay out by: ' : 'Receive by: ') + PMODES[pmd] + (pmd === 'home' && pdl ? ' (' + pdl + ')' : '') + (pmd === 'bank' && pbk ? ' (' + pbk.name + (pbk.acno ? ' A/c ' + last4(pbk.acno) : '') + (pbk.ifsc ? ', IFSC ' + pbk.ifsc : '') + ')' : ''));
      const done = sd === 'p' ? 'PAID' : 'RECEIVED';
      o.push('Status: ' + (ls.st === 'paid' && pj ? '✅ ' + done + ' via ' + PMODES[pj.mode] + ' on ' + dmy(pj.date) + (pj.ref ? ' (Ref ' + pj.ref + ')' : '')
        : ls.st === 'part' ? '🟡 PART ' + done + ' ' + cur + ' ' + m(ls.paid) + ' · PENDING ' + cur + ' ' + m(ls.due) : '⏳ PENDING'));
    });
    const bal = E.partyBal(party);
    o.push('Balance: ₹' + m(Math.abs(bal)) + (bal > 0.004 ? ' Dr (payable by you)' : bal < -0.004 ? ' Cr (payable to you)' : ' (settled)'));
    return o.join('\n');
  }
  waLink(b: Bill, party: string) { let d = this.phoneOf(party).replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return 'https://wa.me/' + d + '?text=' + encodeURIComponent(this.waText(b, party)); }
  async savePhone(party: string) {
    const r = await this.store.save('put', '/accounts/' + encodeURIComponent(party) + '/phone', { phone: this.phoneVal.trim() }, this.phoneVal.trim() ? '✓ WhatsApp number saved' : '✓ WhatsApp number removed');
    if (r) this.phoneKey = null;
  }
}
