import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { UiService } from '../shared/ui.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
  <header><h1><span class="logo">₹</span>Remit</h1></header>
  <main>
    <div class="card login">
      @if (setupNeeded()) {
        <h2>👋 Welcome – create the Super admin</h2>
        <p class="hint">This login can do everything and adds the other logins.</p>
        <label>Name</label><input [(ngModel)]="name" class="up" placeholder="Your name">
        <label>PIN (4–6 numbers)</label><input [(ngModel)]="pin" type="password" inputmode="numeric" class="pinbox" (keydown.enter)="setup()">
        <div class="acts"><button class="pr" (click)="setup()">Create & login</button></div>
      } @else {
        <h2>🔒 Login</h2>
        <label>Who are you?</label>
        <div class="lgnames">
          @for (u of users(); track u.name) {
            <button [class.on]="name === u.name" (click)="pick(u.name)">{{ u.name }}<small>{{ roleName[u.role] }}</small></button>
          }
        </div>
        @if (name) {
          <label>PIN for {{ name }}</label>
          <input id="lg-pin" [(ngModel)]="pin" type="password" inputmode="numeric" class="pinbox" placeholder="••••" (keydown.enter)="login()">
          <div class="acts"><button class="pr" (click)="login()">Login</button></div>
        } @else { <div class="hint">Tap your name.</div> }
      }
    </div>
  </main>`,
})
export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private ui = inject(UiService);
  private router = inject(Router);
  roleName: Record<string, string> = { super: 'Super admin', master: 'Master', user: 'User' };
  users = signal<{ name: string; role: string }[]>([]);
  setupNeeded = signal(false);
  name = ''; pin = '';

  async ngOnInit() {
    if (this.auth.user()) { this.router.navigateByUrl('/'); return; }
    try { const r = await this.auth.publicUsers(); this.users.set(r.users); this.setupNeeded.set(r.setupNeeded); }
    catch (e: any) { this.ui.toast('⚠️ ' + e.message); }
  }
  pick(n: string) { this.name = n; this.pin = ''; setTimeout(() => document.getElementById('lg-pin')?.focus(), 30); }
  async login() {
    try { await this.auth.login(this.name, this.pin); this.router.navigateByUrl('/'); this.ui.toast('Welcome ' + this.name); }
    catch (e: any) { this.pin = ''; this.ui.toast('⚠️ ' + e.message); }
  }
  async setup() {
    if (!/^\d{4,6}$/.test(this.pin)) { this.ui.toast('PIN must be 4 to 6 numbers'); return; }
    try { await this.auth.setup(this.name, this.pin); this.router.navigateByUrl('/setup'); this.ui.toast('✓ Super admin created'); }
    catch (e: any) { this.ui.toast('⚠️ ' + e.message); }
  }
}
