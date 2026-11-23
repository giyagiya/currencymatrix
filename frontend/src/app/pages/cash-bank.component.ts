import { Component, inject, computed, AfterViewChecked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { UiService } from '../shared/ui.service';
import { Jv, BillRow, Bill, PMODES, VM } from '../core/models';
import { m, num, U, r2, today, dmy } from '../core/fmt';

interface VLine { desc: string; mode: 'cash' | 'bank'; bank: string; out: string; inn: string; exp: string; other: string; note: string; }
interface Item { k: 'jv' | 'bill'; date: string; t: number; n: number; j?: Jv; b?: Bill; r?: BillRow; i?: number; cb?: number; cd?: number; }

@Component({
  standalone: true,
  imports: [FormsModule],
  templateUrl: './cash-bank.component.html',
})
export class CashBankComponent implements AfterViewChecked {
  store = inject(StoreService); auth = inject(AuthService); ui = inject(UiService);
  m = m; num = num; dmy = dmy; PMODES = PMODES;
  E = computed(() => this.store.engine()!);
  S = computed(() => this.store.book()!);
  date = today(); vno = ''; cur = '';
  rows: VLine[] = [this.empty()];
  RF: 'all' | 'vouchers' | 'bills' = 'all';
  cap: { dir: 'in' | 'out'; date: string; cur: string; amt: string; mode: 'cash' | 'bank'; bank: string; note: string } | null = null;
  private scrolled = 0;

  constructor() { this.cur = this.S().base; this.vno = String(this.E().nextVno()); }
  empty(): VLine { return { desc: '', mode: 'cash', bank: 'BANK', out: '', inn: '', exp: '', other: '', note: '' }; }
  filled(x: VLine) { return !!(U(x.desc) || num(x.out) || num(x.inn) || num(x.exp)); }
  trail() { if (this.filled(this.rows[this.rows.length - 1])) this.rows.push(this.empty()); }
  amtChanged(x: VLine, k: 'out' | 'inn' | 'exp') { if (num(x[k])) (['out', 'inn', 'exp'] as const).forEach(o => { if (o !== k) x[o] = ''; }); this.trail(); }
  dir(x: VLine): 'out' | 'in' | 'exp' { return num(x.inn) ? 'in' : num(x.exp) ? 'exp' : 'out'; }
  amt(x: VLine) { return num(x.out) || num(x.inn) || num(x.exp); }
  counter(x: VLine) { return U(x.other) || (x.mode === 'bank' ? (x.bank || 'BANK') : 'CASH'); }
  /** Enter moves to the next box; a new row appears by itself */
  nextBox(ev: Event) {
    ev.preventDefault();
    const el = ev.target as HTMLElement, all = Array.from(document.querySelectorAll<HTMLElement>('.vg input:not([disabled]),.vg select:not([disabled])'));
    const i = all.indexOf(el); this.trail(); setTimeout(() => { const nx = Array.from(document.querySelectorAll<HTMLElement>('.vg input:not([disabled]),.vg select:not([disabled])'))[i + 1]; nx?.focus(); }, 0);
  }
  removeRow(i: number) { this.rows.splice(i, 1); if (!this.rows.length) this.rows.push(this.empty()); }

  /* live totals */
  tot() {
    let o = 0, i = 0, e = 0, cd = 0;
    this.rows.forEach(x => { const a = this.amt(x); if (!a) return; const d = this.dir(x); if (d === 'out') o += a; else if (d === 'in') i += a; else e += a;
      if (!U(x.other) && x.mode === 'cash') cd += d === 'in' ? a : -a; });
    const E = this.E(), c0 = E.cashNow(this.cur), tp = E.totalProfit().total;
    return { o, i, e, net: i - o - e, c0, cd, c1: c0 + cd, tp, p1: tp - e * E.curRate(this.cur), ex: e * E.curRate(this.cur) };
  }
  sentence(x: VLine, cur = this.cur) {
    const a = (cur === this.S().base ? '₹' : cur + ' ') + m(this.amt(x)), d = U(x.desc) || 'EXPENSES', via = x.mode === 'bank' ? 'Bank' + (x.bank && x.bank !== 'BANK' ? ' (' + x.bank + ')' : '') : 'Cash';
    if (U(x.other)) return `<b>${U(x.other)}</b> pays <b>${d}</b> ${a} for us`;
    const k = this.dir(x);
    if (k === 'exp') return `We <b>SPEND</b> ${a} on <b>${d}</b> from ${via}`;
    if (d === 'CAPITAL' && k === 'in') return `Owner puts <b>${a}</b> into ${via} (capital)`;
    return k === 'out' ? `We <b>GIVE</b> ${a} to <b>${d}</b> from ${via}` : `We <b>GET</b> ${a} from <b>${d}</b> into ${via}`;
  }

  /* currency switch: unsaved rows of the old currency are saved, kept as a draft, or the switch is cancelled */
  drafts: Record<string, VLine[]> = {};
  draftCount(c: string) { return (this.drafts[c] || []).filter(x => this.filled(x)).length; }
  async switchCur(c: string) {
    if (c === this.cur) return;
    const from = this.cur, n = this.rows.filter(x => this.filled(x)).length;
    if (n) {
      const k = await this.ui.choose('Save ' + from + ' entries first?',
        'You have <b>' + n + ' unsaved ' + from + ' row' + (n > 1 ? 's' : '') + '</b>. Do you want to save them before switching to <b>' + c + '</b>?',
        [{ k: 'save', label: '✓ Yes, save', cls: 'pr' }, { k: 'draft', label: 'Keep separate (draft)' }, { k: 'cancel', label: 'Cancel' }],
        '“Keep separate” keeps these ' + from + ' rows as a draft. Click ' + from + ' again to continue them.');
      if (k === 'save') { if (!(await this.saveVoucher())) return; }
      else if (k === 'draft') this.drafts[from] = this.rows;
      else return;
    }
    this.cur = c;
    this.rows = this.drafts[c] || [this.empty()];
    delete this.drafts[c];
  }

  /** What is wrong with one line ('' = fine). An expense line with no description becomes EXPENSES. */
  lineError(y: VLine): string {
    if (this.dir(y) === 'exp') { if (!U(y.desc)) y.desc = 'EXPENSES'; else if (this.S().accounts[U(y.desc)] && this.E().accType(U(y.desc)) !== 'expense') return U(y.desc) + ' is not an expense. Use RENT, TEA, SALARY…'; }
    if (!U(y.desc)) return 'enter Description';
    if (!(this.amt(y) > 0)) return 'enter IN, OUT or EXPENSE amount';
    if (U(y.other) && U(y.other) === U(y.desc)) return 'From/To must be different';
    if (!U(y.other) && U(y.desc) === this.counter(y)) return 'Description can’t be ' + this.counter(y) + '. Use CAPITAL + IN to add your own money.';
    return '';
  }
  /** One line → the jv record the API saves; the accounts it uses are added to `accounts`. */
  toEntry(x: VLine, date: string, vno: string, cur: string, accounts: any[]) {
    const S = this.S(), d = this.dir(x), desc = U(x.desc), c = this.counter(x);
    const t = d === 'exp' ? 'expense' : (S.accounts[desc] ? this.E().accType(desc) : (desc === 'CAPITAL' ? 'capital' : /EXPENSE/.test(desc) ? 'expense' : 'party'));
    accounts.push({ name: desc, type: t }, { name: c, type: U(x.other) ? 'party' : (x.mode === 'bank' ? 'bank' : 'cash') });
    return { date, vno, type: d, desc, dr: d === 'in' ? c : desc, cr: d === 'in' ? desc : c, cur, amt: r2(this.amt(x)), note: x.note,
      mode: U(x.other) ? '' : x.mode, bank: x.mode === 'bank' && !U(x.other) ? x.bank : '' };
  }

  async saveVoucher(): Promise<boolean> {
    const LL = this.rows.filter(x => this.filled(x));
    if (!LL.length) { this.ui.toast('Add at least one line'); return false; }
    for (let q = 0; q < LL.length; q++) { const err = this.lineError(LL[q]); if (err) { this.ui.toast('Line ' + (q + 1) + ': ' + err); return false; } }
    if (!(await this.ui.confirm('Please check – Voucher ' + this.vno + ' (' + this.cur + ')', LL.map(x => this.sentence(x))))) return false;
    const accounts: any[] = [];
    const entries = LL.map(x => this.toEntry(x, this.date, this.vno, this.cur, accounts));
    const r = await this.store.save('post', '/jv', { entries, accounts }, 'Voucher ' + this.vno + ' saved');
    if (r) { this.rows = [this.empty()]; this.vno = String(this.E().nextVno()); this.scrolled = 0; }
    return !!r;
  }
  newVoucher() { this.rows = [this.empty()]; this.vno = String(this.E().nextVno()); }

  /* capital */
  openCap() { this.cap = { dir: 'in', date: today(), cur: this.S().base, amt: '', mode: 'cash', bank: 'BANK', note: '' }; setTimeout(() => document.getElementById('cap-amt')?.focus(), 40); }
  async saveCap() {
    const c = this.cap!; if (!(num(c.amt) > 0)) { this.ui.toast('Enter the capital amount'); return; }
    const acc = c.mode === 'bank' ? (c.bank || 'BANK') : 'CASH';
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
    const run: Record<string, number> = {}, isCash = (n: string) => E.accType(n) === 'cash';
    items.forEach(it => { if (it.k !== 'jv') return; const j = it.j!, d = (isCash(j.dr) ? j.amt : 0) - (isCash(j.cr) ? j.amt : 0); run[j.cur] = (run[j.cur] || 0) + d; it.cb = run[j.cur]; it.cd = d; });
    return { items, run };
  });
  /** currency filter for Recent entries ('' = all). A bill line matches the currency it trades (SGD…) and the one it is priced in (INR). */
  CF = '';
  curMatch(it: Item) { return !this.CF || (it.k === 'jv' ? it.j!.cur === this.CF : it.r!.cur === this.CF || (it.r!.base || this.S().base) === this.CF); }
  shown() { return this.items().items.filter(it => (this.RF === 'all' || (this.RF === 'bills' ? it.k === 'bill' : it.k === 'jv')) && this.curMatch(it)); }
  footer() {
    const tot: Record<string, { o: number; i: number; e: number }> = {}, bt = { p: 0, s: 0 }, E = this.E();
    this.shown().forEach(it => {
      if (it.k === 'jv') { const j = it.j!, r = E.jvRow(j); tot[j.cur] = tot[j.cur] || { o: 0, i: 0, e: 0 }; tot[j.cur][r.dir === 'out' ? 'o' : r.dir === 'in' ? 'i' : 'e'] += j.amt; }
      else { const r = it.r!; if ((r.base || this.S().base) === this.S().base) bt[E.rowSide(r)] += E.rowAmt(r); }
    });
    return { tot: Object.keys(tot).map(c => ({ c, ...tot[c], run: this.items().run[c] || 0 })), bt };
  }
  delJv(j: Jv) { const r = this.E().jvRow(j); this.store.remove('/jv/' + j.id, r.desc + ' ' + j.cur + ' ' + m(j.amt)); }

  /* edit one saved voucher line in a popup (bill payments are changed from Bills & payments) */
  ed: { id: string; date: string; vno: string; cur: string; dir: 'in' | 'out' | 'exp'; amt: string; desc: string; mode: 'cash' | 'bank'; bank: string; other: string; note: string } | null = null;
  canEdit(j: Jv) { return !j.link && this.auth.canPage('jv') && (this.auth.canPage('sheet') || (U(j.dr) !== 'CAPITAL' && U(j.cr) !== 'CAPITAL')); }
  openEdit(j: Jv) {
    const r = this.E().jvRow(j);
    this.ed = { id: j.id, date: j.date, vno: j.vno || '', cur: j.cur, dir: r.dir, amt: String(j.amt), desc: r.desc, mode: r.bank ? 'bank' : 'cash', bank: r.bank || 'BANK', other: r.other, note: j.note || '' };
    setTimeout(() => document.getElementById('ed-amt')?.focus(), 40);
  }
  /** bank choices for the popup – keeps the line's own bank even if it is no longer in the bank list */
  edBanks() { const l = ['BANK', ...this.S().banks.map(b => b.name)]; return this.ed && !l.includes(this.ed.bank) ? [...l, this.ed.bank] : l; }
  edLine(): VLine {
    const e = this.ed!;
    return { desc: e.desc, mode: e.mode, bank: e.bank, out: e.dir === 'out' ? e.amt : '', inn: e.dir === 'in' ? e.amt : '', exp: e.dir === 'exp' ? e.amt : '', other: e.other, note: e.note };
  }
  async saveEdit() {
    const e = this.ed!, x = this.edLine(), err = this.lineError(x);
    if (!e.date) { this.ui.toast('Enter the date'); return; }
    if (err) { this.ui.toast(err.charAt(0).toUpperCase() + err.slice(1)); return; }
    if (!(await this.ui.confirm('Please check – change Voucher ' + e.vno + ' (' + e.cur + ')', [this.sentence(x, e.cur)], '✅ Yes, update'))) return;
    const accounts: any[] = [], entry = this.toEntry(x, e.date, e.vno, e.cur, accounts);
    if (await this.store.save('put', '/jv/' + e.id, { entry, accounts }, 'Voucher ' + e.vno + ' updated')) this.ed = null;
  }
  ngAfterViewChecked() {
    const w = document.getElementById('xlwrap'), n = this.shown().length;
    if (w && n !== this.scrolled) { w.scrollTop = w.scrollHeight; this.scrolled = n; }
  }
}
