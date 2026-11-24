const r = require('express').Router();
const { tx } = require('../db');
const { requireAuth, needPage, checkDeletePin } = require('../auth');
const { U, num, newId, isDate, bad, HttpError } = require('../util');
const { ensureAccounts, upsertBanks, upsertDealers, patchSettings, audit, SAFE_SETTINGS, loadBook } = require('../book');

r.use(requireAuth);

/* Save a bill (new or edit).
   body: { bill:{id?,no,date,rows:[{desc,cur,base,qty,prate,srate,stock,mode,bank,dealer,comm}]},
           remap?:{ oldLine:newLine }   // when editing: where each old line moved (missing = removed)
           accounts?:[{name,type,phone}], banks?:[], dealers?:[], settings?:{stockOf,lastMode,payComm} } */
r.post('/bills', needPage('bill'), async (req, res) => {
  const b = req.body.bill || {};
  if (!isDate(b.date)) throw bad('Enter a valid date');
  const rows = (b.rows || []).map(x => ({
    desc: U(x.desc), cur: U(x.cur), base: U(x.base) || 'INR', qty: num(x.qty), prate: num(x.prate), srate: num(x.srate),
    stock: U(x.stock), mode: ['bank', 'shop', 'home'].includes(x.mode) ? x.mode : 'bank', bank: U(x.bank), dealer: U(x.dealer), comm: num(x.comm),
  }));
  if (!rows.length) throw bad('Add at least one line');
  rows.forEach((x, i) => {
    if (!x.desc) throw bad(`Line ${i + 1}: enter party name`);
    if (!(x.qty > 0)) throw bad(`Line ${i + 1}: enter quantity`);
    if (!(x.prate > 0) === !(x.srate > 0)) throw bad(`Line ${i + 1}: enter a purchase OR a sale rate`);
    if (x.cur === x.base) throw bad(`Line ${i + 1}: currency and base currency are the same`);
  });
  const out = await tx(async db => {
    await ensureAccounts(db, req.body.accounts);
    await upsertBanks(db, req.body.banks);
    await upsertDealers(db, req.body.dealers);
    await patchSettings(db, req.body.settings, SAFE_SETTINGS);
    for (const x of rows) {
      await ensureAccounts(db, [{ name: x.desc, type: 'party' }]);
      // currency goes to the stock company, or (no Stock) to our own "SGD STOCK"
      await ensureAccounts(db, [{ name: x.stock || x.cur + ' STOCK', type: 'stock' }]);
    }
    let id = b.id;
    const exists = id ? (await db.query('SELECT 1 FROM bills WHERE id=$1', [id])).rows.length : 0;
    let no = String(b.no || '').trim();
    if (!no) {
      const m = await db.query("SELECT COALESCE(MAX(NULLIF(regexp_replace(no,'\\D','','g'),'')::int),0) AS m FROM bills");
      no = String(Number(m.rows[0].m) + 1);
    }
    if (exists) {
      await db.query('UPDATE bills SET no=$2,date=$3 WHERE id=$1', [id, no, b.date]);
      await db.query('DELETE FROM bill_rows WHERE bill_id=$1', [id]);
      // re-point payments to the new line numbers, drop payments of removed lines
      const remap = req.body.remap || {};
      const linked = await db.query('SELECT * FROM jv WHERE link_bill=$1', [id]);
      for (const j of linked.rows) {
        const ni = remap[j.link_line];
        if (ni === undefined || ni === null || !rows[ni]) { await db.query('DELETE FROM jv WHERE id=$1', [j.id]); continue; }
        if (j.link_comm) { await db.query('UPDATE jv SET link_line=$2 WHERE id=$1', [j.id, ni]); continue; }
        const nr = rows[ni], purchase = nr.prate > 0;
        const counterIsMoney = ['bank', 'cash', 'dealer'].includes((await db.query('SELECT type FROM accounts WHERE name=$1', [j.dr])).rows[0]?.type);
        const ac = counterIsMoney ? j.dr : j.cr;
        const bookTo = nr.stock || nr.desc;   // a line with a Stock is booked to the stock company, so its payment settles that account
        await db.query('UPDATE jv SET link_line=$2, dr=$3, cr=$4, type=$5 WHERE id=$1',
          [j.id, ni, purchase ? bookTo : ac, purchase ? ac : bookTo, purchase ? 'payment' : 'receipt']);
      }
    } else {
      id = id || newId();
      await db.query('INSERT INTO bills(id,no,date,created_by) VALUES($1,$2,$3,$4)', [id, no, b.date, req.user.name]);
    }
    let i = 0;
    for (const x of rows) {
      await db.query(`INSERT INTO bill_rows(bill_id,line,descr,cur,base,qty,prate,srate,stock,mode,bank,dealer,comm)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, i++, x.desc, x.cur, x.base, x.qty, x.prate, x.srate, x.stock, x.mode, x.mode === 'bank' ? x.bank : '', x.mode === 'home' ? x.dealer : '', x.comm]);
    }
    if (exists) await audit(db, req.user.name, 'bill.edit', { id, no });
    return { id, no };
  });
  res.json({ ok: true, ...out, book: await loadBook(undefined, req.user) });
});

r.delete('/bills/:id', needPage(['bill', 'pay']), async (req, res) => {
  await checkDeletePin(req);
  await tx(async db => {
    const b = (await db.query('SELECT * FROM bills WHERE id=$1', [req.params.id])).rows[0];
    if (!b) throw new HttpError(404, 'Bill not found');
    await db.query('DELETE FROM bills WHERE id=$1', [b.id]); // rows + payments go with it (cascade)
    await audit(db, req.user.name, 'bill.delete', { id: b.id, no: b.no, date: b.date });
  });
  res.json({ ok: true, book: await loadBook(undefined, req.user) });
});

module.exports = r;
