import { Component, inject, computed, signal } from '@angular/core';
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
}
interface PayForm { date: string; amt: string; mode: PayMode; bank: string; dealer: string; comm: string; person: string; ref: string; nbName: string; nbAc: string; nbIfsc: string; ndName: string; }

@Component({
  standalone: true,
  imports: [FormsModule, SummaryComponent],
  templateUrl: './bill.component.html',
})
export class BillComponent {
  store = inject(StoreService); auth = inject(AuthService); ui = inject(UiService);
  m = m; num = num; dmy = dmy; PMODES = PMODES; MIC = MIC; modes: PayMode[] = ['bank', 'shop', 'home'];
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

  /** A new row copies type, currency, price-in, pay-by, bank and dealer from the row above. */
  newLine(p?: Line): Line {
    const S = this.store.book()!;
    const c = p?.cur || S.currencies[0] || 'USD';
    return { desc: '', phone: '', side: p?.side || 'p', cur: c, base: p?.base || S.base, qty: '', rate: '', inv: '', stock: p?.stock || S.stockOf[c] || '',
      mode: p?.mode || S.lastMode || 'bank', bank: p?.bank || 'BANK', dealer: p?.dealer || '', comm: '' };
  }
  filled(l: Line) { return !!(U(l.desc) || num(l.qty) || num(l.rate)); }
  trail() { const last = this.rows[this.rows.length - 1]; if (this.filled(last)) this.rows.push(this.newLine(last)); }
  removeRow(i: number) { this.rows.splice(i, 1); if (!this.rows.length || this.filled(this.rows[this.rows.length - 1])) this.rows.push(this.newLine(this.rows[this.rows.length - 1])); }
  invCur(c: string) { return this.E().invCur(c); }
  curChanged(l: Line) { l.stock = this.S().stockOf[l.cur] || ''; }
  invChanged(l: Line) { const v = num(l.inv); l.rate = v ? String(+(1 / v).toFixed(10)) : ''; }
  lineAmt(l: Line) { return num(l.qty) * num(l.rate); }
  lineComm(l: Line) { return r2(this.lineAmt(l) * num(l.comm) / 100000); }
  partyPhone(l: Line) { const a = this.S().accounts[U(l.desc)]; if (a && a.phone && !l.phone) l.phone = a.phone; }
  lastRate(l: Line) { return this.E().lastRate(l.cur, l.base); }
  isNewBank(n: string) { n = U(n); return !!n && n !== 'BANK' && !this.S().banks.some(b => b.name === n); }
  isNewDealer(n: string) { n = U(n); return !!n && !this.S().dealers.some(d => d.name === n); }

  /** Enter in the grid: next box (across, then the next row). Enter on Rate jumps to the next row's Party. */
  gridKey(e: Event) {
    const el = e.target as HTMLElement;
    if (el.tagName === 'BUTTON' || (e as KeyboardEvent).isComposing) return;   // Enter on a button still clicks it
    e.preventDefault();
    this.trail();
    const toRow = el.dataset['enter'] === 'row', tr = el.closest('tr');
    setTimeout(() => {   // let a name picked from the party list fill in, and a new row appear
      if (toRow) { (tr?.nextElementSibling?.querySelector('td.desc input') as HTMLElement | null)?.focus(); return; }
      const boxes = Array.from(document.querySelectorAll<HTMLElement>('table.bg input:not([disabled]), table.bg select'));
      boxes[boxes.indexOf(el) + 1]?.focus();
    }, 30);
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
    const amt = '₹' + m(this.lineAmt(l)), q = l.cur + ' ' + m(num(l.qty)), r = this.E().rateShort(l.cur, num(l.rate)),
      c = num(l.comm) ? ' · commission ₹' + m(this.lineComm(l)) : '';
    return l.side === 'p'
      ? `We <b>BUY</b> ${q} from <b>${l.desc}</b> ${r} → we must <b>PAY</b> ${amt} ${this.payTxt(l)}${c}`
      : `We <b>SELL</b> ${q} to <b>${l.desc}</b> ${r} → <b>${l.desc}</b> must <b>PAY us</b> ${amt} ${this.payTxt(l)}${c}`;
  }

  async saveBill() {
    const LL = this.rows.filter(l => this.filled(l));
    if (!LL.length) { this.ui.toast('Type at least one line'); return; }
    for (let q = 0; q < LL.length; q++) {
      const l = LL[q], n = 'Line ' + (q + 1) + ': ';
      if (!U(l.desc)) { this.ui.toast(n + 'enter party name'); return; }
      if (!(num(l.qty) > 0)) { this.ui.toast(n + 'enter quantity'); return; }
      if (!(num(l.rate) > 0)) { this.ui.toast(n + 'enter rate'); return; }
      if (l.cur === l.base) { this.ui.toast(n + 'Currency and Price in are the same. Change one.'); return; }
    }
    const notes: string[] = [];
    LL.forEach((l, q) => {
      const lr = this.lastRate(l), rr = num(l.rate);
      if (lr && (rr > lr * 1.3 || rr < lr * 0.7)) notes.push(`⚠️ Line ${q + 1}: rate <b>${rr}</b> is far from your usual ${l.cur} rate ${lr}`);
    });
    const nb = [...new Set(LL.filter(l => l.mode === 'bank' && this.isNewBank(l.bank)).map(l => U(l.bank)))];
    const nd = [...new Set(LL.filter(l => l.mode === 'home' && this.isNewDealer(l.dealer)).map(l => U(l.dealer)))];
    nb.forEach(b => notes.push(`➕ New bank <b>${b}</b> will be added (A/c no. and IFSC can be added in Setup → Banks)`));
    nd.forEach(d => notes.push(`➕ New delivery dealer <b>${d}</b> will be added`));
    LL.forEach(l => { l.desc = U(l.desc); l.stock = U(l.stock); l.bank = U(l.bank) || 'BANK'; l.dealer = U(l.dealer); });
    if (!(await this.ui.confirm('Please check – Bill ' + (this.no || ''), [...notes, ...LL.map(l => this.sentence(l))]))) return;
    const S = this.S(), accounts: any[] = [], stockOf = { ...S.stockOf };
    const banks = nb.map(name => ({ name, acno: '', ifsc: '', comm: num(LL.find(l => l.mode === 'bank' && l.bank === name)!.comm) }));
    const dealers = nd.map(name => ({ name, comm: num(LL.find(l => l.mode === 'home' && l.dealer === name)!.comm) }));
    const rows: BillRow[] = LL.map(l => {
      if (l.phone) accounts.push({ name: l.desc, type: 'party', phone: l.phone });
      if (l.stock && !stockOf[l.cur]) stockOf[l.cur] = l.stock;
      return { desc: l.desc, cur: l.cur, base: l.base, qty: num(l.qty), prate: l.side === 'p' ? num(l.rate) : 0, srate: l.side === 's' ? num(l.rate) : 0,
        stock: l.stock, mode: l.mode, bank: l.mode === 'bank' ? l.bank : '', dealer: l.mode === 'home' ? l.dealer : '', comm: num(l.comm) };
    });
    const remap: Record<number, number> = {};
    LL.forEach((l, i) => { if (l.orig !== undefined) remap[l.orig] = i; });
    const r = await this.store.save('post', '/bills', {
      bill: { id: this.editId || undefined, no: this.no, date: this.date, rows }, remap, accounts, banks, dealers,
      settings: { stockOf, lastMode: LL[LL.length - 1].mode },
    });
    if (r) { this.ui.toast('Bill ' + r.no + ' saved'); this.newBill(); }
  }
  newBill() {
    const last = this.rows.filter(l => this.filled(l)).pop() || this.rows[this.rows.length - 1];
    this.editId = null; this.rows = [this.newLine(last)]; this.no = String(this.E().nextBillNo());
  }
  openBill(b: Bill) {
    this.editId = b.id; this.no = b.no; this.date = b.date;
    this.rows = b.rows.map((r, i) => ({ desc: r.desc, phone: this.S().accounts[r.desc]?.phone || '', side: this.E().rowSide(r), cur: r.cur, base: r.base,
      qty: String(r.qty), rate: String(this.E().rowRate(r)), inv: this.invCur(r.cur) ? String(+(1 / this.E().rowRate(r)).toFixed(6)) : '',
      stock: r.stock, mode: r.mode, bank: r.bank || 'BANK', dealer: r.dealer, comm: r.comm ? String(r.comm) : '', orig: i }));
    this.rows.push(this.newLine(this.rows[this.rows.length - 1]));
    window.scrollTo(0, 0);
  }

  /* ---------- saved bills & payments ---------- */
  billList = computed(() => {
    const E = this.E();
    return this.S().bills.slice().sort((a, b) => (b.date + this.p3(b.no)) > (a.date + this.p3(a.no)) ? 1 : -1);
  });
  p3(n: string) { return ('000000' + n).slice(-6); }
  shown() {
    const E = this.E(), q = U(this.q);
    return this.billList().filter(b => {
      const st = E.billState(b);
      if (this.BF === 'pending' && st.paid === st.n) return false;
      if (this.BF === 'paid' && st.paid < st.n) return false;
      if (!q) return true;
      return ('BILL ' + b.no + ' ' + b.rows.map(r => r.desc + ' ' + r.stock + ' ' + r.cur).join(' ')).toUpperCase().includes(q);
    });
  }
  pendingCount() { const E = this.E(); return this.S().bills.filter(b => { const s = E.billState(b); return s.paid < s.n; }).length; }
  billSums(b: Bill) {
    let bp = 0, bs = 0, bc = 0; const E = this.E();
    b.rows.forEach(r => { if ((r.base || this.S().base) !== this.S().base) return; if (E.rowSide(r) === 'p') bp += E.rowAmt(r); else bs += E.rowAmt(r); bc += E.rowComm(r); });
    return { diff: bs - bp, comm: bc, net: bs - bp - bc };
  }
  openPay(b: Bill, i: number) {
    const r = b.rows[i];
    this.PY = { date: today(), amt: String(this.E().rowAmt(r)), mode: r.mode, bank: r.bank || 'BANK', dealer: r.dealer, comm: r.comm ? String(r.comm) : '',
      person: '', ref: '', nbName: '', nbAc: '', nbIfsc: '', ndName: '' };
    this.payKey.set(b.id + ':' + i);
  }
  async confirmPay(b: Bill, i: number) {
    const P = this.PY!, r = b.rows[i], sd = this.E().rowSide(r), amt = num(P.amt), cm = num(P.comm);
    if (!(amt > 0)) { this.ui.toast('Enter amount'); return; }
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
    const ok = await this.ui.confirm('Please check', [(sd === 'p' ? 'We <b>PAY</b> ' : 'We <b>GET</b> ') + '₹' + m(amt) + (sd === 'p' ? ' to <b>' : ' from <b>') + r.desc + '</b> ' + this.payTxt({ ...P, bank: ac, dealer: accType === 'dealer' ? ac : '' })
      + (cm ? ' · commission ₹' + m(r2(amt * cm / 100000)) : '')]);
    if (!ok) return;
    const pay: any = { date: P.date || today(), type: sd === 'p' ? 'payment' : 'receipt', desc: '', dr: sd === 'p' ? r.desc : ac, cr: sd === 'p' ? ac : r.desc,
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
  unpay(b: Bill, i: number) { this.store.remove('/payments/' + b.id + '/' + i, 'this payment (back to pending)', 'Back to pending'); }
  delBill(b: Bill) { this.store.remove('/bills/' + b.id, 'Bill ' + b.no, 'Bill deleted').then(ok => { if (ok && this.editId === b.id) this.newBill(); }); }

  phoneOf(n: string) { return this.S().accounts[n]?.phone || ''; }
  waText(b: Bill, party: string) {
    const E = this.E(), o: string[] = [];
    b.rows.forEach((r, i) => {
      if (r.desc !== party) return; const sd = E.rowSide(r), pj = E.payOf(b.id, i);
      o.push('Amount: ' + (r.base || this.S().base) + ' ' + m(E.rowAmt(r)));
      const pmd = pj ? pj.mode : r.mode, pbk = pj ? (pj.bank ? E.bankBy(pj.bank) : undefined) : (r.bank ? E.bankBy(r.bank) : undefined), pdl = pj ? pj.dealer : (r.mode === 'home' ? r.dealer : '');
      o.push((sd === 'p' ? 'Pay out by: ' : 'Receive by: ') + PMODES[pmd] + (pmd === 'home' && pdl ? ' (' + pdl + ')' : '') + (pmd === 'bank' && pbk ? ' (' + pbk.name + (pbk.acno ? ' A/c ' + last4(pbk.acno) : '') + (pbk.ifsc ? ', IFSC ' + pbk.ifsc : '') + ')' : ''));
      o.push('Status: ' + (pj ? '✅ ' + (sd === 'p' ? 'PAID' : 'RECEIVED') + ' via ' + PMODES[pj.mode] + ' on ' + dmy(pj.date) + (pj.ref ? ' (Ref ' + pj.ref + ')' : '') : '⏳ PENDING'));
    });
    const bal = E.partyBal(party);
    o.push('Balance: ₹' + m(Math.abs(bal)) + (bal > 0.004 ? ' Dr (payable by you)' : bal < -0.004 ? ' Cr (payable to you)' : ' (settled)'));
    return o.join('\n');
  }
  waLink(b: Bill, party: string) { let d = this.phoneOf(party).replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return 'https://wa.me/' + d + '?text=' + encodeURIComponent(this.waText(b, party)); }
  async savePhone(party: string) {
    const r = await this.store.save('put', '/accounts/' + encodeURIComponent(party) + '/phone', { phone: this.phoneVal }, '✓ WhatsApp number saved');
    if (r) this.phoneKey = null;
  }
}
