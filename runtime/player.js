// painted-cinema player
// Loads /film/film.json, turns every image into a brush-stroke layer, and exposes
//   window.render(seconds), window.DUR, window.READY   — the contract scripts/render.mjs drives.
import { Painter } from './engine/painter.js';
import { buildStrokes } from './engine/strokes.js';

const params = new URLSearchParams(location.search);
const FILM_DIR = '/' + (params.get('film') || 'film').replace(/^\/|\/$/g, '');

// ---- maths & colour ---------------------------------------------------------------------------
const unit = x => x < 0 ? 0 : x > 1 ? 1 : x;
const mix = (a, b, k) => a * (1 - k) + b * k;
const between = (x, a, b) => unit((x - a) / (b - a));
const smooth = k => (k = unit(k), k * k * (3 - 2 * k));
const noise = i => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
const rgb = css => { const n = parseInt(css.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// ---- film state ---------------------------------------------------------------------------------
const film = { spec: null, w: 0, h: 0, timeline: [], layers: new Map(), painter: null, glazes: [] };

// paint-in order for a layer: a diagonal sweep, broad brushes before fine ones
const diagonal = (w, h) => (x, y, level) => (x / w + y / h) * .22 + level * .03;

function rasterise(draw) {
  const c = new OffscreenCanvas(film.w, film.h), g = c.getContext('2d', { willReadFrequently: true }); draw(g); return c;
}
function toLayer(canvas, seed, order, sizes) {
  const px = canvas.getContext('2d').getImageData(0, 0, film.w, film.h).data;
  const brushes = sizes || (film.spec.detail === 'high' ? [30, 15, 7.5, 4] : [30, 15, 7.5]);
  return film.painter.layer(canvas, buildStrokes(px, film.w, film.h, { seed, order, sizes: brushes }));
}
async function imageLayer(src, seed) {
  const blob = await (await fetch(`${FILM_DIR}/${src}`)).blob(), bmp = await createImageBitmap(blob);
  return toLayer(rasterise(g => g.drawImage(bmp, 0, 0, film.w, film.h)), seed, diagonal(film.w, film.h));
}
// the end card is itself a painting: a dark ground with the title written across it
function titleLayer(t) {
  const { w, h } = film, size = Math.round(Math.min(w * 1.45 / Math.max(3, t.text.length), w * .37)), base = h * .51;
  const canvas = rasterise(g => {
    const glow = g.createRadialGradient(w / 2, h * .45, 30, w / 2, h * .45, h * .7);
    glow.addColorStop(0, t.bg?.[0] || '#2a1c14'); glow.addColorStop(1, t.bg?.[1] || '#0c0807');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.font = `600 ${size}px "Cormorant Garamond"`; g.textAlign = 'center'; g.fillStyle = t.color || '#2fd0c0'; g.fillText(t.text, w / 2, base);
  });
  const inWord = (x, y) => y > base - size * .85 && y < base + size * .1 && x > w * .08 && x < w * .92;
  return toLayer(canvas, 23, (x, y, level) => inWord(x, y) && level > 0 ? .35 + (x - w * .08) / (w * .84) * 1.1 : (x / w + y / h) * .1, [30, 12, 5]);
}

// ---- light effects ------------------------------------------------------------------------------
// all positions are fractions of the painting; each adds glazes for this frame
const EFFECTS = {
  glow(t, e) {
    const beat = e.pulse ? .5 + .5 * Math.sin(t * e.pulse) : 1, dip = e.flicker && noise(Math.floor(t * 14)) > .8 ? .15 : 1, r = e.r || 200;
    film.glazes.push({ x: e.x * film.w, y: e.y * film.h, w: 2 * r, h: 1.7 * r, tint: rgb(e.color || '#ffb050'), strength: (e.alpha ?? .15) * beat * dip });
  },
  motes(t, e) {
    const [ax, ay, bx, by] = e.box || [0, 0, 1, 1], tint = rgb(e.color || '#ffe8c0'), wrap = (v, lo, span) => lo + ((v % span) + span) % span;
    for (let i = 0; i < (e.n || 50); i++) {
      const sx = (bx - ax) * film.w, sy = (by - ay) * film.h, size = 4 + noise(i + .5) * 5;
      const x = wrap(noise(i * 1.7) * sx + Math.sin(t * .4 + i) * 30, ax * film.w, sx), y = wrap(noise(i * 2.9) * sy - t * (6 + noise(i * 4.1) * 14), ay * film.h, sy);
      film.glazes.push({ x, y, w: size, h: size, tint, strength: (e.alpha ?? .5) * (.4 + .6 * Math.abs(Math.sin(t * 1.3 + i))), feather: .8 });
    }
  },
  shaft(t, e) {
    const a = (e.angle ?? 90) * Math.PI / 180, len = (e.len || .5) * film.h;
    film.glazes.push({ x: e.x * film.w + Math.cos(a) * len / 2, y: e.y * film.h + Math.sin(a) * len / 2, w: len, h: (e.width || .3) * film.w, turn: a, tint: rgb(e.color || '#ffd090'), strength: (e.alpha ?? .04) * (1 + .25 * Math.sin(t * 2)) });
  },
  rain(t, e) {
    const top = (e.y0 ?? 0) * film.h, span = (e.h ?? .4) * film.h;
    for (let i = 0; i < (e.n || 24); i++) film.glazes.push({ x: noise(i * 3.3) * film.w, y: top + (noise(i * 5.1) * span + t * (8 + noise(i * 7.7) * 24)) % span, w: 9, h: 12, tint: rgb(e.color || '#ffcc80'), strength: .5, feather: .6 });
  },
  glint(t, e, shot) {
    const k = between(t, shot.start + (e.at ?? 0), shot.start + (e.at ?? 0) + .9); if (k <= 0 || k >= 1) return;
    for (const [x, y] of e.points || [[e.x, e.y]]) film.glazes.push({ x: x * film.w - 150 + k * 300, y: y * film.h + k * 50, w: 220, h: 22, turn: -1, tint: rgb(e.color || '#b0fff4'), strength: Math.sin(k * Math.PI) * (e.alpha ?? .4) });
  },
};

// ---- camera -------------------------------------------------------------------------------------
function viewFor(shot, t) {
  const k = smooth(between(t, shot.start, shot.end)), a = shot.cam?.from || [.5, .5, 1], b = shot.cam?.to || a;
  const zoom = Math.max(1, mix(a[2] ?? 1, b[2] ?? 1, k)), jit = shot.cam?.shake || 0;
  const halfW = film.w / (2 * zoom), halfH = film.h / (2 * zoom);
  const x = mix(a[0], b[0], k) * film.w + Math.sin(t * 31) * jit, y = mix(a[1], b[1], k) * film.h + Math.sin(t * 23) * jit;
  // clamp: the frame never leaves the painting
  return { x: Math.min(film.w - halfW, Math.max(halfW, x)), y: Math.min(film.h - halfH, Math.max(halfH, y)), zoom };
}

// ---- painting one shot --------------------------------------------------------------------------
// paintFrom: the moment this shot's strokes start being laid (undefined = already finished), over `over` seconds
function paintLayer(layer, view, t, paintFrom, over) {
  const fresh = paintFrom !== undefined;
  film.painter.paint(layer, {
    view, clock: t, layFrom: fresh ? paintFrom : -Infinity,
    orderScale: fresh ? Math.max(1, over / .6) : 1, strokeTime: fresh ? Math.min(.35, Math.max(.12, over * .35)) : .2,
    sheet: fresh ? smooth(between(t, paintFrom + over * .5, paintFrom + over * 1.2)) : 1,   // the soft underlayer arrives last
  });
}
function paintShot(shot, t, paintFrom, over) {
  const view = viewFor(shot, t);
  if (shot.title) { paintLayer(film.layers.get('§title'), view, t, shot.start, 1.6); return view; }
  // which image is showing, and is a variant being painted over it right now?
  const local = t - shot.start, steps = shot.images;
  let now = 0; while (now + 1 < steps.length && local >= steps[now + 1].at) now++;
  const step = steps[now], swapping = now > 0 && local < step.at + (step.dur ?? .5) * 1.2;
  if (swapping) { paintLayer(film.layers.get(steps[now - 1].src), view, t); paintLayer(film.layers.get(step.src), view, t, shot.start + step.at, step.dur ?? .5); }
  else paintLayer(film.layers.get(step.src), view, t, paintFrom, over);
  for (const e of shot.fx || []) EFFECTS[e.type]?.(t, e, shot);
  return view;
}

// ---- frame --------------------------------------------------------------------------------------
function render(t) {
  const { timeline, painter, spec } = film;
  const idx = Math.max(0, timeline.findLastIndex(s => t >= s.start)), shot = timeline[idx], prev = timeline[idx - 1];
  film.glazes = [];
  painter.start();
  const sweep = shot.transition === 'cut' || shot.title ? 0 : shot.transitionDur ?? .5;
  const crossing = sweep > 0 && prev && !prev.title && t < shot.start + sweep * 1.2;
  if (crossing) paintShot(prev, t);
  let paintFrom, over;
  if (crossing) { paintFrom = shot.start; over = sweep; }
  else if (idx === 0 && shot.paintIn !== false) { paintFrom = .3; over = shot.paintInDur || 2.4; }
  const view = paintShot(shot, t, paintFrom, over);
  const look = { ...(shot.look || {}) };
  if (shot.post) look.grade = { gain: [shot.post.expo ?? 1, shot.post.expo ?? 1, shot.post.expo ?? 1], chroma: shot.post.sat ?? 1.05 }, look.vignette = shot.post.vig ?? .32;
  if (shot.light === 'rake') {   // the sun sinks to the horizon of the paint and comes back up
    const low = Math.sin(between(t, shot.start + .4, shot.start + Math.min(shot.end - shot.start, 3.6)) * Math.PI);
    look.sun = { azimuth: 160, elevation: mix(50, 12, low) }; look.relief = mix(5, 12, low); look.sheen = .12 + .22 * low;
  }
  painter.show(look);
  painter.glazes(film.glazes, view);
  const line = (spec.subtitles || []).find(c => t >= c.t && t < c.t + c.dur), sub = document.getElementById('sub');
  sub.replaceChildren(); sub.style.opacity = line ? 1 : 0;
  if (line) { if (line.who) { const w = document.createElement('div'); w.className = 'who'; w.textContent = line.who; sub.append(w); } sub.append(line.text); }
  const card = timeline.find(s => s.title);
  document.getElementById('card').style.opacity = card ? smooth(between(t, card.start + 1.6, card.start + 2.2)) : 0;
}

// ---- boot ---------------------------------------------------------------------------------------
async function loadFonts() {
  const faces = [new FontFace('Cormorant Garamond', 'url(fonts/CormorantGaramond.ttf)', { weight: '300 700' }), new FontFace('Cormorant SC', 'url(fonts/CormorantSC-Medium.ttf)', { weight: '500' })];
  for (const f of faces) document.fonts.add(await f.load());
}
export async function start(canvas) {
  await loadFonts();
  const spec = film.spec = await (await fetch(`${FILM_DIR}/film.json`)).json();
  [film.w, film.h] = spec.size || [1080, 1920];
  film.painter = new Painter(canvas, { W: film.w, H: film.h, ss: +(params.get('ss') || spec.supersample || 1) });
  let clock = 0;
  film.timeline = spec.shots.map(s => {
    const images = (s.images || []).map(im => typeof im === 'string' ? { src: im, at: 0 } : { at: 0, ...im });
    const shot = { ...s, images, start: clock, end: clock + s.dur }; clock = shot.end; return shot;
  });
  if (spec.title) {
    film.timeline.push({ title: true, start: clock, end: clock + (spec.title.dur || 4) }); clock += spec.title.dur || 4;
    document.getElementById('card').replaceChildren(...(spec.title.lines || []).map((l, i) => Object.assign(document.createElement('div'), { className: 'l' + i, textContent: l })));
  }
  const sources = [...new Set(film.timeline.flatMap(s => (s.images || []).map(i => i.src)))];
  for (let i = 0; i < sources.length; i++) film.layers.set(sources[i], await imageLayer(sources[i], 11 + i * 37));
  if (spec.title) film.layers.set('§title', titleLayer(spec.title));
  window.DUR = clock; window.render = render; render(0); window.READY = true;
}
