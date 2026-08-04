() => {
  /* clone-site / scripts/probe-responsive.js — installer payload for responsive truth.
     CONTRACT — measure() is called ONCE PER BREAKPOINT by the orchestrator; it measures the
     stored probe set at whatever viewport is currently active and knows nothing about the sweep.
       1. install once per navigation:  evaluate_script(function = <entire contents of this file>)
       2. () => window.__clone.responsive.breakpoints()      -> .clone/raw/breakpoints.json
          caches the media-query list on window.__clone.state.mqList
       3. resize to the primary width, then
          () => window.__clone.responsive.probes()           -> .clone/raw/probes.json
          caches the probe selectors on window.__clone.state.probes
       4. per viewport, in ASCENDING width order:
            cdp:resize_page {width,height}   (or cdp:emulate for the DPR/mobile re-verify)
            () => window.__clone.responsive.measure('resize')  -> .clone/raw/vp-<w>.json
            () => window.__clone.responsive.overflow()         -> .clone/raw/overflow-<w>.json
       5. at 390 width, after cdp:click on the toggle:
            () => window.__clone.responsive.drawer()                    -> candidates only
            () => window.__clone.responsive.drawer('<toggle>','<panel>',0)   closed baseline
            () => window.__clone.responsive.drawer('<toggle>','<panel>',400) -> .clone/raw/drawer.json
       6. solve fluid values without leaving the browser, interpolating the sample table into the
          call source (args takes element uids only, never JSON):
            () => window.__clone.responsive.fitFluid([[320,32],[768,55],[1440,89.4],[1920,88]])
     Reinstall after any navigate_page (including reload). resize_page and emulate do NOT wipe state,
     but emulate can trigger a reload — re-check window.__clone.v before trusting a measure() call.
     Uses window.__clone.util when scripts/extract-foundation.js installed it, and fills in whatever
     helper it needs itself, so it also runs standalone. */
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
  need('style', (el, props, pseudo) => {
    const cs = getComputedStyle(el, pseudo || null), o = {};
    for (const p of props) o[p] = cs.getPropertyValue(p);
    return o;
  });
  need('rect', (el) => {
    const r = el.getBoundingClientRect();
    return { x: num(r.x), y: num(r.y), docY: num(r.y + (window.scrollY || 0)), w: num(r.width), h: num(r.height) };
  });

  const R = (root.responsive = {});
  const MEASURE_PROPS = ['display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'order', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow', 'grid-column', 'grid-row', 'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'font-size', 'line-height', 'letter-spacing', 'font-weight', 'font-family', 'text-align', 'text-wrap', 'white-space', 'transform', 'translate', 'opacity', 'visibility', 'overflow-x', 'overflow-y', 'aspect-ratio', 'column-count', 'border-radius', 'background-image', 'background-size', 'background-position', 'background-repeat', 'top', 'right', 'bottom', 'left', 'z-index', 'object-fit', 'object-position', 'container-type', 'writing-mode', 'flex-basis', 'flex-grow'];

  R.breakpoints = () => {
    const MQ_UNIT = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, rem: 16, em: 16 };
    const toPx = (n, u) => +(n * (MQ_UNIT[String(u || 'px').toLowerCase()] || 1)).toFixed(2);
    const FLIP = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };
    const atoms = (q) => {
      const out = [];
      for (const m of q.matchAll(/\(\s*(min|max)-(width|height)\s*:\s*(-?[\d.]+)([a-z]*)\s*\)/gi)) out.push({ axis: m[2].toLowerCase(), op: m[1].toLowerCase() === 'min' ? '>=' : '<=', px: toPx(+m[3], m[4]), src: m[0] });
      for (const m of q.matchAll(/\(\s*(?:(-?[\d.]+)([a-z]*)\s*(<=|<|>=|>)\s*)?(width|height)\s*(?:(<=|<|>=|>)\s*(-?[\d.]+)([a-z]*)\s*)?\)/gi)) {
        const axis = m[4].toLowerCase();
        if (m[1] && m[3]) out.push({ axis, op: FLIP[m[3]], px: toPx(+m[1], m[2]), src: m[0] });
        if (m[6] && m[5]) out.push({ axis, op: m[5], px: toPx(+m[6], m[7]), src: m[0] });
      }
      return out;
    };
    const queries = new Map(), containerQueries = [], nonSize = new Map();
    const blocked = U.walk((rule, ctx) => {
      if (rule.media && rule.cssRules) {
        const q = rule.conditionText;
        const rec = queries.get(q) || { condition: q, ruleCount: 0, selectorSamples: [], atoms: atoms(q), matchesNow: matchMedia(q).matches };
        rec.ruleCount += rule.cssRules.length;
        for (const r of rule.cssRules) if (r.selectorText && rec.selectorSamples.length < 6) rec.selectorSamples.push(r.selectorText.slice(0, 90));
        queries.set(q, rec);
        for (const f of q.matchAll(/\(\s*([a-z-]+)\s*(?::|[<>=])/gi)) if (!/^(min-|max-)?(width|height)$/.test(f[1])) nonSize.set(f[1], (nonSize.get(f[1]) || 0) + 1);
      }
      if (rule.containerQuery !== undefined) {
        let ruleCount = 0;
        try { ruleCount = rule.cssRules.length; } catch (e) { ruleCount = 0; }
        containerQueries.push({ name: rule.containerName || null, query: rule.containerQuery, atoms: atoms(rule.containerQuery), ruleCount });
      }
    });
    for (const l of document.querySelectorAll('link[rel~="stylesheet"][media]')) {
      const q = l.media;
      if (q && q !== 'all' && !queries.has(q)) queries.set(q, { condition: q, ruleCount: -1, viaLinkMedia: l.href, atoms: atoms(q), matchesNow: matchMedia(q).matches, selectorSamples: [] });
    }
    const all = [...queries.values()];
    const widthAtoms = all.flatMap((q) => q.atoms.filter((a) => a.axis === 'width').map((a) => ({ op: a.op, px: a.px, weight: Math.max(1, q.ruleCount), condition: q.condition })));
    const byPx = new Map();
    for (const a of widthAtoms) {
      const k = a.op + ':' + a.px;
      const v = byPx.get(k) || { op: a.op, px: a.px, count: 0, weight: 0, conditions: [] };
      v.count++; v.weight += a.weight;
      if (v.conditions.length < 6 && !v.conditions.includes(a.condition)) v.conditions.push(a.condition);
      byPx.set(k, v);
    }
    const raw = [...byPx.values()].sort((a, b) => b.weight - a.weight);
    const mins = raw.filter((r) => r.op === '>=').reduce((a, r) => a + r.weight, 0);
    const maxes = raw.filter((r) => r.op === '<=').reduce((a, r) => a + r.weight, 0);
    const boundaries = [...new Set(raw.filter((r) => r.weight >= 3).map((r) => Math.round(r.px)))].sort((a, b) => a - b);
    const containerElements = [];
    let scanned = 0;
    for (const el of document.querySelectorAll('*')) {
      if (++scanned > 6000 || containerElements.length > 60) break;
      const s = getComputedStyle(el);
      if (s.containerType && s.containerType !== 'normal') containerElements.push({ path: U.cssPath(el), type: s.containerType, name: s.containerName || null, width: num(el.getBoundingClientRect().width) });
    }
    root.state.mqList = cap(all.sort((a, b) => b.ruleCount - a.ruleCount).map((q) => q.condition), 80);
    const meta = document.querySelector('meta[name="viewport"]');
    return {
      blocked, metaViewport: meta ? meta.content : null,
      breakpointSystem: { unit: 'px', boundaries, source: 'cssom.weighted', convention: mins > maxes * 2 ? 'min-width' : (maxes > mins * 2 ? 'max-width' : 'mixed'), raw: raw.map((r) => ({ px: r.px, op: r.op, count: r.count, weight: r.weight, conditions: r.conditions })) },
      heightBreakpoints: [...new Set(all.flatMap((q) => q.atoms.filter((a) => a.axis === 'height').map((a) => a.px)))].sort((a, b) => a - b),
      nonSizeFeatures: [...nonSize.entries()].sort((a, b) => b[1] - a[1]).map(([feature, count]) => ({ feature, count })),
      queries: cap(all, 120), containerQueries, containerElements, mqList: root.state.mqList,
      plan: (() => {
        const set = new Set([390, 768, 1280, 1440, 1920]);
        for (const b of raw.slice(0, 8)) { const px = Math.round(b.px); set.add(px); set.add(px + (b.op === '>=' ? -1 : 1)); }
        return [...set].filter((w) => w >= 280 && w <= 2560).sort((a, b) => a - b);
      })()
    };
  };

  R.probes = () => {
    const picked = new Map();
    const add = (el, why) => { if (picked.size >= 120) return; const p = U.cssPath(el); if (p && !picked.has(p)) picked.set(p, why); };
    document.querySelectorAll('body > *, header, nav, main, footer, aside, section, article, dialog, [role="banner"], [role="navigation"], [role="contentinfo"]').forEach((el) => add(el, 'structure'));
    let scanned = 0;
    for (const el of document.querySelectorAll('*')) {
      if (++scanned > 6000 || picked.size >= 100) break;
      const s = getComputedStyle(el);
      if (/grid|flex/.test(s.display) && el.children.length > 1) {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 40) add(el, 'layout:' + s.display);
      }
      if (s.position === 'sticky' || s.position === 'fixed') add(el, 'pinned');
      if (s.containerType && s.containerType !== 'normal') add(el, 'container');
    }
    document.querySelectorAll('h1, h2, h3, p, button, a[class], input, label, img, picture, video, [class*="btn"], [class*="card"], [class*="nav"], [class*="menu"], [class*="burger"], [class*="hamburger"], [class*="toggle"], [class*="drawer"], [class*="overlay"], [class*="container"], [class*="wrapper"], [class*="grid"]').forEach((el) => add(el, 'role'));
    root.state.probes = [...picked.keys()];
    return { count: picked.size, probes: [...picked.entries()].map(([selector, why]) => ({ selector, why })) };
  };

  R.measure = async (how) => {
    const probes = root.state.probes || [];
    if (!probes.length) return { error: 'no probes cached — call window.__clone.responsive.probes() at the primary width first' };
    try { await document.fonts.ready; } catch (e) { /* fonts API absent */ }
    await U.raf(4);
    window.scrollTo(0, 0);
    await U.raf(2);
    const html = document.documentElement;
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;top:-9999px;left:0;width:100vw;height:100vh;pointer-events:none';
    document.body.appendChild(d);
    const pr = d.getBoundingClientRect();
    d.style.height = '100dvh'; const dvh = d.getBoundingClientRect().height;
    d.style.height = '100svh'; const svh = d.getBoundingClientRect().height;
    d.style.height = '100lvh'; const lvh = d.getBoundingClientRect().height;
    d.remove();
    const vp = {
      how: how || 'resize', innerWidth, innerHeight, clientWidth: html.clientWidth, clientHeight: html.clientHeight,
      vw100: num(pr.width), vh100: num(pr.height), dvh: num(dvh), svh: num(svh), lvh: num(lvh),
      scrollbar: num(pr.width - html.clientWidth), dpr: devicePixelRatio,
      rootFontSize: parseFloat(getComputedStyle(html).fontSize),
      visualViewport: window.visualViewport ? { width: num(visualViewport.width), height: num(visualViewport.height), scale: visualViewport.scale } : null,
      docHeight: html.scrollHeight, docOverflowX: num(html.scrollWidth - html.clientWidth)
    };
    const mq = {};
    for (const q of (root.state.mqList || [])) { try { mq[q] = matchMedia(q).matches; } catch (e) { mq[q] = null; } }
    const els = probes.map((sel) => {
      let nodes = [];
      try { nodes = document.querySelectorAll(sel); } catch (e) { return { sel, error: 'bad-selector' }; }
      const el = nodes[0];
      if (!el) return { sel, present: false };
      const s = getComputedStyle(el), st = {};
      for (const p of MEASURE_PROPS) st[p] = s.getPropertyValue(p);
      const r = el.getBoundingClientRect();
      const kids = [...el.children].map((c) => { const cr = c.getBoundingClientRect(); return { t: Math.round(cr.top), l: Math.round(cr.left), w: Math.round(cr.width), h: Math.round(cr.height), hidden: getComputedStyle(c).display === 'none' }; });
      const vis = kids.filter((k) => !k.hidden && k.w > 0);
      const bands = {};
      for (const k of vis) { const b = Math.round(k.t / 8) * 8; bands[b] = (bands[b] || 0) + 1; }
      const rowCounts = Object.keys(bands).sort((a, b) => a - b).map((b) => bands[b]);
      return {
        sel, present: true, n: nodes.length,
        rendered: st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0 && r.width > 0 && r.height > 0,
        rect: { x: num(r.x), y: num(r.y), docY: num(r.y + window.scrollY), w: num(r.width), h: num(r.height) },
        st, contentBox: { w: num(el.clientWidth), h: num(el.clientHeight) },
        childCount: kids.length, visibleChildren: vis.length, rows: rowCounts.length, perRow: rowCounts,
        overflowX: num(el.scrollWidth - el.clientWidth),
        clipped: el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(st['overflow-x']),
        media: el.currentSrc ? { currentSrc: el.currentSrc, srcset: el.getAttribute('srcset'), sizes: el.getAttribute('sizes'), natural: el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null } : null,
        visualOrder: vis.map((k, i) => ({ i, t: k.t, l: k.l })).sort((a, b) => a.t - b.t || a.l - b.l).map((o) => o.i).slice(0, 12),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      };
    });
    return { vp, mq, els };
  };

  R.overflow = () => {
    const html = document.documentElement, vw = html.clientWidth, offenders = [];
    let scanned = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (++scanned > 6000 || offenders.length > 40) break;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 80), path: U.cssPath(el), left: num(r.left), right: num(r.right), w: num(r.width), overflowX: getComputedStyle(el).overflowX });
    }
    return { w: innerWidth, clientWidth: vw, docOverflow: html.scrollWidth - vw > 1, scrollWidth: html.scrollWidth, offenders: offenders.sort((a, b) => b.right - a.right) };
  };

  R.drawer = async (toggleSel, panelSel, waitMs) => {
    const CAND = ['button[aria-expanded]', 'button[aria-controls]', '[class*="burger" i]', '[class*="hamburger" i]', '[class*="menu-toggle" i]', '[class*="nav-toggle" i]', '[class*="menu-btn" i]', '[data-menu-toggle]'];
    if (!toggleSel && !panelSel) {
      const toggles = [];
      for (const sel of CAND) {
        let list = [];
        try { list = [...document.querySelectorAll(sel)]; } catch (e) { list = []; }
        for (const el of list) {
          const p = U.cssPath(el);
          if (!p || toggles.some((t) => t.selector === p)) continue;
          const r = el.getBoundingClientRect();
          toggles.push({ selector: p, matchedBy: sel, ariaExpanded: el.getAttribute('aria-expanded'), ariaControls: el.getAttribute('aria-controls'), ariaLabel: el.getAttribute('aria-label'), visible: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none', rect: U.rect(el), svgLines: el.querySelectorAll('svg line, svg rect, span').length });
        }
      }
      const panels = [];
      for (const t of toggles) {
        if (!t.ariaControls) continue;
        const el = document.getElementById(t.ariaControls);
        if (el) panels.push({ selector: '#' + t.ariaControls, from: 'aria-controls', path: U.cssPath(el) });
      }
      for (const el of document.querySelectorAll('dialog, [popover], nav[class*="mobile" i], [class*="drawer" i], [class*="offcanvas" i], [class*="mobile-menu" i], [class*="nav-panel" i]')) {
        const p = U.cssPath(el);
        if (p && !panels.some((x) => x.selector === p)) panels.push({ selector: p, from: 'pattern', tag: el.tagName.toLowerCase(), isDialog: el.tagName === 'DIALOG', popover: el.getAttribute('popover'), display: getComputedStyle(el).display, position: getComputedStyle(el).position, links: el.querySelectorAll('a[href]').length });
      }
      return { candidates: { toggles: cap(toggles, 12), panels: cap(panels, 12) }, note: 'call drawer(toggleSel, panelSel, waitMs) after cdp:click on the toggle uid' };
    }
    const PROPS = ['display', 'visibility', 'opacity', 'position', 'inset', 'top', 'right', 'bottom', 'left', 'width', 'height', 'max-width', 'max-height', 'transform', 'translate', 'scale', 'clip-path', 'background-color', 'backdrop-filter', 'z-index', 'overflow-y', 'pointer-events', 'transition', 'transition-duration', 'transition-timing-function', 'transition-behavior', 'padding', 'gap', 'flex-direction', 'font-size', 'border-radius', 'box-shadow', 'will-change'];
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const q = (sel) => { try { return sel ? document.querySelector(sel) : null; } catch (e) { return null; } };
    const panel = q(panelSel), toggle = q(toggleSel);
    const snap = (el) => (el ? {
      path: U.cssPath(el), classList: [...el.classList],
      base: U.style(el, PROPS), before: U.style(el, PROPS, '::before'), after: U.style(el, PROPS, '::after'),
      rect: U.rect(el), inert: el.hasAttribute('inert'), hidden: el.hasAttribute('hidden'),
      ariaHidden: el.getAttribute('aria-hidden'), ariaModal: el.getAttribute('aria-modal'), role: el.getAttribute('role'),
      popover: el.getAttribute('popover'), isDialog: el.tagName === 'DIALOG', open: el.open == null ? null : el.open,
      anims: el.getAnimations({ subtree: true }).map((a) => ({ ctor: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || null, state: a.playState, pseudo: (a.effect && a.effect.pseudoElement) || null, target: a.effect && a.effect.target ? U.cssPath(a.effect.target) : null, timing: a.effect && a.effect.getTiming ? { duration: a.effect.getTiming().duration, delay: a.effect.getTiming().delay, easing: a.effect.getTiming().easing } : null, progress: a.effect && a.effect.getComputedTiming ? num(a.effect.getComputedTiming().progress) : null, keyframes: a.effect && a.effect.getKeyframes ? cap(a.effect.getKeyframes(), 12) : null }))
    } : null);
    const bodyCS = getComputedStyle(document.body), htmlCS = getComputedStyle(document.documentElement);
    const active = document.activeElement;
    return {
      w: innerWidth, waitMs: waitMs || 0, toggleSelector: toggleSel || null, panelSelector: panelSel || null,
      panel: snap(panel),
      toggle: toggle ? Object.assign(snap(toggle), { ariaExpanded: toggle.getAttribute('aria-expanded'), ariaControls: toggle.getAttribute('aria-controls'), ariaLabel: toggle.getAttribute('aria-label') }) : null,
      scrollLock: { bodyOverflow: bodyCS.overflow, bodyPosition: bodyCS.position, bodyTop: bodyCS.top, bodyHeight: bodyCS.height, bodyPaddingRight: bodyCS.paddingRight, htmlOverflow: htmlCS.overflow, htmlClasses: [...document.documentElement.classList], bodyClasses: [...document.body.classList], scrollY: window.scrollY },
      focus: { activeElement: active ? U.cssPath(active) : null, inPanel: !!(panel && active && panel.contains(active)) },
      backdrop: (() => {
        const b = [...document.querySelectorAll('body *')].find((el) => { const s = getComputedStyle(el); if (!/fixed/.test(s.position) || parseFloat(s.opacity) === 0 || el === panel) return false; const r = el.getBoundingClientRect(); return r.width >= innerWidth - 2 && r.height >= innerHeight - 2; });
        return b ? snap(b) : null;
      })(),
      topLevel: { hasOpenDialog: !!document.querySelector('dialog[open]'), hasOpenPopover: (() => { try { return !!document.querySelector('[popover]:popover-open'); } catch (e) { return null; } })() }
    };
  };

  R.fitFluid = (samples, rootFontSize, tol) => {
    const rfs = rootFontSize || parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const T = tol == null ? 0.6 : tol;
    const s = samples.map((p) => (Array.isArray(p) ? { w: +p[0], v: +p[1] } : { w: +p.w, v: +p.v }))
      .filter((p) => Number.isFinite(p.w) && Number.isFinite(p.v)).sort((a, b) => a.w - b.w);
    if (s.length < 2) return { kind: 'insufficient', points: s.length, samples: s };
    const rem = (px) => (Math.abs(px) < 0.01 ? '0rem' : +(px / rfs).toFixed(4) + 'rem');
    if (s.every((p) => Math.abs(p.v - s[0].v) < T)) return { kind: 'fixed', minPx: num(s[0].v), maxPx: num(s[0].v), aPx: num(s[0].v), bVw: 0, aRem: num(s[0].v / rfs), points: s.length, css: num(s[0].v) + 'px', cssRem: rem(s[0].v), minIsObservedOnly: false, maxIsObservedOnly: false, samples: s };
    const seg = s.slice(1).map((p, i) => ({ w0: s[i].w, w1: p.w, m: (p.v - s[i].v) / (p.w - s[i].w) }));
    const FLAT = Math.max(1e-4, Math.max(...seg.map((x) => Math.abs(x.m))) * 0.1);
    let i = 0; while (i < seg.length && Math.abs(seg[i].m) < FLAT) i++;
    let j = seg.length - 1; while (j >= i && Math.abs(seg[j].m) < FLAT) j--;
    if (j < i) return { kind: 'fixed', minPx: num(s[0].v), maxPx: num(s[0].v), aPx: num(s[0].v), bVw: 0, points: s.length, css: num(s[0].v) + 'px', cssRem: rem(s[0].v), minIsObservedOnly: false, maxIsObservedOnly: false, samples: s };
    const mid = seg.slice(i, j + 1);
    const mAvg = mid.reduce((a, x) => a + x.m, 0) / mid.length;
    const spread = Math.max(...mid.map((x) => Math.abs(x.m - mAvg)));
    const railedLow = i, railedHigh = seg.length - 1 - j;
    if (spread > Math.abs(mAvg) * 0.08 + FLAT) {
      const steps = [];
      for (let k = 0; k < seg.length; k++) if (Math.abs(seg[k].m) > FLAT) steps.push({ w: seg[k].w1, v: num(s[k + 1].v) });
      return { kind: 'stepped', minPx: num(s[0].v), maxPx: num(s[s.length - 1].v), aPx: null, bVw: null, points: s.length, railedLow, railedHigh, steps, r2: null, minIsObservedOnly: railedLow === 0, maxIsObservedOnly: railedHigh === 0, note: 'slope varies >8% across samples — breakpoint steps, cqi/cqw units, or nested min()/max(); refit against the container width before emitting vw', samples: s, css: null, cssRem: null };
    }
    const pts = s.slice(i, j + 2);
    const mw = pts.reduce((a, p) => a + p.w, 0) / pts.length, mv = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    const sww = pts.reduce((a, p) => a + (p.w - mw) * (p.w - mw), 0);
    const m = sww ? pts.reduce((a, p) => a + (p.w - mw) * (p.v - mv), 0) / sww : mAvg;
    const a0 = mv - m * mw;
    const ssTot = pts.reduce((acc, p) => acc + (p.v - mv) * (p.v - mv), 0);
    const ssRes = pts.reduce((acc, p) => acc + (p.v - (m * p.w + a0)) * (p.v - (m * p.w + a0)), 0);
    const r2 = ssTot ? num(1 - ssRes / ssTot) : 1;
    const bVw = +(m * 100).toFixed(4), aPx = +a0.toFixed(3);
    const pref = Math.abs(aPx) < 0.01 ? bVw + 'vw' : (aPx > 0 ? rem(aPx) + ' + ' + bVw + 'vw' : bVw + 'vw - ' + rem(-aPx));
    const minPx = num(s[0].v), maxPx = num(s[s.length - 1].v);
    const base = { minPx, maxPx, aPx, bVw, aRem: num(aPx / rfs), minRem: num(minPx / rfs), maxRem: num(maxPx / rfs), r2, points: s.length, railedLow, railedHigh, minIsObservedOnly: railedLow === 0, maxIsObservedOnly: railedHigh === 0, samples: s };
    if (!railedLow && !railedHigh) return Object.assign(base, { kind: 'linear', css: 'calc(' + pref + ')', cssRem: 'calc(' + pref + ')', note: 'no rails observed inside the swept range — add a 280px and a 2560px sample before authoring a clamp()' });
    return Object.assign(base, { kind: 'clamp', css: 'clamp(' + minPx + 'px, ' + pref + ', ' + maxPx + 'px)', cssRem: 'clamp(' + rem(minPx) + ', ' + pref + ', ' + rem(maxPx) + ')', crossoverLow: railedLow ? s[i].w : null, crossoverHigh: railedHigh ? s[j + 1].w : null });
  };

  return { ok: true, installed: Object.keys(R), utilFilled: filled, probesCached: (root.state.probes || []).length, v: root.v };
}
