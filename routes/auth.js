const express = require('express');
const { q } = require('../lib/db');
const { setSession, clearSession, currentUser, requireUser, hash, check } = require('../lib/auth');
const { clean } = require('../lib/util');

const r = express.Router();

// Tells the login page whether the first admin still needs creating.
r.get('/state', async (req, res) => {
  const n = (await q('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
  const user = await currentUser(req);
  res.json({ needsSetup: n === 0, setupEnabled: !!process.env.SETUP_KEY, user });
});

// First admin account. Only works while there are no users, and only with SETUP_KEY.
r.post('/setup', async (req, res) => {
  const n = (await q('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
  if (n > 0) return res.status(400).json({ error: 'The portal is already set up. Log in instead.' });
  if (!process.env.SETUP_KEY) return res.status(400).json({ error: 'Set a SETUP_KEY variable on Railway, then try again.' });
  const { setup_key, name, email, password } = req.body || {};
  if (setup_key !== process.env.SETUP_KEY) return res.status(403).json({ error: 'That setup key is not right.' });
  if (!clean(name) || !clean(email) || !password || password.length < 8) return res.status(400).json({ error: 'Enter a name, an email and a password of at least 8 characters.' });
  const u = (await q("INSERT INTO users (name, email, password_hash, role) VALUES ($1, LOWER($2), $3, 'admin') RETURNING id, name, email, role",
    [clean(name), clean(email), await hash(password)])).rows[0];
  setSession(res, u);
  res.json({ user: u });
});

r.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = (await q('SELECT * FROM users WHERE email = LOWER($1) AND active = TRUE', [clean(email) || ''])).rows[0];
  if (!u || !(await check(password || '', u.password_hash))) return res.status(401).json({ error: 'Email or password not recognised.' });
  setSession(res, u);
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

r.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

r.post('/password', requireUser(), async (req, res) => {
  const { current, next } = req.body || {};
  const u = (await q('SELECT password_hash FROM users WHERE id = $1', [req.user.id])).rows[0];
  if (!(await check(current || '', u.password_hash))) return res.status(400).json({ error: 'Current password is not right.' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'New password needs at least 8 characters.' });
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await hash(next), req.user.id]);
  res.json({ ok: true });
});

module.exports = r;
