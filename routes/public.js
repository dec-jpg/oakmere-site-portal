// Operative-facing API. Used by the site sign-in link (/s/CODE) and kiosk mode (/k/TOKEN).
const express = require('express');
const { q } = require('../lib/db');
const { distanceM, token, clean, normPhone, surname, validImage } = require('../lib/util');

const r = express.Router();

// ---------- helpers ----------
async function siteByCode(code) {
  return (await q('SELECT * FROM sites WHERE code = UPPER($1) AND active = TRUE', [code || ''])).rows[0];
}

async function kioskFor(req) {
  const t = req.get('x-kiosk-token');
  if (!t) return null;
  return (await q('SELECT k.*, s.code FROM kiosks k JOIN sites s ON s.id = k.site_id WHERE k.token = $1 AND k.revoked = FALSE AND s.active = TRUE', [t])).rows[0] || null;
}

async function operativeFor(req) {
  const t = req.get('x-op-token');
  if (!t) return null;
  return (await q(`SELECT o.*, c.name AS company_name FROM operatives o
                   LEFT JOIN companies c ON c.id = o.company_id WHERE o.device_token = $1`, [t])).rows[0] || null;
}

async function currentInduction() {
  return (await q("SELECT * FROM inductions WHERE status = 'published' ORDER BY published_at DESC LIMIT 1")).rows[0] || null;
}

async function pendingRams(op, siteId) {
  if (!op.company_id) return [];
  return (await q(`SELECT r.id, r.title, r.reference, r.revision FROM rams r
      WHERE r.site_id = $1 AND r.company_id = $2 AND r.status = 'accepted'
        AND NOT EXISTS (SELECT 1 FROM rams_briefings b WHERE b.rams_id = r.id AND b.operative_id = $3)
      ORDER BY r.title`, [siteId, op.company_id, op.id])).rows;
}

async function statusFor(op, site) {
  const ind = await currentInduction();
  const inducted = ind ? !!(await q('SELECT 1 FROM induction_records WHERE operative_id = $1 AND induction_id = $2', [op.id, ind.id])).rows[0] : true;
  const briefed = !!(await q('SELECT 1 FROM site_briefings WHERE operative_id = $1 AND site_id = $2', [op.id, site.id])).rows[0];
  const open = (await q(`SELECT a.id, a.in_at, a.site_id, s.name AS site_name, s.code AS site_code FROM attendance a
                         JOIN sites s ON s.id = a.site_id WHERE a.operative_id = $1 AND a.out_at IS NULL ORDER BY a.in_at DESC LIMIT 1`, [op.id])).rows[0] || null;
  return {
    operative: { id: op.id, full_name: op.full_name, company: op.company_name || op.company_other, trade: op.trade },
    induction_required: !inducted,
    briefing_required: !briefed,
    open_attendance: open,
    rams_pending: await pendingRams(op, site.id),
  };
}

async function refuse(op, site, action, reason, distance) {
  await q('INSERT INTO refusals (operative_id, site_id, action, reason, distance_m) VALUES ($1, $2, $3, $4, $5)',
    [op ? op.id : null, site ? site.id : null, action, reason, distance ?? null]);
}

// Resolves site and (optionally) kiosk for every request that names a site.
async function siteCtx(req, res) {
  const kiosk = await kioskFor(req);
  const code = (req.body && req.body.site) || req.query.site || req.params.code;
  const site = await siteByCode(code);
  if (!site) { res.status(404).json({ error: 'This site link is not active. Ask the site manager for the current link.' }); return null; }
  if (kiosk && kiosk.site_id !== site.id) { res.status(403).json({ error: 'This kiosk belongs to a different site.' }); return null; }
  return { site, kiosk };
}

// ---------- site & kiosk ----------
r.get('/kiosk/:token', async (req, res) => {
  const k = (await q('SELECT s.code FROM kiosks k JOIN sites s ON s.id = k.site_id WHERE k.token = $1 AND k.revoked = FALSE AND s.active = TRUE', [req.params.token])).rows[0];
  if (!k) return res.status(404).json({ error: 'This kiosk has been switched off. Ask the site manager to set it up again.' });
  res.json({ site: k.code });
});

r.get('/site/:code', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const { site } = ctx;
  const companies = (await q('SELECT id, name FROM companies WHERE active = TRUE ORDER BY LOWER(name)')).rows;
  const ind = await currentInduction();
  res.json({
    site: {
      code: site.code, name: site.name, address: site.address,
      geofenced: site.lat != null && site.lng != null, radius_m: site.radius_m,
      site_manager: site.site_manager, site_phone: site.site_phone, muster_point: site.muster_point,
      first_aid: site.first_aid, welfare: site.welfare, site_rules: site.site_rules,
    },
    companies,
    induction: ind ? {
      id: ind.id, title: ind.title, year: ind.year, intro: ind.intro, sections: ind.sections,
      questions: (ind.questions || []).map(x => ({ question: x.question, options: x.options })),
    } : null,
    kiosk: !!ctx.kiosk,
  });
});

// ---------- identity ----------
r.post('/register', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const b = req.body || {};
  const full_name = clean(b.full_name, 120);
  const phone = normPhone(b.phone);
  if (!full_name || full_name.split(/\s+/).length < 2) return res.status(400).json({ error: 'Enter your first name and surname.' });
  if (phone.length < 10) return res.status(400).json({ error: 'Enter a mobile number we can reach you on.' });
  let company_id = b.company_id ? parseInt(b.company_id, 10) : null;
  const company_other = company_id ? null : clean(b.company_other, 120);
  if (!company_id && !company_other) return res.status(400).json({ error: 'Choose the company you work for, or type it in.' });
  if (company_id && !(await q('SELECT 1 FROM companies WHERE id = $1 AND active = TRUE', [company_id])).rows[0]) company_id = null;

  // Same phone and surname means the same person on a new device.
  const existing = (await q('SELECT * FROM operatives WHERE phone = $1', [phone])).rows.find(o => surname(o.full_name) === surname(full_name));
  if (existing) {
    const t = existing.device_token || token();
    if (!existing.device_token) await q('UPDATE operatives SET device_token = $1 WHERE id = $2', [t, existing.id]);
    return res.json({ token: t, existing: true });
  }
  const t = token();
  await q(`INSERT INTO operatives (full_name, phone, company_id, company_other, trade, cscs_type, cscs_number, cscs_expiry, emergency_name, emergency_phone, device_token)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [full_name, phone, company_id, company_other, clean(b.trade, 80), clean(b.cscs_type, 60), clean(b.cscs_number, 40),
      b.cscs_expiry || null, clean(b.emergency_name, 120), normPhone(b.emergency_phone) || null, t]);
  res.json({ token: t, existing: false });
});

r.post('/lookup', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const phone = normPhone((req.body || {}).phone);
  const sn = surname((req.body || {}).surname);
  const op = (await q('SELECT * FROM operatives WHERE phone = $1', [phone])).rows.find(o => surname(o.full_name) === sn);
  if (!op) return res.status(404).json({ error: 'No one found with that mobile number and surname. Register as new instead.' });
  const t = op.device_token || token();
  if (!op.device_token) await q('UPDATE operatives SET device_token = $1 WHERE id = $2', [t, op.id]);
  res.json({ token: t });
});

r.get('/status', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const op = await operativeFor(req);
  if (!op) return res.status(401).json({ error: 'not_registered' });
  res.json(await statusFor(op, ctx.site));
});

// ---------- induction & briefing ----------
r.post('/induction', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const op = await operativeFor(req);
  if (!op) return res.status(401).json({ error: 'not_registered' });
  const ind = await currentInduction();
  if (!ind) return res.json({ ok: true });
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const wrong = (ind.questions || []).map((x, i) => (Number(answers[i]) === Number(x.answer) ? null : i)).filter(i => i !== null);
  if (wrong.length) return res.json({ ok: false, wrong });
  if (!validImage(req.body.signature, 400_000)) return res.status(400).json({ error: 'Sign in the box to confirm.' });
  await q(`INSERT INTO induction_records (operative_id, induction_id, site_id, signature, attempts) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (operative_id, induction_id) DO NOTHING`,
    [op.id, ind.id, ctx.site.id, req.body.signature, Math.max(1, parseInt(req.body.attempts, 10) || 1)]);
  res.json({ ok: true });
});

r.post('/briefing', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const op = await operativeFor(req);
  if (!op) return res.status(401).json({ error: 'not_registered' });
  await q('INSERT INTO site_briefings (operative_id, site_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [op.id, ctx.site.id]);
  res.json({ ok: true });
});

// An operative can open their own company's accepted RAMS for the site.
r.get('/rams/:id', async (req, res) => {
  const t = req.query.t;
  const op = t ? (await q('SELECT * FROM operatives WHERE device_token = $1', [t])).rows[0] : null;
  if (!op) return res.status(401).send('Open this from the sign-in page.');
  const row = (await q("SELECT file_name, file_mime, file_data FROM rams WHERE id = $1 AND company_id = $2 AND status = 'accepted'", [req.params.id, op.company_id])).rows[0];
  if (!row || !row.file_data) return res.status(404).send('Document not available.');
  res.setHeader('Content-Type', row.file_mime || 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${(row.file_name || 'rams.pdf').replace(/"/g, '')}"`);
  res.send(row.file_data);
});

// ---------- sign in / out ----------
r.post('/signin', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const { site, kiosk } = ctx;
  const op = await operativeFor(req);
  if (!op) return res.status(401).json({ error: 'not_registered' });
  const b = req.body || {};
  const st = await statusFor(op, site);

  if (st.induction_required) { await refuse(op, site, 'sign-in', 'Induction not completed'); return res.status(400).json({ error: 'Complete the site induction first.' }); }
  if (st.briefing_required) return res.status(400).json({ error: 'Read and confirm the site information first.' });
  if (st.open_attendance) {
    const where = st.open_attendance.site_id === site.id ? 'here' : `at ${st.open_attendance.site_name}`;
    return res.status(400).json({ error: `You are already signed in ${where}. Sign out first.` });
  }
  const confirmed = new Set((b.rams_ids || []).map(Number));
  const missing = st.rams_pending.filter(x => !confirmed.has(x.id));
  if (missing.length) return res.status(400).json({ error: 'Confirm you have been briefed on each RAMS listed.' });
  if (!validImage(b.photo)) { await refuse(op, site, 'sign-in', 'No photo taken'); return res.status(400).json({ error: 'Take a photo to sign in.' }); }

  let dist = null;
  if (!kiosk && site.lat != null && site.lng != null) {
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!isFinite(lat) || !isFinite(lng)) {
      await refuse(op, site, 'sign-in', 'Location not shared');
      return res.status(400).json({ error: 'Your location is needed to sign in. Allow location for this page and try again.' });
    }
    dist = distanceM(lat, lng, site.lat, site.lng);
    if (dist > site.radius_m) {
      await refuse(op, site, 'sign-in', 'Outside site boundary', dist);
      return res.status(400).json({ error: `You appear to be ${dist} m from site. You need to be on site to sign in.` });
    }
  }

  for (const x of st.rams_pending) await q('INSERT INTO rams_briefings (rams_id, operative_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [x.id, op.id]);
  const a = (await q(`INSERT INTO attendance (operative_id, site_id, company_name, method, in_lat, in_lng, in_distance_m, in_photo, in_note)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING in_at`,
    [op.id, site.id, op.company_name || op.company_other, kiosk ? 'kiosk' : 'mobile', kiosk ? null : Number(b.lat) || null,
      kiosk ? null : Number(b.lng) || null, dist, b.photo, clean(b.note, 500)])).rows[0];
  res.json({ ok: true, in_at: a.in_at });
});

r.post('/signout', async (req, res) => {
  const ctx = await siteCtx(req, res); if (!ctx) return;
  const { site, kiosk } = ctx;
  const op = await operativeFor(req);
  if (!op) return res.status(401).json({ error: 'not_registered' });
  const b = req.body || {};
  const open = (await q('SELECT * FROM attendance WHERE operative_id = $1 AND site_id = $2 AND out_at IS NULL ORDER BY in_at DESC LIMIT 1', [op.id, site.id])).rows[0];
  if (!open) return res.status(400).json({ error: 'You are not signed in at this site.' });
  if (!validImage(b.photo)) { await refuse(op, site, 'sign-out', 'No photo taken'); return res.status(400).json({ error: 'Take a photo to sign out.' }); }
  let dist = null;
  if (!kiosk && site.lat != null && isFinite(Number(b.lat)) && isFinite(Number(b.lng)) && b.lat != null) dist = distanceM(Number(b.lat), Number(b.lng), site.lat, site.lng);
  const a = (await q(`UPDATE attendance SET out_at = NOW(), out_lat = $2, out_lng = $3, out_distance_m = $4, out_photo = $5, out_note = $6
                      WHERE id = $1 RETURNING in_at, out_at`,
    [open.id, kiosk ? null : Number(b.lat) || null, kiosk ? null : Number(b.lng) || null, dist, b.photo, clean(b.note, 500)])).rows[0];
  res.json({ ok: true, in_at: a.in_at, out_at: a.out_at });
});

module.exports = r;
