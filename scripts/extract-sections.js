/*
 * clone-site / scripts/extract-sections.js — section segmentation payload (installer).
 * Emits `clone-site/sections@1` (SPEC D2). Algorithm + capture flow: references/sectioning.md.
 *
 * INSTALL (once per navigation; re-install after every navigate_page including reload — resize_page
 * does not wipe page state). Read this file and pass its ENTIRE contents as the `function` argument
 * to mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script with
 * filePath ".clone/raw/install-sections.json". Returns {ok:true,installed:[…],v:1} (~200 bytes).
 *
 * INVOKE — one-liners as `function`, always with filePath (a 20-section manifest is 40–150 KB):
 *   () => window.__clone.sections.prewarm()                   -> .clone/raw/prewarm-<w>.json
 *   () => window.__clone.sections.all()                       -> .clone/raw/sections-<w>.json
 *   () => window.__clone.sections.all({keep:3.6,sliver:0.22,pageId:"pricing"})   (retune / label)
 *   () => window.__clone.sections.skeletons()                 -> .clone/raw/skeletons-<w>.json
 *   () => window.__clone.sections.content("#features")        -> rows for content.md
 *   () => window.__clone.sections.capture("#features",{hideFixed:true})
 *   () => window.__clone.sections.restore()
 *   () => window.__clone.sections.probe("#features h2","heading")
 * `args` carries element uids only — interpolate option literals into the source above.
 */
() => {
  const V = 1;
  const NS = (window.__clone = window.__clone || {});
  NS.v = V; NS.state = NS.state || {};
  const CAP = { sections: 60, overlay: 20, probeStr: 240, warn: 40, shingle: 240, content: 400, depth: 3, tags: 240 };
  const warnings = [];
  const warn = (m) => { if (warnings.length < CAP.warn && warnings.indexOf(m) < 0) warnings.push(m); };
  const safe = (fn, fb, tag) => { try { return fn(); } catch (e) { warn((tag || 'safe') + ':' + ((e && e.name) || 'Error')); return fb; } };
  const T = (s, n) => (typeof s === 'string' && s.length > (n || CAP.probeStr) ? s.slice(0, n || CAP.probeStr) : s);
  const R = (n) => Math.round(n);
  /* ---------- hashing: two seeded FNV-1a passes -> 64-bit hex ---------- */
  const hash = (s) => {
    const f = (str, seed) => { let h = seed >>> 0;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
    const p = (n) => n.toString(16).padStart(8, '0'), v = String(s);
    return p(f(v, 0x811c9dc5)) + p(f(v + '|' + v.length, 0x01000193));
  };
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const nlow = (t) => norm(t).toLowerCase().slice(0, 2000);
  /* ---------- dom helpers ---------- */
  const SKIP = /^(script|style|noscript|template|link|meta|br|iframe)$/i;
  const kids = (el) => [...el.children].filter((c) => !SKIP.test(c.tagName));
  const vis = (el) => { const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const cls = (el) => el.getAttribute('class') || '';                 /* SVG className is an object */
  const nameOf = (el) => [el.id, cls(el), el.getAttribute('data-section') || '', el.getAttribute('aria-label') || ''].join(' ');
  const bgKey = (el) => { if (!el) return ' '; const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.backgroundImage.slice(0, 60), cs.borderTopWidth, cs.color].join('|'); };
  const headingIn = (el) => el.querySelector('h1,h2,h3,[role="heading"]');
  const NAME_HINT = /hero|banner|jumbotron|feature|pricing|plan|tier|faq|cta|testimonial|review|logo|marquee|stat|metric|team|contact|newsletter|footer|header|nav|gallery|showcase|step|process|integration|compare|about|blog|resource|partner|award|bento|section/i;
  const isFixedish = (el) => { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'sticky'; };
  const cssPath = (el) => safe(() => {
    const one = (s) => { try { return document.querySelectorAll(s).length === 1; } catch (e) { return false; } };
    if (el.id) { const s = '#' + CSS.escape(el.id); if (one(s)) return s; }
    for (const a of ['data-testid', 'data-section', 'data-block', 'data-id', 'name']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const s = el.tagName.toLowerCase() + '[' + a + '="' + CSS.escape(v) + '"]'; if (one(s)) return s; }
    }
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
      if (cur.id) { const s = '#' + CSS.escape(cur.id); if (one(s)) { parts.unshift(s); break; } }
      let p = cur.tagName.toLowerCase();
      const sibs = [...(cur.parentElement ? cur.parentElement.children : [])].filter((x) => x.tagName === cur.tagName);
      if (sibs.length > 1) p += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      parts.unshift(p);
    }
    return parts.join(' > ');
  }, ':root', 'cssPath');
  /* ---------- scroll root: <html>, or a hijacked overflow container (Lenis / Locomotive) ---------- */
  const docRoot = document.scrollingElement || document.documentElement;
  const findScrollRoot = () => {
    if (docRoot.scrollHeight > docRoot.clientHeight + 200) return docRoot;
    let best = null, bestArea = 0;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect(), area = r.width * r.height;
      if (area < innerWidth * innerHeight * 0.4 || area <= bestArea) continue;
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 200) continue;
      best = el; bestArea = area;
    }
    return best || docRoot;
  };
  let SR = docRoot, SRdoc = true, SRrect = { left: 0, top: 0 };
  const syncRoot = () => { SR = findScrollRoot(); SRdoc = SR === docRoot; SRrect = SR.getBoundingClientRect(); return SR; };
  const abs = (r) => SRdoc
    ? { x: R(r.left + scrollX), y: R(r.top + scrollY), w: R(r.width), h: R(r.height) }
    : { x: R(r.left - SRrect.left + SR.scrollLeft), y: R(r.top - SRrect.top + SR.scrollTop), w: R(r.width), h: R(r.height) };
  /* ---------- probes: exactly what verification re-measures (closed name vocabulary) ---------- */
  const PROBE_SEL = [['heading', 'h1,h2,h3'], ['body', 'p'], ['cta', 'a[href],button,[role="button"]'],
    ['media', 'img,svg,video,picture'], ['eyebrow', '[class*="eyebrow" i],[class*="kicker" i],[class*="label" i],small']];
  const probeEl = (el, name) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { name: name, selector: cssPath(el), box: abs(r),
      font: { family: T(cs.fontFamily), size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing, transform: cs.textTransform },
      color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius, shadow: T(cs.boxShadow), display: cs.display,
      pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      flow: [cs.display, cs.flexDirection, T(cs.gridTemplateColumns, 120), cs.gap].join(' | ') };
  };
  /* ---------- repeated card grid ---------- */
  const detectRepeat = (root) => {
    let best = null;
    const sig = (k) => k.tagName + '|' + cls(k).split(/\s+/).filter(Boolean).slice(0, 3).sort().join('.') + '|' + k.children.length;
    for (const parent of [root, ...root.querySelectorAll('*')]) {
      const k = [...parent.children].filter((c) => !SKIP.test(c.tagName) && c.getBoundingClientRect().height > 24);
      if (k.length < 3 || (best && k.length <= best.rec.count)) continue;
      const sigs = k.map(sig);
      if (sigs.filter((s) => s === sigs[0]).length / k.length < 0.8) continue;
      const cs = getComputedStyle(parent);
      best = { first: k[0], items: k, rec: { count: k.length, containerSelector: cssPath(parent), itemSelector: cssPath(k[0]),
        columns: new Set(k.map((x) => R(x.getBoundingClientRect().left))).size, gap: cs.gap || null, display: cs.display,
        itemHash: hash(k.map((x) => nlow(x.innerText)).join('')) } };
    }
    return best;
  };
  /* ---------- carousel ---------- */
  const CAROUSEL_LIB = /swiper|slick|embla|keen-slider|flickity|glide|splide|owl-carousel|tns-|marquee/i;
  const detectCarousel = (root) => {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const attrs = nameOf(el) + ' ' + [...el.attributes].map((a) => a.name).join(' ');
      const cs = getComputedStyle(el);
      const overflows = el.scrollWidth > el.clientWidth + 24 && /(auto|scroll|hidden)/.test(cs.overflowX);
      if (!(CAROUSEL_LIB.test(attrs) || el.getAttribute('aria-roledescription') === 'carousel' || (overflows && el.children.length >= 3))) continue;
      const slides = [...el.children].filter((c) => c.getBoundingClientRect().width > 40);
      return { rootSelector: cssPath(el), slideSelector: slides[0] ? cssPath(slides[0]) : null,
        slides: slides.length, libraryHint: (attrs.match(CAROUSEL_LIB) || [null])[0],
        scrollWidth: R(el.scrollWidth), clientWidth: R(el.clientWidth), snap: cs.scrollSnapType || 'none' };
    }
    return null;
  };
  /* ---------- role classification (closed vocabulary) ---------- */
  const roleOf = (el, idx, total) => {
    const t = el.tagName.toLowerCase(), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const links = el.querySelectorAll('a,button').length;
    if (t === 'header') return 'header';
    if (t === 'footer') return 'footer';
    if (safe(() => el.matches('[role="dialog"],[aria-modal="true"],dialog'), false, 'matches')) return 'overlay';
    if (cs.position === 'fixed' && (+cs.zIndex || 0) >= 40 && r.height < innerHeight * 0.5) return r.top <= 8 ? 'header' : 'sticky-cta';
    if (isFixedish(el) && r.top <= 8 && links >= 2 && r.height < innerHeight * 0.3) return 'header';
    if (idx === 0 && links >= 2 && r.height < innerHeight * 0.25) return 'header';
    if (t === 'nav' && !el.closest('header,footer')) return 'nav';
    if (idx === total - 1 && links >= 4) return 'footer';
    return 'section';
  };
  const slugify = (s) => (s || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'section';
  const tagsOf = (el) => [...el.querySelectorAll('*')].slice(0, CAP.tags).map((n) => n.tagName);
  /* ---------- one segmentation pass at the current viewport ---------- */
  const pass = (KEEP, SLIVER) => {
    const VW = innerWidth, VH = innerHeight;
    syncRoot();
    let contentRoot = SRdoc ? document.body : SR;
    for (let i = 0; i < 6; i++) {                                     /* unwrap single-child shells */
      const k = kids(contentRoot).filter(vis);
      if (k.length !== 1 || k[0].scrollHeight < contentRoot.scrollHeight * 0.8) break;
      contentRoot = k[0];
    }
    const picked = [];
    const visit = (parent, depth) => {
      let prev = null;
      for (const el of kids(parent).filter(vis)) {
        const r = el.getBoundingClientRect();
        if (r.height < 24 || r.width < 40) { prev = el; continue; }
        let s = 0;
        if (r.width >= VW * 0.98) s += 2.0; else if (r.width >= VW * 0.70) s += 1.0;
        const hr = r.height / VH;
        if (hr >= 0.9) s += 1.5; else if (hr >= 0.3) s += 1.0; else if (hr >= 0.12) s += 0.4;
        if (bgKey(el) !== bgKey(prev)) s += 1.5;
        if (/^(section|header|footer|main|article|aside|nav|form)$/i.test(el.tagName)) s += 1.5;
        if (headingIn(el)) s += 1.0;
        if (NAME_HINT.test(nameOf(el))) s += 0.75;
        if (kids(el).length >= 2) s += 0.25;
        prev = el;
        const tooTall = r.height > VH * 3.5 && el.querySelectorAll('h1,h2,h3').length >= 2;
        const canDescend = depth < CAP.depth && kids(el).length >= 2 && r.height > VH * 0.6;
        if (canDescend && (s < KEEP || tooTall)) { visit(el, depth + 1); continue; }
        picked.push({ el: el, score: +s.toFixed(2) });
      }
    };
    visit(contentRoot, 0);
    const groups = [];                                                /* merge slivers into the previous keeper */
    for (const p of picked) {
      const r = p.el.getBoundingClientRect(), prevG = groups[groups.length - 1];
      const sliver = r.height < VH * SLIVER && !headingIn(p.el) && p.score < KEEP;
      const prevIsChrome = prevG && (/^(header|footer|nav)$/i.test(prevG.el.tagName) || isFixedish(prevG.el));
      if (sliver && prevG && !prevIsChrome && !isFixedish(p.el)) { prevG.extra.push(p.el); continue; }
      groups.push({ el: p.el, score: p.score, extra: [] });
    }
    const ordered = groups.sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top).slice(0, CAP.sections);
    return { contentRoot: contentRoot, groups: ordered, candidates: picked.length,
      merged: ordered.reduce((n, g) => n + g.extra.length, 0) };
  };
  /* ---------- emit the D2 manifest for the current width ---------- */
  const emit = (res, KEEP, opts) => {
    const w = String(R(innerWidth)), seen = {}, els = [];
    const sections = res.groups.map((g, i) => {
      const el = g.el, r = el.getBoundingClientRect(), cs = getComputedStyle(el), h = headingIn(el);
      const role = roleOf(el, i, res.groups.length);
      const label = norm((h && h.innerText) || el.getAttribute('aria-label') || (NAME_HINT.exec(nameOf(el)) || [])[0] || role).slice(0, 60) || role;
      let id = String(i).padStart(2, '0') + '-' + slugify(label);
      if (seen[id]) id = id.slice(0, 26) + '-' + (++seen[id]); else seen[id] = 1;
      const rep = detectRepeat(el), probes = [probeEl(el, 'root')];
      for (const ps of PROBE_SEL) { const n = el.querySelector(ps[1]); if (n) probes.push(probeEl(n, ps[0])); }
      if (rep) probes.push(probeEl(rep.first, 'repeat-item'));
      const skel = tagsOf(el).join('.'), text = nlow(el.innerText), contentHash = hash(skel + '' + text + '' + bgKey(el));
      const box = {}, background = {}, layout = {};
      box[w] = abs(r);
      background[w] = { color: cs.backgroundColor, image: T(cs.backgroundImage), size: cs.backgroundSize,
        position: cs.backgroundPosition, attachment: cs.backgroundAttachment };
      layout[w] = { display: cs.display, flexDirection: cs.flexDirection, gridTemplateColumns: T(cs.gridTemplateColumns, 200),
        gap: cs.gap, padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
        maxWidth: cs.maxWidth, minHeight: cs.minHeight, overflow: cs.overflow };
      const chrome = role === 'header' || role === 'footer' || role === 'sticky-cta';
      els.push({ id: id, el: el });
      return { id: id, order: i, role: role, label: label, score: g.score,
        selector: cssPath(el), extraSelectors: g.extra.map(cssPath),
        box: box, sticky: isFixedish(el) ? cs.position : null, zIndex: cs.zIndex,
        background: background, layout: layout, repeat: rep ? rep.rec : null, carousel: detectCarousel(el),
        counts: { headings: el.querySelectorAll('h1,h2,h3,h4,h5,h6').length, links: el.querySelectorAll('a[href]').length,
          buttons: el.querySelectorAll('button,[role="button"]').length, images: el.querySelectorAll('img,picture,svg').length,
          forms: el.querySelectorAll('form,input,textarea,select').length, videos: el.querySelectorAll('video').length },
        textChars: text.length, contentHash: contentHash,
        structureHash: hash(skel + '' + bgKey(el) + '' + kids(el).length + '' + R(r.height / 40)),
        probes: probes, shared: chrome, sharedKey: chrome ? 'c_' + contentHash : null, dedupOf: null };
    });
    const overlays = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog,[class*="modal" i],[class*="drawer" i],[class*="cookie" i],[class*="consent" i]')]
      .slice(0, CAP.overlay).map((el) => {
        const cs = getComputedStyle(el);
        const trig = el.id ? [...document.querySelectorAll('[aria-controls],[aria-haspopup],[data-modal-target],[data-open]')]
          .find((b) => b.getAttribute('aria-controls') === el.id || b.getAttribute('data-modal-target') === el.id) : null;
        return { selector: cssPath(el), tag: el.tagName.toLowerCase(), position: cs.position, zIndex: cs.zIndex,
          open: cs.display !== 'none' && cs.visibility !== 'hidden', triggerSelector: trig ? cssPath(trig) : null,
          label: norm(el.getAttribute('aria-label') || el.innerText).slice(0, 60), contentHash: hash(nlow(el.innerText)) };
      });
    NS.state.sectionEls = els;
    const docHeight = {}; docHeight[w] = R(SR.scrollHeight);
    return { schema: 'clone-site/sections@1', capturedAt: new Date().toISOString(),
      page: { id: (opts && opts.pageId) || 'home', route: location.pathname || '/', url: location.href,
        finalUrl: location.href, title: document.title },
      primaryWidth: (opts && opts.primaryWidth) || R(innerWidth), widths: [R(innerWidth)], keepThreshold: KEEP,
      scrollRoot: SRdoc ? ':root' : cssPath(SR), contentRoot: cssPath(res.contentRoot),
      docHeight: docHeight, sections: sections, overlays: overlays,
      stats: { candidates: res.candidates, kept: sections.length, merged: res.merged, retunes: 0 },
      warnings: warnings.slice() };
  };
  /* ---------- public API ---------- */
  const all = (opts) => {
    opts = opts || {};
    let KEEP = opts.keep != null ? opts.keep : 3.0, SLIVER = opts.sliver != null ? opts.sliver : 0.15;
    let res = pass(KEEP, SLIVER), retunes = 0;
    while (opts.keep == null && retunes < 2) {                          /* auto-retune on absurd counts */
      const n = res.groups.length;
      if (n >= 4 && n <= 30) break;
      if (n < 4) KEEP = KEEP > 2.4 ? 2.4 : 1.8; else { KEEP = KEEP < 3.6 ? 3.6 : 4.2; SLIVER = 0.22; }
      warn('retune:kept=' + n + '->keep=' + KEEP);
      res = pass(KEEP, SLIVER); retunes++;
    }
    const out = emit(res, KEEP, opts);
    out.stats.retunes = retunes;
    return out;
  };
  const skeletons = () => {
    const src = NS.state.sectionEls || [];
    if (!src.length) return { error: 'call window.__clone.sections.all() first' };
    const out = {};
    for (const s of src) {
      const tags = tagsOf(s.el), set = [];
      for (let i = 0; i + 4 <= tags.length; i++) {
        const g = hash(tags.slice(i, i + 4).join('.'));
        if (set.indexOf(g) < 0 && set.length < CAP.shingle) set.push(g);
      }
      out[s.id] = set;
    }
    return { schema: 'clone-site/skeletons@1', width: R(innerWidth), shingleSize: 4, sections: out };
  };
  const ROLE_OF_TAG = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6', P: 'body', LI: 'li', CODE: 'code',
    BLOCKQUOTE: 'quote', FIGCAPTION: 'caption', LABEL: 'label', SUMMARY: 'summary', DT: 'term', DD: 'def',
    TD: 'cell', TH: 'cell', SMALL: 'eyebrow' };
  const KEEP_NESTED = 'a[href],button,[role="button"],img,input,textarea,select';
  const content = (sel) => {
    const root = document.querySelector(sel);
    if (!root) return { error: 'selector not found', selector: sel };
    const rep = detectRepeat(root), items = rep ? rep.items : [], rows = [], skip = new Set(), n = {};
    const key = (base) => { n[base] = (n[base] || 0) + 1; return n[base] > 1 ? base + '[' + (n[base] - 1) + ']' : base; };
    const prefix = (el) => { for (let i = 0; i < items.length; i++) if (items[i] === el || items[i].contains(el)) return 'item[' + i + '].'; return ''; };
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let el = root;
    while (el && rows.length < CAP.content) {
      if (!skip.has(el) && !SKIP.test(el.tagName) && vis(el)) {
        const tag = el.tagName;
        let role = null, text = null, extra = null;
        if (tag === 'IMG') { role = 'img'; text = el.getAttribute('alt') || ''; extra = { src: el.currentSrc || el.src }; }
        else if (tag === 'INPUT' || tag === 'TEXTAREA') { role = 'field'; text = el.getAttribute('placeholder') || el.value || ''; extra = { type: el.getAttribute('type') || tag.toLowerCase() }; }
        else if (tag === 'A' && el.getAttribute('href')) { role = 'link'; text = norm(el.innerText); extra = { href: el.getAttribute('href') }; }
        else if (tag === 'BUTTON' || el.getAttribute('role') === 'button') { role = 'button'; text = norm(el.innerText); }
        else if (ROLE_OF_TAG[tag]) { role = ROLE_OF_TAG[tag]; text = norm(el.innerText); }
        else if (/eyebrow|kicker|badge|pill|overline/i.test(cls(el)) && !el.children.length) { role = 'eyebrow'; text = norm(el.innerText); }
        else if (!el.children.length) { const own = norm(el.textContent); if (own) { role = 'text'; text = own; } }
        if (role && (text || role === 'img')) {
          rows.push(Object.assign({ key: key(prefix(el) + role), role: role, selector: cssPath(el), text: T(text, 600) }, extra || {}));
          if (role === 'link' || role === 'button' || ROLE_OF_TAG[tag]) {                /* don't re-emit inner spans */
            const keep = new Set([...el.querySelectorAll(KEEP_NESTED)]);
            for (const d of el.querySelectorAll('*')) if (!keep.has(d)) skip.add(d);
          }
        }
      }
      el = walk.nextNode();
    }
    return { selector: sel, repeatItems: items.length, chars: nlow(root.innerText).length, rows: rows };
  };
  const restore = () => {
    const st = NS.state.capture;
    if (st) for (const h of st.hidden) h.el.style.visibility = h.vis;
    for (const s of document.querySelectorAll('style[data-clone-capture]')) s.remove();
    NS.state.capture = null;
    syncRoot(); SR.scrollTo({ top: 0, behavior: 'instant' });
    return { ok: true, restored: st ? st.hidden.length : 0 };
  };
  const capture = (sel, opts) => {
    opts = opts || {};
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: 'selector not found', selector: sel };
    restore();
    const hidden = [];
    if (opts.hideFixed !== false) {                                    /* sticky chrome would smear every shot */
      for (const c of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(c), cr = c.getBoundingClientRect();
        if ((cs.position !== 'fixed' && cs.position !== 'sticky') || cr.width < 8 || cr.height < 8) continue;
        if (c === el || c.contains(el) || el.contains(c)) continue;
        hidden.push({ el: c, vis: c.style.visibility }); c.style.visibility = 'hidden';
      }
    }
    const st = document.createElement('style');
    st.setAttribute('data-clone-capture', '1');
    st.textContent = ':root,*{scroll-behavior:auto !important}' +
      (opts.freeze === false ? '' : '*,*::before,*::after{animation-play-state:paused !important;transition:none !important}');
    document.head.appendChild(st);
    NS.state.capture = { hidden: hidden, selector: sel };
    syncRoot();
    SR.scrollTo({ top: Math.max(0, SR.scrollTop + el.getBoundingClientRect().top - (opts.offset || 0)), behavior: 'instant' });
    const a = el.getBoundingClientRect();
    return { ok: true, selector: sel, box: abs(a), rectTop: R(a.top), rectHeight: R(a.height),
      viewport: { w: R(innerWidth), h: R(innerHeight) }, needsHeight: Math.ceil(a.height),
      clipped: a.height > innerHeight + 1, tall: a.height > (opts.maxHeight || 4000), hiddenCount: hidden.length,
      scrollTop: R(SR.scrollTop), atTop: Math.abs(a.top - (opts.offset || 0)) <= 2 };
  };
  const probe = (sel, name) => {
    const el = document.querySelector(sel);
    if (!el) return { error: 'selector not found', selector: sel };
    syncRoot();
    return probeEl(el, name || 'root');
  };
  const prewarm = async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    syncRoot();
    const step = Math.round(innerHeight * 0.8);
    let last = -1, guard = 0;
    while (guard++ < 120) {
      const next = Math.min(SR.scrollTop + step, SR.scrollHeight - innerHeight);
      SR.scrollTo({ top: next, behavior: 'instant' });
      await sleep(180);
      if (next === last) break;
      last = next;
    }
    for (const i of document.querySelectorAll('img[loading="lazy"]')) i.loading = 'eager';
    await Promise.allSettled([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
    SR.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(400);
    return { ok: true, docHeight: R(SR.scrollHeight), passes: guard, images: document.images.length,
      imagesDecoded: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
      fontsLoaded: safe(() => [...document.fonts].filter((f) => f.status === 'loaded').length, -1, 'fonts'),
      scrollRoot: SRdoc ? ':root' : cssPath(SR), warnings: warnings.slice() };
  };
  NS.sections = { all: all, prewarm: prewarm, skeletons: skeletons, content: content,
    capture: capture, restore: restore, probe: probe, hash: hash };
  NS.util = Object.assign(NS.util || {}, { cssPath: cssPath, hash: hash, norm: norm, nlow: nlow, abs: abs, visible: vis });
  return { ok: true, v: V, installed: ['sections.all', 'sections.prewarm', 'sections.skeletons', 'sections.content',
    'sections.capture', 'sections.restore', 'sections.probe', 'util.cssPath', 'util.hash'] };
}
