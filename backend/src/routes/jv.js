const r = require('express').Router();
const { tx } = require('../db');
const { requireAuth, needPage, checkDeletePin, canPage } = require('../auth');
const { U, num, newId, isDate, bad, HttpError } = require('../util');
const { ensureAccounts, upsertBanks, upsertDealers, patchSettings, nextJvNo, insertJv, audit, SAFE_SETTINGS, loadBook } = require('../book');

r.use(requireAuth);

/* Save voucher lines / capital / payments.
   body: { entries:[{date,vno,type,desc,dr,cr,cur,amt,note,mode,bank,dealer,person,ref,link?}],
           accounts?:[{name,type}], banks?, dealers?, settings? } */
r.post('/jv', async (req, res) => {
  const entries = req.body.entries || [];
  if (!entries.length) throw bad('Add at least one line');
  const isPay = entries.every(e => e.link && e.link.bill);
  if (!(isPay ? canPage(req.user, 'pay') || canPage(req.user, 'bill') : canPage(req.user, 'jv'))) throw new HttpError(403, 'No access to this page');
  const capital = entries.some(e => U(e.dr) === 'CAPITAL' || U(e.cr) === 'CAPITAL');
  if (capital && !canPage(req.user, 'sheet')) throw new HttpError(403, 'Only logins with the Balance page can add capital');
  const out = await tx(async db => {
    await ensureAccounts(db, req.body.accounts);
    await upsertBanks(db, req.body.banks);
    await upsertDealers(db, req.body.dealers);
    await patchSettings(db, req.body.settings, SAFE_SETTINGS);
    let no = await nextJvNo(db);
    const vm = await db.query("SELECT COALESCE(MAX(NULLIF(regexp_replace(vno,'\\D','','g'),'')::int),0) AS m FROM jv");
    const autoVno = String(Number(vm.rows[0].m) + 1);
    const ids = [];
    for (const e of entries) {
      if (!isDate(e.date)) throw bad('Enter a valid date');
      if (e.link && e.link.bill) {
        const ok = (await db.query('SELECT 1 FROM bill_rows WHERE bill_id=$1 AND line=$2', [e.link.bill, e.link.line])).rows.length;
        if (!ok) throw bad('Bill line not found – refresh and try again');
        if (!e.link.comm) {
          const dup = (await db.query('SELECT 1 FROM jv WHERE link_bill=$1 AND link_line=$2 AND NOT link_comm', [e.link.bill, e.link.line])).rows.length;
          if (dup) throw bad('This bill line is already paid');
        }
      }
      for (const a of [e.dr, e.cr]) await ensureAccounts(db, [{ name: a, type: 'party' }]);
      const j = { ...e, id: e.id || newId(), no: no++, vno: e.link ? '' : (String(e.vno || '').trim() || autoVno) };
      await insertJv(db, j, req.user.name);
      ids.push(j.id);
    }
    return { ids };
  });
  res.json({ ok: true, ...out, book: await loadBook(undefined, req.user) });
});

r.delete('/jv/:id', needPage(['jv', 'pay']), async (req, res) => {
  await checkDeletePin(req);
  await tx(async db => {
    const j = (await db.query('SELECT * FROM jv WHERE id=$1', [req.params.id])).rows[0];
    if (!j) throw new HttpError(404, 'Entry not found');
    await db.query('DELETE FROM jv WHERE id=$1', [j.id]);
    await audit(db, req.user.name, 'jv.delete', j);
  });
  res.json({ ok: true, book: await loadBook(undefined, req.user) });
});

// Undo a bill payment (back to pending) – removes the payment and its commission
r.delete('/payments/:bill/:line', needPage(['pay', 'bill']), async (req, res) => {
  await checkDeletePin(req);
  await tx(async db => {
    const del = await db.query('DELETE FROM jv WHERE link_bill=$1 AND link_line=$2 RETURNING *', [req.params.bill, Number(req.params.line)]);
    await audit(db, req.user.name, 'payment.undo', del.rows);
  });
  res.json({ ok: true, book: await loadBook(undefined, req.user) });
});

module.exports = r;
