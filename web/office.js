// Agent Office: mission control, fed by /events (SSE). Everything is drawn in code.
{
  const KC = { start: '#6fa3b5', think: '#b48cff', read: '#5aa9ff', edit: '#3cf0b4', bash: '#e8e36a', web: '#ff8fc7', agent: '#7ee0ff', ask: '#ff8a3d', error: '#ff4d5e', idle: '#4a6470', gone: '#0b2029' };
  const KN = { start: 'starting', think: 'thinking', read: 'reading', edit: 'writing', bash: 'terminal', web: 'searching the web', agent: 'subagent at work', ask: 'waiting for you', error: 'error', idle: 'idle', gone: 'closed' };
  const CLIENT = { cli: { n: 'Terminal', c: '#3cf0b4' }, app: { n: 'Claude app', c: '#ffb27a' }, cursor: { n: 'Cursor', c: '#5aa9ff' }, 'cursor-cli': { n: 'Cursor CLI', c: '#c9a6ff' } };
  const SHIRTS = ['#e85d75', '#3fa7d6', '#9b5de5', '#59cd90', '#f6ae2d', '#f26419', '#00bbf9', '#ef476f', '#7bdff2', '#c77dff', '#ffd166', '#06d6a0'];
  const HAIR = ['#2b1d14', '#d8b04a', '#a83a2a', '#6b3e1f', '#3a3a3a', '#e6e2d6', '#4a2a6b', '#1a1a1a'];
  const SKIN = ['#f1c27d', '#ffdbac', '#e0ac69', '#c68642', '#8d5524'];
  const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const lookOf = (id) => { const h = hash(id); return [SHIRTS[h % SHIRTS.length], HAIR[(h >>> 8) % HAIR.length], SKIN[(h >>> 16) % SKIN.length]]; };

  // ── data ──────────────────────────────────────────────────────
  const AG = new Map(); // id → agent
  const desks = []; // index → id
  let offset = 0, connected = false, lastHook = 0, gotData = false, firstAt = 0;
  const now = () => Date.now() + offset;
  const deskFor = (id) => { let i = desks.indexOf(id); if (i < 0) { i = desks.indexOf(undefined); if (i < 0) i = desks.length; desks[i] = id; } return i; };

  function ingest(d) {
    offset = d.now - Date.now(); lastHook = d.lastHook || 0; if (!gotData) firstAt = performance.now(); gotData = true;
    const seen = new Set();
    for (const s of d.sessions) {
      seen.add(s.id);
      let a = AG.get(s.id);
      if (!a) { a = { key: s.id, look: lookOf(s.id), desk: deskFor(s.id) }; AG.set(s.id, a); }
      Object.assign(a, { name: s.name, client: CLIENT[s.client] ? s.client : 'cli', project: s.project, kind: s.kind, txt: s.txt, since: s.since, recent: s.recent, history: s.history, subs: s.subs, guess: s.guess, removeAt: 0 });
    }
    for (const a of AG.values()) if (!seen.has(a.key) && !a.removeAt) { a.kind = 'gone'; a.txt = ''; a.removeAt = now() + 8000; a.history = [...(a.history || []), { t: now(), kind: 'gone' }]; }
  }
  function prune() {
    const t = now();
    for (const [id, a] of AG) if (a.removeAt && t > a.removeAt) { AG.delete(id); desks[desks.indexOf(id)] = undefined; delete pos[id]; }
    while (desks.length && desks.at(-1) === undefined) desks.pop();
  }
  const kindAt = (a, T) => { const h = a.history || []; let k = null; for (const e of h) { if (e.t <= T) k = e.kind; else break; } return k; };
  const list = () => [...AG.values()].sort((u, v) => u.desk - v.desk);

  function connect() {
    const es = new EventSource('/events');
    es.onopen = () => { connected = true; };
    es.onmessage = (e) => { connected = true; try { ingest(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    es.onerror = () => { connected = false; };
  }
  connect();

  // No break room: idle agents stay at their console with a coffee.
  const zoneOf = (k) => (k === 'gone' ? null : k === 'start' ? 'door' : 'desk');
  function update() {
    prune();
    let door = 0; const t = now();
    for (const a of list()) {
      a.into = Math.max(0, (t - a.since) / 1000);
      a.zone = zoneOf(a.kind);
      a.slot = a.zone === 'door' ? door++ : a.desk;
    }
  }
  const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
  const mmss = (s) => s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s / 60) % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ── layout (grows with the number of sessions) ───────────────
  const W = 400, rowH = 7.6;
  let H = 250, CORR = 238, dy = 0, CON = [], wallRows = 8;
  function layout() {
    const n = AG.size;
    wallRows = Math.max(8, Math.min(n, 24));
    dy = Math.max(0, 19 + wallRows * rowH + 13.2 - 93);
    const nd = Math.max(8, Math.ceil(desks.length / 4) * 4), rows = nd / 4;
    H = 250 + dy + (rows - 2) * 54; CORR = H - 12;
    CON = Array.from({ length: nd }, (_, i) => ({ x: [86, 166, 246, 326][i % 4], y: 142 + dy + Math.floor(i / 4) * 54 }));
  }
  layout();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pos = {}; let frames = 0;
  const door = () => ({ key: 'door', pts: [{ x: 14, y: CORR }, { x: -8, y: CORR }] });
  const place = (a) => {
    if (a.zone === 'desk') { const k = CON[a.desk]; return { key: 'd' + a.desk + ':' + H, pts: [{ x: k.x + 36, y: CORR }, { x: k.x + 36, y: k.y + 12 }, { x: k.x, y: k.y + 12 }] }; }
    if (a.zone === 'door') return { key: 'q' + a.slot + ':' + H, pts: [{ x: 14, y: CORR }, { x: 14, y: CORR - 16 - a.slot * 16 }] };
    return null;
  };
  function go(a, pl, dt) {
    let p = pos[a.key];
    const tgt = pl || door();
    if (!p) {
      if (!pl) return null;
      const start = performance.now() - firstAt < 400 ? pl : door(), s = start.pts[start.pts.length - 1];
      p = pos[a.key] = { x: s.x, y: s.y, at: start, path: [], moving: false };
    }
    if (p.at.key !== tgt.key) {
      // Layout changed (same spot, different height): jump there instead of walking.
      if (p.at.key.split(':')[0] === tgt.key.split(':')[0]) { const e = tgt.pts.at(-1); p.x = e.x; p.y = e.y; p.path = []; }
      else p.path = [...p.at.pts.slice(0, -1).reverse(), ...tgt.pts];
      p.at = tgt;
    }
    let step = reduced ? 1e9 : 46 * dt;
    while (p.path.length && step > 0) {
      const w = p.path[0], dx = w.x - p.x, dy2 = w.y - p.y, d = Math.hypot(dx, dy2);
      if (d <= step) { p.x = w.x; p.y = w.y; step -= d; p.path.shift(); } else { p.x += (dx / d) * step; p.y += (dy2 / d) * step; step = 0; }
    }
    p.moving = p.path.length > 0;
    if (!pl && !p.moving) { delete pos[a.key]; return null; }
    return p;
  }
  const SCR = { think: 'THINKING', read: 'READING', edit: 'WRITING', bash: 'TERMINAL', web: 'WEB', agent: 'SUBAGENT', ask: 'NEEDS YOU', error: 'ERROR', idle: 'IDLE' };
  const wrap = (txt, n) => {
    const out = ['']; for (let w of String(txt || '').split(' ')) { while (w.length > n) { if (out.at(-1)) out.push(''); out[out.length - 1] = w.slice(0, n); out.push(''); w = w.slice(n); } const cur = out.at(-1); if ((cur + ' ' + w).trim().length > n) out.push(w); else out[out.length - 1] = (cur + ' ' + w).trim(); }
    const lines = out.filter(Boolean); if (lines.length > 2) lines[1] = lines[1].slice(0, n - 1) + '…'; return lines.slice(0, 2);
  };
  const mono = (c, px, w = 600) => { c.font = `${w} ${px}px ui-monospace, Menlo, Consolas, monospace`; };
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
  function glyph(c, client, x, y, s = 1) {
    const col = CLIENT[client].c;
    c.save(); c.translate(x, y); c.scale(s, s); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 0.7;
    if (client === 'cli') { rr(c, 0, 0, 6.5, 5, 1); c.stroke(); c.beginPath(); c.moveTo(1.3, 1.4); c.lineTo(2.6, 2.5); c.lineTo(1.3, 3.6); c.stroke(); c.fillRect(3.2, 3.3, 2, 0.6); }
    else if (client === 'cursor') { c.beginPath(); c.moveTo(0.5, 0); c.lineTo(5.6, 2.6); c.lineTo(3, 3.2); c.lineTo(1.8, 5.4); c.closePath(); c.fill(); }
    else if (client === 'cursor-cli') { rr(c, 0, 0, 6.5, 5, 1); c.stroke(); c.beginPath(); c.moveTo(1.6, 1); c.lineTo(4.6, 2.4); c.lineTo(2.9, 2.8); c.lineTo(2.2, 4.2); c.closePath(); c.fill(); }
    else { rr(c, 0, 0, 6.5, 5, 1); c.stroke(); c.fillRect(0, 0, 6.5, 1.4); }
    c.restore();
  }
  function screenArt(c, a, x, y, w, h, t, i) {
    const col = KC[a.kind];
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 0.9;
    const wave = (amp, fr, sp, jag) => { c.beginPath(); for (let s = 0; s <= w; s += 0.7) { let v = Math.sin(s * fr + t * sp + i) * amp; if (jag) v *= s % 3 < 1.5 ? 1 : -1; const yy = y + h / 2 + v; s ? c.lineTo(x + s, yy) : c.moveTo(x + s, yy); } c.stroke(); };
    if (a.kind === 'think') wave(4.5, 0.28, 1.4);
    else if (a.kind === 'read') { const o = (t * 8) % 3; for (let l = -1; l < 6; l++) c.fillRect(x + 2, y + 1 + l * 3 - o, 4 + ((l * 7 + Math.floor(t * 8 / 3)) % 10), 1); }
    else if (a.kind === 'edit') { wave(3, 0.9, 6); if (Math.floor(t * 3) % 2) c.fillRect(x + w - 3, y + 2, 1, h - 4); }
    else if (a.kind === 'bash') { mono(c, 3.2, 700); c.textBaseline = 'top'; c.fillText('$_', x + 1.5, y + 1.5); const o = (t * 6) % 3; for (let l = 0; l < 4; l++) c.fillRect(x + 2, y + 6 + l * 2.6 - o * 0.3, 3 + ((l * 5 + Math.floor(t * 2)) % 11), 0.8); }
    else if (a.kind === 'web') { const cx = x + w / 2, cy = y + h / 2; c.beginPath(); c.arc(cx, cy, 5.5, 0, 7); c.stroke(); c.beginPath(); c.ellipse(cx, cy, Math.abs(Math.cos(t * 2)) * 5.5, 5.5, 0, 0, 7); c.stroke(); c.beginPath(); c.moveTo(cx - 5.5, cy); c.lineTo(cx + 5.5, cy); c.stroke(); }
    else if (a.kind === 'agent') { const p = (t * 1.5) % 1; c.beginPath(); c.arc(x + 4, y + h / 2, 2, 0, 7); c.fill(); c.beginPath(); c.arc(x + w - 4, y + h / 2, 2, 0, 7); c.fill(); c.beginPath(); c.moveTo(x + 6, y + h / 2); c.lineTo(x + w - 6, y + h / 2); c.stroke(); c.fillRect(x + 6 + p * (w - 13), y + h / 2 - 1, 2, 2); }
    else if (a.kind === 'ask') { if (Math.floor(t * 2.5) % 2) { c.font = `800 ${h * 0.9}px Manrope, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', x + w / 2, y + h / 2 + 0.5); c.textAlign = 'left'; } }
    else if (a.kind === 'error') wave(5, 1.4, 10, true);
    else { c.beginPath(); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.stroke(); }
    c.restore();
  }
  function beacon(c, x, y, col, t) {
    const on = Math.floor(t * 4) % 2;
    c.fillStyle = on ? col : '#2a1a14'; c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill();
    if (on) { const g = c.createRadialGradient(x, y, 1, x, y, 20); g.addColorStop(0, col + '66'); g.addColorStop(1, col + '00'); c.fillStyle = g; c.fillRect(x - 20, y - 20, 40, 40); }
  }
  function standing(c, x, y, lk, o = {}) {
    const [shirt, hair, skin] = lk, sc = o.scale || 1, bob = o.walk ? Math.abs(Math.sin(o.t * 9)) * 1.2 : 0;
    c.save(); c.translate(x, y); c.scale(sc, sc); c.globalAlpha = o.alpha ?? 1;
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(0, 0, 5, 1.6, 0, 0, 7); c.fill();
    c.fillStyle = shirt; rr(c, -4.5, -13 - bob, 9, 12, 3); c.fill();
    c.fillStyle = skin; c.beginPath(); c.arc(0, -16.5 - bob, 3.6, 0, 7); c.fill();
    c.fillStyle = hair; c.beginPath(); c.arc(0, -17.5 - bob, 3.6, Math.PI, 0); c.fill();
    c.restore();
  }

  const hits = [], labels = [];
  function draw(c, t, dt) {
    hits.length = 0; labels.length = 0;
    const agents = list(), T0 = now();
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#071016'); g.addColorStop(1, '#0f1d26');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(60,240,180,.05)'; c.lineWidth = 0.5;
    for (let x = -300; x < W + 300; x += 26) { c.beginPath(); c.moveTo(200 + (x - 200) * 0.4, 100 + dy); c.lineTo(x, H); c.stroke(); }

    // wall screen
    c.fillStyle = '#03101a'; c.strokeStyle = '#1e3a47'; c.lineWidth = 1.2; rr(c, 10, 5, 380, 88 + dy, 4); c.fill(); c.stroke();
    mono(c, 4.4, 700); c.fillStyle = '#5ad1b0'; c.textBaseline = 'middle'; c.fillText('ACTIVITY · LAST 60 S', 18, 12.5);
    const tx = 72, tw = 186, span = 60_000;
    if (!agents.length) { mono(c, 4.4); c.fillStyle = '#3d7f70'; c.fillText(gotData ? 'no agents active on this machine' : 'connecting to Agent Office…', 18, 26); }
    agents.slice(0, wallRows).forEach((a, r) => {
      const y = 19 + r * rowH, live = !!a.zone;
      glyph(c, a.client, 18, y + 1.2, 0.8);
      mono(c, 4.3, 600); c.fillStyle = live ? '#cfeee6' : '#3a5a5a'; c.fillText(String(a.name).slice(0, 14), 25, y + rowH / 2 - 0.4);
      c.fillStyle = '#0a1d26'; c.fillRect(tx, y + 0.8, tw, rowH - 2.2);
      for (let s = 0; s < tw; s += 1.25) {
        const k = kindAt(a, T0 - span + (s / tw) * span);
        if (!k || k === 'gone') continue;
        c.fillStyle = KC[k] || KC.idle; c.globalAlpha = k === 'idle' ? 0.55 : 0.85; c.fillRect(tx + s, y + 0.8, 1.35, rowH - 2.2);
      }
      c.globalAlpha = 1;
      if (live && a.zone === 'desk' && a.kind !== 'idle') { c.fillStyle = `rgba(255,255,255,${0.4 + 0.4 * Math.sin(t * 5)})`; c.fillRect(tx + tw - 1.4, y + 0.8, 1.4, rowH - 2.2); }
    });
    if (agents.length > wallRows) { mono(c, 3.6); c.fillStyle = '#3d7f70'; c.fillText(`+${agents.length - wallRows} more, see the table`, 25, 19 + wallRows * rowH + 1); }
    const lineEnd = 81 + dy;
    c.strokeStyle = '#2de2b0'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(tx + tw, 17); c.lineTo(tx + tw, lineEnd); c.stroke();
    mono(c, 3.6); c.fillStyle = '#3d7f70'; c.textAlign = 'right'; c.fillText('now', tx + tw - 2, 12.5); c.textAlign = 'left';

    // waiting for you
    const waiting = agents.filter((a) => a.kind === 'ask').sort((u, v) => u.since - v.since);
    const maxW = Math.max(1, Math.floor((72 + dy - 14) / 19));
    c.fillStyle = '#0a2430'; rr(c, 266, 9, 120, 72 + dy, 2); c.fill();
    mono(c, 4.6, 800); c.fillStyle = waiting.length ? '#ff8a3d' : '#5ad1b0'; c.fillText(`WAITING FOR YOU · ${waiting.length}`, 271, 15);
    if (!waiting.length) { mono(c, 4.2); c.fillStyle = '#3d7f70'; c.fillText('nobody is waiting for you', 271, 26); }
    waiting.slice(0, maxW).forEach((a, i) => {
      const y = 22 + i * 19;
      c.fillStyle = `rgba(255,138,61,${a.guess ? 0.4 : 0.55 + 0.45 * Math.sin(t * 4 + i)})`; c.fillRect(271, y, 1.6, 15);
      glyph(c, a.client, 275, y + 0.8, 0.75);
      mono(c, 4.4, 700); c.fillStyle = '#ffe3cf'; c.fillText(String(a.name).slice(0, 17), 281.5, y + 3.2);
      c.textAlign = 'right'; c.fillStyle = '#ff8a3d'; c.fillText(mmss(a.into), 382, y + 3.2); c.textAlign = 'left';
      c.font = '600 4.3px Manrope, system-ui, sans-serif'; c.fillStyle = a.guess ? '#b39a88' : '#d9c3b3';
      const q = `${a.project} · ${a.txt || ''}`; c.fillText(q.length > 34 ? q.slice(0, 33) + '…' : q, 275, y + 10.5);
    });
    if (waiting.length > maxW) { mono(c, 3.8); c.fillStyle = '#ff8a3d'; c.fillText(`+${waiting.length - maxW} more`, 275, 22 + maxW * 19 + 1); }
    const fy = 87 + dy;
    let cx = 18; c.textBaseline = 'middle';
    Object.keys(CLIENT).forEach((k) => { const n = agents.filter((a) => a.client === k && a.zone).length; glyph(c, k, cx, fy - 2, 0.75); mono(c, 4.2, 600); c.fillStyle = n ? '#9fe8d2' : '#3d7f70'; const s = `${CLIENT[k].n} ${n}`; c.fillText(s, cx + 6.5, fy); cx += c.measureText(s).width + 13; });
    const subs = agents.reduce((n, a) => n + (a.zone ? a.subs || 0 : 0), 0);
    c.fillStyle = subs ? '#7ee0ff' : '#3d7f70'; c.fillText(`subagents ${subs}`, cx, fy);
    c.textAlign = 'right'; c.fillStyle = '#3d7f70'; c.fillText(clock(), 384, fy); c.textAlign = 'left';

    // door
    const top = 112 + dy;
    c.fillStyle = '#0b1820'; c.fillRect(4, top, 20, H - top); c.fillStyle = '#3cf0b4'; c.fillRect(10, top - 4, 8, 2);

    // consoles
    CON.forEach((k, i) => {
      const a = AG.get(desks[i]), here = a && a.zone === 'desk' && pos[a.key] && !pos[a.key].moving;
      const x = k.x, y = k.y;
      for (const [sx, sw] of [[-27, 19], [-6, 33]]) { c.fillStyle = '#020a0e'; c.strokeStyle = '#1e3a47'; c.lineWidth = 0.8; rr(c, x + sx, y - 31, sw, 17, 1.5); c.fill(); c.stroke(); }
      if (here) {
        screenArt(c, a, x - 26, y - 30, 17, 15, t, i);
        mono(c, 3.6, 800); c.fillStyle = KC[a.kind]; c.textBaseline = 'top'; c.fillText(a.guess ? 'WAITING?' : SCR[a.kind] || '', x - 4.5, y - 28.5);
        mono(c, 3.5, 500); c.fillStyle = '#cfeee6';
        wrap(a.txt, 15).forEach((w, l) => c.fillText(w, x - 4.5, y - 23 + l * 4.2));
        c.textBaseline = 'middle';
      }
      c.fillStyle = '#16232c'; c.beginPath(); c.moveTo(x - 30, y - 13); c.lineTo(x + 30, y - 13); c.lineTo(x + 28, y - 6); c.lineTo(x - 28, y - 6); c.fill();
      c.fillStyle = '#2a3c47'; c.fillRect(x - 30, y - 13.6, 60, 0.8);
      if (a) {
        glyph(c, a.client, x - 26, y - 11.6, 0.7);
        c.font = '700 3.8px Manrope, system-ui, sans-serif'; c.fillStyle = here ? CLIENT[a.client].c : '#36525c'; c.fillText(String(a.project).slice(0, 22), x - 20.5, y - 9.6);
      }
      if (here && a.kind === 'ask') beacon(c, x + 28, y - 33, '#ff8a3d', a.guess ? t / 2 : t);
      if (here && a.kind === 'error') beacon(c, x + 28, y - 33, '#ff4d5e', t);
    });

    // people
    const people = agents.map((a) => ({ a, p: go(a, place(a), dt) })).filter((o) => o.p).sort((u, v) => u.p.y - v.p.y);
    for (const { a, p } of people) {
      const [shirt, hair, skin] = a.look;
      if (a.zone === 'desk' && !p.moving) {
        const y = p.y - 6;
        c.fillStyle = '#1b2a33'; rr(c, p.x - 7, y - 2, 14, 10, 3); c.fill();
        if (a.kind === 'ask') { const wv = Math.sin(t * 6) * 0.25; c.save(); c.translate(p.x + 5, y - 2); c.rotate(-0.35 + wv); c.fillStyle = shirt; rr(c, -1.3, -11, 2.6, 11, 1.2); c.fill(); c.fillStyle = skin; c.beginPath(); c.arc(0, -11.5, 1.6, 0, 7); c.fill(); c.restore(); }
        else if (a.kind === 'idle') { // coffee break at the console
          const cx2 = p.x + 6, cy2 = y - 5;
          c.fillStyle = '#e9edf3'; c.fillRect(cx2, cy2, 3, 3.5); c.strokeStyle = '#e9edf3'; c.lineWidth = 0.5; c.beginPath(); c.arc(cx2 + 3.3, cy2 + 1.7, 1, -1.4, 1.4); c.stroke();
          c.fillStyle = skin; c.fillRect(cx2 - 1.6, cy2 + 1.2, 1.8, 1.6);
          if (!reduced) for (let w = 0; w < 2; w++) { const k = (t * 1.1 + w * 0.5) % 1; c.fillStyle = `rgba(255,255,255,${0.45 - k * 0.45})`; c.fillRect(cx2 + 0.8 + w * 1.2, cy2 - 1.5 - k * 5, 0.7, 1.8); }
        }
        else if (['edit', 'bash'].includes(a.kind)) { const tap = Math.floor(t * 9) % 2; c.fillStyle = skin; c.fillRect(p.x - 7, y - 4 - tap, 2.2, 1.6); c.fillRect(p.x + 4.8, y - 3 - (1 - tap), 2.2, 1.6); }
        c.fillStyle = shirt; c.beginPath(); c.ellipse(p.x, y, 7, 4.5, 0, Math.PI, 0); c.fill();
        const tilt = a.kind === 'think' && !reduced ? Math.sin(t * 1.2) * 0.8 : 0;
        c.fillStyle = hair; c.beginPath(); c.arc(p.x + tilt, y - 7, 4, 0, 7); c.fill();
        c.strokeStyle = '#d8e3ea'; c.lineWidth = 0.9; c.beginPath(); c.arc(p.x + tilt, y - 7, 4.6, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
        c.fillStyle = '#d8e3ea'; c.fillRect(p.x - 5.2 + tilt, y - 8, 1.4, 3); c.fillRect(p.x + 3.8 + tilt, y - 8, 1.4, 3);
        if (a.kind === 'think') for (let d = 0; d < 3; d++) { c.fillStyle = `rgba(180,140,255,${0.35 + 0.65 * ((Math.floor(t * 3) % 3) === d)})`; c.beginPath(); c.arc(p.x + 7 + d * 2.6, y - 13 - d * 1.2, 0.9, 0, 7); c.fill(); }
        if (a.subs > 0 || a.kind === 'agent') {
          const k = CON[a.desk], appear = 1, n = Math.max(1, a.subs);
          standing(c, k.x + 36, k.y + 14, [shirt + 'cc', hair, skin], { scale: 0.78, alpha: appear, t });
          mono(c, 3.4, 700); c.fillStyle = '#7ee0ff'; c.textAlign = 'center'; c.fillText(n > 1 ? `sub ×${n}` : 'sub', k.x + 36, k.y + 17.5); c.textAlign = 'left';
          c.strokeStyle = 'rgba(126,224,255,.5)'; c.setLineDash([1, 1.2]); c.lineWidth = 0.5; c.beginPath(); c.moveTo(p.x + 7, y - 2); c.lineTo(k.x + 32, k.y + 2); c.stroke(); c.setLineDash([]);
        }
        hits.push({ x: p.x - 8, y: y - 13, w: 16, h: 20, a });
        labels.push({ a, x: p.x, y: y - 13, full: true });
      } else {
        standing(c, p.x, p.y, a.look, { walk: p.moving, t });
        hits.push({ x: p.x - 6, y: p.y - 21, w: 12, h: 21, a });
        labels.push({ a, x: p.x, y: p.y - 21, full: false });
      }
    }
  }

  // ── canvas, labels, tooltip ───────────────────────────────────
  const view = document.getElementById('view'), cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  let hover = null, pinned = null, last = performance.now(), frame = 0, s = 1, shownH = 0;
  const labelOf = (a) => (a.kind === 'ask' ? (a.guess ? 'seems to be waiting' : 'waiting for you') : KN[a.kind]);
  function overlay(dpr, cw) {
    const fs = Math.round(Math.max(10, Math.min(12, 11 * (cw / dpr) / 1000)) * dpr), bw = Math.max(1, Math.round(1.3 * dpr));
    const hot = (L) => L.a.key === hover || L.a.key === pinned;
    const placed = [], over = (x, y, w, h) => placed.some((q) => x < q.x + q.w && q.x < x + w && y < q.y + q.h && q.y < y + h);
    ctx.font = `700 ${fs}px ui-monospace, Menlo, monospace`; ctx.textBaseline = 'middle';
    [...labels].sort((u, v) => hot(u) - hot(v) || v.full - u.full || u.y - v.y).forEach((L) => {
      const a = L.a, hv = hot(L), h = fs * 1.6, tail = fs * 0.4, cx = L.x * s;
      const nm = String(a.name).slice(0, 26);
      let text = (L.full || hv) ? `${nm} · ${labelOf(a)}` : nm;
      const box = () => { const w = ctx.measureText(text).width + fs * 0.9; return [w, Math.min(cw - w - 4, Math.max(4, cx - w / 2))]; };
      let [w, x] = box(), y = Math.max(4, L.y * s - h - tail);
      if (!hv && L.full && over(x, y, w, h)) { text = nm; [w, x] = box(); }
      for (let k = 0; !hv && k < 2 && over(x, y, w, h); k++) y -= h * 0.75;
      placed.push({ x: x - 2, y: y - 2, w: w + 4, h: h + 4 });
      const col = a.kind === 'ask' ? '#ff8a3d' : a.kind === 'error' ? '#ff4d5e' : '#2de2b0';
      ctx.fillStyle = hv ? '#ffd84a' : col; rr(ctx, x - bw, y - bw, w + bw * 2, h + bw * 2, 4 * dpr + bw); ctx.fill();
      ctx.fillStyle = a.kind === 'ask' ? '#2a1408' : a.kind === 'error' ? '#2a0a10' : '#06141b'; rr(ctx, x, y, w, h, 4 * dpr); ctx.fill();
      const tx = Math.min(x + w - tail * 2, Math.max(x + tail * 2, cx));
      ctx.beginPath(); ctx.moveTo(tx - tail, y + h - 0.5); ctx.lineTo(tx + tail, y + h - 0.5); ctx.lineTo(tx, y + h + tail); ctx.fill();
      ctx.fillStyle = a.kind === 'ask' ? '#ffd2b0' : a.kind === 'error' ? '#ffb3bb' : '#bff8e6';
      ctx.fillText(text, x + fs * 0.45, y + h / 2 + 0.5);
    });
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  function tip() {
    const el = document.getElementById('tip'), key = pinned || hover, h = key && hits.find((x) => x.a.key === key);
    if (!h) { el.hidden = true; if (pinned && !AG.has(pinned)) pinned = null; return; }
    const a = h.a;
    const html = `<b>${esc(a.name)}</b> <span class="k">· ${esc(CLIENT[a.client].n)} · ${esc(a.project)}</span><br><span style="color:${KC[a.kind]};font-weight:700">${esc(labelOf(a))}</span> ${esc(a.txt)} <span class="k">(${mmss(a.into)})</span>${a.subs ? ` <span style="color:#7ee0ff">· ${a.subs} subagent${a.subs > 1 ? 's' : ''}</span>` : ''}<ol>${(a.recent || []).map((r) => `<li>${esc(KN[r.kind] || r.kind)}: ${esc(r.txt)}</li>`).join('')}</ol>`;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
    el.style.left = Math.min(84, Math.max(16, ((h.x + h.w / 2) / W) * 100)) + '%';
    el.style.top = Math.max(42 * 250 / H, (h.y / H) * 100) + '%';
  }
  const hitAt = (e) => { const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H; for (let i = hits.length - 1; i >= 0; i--) { const q = hits[i]; if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) return q.a; } return null; };
  cv.addEventListener('pointermove', (e) => { const a = hitAt(e); hover = a?.key ?? null; cv.style.cursor = a ? 'pointer' : 'default'; });
  cv.addEventListener('pointerleave', () => { hover = null; });
  cv.addEventListener('click', (e) => { const a = hitAt(e); pinned = a && pinned !== a.key ? a.key : null; });

  document.getElementById('legend').innerHTML = ['think', 'read', 'edit', 'bash', 'web', 'agent', 'ask', 'error', 'idle']
    .map((k) => `<div><span class="dot" style="background:${KC[k]}"></span><span><dt>${KN[k][0].toUpperCase() + KN[k].slice(1)}</dt><dd>${({ think: 'thinking or writing a reply', read: 'reading or searching files', edit: 'writing or changing files', bash: 'running a command', web: 'searching or fetching a page', agent: 'a helper joined; stands next to the console', ask: 'needs permission or an answer: orange beacon and a raised hand. "Seems to be waiting" is a guess (no hook)', error: 'something went wrong: red beacon', idle: 'session open, turn done: coffee at the console' })[k]}</dd></span></div>`).join('');

  function table() {
    const order = { ask: 0, error: 1, idle: 3, gone: 4 };
    const rows = [...AG.values()].sort((u, v) => (order[u.kind] ?? 2) - (order[v.kind] ?? 2) || u.desk - v.desk)
      .map((a) => `<tr class="${a.kind === 'ask' ? 'ask' : a.kind === 'error' ? 'err' : a.kind === 'gone' ? 'gone' : ''}"><td><b>${esc(a.name)}</b></td><td><span class="chip">${esc(CLIENT[a.client].n)}</span></td><td>${esc(a.project)}</td><td><span class="chip"><span class="dot" style="background:${KC[a.kind]}"></span>${esc(labelOf(a))}</span></td><td>${esc(a.txt || '–')}</td><td class="t">${a.kind === 'gone' ? '–' : mmss(a.into || 0)}</td></tr>`).join('')
      || `<tr><td class="empty" colspan="6">${gotData ? 'No running agent sessions on this machine.' : 'Connecting…'}</td></tr>`;
    const tb = document.getElementById('rows'); if (tb.innerHTML !== rows) tb.innerHTML = rows;
    tb.querySelectorAll('td').forEach((td) => { td.dataset.l = td.closest('table').rows[0].cells[td.cellIndex]?.textContent || ''; });
    const n = [...AG.values()].filter((a) => a.kind !== 'gone').length, w = [...AG.values()].filter((a) => a.kind === 'ask').length;
    const hooks = lastHook && now() - lastHook < 30 * 60_000;
    document.getElementById('status').textContent = connected ? `connected · ${n} session${n === 1 ? '' : 's'} · ${w} waiting for you · hooks ${hooks ? 'active' : 'not seen (waiting is guessed)'}` : 'lost connection to the server, retrying…';
    document.getElementById('conn-dot').style.background = !connected ? '#ff4d5e' : w ? '#ff8a3d' : '#3cf0b4';
    const title = w ? `(${w}) Agent Office` : 'Agent Office';
    if (document.title !== title) document.title = title;
  }
  function loop(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs; frame++;
    update(); layout();
    if (H !== shownH) { shownH = H; view.style.aspectRatio = `${W}/${H}`; view.style.maxWidth = `calc(86vh * ${W / H})`; }
    const dpr = Math.min(2, devicePixelRatio || 1), cw = Math.max(1, Math.round(cv.clientWidth * dpr)), ch = Math.round((cw * H) / W);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    s = cw / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    try { draw(ctx, reduced ? 0 : nowMs / 1000, dt); } catch (err) { if (frame < 3) console.error(err); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    overlay(dpr, cw);
    frames++; tip();
    if (frame % 15 === 1) table();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
