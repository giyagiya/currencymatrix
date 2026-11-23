const U = s => String(s || '').trim().toUpperCase();
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(n * 100) / 100;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);
module.exports = { U, num, r2, newId, isDate, HttpError, bad };
