-- Remit accounting – PostgreSQL schema
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('super','master','user')),
  pin_hash   TEXT NOT NULL,
  pages      TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  name  TEXT PRIMARY KEY,
  type  TEXT NOT NULL DEFAULT 'party'
        CHECK (type IN ('party','dealer','stock','cash','bank','expense','capital')),
  phone TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS banks (
  name TEXT PRIMARY KEY,
  acno TEXT NOT NULL DEFAULT '',
  ifsc TEXT NOT NULL DEFAULT '',
  comm NUMERIC(14,4) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dealers (
  name TEXT PRIMARY KEY,
  comm NUMERIC(14,4) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bills (
  id         TEXT PRIMARY KEY,
  no         TEXT NOT NULL,
  date       DATE NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bills_date_idx ON bills(date);

CREATE TABLE IF NOT EXISTS bill_rows (
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line    INT  NOT NULL,
  descr   TEXT NOT NULL,              -- party name
  cur     TEXT NOT NULL,              -- foreign currency (SGD…)
  base    TEXT NOT NULL,              -- currency of the price (INR)
  qty     NUMERIC(20,4) NOT NULL,
  prate   NUMERIC(20,8) NOT NULL DEFAULT 0,  -- purchase rate (0 when sale)
  srate   NUMERIC(20,8) NOT NULL DEFAULT 0,  -- sale rate (0 when purchase)
  stock   TEXT NOT NULL DEFAULT '',
  mode    TEXT NOT NULL DEFAULT 'bank' CHECK (mode IN ('bank','shop','home')),
  bank    TEXT NOT NULL DEFAULT '',
  dealer  TEXT NOT NULL DEFAULT '',
  comm    NUMERIC(14,4) NOT NULL DEFAULT 0,  -- commission per lakh
  PRIMARY KEY (bill_id, line)
);

-- Every money movement: vouchers, payments, receipts, commissions, capital.
CREATE TABLE IF NOT EXISTS jv (
  id         TEXT PRIMARY KEY,
  no         INT  NOT NULL,
  vno        TEXT NOT NULL DEFAULT '',
  date       DATE NOT NULL,
  type       TEXT NOT NULL,           -- in / out / exp / payment / receipt / expense
  descr      TEXT NOT NULL DEFAULT '',
  dr         TEXT NOT NULL,           -- debit account
  cr         TEXT NOT NULL,           -- credit account
  cur        TEXT NOT NULL,
  amt        NUMERIC(20,2) NOT NULL CHECK (amt > 0),
  note       TEXT NOT NULL DEFAULT '',
  mode       TEXT NOT NULL DEFAULT '',
  bank       TEXT NOT NULL DEFAULT '',
  dealer     TEXT NOT NULL DEFAULT '',
  person     TEXT NOT NULL DEFAULT '',
  ref        TEXT NOT NULL DEFAULT '',
  link_bill  TEXT REFERENCES bills(id) ON DELETE CASCADE,
  link_line  INT,
  link_comm  BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jv_date_idx ON jv(date);
CREATE INDEX IF NOT EXISTS jv_link_idx ON jv(link_bill, link_line);

-- Who deleted / changed what
CREATE TABLE IF NOT EXISTS audit_log (
  id     SERIAL PRIMARY KEY,
  at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  who    TEXT,
  action TEXT NOT NULL,
  detail JSONB
);

INSERT INTO settings(key,value) VALUES
 ('base','"INR"'),
 ('currencies','["SGD","MYR","AED","USD","USDT"]'),
 ('stockOf','{}'),
 ('payComm','{"bank":0,"shop":0,"home":0}'),
 ('lastMode','"bank"'),
 ('valRate','{}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO accounts(name,type) VALUES ('CASH','cash'),('HAND CASH','cash'),('BANK','bank'),('EXPENSES','expense'),('CAPITAL','capital')
ON CONFLICT (name) DO NOTHING;

-- A bill line with a Stock is booked to the stock company (no Stock = the party).
-- Move payments / receipts saved before this rule from the party to the stock company. Safe to run again.
UPDATE jv SET dr = br.stock FROM bill_rows br
 WHERE jv.link_bill = br.bill_id AND jv.link_line = br.line AND NOT jv.link_comm
   AND br.stock <> '' AND jv.type = 'payment' AND jv.dr = br.descr;
UPDATE jv SET cr = br.stock FROM bill_rows br
 WHERE jv.link_bill = br.bill_id AND jv.link_line = br.line AND NOT jv.link_comm
   AND br.stock <> '' AND jv.type = 'receipt' AND jv.cr = br.descr;

-- A bill line with no Stock keeps its currency in our own stock account ("SGD STOCK"). Create those for older bills. Safe to run again.
INSERT INTO accounts(name,type) SELECT DISTINCT cur || ' STOCK', 'stock' FROM bill_rows WHERE stock = ''
ON CONFLICT (name) DO NOTHING;
