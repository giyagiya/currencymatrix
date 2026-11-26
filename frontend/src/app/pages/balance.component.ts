import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { UiService } from '../shared/ui.service';
import { TYPES } from '../core/models';
import { SheetBlock } from '../core/engine';
import { m, num, today } from '../core/fmt';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
  <div class="card">
    <div class="grid4">
      <div><label>As on date</label><input type="date" [(ngModel)]="f.to"></div>
      <div><label>Name</label><select [(ngModel)]="f.acct"><option value="">All names</option>@for (a of E().allAccounts(); track a) { <option [value]="a">{{ a }}</option> }</select></div>
      <div><label>Type</label><select [(ngModel)]="f.typ"><option value="all">All types</option><option value="party">Party</option><option value="dealer">Delivery dealer</option>
        <option value="stock">Stock / wallet</option><option value="cb">Cash &amp; Bank</option><option value="expense">Expense</option><option value="capital">Capital</option></select></div>
      <div><label>Currency</label><select [ngModel]="curNow()" (ngModelChange)="setCur($event)"><option value="all">All currencies</option>@for (c of shownCurs(); track c) { <option [value]="c">{{ c }}</option> }</select></div>
    </div>
    <div class="hint">Shows the currencies you buy and sell{{ baseTraded() ? '' : ' (' + base() + ' shows only when a bill buys or sells ' + base() + ')' }}. Totals are worked out only for the names shown.{{ canLedger() ? ' Tap a name to open its ledger.' : '' }}</div>
  </div>

  @if (blocks(); as blocks) {
    @if (blocks.length) {
      <div class="card pad0"><div class="gridwrap"><table class="s grid bs">
        <colgroup><col><col class="amt"><col class="amt"></colgroup>
        <tr><th class="l">Dr = they owe us · Cr = we owe them</th><th>Debit</th><th>Credit</th></tr>
        @for (b of blocks; track b.cur; let first = $first) {
          @if (!first) { <tr class="bs-gap"><td colspan="3"></td></tr> }
          <tr class="bs-cur"><td class="l">{{ b.cur }}</td><td></td><td></td></tr>
          @for (r of b.rows; track r.a) {
            <tr><td class="l">@if (canLedger()) { <a class="acc" (click)="openLedger(r.a)">{{ r.a }}</a> } @else { <span class="acc0">{{ r.a }}</span> }
                @if (r.t !== 'party') { <span class="tag">{{ TYPES[r.t] }}</span> }</td>
              <td class="n">{{ r.b > 0 ? m(r.b) : '' }}</td><td class="n" [class.bs-cr]="r.b < 0">{{ r.b < 0 ? m(-r.b) : '' }}</td></tr>
          }
          <tr class="bs-tot"><td></td><td class="n">{{ m(b.dr) }}</td><td class="n">{{ m(b.cr) }}</td></tr>
          <tr class="bs-s"><td class="l">Outstanding value</td><td class="n">{{ m(b.os) }}</td><td></td></tr>
          <tr class="bs-s"><td class="l" title="Cash accounts and stock / wallet companies">Cash in hand value <small class="sub">incl. stock / wallet</small></td><td class="n">{{ m(b.cash) }}</td><td></td></tr>
          <tr class="bs-s"><td class="l">Bank value</td><td class="n">{{ m(b.bank) }}</td><td></td></tr>
          <tr class="bs-s"><td class="l">Total</td><td class="n dash">{{ m(b.total) }}</td><td></td></tr>
          <tr class="bs-s"><td class="l">Credit outstanding value</td><td class="n">{{ m(b.cos) }}</td><td></td></tr>
          <tr class="bs-s"><td class="l">Expenses (already included)</td><td class="n">{{ m(b.exp) }}</td><td></td></tr>
          <tr class="bs-s bs-net"><td class="l">Net total</td><td class="n dash2">{{ m(b.net) }}</td><td></td></tr>
          @if (b.cap) { <tr class="bs-s"><td class="l">Capital (your money)</td><td class="n">{{ m(b.cap) }}</td><td></td></tr> }
        }
      </table></div></div>
    } @else { <div class="empty">Nothing to show.</div> }
  }

  @if (exp().rows.length) {
    <div class="card"><h2 class="sech">Expenses by head</h2>
      <div class="gridwrap"><table class="s grid">
        <tr><th class="l">Expense</th><th>Currency</th><th>Amount</th></tr>
        @for (e of exp().rows; track e.c + e.a) {
          <tr><td class="l">@if (canLedger()) { <a class="acc" (click)="openLedger(e.a)">{{ e.a }}</a> } @else { {{ e.a }} }</td><td>{{ e.c }}</td><td class="n exp">{{ m(e.v) }}</td></tr>
        }
        @for (t of exp().tots; track t.c) { <tr class="bs-tot"><td class="l">Total expenses</td><td>{{ t.c }}</td><td class="n">{{ m(t.v) }}</td></tr> }
      </table></div>
      <div class="hint">{{ canLedger() ? 'Tap an expense to open its ledger. ' : '' }}Expenses are already taken out of Cash / Bank and reduce Total profit.</div>
    </div>
  }

  @if (tp(); as t) {
    @if (t.parts.length) {
      <div class="card">
        <h2 class="sech">Total profit (all currencies in {{ t.base }})</h2>
        <div class="gridwrap"><table class="s grid">
          <tr><th class="l">Currency</th><th>Net (excl. capital)</th><th>Rate</th><th>In {{ t.base }}</th></tr>
          @for (p of t.parts; track p.cur) {
            <tr><td class="l">{{ p.cur }}</td><td class="n">{{ m(p.net) }}</td>
              <td class="n">@if (p.cur === t.base) { — } @else if (auth.isSuper()) { <input class="rate" [ngModel]="+p.rate.toFixed(4)" (change)="setRate(p.cur, $any($event.target).value)" inputmode="decimal"> } @else { {{ +p.rate.toFixed(4) }} }</td>
              <td class="n">{{ m(p.inBase) }}</td></tr>
          }
          <tr class="bs-tot"><td class="l">Total value</td><td></td><td></td><td class="n">{{ m(t.value) }}</td></tr>
          <tr class="bs-s"><td class="l">Less capital</td><td></td><td></td><td class="n">{{ m(-t.cap) }}</td></tr>
          <tr class="bs-s bs-net"><td class="l">{{ t.total >= 0 ? 'Total profit' : 'Total loss' }}</td><td></td><td></td><td class="n" [class.pos]="t.total >= 0" [class.neg]="t.total < 0">{{ m(t.total) }}</td></tr>
        </table></div>
        <div class="hint">Currency you still hold is valued at what it cost you (average cost of the unsold currency){{ auth.isSuper() ? ' (change the rate to value it at today\\'s rate)' : '' }}. Capital is your own money, so it is not profit.</div>
      </div>
    }
  }

  @if (foreign().length) {
    <div class="card">
      <h2 class="sech">Convert {{ base() }} net total</h2>
      <div class="grid3">
        <div><label>{{ base() }} net total</label><input [ngModel]="cvAmt ?? m(baseNet())" (ngModelChange)="cvAmt = $event" inputmode="decimal"></div>
        <div><label>Into</label><select [ngModel]="cvCurNow()" (ngModelChange)="cvCur = $event; cvRate = null">@for (c of foreign(); track c) { <option [value]="c">{{ c }}</option> }</select></div>
        <div><label>Rate</label><input [ngModel]="cvRate ?? (cvLast() || '')" (ngModelChange)="cvRate = $event" inputmode="decimal"></div>
      </div>
      <div class="gridwrap"><table class="s grid cv">
        <tr><td class="l">{{ base() }} {{ m(cvIn()) }} / {{ cvR() || 0 }}</td><td class="n"><b>{{ cvR() ? m(cvIn() / cvR()) : '—' }} {{ cvCurNow() }}</b></td></tr>
      </table></div>
      <div class="hint">Rate starts at your latest purchase rate for {{ cvCurNow() }}. You can change it.</div>
    </div>
  }

  <div class="card"><div class="acts"><button (click)="downloadCsv()">⬇ Download CSV</button><button (click)="copyCsv()">📋 Copy as CSV</button></div></div>
  `,
})
export class BalanceComponent {
  store = inject(StoreService); auth = inject(AuthService); ui = inject(UiService); router = inject(Router);
  m = m; TYPES = TYPES as Record<string, string>;
  E = computed(() => this.store.engine()!);
  /** cur: 'all' or one currency – the choice is remembered on this device */
  f = { to: '', acct: '', typ: 'all', cur: (() => { try { return localStorage.getItem('remit.bsCur') || 'all'; } catch { return 'all'; } })() };
  setCur(c: string) { this.f.cur = c; try { localStorage.setItem('remit.bsCur', c); } catch {} }
  tp = computed(() => this.E().totalProfit());
  /** Rupees (the base currency) are shown only when a bill buys or sells rupees themselves (e.g. INR priced in SGD) – and then
   *  only that traded INR (who holds it), never the rupees paid / received for SGD, USDT… */
  baseTraded() { const base = this.base(); return this.E().S.bills.some(b => b.rows.some(r => r.cur === base)); }
  shownCurs() { return this.E().allCurs().filter(c => c !== this.base() || this.baseTraded()); }
  /** the picked currency, or 'all' when that currency is not shown (e.g. an old INR choice) */
  curNow() { return this.shownCurs().includes(this.f.cur) ? this.f.cur : 'all'; }
  blocks(): SheetBlock[] {
    const show = new Set(this.shownCurs());
    return this.E().sheetData({ ...this.f, cur: this.curNow(), stockOnly: true }).filter(b => show.has(b.cur));
  }
  /** the rupee block (same date / name / type filters) – for the Convert box */
  baseBlock(): SheetBlock | undefined { return this.E().sheetData({ ...this.f, cur: this.base() })[0]; }
  canLedger() { return this.auth.canPage('ledger'); }
  openLedger(a: string) { this.router.navigate(['/ledger'], { queryParams: { acct: a, ...(this.f.to ? { to: this.f.to } : {}) } }); }

  /** expenses per head (and a total per currency) */
  exp = computed(() => {
    const E = this.E(), B = E.balances(), rows: { a: string; c: string; v: number }[] = [], tots: { c: string; v: number }[] = [];
    E.curOrder(B).forEach(c => {
      const A = B[c] || {}, r = Object.keys(A).filter(a => E.accType(a) === 'expense' && Math.abs(A[a]) > 0.004).map(a => ({ a, c, v: A[a] }));
      if (!r.length) return;
      rows.push(...r.sort((x, y) => y.v - x.v)); tots.push({ c, v: r.reduce((s, x) => s + x.v, 0) });
    });
    return { rows, tots };
  });

  setRate(cur: string, v: string) {
    const vr = { ...(this.store.book()!.valRate || {}) }; if (num(v) > 0) vr[cur] = num(v); else delete vr[cur];
    this.store.save('put', '/settings', { valRate: vr }, '✓ Rate saved');
  }

  /* convert the base-currency net total into another currency */
  cvAmt: string | null = null;   // null = follow the net total shown above
  cvCur = '';
  cvRate: string | null = null;  // null = latest purchase rate
  base() { return this.E().S.base; }
  foreign() { return this.E().allCurs().filter(c => c !== this.base()); }
  baseNet() { return this.baseBlock()?.net || 0; }
  cvCurNow() { const f = this.foreign(); return f.includes(this.cvCur) ? this.cvCur : f.includes('USDT') ? 'USDT' : f[0]; }
  cvLast() { return this.E().lastPRate(this.cvCurNow()); }
  cvIn() { return this.cvAmt === null ? this.baseNet() : num(this.cvAmt); }
  cvR() { return this.cvRate === null ? this.cvLast() : num(this.cvRate); }

  /* CSV of the balance sheet as shown */
  csv() {
    const q = (v: unknown) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const n = (v: number) => String(Math.round(v * 100) / 100 || 0);
    const out: unknown[][] = [['As on', this.f.to || today()], [], ['Currency', 'Name', 'Type', 'Debit', 'Credit']];
    this.blocks().forEach(b => {
      b.rows.forEach(r => out.push([b.cur, r.a, this.TYPES[r.t], r.b > 0 ? n(r.b) : '', r.b < 0 ? n(-r.b) : '']));
      out.push([b.cur, 'TOTAL', '', n(b.dr), n(b.cr)]);
      ([['OUTSTANDING VALUE', b.os], ['CASH IN HAND VALUE (INCL. STOCK / WALLET)', b.cash], ['BANK VALUE', b.bank], ['TOTAL', b.total], ['CREDIT OUTSTANDING VALUE', b.cos],
        ['EXPENSES (ALREADY INCLUDED)', b.exp], ['NET TOTAL', b.net], ...(b.cap ? [['CAPITAL (YOUR MONEY)', b.cap]] : [])] as [string, number][])
        .forEach(([l, v]) => out.push([b.cur, l, '', n(v), '']));
      out.push([]);
    });
    return out.map(r => r.map(q).join(',')).join('\r\n');
  }
  downloadCsv() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + this.csv()], { type: 'text/csv;charset=utf-8' }));
    a.download = 'balance-sheet-' + (this.f.to || today()) + '.csv'; a.click();
  }
  async copyCsv() {
    const t = this.csv();
    try { await navigator.clipboard.writeText(t); }
    catch {   // plain-http sites have no clipboard API
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); if (!ok) { this.ui.toast('⚠️ Could not copy'); return; }
    }
    this.ui.toast('✓ Copied as CSV');
  }
}
