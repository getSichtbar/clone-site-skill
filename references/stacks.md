# Stacks — adopt an existing repo or scaffold a new one

`cdp:` = `mcp__plugin_chrome-devtools-mcp_chrome-devtools__`.

Decide the output stack **before** anything is written, and record the answer in `run.json.stack`. Every later
phase (foundation, section agents, assembly) resolves its file paths from that block and nowhere else.

Three modes:

| Mode | When | Effect |
|---|---|---|
| `adopt` | detection finds a framework in the cwd (or an ancestor holding `package.json`) | emit into the repo's own conventions; never reformat or migrate what is already there |
| `scaffold` | no framework detected | Next 15 App Router + Tailwind v4 + TypeScript into `--out` (default `./<domain>-clone`) |
| `static` | `--static` passed | framework-agnostic `index.html` + `styles.css` + `main.js` + `sections/*.html`; overrides detection entirely |

`--static` wins over detection. `--out` is ignored in `adopt` mode.

**Where `.clone/` lives before the project exists.** `adopt` mode: the detected repo root, so `.clone/` is written
at step 1. `scaffold` and `static` modes: `<out>/.clone/`, and `<out>` does not exist yet at step 1 even though
step 1's exit gate already requires `run.json` on disk. Resolve it in this order and never guess:

1. `mkdir -p <out>` yourself, then write `<out>/.clone/run.json`. Add `.clone/` to `.gitignore` when you create one.
2. `create-next-app` refuses a target directory containing entries it does not recognise, and `.clone/` is one.
   So at phase `scaffold` (step 3), scaffold into a sibling temp dir — `npx create-next-app@latest <out>.scaffold …`
   — then move its contents into `<out>` (`cp -a <out>.scaffold/. <out>/ && rm -rf <out>.scaffold`), leaving
   `<out>/.clone/` untouched. Verify `<out>/package.json` exists before marking the phase `done`.
3. Never write `.clone/` into the cwd in scaffold mode: the run state would end up outside the project it
   describes, and `--resume` reads `.clone/run.json` relative to `stack.root`.

## 1. Detection order

Stop at the first framework hit. Run all of it before writing a byte — a half-detected stack produces files
nobody imports.

| # | Probe | Reads |
|---|---|---|
| 1 | `package.json` exists in cwd or an ancestor (stop at `.git` or `$HOME`) | `root`; absence of a `package.json` anywhere ⇒ `scaffold` |
| 2 | `dependencies` + `devDependencies` | `next` ⇒ Next · `astro` ⇒ Astro · `@sveltejs/kit` ⇒ SvelteKit · `nuxt` ⇒ Nuxt · `@remix-run/*`/`react-router` v7 ⇒ Remix · `vite` + `react` ⇒ Vite React · `vite` + `vue` ⇒ Vite Vue |
| 3 | config files, in this order | `next.config.{ts,mjs,js}` → `astro.config.{ts,mjs,js}` → `svelte.config.js` → `nuxt.config.ts` → `vite.config.{ts,js}` |
| 4 | Tailwind major | `@tailwindcss/postcss` or `@tailwindcss/vite` in deps, **or** `@import "tailwindcss"` in any CSS ⇒ **v4**. `tailwind.config.{js,ts,cjs}` + `@tailwind base;` ⇒ **v3**. Neither ⇒ plain CSS / CSS modules / styled system — read the actual style files before assuming |
| 5 | Next router | `app/` or `src/app/` with a `layout.tsx` ⇒ App Router. `pages/_app.*` ⇒ Pages Router. Both present ⇒ App Router for new routes, and say so in `CLONE-REPORT.md` |
| 6 | Existing tokens | `git ls-files \| grep -Ei '(globals\|global\|app\|index\|theme\|tokens)\.(css\|scss)$'` plus any `@theme`, `:root{--`, `tailwind.config` `theme.extend` — the **first** match becomes `tokensFile`; extend it, never create a rival token file |
| 7 | Component conventions | list 3 existing components: default vs named export, `.tsx` vs `.jsx` vs `.vue`/`.svelte`/`.astro`, `clsx`/`cn()` helper, `cva`, `React.FC` vs plain function, quote style, semicolons, indent |
| 8 | TypeScript | `tsconfig.json` present ⇒ `typescript: true`. Match `strict`, `paths` aliases (`@/*`), and `jsx` |
| 9 | UI kit | `components.json` (shadcn/ui) ⇒ reuse its `Button`/`Card` primitives and `cn()`; `@mui/material`, `@chakra-ui/react`, `antd`, `bootstrap` ⇒ prefer the kit's primitives over raw markup where the measured styles allow |
| 10 | Package manager | `pnpm-lock.yaml` ⇒ pnpm · `yarn.lock` ⇒ yarn · `bun.lockb`/`bun.lock` ⇒ bun · `package-lock.json` or nothing ⇒ npm |

```bash
ls package.json next.config.* astro.config.* svelte.config.* nuxt.config.* vite.config.* \
   tailwind.config.* components.json tsconfig.json 2>/dev/null
ls -d app src/app pages src/pages src/routes src/components components 2>/dev/null
grep -l '@import "tailwindcss"' $(git ls-files '*.css' 2>/dev/null) 2>/dev/null
node -e 'const p=require("./package.json");console.log(JSON.stringify({d:p.dependencies,dd:p.devDependencies,pm:p.packageManager},null,1))'
```

Announce the result in one line before proceeding — *"Adopting: Next 15 App Router, Tailwind v4, TS, pnpm,
shadcn/ui; tokens in `app/globals.css`"* — then write `run.json.stack`.

## 2. Path map

Fill every field. `sectionsDir`/`sharedDir` are created if missing; `pageFile` and `tokensFile` are appended to
when they already exist.

| Mode | `sectionsDir` | `sharedDir` | `assetsDir` | `ref` prefix | `pageFile` | `tokensFile` |
|---|---|---|---|---|---|---|
| Next 15 App Router | `components/sections/` | `components/shared/` | `public/assets/` | `/assets/` | `app/page.tsx` | `app/globals.css` |
| Next Pages Router | `components/sections/` | `components/shared/` | `public/assets/` | `/assets/` | `pages/index.tsx` | `styles/globals.css` |
| Vite React | `src/components/sections/` | `src/components/shared/` | `public/assets/` | `/assets/` | `src/App.tsx` | `src/index.css` |
| Astro | `src/components/sections/` | `src/components/shared/` | `public/assets/` | `/assets/` | `src/pages/index.astro` | `src/styles/global.css` |
| SvelteKit | `src/lib/components/sections/` | `src/lib/components/shared/` | `static/assets/` | `/assets/` | `src/routes/+page.svelte` | `src/app.css` |
| `--static` | `sections/` | `sections/` | `assets/` | `./assets/` | `index.html` | `styles.css` |

If the repo already uses `src/`, prefix every emitted path with it and keep the existing alias (`@/components/…`).

`run.json.stack`, written before anything is emitted, is the only place downstream phases look up a path. `root`
is absolute, every other path is relative to it, and directories carry **no** trailing slash.

```jsonc
"stack": {
  "mode": "adopt",                       // adopt | scaffold | static
  "detectedFrom": "package.json:next@15.4.6 + app/layout.tsx + @tailwindcss/postcss",
  "framework": "next",                   // next | astro | sveltekit | vite-react | nuxt | remix | static
  "router": "app",                       // app | pages | null
  "css": "tailwind-v4",                  // tailwind-v4 | tailwind-v3 | css
  "typescript": true,
  "pkgManager": "pnpm",                  // pnpm | yarn | bun | npm
  "root": "/abs/path/to/repo",
  "sectionsDir": "components/sections",
  "sharedDir": "components/shared",
  "assetsDir": "public/assets",
  "pageFile": "app/page.tsx",
  "tokensFile": "app/globals.css"
}
```

No repo detected and no `--static`: `mode:"scaffold"`, `framework:"next"`, `router:"app"`, `css:"tailwind-v4"`,
`typescript:true`, `root` = `--out`, and the Next 15 row of the table above. The `ref` prefix is not stored —
derive it from `assetsDir` by dropping the served root (`public/assets` → `/assets/`, `static/assets` →
`/assets/`, static mode → `./assets/`).

## 3. Scaffold — Next 15 App Router + Tailwind v4 + TS (the default)

`<out>` already exists and already holds `.clone/` by now (§1), which `create-next-app` refuses to scaffold into,
so scaffold beside it and move in:

```bash
npx create-next-app@latest <out>.scaffold --typescript --tailwind --app --eslint \
  --no-src-dir --import-alias "@/*" --use-npm --empty --yes --reset-preferences
cp -a <out>.scaffold/. <out>/ && rm -rf <out>.scaffold      # .clone/ in <out> is untouched
cd <out>
test -f package.json || { echo "scaffold did not land"; exit 1; }
node -e 'console.log(require("./package.json").dependencies.tailwindcss)'   # must be ^4
```

`--yes` reuses the machine's *saved* create-next-app preferences for anything you did not pass, which is why
every option above is explicit and `--reset-preferences` is on. `--empty` skips the demo page so `app/page.tsx`
starts clean.

If that prints `^3`, either upgrade (`npx @tailwindcss/upgrade@latest`) or switch to the v3 recipe in §4 — do
not hand-write a v4 `@theme` block against a v3 install; the utilities will not generate.

`app/globals.css` — the only token file. No `tailwind.config.js` in v4:

```css
@import "tailwindcss";

@theme {
  --font-sans: "Soehne", ui-sans-serif, system-ui, sans-serif;
  --color-ink: oklch(0.21 0.006 285.9);
  --color-surface: #ffffff;
  --color-accent: oklch(0.62 0.19 258);
  --text-7xl: 4.5rem;
  --text-7xl--line-height: 1.05;
  --spacing: 4px;
  --radius-lg: 12px;
  --shadow-lg: 0 10px 30px -12px rgb(16 24 40 / 0.18);
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --breakpoint-md: 48rem;
  --container-6xl: 72rem;
}

@custom-variant dark (&:where(.dark, .dark *));

@font-face {
  font-family: "Soehne";
  src: url("/assets/fonts/soehne-buch.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153;
}

@layer base { html { -webkit-font-smoothing: antialiased; } }
```

Token names and the values-to-tokens mapping are owned by `references/foundation.md`. Notes that
matter in v4: `@theme` keys generate utilities (`--color-ink` → `bg-ink`/`text-ink`), so the namespace prefix is
load-bearing; `@theme inline` when a token references another `var()`; `@source "../lib"` only if a template
lives outside the auto-detected tree; custom utilities use `@utility`, not `@layer utilities`.

Fonts: `@font-face` in `globals.css` pointing at `/assets/fonts/*` is the byte-verbatim default and matches the
`--static` output. Use `next/font/local` **only** if the repo already does:

```ts
// app/fonts.ts
import localFont from "next/font/local";
export const soehne = localFont({
  src: [{ path: "../public/assets/fonts/soehne-buch.woff2", weight: "400", style: "normal" }],
  variable: "--font-sans", display: "swap",
});
```

`app/page.tsx` composes sections in document order, one import per section, named exports only:

```tsx
import { SiteHeader } from "@/components/shared/SiteHeader";
import { Hero } from "@/components/sections/Hero";
export default function Page() {
  return (<><SiteHeader /><main><Hero /></main></>);
}
```

## 4. Per-stack emission

| Stack | Sections | Tokens | Fonts | Assets | Scaffold |
|---|---|---|---|---|---|
| **Next 15 + TW v4** | `.tsx`, named export | `@theme` in `app/globals.css` | `@font-face` (or `next/font/local` if the repo does) | `public/assets/` | §3 |
| **Next + TW v3** | `.tsx`, named export | `theme.extend` in `tailwind.config.ts` + `:root{--…}` in `styles/globals.css`; keep `@tailwind base/components/utilities` | `@font-face` in `globals.css` | `public/assets/` | `npx create-next-app@latest <out> --typescript --tailwind --app` on `next@14`, or adopt as found |
| **Vite + React** | `src/components/sections/*.tsx` | `@theme` in `src/index.css` | `@font-face` in `src/index.css` | `public/assets/` | `npm create vite@latest <out> -- --template react-ts` then `npm i tailwindcss @tailwindcss/vite` and add `tailwindcss()` to `vite.config.ts` `plugins` |
| **Astro** | `src/components/sections/*.astro`, props in the frontmatter fence | `@theme` in `src/styles/global.css`, imported once from the layout | `@font-face` in `global.css` | `public/assets/` | `npm create astro@latest <out> -- --template minimal --typescript strict` then `npx astro add tailwind` |
| **SvelteKit** | `src/lib/components/sections/*.svelte` | `@theme` in `src/app.css`, imported from `+layout.svelte` | `@font-face` in `app.css` | `static/assets/` | `npx sv create <out> --template minimal --types ts` then `npx sv add tailwindcss` |
| **`--static`** | `sections/<id>.html` fragments | `:root{--…}` in `styles.css` | `@font-face` in `styles.css`, `url("./assets/fonts/…")` | `assets/` | `mkdir -p <out>/{sections,assets}` — nothing to install |

Per-stack specifics worth stating once:

- **Astro** ships zero client JS by default. A section with real interactivity needs `client:load` on a
  framework island or a plain `<script>` in the component — decide from `motion.json`, and never wrap a static
  section in an island "just in case".
- **SvelteKit** puts global CSS in `src/app.css` imported by `src/routes/+layout.svelte`; `static/` is served
  from the root, so `ref` stays `/assets/…`.
- **Vite React** has no file-based routing: extra pages (`--pages > 1`) mean adding `react-router-dom`, which is
  a `dependency` request (`references/agent-brief.md`), not a silent install.
- **Next Pages Router**: `styles/globals.css` is imported from `pages/_app.tsx`. Do not add an `app/` directory
  to a Pages-Router repo.

## 5. `--static` layout and assembly

```
<out>/
├── index.html            # <head>, tokens link, shell, one marker per section, main.js
├── styles.css            # :root{--…} using the SAME token names as @theme, then base + shell CSS — ORCHESTRATOR ONLY
├── main.js               # drawer toggle, reveal observers, carousel — only what motion.json proves exists
├── sections/03-features.html   # fragment; root element carries data-section="03-features"
├── sections/03-features.css    # that section's own rules — the SECTION AGENT's second owned file
└── assets/{fonts,img,media,meta}/
```

`index.html` carries one marker comment per section in document order:

```html
<body>
  <!-- section:00-header -->
  <!-- section:01-hero -->
  <script src="./main.js" type="module"></script>
</body>
```

Assembly replaces each `<!-- section:<id> -->` line with that fragment's bytes, in id order, leaving the
fragments on disk for per-section diffing. Sections stay standalone-valid HTML so a fragment can be opened
directly during repair. Tokens use the identical `--color-*` / `--text-*` / `--spacing` names as the Tailwind
modes (`references/foundation.md`) so a `--static` clone can be lifted into a framework later without renames.

**Two owned files per section, because there is no utility engine.** A static section agent writes
`sections/<id>.html` **and** `sections/<id>.css` — nothing else, and never `styles.css`, which is the tokens
file and the orchestrator's alone (ownership map: `references/sectioning.md` §10). Every rule in
`sections/<id>.css` is scoped to `[data-section="<id>"]`, so two agents can never collide even though both
files land in the same directory. The orchestrator emits one `<link rel="stylesheet" href="./sections/<id>.css">`
per section into `index.html`'s `<head>`, in id order, immediately after `styles.css` — cascade order is
document order, so a later section can never restyle an earlier one.

Three contract rows change in static mode, and `references/agent-brief.md` §8 is where the substitution is made:

| Row | Tailwind wording | `--static` wording |
|---|---|---|
| `tokenRule` | "written as the utility `@theme` generates (`text-ink-muted`, `bg-surface`, `gap-16`)" | "written as a declaration that reads the custom property: `color: var(--color-ink-muted)`, `background: var(--color-surface)`, `gap: calc(var(--spacing) * 16)`. Zero literal hex/rgb/hsl/oklch, exactly as before — the ban is on literal values, not on declarations." |
| arbitrary-value gate | "≤ 3 `-[Npx]` utilities, each justified" | "≤ 3 px literals that are not `var()`/`calc(var())`-derived, each justified in `report.md` with its measured source. `grep -nE ':\s*-?[0-9.]+(px\|rem)' sections/<id>.css` is the check." |
| write surface | one component file | `sections/<id>.html` + `sections/<id>.css`, both scoped to this section |

## 6. Dependency policy

- **Adopt mode: add nothing.** Build with what the repo already has. A section agent that needs a package files
  a `dependency` request; the orchestrator installs it once, with the detected package manager, after review.
- **Scaffold mode:** only what the scaffold command installs, plus a motion library **only** when
  `motion.json.libraries[]` names one the CSS-first rebuild cannot cover. `--static` installs nothing, ever.
- Never add a UI kit, a component library, an icon package, or a CSS-in-JS runtime to reproduce a design that
  measured out as plain CSS.
- Mirrored vendor CSS/JS in `.clone/assets/{css,js}` is reference material, not a dependency. Do not ship it.

## 7. Build and verify commands

Run with the detected package manager (`pnpm`/`yarn`/`bun`/`npm`). Every one of these must pass before the
verify phase captures the clone.

| Stack | typecheck | build | serve the built clone (the capture target) | dev |
|---|---|---|---|---|
| Next | `npx tsc --noEmit` | `npm run build` | `npx next start -p 3000` | `npm run dev` :3000 |
| Vite React | `npx tsc --noEmit` | `npm run build` | `npx vite preview --port 4173` | `npm run dev` :5173 |
| Astro | `npx astro check` | `npm run build` | `npx astro preview --port 4321` | `npm run dev` :4321 |
| SvelteKit | `npm run check` | `npm run build` | `npx vite preview --port 4173` | `npm run dev` :5173 |
| `--static` | — | — | `python3 -m http.server -d <out> 8080` | same |

Capture against the **built** server, not `npm run dev` (see pitfall 7). A TypeScript error, a failed build, or
a missing token file is a hard stop, not a warning: gate numbers and the repair loop are in
`references/assembly.md`.

## 8. Pitfalls

Each one has cost a real run.

1. **Tailwind v4 needs no `tailwind.config.js`.** Creating one is a v3 reflex: v4 ignores it unless a CSS file
   explicitly does `@config "…"`, so the file is dead weight that misleads the next reader — and any agent —
   into editing config that generates nothing. Tokens live in `@theme` in `tokensFile`. If a v4 repo already has
   one, leave it alone and still author into `@theme`.
2. **Next 15 rejects TypeScript 7.** Next's type checking uses the TS **JS compiler API**, which the native TS 7
   port does not expose; `next build` dies before it reaches your code. Pin `"typescript": "^6"` in
   `devDependencies` and reinstall. Check first: `node -e 'console.log(require("typescript").version)'`.
3. **`@/*` needs a `paths` entry, and `baseUrl` is deprecated in TS 6.** Do not add `baseUrl` to silence a
   resolution error — write paths that resolve relative to the `tsconfig.json` itself:
   `"paths": { "@/*": ["./*"] }` (or `["./src/*"]` in a `src/` repo). Adding `baseUrl` earns a deprecation
   error under TS 6 and breaks the build you were trying to fix.
4. **Side-effect CSS imports need a `.d.ts`.** Next only declares `*.module.css`, so `import "./x.css"` fails
   typecheck. Add `types/css.d.ts` with `declare module '*.css';` and make sure `tsconfig.json` `include`
   covers `types/`.
5. **`next-env.d.ts` must exist** and be listed in `tsconfig.json` `include`. Next regenerates it on `dev`/
   `build`; deleting it (or scaffolding a tsconfig by hand without it) removes the `next/image` and JSX
   ambient types, and every section file lights up red.
6. **Edit `package.json`, never overwrite it.** Writing the whole file after an install silently drops the deps
   the installer just added — the next `install` prunes them and the build fails somewhere unrelated. Use
   `Edit` on the exact line, or `npm pkg set scripts.foo=…`.
7. **`next dev` never goes quiet.** The HMR websocket keeps a request open forever, so any wait that expects
   network idle burns its whole timeout — `cdp:navigate_page` has no `waitUntil`, so give it an explicit
   `timeout` and gate readiness on `cdp:wait_for {text:[…]}` plus a `document.readyState === 'complete'` poll
   instead. Vite's `/@vite/client` behaves the same. Capturing the production server sidesteps it entirely and
   also removes dev-only overlays from the diff.
