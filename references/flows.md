# Flows — capturing multi-step UX behind a login

The rest of this skill measures **one page at rest**: it segments a document and records each
band's settled state. That is the wrong shape for three things:

- a UI that only exists **after authentication**
- a UI rendered **inside an iframe** (Shopify App Bridge, Stripe, embedded dashboards)
- a **flow**: onboarding, a setup wizard, a checkout, an empty→populated transition, a
  validation path. Its content is not a rectangle on a page, it is a sequence of states and the
  transitions between them

Read this when the target is an app rather than a site. Output: `.clone/flows.json`
(`clone-site/flows@1`), `.clone/flows/<flowId>/step-<NN>-<state>.{png,webp}`, and
`.clone/FLOW-MAP.md`.

## F0 — decide what you are producing, first

**Default to a spec, not a stylesheet.** For an app UI the valuable artefact is the flow map —
step order, what each step asks for, what it validates, what it does on failure, what the empty
state says, where the exits are. That is portable to any implementation and it is what makes a
product decision.

Cloning an app's *visual* layer is usually the wrong call on top of that, for reasons that are
engineering, not just legal:

| if the target is | why not to clone its CSS |
|---|---|
| a Shopify embedded app | it is Polaris. Reproducing Polaris's computed styles in bespoke CSS means hand-maintaining a design system you could import, and drifting from the admin every time Shopify ships. Build on `@shopify/polaris`; take the *flow*, not the chrome. |
| any admin built on a known kit (MUI, Chakra, shadcn, Ant, Carbon) | same argument. Detect the kit (`references/stacks.md` §1 row 9) and use it. |
| a competitor's product surface | interface trade dress is a real exposure, and marketplace review processes look at UI similarity. A flow map carries no such risk. |

So: run F1–F6, write `FLOW-MAP.md`, and only run a token pass (`references/foundation.md`) if the
visual language is genuinely the deliverable. Record which you chose in `flows.json.intent`
(`"spec"` or `"spec+visual"`) so the report cannot imply more than was decided.

## F1 — authentication is the operator's job, not the harness's

The skill's normal navigation opens a **fresh isolated context** deliberately, for first-visit
fidelity. An app UI needs the opposite. Never put credentials in a script, a flag, or a prompt.

Use a **persistent profile** the operator logs into once, by hand:

```js
// one-time, interactive: the human logs in, solves 2FA, dismisses onboarding
const ctx = await chromium.launchPersistentContext('/abs/.clone/profile', {
  executablePath, headless: false, viewport: { width: 1440, height: 900 },
});
// ...operator logs in, then close the window. The profile keeps the session.
```

Then every later run reuses it headless, with no secrets anywhere:

```js
const ctx = await chromium.launchPersistentContext('/abs/.clone/profile', {
  executablePath, headless: true, viewport: { width: 1440, height: 900 },
});
```

Rules that are not optional:

- `.clone/profile/` holds live session cookies. Add it to `.gitignore` **before** it exists, and
  never commit it. Treat it exactly as you would a token.
- Prefer a **test/development store and a throwaway account** over anyone's production tenant.
- If the session dies mid-run, stop and ask for a re-login. Do **not** retry a login form.
- Storage-state export (`context.storageState()`) is the alternative, and the same warnings apply
  to the JSON file it writes.
- Anything destructive in a flow (delete, disconnect, charge, publish) is captured up to the
  **confirmation dialog** and no further, unless the operator explicitly asked otherwise. Record
  `stoppedAt: "confirm"` rather than pressing the button.

## F2 — find the real document: iframes

An embedded app is not the top document. Enumerate frames before measuring anything, and record
which one you chose in `flows.json.frame`:

```js
page.frames().map((f) => ({ name: f.name(), url: f.url() }))
```

| symptom | what it means |
|---|---|
| the app's markup is absent from the top document | you are measuring the host admin, not the app |
| `document.querySelectorAll('*').length` is tiny | same |
| the frame's origin differs from the address bar | cross-origin: you can drive it via Playwright's frame API, but page-level `evaluate` will not reach it |

Pick the frame whose `scrollHeight` is largest and whose URL matches the app's own host. Every
payload in this skill installs per-frame — install into the **app frame**, not the page. Note in
the report that measurements are frame-relative, because a coordinate inside the frame is not a
coordinate on screen.

## F3 — discover candidate flows before authoring any

Do not hand-write step lists first. Install `scripts/extract-flow.js` and run
`flow.discover()`, which proposes flows from what is actually on screen: forms and their required
fields, step/progress indicators, primary CTAs, empty-state calls to action, modal triggers, and
anything with a wizard-ish `aria-current` or `data-step`.

Its output is a candidate list with a confidence and the evidence that produced it. Read it,
delete what is noise, and only then author the traversal. This is the same discipline as
segmentation: propose from the page, then retune.

## F4 — capture a state, not a screenshot

At every step record all of it, because a screenshot alone cannot answer "what did it validate":

| field | why |
|---|---|
| `url`, `frameUrl` | routing is part of the flow |
| screenshot at each gated width | the visual target |
| the step container's DOM outline (tag/role/label tree, not raw HTML) | structure without inheriting markup |
| every field: `name`, `type`, `required`, `pattern`, `placeholder`, `value`, `aria-describedby` | this **is** the validation contract |
| visible text, verbatim | labels, helper text, error copy |
| focus position | keyboard order is UX, and it is where accessibility bugs live |
| `aria-live` region contents | what a screen reader is told |
| disabled/enabled state of the primary action | reveals the gating rule |
| network calls the step fired (method, path, status — **never bodies**) | tells you what the step actually does |

Never store request/response **bodies**: on an authenticated app those contain tenant data.
Record method, path shape and status only.

## F5 — probe the states everyone forgets

The reason to automate this rather than click through by hand. For each flow, deliberately drive:

| state | how to provoke it | why it matters |
|---|---|---|
| **empty** | a fresh account, or a filtered view with no matches | the empty state is the first thing a new user sees, and it is usually the least designed |
| **validation** | submit the form untouched, then with one bad value | you get the real rules and the real copy, not a guess |
| **loading** | throttle or block the step's own request (`route.abort`/`route.fulfill` with a delay) | skeletons and spinners are otherwise invisible |
| **error** | fail that request with a 500 | error copy and recovery affordances |
| **success** | complete the happy path | the confirmation state and where it lands you |
| **partial/resume** | reload mid-flow | does it persist progress? this is a genuine product decision you can read off the page |
| **destructive** | open the confirm dialog and stop | wording and friction, without performing the action |

Each becomes a captured state with its own row. A flow map that only has the happy path is worth
a fraction of one that has all seven.

## F6 — write the map

`FLOW-MAP.md` is the deliverable. One section per flow:

- a state diagram (states, transitions, guards)
- per step: purpose, fields with their real validation contract, primary/secondary actions,
  verbatim copy, exits
- what gates progress, and what happens when it fails
- how many steps to the first successful outcome, and how many fields are required to get there —
  the two numbers most worth comparing against your own app
- what the empty, loading and error states say
- an explicit **Not captured** list: anything behind a paywall, a destructive action stopped at
  confirmation, a step needing data you did not have

Then, if `intent` is `"spec"`, stop. Implementation is a normal build against your own design
system — for a Shopify app that means Polaris, and the `shopify-polaris-*` skills, not this one.

## Gate

- `flows.json.intent` is set, and the report does not claim visual fidelity if it is `"spec"`
- authentication used a persistent profile the operator logged into; no credential appears in any
  file, and `.clone/profile/` is gitignored
- the measured frame is recorded, and coordinates are labelled frame-relative
- every flow has the happy path **plus** at least the empty and validation states, or an explicit
  reason why not
- no request or response body was stored
- destructive actions show `stoppedAt: "confirm"`
