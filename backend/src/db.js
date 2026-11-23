const { Pool, types } = require('pg');
require('dotenv').config();

// DATE columns come back as plain 'YYYY-MM-DD' text (no timezone shifts)
types.setTypeParser(1082, v => v);
// NUMERIC columns come back as JS numbers
types.setTypeParser(1700, v => (v === null ? null : Number(v)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// The database must be UTF8, otherwise text with ₹ (commission notes) can not be saved.
async function checkEncoding() {
  const { rows } = await pool.query('SHOW server_encoding');
  const enc = rows[0].server_encoding;
  if (enc !== 'UTF8') console.warn(`⚠ Database encoding is ${enc}, not UTF8 – entries with ₹ in them will fail to save.\n` +
    `  Create the database with:  CREATE DATABASE remit OWNER remit ENCODING 'UTF8' TEMPLATE template0;`);
  return enc;
}

module.exports = { pool, tx, checkEncoding };
