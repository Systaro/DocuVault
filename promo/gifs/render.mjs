// Renders every <section class="scene"> in scenes.html into ../assets/<id>.gif.
// Needs ffmpeg on the PATH. Usage: npm install && npm run render [-- <id> ...]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOOP_MS = 8000;
const FPS = 15;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 560 } });
const url = pathToFileURL(join(here, 'scenes.html')).href;
await page.goto(url, { waitUntil: 'networkidle' });
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : await page.$$eval('section.scene', s => s.map(x => x.id));

for (const id of ids) {
  await page.goto(`${url}#${id}`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const frames = mkdtempSync(join(tmpdir(), `dv-${id}-`));
  const scene = page.locator(`#${id}`);
  const count = (LOOP_MS / 1000) * FPS;
  for (let i = 0; i < count; i++) {
    await page.evaluate(ms => window.seek(ms), (i * 1000) / FPS);
    await scene.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
  }
  const out = join(here, '..', 'assets', `${id}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%04d.png'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none',
    '-loop', '0', out]);
  rmSync(frames, { recursive: true, force: true });
  console.log('rendered', out);
}
await browser.close();
