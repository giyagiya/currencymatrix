// Creates all tables. Run once:  npm run db:init
const fs = require('fs');
const path = require('path');
const { pool, checkEncoding } = require('./db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✔ Database tables are ready');
  await checkEncoding();
  await pool.end();
})().catch(e => { console.error('✖ ' + e.message); process.exit(1); });
