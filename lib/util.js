const crypto = require('crypto');

// Great-circle distance in metres.
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? null : String(v).trim().slice(0, max)) || null;

const normPhone = p => (p || '').replace(/[^\d+]/g, '').replace(/^\+44/, '0');

const surname = n => (n || '').trim().split(/\s+/).pop().toLowerCase();

// Photos and signatures arrive as data URLs from the browser.
function validImage(d, maxBytes = 1_500_000) {
  return typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(d) && d.length <= maxBytes * 1.37;
}

function csv(rows, cols) {
  const esc = v => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(c => esc(c.label)).join(','), ...rows.map(r => cols.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
}

const londonFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const london = d => (d ? londonFmt.format(new Date(d)).replace(',', '') : '');

module.exports = { distanceM, token, clean, normPhone, surname, validImage, csv, london };
