// Portal API for Oakmere staff. Roles: admin (everything incl. users), manager (edit), viewer (read only).
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { q } = require('../lib/db');
const { requireUser, hash } = require('../lib/auth');
const { token, clean, normPhone, csv, london } = require('../lib/util');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const view = requireUser();
const edit = requireUser('manager');
const admin = requireUser('admin');

const baseUrl = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const int = v => (v === '' || v == null ? null : parseInt(v, 10));
const num = v => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
const RAMS_STATUSES = ['received', 'under_review', 'accepted', 'returned'];

r.get('/me', view, (req, res) => res.json({ user: req.user }));

// ---------- dashboard ----------
r.get('/dashboard', view, async (req, res) => {
  const sites = (await q(`SELECT s.id, s.code, s.name,
      (SELECT COUNT(*)::int FROM attendance a WHERE a.site_id = s.id AND a.out_at IS NULL) AS on_site,
      (SELECT COUNT(DISTINCT a.operative_id)::int FROM attendance a WHERE a.site_id = s.id
         AND (a.in_at AT TIME ZONE 'Europe/London')::date = (NOW() AT TIME ZONE 'Europe/London')::date) AS today
      FROM sites s WHERE s.active = TRUE ORDER BY s.name`)).rows;
  const rams = (await q(`SELECT
      COUNT(*) FILTER (WHERE status IN ('received','under_review'))::int AS to_review,
      COUNT(*) FILTER (WHERE status = 'returned')::int AS returned,
      COUNT(*) FILTER (WHERE status = 'accepted' AND review_due IS NOT NULL AND review_due < CURRENT_DATE)::int AS overdue
      FROM rams`)).rows[0];
  // Companies on site today with no accepted RAMS for that site.
  const gaps = (await q(`SELECT DISTINCT s.name AS site_name, s.id AS site_id, COALESCE(c.name, o.company_other) AS company, c.id AS company_id
      FROM attendance a JOIN operatives o ON o.id = a.operative_id JOIN sites s ON s.id = a.site_id
      LEFT JOIN companies c ON c.id = o.company_id
      WHERE (a.in_at AT TIME ZONE 'Europe/London')::date = (NOW() AT TIME ZONE 'Europe/London')::date
        AND NOT EXISTS (SELECT 1 FROM rams r WHERE r.site_id = a.site_id AND r.company_id = o.company_id AND r.status = 'accepted')
      ORDER BY 1, 3`)).rows;
  const unmatched = (await q('SELECT COUNT(*)::int AS n FROM operatives WHERE company_id IS NULL')).rows[0].n;
  const ind = (await q("SELECT id, title, year FROM inductions WHERE status = 'published' ORDER BY published_at DESC LIMIT 1")).rows[0] || null;
  const refusals = (await q("SELECT COUNT(*)::int AS n FROM refusals WHERE (at AT TIME ZONE 'Europe/London')::date = (NOW() AT TIME ZONE 'Europe/London')::date")).rows[0].n;
  res.json({ sites, rams, gaps, unmatched, induction: ind, refusals_today: refusals });
});

// Fire roll: who is on site right now.
r.get('/onsite', view, async (req, res) => {
  const rows = (await q(`SELECT a.id, a.in_at, a.method, a.in_note, a.site_id, s.name AS site_name, o.id AS operative_id, o.full_name, o.phone,
      COALESCE(c.name, o.company_other) AS company, o.trade, (a.in_photo IS NOT NULL) AS has_photo
      FROM attendance a JOIN operatives o ON o.id = a.operative_id JOIN sites s ON s.id = a.site_id
      LEFT JOIN companies c ON c.id = o.company_id
      WHERE a.out_at IS NULL AND ($1::int IS NULL OR a.site_id = $1) ORDER BY s.name, company, o.full_name`, [int(req.query.site)])).rows;
  res.json({ rows });
});

// ---------- sites ----------
const SITE_FIELDS = ['code', 'name', 'address', 'lat', 'lng', 'radius_m', 'site_manager', 'site_phone', 'muster_point', 'first_aid', 'welfare', 'site_rules', 'active'];
function siteValues(b) {
  return [
    (clean(b.code, 20) || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''), clean(b.name, 120), clean(b.address, 300),
    num(b.lat), num(b.lng), Math.max(25, Math.min(5000, int(b.radius_m) || 250)),
    clean(b.site_manager, 120), clean(b.site_phone, 40), clean(b.muster_point, 500), clean(b.first_aid, 500),
    clean(b.welfare, 500), clean(b.site_rules, 4000), b.active === undefined ? true : !!b.active,
  ];
}

r.get('/sites', view, async (req, res) => {
  res.json({ rows: (await q('SELECT * FROM sites ORDER BY active DESC, name')).rows, base: baseUrl(req) });
});

r.post('/sites', edit, async (req, res) => {
  const v = siteValues(req.body || {});
  if (!v[0] || !v[1]) return res.status(400).json({ error: 'A site needs a code and a name.' });
  if ((v[3] == null) !== (v[4] == null)) return res.status(400).json({ error: 'Enter both latitude and longitude, or neither.' });
  try {
    const row = (await q(`INSERT INTO sites (${SITE_FIELDS.join(',')}) VALUES (${SITE_FIELDS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, v)).rows[0];
    res.json({ row });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Another site already uses that code.' });
    throw e;
  }
});

r.put('/sites/:id', edit, async (req, res) => {
  const v = siteValues(req.body || {});
  if (!v[0] || !v[1]) return res.status(400).json({ error: 'A site needs a code and a name.' });
  if ((v[3] == null) !== (v[4] == null)) return res.status(400).json({ error: 'Enter both latitude and longitude, or neither.' });
  try {
    const row = (await q(`UPDATE sites SET ${SITE_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')} WHERE id = $${SITE_FIELDS.length + 1} RETURNING *`, [...v, req.params.id])).rows[0];
    res.json({ row });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Another site already uses that code.' });
    throw e;
  }
});

r.get('/sites/:id/qr.svg', view, async (req, res) => {
  const s = (await q('SELECT code FROM sites WHERE id = $1', [req.params.id])).rows[0];
  if (!s) return res.status(404).end();
  res.type('image/svg+xml').send(await QRCode.toString(`${baseUrl(req)}/s/${s.code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
});

// Printable poster with the QR code for the site cabin.
r.get('/sites/:id/poster', view, async (req, res) => {
  const s = (await q('SELECT code, name FROM sites WHERE id = $1', [req.params.id])).rows[0];
  if (!s) return res.status(404).end();
  const url = `${baseUrl(req)}/s/${s.code}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Sign in: ${esc(s.name)}</title>
  <link rel="stylesheet" href="/style.css"></head><body class="poster">
  <div class="poster-sheet"><img src="/logo.svg" alt="Oakmere" class="poster-logo">
  <h1>Sign in and out here</h1><p class="poster-site">${esc(s.name)}</p><div class="poster-qr">${svg}</div>
  <p>Scan with your phone camera every time you arrive and leave.</p><p class="poster-url">${esc(url)}</p>
  <p class="poster-small">First time on site? The scan takes you through the induction.</p></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
});

r.get('/sites/:id/kiosks', view, async (req, res) => {
  const rows = (await q('SELECT id, token, label, created_by, created_at FROM kiosks WHERE site_id = $1 AND revoked = FALSE ORDER BY created_at DESC', [req.params.id])).rows;
  res.json({ rows: rows.map(k => ({ ...k, url: `${baseUrl(req)}/k/${k.token}` })) });
});

r.post('/sites/:id/kiosks', edit, async (req, res) => {
  const t = token(18);
  const row = (await q('INSERT INTO kiosks (site_id, token, label, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [req.params.id, t, clean((req.body || {}).label, 80), req.user.name])).rows[0];
  res.json({ row: { ...row, url: `${baseUrl(req)}/k/${t}` } });
});

r.delete('/kiosks/:id', edit, async (req, res) => {
  await q('UPDATE kiosks SET revoked = TRUE WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- subcontractors ----------
r.get('/companies', view, async (req, res) => {
  const rows = (await q(`SELECT c.*,
      (SELECT COUNT(*)::int FROM operatives o WHERE o.company_id = c.id) AS operatives,
      (SELECT COUNT(*)::int FROM rams r WHERE r.company_id = c.id AND r.status = 'accepted') AS rams_accepted,
      (SELECT COUNT(*)::int FROM rams r WHERE r.company_id = c.id AND r.status IN ('received','under_review')) AS rams_pending,
      (SELECT COUNT(*)::int FROM attendance a JOIN operatives o ON o.id = a.operative_id WHERE o.company_id = c.id AND a.out_at IS NULL) AS on_site
      FROM companies c ORDER BY c.active DESC, LOWER(c.name)`)).rows;
  res.json({ rows });
});

function companyValues(b) {
  return [clean(b.name, 120), clean(b.trade, 80), clean(b.contact_name, 120), clean(b.contact_email, 160), clean(b.contact_phone, 40), b.active === undefined ? true : !!b.active];
}

r.post('/companies', edit, async (req, res) => {
  const v = companyValues(req.body || {});
  if (!v[0]) return res.status(400).json({ error: 'Enter the company name.' });
  try {
    res.json({ row: (await q('INSERT INTO companies (name, trade, contact_name, contact_email, contact_phone, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', v)).rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'That company is already on the list.' });
    throw e;
  }
});

r.put('/companies/:id', edit, async (req, res) => {
  const v = companyValues(req.body || {});
  if (!v[0]) return res.status(400).json({ error: 'Enter the company name.' });
  try {
    res.json({ row: (await q('UPDATE companies SET name=$1, trade=$2, contact_name=$3, contact_email=$4, contact_phone=$5, active=$6 WHERE id=$7 RETURNING *', [...v, req.params.id])).rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Another company already has that name.' });
    throw e;
  }
});

// ---------- operatives ----------
r.get('/operatives', view, async (req, res) => {
  const s = clean(req.query.search, 80);
  const rows = (await q(`SELECT o.id, o.full_name, o.phone, o.trade, o.company_id, o.company_other, o.cscs_type, o.cscs_expiry, o.created_at,
      COALESCE(c.name, o.company_other) AS company,
      (SELECT MAX(in_at) FROM attendance a WHERE a.operative_id = o.id) AS last_seen,
      EXISTS (SELECT 1 FROM attendance a WHERE a.operative_id = o.id AND a.out_at IS NULL) AS on_site,
      EXISTS (SELECT 1 FROM induction_records ir JOIN inductions i ON i.id = ir.induction_id
              WHERE ir.operative_id = o.id AND i.id = (SELECT id FROM inductions WHERE status='published' ORDER BY published_at DESC LIMIT 1)) AS inducted
      FROM operatives o LEFT JOIN companies c ON c.id = o.company_id
      WHERE ($1::text IS NULL OR o.full_name ILIKE '%' || $1 || '%' OR o.phone ILIKE '%' || $1 || '%' OR COALESCE(c.name, o.company_other) ILIKE '%' || $1 || '%')
        AND ($2::int IS NULL OR o.company_id = $2)
        AND ($3::text IS NULL OR o.company_id IS NULL)
      ORDER BY o.full_name`, [s, int(req.query.company), req.query.unmatched ? '1' : null])).rows;
  res.json({ rows });
});

r.get('/operatives/:id', view, async (req, res) => {
  const op = (await q(`SELECT o.*, COALESCE(c.name, o.company_other) AS company FROM operatives o LEFT JOIN companies c ON c.id = o.company_id WHERE o.id = $1`, [req.params.id])).rows[0];
  if (!op) return res.status(404).json({ error: 'Not found.' });
  delete op.device_token;
  const inductions = (await q(`SELECT ir.id, ir.completed_at, ir.attempts, i.title, i.year, s.name AS site_name
      FROM induction_records ir JOIN inductions i ON i.id = ir.induction_id LEFT JOIN sites s ON s.id = ir.site_id
      WHERE ir.operative_id = $1 ORDER BY ir.completed_at DESC`, [op.id])).rows;
  const attendance = (await q(`SELECT a.id, a.in_at, a.out_at, a.auto_closed, a.method, s.name AS site_name FROM attendance a JOIN sites s ON s.id = a.site_id
      WHERE a.operative_id = $1 ORDER BY a.in_at DESC LIMIT 60`, [op.id])).rows;
  const rams = (await q(`SELECT b.confirmed_at, r.title, r.reference, r.revision, s.name AS site_name FROM rams_briefings b
      JOIN rams r ON r.id = b.rams_id JOIN sites s ON s.id = r.site_id WHERE b.operative_id = $1 ORDER BY b.confirmed_at DESC`, [op.id])).rows;
  res.json({ operative: op, inductions, attendance, rams });
});

r.put('/operatives/:id', edit, async (req, res) => {
  const b = req.body || {};
  const company_id = int(b.company_id);
  await q(`UPDATE operatives SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone), company_id = $3,
           company_other = CASE WHEN $3::int IS NULL THEN $4 ELSE NULL END, trade = $5, cscs_type = $6, cscs_number = $7, cscs_expiry = $8,
           emergency_name = $9, emergency_phone = $10 WHERE id = $11`,
    [clean(b.full_name, 120), normPhone(b.phone) || null, company_id, clean(b.company_other, 120), clean(b.trade, 80), clean(b.cscs_type, 60),
      clean(b.cscs_number, 40), b.cscs_expiry || null, clean(b.emergency_name, 120), normPhone(b.emergency_phone) || null, req.params.id]);
  res.json({ ok: true });
});

r.get('/induction-records/:id/signature', view, async (req, res) => {
  const row = (await q('SELECT signature FROM induction_records WHERE id = $1', [req.params.id])).rows[0];
  if (!row || !row.signature) return res.status(404).end();
  const m = row.signature.match(/^data:(image\/\w+);base64,(.*)$/);
  res.type(m[1]).send(Buffer.from(m[2], 'base64'));
});

// ---------- attendance ----------
async function attendanceRows(req) {
  const from = req.query.from || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  return (await q(`SELECT a.id, a.in_at, a.out_at, a.auto_closed, a.method, a.in_distance_m, a.out_distance_m, a.in_note, a.out_note,
      (a.in_photo IS NOT NULL) AS has_in_photo, (a.out_photo IS NOT NULL) AS has_out_photo,
      s.name AS site_name, s.code AS site_code, o.id AS operative_id, o.full_name, COALESCE(a.company_name, c.name, o.company_other) AS company, o.trade
      FROM attendance a JOIN sites s ON s.id = a.site_id JOIN operatives o ON o.id = a.operative_id LEFT JOIN companies c ON c.id = o.company_id
      WHERE (a.in_at AT TIME ZONE 'Europe/London')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR a.site_id = $3) AND ($4::int IS NULL OR o.company_id = $4)
      ORDER BY a.in_at DESC LIMIT 5000`, [from, to, int(req.query.site), int(req.query.company)])).rows;
}

r.get('/attendance', view, async (req, res) => res.json({ rows: await attendanceRows(req) }));

r.get('/attendance.csv', view, async (req, res) => {
  const rows = await attendanceRows(req);
  const hrs = x => (x.out_at ? ((new Date(x.out_at) - new Date(x.in_at)) / 36e5).toFixed(2) : '');
  const out = csv(rows, [
    { label: 'Site', key: 'site_name' }, { label: 'Name', key: 'full_name' }, { label: 'Company', key: 'company' }, { label: 'Trade', key: 'trade' },
    { label: 'Signed in', get: x => london(x.in_at) }, { label: 'Signed out', get: x => london(x.out_at) }, { label: 'Hours', get: hrs },
    { label: 'Auto-closed', get: x => (x.auto_closed ? 'Yes' : '') }, { label: 'Method', key: 'method' },
    { label: 'Distance in (m)', key: 'in_distance_m' }, { label: 'Note in', key: 'in_note' }, { label: 'Note out', key: 'out_note' },
  ]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${req.query.from || 'last7'}-${req.query.to || 'today'}.csv"`);
  res.send(out);
});

r.get('/attendance/:id/photo/:which', view, async (req, res) => {
  const col = req.params.which === 'out' ? 'out_photo' : 'in_photo';
  const row = (await q(`SELECT ${col} AS p FROM attendance WHERE id = $1`, [req.params.id])).rows[0];
  if (!row || !row.p) return res.status(404).end();
  const m = row.p.match(/^data:(image\/\w+);base64,(.*)$/);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(m[1]).send(Buffer.from(m[2], 'base64'));
});

// Manager signs someone out (e.g. clearing the fire roll at the end of the day).
r.post('/attendance/:id/close', edit, async (req, res) => {
  await q(`UPDATE attendance SET out_at = NOW(), out_note = $2 WHERE id = $1 AND out_at IS NULL`, [req.params.id, `Signed out by ${req.user.name}`]);
  res.json({ ok: true });
});

r.get('/refusals', view, async (req, res) => {
  const rows = (await q(`SELECT f.*, s.name AS site_name, o.full_name, COALESCE(c.name, o.company_other) AS company
      FROM refusals f LEFT JOIN sites s ON s.id = f.site_id LEFT JOIN operatives o ON o.id = f.operative_id LEFT JOIN companies c ON c.id = o.company_id
      ORDER BY f.at DESC LIMIT 300`)).rows;
  res.json({ rows });
});

// ---------- inductions ----------
r.get('/inductions', view, async (req, res) => {
  const rows = (await q(`SELECT i.id, i.title, i.year, i.status, i.published_at, i.updated_at,
      jsonb_array_length(i.sections) AS section_count, jsonb_array_length(i.questions) AS question_count,
      (SELECT COUNT(*)::int FROM induction_records ir WHERE ir.induction_id = i.id) AS completed
      FROM inductions i ORDER BY i.year DESC, i.created_at DESC`)).rows;
  res.json({ rows });
});

r.get('/inductions/:id', view, async (req, res) => {
  const row = (await q('SELECT * FROM inductions WHERE id = $1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json({ row });
});

function inductionPayload(b) {
  const sections = (Array.isArray(b.sections) ? b.sections : []).map(s => ({ heading: clean(s.heading, 200) || '', body: clean(s.body, 20000) || '' })).filter(s => s.heading || s.body);
  const questions = (Array.isArray(b.questions) ? b.questions : []).map(x => {
    const options = (Array.isArray(x.options) ? x.options : []).map(o => clean(o, 300)).filter(Boolean);
    return { question: clean(x.question, 500) || '', options, answer: Math.min(Math.max(0, int(x.answer) || 0), Math.max(0, options.length - 1)) };
  }).filter(x => x.question && x.options.length >= 2);
  return { title: clean(b.title, 200), year: int(b.year), intro: clean(b.intro, 4000), sections, questions };
}

r.post('/inductions', edit, async (req, res) => {
  const b = req.body || {};
  let base = { title: `Site induction ${new Date().getFullYear()}`, year: new Date().getFullYear(), intro: null, sections: [], questions: [] };
  if (b.copy_from) {
    const src = (await q('SELECT * FROM inductions WHERE id = $1', [b.copy_from])).rows[0];
    if (src) base = { title: src.title.replace(/\d{4}/, String(src.year + 1)), year: src.year + 1, intro: src.intro, sections: src.sections, questions: src.questions };
  }
  const row = (await q("INSERT INTO inductions (title, year, intro, sections, questions, status) VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *",
    [base.title, base.year, base.intro, JSON.stringify(base.sections), JSON.stringify(base.questions)])).rows[0];
  res.json({ row });
});

r.put('/inductions/:id', edit, async (req, res) => {
  const cur = (await q('SELECT status FROM inductions WHERE id = $1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Not found.' });
  if (cur.status !== 'draft') return res.status(400).json({ error: 'Published inductions are locked. Start a new version to make changes.' });
  const p = inductionPayload(req.body || {});
  if (!p.title || !p.year) return res.status(400).json({ error: 'Give the induction a title and a year.' });
  const row = (await q('UPDATE inductions SET title=$1, year=$2, intro=$3, sections=$4, questions=$5, updated_at=NOW() WHERE id=$6 RETURNING *',
    [p.title, p.year, p.intro, JSON.stringify(p.sections), JSON.stringify(p.questions), req.params.id])).rows[0];
  res.json({ row });
});

r.post('/inductions/:id/publish', edit, async (req, res) => {
  const row = (await q('SELECT * FROM inductions WHERE id = $1', [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (row.status !== 'draft') return res.status(400).json({ error: 'This version is already published.' });
  if (!row.sections.length) return res.status(400).json({ error: 'Add at least one section before publishing.' });
  if (!row.questions.length) return res.status(400).json({ error: 'Add at least one question before publishing.' });
  await q("UPDATE inductions SET status = 'superseded' WHERE status = 'published'");
  await q("UPDATE inductions SET status = 'published', published_at = NOW() WHERE id = $1", [row.id]);
  res.json({ ok: true });
});

r.delete('/inductions/:id', edit, async (req, res) => {
  const row = (await q("DELETE FROM inductions WHERE id = $1 AND status = 'draft' RETURNING id", [req.params.id])).rows[0];
  if (!row) return res.status(400).json({ error: 'Only drafts can be deleted.' });
  res.json({ ok: true });
});

r.get('/inductions/:id/records', view, async (req, res) => {
  const rows = (await q(`SELECT ir.id, ir.completed_at, ir.attempts, o.id AS operative_id, o.full_name, COALESCE(c.name, o.company_other) AS company, s.name AS site_name
      FROM induction_records ir JOIN operatives o ON o.id = ir.operative_id LEFT JOIN companies c ON c.id = o.company_id LEFT JOIN sites s ON s.id = ir.site_id
      WHERE ir.induction_id = $1 ORDER BY ir.completed_at DESC`, [req.params.id])).rows;
  res.json({ rows });
});

// ---------- RAMS register ----------
r.get('/rams', view, async (req, res) => {
  const rows = (await q(`SELECT r.id, r.site_id, r.company_id, r.title, r.reference, r.revision, r.received_on, r.status, r.review_comments,
      r.reviewed_by, r.reviewed_at, r.review_due, r.file_name, r.uploaded_by, r.created_at, s.name AS site_name, c.name AS company,
      (r.file_data IS NOT NULL) AS has_file,
      (SELECT COUNT(*)::int FROM rams_briefings b WHERE b.rams_id = r.id) AS briefed
      FROM rams r JOIN sites s ON s.id = r.site_id JOIN companies c ON c.id = r.company_id
      WHERE ($1::int IS NULL OR r.site_id = $1) AND ($2::int IS NULL OR r.company_id = $2) AND ($3::text IS NULL OR r.status = $3)
      ORDER BY CASE r.status WHEN 'received' THEN 0 WHEN 'under_review' THEN 1 WHEN 'returned' THEN 2 ELSE 3 END, r.received_on DESC, r.id DESC`,
    [int(req.query.site), int(req.query.company), RAMS_STATUSES.includes(req.query.status) ? req.query.status : null])).rows;
  res.json({ rows });
});

r.post('/rams', edit, upload.single('file'), async (req, res) => {
  const b = req.body || {};
  if (!int(b.site_id) || !int(b.company_id) || !clean(b.title)) return res.status(400).json({ error: 'Choose the site and subcontractor, and give the RAMS a title.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the RAMS document.' });
  const row = (await q(`INSERT INTO rams (site_id, company_id, title, reference, revision, received_on, file_name, file_mime, file_data, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8,$9,$10) RETURNING id`,
    [int(b.site_id), int(b.company_id), clean(b.title, 200), clean(b.reference, 80), clean(b.revision, 20), b.received_on || null,
      req.file.originalname, req.file.mimetype, req.file.buffer, req.user.name])).rows[0];
  res.json({ id: row.id });
});

r.put('/rams/:id', edit, async (req, res) => {
  const b = req.body || {};
  const cur = (await q('SELECT * FROM rams WHERE id = $1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Not found.' });
  const status = RAMS_STATUSES.includes(b.status) ? b.status : cur.status;
  if (status === 'returned' && !clean(b.review_comments)) return res.status(400).json({ error: 'Add comments so the subcontractor knows what to change.' });
  const reviewed = status !== cur.status && ['accepted', 'returned'].includes(status);
  await q(`UPDATE rams SET title=$1, reference=$2, revision=$3, status=$4, review_comments=$5, review_due=$6,
           reviewed_by = CASE WHEN $7 THEN $8 ELSE reviewed_by END, reviewed_at = CASE WHEN $7 THEN NOW() ELSE reviewed_at END WHERE id=$9`,
    [clean(b.title, 200) || cur.title, clean(b.reference, 80), clean(b.revision, 20), status, clean(b.review_comments, 4000), b.review_due || null,
      reviewed, req.user.name, req.params.id]);
  res.json({ ok: true });
});

r.get('/rams/:id/file', view, async (req, res) => {
  const row = (await q('SELECT file_name, file_mime, file_data FROM rams WHERE id = $1', [req.params.id])).rows[0];
  if (!row || !row.file_data) return res.status(404).end();
  res.setHeader('Content-Type', row.file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${(row.file_name || 'rams').replace(/"/g, '')}"`);
  res.send(row.file_data);
});

r.get('/rams/:id/briefings', view, async (req, res) => {
  const rows = (await q(`SELECT b.confirmed_at, o.id AS operative_id, o.full_name FROM rams_briefings b JOIN operatives o ON o.id = b.operative_id
      WHERE b.rams_id = $1 ORDER BY b.confirmed_at DESC`, [req.params.id])).rows;
  res.json({ rows });
});

r.delete('/rams/:id', edit, async (req, res) => {
  await q('DELETE FROM rams WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- users ----------
r.get('/users', admin, async (req, res) => {
  res.json({ rows: (await q('SELECT id, name, email, role, active, created_at FROM users ORDER BY name')).rows });
});

r.post('/users', admin, async (req, res) => {
  const b = req.body || {};
  if (!clean(b.name) || !clean(b.email) || !b.password || b.password.length < 8) return res.status(400).json({ error: 'Enter a name, an email and a password of at least 8 characters.' });
  const role = ['admin', 'manager', 'viewer'].includes(b.role) ? b.role : 'manager';
  try {
    const row = (await q('INSERT INTO users (name, email, password_hash, role) VALUES ($1, LOWER($2), $3, $4) RETURNING id, name, email, role, active',
      [clean(b.name, 120), clean(b.email, 160), await hash(b.password), role])).rows[0];
    res.json({ row });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'There is already an account with that email.' });
    throw e;
  }
});

r.put('/users/:id', admin, async (req, res) => {
  const b = req.body || {};
  const role = ['admin', 'manager', 'viewer'].includes(b.role) ? b.role : null;
  if (Number(req.params.id) === req.user.id && (b.active === false || (role && role !== 'admin'))) return res.status(400).json({ error: 'You cannot remove your own admin access.' });
  await q('UPDATE users SET role = COALESCE($1, role), active = COALESCE($2, active) WHERE id = $3', [role, typeof b.active === 'boolean' ? b.active : null, req.params.id]);
  if (b.password) {
    if (b.password.length < 8) return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
    await q('UPDATE users SET password_hash = $1 WHERE id = $2', [await hash(b.password), req.params.id]);
  }
  res.json({ ok: true });
});

module.exports = r;
