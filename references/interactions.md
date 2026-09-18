# Interaction discovery and verification

Read during original-page measurement, before section briefs, and again at verification. This is the behavioral contract for the requested website pages or the one root selected by `--section`; application workflows also use `flows.md` for authentication and multi-step flows. A build, static screenshot, or presence of keyframes does not prove this contract.

## Discover before implementing

Walk every in-scope section, including shared navigation on a page-wide run. For `--section`, scope means the resolved root plus interactions whose trigger and affected target both live inside it. Record a cross-boundary dependency (for example, a selected CTA opening a page-level modal) in `SELECTION.md`; do not silently claim it as local behavior. Use real pointer/keyboard input, wait for timed changes, and scroll down **and back up**. Inspect builder action lists and first-party code for state machines that runtime animation APIs miss. Record each distinct behavior in `.clone/interactions.json`, including behaviors that cannot yet be measured. Do not discard an in-scope interaction because its evidence is missing.

Record trigger and preconditions, states, affected elements, start/midpoint/end appearance, timing/easing/direction, exit/reset behavior, interruption behavior, and responsive differences. Record the source selector separately from the clone selector. For overlays, measure panel placement, backdrop/blur, stacking, hit testing, and dismissal together. For synchronized tracks, record selection and neighbor visibility on **both** tracks.

Use `status: planned` until implemented, `implemented` until compared against the original, `verified` only after all applicable scenarios pass, and `unresolved` for missing or mismatched behavior. `excluded` requires a specific user scope instruction; a profile or exhausted repair budget is not one. In a `--section` run, keep wholly outside interactions out of `interactions.json` entirely: record the literal `--section …` request, boundary reason, and cross-boundary dependency in `SELECTION.md` instead. That keeps the ledger's coverage total honestly limited to the one selected root, while an in-root behavior that is not measured stays unresolved. Use `userScopeInstruction` only when an interaction is deliberately recorded as excluded in a page-wide ledger so `check-interactions.mjs` can validate it.

Finish discovery before fan-out and set `discovery.complete` only after visiting every in-scope section at the relevant layouts. DOM selector scans alone are not discovery. In each section spec, include the absolute ledger path and its interaction IDs; the shared-header owner receives navigation interactions too.

## Compare sequences, including boundaries

Run the **same ordered actions and preconditions** on original and clone. Preserve matched viewport, scroll, focus, pointer position, and loading state. Navigate fresh when changing a breakpoint if the source initializes behavior only at load. Do not infer mobile behavior from a resized desktop session. Keep baseline styles separate from captured hover/active state.

Choose scenarios from the applicable row; do not impose a behavior the source lacks:

| Component | Required observations |
|---|---|
| Navigation/dropdown | Open each menu, move pointer from trigger into panel, switch menus, leave/dismiss, reopen; keyboard access; panel centering and viewport containment; blur/backdrop hit testing; scroll down/up; mobile open/close |
| Carousel | Visit every item; cross last→first and first→last using normal controls; verify neighboring content does not disappear; selected item and coupled tracks stay aligned; repeat and interrupt navigation |
| Autoplay | Observe at least two timed advances; click a tab/dot/chip then wait again with pointer outside and focus retained; enter/leave hover; inspect pause/resume and timer reset rules; observe a wrap (navigate near the end to avoid waiting a full long cycle) |
| Hover card/Lottie | Baseline→enter→leave→another card→re-enter; colors, button, artwork, reset frame, exclusivity, and timing; an outgoing animation must not leave a second card colored if the source resets immediately |
| Tabs/card stack | Start/midpoint/end in both directions; outgoing and incoming layers; rapid switch; selected controls; counters; different responsive movement directions |
| Accordion | Closed→opening→open→closing→closed; height, opacity, icon rotation; multiple open items if allowed; interruption; focus and hidden content interaction |
| Scroll-triggered content | First entry, exit, re-entry, reverse direction, reload at a scrolled position; distinguish one-shot from repeat behavior |

Where accessible keyboard or reduced-motion behavior is authored beyond the original, label it an enhancement; test it separately rather than claiming source parity. If the available browser can emulate reduced motion, test it. Otherwise record `authored-not-verified` for that enhancement. Never convert an untested source behavior into a passed parity check.

Capture stable checkpoints and intermediate samples. For a duration `D`, compare start, around `D/2`, and settled state; for timers compare elapsed time from the same trigger. Poll settled values with a bounded timeout and numeric tolerances instead of assuming a sleep guarantees a frame was painted. Include position/direction and neighbor visibility: an end-state-only screenshot cannot distinguish an instant swap from a slide. Don't dismiss a pixel mismatch as “animation timing” until matched checkpoints explain it.

Store original and clone traces/captures plus a comparison artifact containing source expectations, observed clone values, tolerances, assertion outcomes, and environment. Use measured timing, not hard-coded site-specific numbers. A comparison checks observable behavior, not whether an implementation contains a particular class/function.

## Ledger and coverage gate

Use this shape (paths are relative to the ledger directory). One scenario can contain multiple assertions; `checks` names the assertions the browser comparison actually ran.

```json
{
  "schema": "clone-site/interactions@1",
  "discovery": { "complete": true, "sections": ["00-header"], "reviewedSections": ["00-header"] },
  "interactions": [{
    "id": "header-channels", "section": "00-header", "kind": "dropdown",
    "sourceSelector": ".source-menu", "cloneSelector": ".clone-menu",
    "status": "verified", "contract": "raw/header-contract.json",
    "scenarios": [{
      "id": "pointer-open-dismiss", "status": "passed",
      "original": "raw/header-original.json", "clone": "raw/header-clone.json",
      "comparison": "raw/header-comparison.json",
      "checks": ["panel-center", "backdrop-blur", "pointer-bridge", "dismiss-reset"]
    }]
  }]
}
```

A comparison artifact is JSON with a `checks` array. Each entry has `id`, `passed` (boolean), and `original` and `clone` observations; include `tolerance` where applicable. Contract files are normalized JSON captured **before implementation**. Include source provenance and behavior details, plus a machine-readable `requiredScenarios` list of `{ "id": "pointer-open-dismiss", "checks": ["panel-center", "backdrop-blur", "pointer-bridge", "dismiss-reset"] }` entries. Every applicable scenario from the table must be in that source contract. The helper rejects missing scenarios and assertions relative to this list; do not shrink it to match the implementation. Contract changes require new source evidence or an explicit user scope change. A required scenario cannot be waived as `not-applicable`; that status is only for additionally recorded cases outside the required inventory. Record every applicable scenario above, including viewport variants. `not-applicable` scenarios require `reason` and an `evidence` file showing why; don't label an unimplemented feature not applicable.

Run from any directory:

```bash
node /absolute/path/to/skill/scripts/check-interactions.mjs /project/.clone/interactions.json
```

This helper rejects incomplete discovery, missing/empty evidence, unresolved implementations, scenarios/assertions omitted from the source contract’s required inventory, and failed scenarios. It checks the recorded evidence contract; it cannot establish whether discovery is exhaustive or whether a screenshot actually matches. The orchestrator must inspect comparisons and perform the browser walkthrough. Do not fabricate evidence or treat this helper alone as proof of fidelity.

After a behavior change, rerun affected sequences, including any shared selectors/state they use. Keep the ledger current; passing artifacts from an older implementation do not verify the new one. Report verified/total interaction counts and unresolved IDs alongside visual gates. Any required behavioral gap makes the delivery **incomplete**, even if static gates pass.
