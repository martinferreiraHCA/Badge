/* Badge Studio — text effects: the Zrun "DIY text" feature set and more.
   draw(ctx, t, cfg, dur) renders at logical 368×368. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { rgba, hslToHex, clamp } = BS.util;
  const W = 368, C = 184, TAU = Math.PI * 2;

  const FONTS = [
    ['sans', 'Moderna', 'Inter,"Segoe UI",Roboto,Arial,sans-serif'],
    ['serif', 'Clásica', 'Georgia,"Times New Roman",serif'],
    ['mono', 'Código', '"JetBrains Mono","Fira Code","Courier New",monospace'],
    ['impact', 'Impacto', 'Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif'],
    ['round', 'Redonda', '"Trebuchet MS","Comic Sans MS","Segoe UI",sans-serif'],
    ['script', 'Manuscrita', '"Brush Script MT","Segoe Script","Comic Sans MS",cursive'],
  ];
  const EFFECTS = [
    ['static', 'Fijo'], ['pulse', 'Latido'], ['ticker', 'Marquesina ←'], ['vscroll', 'Desplazar ↑'], ['rainbow', 'Arcoíris'],
    ['blink', 'Parpadeo'], ['bounce', 'Rebote'], ['typewriter', 'Máquina de escribir'], ['glow', 'Neón'], ['wave', 'Ola'], ['zoom', 'Zoom'], ['spin', 'Giro'],
  ];
  const fontOf = (id) => (FONTS.find((f) => f[0] === id) || FONTS[0])[2];
  const wrap = (ctx, text, max) => { const lines = []; for (const para of String(text).split('\n')) { let line = ''; for (const w of para.split(' ')) { if (ctx.measureText(line + ' ' + w).width > max && line) { lines.push(line); line = w; } else line += (line ? ' ' : '') + w; } lines.push(line); } return lines.slice(0, 5); };

  function drawText(ctx, text, x, y, cfg, color) {
    if (cfg.outline) { ctx.lineWidth = Math.max(2, cfg.size / 9); ctx.strokeStyle = cfg.outlineColor || '#000'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function draw(ctx, t, cfg, dur = 4) {
    const q = (t / dur) * TAU * (cfg.speed || 1), fx = cfg.effect || 'static', size = cfg.size || 28, font = fontOf(cfg.font);
    const weight = cfg.bold === false ? 500 : 800;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    if (cfg.shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; }
    const colorAt = (i, n) => (fx === 'rainbow' ? hslToHex(((i / Math.max(1, n)) * 360 + t * 120 * (cfg.speed || 1)) % 360, 90, 60) : cfg.color || '#ffffff');
    const main = cfg.line1 || '', sub = cfg.line2 || '';
    let fs = size, alpha = 1, rot = 0, scale = 1;
    if (fx === 'pulse') fs = size * (1 + Math.sin(q) * 0.08);
    if (fx === 'blink') alpha = Math.sin(q * 2) > -0.2 ? 1 : 0.08;
    if (fx === 'zoom') scale = 0.6 + 0.5 * (0.5 - 0.5 * Math.cos(q));
    if (fx === 'spin') rot = q;
    if (fx === 'glow') { ctx.shadowColor = cfg.color || '#fff'; ctx.shadowBlur = 18 + Math.sin(q * 2) * 12; }
    ctx.globalAlpha = alpha;
    ctx.font = weight + ' ' + fs + 'px ' + font;
    const subY = sub ? C + 70 : C, mainY = sub ? C - 10 : C;
    if (fx === 'ticker') {
      ctx.textAlign = 'left';
      const width = ctx.measureText(main).width + 120, x = W - ((t * (cfg.speed || 1) * 110) % (width + W));
      drawText(ctx, main, x, mainY, cfg, colorAt(0, 1));
    } else if (fx === 'vscroll') {
      const lines = wrap(ctx, main, 300), total = lines.length * (fs + 8) + W, off = (t * (cfg.speed || 1) * 70) % total;
      lines.forEach((l, i) => drawText(ctx, l, C, W + i * (fs + 8) - off, cfg, colorAt(i, lines.length)));
    } else if (fx === 'wave' || fx === 'bounce' || fx === 'rainbow') {
      const lines = wrap(ctx, main, 300);
      lines.forEach((line, li) => {
        const y = mainY + (li - (lines.length - 1) / 2) * (fs + 6);
        const widths = [...line].map((ch) => ctx.measureText(ch).width), total = widths.reduce((a, b) => a + b, 0);
        let x = C - total / 2; ctx.textAlign = 'left';
        [...line].forEach((ch, i) => {
          const dy = fx === 'wave' ? Math.sin(q * 2 + i * 0.5) * fs * 0.3 : fx === 'bounce' ? -Math.abs(Math.sin(q * 2 + i * 0.4)) * fs * 0.45 : 0;
          drawText(ctx, ch, x, y + dy, cfg, colorAt(i + li * 7, line.length));
          x += widths[i];
        });
      });
    } else {
      let text = main;
      if (fx === 'typewriter') { const n = Math.floor((t / dur) * (main.length + 6)); text = main.slice(0, n) + (n <= main.length && Math.floor(t * 3) % 2 ? '▏' : ''); }
      ctx.save(); ctx.translate(C, mainY); ctx.rotate(rot); ctx.scale(scale, scale); ctx.translate(-C, -mainY);
      const lines = wrap(ctx, text, 300);
      lines.forEach((l, i) => drawText(ctx, l, C, mainY + (i - (lines.length - 1) / 2) * (fs + 6), cfg, colorAt(i, lines.length)));
      ctx.restore();
    }
    if (sub) { ctx.textAlign = 'center'; ctx.font = '600 ' + Math.max(10, size * 0.42) + 'px ' + font; drawText(ctx, sub, C, subY, { ...cfg, outline: false }, cfg.color2 || '#a8ba96'); }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }

  /* Caption overlay used on top of any mode. */
  function caption(ctx, t, ov, dur = 4) {
    if (!ov || !ov.text) return;
    const size = ov.size || 20, font = fontOf(ov.font), y = ov.position === 'top' ? 70 : ov.position === 'center' ? C : 300;
    ctx.save(); ctx.font = '700 ' + size + 'px ' + font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = wrap(ctx, ov.text, 290), h = lines.length * (size + 6);
    if (ov.bg !== false) { ctx.fillStyle = 'rgba(0,0,0,.55)'; const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 36; ctx.beginPath(); ctx.roundRect(C - w / 2, y - h / 2 - 8, w, h + 16, 12); ctx.fill(); }
    if (ov.effect === 'ticker') { ctx.textAlign = 'left'; const w = ctx.measureText(ov.text).width + 100; ctx.fillStyle = ov.color || '#fff'; ctx.fillText(ov.text, W - ((t * 100) % (w + W)), y); }
    else lines.forEach((l, i) => { ctx.fillStyle = ov.color || '#fff'; ctx.fillText(l, C, y + (i - (lines.length - 1) / 2) * (size + 6)); });
    ctx.restore();
  }

  BS.textfx = { FONTS, EFFECTS, fontOf, draw, caption, wrap };
})(typeof window !== 'undefined' ? window : globalThis);
