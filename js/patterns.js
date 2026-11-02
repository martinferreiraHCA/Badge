/* Badge Studio — procedural animation library.
   Every pattern draws one frame at logical 368×368 px. `t` is seconds inside
   the loop, `o.q` the loop phase (0..2π) so exports are seamless loops. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { hash, rgba, rgb, lerp, noise2, hslToHex, mixHex, clamp } = BS.util;
  const W = 368, C = 184, TAU = Math.PI * 2;

  const P = [];
  const add = (id, name, group, draw, tags = []) => P.push({ id, name, group, draw, tags });
  const font = (px, mono) => (mono ? px + 'px "JetBrains Mono","Fira Code",monospace' : '700 ' + px + 'px Inter,"Segoe UI",Arial,sans-serif');

  /* ── Geométricos ───────────────────────────────── */
  add('orbit', 'Órbita', 'geo', (ctx, t, o) => {
    const cx = C, cy = 166, q = o.q;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.55);
    for (let i = 0; i < 40 * o.density; i++) { const a = i / (40 * o.density) * TAU + q * 0.25, yy = Math.sin(a) * 40, rx = 106 + Math.cos(a) * 16, ry = 36 + Math.sin(a) * 5; ctx.beginPath(); ctx.ellipse(0, yy, rx, ry, Math.sin(q) * 0.09, 0, TAU); ctx.strokeStyle = rgba(o.c, 0.13 + (0.5 + 0.5 * Math.cos(a)) * 0.54); ctx.lineWidth = 0.85; ctx.stroke(); }
    ctx.restore();
    for (let i = 0; i < 3; i++) { const a = q + i * 2.1, x = cx + Math.cos(a) * 116, y = cy + Math.sin(a) * 77; ctx.beginPath(); ctx.arc(x, y, i === 0 ? 3 : 1.6, 0, 7); ctx.fillStyle = i ? o.c2 : o.c; ctx.shadowColor = o.c; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0; }
  });
  add('rings', 'Anillos', 'geo', (ctx, t, o) => {
    for (let i = 0; i < 12; i++) { const ph = ((i / 12) + t * o.speed * 0.25) % 1, r = ph * 190; ctx.beginPath(); ctx.arc(C, C, r, 0, TAU); ctx.strokeStyle = rgba(mixHex(o.c, o.c2, ph), (1 - ph) * 0.9); ctx.lineWidth = 2 + (1 - ph) * 6; ctx.stroke(); }
  });
  add('spiral', 'Espiral hipnótica', 'geo', (ctx, t, o) => {
    ctx.save(); ctx.translate(C, C); ctx.rotate(o.q);
    for (let arm = 0; arm < 3; arm++) { ctx.beginPath(); for (let r = 0; r < 260; r += 2) { const a = r * 0.045 + arm * TAU / 3; const x = Math.cos(a) * r, y = Math.sin(a) * r; r === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.strokeStyle = arm % 2 ? o.c : o.c2; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke(); }
    ctx.restore();
  });
  add('kaleido', 'Caleidoscopio', 'geo', (ctx, t, o) => {
    const n = 8;
    for (let s = 0; s < n; s++) { ctx.save(); ctx.translate(C, C); ctx.rotate(s * TAU / n + (s % 2 ? -o.q : o.q) * 0.5); if (s % 2) ctx.scale(1, -1);
      for (let i = 0; i < 6; i++) { const a = i * 0.4 + Math.sin(o.q + i) * 0.3, r = 40 + i * 28; ctx.beginPath(); ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r * 0.5, 22, 9, a, 0, TAU); ctx.fillStyle = rgba(i % 2 ? o.c : o.c2, 0.75); ctx.fill(); }
      ctx.restore(); }
  });
  add('hex', 'Panal', 'geo', (ctx, t, o) => {
    const s = 24, h = s * Math.sqrt(3);
    for (let y = -h; y < W + h; y += h * 0.75) for (let x = -s; x < W + s; x += s * 1.5) { const yy = y + ((Math.round(x / (s * 1.5)) % 2) ? h / 2 : 0) * 0.5; const d = Math.hypot(x - C, yy - C), v = 0.5 + 0.5 * Math.sin(d / 28 - o.q * 2);
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + Math.PI / 6; const px = x + Math.cos(a) * s * 0.9 * (0.4 + v * 0.6), py = yy + Math.sin(a) * s * 0.9 * (0.4 + v * 0.6); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fillStyle = rgba(mixHex(o.c2, o.c, v), 0.4 + v * 0.6); ctx.fill(); }
  });
  add('lissajous', 'Lissajous', 'geo', (ctx, t, o) => {
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) { ctx.beginPath(); for (let i = 0; i <= 400; i++) { const u = i / 400 * TAU; const x = C + Math.sin(3 * u + o.q + k) * 140, y = C + Math.sin(4 * u + k * 1.3) * 140; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.strokeStyle = rgba(k ? o.c2 : o.c, 0.85); ctx.stroke(); }
    const u = o.q * 2; ctx.beginPath(); ctx.arc(C + Math.sin(3 * u + o.q) * 140, C + Math.sin(4 * u) * 140, 7, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
  });
  add('checker', 'Damero', 'geo', (ctx, t, o) => {
    const n = 8, s = W / n, off = (t * o.speed * s) % (s * 2);
    ctx.save(); ctx.translate(C, C); ctx.rotate(Math.sin(o.q) * 0.2); ctx.translate(-C - off, -C - off);
    for (let y = -2; y < n + 2; y++) for (let x = -2; x < n + 2; x++) { ctx.fillStyle = (x + y) % 2 ? o.c : o.c2; ctx.fillRect(x * s, y * s, s, s); }
    ctx.restore();
  });
  add('tunnel', 'Túnel', 'geo', (ctx, t, o) => {
    for (let i = 14; i >= 0; i--) { const ph = ((i / 14) + (t * o.speed * 0.4) % 1) % 1, s = Math.pow(ph, 2.2) * 400 + 4; ctx.save(); ctx.translate(C + Math.sin(o.q) * 20 * ph, C + Math.cos(o.q) * 20 * ph); ctx.rotate(ph * 1.5 + o.q * 0.3); ctx.strokeStyle = rgba(i % 2 ? o.c : o.c2, 0.2 + ph * 0.8); ctx.lineWidth = 2 + ph * 5; ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore(); }
  });

  /* ── Energía y naturaleza ───────────────────────── */
  add('plasma', 'Plasma', 'energy', (ctx, t, o) => {
    const q = o.q, base = parseInt(o.c.slice(1, 3), 16);
    for (let y = 0; y < W; y += 8) for (let x = 0; x < W; x += 8) { const v = Math.sin(x / 37 + q) + Math.sin(y / 42 - q) + Math.sin(Math.hypot(x - C, y - C) / 28 - q * 2); ctx.fillStyle = 'hsl(' + ((v * 35 + t * 25 + base) % 360) + ' 72% ' + (20 + v * 5) + '%)'; ctx.fillRect(x, y, 9, 9); }
  });
  add('aurora', 'Aurora', 'energy', (ctx, t, o) => {
    for (let b = 0; b < 5; b++) { ctx.beginPath(); ctx.moveTo(0, W); for (let x = 0; x <= W; x += 6) { const y = 110 + b * 36 + Math.sin(x / 50 + o.q + b) * 28 + noise2(x / 60, t * o.speed + b * 3) * 50; ctx.lineTo(x, y); } ctx.lineTo(W, W); ctx.closePath(); const g = ctx.createLinearGradient(0, 80 + b * 30, 0, W); g.addColorStop(0, rgba(b % 2 ? o.c : o.c2, 0.55)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fill(); }
    for (let i = 0; i < 40; i++) { ctx.fillStyle = rgba('#ffffff', 0.3 + 0.7 * hash(i + Math.floor(t * 3))); ctx.fillRect(hash(i) * W, hash(i + 50) * 120, 2, 2); }
  });
  add('wave', 'Ondas', 'energy', (ctx, t, o) => {
    for (let j = 0; j < 32; j++) { ctx.beginPath(); for (let x = -20; x <= 388; x += 4) { const y = 83 + j * 5 + Math.sin(x / 55 + o.q + j * 0.14) * 22 + Math.sin(x / 90 - o.q) * 22; x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.strokeStyle = rgba(mixHex(o.c, o.c2, j / 32), 0.22 + Math.sin(j / 32 * Math.PI) * 0.65); ctx.lineWidth = 0.8; ctx.stroke(); }
  });
  add('fire', 'Fuego', 'energy', (ctx, t, o) => {
    for (let i = 0; i < 90 * o.density; i++) { const life = (hash(i) + t * o.speed * 0.6) % 1, x = C + (hash(i + 7) - 0.5) * 140 * (1 - life * 0.3) + Math.sin(life * 9 + i) * 12, y = 300 - life * 230, r = (1 - life) * 18 + 2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = rgba(mixHex('#ff3b00', '#ffe56b', 1 - life), (1 - life) * 0.8); ctx.fill(); }
    ctx.fillStyle = rgba(o.c, 0.5); ctx.beginPath(); ctx.ellipse(C, 300, 90, 16, 0, 0, TAU); ctx.fill();
  });
  add('lava', 'Lava', 'energy', (ctx, t, o) => {
    const blobs = 7; const img = []; for (let i = 0; i < blobs; i++) img.push([C + Math.sin(o.q * (1 + i * 0.13) + i) * 110, C + Math.cos(o.q * (1.3 + i * 0.1) + i * 2) * 110, 40 + hash(i) * 40]);
    for (let y = 0; y < W; y += 6) for (let x = 0; x < W; x += 6) { let s = 0; for (const [bx, by, br] of img) s += br * br / ((x - bx) ** 2 + (y - by) ** 2 + 1); if (s > 0.7) { ctx.fillStyle = s > 1.4 ? o.c : o.c2; ctx.fillRect(x, y, 6, 6); } }
  });
  add('snow', 'Nieve', 'energy', (ctx, t, o) => {
    for (let i = 0; i < 120 * o.density; i++) { const sp = 0.3 + hash(i) * 0.7, y = ((hash(i + 3) + t * o.speed * 0.12 * sp) % 1) * (W + 20) - 10, x = hash(i + 9) * W + Math.sin(t * 2 + i) * 12, r = 1 + hash(i + 2) * 3; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = rgba('#ffffff', 0.4 + sp * 0.6); ctx.fill(); }
    ctx.fillStyle = rgba(o.c, 0.8); ctx.beginPath(); ctx.ellipse(C, 340, 200, 40, 0, 0, TAU); ctx.fill();
  });
  add('bubbles', 'Burbujas', 'energy', (ctx, t, o) => {
    for (let i = 0; i < 40 * o.density; i++) { const sp = 0.4 + hash(i) * 0.6, ph = (hash(i + 3) + t * o.speed * 0.15 * sp) % 1, y = W - ph * (W + 60), x = hash(i + 9) * W + Math.sin(ph * 8 + i) * 16, r = 6 + hash(i + 2) * 22; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = rgba(i % 3 ? o.c : o.c2, 0.6); ctx.lineWidth = 2; ctx.stroke(); ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.2, 0, TAU); ctx.fillStyle = rgba('#ffffff', 0.5); ctx.fill(); }
  });
  add('flow', 'Campo de flujo', 'energy', (ctx, t, o) => {
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 120 * o.density; i++) { let x = hash(i) * W, y = hash(i + 1) * W; ctx.beginPath(); ctx.moveTo(x, y); for (let s = 0; s < 24; s++) { const a = noise2(x / 70 + t * o.speed * 0.2, y / 70) * TAU * 2; x += Math.cos(a) * 5; y += Math.sin(a) * 5; ctx.lineTo(x, y); } ctx.strokeStyle = rgba(mixHex(o.c, o.c2, hash(i + 5)), 0.5); ctx.stroke(); }
  });
  add('clouds', 'Nubes de ruido', 'energy', (ctx, t, o) => {
    for (let y = 0; y < W; y += 8) for (let x = 0; x < W; x += 8) { const v = noise2(x / 90 + t * o.speed * 0.15, y / 90) * 0.6 + noise2(x / 30 - t * 0.1, y / 30 + t * 0.2) * 0.4; ctx.fillStyle = mixHex(o.c2, o.c, clamp((v - 0.35) * 2.2, 0, 1)); ctx.fillRect(x, y, 8, 8); }
  });

  /* ── Tech / retro ──────────────────────────────── */
  add('matrix', 'Matrix', 'tech', (ctx, t, o) => {
    ctx.font = font(13, true);
    for (let x = 22; x < 355; x += 14) { const k = (x - 22) / 14, offset = (t * o.speed * 60 + hash(k) * 500) % 450; for (let j = 0; j < 14; j++) { const y = offset - j * 19; ctx.fillStyle = j === 0 ? '#efffd5' : rgba(o.c, Math.max(0, 0.8 - j * 0.06)); ctx.fillText(Math.floor(hash(k * 200 + j + Math.floor(t * 6)) * 16).toString(16).toUpperCase(), x, y); } }
  });
  add('radar', 'Radar', 'tech', (ctx, t, o) => {
    ctx.save(); ctx.translate(C, 173); ctx.strokeStyle = rgba(o.c, 0.2);
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(0, 0, i * 32, 0, TAU); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-130, 0); ctx.lineTo(130, 0); ctx.moveTo(0, -130); ctx.lineTo(0, 130); ctx.stroke();
    for (let i = 0; i < 50; i++) { const a = o.q - i * 0.014; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); ctx.strokeStyle = rgba(o.c, (1 - i / 50) * 0.25); ctx.stroke(); }
    for (let i = 0; i < 7; i++) { const a = hash(i) * TAU, r = 30 + hash(i + 99) * 90, delta = ((o.q - a) % TAU + TAU) % TAU; ctx.fillStyle = rgba(o.c2, Math.max(0.1, 1 - delta / TAU)); ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 3, 0, TAU); ctx.fill(); }
    ctx.restore();
  });
  add('stars', 'Warp', 'tech', (ctx, t, o) => {
    for (let i = 0; i < 95 * o.density; i++) { const z = (hash(i + 40) + t * o.speed * 0.22) % 1, angle = hash(i) * TAU, r = z * z * 245, x = C + Math.cos(angle) * r, y = 172 + Math.sin(angle) * r; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(C + Math.cos(angle) * (r + z * 10), 172 + Math.sin(angle) * (r + z * 10)); ctx.strokeStyle = rgba(i % 4 ? o.c : o.c2, z * 0.8); ctx.lineWidth = 0.5 + z * 2; ctx.stroke(); }
  });
  add('dna', 'ADN', 'tech', (ctx, t, o) => {
    for (let i = 0; i < 22; i++) { const y = 66 + i * 8 * 1.5, a = i * 0.36 + o.q, x1 = C + Math.sin(a) * 68, x2 = C - Math.sin(a) * 68; ctx.strokeStyle = rgba(o.c, 0.25); ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); for (const [x, alpha, col] of [[x1, 0.6 + Math.cos(a) * 0.35, o.c], [x2, 0.6 - Math.cos(a) * 0.35, o.c2]]) { ctx.beginPath(); ctx.arc(x, y, 3.6, 0, TAU); ctx.fillStyle = rgba(col, alpha); ctx.fill(); } }
  });
  add('life', 'Juego de la vida', 'tech', (ctx, t, o) => {
    let g = Array.from({ length: 400 }, (_, i) => (hash(i + 8) > 0.69 ? 1 : 0)); const n = Math.floor(t * o.speed * 5) % 30;
    for (let step = 0; step < n; step++) { const old = g; g = old.map((v, i) => { let count = 0; const x = i % 20, y = i / 20 | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) count += old[((y + dy + 20) % 20) * 20 + (x + dx + 20) % 20]; return count === 3 || (v && count === 2) ? 1 : 0; }); }
    g.forEach((v, i) => { if (v) { ctx.fillStyle = rgba(o.c, 0.55 + hash(i) * 0.4); ctx.fillRect(64 + (i % 20) * 12, 45 + (i / 20 | 0) * 14, 10, 12); } });
  });
  add('eq', 'Ecualizador', 'tech', (ctx, t, o) => {
    const bars = 16, w = 14, gap = 6, x0 = C - (bars * (w + gap)) / 2;
    for (let i = 0; i < bars; i++) { const h = 40 + (0.5 + 0.5 * Math.sin(o.q * 2 + i * 0.7)) * 120 + noise2(i, t * o.speed * 3) * 60; for (let s = 0; s < h; s += 10) { ctx.fillStyle = s > h - 20 ? o.c2 : rgba(o.c, 0.35 + (s / h) * 0.65); ctx.fillRect(x0 + i * (w + gap), 270 - s, w, 7); } }
  });
  add('cyber', 'Lluvia cyberpunk', 'tech', (ctx, t, o) => {
    ctx.strokeStyle = rgba(o.c2, 0.25); ctx.lineWidth = 1;
    for (let y = 200; y < W; y += 18) { const k = (y - 200) / 168; ctx.beginPath(); ctx.moveTo(0, y + ((t * o.speed * 40) % 18)); ctx.lineTo(W, y + ((t * o.speed * 40) % 18)); ctx.stroke(); }
    for (let x = 0; x <= W; x += 36) { ctx.beginPath(); ctx.moveTo(C + (x - C) * 0.2, 200); ctx.lineTo(x, W); ctx.stroke(); }
    for (let i = 0; i < 60 * o.density; i++) { const x = hash(i) * W, y = ((hash(i + 1) + t * o.speed * 0.5) % 1) * 200, len = 12 + hash(i + 2) * 30; ctx.strokeStyle = rgba(i % 2 ? o.c : '#ff4fd8', 0.7); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + len); ctx.stroke(); }
    const g = ctx.createLinearGradient(0, 120, 0, 200); g.addColorStop(0, rgba('#ff4fd8', 0)); g.addColorStop(1, rgba('#ff4fd8', 0.4)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, 200, 70, Math.PI, TAU); ctx.fill();
  });
  add('scan', 'Escáner', 'tech', (ctx, t, o) => {
    const y = (0.5 - 0.5 * Math.cos(o.q)) * W;
    ctx.strokeStyle = rgba(o.c, 0.12); for (let g = 0; g < W; g += 23) { ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, W); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke(); }
    const grd = ctx.createLinearGradient(0, y - 60, 0, y); grd.addColorStop(0, rgba(o.c, 0)); grd.addColorStop(1, rgba(o.c, 0.5)); ctx.fillStyle = grd; ctx.fillRect(0, y - 60, W, 60);
    ctx.fillStyle = o.c2; ctx.fillRect(0, y - 1, W, 3);
    ctx.font = font(11, true); ctx.fillStyle = o.c; ctx.textAlign = 'left'; ctx.fillText('SCAN ' + Math.floor(y / W * 100).toString().padStart(3, '0') + '%', 40, 60);
  });
  add('braille', 'Puntos', 'tech', (ctx, t, o) => {
    for (let y = 20; y < W; y += 16) for (let x = 20; x < W; x += 16) { const v = 0.5 + 0.5 * Math.sin((x + y) / 40 + o.q * 2) * Math.cos(Math.hypot(x - C, y - C) / 30 - o.q); ctx.beginPath(); ctx.arc(x, y, 1 + v * 5, 0, TAU); ctx.fillStyle = rgba(mixHex(o.c2, o.c, v), 0.3 + v * 0.7); ctx.fill(); }
  });

  /* ── Celebración ───────────────────────────────── */
  add('fireworks', 'Fuegos artificiales', 'party', (ctx, t, o) => {
    for (let f = 0; f < 4; f++) { const ph = ((t * o.speed * 0.5) + f * 0.25) % 1, cx = 80 + hash(f + Math.floor(t * o.speed * 0.5 + f * 0.25)) * 208, cy = 80 + hash(f + 30 + Math.floor(t * o.speed * 0.5 + f * 0.25)) * 150;
      if (ph < 0.3) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, 340 - (ph / 0.3) * (340 - cy), 2, 0, TAU); ctx.fill(); continue; }
      const e = (ph - 0.3) / 0.7, col = f % 2 ? o.c : o.c2;
      for (let i = 0; i < 28; i++) { const a = i / 28 * TAU, r = e * 90 * (0.7 + hash(i + f) * 0.3); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r + e * e * 40, 2.5 * (1 - e), 0, TAU); ctx.fillStyle = rgba(col, 1 - e); ctx.fill(); } }
  });
  add('confetti', 'Confeti', 'party', (ctx, t, o) => {
    const cols = [o.c, o.c2, '#ff8f72', '#a7b7ff', '#ffd166'];
    for (let i = 0; i < 90 * o.density; i++) { const sp = 0.5 + hash(i) * 0.5, y = ((hash(i + 3) + t * o.speed * 0.2 * sp) % 1) * (W + 30) - 15, x = hash(i + 9) * W + Math.sin(t * 3 + i) * 14; ctx.save(); ctx.translate(x, y); ctx.rotate(t * 4 * sp + i); ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(-5, -3, 10, 6); ctx.restore(); }
  });
  add('hearts', 'Corazones', 'party', (ctx, t, o) => {
    const heart = (x, y, s, col, a) => { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.beginPath(); ctx.moveTo(0, 3); ctx.bezierCurveTo(-5, -2, -10, 1, -10, 5); ctx.bezierCurveTo(-10, 9, -5, 13, 0, 17); ctx.bezierCurveTo(5, 13, 10, 9, 10, 5); ctx.bezierCurveTo(10, 1, 5, -2, 0, 3); ctx.fillStyle = rgba(col, a); ctx.fill(); ctx.restore(); };
    for (let i = 0; i < 30 * o.density; i++) { const ph = (hash(i + 3) + t * o.speed * 0.15) % 1; heart(hash(i) * W + Math.sin(ph * 6 + i) * 20, W - ph * (W + 60), 0.8 + hash(i + 2) * 1.6, i % 2 ? o.c : o.c2, 0.4 + (1 - ph) * 0.6); }
    heart(C, 150, 5 + Math.sin(o.q * 2) * 0.6, o.c, 1);
  });
  add('pulse', 'Pulso', 'party', (ctx, t, o) => {
    const beat = Math.pow(0.5 + 0.5 * Math.sin(o.q * 2), 6);
    for (let i = 3; i >= 0; i--) { ctx.beginPath(); ctx.arc(C, C, 50 + i * 36 + beat * 20, 0, TAU); ctx.fillStyle = rgba(i % 2 ? o.c : o.c2, 0.18 + beat * 0.15); ctx.fill(); }
    ctx.beginPath(); ctx.arc(C, C, 40 + beat * 14, 0, TAU); ctx.fillStyle = o.c; ctx.shadowColor = o.c; ctx.shadowBlur = 30 * beat; ctx.fill(); ctx.shadowBlur = 0;
  });
  add('rainbow', 'Arcoíris', 'party', (ctx, t, o) => {
    for (let i = 0; i < 24; i++) { ctx.beginPath(); ctx.arc(C, 300, 60 + i * 9, Math.PI, TAU); ctx.strokeStyle = hslToHex((i * 15 + t * o.speed * 60) % 360, 85, 58); ctx.lineWidth = 9; ctx.stroke(); }
    const g = ctx.createRadialGradient(C, 300, 0, C, 300, 70); g.addColorStop(0, o.c2); g.addColorStop(1, rgba(o.c2, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, 300, 70, 0, TAU); ctx.fill();
  });
  add('smiley', 'Carita', 'party', (ctx, t, o) => {
    const bounce = Math.abs(Math.sin(o.q)) * 20;
    ctx.save(); ctx.translate(C, C - bounce + 10); ctx.fillStyle = o.c; ctx.beginPath(); ctx.arc(0, 0, 120, 0, TAU); ctx.fill();
    ctx.fillStyle = '#20241e'; const blink = Math.sin(t * o.speed * 4) > 0.97 ? 0.1 : 1;
    for (const x of [-45, 45]) { ctx.beginPath(); ctx.ellipse(x, -35, 16, 22 * blink, 0, 0, TAU); ctx.fill(); }
    ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.strokeStyle = '#20241e'; ctx.beginPath(); ctx.arc(0, 15, 70, 0.25, Math.PI - 0.25); ctx.stroke();
    ctx.fillStyle = rgba(o.c2, 0.6); for (const x of [-85, 85]) { ctx.beginPath(); ctx.arc(x, 25, 18, 0, TAU); ctx.fill(); }
    ctx.restore();
  });
  add('marquee-lights', 'Luces de marquesina', 'party', (ctx, t, o) => {
    const n = 36, on = Math.floor(t * o.speed * 8);
    for (let i = 0; i < n; i++) { const a = i / n * TAU - Math.PI / 2, lit = (i + on) % 3 === 0; ctx.beginPath(); ctx.arc(C + Math.cos(a) * 165, C + Math.sin(a) * 165, lit ? 9 : 6, 0, TAU); ctx.fillStyle = lit ? o.c : rgba(o.c2, 0.4); ctx.shadowColor = o.c; ctx.shadowBlur = lit ? 18 : 0; ctx.fill(); }
    ctx.shadowBlur = 0; ctx.font = font(46); ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('★', C, C + 16);
  });

  const byId = Object.fromEntries(P.map((p) => [p.id, p]));
  const GROUPS = { geo: 'Geométricos', energy: 'Energía y naturaleza', tech: 'Tech y retro', party: 'Celebración' };
  function draw(ctx, t, opts) {
    const p = byId[opts.id] || P[0];
    const o = { c: opts.color || '#d0f56a', c2: opts.color2 || '#469cff', speed: opts.speed || 1, density: opts.density || 1, duration: opts.duration || 4 };
    o.q = (t / o.duration) * TAU * Math.max(1, Math.round(o.speed));
    ctx.save(); p.draw(ctx, t, o); ctx.restore();
  }
  BS.patterns = { list: P, byId, GROUPS, draw };
})(typeof window !== 'undefined' ? window : globalThis);
