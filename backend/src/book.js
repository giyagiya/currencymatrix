const { pool } = require('./db');
const { U, num, bad } = require('./util');

const ACC_TYPES = ['party', 'dealer', 'stock', 'cash', 'bank', 'expense', 'capital'];
const SAFE_SETTINGS = ['stockOf', 'lastMode', 'payComm']; // small keys any entry user may update

async function loadBook(db = pool, user = null) {
  const [st, acc, bk, dl, bills, rows, jv] = await Promise.all([
    db.query('SELECT key,value FROM settings'),
    db.query('SELECT name,type,phone FROM accounts'),
    db.query('SELECT name,acno,ifsc,comm FROM banks ORDER BY name'),
    db.query('SELECT name,comm FROM dealers ORDER BY name'),
    db.query('SELECT id,no,date FROM bills ORDER BY date, created_at'),
    db.query('SELECT * FROM bill_rows ORDER BY bill_id, line'),
    db.query('SELECT * FROM jv ORDER BY date, no'),
  ]);
  const S = { base: 'INR', currencies: [], stockOf: {}, payComm: { bank: 0, shop: 0, home: 0 }, lastMode: 'bank', valRate: {} };
  st.rows.forEach(r => { if (r.key !== 'delPinHash') S[r.key] = r.value; });
  S.hasDelPin = st.rows.some(r => r.key === 'delPinHash');
  S.accounts = {};
  acc.rows.forEach(a => { S.accounts[a.name] = a.phone ? { type: a.type, phone: a.phone } : { type: a.type }; });
  S.banks = bk.rows.map(b => ({ name: b.name, acno: b.acno, ifsc: b.ifsc, comm: num(b.comm) }));
  S.dealers = dl.rows.map(d => ({ name: d.name, comm: num(d.comm) }));
  const byBill = {};
  rows.rows.forEach(r => {
    (byBill[r.bill_id] = byBill[r.bill_id] || []).push({
      desc: r.descr, cur: r.cur, base: r.base, qty: num(r.qty), prate: num(r.prate), srate: num(r.srate),
      stock: r.stock, mode: r.mode, bank: r.bank, dealer: r.dealer, comm: num(r.comm),
    });
  });
  S.bills = bills.rows.map(b => ({ id: b.id, no: b.no, date: b.date, rows: byBill[b.id] || [] }));
  S.jv = jv.rows.map(j => {
    const o = { id: j.id, no: j.no, vno: j.vno, date: j.date, type: j.type, desc: j.descr, dr: j.dr, cr: j.cr, cur: j.cur, amt: num(j.amt), note: j.note, mode: j.mode, bank: j.bank, person: j.person, ref: j.ref };
    if (j.dealer) o.dealer = j.dealer;
    if (j.link_bill) o.link = j.link_comm ? { bill: j.link_bill, line: j.link_line, comm: true } : { bill: j.link_bill, line: j.link_line };
    return o;
  });
  const mx = S.bills.reduce((m, b) => Math.max(m, parseInt(b.no, 10) || 0), 0);
  S.nextBill = mx + 1;
  if (user && user.role === 'super') {
    const us = await db.query('SELECT id,name,role,pages FROM users ORDER BY id');
    S.users = us.rows;
  }
  return S;
}

async function ensureAccounts(db, list) {
  for (const a of list || []) {
    const name = U(a.name);
    if (!name) continue;
    const type = ACC_TYPES.includes(a.type) ? a.type : 'party';
    await db.query('INSERT INTO accounts(name,type,phone) VALUES($1,$2,$3) ON CONFLICT (name) DO NOTHING', [name, type, a.phone || '']);
    if (a.phone) await db.query('UPDATE accounts SET phone=$2 WHERE name=$1', [name, String(a.phone).trim()]);
  }
}

async function upsertBanks(db, list) {
  for (const b of list || []) {
    const name = U(b.name); if (!name) continue;
    await db.query(`INSERT INTO banks(name,acno,ifsc,comm) VALUES($1,$2,$3,$4)
      ON CONFLICT (name) DO UPDATE SET acno=COALESCE(NULLIF(EXCLUDED.acno,''),banks.acno), ifsc=COALESCE(NULLIF(EXCLUDED.ifsc,''),banks.ifsc), comm=EXCLUDED.comm`,
      [name, String(b.acno || '').trim(), U(b.ifsc), num(b.comm)]);
    await ensureAccounts(db, [{ name, type: 'bank' }]);
  }
}

async function upsertDealers(db, list) {
  for (const d of list || []) {
    const name = U(d.name); if (!name) continue;
    await db.query('INSERT INTO dealers(name,comm) VALUES($1,$2) ON CONFLICT (name) DO UPDATE SET comm=EXCLUDED.comm', [name, num(d.comm)]);
    await ensureAccounts(db, [{ name, type: 'dealer' }]);
  }
}

async function patchSettings(db, obj, allowed) {
  for (const k of Object.keys(obj || {})) {
    if (allowed && !allowed.includes(k)) continue;
    if (k === 'delPinHash') continue;
    await db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, JSON.stringify(obj[k])]);
  }
}

async function nextJvNo(db) {
  const { rows } = await db.query('SELECT COALESCE(MAX(no),0) AS m FROM jv');
  return Number(rows[0].m) + 1;
}

// Rules every jv record must follow (new or edited)
function checkJv(j) {
  if (!j.dr || !j.cr) throw bad('Entry needs a debit and a credit account');
  if (U(j.dr) === U(j.cr)) throw bad('Debit and credit can not be the same account (' + U(j.dr) + ')');
  if (!(num(j.amt) > 0)) throw bad('Amount must be more than 0');
}

// Insert one jv record (already validated)
async function insertJv(db, j, who) {
  checkJv(j);
  await db.query(`INSERT INTO jv(id,no,vno,date,type,descr,dr,cr,cur,amt,note,mode,bank,dealer,person,ref,link_bill,link_line,link_comm,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [j.id, j.no, String(j.vno || ''), j.date, j.type || 'out', U(j.desc), U(j.dr), U(j.cr), U(j.cur), Math.round(num(j.amt) * 100) / 100,
      j.note || '', j.mode || '', U(j.bank), U(j.dealer), U(j.person), j.ref || '',
      j.link ? j.link.bill : null, j.link ? j.link.line : null, !!(j.link && j.link.comm), who]);
}

async function audit(db, who, action, detail) {
  await db.query('INSERT INTO audit_log(who,action,detail) VALUES($1,$2,$3)', [who, action, JSON.stringify(detail || {})]);
}

module.exports = { loadBook, ensureAccounts, upsertBanks, upsertDealers, patchSettings, nextJvNo, checkJv, insertJv, audit, ACC_TYPES, SAFE_SETTINGS };
