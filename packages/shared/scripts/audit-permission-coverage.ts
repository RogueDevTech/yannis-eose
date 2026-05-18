/**
 * Compare permission codes passed to `permissionProcedure('a.b', ...)` call sites
 * against the static PERMISSIONS catalog in seed-permissions.ts.
 *
 * Usage: pnpm --filter @yannis/shared db:audit-permission-coverage
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../..');

function loadSeedPermissionCodes(): Set<string> {
  const seedPath = join(ROOT, 'packages/shared/scripts/seed-permissions.ts');
  const src = readFileSync(seedPath, 'utf8');
  const start = src.indexOf('const PERMISSIONS:');
  if (start < 0) throw new Error('Could not find PERMISSIONS in seed-permissions.ts');
  const sub = src.slice(start);
  const open = sub.indexOf('[');
  const close = sub.indexOf('];');
  const body = sub.slice(open + 1, close);
  const codes: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/code:\s*'([^']+)'/);
    if (m) codes.push(m[1]!);
  }
  return new Set(codes);
}

function walk(dir: string, out: string[]) {
  for (const ent of readdirSync(dir)) {
    if (ent === 'node_modules' || ent === 'dist' || ent === 'build' || ent === '.git') continue;
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && (ent.endsWith('.ts') || ent.endsWith('.tsx'))) out.push(p);
  }
}

// Permission codes are mostly lowercase, but some segments include camelCase actions.
const permissionLike = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

function extractStringArgs(inside: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inside))) {
    out.push(m[1]!);
  }
  return out;
}

function extractPermissionProcedureBlocks(text: string): string[] {
  const results: string[] = [];
  const token = 'permissionProcedure';
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(token, i);
    if (idx < 0) break;
    let j = idx + token.length;
    while (j < text.length && /\s/.test(text[j]!)) j++;
    if (text[j] !== '(') {
      i = idx + token.length;
      continue;
    }
    j++;
    let depth = 1;
    const startArgs = j;
    while (j < text.length && depth > 0) {
      const ch = text[j]!;
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      j++;
    }
    if (depth !== 0) break;
    const inside = text.slice(startArgs, j - 1);
    results.push(inside);
    i = j;
  }
  return results;
}

const seedCodes = loadSeedPermissionCodes();
const sourceFiles: string[] = [];
walk(join(ROOT, 'apps/api'), sourceFiles);
walk(join(ROOT, 'apps/web'), sourceFiles);

const referenced = new Set<string>();
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  for (const inside of extractPermissionProcedureBlocks(text)) {
    for (const arg of extractStringArgs(inside)) {
      if (permissionLike.test(arg)) referenced.add(arg);
    }
  }
}

const missing = [...referenced].filter((c) => !seedCodes.has(c)).sort();
if (missing.length) {
  console.error('permissionProcedure string args not present in seed-permissions PERMISSIONS:\n');
  for (const c of missing) console.error(`  - ${c}`);
  process.exit(1);
}

console.log(
  `Permission coverage OK — ${referenced.size} unique dotted permission codes in permissionProcedure(...), all in seed catalog.`,
);
