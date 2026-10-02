// Operative sign-in: phone link (/s/CODE) or site kiosk (/k/TOKEN).
(() => {
  const app = document.getElementById('app');
  const parts = location.pathname.split('/').filter(Boolean);
  const KIOSK = parts[0] === 'k' ? parts[1] : null;
  let SITE_CODE = parts[0] === 's' ? (parts[1] || '').toUpperCase() : null;
  const OP_KEY = 'oak_op_token';

  let site = null, companies = [], induction = null;
  let opToken = null;
  let kioskTimer = null;

  // ---------- small helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const $ = sel => app.querySelector(sel);
  const store = {
    get() { try { return localStorage.getItem(OP_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(OP_KEY, v); } catch { /* private mode */ } },
    clear() { try { localStorage.removeItem(OP_KEY); } catch { /* ignore */ } },
  };

  async function api(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    if (opToken) headers['x-op-token'] = opToken;
    if (KIOSK) headers['x-kiosk-token'] = KIOSK;
    const res = await fetch('/api/p' + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong. Try again.'); e.status = res.status; e.code = data.error; throw e; }
    return data;
  }

  function render(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function showErr(msg) {
    let n = $('.note.err');
    if (!n) { n = document.createElement('div'); n.className = 'note err'; app.prepend(n); }
    n.textContent = msg; n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Please wait'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  function whoBar(st) {
    return `<div class="si-who"><div><b>${esc(st.operative.full_name)}</b><span class="muted small">${esc(st.operative.company || '')}</span></div>
      ${KIOSK ? '<button class="btn quiet" data-act="reset">Not you?</button>' : '<button class="btn quiet" data-act="forget">Not you?</button>'}</div>`;
  }
  app.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'forget') { store.clear(); opToken = null; welcome(); }
    if (a.dataset.act === 'reset') { opToken = null; welcome(); }
  });

  // Resize a photo to keep uploads small on site signal.
  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 720, scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('That photo could not be read. Try again.'));
      img.src = URL.createObjectURL(file);
    });
  }

  function photoField(id) {
    return `<div class="photo-box" id="${id}Box">
      <img id="${id}Img" class="hidden" alt="Your photo">
      <label class="btn ghost" for="${id}">Take photo</label>
      <input id="${id}" type="file" accept="image/*" capture="user" class="hidden">
      <p class="small muted" style="margin:.6rem 0 0">A clear photo of your face, taken now.</p></div>`;
  }
  function wirePhoto(id, onPhoto) {
    const input = $('#' + id);
    input.addEventListener('change', async () => {
      if (!input.files[0]) return;
      try {
        const d = await readPhoto(input.files[0]);
        const img = $('#' + id + 'Img'); img.src = d; img.classList.remove('hidden');
        $('label[for=' + id + ']').textContent = 'Retake photo';
        onPhoto(d);
      } catch (e) { showErr(e.message); }
    });
  }

  function getPosition() {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  // ---------- start ----------
  async function start() {
    try {
      if (KIOSK) {
        const k = await api('/kiosk/' + encodeURIComponent(KIOSK));
        SITE_CODE = k.site;
        document.getElementById('kioskTag').classList.remove('hidden');
      }
      const d = await api('/site/' + encodeURIComponent(SITE_CODE));
      site = d.site; companies = d.companies; induction = d.induction;
      document.getElementById('siteName').textContent = site.name;
      document.getElementById('siteAddr').textContent = site.address || '';
      document.title = `Sign in: ${site.name}`;
    } catch (e) {
      document.getElementById('siteName').textContent = 'Site not found';
      render(`<div class="note err">${esc(e.message)}</div>`);
      return;
    }
    if (!KIOSK) {
      opToken = store.get();
      if (opToken) return next();
    }
    welcome();
  }

  function welcome() {
    clearTimeout(kioskTimer);
    render(`<h1>${KIOSK ? 'Sign in or out' : 'Welcome to site'}</h1>
      <p class="muted">${KIOSK ? 'Enter your mobile number to sign in or out.' : 'Sign in every time you arrive, and sign out when you leave.'}</p>
      <div style="display:grid;gap:.75rem;margin-top:1.5rem">
        <button class="btn big" id="been">I have been here before</button>
        <button class="btn big ghost" id="new">First time on an Oakmere site</button>
      </div>`);
    $('#been').onclick = lookup;
    $('#new').onclick = register;
  }

  function lookup() {
    render(`<h1>Find your details</h1>
      <p class="muted">Use the mobile number you registered with.</p>
      <div class="field"><label for="ph">Mobile number</label><input id="ph" type="tel" autocomplete="tel" inputmode="tel"></div>
      <div class="field"><label for="sn">Surname</label><input id="sn" type="text" autocomplete="family-name"></div>
      <button class="btn big" id="go">Continue</button>
      <p class="link-row"><button class="btn quiet" id="back">Back</button></p>`);
    $('#back').onclick = welcome;
    $('#go').onclick = async ev => {
      busy(ev.target, true);
      try {
        const d = await api('/lookup', { site: SITE_CODE, phone: $('#ph').value, surname: $('#sn').value });
        opToken = d.token; if (!KIOSK) store.set(opToken);
        next();
      } catch (e) { busy(ev.target, false); showErr(e.message); }
    };
  }

  function register() {
    const opts = companies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    render(`<h1>Your details</h1>
      <p class="muted">You only do this once. Next time you just sign in.</p>
      <div class="field"><label for="fn">Full name</label><input id="fn" type="text" autocomplete="name"></div>
      <div class="field"><label for="ph">Mobile number</label><input id="ph" type="tel" autocomplete="tel" inputmode="tel"></div>
      <div class="field"><label for="co">Company you work for</label>
        <select id="co"><option value="">Choose your company</option>${opts}<option value="other">My company is not listed</option></select></div>
      <div class="field hidden" id="coOtherWrap"><label for="coOther">Company name</label><input id="coOther" type="text"></div>
      <div class="field"><label for="tr">Trade <span class="hint">for example bricklayer, groundworker, electrician</span></label><input id="tr" type="text"></div>
      <h2 style="margin-top:1.5rem">CSCS or skills card</h2>
      <div class="field"><label for="ct">Card type</label><select id="ct">
        <option value="">Choose card type</option><option>Green (labourer)</option><option>Red (trainee or experienced worker)</option>
        <option>Blue (skilled worker)</option><option>Gold (advanced craft or supervisor)</option><option>Black (manager)</option>
        <option>White (professionally qualified or academic)</option><option>Other skills card (CPCS, NPORS, ECS, JIB and similar)</option><option>Visitor (no card)</option></select></div>
      <div class="row">
        <div class="field"><label for="cn">Card number</label><input id="cn" type="text"></div>
        <div class="field"><label for="cx">Expiry date</label><input id="cx" type="date"></div>
      </div>
      <h2 style="margin-top:1.5rem">Emergency contact</h2>
      <div class="row">
        <div class="field"><label for="en">Name</label><input id="en" type="text"></div>
        <div class="field"><label for="ep">Phone</label><input id="ep" type="tel" inputmode="tel"></div>
      </div>
      <button class="btn big" id="go">Continue</button>
      <p class="link-row"><button class="btn quiet" id="back">Back</button></p>`);
    $('#back').onclick = welcome;
    $('#co').onchange = () => $('#coOtherWrap').classList.toggle('hidden', $('#co').value !== 'other');
    $('#go').onclick = async ev => {
      const co = $('#co').value;
      const body = {
        site: SITE_CODE, full_name: $('#fn').value, phone: $('#ph').value,
        company_id: co && co !== 'other' ? co : null, company_other: co === 'other' ? $('#coOther').value : null,
        trade: $('#tr').value, cscs_type: $('#ct').value, cscs_number: $('#cn').value, cscs_expiry: $('#cx').value || null,
        emergency_name: $('#en').value, emergency_phone: $('#ep').value,
      };
      if (!co) return showErr('Choose the company you work for.');
      busy(ev.target, true);
      try {
        const d = await api('/register', body);
        opToken = d.token; if (!KIOSK) store.set(opToken);
        next();
      } catch (e) { busy(ev.target, false); showErr(e.message); }
    };
  }

  // Works out the next screen from the server's view of this person.
  async function next() {
    let st;
    try { st = await api('/status?site=' + encodeURIComponent(SITE_CODE)); }
    catch (e) {
      if (e.status === 401) { store.clear(); opToken = null; return welcome(); }
      return render(`<div class="note err">${esc(e.message)}</div>`);
    }
    if (st.induction_required && induction) return inductionRead(st, 0);
    if (st.briefing_required) return briefing(st);
    if (st.open_attendance && st.open_attendance.site_code === site.code) return signOut(st);
    if (st.open_attendance) return elsewhere(st);
    return signIn(st);
  }

  // ---------- induction ----------
  function inductionRead(st, i) {
    const secs = induction.sections || [];
    if (i >= secs.length) return quiz(st, 1);
    const s = secs[i];
    render(`${whoBar(st)}
      <div class="ind-progress">${esc(induction.title)}: part ${i + 1} of ${secs.length}</div>
      <div class="si-steps">${secs.map((_, j) => `<span class="${j < i ? 'done' : j === i ? 'now' : ''}"></span>`).join('')}<span></span></div>
      ${i === 0 && induction.intro ? `<p>${esc(induction.intro)}</p>` : ''}
      <div class="ind-section"><h2>${esc(s.heading)}</h2><div class="body">${esc(s.body)}</div></div>
      <button class="btn big" id="go">${i === secs.length - 1 ? 'Go to questions' : 'Next'}</button>
      ${i > 0 ? '<p class="link-row"><button class="btn quiet" id="back">Back</button></p>' : ''}`);
    $('#go').onclick = () => inductionRead(st, i + 1);
    if (i > 0) $('#back').onclick = () => inductionRead(st, i - 1);
  }

  function quiz(st, attempt, wrong = [], prev = []) {
    const qs = induction.questions || [];
    render(`${whoBar(st)}
      <h1>Check your understanding</h1>
      ${wrong.length ? `<div class="note warn">${wrong.length === 1 ? 'One answer needs' : wrong.length + ' answers need'} another look. Re-read the question and try again.</div>`
                     : '<p class="muted">Answer every question correctly to finish the induction.</p>'}
      ${qs.map((x, i) => `<fieldset class="quiz-q ${wrong.includes(i) ? 'wrong' : ''}" style="margin:0 0 1rem">
          <legend style="font-weight:700;padding:0">${i + 1}. ${esc(x.question)}</legend>
          <div class="opts">${x.options.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}" ${!wrong.includes(i) && prev[i] === j ? 'checked' : ''}> <span>${esc(o)}</span></label>`).join('')}</div>
        </fieldset>`).join('')}
      <button class="btn big" id="go">Check answers</button>`);
    $('#go').onclick = () => {
      const answers = qs.map((_, i) => { const c = app.querySelector(`input[name=q${i}]:checked`); return c ? Number(c.value) : null; });
      if (answers.some(a => a === null)) return showErr('Answer every question.');
      signature(st, answers, attempt);
    };
  }

  function signature(st, answers, attempt) {
    render(`${whoBar(st)}
      <h1>Sign your induction</h1>
      <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="ack">
        <span>I have read and understood the ${esc(induction.title)} and will follow the site rules.</span></label>
      <label>Your signature</label>
      <div class="sig-wrap"><canvas id="sig"></canvas></div>
      <p class="link-row" style="margin:0 0 1rem;text-align:right"><button class="btn quiet small" id="clr">Clear signature</button></p>
      <button class="btn big" id="go">Finish induction</button>`);
    const pad = sigPad($('#sig'));
    $('#clr').onclick = pad.clear;
    $('#go').onclick = async ev => {
      if (!$('#ack').checked) return showErr('Tick the box to confirm.');
      if (pad.empty()) return showErr('Sign in the box.');
      busy(ev.target, true);
      try {
        const r = await api('/induction', { site: SITE_CODE, answers, signature: pad.data(), attempts: attempt });
        if (!r.ok) return quiz(st, attempt + 1, r.wrong, answers);
        next();
      } catch (e) { busy(ev.target, false); showErr(e.message); }
    };
  }

  function sigPad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false, dirty = false;
    function size() {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#18201b';
    }
    size();
    const pt = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); const p = pt(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.lineTo(p.x, p.y); ctx.stroke(); dirty = true; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
      empty: () => !dirty,
      data: () => canvas.toDataURL('image/png'),
    };
  }

  // ---------- site briefing ----------
  function briefing(st) {
    const items = [
      ['Site manager', [site.site_manager, site.site_phone].filter(Boolean).join(', ')],
      ['Fire assembly point', site.muster_point], ['First aid', site.first_aid], ['Welfare', site.welfare], ['Site rules', site.site_rules],
    ].filter(x => x[1]);
    if (!items.length) {
      return api('/briefing', { site: SITE_CODE }).then(next).catch(e => showErr(e.message));
    }
    render(`${whoBar(st)}
      <h1>About this site</h1>
      <p class="muted">Read this before your first sign-in at ${esc(site.name)}.</p>
      <dl class="info-list">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="ack"><span>I have read the site information above.</span></label>
      <button class="btn big" id="go">Continue</button>`);
    $('#go').onclick = async ev => {
      if (!$('#ack').checked) return showErr('Tick the box to confirm.');
      busy(ev.target, true);
      try { await api('/briefing', { site: SITE_CODE }); next(); } catch (e) { busy(ev.target, false); showErr(e.message); }
    };
  }

  // ---------- sign in / out ----------
  function signIn(st) {
    let photo = null;
    const rams = st.rams_pending || [];
    render(`${whoBar(st)}
      <h1>Sign in</h1>
      ${rams.length ? `<h2>Your company's RAMS for this site</h2>
        <p class="muted small">Open each one and confirm you have been briefed on it.</p>
        <div style="display:grid;gap:.5rem;margin-bottom:1.25rem">${rams.map(r => `<label class="check rams-item"><input type="checkbox" class="rams" value="${r.id}">
          <span><a href="/api/p/rams/${r.id}?t=${encodeURIComponent(opToken)}" target="_blank" rel="noopener">${esc(r.title)}</a>
          ${r.reference || r.revision ? `<span class="small muted"> ${esc([r.reference, r.revision && 'rev ' + r.revision].filter(Boolean).join(', '))}</span>` : ''}<br>
          <span class="small">I have been briefed on this RAMS and understand it.</span></span></label>`).join('')}</div>` : ''}
      ${photoField('ph')}
      <div class="field"><label for="nt">Note <span class="hint">optional</span></label><input id="nt" type="text" placeholder="For example, delivering to plot 12"></div>
      ${!KIOSK && site.geofenced ? '<p class="small muted">Your location is checked when you sign in, so allow location if asked.</p>' : ''}
      <button class="btn big" id="go">Sign in</button>`);
    wirePhoto('ph', d => { photo = d; });
    $('#go').onclick = async ev => {
      const ticked = [...app.querySelectorAll('.rams:checked')].map(x => Number(x.value));
      if (ticked.length < rams.length) return showErr('Confirm you have been briefed on each RAMS.');
      if (!photo) return showErr('Take a photo to sign in.');
      busy(ev.target, true, !KIOSK && site.geofenced ? 'Checking your location' : 'Signing in');
      const pos = !KIOSK && site.geofenced ? await getPosition() : null;
      try {
        const r = await api('/signin', { site: SITE_CODE, photo, note: $('#nt').value, rams_ids: ticked, lat: pos && pos.lat, lng: pos && pos.lng });
        done('in', st, r.in_at);
      } catch (e) { busy(ev.target, false); showErr(e.message); }
    };
  }

  function signOut(st) {
    let photo = null;
    render(`${whoBar(st)}
      <div class="si-state"><p class="muted" style="margin:0">Signed in since</p><div class="big-time">${time(st.open_attendance.in_at)}</div></div>
      ${photoField('ph')}
      <div class="field"><label for="nt">Note <span class="hint">optional</span></label><input id="nt" type="text"></div>
      <button class="btn big" id="go">Sign out</button>`);
    wirePhoto('ph', d => { photo = d; });
    $('#go').onclick = async ev => {
      if (!photo) return showErr('Take a photo to sign out.');
      busy(ev.target, true, 'Signing out');
      const pos = !KIOSK && site.geofenced ? await getPosition() : null;
      try {
        const r = await api('/signout', { site: SITE_CODE, photo, note: $('#nt').value, lat: pos && pos.lat, lng: pos && pos.lng });
        done('out', st, r.out_at);
      } catch (e) { busy(ev.target, false); showErr(e.message); }
    };
  }

  function elsewhere(st) {
    const o = st.open_attendance;
    render(`${whoBar(st)}
      <div class="note warn">You are still signed in at ${esc(o.site_name)} from ${time(o.in_at)}.</div>
      ${KIOSK ? '<p>Sign out of that site on your phone, or ask the site manager, then sign in here.</p><button class="btn big" data-act="reset">Done</button>'
              : `<p>Sign out of ${esc(o.site_name)} first, then sign in here.</p><button class="btn big" id="go">Sign out of ${esc(o.site_name)}</button>`}`);
    if (!KIOSK) $('#go').onclick = () => { const here = SITE_CODE; SITE_CODE = o.site_code; signOutElsewhere(st, here); };
  }

  function signOutElsewhere(st, here) {
    let photo = null;
    render(`${whoBar(st)}<h1>Sign out of ${esc(st.open_attendance.site_name)}</h1>${photoField('ph')}
      <button class="btn big" id="go">Sign out</button>`);
    wirePhoto('ph', d => { photo = d; });
    $('#go').onclick = async ev => {
      if (!photo) return showErr('Take a photo to sign out.');
      busy(ev.target, true);
      try { await api('/signout', { site: SITE_CODE, photo, note: 'Signed out from another site link' }); SITE_CODE = here; next(); }
      catch (e) { SITE_CODE = here; busy(ev.target, false); showErr(e.message); }
    };
  }

  function done(kind, st, at) {
    render(`<div class="si-done ${kind}">
      <div class="tick" aria-hidden="true">${kind === 'in' ? '✓' : '✓'}</div>
      <h1>${kind === 'in' ? 'Signed in' : 'Signed out'} at ${time(at)}</h1>
      <p class="muted">${esc(st.operative.full_name)}, ${esc(site.name)}</p>
      <p>${kind === 'in' ? 'Remember to sign out before you leave site.' : 'Thanks. Travel home safely.'}</p>
      ${KIOSK ? '<button class="btn big" data-act="reset" style="margin-top:1rem">Done</button>' : ''}</div>`);
    if (KIOSK) kioskTimer = setTimeout(() => { opToken = null; welcome(); }, 8000);
  }

  start();
})();
