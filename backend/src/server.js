require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { HttpError } = require('./util');

const app = express();
const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/bills'));
app.use('/api', require('./routes/jv'));
app.use('/api', require('./routes/setup'));

// Optional: serve the built Angular app from the same server (frontend/dist/frontend/browser)
const web = path.join(__dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser');
if (fs.existsSync(web)) {
  app.use(express.static(web));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(web, 'index.html')));
}

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : (err.code === '23505' ? 409 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Server error – please try again' : err.message });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log('Remit API running on http://localhost:' + port));
