import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { Page, Role } from './models';

export interface Me { id: number; name: string; role: Role; pages: Page[]; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  user = signal<Me | null>(null);
  isSuper = computed(() => this.user()?.role === 'super');

  constructor() {
    try {
      const t = sessionStorage.getItem('remitToken'), u = sessionStorage.getItem('remitUser');
      if (t && u) { this.api.token = t; this.user.set(JSON.parse(u)); }
    } catch { /* private mode */ }
  }
  private keep(token: string, user: Me) {
    this.api.token = token; this.user.set(user);
    try { sessionStorage.setItem('remitToken', token); sessionStorage.setItem('remitUser', JSON.stringify(user)); } catch { /* ignore */ }
  }
  publicUsers() { return this.api.get<{ setupNeeded: boolean; users: { name: string; role: Role }[] }>('/public/users'); }
  async login(name: string, pin: string) { const r = await this.api.post<{ token: string; user: Me }>('/auth/login', { name, pin }); this.keep(r.token, r.user); }
  async setup(name: string, pin: string) { const r = await this.api.post<{ token: string; user: Me }>('/auth/setup', { name, pin }); this.keep(r.token, r.user); }
  /** refresh my role/pages from the server */
  async refreshMe() { const u = await this.api.get<Me>('/me'); this.user.set(u); try { sessionStorage.setItem('remitUser', JSON.stringify(u)); } catch { /* */ } }
  logout() { this.api.token = ''; this.user.set(null); try { sessionStorage.removeItem('remitToken'); sessionStorage.removeItem('remitUser'); } catch { /* */ } }

  canPage(p: Page | 'setup') {
    const u = this.user(); if (!u) return false;
    if (u.role === 'super') return true; if (p === 'setup') return false;
    return u.pages.includes(p);
  }
  canTab(t: string) { return t === 'bill' ? this.canPage('bill') || this.canPage('pay') : this.canPage(t as Page); }
  seeMoney() { return this.canPage('sheet'); }
}
