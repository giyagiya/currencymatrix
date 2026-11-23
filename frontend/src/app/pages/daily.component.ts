import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { m, dmy, drcr } from '../core/fmt';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
  <div class="card">
    <h2 class="sech">📅 Daily summary <small>{{ E().S.base }}</small></h2>
    <div class="grid3">
      <div><label>From</label><input type="date" [(ngModel)]="f.from"></div>
      <div><label>To</label><input type="date" [(ngModel)]="f.to"></div>
      <div><label>Name</label><input [(ngModel)]="f.party" list="dl-acc4" class="up" placeholder="All names"></div>
    </div>
  </div>
  <div class="card pad0"><div class="gridwrap"><table class="s">
    <tr><th class="l">Date</th><th class="l">Bills</th><th>Purchase</th><th>Sale</th><th>Paid</th><th>Received</th><th>Commission</th><th>Expenses</th>@if (auth.seeMoney() && !f.party) { <th>Profit</th> }<th></th></tr>
    @for (x of rows(); track x.d) {
      <tr>
        <td class="l"><b>{{ dmy(x.d) }}</b></td><td class="l">{{ billNos(x) }}</td>
        <td class="n neg">{{ m(x.pur) }}</td><td class="n pos">{{ m(x.sale) }}</td><td class="n">{{ m(x.paid) }}</td><td class="n">{{ m(x.recv) }}</td>
        <td class="n">{{ m(x.comm) }}</td><td class="n">{{ m(x.exp) }}</td>
        @if (auth.seeMoney() && !f.party) { <td class="n" [class.neg]="(x.profit || 0) < 0"><b>{{ m(x.profit || 0) }}</b></td> }
        <td><button class="sm" (click)="open = open === x.d ? '' : x.d">{{ open === x.d ? '▲' : '👥' }}</button></td>
      </tr>
      @if (open === x.d) {
        <tr><td colspan="10" class="inner"><table class="s">
          <tr><th class="l">Name</th><th class="l">Bought from them</th><th class="l">Sold to them</th><th>Purchase</th><th>Sale</th><th>Paid</th><th>Received</th><th>Balance</th></tr>
          @for (p of E().dayPeople(x.d, f.party); track p.n) {
            <tr><td class="l"><b>{{ p.n }}</b></td><td class="l sub">{{ p.pq.join(', ') }}</td><td class="l sub">{{ p.sq.join(', ') }}</td>
              <td class="n">{{ m(p.pur) }}</td><td class="n">{{ m(p.sale) }}</td><td class="n">{{ m(p.paid) }}</td><td class="n">{{ m(p.recv) }}</td><td class="n">{{ drcr(p.bal) }}</td></tr>
          }
        </table></td></tr>
      }
    } @empty { <tr><td colspan="10" class="empty">No entries.</td></tr> }
  </table></div></div>
  <datalist id="dl-acc4">@for (a of E().allAccounts(); track a) { <option [value]="a"></option> }</datalist>
  `,
})
export class DailyComponent {
  store = inject(StoreService); auth = inject(AuthService);
  m = m; dmy = dmy; drcr = drcr;
  E = computed(() => this.store.engine()!);
  f = { from: '', to: '', party: '' };
  open = '';
  rows() { return this.E().dailyRows(this.f).slice().reverse(); }
  billNos(x: { bills: Record<string, 1> }) { const k = Object.keys(x.bills); return k.length ? 'Bill ' + k.join(', ') : 'Cash & Bank only'; }
}
