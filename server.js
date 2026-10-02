// Oakmere site portal: sign in/out, inductions and subcontractor RAMS register.
const express = require('express');
const path = require('path');
const { q, migrate } = require('./lib/db');
const { loadSecret } = require('./lib/auth');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/p', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));

const pub = path.join(__dirname, 'public');
app.use(express.static(pub, { index: false, maxAge: '1h' }));
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get(['/s/:code', '/k/:token'], (req, res) => res.sendFile(path.join(pub, 'signin.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That file is over 20 MB.' });
  res.status(500).json({ error: 'Something went wrong on the server. Try again, and if it keeps happening let Safety Simplified know.' });
});

// Anyone still signed in from a previous day is closed off at 23:59 that day and flagged.
async function autoClose() {
  try {
    const r = await q(`UPDATE attendance
      SET out_at = (date_trunc('day', in_at AT TIME ZONE 'Europe/London') + INTERVAL '23 hours 59 minutes') AT TIME ZONE 'Europe/London',
          auto_closed = TRUE
      WHERE out_at IS NULL AND (in_at AT TIME ZONE 'Europe/London')::date < (NOW() AT TIME ZONE 'Europe/London')::date`);
    if (r.rowCount) console.log(`Auto-closed ${r.rowCount} open sign-ins from previous days`);
  } catch (e) { console.error('auto-close failed', e.message); }
}

(async () => {
  await migrate();
  await loadSecret();
  await autoClose();
  setInterval(autoClose, 10 * 60 * 1000);
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Oakmere site portal listening on ${port}`));
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
