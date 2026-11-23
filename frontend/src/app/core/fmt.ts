/** Small helpers shared by the whole app (same rules as the original Remit app). */
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const num = (v: unknown): number => {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
};
export const U = (s: unknown) => String(s || '').trim().toUpperCase();
/** Indian number format: 1,00,000.00  (|| 0 so a rounded -0 shows as 0.00, not -0.00) */
export const m = (n: number) => (r2(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const p2 = (n: number) => (n < 10 ? '0' : '') + n;
export const dmy = (s: string) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '');
export const today = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
export const drcr = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : m(Math.abs(v)) + (v > 0 ? ' Dr' : ' Cr'));
export const last4 = (a: string) => { a = String(a || '').replace(/\s/g, ''); return a ? '••' + a.slice(-4) : ''; };
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
