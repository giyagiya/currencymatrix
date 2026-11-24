import { Component, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../core/store.service';
import { AuthService } from '../core/auth.service';
import { ApiService } from '../core/api.service';
import { UiService } from '../shared/ui.service';
import { TYPES, PAGES, Page, UserRow } from '../core/models';
import { U, num } from '../core/fmt';

@Component({
  standalone: true,
  imports: [FormsModule],
  templateUrl: './setup.component.html',
})
export class SetupComponent {
  store = inject(StoreService); auth = inject(AuthService); api = inject(ApiService); ui = inject(UiService);
  E = computed(() => this.store.engine()!);
  S = computed(() => this.store.book()!);
  TYPES = TYPES as Record<string, string>; typeKeys = Object.keys(TYPES); PAGES = PAGES;
  roleName: Record<string, string> = { super: 'Super admin', master: 'Master', user: 'User' };
  newCur = ''; newAcc = ''; newAccType = 'party';
  ren: string | null = null; renVal = '';
  nb = { name: '', acno: '', ifsc: '', comm: '' }; nd = { name: '', comm: '' };
  uf = { name: '', role: 'user', pin: '', pages: ['bill', 'pay', 'jv'] as Page[] };
  upin: Record<number, string> = {};
  dpin = '';

  /* currencies */
  setBase(v: string) { this.store.save('put', '/settings', { base: v }, '✓ Base currency ' + v); }
  addCur() { const c = U(this.newCur); if (!c) return; if (this.S().currencies.includes(c)) { this.ui.toast(c + ' already added'); return; }
    this.store.save('put', '/settings', { currencies: [...this.S().currencies, c] }, '✓ ' + c + ' added').then(r => { if (r) this.newCur = ''; }); }
  usedCur(c: string) { return this.S().bills.some(b => b.rows.some(r => r.cur === c || r.base === c)) || this.S().jv.some(j => j.cur === c); }
  delCur(c: string) { this.store.save('put', '/settings', { currencies: this.S().currencies.filter(x => x !== c) }, c + ' removed'); }
  /** Enter in a list of boxes: go to the next box in the same card (leaving a box saves it); on the last box it just saves. */
  nextIn(e: Event) {
    const el = e.target as HTMLInputElement;
    if (el.tagName !== 'INPUT') return;
    e.preventDefault();
    const boxes = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLInputElement>('input:not([disabled])'));
    const nx = boxes[boxes.indexOf(el) + 1];
    if (nx) { nx.focus(); nx.select(); } else el.blur();
  }
  setStock(cur: string, v: string) { const so = { ...this.S().stockOf }; if (U(v)) so[cur] = U(v); else delete so[cur]; this.store.save('put', '/settings', { stockOf: so }, '✓ Saved'); }

  /* accounts */
  accounts() { return this.E().allAccounts(); }
  count(a: string) { return this.E().postings().filter(p => p.acct === a).length; }
  setType(a: string, t: string) { this.store.save('put', '/accounts/' + encodeURIComponent(a), { type: t }, '✓ ' + a + ' is now ' + this.TYPES[t]); }
  addAcc() { const n = U(this.newAcc); if (!n) return; this.store.save('post', '/accounts', { name: n, type: this.newAccType }, '✓ Added').then(r => { if (r) this.newAcc = ''; }); }
  async rename() { const to = U(this.renVal); if (!to || !this.ren) return; const r = await this.store.save('post', '/accounts/rename', { from: this.ren, to }, '✓ Renamed'); if (r) this.ren = null; }
  delAcc(a: string) { this.store.remove('/accounts/' + encodeURIComponent(a), a); }

  /* banks & dealers */
  saveBank(b?: any) { const x = b || this.nb; if (!U(x.name)) { this.ui.toast('Enter bank name'); return; }
    this.store.save('post', '/banks', { ...x, comm: num(x.comm) }, '✓ Bank saved').then(r => { if (r && !b) this.nb = { name: '', acno: '', ifsc: '', comm: '' }; }); }
  delBank(n: string) { this.store.remove('/banks/' + encodeURIComponent(n), 'bank ' + n); }
  saveDealer(d?: any) { const x = d || this.nd; if (!U(x.name)) { this.ui.toast('Enter dealer name'); return; }
    this.store.save('post', '/dealers', { ...x, comm: num(x.comm) }, '✓ Dealer saved').then(r => { if (r && !d) this.nd = { name: '', comm: '' }; }); }
  delDealer(n: string) { this.store.remove('/dealers/' + encodeURIComponent(n), 'dealer ' + n); }

  /* users */
  togglePage(list: Page[], p: Page) { const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); else list.push(p); }
  ufRole() { this.uf.pages = this.uf.role === 'master' ? ['bill', 'pay', 'jv', 'sheet', 'daily', 'ledger'] : ['bill', 'pay', 'jv']; }
  async addUser() {
    if (!U(this.uf.name)) { this.ui.toast('Enter name'); return; }
    if (!/^\d{4,6}$/.test(this.uf.pin)) { this.ui.toast('PIN must be 4 to 6 numbers'); return; }
    const r = await this.store.save('post', '/users', this.uf, '✓ Login saved for ' + U(this.uf.name));
    if (r) this.uf = { name: '', role: 'user', pin: '', pages: ['bill', 'pay', 'jv'] };
  }
  userPage(u: UserRow, p: Page, on: boolean) { const pages = u.pages.filter(x => x !== p); if (on) pages.push(p); this.store.save('put', '/users/' + u.id, { pages }, '✓ ' + u.name + ' pages updated'); }
  userRole(u: UserRow, role: string) { this.store.save('put', '/users/' + u.id, { role }, '✓ ' + u.name + ' is now ' + this.roleName[role]); }
  userPin(u: UserRow) { const p = this.upin[u.id] || ''; if (!/^\d{4,6}$/.test(p)) { this.ui.toast('PIN must be 4 to 6 numbers'); return; }
    this.store.save('put', '/users/' + u.id, { pin: p }, '✓ PIN changed for ' + u.name).then(r => { if (r) this.upin[u.id] = ''; }); }
  delUser(u: UserRow) { this.store.remove('/users/' + u.id, 'login ' + u.name, 'Removed ' + u.name); }
  saveDelPin() { if (!/^\d{4}$/.test(this.dpin)) { this.ui.toast('Delete password must be exactly 4 numbers'); return; }
    this.store.save('put', '/delete-pin', { pin: this.dpin }, '✓ Delete password saved').then(r => { if (r) this.dpin = ''; }); }

  /* reset */
  async reset(what: 'entries' | 'all') {
    const S = this.S(), n = '<b>' + S.bills.length + ' bills</b> and <b>' + S.jv.length + ' entries</b>';
    const lines = what === 'entries'
      ? ['This deletes all ' + n + ' (vouchers, payments, capital) and the saved WhatsApp numbers.', 'Kept: names (accounts), banks, dealers, currencies, logins and the delete password.']
      : ['This deletes all ' + n + ', and also all accounts, banks, dealers, currencies and settings.', 'Kept: logins and the delete password.'];
    if (!(await this.ui.confirm(what === 'entries' ? '🧹 Clear all entries?' : '🗑 Reset all?', [...lines, 'Download a backup first if you may need the old data.'], '🗑 Yes, delete', true))) return;
    if (!(await this.ui.confirm('⚠️ Last check', ['This can not be undone. Delete now?'], '🗑 Delete now', true))) return;
    await this.store.save('post', '/reset', { what }, what === 'entries' ? '✓ All entries cleared' : '✓ Reset done – back to a new start');
  }

  /* backup */
  async exportBook() {
    try {
      const data = await this.api.get('/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      a.download = 'remit-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    } catch (e: any) { this.ui.toast('⚠️ ' + e.message); }
  }
  async importBook(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    let data: any; try { data = JSON.parse(await f.text()); } catch { this.ui.toast('⚠️ Not a backup file'); return; }
    if (data && data.v === 2 && data.fx) data = data.fx; // very old format
    if (!data || !Array.isArray(data.bills) || !Array.isArray(data.jv)) { this.ui.toast('⚠️ Not a Remit backup file'); return; }
    if (!(await this.ui.confirm('Import backup?', ['This REPLACES all bills and vouchers with <b>' + data.bills.length + ' bills</b> and <b>' + data.jv.length + ' entries</b> from the file.', 'Logins and the delete password are kept.'], '⬆️ Yes, import', true))) return;
    const r = await this.store.save('post', '/import', data);
    if (r) this.ui.toast('✓ Backup imported' + (r.skipped ? ' – ' + r.skipped + ' broken entries skipped' : ''));
    (ev.target as HTMLInputElement).value = '';
  }
}
