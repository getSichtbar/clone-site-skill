# Scaling: profiles, budgets, checkpointing, resume

Read this before you fan out, and any time the page or the site is large. It decides how much you measure, how
many agents run at once, where the output goes, and how a killed run picks itself back up.

`cdp:` = `mcp__plugin_chrome-devtools-mcp_chrome-devtools__` throughout.

## Profiles

`--profile cheap|standard|thorough` (aliases `--cheap`, `--thorough`) sets the defaults below. An explicit flag
always overrides the profile: `--cheap --max-parallel 8` runs 8. Record the resolved values in
`run.json.flags` and `run.json.budget` before phase `prewarm`.

| Dimension | `cheap` | `standard` (default) | `thorough` |
|---|---|---|---|
| Viewports measured | `1440x900` | `1440x900` + `390x844` | `1440x900` + `1024x768` + `390x844` |
| Section captures | primary width only | both widths | all three widths |
| Segmentation `KEEP` | 3.6 (fewer, bigger sections) | 3.0 | 2.6 (finer cuts) |
| Hover / focus / active | skipped | CTAs and cards only | every interactive element |
| Motion capture | CSSOM only, static render | measured for revealed sections | full `getAnimations()` + scroll-linked fits |
| Overlays / modals | stubbed closed | measured when `open: true` | each opened via its trigger and measured |
| Carousels | first slide, static | CSS `scroll-snap` track, all slides | full behaviour incl. autoplay timing |
| Fluid sweep widths | 7 † | 7 † | 7 † |
| Pages | 1 | `--pages` | `--pages`, `--depth 2` |
| `budget.repairMax` (`K`) | **1** | **3** | **4** |
| `budget.sectionAttemptsMax` | 1 | 2 | 3 |
| Full-page diff | no | yes, primary width | yes, every gated width |
| `cdp:lighthouse_audit` | no | no | yes, both sides |
| Asset mirror | images + fonts | + svg, posters, sprites | + video, `srcset` variants, favicons, `og:` images |
| Typical cost | ~0.25× | 1× | ~2.5× |

Explicit `--viewport` flags **replace** the profile's viewport set, they do not append. The first one is the
primary width and is authoritative for the manifest. Dark-mode extraction is not a profile dial — it runs
whenever `foundation.json.color.darkMode` shows any signal.

**† The fluid sweep is a correctness floor, not a cost dial.** All three profiles sweep the same seven widths —
`360 480 768 1024 1200 1440 1920` (`references/extraction.md` §7). `fitFluid` reads `MIN`/`MAX` off the flat head
and tail of the curve, so it needs **≥ 4 samples spanning 320→2560** before a `clamp()` has recoverable rails
(`references/responsive.md` R5); a typical `clamp()` is already railed at both ends of even a 5-width sweep, which
leaves exactly two interior samples. Cut fewer than seven and every fluid token ships `minIsObservedOnly` /
`maxIsObservedOnly` — a guessed number in the one place this skill promises not to guess. The sweep is also cheap
relative to what it protects: seven `resize_page` + `measure('resize')` pairs, no captures, no agents. `cheap` gets
its ~0.25× from viewports, captures, hover depth, motion depth, `K`, and the full-page diff — not from here.

## Where the tokens actually go

Measured shape of a 12-section, one-page `standard` run (~600–900k tokens total):

| Bucket | Share | Why |
|---|---|---|
| Section agent context (12 × 35–50k) | **~55%** | each reads `spec.json`, two captures, the token file, `_EXAMPLE` |
| Foundation + motion + responsive extraction | ~12% | computed-style and CSSOM dumps are enormous — `filePath` or bust |
| Verification screenshots + diffs | ~12% | two captures per section per iteration |
| Orchestrator review + reports | ~10% | N reports × 400 words + gate tables |
| Repair iterations | ~8% | scales with how wrong the foundation was |
| Route discovery, mirroring, assembly | ~3% | mostly `Bash`, cheap |

The section fan-out is the bill. Everything in this file exists to keep that number honest: dedup before you
schedule, verify per wave so a systemic error costs one edit instead of N repairs, and never re-measure.

## `filePath` discipline — a hard rule, not a nicety

| Call | Inline cost | With `filePath` |
|---|---|---|
| `cdp:evaluate_script`, full computed-style dump | 80k–400k tokens; routinely blows the turn | ~30 tokens + a path |
| `cdp:take_snapshot` on a marketing page | 15k–60k tokens | ~30 tokens |
| `cdp:take_screenshot` (attached under 2 MB, temp file above it) | 1.5–3k tokens, ungreppable, unpredictable | ~30 tokens |
| `cdp:performance_stop_trace` | megabytes | a path |

1. **Every `evaluate_script`, `take_screenshot`, and `take_snapshot` in this skill passes `filePath`.** The only
   exception is a small scalar return you must branch on immediately (`{docHeight, kept: 14}`).
2. Never `Read` a dumped file whole. `Grep` or `jq` the field you need — `sections[].box` and `probes[]`, not
   the 120 KB manifest.
3. `filePath` is sandboxed to the negotiated MCP roots plus `os.tmpdir()`, and the server rewrites the
   extension per tool. Both are covered in `references/troubleshooting.md`.
4. Dumps live under `.clone/raw/` and are scratch. Nothing downstream may depend on reading one in full.

## `run.json` lifecycle

`.clone/run.json` is the only state, and the only file `--resume` reads. Write it **atomically on every state
transition**, not at wave boundaries — a crash mid-wave must not lose six agents' worth of work.

```bash
jq --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.phase="verify" | .phases.sections="done" | .updatedAt=$t' \
  .clone/run.json > .clone/run.json.tmp && mv .clone/run.json.tmp .clone/run.json
```

Complete schema. Types: `s` string, `n` number, `b` boolean, `?` nullable. Field names are law — nothing
downstream tolerates a synonym.

```jsonc
{
  "schema": "clone-site/run@1",
  "runId": "2026-07-30T18-22-05Z-acme",             // <ISO-with-dashes>-<domain>
  "createdAt": "s", "updatedAt": "s", "cli": "s",   // cli = the literal invocation string
  "target": { "url":"s","origin":"s","finalUrl":"s","title":"s","userAgent":"s","capturedAt":"s",
              "bodyHash":"s" },                     // bodyHash detects a changed target on resume — definition below
  "flags": { "static":"b","out":"s","pages":"n","depth":"n","sections":["s"]|null,"maxParallel":"n",
             "viewports":[[1440,900]],"profile":"cheap|standard|thorough","resume":"b","refresh":"b" },
  "stack": { "mode":"adopt|scaffold|static","detectedFrom":"s?","framework":"s","router":"s?",
             "css":"s","typescript":"b","pkgManager":"s","root":"s",
             "sectionsDir":"s","sharedDir":"s","assetsDir":"s","pageFile":"s","tokensFile":"s" },
  "phase": "init|discover|prewarm|motion|foundation|responsive|mirror|scaffold|segment|sections|assemble|verify|repair|done",
  "phases": { "init":"pending|running|done|failed|skipped" },   // one key per phase name above
                                                    // the enum IS the execution order; --resume walks it left to right
  "phaseLog": [{ "phase":"s","startedAt":"s","endedAt":"s","ok":"b","note":"s" }],
  "budget": { "repairMax":"n","repairUsed":"n","wavesTotal":"n","wavesDone":"n",
              "sectionAttemptsMax":"n","wallClockStartedAt":"s" },
  "foundation": { "spec":".clone/foundation.json","tokensFile":"s","tokenCount":"n","hash":"s",
                  "breakpoints":["n"],
                  "fontFamilies":[{ "family":"s","files":["s"],"weights":["n"],"unicodeRange":"s?","display":"s" }] },
  "assets": { "manifest":".clone/assets.json","provenance":".clone/PROVENANCE.md","count":"n","bytes":"n",
              "failed":[{ "url":"s","status":"n","why":"s" }] },
  "motion": ".clone/motion.json", "responsive": ".clone/responsive.json",
  "pagesManifest": ".clone/pages.json?", "componentsManifest": ".clone/components.json?",
  "sections": [{
    "id":"s","pageId":"s","order":"n","wave":"n","role":"s","label":"s","selector":"s","extraSelectors":["s"],
    "contentHash":"s","structureHash":"s","shared":"b","sharedKey":"s?","dedupOf":"s?",
    "state":"pending|running|done|failed|skipped|needs-repair",
    "attempts":"n","agent":"clone-section","startedAt":"s?","endedAt":"s?","error":"s?",
    "artifacts": { "dir":"s","spec":"s","prompt":"s","content":"s","report":"s","requests":"s","outFile":"s",
                   "captures":{ "1440":{ "orig":"s","clone":"s" } },"diff":"s?","geometry":"s?" },
    "gates": { "byWidth":{ "1440":{ "pixelDiff":"n","aHash":"n","worstTile":"n","overflowOffenders":"n",
                                    "worstTileBox":{ "x":"n","y":"n","w":"n","h":"n" } } },
               "geometryPass":"n","geometryWorstPx":"n","textFidelity":"n","hardcodedColors":"n",
               "arbitraryValues":"n","consoleErrors":"n","verdict":"pass|warn|fail" } }],
  "requests": { "drained":"n","applied":[{ "kind":"s","name":"s","from":"s" }],"rejected":[{ "kind":"s","name":"s","why":"s" }] },
  "verify": { "lastRunAt":"s", "failing":["s"], "history":[{ "iter":"n","diffMean":"n" }],
              "overall":{ "diffMean":"n","diffWorst":"n","gatesPassed":"n","gatesTotal":"n","consoleErrors":"n",
                          "http404":"n","tokenDrift":"n","docHeightDelta":"n","overflowBreakpoints":["n"] } },
  "notes": ["s"]
}
```

`target.bodyHash` is only useful if both runs compute it identically, so it is pinned to the run's own hasher:
`util.hash(util.norm(document.body.innerText))` — the two-seed FNV-1a 64-bit hex from
`scripts/extract-sections.js`, over whitespace-collapsed body text — read **at the primary width, after the
prewarm, with `scrollY === 0`**. Use `norm`, never `nlow`: `nlow` truncates at 2000 chars, so any change past the
fold would hash identically. One call:

```
cdp:evaluate_script {filePath:".clone/raw/bodyhash.json", function:
  "() => { const U = window.__clone.util, t = document.body.innerText; return { bodyHash: U.hash(U.norm(t)), len: t.length }; }"}
```

Text only, deliberately: a hash of `innerHTML` or of the document bytes flips on every build id, CSRF token, and
analytics attribute, which would make `--refresh` fire on every resumed run. Recompute it exactly this way on
resume — different scroll position, different viewport, or a cold (un-prewarmed) page all change `innerText` and
produce a false "target changed". Record `len` next to it: a large `len` delta with a matching hash means you
compared against a page in a different lifecycle state, not a changed target.

Section state machine. Both `skipped` and `failed` are terminal and they mean different things in the report:
`skipped` was a choice, `failed` is a gap that belongs in `UNRESOLVED.md`.

| Transition | Trigger |
|---|---|
| `pending → running` | the `Task` call for that section is dispatched (or its in-thread turn begins) |
| `running → done` | its `outFile` exists, is over 200 bytes, and the static sweep passed |
| `running → failed` | the agent returned no file, or the file will not parse; `error` records which |
| `running → pending` | `--resume` only: the agent died mid-write |
| `done → needs-repair` | a gate failed in the verify pass |
| `needs-repair → running` | a repair agent is dispatched; `attempts++` |
| `→ skipped` | excluded by `--sections`, or `dedupOf` names another section that ships the markup |

`phases.<name>` uses the same vocabulary: `running` on entry with a `phaseLog` row opened, `done` at the exit
gate below, `failed` on an unrecoverable tool error (stop and report — never degrade silently), `skipped` when
the phase does not apply (`discover` at `--pages 1`, `repair` when nothing failed).

Phase order — **this table's row order is the executed order**, matching SKILL.md steps 0→5, and it is the list
`--resume` walks. What each phase must have on disk before it may be marked `done`:

| Phase | Produces | Marked `done` when |
|---|---|---|
| `init` | `flags`, `target`, `runId` | flags parsed, Chrome precheck passed |
| `discover` | `pages.json` (only when `--pages > 1`) | routes selected and ranked |
| ↳ | **runs immediately after the step-1 navigation and before `prewarm`** — it needs only a loaded DOM plus `Bash curl` for `robots.txt`/`sitemap.xml`, and running it here is what lets `--pages 0` report and stop before a single measurement pass is spent. SKILL.md step 4 *consumes* `pages.json`; it does not produce it. Route ranking and the payload: `references/sectioning.md` §9 | |
| `prewarm` | full-height scroll, quiescent network | `docHeight` stable across two reads |
| `motion` | `motion.json` | every `bySection` entry carries `evidence` |
| `foundation` | `foundation.json`, `raw/foundation-*.json` | merged file validates against D1 |
| `responsive` | `responsive.json` | every gated width measured |
| `mirror` | `assets.json`, `PROVENANCE.md`, `.clone/assets/**` | every non-failed asset has bytes + sha256 |
| `scaffold` | project files, tokens, layout shell, `_EXAMPLE` | build passes on the empty page |
| `segment` | `sections.json` (+ `components.json` when multi-page) | `stats.kept` inside the sanity bounds |
| `sections` | one file per section, `report.md`, `requests.json` | no section left `running` |
| `assemble` | wired page, successful build | build exit 0 |
| `verify` | `VERIFY.md`, `sections[].gates`, `verify.overall` | every gate has a measured value |
| `repair` | edited files, re-measured gates | loop exited (success, budget, or plateau) |
| `done` | `CLONE-REPORT.md`, `UNRESOLVED.md` if needed | report written |

`motion` is the one phase that straddles another: its at-load passes are the first thing that touches the page,
before `prewarm` scrolls anything, and its scroll/state passes run after. The checkpoint records **completion**, so
`phases.motion == "done"` means every pass landed and `phases.prewarm == "done"` alone never implies it. Ordering
rules: `references/motion.md` M1.

`--resume` (auto-implied when `.clone/run.json` exists and `phase != "done"`):

0. **Find it first.** `.clone/` lives in the *clone project root*, which in scaffold mode is `--out`
   (default `./<domain>-clone`) and only in adopt mode is the cwd. Probe in order and stop at the first hit:
   `./.clone/run.json` → `<--out>/.clone/run.json` → `./<domain>-clone/.clone/run.json`. On a hit, `cd` to that
   root and resolve every path from its `stack`. On several hits, take the newest `updatedAt` and report which.
   No hit means this is a fresh run — say so instead of resuming nothing.
1. Read `run.json`. Confirm `stack.root` still exists and still matches `stack.framework`.
2. Skip every phase marked `done`. **Never re-navigate or re-measure** when `phases.segment == "done"` and the
   manifests exist — `segment` is the last phase that needs the original open, so a `done` there means every
   measurement phase before it is also done, and measurement is the expensive half of the run.
3. Any section in `running` → reset to `pending`; delete its `outFile` if it is under 200 bytes or does not
   parse (its agent died mid-write).
4. `failed` sections re-run only while `attempts < budget.sectionAttemptsMax`; otherwise they stay `failed` and
   land in `UNRESOLVED.md`.
5. Re-run the current wave's remaining `pending` sections, then continue forward through the phase table above,
   left to right from the first phase that is not `done`. Never jump backwards into a measurement phase.
6. If the live page has changed since capture (`target.bodyHash` differs), warn and stop rather than mixing old
   specs with a new page. `--refresh` re-runs `prewarm` → `responsive` against the live page and keeps
   everything downstream, resetting affected sections to `pending`.

`--refresh` without `--resume` is a full re-measure. `--pages 0` stops after `discover` and reports routes.

## Parallelism and batching

```
wave 0     orchestrator only: mirror assets, tokens, base CSS, @font-face, layout shell, _EXAMPLE, empty page
wave 1     shared chrome: header, footer, any hash-deduped shared component        (2–4 agents)
wave 2..n  body sections in document order, --max-parallel per wave               (default 6)
wave n+1   orchestrator: drain requests, wire the page, build
wave n+2   verify → repair waves (≤ K)
```

- **Default `--max-parallel 6`, clamped to `[1,10]`.** The ceiling is a review-throughput limit, not a
  technical one: above ~8 concurrent agents *your* context becomes the bottleneck, because you must read N
  reports and N gate tables.
- **No two sections with the same `contentHash` or `structureHash` in the same wave.** Dedup before scheduling
  (rules in `references/sectioning.md`), never after — one agent would redo the other's work.
- Above-the-fold sections (`box.y < 2 × viewport height`) go in wave 2 regardless of order, so a systemic
  failure surfaces on the first wave.
- **Verify per wave, not at the end.** Screenshot and diff a finished wave while the next one runs. A wrong
  container width found at wave 2 is one orchestrator edit; found at wave 6 it is N repairs.
- A wave completes when all its agents return. Update `run.json` on every individual transition anyway.

## Large pages

**24+ sections.** Warn once — "24+ sections at ~35k tokens each; consider `--sections 0-11` to do the top half
first" — then proceed. Do not gate. First check that the count is real: re-segment at `KEEP = 3.6`; 30
candidates usually collapse to 18–22 genuine sections. Then dedup by `structureHash` — repeated CTA bands, logo
strips, and alternating feature rows collapse further, and the archetype is built once and rendered N times
from a data array (wave 1 work, yours, not an agent's).

**Tall pages.** `fullPage: true` is one CDP capture of one surface; Skia cannot allocate an arbitrarily tall
bitmap (empirically ~16k device px in a dimension) and bytes grow with area. Above ~10 000 CSS px of
`scrollHeight`, or whenever a `fullPage` shot comes back blank, truncated, or absurdly large, stitch instead:

```
cdp:evaluate_script { function: "() => ({sh: document.documentElement.scrollHeight, vh: innerHeight})" }
cdp:resize_page     { width: <w>, height: 900 }
for i in 0 .. ceil(sh/900)-1:
  cdp:evaluate_script { function: "() => { scrollTo(0, <i*900>); return {y: scrollY}; }" }
  cdp:evaluate_script { function: "() => new Promise(r => requestAnimationFrame(() =>
                          setTimeout(() => r(scrollY), 350)))" }          # let reveals settle
  cdp:take_screenshot { format: "webp", quality: 88,
                        filePath: ".clone/screenshots/orig-w<w>-tile-<NN>.webp" }
```

Tiling has a second payoff: it fires the `IntersectionObserver` reveals a single `fullPage` capture can miss.
The inverse trick — `resize_page` to `{width: <w>, height: scrollHeight}` — forces every viewport-triggered
reveal at once, but it distorts `100vh`/`svh` sections and all `position: sticky` behaviour, so use it for
capture only, never for measurement.

## Multi-page runs

Route discovery, `pages.json`, cross-page dedup, `components.json`, and the shared-component promotion rules
all live in `references/sectioning.md`. What matters at this altitude:

- **Segment every selected page before building any of them.** Dedup needs the whole picture; building `home`
  first and then discovering that `pricing` reuses four of its sections means rewriting `home`'s imports.
- The entry page writes `.clone/{sections,motion,responsive}.json`. Every extra page writes
  `.clone/pages/<pageId>/` with byte-identical schemas and its own `raw/` and `sections/`. `pages/` is not
  created when `--pages 1`.
- Dedup is what makes multi-page affordable: 5 pages × 8 sections = 40 candidates typically collapse to ~22
  unique builds, so 5 pages cost ~2.2× a single page, not 5×.
- `--pages` interacts with `--max-parallel` per wave, not per page. One wave may mix sections from two pages;
  ownership is still one file per agent.

## Sequential fallback

`--max-parallel 1`, or no subagent capability at all: run the identical contracts in the main thread, one
section per turn — read `spec.json`, `content.md`, and the two captures, write the same single file, write the
same `report.md`. Same output, roughly 3× the wall time. `run.json` shape is unchanged, so a sequential run can
be resumed in parallel mode and vice versa.

## Never spend on

- Re-measuring the original on `--resume`.
- Re-screenshotting sections that passed. Repair iterations re-capture only the failing ones.
- Reading passing agents' reports.
- `cdp:take_snapshot` for measurement. `evaluate_script` returns exactly the fields you asked for; the a11y
  tree returns everything. Snapshots exist to harvest `uid`s for `click`, `hover`, and element screenshots.
- A fourth repair iteration on a plateaued section — thresholds and the plateau rule are in
  `references/assembly.md`. Write the row into `UNRESOLVED.md` and move on.
- Skipping the prewarm scroll to save two tool calls. It costs a whole repair iteration.

Capability limits — what this skill cannot reproduce well, and what to do instead — are in
`references/troubleshooting.md`. Surface them in `CLONE-REPORT.md` rather than burning budget against them.
