# Troubleshooting: precheck, failures, traps, and honest limits

Read this when a browser call fails or the page fights you. `cdp:` =
`mcp__plugin_chrome-devtools-mcp_chrome-devtools__` throughout. Everything here is verified against
chrome-devtools-mcp 1.6.0. If a remedy needs a server flag, tell the user the flag — do not retry blindly.

Triage order, because the cheap checks rule out the expensive theories: (1) is there a browser and are the tools
present (§0)? (2) did the call actually fail, or did it succeed and return junk — `navigate_page` reports
failures in its response text instead of throwing; (3) is the page settled (fonts, lazy content, reveals,
consent) — most "wrong measurement" bugs are timing, not extraction; (4) is the output where you think it is
(`filePath` roots and forced extensions); (5) only then suspect the extractor. Record every workaround you
apply in `run.json.notes` — an unrecorded workaround becomes an unexplained fidelity gap in the report.

## Step 0 precheck — is there a browser at all?

```bash
ls /opt/google/chrome/chrome 2>/dev/null || which google-chrome google-chrome-stable chromium
```

No hit means `cdp:list_pages` fails with `Could not find Google Chrome executable for channel 'stable'`. The
Playwright MCP is **not** a fallback for this — it dies at the same place
(`Chromium distribution 'chrome' is not found`). Remedies, in order:

1. `npx playwright install chrome`, or install the deb:
   `wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo dpkg -i google-chrome-stable_current_amd64.deb`
2. Point the server at any Chromium build:
   `npx chrome-devtools-mcp@latest --executablePath /path/to/chrome`, or `--channel canary|dev|beta`.
3. Attach to a browser you already run: `--browserUrl http://127.0.0.1:9222`. Also the sandbox workaround
   (macOS Seatbelt, Linux containers, WSL).
4. `error while loading shared libraries: libnspr4.so` from an existing Chromium (typically
   `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`) means the binary is fine and the box is missing
   system libs. With root: `sudo apt-get install -y libnspr4 libnss3 libasound2t64` or
   `npx playwright install-deps chromium`. Without root, stage the `.so` files into a directory and launch the
   server against it — `LD_LIBRARY_PATH=$HOME/.local/chromelibs npx chrome-devtools-mcp@latest
   --executablePath ~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`. `libnspr4`, `libnss3`,
   `libX11`, and `libasound2` are the usual four; run `ldd <chrome> | grep 'not found'` to get the real list
   for this box rather than guessing.

Launch is lazy and **headed**, with a persistent profile at `$HOME/.cache/chrome-devtools-mcp/chrome-profile`.
Two consequences: scroll and `IntersectionObserver` reveals run normally, and a previous session may already
have dismissed the cookie banner or be logged in. Never assume — check the DOM, or open the target with
`cdp:new_page {url, isolatedContext:"clone"}` for a true first-visit state.

**Stop conditions.** If the only tools present are `navigate`, `evaluate`, `screenshot`, the server was started
`--slim`: no snapshot, no network, no `filePath`, no emulation, so the pipeline cannot run. If roughly nine
read-only tools are present, the client is in read-only or plan mode. Both cases: stop and report the flag or
mode to change. Never degrade silently into a screenshot-guessing clone — that is the failure this skill exists
to prevent.

## `filePath` mechanics

Every `filePath` / `responseFilePath` / `outputDirPath` is validated against the negotiated MCP roots plus
`os.tmpdir()`. Outside them you get `Access denied: path … is not within any of the configured workspace roots.`
Write everything under the clone project root (`.clone/**`) or `/tmp`. Parent directories are created for you.

The server **substitutes** the extension instead of appending it:

| Tool | Forced extension | Consequence |
|---|---|---|
| `evaluate_script` | `.json` | output may carry wrapper text — parse with `text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)` |
| `take_snapshot` | `.txt` | snapshots are for uid harvesting only |
| `take_screenshot` | `.png` / `.jpeg` / `.webp` | `.jpg` is rewritten to `.jpeg` |
| `get_network_request` | `.network-request` / `.network-response` | mirroring a font needs `mv hero.network-response hero.woff2` |

## Server and tool failures

| Symptom | Cause | Fix |
|---|---|---|
| No `cdp:*` tools listed | server not enabled for this client, or `--slim`, or read-only mode | Report which one. Do not swap to Playwright for a `--slim` server — it lacks the same capabilities. |
| `Target closed` | Chrome failed to start, or a conflicting instance | Close other Chrome instances, install current stable, retry. |
| `Could not find DevToolsActivePort` | `--autoConnect` with no debuggable Chrome | Ensure Chrome 144+ is running with remote debugging, then call `cdp:list_pages` only. |
| `ProtocolError: Network.enable timed out` | hundreds of tabs, or frozen tabs | Close tabs, restart the server, reconnect via `--browserUrl`. |
| `Access denied: path …` | `filePath` outside the MCP roots | Write under the project root or `/tmp`. |
| `Element not found` for a `uid` | snapshot went stale on a DOM mutation | Re-`take_snapshot` immediately before the uid-bearing call; all uids in one call must share a frame. |
| `Providing both "uid" and "fullPage" is not allowed.` | both passed | Pick one. |
| `Elements from different frames can't be evaluated together.` | mixed-frame `args` | One frame per call. |
| Emulation "randomly resets" | `emulate` resets every omitted option and may trigger a reload | Restate the full state every call (viewport + `mobile,touch` + UA + colorScheme), and emulate *before* navigate → wait → interact → measure. |
| `ERR_MODULE_NOT_FOUND` from the server | bad Node version or corrupt npx cache | `rm -rf ~/.npm/_npx && npm cache clean --force`. |
| Unclear server-side error | — | `DEBUG=* npx chrome-devtools-mcp@latest --logFile=/tmp/cdm.log`, or invoke the bundled `chrome-devtools-mcp:troubleshooting` skill. |

## Page-lifecycle traps

| Symptom | Cause | Fix |
|---|---|---|
| `SecurityError` on `sheet.cssRules` | cross-origin stylesheet without CORS | `try/catch` every sheet, record `{href, error:"cors"}` in `cssom.blocked[]`, recover the text over the network — see below. |
| Clone renders in a fallback font | measured before fonts loaded, or `@font-face src` still remote | `await document.fonts.ready` first; get files from the network, not from `FontFace` — see below. |
| Consent banner in every shot; `scrollHeight` wrong | overlay plus `body{overflow:hidden}` | `cdp:take_snapshot` → `cdp:click` the accept/reject `uid` → re-snapshot. Reappears on reload? Capture its design once under `isolatedContext`, then dismiss. Unclickable? Remove it in an `initScript` and record that in `run.json.notes`. |
| Native dialog open, every tool errors | most tools are `blockedByDialog` | `cdp:handle_dialog {action:"dismiss"}`; pre-empt with `dialogAction` on `evaluate_script`. |
| Lazy content never loads; `naturalWidth === 0`; short asset census | `loading="lazy"` and IO-gated fetches | Prewarm-scroll to full height, set `img.loading = "eager"`, `await img.decode()`, then re-run `cdp:list_network_requests`. |
| Sections measured at `opacity:0` / `translateY(40px)`; clone ships blank | reveal captured pre-animation | Scroll past each section, wait ~350 ms, measure. Escape hatch below. |
| SPA route never settles; request log looks reset | `pushState`; the server's DOM-quiet wait is 100 ms capped at 3 s | `cdp:wait_for {text:["<a real footer string>"]}`, then poll for `readyState`, `document.fonts.status === "loaded"`, and a stable `scrollHeight`. Pass `includePreservedRequests: true` for pre-route requests. Navigation failures do **not** throw — read the response text for "Unable to navigate". |
| `fullPage` shot blank, truncated, or enormous | one CDP surface capture; Skia cannot allocate an arbitrarily tall bitmap (~16k device px, empirical) | Stitch tiles — procedure in `references/scaling.md`. |
| Sticky header measured at an offset, or duplicated in tiles | captured mid-scroll | Measure with `scrollY === 0`; record `position`, `top`, `z-index`, `backdrop-filter`, and the scrolled-state class the page toggles. |
| Parallax values look arbitrary | sampled at one scroll offset | Sample three or more offsets and record the deltas (`references/motion.md`). |
| Logged-in or A/B state in the clone | persistent profile leakage | Re-open with `cdp:new_page {url, isolatedContext:"clone"}`. |

Three of those need more than a table cell:

- **Blocked stylesheets.** Recover the text with `cdp:list_network_requests {resourceTypes:["stylesheet"]}` +
  `cdp:get_network_request {reqid, responseFilePath}` into `.clone/css/<slug>.css`, then parse it as text.
  In-page `fetch(href)` is blocked by the same CORS rule — the network route is the only reliable one.
- **Fonts.** `FontFace` objects expose family/weight/style/unicodeRange but never `src`. Take file URLs from
  `resourceTypes:["font"]` and the family↔file↔weight join from
  `CSSFontFaceRule.style.getPropertyValue('src')` or the mirrored stylesheet text. Confirm with the fingerprint
  gate: a `resolvedFamily` or `textWidthPx` mismatch is fallback rendering, not a rounding error.
- **Reveal animations.** Last resort is an `initScript` that stubs `IntersectionObserver` to fire immediately,
  or injects `*{animation:none!important;transition:none!important}` plus
  `[data-aos],.reveal{opacity:1!important;transform:none!important}`. That measures the **end** state; read the
  animation itself separately from `getAnimations()` and the CSSOM keyframes. `initScript` applies to the next
  navigation only — re-pass it every time.

## Extraction and output failures

| Symptom | Cause | Fix |
|---|---|---|
| `evaluate_script` returns `null`, `{}`, `"undefined"`, or an index→name map | the return value is `JSON.stringify`'d **inside the page** | Never return a DOM node, `NodeList`, `Map`, `Set`, `CSSStyleDeclaration`, `Animation`, or anything circular. Return plain objects of primitives: `Object.fromEntries(PROPS.map(p => [p, cs.getPropertyValue(p)]))`. `undefined` serializes to the string `"undefined"`; `NaN`/`Infinity` become `null` — guard with `Number.isFinite`. |
| The dump is 9 bytes containing the literal text `undefined` | the payload was not a callable expression, or the function returned nothing | The server evaluates `` `(${fn})` `` as an **expression** and then calls the result, so the payload must be exactly one function expression and must `return`. A bare statement, or anything outside the arrow function, produces a non-function. A driver that instead treats the string as a function *body* (the Playwright fallback's `browser_evaluate`) returns nothing for a bare `() => {…}` — send an explicit call expression there: `(() => { … })()`. |
| A literal passed through `args` comes back as *element not found* | every `args` string is resolved with `getElementByUid` | `args` carries element uids **only** — never JSON, never a number, never a selector. Interpolate literals into the `function` source, or stash them on `window.__clone.state` in a prior call. A string payload receives no second parameter to hold them. |
| `TypeError: Converting circular structure to JSON` | same | Build a fresh plain object. |
| The turn blows up on output size | a dump landed inline; there is no inline cap on `evaluate_script` | Re-run with `filePath`, then `Grep`/`jq` the one field. Never `Read` a raw dump whole. |
| `node --check` fails on a `scripts/*.js` payload | the file is not exactly one arrow-function expression | The server wraps the string as `` `(${fn})` `` and calls it: one `() => { … }`, nothing else — no `export`, no `import`, no second statement, no trailing text. Verify with `node --check scripts/<name>.js`. |
| `<binary data>` where bytes were expected | inline body read | Re-call with `responseFilePath`. |
| `<Response body not available anymore>` | Chrome evicted the body | Re-request the URL or `curl` it. Do byte fetches soon after load — eviction is the top cause of an empty mirror. |
| A text body ends in `… <truncated>` | 10 000-char inline cap | `responseFilePath`, or `curl`. |
| Mirrored asset 403s, or returns an HTML error page | hotlink protection, signed CDN URL, cookie- or header-gated asset | Prefer `cdp:get_network_request {reqid, responseFilePath}` — the browser already paid the auth. For `curl`, send what the browser sent: `curl -sSL --compressed -A "<page UA>" -e "<page url>" -o dest url`. Still 403 → record it in `run.json.assets.failed[]` and in `CLONE-REPORT.md`. Never substitute a look-alike asset silently. |

## Build and agent failures

| Symptom | Cause | Fix |
|---|---|---|
| A section file contains a literal hex/rgb/oklch value | the agent invented a color it could not map to a token | Check `foundation.json`: a real measured value gets a token added centrally and the agent swaps to it; an invented one is rejected and forced to the nearest token. Gate is zero literals outside the token file (`references/assembly.md`). |
| Tailwind utilities missing, or `@theme` ignored | v4-vs-v3 mismatch | v4 is CSS-first: `@import "tailwindcss"` plus `@theme { --color-…: … }`, no `tailwind.config.js`. v3 needs `@tailwind base/components/utilities` and tokens in `theme.extend`. Detect from the installed version in `package.json`, never from habit; emit per `references/stacks.md`. In `--static` mode the same token names live in `:root` and no utilities exist at all. |
| Two agents changed the same shared file | an agent ignored its ownership map | Revert the shared file to your version, apply the intent through `requests.json`, and re-brief. One writer per path, always. |
| Run died mid-flight | crash, timeout, or a killed agent | `run.json` is written atomically on every transition: re-invoke with `--resume`. `running` sections reset to `pending`, stub `outFile`s are deleted, `done` phases are skipped. Semantics in `references/scaling.md`. Add `--refresh` only if the live page changed. |
| `--resume` warns that the target changed | `target.bodyHash` differs from capture | Stop rather than mixing old specs with a new page. Re-measure with `--refresh`, or accept the old capture deliberately and say so in the report. |

## Playwright MCP fallback

chrome-devtools MCP is primary. Switch only after a chrome-devtools **server** failure the precheck cannot fix,
announce the switch, and record in `PROVENANCE.md` which measurements were lost.

| chrome-devtools | Playwright | What you lose |
|---|---|---|
| `navigate_page` | `browser_navigate` | no `reload` / `initScript` / `timeout` — reveal-stubbing and hook installation are gone |
| `evaluate_script {function, filePath}` | `browser_evaluate {function, filename}` | clean; elements by selector/`ref` instead of uid |
| `take_screenshot` | `browser_take_screenshot {type, scale, …}` | `type` and `scale` are required; no `webp`, no `quality` |
| `take_snapshot` | `browser_snapshot {boxes:true}` | different format, but `boxes` returns bounding rects |
| `resize_page` | `browser_resize` | clean |
| `wait_for {text:[…]}` | `browser_wait_for {text}` | `text` is a single string; `time` is in **seconds** |
| `list_network_requests {resourceTypes}` | `browser_network_requests {static, filter}` | no resourceType enum — filter by URL regex |
| `get_network_request {responseFilePath}` | `browser_network_request {index, part}` | no raw-bytes-to-disk guarantee — mirror binaries with `curl` |
| `emulate` | *none* | **mobile, DPR, touch, UA, and dark-mode passes are not reproducible.** Do them on chrome-devtools MCP or not at all. |
| `lighthouse_audit`, `performance_*` | *none* | skip those gates |

## Known limits — state them, do not fight them

| Limit | Why | Do this instead |
|---|---|---|
| Heavy WebGL / shader canvases | pixels are GPU output: no styles, no geometry, and shader source is bundled and minified | Mirror a poster frame at the measured box; offer a CSS or video approximation as follow-up. |
| Auth-gated app UI | only the anonymous surface is reachable, and a profile's logged-in state is neither reproducible nor shareable | Clone the public surface. If the user supplies credentials, they log in and you continue from the settled page. |
| Server-driven personalisation and A/B tests | the page you measured is one bucket of many | Capture under `isolatedContext` for a stable anonymous bucket; note that variants exist. |
| Infinite feeds and virtualized lists | unbounded content, a moving DOM window, geometry that changes on every scroll | Clone a fixed number of items as an archetype plus a data array. Never mirror the whole feed. |
| Cross-origin iframe widgets (chat, maps, payments, embeds) | no CSSOM, no computed styles, no DOM access | Reproduce the container box and load the same embed, or ship a static placeholder at the measured size. |
| Closed shadow roots | unreachable by any script | Record the count in `cssom.shadowRootsSuspectedClosed` and rebuild the visible result from the capture. |
| rAF-driven physics motion (springs, inertia, hijacked scroll) | no declarative source, only sampled positions | Fit a curve from the samples, ship the closest CSS easing, mark it `authored-not-verified`. |
| `:active`, `prefers-reduced-motion` | not observable / not emulable through this MCP | Read them from the CSSOM, mark `authored-not-verified`. |
| DRM or streaming video | bytes are not retrievable | Mirror the poster, keep the player box, note it. |

Every row you hit belongs in `CLONE-REPORT.md`'s "Not reproduced, and why" table with what shipped instead. A
documented gap is a deliverable; a silently faked one is a defect.
