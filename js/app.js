/* Badge Studio — application shell. Binds the modules to the DOM. */
(function () {
  'use strict';
  const BS = window.BS;
  const { sleep, clamp, esc, bytesLabel, sanitizeName, nextFileName, uniqueId } = BS.util;
  const $ = (id) => document.getElementById(id), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';

  /* ---------- settings ---------- */
  const settings = Object.assign({ theme: 'auto', motion: false, name: 'MARTÍN', resolution: 368, prefix: 'BADGE', confirmSend: true, autoReconnect: true, giphyKey: '', pad: true }, (() => { try { return JSON.parse(localStorage.getItem('badge-studio-settings') || '{}'); } catch { return {}; } })());
  const saveSettings = () => { try { localStorage.setItem('badge-studio-settings', JSON.stringify(settings)); } catch { /* ignore */ } };
  function applyTheme() { const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.querySelector('meta[name=theme-color]').content = dark ? '#111411' : '#f4f4ee'; document.documentElement.dataset.motion = settings.motion ? 'reduce' : ''; }
  applyTheme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---------- state ---------- */
  let project = BS.scene.normalize({ export: { resolution: settings.resolution } });
  project.text.line2 = settings.name + ' • STEM MAKER';
  const assets = { image: null, gif: null, video: null, videoURL: null, sequence: [], qr: null, now: new Date() };
  let page = 'home', playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, time = 0, lastTick = 0, busy = false, buildCancelled = false, prepared = null, libraryItems = [], materials = [], recording = false;
  const pixel = new BS.pixel.PixelEditor(16); pixel.frames = [BS.pixel.defaultHeart(16)];
  const arcade = new BS.games.Arcade(() => updateGameStatus());
  const stage = $('stage'), sctx = stage.getContext('2d');

  /* ---------- helpers ---------- */
  function toast(message, error = false) { const el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.textContent = message; $('toasts').append(el); setTimeout(() => el.remove(), error ? 7500 : 4000); }
  function report(e) { console.error(e); toast(e.message || String(e), true); log('ERROR · ' + (e.message || e)); }
  const action = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { report(e); } };
  function log(s) { const el = $('log'), line = '[' + new Date().toLocaleTimeString('es-UY', { hour12: false }) + '] ' + s; el.textContent = (el.textContent + '\n' + line).split('\n').slice(-600).join('\n'); el.scrollTop = el.scrollHeight; }
  function download(blob, name) { const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const set = (obj, path, v) => { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; };
  function persistDraft() { try { localStorage.setItem('badge-studio-draft-v2', JSON.stringify({ project: { ...project, pixel: { ...project.pixel, frames: pixel.frames, size: pixel.size, index: pixel.index } } })); } catch { /* ignore */ } }
  function invalidate() { prepared = null; updateShelf(); persistDraft(); }
  const duration = () => (page === 'pixel' ? pixel.frames.length / project.pixel.rate : BS.scene.duration(project, assets));
  const clock = (t) => '00:' + t.toFixed(1).padStart(4, '0');

  /* ---------- navigation ---------- */
  const pageMeta = {
    home: ['Inicio'], studio: ['Crear', '01 / CREAR', 'Tu diseño', 'Un poco de código, un poco de arte. Y mucho de vos.'], pixel: ['Pixel Lab', '02 / DIBUJAR', 'Dibujá tu próximo loop.', 'Cuadro a cuadro, tu idea empieza a moverse.'],
    arcade: ['Arcade', '03 / JUGAR', 'Un clásico. Otra vuelta.', 'Jugá acá con teclado o táctil. Llevá la grabación al badge.'], materials: ['Materiales'], library: ['Mi colección'], device: ['Mi badge'], settings: ['Ajustes'],
  };
  function navigate(next) {
    if (!pageMeta[next]) next = 'home';
    if (busy && ['studio', 'pixel', 'arcade'].includes(next) && next !== page) return;
    page = next; $('sidebar').classList.remove('open');
    const editor = ['studio', 'pixel', 'arcade'].includes(next);
    if (editor) { project.mode = next === 'pixel' ? 'pixel' : next === 'arcade' ? project.mode : (project.mode === 'pixel' ? 'pattern' : project.mode); }
    if (next !== 'arcade' && arcade.game?.running) arcade.game.paused = true;
    arcade.held.clear(); if (assets.video && next !== 'studio') assets.video.pause();
    $('breadcrumb').textContent = pageMeta[next][0];
    $$('[data-page]').forEach((b) => { b.classList.toggle('active', b.dataset.page === next); b.toggleAttribute('aria-current', b.dataset.page === next); });
    for (const p of ['home', 'editor', 'materials', 'library', 'device', 'settings']) $('page-' + p).hidden = p !== (editor ? 'editor' : next);
    if (editor) {
      const m = pageMeta[next]; $('pageEyebrow').textContent = m[1]; $('pageTitle').textContent = m[2]; $('pageSubtitle').textContent = m[3]; $('inspectorTag').textContent = m[1]; $('inspectorTitle').textContent = next === 'pixel' ? 'Toneladas de píxeles' : next === 'arcade' ? 'Playground' : 'Tu diseño';
      $('modeTabs').hidden = next !== 'studio'; $('inspectorBody').hidden = next !== 'studio'; $('pixelControls').hidden = next !== 'pixel'; $('arcadeControls').hidden = next !== 'arcade';
      $('timeline').hidden = next === 'arcade'; $('gamePad').hidden = !(next === 'arcade' && settings.pad); $('exportSettings').hidden = next === 'arcade'; $('editorActions').hidden = next === 'arcade';
      $('timelineHelp').textContent = next === 'pixel' ? 'Los cuadros se reproducen en secuencia y vuelven a empezar.' : 'Todo lo que ves acá se puede exportar.';
      if (next === 'studio') renderInspector(); if (next === 'pixel') drawPixelEditor(); if (next === 'arcade' && !arcade.game) arcade.select(arcade.kind);
      time = 0; syncExport();
    }
    if (next === 'home') renderHome(); if (next === 'library') refreshLibrary(); if (next === 'materials') renderMaterials(); if (next === 'device') updateConnection(client);
    history.replaceState(null, '', '#' + next); persistDraft(); drawNow();
  }

  /* ---------- stage loop ---------- */
  function drawNow() {
    if (!['studio', 'pixel', 'arcade'].includes(page)) return;
    if (page === 'arcade') { arcade.draw(sctx); return; }
    const t = page === 'pixel' && !playing ? pixel.index / project.pixel.rate : time;
    if (page === 'pixel') { project.pixel.frames = pixel.frames; project.pixel.size = pixel.size; }
    BS.scene.render(sctx, t, project, assets);
    $('timeCode').textContent = clock(time) + ' / ' + clock(duration()); $('scrubber').value = time;
  }
  let acc = 0;
  function tick(ts) {
    const dt = lastTick ? Math.min(0.05, (ts - lastTick) / 1000) : 0; lastTick = ts;
    if (!document.hidden) {
      if (page === 'arcade') { if (arcade.game?.running && !arcade.game.paused) arcade.step(dt); }
      else if (playing && !busy) {
        time = (time + dt) % duration();
        if (page === 'studio' && project.mode === 'video' && assets.video?.readyState >= 2) { const v = assets.video, start = Math.min(project.video.start, Math.max(0, v.duration - 0.1)), end = Math.min(v.duration, start + project.export.duration * (project.video.speed || 1)); v.playbackRate = project.video.speed || 1; if (v.paused) v.play().catch(() => {}); if (v.currentTime < start || v.currentTime >= end - 0.03) v.currentTime = start; }
      }
      acc += dt; if (acc >= 1 / (page === 'arcade' ? 60 : 30)) { drawNow(); acc = 0; }
      if (page === 'home' && acc === 0) drawHomePreview();
    }
    requestAnimationFrame(tick);
  }
  function updatePlayIcon() { $('playPause').innerHTML = icon(playing ? 'pause' : 'play'); $('playPause').setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir'); }
  function togglePlay() { playing = !playing; updatePlayIcon(); if (!playing && assets.video) assets.video.pause(); drawNow(); }
  function setShape(circle) { $('hardware').classList.toggle('square', !circle); $('circleView').classList.toggle('selected', circle); $('squareView').classList.toggle('selected', !circle); }

  /* ---------- inspector (dynamic form) ---------- */
  const F = {
    range: (path, label, min, max, step, fmt = (v) => v) => ({ kind: 'range', path, label, min, max, step, fmt }),
    select: (path, label, options) => ({ kind: 'select', path, label, options }),
    color: (path, label) => ({ kind: 'color', path, label }),
    text: (path, label, max = 80, area = false) => ({ kind: 'text', path, label, max, area }),
    check: (path, label) => ({ kind: 'check', path, label }),
    swatches: (path, label, colors) => ({ kind: 'swatches', path, label, colors }),
    custom: (render) => ({ kind: 'custom', render }),
  };
  const SWATCH = ['#d0f56a', '#ffffff', '#a7b7ff', '#ff8f72', '#69dfd0', '#ffd166', '#eb77b5', '#469cff', '#ff3b3b', '#111111'];
  const filterFields = () => [F.range('media.filters.brightness', 'Brillo', 20, 200, 5, (v) => v + '%'), F.range('media.filters.contrast', 'Contraste', 20, 200, 5, (v) => v + '%'), F.range('media.filters.saturate', 'Saturación', 0, 250, 5, (v) => v + '%'), F.range('media.filters.hue', 'Tono', 0, 360, 5, (v) => v + '°'), F.range('media.filters.grayscale', 'Gris', 0, 100, 5, (v) => v + '%'), F.range('media.filters.sepia', 'Sepia', 0, 100, 5, (v) => v + '%'), F.range('media.filters.invert', 'Invertir', 0, 100, 10, (v) => v + '%'), F.range('media.filters.blur', 'Desenfoque', 0, 10, 1, (v) => v + 'px')];
  const mediaFields = () => [F.select('media.fit', 'Encuadre', BS.scene.FITS), F.range('media.zoom', 'Zoom', 0.3, 3, 0.05, (v) => v.toFixed(2) + '×'), F.range('media.panX', 'Mover ↔', -0.5, 0.5, 0.01, (v) => Math.round(v * 100) + '%'), F.range('media.panY', 'Mover ↕', -0.5, 0.5, 0.01, (v) => Math.round(v * 100) + '%'), F.range('media.rotation', 'Rotación', 0, 359, 1, (v) => v + '°'), F.check('media.flipH', 'Voltear horizontal'), F.check('media.flipV', 'Voltear vertical'), F.select('media.mask', 'Máscara', [['none', 'Sin máscara'], ['circle', 'Círculo'], ['rounded', 'Redondeada']])];
  function modeFields() {
    switch (project.mode) {
      case 'pattern': return [F.custom(renderPatternPicker), F.swatches('pattern.color', 'Color principal', SWATCH), F.color('pattern.color', 'Color exacto'), F.swatches('pattern.color2', 'Color secundario', SWATCH), F.range('pattern.speed', 'Velocidad', 0.25, 3, 0.25, (v) => v + '×'), F.range('pattern.density', 'Densidad', 0.3, 2, 0.1, (v) => v.toFixed(1) + '×')];
      case 'text': return [F.text('text.line1', 'Texto principal', 120, true), F.text('text.line2', 'Texto secundario', 60), F.select('text.effect', 'Efecto', BS.textfx.EFFECTS), F.select('text.font', 'Tipografía', BS.textfx.FONTS.map((f) => [f[0], f[1]])), F.range('text.size', 'Tamaño', 12, 72, 1, (v) => v + ' px'), F.swatches('text.color', 'Color', SWATCH), F.color('text.color', 'Color exacto'), F.color('text.color2', 'Color secundario'), F.range('text.speed', 'Velocidad', 0.25, 3, 0.25, (v) => v + '×'), F.check('text.bold', 'Negrita'), F.check('text.outline', 'Contorno'), F.color('text.outlineColor', 'Color del contorno'), F.check('text.shadow', 'Sombra')];
      case 'image': return [F.custom(renderImagePicker), ...mediaFields(), F.custom((el) => group(el, 'Filtros', filterFields()))];
      case 'gif': return [F.custom(renderGifPicker), F.range('gif.fps', 'FPS (0 = original)', 0, 30, 1, (v) => (v ? v + ' FPS' : 'original')), F.range('gif.trimStart', 'Inicio', 0, 0.95, 0.05, (v) => Math.round(v * 100) + '%'), F.range('gif.trimEnd', 'Fin', 0.05, 1, 0.05, (v) => Math.round(v * 100) + '%'), F.check('gif.reverse', 'Invertir'), F.check('gif.boomerang', 'Boomerang'), ...mediaFields(), F.custom((el) => group(el, 'Filtros', filterFields()))];
      case 'video': return [F.custom(renderVideoPicker), F.range('video.start', 'Inicio del fragmento', 0, Math.max(0.1, (assets.video?.duration || 10) - 0.1), 0.1, (v) => v.toFixed(1) + ' s'), F.range('video.speed', 'Velocidad', 0.25, 3, 0.25, (v) => v + '×'), ...mediaFields(), F.custom((el) => group(el, 'Filtros', filterFields()))];
      case 'sequence': return [F.custom(renderSequencePicker), F.range('sequence.perFrame', 'Segundos por imagen', 0.2, 5, 0.1, (v) => v.toFixed(1) + ' s'), F.select('sequence.transition', 'Transición', [['cut', 'Corte'], ['fade', 'Fundido']]), ...mediaFields()];
      case 'qr': return [F.text('qr.text', 'Contenido (URL, texto, Wi-Fi…)', 300, true), F.text('qr.caption', 'Leyenda', 40), F.select('qr.ecc', 'Corrección de errores', [['L', 'L · 7%'], ['M', 'M · 15%'], ['Q', 'Q · 25%'], ['H', 'H · 30%']]), F.range('qr.size', 'Tamaño', 0.4, 0.85, 0.05, (v) => Math.round(v * 100) + '%'), F.color('qr.fg', 'Módulos'), F.color('qr.bg', 'Fondo del QR')];
      case 'clock': return [F.select('clock.face', 'Carátula', BS.clock.FACES), F.swatches('clock.color', 'Acento', SWATCH), F.color('clock.color2', 'Texto / agujas'), F.check('clock.h24', 'Formato 24 h'), F.check('clock.showDate', 'Mostrar fecha'), F.check('clock.showSeconds', 'Mostrar segundos'), F.custom((el) => { el.innerHTML = '<p class="help">El badge reproduce la animación exportada: la hora queda fija al momento de preparar. Sincronizá el reloj interno desde Mi badge → Hora.</p>'; })];
      default: return [];
    }
  }
  function commonFields() {
    return [
      F.custom((el) => group(el, 'Fondo', [F.select('background.kind', 'Tipo', BS.scene.BACKGROUNDS), F.color('background.color', 'Color'), F.color('background.color2', 'Color 2'), F.range('background.angle', 'Ángulo', 0, 360, 5, (v) => v + '°'), F.select('background.patternId', 'Animación de fondo', BS.patterns.list.map((p) => [p.id, p.name]))])),
      F.custom((el) => group(el, 'Stickers', [F.custom(renderStickers)])),
      F.custom((el) => group(el, 'Texto superpuesto', [F.text('overlay.text', 'Texto', 80), F.select('overlay.position', 'Posición', [['bottom', 'Abajo'], ['center', 'Centro'], ['top', 'Arriba']]), F.select('overlay.effect', 'Movimiento', [['static', 'Fijo'], ['ticker', 'Marquesina']]), F.range('overlay.size', 'Tamaño', 10, 48, 1, (v) => v + ' px'), F.color('overlay.color', 'Color'), F.select('overlay.font', 'Tipografía', BS.textfx.FONTS.map((f) => [f[0], f[1]])), F.check('overlay.bg', 'Fondo oscuro')])),
      F.custom((el) => group(el, 'Marco', [F.select('frame.style', 'Estilo', BS.scene.FRAMES), F.color('frame.color', 'Color'), F.range('frame.width', 'Grosor', 2, 30, 1, (v) => v + ' px')])),
    ];
  }
  function renderField(f) {
    const wrap = document.createElement('div'); wrap.className = 'field';
    if (f.kind === 'custom') { f.render(wrap); return wrap; }
    const val = get(project, f.path);
    if (f.kind === 'range') { wrap.innerHTML = '<label>' + esc(f.label) + ' <output>' + esc(f.fmt(+val)) + '</output></label><input type="range" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + val + '">'; const i = wrap.querySelector('input'); i.oninput = () => { set(project, f.path, +i.value); wrap.querySelector('output').textContent = f.fmt(+i.value); changed(f.path); }; }
    else if (f.kind === 'select') { wrap.innerHTML = '<label>' + esc(f.label) + '</label><select>' + f.options.map((o) => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'; wrap.querySelector('select').onchange = (e) => { set(project, f.path, e.target.value); changed(f.path); }; }
    else if (f.kind === 'color') { wrap.innerHTML = '<label>' + esc(f.label) + ' <output>' + esc(String(val).toUpperCase()) + '</output></label><input type="color" value="' + esc(val) + '">'; const i = wrap.querySelector('input'); i.oninput = () => { set(project, f.path, i.value); wrap.querySelector('output').textContent = i.value.toUpperCase(); changed(f.path); }; }
    else if (f.kind === 'text') { wrap.innerHTML = '<label>' + esc(f.label) + '</label>' + (f.area ? '<textarea maxlength="' + f.max + '"></textarea>' : '<input type="text" maxlength="' + f.max + '">'); const i = wrap.querySelector('textarea,input'); i.value = val || ''; i.oninput = () => { set(project, f.path, i.value); changed(f.path); }; }
    else if (f.kind === 'check') { wrap.innerHTML = '<label class="check"><input type="checkbox"' + (val ? ' checked' : '') + '> ' + esc(f.label) + '</label>'; wrap.querySelector('input').onchange = (e) => { set(project, f.path, e.target.checked); changed(f.path); }; }
    else if (f.kind === 'swatches') { wrap.innerHTML = '<label>' + esc(f.label) + '</label><div class="swatches">' + f.colors.map((c) => '<button type="button" data-c="' + c + '" style="background:' + c + '" class="' + (c === val ? 'active' : '') + '" aria-label="' + c + '"></button>').join('') + '</div>'; wrap.querySelector('.swatches').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; set(project, f.path, b.dataset.c); $$('button', wrap).forEach((x) => x.classList.toggle('active', x === b)); changed(f.path); }; }
    return wrap;
  }
  function group(el, title, fields, open = false) { const d = document.createElement('details'); d.className = 'group'; if (open) d.open = true; d.innerHTML = '<summary>' + esc(title) + '</summary>'; for (const f of fields) d.append(renderField(f)); el.replaceWith(d); }
  function renderInspector() {
    const tabs = $('modeTabs'); tabs.innerHTML = BS.scene.MODES.filter((m) => m[0] !== 'pixel').map((m) => '<button data-mode="' + m[0] + '" class="' + (project.mode === m[0] ? 'active' : '') + '">' + icon(m[2]) + esc(m[1]) + '</button>').join('');
    tabs.onclick = (e) => { const b = e.target.closest('[data-mode]'); if (!b || busy) return; project.mode = b.dataset.mode; time = 0; invalidate(); renderInspector(); syncExport(); drawNow(); };
    const body = $('inspectorBody'); body.innerHTML = '';
    for (const f of [...modeFields(), ...commonFields()]) body.append(renderField(f));
  }
  function changed(path) {
    if (path.startsWith('qr.')) rebuildQR();
    if (path === 'video.start' && assets.video) assets.video.currentTime = project.video.start;
    time = Math.min(time, duration()); invalidate(); syncExport(); drawNow();
  }
  function rebuildQR() { try { assets.qr = BS.qr.encode(project.qr.text || ' ', project.qr.ecc); } catch (e) { assets.qr = null; toast(e.message, true); } }

  /* pickers */
  function renderPatternPicker(el) {
    el.innerHTML = '<label>Animación · <span class="tiny">' + BS.patterns.list.length + ' loops</span></label><div class="presets small" id="patternPicker"></div>';
    const wrap = el.querySelector('#patternPicker');
    for (const p of BS.patterns.list) { const b = document.createElement('button'); b.type = 'button'; b.className = 'preset' + (project.pattern.id === p.id ? ' active' : ''); b.innerHTML = '<canvas width="120" height="120"></canvas><span class="preset-label">' + esc(p.name) + '</span>'; b.onclick = () => { project.pattern.id = p.id; $$('.preset', wrap).forEach((x) => x.classList.toggle('active', x === b)); changed('pattern.id'); }; wrap.append(b); thumbQueue.push([b.querySelector('canvas'), p.id]); }
    pumpThumbs();
  }
  const thumbQueue = []; let pumping = false;
  function pumpThumbs() { if (pumping) return; pumping = true; const run = () => { const item = thumbQueue.shift(); if (!item) { pumping = false; return; } const [c, id] = item; if (c.isConnected) { const s = document.createElement('canvas'); s.width = s.height = 184; s.getContext('2d').fillStyle = '#090f0b'; s.getContext('2d').fillRect(0, 0, 184, 184); BS.patterns.draw(s.getContext('2d'), 1.2, { id, color: project.pattern.color, color2: project.pattern.color2, speed: 1, density: 1, duration: 4 }); c.getContext('2d').drawImage(s, 0, 0, 120, 120); } setTimeout(run, 8); }; run(); }
  function filePicker(el, label, accept, onFile, multiple = false) { el.innerHTML = '<label>' + esc(label) + '</label><label class="btn file-btn">' + icon('upload') + ' Elegir archivo<input type="file" accept="' + accept + '"' + (multiple ? ' multiple' : '') + ' hidden></label><p class="tiny" id="pickMeta"></p>'; el.querySelector('input').onchange = action(async (e) => { await onFile(e.target.files); e.target.value = ''; }); return el.querySelector('#pickMeta'); }
  function renderImagePicker(el) { const meta = filePicker(el, 'Imagen (PNG, JPG, WebP)', 'image/*', (files) => loadImage(files[0])); meta.textContent = assets.imageName || 'Sin imagen seleccionada. También podés arrastrarla sobre la pantalla.'; }
  function renderGifPicker(el) { const meta = filePicker(el, 'GIF animado', 'image/gif', (files) => loadGif(files[0])); meta.textContent = assets.gif ? assets.gifName + ' · ' + assets.gif.frames.length + ' cuadros · ' + assets.gif.width + '×' + assets.gif.height : 'Sin GIF. Probá Materiales → Desde la web.'; }
  function renderVideoPicker(el) { const meta = filePicker(el, 'Video (MP4 H.264, WebM)', 'video/*', (files) => loadVideo(files[0])); meta.textContent = assets.video ? assets.videoName + ' · ' + assets.video.duration.toFixed(1) + ' s' : 'Sin video seleccionado.'; }
  function renderSequencePicker(el) {
    el.innerHTML = '<label>Imágenes de la secuencia</label><div class="sequence-list" id="seqList"></div><div class="row"><label class="btn small file-btn">' + icon('plus') + ' Agregar<input type="file" accept="image/*" multiple hidden></label><button class="btn small" type="button" id="seqClear">Vaciar</button></div>';
    const list = el.querySelector('#seqList'); list.innerHTML = assets.sequence.map((b, i) => '<div class="seq"><img src="' + esc(b.thumb) + '" alt=""><button type="button" data-i="' + i + '">×</button></div>').join('');
    list.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; assets.sequence.splice(+b.dataset.i, 1); changed('sequence'); renderInspector(); };
    el.querySelector('input').onchange = action(async (e) => { for (const f of e.target.files) await addSequenceImage(f); e.target.value = ''; renderInspector(); });
    el.querySelector('#seqClear').onclick = () => { assets.sequence = []; changed('sequence'); renderInspector(); };
  }
  function renderStickers(el) {
    el.innerHTML = '<div class="sticker-list" id="stickerList"></div><div class="row"><input type="text" id="stickerEmoji" maxlength="8" placeholder="🔥" style="width:70px"><button class="btn small" type="button" id="stickerAdd">Agregar</button><button class="btn small" type="button" data-go="materials">Más stickers</button></div>';
    const list = el.querySelector('#stickerList');
    const render = () => { list.innerHTML = project.stickers.map((s, i) => '<div class="sticker-item"><span>' + esc(s.emoji) + '</span><div><input type="range" min="0" max="1" step="0.01" value="' + s.x + '" data-k="x" data-i="' + i + '" aria-label="Horizontal"><input type="range" min="0" max="1" step="0.01" value="' + s.y + '" data-k="y" data-i="' + i + '" aria-label="Vertical"><input type="range" min="0.05" max="0.6" step="0.01" value="' + s.size + '" data-k="size" data-i="' + i + '" aria-label="Tamaño"><select data-k="anim" data-i="' + i + '">' + [['none', 'Quieto'], ['bounce', 'Rebote'], ['spin', 'Giro'], ['pulse', 'Latido'], ['float', 'Flotar']].map((o) => '<option value="' + o[0] + '"' + (s.anim === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div><button type="button" class="icon-btn" data-del="' + i + '" aria-label="Quitar">' + icon('trash') + '</button></div>').join('') || '<p class="help">Sin stickers. Agregá un emoji o elegí uno en Materiales.</p>'; };
    render();
    list.oninput = (e) => { const t = e.target; if (t.dataset.k) { const s = project.stickers[+t.dataset.i]; s[t.dataset.k] = t.type === 'range' ? +t.value : t.value; changed('stickers'); } };
    list.onclick = (e) => { const b = e.target.closest('[data-del]'); if (b) { project.stickers.splice(+b.dataset.del, 1); render(); changed('stickers'); } };
    el.querySelector('#stickerAdd').onclick = () => { const v = el.querySelector('#stickerEmoji').value.trim(); if (v) { addSticker(v); render(); } };
    el.querySelector('[data-go]').onclick = () => navigate('materials');
  }
  function addSticker(emoji) { if (project.stickers.length >= 12) { toast('Máximo 12 stickers.', true); return; } project.stickers.push({ emoji, x: 0.5, y: 0.5, size: 0.22, rotation: 0, anim: 'bounce' }); changed('stickers'); }

  /* ---------- assets ---------- */
  async function bitmapFromFile(file, max = 1024) { const bmp = await createImageBitmap(file); const ratio = Math.min(1, max / Math.max(bmp.width, bmp.height)); if (ratio === 1) return bmp; const c = document.createElement('canvas'); c.width = Math.round(bmp.width * ratio); c.height = Math.round(bmp.height * ratio); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close(); return createImageBitmap(c); }
  function thumbOf(src, size = 96) { const c = document.createElement('canvas'); c.width = c.height = size; const w = src.width || src.videoWidth, h = src.height || src.videoHeight, s = Math.max(size / w, size / h); c.getContext('2d').drawImage(src, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s); return c.toDataURL('image/jpeg', 0.7); }
  async function loadImage(file) {
    if (!file) return; if (file.size > 20 * 1024 * 1024) throw new Error('La imagen supera los 20 MB.');
    if (file.type === 'image/gif') return loadGif(file);
    assets.image?.close?.(); assets.image = await bitmapFromFile(file, 1200); assets.imageName = file.name; assets.imageBlob = file;
    project.mode = 'image'; Object.assign(project.media, { zoom: 1, panX: 0, panY: 0, rotation: 0 }); invalidate(); renderInspector(); syncExport(); drawNow(); toast('Imagen lista. Ajustá encuadre y filtros.');
  }
  async function decodeGif(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let frames = [], width = 0, height = 0;
    if ('ImageDecoder' in window) {
      try { const dec = new ImageDecoder({ data: bytes, type: 'image/gif' }); await dec.tracks.ready; const n = dec.tracks.selectedTrack.frameCount; for (let i = 0; i < Math.min(n, 300); i++) { const { image } = await dec.decode({ frameIndex: i }); const bitmap = await createImageBitmap(image); frames.push({ bitmap, delay: Math.max(20, (image.duration || 100000) / 1000) }); width = image.displayWidth; height = image.displayHeight; image.close(); } dec.close(); } catch (e) { log('ImageDecoder falló (' + e.message + '); se usa el decodificador propio.'); frames = []; }
    }
    if (!frames.length) { const g = BS.gif.decode(bytes); width = g.width; height = g.height; for (const f of g.frames.slice(0, 300)) { const c = document.createElement('canvas'); c.width = width; c.height = height; c.getContext('2d').putImageData(new ImageData(f.data, width, height), 0, 0); frames.push({ canvas: c, delay: f.delay }); } }
    return { frames, width, height, bytes };
  }
  async function loadGif(file) {
    if (!file) return; if (file.size > 30 * 1024 * 1024) throw new Error('El GIF supera los 30 MB.');
    const g = await decodeGif(file); if (!g.frames.length) throw new Error('No se pudieron leer cuadros del GIF.');
    assets.gif = g; assets.gifName = file.name; project.mode = 'gif'; project.gif.trimStart = 0; project.gif.trimEnd = 1; Object.assign(project.media, { zoom: 1, panX: 0, panY: 0, rotation: 0 });
    invalidate(); renderInspector(); syncExport(); drawNow(); toast('GIF cargado: ' + g.frames.length + ' cuadros.');
  }
  async function loadVideo(file) {
    if (!file) return; if (file.size > 300 * 1024 * 1024) throw new Error('Elegí un video de menos de 300 MB.');
    const url = URL.createObjectURL(file), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('No se pudo leer el video. Probá MP4 H.264 o WebM.')), 15000); v.onloadeddata = () => { clearTimeout(timer); resolve(); }; v.onerror = () => { clearTimeout(timer); reject(new Error('Formato de video no compatible con este navegador.')); }; v.src = url; v.load(); }).catch((e) => { URL.revokeObjectURL(url); throw e; });
    if (!Number.isFinite(v.duration) || v.duration <= 0) throw new Error('El video no informa una duración válida.');
    assets.video?.pause(); if (assets.videoURL) URL.revokeObjectURL(assets.videoURL);
    assets.video = v; assets.videoURL = url; assets.videoName = file.name; project.mode = 'video'; project.video.start = 0; Object.assign(project.media, { zoom: 1, panX: 0, panY: 0, rotation: 0 });
    invalidate(); renderInspector(); syncExport(); drawNow(); toast('Video cargado: ' + v.duration.toFixed(1) + ' s. Elegí el inicio y la duración.');
  }
  async function addSequenceImage(file) { if (assets.sequence.length >= 30) throw new Error('Máximo 30 imágenes.'); const bmp = await bitmapFromFile(file, 800); bmp.thumb = thumbOf(bmp, 64); assets.sequence.push(bmp); project.mode = 'sequence'; changed('sequence'); }
  async function seekVideo(v, t) { if (Math.abs(v.currentTime - t) < 0.015 && v.readyState >= 2) return; await new Promise((resolve, reject) => { const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); resolve(); }, timer = setTimeout(() => { v.removeEventListener('seeked', done); reject(new Error('No se pudo leer un cuadro del video.')); }, 8000); v.addEventListener('seeked', done); v.currentTime = t; }); }

  /* ---------- export ---------- */
  function syncExport() {
    const e = project.export; $('exDuration').value = e.duration; $('exFps').value = e.fps; $('exResolution').value = e.resolution; $('exQuality').value = e.quality; $('exBudget').value = e.budgetKB; $('exStill').checked = e.still;
    const d = duration(), fps = page === 'pixel' ? project.pixel.rate : e.fps, n = e.still && page !== 'pixel' ? 2 : Math.max(1, Math.round(d * fps));
    $('exportEstimate').textContent = n + ' cuadros · ' + d.toFixed(1) + ' s · ~' + bytesLabel(n * e.resolution * e.resolution * (e.quality / 100) * 0.12);
    $('stageChip').textContent = (client.device?.name || 'E01') + ' · ' + e.resolution + ' × ' + e.resolution; $('previewFps').textContent = fps + ' FPS · ' + (e.still ? 'FIJA' : 'LOOP');
    $('scrubber').max = d; $('exDuration').closest('label').hidden = page === 'pixel' || ['gif', 'sequence'].includes(project.mode); $('exFps').closest('label').hidden = page === 'pixel' || project.mode === 'gif';
    $('pixelRateOut').textContent = project.pixel.rate + ' FPS'; $('pixelRate').value = project.pixel.rate;
  }
  async function buildFrames(onProgress) {
    const e = project.export, res = e.resolution, c = document.createElement('canvas'); c.width = c.height = res; const ctx = c.getContext('2d', { willReadFrequently: true });
    const still = e.still && page !== 'pixel', d = duration(), fps = page === 'pixel' ? project.pixel.rate : project.mode === 'gif' ? (project.gif.fps || Math.round(1000 / (assets.gif.frames.reduce((s, f) => s + f.delay, 0) / assets.gif.frames.length))) : e.fps;
    const n = still ? 2 : Math.max(1, Math.round(d * fps));
    if (n > 600) throw new Error('Demasiados cuadros (' + n + '). Reducí duración o FPS.');
    const frames = [], raw = [];
    let quality = e.quality, thumb = null;
    for (let i = 0; i < n; i++) {
      if (buildCancelled) throw new Error('Exportación cancelada.');
      const t = still ? time : i / fps;
      if (project.mode === 'video' && assets.video) await seekVideo(assets.video, Math.min(assets.video.duration - 0.04, project.video.start + t * (project.video.speed || 1)));
      BS.scene.render(ctx, t, project, assets);
      if (i === 0) thumb = thumbOf(c, 160);
      raw.push(ctx.getImageData(0, 0, res, res));
      onProgress((i + 1) / (n * 2), 'Dibujando cuadro ' + (i + 1) + ' de ' + n);
      if (i % 3 === 0) await sleep(0);
    }
    const budget = e.budgetKB * 1024;
    for (let attempt = 0; attempt < 6; attempt++) {
      frames.length = 0; let total = 0;
      for (let i = 0; i < raw.length; i++) { if (buildCancelled) throw new Error('Exportación cancelada.'); const j = BS.jpeg.encodeRGBA(raw[i].data, res, res, quality); frames.push(j); total += j.length; onProgress(0.5 + (i + 1) / (raw.length * 2), 'Codificando JPEG ' + (i + 1) + ' de ' + raw.length + ' · calidad ' + quality); if (i % 4 === 0) await sleep(0); }
      if (total <= budget || quality <= 35) { if (total > budget) toast('La animación supera el límite elegido (' + bytesLabel(total) + '). Reducí duración o FPS.', true); break; }
      quality = Math.max(35, Math.round(quality * Math.min(0.9, budget / total * 0.95)));
    }
    return { frames, fps: still ? 1 : fps, thumb, quality, raw };
  }
  async function prepare() {
    if (busy || page === 'arcade') return;
    if (project.mode === 'image' && !assets.image) throw new Error('Elegí una imagen primero.');
    if (project.mode === 'gif' && !assets.gif) throw new Error('Elegí un GIF primero.');
    if (project.mode === 'video' && !assets.video) throw new Error('Elegí un video primero.');
    if (project.mode === 'sequence' && !assets.sequence.length) throw new Error('Agregá imágenes a la secuencia.');
    buildCancelled = false; setBusy(true); const wasPlaying = playing; playing = false; assets.video?.pause();
    try {
      const b = await buildFrames((p, label) => { $('busyText').textContent = label; $('buildProgress').querySelector('span').style.width = (p * 100) + '%'; });
      const bytes = BS.avi.build(b.frames, project.export.resolution, project.export.resolution, b.fps), info = BS.avi.inspect(bytes);
      prepared = { bytes, blob: new Blob([bytes], { type: 'video/x-msvideo' }), name: sanitizeName($('targetName').value), meta: bytesLabel(bytes.length) + ' · ' + info.width + ' × ' + info.height + ' · ' + info.frames + ' cuadros · ' + info.fps + ' FPS · q' + b.quality, thumb: b.thumb, project: snapshot(), raw: b.raw, fps: b.fps, source: 'generated' };
      log('AVI listo · ' + prepared.meta); toast('Listo. Descargalo o enviálo al badge.');
    } finally { playing = wasPlaying; setBusy(false); updatePlayIcon(); updateShelf(); drawNow(); }
  }
  function setBusy(v, label = 'Preparando…') { busy = v; $('busyBanner').hidden = !v; $('busyText').textContent = label; $('buildProgress').querySelector('span').style.width = '0%'; $$('#buildAvi, #saveProject, #projectExport, #recordBtn, #savePng, #sendBadge, #downloadAvi, #downloadGif').forEach((e) => { e.disabled = v; }); $('cancelBuild').hidden = !v; if (!v) updateShelf(); }
  function updateShelf() {
    const has = !!prepared; $('preparedName').textContent = has ? prepared.name + ' · listo para el badge' : 'Tu próxima creación está por llegar.'; $('preparedMeta').textContent = has ? prepared.meta : 'Diseñá algo y preparalo para el badge.';
    $('preparedThumb').innerHTML = has && prepared.thumb ? '<img src="' + prepared.thumb + '" alt="">' : '';
    $('downloadAvi').disabled = !has || busy; $('downloadGif').disabled = !has || busy || !prepared.raw; $('sendBadge').disabled = !has || busy || !client.ready || !!client.transfer?.active;
    $('sendBadge').title = !client.ready ? 'Conectá el badge para enviar.' : '';
  }
  async function exportGif() {
    if (!prepared?.raw) return; setBusy(true, 'Generando GIF…');
    try { await sleep(10); const res = project.export.resolution, frames = prepared.raw.map((d) => ({ data: d.data, width: res, height: res, delay: Math.round(1000 / prepared.fps) })); const g = BS.gif.encode(frames.length > 120 ? frames.filter((_, i) => i % 2 === 0) : frames); download(new Blob([g], { type: 'image/gif' }), prepared.name.replace(/\.AVI$/i, '') + '.gif'); toast('GIF descargado (' + bytesLabel(g.length) + ').'); }
    finally { setBusy(false); }
  }
  function snapshot() { return { format: 'badge-studio', version: 2, project: { ...project, pixel: { ...project.pixel, frames: pixel.frames, size: pixel.size, index: pixel.index } }, page, assets: { imageName: assets.imageName || '', gifName: assets.gifName || '', videoName: assets.videoName || '', sequence: assets.sequence.length } }; }
  async function serializeAssets() {
    const out = {};
    if (assets.imageBlob) out.image = await blobToDataURL(assets.imageBlob);
    if (assets.gif?.bytes) out.gif = await blobToDataURL(new Blob([assets.gif.bytes], { type: 'image/gif' }));
    if (assets.sequence.length) out.sequence = assets.sequence.map((b) => { const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; c.getContext('2d').drawImage(b, 0, 0); return c.toDataURL('image/jpeg', 0.85); });
    return out;
  }
  const blobToDataURL = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('No se pudo leer el archivo.')); r.readAsDataURL(blob); });
  async function dataURLToFile(url, name) { const res = await fetch(url); return new File([await res.blob()], name, { type: (url.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream' }); }
  async function restoreProject(snap, savedAssets = {}) {
    if (!snap || snap.format !== 'badge-studio') throw new Error('No es un proyecto de Badge Studio.');
    if (snap.version === 1) snap = upgradeV1(snap);
    const p = BS.scene.normalize(snap.project);
    if (p.pixel.frames?.length) { try { pixel.load(BS.pixel.validateFrames(p.pixel.frames, p.pixel.size || 16), p.pixel.size || 16); } catch (e) { toast(e.message, true); } }
    project = p; project.pixel.frames = pixel.frames; project.pixel.size = pixel.size;
    assets.image?.close?.(); assets.image = null; assets.imageName = ''; assets.gif = null; assets.gifName = ''; assets.sequence = [];
    if (savedAssets.image) { const f = await dataURLToFile(savedAssets.image, snap.assets?.imageName || 'imagen'); assets.image = await bitmapFromFile(f, 1200); assets.imageBlob = f; assets.imageName = f.name; }
    if (savedAssets.gif) { const f = await dataURLToFile(savedAssets.gif, snap.assets?.gifName || 'animacion.gif'); assets.gif = await decodeGif(f); assets.gifName = f.name; }
    if (savedAssets.sequence) for (const u of savedAssets.sequence) { const b = await createImageBitmap(await (await fetch(u)).blob()); b.thumb = thumbOf(b, 64); assets.sequence.push(b); }
    if (project.mode === 'video' && !assets.video) toast('Volvé a seleccionar el video original para continuar.');
    if (project.mode === 'qr') rebuildQR();
    invalidate(); navigate(project.mode === 'pixel' ? 'pixel' : snap.page === 'arcade' ? 'arcade' : 'studio'); renderInspector(); drawPixelEditor(); drawNow();
  }
  function upgradeV1(s) { const st = s.state || {}; const modeMap = { animation: 'pattern', text: 'text', image: 'image', video: 'video' }; const p = BS.scene.normalize({ mode: st.editor === 'pixel' ? 'pixel' : modeMap[st.mode] || 'pattern', pattern: { id: st.effect || 'orbit', color: st.accent || '#d0f56a', speed: st.speed || 1 }, text: { line1: st.headline || '', line2: st.subtitle || '', effect: st.textStyle || 'pulse', size: st.fontSize || 28, color: st.accent || '#d0f56a' }, media: { fit: st.fitMode || 'cover', zoom: st.zoom || 1, rotation: st.rotation || 0 }, pixel: { frames: s.pixelFrames || [], size: 16, rate: st.pixelRate || 4 }, export: { duration: st.duration || 4, fps: st.fps || 10, resolution: st.resolution || 368, quality: Math.round((st.quality || 0.82) * 100), still: !!st.stillMode } }); return { format: 'badge-studio', version: 2, project: p, page: st.editor === 'pixel' ? 'pixel' : 'studio', assets: { imageName: s.imageName || '' }, _v1image: s.imageData }; }

  /* ---------- pixel lab ---------- */
  function drawPixelEditor() {
    const c = $('pixelCanvas'), ctx = c.getContext('2d'), n = pixel.size, cell = 320 / n, f = pixel.frame, prev = pixel.onion && pixel.index > 0 ? pixel.frames[pixel.index - 1] : null;
    ctx.fillStyle = '#10170f'; ctx.fillRect(0, 0, 320, 320);
    for (let i = 0; i < n * n; i++) { const x = (i % n) * cell, y = Math.floor(i / n) * cell; ctx.fillStyle = ((i % n) + Math.floor(i / n)) % 2 ? '#162012' : '#1c2617'; ctx.fillRect(x, y, cell, cell); if (prev && prev[i] && !f[i]) { ctx.globalAlpha = 0.3; ctx.fillStyle = prev[i]; ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2); ctx.globalAlpha = 1; } if (f[i]) { ctx.fillStyle = f[i]; ctx.fillRect(x, y, cell - (n <= 16 ? 1 : 0), cell - (n <= 16 ? 1 : 0)); } }
    $('frameCount').textContent = (pixel.index + 1) + ' / ' + pixel.frames.length;
    $('pixelFrames').innerHTML = pixel.frames.map((_, i) => '<button class="frame-btn ' + (i === pixel.index ? 'active' : '') + '" data-frame="' + i + '">' + (i + 1) + '</button>').join('');
    $('deleteFrame').disabled = pixel.frames.length <= 1; $('undoPixel').disabled = !pixel.undo.length; $('redoPixel').disabled = !pixel.redo.length; $('pixelColor').value = pixel.color; $('pixelSize').value = pixel.size;
    $$('#pixelTools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === pixel.tool)); $$('#pixelPalette button').forEach((b) => b.classList.toggle('active', b.dataset.ink === pixel.color));
    project.pixel.frames = pixel.frames; project.pixel.size = pixel.size; project.pixel.index = pixel.index;
  }
  function pixelChanged() { playing = false; updatePlayIcon(); invalidate(); drawPixelEditor(); syncExport(); drawNow(); }
  function setupPixels() {
    $('pixelTools').innerHTML = BS.pixel.TOOLS.map((t) => '<button data-tool="' + t[0] + '">' + t[1] + '</button>').join('');
    $('pixelTools').onclick = (e) => { const b = e.target.closest('[data-tool]'); if (b) { pixel.tool = b.dataset.tool; drawPixelEditor(); } };
    const renderPalette = () => { $('pixelPalette').innerHTML = BS.pixel.PALETTES[$('paletteSelect').value].map((c) => '<button data-ink="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join(''); drawPixelEditor(); };
    renderPalette(); $('paletteSelect').onchange = renderPalette;
    $('pixelPalette').onclick = (e) => { const b = e.target.closest('[data-ink]'); if (b) { pixel.color = b.dataset.ink; drawPixelEditor(); } };
    $('pixelColor').oninput = (e) => { pixel.color = e.target.value; };
    $('pixelMirror').onchange = (e) => { pixel.mirror = e.target.checked; }; $('pixelOnion').onchange = (e) => { pixel.onion = e.target.checked; drawPixelEditor(); };
    $('pixelSize').onchange = (e) => { pixel.resize(+e.target.value); pixelChanged(); };
    $('pixelFlipH').onclick = () => { pixel.flip(true); pixelChanged(); }; $('pixelFlipV').onclick = () => { pixel.flip(false); pixelChanged(); };
    $('pixelShiftL').onclick = () => { pixel.shift(-1, 0); pixelChanged(); }; $('pixelShiftR').onclick = () => { pixel.shift(1, 0); pixelChanged(); }; $('pixelShiftU').onclick = () => { pixel.shift(0, -1); pixelChanged(); }; $('pixelShiftD').onclick = () => { pixel.shift(0, 1); pixelChanged(); };
    const c = $('pixelCanvas'); const cellOf = (e) => { const r = c.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * pixel.size), Math.floor((e.clientY - r.top) / r.height * pixel.size)]; };
    let painting = false;
    c.onpointerdown = (e) => { if (busy) return; e.preventDefault(); c.focus(); c.setPointerCapture(e.pointerId); painting = true; playing = false; updatePlayIcon(); if (pixel.down(...cellOf(e))) pixelChanged(); };
    c.onpointermove = (e) => { if (painting && pixel.move(...cellOf(e))) { drawPixelEditor(); drawNow(); } };
    c.onpointerup = c.onpointercancel = () => { if (painting) { painting = false; pixel.up(); pixelChanged(); } };
    c.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey ? pixel.redoStep() : pixel.undoStep()) pixelChanged(); } };
    $('pixelFrames').onclick = (e) => { const b = e.target.closest('[data-frame]'); if (b) { pixel.index = +b.dataset.frame; playing = false; updatePlayIcon(); drawPixelEditor(); drawNow(); } };
    $('addFrame').onclick = () => { pixel.addFrame(); pixelChanged(); }; $('duplicateFrame').onclick = () => { pixel.duplicateFrame(); pixelChanged(); }; $('deleteFrame').onclick = () => { pixel.deleteFrame(); pixelChanged(); };
    $('moveFrameL').onclick = () => { pixel.moveFrame(-1); pixelChanged(); }; $('moveFrameR').onclick = () => { pixel.moveFrame(1); pixelChanged(); };
    $('clearPixel').onclick = () => { pixel.clear(); pixelChanged(); }; $('undoPixel').onclick = () => { if (pixel.undoStep()) pixelChanged(); }; $('redoPixel').onclick = () => { if (pixel.redoStep()) pixelChanged(); };
    $('pixelRate').oninput = (e) => { project.pixel.rate = +e.target.value; invalidate(); syncExport(); };
    $('pixelImport').onchange = action(async (e) => { const f = e.target.files[0]; if (!f) return; const bmp = await createImageBitmap(f); const n = pixel.size, c2 = document.createElement('canvas'); c2.width = c2.height = n; const x = c2.getContext('2d'); x.imageSmoothingEnabled = true; const s = Math.max(n / bmp.width, n / bmp.height); x.drawImage(bmp, (n - bmp.width * s) / 2, (n - bmp.height * s) / 2, bmp.width * s, bmp.height * s); pixel.importImageData(x.getImageData(0, 0, n, n).data, n); bmp.close(); pixelChanged(); e.target.value = ''; toast('Imagen convertida a ' + n + '×' + n + ' píxeles.'); });
    $('pixelPng').onclick = () => { const url = pixel.toPNGData(16); const a = document.createElement('a'); a.href = url; a.download = 'pixel-art.png'; a.click(); };
    drawPixelEditor();
  }

  /* ---------- arcade ---------- */
  function updateGameStatus() { $('gameStatus').textContent = arcade.status(); const g = arcade.game; $('pauseGame').disabled = !g?.running; $('pauseGame').textContent = g?.paused ? 'Continuar' : 'Pausar'; $('startGame').innerHTML = icon(g?.running ? 'reset' : 'play') + (g?.running ? 'Reiniciar' : 'Empezar'); }
  function setupArcade() {
    $('gameChooser').innerHTML = BS.games.GAMES.map((g) => '<button data-game="' + g[0] + '">' + g[1] + '</button>').join('');
    const select = (kind) => { if (recording) return; arcade.select(kind); $$('[data-game]').forEach((b) => b.classList.toggle('active', b.dataset.game === kind)); const g = BS.games.GAMES.find((x) => x[0] === kind); $('gameTitle').textContent = g[1]; $('gameInstructions').textContent = g[2]; updateGameStatus(); drawNow(); };
    $('gameChooser').onclick = (e) => { const b = e.target.closest('[data-game]'); if (b) select(b.dataset.game); };
    select('snake');
    $('startGame').onclick = () => { arcade.start(); stage.focus({ preventScroll: true }); drawNow(); }; $('pauseGame').onclick = () => arcade.togglePause();
    $('recordBtn').onclick = action(recordGame); $('padToggle').checked = settings.pad; $('padToggle').onchange = (e) => { settings.pad = e.target.checked; saveSettings(); $('gamePad').hidden = !(page === 'arcade' && settings.pad); };
    $('downloadPort').onclick = () => download(new Blob([SNAKE_PORT], { type: 'text/x-c' }), 'badge_snake_portable.c');
    window.addEventListener('keydown', (e) => { if (page !== 'arcade' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector('dialog[open]')) return; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); arcade.held.add(e.key); arcade.direction(e.key); } else if (e.code === 'Space') { e.preventDefault(); if (arcade.game?.running) { if (arcade.kind === 'flappy') arcade.direction('Space'); else arcade.togglePause(); } else arcade.start(); } });
    window.addEventListener('keyup', (e) => arcade.held.delete(e.key)); window.addEventListener('blur', () => arcade.held.clear());
    $$('[data-key]').forEach((b) => { b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); if (b.dataset.key === 'Space') { if (!arcade.game?.running) arcade.start(); else if (arcade.kind === 'flappy') arcade.direction('Space'); else arcade.togglePause(); return; } arcade.held.add(b.dataset.key); arcade.direction(b.dataset.key); }; b.onpointerup = b.onpointercancel = () => arcade.held.delete(b.dataset.key); });
    let pointer = false; const logical = (e) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 368, (e.clientY - r.top) / r.height * 368]; };
    stage.addEventListener('pointerdown', (e) => { if (page !== 'arcade') return; e.preventDefault(); stage.focus({ preventScroll: true }); if (!arcade.game?.running) { if (!arcade.game?.paused) arcade.start(); } pointer = true; stage.setPointerCapture(e.pointerId); arcade.pointer(...logical(e), 'down'); });
    stage.addEventListener('pointermove', (e) => { if (pointer) arcade.pointer(...logical(e), 'move'); });
    const end = (e) => { if (pointer) { pointer = false; arcade.pointer(...logical(e), 'up'); } };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  }
  async function recordGame() {
    if (busy) return; if (!arcade.game?.running) arcade.start(); if (arcade.game.paused) arcade.togglePause();
    recording = true; buildCancelled = false; setBusy(true, 'Grabando 6 segundos de tu partida…');
    const res = project.export.resolution, c = document.createElement('canvas'); c.width = c.height = res; const ctx = c.getContext('2d', { willReadFrequently: true }), frames = [], start = performance.now(); let thumb;
    try {
      for (let i = 0; i < 60; i++) { if (buildCancelled) throw new Error('Grabación cancelada.'); if (document.hidden) throw new Error('La grabación se interrumpió al ocultar la pestaña.'); await sleep(Math.max(0, start + i * 100 - performance.now())); arcade.draw(ctx); if (i === 0) thumb = thumbOf(c, 160); frames.push(BS.jpeg.encodeCanvas(c, 0.8)); $('busyText').textContent = 'Grabando · ' + (i / 10).toFixed(1) + ' / 6 s · seguí jugando'; $('buildProgress').querySelector('span').style.width = ((i + 1) / 60 * 100) + '%'; }
      const bytes = BS.avi.build(frames, res, res, 10); BS.avi.inspect(bytes);
      prepared = { bytes, blob: new Blob([bytes], { type: 'video/x-msvideo' }), name: sanitizeName(arcade.kind), meta: 'Partida grabada · ' + bytesLabel(bytes.length) + ' · 6 s · 10 FPS', thumb, project: null, source: 'recording' };
      await BS.db.projects.put({ id: uniqueId(), name: $('gameTitle').textContent + ' · partida', created: Date.now(), thumb, project: null, avi: prepared.blob, meta: prepared.meta, fileName: prepared.name });
      toast('Partida grabada y guardada. Ya podés mandarla al badge.');
    } finally { recording = false; setBusy(false); updateGameStatus(); }
  }

  /* ---------- library ---------- */
  async function refreshLibrary() { try { libraryItems = (await BS.db.projects.all()).sort((a, b) => b.created - a.created); $('libraryCount').textContent = libraryItems.length; renderLibrary(); } catch (e) { toast(e.message, true); } }
  function libraryCard(item) { return '<article class="library-card"><div class="library-image"><img src="' + esc(item.thumb || '') + '" alt=""></div><div class="library-meta"><h3>' + esc(item.name) + '</h3><p>' + esc(item.meta || 'Proyecto editable') + ' · ' + new Date(item.created).toLocaleDateString() + '</p><div class="actions"><button class="btn small dark" data-open="' + esc(item.id) + '">' + (item.project ? 'Abrir' : 'Usar AVI') + '</button>' + (item.avi ? '<button class="btn small" data-download="' + esc(item.id) + '">' + icon('download') + 'AVI</button>' : '') + '<button class="icon-btn" data-delete="' + esc(item.id) + '" aria-label="Eliminar">' + icon('trash') + '</button></div></div></article>'; }
  function renderLibrary() { const term = $('librarySearch').value.toLocaleLowerCase(), items = libraryItems.filter((x) => x.name.toLocaleLowerCase().includes(term)); $('emptyLibrary').hidden = items.length > 0; $('libraryList').innerHTML = items.map(libraryCard).join(''); }
  async function libraryAction(e) {
    const btn = e.target.closest('button'); if (!btn) return;
    const id = btn.dataset.open || btn.dataset.download || btn.dataset.delete, item = libraryItems.find((i) => i.id === id); if (!item) return;
    if (btn.dataset.delete) { if (confirm('¿Eliminar «' + item.name + '» de esta colección local?')) { await BS.db.projects.remove(id); await refreshLibrary(); renderHome(); } return; }
    if (btn.dataset.download) { download(item.avi, item.fileName || 'BADGE001.AVI'); return; }
    if (item.project) await restoreProject(item.project, item.assets || {});
    if (item.avi) { const bytes = new Uint8Array(await item.avi.arrayBuffer()); BS.avi.inspect(bytes); prepared = { bytes, blob: item.avi, name: item.fileName || 'BADGE001.AVI', meta: item.meta, thumb: item.thumb, project: item.project, source: 'collection' }; $('targetName').value = prepared.name; updateShelf(); if (!item.project) { navigate('studio'); toast('AVI seleccionado. Descargalo o envialo al badge.'); } }
  }
  async function saveCurrent(name) {
    const snap = snapshot(), savedAssets = await serializeAssets(), thumb = page === 'arcade' ? null : thumbOf(stage, 160);
    await BS.db.projects.put({ id: uniqueId(), name: name.trim() || 'Mi diseño', created: Date.now(), thumb: thumb || prepared?.thumb, project: snap, assets: savedAssets, avi: prepared?.blob || null, meta: prepared?.meta || 'Proyecto editable · sin AVI preparado', fileName: prepared?.name || sanitizeName(settings.prefix + '001') });
    $('saveDialog').close(); toast('Guardado en tu colección.'); refreshLibrary();
  }
  async function importAVI(file) {
    if (!file) return; const bytes = new Uint8Array(await file.arrayBuffer()), info = BS.avi.inspect(bytes), bmp = await createImageBitmap(new Blob([info.first], { type: 'image/jpeg' })), thumb = thumbOf(bmp, 160); bmp.close();
    prepared = { bytes, blob: new Blob([bytes], { type: 'video/x-msvideo' }), name: sanitizeName(file.name), meta: bytesLabel(bytes.length) + ' · ' + info.width + ' × ' + info.height + ' · ' + info.frames + ' cuadros · ' + info.fps.toFixed(1) + ' FPS', thumb, project: null, source: 'imported' };
    $('targetName').value = prepared.name;
    await BS.db.projects.put({ id: uniqueId(), name: file.name.slice(0, 60), created: Date.now(), thumb, project: null, avi: prepared.blob, meta: prepared.meta, fileName: prepared.name });
    updateShelf(); await refreshLibrary(); toast('AVI validado y guardado en tu colección.');
  }

  /* ---------- home ---------- */
  function renderHome() {
    const quick = [['pattern', 'Animación', 'wand'], ['text', 'Texto', 'type'], ['image', 'Imagen', 'image'], ['gif', 'GIF', 'film'], ['video', 'Video', 'video'], ['qr', 'Código QR', 'qr'], ['clock', 'Reloj', 'clock'], ['pixel', 'Pixel art', 'pixel'], ['arcade', 'Arcade', 'game']];
    $('quickGrid').innerHTML = quick.map((q) => '<button data-quick="' + q[0] + '">' + icon(q[2]) + esc(q[1]) + '</button>').join('');
    $('quickGrid').onclick = (e) => { const b = e.target.closest('[data-quick]'); if (!b) return; const k = b.dataset.quick; if (k === 'arcade') navigate('arcade'); else if (k === 'pixel') navigate('pixel'); else { project.mode = k; if (k === 'qr') rebuildQR(); invalidate(); navigate('studio'); } };
    refreshLibrary().then(() => { const recent = libraryItems.slice(0, 4); $('homeRecent').innerHTML = recent.map(libraryCard).join(''); $('homeEmpty').hidden = recent.length > 0; });
    const feat = BS.patterns.list.slice(0, 6); $('homeMaterials').innerHTML = feat.map((p) => '<button class="preset" data-pattern="' + p.id + '"><canvas width="120" height="120"></canvas><span class="preset-label">' + esc(p.name) + '</span></button>').join('');
    $$('#homeMaterials .preset').forEach((b) => thumbQueue.push([b.querySelector('canvas'), b.dataset.pattern])); pumpThumbs();
    $('homeMaterials').onclick = (e) => { const b = e.target.closest('[data-pattern]'); if (b) { project.mode = 'pattern'; project.pattern.id = b.dataset.pattern; invalidate(); navigate('studio'); } };
    updateConnection(client);
  }
  function drawHomePreview() { const c = $('homePreview'); if (!c) return; const ctx = c.getContext('2d'); BS.scene.render(ctx, performance.now() / 1000 % duration(), project, assets); }

  /* ---------- materials ---------- */
  const EMOJIS = '😀 😎 🥳 😍 🤖 👾 👻 💀 🔥 ⭐ ✨ 💖 💚 💙 🌈 ⚡ 🎉 🎈 🎵 🎮 🕹️ 🚀 🛸 🌙 ☀️ 🌍 🌸 🌵 🍕 🍔 🍩 🍉 ☕ 🐱 🐶 🦊 🐸 🦄 🐢 🦖 🏀 ⚽ 🏆 🎯 💡 🔧 🧪 🧬 🧲 📡 💻 📱 🎓 ✏️ 📚 🧩 ♟️ 🎲 🏁 🚲 🛹 🎸 🥁 🎤 🎧 ❤️ 🧡 💛 💜 🖤 🤍 ✅ ❌ ⚠️ 🔔 👋 👍 🤘 ✌️ 🙌 👀'.split(' ');
  function renderMaterials() {
    const wrap = $('materialPatterns'); if (!wrap.children.length) { wrap.innerHTML = BS.patterns.list.map((p) => '<button class="preset" data-pattern="' + p.id + '"><canvas width="150" height="150"></canvas><span class="preset-label">' + esc(p.name) + '<span class="tiny">' + esc(BS.patterns.GROUPS[p.group]) + '</span></span></button>').join(''); $$('.preset', wrap).forEach((b) => thumbQueue.push([b.querySelector('canvas'), b.dataset.pattern])); pumpThumbs(); wrap.onclick = (e) => { const b = e.target.closest('[data-pattern]'); if (b) { project.mode = 'pattern'; project.pattern.id = b.dataset.pattern; invalidate(); navigate('studio'); } }; }
    if (!$('stickerGrid').children.length) { $('stickerGrid').innerHTML = EMOJIS.map((e) => '<button data-emoji="' + e + '">' + e + '</button>').join(''); $('stickerGrid').onclick = (e) => { const b = e.target.closest('[data-emoji]'); if (b) { addSticker(b.dataset.emoji); toast('Sticker agregado. Ajustalo en Crear → Stickers.'); } }; }
    refreshMaterials();
  }
  async function refreshMaterials() { try { materials = (await BS.db.materials.all()).sort((a, b) => b.created - a.created); $('materialEmpty').hidden = materials.length > 0; $('materialList').innerHTML = materials.map((m) => '<article class="library-card"><div class="library-image"><img src="' + esc(m.thumb) + '" alt=""></div><div class="library-meta"><h3>' + esc(m.name) + '</h3><p>' + esc(m.kind === 'gif' ? 'GIF' : 'Imagen') + ' · ' + bytesLabel(m.blob.size) + '</p><div class="actions"><button class="btn small dark" data-use="' + m.id + '">Usar</button><button class="btn small" data-seq="' + m.id + '">+ Secuencia</button><button class="icon-btn" data-del="' + m.id + '" aria-label="Eliminar">' + icon('trash') + '</button></div></div></article>').join(''); } catch (e) { toast(e.message, true); } }
  async function addMaterial(file, name = file.name) { const kind = file.type === 'image/gif' ? 'gif' : 'image'; const bmp = await createImageBitmap(file); const thumb = thumbOf(bmp, 120); bmp.close(); await BS.db.materials.put({ id: uniqueId(), name: name.slice(0, 60), kind, blob: file, thumb, created: Date.now() }); }
  async function materialAction(e) {
    const b = e.target.closest('button'); if (!b) return; const m = materials.find((x) => x.id === (b.dataset.use || b.dataset.seq || b.dataset.del)); if (!m) return;
    if (b.dataset.del) { await BS.db.materials.remove(m.id); refreshMaterials(); return; }
    const file = new File([m.blob], m.name, { type: m.blob.type || (m.kind === 'gif' ? 'image/gif' : 'image/png') });
    if (b.dataset.seq) { await addSequenceImage(file); navigate('studio'); toast('Agregada a la secuencia.'); return; }
    if (m.kind === 'gif') await loadGif(file); else await loadImage(file); navigate('studio');
  }
  async function fetchWeb(url) {
    if (!/^https?:\/\//.test(url)) throw new Error('Pegá un enlace http(s) a una imagen o GIF.');
    const res = await fetch(url, { mode: 'cors' }).catch(() => { throw new Error('No se pudo descargar (el sitio no permite CORS). Descargá el archivo y subilo.'); });
    if (!res.ok) throw new Error('Error ' + res.status + ' al descargar.');
    const blob = await res.blob(); if (!/^image\//.test(blob.type)) throw new Error('El enlace no es una imagen.');
    const name = (url.split('/').pop() || 'web').split('?')[0].slice(0, 40) || 'web', file = new File([blob], name, { type: blob.type });
    await addMaterial(file, name); refreshMaterials(); if (blob.type === 'image/gif') await loadGif(file); else await loadImage(file); navigate('studio');
  }
  async function giphySearch() {
    const key = $('giphyKey').value.trim(), q = $('giphyQuery').value.trim(); if (!key) throw new Error('Ingresá tu API key de GIPHY.'); if (!q) throw new Error('Escribí qué buscar.');
    settings.giphyKey = key; saveSettings();
    const res = await fetch('https://api.giphy.com/v1/gifs/search?api_key=' + encodeURIComponent(key) + '&q=' + encodeURIComponent(q) + '&limit=24&rating=g&lang=es'); if (!res.ok) throw new Error('GIPHY respondió ' + res.status + '. Revisá la API key.');
    const data = await res.json(); $('giphyResults').innerHTML = data.data.map((g) => '<button data-url="' + esc(g.images.downsized.url) + '" title="' + esc(g.title) + '"><img src="' + esc(g.images.fixed_width_small.url) + '" alt="' + esc(g.title) + '" loading="lazy"></button>').join('') || '<p class="help">Sin resultados.</p>';
  }

  /* ---------- device ---------- */
  /* window.__badgeBluetooth lets tests inject a simulated badge (tests/helpers/sim-badge.js). */
  const client = new BS.BadgeClient({ bluetooth: window.__badgeBluetooth || null, log, change: updateConnection, progress: (p, label) => { $('transferProgress').value = p; $('transferPercent').textContent = p.toFixed(1) + ' %'; $('transferLabel').textContent = label; }, complete: onUploadComplete });
  async function onUploadComplete(name) {
    toast('El badge confirmó ' + name + '. Revisá la reproducción en su pantalla.'); $('targetName').value = nextFileName(name);
    if (prepared) { try { await BS.db.thumbs.put({ name, thumb: prepared.thumb, meta: prepared.meta, date: Date.now() }); } catch { /* ignore */ } }
    if (client.device) { try { await BS.db.devices.put({ id: client.device.id, name: client.device.name, last: Date.now() }); } catch { /* ignore */ } }
    setTimeout(() => refreshDeviceFiles().catch(() => {}), 800);
  }
  function updateConnection(c) {
    const labels = { offline: 'Sin conexión', connecting: 'Buscando…', connected: 'Conectado', authenticating: 'Autenticando…', ready: (c.device?.name || 'Badge') + ' listo' };
    const status = labels[c.state] || c.state, name = c.device?.name || '—';
    $('connectionLabel').textContent = status; $('miniStatus').textContent = status; $('deviceStatus').textContent = status; $('miniName').textContent = c.state === 'offline' ? 'Sin badge' : name; $('miniOrb').textContent = (c.device?.name || 'E01').slice(0, 3).toUpperCase(); $('miniOrb').classList.toggle('online', c.ready);
    $('connectionDot').classList.toggle('online', c.ready); $('connectBtn').disabled = ['connecting', 'authenticating'].includes(c.state);
    $('connectBtn').innerHTML = icon('bt') + '<span>' + (c.ready ? 'Mi badge' : c.state === 'connected' ? 'Autenticar' : c.state === 'connecting' ? 'Buscando…' : c.state === 'authenticating' ? 'Autenticando…' : 'Conectar badge') + '</span>';
    $('deviceConnect').innerHTML = icon('bt') + (c.connected ? 'Reconectar' : 'Conectar'); $('homeConnect').innerHTML = icon('bt') + (c.ready ? 'Conectado' : 'Conectar');
    $('deviceName').textContent = c.state === 'offline' ? '—' : name; $('deviceProfile').textContent = c.state === 'offline' ? '—' : c.profile + (c.hasQix ? ' + Qix' : '');
    $('authStatus').textContent = c.ready ? 'Verificada' : c.authState === 'failed' ? 'Requiere reintento' : c.state === 'authenticating' ? 'Verificando…' : 'Pendiente';
    const batt = c.battery === null ? 'Sin lectura' : c.battery + ' %' + (c.charging ? ' · cargando' : ''); $('batteryStatus').textContent = batt; $('miniBattery').hidden = c.battery === null; $('miniBatteryText').textContent = batt;
    $('writeStatus').textContent = c.txProps || '—'; $('storageStatus').textContent = c.storage === null ? 'Por consultar' : (c.storageName || 'SD1') + ' · 0x' + c.storage.toString(16).padStart(8, '0').toUpperCase(); $('packetStatus').textContent = c.packetSize ? c.packetSize + ' B · ' + (c.withCRC ? 'CRC16' : 'sin CRC') : 'Sin negociar';
    $('screenStatus').textContent = c.screen ? c.screen.width + ' × ' + c.screen.height : '—'; $('deviceInfoText').textContent = c.info;
    if (c.brightness !== null) { $('brightness').value = c.brightness; $('brightnessOut').textContent = c.brightness + ' %'; }
    $('authBtn').disabled = !c.tx || ['authenticating', 'ready'].includes(c.state) || !!c.transfer?.active;
    for (const id of ['infoBtn', 'storageBtn', 'batteryBtn', 'diagBtn', 'refreshFiles', 'brightnessApply', 'syncTime']) $(id).disabled = !c.ready || !!c.transfer?.active;
    $$('[data-lang]').forEach((b) => { b.disabled = !c.ready; }); $('disconnectBtn').disabled = !c.connected; $('cancelTransfer').disabled = !c.transfer?.active;
    $('homeDeviceName').textContent = c.ready ? name : 'Sin badge conectado'; $('homeDeviceMeta').textContent = c.ready ? 'Perfil ' + c.profile + ' · autenticado · ' + (c.txProps || '') : 'Conectá por Bluetooth para ver batería, archivos y enviar contenido.'; $('homeStats').hidden = !c.ready; $('homeBattery').textContent = c.battery === null ? '—' : c.battery + '%'; $('homeFiles').textContent = c.files.length || '—'; $('homeStorage').textContent = c.storageName || '—';
    $('deviceFileCount').hidden = !c.files.length; $('deviceFileCount').textContent = c.files.length; $('deleteAllFiles').hidden = !c.files.length;
    renderDeviceFiles(); updateShelf(); syncExport();
  }
  async function connectBadge(existing = null) {
    if (client.ready && !existing) { navigate('device'); return; }
    if (client.state === 'connected') await client.authenticate(); else await client.connect(existing);
    toast('Badge autenticado. Tu conexión está lista.');
    if (client.device) { try { await BS.db.devices.put({ id: client.device.id, name: client.device.name, last: Date.now() }); } catch { /* ignore */ } }
    client.refreshBattery().catch(() => {}); refreshDeviceFiles().catch((e) => log('Listado inicial: ' + e.message));
  }
  async function autoReconnect() {
    if (!settings.autoReconnect || !BS.BadgeClient.available()) return;
    const known = await client.rememberedDevices(); if (!known.length) return;
    const saved = await BS.db.devices.all().catch(() => []); const pick = known.find((d) => saved.some((s) => s.id === d.id)) || known[0];
    if (!pick) return; log('Badge recordado: ' + (pick.name || pick.id) + '. Esperando que anuncie…');
    try { if (pick.watchAdvertisements) { const ctl = new AbortController(); pick.addEventListener('advertisementreceived', () => { ctl.abort(); connectBadge(pick).catch((e) => log('Reconexión: ' + e.message)); }, { once: true }); await pick.watchAdvertisements({ signal: ctl.signal }); setTimeout(() => ctl.abort(), 30000); } } catch (e) { log('watchAdvertisements no disponible: ' + e.message); }
  }
  let thumbCache = {};
  async function refreshDeviceFiles() { if (!client.ready) throw new Error('Conectá el badge primero.'); const t = await BS.db.thumbs.all().catch(() => []); thumbCache = Object.fromEntries(t.map((x) => [x.name, x])); await client.browseFiles(); renderDeviceFiles(); }
  function renderDeviceFiles() {
    const files = client.files; $('deviceFilesEmpty').hidden = files.length > 0; $('deviceFilesTitle').textContent = files.length ? files.length + ' archivos en ' + (client.storageName || 'el badge') : 'Contenido guardado';
    $('deviceFiles').innerHTML = files.map((f, i) => { const th = thumbCache[f.name]; return '<div class="file-card"><div class="thumb">' + (th ? '<img src="' + esc(th.thumb) + '" alt="">' : esc((f.name.split('.').pop() || '').toUpperCase())) + '</div><strong>' + esc(f.name) + '</strong><small>' + (th ? esc(th.meta) : 'clúster ' + f.cluster + (f.isFile ? '' : ' · carpeta')) + '</small><div class="row"><button class="btn small danger" data-delete-file="' + i + '">' + icon('trash') + 'Borrar</button></div></div>'; }).join('');
  }
  async function deleteDeviceFile(i) { const f = client.files[i]; if (!f) return; if (!confirm('¿Borrar «' + f.name + '» del badge? No se puede deshacer.')) return; await client.deleteFile(f); toast('Borrado ' + f.name + '.'); await BS.db.thumbs.remove(f.name).catch(() => {}); renderDeviceFiles(); updateConnection(client); }
  async function deleteAllFiles() { if (!client.files.length || !confirm('¿Borrar los ' + client.files.length + ' archivos del badge? No se puede deshacer.')) return; for (const f of client.files.slice()) { try { await client.deleteFile(f); await BS.db.thumbs.remove(f.name).catch(() => {}); } catch (e) { log('No se borró ' + f.name + ': ' + e.message); } } toast('Listo.'); await refreshDeviceFiles().catch(() => {}); }
  async function runDiagnostics() { const box = $('diagResult'); box.hidden = false; box.innerHTML = '<div>Ejecutando…</div>'; const steps = await client.diagnostics(); box.innerHTML = steps.map((s) => '<div><span>' + esc(s.name) + '</span><span class="' + (s.ok ? 'ok' : 'fail') + '">' + esc(String(s.value)) + ' · ' + s.ms + ' ms</span></div>').join(''); }

  /* ---------- events ---------- */
  function setupEvents() {
    $$('[data-page]').forEach((b) => { b.onclick = () => navigate(b.dataset.page); });
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b && !b.closest('#stickerList')) navigate(b.dataset.go); });
    $('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
    $('themeBtn').onclick = () => { settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); $('setTheme').value = settings.theme; };
    $('helpBtn').onclick = () => $('helpDialog').showModal();
    $('playPause').onclick = togglePlay; $('circleView').onclick = () => setShape(true); $('squareView').onclick = () => setShape(false);
    $('resetPreview').onclick = () => { time = 0; if (page === 'arcade') arcade.start(); drawNow(); };
    $('scrubber').oninput = () => { if (busy) return; playing = false; time = +$('scrubber').value; updatePlayIcon(); if (page === 'pixel') pixel.index = Math.floor(time * project.pixel.rate) % pixel.frames.length; if (assets.video && project.mode === 'video') assets.video.currentTime = Math.min(assets.video.duration - 0.04, project.video.start + time); drawNow(); if (page === 'pixel') drawPixelEditor(); };
    for (const [id, key, num] of [['exDuration', 'duration', 1], ['exFps', 'fps', 1], ['exResolution', 'resolution', 1], ['exQuality', 'quality', 1], ['exBudget', 'budgetKB', 1]]) $(id).onchange = (e) => { project.export[key] = num ? +e.target.value : e.target.value; stage.width = stage.height = project.export.resolution; invalidate(); syncExport(); drawNow(); };
    $('exStill').onchange = (e) => { project.export.still = e.target.checked; invalidate(); syncExport(); };
    $('targetName').onchange = (e) => { e.target.value = sanitizeName(e.target.value); };
    $('buildAvi').onclick = action(prepare); $('cancelBuild').onclick = () => { buildCancelled = true; $('busyText').textContent = 'Cancelando…'; };
    $('savePng').onclick = () => stage.toBlob((b) => (b ? download(b, 'badge-studio.png') : toast('No se pudo crear el PNG.', true)), 'image/png');
    $('downloadAvi').onclick = () => { if (prepared) download(prepared.blob, prepared.name); }; $('downloadGif').onclick = action(exportGif);
    $('saveProject').onclick = () => { $('projectName').value = project.mode === 'pixel' ? 'Mi pixel loop' : project.mode === 'text' ? project.text.line1.slice(0, 40) : BS.scene.MODES.find((m) => m[0] === project.mode)[1] + ' · ' + (project.mode === 'pattern' ? BS.patterns.byId[project.pattern.id].name : ''); $('saveDialog').showModal(); $('projectName').select(); };
    $('saveForm').onsubmit = action(async (e) => { e.preventDefault(); await saveCurrent($('projectName').value); });
    $('projectExport').onclick = action(async () => { const snap = snapshot(); snap.assetsData = await serializeAssets(); download(new Blob([JSON.stringify(snap)], { type: 'application/json' }), 'mi-diseno.badge.json'); });
    $('importProject').onchange = action(async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 60 * 1024 * 1024) throw new Error('El proyecto supera los 60 MB.'); let data; try { data = JSON.parse(await f.text()); } catch { throw new Error('El archivo no es JSON válido.'); } await restoreProject(data, data.assetsData || (data._v1image ? { image: data._v1image } : {})); e.target.value = ''; toast('Proyecto abierto.'); });
    $('aviFile').onchange = action(async (e) => { await importAVI(e.target.files[0]); e.target.value = ''; }); $('librarySearch').oninput = renderLibrary; $('libraryList').onclick = action(libraryAction); $('homeRecent').onclick = action(libraryAction);
    $('materialTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; $$('#materialTabs button').forEach((x) => x.classList.toggle('active', x === b)); for (const t of ['patterns', 'stickers', 'mine', 'web']) $('materials-' + t).hidden = t !== b.dataset.tab; };
    $('materialUpload').onchange = action(async (e) => { for (const f of e.target.files) await addMaterial(f); e.target.value = ''; refreshMaterials(); $$('#materialTabs button')[2].click(); toast('Materiales guardados.'); });
    $('materialList').onclick = action(materialAction); $('webFetch').onclick = action(() => fetchWeb($('webUrl').value.trim())); $('giphySearch').onclick = action(giphySearch); $('giphyKey').value = settings.giphyKey || '';
    $('giphyResults').onclick = action(async (e) => { const b = e.target.closest('[data-url]'); if (b) await fetchWeb(b.dataset.url); });
    $('connectBtn').onclick = action(() => connectBadge()); $('homeConnect').onclick = action(() => connectBadge()); $('deviceConnect').onclick = action(async () => { if (client.connected) client.disconnect(); await connectBadge(); });
    $('authBtn').onclick = action(() => client.authenticate()); $('disconnectBtn').onclick = () => client.disconnect(); $('infoBtn').onclick = action(() => client.queryInfo()); $('storageBtn').onclick = action(() => client.queryStorage()); $('batteryBtn').onclick = action(async () => { const b = await client.refreshBattery(); toast('Batería: ' + (b.level ?? '?') + ' %'); });
    $('diagBtn').onclick = action(runDiagnostics); $('cancelTransfer').onclick = () => client.cancel(); $('refreshFiles').onclick = action(refreshDeviceFiles); $('deleteAllFiles').onclick = action(deleteAllFiles);
    $('deviceFiles').onclick = action((e) => { const b = e.target.closest('[data-delete-file]'); if (b) return deleteDeviceFile(+b.dataset.deleteFile); });
    $('brightness').oninput = (e) => { $('brightnessOut').textContent = e.target.value + ' %'; }; $('brightnessApply').onclick = action(async () => { await client.setBrightness(+$('brightness').value); toast('Brillo aplicado.'); });
    $$('[data-lang]').forEach((b) => { b.onclick = action(async () => { await client.setLanguage(b.dataset.lang); toast('Idioma enviado.'); }); }); $('syncTime').onclick = action(async () => { await client.syncTime(); toast('Hora enviada al badge.'); });
    $('forgetDevices').onclick = action(async () => { for (const d of await client.rememberedDevices()) { try { await d.forget?.(); } catch { /* ignore */ } } await BS.db.devices.clear(); toast('Badges olvidados.'); });
    $('sendBadge').onclick = () => { if (!prepared || !client.ready) return; if (!settings.confirmSend) { sendNow(); return; } $('sendSummary').textContent = prepared.meta; $('sendName').value = sanitizeName($('targetName').value); $('sendDialog').showModal(); };
    $('confirmSend').onclick = action(sendNow);
    $('copyLog').onclick = action(async () => { await navigator.clipboard.writeText($('log').textContent); toast('Registro copiado.'); }); $('downloadLog').onclick = () => download(new Blob([$('log').textContent], { type: 'text/plain' }), 'badge-diagnostico.txt'); $('clearLog').onclick = () => { $('log').textContent = ''; };
    $$('[data-close]').forEach((b) => { b.onclick = () => $(b.dataset.close).close(); }); $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    /* settings */
    $('setTheme').value = settings.theme; $('setMotion').checked = settings.motion; $('setName').value = settings.name; $('setResolution').value = settings.resolution; $('setPrefix').value = settings.prefix; $('setConfirmSend').checked = settings.confirmSend; $('setAutoReconnect').checked = settings.autoReconnect; $('versionText').textContent = 'v' + BS.VERSION;
    $('setTheme').onchange = (e) => { settings.theme = e.target.value; saveSettings(); applyTheme(); }; $('setMotion').onchange = (e) => { settings.motion = e.target.checked; saveSettings(); applyTheme(); }; $('setName').onchange = (e) => { settings.name = e.target.value.toUpperCase(); saveSettings(); };
    $('setResolution').onchange = (e) => { settings.resolution = +e.target.value; saveSettings(); }; $('setPrefix').onchange = (e) => { settings.prefix = (e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BADGE').slice(0, 5); e.target.value = settings.prefix; saveSettings(); $('targetName').value = settings.prefix + '001.AVI'; };
    $('setConfirmSend').onchange = (e) => { settings.confirmSend = e.target.checked; saveSettings(); }; $('setAutoReconnect').onchange = (e) => { settings.autoReconnect = e.target.checked; saveSettings(); };
    $('resetData').onclick = action(async () => { if (!confirm('¿Borrar colección, materiales, miniaturas y ajustes de este navegador?')) return; await BS.db.projects.clear(); await BS.db.materials.clear(); await BS.db.thumbs.clear(); await BS.db.devices.clear(); localStorage.clear(); location.reload(); });
    /* drag & drop onto the stage */
    for (const ev of ['dragover', 'dragenter']) stage.addEventListener(ev, (e) => { e.preventDefault(); });
    stage.addEventListener('drop', action(async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; if (f.type.startsWith('video/')) await loadVideo(f); else if (f.type === 'image/gif') await loadGif(f); else if (f.type.startsWith('image/')) await loadImage(f); else if (/\.avi$/i.test(f.name)) await importAVI(f); else if (/\.json$/i.test(f.name)) await restoreProject(JSON.parse(await f.text())); }));
    window.addEventListener('keydown', (e) => { if (page === 'studio' && e.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); togglePlay(); } });
    window.addEventListener('hashchange', () => navigate(location.hash.slice(1))); window.addEventListener('beforeunload', (e) => { if (client.transfer?.active) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { arcade.held.clear(); if (document.hidden) { assets.video?.pause(); if (arcade.game?.running) { arcade.game.paused = true; updateGameStatus(); } } });
    let deferredInstall = null; window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('installBtn').hidden = false; }); $('installBtn').onclick = () => deferredInstall?.prompt();
  }
  async function sendNow() {
    const content = prepared; if (!content) throw new Error('Prepará el contenido primero.');
    const name = sanitizeName($('sendName').value || $('targetName').value); $('targetName').value = name; $('sendDialog').close(); navigate('device');
    await client.upload(content.bytes, name, { ext: 'AVI' });
  }

  const SNAKE_PORT = "/* Badge Studio - portable Snake core, original implementation, MIT license.\n * NOT a firmware image: integrate with a verified board SDK (see docs/GAMES-ON-BADGE.md).\n * badge_snake_init(seed); badge_snake_turn(dx,dy); badge_snake_tick() every ~140 ms; badge_snake_render(cb).\n */\n#include <stdint.h>\n#include <stddef.h>\ntypedef void (*badge_pixel_fn)(uint8_t x, uint8_t y, uint32_t rgb);\ntypedef struct {uint8_t x,y;} badge_point;\nstatic struct {badge_point body[256],food;uint16_t length,score;int8_t dx,dy,nx,ny;uint8_t alive,won;uint32_t rng;} g;\nstatic uint32_t rnd(void){g.rng=g.rng*1664525u+1013904223u;return g.rng;}\nstatic int occupied(unsigned x,unsigned y,unsigned n){unsigned i;for(i=0;i<n;i++)if(g.body[i].x==x&&g.body[i].y==y)return 1;return 0;}\nstatic void food(void){unsigned free_count=256u-g.length,pick,i;if(!free_count){g.won=1;g.alive=0;return;}pick=rnd()%free_count;for(i=0;i<256u;i++)if(!occupied(i%16u,i/16u,g.length)){if(!pick){g.food.x=(uint8_t)(i%16u);g.food.y=(uint8_t)(i/16u);return;}pick--;}}\nvoid badge_snake_init(uint32_t seed){unsigned i;g.rng=seed;g.length=3;g.score=0;g.dx=1;g.dy=0;g.nx=1;g.ny=0;g.alive=1;g.won=0;for(i=0;i<3;i++){g.body[i].x=(uint8_t)(7u-i);g.body[i].y=8;}food();}\nvoid badge_snake_turn(int dx,int dy){if(!g.alive||!((dx==0&&(dy==1||dy==-1))||(dy==0&&(dx==1||dx==-1))))return;if(dx==-g.dx&&dy==-g.dy)return;g.nx=(int8_t)dx;g.ny=(int8_t)dy;}\nvoid badge_snake_tick(void){int x,y,eat;unsigned n,i;if(!g.alive)return;g.dx=g.nx;g.dy=g.ny;x=g.body[0].x+g.dx;y=g.body[0].y+g.dy;eat=x==g.food.x&&y==g.food.y;n=g.length-(eat?0u:1u);if(x<0||x>=16||y<0||y>=16||occupied((unsigned)x,(unsigned)y,n)){g.alive=0;return;}if(eat){g.length++;g.score++;}for(i=g.length-1;i>0;i--)g.body[i]=g.body[i-1];g.body[0].x=(uint8_t)x;g.body[0].y=(uint8_t)y;if(eat)food();}\nvoid badge_snake_render(badge_pixel_fn px){unsigned x,y,i;if(!px)return;for(y=0;y<16;y++)for(x=0;x<16;x++)px((uint8_t)x,(uint8_t)y,0x090F0Bu);if(!g.won)px(g.food.x,g.food.y,0xFF8F72u);for(i=0;i<g.length;i++)px(g.body[i].x,g.body[i].y,i?0x9DBD58u:0xEDFFD5u);}\nunsigned badge_snake_score(void){return g.score;}\nint badge_snake_alive(void){return g.alive;}\n";

  /* ---------- boot ---------- */
  try { const d = JSON.parse(localStorage.getItem('badge-studio-draft-v2') || 'null'); if (d?.project) { const p = BS.scene.normalize(d.project); if (p.pixel.frames?.length) pixel.load(BS.pixel.validateFrames(p.pixel.frames, p.pixel.size || 16), p.pixel.size || 16); project = p; } } catch { /* fresh start */ }
  project.pixel.frames = pixel.frames; project.pixel.size = pixel.size; if (project.mode === 'qr') rebuildQR();
  if (['image', 'gif', 'video', 'sequence'].includes(project.mode)) project.mode = 'pattern';
  stage.width = stage.height = project.export.resolution; $('targetName').value = settings.prefix + '001.AVI';
  setupPixels(); setupArcade(); setupEvents(); setShape(true); updatePlayIcon(); updateConnection(client);
  navigate(pageMeta[location.hash.slice(1)] ? location.hash.slice(1) : 'home'); requestAnimationFrame(tick);
  if (!BS.BadgeClient.available() && !window.__badgeBluetooth) { $('browserNotice').hidden = false; $('browserNotice').textContent = 'Crear, Pixel Lab y Arcade funcionan acá. Para Bluetooth abrí el enlace HTTPS en Chrome, Edge u Opera (Android, Windows, macOS, ChromeOS).'; log('Web Bluetooth no disponible en este contexto. Editor y exportaciones habilitados.'); }
  else { log('Listo. Crear → preparar → conectar → enviar.'); autoReconnect().catch(() => {}); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
