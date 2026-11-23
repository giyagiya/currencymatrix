const r = require('express').Router();
const { pool, tx } = require('../db');
const { sign, requireAuth, bcrypt } = require('../auth');
const { U, bad, HttpError } = require('../util');
const { loadBook } = require('../book');

// Names for the login screen
r.get('/public/users', async (req, res) => {
  const { rows } = await pool.query('SELECT name,role FROM users ORDER BY id');
  res.json({ setupNeeded: !rows.some(u => u.role === 'super'), users: rows });
});

// First run: create the Super admin (only works when no Super admin exists)
r.post('/auth/setup', async (req, res) => {
  const name = U(req.body.name), pin = String(req.body.pin || '');
  if (!name) throw bad('Enter name');
  if (!/^\d{4,6}$/.test(pin)) throw bad('PIN must be 4 to 6 numbers');
  const user = await tx(async db => {
    const { rows } = await db.query("SELECT 1 FROM users WHERE role='super' LIMIT 1");
    if (rows.length) throw new HttpError(409, 'Super admin already exists – please login');
    const ins = await db.query('INSERT INTO users(name,role,pin_hash,pages) VALUES($1,$2,$3,$4) RETURNING id,name,role,pages',
      [name, 'super', await bcrypt.hash(pin, 10), []]);
    return ins.rows[0];
  });
  res.json({ token: sign(user), user });
});

r.post('/auth/login', async (req, res) => {
  const name = U(req.body.name), pin = String(req.body.pin || '');
  const { rows } = await pool.query('SELECT id,name,role,pages,pin_hash FROM users WHERE name=$1', [name]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(pin, u.pin_hash))) throw new HttpError(401, 'Wrong PIN');
  delete u.pin_hash;
  res.json({ token: sign(u), user: u });
});

r.get('/me', requireAuth, (req, res) => res.json(req.user));

// Whole book (all bills, vouchers, accounts, settings) – the app calculates from this
r.get('/book', requireAuth, async (req, res) => res.json(await loadBook(pool, req.user)));

module.exports = r;
