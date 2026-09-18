() => {
  /* clone-site / scripts/extract-motion-attrs.js — installer payload for DECLARATIVE motion.
     Algorithm and the reason this exists: references/motion-source.md §S6.

     A custom motion system is attribute-driven and the attribute names are the author's own,
     not a library's — `data-anim`, `data-reveal`, `data-parallax`, `data-split-lines`,
     `data-scroll-speed`, whatever they invented. So this payload DISCOVERS the vocabulary
     rather than hard-coding it, then harvests it per section.

     INSTALL (once per navigation; re-install after every navigate_page including reload —
     resize_page does not wipe page state). Read this file and pass its ENTIRE contents as
     the `function` argument to evaluate_script. Install returns {ok,installed,v}.

     PASSES, each with its own filePath:
       () => window.__clone.motionAttrs.vocabulary()      -> .clone/raw/motion-vocab.json
       () => window.__clone.motionAttrs.all()             -> .clone/raw/motion-attrs.json
       () => window.__clone.motionAttrs.section('<sel>')  -> one section, for a spec

     Run it AFTER the prewarm (so lazy sections exist) but note that a `once:true` reveal
     which has already fired may have had its attribute rewritten by the site's own JS — e.g.
     `data-anim-trigger` becoming `"ready"`. That rewrite is itself evidence and is reported
     verbatim; §S3 row 5 explains why. */
  const root = (window.__clone = window.__clone || {});
  root.v = root.v || 1;
  root.state = root.state || {};
  const U = (root.util = root.util || {});
  const filled = [];

  /* Stand-alone fallbacks, so this payload works without extract-foundation/sections. */
  if (!U.cssPath) {
    filled.push('cssPath');
    U.cssPath = function (el) {
      if (!el || el.nodeType !== 1) return null;
      const parts = [];
      let n = el;
      while (n && n.nodeType === 1 && parts.length < 12) {
        if (n === document.body) { parts.unshift('body'); break; }
        if (n === document.documentElement) { parts.unshift('html'); break; }
        const p = n.parentElement;
        if (!p) break;
        const tag = n.tagName.toLowerCase();
        const same = Array.prototype.filter.call(p.children, (c) => c.tagName === n.tagName);
        parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(n) + 1) + ')' : tag);
        n = p;
      }
      return parts.join(' > ');
    };
  }
  const R = Math.round;
  const cls = (el) => {
    /* An SVG element's className is an SVGAnimatedString, NOT a string: String(el.className)
       yields "[object SVGAnimatedString]" and the real classes are lost. That silently cost a
       real run its background-glyph rules. Always go through baseVal for SVG. */
    const c = el.className;
    if (c && typeof c === 'object' && 'baseVal' in c) return String(c.baseVal);
    return String(c == null ? '' : c);
  };

  /* Names that mark motion when they appear in a data-* attribute. Deliberately generous:
     a false positive costs one harmless row, a false negative loses a whole behaviour. */
  const MOTION_WORD = /(anim|motion|reveal|inview|in-view|appear|enter|exit|fade|slide|parallax|split|stagger|delay|duration|ease|easing|trigger|scroll|marquee|ticker|swiper|slider|carousel|tilt|lag|speed|magnet|cursor|sticky|pin|scrub|lottie|rive|counter|typewriter|blur|zoom)/i;

  /* Attributes that are motion-relevant but are NOT data-* — library conventions. */
  const NON_DATA = ['x-transition', 'x-data', 'data-w-id', 'data-framer-appear-id',
    'data-aos', 'data-sr-id', 'data-barba', 'data-load-namespace', 'data-header'];

  const isMotionAttr = (name) =>
    (name.indexOf('data-') === 0 && MOTION_WORD.test(name)) || NON_DATA.indexOf(name) >= 0;

  const describe = (el, rootEl) => {
    const attrs = {};
    for (const a of el.attributes) if (isMotionAttr(a.name)) attrs[a.name] = a.value;
    if (!Object.keys(attrs).length) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      path: rootEl ? relPath(rootEl, el) : U.cssPath(el),
      absPath: U.cssPath(el),
      tag: el.tagName.toLowerCase(),
      cls: cls(el).slice(0, 120),
      attrs: attrs,
      /* the current visual state, which tells you whether this reveal has already fired */
      opacity: cs.opacity,
      transform: cs.transform === 'none' ? null : cs.transform.slice(0, 80),
      visibility: cs.visibility,
      /* wrapper/child classes a splitter injected — the thing the clone must reproduce */
      splitChildren: {
        line: el.querySelectorAll('.line').length,
        char: el.querySelectorAll('.char').length,
        word: el.querySelectorAll('.word').length,
        mask: el.querySelectorAll('[class*="mask"]').length,
      },
      box: { x: R(r.x), y: R(r.y + window.scrollY), w: R(r.width), h: R(r.height) },
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70),
    };
  };

  /* path of `el` relative to `rootEl`, so a section spec can locate the same node */
  function relPath(rootEl, el) {
    const parts = [];
    let n = el;
    while (n && n !== rootEl) {
      const p = n.parentElement;
      if (!p) break;
      const same = Array.prototype.filter.call(p.children, (c) => c.tagName === n.tagName);
      parts.unshift(same.length > 1
        ? n.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(n) + 1) + ')'
        : n.tagName.toLowerCase());
      n = p;
    }
    return parts.join(' > ') || '(root)';
  }

  const M = (root.motionAttrs = {
    /* Which motion attributes does this site actually use, and how often? Read this FIRST:
       it is the site's own motion vocabulary, and it tells you what to grep the bundle for
       (references/motion-source.md §S3). */
    vocabulary: function () {
      const counts = {}, values = {}, examples = {};
      for (const el of document.querySelectorAll('*')) {
        for (const a of el.attributes) {
          if (!isMotionAttr(a.name)) continue;
          counts[a.name] = (counts[a.name] || 0) + 1;
          if (a.value) {
            values[a.name] = values[a.name] || {};
            values[a.name][a.value] = (values[a.name][a.value] || 0) + 1;
          }
          if (!examples[a.name]) examples[a.name] = U.cssPath(el);
        }
      }
      const vocab = Object.keys(counts).sort((x, y) => counts[y] - counts[x]).map((name) => ({
        name: name,
        count: counts[name],
        distinctValues: values[name] ? Object.keys(values[name]).length : 0,
        values: values[name] || null,
        firstAt: examples[name],
      }));
      return {
        ok: true,
        vocabulary: vocab,
        /* The IO-vs-ScrollTrigger check from §S7, answered from the DOM side. */
        hints: {
          hasPinSpacer: !!document.querySelector('.pin-spacer'),
          htmlDataAttrs: Object.keys(document.documentElement.dataset),
          bodyDataAttrs: Object.keys(document.body.dataset),
          splitArtifacts: {
            line: document.querySelectorAll('.line').length,
            char: document.querySelectorAll('.char').length,
            maskish: document.querySelectorAll('[class*="mask"]').length,
          },
        },
      };
    },

    /* Every element carrying a motion attribute, page-wide, in document order. */
    all: function () {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const d = describe(el, null);
        if (d) out.push(d);
        if (out.length >= 1200) break;
      }
      return { ok: true, count: out.length, elements: out,
        route: (function () {
          /* per-route container attributes: the page-transition namespace and any theme
             attribute the site copies onto <html> (§S3 row 10) */
          const c = document.querySelector('[data-barba="container"], [data-load-namespace], main');
          return c ? { tag: c.tagName.toLowerCase(), attrs: (function () {
            const o = {}; for (const a of c.attributes) if (a.name.indexOf('data-') === 0) o[a.name] = a.value; return o;
          })() } : null;
        })() };
    },

    /* One section's slice, paths relative to that section's root — this is what goes into a
       section agent's spec.json as motion.attrs[] (references/agent-brief.md). */
    section: function (selector) {
      const rootEl = document.querySelector(selector);
      if (!rootEl) return { ok: false, why: 'no match for ' + selector };
      const out = [];
      const d0 = describe(rootEl, rootEl);
      if (d0) out.push(d0);
      for (const el of rootEl.querySelectorAll('*')) {
        const d = describe(el, rootEl);
        if (d) out.push(d);
        if (out.length >= 400) break;
      }
      return { ok: true, selector: selector, count: out.length, elements: out };
    },
  });

  U.motionAttrIsMotion = isMotionAttr;
  return { ok: true, installed: Object.keys(M).map((k) => 'motionAttrs.' + k),
    utilFilled: filled, v: root.v };
}
