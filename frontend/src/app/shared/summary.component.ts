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
      <div><span>Capital</span><b>{{ m(x.cap) }}</b></div>
      <div><span>Cash in hand</span><b [class.neg]="x.cash < 0">{{ m(x.cash) }}</b></div>
      <div><span>Bank</span><b [class.neg]="x.bank < 0">{{ m(x.bank) }}</b></div>
      <div class="hl"><span>Total profit</span><b [class.neg]="x.tp < 0">{{ m(x.tp) }}</b></div>
    </div>
  }`,
})
export class SummaryComponent {
  store = inject(StoreService); auth = inject(AuthService); m = m;
  v = computed(() => {
    const E = this.store.engine(); if (!E) return null;
    const A = E.balances()[E.S.base] || {}; let cap = 0, cash = 0, bank = 0;
    Object.keys(A).forEach(a => { const t = E.accType(a); if (t === 'capital') cap -= A[a]; else if (t === 'cash' || t === 'stock') cash += A[a]; else if (t === 'bank') bank += A[a]; });
    return { cap, cash, bank, tp: E.totalProfit().total };
  });
}
