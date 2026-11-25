import { Component, inject, computed, AfterViewChecked, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { UiService } from '../shared/ui.service';
import { Jv, BillRow, Bill, PMODES, VM, TYPES, CbMode, HAND_CASH } from '../core/models';
import { Engine, LedgerLine } from '../core/engine';
import { m, num, U, r2, today, dmy, drcr } from '../core/fmt';

/** One row of the voucher grid. saved = already saved (Enter on Remarks → Yes, or opened from an earlier voucher); jid = its saved entry;
 *  editing = a saved row unlocked with ✏️ and being changed. */
interface VLine { desc: string; mode: CbMode; bank: string; out: string; inn: string; exp: string; from: string; note: string; saved?: boolean; jid?: string; editing?: boolean; }
interface Item { k: 'jv' | 'bill'; date: string; t: number; n: number; j?: Jv; b?: Bill; r?: BillRow; i?: number; cb?: number; cd?: number; }
/** What we know about a saved name typed in Description (null parts = this login may not see them). */
interface AccInfo {
  n: string; type: string; owes: boolean; phone: string; cur: string;
  bals: { c: string; v: number }[] | null; now: number;               // balance per currency · balance in the voucher currency
  pend: { no: string; due: number; c: string }[] | null;              // unpaid bill lines
  last: LedgerLine[] | null;                                          // latest entries in the voucher currency, newest first
}

@Component({
  standalone: true,
  imports: [FormsModule],
  templateUrl: './cash-bank.component.html',
})
export class CashBankComponent implements AfterViewChecked, AfterViewInit {
  store = inject(StoreService); auth = inject(AuthService); ui = inject(UiService); router = inject(Router);
  m = m; num = num; dmy = dmy; drcr = drcr; PMODES = PMODES;
  E = computed(() => this.store.engine()!);
  S = computed(() => this.store.book()!);
  date = today(); vno = ''; cur = '';
  rows: VLine[] = [this.empty()];
  RF: 'all' | 'vouchers' | 'bills' = 'all';
  cap: { dir: 'in' | 'out'; date: string; cur: string; amt: string; mode: CbMode; bank: string; note: string } | null = null;
  private scrolled = 0;

  constructor() { this.cur = this.S().base; this.vno = String(this.E().nextVno()); }
  empty(): VLine { return { desc: '', mode: 'cash', bank: 'BANK', out: '', inn: '', exp: '', from: '', note: '' }; }
  filled(x: VLine) { return !!(U(x.desc) || num(x.out) || num(x.inn) || num(x.exp)); }
  unsaved(x: VLine) { return this.filled(x) && !x.saved; }
  /** Saved and not being changed → its boxes are locked. */
  locked(x: VLine) { return !!x.saved && !x.editing; }
  /** Rows with something not saved yet: new lines and saved lines being changed. */
  pendingRows() { return this.rows.filter(x => this.unsaved(x) || !!x.editing); }
  /** Money effect of a row on cash in hand / expenses (Cash and Hand cash are both cash in hand). */
  /** + into / − out of cash in hand (cash accounts and stock / wallet companies), from the names this row debits / credits. */
  private cashEff(x: VLine) {
    const a = this.amt(x); if (!a) return 0;
    const E = this.E(), d = this.dir(x), desc = U(x.desc) || (d === 'exp' ? 'EXPENSES' : ''), c = this.counter(x);
    const dr = d === 'in' ? c : desc, cr = d === 'in' ? desc : c;
    return (E.isCashLike(dr) ? a : 0) - (E.isCashLike(cr) ? a : 0);
  }
  private expEff(x: VLine) { return this.dir(x) === 'exp' ? this.amt(x) : 0; }
  /** The saved version of a row being changed (null for others). */
  private orig(x: VLine) { const j = x.editing ? this.savedJv(x) : undefined; return j ? this.fromJv(j) : null; }
  trail() { if (this.filled(this.rows[this.rows.length - 1])) this.rows.push(this.empty()); }
  amtChanged(x: VLine, k: 'out' | 'inn' | 'exp') { if (num(x[k])) (['out', 'inn', 'exp'] as const).forEach(o => { if (o !== k) x[o] = ''; }); this.trail(); }
  dir(x: VLine): 'out' | 'in' | 'exp' {
    if (this.flow(x) === 'from') return num(x.exp) ? 'exp' : 'out';   // From's money given to Description (or paying our expense)
    return num(x.inn) ? 'in' : num(x.exp) ? 'exp' : 'out';
  }
  amt(x: VLine) { return num(x.out) || num(x.inn) || num(x.exp); }
  /** From – someone else's money, our cash / bank is not used: the From name's money is given to Description. */
  flow(x: VLine): '' | 'from' { return U(x.from) ? 'from' : ''; }
  /** the From name ('' = none – our cash / bank is used) */
  other(x: VLine) { return U(x.from); }
  counter(x: VLine) { return this.other(x) || this.modeAcc(x.mode, x.bank); }
  /** From filled → money between two names; Mode and Bank are not used. */
  hasOther(x: VLine) { return !!this.other(x); }
  /** From typed: the amount goes in Cash Out (taken from From, given to Description). */
  fromChanged(x: VLine) {
    if (this.flow(x) === 'from' && num(x.inn)) { x.out = x.inn; x.inn = ''; }
    this.autoCur(x);
    this.trail();
  }
  descChanged(x: VLine) { this.autoCur(x); this.trail(); }

  /* ---------- a stock company keeps only its own currency (e.g. MY SGD COMPANY → SGD) ---------- */
  /** The currencies the names on this row are tied to ('' names and parties are free). */
  private rowCurs(x: VLine) {
    const E = this.E();
    return [U(x.desc), U(x.from)].filter(n => n).map(n => ({ n, c: E.stockCurs(n) })).filter(o => o.c.length);
  }
  /** Message when a name on the row keeps another currency than this voucher ('' = fine). */
  curMismatch(x: VLine): string {
    const bad = this.rowCurs(x).find(o => !o.c.includes(this.cur));
    return bad ? `${bad.n} keeps only ${bad.c.join(' / ')} – use the ${bad.c[0]} tab (this voucher is ${this.cur})` : '';
  }
  /** Typing a stock company on an otherwise empty voucher switches to its currency by itself. */
  private autoCur(x: VLine) {
    const bad = this.rowCurs(x).find(o => !o.c.includes(this.cur)); if (!bad) return;
    const alone = !this.loadedVno && !this.rows.some(r => r !== x && (r.saved || this.filled(r)));
    if (!alone) return;   // other lines already in this currency – Save will say what is wrong
    this.cur = bad.c[0];
    this.ui.toast('Switched to ' + this.cur + ' – ' + bad.n + ' keeps ' + bad.c.join(' / '));
  }
  /** Account a mode pays from / into: Cash → CASH, Hand cash → HAND CASH, Bank → the chosen bank. */
  modeAcc(mode: CbMode, bank: string) { return mode === 'bank' ? (bank || 'BANK') : mode === 'hand' ? HAND_CASH : 'CASH'; }

  /* ---------- details of a saved name typed in Description (shown under the grid) ---------- */
  act: VLine | null = null;   // row being typed in
  private infoKey = ''; private infoE: Engine | null = null; private infoVal: AccInfo | null = null;
  accInfo(): AccInfo | null {
    const x = this.act; if (!x || !this.rows.includes(x)) return null;
    const n = U(x.desc), E = this.E(), S = this.S(), key = n + '|' + this.cur;
    if (key === this.infoKey && E === this.infoE) return this.infoVal;   // worked out once per name / currency / book
    this.infoKey = key; this.infoE = E; this.infoVal = null;
    if (!n || !S.accounts[n]) return null;
    const t = E.accType(n), seeBal = this.auth.canPage('ledger') || this.auth.seeMoney(), seeBills = this.auth.canPage('pay') || this.auth.canPage('bill');
    const B = E.balances();
    const bals = E.curOrder(B).filter(c => Math.abs((B[c] || {})[n] || 0) > 0.004).map(c => ({ c, v: B[c][n] }));
    return this.infoVal = {
      n, type: (TYPES as Record<string, string>)[t] || t, owes: t === 'party' || t === 'dealer' || t === 'stock', phone: seeBills ? S.accounts[n].phone || '' : '', cur: this.cur,
      bals: seeBal ? bals : null, now: (B[this.cur] || {})[n] || 0,
      pend: seeBills ? E.allCurs().flatMap(c => E.pendingLines(n, c).map(p => ({ ...p, c }))) : null,
      last: this.auth.canPage('ledger') ? (E.ledger(n).find(b => b.cur === this.cur)?.lines.slice(-5).reverse() || []) : null,
    };
  }
  /** Balance in the voucher currency once the row being typed is saved (null = no amount yet; wrapped so 0.00 still shows). */
  afterEntry(ai: AccInfo): { v: number } | null {
    const x = this.act, a = x && !this.locked(x) ? this.amt(x) : 0;   // a saved row is already in the balance
    if (!x || !a) return null;
    let v = ai.now + (this.dir(x) === 'in' ? -a : a);
    const old = this.orig(x);   // changing a saved line: take its saved amount out first
    if (old && U(old.desc) === ai.n) { const oa = this.amt(old); v -= this.dir(old) === 'in' ? -oa : oa; }
    return { v: r2(v) };
  }
  sym(c: string) { return c === this.S().base ? '₹' : c + ' '; }
  openLedger(n: string) { this.router.navigate(['/ledger'], { queryParams: { acct: n } }); }
  /** Enter moves to the next box; a new row appears by itself */
  nextBox(ev: Event) {
    ev.preventDefault();
    const el = ev.target as HTMLElement, all = Array.from(document.querySelectorAll<HTMLElement>('.vg input:not([disabled]),.vg select:not([disabled])'));
    const i = all.indexOf(el); this.trail(); setTimeout(() => { const nx = Array.from(document.querySelectorAll<HTMLElement>('.vg input:not([disabled]),.vg select:not([disabled])'))[i + 1]; nx?.focus(); }, 0);
  }
  removeRow(i: number) { this.rows.splice(i, 1); if (!this.rows.length) this.rows.push(this.empty()); }

  /* live totals – Cash In / Out / Expense / Net cover the whole voucher; cash in hand and profit add only what is not saved yet
     (saved rows are already in them; a saved row being changed adds just the difference) */
  tot() {
    let o = 0, i = 0, e = 0, cd = 0, eu = 0;
    this.rows.forEach(x => {
      const a = this.amt(x), d = this.dir(x);
      if (a) { if (d === 'out') o += a; else if (d === 'in') i += a; else e += a; }
      if (x.saved && !x.editing) return;
      const old = this.orig(x);
      cd += this.cashEff(x) - (old ? this.cashEff(old) : 0);
      eu += this.expEff(x) - (old ? this.expEff(old) : 0);
    });
    const E = this.E(), c0 = E.cashNow(this.cur), tp = E.totalProfit().total;
    return { o, i, e, net: i - o - e, c0, cd, c1: c0 + cd, tp, p1: tp - eu * E.curRate(this.cur), ex: eu * E.curRate(this.cur) };
  }
  sentence(x: VLine, cur = this.cur) {
    const a = (cur === this.S().base ? '₹' : cur + ' ') + m(this.amt(x)), d = U(x.desc) || 'EXPENSES', via = x.mode === 'bank' ? 'Bank' + (x.bank && x.bank !== 'BANK' ? ' (' + x.bank + ')' : '') : x.mode === 'hand' ? 'Hand cash' : 'Cash';
    const k = this.dir(x), o = this.other(x);
    if (o) {   // From: someone else's money – our cash / bank is not touched
      if (k === 'exp') return `Take ${a} from <b>${o}</b> → pay our expense <b>${d}</b> (our cash not touched)`;
      return `Take ${a} from <b>${o}</b> → give to <b>${d}</b> (our cash not touched)`;
    }
    if (k === 'exp') return `We <b>SPEND</b> ${a} on <b>${d}</b> from ${via}`;
    if (d === 'CAPITAL' && k === 'in') return `Owner puts <b>${a}</b> into ${via} (capital)`;
    return k === 'out' ? `We <b>GIVE</b> ${a} to <b>${d}</b> from ${via}` : `We <b>GET</b> ${a} from <b>${d}</b> into ${via}`;
  }

  /* currency switch: unsaved rows of the old currency are saved, kept as a draft, or the switch is cancelled */
  drafts: Record<string, VLine[]> = {};
  draftCount(c: string) { return (this.drafts[c] || []).filter(x => this.unsaved(x)).length; }
  async switchCur(c: string) {
    if (c === this.cur) return;
    const from = this.cur, n = this.pendingRows().length, hadSaved = this.rows.some(x => x.saved);
    if (n) {
      const k = await this.ui.choose('Save ' + from + ' entries first?',
        'You have <b>' + n + ' unsaved ' + from + ' row' + (n > 1 ? 's' : '') + '</b>. Do you want to save them before switching to <b>' + c + '</b>?',
        [{ k: 'save', label: '✓ Yes, save', cls: 'pr' }, { k: 'draft', label: 'Keep separate (draft)' }, { k: 'cancel', label: 'Cancel' }],
        '“Keep separate” keeps these ' + from + ' rows as a draft. Click ' + from + ' again to continue them.');
      if (k === 'save') { if (!(await this.saveVoucher())) return; }
      else if (k === 'draft') this.drafts[from] = this.rows;
      else return;
    }
    const lv = this.loadedVno;
    if (lv) {   // an opened voucher that also has lines in that currency → show those
      const L = this.S().jv.filter(j => !j.link && String(j.vno || '').trim() === lv && j.cur === c);
      if (L.length) { this.cur = c; this.rows = [...L.map(j => this.fromJv(j)), this.empty()]; delete this.drafts[c]; return; }
    }
    if (hadSaved && this.rows.some(x => x.saved)) {   // rows already saved under this number → next currency gets a new one
      this.vno = String(this.E().nextVno());
      if (this.loadedVno) { this.loadedVno = ''; this.date = today(); }
    }
    this.cur = c;
    this.rows = this.drafts[c] || [this.empty()];
    delete this.drafts[c];
  }

  /** What is wrong with one line ('' = fine). An expense line with no description becomes EXPENSES. */
  lineError(y: VLine): string {
    const wrong = this.curMismatch(y);
    if (wrong) return wrong;
    if (this.dir(y) === 'exp') { if (!U(y.desc)) y.desc = 'EXPENSES'; else if (this.S().accounts[U(y.desc)] && this.E().accType(U(y.desc)) !== 'expense') return U(y.desc) + ' is not an expense. Use RENT, TEA, SALARY…'; }
    if (!U(y.desc)) return 'enter Description';
    if (!(this.amt(y) > 0)) return 'enter Cash In, Cash Out or Expense amount';
    if (this.other(y) && this.other(y) === U(y.desc)) return 'From must be different from Description';
    if (!this.other(y) && U(y.desc) === this.counter(y)) return 'Description can’t be ' + this.counter(y) + '. Use CAPITAL + Cash In to add your own money.';
    return '';
  }
  /** One line → the jv record the API saves; the accounts it uses are added to `accounts`. */
  toEntry(x: VLine, date: string, vno: string, cur: string, accounts: any[]) {
    const S = this.S(), d = this.dir(x), desc = U(x.desc), c = this.counter(x);
    const t = d === 'exp' ? 'expense' : (S.accounts[desc] ? this.E().accType(desc) : (desc === 'CAPITAL' ? 'capital' : /EXPENSE/.test(desc) ? 'expense' : 'party'));
    accounts.push({ name: desc, type: t }, { name: c, type: this.hasOther(x) ? 'party' : (x.mode === 'bank' ? 'bank' : 'cash') });
    return { date, vno, type: d, desc, dr: d === 'in' ? c : desc, cr: d === 'in' ? desc : c, cur, amt: r2(this.amt(x)), note: x.note,
      mode: this.hasOther(x) ? '' : x.mode, bank: x.mode === 'bank' && !this.hasOther(x) ? x.bank : '' };
  }

  /** Saves new lines and lines being changed, then starts the next voucher. */
  async saveVoucher(): Promise<boolean> {
    const LL = this.rows.filter(x => this.unsaved(x)), ED = this.rows.filter(x => x.saved && x.editing);
    if (!LL.length && !ED.length) {
      if (this.rows.some(x => x.saved)) { this.ui.toast('✓ Voucher ' + this.vno + ' done'); this.newVoucher(); return true; }   // every row already saved one by one
      this.ui.toast('Add at least one line'); return false;
    }
    for (const y of [...ED, ...LL]) { const err = this.lineError(y); if (err) { this.ui.toast('Line ' + (this.rows.indexOf(y) + 1) + ': ' + err); return false; } }
    const lines = [...this.billWarnings([...ED, ...LL]), ...ED.map(x => '✏️ Change line ' + (this.rows.indexOf(x) + 1) + ': ' + this.sentence(x)), ...LL.map(x => this.sentence(x))];
    if (!(await this.ui.confirm('Please check – Voucher ' + this.vno + ' (' + this.cur + ')', lines))) return false;
    for (const x of ED) if (!(await this.updateLine(x))) return false;
    if (LL.length) {
      const accounts: any[] = [];
      const entries = LL.map(x => this.toEntry(x, this.date, this.vno, this.cur, accounts));
      if (!(await this.store.save('post', '/jv', { entries, accounts }))) return false;
    }
    this.ui.toast('Voucher ' + this.vno + ' saved');
    this.scrolled = 0; this.newVoucher();   // next voucher (an opened old voucher goes back to today's date)
    return true;
  }
  newVoucher() {
    if (this.loadedVno) { this.loadedVno = ''; this.date = today(); }   // leaving an opened old voucher → back to today
    this.rows = [this.empty()]; this.vno = String(this.E().nextVno()); this.focusDesc();
  }

  /* ---------- type an earlier Voucher No. → that voucher opens in the grid ---------- */
  loadedVno = '';   // number of the earlier voucher shown in the grid ('' = new voucher)
  /** A saved voucher line as a locked grid row (✏️ / 🗑 work on it). */
  fromJv(j: Jv): VLine {
    const r = this.E().jvRow(j), a = String(j.amt);
    const mode: CbMode = r.bank ? 'bank' : (j.mode === 'hand' || j.dr === HAND_CASH || j.cr === HAND_CASH) ? 'hand' : 'cash';
    // an older "To" line (Description's money given to another name) shows as From: that name gets it, From = Description – same booking
    const toLine = r.dir === 'in' && !!r.other;
    return { desc: toLine ? r.other : r.desc, mode, bank: r.bank || 'BANK',
      out: r.dir === 'out' || toLine ? a : '', inn: r.dir === 'in' && !toLine ? a : '', exp: r.dir === 'exp' ? a : '',
      from: toLine ? r.desc : r.other, note: j.note || '', saved: true, jid: j.id };
  }
  async vnoChanged(curPref?: string) {
    const v = String(this.vno || '').trim();
    if (!v || v === this.loadedVno) return;
    const lines = this.S().jv.filter(j => !j.link && String(j.vno || '').trim() === v);   // bill payments have no voucher no.
    if (!lines.length) {                                    // a new number: leave the opened voucher, keep rows not saved yet
      if (this.loadedVno || this.rows.some(x => x.saved)) {
        this.rows = [...this.rows.filter(x => this.unsaved(x)), this.empty()];
        if (this.loadedVno) this.date = today();
        this.loadedVno = '';
      }
      return;
    }
    if (this.rows.some(x => x.saved && lines.some(j => j.id === x.jid))) { this.loadedVno = v; return; }   // already on screen
    const n = this.pendingRows().length;
    if (n && !(await this.ui.confirm('Open Voucher ' + v + '?',
      ['You have <b>' + n + ' row' + (n > 1 ? 's' : '') + ' not saved yet</b>. They will be cleared if you open Voucher ' + v + '.'], '📂 Open Voucher ' + v))) {
      this.vno = this.loadedVno || String(this.E().nextVno()); return;
    }
    const want = curPref || this.cur, cur = lines.some(j => j.cur === want) ? want : lines[0].cur, L = lines.filter(j => j.cur === cur);
    const others = [...new Set(lines.filter(j => j.cur !== cur).map(j => j.cur))];
    this.drafts = {}; this.cur = cur; this.date = L[0].date; this.loadedVno = v;
    this.rows = [...L.map(j => this.fromJv(j)), this.empty()];
    this.ui.toast('📂 Voucher ' + v + ' opened – ' + L.length + ' line' + (L.length > 1 ? 's' : '') + (others.length ? ' (also has ' + others.join(', ') + ' lines – click that currency)' : ''));
    this.focusRow(this.rows[this.rows.length - 1]);
  }

  /* ---------- save row by row: Enter on Remarks asks "save this line?" ---------- */
  private asking = false;
  async rowDone(ev: Event, x: VLine) {
    ev.preventDefault();
    if (this.asking || (ev as KeyboardEvent).isComposing) return;
    if (this.locked(x) || !this.filled(x)) { this.nextBox(ev); return; }   // nothing to save here – just move on
    const no = this.rows.indexOf(x) + 1, err = this.lineError(x);
    if (err) { this.ui.toast('Line ' + no + ': ' + err); return; }
    this.asking = true;
    try {
      if (x.editing) {                                                    // a saved line that was changed → update it
        const ok = await this.ui.confirm('Update line ' + no + '? – Voucher ' + this.vno + ' (' + this.cur + ')', [...this.billWarnings([x]), this.sentence(x)], '✅ Yes, update');
        if (!ok || !(await this.updateLine(x, '✓ Line ' + no + ' updated'))) { this.focusRow(x); return; }
        this.focusRow(this.rows.find(r => !this.locked(r) && r !== x) || this.rows[this.rows.length - 1]);
        return;
      }
      const ok = await this.ui.confirm('Save line ' + no + '? – Voucher ' + this.vno + ' (' + this.cur + ')', [...this.billWarnings([x]), this.sentence(x)]);
      if (!ok) { this.focusRow(x); return; }                              // ✏️ Go back → edit this row
      const accounts: any[] = [];
      const r = await this.store.save('post', '/jv', { entries: [this.toEntry(x, this.date, this.vno, this.cur, accounts)], accounts }, '✓ Line ' + no + ' saved');
      if (!r) { this.focusRow(x); return; }
      x.saved = true; x.jid = r.ids?.[0];
      this.trail();
      this.focusRow(this.rows[this.rows.indexOf(x) + 1]);                // next row's Description
    } finally { this.asking = false; }
  }
  focusRow(x?: VLine) {
    const i = x ? this.rows.indexOf(x) : -1; if (i < 0) return;
    setTimeout(() => document.querySelectorAll<HTMLElement>('table.vg tbody tr')[i]?.querySelector<HTMLInputElement>('td.desc input')?.focus(), 30);
  }
  savedJv(x: VLine) { return x.jid ? this.S().jv.find(j => j.id === x.jid) : undefined; }
  /** a line saved with a bank that is no longer in the bank list still shows its bank */
  hasBank(n: string) { return this.S().banks.some(b => b.name === n); }
  /** 🗑 on a saved row deletes its entry (same as in Recent entries) and takes the row out of the grid. */
  delSaved(x: VLine) { const j = this.savedJv(x); if (j) this.delJv(j); }
  /** Cursor in the first row's Description – when the page opens and after a voucher is saved / started.
   *  Skipped on touch phones so the keyboard does not pop up by itself. */
  focusDesc() {
    try { if (window.matchMedia('(pointer: coarse)').matches) return; } catch {}
    setTimeout(() => document.querySelector<HTMLInputElement>('table.vg tbody tr:first-child td.desc input')?.focus(), 0);
  }
  ngAfterViewInit() { this.focusDesc(); }
  /** A voucher to / from someone with unpaid bill lines changes their balance but does not mark the bill paid – say so. */
  billWarnings(LL: VLine[]): string[] {
    const E = this.E(), sym = this.cur === this.S().base ? '₹' : this.cur + ' ';
    return [...new Set(LL.filter(x => this.dir(x) !== 'exp').map(x => U(x.desc)))].flatMap(n => {
      const p = E.pendingLines(n, this.cur); if (!p.length) return [];
      return [`⚠️ <b>${n}</b> has unpaid bill lines (${p.map(x => 'Bill ' + x.no + ': ' + sym + m(x.due) + ' pending').join(', ')}). `
        + `This voucher changes ${n}'s balance but does <b>not</b> mark the bill paid – to settle the bill use <b>Bills &amp; payments → Pay</b>.`];
    });
  }

  /* capital */
  openCap() { this.cap = { dir: 'in', date: today(), cur: this.S().base, amt: '', mode: 'cash', bank: 'BANK', note: '' }; setTimeout(() => document.getElementById('cap-amt')?.focus(), 40); }
  async saveCap() {
    const c = this.cap!; if (!(num(c.amt) > 0)) { this.ui.toast('Enter the capital amount'); return; }
    const acc = this.modeAcc(c.mode, c.bank);
    const e = { date: c.date, vno: String(this.E().nextVno()), type: c.dir, desc: 'CAPITAL', dr: c.dir === 'in' ? acc : 'CAPITAL', cr: c.dir === 'in' ? 'CAPITAL' : acc,
      cur: c.cur, amt: r2(num(c.amt)), note: U(c.note), mode: c.mode, bank: c.mode === 'bank' ? acc : '' };
    const r = await this.store.save('post', '/jv', { entries: [e], accounts: [{ name: 'CAPITAL', type: 'capital' }, { name: acc, type: c.mode === 'bank' ? 'bank' : 'cash' }] },
      '✓ Capital ' + (c.dir === 'in' ? 'added' : 'taken out') + ': ' + c.cur + ' ' + m(num(c.amt)));
    if (r) { this.cap = null; this.vno = String(this.E().nextVno()); }
  }

  /* recent entries – spreadsheet, newest at the bottom, running cash balance */
  idTime(id: string) { const t = parseInt(String(id || '').slice(0, 8), 36); return isFinite(t) ? t : 0; }
  items = computed(() => {
    const S = this.S(), E = this.E(), items: Item[] = [], showBills = this.auth.canPage('pay') || this.auth.canPage('bill');
    S.jv.forEach(j => items.push({ k: 'jv', date: j.date, t: this.idTime(j.id), n: j.no || 0, j }));
    if (showBills) S.bills.forEach(b => b.rows.forEach((r, i) => items.push({ k: 'bill', date: b.date, t: this.idTime(b.id), n: i, b, r, i })));
    items.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.t - b.t) || (a.n - b.n));
    const run: Record<string, number> = {}, isCash = (n: string) => E.isCashLike(n);   // stock / wallet counts as cash in hand
    items.forEach(it => { if (it.k !== 'jv') return; const j = it.j!, d = (isCash(j.dr) ? j.amt : 0) - (isCash(j.cr) ? j.amt : 0); run[j.cur] = (run[j.cur] || 0) + d; it.cb = run[j.cur]; it.cd = d; });
    return { items, run };
  });
  /** currency filter for Recent entries ('' = all) – follows the Cur. column: a bill line counts in the currency its amount is in
   *  (INR for SGD bought / sold in INR), not the currency it trades. */
  CF = '';
  curMatch(it: Item) { return !this.CF || (it.k === 'jv' ? it.j!.cur : it.r!.base || this.S().base) === this.CF; }
  shown() { return this.items().items.filter(it => (this.RF === 'all' || (this.RF === 'bills' ? it.k === 'bill' : it.k === 'jv')) && this.curMatch(it)); }
  footer() {
    const tot: Record<string, { o: number; i: number; e: number }> = {}, bt = { p: 0, s: 0 }, E = this.E();
    this.shown().forEach(it => {
      if (it.k === 'jv') { const j = it.j!, r = E.jvRow(j); tot[j.cur] = tot[j.cur] || { o: 0, i: 0, e: 0 }; tot[j.cur][r.dir === 'out' ? 'o' : r.dir === 'in' ? 'i' : 'e'] += j.amt; }
      else { const r = it.r!; if ((r.base || this.S().base) === this.S().base) bt[E.rowSide(r)] += E.rowAmt(r); }
    });
    return { tot: Object.keys(tot).map(c => ({ c, ...tot[c], run: this.items().run[c] || 0 })), bt };
  }
  delJv(j: Jv) {
    const r = this.E().jvRow(j);
    this.store.remove('/jv/' + j.id, r.desc + ' ' + j.cur + ' ' + m(j.amt)).then(ok => {
      if (!ok) return;
      this.rows = this.rows.filter(x => x.jid !== j.id);   // a row saved on its own goes with its entry
      if (!this.rows.length || this.filled(this.rows[this.rows.length - 1])) this.rows.push(this.empty());
    });
  }

  /* ---------- edit a saved line right in the grid (like Bill entry – no popup). Bill payments are changed from Bills & payments. ---------- */
  canEdit(j: Jv) { return !j.link && this.auth.canPage('jv') && (this.auth.canPage('sheet') || (U(j.dr) !== 'CAPITAL' && U(j.cr) !== 'CAPITAL')); }
  /** ✏️ on a saved row: unlock it so it can be changed; Enter on Remarks (or Save voucher) updates it. */
  editRow(x: VLine) {
    const j = this.savedJv(x); if (!j || !this.canEdit(j)) return;
    x.editing = true; this.act = x; this.focusRow(x);
  }
  /** ↩ on a row being changed: put back what is saved. */
  cancelEdit(x: VLine) { const j = this.savedJv(x); if (j) Object.assign(x, this.fromJv(j), { editing: false }); }
  /** ✏️ in Recent entries: open that voucher in the grid above with this line ready to change. */
  async editFromList(j: Jv) {
    if (!this.canEdit(j)) return;
    const v = String(j.vno || '').trim(); if (!v) return;
    if (this.loadedVno === v && this.cur !== j.cur) await this.switchCur(j.cur);
    else if (this.loadedVno !== v) { this.vno = v; await this.vnoChanged(j.cur); }
    const x = this.rows.find(r => r.jid === j.id); if (!x) return;
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
    this.editRow(x);
  }
  /** Save a changed line (PUT); keeps its voucher no., uses the voucher's date and currency. */
  private async updateLine(x: VLine, msg?: string) {
    const accounts: any[] = [], entry = this.toEntry(x, this.date, this.vno, this.cur, accounts);
    const r = await this.store.save('put', '/jv/' + x.jid, { entry, accounts }, msg);
    if (r) x.editing = false;
    return !!r;
  }
  ngAfterViewChecked() {
    const w = document.getElementById('xlwrap'), n = this.shown().length;
    if (w && n !== this.scrolled) { w.scrollTop = w.scrollHeight; this.scrolled = n; }
  }
}
