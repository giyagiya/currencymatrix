import { Component, inject, OnInit, HostListener, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { StoreService } from './core/store.service';
import { UiService } from './shared/ui.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  @if (!open()) {
    <!-- after login / reload: a blank screen with one small icon in the top-right corner; click it to open the app -->
    <div class="blank">
      <button class="peek" (click)="show()" title="Open" aria-label="Open"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    </div>
  } @else {
  <header class="topbar">
    <div class="tb-in">
      <h1 class="brand"><span class="logo">₹</span>Remit</h1>
      <nav aria-label="Main">
        @for (n of nav; track n[0]) {
          @if (auth.canTab(n[0])) {
            <a [routerLink]="'/' + n[0]" routerLinkActive="on" [title]="n[2]"><span class="ic">{{ n[1] }}</span><span class="lb">{{ n[2] }}</span></a>
          }
        }
      </nav>
      <div class="tb-r">
        <span class="pill" [class.busy]="store.busy()"><i></i>{{ store.busy() ? 'Saving…' : 'Saved' }}</span>
        <button class="hidebtn" (click)="hide()" title="Hide screen" aria-label="Hide screen"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg></button>
        @if (auth.user(); as u) {
          <span class="uchip">
            <span class="av">{{ (u.name || '?').charAt(0).toUpperCase() }}</span>
            <span class="un">{{ u.name }}<small>{{ roleName[u.role] }}</small></span>
            <button class="out" (click)="logout()" title="Logout" aria-label="Logout"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span class="lb">Logout</span></button>
          </span>
        }
      </div>
    </div>
  </header>
  <main>
    @if (store.book()) { <router-outlet /> } @else { <div class="empty">Loading…</div> }
  </main>
  }
  `,
})
export class ShellComponent implements OnInit {
  auth = inject(AuthService);
  store = inject(StoreService);
  ui = inject(UiService);
  router = inject(Router);
  roleName: Record<string, string> = { super: 'Super admin', master: 'Master', user: 'User' };
  nav: [string, string, string][] = [
    ['bill', '🧾', 'Bill'], ['jv', '💵', 'Cash Book'], ['sheet', '⚖️', 'Balance'],
    ['daily', '📅', 'Daily'], ['ledger', '📒', 'Ledger'], ['setup', '⚙', 'Setup'],
  ];
  /** The app starts hidden after every login / reload (blank screen + one small icon); data still loads meanwhile. */
  open = signal(false);
  show() { this.open.set(true); }
  hide() { this.open.set(false); }
  ngOnInit() { this.auth.refreshMe().catch(() => {}); this.store.load(); }
  logout() { this.auth.logout(); this.store.book.set(null); this.router.navigateByUrl('/login'); }

  /** Esc = go back to the previous box (keeps what you typed) */
  @HostListener('document:keydown.escape', ['$event'])
  esc(ev: Event) {
    if (this.ui.dialog()) return;
    const el = document.activeElement as HTMLElement | null;
    if (!el || !/INPUT|SELECT|TEXTAREA/.test(el.tagName)) return;
    const scope = el.closest('.modal,.entry,.gridwrap,.card') || document.body;
    const all = Array.from(scope.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([disabled]),select:not([disabled]),textarea:not([disabled])'))
      .filter(x => x.offsetParent !== null);
    const i = all.indexOf(el);
    if (i > 0) { ev.preventDefault(); all[i - 1].focus(); (all[i - 1] as HTMLInputElement).select?.(); }
  }
}
