#!/usr/bin/env node
// clone-site/scripts/visual-diff.mjs — PNG-vs-PNG fidelity diff. Node built-ins only.
// node visual-diff.mjs <orig.png> <clone.png> [diff.json] [--threshold 12] [--cols 8] [--rows 12]
//                      [--gate 0.025] [--json] [--out heat.png] [--loose] [--help]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const HELP = `visual-diff.mjs — per-pixel + tile-heat comparison of two PNG screenshots.

  node visual-diff.mjs <a.png> <b.png> [out.json] [options]

  a.png            original capture (.clone/sections/<id>/orig-w1440.png)
  b.png            clone capture   (.clone/sections/<id>/clone-w1440.png)
  out.json         write the report here (schema: clone-site/diff@1)

  --threshold N    per-channel delta counted as different, 0-255   (default 12)
  --cols N         heat-grid columns                               (default 8)
  --rows N         heat-grid rows                                  (default 12)
  --gate R         exit 1 when pixelDiff > R                       (default off)
  --out FILE.png   write a red-on-gray diff map
  --json           print the report JSON to stdout instead of the summary
  --loose          on undecodable input, fall back to a byte/size heuristic
  --help

Decodes non-interlaced PNG, bit depth 8 or 16, color type 0/2/3/4/6 — which is what
Chrome DevTools MCP take_screenshot {format:"png"} emits. Interlaced or sub-byte depths
are refused (exit 2) unless --loose. Exit codes: 0 ok · 1 gate exceeded · 2 cannot decode
· 3 bad usage or unreadable file.`;

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const fail = (code, msg) => { process.stderr.write(msg + '\n'); process.exit(code); };

function parseArgs(argv) {
  const o = { pos: [], threshold: 12, cols: 8, rows: 12, gate: null, out: null, json: false, loose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { process.stdout.write(HELP + '\n'); process.exit(0); }
    else if (a === '--json') o.json = true;
    else if (a === '--loose') o.loose = true;
    else if (a === '--threshold') o.threshold = Number(argv[++i]);
    else if (a === '--cols') o.cols = Math.max(1, parseInt(argv[++i], 10));
    else if (a === '--rows') o.rows = Math.max(1, parseInt(argv[++i], 10));
    else if (a === '--gate') o.gate = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a.startsWith('-')) fail(3, `Unknown option ${a}. Run with --help.`);
    else o.pos.push(a);
  }
  if (o.pos.length < 2) fail(3, 'Need two PNG paths. Run with --help.');
  if (!Number.isFinite(o.threshold) || o.threshold < 0 || o.threshold > 255) fail(3, '--threshold must be 0-255.');
  return o;
}

/* ---------------- PNG decode: signature + chunks + unfilter + RGBA8 ---------------- */
function decodePng(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('not a PNG (bad signature)');
  let p = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = p + 8;
    if (type === 'IHDR') ihdr = { w: buf.readUInt32BE(d), h: buf.readUInt32BE(d + 4), depth: buf[d + 8],
                                  ct: buf[d + 9], comp: buf[d + 10], filter: buf[d + 11], interlace: buf[d + 12] };
    else if (type === 'PLTE') plte = buf.subarray(d, d + len);
    else if (type === 'tRNS') trns = buf.subarray(d, d + len);
    else if (type === 'IDAT') idat.push(buf.subarray(d, d + len));
    else if (type === 'IEND') break;
    p = d + len + 4;
  }
  if (!ihdr) throw new Error('no IHDR chunk');
  const { w, h, depth, ct, comp, interlace } = ihdr;
  if (comp !== 0) throw new Error(`compression method ${comp} unsupported`);
  if (interlace !== 0) throw new Error('interlaced (Adam7) PNG unsupported');
  if (depth !== 8 && depth !== 16) throw new Error(`bit depth ${depth} unsupported (need 8 or 16)`);
  if (![0, 2, 3, 4, 6].includes(ct)) throw new Error(`color type ${ct} unsupported`);
  if (ct === 3 && (depth !== 8 || !plte)) throw new Error('palette PNG needs 8-bit indices and a PLTE chunk');
  if (!idat.length) throw new Error('no IDAT data');

  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const bypp = ct === 3 ? 1 : CH * (depth / 8);
  const stride = w * bypp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * h) throw new Error(`IDAT short: ${raw.length} < ${(stride + 1) * h}`);

  const lines = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bypp ? lines[dst + x - bypp] : 0;
      const b = y > 0 ? lines[up + x] : 0;
      const c = x >= bypp && y > 0 ? lines[up + x - bypp] : 0;
      let out;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + b;
      else if (f === 3) out = v + ((a + b) >> 1);
      else if (f === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`unknown row filter ${f} at row ${y}`);
      lines[dst + x] = out & 0xff;
    }
  }

  const rgba = new Uint8Array(w * h * 4);
  const step = depth === 16 ? 2 : 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = y * stride + x * bypp, o = (y * w + x) * 4;
    let r, g, b, a = 255;
    if (ct === 3) {
      const idx = lines[s]; r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (ct === 0) { r = g = b = lines[s]; }
    else if (ct === 4) { r = g = b = lines[s]; a = lines[s + step]; }
    else if (ct === 2) { r = lines[s]; g = lines[s + step]; b = lines[s + 2 * step]; }
    else { r = lines[s]; g = lines[s + step]; b = lines[s + 2 * step]; a = lines[s + 3 * step]; }
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
  }
  return { w, h, rgba };
}

/* ---------------- 2x box downscale (kills antialias + subpixel noise) ---------------- */
function half(img) {
  const W = img.w >> 1, H = img.h >> 1;
  if (W < 1 || H < 1) return img;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const i0 = ((y * 2) * img.w + x * 2) * 4, i1 = i0 + 4, i2 = i0 + img.w * 4, i3 = i2 + 4;
    for (let c = 0; c < 4; c++) out[o + c] = (img.rgba[i0 + c] + img.rgba[i1 + c] + img.rgba[i2 + c] + img.rgba[i3 + c] + 2) >> 2;
  }
  return { w: W, h: H, rgba: out };
}

const gray = (d, i) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);

function aHash(img) {
  const bins = new Float64Array(64), n = new Float64Array(64);
  for (let y = 0; y < img.h; y++) { const by = Math.min(7, (y * 8 / img.h) | 0);
    for (let x = 0; x < img.w; x++) { const t = by * 8 + Math.min(7, (x * 8 / img.w) | 0);
      bins[t] += gray(img.rgba, (y * img.w + x) * 4); n[t]++; } }
  const v = Array.from(bins, (s, i) => (n[i] ? s / n[i] : 0));
  const mean = v.reduce((s, x) => s + x, 0) / 64;
  return v.map((x) => (x > mean ? 1 : 0));
}

/* ---------------- PNG encode (colorType 6, filter 0) for the diff map ---------------- */
const CRC = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t; })();
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from(SIG), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- loose fallback: never crash, say what is missing ---------------- */
function looseReport(pa, pb, ba, bb, why) {
  const dim = (b) => { try { return [b.readUInt32BE(16), b.readUInt32BE(20)]; } catch { return null; } };
  const n = Math.min(ba.length, bb.length);
  let same = 0, taken = 0;
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20000))) { if (ba[i] === bb[i]) same++; taken++; }
  return { schema: 'clone-site/diff@1', mode: 'loose', degraded: true, why,
    a: pa, b: pb, size: { a: dim(ba), b: dim(bb) }, bytes: { a: ba.length, b: bb.length },
    sizeRatio: +(Math.min(ba.length, bb.length) / Math.max(ba.length, bb.length)).toFixed(4),
    byteEqualRatio: +(same / (taken || 1)).toFixed(4),
    pixelDiff: null, similarity: null, aHash: null, worstTile: null, worstTileBox: null, worstTiles: [], tiles: [],
    note: 'Byte/size heuristic only — not a fidelity score. For a real diff install an optional decoder (pngjs or sharp) and re-run, or re-capture with take_screenshot {format:"png"}.' };
}

/* ---------------- main ---------------- */
const o = parseArgs(process.argv.slice(2));
const [pa, pb, outJson] = o.pos;
let ba, bb;
try { ba = readFileSync(pa); } catch (e) { fail(3, `Cannot read ${pa}: ${e.message}`); }
try { bb = readFileSync(pb); } catch (e) { fail(3, `Cannot read ${pb}: ${e.message}`); }

let A, B, decodeErr = null;
try { A = decodePng(ba); B = decodePng(bb); } catch (e) { decodeErr = e.message; }

let report;
if (decodeErr) {
  if (!o.loose) fail(2, `Cannot decode PNG: ${decodeErr}\n` +
    'This decoder handles non-interlaced 8/16-bit PNG only. Options: re-capture with\n' +
    'take_screenshot {format:"png"} (never webp for this script), re-run with --loose for a\n' +
    'byte/size heuristic, or install an optional decoder (pngjs, or sharp) and use that instead.');
  report = looseReport(pa, pb, ba, bb, decodeErr);
} else {
  const ha = half(A), hb = half(B);
  const W = Math.min(ha.w, hb.w), H = Math.min(ha.h, hb.h);
  const cols = o.cols, rows = o.rows;
  const hit = new Float64Array(cols * rows), tot = new Float64Array(cols * rows);
  const map = o.out ? new Uint8Array(W * H * 4) : null;
  let diff = 0;
  for (let y = 0; y < H; y++) {
    const ty = Math.min(rows - 1, (y * rows / H) | 0);
    for (let x = 0; x < W; x++) {
      const ia = (y * ha.w + x) * 4, ib = (y * hb.w + x) * 4;
      const d = Math.max(Math.abs(ha.rgba[ia] - hb.rgba[ib]), Math.abs(ha.rgba[ia + 1] - hb.rgba[ib + 1]),
                         Math.abs(ha.rgba[ia + 2] - hb.rgba[ib + 2]), Math.abs(ha.rgba[ia + 3] - hb.rgba[ib + 3]));
      const t = ty * cols + Math.min(cols - 1, (x * cols / W) | 0);
      tot[t]++;
      const bad = d > o.threshold;
      if (bad) { diff++; hit[t]++; }
      if (map) { const g = gray(ha.rgba, ia) * 0.35 | 0, m = (y * W + x) * 4;
        map[m] = bad ? 255 : g; map[m + 1] = bad ? 40 : g; map[m + 2] = bad ? 40 : g; map[m + 3] = 255; }
    }
  }
  const tiles = Array.from(hit, (v, i) => (tot[i] ? +(v / tot[i]).toFixed(3) : 0));
  const box = (i) => ({ col: i % cols, row: (i / cols) | 0,
    x: Math.round((i % cols) * (W * 2) / cols), y: Math.round(((i / cols) | 0) * (H * 2) / rows),
    w: Math.round(W * 2 / cols), h: Math.round(H * 2 / rows) });
  const ranked = tiles.map((r, i) => ({ i, r })).sort((p, q) => q.r - p.r).slice(0, 5).filter((t) => t.r > 0);
  const hashA = aHash(ha), hashB = aHash(hb);
  let ham = 0; for (let i = 0; i < 64; i++) if (hashA[i] !== hashB[i]) ham++;
  const pixelDiff = +(diff / (W * H)).toFixed(5);
  report = { schema: 'clone-site/diff@1', mode: 'decoded', degraded: false, a: pa, b: pb,
    threshold: o.threshold, grid: { cols, rows }, w: W, h: H,
    size: { a: [A.w, A.h], b: [B.w, B.h] },
    sizeDelta: { w: B.w - A.w, h: B.h - A.h,
                 hPct: A.h ? +(((B.h - A.h) / A.h) * 100).toFixed(2) : null },
    pixelDiff, similarity: +(1 - pixelDiff).toFixed(5), aHash: ham,
    worstTile: ranked.length ? ranked[0].r : 0,
    worstTileBox: ranked.length ? box(ranked[0].i) : null,
    worstTiles: ranked.map((t) => ({ ...box(t.i), ratio: t.r })), tiles };
  if (o.out) { mkdirSync(dirname(o.out), { recursive: true }); writeFileSync(o.out, encodePng(W, H, map)); report.map = o.out; }
}

if (outJson) { mkdirSync(dirname(outJson), { recursive: true }); writeFileSync(outJson, JSON.stringify(report, null, 2)); }
if (o.json) process.stdout.write(JSON.stringify(report) + '\n');
else if (report.degraded) process.stdout.write(
  `DEGRADED (${report.why}) sizeRatio ${report.sizeRatio} byteEqual ${report.byteEqualRatio}\n${report.note}\n`);
else {
  const w = report.worstTiles.map((t) => `${(t.ratio * 100).toFixed(1)}% @ x${t.x} y${t.y} ${t.w}x${t.h}`);
  process.stdout.write(
    `similarity ${(report.similarity * 100).toFixed(2)}%  pixelDiff ${report.pixelDiff}  aHash ${report.aHash}/64  ` +
    `size ${report.size.a.join('x')} vs ${report.size.b.join('x')} (Δh ${report.sizeDelta.h}px)\n` +
    (w.length ? `worst regions (original px): ${w.join(' | ')}\n` : 'worst regions: none above threshold\n') +
    (outJson ? `report ${outJson}\n` : '') + (report.map ? `map ${report.map}\n` : ''));
}
if (o.gate !== null && report.pixelDiff !== null && report.pixelDiff > o.gate) process.exit(1);
