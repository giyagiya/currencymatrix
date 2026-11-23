import { Component, inject, OnInit, HostListener } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { StoreService } from './core/store.service';
import { UiService } from './shared/ui.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <header>
    <h1><span class="logo">₹</span>Remit</h1>
    @if (auth.user(); as u) {
      <span class="uchip">👤 {{ u.name }} <small>{{ roleName[u.role] }}</small><button (click)="logout()">Logout</button></span>
    }
    <span class="pill">{{ store.busy() ? 'Saving…' : 'Saved' }}</span>
  </header>
  <main>
    @if (store.book()) { <router-outlet /> } @else { <div class="empty">Loading…</div> }
  </main>
  <nav>
    @for (n of nav; track n[0]) {
      @if (auth.canTab(n[0])) {
        <a [routerLink]="'/' + n[0]" routerLinkActive="on"><span class="ic">{{ n[1] }}</span>{{ n[2] }}</a>
      }
    }
  </nav>
  `,
})
export class ShellComponent implements OnInit {
  auth = inject(AuthService);
  store = inject(StoreService);
  ui = inject(UiService);
  router = inject(Router);
  roleName: Record<string, string> = { super: 'Super admin', master: 'Master', user: 'User' };
  nav: [string, string, string][] = [
    ['bill', '🧾', 'Bill'], ['jv', '💵', 'Cash & Bank'], ['sheet', '⚖️', 'Balance'],
    ['daily', '📅', 'Daily'], ['ledger', '📒', 'Ledger'], ['setup', '⚙', 'Setup'],
  ];
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
