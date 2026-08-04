() => {
  /* clone-site / scripts/extract-motion.js — installer payload for motion truth.
     CONTRACT
       Install once per navigation:  evaluate_script(function = <entire contents of this file>).
       Returns {ok,installed,utilFilled,v}. Then run one pass per call, each with its own filePath:
         () => window.__clone.motion.libs()               -> .clone/raw/motion-libs.json
         () => window.__clone.motion.cssom()              -> .clone/raw/motion-cssom.json
         () => window.__clone.motion.transitions()        -> .clone/raw/motion-transitions.json
         () => window.__clone.motion.anims()              -> .clone/raw/motion-anims-load.json
         () => window.__clone.motion.scroll(21)           -> .clone/raw/motion-scroll.json   (async, internal sweep)
         () => window.__clone.motion.drain()              -> .clone/raw/motion-hooks.json    (needs the HOOKS initScript)
         () => window.__clone.motion.states()             -> .clone/raw/motion-states-cssom.json
         () => window.__clone.motion.states('<sel>')      -> rest snapshot, cached on __clone.state.rest
         () => window.__clone.motion.states('<sel>', 220) -> .clone/raw/motion-states-live.json (delta vs rest)
         () => window.__clone.motion.page()               -> .clone/raw/motion-page.json
       anims() is re-callable: load, every scroll stop, mid-hover, drawer-open, dark-mode toggle.
       Reinstall after any navigate_page (including reload); resize_page does not wipe it.
       Uses window.__clone.util from scripts/extract-foundation.js when present and fills in any
       helper it is missing, so it also runs standalone. */
  const root = (window.__clone = window.__clone || {});
  root.v = 1;
  root.state = root.state || {};
  const U = (root.util = root.util || {});
  const filled = [];
  const need = (k, fn) => { if (typeof U[k] !== 'function') { U[k] = fn; filled.push(k); } };
  const num = (v) => (Number.isFinite(v) ? +v.toFixed(3) : null);
  const cap = (a, n) => (a.length > n ? a.slice(0, n) : a);

  need('cssPath', (el) => {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 12) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && document.querySelectorAll('#' + node.id).length === 1) { parts.unshift('#' + node.id); break; }
      let seg = node.localName;
      const cls = String(node.getAttribute('class') || '').trim().split(/\s+/)
        .filter((c) => c && !/^(is-|has-|js-|active$|aos-|swiper-|lenis|in-view|visible$)/.test(c))
        .filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) seg += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const p = node.parentElement;
      if (p) { const sibs = [...p.children].filter((s) => s.localName === node.localName); if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')'; }
      parts.unshift(seg);
      node = node.parentElement;
    }
    return parts.join(' > ');
  });
  need('sheets', () => {
    const out = [], seen = new Set();
    const push = (sheet, origin) => {
      if (!sheet || seen.has(sheet)) return;
      seen.add(sheet);
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) { out.push({ blocked: true, href: sheet.href, origin }); return; }
      out.push({ rules, href: sheet.href || null, origin, media: String((sheet.media && sheet.media.mediaText) || '') });
    };
    const scan = (r, origin) => {
      for (const s of r.styleSheets || []) push(s, origin);
      for (const s of r.adoptedStyleSheets || []) push(s, origin + ' #adopted');
    };
    scan(document, 'document');
    const stack = [document];
    while (stack.length) {
      const r = stack.pop();
      let nodes = [];
      try { nodes = r.querySelectorAll('*'); } catch (e) { nodes = []; }
      for (const el of nodes) if (el.shadowRoot) { scan(el.shadowRoot, 'shadow ' + U.cssPath(el)); stack.push(el.shadowRoot); }
    }
    return out;
  });
  need('walk', (visit) => {
    const blocked = [];
    const label = (rule) => {
      if (rule.media) return '@media ' + rule.conditionText;
      if (rule.containerQuery !== undefined) return '@container ' + (rule.containerName ? rule.containerName + ' ' : '') + rule.containerQuery;
      if (rule.name !== undefined && rule.cssRules) return '@keyframes ' + rule.name;
      if (rule.conditionText !== undefined) return '@supports ' + rule.conditionText;
      if (rule.layerName !== undefined) return '@layer ' + (rule.layerName || '<anon>');
      return rule.constructor.name;
    };
    const rec = (rules, ctx) => {
      for (const rule of rules) {
        visit(rule, ctx);
        let kids = null;
        try { kids = rule.cssRules; } catch (e) { kids = null; }
        if (kids && kids.length) rec(kids, ctx.concat(label(rule)));
      }
    };
    for (const s of U.sheets()) {
      if (s.blocked) { blocked.push(s.href); continue; }
      rec(s.rules, [s.origin + (s.href ? ' ' + s.href : '') + (s.media ? ' media=' + s.media : '')]);
    }
    return blocked;
  });
  need('raf', (n) => new Promise((res) => { let k = n || 2; const step = () => (--k <= 0 ? res() : requestAnimationFrame(step)); requestAnimationFrame(step); }));
  need('settle', async (read, o) => {
    const maxFrames = (o && o.maxFrames) || 120, stable = (o && o.stable) || 5;
    let last = null, same = 0;
    for (let i = 0; i < maxFrames; i++) {
      await U.raf(1);
      const j = JSON.stringify(read());
      if (last !== null && j === last) { if (++same >= stable) return { value: JSON.parse(j), frames: i, settled: true }; } else same = 0;
      last = j;
    }
    return { value: read(), frames: maxFrames, settled: false };
  });
  need('scrollY', () => window.scrollY || document.documentElement.scrollTop || 0);
  need('maxScroll', () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
  need('scrollTo', async (y) => {
    const html = document.documentElement, prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    const lenis = window.lenis || window.__lenis || null;
    const smoother = (window.ScrollSmoother && window.ScrollSmoother.get && window.ScrollSmoother.get()) || null;
    const loco = window.locoScroll || window.locomotiveScroll || null;
    if (smoother) smoother.scrollTo(y, false);
    else if (lenis && lenis.scrollTo) lenis.scrollTo(y, { immediate: true, force: true, lock: true });
    else if (loco && typeof loco.scrollTo === 'function') loco.scrollTo(y, { duration: 0, disableLerp: true });
    else window.scrollTo(0, y);
    await U.raf(3);
    if (window.ScrollTrigger && window.ScrollTrigger.update) window.ScrollTrigger.update();
    html.style.scrollBehavior = prev;
    return U.scrollY();
  });
  need('style', (el, props, pseudo) => {
    const cs = getComputedStyle(el, pseudo || null), o = {};
    for (const p of props) o[p] = cs.getPropertyValue(p);
    return o;
  });
  need('rect', (el) => {
    const r = el.getBoundingClientRect();
    return { x: num(r.x), y: num(r.y), docY: num(r.y + U.scrollY()), w: num(r.width), h: num(r.height) };
  });
  need('matrix', (t) => {
    if (!t || t === 'none') return null;
    let m;
    try { m = new DOMMatrixReadOnly(t); } catch (e) { return { raw: t }; }
    return { tx: num(m.m41), ty: num(m.m42), tz: num(m.m43), sx: num(Math.hypot(m.m11, m.m12)), sy: num(Math.hypot(m.m21, m.m22)), rot: num(Math.atan2(m.m12, m.m11) * 180 / Math.PI), is3d: !m.is2D };
  });

  const declText = (style) => {
    const out = [];
    for (let i = 0; i < style.length; i++) { const p = style[i]; out.push(p + ': ' + style.getPropertyValue(p) + (style.getPropertyPriority(p) ? ' !important' : '')); }
    return out.join('; ');
  };
  const ms = (s) => { const v = String(s || '').trim(); return /ms$/.test(v) ? parseFloat(v) : (parseFloat(v) || 0) * 1000; };
  const listOf = (s) => String(s || '').split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
  const flat = (o) => { const r = {}; for (const k in o) { const v = o[k]; if (v === null || (typeof v !== 'object' && typeof v !== 'function')) r[k] = v; } return r; };
  const STATE = /:(hover|focus-visible|focus-within|focus|active|target|visited|checked|indeterminate|disabled|enabled|placeholder-shown|autofill|user-invalid|invalid|valid|open|popover-open|modal|fullscreen)\b/;
  const STATE_ATTR = /\[(aria-expanded|aria-selected|aria-current|aria-pressed|data-state|data-open|open)/;
  const STATE_PROPS = ['color', 'background-color', 'background-image', 'background-position', 'background-size', 'border-color', 'border-width', 'border-radius', 'box-shadow', 'text-decoration-line', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset', 'opacity', 'transform', 'translate', 'scale', 'rotate', 'filter', 'backdrop-filter', 'letter-spacing', 'font-weight', 'font-variation-settings', 'outline', 'outline-offset', 'outline-color', 'cursor', 'clip-path', 'gap', 'padding', 'inset', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'will-change'];

  const M = (root.motion = {});

  M.libs = () => {
    const g = (k) => { try { const v = window[k]; return typeof v === 'undefined' || !v ? false : (v.version || v.VERSION || true); } catch (e) { return false; } };
    const q = (sel) => { try { return sel ? document.querySelectorAll(sel).length : 0; } catch (e) { return 0; } };
    const P = {
      gsap: [g('gsap') || g('TweenMax') || g('TweenLite'), '.pin-spacer,[data-flip-id],.gsap-marker-start'],
      scrollTrigger: [!!window.ScrollTrigger, '.pin-spacer,.gsap-marker-scroller-start'],
      scrollSmoother: [!!(window.ScrollSmoother && window.ScrollSmoother.get && window.ScrollSmoother.get()), '#smooth-wrapper,#smooth-content'],
      splitText: [!!(window.SplitText || window.Splitting), '.split-line,.split-word,.split-char,[data-splitting]'],
      motionOne: [g('Motion') || !!(window.motion && window.motion.animate), ''],
      framerMotion: [!!window.__FRAMER_MOTION__, '[data-projection-id],[data-framer-name],[data-framer-component-type]'],
      framerSite: [!!(window.__framer_importFromPackage || window.Framer), '#__framer-badge-container,[class^="framer-"]'],
      anime: [g('anime'), ''],
      lenis: [g('Lenis') || !!window.lenis, 'html.lenis,html.lenis-smooth,.lenis-scrolling,[data-lenis-prevent]'],
      locomotive: [g('LocomotiveScroll') || !!(window.locoScroll || window.locomotiveScroll), '[data-scroll-container],[data-scroll-speed],html.has-scroll-smooth'],
      aos: [g('AOS'), '[data-aos]'],
      scrollReveal: [g('ScrollReveal'), '[data-sr-id]'],
      swiper: [g('Swiper'), '.swiper,.swiper-slide,.swiper-initialized'],
      embla: [g('EmblaCarousel'), '.embla__viewport,.embla__container,[data-embla]'],
      splide: [g('Splide'), '.splide__track'],
      keenSlider: [g('KeenSlider'), '.keen-slider,[data-keen-slider]'],
      rellax: [g('Rellax'), '.rellax,[data-rellax-speed]'],
      barba: [g('barba'), '[data-barba],[data-barba-namespace]'],
      threejs: [g('THREE'), 'canvas[data-engine],canvas.webgl'],
      lottie: [g('lottie') || g('bodymovin'), 'lottie-player,dotlottie-player,[data-animation-path]'],
      webflowIx2: [!!window.Webflow, '[data-w-id]'],
      alpine: [g('Alpine'), '[x-data],[x-transition]'],
      vanta: [g('VANTA'), '.vanta-canvas'],
      tailwindAnimate: [false, '[class*="animate-"]']
    };
    const libraries = [];
    for (const name of Object.keys(P)) {
      const gl = P[name][0], sel = P[name][1], dom = q(sel);
      if (!gl && !dom) continue;
      libraries.push({ name, version: typeof gl === 'string' ? gl : null, evidence: [gl ? 'global' : null, dom ? 'dom×' + dom + ' ' + sel : null].filter(Boolean).join(' + ') });
    }
    const html = document.documentElement;
    const platform = {
      next: !!(q('#__next') || window.__NEXT_DATA__ || window.next), nuxt: !!(q('#__nuxt') || window.__NUXT__),
      astro: !!q('astro-island,[astro-island]'), sveltekit: !!q('[data-sveltekit-preload-data]'),
      webflow: html.classList.contains('w-mod-js'), wordpress: !!q('link[href*="wp-content"]'),
      squarespace: !!(window.Static && window.Static.SQUARESPACE_CONTEXT), shopify: !!window.Shopify,
      wix: !!(window.wixBiSession || window.wixPerformanceMeasurements)
    };
    let ix2 = null;
    try {
      const st = window.Webflow && window.Webflow.require && window.Webflow.require('ix2').store.getState();
      if (st && st.ixData) {                                /* capped like every other collection: the raw store runs to MBs on interaction-heavy sites */
        const IXC = 60, ev = Object.entries(st.ixData.events || {}), al = Object.entries(st.ixData.actionLists || {});
        ix2 = { events: ev.length, actionLists: al.length, truncated: ev.length > IXC || al.length > IXC,
          data: { events: Object.fromEntries(ev.slice(0, IXC)), actionLists: Object.fromEntries(al.slice(0, IXC)) } };
        if (ix2.truncated) ix2.warnings = ['ix2 store capped at ' + IXC + ' events / ' + IXC + ' actionLists (' + ev.length + '/' + al.length + ' present) — recover the remainder from anims()/drain()'];
      }
    } catch (e) { ix2 = null; }
    let gsapDump = null;
    try {
      if (window.gsap) gsapDump = { version: window.gsap.version, tweens: cap(window.gsap.globalTimeline.getChildren(true, true, false), 120).map((t) => ({ targets: cap((t.targets() || []), 4).map((el) => (el && el.tagName ? U.cssPath(el) : String(el))), durationMs: Math.round(t.duration() * 1000), delayMs: Math.round(((t.vars && t.vars.delay) || 0) * 1000), ease: t.vars && String(t.vars.ease), repeat: t.vars && t.vars.repeat, yoyo: t.vars && t.vars.yoyo, stagger: t.vars && t.vars.stagger && (typeof t.vars.stagger === 'object' ? flat(t.vars.stagger) : { each: t.vars.stagger }), vars: Object.fromEntries(Object.entries(t.vars || {}).filter(([, v]) => typeof v !== 'function' && typeof v !== 'object').slice(0, 24)) })) };
      if (window.ScrollTrigger) gsapDump = Object.assign(gsapDump || {}, { scrollTriggers: cap(window.ScrollTrigger.getAll(), 80).map((s) => ({ trigger: s.trigger ? U.cssPath(s.trigger) : null, startPx: Math.round(s.start), endPx: Math.round(s.end), progress: num(s.progress), startVar: String(s.vars.start), endVar: String(s.vars.end), scrub: typeof s.vars.scrub === 'object' ? true : s.vars.scrub, pin: !!s.vars.pin, pinSpacing: s.vars.pinSpacing, toggleActions: s.vars.toggleActions, snap: typeof s.vars.snap === 'object' ? flat(s.vars.snap) : s.vars.snap })) });
    } catch (e) { gsapDump = gsapDump || null; }
    let swiperParams = null;
    try {
      const sw = document.querySelector('.swiper');
      if (sw && sw.swiper) swiperParams = { slidesPerView: sw.swiper.params.slidesPerView, spaceBetween: sw.swiper.params.spaceBetween, speed: sw.swiper.params.speed, effect: sw.swiper.params.effect, loop: sw.swiper.params.loop, autoplay: flat(sw.swiper.params.autoplay || {}), breakpoints: JSON.parse(JSON.stringify(sw.swiper.params.breakpoints || {})) };
    } catch (e) { swiperParams = null; }
    return { libraries, platform, ix2, gsap: gsapDump, swiperParams, smoothScrollHijack: libraries.some((l) => /lenis|locomotive|scrollSmoother/.test(l.name)), scriptUrls: cap([...document.querySelectorAll('script[src]')].map((s) => s.src), 120) };
  };

  M.cssom = () => {
    const keyframes = {}, propertyRules = [], startingStyle = [], timelines = [], reducedMotionRules = [], usages = [], transitionRules = [];
    const viewTransition = { rule: null, pseudos: [], names: [] };
    const blocked = U.walk((rule, ctx) => {
      const cx = ctx || [];
      const reduced = cx.some((c) => /prefers-reduced-motion/.test(String(c)));
      const kind = rule.constructor && rule.constructor.name;
      if (kind === 'CSSKeyframesRule') {
        const steps = [];
        for (const kf of rule.cssRules) steps.push({ offset: kf.keyText, decl: declText(kf.style) });
        keyframes[(reduced ? 'reduced:' : '') + rule.name] = { name: rule.name, reducedMotionVariant: reduced, steps, sources: cx, usedBy: [] };
        return;
      }
      if (kind === 'CSSPropertyRule') { propertyRules.push({ name: rule.name, syntax: rule.syntax, inherits: rule.inherits, initialValue: rule.initialValue }); return; }
      if (kind === 'CSSStartingStyleRule') { for (const r of rule.cssRules || []) startingStyle.push({ selector: r.selectorText || '', decl: r.style ? declText(r.style) : '', sources: cx }); return; }
      if (kind === 'CSSViewTransitionRule') { viewTransition.rule = { navigation: rule.navigation, types: rule.types || null }; return; }
      if (!rule.style || !rule.selectorText) return;
      const s = rule.style, get = (p) => s.getPropertyValue(p);
      const media = cx.filter((c) => /^@media/.test(String(c))).join(' ') || null;
      if (/^::view-transition/.test(rule.selectorText)) viewTransition.pseudos.push({ selector: rule.selectorText, decl: declText(s) });
      if (get('view-transition-name')) viewTransition.names.push({ selector: rule.selectorText, name: get('view-transition-name') });
      if (get('transition') || get('transition-property')) transitionRules.push({ selector: rule.selectorText.slice(0, 200), value: get('transition') || [get('transition-property'), get('transition-duration'), get('transition-timing-function'), get('transition-delay')].filter(Boolean).join(' '), behavior: get('transition-behavior') || null, media });
      if (get('animation-timeline') || get('scroll-timeline') || get('scroll-timeline-name') || get('view-timeline') || get('view-timeline-name') || get('timeline-scope') || get('animation-range')) {
        timelines.push({ selector: rule.selectorText, animationTimeline: get('animation-timeline'), animationRange: get('animation-range') || null, scrollTimeline: get('scroll-timeline') || get('scroll-timeline-name') || null, scrollTimelineAxis: get('scroll-timeline-axis') || null, viewTimeline: get('view-timeline') || get('view-timeline-name') || null, viewTimelineAxis: get('view-timeline-axis') || null, viewTimelineInset: get('view-timeline-inset') || null, timelineScope: get('timeline-scope') || null, media });
      }
      if (get('animation') || get('animation-name')) {
        let matches = 0;
        try { matches = document.querySelectorAll(rule.selectorText).length; } catch (e) { matches = -1; }
        usages.push({ selector: rule.selectorText, matches, name: get('animation-name'), duration: get('animation-duration'), easing: get('animation-timing-function'), delay: get('animation-delay'), iterations: get('animation-iteration-count'), direction: get('animation-direction'), fillMode: get('animation-fill-mode'), playState: get('animation-play-state'), composition: get('animation-composition') || null, shorthand: get('animation'), reducedMotionVariant: reduced, media });
      }
      if (reduced) reducedMotionRules.push({ condition: cx.filter((c) => /prefers-reduced-motion/.test(String(c))).join(' '), selector: rule.selectorText, decl: declText(s) });
    });
    for (const u of usages) for (const n of listOf(u.name)) { const k = keyframes[n]; if (k && k.usedBy.length < 12) k.usedBy.push(u.selector); }
    return {
      blocked,
      supports: { scrollTimeline: CSS.supports('animation-timeline', 'scroll()'), viewTimeline: CSS.supports('animation-timeline', 'view()'), animationRange: CSS.supports('animation-range', 'entry 0% cover 50%'), transitionBehavior: CSS.supports('transition-behavior', 'allow-discrete'), linearEasing: CSS.supports('transition-timing-function', 'linear(0, 0.5 50%, 1)'), viewTransitionsAPI: typeof document.startViewTransition === 'function' },
      counts: { keyframes: Object.keys(keyframes).length, usages: usages.length, timelines: timelines.length, reducedMotionRules: reducedMotionRules.length, transitionRules: transitionRules.length },
      keyframes, propertyRules, startingStyle, timelines, reducedMotionRules, usages, viewTransition,
      transitionRules: cap(transitionRules, 400)
    };
  };

  M.transitions = () => {
    const P = ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior', 'will-change'];
    const roleOf = (el) => {
      const t = el.tagName.toLowerCase(), cls = String(el.className || '').toLowerCase();
      if (t === 'a' && el.closest('nav,header')) return 'nav-link';
      if (t === 'button' || el.getAttribute('role') === 'button' || /\bbtn|button|cta\b/.test(cls)) return 'button';
      if (t === 'a') return 'link';
      if (/card|tile|item|post|product/.test(cls)) return 'card';
      if (t === 'img' || t === 'picture' || t === 'video' || /media|thumb|image/.test(cls)) return 'media';
      if (/^(input|textarea|select)$/.test(t)) return 'field';
      if (t === 'dialog' || /nav|menu|drawer|overlay|modal|dialog|backdrop/.test(cls)) return 'overlay';
      if (t === 'header' || t === 'nav') return 'chrome';
      if (t === 'svg' || t === 'path' || /icon|arrow|chevron|caret/.test(cls)) return 'icon';
      return el.closest('section,article,footer,header') ? 'section-child' : 'other';
    };
    const groups = {};
    let scanned = 0, withTransition = 0;
    for (const el of document.querySelectorAll('*')) {
      if (++scanned > 6000) break;
      const st = U.style(el, P);
      const propRaw = st['transition-property'];
      if (!propRaw || propRaw === 'none' || propRaw === 'all 0s ease 0s') continue;
      const props = listOf(propRaw), durs = listOf(st['transition-duration']), eases = listOf(st['transition-timing-function']), delays = listOf(st['transition-delay']), behs = listOf(st['transition-behavior']);
      const legs = props.map((p, i) => ({ property: p, durationMs: ms(durs[i % (durs.length || 1)] || '0s'), easing: eases[i % (eases.length || 1)] || 'ease', delayMs: ms(delays[i % (delays.length || 1)] || '0s'), behavior: behs[i % (behs.length || 1)] || 'normal' })).filter((l) => l.durationMs > 0 || l.delayMs > 0);
      if (!legs.length) continue;
      withTransition++;
      const signature = legs.map((l) => l.property + ' ' + l.durationMs + 'ms ' + l.easing + (l.delayMs ? ' +' + l.delayMs + 'ms' : '') + (l.behavior !== 'normal' ? ' ' + l.behavior : '')).join(' | ');
      const role = roleOf(el), key = role + '§' + signature;
      const g = (groups[key] = groups[key] || { role, signature, properties: legs.map((l) => l.property), durationMs: legs.map((l) => l.durationMs), easings: legs.map((l) => l.easing), delayMs: legs.map((l) => l.delayMs), behaviors: legs.map((l) => l.behavior), willChange: st['will-change'], count: 0, samplePaths: [] });
      g.count++;
      if (g.samplePaths.length < 3) g.samplePaths.push(U.cssPath(el));
    }
    const transitions = Object.values(groups).sort((a, b) => b.count - a.count);
    const byRole = {};
    for (const t of transitions) if (!byRole[t.role]) byRole[t.role] = t.signature;
    return { scanned, withTransition, canonicalByRole: byRole, transitions: cap(transitions, 120) };
  };

  M.anims = (label) => {
    const list = document.getAnimations().map((a, i) => {
      const e = a.effect, tl = a.timeline, timeline = { type: tl ? tl.constructor.name : null };
      if (tl) {
        if (tl.source) timeline.source = U.cssPath(tl.source);
        if (tl.subject) timeline.subject = U.cssPath(tl.subject);
        if (tl.axis) timeline.axis = tl.axis;
        if (tl.startOffset) timeline.startOffset = String(tl.startOffset);
        if (tl.endOffset) timeline.endOffset = String(tl.endOffset);
      }
      const timing = e && e.getTiming ? flat(e.getTiming()) : null;
      const ct = e && e.getComputedTiming ? e.getComputedTiming() : null;
      return {
        i, kind: a.constructor.name === 'Animation' ? 'waapi' : 'css', ctor: a.constructor.name,
        name: a.animationName || a.transitionProperty || a.id || null,
        target: e && e.target ? U.cssPath(e.target) : null, targetTag: e && e.target ? e.target.tagName : null,
        pseudo: (e && e.pseudoElement) || null, playState: a.playState, playbackRate: a.playbackRate,
        replaceState: a.replaceState, overallProgress: typeof a.overallProgress === 'number' ? num(a.overallProgress) : null,
        timeline, timing,
        computed: ct ? { activeDuration: typeof ct.activeDuration === 'number' ? num(ct.activeDuration) : String(ct.activeDuration), progress: ct.progress == null ? null : num(ct.progress), currentIteration: ct.currentIteration } : null,
        keyframes: e && e.getKeyframes ? cap(e.getKeyframes().map(flat), 24) : null
      };
    });
    const groups = {};
    for (const a of list) {
      const key = [a.ctor, a.name, JSON.stringify(a.timing && Object.assign({}, a.timing, { delay: 0 })), JSON.stringify(a.keyframes)].join('§');
      (groups[key] = groups[key] || { kind: a.kind, name: a.name, timing: a.timing, keyframes: a.keyframes, timeline: a.timeline, playState: a.playState, members: [] }).members.push({ target: a.target, pseudo: a.pseudo, delay: (a.timing && a.timing.delay) || 0 });
    }
    const animations = Object.values(groups).map((g) => {
      const ds = g.members.map((m) => m.delay).sort((x, y) => x - y);
      const steps = ds.slice(1).map((d, i) => +(d - ds[i]).toFixed(2));
      const uniform = steps.length && steps.every((s) => Math.abs(s - steps[0]) < 2);
      const t = g.timing || {};
      return { target: g.members[0].target, name: g.name, kind: g.kind, durationMs: typeof t.duration === 'number' ? num(t.duration) : (t.duration || null), delayMs: num(ds[0]) || 0, easing: t.easing || null, iterations: String(t.iterations), direction: t.direction || null, fillMode: t.fill || null, playState: g.playState, timeline: g.timeline && g.timeline.type, groupCount: g.members.length, staggerMs: uniform ? steps[0] : null, delays: cap(ds, 16), targets: cap(g.members.map((m) => m.target), 8), keyframes: g.keyframes };
    }).sort((a, b) => b.groupCount - a.groupCount);
    return { at: { label: label || 'load', scrollY: U.scrollY(), w: innerWidth, h: innerHeight, t: Math.round(performance.now()) }, count: list.length, groupCount: animations.length, animations: cap(animations, 80), loops: animations.filter((a) => a.iterations === 'Infinity').map((a) => ({ target: a.target, name: a.name, durationMs: a.durationMs, easing: a.easing })), raw: cap(list, 120) };
  };

  M.fit = (pairs) => {
    const s = pairs.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.v)).sort((a, b) => a.x - b.x);
    if (s.length < 3) return { kind: 'insufficient' };
    const vs = s.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo;
    if (span < 0.001) return { kind: 'constant', from: lo, to: lo };
    let i = 0; while (i < s.length - 1 && Math.abs(s[i + 1].v - s[i].v) < span * 0.01) i++;
    let j = s.length - 1; while (j > i + 1 && Math.abs(s[j].v - s[j - 1].v) < span * 0.01) j--;
    const act = s.slice(i, j + 1), n = act.length;
    const range = { start: num(s[i].x), end: num(s[j].x) };
    const mx = act.reduce((a, p) => a + p.x, 0) / n, mv = act.reduce((a, p) => a + p.v, 0) / n;
    const sxx = act.reduce((a, p) => a + (p.x - mx) * (p.x - mx), 0);
    const m = sxx ? act.reduce((a, p) => a + (p.x - mx) * (p.v - mv), 0) / sxx : 0, b = mv - m * mx;
    const ssTot = act.reduce((a, p) => a + (p.v - mv) * (p.v - mv), 0);
    const ssRes = act.reduce((a, p) => a + (p.v - (m * p.x + b)) * (p.v - (m * p.x + b)), 0);
    const r2 = ssTot ? 1 - ssRes / ssTot : 1;
    const dv = act[n - 1].v - act[0].v, dx = (range.end - range.start) || 1;
    const norm = act.map((p) => ({ t: (p.x - range.start) / dx, u: dv ? (p.v - act[0].v) / dv : 0 }));
    const up = norm.every((p, k) => k === 0 || p.u >= norm[k - 1].u - 0.02), dn = norm.every((p, k) => k === 0 || p.u <= norm[k - 1].u + 0.02);
    return { kind: r2 > 0.995 ? 'linear' : (up || dn ? 'eased' : 'nonMonotone'), range, from: num(act[0].v), to: num(act[n - 1].v), slopePerProgress: num(m), r2: num(r2), linearEasing: 'linear(' + norm.map((p) => num(p.u) + ' ' + num(p.t * 100) + '%').join(', ') + ')', keyframeOffsets: norm.map((p) => ({ offset: num(p.t * 100) + '%', value: num(act[0].v + p.u * dv) })) };
  };

  M.scrollTargets = () => {
    if (Array.isArray(root.state.scrollTargets) && root.state.scrollTargets.length) return root.state.scrollTargets;
    const picked = new Map();
    const add = (el, why) => { const p = el && U.cssPath(el); if (p && !picked.has(p) && picked.size < 40) picked.set(p, why); };
    document.querySelectorAll('[data-scroll],[data-aos],[data-w-id],[data-rellax-speed],[data-scroll-speed],[data-sr-id]').forEach((el) => add(el, 'attr'));
    let scanned = 0;
    for (const el of document.querySelectorAll('*')) {
      if (++scanned > 4000 || picked.size >= 40) break;
      const cs = getComputedStyle(el);
      if (/sticky|fixed/.test(cs.position)) add(el, 'pinned');
      else if (cs.transform && cs.transform !== 'none') add(el, 'transform');
      else if (parseFloat(cs.opacity) < 1) add(el, 'opacity');
      else if (cs.animationTimeline && cs.animationTimeline !== 'auto') add(el, 'timeline');
    }
    document.querySelectorAll('body > *, main > section, main > div').forEach((el) => add(el, 'section'));
    root.state.scrollTargets = [...picked.keys()];
    root.state.scrollTargetWhy = Object.fromEntries(picked);
    return root.state.scrollTargets;
  };

  M.scroll = async (steps) => {
    const sels = M.scrollTargets(), N = Math.max(3, steps || 21), max = U.maxScroll(), vh = innerHeight;
    const CH = ['transform', 'opacity', 'filter', 'clip-path', 'background-position', 'background-size', 'color', 'background-color', 'width', 'height', 'letter-spacing', 'border-radius', 'top'];
    const CUSTOM = ['--progress', '--scroll', '--p', '--y', '--offset', '--clone-scroll-progress'];
    const read = () => sels.map((sel) => {
      let el = null;
      try { el = document.querySelector(sel); } catch (e) { el = null; }
      if (!el) return { sel, missing: true };
      const st = U.style(el, CH), cs = getComputedStyle(el), r = el.getBoundingClientRect(), m = U.matrix(st.transform) || {};
      const custom = {};
      for (const p of CUSTOM) { const v = cs.getPropertyValue(p); if (v) custom[p] = v.trim(); }
      return { sel, ch: { ty: m.ty == null ? null : m.ty, tx: m.tx == null ? null : m.tx, sx: m.sx == null ? null : m.sx, rot: m.rot == null ? null : m.rot, opacity: parseFloat(st.opacity), blur: (() => { const g = /blur\(([\d.]+)px\)/.exec(st.filter || ''); return g ? +g[1] : null; })() }, str: { transform: st.transform, filter: st.filter, clipPath: st['clip-path'], bgPos: st['background-position'], bgSize: st['background-size'], color: st.color, bg: st['background-color'], top: st.top }, w: num(r.width), h: num(r.height), vpTop: num(r.top), cover: num((vh - r.top) / (vh + r.height)), custom, anims: el.getAnimations({ subtree: false }).map((a) => ({ ctor: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || null, state: a.playState, tl: a.timeline && a.timeline.constructor.name, progress: a.effect && a.effect.getComputedTiming ? num(a.effect.getComputedTiming().progress) : null })) };
    });
    const out = { max, viewport: { w: innerWidth, h: vh }, docHeightAtStart: document.documentElement.scrollHeight, targets: sels, why: root.state.scrollTargetWhy || {}, samples: [], docHeightDrift: false, warnings: [] };
    for (let k = 0; k < N; k++) {
      const y = Math.round(max * k / (N - 1));
      const landed = await U.scrollTo(y);
      const s = await U.settle(read, { maxFrames: 150, stable: 5 });
      out.samples.push({ y, landed, p: num(y / (max || 1)), settled: s.settled, frames: s.frames, docHeight: document.documentElement.scrollHeight, els: s.value });
      if (!s.settled) out.warnings.push('unsettled at y=' + y);
    }
    await U.scrollTo(0);
    const heights = out.samples.map((s) => s.docHeight);
    if (Math.max(...heights) - Math.min(...heights) > 8) { out.docHeightDrift = true; out.warnings.push('docHeight drifted ' + Math.min(...heights) + '→' + Math.max(...heights) + ' — lazy content or virtualisation; scroll fits are approximate'); }
    const UNIT = { ty: 'px', tx: 'px', sx: '', rot: 'deg', opacity: '', blur: 'px' };
    out.scrollLinked = [];
    sels.forEach((sel, idx) => {
      for (const ch of ['ty', 'tx', 'sx', 'rot', 'opacity', 'blur']) {
        const byPage = [], byCover = [], samples = [];
        for (const s of out.samples) {
          const e = s.els[idx];
          if (!e || e.missing || e.ch[ch] == null) continue;
          byPage.push({ x: s.p, v: e.ch[ch] });
          byCover.push({ x: e.cover, v: e.ch[ch] });
          samples.push({ y: s.y, v: num(e.ch[ch]) });
        }
        if (byPage.length < 3) continue;
        const fp = M.fit(byPage), fc = M.fit(byCover);
        if (fp.kind === 'constant' || fp.kind === 'insufficient') continue;
        const useCover = (fc.r2 || 0) > (fp.r2 || 0) + 0.01;
        const fit = useCover ? fc : fp;
        out.scrollLinked.push({ target: sel, driver: useCover ? 'cover' : 'page', channel: ch, range: fit.range, from: fit.from, to: fit.to, unit: UNIT[ch], fit: { kind: fit.kind, r2: fit.r2 }, linearEasing: fit.linearEasing, keyframeOffsets: fit.keyframeOffsets, samples, evidence: 'motion-scroll.json#samples[].els[' + idx + '].ch.' + ch });
      }
    });
    return out;
  };

  M.drain = () => {
    const L = window.__cloneHooks;
    if (!L) return { error: 'hooks not installed — re-navigate with the HOOKS initScript from references/motion.md', animate: [], observers: [], events: [], rafBursts: 0, errors: [] };
    const byName = {};
    for (const e of L.events) {
      const k = (e.name || '?') + '·' + e.type;
      const b = (byName[k] = byName[k] || { name: e.name, type: e.type, n: 0, firstT: e.t, lastT: e.t, elapsed: [], tags: [], pseudo: [] });
      b.n++; b.lastT = e.t;
      if (b.elapsed.length < 6 && !b.elapsed.includes(e.elapsed)) b.elapsed.push(e.elapsed);
      if (b.tags.length < 6 && !b.tags.includes(e.tag)) b.tags.push(e.tag);
      if (e.pseudo && !b.pseudo.includes(e.pseudo)) b.pseudo.push(e.pseudo);
    }
    const events = Object.values(byName).sort((a, b) => b.n - a.n);
    const seen = new Map();
    for (const a of L.animate) {
      const k = JSON.stringify([a.keyframes, a.options]);
      const g = seen.get(k) || { keyframes: a.keyframes, options: a.options, n: 0, targets: [], stack: a.stack };
      g.n++;
      if (g.targets.length < 6) g.targets.push(a.tag + (a.cls ? '.' + String(a.cls).split(/\s+/)[0] : ''));
      seen.set(k, g);
    }
    return { eventTypes: events.length, events: cap(events, 120), loops: events.filter((e) => e.type === 'animationiteration' && e.n > 2).map((e) => ({ name: e.name, iterations: e.n })), animate: cap([...seen.values()].sort((a, b) => b.n - a.n), 60), observers: cap(L.observers, 60), rafBursts: L.rafBursts || 0, errors: L.errors || [] };
  };

  M.states = async (sel, waitMs) => {
    if (!sel) {
      const rules = [], groups = {};
      /* the pointer route cannot reach the form/dialog states (motion.md M7), so the CSSOM route must name them */
      const norm = (v) => { const m = /:(hover|focus-visible|focus-within|focus|active|target|user-invalid|invalid|valid|placeholder-shown|indeterminate|checked|disabled|autofill|popover-open|open|modal|fullscreen)\b/.exec(v); return m ? m[1] : null; };
      const blocked = U.walk((rule, ctx) => {
        const cx = ctx || [], s = rule.selectorText;
        if (!s || !rule.style) return;
        if (!STATE.test(s) && !STATE_ATTR.test(s)) return;
        const live = [];
        for (const part of s.split(/,(?![^(]*\))/).map((x) => x.trim())) {
          if (!STATE.test(part) && !STATE_ATTR.test(part)) continue;
          const base = part.replace(STATE, '').replace(/::[a-z-]+(\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim();
          let n = 0;
          try { n = base ? document.querySelectorAll(base).length : 0; } catch (e) { n = -1; }
          if (n !== 0) live.push({ variant: part, base, matches: n, state: norm(part) });
        }
        if (!live.length) return;
        const decl = declText(rule.style);
        const media = cx.filter((c) => /^@media/.test(String(c))).join(' ') || null;
        rules.push({ selector: s.slice(0, 300), state: live[0].state, live, decl, media, gatedBy: media && /hover/.test(media) ? media : null, reducedMotion: cx.some((c) => /prefers-reduced-motion/.test(String(c))) });
        (groups[decl] = groups[decl] || { decl, selectors: [] }).selectors.push(s.slice(0, 120));
      });
      return { route: 'cssom', blocked, count: rules.length, common: Object.values(groups).filter((g) => g.selectors.length > 1).sort((a, b) => b.selectors.length - a.selectors.length).slice(0, 20), rules: cap(rules, 400) };
    }
    let el = null;
    try { el = document.querySelector(sel); } catch (e) { el = null; }
    if (!el) return { sel, missing: true };
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const snap = (pseudo) => {
      const st = U.style(el, STATE_PROPS, pseudo);
      if (pseudo) st.content = getComputedStyle(el, pseudo).content;
      return st;
    };
    const cs = getComputedStyle(el);
    const now = { base: snap(null), before: snap('::before'), after: snap('::after') };
    const rec = {
      sel, route: 'live', waitMs: waitMs || 0,
      matchesHover: el.matches(':hover'), matchesFocus: el.matches(':focus'),
      matchesFocusVisible: (() => { try { return el.matches(':focus-visible'); } catch (e) { return null; } })(),
      matchesActive: el.matches(':active'), classList: [...el.classList],
      ariaExpanded: el.getAttribute('aria-expanded'), rect: U.rect(el),
      settleMs: Math.min(2000, Math.max(0, ...listOf(cs.transitionDuration).map(ms)) + Math.max(0, ...listOf(cs.transitionDelay).map(ms)) + 60),
      transition: cs.transition,
      snapshot: now,
      anims: el.getAnimations({ subtree: true }).map((a) => ({ ctor: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || null, state: a.playState, pseudo: (a.effect && a.effect.pseudoElement) || null, target: a.effect && a.effect.target ? U.cssPath(a.effect.target) : null, timing: a.effect && a.effect.getTiming ? flat(a.effect.getTiming()) : null, progress: a.effect && a.effect.getComputedTiming ? num(a.effect.getComputedTiming().progress) : null, keyframes: a.effect && a.effect.getKeyframes ? cap(a.effect.getKeyframes().map(flat), 12) : null }))
    };
    root.state.rest = root.state.rest || {};
    if (!waitMs) { root.state.rest[sel] = now; rec.storedAsRest = true; return rec; }
    const rest = root.state.rest[sel];
    if (rest) {
      rec.delta = {};
      for (const part of ['base', 'before', 'after']) {
        for (const p of Object.keys(now[part])) if (rest[part] && rest[part][p] !== now[part][p]) rec.delta[(part === 'base' ? '' : part + ' ') + p] = { from: rest[part][p], to: now[part][p] };
      }
      rec.changedCount = Object.keys(rec.delta).length;
    } else rec.warning = 'no rest snapshot cached for this selector — call states(sel) before hovering';
    return rec;
  };

  M.page = () => {
    const html = document.documentElement, body = document.body;
    const S = ['scroll-behavior', 'overscroll-behavior', 'scroll-snap-type', 'scroll-padding-top', 'scroll-margin', 'scrollbar-gutter', 'scrollbar-width', 'scrollbar-color', 'overflow', 'overflow-x', 'overflow-y', 'touch-action', 'overflow-anchor', 'view-transition-name'];
    const containers = [], snapChildren = [], pinned = [];
    let scanned = 0;
    for (const el of document.querySelectorAll('*')) {
      if (++scanned > 6000) break;
      const s = getComputedStyle(el);
      if (containers.length < 40) {
        const yy = /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight - el.clientHeight > 2;
        const xx = /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth - el.clientWidth > 2;
        if (yy || xx) containers.push({ path: U.cssPath(el), axis: xx && yy ? 'both' : (xx ? 'x' : 'y'), snapType: s.scrollSnapType, behavior: s.scrollBehavior, scrollSize: { w: el.scrollWidth, h: el.scrollHeight }, clientSize: { w: el.clientWidth, h: el.clientHeight } });
      }
      if (snapChildren.length < 60 && s.scrollSnapAlign && s.scrollSnapAlign !== 'none') snapChildren.push({ path: U.cssPath(el), align: s.scrollSnapAlign, stop: s.scrollSnapStop });
      if (pinned.length < 60 && /sticky|fixed/.test(s.position)) pinned.push({ path: U.cssPath(el), position: s.position, top: s.top, bottom: s.bottom, zIndex: s.zIndex, height: s.height, backdropFilter: s.backdropFilter, background: s.backgroundColor, transform: s.transform, transition: s.transition, willChange: s.willChange, rect: U.rect(el) });
    }
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;top:-9999px;left:0;width:100vw;height:100vh;pointer-events:none';
    body.appendChild(d);
    const units = { vw: num(d.getBoundingClientRect().width), vh: num(d.getBoundingClientRect().height) };
    d.style.height = '100dvh'; units.dvh = num(d.getBoundingClientRect().height);
    d.style.height = '100svh'; units.svh = num(d.getBoundingClientRect().height);
    d.style.height = '100lvh'; units.lvh = num(d.getBoundingClientRect().height);
    d.remove();
    units.scrollbar = num(units.vw - html.clientWidth);
    return {
      root: U.style(html, S), body: U.style(body, S),
      pageScroll: { scrollBehavior: getComputedStyle(html).scrollBehavior, overscroll: getComputedStyle(html).overscrollBehavior, snapType: getComputedStyle(html).scrollSnapType, snapChildren: snapChildren.length, scrollPaddingTop: getComputedStyle(html).scrollPaddingTop, viewTransitions: typeof document.startViewTransition === 'function' && !!document.querySelector('[style*="view-transition-name"]'), smoothScrollLib: (window.lenis && 'lenis') || (window.locoScroll || window.locomotiveScroll ? 'locomotive' : null) || ((window.ScrollSmoother && window.ScrollSmoother.get && window.ScrollSmoother.get()) ? 'scrollSmoother' : null) },
      lenisOptions: (() => { try { return window.lenis && window.lenis.options ? JSON.parse(JSON.stringify(window.lenis.options)) : null; } catch (e) { return null; } })(),
      media: { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches, forcedColors: matchMedia('(forced-colors: active)').matches, hover: matchMedia('(hover: hover)').matches, pointerCoarse: matchMedia('(pointer: coarse)').matches },
      viewTransitionNames: cap([...document.querySelectorAll('*')].filter((el) => { const v = getComputedStyle(el).viewTransitionName; return v && v !== 'none'; }).map((el) => ({ path: U.cssPath(el), name: getComputedStyle(el).viewTransitionName })), 40),
      containers, snapChildren, pinned, units,
      docScroll: { height: html.scrollHeight, clientHeight: html.clientHeight, maxScroll: U.maxScroll() }
    };
  };

  return { ok: true, installed: Object.keys(M), utilFilled: filled, hooks: !!window.__cloneHooks, v: root.v };
}
