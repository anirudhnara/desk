/* Canvas charts, devicePixelRatio aware. No libraries. */
(function () {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    return { c, w, h };
  }
  const COL = { bought: '#0a84ff', sold: '#00d35a', stopped: '#ff453a' };

  function line(cv, d, prev) {
    const st = cv._st || (cv._st = { seen: new Set(), anim: 0 });
    const draw = (slide, fade) => {
      const { c, w, h } = setup(cv);
      const pts = d.points || [];
      const top = 64, bot = h - 8;
      if (!pts.length || !d.trades) {
        c.setLineDash([4, 5]); c.strokeStyle = 'rgba(235,235,245,0.3)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke(); c.setLineDash([]);
        c.fillStyle = 'rgba(235,235,245,0.6)'; c.font = '15px -apple-system,system-ui'; c.textAlign = 'center';
        c.fillText('Waiting for the first trade', w / 2, h / 2 - 14); return;
      }
      let t0 = pts[0].ts, t1 = pts[pts.length - 1].ts; if (t1 === t0) t1 = t0 + 60;
      let lo = Math.min(d.start, ...pts.map(p => p.value)), hi = Math.max(d.start, ...pts.map(p => p.value));
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      const X = t => (t - t0) / (t1 - t0) * w, Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
      // dashed start line
      c.setLineDash([4, 5]); c.strokeStyle = 'rgba(235,235,245,0.3)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, Y(d.start)); c.lineTo(w, Y(d.start)); c.stroke(); c.setLineDash([]);
      const P = pts.map((p, i) => [X(p.ts), Y(p.value)]);
      if (slide < 1 && P.length > 1) { const a = P[P.length - 2], b = P[P.length - 1]; P[P.length - 1] = [a[0] + (b[0] - a[0]) * slide, a[1] + (b[1] - a[1]) * slide]; }
      const g = c.createLinearGradient(0, top, 0, bot); g.addColorStop(0, 'rgba(0,211,90,0.28)'); g.addColorStop(1, 'rgba(0,211,90,0)');
      c.beginPath(); P.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
      c.lineTo(P[P.length - 1][0], bot); c.lineTo(P[0][0], bot); c.closePath(); c.fillStyle = g; c.fill();
      c.beginPath(); P.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
      c.strokeStyle = '#00d35a'; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
      // marks above the line; a later mark that would overlap moves up a row
      c.font = '600 12px -apple-system,system-ui'; c.textAlign = 'left';
      const placed = [];
      (d.marks || []).filter(m => m.ts >= t0 && m.ts <= t1).forEach(m => {
        const tw = c.measureText(m.text).width + 14, x = Math.min(Math.max(0, X(m.ts) - tw / 2), w - tw);
        let row = 0; while (placed.some(p => p.row === row && x < p.x + p.w + 4 && p.x < x + tw + 4)) row++;
        placed.push({ x, w: tw, row });
        const y = 6 + row * 24; const key = m.ts + m.text;
        c.globalAlpha = st.seen.has(key) ? 1 : fade;
        c.fillStyle = COL[m.kind] || '#fff'; roundRect(c, x, y, tw, 20, 10); c.fill();
        c.fillStyle = m.kind === 'bought' ? '#fff' : '#000'; c.fillText(m.text, x + 7, y + 14);
        c.globalAlpha = 1;
      });
    };
    const fresh = (d.marks || []).some(m => !st.seen.has(m.ts + m.text));
    const grew = prev && d.points && prev.points && d.points.length > prev.points.length;
    if (RM || (!fresh && !grew)) { draw(1, 1); (d.marks || []).forEach(m => st.seen.add(m.ts + m.text)); return; }
    const s0 = performance.now();
    cancelAnimationFrame(st.anim);
    const step = now => { const k = now - s0; draw(grew ? Math.min(1, k / 250) : 1, Math.min(1, k / 200));
      if (k < 250) st.anim = requestAnimationFrame(step); else (d.marks || []).forEach(m => st.seen.add(m.ts + m.text)); };
    st.anim = requestAnimationFrame(step);
  }

  function candles(cv, d) {
    const { c, w, h } = setup(cv);
    const cs = (d.candles || []).slice(-60);
    if (!cs.length) { c.fillStyle = 'rgba(235,235,245,0.6)'; c.font = '15px -apple-system,system-ui'; c.textAlign = 'center'; c.fillText('Waiting for prices', w / 2, h / 2); return; }
    const vh = h * 0.18, top = 8, bot = h - vh - 10;
    let lo = Math.min(...cs.map(x => x.l)), hi = Math.max(...cs.map(x => x.h));
    if (d.exitLine) { lo = Math.min(lo, d.exitLine); hi = Math.max(hi, d.exitLine); }
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    const Y = v => bot - (v - lo) / (hi - lo) * (bot - top), bw = w / 60, vmax = Math.max(1e-9, ...cs.map(x => x.v || 0));
    cs.forEach((k, i) => {
      const x = w - (cs.length - i) * bw + bw / 2, up = k.c >= k.o, col = up ? '#00d35a' : '#ff453a';
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, Y(k.h)); c.lineTo(x, Y(k.l)); c.stroke();
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)); c.fillRect(x - bw * 0.35, y1, bw * 0.7, Math.max(1, y2 - y1));
      c.globalAlpha = 0.4; const vv = (k.v || 0) / vmax * vh; c.fillRect(x - bw * 0.35, h - vv, bw * 0.7, vv); c.globalAlpha = 1;
    });
    if (d.exitLine) {
      c.setLineDash([6, 4]); c.strokeStyle = '#ff9f0a'; c.lineWidth = 1.5; const y = Y(d.exitLine);
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#ff9f0a'; c.font = '600 11px -apple-system,system-ui'; c.textAlign = 'left'; c.fillText('Risk trailing stop', 4, y - 5);
    }
  }

  function ring(cv, score, min) {
    const { c, w, h } = setup(cv); const r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
    c.lineWidth = 10; c.lineCap = 'round';
    c.strokeStyle = '#2c2c2e'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    if (score != null) {
      c.strokeStyle = score >= (min || 70) ? '#00d35a' : '#ffd60a';
      c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); c.stroke();
    }
    c.fillStyle = '#fff'; c.font = '600 30px -apple-system,system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(score == null ? '–' : String(score), cx, cy);
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  window.Charts = { line, candles, ring };
})();
