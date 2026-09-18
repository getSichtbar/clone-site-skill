# Breakpoints, the viewport sweep, and solving fluid values

Output: `.clone/responsive.json` (schema `clone-site/responsive@1`) plus raw dumps
`.clone/raw/breakpoints.json`, `probes.json`, `vp-<w>.json`, `overflow-<w>.json`, `dev-<w>.json`, `drawer.json`.
`cdp:` = `mcp__plugin_chrome-devtools-mcp_chrome-devtools__`.

Two facts drive everything here. **Breakpoints are read, never guessed** — Tailwind sites show
`640/768/1024/1280/1536`, Bootstrap shows `576/768/992/1200/1400`, bespoke systems show whatever they show.
And **`getComputedStyle` returns resolved values**, so `clamp()`, `vw`, and `cqi` arrive already collapsed to
px; the authored function has to be solved from several samples or read out of the CSSOM.

## R1 — breakpoint discovery from the CSSOM

Read `scripts/probe-responsive.js` with `Read` and pass its **entire contents** as the `function` argument to
`mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script`, with `filePath` set to the run-directory
target for that pass (`.clone/raw/<pass>.json`). Never inline the payload into this reference; never call it
without `filePath`.

That installs `window.__clone.responsive`. Then:

| # | Pass | `function` argument | `filePath` |
|---|---|---|---|
| 1 | breakpoints | `() => window.__clone.responsive.breakpoints()` | `.clone/raw/breakpoints.json` |
| 2 | probes (at the primary width) | `() => window.__clone.responsive.probes()` | `.clone/raw/probes.json` |
| 3 | measure, once per viewport | `() => window.__clone.responsive.measure('resize')` | `.clone/raw/vp-<w>.json` |
| 4 | overflow, once per viewport | `() => window.__clone.responsive.overflow()` | `.clone/raw/overflow-<w>.json` |
| 5 | drawer | `() => window.__clone.responsive.drawer('<toggle>','<panel>',400)` | `.clone/raw/drawer.json` |
| 6 | fluid solve | `() => window.__clone.responsive.fitFluid([[320,32],[768,55]])` | inline, small |

`breakpoints()` caches the media-query list on `window.__clone.state.mqList` and `probes()` caches the probe
selectors on `window.__clone.state.probes`; `measure()` reads both from there. Do not try to pass them
through `args` — `args` resolves element uids only, never JSON. Re-install after any `cdp:navigate_page`;
install order relative to `scripts/extract-foundation.js` does not matter.

Three correctness details the payload handles and you must not undo:

- **`rem`/`em` inside a media query are always relative to the *initial* font size, 16px** — never to the
  document's `font-size`. A site with `html{font-size:62.5%}` still has `@media (min-width:48rem)` = 768px.
  Inside ordinary declarations `rem` uses the real root font size. Two different divisors; mixing them puts
  every breakpoint 37.5% off.
- **Modern range syntax counts.** `(width >= 48rem)` and `(400px <= width < 900px)` are parsed alongside
  `min-width`/`max-width`, with the operator flipped for the left-hand form.
- **`max-width` boundaries are exclusive-ish.** `(max-width: 767.98px)` pairs with `(min-width: 768px)`.
  Measure at both `bp` and `bp − 1` to learn which side each rule falls on.

The shape to expect, from `breakpoints().breakpointSystem` on a builder-generated site — nothing like
768/1024, and every `min-width` has a `.98px` `max-width` partner:

```jsonc
{ "unit":"px", "boundaries":[809,1200,1440], "source":"cssom.weighted", "convention":"mixed",
  "raw":[ {"px":1200,   "op":">=","count":41,"weight":612,"conditions":["(min-width: 1200px)"]},
          {"px":1199.98,"op":"<=","count":38,"weight":540,"conditions":["(max-width: 1199.98px)"]},
          {"px":809,    "op":">=","count":38,"weight":540,"conditions":["(min-width: 809px) and (max-width: 1199.98px)"]},
          {"px":808.98, "op":"<=","count":22,"weight":190,"conditions":["(max-width: 808.98px)"]},
          {"px":1440,   "op":">=","count":6, "weight":31, "conditions":["(min-width: 1440px)"]} ] }
```

**A builder's own breakpoint manifest outranks the CSSOM.** Framer ships one as
`script#__framer__breakpoints`, Swiper as `swiper.params.breakpoints`, Elementor as
`elementorFrontendConfig.responsive.breakpoints` — authored numbers rather than their compiled output.
Extraction code and the full builder table live in `references/motion.md` §M5b; when you use one, set
`breakpointSystem.source` to `builder-manifest` and keep the CSSOM values as the cross-check.

`breakpointSystem.raw` is ranked by **weight** = how many rules hang off each boundary. A boundary with 400
rules is a design decision; one with 2 rules is a spot fix. `boundaries[]` keeps only weight ≥ 3, and
`convention` is derived from the min/max weight balance. `nonSizeFeatures` matters as much as widths:

| Feature found | Consequence |
|---|---|
| `hover` / `any-hover` | hover styles are gated. Reproduce the gate or mobile gets stuck hover states. |
| `pointer` / `any-pointer` | hit-target sizing differs by input; needs `cdp:emulate` with `,touch` to verify. |
| `prefers-color-scheme` | a second full token set. Re-run the foundation pass under `cdp:emulate({colorScheme:"dark"})`. |
| `prefers-reduced-motion` | handled in `references/motion.md`. |
| `orientation` / `aspect-ratio` | sweep height too; add a 844×390 landscape probe. |
| `min-resolution`, `-webkit-min-device-pixel-ratio` | 2× art direction, reachable **only** via `cdp:emulate` with an explicit DPR. `cdp:resize_page` cannot trigger it. |
| `forced-colors`, `display-mode`, `scripting` | carry the rules verbatim; cheap. |

## R2 — the viewport plan, and emulate vs resize

`breakpoints().plan` proposes the widths: `390/768/1280/1440/1920` plus `bp` and `bp∓1` for the eight
heaviest boundaries, clamped to 280–2560. Record it as `responsive.json.plan[]` with a `reason` per row and
cap it at 10–14 entries — cost is linear (one resize + two evaluates each) but the delta table becomes
unreadable past that. `--profile` sets the real cap (`references/scaling.md`).

| Width | Why it earns a row |
|---|---|
| 320 | smallest realistic; catches overflow and unbreakable headings |
| 390 | phone baseline; **also verify with real emulation** |
| `bp` and `bp−1` for the top boundaries | proves which side of each boundary each rule lands on |
| 768 / 1024 | tablet portrait and landscape; the most common single point of failure |
| 1280 / 1440 | laptop and the width most designs were drawn at |
| 1920 / 2560 | proves the max-width cap, and catches unclamped `vw` type that explodes |

Sweep **ascending** and reset scroll to 0 before each measurement — `measure()` does the reset, but
smooth-scroll libraries can keep a stale transform after a resize, and a mid-page scroll position changes
which reveals have fired.

`cdp:resize_page({width, height})` resizes the real window so the content box matches. No DPR override, no
reload, no mobile flags — correct for geometry. `cdp:emulate({viewport:"390x844x3,mobile,touch"})` issues a
full device-metrics override.

| Concern | `resize_page` | `emulate("390x844x3,mobile,touch")` |
|---|---|---|
| DPR | the host's | exactly what you set — **`srcset` picks a different file** |
| `hover` / `pointer` | always `hover`/`fine` | `,touch` ⇒ `none`/`coarse`; the whole hover layer disappears |
| meta viewport | ignored; layout viewport == window | honoured; layout vs visual viewport split becomes real |
| classic scrollbar | present, steals ~15px | overlay in mobile mode, 0px |
| `svh`/`lvh`/`dvh` | all equal `vh` | distinct |
| side effects | none | resets every omitted option, and **can trigger a reload** |

Protocol: sweep every width with `resize_page`, then re-verify exactly two sizes with `emulate`, restating the
whole emulation state in each call because omitted options are reset:

```
cdp:emulate  viewport: "390x844x3,mobile,touch"
             userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
cdp:evaluate_script  function: () => window.__clone.responsive.measure('emulate')   filePath: .clone/raw/dev-390.json
cdp:emulate  viewport: "768x1024x2,mobile,touch"
cdp:evaluate_script  function: () => window.__clone.responsive.measure('emulate')   filePath: .clone/raw/dev-768.json
cdp:emulate  viewport: "1440x900x1"
```

Because `emulate` may reload, re-check `window.__clone.v` after each one and re-install the payload if it is
gone. Record every emulated size in `responsive.json.verifiedWithEmulation[]`, and diff the emulated file
against the `resize_page` file at the same width — the three differences that show up most are a different
`currentSrc`, a missing hover layer, and `dvh` ≠ `vh`.

**The scrollbar trap, concretely.** `measure()` records `vw100` (a `width:100vw` probe), `clientWidth`, and
`scrollbar = vw100 − clientWidth`. On classic-scrollbar Chrome, `resize_page({width:768})` typically yields
`innerWidth: 768`, `clientWidth: 753`, `scrollbar: 15`. Whether `@media (min-width: 768px)` is firing at that
moment is answered by the `mq` truth table in the same file — **use `mq`, never arithmetic**. To land cleanly
inside a branch, resize to `bp + scrollbar + 1`.

## R3 — the per-viewport loop

`probes()` derives 60–120 selectors, capped at 120: the structural spine (`body > *`, landmarks, `dialog`),
every grid/flex container wider than 200px with more than one child, every sticky/fixed element, every
`container-type` element, then typographic and interactive roles. More probes is not better — the delta table
becomes unreadable and each `vp-<w>.json` grows past cheap-to-diff. Emit them as
`responsive.json.probes[{selector, why}]`.

Per viewport, exactly three calls:

```
cdp:resize_page      width: 1440   height: 900
cdp:evaluate_script  function: () => window.__clone.responsive.measure('resize')   filePath: .clone/raw/vp-1440.json
cdp:evaluate_script  function: () => window.__clone.responsive.overflow()          filePath: .clone/raw/overflow-1440.json
```

`measure()` awaits `document.fonts.ready` first — a resize measured before fonts load gives you fallback-font
metrics — then four frames, scroll to 0, two more frames. Per element it records `rendered`, `rect`, ~60
computed properties, `contentBox`, `visibleChildren`, `rows`/`perRow` (children bucketed into 8px bands, so
wrap changes are visible), `overflowX`, `clipped`, `media.currentSrc`, `visualOrder`, and a text head.
Per document it records `vp` (including `dvh`/`svh`/`lvh`, `scrollbar`, `dpr`, `rootFontSize`, `docOverflowX`)
and the full `mq` truth table.

Every per-viewport artifact is keyed by integer width as a string: `vp-1440.json`, `"1440"`. Never
`desktop`/`mobile`.

## R4 — the delta table

Diff happens outside the browser, over the `vp-*.json` set, ascending. **Emit only what changes.** A row
identical at every width is foundation, not responsive spec, and belongs in `foundation.json`. Each row
becomes one `responsive.json.deltas[]` entry: `{path, prop, values:{"<w>":…}, kind, severity, fluid}`.

`kind` is closed: `numeric` (all values `<n>px` → run `fitFluid`), `discrete`, `existence` (`rendered`
changed), `wrap` (`rows` changed), `reorder` (`visualOrder` changed), `overflow` (`overflowX` > 1), `asset`
(`currentSrc` changed). `severity`: `critical` for overflow, `high` for `display`, `flex-direction`,
`grid-template-columns`, `grid-template-areas`, `order`, `position`, `grid-auto-flow`, existence, wrap,
reorder and asset rows, `normal` otherwise. Also emit `mqTruth[]` for every query whose `on` value differs
across widths — that is the authoritative breakpoint mapping.

The per-section markdown handed to an agent, only changing rows:

```md
### 03-features  (`main > section.features`)

| property | 320 | 390 | 767 | 768 | 1024 | 1440 | 1920 | solved |
|---|---|---|---|---|---|---|---|---|
| grid-template-columns | 1fr | 1fr | 1fr | 1fr | 1.2fr 1fr | 1.2fr 1fr | 1.2fr 1fr | switches at 768→1024 |
| padding-top | 48px | 48px | 48px | 64px | 96px | 96px | 96px | stepped, not fluid |
| font-size (h2) | 32px | 36.4px | 71.9px | 72px | 80px | 88px | 88px | `clamp(2rem, 0.98rem + 5.12vw, 5.5rem)` |
| «wrapRows» | 3 | 3 | 3 | 2 | 1 | 1 | 1 | wraps below 1024 |
| «currentSrc» | shot-800.webp | shot-800.webp | shot-1200.webp | shot-1200.webp | shot-2000.webp | … | | mirror all 3 |
| «rendered» .features__dots | yes | yes | yes | display:none | display:none | display:none | display:none | mobile-only |
```

## R5 — solving `clamp()` and `vw`

A fluid value is authored as `clamp(MIN, P + A·vw, MAX)`. In the unclamped middle, `v(w) = P + (A/100)·w`,
which is affine in the viewport width, so two interior samples recover it exactly:

```
A = 100 · (v₂ − v₁) / (w₂ − w₁)     the vw coefficient   → responsive.json …fluid.bVw
P = v₁ − A·w₁/100                    the constant term, px → responsive.json …fluid.aPx
```

Convert `P` to rem with the **document** root font size (`vp.rootFontSize`), not the 16px used for media
queries. Verify with a third sample: if `|v₃ − (P + A·w₃/100)| > 0.5px` it is not one fluid function — it is
stepped at a breakpoint, container-relative, or a nested `min()`/`max()`.

`MIN` and `MAX` are read off the flat head and tail: below the low crossover the value stops changing, and
likewise above the high one. That is why you need **at least 4 samples spanning 320→2560**. With interior
samples only you recover the slope and *invent* the bounds — which is what `minIsObservedOnly` /
`maxIsObservedOnly` exist to admit.

`fitFluid(samples, rootFontSize?)` does all of it. Interpolate the sample table into the call source (it
accepts `[[w,v],…]` or `[{w,v},…]`) and read back `kind` (`fixed` | `linear` | `clamp` | `stepped`), `minPx`,
`maxPx`, `aPx`, `bVw`, `aRem`, `r2`, `points`, `railedLow`, `railedHigh`, `minIsObservedOnly`,
`maxIsObservedOnly`, `css`, `cssRem`, and `steps` when stepped. A segment counts as flat at under 10% of the
steepest segment's slope, so a noisy tail does not get mistaken for a step. `references/extraction.md` calls
the same solver for `foundation.json.type.fluid`.

Worked example — samples `(320,32) (768,55.0) (1440,89.4) (1920,88) (2560,88)`:

```
segment slopes  320→768 0.05134   768→1440 0.05119   1440→1920 −0.0029   1920→2560 0
                the last two are <10% of 0.05134 ⇒ flat ⇒ railedHigh = 2, railedLow = 0
A = 0.051245 × 100 = 5.1245vw
P = 55.0 − 0.051245 × 768 = 15.62px = 0.9761rem
MAX = 88px = 5.5rem (confirmed by the flat tail);  MIN = 32px = 2rem but minIsObservedOnly: true
⇒ clamp(2rem, 0.9761rem + 5.1245vw, 5.5rem)
```

Add a 280px sample to confirm the min. If `v(280)` is still on the line, say so in the spec instead of
fabricating a bound.

**Container query units.** If `fitFluid` returns `stepped` for an element inside a
`container-type: inline-size` ancestor, re-fit against the **container's** measured width — `measure()`
already recorded `contentBox.w` per probe at every viewport. A clean linear fit against container width and a
messy one against viewport width is a positive identification of `cqi`/`cqw`: emit `Xcqi` and keep the
`container-type` declaration on the ancestor. Record it in `responsive.json.containerQueries[]`.

**Height-relative values.** Same algebra with `w` replaced by viewport height, sampled at two heights at one
width. Necessary for `min-height: clamp(…, 60svh, …)` heroes. Which of `vh`/`svh`/`lvh`/`dvh` matches can only
be discriminated under mobile emulation — on desktop they are all equal.

## R6 — element swaps, duplicate trees, reorder, wrap

The single most common clone miss: **the desktop nav and the mobile nav are two different DOM subtrees**,
both in the markup, each `display:none` at the other's breakpoints. A screenshot cloner sees one and builds
one nav that can never become the other. Classify from the `vp-*.json` set:

| Signal across widths | Classification | Instruction to the section agent |
|---|---|---|
| `rendered` `display:none` below X, `yes` at/above | desktop-only element | one component, hidden below the exact boundary X. Record in `breakpointOnly[]`. |
| `rendered` `yes` below X, `display:none` at/above | mobile-only element | same, inverted |
| `present:false` at some widths, `true` at others | **the subtree is not in that DOM** — a different variant was rendered | not a probe failure. Record `existsAt`/`hiddenAt` in `breakpointOnly[]` with `note:"DOM-variant swap"` |
| two probes with identical link sets and **disjoint** `rendered` sets | duplicate nav tree | one data source, two presentations — never two hard-coded copies. Note which twin owns the a11y semantics (check `aria-hidden` on the hidden one). |
| two probes with identical text and **overlapping** `rendered` sets | duplicated content in the original | mirror verbatim, flag once |
| `visualOrder` changes | reorder | read the actual `order` / `grid-template-areas` / `flex-direction` value from the same viewport's delta rows; never infer it. Record in `reorder[]`. |
| `rows` changes with no `grid-template-columns` change | intrinsic wrapping | `flex-wrap` or `repeat(auto-fit, minmax(Npx, 1fr))` |
| `overflowX` > 1 at some width | overflow **in the original** | reproduce only if intentional (a snap scroller); otherwise fix and note. `overflow-x: hidden` on an ancestor is the original's own patch and is part of the spec. |
| `position` `static` → `sticky`/`fixed` at a boundary | breakpoint-conditional pinning | carry `top`, `z-index`, `backdrop-filter` from the same viewport |
| `min-height` tracks `svh`/`dvh` only under emulation | dynamic viewport unit | pick the matching unit; `100vh` on mobile is a bug the original may or may not have |

Builders regenerate the tree per breakpoint, not just restyle it: Framer and Webflow can emit an `h1` in a
desktop subtree and a separate mobile subtree carrying its own heading, so a probe path that resolved at 1440
legitimately comes back `present:false` at 390 with nothing broken. Distinguish the two failure shapes —
`{sel, error:"bad-selector"}` is a syntax problem, `present:false` is an absent node. When more than ~30% of
probes go `present:false` at one width, re-run `probes()` **at that width**, keep both selector sets, record
the pair in `responsive.json.warnings[]` as a DOM-variant swap, and hand the section agent both trees with
one component instruction. Never conclude that the sweep failed.

Solving `minmax(N, 1fr)` from the wrap points: if `perRow` is 4 at 1280 and 3 at 1024 for a container whose
content box is `W`, then `4N + 3g ≤ W₁₂₈₀` and `4N + 3g > W₁₀₂₄` with the measured `gap` as `g`. That brackets
`N` narrowly — pick the round number inside the bracket, because designers use 280 and 300, not 271.4.

## R7 — mobile drawer

The highest-value interaction on any clone, and invisible to every static capture. At 390 width:

```
cdp:resize_page      width: 390   height: 844
cdp:evaluate_script  function: () => window.__clone.responsive.drawer()          → toggle + panel candidates
cdp:evaluate_script  function: () => window.__clone.responsive.drawer('<toggle>','<panel>',0)     closed baseline
cdp:take_snapshot    filePath: .clone/raw/snapshot-drawer.txt                    → the toggle uid
cdp:click            uid: "<uid>"
cdp:evaluate_script  function: () => window.__clone.responsive.drawer('<toggle>','<panel>',0)     mid-transition
cdp:evaluate_script  function: () => window.__clone.responsive.drawer('<toggle>','<panel>',400)   filePath: .clone/raw/drawer.json
cdp:click            uid: "<uid>"                                                confirm it fully reverses
```

The mid-transition read is the point of the sequence: its `anims[].keyframes` give the browser's real from/to
pair. The settled read gives the resting open state. A drawer that does not fully reverse has separate
open and close animations — capture both.

What the agent needs out of `drawer.json`: the open mechanism (`translateX(0)` from `translateX(100%)` vs a
`clip-path` reveal vs a height animation), duration and easing per property, the backdrop's
`background-color` + `backdrop-filter`, the exact scroll-lock technique (`scrollLock` — the body-overflow and
body-fixed variants behave differently on iOS), whether the panel is a `<dialog>` or `[popover]` (which
changes the implementation and needs `@starting-style` + `transition-behavior: allow-discrete`), the
`aria-expanded`/`aria-controls` wiring, and whether focus moves into the panel (`focus.inPanel`).

## R8 — responsive assets

The verbatim-mirror policy means one asset per slot becomes N. `measure().media.currentSrc` per viewport,
unioned across the sweep, gives the set the browser actually chose; every `srcset` candidate, every
`<source>`, every media-query `background-image`, and every 2× and 3× DPR variant also goes into the mirror
list. Emit `responsive.json.assets[{target, variants:{"<w>":…}, srcset, sizes}]` and reproduce the
`srcset`/`sizes` pair verbatim. Run
`cdp:list_network_requests({resourceTypes:["image","media","font"], includePreservedRequests:true})` after the
last viewport to catch files only fetched at one size; downloading is `references/assets.md`.

Art-direction check: if `<source media>` values do not match any discovered breakpoint, the images have their
own breakpoint system. Record both and reproduce both.

## R9 — merging into `responsive.json`

Fill `breakpointSystem`, `metaViewport`, `plan`, `mqTruth`, `probes`, `containerQueries`, `containerElements`,
`deltas`, `breakpointOnly`, `reorder`, `drawer`, `assets`, `overflow`, `verifiedWithEmulation`, then split per section into
`bySection.<sectionId>` using each section's `box` from `.clone/sections.json`. Each section slice carries
`layout[{property, byViewport, solved, evidence}]`, `fluid[{target, property, samples, solved, fit}]`,
`breakpointOnly`, `reorder`, `assets`, `overflowRisks`, `verifiedWithEmulation`, `gaps`. `evidence` is a raw
file plus json path, e.g. `vp-*.json#els[.features__grid].st`. Anything unmeasured goes in `gaps[]`, not in a
`solved` string. Pass and tolerance numbers for the responsive gates live in `references/assembly.md`.

Two top-level fields are easy to drop on the floor because nothing downstream crashes without them:

| Field | Source | Consumer |
|---|---|---|
| `metaViewport` | `breakpoints().metaViewport` — the original's `meta[name=viewport]` `content` string, or `null` when the page has none | `references/foundation.md` §5 emits it into the shell verbatim (default `width=device-width, initial-scale=1` when `null`) and gates it in §8. Measured but unemitted, it is invisible: every capture runs under `resize_page`/`emulate`, which override device metrics and never read the tag |
| `containerElements` | the payload's second container array | the join key for `containerQueries` (below) and the `container-type` declaration the clone must keep |

**`containerQueries` and `containerElements` are two arrays and you need both.** The payload emits the *queries*
without an element path and the *elements* without their queries:

```jsonc
"containerQueries":  [{ "name": "card", "query": "(min-width: 300px)", "atoms": [{}], "ruleCount": 1 }],
"containerElements": [{ "path": "main > section.features .card", "type": "inline-size", "name": "card", "width": 362 }]
```

Copy both through verbatim, then join for the section slice: group `containerQueries` by `name` and match the
`containerElements` row with the same `name`; that row's `path` is the container selector and its `type` is the
`container-type` to re-author. Unnamed containers carry `name: null` on both sides, so there is no join key —
fall back to the single `container-type` ancestor of the affected probe (`R5`, container-query units), and when
more than one candidate ancestor exists emit a `gaps[]` row instead of guessing. A container query reproduced
against the viewport instead of the container is a bug that only appears when the component is reused at another
width.
