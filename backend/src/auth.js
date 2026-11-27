const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { HttpError } = require('./util');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PAGES = ['bill', 'pay', 'jv', 'sheet', 'daily', 'ledger'];

function sign(user) {
  return jwt.sign({ id: user.id, name: user.name }, SECRET, { expiresIn: '12h' });
}

// Loads the user fresh from the DB on every request, so role/page changes apply at once.
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) throw new HttpError(401, 'Please login');
    let p;
    try { p = jwt.verify(tok, SECRET); } catch { throw new HttpError(401, 'Login expired – please login again'); }
    const { rows } = await pool.query('SELECT id,name,role,pages FROM users WHERE id=$1', [p.id]);
    if (!rows[0]) throw new HttpError(401, 'User removed – please login again');
    req.user = rows[0];
    next();
  } catch (e) { next(e); }
}

function canPage(user, page) {
  if (!user) return false;
  if (user.role === 'super') return true;
  if (page === 'setup') return false;
  return (user.pages || []).includes(page);
}

// needPage('bill') or needPage(['bill','pay']) → any of them
const needPage = pages => (req, res, next) => {
  const list = Array.isArray(pages) ? pages : [pages];
  if (list.some(p => canPage(req.user, p))) return next();
  next(new HttpError(403, 'No access to this page'));
};

const needSuper = (req, res, next) =>
  req.user && req.user.role === 'super' ? next() : next(new HttpError(403, 'Only Super admin can do this'));

/* Wrong-PIN limit: after 5 wrong PINs for one login name (or 5 wrong delete passwords by one user) the next try must wait
   5 minutes. Kept in memory – a server restart clears it. A right PIN clears the count. */
const PIN_TRIES = 5, PIN_LOCK_MS = 5 * 60 * 1000, tries = new Map();
function pinWait(key) {   // minutes still locked (0 = free)
  const t = tries.get(key);
  return t && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 60000) : 0;
}
function pinCheck(key) {
  const w = pinWait(key);
  if (w) throw new HttpError(429, 'Too many wrong PINs – try again in ' + w + ' minute' + (w > 1 ? 's' : ''));
}
function pinFailed(key, msg) {
  let t = tries.get(key);
  if (!t || (t.until && t.until <= Date.now())) t = { n: 0, until: 0 };   // first miss, or an old lock that has run out
  t.n++;
  if (t.n >= PIN_TRIES) { t.n = 0; t.until = Date.now() + PIN_LOCK_MS; tries.set(key, t); return new HttpError(429, msg + ' – ' + PIN_TRIES + ' wrong tries, locked for 5 minutes'); }
  tries.set(key, t);
  return new HttpError(key.startsWith('del:') ? 403 : 401, msg + ' (' + (PIN_TRIES - t.n) + ' tr' + (PIN_TRIES - t.n > 1 ? 'ies' : 'y') + ' left)');
}
function pinOk(key) { tries.delete(key); }

// Master / User must send the 4-digit delete password in header "x-delete-pin"
async function checkDeletePin(req) {
  if (req.user.role === 'super') return;
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='delPinHash'");
  const hash = rows[0] && rows[0].value;
  if (!hash) throw new HttpError(403, 'Only Super admin can delete. Ask Super admin to set the delete password first.');
  const key = 'del:' + req.user.id;
  pinCheck(key);
  const pin = String(req.headers['x-delete-pin'] || '');
  if (!/^\d{4}$/.test(pin) || !(await bcrypt.compare(pin, hash))) throw pinFailed(key, 'Wrong password – not deleted');
  pinOk(key);
}

module.exports = { sign, requireAuth, needPage, needSuper, canPage, checkDeletePin, pinCheck, pinFailed, pinOk, PAGES, bcrypt };
