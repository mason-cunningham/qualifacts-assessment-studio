// Combine both app builds into one deployable site:
//   dist/            ← public assessments (apps/runner/dist)   → https://<site>/{slug}
//   dist/studio/     ← internal Studio    (apps/studio/dist)   → https://<site>/studio
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const runner = join(root, 'apps', 'runner', 'dist');
const studio = join(root, 'apps', 'studio', 'dist');

for (const [name, dir] of [['runner', runner], ['studio', studio]]) {
  if (!existsSync(join(dir, 'index.html'))) {
    console.error(`Missing ${name} build at ${dir}. Run the app builds first.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
cpSync(runner, out, { recursive: true });
cpSync(studio, join(out, 'studio'), { recursive: true });
rmSync(join(out, 'studio', '_redirects'), { force: true });

// Netlify SPA routing. Order matters: Studio routes first, then every other path is an assessment slug.
writeFileSync(
  join(out, '_redirects'),
  ['/studio      /studio/index.html   200', '/studio/*    /studio/index.html   200', '/*           /index.html          200', ''].join('\n'),
);

console.log('Assembled dist/ (assessments at /, Studio at /studio)');
