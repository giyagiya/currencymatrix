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

module.exports = { pool, tx };
