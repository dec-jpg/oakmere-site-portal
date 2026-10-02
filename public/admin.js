// Oakmere site portal: staff side.
(() => {
  const root = document.getElementById('root');
  const dlg = document.getElementById('dlg');
  let me = null;
  let cache = { sites: null, companies: null };
  let refreshTimer = null;

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tz = { timeZone: 'Europe/London' };
  const fDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { ...tz, day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const fTime = d => (d ? new Date(d).toLocaleTimeString('en-GB', { ...tz, hour: '2-digit', minute: '2-digit' }) : '');
  const fDT = d => (d ? `${fDate(d)} ${fTime(d)}` : '');
  const dateOnly = d => (d ? String(d).slice(0, 10) : '');
  const todayISO = () => new Date().toLocaleDateString('en-CA', tz);
  const daysAgoISO = n => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', tz);
  const canEdit = () => me && me.role !== 'viewer';
  const STATUS = { received: 'Received', under_review: 'Under review', accepted: 'Accepted', returned: 'Returned' };
  const statusPill = s => `<span class="pill ${s}">${STATUS[s] || s}</span>`;

  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'), headers: {} };
    if (opts.form) init.body = opts.form;
    else if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const res = await fetch(path.startsWith('/api') ? path : '/api/admin' + path, init);
    let data = {};
    try { data = await res.json(); } catch { /* not json */ }
    if (res.status === 401 && !path.startsWith('/api/auth')) { me = null; showLogin(); throw new Error('Log in to continue.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  async function sites(force) { if (!cache.sites || force) cache.sites = (await api('/sites')).rows; return cache.sites; }
  async function companies(force) { if (!cache.companies || force) cache.companies = (await api('/companies')).rows; return cache.companies; }
  const opt = (rows, sel, label = 'name') => rows.map(r => `<option value="${r.id}" ${String(sel) === String(r.id) ? 'selected' : ''}>${esc(r[label])}</option>`).join('');

  function main() { return document.getElementById('main'); }
  function setMain(html) { main().innerHTML = html; }
  function flash(msg, kind = 'ok', el) {
    const host = el || main();
    const n = document.createElement('div'); n.className = `note ${kind}`; n.textContent = msg;
    host.prepend(n); setTimeout(() => n.remove(), kind === 'err' ? 7000 : 3500);
  }
  function dlgErr(msg) {
    let n = dlg.querySelector('.dlg-body .note.err');
    if (!n) { n = document.createElement('div'); n.className = 'note err'; dlg.querySelector('.dlg-body').prepend(n); }
    n.textContent = msg; n.scrollIntoView({ block: 'nearest' });
  }
  function openDlg(title, body, foot = '') {
    dlg.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button class="btn quiet" data-close aria-label="Close">Close</button></div>
      <div class="dlg-body">${body}</div>${foot ? `<div class="dlg-foot">${foot}</div>` : ''}`;
    dlg.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => dlg.close()));
    if (!dlg.open) dlg.showModal();
    return dlg;
  }
  const $d = sel => dlg.querySelector(sel);
  const val = sel => { const el = $d(sel); return el ? el.value : null; };
  function busy(btn, on) { if (!btn) return; btn.disabled = on; }
  function photo(id, which) {
    openDlg(which === 'out' ? 'Sign-out photo' : 'Sign-in photo', `<img class="photo-full" src="/api/admin/attendance/${id}/photo/${which}" alt="">`);
  }
  window.oakPhoto = photo;

  // ---------- login ----------
  async function boot() {
    const s = await api('/api/auth/state');
    if (s.user) { me = s.user; return shell(); }
    showLogin(s);
  }

  async function showLogin(state) {
    clearInterval(refreshTimer);
    const s = state || await api('/api/auth/state');
    if (s.needsSetup) {
      root.innerHTML = `<div class="login-wrap"><div class="login-card"><img src="/logo.svg" alt="Oakmere">
        <h1>Set up the portal</h1>
        ${s.setupEnabled ? `<p class="muted">Create the first admin account. You can add everyone else from inside the portal.</p>
          <div id="msg"></div>
          <div class="field"><label for="k">Setup key</label><input id="k" type="password"></div>
          <div class="field"><label for="n">Your name</label><input id="n" type="text" autocomplete="name"></div>
          <div class="field"><label for="e">Email</label><input id="e" type="email" autocomplete="email"></div>
          <div class="field"><label for="p">Password <span class="hint">at least 8 characters</span></label><input id="p" type="password" autocomplete="new-password"></div>
          <button class="btn big" id="go">Create admin account</button>`
          : '<div class="note warn">Add a SETUP_KEY variable to this service on Railway, redeploy, then reload this page.</div>'}
        </div></div>`;
      const go = document.getElementById('go');
      if (go) go.onclick = async () => {
        try {
          const r = await api('/api/auth/setup', { body: { setup_key: v('k'), name: v('n'), email: v('e'), password: v('p') } });
          me = r.user; shell();
        } catch (e) { document.getElementById('msg').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
      };
      return;
    }
    root.innerHTML = `<div class="login-wrap"><div class="login-card"><img src="/logo.svg" alt="Oakmere">
      <h1>Log in</h1><div id="msg"></div>
      <div class="field"><label for="e">Email</label><input id="e" type="email" autocomplete="username"></div>
      <div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password"></div>
      <button class="btn big" id="go">Log in</button></div></div>`;
    const go = async () => {
      try { const r = await api('/api/auth/login', { body: { email: v('e'), password: v('p') } }); me = r.user; shell(); }
      catch (e) { document.getElementById('msg').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
    };
    document.getElementById('go').onclick = go;
    document.getElementById('p').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  const v = id => document.getElementById(id).value;

  // ---------- shell & routing ----------
  const NAV = [
    ['', 'Dashboard'], ['onsite', 'On site now'], ['attendance', 'Attendance'], ['rams', 'RAMS register'],
    ['operatives', 'Operatives'], ['companies', 'Subcontractors'], ['sites', 'Sites'], ['induction', 'Induction'], ['users', 'Users', 'admin'],
  ];

  function shell() {
    root.innerHTML = `<div class="ad-shell"><nav class="ad-nav" aria-label="Main">
      <img src="/logo.svg" alt="Oakmere">
      ${NAV.filter(n => !n[2] || me.role === 'admin').map(([k, l]) => `<a href="#/${k}" data-nav="${k}">${l}<span class="count hidden" data-count="${k}"></span></a>`).join('')}
      <div class="foot"><b>${esc(me.name)}</b><span>${esc(me.role === 'admin' ? 'Admin' : me.role === 'viewer' ? 'View only' : 'Manager')}</span><br>
        <button id="pw">Change password</button><button id="lo">Log out</button></div>
      </nav><main class="ad-main" id="main"></main></div>`;
    document.getElementById('lo').onclick = async () => { await api('/api/auth/logout', { body: {} }); me = null; showLogin(); };
    document.getElementById('pw').onclick = changePassword;
    window.onhashchange = route;
    route();
  }

  function route() {
    clearInterval(refreshTimer);
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const params = new URLSearchParams(qs || '');
    const [view, id] = path.split('/');
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === (view || '')));
    const views = { '': dashboard, onsite, attendance, rams, operatives, companies: companiesView, sites: sitesView, induction, users };
    setMain('<p class="muted">Loading</p>');
    (views[view] || dashboard)(params, id).catch(e => setMain(`<div class="note err">${esc(e.message)}</div>`));
    updateCounts();
  }

  async function updateCounts() {
    try {
      const d = await api('/dashboard');
      const el = document.querySelector('[data-count=rams]');
      if (el) { el.textContent = d.rams.to_review; el.classList.toggle('hidden', !d.rams.to_review); }
    } catch { /* ignore */ }
  }

  function changePassword() {
    openDlg('Change password', `<div class="field"><label>Current password</label><input id="c" type="password" autocomplete="current-password"></div>
      <div class="field"><label>New password <span class="hint">at least 8 characters</span></label><input id="n" type="password" autocomplete="new-password"></div>`,
    '<button class="btn" id="save">Change password</button>');
    $d('#save').onclick = async () => {
      try { await api('/api/auth/password', { body: { current: val('#c'), next: val('#n') } }); dlg.close(); flash('Password changed.'); }
      catch (e) { dlgErr(e.message); }
    };
  }

  // ---------- dashboard ----------
  async function dashboard() {
    const d = await api('/dashboard');
    const total = d.sites.reduce((a, s) => a + s.on_site, 0);
    if (!d.sites.length) {
      return setMain(`<div class="ad-head"><div><h1>Welcome to the site portal</h1><p class="muted">Three things to set up, then you're ready to go live.</p></div></div>
        <div class="flags">
          <a class="flag" href="#/sites"><span><b>Add your sites</b><br><span class="small muted">Each site gets its own sign-in link and QR poster.</span></span><span class="btn small">Add a site</span></a>
          <a class="flag" href="#/companies"><span><b>Add your subcontractors</b><br><span class="small muted">They appear in the drop-down when operatives register.</span></span><span class="btn small">Add subcontractors</span></a>
          <a class="flag ${d.induction ? 'green' : ''}" href="#/induction"><span><b>${d.induction ? 'Induction published' : 'Load this year\'s induction'}</b><br><span class="small muted">${d.induction ? esc(d.induction.title) : 'Everyone completes it before their first sign-in.'}</span></span><span class="btn small ghost">Open</span></a>
        </div>`);
    }
    const flags = [];
    if (!d.induction) flags.push(['red', 'No induction is published, so operatives can sign in without one.', '#/induction', 'Set up induction']);
    if (d.rams.to_review) flags.push(['', `${d.rams.to_review} RAMS waiting for review.`, '#/rams?status=received', 'Review']);
    if (d.rams.overdue) flags.push(['', `${d.rams.overdue} accepted RAMS ${d.rams.overdue === 1 ? 'is' : 'are'} past the review date.`, '#/rams?status=accepted', 'View']);
    if (d.rams.returned) flags.push(['', `${d.rams.returned} RAMS returned to subcontractors and waiting for a new version.`, '#/rams?status=returned', 'View']);
    d.gaps.forEach(g => flags.push(['red', `${g.company} signed in at ${g.site_name} today with no accepted RAMS for that site.`, `#/rams?site=${g.site_id}${g.company_id ? '&company=' + g.company_id : ''}`, 'Check']));
    if (d.unmatched) flags.push(['', `${d.unmatched} ${d.unmatched === 1 ? 'operative' : 'operatives'} registered with a company that is not on your list.`, '#/operatives?unmatched=1', 'Sort out']);
    if (d.refusals_today) flags.push(['', `${d.refusals_today} ${d.refusals_today === 1 ? 'sign-in attempt' : 'sign-in attempts'} refused today.`, '#/attendance?tab=refusals', 'View']);

    setMain(`<div class="ad-head"><div><h1>${total} on site now</h1><p class="muted">${new Date().toLocaleDateString('en-GB', { ...tz, weekday: 'long', day: 'numeric', month: 'long' })}${d.induction ? `, ${esc(d.induction.title)} live` : ''}</p></div>
        <a class="btn ghost" href="#/onsite">Fire roll</a></div>
      <div class="roll">${d.sites.map(s => `<button class="roll-site" data-site="${s.id}"><span><span class="name">${esc(s.name)}</span><br><span class="sub">${s.today} signed in today</span></span>
        <span class="n ${s.on_site ? '' : 'zero'}">${s.on_site}</span></button>`).join('')}</div>
      <h2>Needs attention</h2>
      ${flags.length ? `<div class="flags">${flags.map(f => `<div class="flag ${f[0]}"><span>${esc(f[1])}</span><a class="btn small ghost" href="${f[2]}">${f[3]}</a></div>`).join('')}</div>`
                     : '<div class="flags"><div class="flag green"><span>Nothing outstanding.</span></div></div>'}`);
    main().querySelectorAll('[data-site]').forEach(b => (b.onclick = () => (location.hash = `#/onsite?site=${b.dataset.site}`)));
    refreshTimer = setInterval(() => { if (!dlg.open && location.hash.replace(/^#\/?/, '') === '') dashboard(); }, 60000);
  }

  // ---------- on site now / fire roll ----------
  async function onsite(params) {
    const all = await sites();
    const siteId = params.get('site') || '';
    const d = await api('/onsite' + (siteId ? `?site=${siteId}` : ''));
    const bySite = {};
    d.rows.forEach(r => (bySite[r.site_name] = bySite[r.site_name] || []).push(r));
    setMain(`<div class="ad-head"><div><h1>On site now</h1><p class="muted">${d.rows.length} people, as at ${fTime(new Date())}. Use this as the fire roll.</p></div>
        <div class="toolbar no-print" style="margin:0"><div class="field"><label for="fs">Site</label><select id="fs"><option value="">All sites</option>${opt(all.filter(s => s.active), siteId)}</select></div>
        <button class="btn ghost" onclick="window.print()">Print</button></div></div>
      ${!d.rows.length ? '<div class="tablewrap"><div class="empty"><b>Nobody is signed in.</b>People appear here as soon as they sign in.</div></div>' : ''}
      ${Object.entries(bySite).map(([name, rows]) => `<h2>${esc(name)} <span class="muted">(${rows.length})</span></h2>
        <div class="tablewrap"><table><thead><tr><th></th><th>Name</th><th>Company</th><th>Trade</th><th>Phone</th><th>Signed in</th><th class="no-print"></th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${r.has_photo ? `<img class="thumb" loading="lazy" src="/api/admin/attendance/${r.id}/photo/in" alt="" onclick="oakPhoto(${r.id},'in')">` : ''}</td>
          <td><a href="#/operatives?id=${r.operative_id}">${esc(r.full_name)}</a>${r.in_note ? `<br><span class="small muted">${esc(r.in_note)}</span>` : ''}</td>
          <td>${esc(r.company || '')}</td><td>${esc(r.trade || '')}</td><td>${esc(r.phone)}</td><td>${fTime(r.in_at)}${r.method === 'kiosk' ? ' <span class="pill grey">kiosk</span>' : ''}</td>
          <td class="no-print">${canEdit() ? `<button class="btn small ghost" data-close-att="${r.id}" data-name="${esc(r.full_name)}">Sign out</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>`).join('')}`);
    document.getElementById('fs').onchange = e => (location.hash = '#/onsite' + (e.target.value ? `?site=${e.target.value}` : ''));
    main().querySelectorAll('[data-close-att]').forEach(b => (b.onclick = async () => {
      if (!confirm(`Sign out ${b.dataset.name}? This is recorded as signed out by you.`)) return;
      await api(`/attendance/${b.dataset.closeAtt}/close`, { body: {} }); onsite(params);
    }));
    refreshTimer = setInterval(() => { if (!dlg.open && location.hash.startsWith('#/onsite')) onsite(params); }, 30000);
  }

  // ---------- attendance ----------
  async function attendance(params) {
    const tab = params.get('tab') || 'register';
    const [all, cos] = await Promise.all([sites(), companies()]);
    const f = { from: params.get('from') || daysAgoISO(6), to: params.get('to') || todayISO(), site: params.get('site') || '', company: params.get('company') || '' };
    const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x)).toString();
    const head = `<div class="ad-head"><div><h1>Attendance</h1></div></div>
      <div class="tabs"><button data-tab="register" class="${tab === 'register' ? 'on' : ''}">Sign-in register</button><button data-tab="refusals" class="${tab === 'refusals' ? 'on' : ''}">Refused attempts</button></div>`;
    if (tab === 'refusals') {
      const d = await api('/refusals');
      setMain(head + `<p class="muted">Attempts the portal turned away, for example outside the site boundary or without a photo. Latest 300.</p>
        <div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>When</th><th>Name</th><th>Company</th><th>Site</th><th>Action</th><th>Reason</th><th>Distance</th></tr></thead><tbody>
        ${d.rows.map(r => `<tr><td>${fDT(r.at)}</td><td>${esc(r.full_name || '')}</td><td>${esc(r.company || '')}</td><td>${esc(r.site_name || '')}</td><td>${esc(r.action)}</td><td>${esc(r.reason)}</td><td>${r.distance_m != null ? r.distance_m + ' m' : ''}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty"><b>No refused attempts.</b></div>'}</div>`);
    } else {
      const d = await api('/attendance?' + qs);
      const hrs = r => (r.out_at ? ((new Date(r.out_at) - new Date(r.in_at)) / 36e5).toFixed(1) : '');
      setMain(head + `<div class="toolbar">
        <div class="field"><label>From</label><input type="date" id="ff" value="${f.from}"></div>
        <div class="field"><label>To</label><input type="date" id="ft" value="${f.to}"></div>
        <div class="field"><label>Site</label><select id="fsi"><option value="">All sites</option>${opt(all, f.site)}</select></div>
        <div class="field"><label>Subcontractor</label><select id="fc"><option value="">All</option>${opt(cos, f.company)}</select></div>
        <button class="btn" id="apply">Show</button><a class="btn ghost" href="/api/admin/attendance.csv?${qs}">Download CSV</a></div>
        <div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>Date</th><th>Name</th><th>Company</th><th>Site</th><th>In</th><th>Out</th><th>Hours</th><th>Photos</th><th>Notes</th></tr></thead><tbody>
        ${d.rows.map(r => `<tr><td>${fDate(r.in_at)}</td><td><a href="#/operatives?id=${r.operative_id}">${esc(r.full_name)}</a></td><td>${esc(r.company || '')}</td><td>${esc(r.site_name)}</td>
          <td>${fTime(r.in_at)}${r.in_distance_m != null ? `<br><span class="small muted">${r.in_distance_m} m</span>` : ''}</td>
          <td>${r.out_at ? fTime(r.out_at) : '<span class="pill yes">on site</span>'}${r.auto_closed ? '<br><span class="pill no">not signed out</span>' : ''}</td>
          <td>${hrs(r)}</td>
          <td style="display:flex;gap:.3rem">${r.has_in_photo ? `<img class="thumb" loading="lazy" src="/api/admin/attendance/${r.id}/photo/in" alt="In" onclick="oakPhoto(${r.id},'in')">` : ''}${r.has_out_photo ? `<img class="thumb" loading="lazy" src="/api/admin/attendance/${r.id}/photo/out" alt="Out" onclick="oakPhoto(${r.id},'out')">` : ''}</td>
          <td class="small">${esc([r.in_note, r.out_note].filter(Boolean).join(' / '))}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty"><b>No sign-ins for these dates.</b>Change the dates or filters above.</div>'}</div>`);
      document.getElementById('apply').onclick = () => {
        const p = new URLSearchParams({ from: v('ff'), to: v('ft') });
        if (v('fsi')) p.set('site', v('fsi')); if (v('fc')) p.set('company', v('fc'));
        location.hash = '#/attendance?' + p;
      };
    }
    main().querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => (location.hash = '#/attendance?tab=' + b.dataset.tab)));
  }

  // ---------- RAMS register ----------
  async function rams(params) {
    const [all, cos] = await Promise.all([sites(), companies()]);
    const f = { site: params.get('site') || '', company: params.get('company') || '', status: params.get('status') || '' };
    const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x)).toString();
    const d = await api('/rams?' + qs);
    setMain(`<div class="ad-head"><div><h1>RAMS register</h1><p class="muted">Subcontractor RAMS received for each site, and where each one is up to.</p></div>
        ${canEdit() ? '<button class="btn" id="add">Add RAMS</button>' : ''}</div>
      <div class="toolbar">
        <div class="field"><label>Site</label><select id="fs"><option value="">All sites</option>${opt(all, f.site)}</select></div>
        <div class="field"><label>Subcontractor</label><select id="fc"><option value="">All</option>${opt(cos, f.company)}</select></div>
        <div class="field"><label>Status</label><select id="fst"><option value="">Any status</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>RAMS</th><th>Subcontractor</th><th>Site</th><th>Received</th><th>Status</th><th>Review due</th><th>Briefed</th></tr></thead><tbody>
        ${d.rows.map(r => {
          const overdue = r.status === 'accepted' && r.review_due && r.review_due.slice(0, 10) < todayISO();
          return `<tr class="click" data-id="${r.id}"><td><b>${esc(r.title)}</b>${r.reference || r.revision ? `<br><span class="small muted">${esc([r.reference, r.revision && 'rev ' + r.revision].filter(Boolean).join(', '))}</span>` : ''}</td>
          <td>${esc(r.company)}</td><td>${esc(r.site_name)}</td><td>${fDate(r.received_on)}</td><td>${statusPill(r.status)}</td>
          <td>${r.review_due ? `<span class="${overdue ? 'pill no' : ''}">${fDate(r.review_due)}</span>` : ''}</td><td>${r.status === 'accepted' ? r.briefed : ''}</td></tr>`;
        }).join('')}</tbody></table>`
        : `<div class="empty"><b>No RAMS ${qs ? 'match these filters' : 'on the register yet'}.</b>${qs ? '' : 'When a subcontractor sends RAMS in, add them here against the site they cover.'}</div>`}</div>`);
    const go = () => {
      const p = new URLSearchParams();
      if (v('fs')) p.set('site', v('fs')); if (v('fc')) p.set('company', v('fc')); if (v('fst')) p.set('status', v('fst'));
      location.hash = '#/rams' + (p.toString() ? '?' + p : '');
    };
    ['fs', 'fc', 'fst'].forEach(id => (document.getElementById(id).onchange = go));
    const add = document.getElementById('add');
    if (add) add.onclick = () => ramsAdd(all, cos, f, () => rams(params));
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => ramsOpen(d.rows.find(r => String(r.id) === tr.dataset.id), () => rams(params))));
  }

  function ramsAdd(all, cos, f, done) {
    if (!all.length || !cos.length) return flash('Add at least one site and one subcontractor first.', 'warn');
    openDlg('Add RAMS', `
      <div class="row"><div class="field"><label>Site</label><select id="s">${opt(all.filter(s => s.active), f.site)}</select></div>
        <div class="field"><label>Subcontractor</label><select id="c">${opt(cos.filter(c => c.active), f.company)}</select></div></div>
      <div class="field"><label>Title</label><input id="t" type="text" placeholder="For example, Brickwork and blockwork to plots 1 to 20"></div>
      <div class="row"><div class="field"><label>Their reference <span class="hint">optional</span></label><input id="rf" type="text"></div>
        <div class="field"><label>Revision <span class="hint">optional</span></label><input id="rv" type="text"></div>
        <div class="field"><label>Received</label><input id="rd" type="date" value="${todayISO()}"></div></div>
      <div class="field"><label>Document <span class="hint">PDF or Word, up to 20 MB</span></label><input id="fl" type="file" accept=".pdf,.doc,.docx,application/pdf"></div>`,
    '<button class="btn" id="save">Add to register</button>');
    $d('#save').onclick = async ev => {
      const fd = new FormData();
      fd.append('site_id', val('#s')); fd.append('company_id', val('#c')); fd.append('title', val('#t'));
      fd.append('reference', val('#rf')); fd.append('revision', val('#rv')); fd.append('received_on', val('#rd'));
      if ($d('#fl').files[0]) fd.append('file', $d('#fl').files[0]);
      busy(ev.target, true);
      try { await api('/rams', { form: fd }); dlg.close(); cache.companies = null; done(); flash('RAMS added. It is marked as received, ready for review.'); }
      catch (e) { busy(ev.target, false); dlgErr(e.message); }
    };
  }

  async function ramsOpen(r, done) {
    const b = (await api(`/rams/${r.id}/briefings`)).rows;
    const ro = !canEdit();
    openDlg(r.title, `
      <p><b>${esc(r.company)}</b>, ${esc(r.site_name)}<br><span class="muted small">Received ${fDate(r.received_on)}${r.uploaded_by ? `, added by ${esc(r.uploaded_by)}` : ''}${r.reviewed_by ? `. Last reviewed by ${esc(r.reviewed_by)} on ${fDate(r.reviewed_at)}` : ''}</span></p>
      <p><a class="btn ghost small" href="/api/admin/rams/${r.id}/file" target="_blank" rel="noopener">Open document</a> <a class="btn quiet small" href="/api/admin/rams/${r.id}/file?download=1">Download</a></p>
      <div class="field"><label>Title</label><input id="t" type="text" value="${esc(r.title)}" ${ro ? 'disabled' : ''}></div>
      <div class="row"><div class="field"><label>Reference</label><input id="rf" type="text" value="${esc(r.reference || '')}" ${ro ? 'disabled' : ''}></div>
        <div class="field"><label>Revision</label><input id="rv" type="text" value="${esc(r.revision || '')}" ${ro ? 'disabled' : ''}></div></div>
      <div class="row"><div class="field"><label>Status</label><select id="st" ${ro ? 'disabled' : ''}>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Review due</label><input id="rd" type="date" value="${dateOnly(r.review_due)}" ${ro ? 'disabled' : ''}></div></div>
      <div class="field"><label>Review comments <span class="hint">required when returning RAMS to the subcontractor</span></label><textarea id="cm" ${ro ? 'disabled' : ''}>${esc(r.review_comments || '')}</textarea></div>
      <p class="small muted">Once accepted, operatives from ${esc(r.company)} confirm they have been briefed on this RAMS when they next sign in at ${esc(r.site_name)}.</p>
      <h3>Briefing confirmations (${b.length})</h3>
      ${b.length ? `<div class="tablewrap"><table><tbody>${b.map(x => `<tr><td>${esc(x.full_name)}</td><td>${fDT(x.confirmed_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">None yet.</p>'}`,
    ro ? '' : '<button class="btn quiet left" id="del" style="color:var(--brick)">Remove from register</button><button class="btn" id="save">Save</button>');
    if (ro) return;
    $d('#save').onclick = async () => {
      try {
        await api(`/rams/${r.id}`, { method: 'PUT', body: { title: val('#t'), reference: val('#rf'), revision: val('#rv'), status: val('#st'), review_due: val('#rd') || null, review_comments: val('#cm') } });
        dlg.close(); done(); updateCounts(); flash('RAMS updated.');
      } catch (e) { dlgErr(e.message); }
    };
    $d('#del').onclick = async () => {
      if (!confirm('Remove this RAMS and its briefing records from the register?')) return;
      await api(`/rams/${r.id}`, { method: 'DELETE' }); dlg.close(); done(); updateCounts();
    };
  }

  // ---------- operatives ----------
  async function operatives(params) {
    if (params.get('id')) {
      const p = new URLSearchParams(params); p.delete('id');
      operativeOpen(params.get('id'), () => (location.hash = '#/operatives' + (p.toString() ? '?' + p : '')));
    }
    const cos = await companies();
    const search = params.get('search') || '', company = params.get('company') || '', unmatched = params.get('unmatched') || '';
    const p = new URLSearchParams(); if (search) p.set('search', search); if (company) p.set('company', company); if (unmatched) p.set('unmatched', '1');
    const d = await api('/operatives?' + p);
    const expired = x => x.cscs_expiry && x.cscs_expiry.slice(0, 10) < todayISO();
    setMain(`<div class="ad-head"><div><h1>Operatives</h1><p class="muted">Everyone who has registered on any site.</p></div></div>
      <div class="toolbar">
        <div class="field" style="min-width:240px"><label>Search</label><input type="search" id="fq" value="${esc(search)}" placeholder="Name, phone or company"></div>
        <div class="field"><label>Subcontractor</label><select id="fc"><option value="">All</option>${opt(cos, company)}</select></div>
        <label class="check" style="align-self:end"><input type="checkbox" id="fu" ${unmatched ? 'checked' : ''}> Company not on list</label>
      </div>
      <div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>Name</th><th>Company</th><th>Trade</th><th>Card</th><th>Induction</th><th>Last on site</th></tr></thead><tbody>
        ${d.rows.map(o => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.full_name)}</b>${o.on_site ? ' <span class="pill yes">on site</span>' : ''}<br><span class="small muted">${esc(o.phone)}</span></td>
          <td>${esc(o.company || '')}${!o.company_id ? ' <span class="pill no">not on list</span>' : ''}</td><td>${esc(o.trade || '')}</td>
          <td class="small">${esc(o.cscs_type || '')}${o.cscs_expiry ? `<br><span class="${expired(o) ? 'pill no' : 'muted'}">${expired(o) ? 'Expired ' : 'Expires '}${fDate(o.cscs_expiry)}</span>` : ''}</td>
          <td>${o.inducted ? '<span class="pill yes">Current</span>' : '<span class="pill grey">Due</span>'}</td><td>${fDT(o.last_seen)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty"><b>${p.toString() ? 'Nobody matches.' : 'Nobody has registered yet.'}</b>${p.toString() ? '' : 'Operatives register themselves the first time they scan a site QR code.'}</div>`}</div>`);
    let t;
    const go = () => {
      const n = new URLSearchParams(); if (v('fq')) n.set('search', v('fq')); if (v('fc')) n.set('company', v('fc')); if (document.getElementById('fu').checked) n.set('unmatched', '1');
      location.hash = '#/operatives' + (n.toString() ? '?' + n : '');
    };
    document.getElementById('fq').oninput = () => { clearTimeout(t); t = setTimeout(go, 450); };
    document.getElementById('fc').onchange = go; document.getElementById('fu').onchange = go;
    const fq = document.getElementById('fq'); if (search) { fq.focus(); fq.setSelectionRange(search.length, search.length); }
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => operativeOpen(tr.dataset.id, () => operatives(params))));
  }

  async function operativeOpen(id, done) {
    const [d, cos] = await Promise.all([api('/operatives/' + id), companies()]);
    const o = d.operative, ro = !canEdit();
    openDlg(o.full_name, `
      <div class="tabs"><button data-t="det" class="on">Details</button><button data-t="att">Attendance (${d.attendance.length})</button><button data-t="ind">Inductions (${d.inductions.length})</button><button data-t="rams">RAMS briefings (${d.rams.length})</button></div>
      <div data-p="det">
        ${!o.company_id ? `<div class="note warn">Registered as working for "${esc(o.company_other || 'unknown')}", which is not on your subcontractor list. Pick the right company below, or add it under Subcontractors first.</div>` : ''}
        <div class="row"><div class="field"><label>Full name</label><input id="fn" value="${esc(o.full_name)}" ${ro ? 'disabled' : ''}></div>
          <div class="field"><label>Mobile</label><input id="ph" value="${esc(o.phone)}" ${ro ? 'disabled' : ''}></div></div>
        <div class="row"><div class="field"><label>Company</label><select id="co" ${ro ? 'disabled' : ''}><option value="">Not on list</option>${opt(cos, o.company_id)}</select></div>
          <div class="field"><label>Trade</label><input id="tr" value="${esc(o.trade || '')}" ${ro ? 'disabled' : ''}></div></div>
        <div class="row"><div class="field"><label>Card type</label><input id="ct" value="${esc(o.cscs_type || '')}" ${ro ? 'disabled' : ''}></div>
          <div class="field"><label>Card number</label><input id="cn" value="${esc(o.cscs_number || '')}" ${ro ? 'disabled' : ''}></div>
          <div class="field"><label>Expiry</label><input id="cx" type="date" value="${dateOnly(o.cscs_expiry)}" ${ro ? 'disabled' : ''}></div></div>
        <div class="row"><div class="field"><label>Emergency contact</label><input id="en" value="${esc(o.emergency_name || '')}" ${ro ? 'disabled' : ''}></div>
          <div class="field"><label>Emergency phone</label><input id="ep" value="${esc(o.emergency_phone || '')}" ${ro ? 'disabled' : ''}></div></div>
        <p class="small muted">Registered ${fDT(o.created_at)}</p></div>
      <div data-p="att" class="hidden">${d.attendance.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Site</th><th>In</th><th>Out</th></tr></thead><tbody>
        ${d.attendance.map(a => `<tr><td>${fDate(a.in_at)}</td><td>${esc(a.site_name)}</td><td>${fTime(a.in_at)}</td><td>${a.out_at ? fTime(a.out_at) : 'on site'}${a.auto_closed ? ' <span class="pill no">not signed out</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No sign-ins yet.</p>'}</div>
      <div data-p="ind" class="hidden">${d.inductions.length ? `<div class="tablewrap"><table><thead><tr><th>Induction</th><th>Completed</th><th>Attempts</th><th>Signature</th></tr></thead><tbody>
        ${d.inductions.map(i => `<tr><td>${esc(i.title)}</td><td>${fDT(i.completed_at)}${i.site_name ? `<br><span class="small muted">at ${esc(i.site_name)}</span>` : ''}</td><td>${i.attempts}</td><td><img src="/api/admin/induction-records/${i.id}/signature" alt="Signature" style="height:40px"></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No inductions completed.</p>'}</div>
      <div data-p="rams" class="hidden">${d.rams.length ? `<div class="tablewrap"><table><thead><tr><th>RAMS</th><th>Site</th><th>Confirmed</th></tr></thead><tbody>
        ${d.rams.map(x => `<tr><td>${esc(x.title)}${x.revision ? ` <span class="small muted">rev ${esc(x.revision)}</span>` : ''}</td><td>${esc(x.site_name)}</td><td>${fDT(x.confirmed_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No RAMS briefings confirmed.</p>'}</div>`,
    ro ? '' : '<button class="btn" id="save">Save changes</button>');
    dlg.querySelectorAll('[data-t]').forEach(b => (b.onclick = () => {
      dlg.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
      dlg.querySelectorAll('[data-p]').forEach(p => p.classList.toggle('hidden', p.dataset.p !== b.dataset.t));
    }));
    dlg.onclose = () => { dlg.onclose = null; if (done) done(); };
    if (ro) return;
    $d('#save').onclick = async () => {
      try {
        await api('/operatives/' + id, { method: 'PUT', body: { full_name: val('#fn'), phone: val('#ph'), company_id: val('#co') || null, company_other: o.company_other,
          trade: val('#tr'), cscs_type: val('#ct'), cscs_number: val('#cn'), cscs_expiry: val('#cx') || null, emergency_name: val('#en'), emergency_phone: val('#ep') } });
        dlg.close(); flash('Operative updated.');
      } catch (e) { dlgErr(e.message); }
    };
  }

  // ---------- subcontractors ----------
  async function companiesView() {
    const rows = await companies(true);
    setMain(`<div class="ad-head"><div><h1>Subcontractors</h1><p class="muted">These appear in the drop-down when operatives register.</p></div>
        ${canEdit() ? '<button class="btn" id="add">Add subcontractor</button>' : ''}</div>
      <div class="tablewrap">${rows.length ? `<table><thead><tr><th>Company</th><th>Trade</th><th>Contact</th><th>Operatives</th><th>On site</th><th>RAMS</th></tr></thead><tbody>
        ${rows.map(c => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.name)}</b>${c.active ? '' : ' <span class="pill grey">inactive</span>'}</td><td>${esc(c.trade || '')}</td>
          <td class="small">${esc(c.contact_name || '')}${c.contact_email ? `<br>${esc(c.contact_email)}` : ''}${c.contact_phone ? `<br>${esc(c.contact_phone)}` : ''}</td>
          <td><a href="#/operatives?company=${c.id}" onclick="event.stopPropagation()">${c.operatives}</a></td><td>${c.on_site}</td>
          <td><a href="#/rams?company=${c.id}" onclick="event.stopPropagation()">${c.rams_accepted} accepted</a>${c.rams_pending ? `<br><span class="pill under_review">${c.rams_pending} to review</span>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty"><b>No subcontractors yet.</b>Add the firms you have working on your sites.</div>'}</div>`);
    const add = document.getElementById('add');
    if (add) add.onclick = () => companyEdit(null);
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => companyEdit(rows.find(c => String(c.id) === tr.dataset.id))));
  }

  function companyEdit(c) {
    const ro = !canEdit();
    c = c || { active: true };
    openDlg(c.id ? c.name : 'Add subcontractor', `
      <div class="field"><label>Company name</label><input id="n" value="${esc(c.name || '')}" ${ro ? 'disabled' : ''}></div>
      <div class="field"><label>Trade</label><input id="t" value="${esc(c.trade || '')}" placeholder="For example, groundworks" ${ro ? 'disabled' : ''}></div>
      <div class="row"><div class="field"><label>Contact name</label><input id="cn" value="${esc(c.contact_name || '')}" ${ro ? 'disabled' : ''}></div>
        <div class="field"><label>Contact phone</label><input id="cp" value="${esc(c.contact_phone || '')}" ${ro ? 'disabled' : ''}></div></div>
      <div class="field"><label>Contact email</label><input id="ce" type="email" value="${esc(c.contact_email || '')}" ${ro ? 'disabled' : ''}></div>
      ${c.id ? `<label class="check"><input type="checkbox" id="a" ${c.active ? 'checked' : ''} ${ro ? 'disabled' : ''}> Active (shown in the registration drop-down)</label>` : ''}`,
    ro ? '' : `<button class="btn" id="save">${c.id ? 'Save changes' : 'Add subcontractor'}</button>`);
    if (ro) return;
    $d('#save').onclick = async () => {
      const body = { name: val('#n'), trade: val('#t'), contact_name: val('#cn'), contact_phone: val('#cp'), contact_email: val('#ce'), active: c.id ? $d('#a').checked : true };
      try { await api('/companies' + (c.id ? '/' + c.id : ''), { method: c.id ? 'PUT' : 'POST', body }); dlg.close(); cache.companies = null; companiesView(); }
      catch (e) { dlgErr(e.message); }
    };
  }

  // ---------- sites ----------
  async function sitesView() {
    const d = await api('/sites'); cache.sites = d.rows;
    setMain(`<div class="ad-head"><div><h1>Sites</h1><p class="muted">Each site has its own sign-in link, QR poster and optional kiosk.</p></div>
        ${canEdit() ? '<button class="btn" id="add">Add site</button>' : ''}</div>
      <div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>Site</th><th>Code</th><th>Boundary</th><th>Sign-in link</th><th></th></tr></thead><tbody>
        ${d.rows.map(s => `<tr><td><b>${esc(s.name)}</b>${s.active ? '' : ' <span class="pill grey">closed</span>'}${s.address ? `<br><span class="small muted">${esc(s.address)}</span>` : ''}</td>
          <td>${esc(s.code)}</td><td>${s.lat != null ? `${s.radius_m} m` : '<span class="pill grey">not set</span>'}</td>
          <td class="small"><a href="${d.base}/s/${esc(s.code)}" target="_blank" rel="noopener">${esc(d.base.replace(/^https?:\/\//, ''))}/s/${esc(s.code)}</a></td>
          <td style="white-space:nowrap"><a class="btn small ghost" href="/api/admin/sites/${s.id}/poster" target="_blank" rel="noopener">QR poster</a>
            <button class="btn small quiet" data-kiosk="${s.id}">Kiosk</button>${canEdit() ? `<button class="btn small quiet" data-edit="${s.id}">Edit</button>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty"><b>No sites yet.</b>Add a site to get its sign-in link and QR poster.</div>'}</div>`);
    const add = document.getElementById('add');
    if (add) add.onclick = () => siteEdit(null);
    main().querySelectorAll('[data-edit]').forEach(b => (b.onclick = () => siteEdit(d.rows.find(s => String(s.id) === b.dataset.edit))));
    main().querySelectorAll('[data-kiosk]').forEach(b => (b.onclick = () => kioskDlg(d.rows.find(s => String(s.id) === b.dataset.kiosk))));
  }

  function siteEdit(s) {
    s = s || { radius_m: 250, active: true };
    openDlg(s.id ? s.name : 'Add site', `
      <div class="row"><div class="field"><label>Site name</label><input id="n" value="${esc(s.name || '')}" placeholder="For example, Meadow View, Leigh"></div>
        <div class="field"><label>Code <span class="hint">short, used in the link</span></label><input id="c" value="${esc(s.code || '')}" placeholder="MV01" style="text-transform:uppercase"></div></div>
      <div class="field"><label>Address</label><input id="ad" value="${esc(s.address || '')}"></div>
      <h3 style="margin-top:1.25rem">Site boundary</h3>
      <p class="small muted">Phone sign-ins are refused outside this circle. Leave the location empty to accept sign-ins from anywhere (kiosks are never checked).</p>
      <div class="row"><div class="field"><label>Latitude</label><input id="la" value="${s.lat ?? ''}" inputmode="decimal"></div>
        <div class="field"><label>Longitude</label><input id="lo" value="${s.lng ?? ''}" inputmode="decimal"></div>
        <div class="field"><label>Radius (metres)</label><input id="ra" type="number" min="25" max="5000" value="${s.radius_m}"></div></div>
      <p><button class="btn small ghost" id="here">Use my current location</button> <span class="small muted" id="hereMsg"></span></p>
      <h3 style="margin-top:1.25rem">Site information</h3>
      <p class="small muted">Shown to each person before their first sign-in at this site.</p>
      <div class="row"><div class="field"><label>Site manager</label><input id="sm" value="${esc(s.site_manager || '')}"></div>
        <div class="field"><label>Site phone</label><input id="sp" value="${esc(s.site_phone || '')}"></div></div>
      <div class="field"><label>Fire assembly point</label><input id="mp" value="${esc(s.muster_point || '')}"></div>
      <div class="field"><label>First aid</label><input id="fa" value="${esc(s.first_aid || '')}" placeholder="Where the kit is and who the first aiders are"></div>
      <div class="field"><label>Welfare</label><input id="we" value="${esc(s.welfare || '')}"></div>
      <div class="field"><label>Site rules</label><textarea id="sr">${esc(s.site_rules || '')}</textarea></div>
      ${s.id ? `<label class="check"><input type="checkbox" id="ac" ${s.active ? 'checked' : ''}> Site open (closing a site switches off its sign-in link)</label>` : ''}`,
    `<button class="btn" id="save">${s.id ? 'Save changes' : 'Add site'}</button>`);
    $d('#here').onclick = () => {
      $d('#hereMsg').textContent = 'Finding you';
      navigator.geolocation.getCurrentPosition(p => {
        $d('#la').value = p.coords.latitude.toFixed(6); $d('#lo').value = p.coords.longitude.toFixed(6);
        $d('#hereMsg').textContent = `Accurate to about ${Math.round(p.coords.accuracy)} m`;
      }, () => ($d('#hereMsg').textContent = 'Location not available on this device.'), { enableHighAccuracy: true, timeout: 15000 });
    };
    $d('#save').onclick = async () => {
      const body = { name: val('#n'), code: val('#c'), address: val('#ad'), lat: val('#la'), lng: val('#lo'), radius_m: val('#ra'), site_manager: val('#sm'), site_phone: val('#sp'),
        muster_point: val('#mp'), first_aid: val('#fa'), welfare: val('#we'), site_rules: val('#sr'), active: s.id ? $d('#ac').checked : true };
      try { await api('/sites' + (s.id ? '/' + s.id : ''), { method: s.id ? 'PUT' : 'POST', body }); dlg.close(); cache.sites = null; sitesView(); }
      catch (e) { dlgErr(e.message); }
    };
  }

  async function kioskDlg(s) {
    const d = await api(`/sites/${s.id}/kiosks`);
    openDlg(`Kiosk: ${s.name}`, `
      <p>A kiosk is a tablet left in the site cabin. Operatives sign in and out on it with their mobile number, and the location check is skipped. Open the kiosk link on the tablet and add it to the home screen.</p>
      ${d.rows.length ? `<div class="tablewrap"><table><thead><tr><th>Kiosk</th><th>Link</th><th></th></tr></thead><tbody>
        ${d.rows.map(k => `<tr><td>${esc(k.label || 'Kiosk')}<br><span class="small muted">set up ${fDate(k.created_at)}</span></td><td class="small" style="word-break:break-all"><a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.url)}</a></td>
          <td>${canEdit() ? `<button class="btn small quiet" data-rv="${k.id}" style="color:var(--brick)">Switch off</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No kiosks set up for this site.</p>'}
      ${canEdit() ? '<div class="row"><div class="field"><label>Name for new kiosk</label><input id="kl" placeholder="For example, Cabin tablet"></div></div>' : ''}`,
    canEdit() ? '<button class="btn" id="mk">Set up kiosk</button>' : '');
    if (!canEdit()) return;
    $d('#mk').onclick = async () => { await api(`/sites/${s.id}/kiosks`, { body: { label: val('#kl') } }); kioskDlg(s); };
    dlg.querySelectorAll('[data-rv]').forEach(b => (b.onclick = async () => {
      if (!confirm('Switch off this kiosk? The tablet will stop working until a new kiosk is set up.')) return;
      await api('/kiosks/' + b.dataset.rv, { method: 'DELETE' }); kioskDlg(s);
    }));
  }

  // ---------- induction ----------
  async function induction(params, id) {
    if (id) return inductionEdit(id);
    const d = await api('/inductions');
    const current = d.rows.find(r => r.status === 'published');
    setMain(`<div class="ad-head"><div><h1>Induction</h1><p class="muted">Everyone completes the published induction before their first sign-in. Publishing a new version asks everyone to redo it at their next sign-in.</p></div>
        ${canEdit() ? `<div style="display:flex;gap:.5rem;flex-wrap:wrap">${current ? `<button class="btn" id="next">Start ${current.year + 1} version</button>` : ''}<button class="btn ${current ? 'ghost' : ''}" id="blank">New blank induction</button></div>` : ''}</div>
      <div class="tablewrap">${d.rows.length ? `<table><thead><tr><th>Induction</th><th>Year</th><th>Status</th><th>Content</th><th>Completed by</th></tr></thead><tbody>
        ${d.rows.map(r => `<tr class="click" data-id="${r.id}"><td><b>${esc(r.title)}</b>${r.published_at ? `<br><span class="small muted">published ${fDate(r.published_at)}</span>` : ''}</td><td>${r.year}</td>
          <td><span class="pill ${r.status}">${r.status === 'published' ? 'Live' : r.status === 'draft' ? 'Draft' : 'Replaced'}</span></td>
          <td class="small">${r.section_count} sections, ${r.question_count} questions</td><td>${r.completed}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty"><b>No induction loaded yet.</b>Start a blank induction and build it from your current induction template.</div>'}</div>`);
    const mk = async copy => { const r = await api('/inductions', { body: copy ? { copy_from: copy } : {} }); location.hash = '#/induction/' + r.row.id; };
    const nx = document.getElementById('next'); if (nx) nx.onclick = () => mk(current.id);
    const bl = document.getElementById('blank'); if (bl) bl.onclick = () => mk(null);
    main().querySelectorAll('tr[data-id]').forEach(tr => (tr.onclick = () => (location.hash = '#/induction/' + tr.dataset.id)));
  }

  async function inductionEdit(id) {
    const { row } = await api('/inductions/' + id);
    const locked = row.status !== 'draft' || !canEdit();
    let sections = row.sections.map(s => ({ ...s }));
    let questions = row.questions.map(x => ({ ...x, options: [...x.options] }));

    const records = locked ? (await api(`/inductions/${id}/records`)).rows : [];

    function draw() {
      setMain(`<p><a href="#/induction">Back to inductions</a></p>
        <div class="ad-head"><div><h1>${esc(row.title)}</h1><p class="muted">${row.status === 'draft' ? 'Draft. Nobody sees this until you publish it.' : row.status === 'published' ? `Live since ${fDate(row.published_at)}. Published versions are locked; start a new version to change it.` : 'Replaced by a newer version.'}</p></div>
          ${!locked ? '<div style="display:flex;gap:.5rem"><button class="btn ghost" id="del">Delete draft</button><button class="btn ghost" id="save">Save draft</button><button class="btn" id="pub">Publish</button></div>' : ''}</div>
        <div class="panel"><div class="row"><div class="field"><label>Title</label><input id="ti" value="${esc(row.title)}" ${locked ? 'disabled' : ''}></div>
          <div class="field"><label>Year</label><input id="yr" type="number" value="${row.year}" ${locked ? 'disabled' : ''}></div></div>
          <div class="field"><label>Introduction <span class="hint">shown at the start</span></label><textarea id="in" ${locked ? 'disabled' : ''}>${esc(row.intro || '')}</textarea></div></div>
        <h2>Sections</h2><p class="muted small">Each section is one screen on the phone. Keep them short enough to read on site.</p>
        <div id="secs">${sections.map((s, i) => `<div class="ed-block">${locked ? '' : `<div class="ed-tools"><button class="btn quiet small" data-su="${i}" ${i === 0 ? 'disabled' : ''}>Move up</button><button class="btn quiet small" data-sd="${i}" ${i === sections.length - 1 ? 'disabled' : ''}>Move down</button><button class="btn quiet small" data-sx="${i}" style="color:var(--brick)">Remove</button></div>`}
          <div class="field"><label>Heading</label><input data-sh="${i}" value="${esc(s.heading)}" ${locked ? 'disabled' : ''}></div>
          <div class="field" style="margin:0"><label>Content</label><textarea data-sb="${i}" rows="7" ${locked ? 'disabled' : ''}>${esc(s.body)}</textarea></div></div>`).join('') || '<p class="muted">No sections yet.</p>'}</div>
        ${locked ? '' : '<p><button class="btn ghost small" id="addSec">Add section</button></p>'}
        <h2 style="margin-top:1.5rem">Questions</h2><p class="muted small">All answers must be correct to finish. Wrong answers are highlighted and the person tries again. Select the correct option with the round button.</p>
        <div id="qs">${questions.map((x, i) => `<div class="ed-block">${locked ? '' : `<div class="ed-tools"><button class="btn quiet small" data-qx="${i}" style="color:var(--brick)">Remove question</button></div>`}
          <div class="field"><label>Question ${i + 1}</label><input data-qq="${i}" value="${esc(x.question)}" ${locked ? 'disabled' : ''}></div>
          ${x.options.map((o, j) => `<div class="ed-opt"><input type="radio" name="ans${i}" data-qa="${i}" value="${j}" ${x.answer === j ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="Correct answer">
            <input data-qo="${i}:${j}" value="${esc(o)}" ${locked ? 'disabled' : ''}>${locked ? '' : `<button class="btn quiet small" data-qox="${i}:${j}" ${x.options.length <= 2 ? 'disabled' : ''}>Remove</button>`}</div>`).join('')}
          ${locked ? '' : `<button class="btn quiet small" data-qadd="${i}">Add option</button>`}</div>`).join('') || '<p class="muted">No questions yet.</p>'}</div>
        ${locked ? '' : '<p><button class="btn ghost small" id="addQ">Add question</button></p>'}
        ${locked ? `<h2 style="margin-top:1.5rem">Completed by (${records.length})</h2><div class="tablewrap">${records.length ? `<table><thead><tr><th>Name</th><th>Company</th><th>Completed</th><th>Attempts</th></tr></thead><tbody>
          ${records.map(r => `<tr><td><a href="#/operatives?id=${r.operative_id}">${esc(r.full_name)}</a></td><td>${esc(r.company || '')}</td><td>${fDT(r.completed_at)}${r.site_name ? ` <span class="small muted">at ${esc(r.site_name)}</span>` : ''}</td><td>${r.attempts}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nobody yet.</div>'}</div>` : ''}`);
      if (locked) return;
      const m = main();
      // Keep edits in memory as the user types.
      m.querySelectorAll('[data-sh]').forEach(el => (el.oninput = () => (sections[el.dataset.sh].heading = el.value)));
      m.querySelectorAll('[data-sb]').forEach(el => (el.oninput = () => (sections[el.dataset.sb].body = el.value)));
      m.querySelectorAll('[data-qq]').forEach(el => (el.oninput = () => (questions[el.dataset.qq].question = el.value)));
      m.querySelectorAll('[data-qo]').forEach(el => (el.oninput = () => { const [i, j] = el.dataset.qo.split(':'); questions[i].options[j] = el.value; }));
      m.querySelectorAll('[data-qa]').forEach(el => (el.onchange = () => (questions[el.dataset.qa].answer = Number(el.value))));
      const keepTop = () => { row.title = v('ti'); row.year = Number(v('yr')); row.intro = v('in'); };
      m.querySelectorAll('[data-su],[data-sd]').forEach(b => (b.onclick = () => {
        keepTop(); const i = Number(b.dataset.su ?? b.dataset.sd), j = b.dataset.su != null ? i - 1 : i + 1;
        [sections[i], sections[j]] = [sections[j], sections[i]]; draw();
      }));
      m.querySelectorAll('[data-sx]').forEach(b => (b.onclick = () => { keepTop(); sections.splice(Number(b.dataset.sx), 1); draw(); }));
      m.querySelectorAll('[data-qx]').forEach(b => (b.onclick = () => { keepTop(); questions.splice(Number(b.dataset.qx), 1); draw(); }));
      m.querySelectorAll('[data-qadd]').forEach(b => (b.onclick = () => { keepTop(); questions[b.dataset.qadd].options.push(''); draw(); }));
      m.querySelectorAll('[data-qox]').forEach(b => (b.onclick = () => {
        keepTop(); const [i, j] = b.dataset.qox.split(':').map(Number); const x = questions[i];
        x.options.splice(j, 1); if (x.answer === j) x.answer = 0; else if (x.answer > j) x.answer--; draw();
      }));
      document.getElementById('addSec').onclick = () => { keepTop(); sections.push({ heading: '', body: '' }); draw(); };
      document.getElementById('addQ').onclick = () => { keepTop(); questions.push({ question: '', options: ['', ''], answer: 0 }); draw(); };
      const save = async quiet => {
        keepTop();
        const r = await api('/inductions/' + id, { method: 'PUT', body: { title: row.title, year: row.year, intro: row.intro, sections, questions } });
        Object.assign(row, r.row);
        if (!quiet) flash('Draft saved.');
      };
      document.getElementById('save').onclick = () => save().catch(e => flash(e.message, 'err'));
      document.getElementById('del').onclick = async () => {
        if (!confirm('Delete this draft?')) return;
        try { await api('/inductions/' + id, { method: 'DELETE' }); location.hash = '#/induction'; } catch (e) { flash(e.message, 'err'); }
      };
      document.getElementById('pub').onclick = async () => {
        try {
          await save(true);
          if (!confirm(`Publish "${row.title}"? It goes live straight away, and everyone will be asked to complete it at their next sign-in.`)) return;
          await api(`/inductions/${id}/publish`, { body: {} }); flash('Induction published.'); inductionEdit(id);
        } catch (e) { flash(e.message, 'err'); }
      };
    }
    draw();
  }

  // ---------- users ----------
  async function users() {
    if (me.role !== 'admin') return setMain('<div class="note warn">Only admins can manage users.</div>');
    const d = await api('/users');
    const roleName = { admin: 'Admin', manager: 'Manager', viewer: 'View only' };
    setMain(`<div class="ad-head"><div><h1>Users</h1><p class="muted">Admins manage users. Managers can change everything else. View-only users can look but not edit.</p></div>
        <button class="btn" id="add">Add user</button></div>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
        ${d.rows.map(u => `<tr><td><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="pill grey">disabled</span>'}</td><td>${esc(u.email)}</td><td>${roleName[u.role]}</td>
          <td><button class="btn small quiet" data-u="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`);
    document.getElementById('add').onclick = () => {
      openDlg('Add user', `<div class="field"><label>Name</label><input id="n"></div><div class="field"><label>Email</label><input id="e" type="email"></div>
        <div class="field"><label>Role</label><select id="r"><option value="manager">Manager</option><option value="viewer">View only</option><option value="admin">Admin</option></select></div>
        <div class="field"><label>Temporary password <span class="hint">at least 8 characters; they can change it after logging in</span></label><input id="p" type="text"></div>`,
      '<button class="btn" id="save">Add user</button>');
      $d('#save').onclick = async () => {
        try { await api('/users', { body: { name: val('#n'), email: val('#e'), role: val('#r'), password: val('#p') } }); dlg.close(); users(); }
        catch (e) { dlgErr(e.message); }
      };
    };
    main().querySelectorAll('[data-u]').forEach(b => (b.onclick = () => {
      const u = d.rows.find(x => String(x.id) === b.dataset.u);
      openDlg(u.name, `<div class="field"><label>Role</label><select id="r">${Object.entries(roleName).map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="a" ${u.active ? 'checked' : ''}> Account active</label>
        <div class="field"><label>Reset password <span class="hint">leave empty to keep the current one</span></label><input id="p" type="text"></div>`,
      '<button class="btn" id="save">Save changes</button>');
      $d('#save').onclick = async () => {
        try { await api('/users/' + u.id, { method: 'PUT', body: { role: val('#r'), active: $d('#a').checked, password: val('#p') || undefined } }); dlg.close(); users(); }
        catch (e) { dlgErr(e.message); }
      };
    }));
  }

  boot().catch(e => (root.innerHTML = `<div class="login-wrap"><div class="login-card"><div class="note err">${esc(e.message)}</div></div></div>`));
})();
