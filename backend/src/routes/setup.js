const r = require('express').Router();
const fs = require('fs');
const path = require('path');
const { tx, pool } = require('../db');
const { requireAuth, needSuper, needPage, PAGES, bcrypt } = require('../auth');
const { U, num, newId, bad, HttpError } = require('../util');
const { loadBook, ensureAccounts, upsertBanks, upsertDealers, patchSettings, insertJv, audit, ACC_TYPES } = require('../book');

r.use(requireAuth);
const book = req => loadBook(undefined, req.user);

/* ---------- settings (Super admin) ---------- */
r.put('/settings', needSuper, async (req, res) => {
  const allowed = ['base', 'currencies', 'stockOf', 'payComm', 'lastMode', 'valRate'];
  const s = req.body || {};
  if (s.currencies && !Array.isArray(s.currencies)) throw bad('currencies must be a list');
  if (s.currencies) s.currencies = [...new Set(s.currencies.map(U).filter(Boolean))];
  await tx(db => patchSettings(db, s, allowed));
  res.json({ ok: true, book: await book(req) });
});

/* ---------- accounts ---------- */
// phone number can be saved by anyone who makes bills or payments
r.put('/accounts/:name/phone', needPage(['bill', 'pay']), async (req, res) => {
  const n = U(req.params.name);
  await tx(async db => {
    await ensureAccounts(db, [{ name: n, type: 'party' }]);
    await db.query('UPDATE accounts SET phone=$2 WHERE name=$1', [n, String(req.body.phone || '').trim()]);
  });
  res.json({ ok: true, book: await book(req) });
});

r.put('/accounts/:name', needSuper, async (req, res) => {
  const n = U(req.params.name), t = req.body.type;
  if (!ACC_TYPES.includes(t)) throw bad('Unknown account type');
  await tx(async db => {
    await ensureAccounts(db, [{ name: n, type: t }]);
    await db.query('UPDATE accounts SET type=$2 WHERE name=$1', [n, t]);
  });
  res.json({ ok: true, book: await book(req) });
});

r.post('/accounts', needSuper, async (req, res) => {
  const n = U(req.body.name);
  if (!n) throw bad('Enter name');
  await tx(db => ensureAccounts(db, [{ name: n, type: req.body.type }]));
  res.json({ ok: true, book: await book(req) });
});

// Rename everywhere (bills, vouchers, banks, dealers)
r.post('/accounts/rename', needSuper, async (req, res) => {
  const from = U(req.body.from), to = U(req.body.to);
  if (!from || !to || from === to) throw bad('Enter the new name');
  await tx(async db => {
    const a = (await db.query('SELECT * FROM accounts WHERE name=$1', [from])).rows[0];
    if (!a) throw new HttpError(404, from + ' not found');
    if ((await db.query('SELECT 1 FROM accounts WHERE name=$1', [to])).rows.length) throw bad(to + ' already exists');
    await db.query('INSERT INTO accounts(name,type,phone) VALUES($1,$2,$3)', [to, a.type, a.phone]);
    for (const col of ['descr', 'stock', 'bank', 'dealer']) await db.query(`UPDATE bill_rows SET ${col}=$2 WHERE ${col}=$1`, [from, to]);
    for (const col of ['descr', 'dr', 'cr', 'bank', 'dealer']) await db.query(`UPDATE jv SET ${col}=$2 WHERE ${col}=$1`, [from, to]);
    await db.query('UPDATE banks SET name=$2 WHERE name=$1', [from, to]);
    await db.query('UPDATE dealers SET name=$2 WHERE name=$1', [from, to]);
    const so = (await db.query("SELECT value FROM settings WHERE key='stockOf'")).rows[0];
    if (so) { const v = so.value; Object.keys(v).forEach(k => { if (v[k] === from) v[k] = to; }); await patchSettings(db, { stockOf: v }); }
    await db.query('DELETE FROM accounts WHERE name=$1', [from]);
    await audit(db, req.user.name, 'account.rename', { from, to });
  });
  res.json({ ok: true, book: await book(req) });
});

r.delete('/accounts/:name', needSuper, async (req, res) => {
  const n = U(req.params.name);
  const used = await pool.query('SELECT (SELECT COUNT(*) FROM jv WHERE dr=$1 OR cr=$1)+(SELECT COUNT(*) FROM bill_rows WHERE descr=$1 OR stock=$1) AS c', [n]);
  if (Number(used.rows[0].c) > 0) throw bad(n + ' has entries – it can not be removed');
  await pool.query('DELETE FROM accounts WHERE name=$1', [n]);
  res.json({ ok: true, book: await book(req) });
});

/* ---------- banks & dealers ---------- */
r.post('/banks', needPage(['bill', 'pay', 'jv']), async (req, res) => { await tx(db => upsertBanks(db, [req.body])); res.json({ ok: true, book: await book(req) }); });
r.delete('/banks/:name', needSuper, async (req, res) => { await pool.query('DELETE FROM banks WHERE name=$1', [U(req.params.name)]); res.json({ ok: true, book: await book(req) }); });
r.post('/dealers', needPage(['bill', 'pay']), async (req, res) => { await tx(db => upsertDealers(db, [req.body])); res.json({ ok: true, book: await book(req) }); });
r.delete('/dealers/:name', needSuper, async (req, res) => { await pool.query('DELETE FROM dealers WHERE name=$1', [U(req.params.name)]); res.json({ ok: true, book: await book(req) }); });

/* ---------- users (Super admin) ---------- */
const cleanPages = p => (Array.isArray(p) ? p : []).filter(x => PAGES.includes(x));
r.post('/users', needSuper, async (req, res) => {
  const name = U(req.body.name), role = req.body.role, pin = String(req.body.pin || '');
  if (!name) throw bad('Enter name');
  if (!['super', 'master', 'user'].includes(role)) throw bad('Choose a role');
  if (!/^\d{4,6}$/.test(pin)) throw bad('PIN must be 4 to 6 numbers');
  if ((await pool.query('SELECT 1 FROM users WHERE name=$1', [name])).rows.length) throw bad(name + ' already exists');
  await pool.query('INSERT INTO users(name,role,pin_hash,pages) VALUES($1,$2,$3,$4)', [name, role, await bcrypt.hash(pin, 10), role === 'super' ? [] : cleanPages(req.body.pages)]);
  res.json({ ok: true, book: await book(req) });
});
r.put('/users/:id', needSuper, async (req, res) => {
  const id = Number(req.params.id), b = req.body;
  const u = (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  if (!u) throw new HttpError(404, 'User not found');
  if (b.role && !['super', 'master', 'user'].includes(b.role)) throw bad('Choose a role');
  if (u.role === 'super' && b.role && b.role !== 'super') {
    const n = (await pool.query("SELECT COUNT(*) c FROM users WHERE role='super'")).rows[0].c;
    if (Number(n) < 2) throw bad('Keep at least one Super admin');
  }
  if (b.pin !== undefined && !/^\d{4,6}$/.test(String(b.pin))) throw bad('PIN must be 4 to 6 numbers');
  await pool.query('UPDATE users SET role=COALESCE($2,role), pages=COALESCE($3,pages), pin_hash=COALESCE($4,pin_hash) WHERE id=$1',
    [id, b.role || null, b.pages ? cleanPages(b.pages) : null, b.pin !== undefined ? await bcrypt.hash(String(b.pin), 10) : null]);
  res.json({ ok: true, book: await book(req) });
});
r.delete('/users/:id', needSuper, async (req, res) => {
  const id = Number(req.params.id);
  const u = (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'super' && Number((await pool.query("SELECT COUNT(*) c FROM users WHERE role='super'")).rows[0].c) < 2) throw bad('Keep at least one Super admin');
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
  res.json({ ok: true, book: await book(req) });
});

/* ---------- delete password (Super admin) ---------- */
r.put('/delete-pin', needSuper, async (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4}$/.test(pin)) throw bad('Delete password must be exactly 4 numbers');
  await pool.query("INSERT INTO settings(key,value) VALUES('delPinHash',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(await bcrypt.hash(pin, 10))]);
  res.json({ ok: true, book: await book(req) });
});

/* ---------- reset (Super admin) ---------- */
// what = 'entries': delete all bills and vouchers (payments, capital…) and the saved WhatsApp numbers. Accounts, banks, dealers and settings stay.
// what = 'all':     also delete accounts, banks, dealers and settings, back to a new install.
// Logins and the delete password are always kept. The audit log keeps the record of the reset.
const SCHEMA = path.join(__dirname, '..', '..', 'db', 'schema.sql');
r.post('/reset', needSuper, async (req, res) => {
  const what = req.body && req.body.what;
  if (!['entries', 'all'].includes(what)) throw bad('Choose what to reset');
  await tx(async db => {
    const jv = (await db.query('DELETE FROM jv')).rowCount;
    const bills = (await db.query('DELETE FROM bills')).rowCount;   // bill rows go with them
    // WhatsApp numbers come from entries – clear them too, so a new bill never shows a number nobody typed
    const phones = (await db.query("UPDATE accounts SET phone='' WHERE phone<>''")).rowCount;
    if (what === 'all') {
      await db.query('DELETE FROM banks'); await db.query('DELETE FROM dealers'); await db.query('DELETE FROM accounts');
      await db.query("DELETE FROM settings WHERE key <> 'delPinHash'");
      await db.query(fs.readFileSync(SCHEMA, 'utf8'));   // puts back the default settings and accounts
    }
    await audit(db, req.user.name, 'reset.' + what, { bills, jv, phones });
  });
  res.json({ ok: true, book: await book(req) });
});

/* ---------- backup & import ---------- */
r.get('/export', needSuper, async (req, res) => {
  const b = await loadBook(undefined, req.user);
  delete b.users;
  res.setHeader('Content-Disposition', 'attachment; filename="remit-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.json(b);
});

// Import a backup (from this app OR from the old single-file Remit app). Replaces all entries.
r.post('/import', needSuper, async (req, res) => {
  const S = req.body || {};
  let skipped = [];
  if (!Array.isArray(S.bills) || !Array.isArray(S.jv)) throw bad('This is not a Remit backup file');
  await tx(async db => {
    await db.query('DELETE FROM jv'); await db.query('DELETE FROM bills');
    await db.query('DELETE FROM banks'); await db.query('DELETE FROM dealers'); await db.query('DELETE FROM accounts');
    await patchSettings(db, {
      base: S.base || 'INR', currencies: S.currencies || [], stockOf: S.stockOf || {},
      payComm: S.payComm || { bank: 0, shop: 0, home: 0 }, lastMode: S.lastMode || 'bank', valRate: S.valRate || {},
    });
    await ensureAccounts(db, Object.keys(S.accounts || {}).map(n => ({ name: n, type: S.accounts[n].type, phone: S.accounts[n].phone })));
    await upsertBanks(db, S.banks); await upsertDealers(db, S.dealers);
    for (const b of S.bills) {
      await db.query('INSERT INTO bills(id,no,date,created_by) VALUES($1,$2,$3,$4)', [b.id || newId(), String(b.no), b.date, req.user.name]);
      let i = 0;
      for (const x of b.rows || []) {
        await ensureAccounts(db, [{ name: x.desc, type: 'party' }]);
        if (x.stock) await ensureAccounts(db, [{ name: U(x.stock), type: 'stock' }]);   // where the currency is kept / given from
        await db.query(`INSERT INTO bill_rows(bill_id,line,descr,cur,base,qty,prate,srate,stock,mode,bank,dealer,comm)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [b.id, i++, U(x.desc), U(x.cur), U(x.base) || S.base || 'INR', num(x.qty), num(x.prate), num(x.srate), U(x.stock), ['bank', 'shop', 'home'].includes(x.mode) ? x.mode : 'bank', U(x.bank), U(x.dealer), num(x.comm)]);
      }
    }
    let no = 1; skipped = [];
    const billIds = new Set(S.bills.map(b => b.id));
    for (const j of [...S.jv].sort((a, b) => (a.no || 0) - (b.no || 0))) {
      // skip entries the database can not accept (same debit & credit, 0 amount, missing bill)
      if (!j.dr || !j.cr || U(j.dr) === U(j.cr) || !(num(j.amt) > 0) || (j.link && !billIds.has(j.link.bill))) { skipped.push(j); continue; }
      for (const a of [j.dr, j.cr]) await ensureAccounts(db, [{ name: a, type: 'party' }]);
      await insertJv(db, { ...j, id: j.id || newId(), no: no++ }, req.user.name);
    }
    if (S.delPin === undefined && S.hasDelPin === undefined) { /* nothing */ }
    await audit(db, req.user.name, 'import', { bills: S.bills.length, jv: S.jv.length, skipped: skipped.length });
  });
  res.json({ ok: true, skipped: skipped.length, book: await book(req) });
});

module.exports = r;
