() => {
  /* clone-site / scripts/extract-flow.js — installer payload for MULTI-STEP FLOW capture.
     Method, auth handling and the states to probe: references/flows.md.

     The rest of this skill measures a page at rest. This measures a FLOW: a sequence of
     states and the transitions between them, which is what an app UI actually is. Its output
     is a spec — step order, validation contract, copy, exits — not a stylesheet. F0 explains
     why that is usually the right deliverable for an app.

     INSTALL (once per navigation, and PER FRAME: an embedded app is not the top document, so
     install into the app frame — references/flows.md F2). Returns {ok,installed,v}.

     PASSES:
       () => window.__clone.flow.discover()        -> .clone/raw/flow-candidates.json
       () => window.__clone.flow.state()           -> one state record, per step
       () => window.__clone.flow.outline('<sel>')  -> role/label tree, no raw markup
       () => window.__clone.flow.diff(a, b)        -> what changed between two state records

     NEVER stores request/response bodies, values of password/secret fields, or anything that
     looks like a token. On an authenticated app those are tenant data. */
  const root = (window.__clone = window.__clone || {});
  root.v = root.v || 1;
  root.state = root.state || {};
  const U = (root.util = root.util || {});
  const filled = [];

  if (!U.cssPath) {
    filled.push('cssPath');
    U.cssPath = function (el) {
      if (!el || el.nodeType !== 1) return null;
      const parts = [];
      let n = el;
      while (n && n.nodeType === 1 && parts.length < 12) {
        if (n === document.body) { parts.unshift('body'); break; }
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
  const txt = (el, n) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, n || 160) : '');
  const vis = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
  };

  /* Never record a value that could be a secret or tenant data. */
  const SECRET_TYPE = /password|hidden/i;
  const SECRET_NAME = /pass|secret|token|key|otp|code|cvv|card|ssn|iban|auth/i;
  const safeValue = (el) => {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    const name = (el.name || el.id || '') + ' ' + (el.getAttribute('aria-label') || '');
    if (SECRET_TYPE.test(type) || SECRET_NAME.test(name)) return '[redacted]';
    const v = el.value == null ? '' : String(el.value);
    return v.length > 80 ? v.slice(0, 80) + '…' : v;
  };

  /* An accessible name, the way a user or screen reader gets one. */
  const nameOf = (el) => {
    const al = el.getAttribute('aria-label');
    if (al) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const parts = lb.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? txt(n, 60) : ''; });
      const joined = parts.filter(Boolean).join(' ');
      if (joined) return joined;
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return txt(l, 60);
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) return txt(wrap, 60);
    return el.getAttribute('placeholder') || el.getAttribute('title') || '';
  };

  const FIELD_SEL = 'input:not([type=hidden]), select, textarea, [contenteditable="true"], [role=textbox], [role=combobox], [role=checkbox], [role=radio], [role=switch]';
  const ACTION_SEL = 'button, [role=button], input[type=submit], input[type=button], a[href]';

  /* The validation CONTRACT — this is the part a screenshot cannot give you. */
  const fieldOf = (el) => ({
    path: U.cssPath(el),
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase() || null,
    role: el.getAttribute('role') || null,
    name: el.name || el.id || null,
    label: nameOf(el),
    required: el.required === true || el.getAttribute('aria-required') === 'true',
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    readOnly: el.readOnly === true,
    pattern: el.getAttribute('pattern'),
    minLength: el.getAttribute('minlength'), maxLength: el.getAttribute('maxlength'),
    min: el.getAttribute('min'), max: el.getAttribute('max'), step: el.getAttribute('step'),
    inputMode: el.getAttribute('inputmode'), autocomplete: el.getAttribute('autocomplete'),
    placeholder: el.getAttribute('placeholder'),
    value: safeValue(el),
    checked: typeof el.checked === 'boolean' ? el.checked : null,
    /* the browser's own verdict, plus whatever help/error text is wired to it */
    validity: (function () {
      try { if (!el.validity) return null; const v = el.validity, o = {};
        for (const k in v) if (v[k] === true) o[k] = true;
        return { valid: v.valid, failed: Object.keys(o), message: el.validationMessage || null }; }
      catch (e) { return null; }
    })(),
    describedBy: (function () {
      const d = el.getAttribute('aria-describedby');
      if (!d) return null;
      return d.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? txt(n, 120) : null; }).filter(Boolean);
    })(),
    invalid: el.getAttribute('aria-invalid') === 'true',
    options: el.tagName === 'SELECT'
      ? Array.prototype.slice.call(el.options, 0, 30).map((o) => ({ value: o.value, label: txt(o, 60), selected: o.selected }))
      : null,
  });

  const actionOf = (el) => ({
    path: U.cssPath(el),
    tag: el.tagName.toLowerCase(),
    label: txt(el, 60) || nameOf(el),
    type: (el.getAttribute('type') || '').toLowerCase() || null,
    href: el.getAttribute('href') || null,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    /* which one is THE primary action — the gating rule usually lives on it */
    primaryish: /submit|continue|next|save|create|connect|install|confirm|finish|done|activate|publish|pay/i
      .test(txt(el, 40) + ' ' + (el.className || '')),
    box: (function () { const r = el.getBoundingClientRect(); return { x: R(r.x), y: R(r.y), w: R(r.width), h: R(r.height) }; })(),
  });

  const F = (root.flow = {
    /* Propose flows from what is on screen. Read the output, delete the noise, THEN author a
       traversal — same discipline as segmentation (references/flows.md F3). */
    discover: function () {
      const out = [];
      const seen = new Set();
      const push = (c) => { if (seen.has(c.path)) return; seen.add(c.path); out.push(c); };

      for (const f of document.querySelectorAll('form')) {
        if (!vis(f)) continue;
        const fields = Array.prototype.filter.call(f.querySelectorAll(FIELD_SEL), vis);
        push({ kind: 'form', path: U.cssPath(f),
          confidence: fields.length ? 'high' : 'low',
          evidence: 'form with ' + fields.length + ' visible fields',
          fieldCount: fields.length,
          requiredCount: fields.filter((x) => x.required || x.getAttribute('aria-required') === 'true').length,
          action: f.getAttribute('action') || null, method: (f.getAttribute('method') || 'get').toLowerCase(),
          submit: Array.prototype.filter.call(f.querySelectorAll(ACTION_SEL), vis).map(actionOf).slice(0, 4),
          heading: txt(f.querySelector('h1,h2,h3,legend'), 80) });
      }

      /* wizards announce themselves: a step indicator, aria-current, or data-step */
      const WIZARD_HINT = /step|wizard|stepper|progress|onboard/i;
      for (const el of document.querySelectorAll('[data-step], [class*="step"], [class*="wizard"], [class*="stepper"], [class*="progress"], [role=tablist]')) {
        if (!vis(el)) continue;
        const items = Array.prototype.filter.call(el.querySelectorAll('li,[role=tab],[data-step],[aria-current]'), vis);
        if (items.length < 2 || items.length > 12) continue;
        /* a list inside a <nav> is a menu, not a wizard. Demand a real signal. */
        const hasSignal = el.hasAttribute('aria-current') || el.hasAttribute('data-step') ||
          el.getAttribute('role') === 'tablist' ||
          WIZARD_HINT.test(String(el.className || '')) ||
          items.some((i) => i.hasAttribute('aria-current') || i.hasAttribute('data-step'));
        if (!hasSignal) continue;
        push({ kind: 'wizard', path: U.cssPath(el), confidence: el.hasAttribute('aria-current') ? 'high' : 'medium',
          evidence: items.length + ' step items' + (el.hasAttribute('aria-current') ? ' + aria-current' : ''),
          steps: items.map((i) => ({ label: txt(i, 40), current: i.hasAttribute('aria-current') || /active|current/.test(i.className || '') })) });
      }

      /* an empty state is a heading + a single call to action and very little else */
      for (const el of document.querySelectorAll('[class*="empty"], [class*="blank"], [class*="placeholder"], [data-empty]')) {
        if (!vis(el)) continue;
        const acts = Array.prototype.filter.call(el.querySelectorAll(ACTION_SEL), vis);
        if (!acts.length) continue;
        push({ kind: 'empty-state', path: U.cssPath(el), confidence: 'medium',
          evidence: 'empty-ish class with ' + acts.length + ' action(s)',
          copy: txt(el, 220), actions: acts.map(actionOf).slice(0, 3) });
      }

      /* modal/drawer triggers: a flow often starts here */
      for (const el of document.querySelectorAll('[aria-haspopup], [data-modal], [aria-controls]')) {
        if (!vis(el)) continue;
        push({ kind: 'overlay-trigger', path: U.cssPath(el), confidence: 'medium',
          evidence: 'aria-haspopup/aria-controls', label: txt(el, 50) || nameOf(el),
          controls: el.getAttribute('aria-controls') || el.getAttribute('data-modal') || null });
      }

      /* otherwise: the loudest primary actions on the page */
      const prim = Array.prototype.filter.call(document.querySelectorAll(ACTION_SEL), vis)
        .map(actionOf).filter((a) => a.primaryish && a.box.w > 40)
        .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).slice(0, 8);
      for (const p of prim) push({ kind: 'primary-action', path: p.path, confidence: 'low',
        evidence: 'primary-looking label', label: p.label, disabled: p.disabled });

      return { ok: true, count: out.length, candidates: out,
        context: { url: location.href, title: document.title,
          forms: document.querySelectorAll('form').length,
          fields: document.querySelectorAll(FIELD_SEL).length,
          inIframe: window.top !== window.self } };
    },

    /* One state record. Call at every step, and at every provoked state (F5). */
    state: function (rootSel, label) {
      const el = rootSel ? document.querySelector(rootSel) : document.body;
      if (!el) return { ok: false, why: 'no match for ' + rootSel };
      const fields = Array.prototype.filter.call(el.querySelectorAll(FIELD_SEL), vis).slice(0, 60);
      const actions = Array.prototype.filter.call(el.querySelectorAll(ACTION_SEL), vis).slice(0, 40);
      const live = Array.prototype.map.call(
        el.querySelectorAll('[aria-live], [role=alert], [role=status]'),
        (n) => ({ path: U.cssPath(n), politeness: n.getAttribute('aria-live') || n.getAttribute('role'), text: txt(n, 240) }))
        .filter((x) => x.text);
      const errs = Array.prototype.map.call(
        el.querySelectorAll('[aria-invalid="true"], [class*="error"], [class*="invalid"], [role=alert]'),
        (n) => ({ path: U.cssPath(n), text: txt(n, 200) })).filter((x) => x.text).slice(0, 20);
      const a = document.activeElement;
      return {
        ok: true, label: label || null,
        url: location.href, title: document.title, inIframe: window.top !== window.self,
        heading: txt(el.querySelector('h1,h2,h3'), 120),
        /* verbatim copy: labels, helper text, error wording — the part worth reading */
        copy: txt(el, 1500),
        fields: fields.map(fieldOf),
        actions: actions.map(actionOf),
        primaryAction: (function () { const p = actions.map(actionOf).filter((x) => x.primaryish)[0]; return p || null; })(),
        liveRegions: live,
        errors: errs,
        /* keyboard order is UX; where focus lands after a transition is a real decision */
        focus: a && a !== document.body ? { path: U.cssPath(a), label: nameOf(a) || txt(a, 40), tag: a.tagName.toLowerCase() } : null,
        scroll: { y: R(window.scrollY), docH: R(document.documentElement.scrollHeight) },
        counts: { fields: fields.length,
          required: fields.filter((x) => x.required || x.getAttribute('aria-required') === 'true').length,
          actions: actions.length, errors: errs.length },
      };
    },

    /* Structure WITHOUT markup: role/label tree only, so a spec never carries their HTML. */
    outline: function (rootSel, maxDepth) {
      const el = rootSel ? document.querySelector(rootSel) : document.body;
      if (!el) return { ok: false, why: 'no match for ' + rootSel };
      const cap = maxDepth || 6;
      let nodes = 0;
      const walk = (n, d) => {
        if (d > cap || nodes > 400 || !vis(n)) return null;
        nodes++;
        const kids = [];
        for (const c of n.children) { const r = walk(c, d + 1); if (r) kids.push(r); }
        const role = n.getAttribute('role') ||
          ({ NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo', FORM: 'form',
             BUTTON: 'button', A: 'link', UL: 'list', OL: 'list', LI: 'listitem', TABLE: 'table',
             H1: 'heading', H2: 'heading', H3: 'heading', INPUT: 'textbox', SELECT: 'combobox',
             TEXTAREA: 'textbox', DIALOG: 'dialog', IMG: 'img' })[n.tagName] || null;
        const own = kids.length ? '' : txt(n, 70);
        if (!role && !own && !kids.length) return null;
        return { role: role, tag: n.tagName.toLowerCase(), name: nameOf(n) || undefined,
          text: own || undefined, children: kids.length ? kids : undefined };
      };
      const tree = walk(el, 0);
      return { ok: true, nodes: nodes, outline: tree };
    },

    /* What changed between two state records — the transition, which is the thing a flow map
       is actually about. */
    diff: function (a, b) {
      if (!a || !b) return { ok: false, why: 'need two state records' };
      const names = (s) => (s.fields || []).map((f) => f.name || f.label || f.path);
      const A = names(a), B = names(b);
      const gained = B.filter((x) => A.indexOf(x) < 0);
      const lost = A.filter((x) => B.indexOf(x) < 0);
      return { ok: true,
        urlChanged: a.url !== b.url, from: a.url, to: b.url,
        headingChanged: a.heading !== b.heading, heading: [a.heading, b.heading],
        fieldsGained: gained, fieldsLost: lost,
        errorsGained: (b.errors || []).length - (a.errors || []).length,
        announced: (b.liveRegions || []).map((r) => r.text).filter((t) => !(a.liveRegions || []).some((r) => r.text === t)),
        primaryActionChanged: (a.primaryAction && a.primaryAction.label) !== (b.primaryAction && b.primaryAction.label),
        primaryEnabled: [a.primaryAction && !a.primaryAction.disabled, b.primaryAction && !b.primaryAction.disabled],
        focusMoved: (a.focus && a.focus.path) !== (b.focus && b.focus.path),
        focusTo: b.focus || null };
    },
  });

  return { ok: true, installed: Object.keys(F).map((k) => 'flow.' + k), utilFilled: filled, v: root.v };
}
