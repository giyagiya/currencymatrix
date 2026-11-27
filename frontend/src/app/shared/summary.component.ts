import { Component, inject, computed } from '@angular/core';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { m } from '../core/fmt';

/** Capital · Cash in hand · Bank · Total profit (only for logins with the Balance page) */
@Component({
  selector: 'app-summary',
  standalone: true,
  template: `
  @if (auth.seeMoney() && v(); as x) {
    <div class="sumstrip">
      <div title="All capital in rupees – opening stock in another currency counts at its cost rate (same as Total profit → Less capital)"><span>Capital</span><b [class.neg]="x.cap < 0">{{ m(x.cap) }}</b></div>
      <div [title]="x.cash < 0 ? 'Minus = more rupees paid out than came in. Enter your starting money: Cash Book → Add capital.' : ''"><span>Cash in hand</span><b [class.neg]="x.cash < 0">{{ m(x.cash) }}</b></div>
      <div><span>Bank</span><b [class.neg]="x.bank < 0">{{ m(x.bank) }}</b></div>
      <div class="hl"><span>Total profit</span><b [class.neg]="x.tp < 0">{{ m(x.tp) }}</b></div>
    </div>
  }`,
})
export class SummaryComponent {
  store = inject(StoreService); auth = inject(AuthService); m = m;
  v = computed(() => {
    const E = this.store.engine(); if (!E) return null;
    // Cash in hand and Bank are rupees; Capital is all capital valued in rupees (SGD opening stock @ 80 counts too),
    // the same figure Total profit takes off – so Total profit = what you hold − this Capital
    const A = E.balances()[E.S.base] || {}, tp = E.totalProfit(); let cash = 0, bank = 0;
    Object.keys(A).forEach(a => { const t = E.accType(a); if (t === 'cash' || t === 'stock') cash += A[a]; else if (t === 'bank') bank += A[a]; });
    return { cap: tp.cap, cash, bank, tp: tp.total };
  });
}
