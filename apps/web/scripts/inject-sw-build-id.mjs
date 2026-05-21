/**
 * Postbuild — stamp a unique build id into the compiled service worker.
 *
 * Remix/Vite copies `public/sw.js` verbatim to `build/client/sw.js`. That file
 * contains the literal placeholder `__BUILD_ID__`. A routine deploy ships new
 * hashed JS/CSS bundles but does NOT change `sw.js`, so the browser never sees
 * a byte-different service worker and the `updatefound` → update-modal flow
 * never triggers. Replacing the placeholder with a per-build value fixes that:
 * every deploy now produces a genuinely new `/sw.js`.
 *
 * The build id is the short git SHA plus a base36 timestamp, so it changes
 * even when the same commit is rebuilt/redeployed.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SW_PATH = fileURLToPath(new URL('../build/client/sw.js', import.meta.url));

if (!existsSync(SW_PATH)) {
  console.warn(`[sw] ${SW_PATH} not found — skipping build-id injection`);
  process.exit(0);
}

let sha = 'nogit';
try {
  sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // Not a git checkout (e.g. a source tarball build) — the timestamp alone
  // still guarantees a unique id per build.
}

const buildId = `${sha}-${Date.now().toString(36)}`;
const source = readFileSync(SW_PATH, 'utf8');

if (!source.includes('__BUILD_ID__')) {
  console.warn('[sw] placeholder __BUILD_ID__ not found in sw.js — already stamped?');
  process.exit(0);
}

writeFileSync(SW_PATH, source.replaceAll('__BUILD_ID__', buildId));
console.log(`[sw] injected build id: ${buildId}`);
