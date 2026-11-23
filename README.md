# Remit – Angular + Node.js + PostgreSQL

Currency exchange / remittance accounting: multi-line purchase & sale bills, payments (bank / shop cash / home delivery with commission per lakh), Cash & Bank vouchers, capital, balance sheet per currency, total profit, daily summary, ledger, WhatsApp bill messages, and logins (Super admin / Master / User) with page access and a delete password.

```
remit/
├── backend/            Node.js + Express API  (saves everything in PostgreSQL)
│   ├── db/schema.sql   all tables
│   ├── src/server.js   starts the API (and serves the built Angular site)
│   └── .env.example    settings – copy to .env
└── frontend/           Angular 18 app (all screens)
    └── src/app/core/engine.ts   all calculations (balances, profit, daily, ledger)
```

## 1. What you need
* **Node.js 20 or newer** – https://nodejs.org
* **PostgreSQL 14 or newer** – on your server, or a hosted one (Neon, Supabase, Render, AWS RDS…)

## 2. Create the database
```sql
-- run in psql as the postgres user
CREATE USER remit WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE remit OWNER remit;
```

## 3. Start the API
```bash
cd backend
cp .env.example .env        # then edit .env:
                            #   DATABASE_URL=postgres://remit:choose-a-strong-password@localhost:5432/remit
                            #   JWT_SECRET=<any long random text>
npm install
npm run db:init             # creates the tables (safe to run again)
npm start                   # → Remit API running on http://localhost:3000
```
Hosted Postgres that needs SSL (Neon, Supabase, Render, RDS): set `DATABASE_SSL=true`.

## 4. Build the Angular app
```bash
cd frontend
npm install
npx ng build                # output: frontend/dist/frontend/browser
```
The API automatically serves this folder, so after building just open **http://localhost:3000** – one server for site + API.

### While developing
```bash
cd backend  && npm run dev          # API on :3000
cd frontend && npx ng serve         # site on :4200 (talks to :3000, see src/environments/environment.development.ts)
```

## 5. First login
1. Open the site – it asks you to **create the Super admin** (name + 4–6 number PIN).
2. **Setup → Users & login**: add Master / User logins and tick the pages each one can open
   (🧾 Bill entry, 💳 Bills & payments, 💵 Cash & Bank, ⚖️ Balance, 📅 Daily, 📒 Ledger).
3. **Setup → Delete password**: set the 4-number password Master / User need to delete anything.
4. **Moving from the old single-file Remit app**: in the old app open Setup → Backup → download,
   then in the new app Setup → Backup → **Import backup**. (Logins and delete password are set again in the new app.)

## 6. Put it online (example: one Linux server / VPS)
```bash
# on the server, with Node + PostgreSQL installed
git clone <your repo> remit && cd remit
cd backend && npm install && cp .env.example .env && nano .env && npm run db:init && cd ..
cd frontend && npm install && npx ng build && cd ..
npm install -g pm2
pm2 start backend/src/server.js --name remit && pm2 save && pm2 startup
```
Then point your domain to the server and put **nginx** (or Caddy) in front of port 3000 with HTTPS (Let's Encrypt).
Set `CORS_ORIGIN` in `.env` to your site address, e.g. `https://remit.yourshop.in`.

Other options: **Render / Railway** (Web Service: build `cd backend && npm install && cd ../frontend && npm install && npx ng build`, start `node backend/src/server.js`, add a PostgreSQL database and copy its URL into `DATABASE_URL`).

## Security
* PINs and the delete password are stored **hashed (bcrypt)**; logins use signed tokens (JWT, 12 h).
* Every page permission and the delete password are checked **on the server**, not only on screen.
* Every delete, edit, rename and import is written to the `audit_log` table (who, when, what).
* Always use HTTPS in production and keep `JWT_SECRET` secret.
* Back up the database daily, e.g. `pg_dump remit > remit-$(date +%F).sql`.

## API (all under /api, JSON)
| Method | Path | Who |
|---|---|---|
| GET | /public/users | anyone (login screen) |
| POST | /auth/setup, /auth/login | first Super admin / everyone |
| GET | /book | logged in – whole book, the app calculates from it |
| POST | /bills | Bill entry |
| DELETE | /bills/:id | Bill entry or Bills & payments + delete password |
| POST | /jv | Cash & Bank (vouchers) · Bills & payments (payments) · Balance (capital) |
| DELETE | /jv/:id, /payments/:bill/:line | + delete password |
| PUT | /settings, /accounts/:name · POST /accounts/rename | Super admin |
| POST/PUT/DELETE | /users, /delete-pin | Super admin |
| GET /export · POST /import | backup | Super admin |
