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

// Master / User must send the 4-digit delete password in header "x-delete-pin"
async function checkDeletePin(req) {
  if (req.user.role === 'super') return;
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='delPinHash'");
  const hash = rows[0] && rows[0].value;
  if (!hash) throw new HttpError(403, 'Only Super admin can delete. Ask Super admin to set the delete password first.');
  const pin = String(req.headers['x-delete-pin'] || '');
  if (!/^\d{4}$/.test(pin) || !(await bcrypt.compare(pin, hash))) throw new HttpError(403, 'Wrong password – not deleted');
}

module.exports = { sign, requireAuth, needPage, needSuper, canPage, checkDeletePin, PAGES, bcrypt };
