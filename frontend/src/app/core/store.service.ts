import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { Book } from './models';
import { Engine } from './engine';
import { UiService } from '../shared/ui.service';

/** Holds the whole book from the server; every page calculates from `engine()`. */
@Injectable({ providedIn: 'root' })
export class StoreService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private ui = inject(UiService);
  book = signal<Book | null>(null);
  engine = computed(() => { const b = this.book(); return b ? new Engine(b) : null; });
  busy = signal(false);

  async load() {
    try { this.book.set(await this.api.get<Book>('/book')); }
    catch (e: any) { if (e.status === 401) this.auth.logout(); this.ui.toast('⚠️ ' + e.message); }
  }
  /** POST/PUT that returns { book } – updates the screen with the fresh book */
  async save(method: 'post' | 'put', url: string, body: unknown, okMsg?: string): Promise<any> {
    this.busy.set(true);
    try {
      const r: any = method === 'post' ? await this.api.post(url, body) : await this.api.put(url, body);
      if (r && r.book) this.book.set(r.book);
      if (okMsg) this.ui.toast(okMsg);
      return r;
    } catch (e: any) { this.ui.toast('⚠️ ' + e.message); return null; }
    finally { this.busy.set(false); }
  }
  /** DELETE with the delete-password popup for Master / User */
  async remove(url: string, what: string, okMsg = 'Deleted'): Promise<boolean> {
    let pin: string | undefined;
    if (!this.auth.isSuper()) {
      if (!this.book()?.hasDelPin) { this.ui.toast('⚠️ Only Super admin can delete. Ask Super admin to set the delete password first.'); return false; }
      const p = await this.ui.askPin(what); if (p === null) return false; pin = p;
    } else if (!(await this.ui.confirm('Delete ' + what + '?', ['This can not be undone.'], '🗑 Delete', true))) return false;
    this.busy.set(true);
    try { const r: any = await this.api.del(url, pin); if (r && r.book) this.book.set(r.book); this.ui.toast(okMsg); return true; }
    catch (e: any) { this.ui.toast('⚠️ ' + e.message); return false; }
    finally { this.busy.set(false); }
  }
}
