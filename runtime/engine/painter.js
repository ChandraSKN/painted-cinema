// painted-cinema · Painter
//
// Pipeline
//   paint layer  (RGBA8, supersampled) — rgb = paint colour, a = paint thickness.
//                The image's soft underlayer is laid first at thin thickness, then brush ribbons on top.
//   relief       a quarter-resolution copy of thickness, blurred, used for cavity shading.
//   present      lights the paint as a surface: sun given as azimuth/elevation, Blinn half-vector gloss,
//                darkening in the recesses between strokes; then a lift/gamma/gain grade with a filmic shoulder.
//   glazes       light effects (glows, dust, beams) added on top of the finished picture.
import { VERT_FLOATS } from './strokes.js';

// ---- small GL helpers -------------------------------------------------------------------------
class Program {
  constructor(gl, vsrc, fsrc) {
    this.gl = gl; this.loc = new Map();
    const sh = (kind, src) => { const s = gl.createShader(kind); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`); return s; };
    this.id = gl.createProgram(); gl.attachShader(this.id, sh(gl.VERTEX_SHADER, vsrc)); gl.attachShader(this.id, sh(gl.FRAGMENT_SHADER, fsrc)); gl.linkProgram(this.id);
    if (!gl.getProgramParameter(this.id, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(this.id)}`);
  }
  use() { this.gl.useProgram(this.id); return this; }
  at(name) { if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.id, name)); return this.loc.get(name); }
  set(values) {   // { name: number | [..] | {mat3} | {tex, unit} }
    const gl = this.gl;
    for (const [k, v] of Object.entries(values)) {
      const l = this.at(k); if (l === null) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.mat3) gl.uniformMatrix3fv(l, false, v.mat3);
      else if (v.tex) { gl.activeTexture(gl.TEXTURE0 + v.unit); gl.bindTexture(gl.TEXTURE_2D, v.tex); gl.uniform1i(l, v.unit); }
      else gl[`uniform${v.length}fv`](l, v);
    }
    return this;
  }
}
function target(gl, w, h) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}
// world (painting pixels) → clip space, as a column-major mat3
export function viewMatrix(view, W, H) {
  const sx = 2 * view.zoom / W, sy = -2 * view.zoom / H;
  return { mat3: [sx, 0, 0, 0, sy, 0, -view.x * sx, -view.y * sy, 1] };
}

// ---- shaders ----------------------------------------------------------------------------------
const RIBBON_VS = `#version 300 es
layout(location=0) in vec4 aPos;      // x, y, along, across
layout(location=1) in vec3 aRGB;
layout(location=2) in vec3 aInfo;     // seed, order, thickness
uniform mat3 uView;
out vec2 vSt; out vec3 vRGB; out vec3 vInfo;
void main(){ gl_Position = vec4((uView * vec3(aPos.xy, 1.)).xy, 0., 1.); vSt = aPos.zw; vRGB = aRGB; vInfo = aInfo; }`;
const RIBBON_FS = `#version 300 es
precision highp float;
in vec2 vSt; in vec3 vRGB; in vec3 vInfo;
uniform float uClock, uLayFrom, uOrderScale, uStrokeTime, uOpacity;
out vec4 frag;
float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float bristles(float across, float seed){        // sum of a few thin random lines across the brush
  float b = 0.;
  for (int i = 0; i < 3; i++) { float f = 6. + float(i) * 9.; float c = floor(across * f + seed); b += mix(rand(vec2(c, seed)), rand(vec2(c + 1., seed)), smoothstep(0., 1., fract(across * f + seed))); }
  return b / 3.;
}
void main(){
  float along = vSt.x, across = vSt.y * .5 + .5, seed = vInfo.x;
  float laid = (uClock - uLayFrom - vInfo.y * uOrderScale) / uStrokeTime;   // how far the brush has travelled
  if (laid < 0. || along > laid * 1.35) discard;
  float bri = bristles(across, seed);
  float side = 1. - smoothstep(.36, .5, abs(across - .5) + (rand(vec2(floor(along * 14.), seed)) - .5) * .08);
  float starve = smoothstep(.6, 1., along) * smoothstep(.55, .2, bri);   // the brush runs out of paint
  float body = clamp(side - starve, 0., 1.);
  if (body < .5 || rand(gl_FragCoord.xy) > uOpacity) discard;          // hard, ragged paint edge; fades dissolve
  float thick = vInfo.z * (.3 + .5 * bri + .4 * (1. - smoothstep(0., .25, along)));
  frag = vec4(vRGB * (.88 + .24 * bri), thick * .3);                    // rgb replaces, alpha adds thickness
}`;
const SHEET_VS = `#version 300 es
layout(location=0) in vec2 aCorner; uniform mat3 uView; uniform vec2 uSize; out vec2 vTex;
void main(){ gl_Position = vec4((uView * vec3(aCorner * uSize, 1.)).xy, 0., 1.); vTex = aCorner; }`;
const SHEET_FS = `#version 300 es
precision highp float; in vec2 vTex; uniform sampler2D uImage; uniform float uOpacity; out vec4 frag;
float rand(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){ if (rand(gl_FragCoord.xy * .37) > uOpacity) discard; frag = vec4(texture(uImage, vTex).rgb, .06); }`;
const FULL_VS = `#version 300 es
layout(location=0) in vec2 aCorner; out vec2 vTex; void main(){ vTex = aCorner; gl_Position = vec4(aCorner * 2. - 1., 0., 1.); }`;
const SHRINK_FS = `#version 300 es
precision highp float; in vec2 vTex; uniform sampler2D uPaint; uniform vec2 uTexel; out vec4 frag;
void main(){ float s = 0.; for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) s += texture(uPaint, vTex + vec2(x, y) * uTexel).a; frag = vec4(s / 25.); }`;
const PRESENT_FS = `#version 300 es
precision highp float; in vec2 vTex; out vec4 frag;
uniform sampler2D uPaint, uRelief; uniform vec2 uTexel;
uniform vec3 uSunDir, uSunTint, uBackdrop; uniform float uRelief_, uGloss, uSheen, uCavity;
uniform vec3 uLift, uGamma, uGain; uniform float uChroma, uVignette;
vec3 filmic(vec3 x){ return x * (1. + x * .15) / (1. + x * .75); }
void main(){
  vec4 p = texture(uPaint, vTex);
  float t0 = p.a;
  float dx = texture(uPaint, vTex + vec2(uTexel.x, 0.)).a - texture(uPaint, vTex - vec2(uTexel.x, 0.)).a;
  float dy = texture(uPaint, vTex + vec2(0., uTexel.y)).a - texture(uPaint, vTex - vec2(0., uTexel.y)).a;
  vec3 nrm = normalize(vec3(-dx * uRelief_, dy * uRelief_, 1.));
  float lambert = clamp(dot(nrm, uSunDir), 0., 1.);
  float gloss = pow(clamp(dot(nrm, normalize(uSunDir + vec3(0., 0., 1.))), 0., 1.), uGloss) * uSheen;
  float hollow = clamp((texture(uRelief, vTex).r - t0) * uCavity, 0., .45);        // recesses between thick strokes
  vec3 paint = mix(uBackdrop, p.rgb, smoothstep(0., .03, t0));
  vec3 c = paint * (.62 + .48 * lambert) * (1. - hollow) + gloss * uSunTint;
  c = pow(max(uGain * (c + uLift * (1. - c)), 0.), 1. / uGamma);
  c = filmic(c * 1.12);
  float luma = dot(c, vec3(.2126, .7152, .0722)); c = luma + (c - luma) * uChroma;
  vec2 off = vTex - .5; c *= 1. - uVignette * smoothstep(.2, .75, length(off * vec2(.9, 1.1)));
  frag = vec4(clamp(c, 0., 1.), 1.);
}`;
const GLAZE_VS = `#version 300 es
layout(location=0) in vec2 aCorner; uniform mat3 uView; uniform vec4 uBox; uniform float uTurn; out vec2 vLocal;
void main(){ vec2 l = (aCorner - .5) * uBox.zw; vec2 r = vec2(l.x * cos(uTurn) - l.y * sin(uTurn), l.x * sin(uTurn) + l.y * cos(uTurn));
  gl_Position = vec4((uView * vec3(uBox.xy + r, 1.)).xy, 0., 1.); vLocal = aCorner * 2. - 1.; }`;
const GLAZE_FS = `#version 300 es
precision highp float; in vec2 vLocal; uniform vec3 uTint; uniform float uStrength, uFeather; out vec4 frag;
void main(){ float d = dot(vLocal, vLocal); float k = uStrength * (1. - smoothstep(1. - uFeather, 1., d)); frag = vec4(uTint * k, k); }`;

// ---- defaults: how the paint is lit and graded ------------------------------------------------
export const DEFAULT_LOOK = {
  sun: { azimuth: 135, elevation: 50, tint: [1, .95, .86] },   // degrees: light from the upper left
  relief: 5, gloss: 24, sheen: .12, cavity: 1.4,
  grade: { lift: [.01, .008, .006], gamma: [1.06, 1.05, 1.04], gain: [1.12, 1.12, 1.12], chroma: 1.05 },
  vignette: .32, backdrop: [.09, .065, .05],
};
const sunVector = s => { const a = s.azimuth * Math.PI / 180, e = s.elevation * Math.PI / 180; return [-Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)]; };

export class Painter {
  constructor(canvas, { W = 1080, H = 1920, ss = 1 } = {}) {
    Object.assign(this, { W, H, PW: Math.round(W * ss), PH: Math.round(H * ss) });
    canvas.width = W; canvas.height = H;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('painted-cinema needs WebGL2');
    this.gl = gl;
    this.ribbon = new Program(gl, RIBBON_VS, RIBBON_FS); this.sheet = new Program(gl, SHEET_VS, SHEET_FS);
    this.shrink = new Program(gl, FULL_VS, SHRINK_FS); this.present = new Program(gl, FULL_VS, PRESENT_FS); this.glaze = new Program(gl, GLAZE_VS, GLAZE_FS);
    this.paintTarget = target(gl, this.PW, this.PH); this.reliefTarget = target(gl, Math.ceil(this.PW / 4), Math.ceil(this.PH / 4));
    this.corner = gl.createVertexArray(); gl.bindVertexArray(this.corner);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0); gl.bindVertexArray(null);
  }
  // a layer = an image (shown softly under the strokes) + the stroke ribbons built from it
  layer(image, ribbons, soften = 2.5) {
    const gl = this.gl, c = new OffscreenCanvas(image.width, image.height), x = c.getContext('2d');
    x.filter = `blur(${soften}px)`; x.drawImage(image, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, ribbons, gl.STATIC_DRAW);
    const stride = VERT_FLOATS * 4;
    [[0, 4, 0], [1, 3, 16], [2, 3, 28]].forEach(([i, n, off]) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, off); });
    gl.bindVertexArray(null);
    return { tex, vao, vertices: ribbons.length / VERT_FLOATS, size: [image.width, image.height] };
  }
  start() {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.paintTarget.fbo); gl.viewport(0, 0, this.PW, this.PH);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    // colour: the newest paint covers what is under it; thickness: paint on paint builds up
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ONE);
  }
  // paint a layer. s: { view:{x,y,zoom}, clock, layFrom (-Infinity = already painted), orderScale, strokeTime, opacity, sheet (underlayer 0..1) }
  paint(L, s) {
    const gl = this.gl, view = viewMatrix(s.view, this.W, this.H), op = s.opacity ?? 1;
    if ((s.sheet ?? 1) > 0) { this.sheet.use().set({ uView: view, uSize: L.size, uImage: { tex: L.tex, unit: 0 }, uOpacity: (s.sheet ?? 1) * op }); gl.bindVertexArray(this.corner); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    this.ribbon.use().set({ uView: view, uClock: s.clock ?? 0, uLayFrom: Number.isFinite(s.layFrom) ? s.layFrom : -1e9, uOrderScale: s.orderScale ?? 1, uStrokeTime: s.strokeTime ?? .2, uOpacity: op });
    gl.bindVertexArray(L.vao); gl.drawArrays(gl.TRIANGLES, 0, L.vertices); gl.bindVertexArray(null);
  }
  // light, grade and show the finished paint
  show(look = {}) {
    const gl = this.gl, k = { ...DEFAULT_LOOK, ...look, sun: { ...DEFAULT_LOOK.sun, ...look.sun }, grade: { ...DEFAULT_LOOK.grade, ...look.grade } };
    gl.disable(gl.BLEND); gl.bindVertexArray(this.corner);
    const r = this.reliefTarget; gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo); gl.viewport(0, 0, r.w, r.h);
    this.shrink.use().set({ uPaint: { tex: this.paintTarget.tex, unit: 0 }, uTexel: [4 / this.PW, 4 / this.PH] }); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
    this.present.use().set({
      uPaint: { tex: this.paintTarget.tex, unit: 0 }, uRelief: { tex: r.tex, unit: 1 }, uTexel: [1 / this.PW, 1 / this.PH],
      uSunDir: sunVector(k.sun), uSunTint: k.sun.tint, uBackdrop: k.backdrop, uRelief_: k.relief, uGloss: k.gloss, uSheen: k.sheen, uCavity: k.cavity,
      uLift: k.grade.lift, uGamma: k.grade.gamma, uGain: k.grade.gain, uChroma: k.grade.chroma, uVignette: k.vignette });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
  }
  // light added over the picture: [{ x, y, w, h, turn, tint:[r,g,b], strength, feather }]
  glazes(list, view) {
    if (!list.length) return;
    const gl = this.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.bindVertexArray(this.corner);
    this.glaze.use().set({ uView: viewMatrix(view, this.W, this.H) });
    for (const g of list) { this.glaze.set({ uBox: [g.x, g.y, g.w, g.h], uTurn: g.turn || 0, uTint: g.tint, uStrength: g.strength, uFeather: g.feather ?? 1 }); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    gl.bindVertexArray(null); gl.disable(gl.BLEND);
  }
}
