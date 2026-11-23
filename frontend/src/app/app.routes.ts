import { Routes, CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './core/auth.service';
import { LoginComponent } from './pages/login.component';
import { ShellComponent } from './shell.component';
import { BillComponent } from './pages/bill.component';
import { CashBankComponent } from './pages/cash-bank.component';
import { BalanceComponent } from './pages/balance.component';
import { DailyComponent } from './pages/daily.component';
import { LedgerComponent } from './pages/ledger.component';
import { SetupComponent } from './pages/setup.component';

const loggedIn: CanActivateFn = () => inject(AuthService).user() ? true : inject(Router).parseUrl('/login');
const tab = (t: string): CanActivateFn => () => {
  const a = inject(AuthService);
  if (a.canTab(t)) return true;
  const first = ['bill', 'jv', 'sheet', 'daily', 'ledger', 'setup'].find(x => a.canTab(x));
  return inject(Router).parseUrl(first ? '/' + first : '/noaccess');
};

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '', component: ShellComponent, canActivate: [loggedIn], children: [
      { path: 'bill', component: BillComponent, canActivate: [tab('bill')] },
      { path: 'jv', component: CashBankComponent, canActivate: [tab('jv')] },
      { path: 'sheet', component: BalanceComponent, canActivate: [tab('sheet')] },
      { path: 'daily', component: DailyComponent, canActivate: [tab('daily')] },
      { path: 'ledger', component: LedgerComponent, canActivate: [tab('ledger')] },
      { path: 'setup', component: SetupComponent, canActivate: [tab('setup')] },
      { path: 'noaccess', loadComponent: () => import('./pages/noaccess.component').then(m => m.NoAccessComponent) },
      { path: '', pathMatch: 'full', redirectTo: 'bill' },
    ],
  },
  { path: '**', redirectTo: '' },
];
