import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { StoreService } from '../core/store.service';
import { TYPES } from '../core/models';
import { m, dmy, drcr, U } from '../core/fmt';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
  <div class="card">
    <h2 class="sech">📒 Ledger</h2>
    <div class="grid3">
      <div><label>Account</label><input [(ngModel)]="acct" list="dl-acc5" class="up" placeholder="Type or pick a name"></div>
      <div><label>From</label><input type="date" [(ngModel)]="from"></div>
      <div><label>To</label><input type="date" [(ngModel)]="to"></div>
    </div>
  </div>
  @if (!U(acct) || !E().S.accounts[U(acct)]) {
    <div class="card"><h2 class="sech">All accounts</h2>
      <div class="list">@for (a of E().allAccounts(); track a) {
        <div class="it link" (click)="acct = a"><b>{{ a }}</b><span class="tag">{{ TYPES[E().accType(a)] }}</span></div>
      }</div></div>
  } @else {
    @for (b of E().ledger(acct, from, to); track b.cur) {
      <div class="card pad0"><div class="gridwrap"><table class="s">
        <tr class="cur"><td colspan="6">{{ U(acct) }} – {{ b.cur }}</td></tr>
        <tr><th class="l">Date</th><th class="l">Ref</th><th class="l">Particulars</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>
        @if (from) { <tr><td class="l">{{ dmy(from) }}</td><td></td><td class="l"><i>Opening balance</i></td><td></td><td></td><td class="n">{{ drcr(b.open) }}</td></tr> }
        @for (l of b.lines; track $index) {
          <tr><td class="l nowrap">{{ dmy(l.date) }}</td><td class="l">{{ l.ref }}</td><td class="l">{{ l.txt }}</td>
            <td class="n">{{ l.dr ? m(l.dr) : '' }}</td><td class="n">{{ l.cr ? m(l.cr) : '' }}</td><td class="n">{{ drcr(l.run) }}</td></tr>
        }
        <tr class="tot"><td></td><td></td><td class="l">Total</td><td class="n">{{ m(b.td) }}</td><td class="n">{{ m(b.tc) }}</td><td class="n">{{ drcr(b.close) }}</td></tr>
      </table></div></div>
    } @empty { <div class="empty">No transactions for {{ U(acct) }}.</div> }
    <button (click)="acct = ''">◀ All accounts</button>
  }
  <datalist id="dl-acc5">@for (a of E().allAccounts(); track a) { <option [value]="a"></option> }</datalist>
  `,
})
export class LedgerComponent {
  store = inject(StoreService);
  m = m; dmy = dmy; drcr = drcr; U = U; TYPES = TYPES as Record<string, string>;
  E = computed(() => this.store.engine()!);
  acct = ''; from = ''; to = '';
  constructor() {   // opened from the Balance sheet: /ledger?acct=NAME&to=DATE
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    this.acct = q.get('acct') || ''; this.to = q.get('to') || '';
  }
}
