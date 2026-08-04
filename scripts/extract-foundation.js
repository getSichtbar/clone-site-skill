/* clone-site foundation extractor v1 — an INSTALLER payload, not a script. See references/extraction.md.
   Invocation: Read this file, pass its ENTIRE contents as the `function` argument to
   mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script. The server evaluates `(<contents>)` and
   calls the result, so the file must stay exactly ONE arrow-function expression; this leading block comment
   sits inside those parens and is harmless, and `node --check` accepts the file as an ExpressionStatement,
   so no wrapper is needed. Install returns {ok:true, installed:['util','foundation'], v:1}. Later passes are
   one-liners sent as `function`, always with `filePath`: "() => window.__clone.foundation.all()" (full pass),
   "() => window.__clone.foundation.vars()" (custom properties only), and
   "() => window.__clone.foundation.fingerprint()" (geometry/type/color probe). Re-install after every
   navigate_page including type:"reload"; resize_page and emulate do not wipe page state.
   Output matches schema clone-site/foundation@1. */
() => {
  const V = 1;
  const CAP = { el: 6000, list: 120, tree: 300, kf: 40, kfStep: 14, sheet: 300, rule: 30000, str: 220, asset: 150,
    fp: 80, pseudo: 1500, warn: 60, member: 8, vars: 400, decl: 600, idx: 6000, palette: 48, grid: 60, node: 40 };
  let W = [];
  const warn = (m) => { if (W.length < CAP.warn && W.indexOf(m) < 0) W.push(String(m)); };
  const safe = (fn, fb, tag) => { try { return fn(); } catch (e) { warn((tag || 'safe') + ':' + ((e && e.name) || 'Error')); return fb; } };
  const T = (s, n) => (typeof s === 'string' && s.length > (n || CAP.str) ? s.slice(0, n || CAP.str) + '…' : s);
  const num = (v) => { const f = parseFloat(v); return Number.isFinite(f) ? f : 0; };
  const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
  const bar = (s) => String(s == null ? '' : s).replace(/\|/g, '/');
  const box = (r, dy) => ({ x: r2(r.left), y: r2(r.top + (dy || 0)), w: r2(r.width), h: r2(r.height) });
  /* ---------- weighted counters; Maps never leave this closure ---------- */
  const SKIPV = { '': 1, none: 1, normal: 1, auto: 1, '0px': 1, 'rgba(0, 0, 0, 0)': 1 };
  const mk = () => new Map();
  const bump = (m, k, w, tag) => {
    if (k == null) return;
    k = String(k); if (SKIPV[k]) return;
    let c = m.get(k); if (!c) { c = { n: 0, w: 0, tags: [] }; m.set(k, c); }
    c.n++; c.w += (Number.isFinite(w) ? w : 0); if (tag && c.tags.length < 6 && c.tags.indexOf(tag) < 0) c.tags.push(tag);
  };
  const rank = (m, n) => [...m.entries()].sort((a, b) => (b[1].w - a[1].w) || (b[1].n - a[1].n)).slice(0, n || CAP.list).map(([v, c]) => ({ value: T(v), count: c.n, weight: Math.round(c.w), tags: c.tags }));
  const vals = (m, n) => rank(m, n).map((x) => x.value);
  const vc = (m, n) => rank(m, n).map((x) => ({ value: x.value, count: x.count }));
  const vcw = (m, n) => rank(m, n).map((x) => ({ value: x.value, count: x.count, weight: x.weight }));
  /* split a comma list at top level: shadows, transitions, gradient layers, font stacks */
  const splitTop = (s) => {
    const out = []; const str = String(s || ''); let d = 0, cur = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i]; if (ch === '(') d++; else if (ch === ')') d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim()); return out;
  };
  /* ---------- color: css string -> sRGB bytes -> OKLab. Clustering only; never emitted as a value.
       8-bit RGBA gamut-clips oklch()/display-p3, so the raw computed string is always the token. ---------- */
  const CTX = safe(() => { const c = document.createElement('canvas'); c.width = c.height = 1; return c.getContext('2d', { willReadFrequently: true }); }, null, 'canvas');
  const RGBA_CACHE = new Map();
  const toRGBA = (v) => {
    if (!v || typeof v !== 'string') return null;
    const k = v.trim(); if (!k || k === 'none' || k.toLowerCase() === 'currentcolor') return null;
    if (RGBA_CACHE.has(k)) return RGBA_CACHE.get(k);
    let out = null;
    const m = /^rgba?\(\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(k);
    if (m) { const a = m[4] == null ? 1 : (String(m[4]).slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4])); out = [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), r2(a)]; }
    else if (CTX) out = safe(() => {
      CTX.fillStyle = '#010203'; CTX.fillStyle = k;                       /* sentinel: invalid colors leave it unchanged */
      if (CTX.fillStyle === '#010203' && !/^#010203$/i.test(k)) return null;
      CTX.clearRect(0, 0, 1, 1); CTX.fillRect(0, 0, 1, 1);
      const d = CTX.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], r2(d[3] / 255)];
    }, null, 'toRGBA');
    RGBA_CACHE.set(k, out); return out;
  };
  const oklab = (rgba) => {
    if (!rgba) return null;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const r = lin(rgba[0]), g = lin(rgba[1]), b = lin(rgba[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [r3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s), r3(1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s), r3(0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)];
  };
  const COLOR_RE = /(#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([^()]*(?:\([^()]*\)[^()]*)*\))/gi;
  const pickColors = (s) => (typeof s === 'string' ? (s.match(COLOR_RE) || []) : []);
  const clusterColors = (ranked, thresh) => {
    const out = [];
    for (const item of ranked) {
      const rgba = toRGBA(item.value), ok = oklab(rgba);
      if (!ok) { if (out.length < CAP.palette) out.push({ value: item.value, rgba: null, oklab: null, weight: item.weight, count: item.count, roles: item.tags, members: [] }); continue; }
      let hit = null;
      for (const c of out) {
        if (!c.oklab) continue;
        const d = Math.hypot(c.oklab[0] - ok[0], c.oklab[1] - ok[1], c.oklab[2] - ok[2]);
        if (d <= (thresh || 0.025) && Math.abs((c.rgba[3] == null ? 1 : c.rgba[3]) - (rgba[3] == null ? 1 : rgba[3])) <= 0.04) { hit = c; break; }
      }
      if (hit) {
        hit.weight += item.weight; hit.count += item.count;
        for (const t of item.tags) if (hit.roles.indexOf(t) < 0) hit.roles.push(t);
        if (hit.members.length < CAP.member) hit.members.push(item.value);
      } else if (out.length < CAP.palette) out.push({ value: item.value, rgba: rgba, oklab: ok, weight: item.weight, count: item.count, roles: item.tags.slice(), members: [] });
    }
    return out.sort((a, b) => b.weight - a.weight);
  };
  /* ---------- which family actually RENDERED: canvas width differential. The authored stack lies and
       Chrome's per-node used-font data (CDP CSS.getPlatformFontsForNode) is not exposed to this MCP. ---------- */
  const GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont'];
  const fontAvail = (() => {
    const c = safe(() => document.createElement('canvas').getContext('2d'), null, 'fontcanvas');
    const probe = 'mmmMMMWWWiiill@#$%0Og8B', base = {}, cache = new Map();
    if (c) for (const g of ['monospace', 'serif', 'sans-serif']) { c.font = '72px ' + g; base[g] = c.measureText(probe).width; }
    return (fam) => {
      if (!c || !fam) return false;
      const low = String(fam).toLowerCase();
      if (GENERIC.indexOf(low) >= 0) return true;
      if (cache.has(low)) return cache.get(low);
      const q = /^[\w \-]+$/.test(fam) ? '"' + fam + '"' : JSON.stringify(fam);
      let ok = false;
      for (const g of ['monospace', 'serif', 'sans-serif']) { c.font = '72px ' + q + ',' + g; if (Math.abs(c.measureText(probe).width - base[g]) > 0.5) { ok = true; break; } }
      cache.set(low, ok); return ok;
    };
  })();
  const parseStack = (ff) => splitTop(ff || '').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const resolveFamily = (ff) => { const st = parseStack(ff); for (const f of st) if (fontAvail(f)) return f; return st[st.length - 1] || ''; };
  /* `line-height: normal` never computes to px — parseFloat gives 0. Rebuild it from font metrics. */
  const LH_CTX = safe(() => document.createElement('canvas').getContext('2d'), null, 'lhcanvas');
  const LH_CACHE = new Map();
  const usedNormalLH = (cs) => {
    if (!LH_CTX) return null;
    const spec = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if (LH_CACHE.has(spec)) return LH_CACHE.get(spec);
    let v = null;
    safe(() => {
      LH_CTX.font = '10px monospace'; LH_CTX.font = spec; if (LH_CTX.font === '10px monospace') return;
      const tm = LH_CTX.measureText('Hxg'); if (tm.fontBoundingBoxAscent != null) v = r3(tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent);
    }, null, 'lh');
    if (v == null) v = r3(num(cs.fontSize) * 1.2);                        /* documented fallback */
    LH_CACHE.set(spec, v); return v;
  };
  /* ---------- stable paths; survive resize. '::shadow' marks an open shadow-boundary hop ---------- */
  const uniqueId = (id) => safe(() => !!id && document.querySelectorAll('#' + CSS.escape(id)).length === 1, false, 'uniqueId');
  const PATH_CACHE = new WeakMap();
  const pathOf = (el) => {
    if (!el || el.nodeType !== 1) return '';
    if (PATH_CACHE.has(el)) return PATH_CACHE.get(el);
    const parts = []; let n = el, guard = 0;
    while (n && n.nodeType === 1 && guard++ < 14) {
      if (uniqueId(n.id)) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let s = n.localName; const p = n.parentElement;
      if (p) { let i = 0, k = 0; for (const ch of p.children) if (ch.localName === n.localName) { k++; if (ch === n) i = k; } if (k > 1) s += ':nth-of-type(' + i + ')'; }
      parts.unshift(s);
      if (!p) { const rt = n.getRootNode && n.getRootNode(); if (rt && rt.host) { parts.unshift('::shadow'); n = rt.host; continue; } break; }
      n = p;
    }
    const out = parts.join(' > '); PATH_CACHE.set(el, out); return out;
  };
  const resolvePath = (p) => safe(() => {
    const hops = String(p || '').split(' > ::shadow > ');
    let root = document, el = null;
    for (let i = 0; i < hops.length; i++) {
      el = root.querySelector(hops[i]); if (!el) return null;
      if (i < hops.length - 1) { if (!el.shadowRoot) return null; root = el.shadowRoot; }
    } return el;
  }, null, 'resolvePath');
  const absUrl = (u, base) => safe(() => new URL(u, base || location.href).href, u, 'absUrl');
  const parseSrc = (src, base) => {                                       /* resolve @font-face src against the SHEET's href */
    const urls = [], formats = [];
    if (!src) return { urls: urls, formats: formats };
    const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?(?:\s*tech\(\s*([^)]*)\s*\))?/gi;
    let m;
    while ((m = re.exec(src))) {
      const u = m[1] || m[2] || m[3];
      if (u && !/^data:/i.test(u)) urls.push(absUrl(u.trim(), base)); else if (u) urls.push('data:(inline)');
      if (m[4]) formats.push(m[4].trim()); if (m[5]) formats.push('tech:' + m[5].trim());
    } return { urls: urls, formats: formats };
  };
  /* ---------- CSSOM ---------- */
  const SPEC_PROPS = ['grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
    'max-width', 'min-width', 'width', 'max-inline-size', 'inline-size', 'font-size', 'line-height', 'letter-spacing', 'padding', 'padding-top',
    'padding-bottom', 'padding-left', 'padding-right', 'margin', 'margin-top', 'margin-bottom', 'margin-inline', 'gap', 'row-gap', 'column-gap',
    'aspect-ratio', 'border-radius', 'color', 'background-color', 'background-image', 'box-shadow', 'transition', 'animation', 'font-family',
    'font-weight', 'font-variation-settings', 'container-type', 'container-name', 'inset', 'top', 'right', 'bottom', 'left', 'position', 'z-index',
    'height', 'max-height', 'min-height'];
  const INSET_PROPS = ['inset', 'top', 'right', 'bottom', 'left'];
  const SVGNS = 'http://www.w3.org/2000/svg';
  /* Per-call CSSOM state, rebuilt by all() so a second invocation on the same page (the dark pass) never double-counts. */
  let S = null;
  const newState = () => ({ sheets: [], blocked: [], ruleCounts: {}, keyframes: [], fontFaces: [], media: [], containers: [], supports: [],
    layers: [], properties: [], customDecl: [], styleIndex: [], scopes: [], adoptedCount: 0, shadowOpen: 0, shadowSuspectClosed: 0,
    ruleTotal: 0, startingStyle: 0, seenSheets: new Set(), mqCache: new Map() });
  const walkRules = (rules, ctx) => {
    if (!rules) return;
    for (let i = 0; i < rules.length; i++) {
      if (S.ruleTotal++ > CAP.rule) { warn('cap:rules'); return; }
      const rule = safe(() => rules[i], null, 'ruleAccess'); if (!rule) continue;
      const kind = safe(() => rule.constructor.name, 'Unknown', 'ctor');  /* numeric rule.type is 0 for @layer/@container/@property */
      S.ruleCounts[kind] = (S.ruleCounts[kind] || 0) + 1;
      if (kind === 'CSSStyleRule') {
        const sel = safe(() => rule.selectorText, '', 'sel') || '', st = rule.style;
        if (st) {
          const decl = {};
          for (let j = 0; j < st.length; j++) {
            const p = st.item(j); if (!p) continue;
            if (p.slice(0, 2) === '--') {
              const v = T(safe(() => st.getPropertyValue(p).trim(), '', 'customProp'), 160);
              if (S.customDecl.length < CAP.decl) S.customDecl.push({ name: p, selector: T(sel, 120), value: v });
              decl[p] = v;
            } else if (SPEC_PROPS.indexOf(p) >= 0) decl[p] = T(safe(() => st.getPropertyValue(p).trim(), '', 'specProp'), 300);
          }
          if (sel.indexOf('&') >= 0) warn('cssom:nested-selector-not-indexed');
          else if (Object.keys(decl).length && S.styleIndex.length < CAP.idx) S.styleIndex.push({ sel: sel, decl: decl, media: ctx.media, container: ctx.container });
        }
        if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, ctx);   /* CSS Nesting: style rules are not leaves */
      } else if (kind === 'CSSMediaRule') {
        const cond = safe(() => rule.conditionText || rule.media.mediaText, '', 'mediaCond') || '';
        S.media.push(cond);
        walkRules(rule.cssRules, { media: ctx.media ? ctx.media + ' and ' + cond : cond, container: ctx.container, href: ctx.href });
      } else if (kind === 'CSSContainerRule') {
        const q = safe(() => rule.containerQuery || rule.conditionText, '', 'containerQuery') || '';
        S.containers.push({ name: safe(() => rule.containerName, '', 'containerName') || null, query: T(q, 160) });
        walkRules(rule.cssRules, { media: ctx.media, container: q, href: ctx.href });
      } else if (kind === 'CSSSupportsRule') {
        const cond = safe(() => rule.conditionText, '', 'supportsCond') || '';
        if (S.supports.indexOf(cond) < 0) S.supports.push(cond);
        walkRules(rule.cssRules, ctx);
      } else if (kind === 'CSSLayerBlockRule') {
        const n = safe(() => rule.name, '', 'layerName');
        if (n && S.layers.indexOf(n) < 0) S.layers.push(n);
        walkRules(rule.cssRules, ctx);
      } else if (kind === 'CSSLayerStatementRule') {
        for (const n of safe(() => Array.from(rule.nameList), [], 'layerList')) if (S.layers.indexOf(n) < 0) S.layers.push(n);
      } else if (kind === 'CSSScopeRule') {
        S.scopes.push(T(safe(() => (rule.start || '') + ' to ' + (rule.end || ''), '', 'scope'), 160));
        walkRules(rule.cssRules, ctx);
      } else if (kind === 'CSSStartingStyleRule') {
        S.startingStyle++; walkRules(rule.cssRules, ctx);
      } else if (kind === 'CSSFontFaceRule') {
        const st = rule.style, gv = (p) => safe(() => (st ? st.getPropertyValue(p).trim() : ''), '', 'fontFaceDesc');
        const parsed = parseSrc(gv('src'), ctx.href), weight = gv('font-weight') || '400';
        S.fontFaces.push({ family: gv('font-family').replace(/^["']|["']$/g, ''), weight: weight, style: gv('font-style') || 'normal',
          stretch: gv('font-stretch') || '', unicodeRange: T(gv('unicode-range'), 300) || null, display: gv('font-display') || 'auto',
          featureSettings: gv('font-feature-settings'), variationSettings: gv('font-variation-settings'), sizeAdjust: gv('size-adjust') || null,
          ascentOverride: gv('ascent-override') || null, descentOverride: gv('descent-override') || null, status: null,
          isVariable: /\s/.test(weight.trim()) || /variations/i.test(parsed.formats.join(' ')), source: 'cssom',
          srcUrls: parsed.urls.slice(0, 6), formats: parsed.formats.slice(0, 6), sheetHref: ctx.href || null });
      } else if (kind === 'CSSKeyframesRule') {
        if (S.keyframes.length < CAP.kf) {
          const steps = [], kfs = safe(() => rule.cssRules, [], 'keyframeList') || [];
          for (let j = 0; j < kfs.length && steps.length < CAP.kfStep; j++) steps.push({ offset: safe(() => kfs[j].keyText, '', 'keyText'), decl: T(safe(() => kfs[j].style.cssText, '', 'keyDecl'), 400) });
          S.keyframes.push({ name: safe(() => rule.name, '', 'keyframeName'), steps: steps });
        }
      } else if (kind === 'CSSPropertyRule') {
        S.properties.push({ name: safe(() => rule.name, '', 'propName'), syntax: safe(() => rule.syntax, '', 'propSyntax'), inherits: safe(() => !!rule.inherits, null, 'propInherits'), initialValue: T(safe(() => rule.initialValue, '', 'propInitial'), 120) });
      } else if (kind === 'CSSImportRule') {
        const s = safe(() => rule.styleSheet, null, 'import');            /* may be null (loading) or throw (cross-origin) */
        if (s) readSheet(s, safe(() => s.href, ctx.href, 'importHref'));
      } else if (rule.cssRules) walkRules(rule.cssRules, ctx);
    }
  };
  const readSheet = (sheet, hrefHint) => {
    if (!sheet || S.seenSheets.has(sheet) || S.sheets.length >= CAP.sheet) return;
    S.seenSheets.add(sheet);
    const href = safe(() => sheet.href, null, 'sheetHref') || hrefHint || null;
    let rules = null, err = null;
    try { rules = sheet.cssRules; } catch (e) { err = (e && e.name) || 'Error'; }   /* cross-origin without CORS -> SecurityError */
    const origin = href && /^https?:|^\/\//.test(href) ? safe(() => new URL(href, location.href).origin, '?', 'origin') : (href || 'inline');
    const media = safe(() => (sheet.media && sheet.media.mediaText) || '', '', 'sheetMedia');
    S.sheets.push({ href: href, origin: origin, readable: !err, ruleCount: rules ? rules.length : 0, media: media, disabled: safe(() => !!sheet.disabled, false, 'sheetDisabled') });
    if (err) { S.blocked.push({ href: href, error: err }); warn('cssom:blocked:' + origin); return; }
    /* Thread sheet-level media down: a recovery shim injected with media="not all" contributes
       @font-face / @keyframes / breakpoints WITHOUT polluting the live specified-value index. */
    walkRules(rules, { media: media && media !== 'all' ? media : '', container: '', href: href || location.href });
  };
  const mqMatches = (cond) => {
    if (!cond) return true;
    if (S.mqCache.has(cond)) return S.mqCache.get(cond);
    const v = safe(() => window.matchMedia(cond).matches, true, 'matchMedia'); S.mqCache.set(cond, v); return v;
  };
  /* Authored ("specified") values. getComputedStyle returns USED values: repeat(3,1fr) is gone, clamp() is
     one number, `auto` insets are px. This index is the only way back. It orders by source position, not by
     the specificity cascade — right ~95% of the time; verify recovered values against measured geometry. */
  const specifiedFor = (el, props) => {
    const out = {};
    for (const rec of S.styleIndex) {
      let hit = false;
      for (const p of props) if (rec.decl[p] != null) { hit = true; break; }
      if (!hit || !mqMatches(rec.media) || !safe(() => el.matches(rec.sel), false, 'matches')) continue;
      for (const p of props) if (rec.decl[p] != null) out[p] = rec.decl[p];
    }
    for (const p of props) { const v = safe(() => el.style.getPropertyValue(p), '', 'inlineStyle'); if (v) out[p] = T(v, 300); }
    return out;
  };
  const specStr = (el, props) => {
    const o = specifiedFor(el, props), parts = [];
    for (const p of props) if (o[p]) parts.push(p + ': ' + o[p]); return parts.length ? T(parts.join('; '), 200) : null;
  };
  const stackingReasons = (el, cs) => {
    const R = [], zi = cs.zIndex;
    if (cs.position === 'fixed') R.push('position:fixed');
    if (zi !== 'auto' && ['relative', 'absolute', 'sticky'].indexOf(cs.position) >= 0) R.push('position+z-index');
    if (zi !== 'auto') { const p = el.parentElement; if (p && /flex|grid/.test(safe(() => getComputedStyle(p).display, '', 'parentDisplay'))) R.push('flex/grid child + z-index'); }
    if (num(cs.opacity) < 1) R.push('opacity<1');
    for (const p of ['transform', 'rotate', 'scale', 'translate', 'perspective', 'filter', 'backdropFilter', 'clipPath', 'maskImage', 'offsetPath', 'viewTransitionName']) {
      const v = cs[p];
      if (!v || v === 'none' || v === 'normal' || v === 'matrix(1, 0, 0, 1, 0, 0)') continue;
      if (p === 'viewTransitionName' && v === 'root' && el === document.documentElement) continue;   /* Chrome sets this itself */
      R.push(p + ':' + T(String(v), 40));
    }
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') R.push('mix-blend-mode');
    if (cs.isolation === 'isolate') R.push('isolation');
    if (cs.willChange && cs.willChange !== 'auto') R.push('will-change:' + T(cs.willChange, 40));
    if (cs.contain && /layout|paint|strict|content/.test(cs.contain)) R.push('contain:' + cs.contain);
    if (cs.contentVisibility && cs.contentVisibility !== 'visible') R.push('content-visibility');
    return R;
  };
  const LANDMARK = { HEADER: 1, NAV: 1, MAIN: 1, ASIDE: 1, FOOTER: 1, SECTION: 1, ARTICLE: 1, FORM: 1, DIALOG: 1 };
  const TYPE_ROLES = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, P: 1, LI: 1, A: 1, BUTTON: 1, LABEL: 1, SMALL: 1, CODE: 1, PRE: 1, BLOCKQUOTE: 1, TH: 1, TD: 1, INPUT: 1, SUMMARY: 1, FIGCAPTION: 1, DT: 1, DD: 1, STRONG: 1, EM: 1, SPAN: 1 };
  const SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1, BR: 1, PARAM: 1, SOURCE: 1, TRACK: 1 };
  const FP_SEL = 'header,nav,main,footer,section,h1,h2,h3,button,a[class],[class*=hero],[class*=cta]';
  const fingerprintOf = () => {
    const out = [];
    for (const el of safe(() => Array.from(document.querySelectorAll(FP_SEL)).slice(0, CAP.fp), [], 'fpSelect')) {
      const cs = safe(() => getComputedStyle(el), null, 'fpStyle'); if (!cs || cs.display === 'none') continue;
      const r = safe(() => el.getBoundingClientRect(), null, 'fpRect'); if (!r) continue;
      let tw = null;
      safe(() => { const rg = document.createRange(); rg.selectNodeContents(el); tw = r2(rg.getBoundingClientRect().width); if (rg.detach) rg.detach(); }, null, 'range');
      out.push({ path: pathOf(el), tag: el.tagName.toLowerCase(), rect: box(r, window.scrollY), fontFamily: T(cs.fontFamily, 160),
        resolvedFamily: resolveFamily(cs.fontFamily), fontSizePx: r3(num(cs.fontSize)), fontWeight: cs.fontWeight,
        lineHeightPx: cs.lineHeight === 'normal' ? usedNormalLH(cs) : r3(num(cs.lineHeight)), color: cs.color, bg: cs.backgroundColor,
        textLen: safe(() => el.textContent.trim().length, 0, 'textLen'), textHead: T(safe(() => el.textContent.trim().replace(/\s+/g, ' '), '', 'textHead'), 80), textWidthPx: tw });
    }
    return out;
  };
  /* getPropertyValue('--x') returns the computed TOKEN STREAM: var() substituted but not type-computed,
     so `1rem` stays `1rem`. Exactly what token emission wants. */
  const varsOf = (rootCS) => {
    const out = [], seen = new Set();
    for (let i = 0; i < rootCS.length && i < 5000; i++) {
      const p = rootCS.item(i);
      if (p && p.slice(0, 2) === '--' && !seen.has(p)) { seen.add(p); out.push({ name: p, value: T(safe(() => rootCS.getPropertyValue(p).trim(), '', 'rootVar'), 160), scope: ':root' }); }
    }
    for (const d of S.customDecl) {
      if (seen.has(d.name) || out.length >= CAP.vars) continue;
      seen.add(d.name);
      const v = safe(() => rootCS.getPropertyValue(d.name).trim(), '', 'rootVar2');
      if (v) { out.push({ name: d.name, value: T(v, 160), scope: ':root' }); continue; }
      const host = safe(() => document.querySelector(d.selector), null, 'varHost'), hv = host ? safe(() => getComputedStyle(host).getPropertyValue(d.name).trim(), '', 'hostVar') : '';
      out.push({ name: d.name, value: hv ? T(hv, 160) : d.value, scope: hv ? T(d.selector, 100) : T(d.selector, 100) + ' (declared)' });
    }
    return out;
  };
  /* ================= the foundation pass ================= */
  const all = async () => {
    W = []; S = newState();
    try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch (e) { warn('fontsReady'); }
    const vw = window.innerWidth, vh = window.innerHeight;
    const rootCS = getComputedStyle(document.documentElement), rootFS = num(rootCS.fontSize) || 16;
    for (const s of safe(() => Array.from(document.styleSheets), [], 'styleSheets')) readSheet(s);
    /* constructed sheets are always readable and never appear in document.styleSheets */
    for (const s of safe(() => Array.from(document.adoptedStyleSheets || []), [], 'adopted')) { S.adoptedCount++; readSheet(s, 'constructed:document'); }
    const nodes = [], hosts = [];
    const collect = (root, depth) => {
      const w = safe(() => document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: (e) => (SKIP_TAG[e.tagName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) }), null, 'treeWalker');
      if (!w) return;
      let cur = w.currentNode && w.currentNode.nodeType === 1 ? w.currentNode : w.nextNode();
      while (cur && nodes.length < CAP.el) {
        nodes.push({ el: cur, sd: depth });
        if (cur.shadowRoot) { S.shadowOpen++; if (depth < 3) hosts.push({ r: cur.shadowRoot, d: depth + 1 }); }
        else if (cur.tagName.indexOf('-') > 0 && !cur.children.length && !cur.textContent.trim()) S.shadowSuspectClosed++;  /* possible CLOSED root: unreachable */
        cur = w.nextNode();
      }
    };
    collect(document, 0);
    for (let i = 0; i < hosts.length && nodes.length < CAP.el; i++) {
      for (const s of safe(() => Array.from(hosts[i].r.adoptedStyleSheets || []), [], 'shadowAdopted')) { S.adoptedCount++; readSheet(s, 'constructed:shadow'); }
      for (const st of safe(() => Array.from(hosts[i].r.querySelectorAll('style')), [], 'shadowStyle')) readSheet(safe(() => st.sheet, null, 'shadowSheet'), 'shadow:style');
      collect(hosts[i].r, hosts[i].d);
    }
    if (nodes.length >= CAP.el) warn('cap:elements');
    const C = { text: mk(), background: mk(), border: mk(), fill: mk(), stroke: mk(), outline: mk(), other: mk() };
    const gradients = mk(), shBox = mk(), shText = mk(), shDrop = mk(), radii = mk(), borders = mk(), outlines = mk();
    const transitions = mk(), animations = mk(), easings = mk(), durations = mk(), effects = mk();
    /* per-node visual effects: the census below is pathless, and a glass panel is unbuildable without its path */
    const effectNodes = [], EFFECT_CAP = 80;
    const spaceVals = mk(), maxWidths = mk(), contentW = mk(), typeRoles = mk(), typeSizes = mk(), featSet = mk(), varSet = mk();
    const fontUse = new Map(), zLadder = new Map();
    const tree = [], landmarks = [], stacking = [], sticky = [], fixed = [], scrollers = [], containerTypes = [];
    const grids = [], flexes = [], pseudos = [], images = [], backgrounds = [], videos = [], svgInline = [], svgUse = [], timelines = [];
    let snapChildren = 0, idx = 0;
    for (const rec of nodes) {
      const el = rec.el; idx++;
      const cs = safe(() => getComputedStyle(el), null, 'computedStyle'); if (!cs) continue;
      const r = safe(() => el.getBoundingClientRect(), null, 'rect') || { width: 0, height: 0, top: 0, left: 0 };
      const area = Math.max(0, Math.min(r.width, vw * 1.5)) * Math.max(0, Math.min(r.height, 4000));
      const painted = cs.display !== 'none' && cs.visibility !== 'hidden' && num(cs.opacity) > 0.01;
      const tag = el.tagName, isSVG = el.namespaceURI === SVGNS, par = el.parentElement;
      const ownText = safe(() => { let n = 0; for (const c of el.childNodes) if (c.nodeType === 3) n += c.nodeValue.trim().length; return n; }, 0, 'ownText');
      if (painted) {
        const fs = num(cs.fontSize) || 16, per = 2 * (r.width + r.height);
        if (ownText) bump(C.text, cs.color, ownText * fs, 'text');        /* ink weight = char-area proxy, not occurrences */
        bump(C.background, cs.backgroundColor, area, 'background');       /* surface weight = painted area */
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          const bw = num(cs['border' + side + 'Width']);
          if (bw > 0 && cs['border' + side + 'Style'] !== 'none') {
            bump(C.border, cs['border' + side + 'Color'], per * bw * 0.25, 'border');
            bump(borders, bw + 'px ' + cs['border' + side + 'Style'] + ' ' + cs['border' + side + 'Color'], per * bw * 0.25, side.toLowerCase());
          }
        }
        if (num(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') { bump(C.outline, cs.outlineColor, per, 'outline'); bump(outlines, cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor, per); }
        /* `fill`/`stroke` are inherited and initial `fill` is black, so they apply to EVERY element.
           Unguarded, rgb(0,0,0) outranks the brand color by orders of magnitude. Gate on the SVG ns. */
        if (isSVG) { bump(C.fill, cs.fill, area, 'fill'); bump(C.stroke, cs.stroke, area, 'stroke'); }
        if (ownText && cs.textDecorationColor !== cs.color) bump(C.other, cs.textDecorationColor, ownText, 'text-decoration');
        if (cs.caretColor !== cs.color) bump(C.other, cs.caretColor, 1, 'caret');
        bump(C.other, cs.accentColor, 1, 'accent');
        if (cs.backgroundImage && cs.backgroundImage !== 'none') for (const layer of splitTop(cs.backgroundImage)) {
          if (/gradient\(/i.test(layer)) {
            bump(gradients, layer, area, /repeating/i.test(layer) ? 'repeating' : String((/(radial|conic)/i.exec(layer) || ['linear'])[0]).toLowerCase());
            for (const c of pickColors(layer)) bump(C.background, c, area * 0.4, 'gradient-stop');
          } else if (/url\(/i.test(layer) && backgrounds.length < CAP.asset) {
            const u = (/url\(\s*["']?([^"')]+)/i.exec(layer) || [])[1];
            if (u && !/^data:/i.test(u)) backgrounds.push({ path: pathOf(el), url: T(absUrl(u), 300), size: cs.backgroundSize, position: cs.backgroundPosition, repeat: cs.backgroundRepeat, attachment: cs.backgroundAttachment, rect: box(r, window.scrollY) });
          }
        }
        /* Chrome serializes shadows COLOR FIRST: "rgba(0,0,0,.1) 0px 1px 2px 0px". Split at top level. */
        if (cs.boxShadow && cs.boxShadow !== 'none') for (const s of splitTop(cs.boxShadow)) { bump(shBox, s, area); for (const c of pickColors(s)) bump(C.other, c, area * 0.1, 'shadow'); }
        if (cs.textShadow && cs.textShadow !== 'none') for (const s of splitTop(cs.textShadow)) bump(shText, s, ownText || 1);
        if (cs.filter && /drop-shadow\(/i.test(cs.filter)) for (const s of (cs.filter.match(/drop-shadow\([^()]*(?:\([^()]*\)[^()]*)*\)/gi) || [])) bump(shDrop, s, area || 1);
      }
      const rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
      if (rad.some((v) => v && v !== '0px')) { bump(radii, rad.join(' '), area, 'set'); for (const v of rad) if (v && v !== '0px') bump(radii, v, area * 0.25, 'corner'); }
      if ((cs.transitionProperty && cs.transitionProperty !== 'all') || (cs.transitionDuration && cs.transitionDuration !== '0s')) {
        const props = splitTop(cs.transitionProperty), durs = splitTop(cs.transitionDuration), eas = splitTop(cs.transitionTimingFunction), dels = splitTop(cs.transitionDelay);
        for (let i = 0; i < props.length && i < 8; i++) {                /* zip 4 parallel lists; the shortest cycles, per spec */
          const d = durs.length ? durs[i % durs.length] : '0s'; if (!d || d === '0s') continue;
          const e = (eas.length ? eas[i % eas.length] : 'ease') || 'ease';
          bump(transitions, props[i] + ' ' + d + ' ' + e + ' ' + ((dels.length ? dels[i % dels.length] : '0s') || '0s'), area || 1);
          bump(durations, d, 1); bump(easings, e, 1);
        }
      }
      if (cs.animationName && cs.animationName !== 'none') {
        const names = splitTop(cs.animationName), durs = splitTop(cs.animationDuration), eas = splitTop(cs.animationTimingFunction);
        for (let i = 0; i < names.length && i < 6; i++) {
          const d = (durs.length ? durs[i % durs.length] : '') || '', e = (eas.length ? eas[i % eas.length] : '') || '';
          bump(animations, names[i] + ' ' + d + ' ' + e + ' ' + cs.animationIterationCount + ' ' + cs.animationFillMode, area || 1);
          if (e) bump(easings, e, 1);
          if (d) bump(durations, d, 1);
        }
      }
      const atl = safe(() => cs.getPropertyValue('animation-timeline').trim(), '', 'animationTimeline');
      if (atl && atl !== 'auto' && atl !== 'none' && timelines.length < CAP.node) {
        const rg = safe(() => cs.getPropertyValue('animation-range').trim(), '', 'animationRange'), vt = safe(() => cs.getPropertyValue('view-timeline-name').trim(), '', 'viewTimeline');
        timelines.push(T(pathOf(el) + ' | animation-timeline: ' + atl + (rg ? ' | animation-range: ' + rg : '') + (vt && vt !== 'none' ? ' | view-timeline-name: ' + vt : ''), 220));
      }
      /* effects census; NOISE strips identity transforms (left behind by animation-fill-mode) and defaults */
      const NOISE = { 'matrix(1, 0, 0, 1, 0, 0)': 1, 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)': 1, none: 1, normal: 1, auto: 1, visible: 1, 'horizontal-tb': 1, fill: 1, wrap: 1, '0px': 1 };
      const PATHED = { filter: 1, backdropFilter: 1, mixBlendMode: 1, clipPath: 1, maskImage: 1 };
      for (const p of ['transform', 'rotate', 'scale', 'translate', 'filter', 'backdropFilter', 'mixBlendMode', 'clipPath', 'maskImage', 'isolation', 'willChange', 'contain', 'contentVisibility', 'perspective', 'viewTransitionName', 'anchorName', 'textWrap', 'writingMode', 'objectFit', 'aspectRatio', 'backfaceVisibility', 'textRendering', 'paintOrder']) {
        const v = cs[p]; if (!v || NOISE[v]) continue;
        if (p === 'viewTransitionName' && v === 'root' && el === document.documentElement) continue;
        bump(effects, p + ':' + T(String(v), 90), area || 1);
        /* the five that make or break a clone and cannot be inferred from a screenshot: keep the path + value */
        if (PATHED[p]) { if (effectNodes.length < EFFECT_CAP) effectNodes.push({ path: pathOf(el), prop: p, value: T(String(v), 160), area: r2(area || 0) }); else warn('cap:effectNodes'); }
      }
      if (cs.containerType && cs.containerType !== 'normal' && containerTypes.length < 24) containerTypes.push({ path: pathOf(el), type: cs.containerType, name: cs.containerName || null });
      if (cs.fontFeatureSettings && cs.fontFeatureSettings !== 'normal') bump(featSet, cs.fontFeatureSettings, ownText || 1);
      if (cs.fontVariationSettings && cs.fontVariationSettings !== 'normal') bump(varSet, cs.fontVariationSettings, ownText || 1);
      if (cs.scrollSnapAlign && cs.scrollSnapAlign !== 'none') snapChildren++;
      /* spacing: authored spacing props only, only (0,400]. Rect dimensions are layout OUTCOMES, not decisions. */
      for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap']) {
        const v = num(cs[p]); if (v > 0 && v <= 400) bump(spaceVals, String(Math.round(v * 2) / 2), 1, p);
      }
      if (cs.maxWidth && cs.maxWidth !== 'none') bump(maxWidths, cs.maxWidth, area || 1);
      if (painted && par && r.width > 200) {
        const pr = safe(() => par.getBoundingClientRect(), null, 'parentRect');
        if (pr && pr.width - r.width > 24 && /block|flow-root|flex|grid/.test(cs.display)) bump(contentW, String(Math.round(r.width)), r.height || 1);
      }
      if (ownText >= 2 && painted && (TYPE_ROLES[tag] || (par && num(safe(() => getComputedStyle(par).fontSize, '', 'parentFontSize')) !== num(cs.fontSize)))) {
        const fsp = num(cs.fontSize), lsp = num(cs.letterSpacing), lhNorm = cs.lineHeight === 'normal';
        const lhp = lhNorm ? (usedNormalLH(cs) || 0) : num(cs.lineHeight);
        bump(typeRoles, [TYPE_ROLES[tag] ? tag.toLowerCase() : 'other', r3(fsp), cs.fontWeight, r3(fsp && lhp ? lhp / fsp : 0), r3(fsp ? lsp / fsp : 0),
          cs.textTransform, bar(T(cs.fontFamily, 90)), resolveFamily(cs.fontFamily), cs.fontStyle, bar(cs.fontVariationSettings),
          lhNorm ? '1' : '0', cs.letterSpacing === 'normal' ? '1' : '0'].join('|'), ownText, pathOf(el));
        bump(typeSizes, String(r3(fsp)), ownText, TYPE_ROLES[tag] ? tag.toLowerCase() : 'other');
      }
      if (ownText && painted) {
        const rf = resolveFamily(cs.fontFamily);
        let u = fontUse.get(rf);
        if (!u) { const st = parseStack(cs.fontFamily); u = { family: rf, stackHead: st[0] || '', stack: st.slice(0, 6), count: 0, charWeight: 0, weights: [], styles: [], samplePaths: [] }; fontUse.set(rf, u); }
        u.count++; u.charWeight += ownText;
        if (u.weights.indexOf(cs.fontWeight) < 0) u.weights.push(cs.fontWeight);
        if (u.styles.indexOf(cs.fontStyle) < 0) u.styles.push(cs.fontStyle);
        if (u.samplePaths.length < 4) u.samplePaths.push(pathOf(el));
      }
      const reasons = painted ? stackingReasons(el, cs) : [];
      if (reasons.length && stacking.length < CAP.list) stacking.push({ path: pathOf(el), tag: tag.toLowerCase(), zIndex: cs.zIndex, reasons: reasons.slice(0, 5) });
      if (cs.zIndex !== 'auto') {
        const z = parseInt(cs.zIndex, 10);
        if (Number.isFinite(z)) { let e2 = zLadder.get(z); if (!e2) { e2 = { z: z, count: 0, owners: [] }; zLadder.set(z, e2); } e2.count++; if (e2.owners.length < 4) e2.owners.push(pathOf(el)); }
      }
      /* Computed top/right/bottom/left are USED px even where `auto` was authored. Copying them pins a
         bottom-right FAB to hard top/left coords. Emit the authored pair; keep `usedInset` as evidence only. */
      if (cs.position === 'sticky' && sticky.length < CAP.node) sticky.push({ path: pathOf(el), usedInset: [cs.top, cs.right, cs.bottom, cs.left].join(' '), authoredInset: specStr(el, INSET_PROPS), zIndex: cs.zIndex, backdropFilter: cs.backdropFilter, bg: cs.backgroundColor, height: r2(r.height) });
      if (cs.position === 'fixed' && fixed.length < CAP.node) fixed.push({ path: pathOf(el), usedInset: [cs.top, cs.right, cs.bottom, cs.left].join(' '), authoredInset: specStr(el, INSET_PROPS), zIndex: cs.zIndex, backdropFilter: cs.backdropFilter, rect: box(r, window.scrollY) });
      if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && scrollers.length < CAP.node) {
        const sh = el.scrollHeight, ch = el.clientHeight, sw = el.scrollWidth, cw = el.clientWidth, ox = sw > cw + 2, oy = sh > ch + 2;
        if (ox || oy) scrollers.push({ path: pathOf(el), overflow: cs.overflowX + '/' + cs.overflowY, axis: ox && oy ? 'both' : (ox ? 'x' : 'y'), scrollSize: ox ? sw : sh, clientSize: ox ? cw : ch, snapType: cs.scrollSnapType, behavior: cs.scrollBehavior });
      }
      if (/(^|inline-)grid$/.test(cs.display) && grids.length < CAP.grid) {
        const sp = specifiedFor(el, ['grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow']);
        grids.push({ path: pathOf(el), computedColumns: T(cs.gridTemplateColumns, 300), authoredColumns: sp['grid-template-columns'] || null,
          computedRows: T(cs.gridTemplateRows, 200), authoredRows: sp['grid-template-rows'] || null, areas: T(cs.gridTemplateAreas, 300) || null,
          gapPx: r2(num(cs.columnGap) || num(cs.rowGap)), autoFlow: cs.gridAutoFlow, itemCount: el.children.length, rect: box(r, window.scrollY) });
      }
      if (/(^|inline-)flex$/.test(cs.display) && flexes.length < CAP.grid && el.children.length > 1) flexes.push({ path: pathOf(el), direction: cs.flexDirection, wrap: cs.flexWrap, justify: cs.justifyContent, align: cs.alignItems, gapPx: r2(num(cs.columnGap) || num(cs.rowGap)), childCount: el.children.length });
      if (idx <= CAP.pseudo && pseudos.length < CAP.grid) for (const ps of ['::before', '::after']) {
        const pcs = safe(() => getComputedStyle(el, ps), null, 'pseudoStyle'); if (!pcs) continue;
        if (pcs.content && pcs.content !== 'none' && pcs.content !== 'normal') pseudos.push({ path: pathOf(el), pseudo: ps, content: T(pcs.content, 120),
          decl: T([['width', pcs.width], ['height', pcs.height], ['background-color', pcs.backgroundColor], ['background-image', pcs.backgroundImage],
            ['position', pcs.position], ['inset', [pcs.top, pcs.right, pcs.bottom, pcs.left].join(' ')], ['transform', pcs.transform], ['color', pcs.color],
            ['mask-image', pcs.maskImage], ['clip-path', pcs.clipPath]].filter((x) => x[1] && x[1] !== 'none' && x[1] !== 'auto' && x[1] !== 'auto auto auto auto').map((x) => x[0] + ': ' + x[1]).join('; '), 300) });
      }
      /* Structural tree. isSection must NOT require full-bleed width: most sections are max-width-constrained,
         and a width test collapses a 7-section page to 1. fullBleed stays a separate flag. */
      let depth = 0; for (let p2 = par; p2 && depth < 40; p2 = p2.parentElement) depth++;
      const pp = par && par.parentElement;
      const shellParent = !!par && (par === document.body || par.tagName === 'MAIN' || (!!pp && (pp === document.body || pp.tagName === 'MAIN') && pp.children.length === 1 && par.children.length >= 3));
      const isSection = painted && shellParent && r.height >= 160 && tag !== 'MAIN' && tag !== 'BODY';
      if (tree.length < CAP.tree && (LANDMARK[tag] || isSection || (painted && r.height >= 64 && depth <= 6) || reasons.length)) tree.push({ path: pathOf(el),
        tag: tag.toLowerCase(), role: el.getAttribute('role') || null, id: el.id || null, classes: safe(() => Array.from(el.classList).slice(0, 3), [], 'classList'),
        depth: depth, rect: box(r, window.scrollY), childCount: el.children.length, textHead: T(safe(() => el.textContent.trim().replace(/\s+/g, ' '), '', 'treeText'), 100),
        display: cs.display, position: cs.position, isSection: isSection, fullBleed: painted && r.width >= vw * 0.98,
        createsStackingContext: reasons.length > 0, ariaLabel: el.getAttribute('aria-label') || null, shadowDepth: rec.sd });
      if (LANDMARK[tag] && landmarks.length < CAP.grid) landmarks.push({ path: pathOf(el), role: el.getAttribute('role') || tag.toLowerCase(), label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || null });
      if (tag === 'IMG' && images.length < CAP.asset) images.push({ path: pathOf(el), src: T(el.getAttribute('src') || '', 300), currentSrc: T(el.currentSrc || '', 300),
        srcset: T(el.getAttribute('srcset') || '', 400) || null, sizes: T(el.getAttribute('sizes') || '', 200) || null, alt: T(el.getAttribute('alt') == null ? '' : el.getAttribute('alt'), 160),
        naturalW: el.naturalWidth, naturalH: el.naturalHeight, renderedW: r2(r.width), renderedH: r2(r.height), loading: el.loading || 'eager',
        decoding: el.decoding || 'auto', objectFit: cs.objectFit, objectPosition: cs.objectPosition, isAboveFold: r.top < vh && r.top + r.height > 0 });
      if ((tag === 'VIDEO' || tag === 'AUDIO') && videos.length < 30) videos.push({ path: pathOf(el), src: T(el.getAttribute('src') || '', 300) || null,
        poster: T(el.getAttribute('poster') || '', 300) || null, sources: safe(() => Array.from(el.querySelectorAll('source')).slice(0, 4).map((s) => T(absUrl(s.getAttribute('src') || ''), 300)), [], 'videoSources'),
        autoplay: !!el.autoplay, loop: !!el.loop, muted: !!el.muted });
      if (isSVG && el.localName === 'svg' && svgInline.length < CAP.grid) svgInline.push({ path: pathOf(el), viewBox: el.getAttribute('viewBox') || null, width: r2(r.width), height: r2(r.height), pathCount: safe(() => el.querySelectorAll('path,circle,rect,polygon,line,ellipse,polyline').length, 0, 'svgPaths') });
      if (isSVG && el.localName === 'use' && svgUse.length < CAP.node) { const h = el.getAttribute('href') || el.getAttribute('xlink:href'); if (h) svgUse.push(T(h, 200)); }
    }
    /* --- fonts, three-source join: CSSOM has src + descriptors, FontFaceSet has status (and no src),
           list_network_requests({resourceTypes:["font"]}) has the files actually fetched. --- */
    const fsFaces = [];
    safe(() => document.fonts.forEach((f) => { if (fsFaces.length < 80) fsFaces.push({ family: String(f.family).replace(/^["']|["']$/g, ''), weight: f.weight,
      style: f.style, stretch: f.stretch || '', unicodeRange: T(f.unicodeRange, 300) || null, display: f.display || 'auto', featureSettings: f.featureSettings || '',
      variationSettings: f.variationSettings || '', sizeAdjust: f.sizeAdjust || null, ascentOverride: f.ascentOverride || null,
      descentOverride: f.descentOverride || null, status: f.status, isVariable: /\s/.test(String(f.weight).trim()) }); }), null, 'fontFaceSet');
    const faceKey = (f) => (f.family || '').toLowerCase() + '|' + f.weight + '|' + f.style + '|' + T(f.unicodeRange || '', 60);
    const faces = new Map();
    for (const f of S.fontFaces) faces.set(faceKey(f), f);
    for (const f of fsFaces) {
      const k = faceKey(f), prev = faces.get(k);
      if (prev) { prev.source = 'both'; prev.status = f.status; if (!prev.isVariable) prev.isVariable = f.isVariable; }
      else faces.set(k, Object.assign({ source: 'fontfaceset', srcUrls: [], formats: [], sheetHref: null }, f));
    }
    const faceList = [...faces.values()].slice(0, 80);
    const webFamilies = new Set(faceList.map((f) => (f.family || '').toLowerCase()));
    const usage = [...fontUse.values()].sort((a, b) => b.charWeight - a.charWeight).slice(0, 40).map((u) => ({ resolvedFamily: u.family, stackHead: u.stackHead,
      stack: u.stack, isWebfont: webFamilies.has(u.family.toLowerCase()), availableLocally: fontAvail(u.family),
      checkPasses: safe(() => document.fonts.check('400 16px "' + u.family + '"', 'Aa Bb 123'), null, 'fontsCheck'), count: u.count,
      charWeight: u.charWeight, weights: u.weights, styles: u.styles, samplePaths: u.samplePaths }));
    const synthesisRisk = [];
    for (const u of usage) {
      if (!u.isWebfont) continue;
      const have = new Set();
      for (const f of faceList) if ((f.family || '').toLowerCase() === u.resolvedFamily.toLowerCase()) { if (/\s/.test(String(f.weight).trim())) have.add('variable'); else have.add(String(parseInt(f.weight, 10) || 400)); }
      if (have.has('variable')) continue;
      for (const w of u.weights) { const wn = String(parseInt(w, 10) || 400);
        if (!have.has(wn) && synthesisRisk.length < 20) synthesisRisk.push(u.resolvedFamily + ' @' + wn + ' requested, declared: ' + ([...have].join(',') || 'none') + ' — browser will synthesize'); }
    }
    /* --- breakpoints + media features. Both syntaxes; em/rem in a media query is ALWAYS relative to the
           initial font size (16px), never to :root — one of the few places 16 is guaranteed. --- */
    const bpCount = new Map(), feat = new Map();
    for (const cond of S.media) {
      if (/width/i.test(cond)) {
        const re = /(\d*\.?\d+)\s*(px|r?em)/g; let m;
        while ((m = re.exec(cond))) {
          const key = Math.round(m[2] === 'px' ? parseFloat(m[1]) : parseFloat(m[1]) * 16);
          let e2 = bpCount.get(key); if (!e2) { e2 = { px: key, count: 0, conditions: [] }; bpCount.set(key, e2); }
          e2.count++; if (e2.conditions.length < 3) e2.conditions.push(T(cond, 90)); }
      }
      const hit = [];
      for (const f of ['prefers-color-scheme', 'prefers-reduced-motion', 'prefers-reduced-transparency', 'prefers-contrast', 'any-hover', 'any-pointer', 'hover', 'pointer', 'orientation', 'print', 'screen', 'forced-colors', 'resolution', 'scripting', 'display-mode', 'aspect-ratio', 'height', 'monochrome', 'inverted-colors']) {
        if (new RegExp('(?:^|[\\s(,])(?:min-|max-)?' + f + '\\b').test(cond)) hit.push(f);
      }
      if (hit.indexOf('any-hover') >= 0) { const i = hit.indexOf('hover'); if (i >= 0) hit.splice(i, 1); }
      if (hit.indexOf('any-pointer') >= 0) { const i = hit.indexOf('pointer'); if (i >= 0) hit.splice(i, 1); }
      for (const f of hit) { let e2 = feat.get(f); if (!e2) { e2 = { feature: f, count: 0, conditions: [] }; feat.set(f, e2); } e2.count++; if (e2.conditions.length < 4) e2.conditions.push(T(cond, 100)); }
    }
    /* --- base spacing unit: coverage scoring, not GCD (sub-pixel layout and 1.5px borders defeat GCD) --- */
    const spaceEntries = [...spaceVals.entries()].map(([v, c]) => ({ v: parseFloat(v), n: c.n, props: c.tags }));
    const totalN = spaceEntries.reduce((a, b) => a + b.n, 0) || 1;
    const candidates = [2, 3, 4, 5, 6, 8, 10, 12, 16].map((u) => {
      let hit = 0;
      for (const e2 of spaceEntries) { const m = e2.v % u; if (m <= 0.5 || u - m <= 0.5) hit += e2.n; } return { unit: u, coverage: r3(hit / totalN) };
    });
    let baseUnit = 1, conf = 0;
    for (const c of candidates) if (c.coverage >= 0.85) { baseUnit = c.unit; conf = c.coverage; }   /* largest u clearing 0.85 wins */
    const spaceScale = spaceEntries.filter((e2) => { if (baseUnit <= 1) return false; const m = e2.v % baseUnit; return m <= 0.5 || baseUnit - m <= 0.5; })
      .sort((a, b) => b.n - a.n).slice(0, 40).map((e2) => ({ px: e2.v, rem: r3(e2.v / rootFS), weight: e2.n, count: e2.n, props: e2.props })).sort((a, b) => a.px - b.px);
    const roles = rank(typeRoles, CAP.list).map((r0) => {
      const p = String(r0.value).split('|'), size = parseFloat(p[1]) || 0, lhr = parseFloat(p[3]) || 0, tre = parseFloat(p[4]) || 0;
      return { role: p[0], fontSizePx: size, fontWeight: p[2], lineHeightPx: r3(size * lhr), lhRatio: lhr || null, letterSpacingPx: r3(size * tre),
        trackingEm: tre, family: p[6], resolvedFamily: p[7], transform: p[5], fontStyle: p[8], variationSettings: p[9] || 'normal',
        lhNormal: p[10] === '1', trackingNormal: p[11] === '1', charWeight: r0.weight, count: r0.count, samplePaths: r0.tags };
    });
    const sizes = rank(typeSizes, 40).map((s) => ({ sizePx: parseFloat(s.value), sizeRem: r3(parseFloat(s.value) / rootFS), charWeight: s.weight, roles: s.tags })).sort((a, b) => a.sizePx - b.sizePx);
    const ratios = []; for (let i = 1; i < sizes.length; i++) if (sizes[i - 1].sizePx > 0) ratios.push(r3(sizes[i].sizePx / sizes[i - 1].sizePx));
    /* --- authored container widths: computed resolves 68ch / min() / rem to px and invents variety --- */
    const authoredMW = [], mwSeen = new Set();
    for (const rec of S.styleIndex) {
      const v = rec.decl['max-width'] || rec.decl['max-inline-size'] || rec.decl['width'];
      if (!v || /^(100%|auto|none|0|0px)$/.test(v) || authoredMW.length >= 24) continue;
      const k = v + '|' + rec.sel; if (mwSeen.has(k)) continue;
      mwSeen.add(k); authoredMW.push({ value: T(v, 80), selector: T(rec.sel, 100), media: T(rec.media, 80) || null });
    }
    /* --- dark signals: a class/attribute toggle means dark values exist even with no @media block --- */
    const toggleSelectors = [];
    for (const rec of S.styleIndex) {
      if (toggleSelectors.length >= 12) break;
      if (/(^|[\s,>+~])(\.dark|\.light|\[data-theme|\[data-mode|\[data-color-scheme|:root\.dark|html\.dark)/i.test(rec.sel)) { const s = T(rec.sel, 100); if (toggleSelectors.indexOf(s) < 0) toggleSelectors.push(s); }
    }
    const linkHrefs = (rels) => safe(() => Array.from(document.querySelectorAll('link')).filter((l) => rels.some((r0) => (l.rel || '').toLowerCase().split(/\s+/).indexOf(r0) >= 0)).slice(0, 30).map((l) => T(absUrl(l.getAttribute('href') || ''), 300)), [], 'linkRel');
    const has = (k) => { try { return typeof window[k] !== 'undefined'; } catch (e) { return false; } };
    const q1 = (s) => safe(() => !!document.querySelector(s), false, 'querySelector');
    const stack = { framework: [], cssFramework: [], animation: [], signals: [] };
    for (const [name, sel, glob] of [['next', '#__next,script#__NEXT_DATA__,script[src*="/_next/"]', '__NEXT_DATA__'], ['nuxt', '#__nuxt', '__NUXT__'],
      ['astro', '[data-astro-cid],astro-island', ''], ['svelte', '[data-svelte-h],[data-sveltekit-preload-data]', ''],
      ['framer', '[data-framer-name]', '__framer_importFromPackage'], ['webflow', '[data-wf-page],html.w-mod-js', ''],
      ['wordpress', '.elementor,link[href*="wp-content"]', ''], ['angular', '[ng-version]', ''], ['react', '[data-reactroot]', 'React'],
      ['vue', '[data-v-app]', 'Vue']]) if ((sel && q1(sel)) || (glob && has(glob))) stack.framework.push(name);
    for (const k of ['gsap', 'ScrollTrigger', 'Lenis', 'LocomotiveScroll', 'ScrollSmoother', 'SplitType', 'Swiper', 'barba', 'Alpine', 'motion', 'anime', 'THREE', 'Matter', 'p5', 'Splitting']) if (has(k)) stack.animation.push(k);
    if (S.customDecl.some((d) => d.name.indexOf('--tw-') === 0)) stack.signals.push('tailwind');
    else if (S.layers.indexOf('theme') >= 0 && S.layers.indexOf('utilities') >= 0) stack.signals.push('tailwind-v4-layers');
    for (const s of S.sheets) if (s.href && /tailwind|bootstrap|bulma|foundation|normalize|reset/i.test(s.href)) stack.cssFramework.push(T(s.href, 120));
    if (q1('style[data-emotion]')) stack.cssFramework.push('emotion');
    if (q1('style[data-styled]')) stack.cssFramework.push('styled-components');
    if (S.startingStyle) stack.signals.push('@starting-style');
    if (timelines.length) stack.signals.push('scroll-driven-animations');
    if (S.adoptedCount) stack.signals.push('adoptedStyleSheets');
    const paletteSrc = new Map();                                        /* merge every role map, then cluster in OKLab */
    for (const m of [C.background, C.text, C.border, C.fill, C.stroke, C.outline, C.other]) for (const [k, c] of m) {
      let e2 = paletteSrc.get(k); if (!e2) { e2 = { n: 0, w: 0, tags: [] }; paletteSrc.set(k, e2); }
      e2.n += c.n; e2.w += c.w; for (const t of c.tags) if (e2.tags.indexOf(t) < 0 && e2.tags.length < 6) e2.tags.push(t);
    }
    const cq = new Map();
    for (const c of S.containers) {
      const k = (c.name || '') + '|' + c.query;
      let e2 = cq.get(k); if (!e2) { e2 = { name: c.name, query: c.query, count: 0 }; cq.set(k, e2); } e2.count++;
    }
    return {
      schema: 'clone-site/foundation@1', capturedAt: new Date().toISOString(),
      meta: { url: location.href, finalUrl: location.href, title: T(document.title, 200), lang: document.documentElement.lang || '',
        dir: document.documentElement.dir || rootCS.direction, viewport: { w: vw, h: vh, dpr: window.devicePixelRatio },
        docHeight: Math.round(document.documentElement.scrollHeight), colorSchemeUsed: rootCS.colorScheme || 'normal', rootFontSizePx: rootFS,
        prefersDark: safe(() => matchMedia('(prefers-color-scheme: dark)').matches, false, 'prefersDark'), ua: T(navigator.userAgent, 200) },
      stack: stack,
      fonts: { faces: faceList, usage: usage, networkFontUrls: [...new Set([].concat.apply([], faceList.map((f) => f.srcUrls || [])))].filter((u) => u && u !== 'data:(inline)').slice(0, 60),
        featureSettings: vals(featSet, 20), variationSettings: vals(varSet, 20), synthesisRisk: synthesisRisk },
      color: { vars: varsOf(rootCS), registered: S.properties.slice(0, 60), palette: clusterColors(rank(paletteSrc, 200), 0.025),
        byRole: { text: vals(C.text, 30), background: vals(C.background, 30), border: vals(C.border, 24), fill: vals(C.fill, 16), stroke: vals(C.stroke, 12), outline: vals(C.outline, 8) },
        gradients: rank(gradients, 30).map((g) => ({ value: g.value, kind: g.tags[0] || 'linear', stops: pickColors(g.value).slice(0, 8), count: g.count })),
        shadows: [].concat(rank(shBox, 24).map((s) => ({ value: s.value, kind: 'box', count: s.count })), rank(shText, 12).map((s) => ({ value: s.value, kind: 'text', count: s.count })), rank(shDrop, 12).map((s) => ({ value: s.value, kind: 'drop', count: s.count }))),
        darkMode: { hasMediaQuery: (feat.get('prefers-color-scheme') || { count: 0 }).count > 0, mediaConditions: (feat.get('prefers-color-scheme') || { conditions: [] }).conditions,
          colorScheme: rootCS.colorScheme || 'normal', toggleSelectors: toggleSelectors, tokenDiff: [] } },
      type: { roles: roles, scale: sizes, ratios: ratios, fluid: [] },
      space: { baseUnitPx: baseUnit, baseUnitConfidence: conf, candidates: candidates, scale: spaceScale,
        observed: rank(spaceVals, 60).map((s) => ({ value: parseFloat(s.value), count: s.count, props: s.tags })),
        containers: { maxWidths: vcw(maxWidths, 20), authoredMaxWidths: authoredMW, contentWidths: vcw(contentW, 16).map((c) => ({ value: parseFloat(c.value), count: c.count, weight: c.weight })), measuredAtPx: vw },
        grids: grids, flex: flexes },
      topology: { tree: tree, landmarks: landmarks, stackingContexts: stacking, sticky: sticky, fixed: fixed, scrollers: scrollers,
        zLadder: [...zLadder.values()].sort((a, b) => a.z - b.z), effects: vc(effects, 60), effectNodes: effectNodes,
        scroll: { behavior: rootCS.scrollBehavior, overscroll: rootCS.overscrollBehavior, snapType: rootCS.scrollSnapType, snapChildren: snapChildren, scrollPaddingTop: rootCS.scrollPaddingTop, timelines: timelines },
        pseudos: pseudos },
      patterns: { radii: vcw(radii, 24), shadows: vcw(shBox, 24), borders: vcw(borders, 24), outlines: vcw(outlines, 10),
        transitions: vc(transitions, 40), animations: vc(animations, 30), easings: vals(easings, 20), durations: vals(durations, 20),
        keyframes: S.keyframes, breakpoints: [...bpCount.values()].sort((a, b) => a.px - b.px), mediaFeatures: [...feat.values()].sort((a, b) => b.count - a.count),
        containerQueries: [...cq.values()].slice(0, 40), containerTypes: containerTypes,
        supports: S.supports.slice(0, 30).map((c) => ({ condition: T(c, 160), live: safe(() => CSS.supports(c), null, 'cssSupports') })), layers: S.layers.slice(0, 30) },
      assets: { images: images, backgrounds: backgrounds, videos: videos, svgInline: svgInline, svgUse: [...new Set(svgUse)],
        preloads: linkHrefs(['preload', 'prefetch', 'modulepreload']), icons: linkHrefs(['icon', 'apple-touch-icon', 'mask-icon', 'shortcut']),
        manifest: linkHrefs(['manifest'])[0] || null,
        ogImage: safe(() => { const m = document.querySelector('meta[property="og:image"],meta[name="twitter:image"]'); return m && m.content ? T(absUrl(m.content), 300) : null; }, null, 'ogImage'),
        /* real fetchable hrefs only: `constructed:*` and `shadow:style` are internal markers, not URLs */
        stylesheetUrls: S.sheets.filter((s) => s.href && /^https?:|^\/\//.test(s.href)).map((s) => T(s.href, 300)).slice(0, 60),
        scriptUrls: safe(() => Array.from(document.scripts).filter((s) => s.src).slice(0, 60).map((s) => T(s.src, 300)), [], 'scriptUrls') },
      cssom: { sheets: S.sheets, blocked: S.blocked, adoptedCount: S.adoptedCount, shadowRootsOpen: S.shadowOpen,
        shadowRootsSuspectedClosed: S.shadowSuspectClosed, ruleCounts: S.ruleCounts, customPropDeclarations: S.customDecl.slice(0, 300) },
      fingerprint: fingerprintOf(),
      counts: { elementsScanned: nodes.length, rulesWalked: S.ruleTotal, sheets: S.sheets.length, blockedSheets: S.blocked.length, faces: faceList.length,
        typeRoles: typeRoles.size, distinctColors: paletteSrc.size, sections: tree.filter((t) => t.isSection).length, scopes: S.scopes.length, startingStyle: S.startingStyle },
      caps: CAP, warnings: W
    };
  };
  const root = (window.__clone = window.__clone || {});
  root.v = V;
  root.state = root.state || {};
  /* MERGE, never replace: the sections/motion/responsive payloads also live on __clone.util (cssPath, hash,
     norm, nlow, abs, visible, style, rect, matrix, walk, sheets, raf, settle) and this payload installs last. */
  root.util = Object.assign(root.util || {}, { T: T, num: num, r2: r2, r3: r3, box: box, safe: safe, warn: warn, warnings: () => W.slice(), splitTop: splitTop, toRGBA: toRGBA,
    oklab: oklab, pickColors: pickColors, fontAvail: fontAvail, parseStack: parseStack, resolveFamily: resolveFamily, usedNormalLH: usedNormalLH,
    pathOf: pathOf, resolvePath: resolvePath, absUrl: absUrl, mk: mk, bump: bump, rank: rank, caps: CAP });
  root.foundation = {
    all: all,
    /* vars() and fingerprint() are cheap re-reads. vars() only reports non-:root scopes if all() has
       already run on this page, because it needs the CSSOM declaration index. */
    vars: () => { if (!S) { S = newState(); warn('vars:no-cssom-index — run all() first for scoped vars'); } return { ok: true, vars: varsOf(getComputedStyle(document.documentElement)), warnings: W.slice() }; },
    fingerprint: () => ({ ok: true, viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }, docHeight: Math.round(document.documentElement.scrollHeight), fingerprint: fingerprintOf(), warnings: W.slice() })
  };
  return { ok: true, installed: ['util', 'foundation'], v: V };
}
