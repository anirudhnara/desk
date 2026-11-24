/* Grok Bot Desk app. Token: read once from #t=, kept in localStorage, sent only as an Authorization header. */
(function () {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // #t={APP_TOKEN} (plan A, live API) or #d={DATA_PATH} (plan B, static snapshots); kept in localStorage, fragment removed
  if (location.hash.length > 1) {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('t')) localStorage.setItem('desk_token', h.get('t'));
    if (h.get('d')) localStorage.setItem('desk_data', h.get('d'));
    history.replaceState(null, '', location.pathname + location.search);
  }
  const TOKEN = () => localStorage.getItem('desk_token') || '';
  const STATIC = location.hostname.endsWith('github.io') || localStorage.getItem('desk_static') === '1' || !!localStorage.getItem('desk_data');
  const DATA = () => localStorage.getItem('desk_data') || '';
  const $ = s => document.querySelector(s);
  const V = $('#view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (x, sign) => x == null ? '—' : (sign && x > 0 ? '+' : x < 0 ? '-' : '') + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (x, sign = true) => x == null ? '—' : (sign && x > 0 ? '+' : '') + Number(x).toFixed(2) + '%';
  const kfmt = x => x == null ? 'n/a' : x >= 1e6 ? '$' + (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : '$' + x.toFixed(0);
  const hhmm = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const priceFmt = p => p == null ? '—' : p >= 1 ? '$' + p.toFixed(4) : '$' + p.toPrecision(4);

  // ---------- network + error state ----------
  const S = { tab: 'home', stack: [], range: 'LIVE', state: null, chart: null, activity: null, lastOk: null, offline: false, retryAt: 0 };
  // plan B: GET /api/* maps onto d/{DATA_PATH}/*.json; writes are not possible from the phone
  function staticPath(path) {
    const u = new URL(path, 'https://x'), p = u.pathname.replace(/^\/api\//, ''), seg = p.split('/');
    if (p === 'chart') return 'chart_' + (u.searchParams.get('range') || 'LIVE') + '.json';
    if (seg[0] === 'agents') return 'agents/' + seg[1] + '.json';
    if (seg[0] === 'coin' || seg[0] === 'audit') return seg[0] + '/' + seg[1] + '.json';
    if (p === 'search') return 'coins.json';
    return p + '.json';
  }
  async function staticApi(path, opts) {
    if (opts.method && opts.method !== 'GET') return { _status: 403, ok: false, reply: 'Read-only on the phone. Send this in chat: the desk takes commands there.', error: 'Read-only on the phone · change it in chat' };
    if (!DATA()) { S.unauth = true; throw new Error('401'); }
    const r = await fetch('d/' + encodeURIComponent(DATA()) + '/' + staticPath(path) + '?v=' + Math.floor(Date.now() / 15000), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let j = await r.json();
    if (path.startsWith('/api/search')) { const q = new URL(path, 'https://x').searchParams.get('q').toLowerCase(); j = { rows: j.rows.filter(c => (c.symbol || '').toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q) || c.mint.toLowerCase().startsWith(q)).slice(0, 20) }; }
    S.lastOk = Date.now(); setOffline(false); j._status = 200; return j;
  }
  async function api(path, opts = {}) {
    if (STATIC) return staticApi(path, opts);
    const r = await fetch(path, { ...opts, headers: { 'Authorization': 'Bearer ' + TOKEN(), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (r.status === 401) { S.unauth = true; throw new Error('401'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 400 && r.status !== 409) throw new Error('HTTP ' + r.status);
    S.lastOk = Date.now(); setOffline(false); j._status = r.status; return j;
  }
  function setOffline(on) {
    S.offline = on; const e = $('#err');
    if (!on) { e.hidden = true; return; }
    e.hidden = false; tickErr();
  }
  function tickErr() {
    if (!S.offline) return;
    const n = Math.max(0, Math.ceil((S.retryAt - Date.now()) / 1000));
    $('#err').textContent = S.unauth ? 'Desk offline · open the app once with its link · last update ' + (S.lastOk ? new Date(S.lastOk).toLocaleTimeString() : 'never')
      : `Desk offline · retrying in ${n}s · last update ${S.lastOk ? new Date(S.lastOk).toLocaleTimeString() : 'never'}`;
  }
  setInterval(tickErr, 1000);
  function fail() { if (S.failT) return; S.retryAt = Date.now() + 5000; setOffline(true); S.failT = setTimeout(() => { S.failT = null; render(true); }, 5000); }
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, 2200); }

  // ---------- odometer ----------
  function odometer(el, text) {
    if (RM || !el._prev) { el._prev = text; el.innerHTML = '<span class="odo">' + [...text].map(ch => /\d/.test(ch) ? col(ch) : `<span>${esc(ch)}</span>`).join('') + '</span>'; return; }
    if (el._prev === text) return;
    const prev = el._prev.padStart(text.length, ' '); el._prev = text;
    const chars = [...text];
    el.innerHTML = '<span class="odo">' + chars.map((ch, i) => /\d/.test(ch) ? col(/\d/.test(prev[i]) ? prev[i] : '0', i) : `<span>${esc(ch)}</span>`).join('') + '</span>';
    const cols = [...el.querySelectorAll('.col')];
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const digitIdx = chars.map((c, i) => /\d/.test(c) ? i : -1).filter(i => i >= 0);
      cols.forEach((c, j) => {
        const i = digitIdx[j], changed = prev[i] !== chars[i];
        const fromRight = digitIdx.length - 1 - j;
        c.style.transitionDelay = changed ? (fromRight * 30) + 'ms' : '0ms';
        c.style.transform = `translateY(-${Number(chars[i]) * 1.05}em)`;
      });
    }));
    function col(d) { return `<span class="col" style="transform:translateY(-${Number(d) * 1.05}em)">${[0,1,2,3,4,5,6,7,8,9].map(n => `<span>${n}</span>`).join('')}</span>`; }
  }

  // ---------- SSE over fetch (header auth, no token in URL) ----------
  let sseOn = false;
  async function sse() {
    if (sseOn) return; sseOn = true;
    if (STATIC) { setInterval(() => { if (!document.hidden) render(true); }, 15000); return; }   // plan B polls the snapshots
    while (true) {
      try {
        const r = await fetch('/api/stream', { headers: { 'Authorization': 'Bearer ' + TOKEN() } });
        if (!r.ok) throw new Error(r.status);
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
        while (true) {
          const { value, done } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const blk = buf.slice(0, i); buf = buf.slice(i + 2);
            let ev = 'message', data = '';
            blk.split('\n').forEach(l => { if (l.startsWith('event: ')) ev = l.slice(7); else if (l.startsWith('data: ')) data += l.slice(6); });
            if (data) { S.lastOk = Date.now(); setOffline(false); onEvent(ev, JSON.parse(data)); }
          }
        }
      } catch (e) { fail(); }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  let refreshT;
  function onEvent(ev, d) {
    if (ev === 'audit_layer' && S.audit && S.audit.mint === d.mint) { beamPush(d); return; }
    clearTimeout(refreshT); refreshT = setTimeout(() => render(true), 400);
  }

  // ---------- shell ----------
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; S.stack = []; render(); scrollTo(0, 0); });
  function go(view, arg) { S.stack.push({ view, arg }); render(); scrollTo(0, 0); }
  function back() { S.stack.pop(); render(); }
  window.addEventListener('resize', () => render(true));

  async function render(soft) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
    const top = S.stack[S.stack.length - 1];
    const key = top ? top.view + ':' + top.arg : S.tab;
    S.cache = S.cache || {};
    try {
      if (top && top.view === 'coin') await viewCoin(top.arg, soft);
      else if (top && top.view === 'audit') await viewAudit(top.arg, soft);
      else if (S.tab === 'home') await viewHome(soft);
      else if (S.tab === 'agents') await viewAgents(soft);
      else if (S.tab === 'activity') await viewActivity(soft);
      else if (S.tab === 'account') await viewAccount(soft);
      if (STATIC) V.querySelectorAll('[data-key], #mode button, #stk, #cmd, #go, #tp, [data-bought], [data-skip], [data-sold], [data-sw], #aen').forEach(e => { e.disabled = true; e.style.opacity = .5; e.style.pointerEvents = 'none'; });
      S.cache[key] = V.innerHTML;
    } catch (e) {
      window.__err = String(e && e.stack || e).slice(0, 300);
      // keep the last good numbers on screen: never a blank screen, never a made-up number
      if (S.cache[key] && V.querySelector('.skel')) {
        V.innerHTML = S.cache[key]; wire();
        if (key === 'home' && S.chart && $('#cv')) Charts.line($('#cv'), S.chart, null);
        if (key === 'home') { const b = $('#bal'); if (b) { b._prev = null; odometer(b, money(S.state.balance)); } }
      }
      fail();
    }
  }
  const skel = (h, r = 14) => `<div class="skel" style="height:${h}px;border-radius:${r}px;margin:10px 0"></div>`;
  const backBar = t => `<div class="nav"><button class="icon" data-back><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><div class="title">${t}</div></div>`;
  function wire() {
    V.querySelectorAll('[data-back]').forEach(b => b.onclick = back);
    V.querySelectorAll('[data-coin]').forEach(b => b.onclick = e => { if (e.target.closest('a')) return; go('coin', b.dataset.coin); });
    V.querySelectorAll('[data-audit]').forEach(b => b.onclick = e => { if (e.target.closest('a')) return; go('audit', b.dataset.audit); });
  }

  // ---------- HOME ----------
  async function viewHome(soft) {
    if (!S.state) V.innerHTML = `<div class="nav">${skel(32, 16)}</div>${skel(70)}${skel(24)}${skel(240)}${skel(44)}<h2>Agents</h2><div class="skel" style="width:calc(100vw - 32px);aspect-ratio:504/470;border-radius:calc(42*(100vw - 32px)/504)"></div>`;
    const [st, ch, ac] = await Promise.all([api('/api/state'), api('/api/chart?range=' + S.range), api('/api/activity')]);
    const prevChart = S.chart; S.state = st; S.chart = ch; S.activity = ac;
    if (!V.querySelector('#home')) {
      V.innerHTML = `<div id="home">
      <div class="nav"><button class="icon" id="av"><span class="avatar">G</span></button><button class="title" id="me">Grok Bot ›</button>
        <button class="icon" id="sr"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>
        <button class="icon" id="bell"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg><i class="dot" id="bdot" hidden></i></button></div>
      <div class="bal"><div class="big" id="bal"></div><span class="badge" id="paper">PAPER</span></div>
      <div class="sub"><span id="today"></span><span class="pill g" id="mult"></span></div>
      <canvas class="chart" id="cv"></canvas>
      <div class="ranges" id="rg">${['LIVE','1H','4H','1D','1W','ALL'].map(r => `<button data-r="${r}">${r}</button>`).join('')}</div>
      <h2 id="agh">Agents</h2><div class="carousel" id="cards"></div>
      <h2>Activity <button id="seeall">See all</button></h2><div class="rows" id="act"></div></div>`;
      $('#av').onclick = $('#me').onclick = () => { S.tab = 'account'; render(); };
      $('#seeall').onclick = () => { S.tab = 'activity'; render(); };
      $('#rg').onclick = e => { const b = e.target.closest('button'); if (b) { S.range = b.dataset.r; render(true); } };
      $('#sr').onclick = search; $('#bell').onclick = bell;
    }
    odometer($('#bal'), money(st.balance));
    $('#paper').hidden = st.mode === 'LIVE'; $('#paper').textContent = st.mode;
    $('#today').textContent = pct(st.today_pct) + ' today'; $('#today').className = st.today_pct >= 0 ? 'up' : 'dn';
    $('#mult').textContent = st.multiplier.toFixed(2) + '×';
    $('#bdot').hidden = !st.unread;
    document.querySelectorAll('#rg button').forEach(b => b.classList.toggle('on', b.dataset.r === S.range));
    Charts.line($('#cv'), ch, prevChart && prevChart.range === ch.range ? prevChart : null);
    const running = st.agents.filter(a => !a.paused).length;
    $('#agh').textContent = `Agents · ${running} running`;
    $('#cards').innerHTML = st.agents.map(agentCard).join('');
    st.agents.filter(a => a.name === 'analyst').forEach(a => { const c = $('#ring'); if (c) Charts.ring(c, a.last ? a.last.score : null, a.min_score); });
    $('#act').innerHTML = rows(ac.rows.slice(0, 5)) || '<div class="empty">Nothing yet tonight</div>';
    wire();
  }

  function agentCard(a) {
    const col = { scanner: '#64d2ff', auditor: '#fff', analyst: '#ffd60a', executor: '#00d35a', risk: '#ff6b9a' }[a.name];
    const nm = a.name[0].toUpperCase() + a.name.slice(1);
    let cnt = '', body = '';
    if (a.name === 'scanner') {
      cnt = `${a.count} pools`;
      body = a.feed.length ? `<div class="feed">${a.feed.slice(0, 6).map(f => `<div data-coin="${f.mint}"><span class="${f.verdict === 'kill' ? 'k' : ''}">${esc(f.label)}</span><span class="${f.verdict === 'kill' ? 'dn' : 'up'}">${f.verdict === 'kill' ? esc(f.reason) : '→ auditor'}</span></div>`).join('')}</div>`
        : `<div class="t2">Listening for graduations${a.waiting ? ' · ' + a.waiting + ' waiting' : ''}</div>`;
    } else if (a.name === 'auditor') {
      cnt = `${a.count} taken apart`;
      const L = a.last ? a.last.layers : [];
      const strips = [1,2,3,4,5,6,7,8].map(n => { const l = L.find(x => x.n === n); return `<i class="${a.running ? (l ? (l.pass ? 'p' : 'r') : '') : l ? (l.pass === 1 ? 'p' : l.pass === 0 ? 'r' : '') : ''}"></i>`; }).join('');
      const red = L.find(l => l.pass === 0);
      body = `<div class="strips">${strips}</div><div>${a.running ? 'taking apart...' : a.last ? (red ? esc(a.last.label) + ' · ' + esc(red.value) : esc(a.last.label) + ' · 8/8 → Executor') : '<span class="t2">No coin taken apart yet</span>'}</div><div class="t2" style="margin-top:6px">${a.rejected} rejected</div>`;
      if (a.last) body = `<div data-audit="${a.last.mint}">${body}</div>`;
    } else if (a.name === 'analyst') {
      cnt = 'Scoring';
      body = `<canvas id="ring" style="width:120px;height:120px;display:block;margin:4px 0"></canvas><div class="t2">${a.last ? esc(a.last.label) + ' · ' + (a.last.pass ? 'pass' : esc(a.last.reason)) : 'No coin scored yet'} · ${a.mode === 'rules' ? 'rules' : 'Jev'}</div>`;
    } else if (a.name === 'executor') {
      cnt = `${a.count} trades`;
      const l = a.last;
      body = l ? `<div>$${l.size.toFixed(2)} · ${a.stack_pct}% of stack</div><div class="bar"><i style="width:${l.status === 'sent' ? 60 : 100}%"></i></div><div class="${l.status === 'sent' ? 't2' : 'up'}">${l.status === 'sent' ? 'Executing... 60%' : '✓ Filled'}</div>`
        : `<div class="t2">$— · ${a.stack_pct}% of stack</div><div class="bar"><i style="width:0"></i></div>`;
    } else if (a.name === 'risk') {
      cnt = 'Guarding';
      body = `<div>${a.open} open${a.last_exit ? ' · ' + esc(a.last_exit) : ''}</div><div style="display:flex;gap:8px;margin-top:12px"><span class="mono" style="background:rgba(255,69,58,.16);color:#ff453a">stop -${a.stop_pct}%</span><span class="mono" style="background:rgba(0,211,90,.16);color:#00d35a">trail ${a.trail_pct}%</span></div>`;
    }
    return `<div class="card"><div class="hd"><span class="nm" style="color:${col}">${nm}</span><span class="t2" style="font-size:13px">${a.paused ? 'paused' : 'running'}</span></div><div class="cnt num">${esc(cnt)}</div><div class="body">${body}</div></div>`;
  }

  function rows(rs) {
    return rs.map(r => {
      const icon = { bought: ['#0a84ff', '↓'], sold: ['#00d35a', '↑'], stopped: ['#ff453a', '!'], rejected: ['#2c2c2e', '×'] }[r.kind] || ['#2c2c2e', '·'];
      const attr = r.kind === 'rejected' ? (r.agent === 'auditor' ? `data-audit="${r.mint}"` : `data-coin="${r.mint}"`) : `data-coin="${r.mint}"`;
      const vcls = r.kind === 'sold' ? 'up' : r.kind === 'stopped' ? 'dn' : r.kind === 'rejected' ? 't2' : '';
      return `<div class="row" ${attr}><div class="ic" style="background:${icon[0]}">${icon[1]}</div><div class="mid"><div class="tt">${esc(r.title)}</div><div class="st">${esc(r.subtitle)}</div></div><div class="rv ${vcls}">${esc(r.value)}</div></div>`;
    }).join('');
  }

  // ---------- AGENTS ----------
  async function viewAgents(soft) {
    if (!soft) V.innerHTML = `<div class="nav"><div class="title">Agents</div></div>` + [1,2,3].map(() => skel(220, 20)).join('');
    const st = await api('/api/state');
    const decs = await Promise.all(st.agents.map(a => api(`/api/agents/${a.name}/decisions`)));
    const hasOpen = st.agents.find(a => a.name === 'risk').open > 0;
    V.innerHTML = `<div class="nav"><div class="title">Agents</div></div>` + st.agents.map((a, i) => {
      const nm = a.name[0].toUpperCase() + a.name.slice(1);
      const locked = a.name === 'risk' && hasOpen;
      const count = a.name === 'scanner' ? a.count + ' pools' : a.name === 'auditor' ? a.count + ' taken apart' : a.name === 'executor' ? a.count + ' trades' : a.name === 'risk' ? a.open + ' open' : (a.last ? 'last ' + a.last.score : '0 scored');
      const d = decs[i].rows;
      return `<div class="full"><div class="hd"><i class="sdot ${a.paused ? 'off' : ''}"></i><b style="flex:1;font-size:18px">${nm}</b><span class="t2 num">${esc(count)}</span>
        <button class="switch ${a.paused ? '' : 'on'}" data-sw="${a.name}" ${locked ? 'disabled title="Risk is locked while a position is open"' : ''} aria-label="pause or resume ${nm}"><i></i></button></div>
        <div style="margin-top:10px">${d.length ? d.map(x => `<div class="dec"><span class="t2">${hhmm(x.ts)}</span><span>${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.symbol || x.name || (x.mint || '').slice(0, 6))}</a>` : ''} <span class="t2">${esc(x.reason || '')}</span></span><span class="${/pass|bought|sent|filled|exit/.test(x.verdict) ? 'up' : 'dn'}">${esc(x.verdict)}</span></div>`).join('') : `<div class="t2">${a.name === 'scanner' ? 'Listening for graduations' : 'Nothing yet tonight'}</div>`}</div>
        <button class="btn alt sm" style="margin-top:12px" data-settings="${a.name}">Settings</button></div>`;
    }).join('');
    V.querySelectorAll('[data-sw]').forEach(b => b.onclick = async () => {
      if (b.disabled) return;
      const on = b.classList.contains('on'); const r = await api(`/api/agents/${b.dataset.sw}/${on ? 'pause' : 'resume'}`, { method: 'POST' });
      if (r.error) toast(r.error); render(true);
    });
    V.querySelectorAll('[data-settings]').forEach(b => b.onclick = () => { S.tab = 'account'; S.jump = b.dataset.settings; render(); });
  }

  // ---------- ACTIVITY ----------
  async function viewActivity(soft) {
    if (!soft) V.innerHTML = `<div class="nav"><div class="title">Activity</div></div>` + [1,2,3,4,5,6].map(() => skel(52)).join('');
    const ac = await api('/api/activity');
    S.actRows = ac.rows; S.actNext = ac.next;
    drawAct();
  }
  function drawAct() {
    V.innerHTML = `<div class="nav"><div class="title">Activity</div></div><div class="rows">${rows(S.actRows) || '<div class="empty">Nothing yet tonight</div>'}</div>${S.actNext ? '<button class="btn alt" id="more">Load more</button>' : ''}`;
    const m = $('#more'); if (m) m.onclick = async () => { const r = await api('/api/activity?before=' + S.actNext); S.actRows = S.actRows.concat(r.rows); S.actNext = r.next; drawAct(); };
    wire();
  }

  // ---------- COIN ----------
  async function viewCoin(mint, soft) {
    if (!soft) V.innerHTML = backBar('') + skel(30) + skel(66) + skel(260) + `<div class="stats">${skel(60)}${skel(60)}${skel(60)}${skel(60)}</div>` + skel(52, 26);
    const c = await api('/api/coin/' + encodeURIComponent(mint));
    const sym = c.symbol || c.name || mint.slice(0, 6);
    const born = c.pair_created_at ? c.pair_created_at / 1000 : c.migrated_at;
    const age = born ? Math.max(0, Math.round((Date.now() / 1000 - born) / 3600)) + 'h old' : '';
    const p = c.position;
    const exitLine = p ? p.exit_line : null;
    const left = p ? Math.max(0, p.timeout_at - Date.now() / 1000) : 0;
    V.innerHTML = backBar(`${esc(c.name || sym)} ${c.mode === 'PAPER' ? '<span class="badge">PAPER</span>' : ''}`) +
      `<div class="t2" style="display:flex;gap:8px;align-items:center">${esc(sym)} · Solana${age ? ' · ' + age : ''} ${c.audit_passed != null ? `<span class="chip">⛨ ${c.audit_passed}/8</span>` : ''}</div>
      <div class="big" style="font-size:52px;margin-top:6px">${priceFmt(c.price)}</div>
      ${p ? `<div class="${p.since_entry_pct >= 0 ? 'up' : 'dn'}" style="font-size:17px">${p.since_entry_pct >= 0 ? '▲' : '▼'} ${Math.abs(p.since_entry_pct).toFixed(2)}% since entry</div>` : ''}
      <canvas class="chart" id="cc" style="height:260px"></canvas>
      <div class="stats"><div><span class="t2">Market cap</span><b>${kfmt(c.stats.market_cap)}</b></div><div><span class="t2">Liquidity</span><b>${kfmt(c.stats.liquidity_usd)}</b></div>
      <div><span class="t2">24h volume</span><b>${kfmt(c.stats.volume_h24)}</b></div><div><span class="t2">Holders</span><b>${c.stats.holders == null ? 'n/a' : c.stats.holders}</b></div></div>
      ${p ? `<div class="full"><b>Your position · ${money(p.size_usd)} in · Executor</b>
        <div class="lrow"><span>Stop line · -${p.stop_pct}%</span><span class="v">${priceFmt(p.stop_price)}</span></div>
        <div class="lrow"><span>Trail line</span><span class="v">${p.trail_line ? priceFmt(p.trail_line) : 'not on yet'}</span></div>
        <div class="lrow"><span>Time left to timeout</span><span class="v">${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m</span></div></div>` : ''}
      <a class="btn" href="${esc(c.coin_url)}" target="_blank" rel="noopener">${p ? 'Sell on FOMO' : 'Buy on FOMO'}</a>
      <button class="btn alt" data-audit="${esc(mint)}">Auditor</button>`;
    Charts.candles($('#cc'), { candles: c.candles, exitLine });
    wire();
  }

  // ---------- AUDITOR ----------
  const LAYERS = ['Mint authority', 'Freeze authority', 'Dev wallet', 'Top 10 holders', 'Liquidity', 'Pool age', 'Bundles', 'Delegations'];
  async function viewAudit(mint, soft) {
    if (!soft || !S.audit || S.audit.mint !== mint) {
      V.innerHTML = backBar('Auditor') + `<div class="discs">${[0,1,2,3,4,5,6,7].map(i => `<div class="skel" style="position:absolute;width:180px;height:30px;border-radius:50%;top:${i * 22}px"></div>`).join('')}</div>` + [1,2,3,4,5,6,7,8].map(() => skel(36)).join('');
    }
    const a = await api('/api/audit/' + encodeURIComponent(mint));
    const fresh = !S.audit || S.audit.mint !== mint;
    if (!fresh && soft) { S.audit.data = a; drawAuditText(); return; }
    S.audit = { mint, data: a, shown: 0, queue: [], beamAt: 0 };
    V.innerHTML = backBar('Auditor') + `<div class="t2" style="text-align:center">${esc(a.label)}</div>
      <div class="discs" id="discs">${[0,1,2,3,4,5,6,7].map(i => `<div class="disc" id="d${i + 1}" style="top:${i * 22}px"></div>`).join('')}<div class="beam" id="beam" style="top:-6px" hidden></div></div>
      <div id="atext"></div><div id="lrows"></div>
      <div class="lrow" style="margin-top:10px"><span>Take apart before buying</span><button class="switch ${a.enabled ? 'on' : ''}" id="aen"><i></i></button></div>
      <a class="btn" href="${esc(a.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>`;
    $('#aen').onclick = async () => {
      const on = $('#aen').classList.contains('on');
      if (on && !(confirm('Turn off the Auditor? Coins go to the Analyst without being taken apart.') && confirm('Sure? Every check is skipped until you turn it back on.'))) return;
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ key: 'auditor.enabled', value: !on }) }); $('#aen').classList.toggle('on', !on);
    };
    if (!a.layers.length) { $('#atext').innerHTML = '<div class="empty">No coin taken apart yet</div>'; drawRows([]); return; }
    a.layers.forEach(l => S.audit.queue.push(l));
    drawRows([]); playBeam();
  }
  function drawRows(shown) {
    const el = $('#lrows'); if (!el) return;
    el.innerHTML = LAYERS.map((nm, i) => { const l = shown.find(x => x.n === i + 1);
      const cls = l ? (l.pass === 1 || l.pass === true ? 'p' : l.pass === 0 || l.pass === false ? 'r' : '') : '';
      return `<div class="lrow"><span><span class="ck ${cls}">${cls === 'p' ? '✓' : cls === 'r' ? '✗' : i + 1}</span>${nm}</span><span class="v ${cls === 'r' ? 'dn' : l && l.value === 'not checked' ? 't3' : ''}">${l ? esc(l.value) : ''}</span></div>`; }).join('');
  }
  function drawAuditText() {
    const A = S.audit, a = A.data, el = $('#atext'); if (!el) return;
    if (!a.layers.length && !A.queue.length) { el.innerHTML = '<div class="empty">No coin taken apart yet</div>'; return; }
    const done = A.shown >= 8 || (A.shownRows || []).some(l => l.pass === 0 || l.pass === false);
    if (!done) { el.innerHTML = '<div class="verdict t2" style="text-align:center">taking apart...</div>'; return; }
    const red = (A.shownRows || []).find(l => l.pass === 0 || l.pass === false);
    el.innerHTML = red ? `<div class="verdict dn">Rejected · ${esc(red.value)}</div><div class="t2">Grok Bot won't buy ${esc(a.label)}</div>`
      : `<div class="verdict up">Cleared · 8/8 parts</div><div class="t2">${a.sent_size ? 'Sent to Executor · ' + money(a.sent_size) : 'Sent to Analyst'}</div>`;
  }
  function beamPush(l) {
    if (!S.audit) return;
    if (l.n === 1 || !S.audit.queue.length && S.audit.shown >= 8) { S.audit.queue = []; S.audit.shown = 0; S.audit.shownRows = []; document.querySelectorAll('.disc').forEach(d => d.className = 'disc'); }
    S.audit.queue.push({ n: l.n, name: l.name, value: l.value, pass: l.pass }); playBeam();
  }
  function playBeam() {
    const A = S.audit; if (!A || A.playing) return; A.playing = true; A.shownRows = A.shownRows || [];
    const beam = $('#beam'); if (beam) beam.hidden = RM;
    const step = () => {
      if (!S.audit || S.audit !== A || !$('#beam')) { A.playing = false; return; }
      const next = A.shown + 1;
      if (next > 8) { A.playing = false; $('#beam').hidden = true; drawAuditText(); return; }
      $('#beam').style.top = ((next - 1) * 22 + 13) + 'px';
      const l = A.queue.find(x => x.n === next);
      if (!l) { drawAuditText(); setTimeout(step, 200); return; }   // server slower: beam waits on this layer
      setTimeout(() => {
        const d = $('#d' + next); const cls = l.pass === 1 || l.pass === true ? 'p' : l.pass === 0 || l.pass === false ? 'r' : '';
        if (d) d.className = 'disc ' + cls;
        A.shown = next; A.shownRows.push(l); drawRows(A.shownRows); drawAuditText();
        setTimeout(step, RM ? 0 : 150);
      }, RM ? 0 : 350);
    };
    step();
  }

  // ---------- ACCOUNT ----------
  async function viewAccount(soft) {
    if (!soft) V.innerHTML = `<div class="nav"><div class="title">Account</div></div>` + skel(44) + skel(60) + skel(52) + skel(52) + skel(300);
    const [ac, se] = await Promise.all([api('/api/account'), api('/api/settings')]);
    const groups = {}; se.settings.forEach(s => (groups[s.group] = groups[s.group] || []).push(s));
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    V.innerHTML = `<div class="nav"><div class="title">Account</div></div>
      <div class="full"><div class="seg" id="mode"><button data-m="PAPER" class="${ac.mode === 'PAPER' ? 'on' : ''}">PAPER</button><button data-m="LIVE" class="${ac.mode === 'LIVE' ? 'on' : ''}">LIVE</button><button data-m="AUTO" class="${ac.mode === 'AUTO' ? 'on' : ''}">AUTO</button></div>
        <div class="lrow"><span>${ac.mode === 'PAPER' ? 'Paper balance' : 'Stack'}</span><span class="num">${money(ac.stack)}</span></div>
        <div class="lrow"><span>LIVE stack</span><input class="field" style="width:130px" id="stk" type="number" inputmode="decimal" value="${ac.live_stack}"></div>
        ${ac.wallet ? `<div class="lrow"><span>Desk wallet</span><span class="v mono" style="font-size:12px">${esc(ac.wallet.address.slice(0, 4) + '…' + ac.wallet.address.slice(-4))}</span></div>
        <div class="lrow"><span>Wallet</span><span class="num">${ac.wallet.sol == null ? '—' : ac.wallet.sol.toFixed(4) + ' SOL · ' + money(ac.wallet.stack_usd) + ' stack'}</span></div>
        <div class="t2" style="font-size:13px;padding:6px 0">AUTO ${ac.wallet.auto_enabled ? 'on' : 'off'} · reserve ${ac.wallet.reserve_sol} SOL · max ${ac.wallet.max_open} open · stops at -${ac.wallet.max_daily_loss_pct}% a day${ac.wallet.can_trade ? ' · ' + esc(ac.wallet.can_trade) : ''}</div>` : ''}
        ${ac.ticket_check && ac.mode !== 'AUTO' ? `<div class="t2" style="padding:8px 0;color:var(--orange)">${esc(ac.ticket_check)}</div>` : ''}</div>
      ${ac.pending_signals.length || ac.open_positions.length ? `<div class="full"><b>Taps</b>
        ${ac.pending_signals.map(s => `<div class="lrow"><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.label)} · ${money(s.size_usd)}</a><span style="display:flex;gap:6px"><button class="btn sm" data-bought="${s.id}">Bought</button><button class="btn sm alt" data-skip="${s.mint}">Skip</button></span></div>`).join('')}
        ${ac.open_positions.map(p => `<div class="lrow"><a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.label)} · ${money(p.size_usd)} in</a>${p.mode === 'LIVE' ? `<button class="btn sm" data-sold="${p.id}">Sold</button>` : '<span class="t2">PAPER</span>'}</div>`).join('')}</div>` : ''}
      <div class="full">
        <a class="lrow" href="${esc(ac.profile_url)}" target="_blank" rel="noopener"><span>Your FOMO profile</span><span class="t2">@${esc(ac.fomo_handle)} ›</span></a>
        <button class="lrow" style="width:100%" id="inv"><span>Invite a friend</span><span class="t2">›</span></button>
        <div class="lrow"><span>Discord · ${ac.notifier_connected ? 'connected' : 'not connected'}</span><button class="btn sm alt" id="tp">Send test push</button></div>
        ${STATIC ? '<div class="lrow"><span>Web push</span><span class="t2" style="font-size:13px">not on this hosting · pushes go to Discord</span></div>'
          : standalone && 'PushManager' in window ? '<div class="lrow"><span>Web push</span><button class="btn sm alt" id="wp">Enable notifications</button></div>' : ''}
        ${STATIC ? '<div class="t2" style="font-size:13px;padding:6px 0">Read-only here: settings, pause, mode and Bought/Sold/Skip go through chat. Updates every few minutes.</div>' : ''}
      </div>
      <div class="full"><b>Desk command</b><div style="display:flex;gap:8px;margin-top:10px"><input class="field" id="cmd" placeholder="status · why X · set stop to 8"><button class="btn sm" id="go">Send</button></div><pre id="cout" class="t2" style="white-space:pre-wrap;font-size:13px"></pre></div>
      ${Object.entries(groups).map(([g, ss]) => `<div class="full" id="set-${g}"><b>${g[0].toUpperCase() + g.slice(1)}</b>${ss.map(setRow).join('')}</div>`).join('')}`;
    if (S.jump) { const el = $('#set-' + S.jump); if (el) el.scrollIntoView(); S.jump = null; }
    $('#mode').onclick = async e => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
      let body = { mode: b.dataset.m }; if (b.dataset.m !== 'PAPER') { const t = prompt('Type ' + b.dataset.m + ' to confirm'); if (t !== b.dataset.m) return; body.confirm = t; }
      const r = await api('/api/mode', { method: 'POST', body: JSON.stringify(body) }); toast(r.reply); render(true); };
    $('#stk').onchange = async e => { const r = await api('/api/settings', { method: 'POST', body: JSON.stringify({ key: 'desk.live_stack_usd', value: e.target.value }) }); toast(r.error || r.ticket_check || 'Saved'); };
    $('#inv').onclick = async () => { try { if (navigator.share) { await navigator.share({ url: ac.signup_url }); return; } } catch (_) { return; } await navigator.clipboard.writeText(ac.signup_url).catch(() => {}); toast('Link copied'); };
    $('#tp').onclick = async () => { const r = await api('/api/test_push', { method: 'POST' }); toast(r.ok ? 'Test push sent' : 'Push failed'); };
    if ($('#wp')) $('#wp').onclick = () => enablePush(ac.vapid_public_key);
    const runCmd = async () => { const r = await api('/api/command', { method: 'POST', body: JSON.stringify({ text: $('#cmd').value }) }); $('#cout').textContent = r.reply; };
    $('#go').onclick = runCmd; $('#cmd').onkeydown = e => { if (e.key === 'Enter') runCmd(); };
    V.querySelectorAll('[data-bought]').forEach(b => b.onclick = async () => { await api(`/api/signals/${b.dataset.bought}/bought`, { method: 'POST' }); toast('Bought'); render(true); });
    V.querySelectorAll('[data-skip]').forEach(b => b.onclick = async () => { await api(`/api/skip/${b.dataset.skip}`, { method: 'POST' }); toast('Skipped'); render(true); });
    V.querySelectorAll('[data-sold]').forEach(b => b.onclick = async () => { await api(`/api/positions/${b.dataset.sold}/sold`, { method: 'POST' }); toast('Sold'); render(true); });
    V.querySelectorAll('[data-key]').forEach(inp => inp.onchange = async () => {
      const v = inp.type === 'checkbox' ? inp.checked : inp.value;
      const r = await api('/api/settings', { method: 'POST', body: JSON.stringify({ key: inp.dataset.key, value: v }) });
      if (r.error) { toast(r.error); render(true); return; }
      V.querySelectorAll(`[data-key="${inp.dataset.key}"]`).forEach(o => { if (o !== inp && o.type !== 'checkbox') o.value = r.new; });
      toast(r.ticket_check || 'Saved');
    });
  }
  function setRow(s) {
    const label = esc(s.key.split('.').slice(1).join('.').replace(/_/g, ' '));
    if (s.choices) {
      if (typeof s.default === 'boolean') return `<div class="set"><label>${label}<input type="checkbox" data-key="${s.key}" ${s.value ? 'checked' : ''} style="width:24px;height:24px;accent-color:#00d35a"></label></div>`;
      return `<div class="set"><label>${label}<select data-key="${s.key}">${s.choices.map(c => `<option ${c === s.value ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div>`;
    }
    if (s.type) return `<div class="set"><label>${label}<input class="field" style="width:60%" data-key="${s.key}" value="${esc(s.value)}"></label></div>`;
    const span = s.max - s.min, stepv = Number.isInteger(s.default) && span > 2 ? 1 : (span / 200);
    return `<div class="set"><label>${label}<input type="number" step="any" min="${s.min}" max="${s.max}" data-key="${s.key}" value="${s.value}"></label>
      <input type="range" min="${s.min}" max="${Math.min(s.max, Math.max(s.default * 4, s.value * 2, s.min + 1))}" step="${stepv}" data-key="${s.key}" value="${s.value}"></div>`;
  }
  async function enablePush(key) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast('Notifications not allowed'); return; }
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
      await api('/api/push', { method: 'POST', body: JSON.stringify(sub.toJSON()) }); toast('Notifications on');
    } catch (e) { toast('Could not enable: ' + e.message); }
  }

  // ---------- search + bell ----------
  function sheet(html) { const s = $('#sheet'); s.innerHTML = `<div>${html}</div>`; s.hidden = false; s.onclick = e => { if (e.target === s) s.hidden = true; }; return s; }
  function search() {
    const s = sheet('<input class="field" id="q" placeholder="Name, symbol or mint" autofocus><div class="rows" id="qr"></div>');
    const q = s.querySelector('#q'); q.focus();
    q.oninput = async () => { if (q.value.length < 2) return; const r = await api('/api/search?q=' + encodeURIComponent(q.value));
      s.querySelector('#qr').innerHTML = r.rows.map(x => `<div class="row" data-m="${x.mint}"><div class="mid"><div class="tt">${esc(x.symbol || x.name)}</div><div class="st">${esc(x.mint)}</div></div></div>`).join('') || (q.value.length >= 32 ? `<div class="row" data-m="${esc(q.value)}"><div class="mid">Open ${esc(q.value.slice(0, 8))}…</div></div>` : '<div class="empty">No match</div>');
      s.querySelectorAll('[data-m]').forEach(r => r.onclick = () => { s.hidden = true; go('coin', r.dataset.m); }); };
  }
  async function bell() {
    const r = await api('/api/pushes');
    sheet(`<b>Pushes</b><div class="rows">${r.rows.map(p => `<a class="row" href="${esc(p.link)}" target="_blank" rel="noopener"><div class="mid"><div class="tt">${esc(p.text)}</div><div class="st">${hhmm(p.ts)} · ${esc(p.channel)}</div></div></a>`).join('') || '<div class="empty">Nothing yet tonight</div>'}</div>`);
    if (S.state) { S.state.unread = 0; const d = $('#bdot'); if (d) d.hidden = true; }
  }

  const qp = new URLSearchParams(location.search);
  if (qp.get('coin')) S.stack.push({ view: 'coin', arg: qp.get('coin') });
  if (qp.get('audit')) S.stack.push({ view: 'audit', arg: qp.get('audit') });
  if (qp.get('tab')) S.tab = qp.get('tab');
  render(); sse();
  setInterval(() => { if (!S.stack.length && S.tab === 'home') render(true); }, 30000);
})();
