#!/usr/bin/env node
// painted-cinema renderer.
//   node scripts/render.mjs <project>                 → <project>/out/film.mp4 (+ film.srt)
//   node scripts/render.mjs <project> --still 1,5.5   → <project>/out/still_<t>.jpg (previews)
// Options: --fps 24  --from 0 --to <dur>  --software (SwiftShader WebGL, for machines without a usable GPU)
// Frames are saved as JPEGs in <project>/out/frames and reused, so an interrupted render resumes where it stopped.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const proj = path.resolve(args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true) || '');
if (!fs.existsSync(path.join(proj, 'film.json'))) { console.error('usage: node scripts/render.mjs <project folder with film.json> [--still t1,t2] [--fps 24] [--software]'); process.exit(2); }
const film = JSON.parse(fs.readFileSync(path.join(proj, 'film.json'), 'utf8'));
const [W, H] = film.size || [1080, 1920], FPS = +opt('--fps', film.fps || 24);
const runtime = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime');
const out = path.join(proj, 'out'); fs.mkdirSync(path.join(out, 'frames'), { recursive: true });

// static server: /film/* → the project, everything else → the runtime
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = u.startsWith('/film/') ? proj : runtime, rel = u.startsWith('/film/') ? u.slice(6) : (u === '/' ? 'index.html' : u.slice(1));
  const f = path.resolve(base, rel);
  if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const launchArgs = ['--enable-webgl', '--ignore-gpu-blocklist', ...(args.includes('--software') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
async function openPage() {
  const browser = await chromium.launch({ args: launchArgs });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', e => console.error('[page]', e.message));
  await page.goto(`http://127.0.0.1:${port}/?film=film`);
  await page.waitForFunction('window.READY === true', null, { timeout: 600000 });
  return { browser, page, dur: await page.evaluate('window.DUR') };
}
const shoot = async (page, t, file) => { await page.evaluate(t => window.render(t), t); await page.screenshot({ path: file, type: 'jpeg', quality: 92, timeout: 180000 }); };

let { browser, page, dur } = await openPage();
try {
  const still = opt('--still');
  if (still) {
    for (const t of still.split(',').map(Number)) { const f = path.join(out, `still_${t}.jpg`); await shoot(page, t, f); console.log(f); }
  } else {
    const from = +opt('--from', 0), to = Math.min(+opt('--to', dur), dur), n0 = Math.round(from * FPS), n1 = Math.round(to * FPS);
    const t0 = Date.now();
    for (let n = n0; n < n1; n++) {
      const f = path.join(out, 'frames', `f_${String(n).padStart(5, '0')}.jpg`);
      if (fs.existsSync(f)) continue;
      for (let tries = 0; ; tries++) {   // a stalled software-WebGL frame restarts the browser instead of failing the render
        try { await shoot(page, n / FPS, f); break; }
        catch (e) { if (tries > 2) throw e; console.error(`frame ${n}: ${e.message.split('\n')[0]}, restarting browser`); await browser.close().catch(() => {}); ({ browser, page } = await openPage()); }
      }
      if (n % 48 === 0) console.log(`frame ${n}/${n1}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    // subtitles as .srt (they are also drawn into the picture)
    const ts = s => { const ms = Math.round(s * 1000); return new Date(ms).toISOString().slice(11, 23).replace('.', ','); };
    fs.writeFileSync(path.join(out, 'film.srt'), (film.subtitles || []).map((c, i) => `${i + 1}\n${ts(c.t)} --> ${ts(c.t + c.dur)}\n${c.text}\n`).join('\n'));
    // encode, with the soundtrack if the film has one
    const ff = ['-y', '-framerate', String(FPS), '-start_number', String(n0), '-i', path.join(out, 'frames', 'f_%05d.jpg')];
    if (film.audio) ff.push('-ss', String(from), '-i', path.join(proj, film.audio));
    ff.push('-frames:v', String(n1 - n0), '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p');
    if (film.audio) ff.push('-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-14:TP=-1', '-shortest');
    ff.push(path.join(out, 'film.mp4'));
    const r = spawnSync('ffmpeg', ff, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    console.log('done:', path.join(out, 'film.mp4'));
  }
} finally { await browser.close(); server.close(); }
