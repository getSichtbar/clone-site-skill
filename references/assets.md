# Assets — verbatim byte mirror

`cdp:` = `mcp__plugin_chrome-devtools-mcp_chrome-devtools__`.

Policy: every asset the original serves is copied **byte-for-byte** into a full-page clone. In `--section` mode,
copy every asset required to render the selected subtree plus its resolved fonts and first-party CSS/JS reference
material; unrelated page media is not shipped. No mirrored byte is re-encoded, resized, or replaced with stock
imagery. A mirrored file's sha256 must match the origin's, and anything that cannot be mirrored is named rather
than silently replaced.

Two ordering rules decide whether this phase works. The **full-page prewarm** (page clone) or the selected-root
**targeted prewarm** (`--section`) must already have run — otherwise lazy media is absent from the log. And the byte
fetch must follow the census **immediately**: Chrome evicts response bodies aggressively, and a census taken at minute
1 fetched at minute 10 returns `<Response body not available anymore>` for half the page.

## 1. Census — five sources, in this order

No source alone is complete. Union them, dedupe by absolute URL.

### Scoped census

After `references/sectioning.md` resolves `run.json.scope.selector` and `run.json.sections[0].extraSelectors`, filter
the shipping manifest to URLs evidenced by every selected member: descendant `img` / `picture` / `source` / `video` /
`audio` / `svg use`, computed backgrounds and pseudos within them, and any response loaded while the targeted prewarm
ran. Keep all font files that resolve for text inside the selected members. Keep first-party CSS/JS that contributes a selected declaration or motion evidence in
`.clone/assets/{css,js}` as **reference material**, but do not expose unrelated scripts from that directory to the
preview or generated component.

Before filtering, preserve the source URL and the reason in each surviving `assets.json[].usedBy` row, for example
`["03-pricing:img", "03-pricing:background"]`. A stylesheet or font needed through inheritance belongs in the
manifest even if no `<img>` references it. Conversely, a network image from the whole-page visit is not evidence for
the selected component just because it happened to be in the log. `scope.context[]` can identify an ancestor
background that is required for a transparent/glass section preview; record that exception in `SELECTION.md`.

| # | Source | Catches | Misses |
|---|---|---|---|
| 1 | `cdp:list_network_requests` | everything the browser actually fetched, with `reqid` for byte access | lazy backgrounds below the fold, unpicked `srcset` candidates, `@font-face` weights no glyph needed, `<link rel=preload>` the browser skipped |
| 2 | `.clone/foundation.json` → `assets.*` | `img` (`src`/`currentSrc`/`srcset`/`sizes`/naturals), computed backgrounds on elements **and** `::before`/`::after`, `video`/`audio` + `poster` + `<source>`, inline `<svg>`, `<use href>`, `link rel` icons/manifest/preload, `ogImage`, stylesheet + script URLs | `url()` inside rules that do not currently match (dark theme, `:hover`, other breakpoints), `<picture><source srcset>` |
| 3 | Mirrored CSS text — **both** dirs: `.clone/css/*.css` (cross-origin sheets recovered by `references/extraction.md`) **and** `.clone/assets/css/*.css` (same-origin sheets mirrored by §3 of this file, which is where they land on the common all-same-origin page) | every `url()` in every rule: lazy backgrounds, `mask-image`, `cursor`, icon-font `src`, `@font-face` subsets, `image-set()` DPR variants | nothing CSS-shaped; not JS-injected URLs |
| 4 | Mirrored HTML in `.clone/raw/document.html` | `<picture><source srcset>`, `<video poster>`, `<link rel=icon sizes=…>`, `<meta og:image>`, inline `<svg><symbol>` sprites, `srcset` candidates verbatim | anything the client renders after hydration (source 2 covers that) |
| 5 | In-page CSSOM `url()` sweep (§1c) | rules in inline `<style>` and in `document.adoptedStyleSheets` — neither has a network entry, and CSS-in-JS sites keep *everything* there | cross-origin sheets (they throw `SecurityError`; source 3 covers them) and closed shadow roots |

### 1a. Network census

Four calls. `resourceTypes` is a closed enum: `document`, `stylesheet`, `image`, `media`, `font`, `script`,
`texttrack`, `xhr`, `fetch`, `prefetch`, `eventsource`, `websocket`, `manifest`, `signedexchange`, `ping`,
`cspviolationreport`, `preflight`, `fedcm`, `other`.

```jsonc
{"resourceTypes":["font"],                  "pageSize":200}   // post-subsetting: the woff2s really used
{"resourceTypes":["image","media"],         "pageSize":300}   // raster, svg-as-img, posters, mp4/webm
{"resourceTypes":["stylesheet","document"], "pageSize":100}   // CSS + the HTML, both mirrored as text
{"resourceTypes":["manifest","other"],      "pageSize":100}   // webmanifest, favicons, sprite sheets
```

Each line returns as `reqid=<n> <METHOD> <url> [<status>]`. Rules:

- **Re-list after prewarming** (`references/sectioning.md`) — full-page for a page clone or targeted for
  `--section`; lazy images and backgrounds only appear in the log once they are requested. Diff the two lists; the
  delta is real assets, not noise.
- `includePreservedRequests: true` merges the last **3** navigations. Use it after a consent-banner reload or
  an SPA route change; otherwise the log resets and the old `reqid`s are unusable.
- Paginate with `pageIdx` on asset-heavy pages rather than raising `pageSize` past 300.
- Ignore `status` 204/304 and redirect hops — they carry no body. Keep the final URL of the chain.

### 1b. Text-source sweeps

Mirror the stylesheets and the HTML first (§3), then harvest URLs from the bytes with `Bash` — no extra
browser round-trip, and it finds the rules that never matched:

```bash
# every url() token in every mirrored stylesheet, absolute + relative, deduped.
# BOTH dirs: .clone/css/ holds recovered cross-origin sheets, .clone/assets/css/ the mirrored same-origin ones.
# Assert first that at least one sheet exists, or this source silently contributes nothing:
ls .clone/css/*.css .clone/assets/css/*.css 2>/dev/null | grep -q . || echo "NO MIRRORED CSS — source 3 did not run"
grep -rhoE 'url\([^)]+\)' .clone/css/ .clone/assets/css/ 2>/dev/null \
  | tr -d "\"'" | sed -E 's/^url\(//; s/\)$//' | sort -u
# picture/source candidates, posters, icons, og images from the initial HTML
grep -oE '(srcset|poster|href|content)="[^"]*\.(avif|webp|png|jpe?g|gif|svg|ico|mp4|webm|woff2?)[^"]*"' \
  .clone/raw/document.html | sort -u
# inline sprite ids — these ship as markup, not as files
grep -oE '<symbol[^>]*id="[^"]+"' .clone/raw/document.html | sort -u
```

Resolve every relative URL against the **stylesheet's** own URL (not the document's) for CSS hits, and
against `meta.finalUrl` for HTML hits. Drop `data:` and `blob:` — see §2 and §5.

### 1c. In-page CSSOM sweep

Pass this as the `function` argument to `cdp:evaluate_script` with `filePath ".clone/raw/cssom-urls.json"`. It
resolves each `url()` against its own sheet's `href`, and reaches the sheets that have no network entry at all:

```js
() => { const out = new Set(), CAP = 800;
  const walk = (sheet) => { let rules; try { rules = sheet.cssRules; } catch { return; }  /* cross-origin: source 3 */
    const base = sheet.href || location.href;
    for (const r of rules || []) {
      if (r.styleSheet) { walk(r.styleSheet); continue; }                                 /* @import */
      for (const m of String(r.cssText || '').matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
        if (out.size >= CAP) break;
        try { out.add(new URL(m[2], base).href); } catch { /* not a URL */ } } } };
  for (const s of [...document.styleSheets, ...document.adoptedStyleSheets]) walk(s);
  return { count: out.size, urls: [...out].filter((u) => !u.startsWith('data:')) }; }
```

A media/`@supports`/`@layer` rule's `cssText` serializes its whole block, so one pass catches every nested
`url()`, including the ones inside breakpoints and themes that do not currently match.

### 1d. srcset, sizes, picture, image-set

The browser fetches exactly one candidate per element at the DPR and viewport it was measured at, so a clone
that ships only that candidate breaks on every other screen. For each `srcset` string (from
`foundation.assets.images[].srcset` and from the HTML sweep), split on top-level commas and add **every**
candidate to `assets.json` with `variantOf` = the id of the candidate the page actually rendered
(`currentSrc`), `descriptor` = the raw `2x` / `1440w` token unchanged, and `sizes` copied verbatim onto the
parent entry.

Same for CSS `image-set()` and `<source type="image/avif">`. Keep the `type` attribute order from the HTML:
`<picture>` resolution is source-order-dependent, and reordering silently changes which format a browser picks.

## 1b. First-party JS and CSS are reference material — always take them

Mirror the site's **own** scripts and stylesheets into `.clone/assets/{js,css}` at every
profile, not just `thorough`. They are never shipped (`references/stacks.md` §6 — strip them
from `public/`), but without them `references/motion-source.md` cannot run, and that file is
where a bespoke site's real motion configuration comes from: scroll thresholds, per-reveal
durations and easings, slider `breakpoints`, resize behaviour. On one real run the bundle was a
webpack build that had kept its module comments, which turned an opaque 3 MB file into a
19-module checklist and corrected a scroll threshold that had been guessed as `> 0` when the
author wrote `> 200`.

Mark third-party tags (`gtm`, `fbevents`, analytics, chat, ad pixels) `optional` so they never
fail the run — they are not needed and must not be reproduced. Everything first-party is
`required`. An unminified stylesheet is the single most valuable file in the mirror: it gives
you authored declarations instead of computed values, and its comments often name the author's
own intent.

## 2. What cannot be mirrored

State each of these plainly in `CLONE-REPORT.md` (template in `references/assembly.md`) and record it as an
`unmirrorable[]` row in `assets.json`. Never fill the hole with a lookalike and say nothing.

| Case | Detection | What to do |
|---|---|---|
| DRM / encrypted media | `requestMediaKeySystemAccess` in use, `.m3u8`/`.mpd` manifests, Widevine license XHRs | Mirror the `poster` only. Ship a `<video>` with the poster and no source; row: `why:"drm"` |
| HLS/DASH streamed video | `resourceTypes:["media"]` shows hundreds of `.ts`/`.m4s` segments | Mirror the poster + first segment for reference; keep the original playback URL in the row; `why:"streamed"` |
| Canvas / WebGL visuals | `assets.svgInline` empty and the section's only child is `<canvas>`; `foundation.stack.animation` names three/ogl/pixi | There is no markup and no file to copy. Screenshot the canvas as a static poster, then **rebuild the region deliberately** (poster image, CSS gradient, or a re-authored shader) and say in `CLONE-REPORT.md` that you rebuilt it; mark the section `authored-not-verified`; `why:"canvas"` |
| Third-party embeds — `<iframe>` for YouTube/Vimeo/Maps/Stripe/Calendly/Intercom | cross-origin `iframe[src]` in `topology.tree`, plus its own `document` entry in the census | The inner document is not yours to mirror. Keep the `<iframe>` with its original `src`, measured box, and `allow`/`loading`/`title` attributes — or swap in the mirrored poster if the clone must run offline. Record `why:"embed"`; the section's `report.md` names it as the one outbound request the clone keeps |
| Auth- or geo-gated assets | 401/403 in the census, or a signed URL with an `Expires` query param | Use the `cdp:get_network_request` path (§3b) — the browser already paid the auth. If it still fails: `why:"auth"`, and say which section is affected |
| `blob:` URLs | URL starts with `blob:` | Runtime-generated; no origin file. Trace to the XHR that produced it, or record `why:"blob"` |
| Fonts blocked by CORS/referrer | font 200s in-browser but `curl` returns 403 | Fetch via `cdp:get_network_request` with `responseFilePath`; if the license forbids redistribution that is the user's call, not the skill's |
| Server-rendered dynamic images | URL has a query-string signature and a `Cache-Control: no-store` | Mirror the bytes once and treat as static; note `why:"dynamic"` |

## 3. Download

### 3a. Default: `fetch-assets.mjs`

Write `assets.json` (§6), then:

```bash
node ~/.claude/skills/clone-site/scripts/fetch-assets.mjs .clone/assets.json .clone/assets
```

Positional args: manifest (default `.clone/assets.json`), staging dir (default `<manifest dir>/assets`). Flags:
`--concurrency N` (1–16, default 6) · `--retries N` (3, backoff `400ms·2^n` + jitter, `Retry-After` honoured on
429) · `--timeout MS` (30000) · `--provenance PATH` · `--ua STR` / `--referer STR` (override
`fetch.userAgent`/`fetch.referer`) · `--force` (re-download even when the local sha256 matches) · `--dry-run` ·
`--quiet` · `-h`. Exit 0 clean, **1** a non-`optional` asset failed, 2 usage/manifest error.

It streams to `<dest>.part` then renames, hashes inline, dedupes by sha256, decodes `data:` URLs locally, skips
entries whose file already matches their recorded `sha256` (`status:"cached"`, so re-runs resume), writes every
result back into `assets.json`, and emits `.clone/PROVENANCE.md`. A 4xx other than 408/429 stops retrying at
once. Entries marked `"optional": true` (analytics, chat widgets, ad scripts) never fail the run.

### 3b. Auth, signed, or CORS-blocked: `cdp:get_network_request`

The browser already holds the cookies, headers, and signature. Fetch through it:

```jsonc
{ "reqid": 142, "responseFilePath": "/abs/project/.clone/assets/fonts/soehne-buch.woff2" }
```

`responseFilePath` writes the **exact bytes** (`response.buffer()`) — the only reliably byte-exact path for
anything private. Omit it and a binary body returns the literal string `<binary data>`, while a text body
truncates at **10 000 characters** with `... <truncated>`. Four mechanics bite:

| Symptom | Cause | Fix |
|---|---|---|
| `<binary data>` | body read inline | re-call with `responseFilePath` |
| `<Response body not available anymore>` | Chrome evicted the body — routine after any navigation, which is why this phase runs right after extraction | the bytes are gone from that `reqid`: re-fetch the URL with `curl` (§3c), or `cdp:navigate_page {type:"reload", initScript: HOOKS}` and re-list for fresh `reqid`s (then re-install every payload) |
| file lands as `*.network-response` | the server forces its own extension | `mv .clone/assets/fonts/soehne-buch.network-response .clone/assets/fonts/soehne-buch.woff2` |
| `Access denied: path … is not within any of the configured workspace roots` | path outside the negotiated MCP roots and `os.tmpdir()` | write under the project root or `/tmp` |

Then hash and size it yourself and patch the entry in `assets.json` before running `fetch-assets.mjs`, which
then reports it `cached`: `sha256sum <file> && wc -c < <file>`.

### 3c. `curl` fast path

Public assets, when you want content-type, bytes, and sha in one shot without a manifest edit:

```bash
curl -sSL --compressed -A "$UA" -e "$PAGE_URL" -D /tmp/h.txt -o .clone/assets/img/hero.avif "$URL" \
  && grep -i '^content-type:' /tmp/h.txt && sha256sum .clone/assets/img/hero.avif
```

`$UA` is `foundation.meta.ua` verbatim — some CDNs serve a different format (or a 403) to an unknown agent,
and a UA mismatch is the usual cause of "the mirror has a WebP where the original had an AVIF".

## 4. Local paths and rewriting

Bytes stage in `.clone/assets/`, then get copied into the emitted project's asset dir — destination and public
prefix from the path map in `references/stacks.md` (`run.json.stack.assetsDir`).

```
.clone/assets/  fonts/soehne-buch.woff2 · img/hero.avif, hero@2x.avif, logo.svg · media/demo.mp4,
demo-poster.jpg · meta/favicon.ico, apple-touch-icon.png, site.webmanifest, og-image.jpg   # all shipped
                css/app.css, vendor.css · js/app.js                # source of truth only, never shipped
```

Naming, in order — the script's fallback derives from the URL basename, so set `local` yourself whenever any
rule below applies:

| Rule | Example |
|---|---|
| Keep the source basename and extension; slugify to lowercase `[a-z0-9._@%+-]`, ≤ 120 chars | `Hero_BG.PNG` → `hero_bg.png` |
| **No extension on the URL** → recover it from the response `content-type` (`image/avif` → `.avif`, `font/woff2` → `.woff2`; unknown → `.bin`) | `/img/12345` + `image/webp` → `12345.webp` |
| **Query string that versions the bytes** → fold it into the basename; two URLs differing only by `?v=` are two different files and otherwise collide. Drop it only when the basename is already content-hashed | `logo.svg?v=3` → `logo-v3.svg`; `f.woff2?x=abc` → `f-x-abc.woff2`; `hero.8f3a21.avif?ts=9` → `hero.8f3a21.avif` |
| Pure build-hash basename (≥ 16 hex chars, no words) → rename from the element's `alt` or its section id | `a3f9…d1.avif` → `hero-dashboard.avif` |
| DPR variants get `@2x`/`@3x`; `w`-descriptor variants keep `-<N>w` verbatim | `hero-1440w.avif` |

Rewrite rule, applied once per URL: `assets.json` maps `url` → `local` → `ref`, the string that goes into markup
and CSS, including every `@font-face` `src` and every `background-image: url()` you re-author. Section agents
write only `ref`; one leftover origin URL means the clone silently phones home, and the asset-path gate that
catches it is in `references/assembly.md`. Preserve per image the exact format (`avif` stays `avif` — do not
"helpfully" convert), `naturalW`/`naturalH` as explicit `width`/`height`, `loading`, `decoding`, `objectFit`,
`objectPosition`, and the verbatim `alt`. Wrong intrinsic dimensions are the top cause of a CLS gap that no
at-rest pixel diff will catch.

## 5. Fonts, SVG, icon fonts

- **Fonts are files.** `foundation.fonts.faces[].srcUrls` × the `resourceTypes:["font"]` census is the mirror
  list; a face with `status:"unloaded"` and no network hit is declared-only (keep the declaration, skip the
  download). Carry `unicodeRange`, `display`, `weight` (a range like `100 900` means variable), `sizeAdjust`
  and the ascent/descent overrides on the entry. Every `src` in the emitted `@font-face` (authored per
  `references/foundation.md`) points at `ref` — never at the origin, never at `fonts.gstatic.com`.
- **SVG.** Inline `<svg>` is markup, not an asset: copy it verbatim into the component (`viewBox`,
  `fill="currentColor"`, `aria-hidden`, `<title>`); do not extract it to a file. An external sprite
  (`<use href="/icons.svg#chevron">`) mirrors as one file, `#id` fragments unchanged; an inline `<symbol>`
  sheet mirrors as markup into the layout shell so every `<use href="#id">` still resolves.
- **Icon fonts** (Font Awesome, Material Icons, ligature fonts) mirror as the font file plus the CSS mapping
  class → `content: "\f105"`. Copy the codepoints verbatim; do not substitute an SVG icon set.
- **`data:` URIs** stay inline as authored — that *is* byte-verbatim. Decode one into `.clone/assets/` only
  when it is over ~8 KB and repeated; the entry's `url` then keeps the full `data:` string.
- **Favicons, manifest, OG.** Mirror every `<link rel>` icon at every declared `sizes`, the `.webmanifest`,
  **and** the icons the manifest itself lists (usually absent from the HTML), plus
  `foundation.assets.ogImage` — nothing renders it, but a clone without it has no social preview.

## 6. `assets.json`

`clone-site/assets@1`. `fetch-assets.mjs` reads `assets[]`, fills `contentType`/`bytes`/`sha256`/`status`, and
adds a top-level `mirror` summary.

`local` → `ref` → `project` is one derived chain, and the script can **move** `local` mid-run in three ways: a
collision gets a url-hash suffix, a URL with no extension gets one recovered from the `content-type`, and an
identical-sha256 duplicate collapses onto the first copy (`status:"deduped"`, `dedupeOf`). It re-points `ref` and
`project` in the same step — never read one of the three without the others, and never cache a `ref` from before
the run. Two rules follow: a hand-authored `ref` must end in its own `local` (otherwise only the basename can be
rewritten, and the script logs that into `manifest.warnings[]`), and the spec-writing step must derive
`spec.assets[].ref` from the **post-run** manifest. Getting this wrong is silent: the asset-path gate in
`references/assembly.md` §1 only checks that the `src` appears in `spec.assets[].ref`, so a stale `ref` matches
itself while pointing at a file that is missing — or, after a collision, at another asset's bytes.

```jsonc
{
  "schema": "clone-site/assets@1",
  "capturedAt": "2026-07-31T10:02:11.418Z",
  "page": { "url": "https://example.com/", "origin": "https://example.com" },
  "fetch": { "userAgent": "<foundation.meta.ua verbatim>", "referer": "https://example.com/",
             "headers": { "cookie": "…only if the asset needs it…" } },
  "assets": [{
    "id": "hero-avif", "kind": "image",      // kind: font|image|video|poster|svg|sprite|stylesheet|script|icon|manifest|og|other
    "url": "https://cdn.example.com/_next/static/hero.8f3a21.avif",
    "local": "img/hero.avif",                // relative to .clone/assets/; the script's own naming is a fallback
    "ref": "/assets/img/hero.avif",          // what markup/CSS writes; prefix from stacks.md
    "project": "public/assets/img/hero.avif",// repo-relative emitted path
    "via": "network", "reqid": 142,          // via: network|css|srcset|dom|head|manifest
    "contentType": "image/avif", "bytes": 184203, "sha256": "9f2c…", "httpStatus": 200, "finalUrl": null,
    "dims": { "w": 2880, "h": 1620 }, "usedBy": ["01-hero"], "optional": false,
    "variantOf": null, "descriptor": null, "sizes": "(max-width: 768px) 100vw, 1200px",
    "status": "mirrored",                    // pending|mirrored|cached|deduped|failed|skipped
    "dedupeOf": null, "note": null
  }],
  "unmirrorable": [{ "url": "https://stream.example.com/master.m3u8", "kind": "video",
                     "why": "streamed", "evidence": "412 .m4s segments in the media census",
                     "fallback": "poster-only <video>", "usedBy": ["04-demo"] }],
  "counts": { "byKind": { "font": 6, "image": 41 } }, "warnings": []
}
```

## 7. PROVENANCE.md

Written by `fetch-assets.mjs` to `.clone/PROVENANCE.md`; never hand-edited. Rows are sorted by local path (so
two runs of the same target diff cleanly) and relative to the staging dir printed in the header. A deduped
entry appears once per source URL, all of them pointing at the one shared local file — that is deliberate.

```markdown
# PROVENANCE

Mirrored from https://example.com/ on 2026-07-31T10:04:52.117Z.
47 files, 3182044 bytes. Staged in `/abs/project/.clone/assets`; paths below are relative to it.

| local path | source URL | content-type | bytes | sha256 |
|---|---|---|---|---|
| `fonts/soehne-buch.woff2` | https://example.com/fonts/soehne-buch.woff2 | font/woff2 | 24184 | `4a7d…` |
| `img/hero.avif` | https://cdn.example.com/_next/static/hero.8f3a21.avif | image/avif | 184203 | `9f2c…` |
```

**Three** "not mirrored" sections follow the table, each emitted only when non-empty, in this order:

| Section | Columns | One row per | Fails the run? |
|---|---|---|---|
| `## Failed` | `source URL \| http \| why` | non-`optional` entry that never downloaded — 403s from hotlink-protected CDNs are the common case, and they belong here rather than dropped | **yes**, exit 1 |
| `## Skipped (optional)` | `source URL \| http \| why` | entry with `"optional": true` that failed anyway (analytics, chat widgets, ad scripts) | no — `status:"skipped"`, and the exit code stays 0 |
| `## Not mirrorable` | `source \| kind \| why` | `unmirrorable[]` entry (§2) | no, but each one is carried into `CLONE-REPORT.md` |

So an entry under `## Skipped (optional)` is an accounted-for absence, not a gate failure: the
provenance-completeness gate in `references/assembly.md` §5.3 reads only the main table plus `## Failed`.

Then reconcile: `run.json.assets.count`/`bytes`/`failed[]` must equal the script's summary line, and every
`assets[].status === "mirrored" \| "cached" \| "deduped"` entry needs a non-null `sha256`. A failed required
asset is a blocking gap — carry it into `CLONE-REPORT.md` with the section it affects; never paper over it with
a placeholder image.

The mirror reproduces third-party text, marks, and imagery byte-for-byte; swapping or keeping them before you
publish is your call. Every mirrored file is listed in `.clone/PROVENANCE.md` with its source URL,
content-type, byte count, and sha256.
