# Motion from source — recovering a hand-rolled motion system from its own bundle

`references/motion.md` M5b reads **builder** manifests (Framer, Webflow, Elementor). This file
covers the other case: a **custom build** whose motion lives in its own JS. Read it whenever
`motion.json.libraries[]` names GSAP, ScrollTrigger, Lenis, SplitType, Barba, Swiper or
Locomotive and no builder manifest was found — i.e. a bespoke site rather than a page builder.

**Why this outranks runtime introspection.** M5 tells you to dump
`gsap.globalTimeline.getChildren()` and `ScrollTrigger.getAll()`. That is real evidence, but it
only sees what exists *at the moment you look*:

- a `once: true` ScrollTrigger that already fired has **killed itself** — no tween, no trigger
- a timeline for a section still below the fold has often not been built yet
- `scrub` tweens report their current progress, not the authored from/to
- a threshold that lives in an `if (x > N)` branch is nowhere in any animation object

Their source has all of it, unconditionally. On a real run this recovered a scroll threshold
that had been guessed wrong by two orders of magnitude, four exact easing/duration pairs, and a
resize behaviour that no amount of screenshotting would have revealed.

## S1 — mirror the JS first, or none of this is possible

The asset mirror must include the site's **own** scripts and stylesheets. They are reference
material, not shippable dependencies: they live in `.clone/assets/{js,css}` and must be excluded
from the built output (`references/assets.md`). Mark third-party tags (`gtm`, `fbevents`,
analytics, chat) `optional` so they never fail the run, but take everything first-party.

```bash
ls -S .clone/assets/js/*.js | head            # biggest first: the app bundle is usually #1
for f in .clone/assets/js/*.js; do
  echo "$f: $(wc -l < "$f") lines, longest $(awk '{print length}' "$f" | sort -rn | head -1)"
done
```

A file with thousands of lines **and** a very long longest-line is a bundle that kept its
newlines — often because it shipped with `sourceURL` comments or an inline source map. Those are
readable. A single 400 KB line is fully minified: S3 still works, S2 mostly does not.

## S2 — find the author's own module boundaries

Modern bundlers leave breadcrumbs even in production builds. Try these in order and stop when
one hits:

| probe | what it gives you |
|---|---|
| `grep -o 'sourceURL=\[module\]' bundle.js \| wc -l` | webpack dev-ish build: module comments survive |
| `grep -o '\.\/src\/[a-z/]*\.js' bundle.js \| sort -u` | the author's actual file tree |
| `grep -oE 'var (init[A-Z]\w+) = function' bundle.js \| sort -u` | their init functions, i.e. the whole motion surface |
| `grep -o 'sourceMappingURL=data:application/json[^"]\{0,40\}' bundle.js` | an inline source map — decode it for original sources |
| `ls .clone/assets/js/*.map` or fetch `<bundle>.map` | a real source map: best case, you get the originals |

Recovering a module list turns an opaque 3 MB file into a checklist. One real run yielded 17
`initX()` functions over 19 modules (`lenis, inview, parallax, splitType, swiper, barba,
loader, navigation, cookieBanner, services, team, …`), each of which is one grep away.

Then read each motion module's config by extracting a window around its name — a few hundred
characters after the declaration is usually the entire options object.

## S3 — what to extract, and where it goes

Work through this list; every row is a value that is otherwise guessed. Put each in
`motion.json` under `source` with the byte offset as `evidence`.

| # | look for | why it matters | goes to |
|---|---|---|---|
| 1 | the smooth-scroll constructor's options (`new Lenis({…})`, `new LocomotiveScroll({…})`) | `lerp`/`duration`/`easing`/`anchors` are JS-only and invisible in CSS | `motion.json.source.smoothScroll` |
| 2 | how the scroll library is driven (`gsap.ticker.add`, `lagSmoothing`, `ScrollTrigger.update`) | wiring it differently desynchronises every scrub | same |
| 3 | **any `> N` scroll threshold** that sets a class or data attribute on `html`/`body` | this is the reveal trigger for sticky bars and header states. It is a *number in a branch* and appears in no animation object | `motion.json.source.scrollFlags[]` |
| 4 | the reveal type map (a `switch` on an attribute value) | duration, stagger, ease **per reveal kind**, exactly | `motion.json.source.revealTypes[]` |
| 5 | the trigger defaults (`start: "top 60%"`, `once`, `invalidateOnRefresh`) | decides *when* content appears | same |
| 6 | the parallax rule (`fromTo(el, {y,scale}, {y, scrollTrigger:{scrub}})`) | one rule usually covers the whole site; the from-values are the below-fold **rest state** | `motion.json.source.parallax` |
| 7 | text-splitting selectors and the wrapper class it injects | which elements get `.line`/`.char`, and the mask element you must reproduce | `motion.json.source.split` |
| 8 | **the resize handler** | see S5. Frequently the single most surprising behaviour on the page | `motion.json.source.onResize` |
| 9 | slider configs keyed by attribute value | `breakpoints`, `loop`, `centeredSlides`, `speed` exist nowhere in CSS | `motion.json.source.sliders[]` |
| 10 | the page-transition init and its per-route re-init list | what must re-arm on navigation, and any per-route theme attribute | `motion.json.source.pageTransitions` |
| 11 | the loader/preloader timeline | never visible in a settled capture, so it is otherwise missed entirely | `motion.json.source.loader` |

## S4 — the CSS half is half the system

A reveal is almost always **CSS sets the from-state, JS animates to the end-state**. Grep the
authored stylesheet for the classes the JS injects:

```bash
grep -oE '\.(line|char|word|split[a-z-]*|[a-z-]*mask)\s*\{[^}]*\}' .clone/assets/css/*.css
grep -oE '\[data-[a-z-]+\][^{]*\{[^}]*\}'                          .clone/assets/css/*.css
```

Two patterns to expect, both of which are invisible if you only read the JS:

- **the from-state**: `.line { transform: translateY(110%) }`. The JS only ever animates *to*
  `y: 0`, so without this rule nothing moves and the reveal looks broken.
- **the opacity gate**: `[data-anim] { opacity: 0 }` plus
  `[data-anim-trigger="ready"] [data-anim] { opacity: 1 }`, where JS stamps `ready` at init.
  Reproduce the mechanism, but note it means **the origin's animated content is invisible with
  JS disabled**. Prefer a `<noscript>` override in the clone and record it as a deliberate
  deviation — do not silently ship a page that is blank without JS.

## S5 — copy the behaviour, not the intent

The rule that costs the most to learn empirically. When their handler does something that looks
*wrong* or incomplete, reproduce it exactly anyway.

Real case: a debounced resize handler `revert()`ed every text split and **did not rebuild them**.
So after any viewport change that site has no line masks at all until the next navigation.
The "obviously correct" implementation reverts and rebuilds — and that clone then had masks at
widths where the origin had none, whose collapsed padding showed up as **+14 to +63 px of
section height** at 1024 and 390, failing three sections that had been passing.

The same asymmetry explains a measurement mystery worth knowing about in advance: because the
harness resizes the viewport between load and capture, **the origin's own narrow-width captures
contained no masks**. A clone that faithfully reproduces revert-only behaviour matches that for
free. One that "fixes" it cannot.

Corollary for verification: when a capture of the *original* looks wrong, suspect the harness
interacting with their JS before suspecting your own measurement.

## S6 — harvest the declarative attributes, then apply them

Custom motion systems are attribute-driven, and the attribute names are theirs, not a library's.
Once S3 has told you which attributes matter, harvest them **per section** with
`scripts/extract-motion-attrs.js` (install like any payload, then one call per section set) and
write the result to `.clone/raw/motion-attrs.json`.

That file is the bridge from analysis to code: it says *this element, in this section, carries
`data-anim="heading" data-anim-delay="0.1" data-split-lines`*. Copy those attributes onto the
matching element in the clone and a single shared runtime animates them — which is how the
origin is built, and it keeps section components declarative instead of each one hand-rolling
its own motion.

Feed the per-section slice into each section agent's `spec.json` as `motion.attrs[]`
(`references/agent-brief.md`), so an agent declares motion rather than inventing it.

## S7 — two traps that produce confidently wrong rebuilds

**`IntersectionObserver` may be entirely absent.** On a GSAP site the reveals are ScrollTrigger
timelines. One real bundle contained exactly **two** references to `IntersectionObserver` in
3 MB — both incidental. Inferring IO from behaviour and picking your own thresholds produces
reveals that fire at visibly the wrong moment. Check before assuming:
`grep -c IntersectionObserver bundle.js` against `grep -c ScrollTrigger bundle.js`.

**A measured offset is not necessarily an initial index.** A looped, centred slider reports its
first slide at a large negative x because the library has **cloned slides and shifted the
track** — not because it opened on slide 4. Reproducing the pixel offset with an initial index
gets the right screenshot for the wrong reason and then diverges the moment anyone interacts.
Read the slider's config (row 9) instead of inferring intent from geometry.

## Gate

Before leaving this file, `motion.json.source` should exist with at least: the smooth-scroll
options, every scroll threshold and the attribute it sets, the reveal type map with per-type
duration/stagger/ease, the parallax rule, the split selectors and injected wrapper class, the
resize behaviour, and every slider config. Anything you could not find gets an explicit
`"notFound"` entry naming what you grepped for — so the next pass does not re-spend on it, and
so a rebuild that had to guess is labelled `authored-not-verified` rather than presented as
measured.
