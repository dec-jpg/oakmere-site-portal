// Portal login: a signed, http-only session cookie. No external session store.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { q } = require('./db');

const COOKIE = 'oak_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
let secret = null;

async function loadSecret() {
  if (process.env.SESSION_SECRET) { secret = process.env.SESSION_SECRET; return; }
  const r = await q("SELECT value FROM settings WHERE key = 'session_secret'");
  if (r.rows[0]) { secret = r.rows[0].value; return; }
  secret = crypto.randomBytes(32).toString('hex');
  await q("INSERT INTO settings (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING", [secret]);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSession(res, user) {
  const token = sign({ uid: user.id, exp: Date.now() + MAX_AGE_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

async function currentUser(req) {
  const p = verify(parseCookies(req)[COOKIE]);
  if (!p) return null;
  const r = await q('SELECT id, name, email, role FROM users WHERE id = $1 AND active = TRUE', [p.uid]);
  return r.rows[0] || null;
}

function requireUser(role) {
  return async (req, res, next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Log in to continue.' });
      if (role === 'admin' && user.role !== 'admin') return res.status(403).json({ error: 'Only admins can do this.' });
      if (role === 'manager' && user.role === 'viewer') return res.status(403).json({ error: 'Your account is view-only.' });
      req.user = user;
      next();
    } catch (e) { next(e); }
  };
}

const hash = pw => bcrypt.hash(pw, 10);
const check = (pw, h) => bcrypt.compare(pw, h);

module.exports = { loadSecret, setSession, clearSession, currentUser, requireUser, hash, check };
