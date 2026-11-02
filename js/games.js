/* Badge Studio — arcade. Five original games rendered at 368×368 with keyboard,
   on-screen pad and touch/pointer control (swipe, tap, drag). A recording of the
   round becomes an AVI loop for the badge. The badge firmware only plays media;
   see docs/GAMES-ON-BADGE.md for the firmware route. */
(function (root) {
  'use strict';
  const BS = root.BS || (root.BS = {});
  const { clamp, hash } = BS.util;
  const W = 368, C = 184, TAU = Math.PI * 2;
  const GAMES = [
    ['snake', 'Snake', 'Comé, crecé y no choques. Flechas, deslizá el dedo o tocá hacia donde querés ir.'],
    ['pong', 'Orbit Pong', 'La paleta izquierda es tuya: ↑/↓ o arrastrá sobre la pantalla. Primero a 5.'],
    ['breakout', 'Breakout', '←/→ o arrastrá la paleta. Tres vidas para romper todos los bloques.'],
    ['flappy', 'Flappy Badge', 'Tocá o presioná espacio para aletear. Pasá entre los tubos.'],
    ['dodge', 'Esquivá', 'Mové la nave con ←/→ o arrastrando. Esquivá los meteoritos.'],
  ];
  const text = (ctx, s, y, size, color = '#f2f7e9', max = 280) => { ctx.font = '650 ' + size + 'px Inter,"Segoe UI",Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(s, C, y, max); };

  class Arcade {
    constructor(onStatus = () => {}) { this.kind = 'snake'; this.game = null; this.held = new Set(); this.onStatus = onStatus; this.colors = { a: '#d0f56a', b: '#a7b7ff', c: '#ff8f72', d: '#69dfd0' }; }
    highScore(kind = this.kind) { try { return +localStorage.getItem('badge-score-' + kind) || 0; } catch { return 0; } }
    setHighScore(kind, score) { try { localStorage.setItem('badge-score-' + kind, String(Math.max(score, this.highScore(kind)))); } catch { /* ignore */ } }
    select(kind) { this.kind = kind; this.game = { kind, running: false, paused: false, over: false, won: false, score: 0 }; this.held.clear(); this.onStatus(); }
    start() {
      const k = this.kind, g = this.game = { kind: k, running: true, paused: false, over: false, won: false, score: 0 };
      if (k === 'snake') { Object.assign(g, { snake: [[7, 8], [6, 8], [5, 8]], dir: [1, 0], next: [1, 0], acc: 0 }); g.food = this.randomFood(g); }
      else if (k === 'pong') Object.assign(g, { paddle: 184, ai: 184, ball: { x: 184, y: 184, vx: 120, vy: 64 }, opponent: 0 });
      else if (k === 'breakout') Object.assign(g, { paddle: 184, ball: { x: 184, y: 240, vx: 90, vy: -115 }, lives: 3, bricks: Array.from({ length: 24 }, (_, i) => ({ x: 73 + (i % 6) * 37, y: 90 + (i / 6 | 0) * 18, on: true })) });
      else if (k === 'flappy') Object.assign(g, { y: 184, vy: 0, pipes: [{ x: 420, gap: 150 }, { x: 620, gap: 200 }], t: 0 });
      else if (k === 'dodge') Object.assign(g, { x: 184, rocks: [], t: 0, spawn: 0 });
      this.held.clear(); this.onStatus();
    }
    finish(won = false) { const g = this.game; g.running = false; g.over = true; g.won = won; this.setHighScore(g.kind, g.score); this.onStatus(); }
    togglePause() { const g = this.game; if (g?.running) { g.paused = !g.paused; this.onStatus(); } }
    randomFood(g) { const free = []; for (let i = 0; i < 256; i++) if (!g.snake.some((p) => p[1] * 16 + p[0] === i)) free.push(i); if (!free.length) return null; const pos = free[Math.floor(Math.random() * free.length)]; return [pos % 16, pos / 16 | 0]; }
    direction(key) {
      const g = this.game; if (!g?.running) return;
      if (g.kind === 'snake') { const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key]; if (d && !(d[0] === -g.dir[0] && d[1] === -g.dir[1])) g.next = d; }
      if (g.kind === 'flappy' && (key === 'ArrowUp' || key === 'Space')) g.vy = -210;
    }
    status() {
      const g = this.game; if (!g) return '';
      if (g.over) return (g.won ? '¡Lo lograste! ' : 'Fin de partida. ') + g.score + ' puntos · récord ' + this.highScore(g.kind);
      if (!g.running) return 'Listo. Tu récord: ' + this.highScore(g.kind);
      if (g.paused) return 'En pausa';
      if (g.kind === 'pong') return g.score + ' — ' + g.opponent + ' · primero a 5';
      return g.score + ' puntos' + (g.kind === 'breakout' ? ' · ' + g.lives + ' vidas' : '');
    }
    /* Pointer control: x,y in 0..368 logical units. */
    pointer(x, y, phase) {
      const g = this.game; if (!g?.running) return;
      if (g.kind === 'pong') g.paddle = clamp(y, 94, 274);
      else if (g.kind === 'breakout') g.paddle = clamp(x, 99, 269);
      else if (g.kind === 'dodge') g.x = clamp(x, 60, 308);
      else if (g.kind === 'flappy' && phase === 'down') g.vy = -210;
      else if (g.kind === 'snake' && phase === 'down') { this.swipeStart = [x, y]; }
      else if (g.kind === 'snake' && phase === 'up' && this.swipeStart) {
        const dx = x - this.swipeStart[0], dy = y - this.swipeStart[1];
        if (Math.hypot(dx, dy) < 12) { const hx = this.game.snake[0][0] * 14 + 80, hy = this.game.snake[0][1] * 14 + 80; const ax = x - hx, ay = y - hy; this.direction(Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'ArrowRight' : 'ArrowLeft') : (ay > 0 ? 'ArrowDown' : 'ArrowUp')); }
        else this.direction(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : (dy > 0 ? 'ArrowDown' : 'ArrowUp'));
        this.swipeStart = null;
      }
    }
    step(dt) {
      const g = this.game, held = this.held; if (!g?.running || g.paused) return;
      if (g.kind === 'snake') {
        g.acc += dt; if (g.acc < Math.max(0.07, 0.15 - g.score * 0.002)) return; g.acc = 0; g.dir = g.next;
        const h = [g.snake[0][0] + g.dir[0], g.snake[0][1] + g.dir[1]], eat = h[0] === g.food[0] && h[1] === g.food[1], body = eat ? g.snake : g.snake.slice(0, -1);
        if (h.some((v) => v < 0 || v >= 16) || body.some((p) => p[0] === h[0] && p[1] === h[1])) { this.finish(); return; }
        g.snake.unshift(h); if (eat) { g.score++; g.food = this.randomFood(g); if (!g.food) { this.finish(true); return; } } else g.snake.pop();
        this.onStatus(); return;
      }
      const b = g.ball;
      if (g.kind === 'pong') {
        const dy = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0); g.paddle = clamp(g.paddle + dy * 210 * dt, 94, 274);
        g.ai = clamp(g.ai + clamp(b.y - g.ai, -1, 1) * Math.min(Math.abs(b.y - g.ai) * 5, 104) * dt, 94, 274);
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < 76) { b.y = 76; b.vy = Math.abs(b.vy); } if (b.y > 292) { b.y = 292; b.vy = -Math.abs(b.vy); }
        if (b.vx < 0 && b.x < 83 && b.x > 66 && Math.abs(b.y - g.paddle) < 28) { b.x = 83; b.vx = Math.min(230, Math.abs(b.vx) * 1.08); b.vy = (b.y - g.paddle) * 4.3; }
        if (b.vx > 0 && b.x > 285 && b.x < 302 && Math.abs(b.y - g.ai) < 28) { b.x = 285; b.vx = -Math.min(230, Math.abs(b.vx) * 1.06); b.vy = (b.y - g.ai) * 4.3; }
        if (b.x < 62 || b.x > 306) { if (b.x > 306) g.score++; else g.opponent++; if (g.score >= 5 || g.opponent >= 5) { this.finish(g.score >= 5); return; } g.ball = { x: 184, y: 184, vx: b.x < 62 ? 120 : -120, vy: 65 * (Math.random() > 0.5 ? 1 : -1) }; this.onStatus(); }
      } else if (g.kind === 'breakout') {
        const dx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0); g.paddle = clamp(g.paddle + dx * 220 * dt, 99, 269);
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < 72) { b.x = 72; b.vx = Math.abs(b.vx); } if (b.x > 296) { b.x = 296; b.vx = -Math.abs(b.vx); } if (b.y < 78) { b.y = 78; b.vy = Math.abs(b.vy); }
        if (b.vy > 0 && b.y >= 275 && b.y < 287 && Math.abs(b.x - g.paddle) < 32) { b.y = 275; b.vy = -Math.abs(b.vy); b.vx = (b.x - g.paddle) * 4.8; }
        for (const brick of g.bricks) if (brick.on && b.x + 4 >= brick.x && b.x - 4 <= brick.x + 33 && b.y + 4 >= brick.y && b.y - 4 <= brick.y + 13) { brick.on = false; b.vy *= -1; g.score += 10; this.onStatus(); break; }
        if (g.bricks.every((brick) => !brick.on)) { this.finish(true); return; }
        if (b.y > 308) { g.lives--; if (!g.lives) { this.finish(); return; } g.ball = { x: g.paddle, y: 245, vx: 90, vy: -115 }; this.onStatus(); }
      } else if (g.kind === 'flappy') {
        g.t += dt; g.vy += 520 * dt; g.y += g.vy * dt;
        for (const p of g.pipes) { p.x -= 95 * dt; if (p.x < -40) { p.x += 400; p.gap = 110 + Math.random() * 150; p.passed = false; } if (!p.passed && p.x + 20 < 120) { p.passed = true; g.score++; this.onStatus(); } const inX = 120 + 12 > p.x && 120 - 12 < p.x + 40; if (inX && (g.y - 12 < p.gap - 55 || g.y + 12 > p.gap + 55)) { this.finish(); return; } }
        if (g.y > 300 || g.y < 60) { this.finish(); return; }
      } else if (g.kind === 'dodge') {
        g.t += dt; g.spawn += dt; const dx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0); g.x = clamp(g.x + dx * 240 * dt, 60, 308);
        if (g.spawn > Math.max(0.25, 0.8 - g.t * 0.02)) { g.spawn = 0; g.rocks.push({ x: 70 + Math.random() * 228, y: 60, r: 8 + Math.random() * 12, v: 90 + Math.random() * 80 + g.t * 4 }); }
        for (const r of g.rocks) { r.y += r.v * dt; if (Math.hypot(r.x - g.x, r.y - 280) < r.r + 11) { this.finish(); return; } }
        const before = g.rocks.length; g.rocks = g.rocks.filter((r) => r.y < 320); g.score += before - g.rocks.length; if (before !== g.rocks.length) this.onStatus();
      }
    }
    draw(ctx) {
      const scale = ctx.canvas.width / W, g = this.game, col = this.colors;
      ctx.save(); ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#090f0b'; ctx.fillRect(0, 0, W, W);
      ctx.textAlign = 'center'; ctx.font = '10px monospace'; ctx.fillStyle = '#c6dfab';
      ctx.fillText(GAMES.find((x) => x[0] === this.kind)[1].toUpperCase().split('').join(' '), C, 48);
      ctx.strokeStyle = '#304126'; ctx.strokeRect(69, 69, 230, 230);
      if (!g?.running && !g?.over) {
        ctx.fillStyle = col.a;
        if (this.kind === 'snake') { for (let i = 0; i < 7; i++) ctx.fillRect(120 + i * 15, 150 + (i > 3 ? 15 : 0), 12, 12); ctx.fillStyle = col.c; ctx.fillRect(222, 209, 11, 11); }
        else if (this.kind === 'pong') { ctx.fillRect(90, 125, 5, 50); ctx.fillRect(275, 195, 5, 50); ctx.beginPath(); ctx.arc(184, 170, 6, 0, 7); ctx.fill(); }
        else if (this.kind === 'breakout') { for (let i = 0; i < 18; i++) { ctx.fillStyle = [col.a, col.b, col.d][i / 6 | 0]; ctx.fillRect(80 + (i % 6) * 35, 110 + (i / 6 | 0) * 22, 30, 15); } ctx.fillStyle = col.a; ctx.fillRect(158, 240, 52, 6); }
        else if (this.kind === 'flappy') { ctx.fillStyle = col.d; ctx.fillRect(220, 70, 36, 70); ctx.fillRect(220, 220, 36, 80); ctx.fillStyle = col.a; ctx.beginPath(); ctx.arc(130, 180, 12, 0, 7); ctx.fill(); }
        else { ctx.fillStyle = col.c; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(100 + i * 42, 110 + (i % 2) * 30, 10, 0, 7); ctx.fill(); } ctx.fillStyle = col.a; ctx.beginPath(); ctx.moveTo(184, 265); ctx.lineTo(170, 290); ctx.lineTo(198, 290); ctx.closePath(); ctx.fill(); }
        text(ctx, 'TOCÁ PARA JUGAR', 268, 13, '#e4edd7'); text(ctx, 'FLECHAS · TÁCTIL · GESTOS', 321, 8, '#748766'); ctx.restore(); return;
      }
      if (g.kind === 'snake') {
        ctx.strokeStyle = '#24311c'; for (let i = 1; i < 16; i++) { ctx.beginPath(); ctx.moveTo(72 + i * 14, 72); ctx.lineTo(72 + i * 14, 296); ctx.moveTo(72, 72 + i * 14); ctx.lineTo(296, 72 + i * 14); ctx.stroke(); }
        g.snake.forEach((p, i) => { ctx.fillStyle = i === 0 ? '#edffd5' : '#9dbd58'; ctx.fillRect(73 + p[0] * 14, 73 + p[1] * 14, 12, 12); });
        if (g.food) { ctx.fillStyle = col.c; ctx.fillRect(75 + g.food[0] * 14, 75 + g.food[1] * 14, 8, 8); }
        text(ctx, 'SCORE ' + String(g.score).padStart(3, '0'), 322, 10, '#a6bc8d');
      } else if (g.kind === 'pong') {
        ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(184, 76); ctx.lineTo(184, 292); ctx.strokeStyle = '#3c4b31'; ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col.a; ctx.fillRect(76, g.paddle - 24, 5, 48); ctx.fillStyle = col.b; ctx.fillRect(287, g.ai - 24, 5, 48);
        ctx.fillStyle = '#f2f8e7'; ctx.beginPath(); ctx.arc(g.ball.x, g.ball.y, 4, 0, 7); ctx.fill(); text(ctx, g.score + '   :   ' + g.opponent, 326, 14, '#b3c59c');
      } else if (g.kind === 'breakout') {
        g.bricks.forEach((b, i) => { if (b.on) { ctx.fillStyle = [col.a, col.b, col.d, col.c][i / 6 | 0]; ctx.fillRect(b.x, b.y, 33, 13); } });
        ctx.fillStyle = col.a; ctx.fillRect(g.paddle - 28, 280, 56, 5); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(g.ball.x, g.ball.y, 4, 0, 7); ctx.fill();
        text(ctx, 'SCORE ' + g.score + '  /  VIDAS ' + g.lives, 326, 10, '#b3c59c');
      } else if (g.kind === 'flappy') {
        ctx.save(); ctx.beginPath(); ctx.rect(70, 70, 228, 228); ctx.clip();
        for (const p of g.pipes) { ctx.fillStyle = col.d; ctx.fillRect(p.x, 60, 40, p.gap - 55 - 60); ctx.fillRect(p.x, p.gap + 55, 40, 300 - p.gap - 55); }
        ctx.fillStyle = col.a; ctx.beginPath(); ctx.arc(120, g.y, 12, 0, 7); ctx.fill(); ctx.fillStyle = '#20241e'; ctx.beginPath(); ctx.arc(125, g.y - 4, 3, 0, 7); ctx.fill();
        ctx.restore(); text(ctx, 'SCORE ' + g.score, 326, 10, '#b3c59c');
      } else if (g.kind === 'dodge') {
        ctx.save(); ctx.beginPath(); ctx.rect(70, 70, 228, 228); ctx.clip();
        for (let i = 0; i < 30; i++) { ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + hash(i) * 0.5) + ')'; ctx.fillRect(72 + hash(i + 1) * 224, 70 + ((hash(i + 2) * 228 + g.t * 60 * (0.5 + hash(i))) % 228), 2, 2); }
        for (const r of g.rocks) { ctx.fillStyle = col.c; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.fill(); }
        ctx.fillStyle = col.a; ctx.beginPath(); ctx.moveTo(g.x, 268); ctx.lineTo(g.x - 12, 292); ctx.lineTo(g.x + 12, 292); ctx.closePath(); ctx.fill();
        ctx.restore(); text(ctx, 'SCORE ' + g.score, 326, 10, '#b3c59c');
      }
      if (g.paused || g.over) { ctx.fillStyle = '#090f0bdd'; ctx.fillRect(70, 145, 228, 80); text(ctx, g.paused ? 'EN PAUSA' : g.won ? '¡VICTORIA!' : 'GAME OVER', 181, 22, col.a, 220); text(ctx, g.over ? g.score + ' PUNTOS · TOCÁ PARA REINTENTAR' : 'CONTINUÁ CUANDO QUIERAS', 207, 10, '#a2b98b'); }
      ctx.restore();
    }
  }
  BS.games = { GAMES, Arcade };
})(typeof window !== 'undefined' ? window : globalThis);
