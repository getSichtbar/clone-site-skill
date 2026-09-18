# clone-site

A Claude Code skill that rebuilds a target URL **in real code**, from measurements taken off the
running page — computed styles, CSSOM rules and keyframes, `document.fonts`,
`getBoundingClientRect`, `getAnimations()`, the network log.

**The one rule that makes it work: every number written into the clone was measured off the live
page.** Screenshots are for human judgement and for giving each section agent a visual target —
never for deriving a colour, a gap, or a font size.

## Install

```bash
git clone https://github.com/getSichtbar/clone-site-skill ~/.claude/skills/clone-site
```

Then in Claude Code:

```
/clone-site https://example.com --thorough
```

To reproduce only one live section as an importable component and preview page:

```bash
/clone-site https://example.com --section 'css:#pricing'
```

Requires Chrome (the skill drives it over CDP) and Node 18+. If Chrome DevTools MCP cannot
launch, `references/troubleshooting.md` covers the fallbacks.

## What it does

```
measure → mirror assets → emit tokens → cut into sections → fan out agents → verify → repair
```

- **Measures** the foundation: palette clustered by painted area, type scale by character
  weight, spacing base unit, breakpoints, container widths, the fluid `clamp()` rails
- **Mirrors** every required asset byte-for-byte with sha256 provenance — no remote URL survives into
  the build, no font CDN request; scoped runs retain only the selected section's runtime assets
- **Cuts** the page into sections on six independent boundary signals, dedupes by content and
  structure hash, then builds them with a parallel team of section agents that each own exactly
  one file
- **Verifies** against the original per section per width: pixel diff, perceptual hash, worst
  tile, geometry probes, text fidelity, token drift, overflow sweep, console and HTTP errors
- **Repairs** in a bounded loop, and writes whatever it could not close into `UNRESOLVED.md`
  with its numbers rather than claiming a gate it did not measure

Output stacks: Next App Router + Tailwind v4 (default), Vite/Astro/SvelteKit/Nuxt/Remix by
detection, or framework-agnostic `--static`.

## Single-section mode

`--section` is a scoped workflow, not a page clone with most sections omitted. It accepts one of:

- `css:<selector>`, such as `css:#pricing` or `css:[data-section="hero"]`
- `id:<NN-slug>`, such as `id:03-features`
- `role:header`, `role:footer`, `role:nav`, `role:section`, or `role:sticky-cta`
- A unique generated label or slug after the skill has produced a primary-width manifest

The selector must identify exactly one visible live element. Ambiguous targets produce `.clone/SELECTION.md` with
candidate ids and selectors instead of silently cloning the wrong sibling.

The scoped run uses targeted prewarming, mirrors only the selected subtree's runtime assets plus necessary fonts and
style/motion source material, and creates one component plus a minimal preview shell. Measured ancestor styles such
as page background or padding are retained as preview context, but ancestor content, navigation, and page-level
overlays are not copied. Verification runs all section-level gates and marks full-page-only checks as
not applicable; a successful scoped run reports `verify.outcome: "scoped"`, not page-wide verified fidelity.

## What's new in 1.1

Motion. The skill already captured motion **from the browser** (CSSOM keyframes, transitions,
`getAnimations()`, WAAPI hooks, builder manifests). 1.1 adds capture **from source**, which is
where a bespoke site actually keeps its configuration:

- **`references/motion-source.md`** — recover a hand-rolled motion system from its own bundle.
  Runtime introspection cannot see a `once:true` trigger that already fired, a timeline for a
  section still below the fold, or a threshold living in an `if (scroll > N)` branch. The source
  can. Eleven things to extract, each otherwise guessed.
- **`scripts/extract-motion-attrs.js`** — harvests the site's own declarative motion vocabulary.
  It *discovers* the attribute names rather than hard-coding a library's, so a custom
  `data-anim` / `data-parallax` / `data-speed-full` system is captured as a spec that section
  agents can declare instead of inventing.
- **`assembly.md` §4b — capture determinism.** A `<video>` frame and a marquee phase are
  functions of elapsed time, so two page loads never agree on them. Freezing them identically on
  both sides took one section from 0.943 to 0.018.
- **`assembly.md` §5b — five ways a gate lies**, with what to gate instead. Two of the fixes make
  the suite *stricter*; the height gate found a real defect that a 0.0000 pixel diff had hidden.
- First-party JS and CSS are now mirrored at every profile, as reference material. An unminified
  stylesheet gives you authored declarations instead of computed values.

Two rules earned the hard way, both now written down:

> **Copy the behaviour, not the intent.** A resize handler that reverts text splits and does not
> rebuild them looks like a bug. Reproduce it anyway — "fixing" it added up to 63px of section
> height and failed three passing sections.

> **`IntersectionObserver` may be entirely absent.** On a GSAP site the reveals are ScrollTrigger
> timelines. Inferring IO from behaviour makes every reveal fire at visibly the wrong moment.

## Apps, not just sites (1.2)

`references/flows.md` + `scripts/extract-flow.js` handle a target that is an **application**:
behind a login, inside an iframe, and valuable for its flows rather than its landing page.

- **auth** is the operator's job: a persistent profile you log into once by hand. No credential
  ever enters a script, a flag or a prompt, and the profile is always gitignored.
- **iframes**: an embedded app is not the top document. Enumerate frames, measure the right one,
  label coordinates frame-relative.
- **discovery** proposes flows from the page (forms with their required-field counts, wizards with
  a real step signal, empty states, overlay triggers) instead of making you author step lists blind.
- **a state, not a screenshot**: every field's `required`/`pattern`/`autocomplete`/`aria-describedby`
  and the browser's own `validity` verdict — the validation *contract*, which no screenshot contains.
- **the states everyone forgets**: empty, validation, loading, error, resume-after-reload, and
  destructive-stopped-at-confirmation.
- **`diff(a, b)`** describes the transition — fields gained/lost, what was announced to a screen
  reader, whether the primary action became enabled, where focus went.

Default deliverable for an app is a **flow map**, not a stylesheet. If the target is built on a
design system (Polaris, MUI, shadcn, Carbon), import it rather than reproducing its computed
styles — §F0 makes that argument properly.

Nothing stores request or response **bodies**, and password/secret-shaped field values are
redacted: on an authenticated app those are tenant data.

## Layout

| path | contents |
|---|---|
| `SKILL.md` | the pipeline: steps 0→5, flags, profiles, gates, hard rules |
| `references/` | 12 files, one per phase — read at the point of use, not up front |
| `scripts/` | installer payloads evaluated in the page, plus the asset mirror and the differ |

## A note on what it produces

A faithful clone reproduces third-party text, marks and imagery byte-for-byte. Everything
mirrored is listed in `.clone/PROVENANCE.md` with its source URL and hash. Whether to keep or
replace that material before publishing anywhere is the operator's decision, and the skill says
so rather than deciding for you.

MIT.

## Interaction fidelity

Unspecified profiles promote to `thorough` when the original has looping/autoplay carousels, scroll-linked state, or coordinated animations. Explicit scope and profile choices remain respected. Every discovered in-scope interaction needs an original/clone comparison covering applicable transitions, resets, and boundaries; the ledger and workflow are in [references/interactions.md](references/interactions.md).

`phase: done` ends a run. `verify.outcome` separately reports `verified`, `incomplete`, or explicitly `scoped` delivery. A build or screenshot pass alone cannot verify behavior. Check recorded coverage with:

```bash
node scripts/check-interactions.mjs /path/to/clone/.clone/interactions.json
node --test scripts/check-interactions.test.mjs
```

The coverage helper checks evidence records and comparison assertions. It does not replace observing the original or reviewing the clone.
