import { Component, inject, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { UiService } from '../shared/ui.service';
import { SummaryComponent } from '../shared/summary.component';
import { Bill, BillRow, PayMode, PMODES, MIC } from '../core/models';
import { m, num, U, r2, today, dmy, last4 } from '../core/fmt';

interface Line {
  desc: string; phone: string; side: 'p' | 's'; cur: string; base: string; qty: string; rate: string; inv: string;
  stock: string; mode: PayMode; bank: string; dealer: string; comm: string;
  nbName: string; nbAc: string; nbIfsc: string; ndName: string; orig?: number; warned?: string;
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
  lines: Line[] = [];
  L: Line = this.newLine();
  LE = -1;
  // list
  BF: 'all' | 'pending' | 'paid' = 'all';
  q = '';
  payKey = signal<string | null>(null);
  PY: PayForm | null = null;
  phoneKey: string | null = null; phoneVal = '';

  constructor() { this.no = String(this.E().nextBillNo()); }

  newLine(cur?: string, side?: 'p' | 's', mode?: PayMode): Line {
    const S = this.store.book()!;
    const c = cur || S.currencies[0] || 'USD';
    return { desc: '', phone: '', side: side || 'p', cur: c, base: S.base, qty: '', rate: '', inv: '', stock: S.stockOf[c] || '',
      mode: mode || S.lastMode || 'bank', bank: 'BANK', dealer: '', comm: '', nbName: '', nbAc: '', nbIfsc: '', ndName: '' };
  }
  invCur(c: string) { return this.E().invCur(c); }
  curChanged() { this.L.stock = this.S().stockOf[this.L.cur] || ''; }
  invChanged() { const v = num(this.L.inv); this.L.rate = v ? String(+(1 / v).toFixed(10)) : ''; }
  lineAmt(l: Line) { return num(l.qty) * num(l.rate); }
  lineComm(l: Line) { return r2(this.lineAmt(l) * num(l.comm) / 100000); }
  partyPhone() { const a = this.S().accounts[U(this.L.desc)]; if (a && a.phone && !this.L.phone) this.L.phone = a.phone; }
  lastRate(l: Line) { return this.E().lastRate(l.cur, l.base); }

  addLine(): boolean {
    const l = this.L;
    if (!U(l.desc)) return this.err('Enter party name');
    if (!(num(l.qty) > 0)) return this.err('Enter quantity');
    if (!(num(l.rate) > 0)) return this.err('Enter rate');
    if (l.cur === l.base) return this.err('Currency and Base currency are the same. Change one.');
    const lr = this.lastRate(l), rr = num(l.rate);
    if (lr && (rr > lr * 1.3 || rr < lr * 0.7) && l.warned !== l.rate) {
      l.warned = l.rate; return this.err('⚠️ Rate ' + rr + ' is far from your usual ' + l.cur + ' rate ' + lr + '. Check it, then press Add again.');
    }
    if (l.mode === 'bank' && l.bank === '__new' && !U(l.nbName)) return this.err('Enter bank name');
    if (l.mode === 'home' && l.dealer === '__new' && !U(l.ndName)) return this.err('Enter dealer name');
    const copy = { ...l, desc: U(l.desc), stock: U(l.stock) };
    if (this.LE >= 0) this.lines[this.LE] = copy; else this.lines.push(copy);
    const n = this.LE >= 0 ? this.LE + 1 : this.lines.length;
    this.ui.toast('✓ Line ' + n + (this.LE >= 0 ? ' updated' : ' added') + ' – press 💾 Save bill when done');
    this.LE = -1; this.L = this.newLine(l.cur, l.side, l.mode);
    setTimeout(() => document.getElementById('l-desc')?.focus(), 30);
    return true;
  }
  editLine(i: number) { this.LE = i; this.L = { ...this.lines[i] }; }
  cancelEdit() { this.LE = -1; this.L = this.newLine(this.L.cur, this.L.side, this.L.mode); }
  removeLine(i: number) { this.lines.splice(i, 1); if (this.LE === i) this.cancelEdit(); }
  err(msg: string) { this.ui.toast(msg); return false; }
  totals() {
    let p = 0, s = 0, c = 0;
    this.lines.forEach(l => { if (l.base !== this.S().base) return; if (l.side === 'p') p += this.lineAmt(l); else s += this.lineAmt(l); c += this.lineComm(l); });
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
    if (U(this.L.desc) || num(this.L.qty)) { if (!this.addLine()) return; }
    if (!this.lines.length) { this.ui.toast('Add at least one line'); return; }
    if (!(await this.ui.confirm('Please check – Bill ' + (this.no || ''), this.lines.map(l => this.sentence(l))))) return;
    const S = this.S(), banks: any[] = [], dealers: any[] = [], accounts: any[] = [], stockOf = { ...S.stockOf };
    const rows: BillRow[] = this.lines.map(l => {
      let bank = l.mode === 'bank' ? l.bank : '', dealer = l.mode === 'home' ? l.dealer : '';
      if (bank === '__new') { bank = U(l.nbName); banks.push({ name: bank, acno: l.nbAc, ifsc: l.nbIfsc, comm: num(l.comm) }); }
      if (dealer === '__new') { dealer = U(l.ndName); dealers.push({ name: dealer, comm: num(l.comm) }); }
      if (l.phone) accounts.push({ name: l.desc, type: 'party', phone: l.phone });
      if (l.stock && !stockOf[l.cur]) stockOf[l.cur] = l.stock;
      return { desc: l.desc, cur: l.cur, base: l.base, qty: num(l.qty), prate: l.side === 'p' ? num(l.rate) : 0, srate: l.side === 's' ? num(l.rate) : 0,
        stock: l.stock, mode: l.mode, bank, dealer, comm: num(l.comm) };
    });
    const remap: Record<number, number> = {};
    this.lines.forEach((l, i) => { if (l.orig !== undefined) remap[l.orig] = i; });
    const r = await this.store.save('post', '/bills', {
      bill: { id: this.editId || undefined, no: this.no, date: this.date, rows }, remap, accounts, banks, dealers,
      settings: { stockOf, lastMode: this.L.mode },
    });
    if (r) { this.ui.toast('Bill ' + r.no + ' saved'); this.newBill(); }
  }
  newBill() { const d = this.date; this.editId = null; this.lines = []; this.LE = -1; this.L = this.newLine(this.L.cur, this.L.side, this.L.mode); this.date = d; this.no = String(this.E().nextBillNo()); }
  openBill(b: Bill) {
    this.editId = b.id; this.no = b.no; this.date = b.date; this.LE = -1;
    this.lines = b.rows.map((r, i) => ({ desc: r.desc, phone: this.S().accounts[r.desc]?.phone || '', side: this.E().rowSide(r), cur: r.cur, base: r.base,
      qty: String(r.qty), rate: String(this.E().rowRate(r)), inv: this.invCur(r.cur) ? String(+(1 / this.E().rowRate(r)).toFixed(6)) : '',
      stock: r.stock, mode: r.mode, bank: r.bank || 'BANK', dealer: r.dealer, comm: r.comm ? String(r.comm) : '', nbName: '', nbAc: '', nbIfsc: '', ndName: '', orig: i }));
    this.L = this.newLine(this.lines[0]?.cur); window.scrollTo(0, 0);
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
