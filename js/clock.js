/* Badge Studio — clock faces. The preview is live; an exported loop freezes
   the time of export (the badge plays AVIs, it does not run a clock). */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { rgba } = BS.util;
  const W = 368, C = 184, TAU = Math.PI * 2;
  const FACES = [['digital', 'Digital'], ['analog', 'Analógico'], ['neon', 'Anillo neón'], ['minimal', 'Minimal'], ['flip', 'Flip'], ['binary', 'Binario']];
  const DAYS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'], MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const z = (n) => String(n).padStart(2, '0');

  function draw(ctx, t, cfg, now = new Date()) {
    const d = cfg.frozen ? new Date(cfg.frozen + t * 1000) : new Date(now.getTime());
    const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds();
    const hh = cfg.h24 === false ? ((h + 11) % 12) + 1 : h, ampm = h >= 12 ? 'PM' : 'AM';
    const c = cfg.color || '#d0f56a', c2 = cfg.color2 || '#ffffff', face = cfg.face || 'digital';
    const dateStr = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (face === 'digital' || face === 'flip') {
      const text = z(hh) + ':' + z(m);
      if (face === 'flip') {
        [z(hh), z(m)].forEach((part, i) => { const x = C + (i ? 62 : -62); ctx.fillStyle = '#1b1f1a'; ctx.beginPath(); ctx.roundRect(x - 52, C - 60, 104, 120, 14); ctx.fill(); ctx.fillStyle = rgba('#000', 0.5); ctx.fillRect(x - 52, C - 1, 104, 2); ctx.fillStyle = c2; ctx.font = '800 88px Inter,"Segoe UI",Arial,sans-serif'; ctx.fillText(part, x, C + 4); });
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(C, C - 14, 5, 0, TAU); ctx.arc(C, C + 14, 5, 0, TAU); ctx.fill();
      } else {
        ctx.font = '800 92px Inter,"Segoe UI",Arial,sans-serif'; ctx.fillStyle = c2; ctx.shadowColor = c; ctx.shadowBlur = 18; ctx.fillText(text, C, C - 6); ctx.shadowBlur = 0;
        if (cfg.showSeconds !== false) { ctx.font = '700 26px Inter,"Segoe UI",Arial,sans-serif'; ctx.fillStyle = c; ctx.fillText(z(s) + (cfg.h24 === false ? '  ' + ampm : ''), C, C + 54); }
      }
      if (cfg.showDate !== false) { ctx.font = '600 16px Inter,"Segoe UI",Arial,sans-serif'; ctx.fillStyle = rgba(c2, 0.7); ctx.fillText(dateStr, C, face === 'flip' ? C + 95 : C + 92); }
      return;
    }
    if (face === 'binary') {
      const cols = [[h, 6], [m, 6], [s, 6]];
      cols.forEach(([v, bits], ci) => { for (let b = 0; b < bits; b++) { const on = (v >> b) & 1; ctx.beginPath(); ctx.arc(C + (ci - 1) * 70, C + 90 - b * 36, 12, 0, TAU); ctx.fillStyle = on ? c : rgba(c2, 0.12); ctx.fill(); } ctx.font = '700 14px monospace'; ctx.fillStyle = rgba(c2, 0.6); ctx.fillText(['H', 'M', 'S'][ci], C + (ci - 1) * 70, C + 125); });
      return;
    }
    const sec = s + ms / 1000, secA = sec / 60 * TAU - Math.PI / 2, minA = (m + sec / 60) / 60 * TAU - Math.PI / 2, hrA = ((h % 12) + m / 60) / 12 * TAU - Math.PI / 2;
    if (face === 'neon') {
      const arc = (r, a, col, w) => { ctx.beginPath(); ctx.arc(C, C, r, -Math.PI / 2, a); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0; };
      for (const r of [150, 122, 94]) { ctx.beginPath(); ctx.arc(C, C, r, 0, TAU); ctx.strokeStyle = rgba(c2, 0.1); ctx.lineWidth = 10; ctx.stroke(); }
      arc(150, secA, c, 10); arc(122, minA, c2, 10); arc(94, hrA, '#ff8f72', 10);
      ctx.font = '800 46px Inter,"Segoe UI",Arial,sans-serif'; ctx.fillStyle = c2; ctx.fillText(z(hh) + ':' + z(m), C, C);
      return;
    }
    /* analog & minimal */
    ctx.beginPath(); ctx.arc(C, C, 160, 0, TAU); ctx.strokeStyle = rgba(c2, face === 'minimal' ? 0.15 : 0.35); ctx.lineWidth = 3; ctx.stroke();
    for (let i = 0; i < 60; i++) { if (face === 'minimal' && i % 15) continue; const a = i / 60 * TAU, big = i % 5 === 0, r1 = big ? 140 : 150; ctx.beginPath(); ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1); ctx.lineTo(C + Math.cos(a) * 156, C + Math.sin(a) * 156); ctx.strokeStyle = rgba(c2, big ? 0.9 : 0.35); ctx.lineWidth = big ? 3 : 1; ctx.stroke(); }
    if (face === 'analog') { ctx.font = '700 22px Inter,"Segoe UI",Arial,sans-serif'; ctx.fillStyle = c2; for (const n of [12, 3, 6, 9]) { const a = n / 12 * TAU - Math.PI / 2; ctx.fillText(String(n), C + Math.cos(a) * 118, C + Math.sin(a) * 118); } }
    const hand = (a, len, w, col) => { ctx.beginPath(); ctx.moveTo(C - Math.cos(a) * 18, C - Math.sin(a) * 18); ctx.lineTo(C + Math.cos(a) * len, C + Math.sin(a) * len); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke(); };
    hand(hrA, 80, 8, c2); hand(minA, 120, 6, c2); if (cfg.showSeconds !== false) hand(secA, 140, 2, c);
    ctx.beginPath(); ctx.arc(C, C, 7, 0, TAU); ctx.fillStyle = c; ctx.fill();
    if (cfg.showDate !== false) { ctx.font = '600 14px Inter,"Segoe UI",Arial,sans-serif'; ctx.fillStyle = rgba(c2, 0.7); ctx.fillText(dateStr, C, C + 62); }
  }
  BS.clock = { FACES, draw };
})(typeof window !== 'undefined' ? window : globalThis);
