import { Injectable, signal } from '@angular/core';

export interface Choice { k: string; label: string; cls?: string; }
export interface Dialog { kind: 'confirm' | 'pin' | 'choice'; title: string; lines: string[]; ok: string; danger?: boolean; choices?: Choice[]; note?: string; resolve: (v: any) => void; }

/** Toast messages + popups (confirm / delete password) */
@Injectable({ providedIn: 'root' })
export class UiService {
  toastMsg = signal('');
  dialog = signal<Dialog | null>(null);
  private t: any;

  toast(msg: string) { this.toastMsg.set(msg); clearTimeout(this.t); this.t = setTimeout(() => this.toastMsg.set(''), 3200); }
  confirm(title: string, lines: string[], ok = '✅ Yes, save', danger = false): Promise<boolean> {
    return new Promise(resolve => this.dialog.set({ kind: 'confirm', title, lines, ok, danger, resolve }));
  }
  askPin(what: string): Promise<string | null> {
    return new Promise(resolve => this.dialog.set({ kind: 'pin', title: '🔒 Password needed to delete', lines: ['Delete ' + what + '?'], ok: '🗑 Delete', danger: true, resolve }));
  }
  /** Popup with several buttons; resolves to the chosen button's key, or null for Esc / click outside. */
  choose(title: string, text: string, choices: Choice[], note = ''): Promise<string | null> {
    return new Promise(resolve => this.dialog.set({ kind: 'choice', title, lines: [text], ok: '', choices, note, resolve }));
  }
  close(v: any) { const d = this.dialog(); this.dialog.set(null); if (d) d.resolve(v); }
}
