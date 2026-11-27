/* Daily backup – saves everything (bills, vouchers, payments, names, banks, settings) to one file, the same file as
   Setup → Backup, so it can be loaded back with Setup → Import.

   Run:       npm run backup                (from the backend folder)
   Saved to:  backend/backups/remit-backup-YYYY-MM-DD.json   (or the folder in BACKUP_DIR in .env)
   Keeps the newest 60 backups and removes older ones from that folder.
   Schedule it daily with Windows Task Scheduler – see README "Daily backup". */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../src/db');
const { loadBook } = require('../src/book');

const KEEP = 60;
const dir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const NAME = /^remit-backup-\d{4}-\d{2}-\d{2}\.json$/;

(async () => {
  const book = await loadBook(pool, { role: 'super', name: 'BACKUP' });
  delete book.users;   // logins and PINs are not part of a backup (same as Setup → Backup)
  const d = new Date(), day = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'remit-backup-' + day + '.json');
  fs.writeFileSync(file, JSON.stringify(book));
  console.log('✔ Backup saved: ' + file + ' (' + book.bills.length + ' bills, ' + book.jv.length + ' entries)');
  const old = fs.readdirSync(dir).filter(f => NAME.test(f)).sort().slice(0, -KEEP);   // names sort by date
  old.forEach(f => fs.unlinkSync(path.join(dir, f)));
  if (old.length) console.log('  removed ' + old.length + ' backup(s) older than the newest ' + KEEP);
})()
  .catch(e => { console.error('✖ Backup failed: ' + e.message); process.exitCode = 1; })
  .finally(() => pool.end());
