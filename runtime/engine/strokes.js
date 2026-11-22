// painted-cinema · stroke builder
// Turns an image into curved brush strokes:
//   1. a flow field from the image's smoothed structure tensor (strokes run along forms, not across them)
//   2. a detail map (local contrast) that decides where smaller brushes are needed
//   3. strokes traced along the flow from jittered seeds, coarse brushes first, stopping where the colour changes
// Output: a Float32Array of triangle vertices for the Painter (see VERT_FLOATS).

export const VERT_FLOATS = 10;   // x, y, u (along), v (across, -1..1), r, g, b, seed, order (s), thickness

function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// separable box blur on a Float32Array (w×h), radius r
function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) { let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / n; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}

// analysis at a reduced scale: flow direction (cos, sin) and local contrast
function analyse(rgba, W, H, k) {
  const w = Math.ceil(W / k), h = Math.ceil(H / k), L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (Math.min(H - 1, y * k) * W + Math.min(W - 1, x * k)) * 4; L[y * w + x] = .3 * rgba[i] + .59 * rgba[i + 1] + .11 * rgba[i + 2]; }
  const Ls = boxBlur(L, w, h, 1);
  const jxx = new Float32Array(w * h), jxy = new Float32Array(w * h), jyy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, a = Ls[i - w - 1], b = Ls[i - w], c = Ls[i - w + 1], d = Ls[i - 1], f = Ls[i + 1], g = Ls[i + w - 1], hh = Ls[i + w], j = Ls[i + w + 1];
    const gx = (c + 2 * f + j) - (a + 2 * d + g), gy = (g + 2 * hh + j) - (a + 2 * b + c);
    jxx[i] = gx * gx; jxy[i] = gx * gy; jyy[i] = gy * gy;
  }
  const R = Math.max(2, Math.round(12 / k)), sxx = boxBlur(jxx, w, h, R), sxy = boxBlur(jxy, w, h, R), syy = boxBlur(jyy, w, h, R);
  const fc = new Float32Array(w * h), fs = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const a = .5 * Math.atan2(2 * sxy[i], sxx[i] - syy[i]) + Math.PI / 2; fc[i] = Math.cos(a); fs[i] = Math.sin(a); }
  // local contrast (std dev) via blurred L and L²
  const L2 = L.map(v => v * v), m = boxBlur(L, w, h, Math.max(1, Math.round(6 / k))), m2 = boxBlur(L2, w, h, Math.max(1, Math.round(6 / k)));
  const det = new Float32Array(w * h); for (let i = 0; i < w * h; i++) det[i] = Math.sqrt(Math.max(0, m2[i] - m[i] * m[i]));
  return { w, h, k, fc, fs, det };
}

/**
 * buildStrokes(rgba, W, H, opts) → Float32Array of triangles
 * opts: sizes [brush widths, coarse→fine], detail [contrast threshold per finer level], seed,
 *       order(x, y, level) → seconds offset at which the stroke is laid during a paint-in.
 */
export function buildStrokes(rgba, W, H, opts = {}) {
  const sizes = opts.sizes || [30, 15, 7.5], thr = opts.detail || [0, 9, 15], rand = rng(opts.seed || 7), order = opts.order || (() => 0);
  const A = analyse(rgba, W, H, 2);
  const at = (arr, x, y) => arr[Math.min(A.h - 1, Math.max(0, (y / A.k) | 0)) * A.w + Math.min(A.w - 1, Math.max(0, (x / A.k) | 0))];
  const col = (x, y) => { const i = (Math.min(H - 1, Math.max(0, y | 0)) * W + Math.min(W - 1, Math.max(0, x | 0))) * 4; return [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255]; };
  const out = []; let n = 0;
  const push = (...v) => { out.push(...v); };
  sizes.forEach((R, level) => {
    const step = R * .85;
    for (let gy = 0; gy < H + step; gy += step) for (let gx = 0; gx < W + step; gx += step) {
      const x0 = gx + (rand() - .5) * step, y0 = gy + (rand() - .5) * step;
      if (level > 0 && at(A.det, x0, y0) < thr[level] * (.8 + rand() * .4)) continue;
      const c0 = col(x0, y0);
      // trace both ways along the flow; stop at a colour edge so silhouettes stay crisp
      const maxLen = R * (1.6 + rand() * 1.8), ds = R * .5, pts = [[x0, y0]];
      for (const sgn of [1, -1]) {
        let x = x0, y = y0, dx = at(A.fc, x, y) * sgn, dy = at(A.fs, x, y) * sgn, len = 0;
        while (len < maxLen / 2) {
          let fx = at(A.fc, x, y), fy = at(A.fs, x, y); if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
          dx = dx * .5 + fx * .5; dy = dy * .5 + fy * .5; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
          const nx = x + dx * ds, ny = y + dy * ds, c = col(nx, ny);
          if (Math.abs(c[0] - c0[0]) + Math.abs(c[1] - c0[1]) + Math.abs(c[2] - c0[2]) > .32) break;
          x = nx; y = ny; len += ds; sgn > 0 ? pts.push([x, y]) : pts.unshift([x, y]);
        }
      }
      if (pts.length < 2) { const a = Math.atan2(at(A.fs, x0, y0), at(A.fc, x0, y0)); pts.splice(0, 1, [x0 - Math.cos(a) * R * .4, y0 - Math.sin(a) * R * .4], [x0 + Math.cos(a) * R * .4, y0 + Math.sin(a) * R * .4]); }
      // ribbon geometry: per point a left/right vertex; colour sampled along the stroke, slight value jitter
      const jit = 1 + (rand() - .5) * .08, seed = rand() * 1000, ord = order(x0, y0, level), thick = 1 - level * .12;
      const m = pts.length, ring = [];
      for (let i = 0; i < m; i++) {
        const [x, y] = pts[i], [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(m - 1, i + 1)];
        let tx = bx - ax, ty = by - ay; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const u = i / (m - 1), wdt = R * .5 * (.72 + .28 * Math.sin(Math.PI * Math.min(1, u * 1.3 + .1)));
        const c = col(x, y).map((v, k) => Math.min(1, (v * .65 + c0[k] * .35) * jit));
        ring.push([x - ty * wdt, y + tx * wdt, u, -1, c], [x + ty * wdt, y - tx * wdt, u, 1, c]);
      }
      for (let i = 0; i < m - 1; i++) {
        const [a, b] = [ring[2 * i], ring[2 * i + 1]], [c, d] = [ring[2 * i + 2], ring[2 * i + 3]];
        for (const p of [a, b, c, b, d, c]) push(p[0], p[1], p[2], p[3], p[4][0], p[4][1], p[4][2], seed, ord, thick);
      }
      n++;
    }
  });
  const data = new Float32Array(out);
  data.strokes = n;
  return data;
}
