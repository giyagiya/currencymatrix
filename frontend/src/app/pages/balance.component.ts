import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { TYPES } from '../core/models';
import { m, num, drcr } from '../core/fmt';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
  <div class="card">
    <h2 class="sech">⚖️ Balance sheet</h2>
    <div class="grid4">
      <div><label>As on date</label><input type="date" [(ngModel)]="f.to"></div>
      <div><label>Name</label><input [(ngModel)]="f.acct" list="dl-acc3" class="up" placeholder="All names"></div>
      <div><label>Type</label><select [(ngModel)]="f.typ"><option value="all">All</option><option value="party">Party</option><option value="dealer">Delivery dealer</option>
        <option value="stock">Stock / wallet</option><option value="cb">Cash &amp; Bank</option><option value="expense">Expense</option><option value="capital">Capital</option></select></div>
      <div><label>Currency</label><select [(ngModel)]="f.cur"><option value="all">All</option>@for (c of E().allCurs(); track c) { <option [value]="c">{{ c }}</option> }</select></div>
    </div>
  </div>

  @for (b of E().sheetData(f); track b.cur) {
    <div class="card pad0">
      <div class="gridwrap"><table class="s sheet">
        <tr class="cur"><td colspan="3">{{ b.cur }}</td></tr>
        <tr><th class="l">Dr = they owe us · Cr = we owe them</th><th>Debit</th><th>Credit</th></tr>
        @for (r of b.rows; track r.a) {
          <tr><td class="l"><b>{{ r.a }}</b> <span class="tag">{{ TYPES[r.t] }}</span></td><td class="n">{{ r.b > 0 ? m(r.b) : '' }}</td><td class="n">{{ r.b < 0 ? m(-r.b) : '' }}</td></tr>
        }
        <tr class="tot"><td class="l">Total</td><td class="n">{{ m(b.dr) }}</td><td class="n">{{ m(b.cr) }}</td></tr>
        <tr><td class="l">Outstanding (they owe us)</td><td class="n" colspan="2">{{ m(b.os) }}</td></tr>
        <tr><td class="l">Cash in hand</td><td class="n" colspan="2">{{ m(b.cash) }}</td></tr>
        <tr><td class="l">Bank</td><td class="n" colspan="2">{{ m(b.bank) }}</td></tr>
        <tr class="tot"><td class="l">Total</td><td class="n" colspan="2">{{ m(b.total) }}</td></tr>
        <tr><td class="l">Credit outstanding (we owe)</td><td class="n neg" colspan="2">{{ m(b.cos) }}</td></tr>
        @if (b.exp) { <tr><td class="l sub">Expenses (already included)</td><td class="n sub" colspan="2">{{ m(b.exp) }}</td></tr> }
        <tr class="net"><td class="l">NET TOTAL</td><td class="n" colspan="2">{{ m(b.net) }}</td></tr>
        @if (b.cap) { <tr><td class="l">Capital</td><td class="n" colspan="2">{{ m(b.cap) }}</td></tr> }
      </table></div>
    </div>
  } @empty { <div class="empty">Nothing to show.</div> }

  @if (tp(); as t) {
    <div class="card">
      <h2 class="sech">💰 Total profit <small>all currencies in {{ t.base }}</small></h2>
      <div class="gridwrap"><table class="s">
        <tr><th class="l">Currency</th><th>Net holding</th><th>Rate</th><th>Value ({{ t.base }})</th></tr>
        @for (p of t.parts; track p.cur) {
          <tr><td class="l">{{ p.cur }}</td><td class="n">{{ m(p.net) }}</td>
            <td class="n">@if (p.cur !== t.base && auth.isSuper()) { <input class="rate" [ngModel]="p.rate" (change)="setRate(p.cur, $any($event.target).value)" inputmode="decimal"> } @else { {{ p.cur === t.base ? '1' : (+p.rate.toFixed(4)) }} }</td>
            <td class="n">{{ m(p.inBase) }}</td></tr>
        }
        <tr><td class="l">Less: capital</td><td colspan="2"></td><td class="n">− {{ m(t.cap) }}</td></tr>
        <tr class="net"><td class="l">{{ t.total >= 0 ? 'TOTAL PROFIT' : 'TOTAL LOSS' }}</td><td colspan="2"></td><td class="n" [class.neg]="t.total < 0">{{ m(t.total) }}</td></tr>
      </table></div>
      <div class="hint">Foreign money is valued at the average purchase rate{{ auth.isSuper() ? ' (you can type another rate)' : '' }}. Capital is not profit.</div>
    </div>
  }
  @if (expHeads().length) {
    <div class="card"><h2 class="sech">🧾 Expenses by head</h2>
      <div class="list">@for (e of expHeads(); track e.a) { <div class="it"><span>{{ e.a }} <span class="sub">{{ e.c }}</span></span><b>{{ m(e.v) }}</b></div> }</div></div>
  }
  <datalist id="dl-acc3">@for (a of E().allAccounts(); track a) { <option [value]="a"></option> }</datalist>
  `,
})
export class BalanceComponent {
  store = inject(StoreService); auth = inject(AuthService);
  m = m; drcr = drcr; TYPES = TYPES as Record<string, string>;
  E = computed(() => this.store.engine()!);
  f = { to: '', acct: '', typ: 'all', cur: 'all' };
  tp = computed(() => this.E().totalProfit());
  expHeads = computed(() => {
    const B = this.E().balances(), out: { a: string; c: string; v: number }[] = [];
    Object.keys(B).forEach(c => Object.keys(B[c]).forEach(a => { if (this.E().accType(a) === 'expense' && Math.abs(B[c][a]) > 0.004) out.push({ a, c, v: B[c][a] }); }));
    return out.sort((x, y) => y.v - x.v);
  });
  setRate(cur: string, v: string) {
    const vr = { ...(this.store.book()!.valRate || {}) }; if (num(v) > 0) vr[cur] = num(v); else delete vr[cur];
    this.store.save('put', '/settings', { valRate: vr }, '✓ Rate saved');
  }
}
