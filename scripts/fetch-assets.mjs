#!/usr/bin/env node
/**
 * clone-site/scripts/fetch-assets.mjs — verbatim byte mirror of .clone/assets.json
 * Node 18+ built-ins only (node:fs, node:path, node:crypto, node:stream, global fetch). Zero npm deps.
 * Reads the asset manifest, downloads every entry byte-for-byte, dedupes by sha256,
 * writes the results back into the manifest, and emits PROVENANCE.md.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HELP = `fetch-assets.mjs — byte-exact asset mirror for clone-site

  node fetch-assets.mjs <manifest.json> [assetsDir] [flags]

Arguments
  manifest.json   clone-site/assets@1 manifest (default: .clone/assets.json)
  assetsDir       staging root for mirrored bytes (default: <manifest dir>/assets)

Flags
  --concurrency N  parallel downloads, clamped 1-16   (default 6)
  --retries N      retries per asset, backoff 400ms*2^n + jitter (default 3)
  --timeout MS     per-request timeout                (default 30000)
  --provenance P   PROVENANCE.md path (default: <manifest dir>/PROVENANCE.md)
  --ua STR         User-Agent override (default: manifest.fetch.userAgent)
  --referer STR    Referer override   (default: manifest.fetch.referer)
  --force          re-download entries that already match their recorded sha256
  --dry-run        resolve and print the plan; write nothing
  --quiet          only print the final summary line
  -h, --help       this text

Exit codes: 0 all good - 1 one or more required assets failed - 2 usage/manifest error
`;

const EXT_BY_TYPE = {
  'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf', 'font/collection': '.ttc',
  'application/font-woff2': '.woff2', 'application/font-woff': '.woff', 'application/x-font-ttf': '.ttf',
  'application/vnd.ms-fontobject': '.eot', 'image/avif': '.avif', 'image/webp': '.webp', 'image/png': '.png',
  'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/apng': '.apng',
  'image/vnd.microsoft.icon': '.ico', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'text/css': '.css', 'text/javascript': '.js', 'application/javascript': '.js',
  'application/json': '.json', 'application/manifest+json': '.webmanifest', 'text/html': '.html',
  'text/plain': '.txt', 'application/pdf': '.pdf'
};

const die = (msg, code) => { process.stderr.write(`fetch-assets: ${msg}\n`); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--') && a.includes('=')) { const i = a.indexOf('='); argv.push(a.slice(0, i), a.slice(i + 1)); }
  else argv.push(a);
}
const opt = { concurrency: 6, retries: 3, timeout: 30000, provenance: null, ua: null, referer: null,
  force: false, dryRun: false, quiet: false };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => { const v = argv[++i]; if (v === undefined) die(`missing value for ${a}`, 2); return v; };
  if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0); }
  else if (a === '--dry-run') opt.dryRun = true;
  else if (a === '--force') opt.force = true;
  else if (a === '--quiet') opt.quiet = true;
  else if (a === '--concurrency') opt.concurrency = Math.max(1, Math.min(16, Number(val()) || 6));
  else if (a === '--retries') opt.retries = Math.max(0, Number(val()) || 0);
  else if (a === '--timeout') opt.timeout = Math.max(1000, Number(val()) || 30000);
  else if (a === '--provenance') opt.provenance = val();
  else if (a === '--ua') opt.ua = val();
  else if (a === '--referer') opt.referer = val();
  else if (a.startsWith('-')) die(`unknown flag ${a}`, 2);
  else pos.push(a);
}

const manifestPath = resolve(pos[0] || '.clone/assets.json');
const assetsDir = resolve(pos[1] || join(dirname(manifestPath), 'assets'));
const provPath = resolve(opt.provenance || join(dirname(manifestPath), 'PROVENANCE.md'));
const log = (s) => { if (!opt.quiet) process.stdout.write(s + '\n'); };

let raw;
try { raw = await readFile(manifestPath, 'utf8'); } catch (e) { die(`cannot read ${manifestPath}: ${e.message}`, 2); }
let manifest;
try { manifest = JSON.parse(raw); } catch {
  try { manifest = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
  catch (e) { die(`manifest is not JSON: ${e.message}`, 2); }
}
const list = Array.isArray(manifest.assets) ? manifest.assets : null;
if (!list) die('manifest has no assets[] array', 2);

const cfg = manifest.fetch || {};
const headersBase = { ...(cfg.headers || {}) };
const ua = opt.ua || cfg.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const referer = opt.referer || cfg.referer || (manifest.page && manifest.page.url) || null;

const DIR_BY_KIND = { font: 'fonts', video: 'media', poster: 'media', stylesheet: 'css', script: 'js',
  manifest: 'meta', icon: 'meta', other: 'misc' };

const extFor = (contentType) => EXT_BY_TYPE[String(contentType || '').split(';')[0].trim().toLowerCase()] || '.bin';

/** `?v=3` -> `v-3`; opaque or long query strings collapse to 8 hex so names stay bounded. */
const querySlug = (search) => {
  const s = String(search || '').replace(/^\?/, '');
  if (!s) return '';
  const slug = s.replace(/[^\w.@%+-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return '';
  return slug.length <= 24 ? slug : createHash('sha256').update(s).digest('hex').slice(0, 8);
};

/** a dot/dash segment of >=6 hex chars with a digit in it is already a content hash — do not fold. */
const contentHashed = (base) => base.split(/[.\-_]/).some((s) => /^[0-9a-f]{6,}$/i.test(s) && /\d/.test(s));

/** local path: manifest wins; else URL basename + folded query, extension from content-type. */
const localFor = (a, contentType) => {
  if (a.local) return a.local;
  let name = 'asset', slug = '';
  try {
    const u = new URL(a.url);
    name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'asset');
    slug = querySlug(u.search);
  } catch { /* data: */ }
  name = name.replace(/[^\w.@%+-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'asset';
  let ext = extname(name);
  if (!ext) ext = extFor(contentType);                    // no extension on the URL: recover it from the type
  else name = name.slice(0, name.length - ext.length);
  if (slug && !contentHashed(name)) name += '-' + slug;   // two URLs differing only by ?v= are two files
  return join(DIR_BY_KIND[a.kind] || 'img', (name.slice(0, 120) || 'asset') + ext);
};

const readDataUrl = (url) => {
  const m = /^data:([^;,]*)(;charset=[^;,]*)?(;base64)?,([\s\S]*)$/i.exec(url);
  if (!m) throw new Error('malformed data: URL');
  return { type: m[1] || 'application/octet-stream', buf: Buffer.from(decodeURIComponent(m[4] || ''), m[3] ? 'base64' : 'utf8') };
};

const sha256File = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

/** one attempt: streams to <dest>.part, hashes inline, renames on success. */
async function download(a, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  if (a.url.startsWith('data:')) {
    const { type, buf } = readDataUrl(a.url);
    await writeFile(tmp, buf); await rename(tmp, dest);
    return { contentType: type, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), httpStatus: 200, finalUrl: null };
  }
  const headers = { ...headersBase, 'user-agent': ua, accept: '*/*' };
  if (referer) headers.referer = referer;
  const res = await fetch(a.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(opt.timeout) });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; e.retryAfter = res.headers.get('retry-after'); throw e; }
  if (!res.body) throw new Error('empty response body');
  const h = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({ transform(c, _e, cb) { h.update(c); bytes += c.length; cb(null, c); } });
  await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(tmp));
  await rename(tmp, dest);
  return { contentType: res.headers.get('content-type') || null, bytes, sha256: h.digest('hex'),
    httpStatus: res.status, finalUrl: res.url && res.url !== a.url ? res.url : null };
}

const bySha = new Map();
const claimed = new Map();                                // staging path -> the URL that owns it
const results = { mirrored: 0, cached: 0, deduped: 0, failed: 0, skipped: 0, bytes: 0 };
const warn = (m) => { (Array.isArray(manifest.warnings) ? manifest.warnings : (manifest.warnings = [])).push(m); };

/**
 * `local` moves during a run — collision suffix, extension recovered from the content-type, sha256 dedupe.
 * `ref` (what markup and CSS write) and `project` (the emitted repo path) are DERIVED from it, so they must
 * move with it. Leaving them stale ships a src that 404s, or worse, one that serves another asset's bytes.
 * Both are `<prefix> + local`, so re-point by swapping the tail; if the tail does not match (hand-authored
 * ref), swap the basename and record it rather than silently guessing a prefix.
 */
const relocate = (a, next) => {
  const prev = a.local;
  if (!next || prev === next) { if (next) a.local = next; return; }
  if (prev) for (const k of ['ref', 'project']) {
    const v = a[k];
    if (typeof v !== 'string' || !v) continue;
    if (v.endsWith(prev)) a[k] = v.slice(0, v.length - prev.length) + next;
    else {
      const base = v.slice(v.lastIndexOf('/') + 1);
      a[k] = v.slice(0, v.length - base.length) + next.slice(next.lastIndexOf('/') + 1);
      warn(`${a.url}: ${k} "${v}" did not end in local "${prev}"; rewrote the basename only -> "${a[k]}"`);
    }
  }
  a.local = next;
};

/** reserve a unique staging path; retries once as a url-hashed sibling, then gives up. */
const claimLocal = (url, local) => {
  const e = extname(local);
  const alt = local.slice(0, local.length - e.length) + '-' + createHash('sha256').update(url).digest('hex').slice(0, 8) + e;
  for (const p of [local, alt]) {
    const owner = claimed.get(p);
    if (owner === undefined || owner === url) { claimed.set(p, url); return p; }
  }
  return null;
};

/** one exit for every non-success. `status` stays `failed` either way, so a re-run retries it; the
    summary counter and PROVENANCE's tables split on `optional`, which never fails the run. */
const noteFailure = (a, note, httpStatus) => {
  a.status = 'failed'; a.httpStatus = httpStatus; a.note = note;
  if (a.optional) { results.skipped++; log(`  skip  ${a.url} (optional): ${note}`); }
  else { results.failed++; process.stderr.write(`  FAIL  ${a.url}: ${note}\n`); }
};

async function handle(a) {
  if (!a.url || a.status === 'skipped') { a.status = a.status || 'skipped'; results.skipped++; return; }
  const derived = !a.local;                               // derived names may need the response's content-type
  const wanted = localFor(a, a.contentType);
  const claim = claimLocal(a.url, wanted);
  if (!claim) return noteFailure(a, `local path collision: ${wanted}`, null);
  relocate(a, claim);                                     // a collision suffix invalidates ref/project
  let dest = join(assetsDir, a.local);
  if (opt.dryRun) { log(`  plan  ${a.local}  <-  ${a.url}`); return; }

  if (!opt.force && a.sha256) {
    try {
      if ((await stat(dest)).isFile() && await sha256File(dest) === a.sha256) {
        if (!bySha.has(a.sha256)) { bySha.set(a.sha256, a.local); results.bytes += a.bytes || 0; }
        a.status = 'cached'; results.cached++; return;
      }
    } catch { /* fall through and re-download */ }
  }
  let lastErr = null;
  for (let attempt = 0; attempt <= opt.retries; attempt++) {
    if (attempt) {
      const ra = Number(lastErr && lastErr.retryAfter);
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 15000) : 400 * 2 ** (attempt - 1) + Math.random() * 250);
    }
    try {
      const r = await download(a, dest);
      Object.assign(a, { contentType: r.contentType, bytes: r.bytes, sha256: r.sha256, httpStatus: r.httpStatus, fetchedAt: new Date().toISOString() });
      if (r.finalUrl) a.finalUrl = r.finalUrl;
      if (derived) {                                      // `/img/12345` + image/webp -> 12345.webp, not .bin
        const better = claimLocal(a.url, localFor({ url: a.url, kind: a.kind }, r.contentType));
        if (better && better !== a.local) {
          const to = join(assetsDir, better);
          await mkdir(dirname(to), { recursive: true });
          await rename(dest, to);
          claimed.delete(a.local); relocate(a, better); dest = to;
        }
      }
      const first = bySha.get(r.sha256);
      if (first && first !== a.local) {
        await unlink(dest).catch(() => {});
        log(`  dedup ${a.local} -> ${first} (identical sha256)`);
        a.status = 'deduped'; a.dedupeOf = first; relocate(a, first); results.deduped++;
      } else {
        bySha.set(r.sha256, a.local); a.status = 'mirrored'; results.mirrored++; results.bytes += r.bytes;
        log(`  ok    ${a.local}  ${a.bytes}B  ${a.contentType || '?'}`);
      }
      return;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) break;
    }
  }
  await unlink(dest + '.part').catch(() => {});
  noteFailure(a, String((lastErr && lastErr.message) || 'unknown error'), (lastErr && lastErr.status) || null);
}

log(`fetch-assets: ${list.length} entries -> ${assetsDir}${opt.dryRun ? ' (dry run)' : ''}`);
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(opt.concurrency, list.length) }, async () => {
  while (cursor < list.length) await handle(list[cursor++]);
}));

if (opt.dryRun) { log(`fetch-assets: dry run, ${list.length} entries planned, nothing written`); process.exit(0); }

manifest.mirror = { finishedAt: new Date().toISOString(), assetsDir, ...results, ok: results.failed === 0 };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '%7C');
const rows = list.filter((a) => a.sha256 && a.status !== 'failed')
  .sort((a, b) => String(a.local).localeCompare(String(b.local)))
  .map((a) => `| \`${esc(a.local)}\` | ${esc(a.finalUrl || a.url)} | ${esc(String(a.contentType || '').split(';')[0])} | ${a.bytes} | \`${esc(a.sha256)}\` |`);
const failed = list.filter((a) => a.status === 'failed' && !a.optional);        // required, never downloaded
const optSkips = list.filter((a) => a.status === 'failed' && a.optional);       // analytics/chat/ads: never a gap
const unmirrorable = Array.isArray(manifest.unmirrorable) ? manifest.unmirrorable : [];
await writeFile(provPath, [
  '# PROVENANCE', '',
  `Mirrored from ${esc((manifest.page && manifest.page.url) || 'unknown')} on ${manifest.mirror.finishedAt}.`,
  `${rows.length} files, ${results.bytes} bytes. Staged in \`${esc(assetsDir)}\`; paths below are relative to it.`, '',
  '| local path | source URL | content-type | bytes | sha256 |', '|---|---|---|---|---|',
  ...rows, '',
  ...(failed.length ? ['## Failed', '', '| source URL | http | why |', '|---|---|---|',
    ...failed.map((a) => `| ${esc(a.url)} | ${a.httpStatus || '-'} | ${esc(a.note)} |`), ''] : []),
  ...(optSkips.length ? ['## Skipped (optional)', '', '| source URL | http | why |', '|---|---|---|',
    ...optSkips.map((a) => `| ${esc(a.url)} | ${a.httpStatus || '-'} | ${esc(a.note)} |`), ''] : []),
  ...(unmirrorable.length ? ['## Not mirrorable', '', '| source | kind | why |', '|---|---|---|',
    ...unmirrorable.map((u) => `| ${esc(u.url || u.target)} | ${esc(u.kind)} | ${esc(u.why)} |`), ''] : [])
].join('\n'));

process.stdout.write(`fetch-assets: ${results.mirrored} mirrored, ${results.cached} cached, ${results.deduped} deduped, ${results.skipped} skipped, ${results.failed} failed, ${results.bytes} bytes -> ${provPath}\n`);
process.exit(results.failed ? 1 : 0);
