() => {
  /* clone-site / scripts/extract-shopify.js — installer payload for --shopify-app runs.
     Method, click policy and deliverables: references/shopify-embedded.md.

     INSTALL twice per navigation: once in the TOP admin document (for unclip) and once in the
     APP document (the embedded iframe's own document, or its src opened in its own tab when the
     frame is cross-origin). Returns {ok,installed,v}.

     PASSES:
       () => window.__clone.shopify.unclip(3600)      top doc: full-height, unclipped app frame
       () => window.__clone.shopify.inventory()       app doc: every control + tooltip source,
                                                      box, state, Polaris flag and RISK class
       () => window.__clone.shopify.tokens()          app doc: computed-style frequency tables,
                                                      CSS variables, Polaris vs custom counts
       window.__clone.shopify.classify(text, role, opts)  pure; also used by the node test

     Read-only by design: it never clicks, types or submits. RISK decides what the operator may
     click by hand (safe-to-open), only hover (hover-only), or must not touch (do-not-click). */
  const root = (window.__clone = window.__clone || {});
  root.v = root.v || 1;
  const S = (root.shopify = root.shopify || {});

  // Word boundaries are Unicode-aware lookarounds ("u" flag): JS \b is ASCII-only and would miss
  // German words that start or end with an umlaut ("Übernehmen").
  const W = (alt) => new RegExp('(?<![\\p{L}\\p{N}])(?:' + alt + ')(?![\\p{L}\\p{N}])', 'iu');
  const DO_NOT = W([
    'install', 'uninstall', 'upgrade', 'downgrade', 'subscribe', 'unsubscribe', 'cancel (?:my |your |the )?(?:subscription|plan|account|charge|billing|trial)',
    'start (?:a |your |the )?(?:\\d+[- ]day )?(?:free )?trial', 'try (?:it )?(?:for )?free', 'get started', 'choose (?:a )?plan', 'select (?:a )?plan', 'change plan',
    'buy', 'purchase', 'pay', 'checkout', 'approve', 'accept', 'allow', 'grant', 'authori[sz]e', 'agree',
    'save', 'apply', 'publish', 'unpublish', 'delete', 'remove', 'archive', 'duplicate', 'restore', 'reset', 'discard',
    'add', 'create', 'new', 'edit', 'update', 'upload', 'replace', 'rename', 'schedule', 'launch', 'start', 'stop', 'pause', 'resume', 'retry',
    'connect', 'disconnect', 'link (?:account|store)', 'send', 'submit', 'import', 'export', 'sync', 'run', 'scan now', 'generate', 'regenerate',
    'optimi[sz]e', 'fix(?: now| all| issues?| it)?', 'bulk', 'enable', 'disable', 'activate', 'deactivate', 'turn (?:on|off)', 'confirm', 'mark as (?:\\w+)', 'dismiss',
    'speichern', 'übernehmen', 'anwenden', 'veröffentlichen', 'löschen', 'entfernen', 'archivieren', 'hinzufügen', 'erstellen', 'bearbeiten', 'aktualisieren', 'hochladen',
    'upgraden', 'abonnieren', 'kündigen', 'testphase(?: starten)?', 'kostenlos testen', 'jetzt starten', 'loslegen', 'jetzt beheben', 'beheben', 'verbinden', 'trennen',
    'senden', 'absenden', 'generieren', 'optimieren', 'aktivieren', 'deaktivieren', 'einschalten', 'ausschalten', 'bestätigen', 'akzeptieren', 'zustimmen', 'erlauben',
    'importieren', 'exportieren', 'synchronisieren', 'ausblenden', 'verwerfen',
  ].join('|'));
  // "Cancel"/"Close"/"Abbrechen" are only safe as the WHOLE label (a modal's close button), never as
  // part of a longer label ("Cancel subscription" is caught above first anyway).
  const SAFE_EXACT = /^(?:cancel|close|abbrechen|schließen|back|zurück|×|x)$/iu;
  const SAFE = W([
    'learn more', 'read more', 'show more', 'view more', 'see more', 'how to use', 'how it works', 'view guide', 'guide', 'docs', 'documentation',
    'details', 'view details', 'preview', 'filter', 'sort', 'help', 'tutorial', 'watch(?: tutorial| video)?', 'faq',
    'mehr erfahren', 'mehr anzeigen', 'weiterlesen', 'anleitung(?: ansehen)?', 'so funktioniert', 'hilfe', 'vorschau', 'details anzeigen', 'ansehen',
  ].join('|'));
  const PERSISTING_ROLES = /^(checkbox|switch|radio|textbox|combobox|input|select|textarea|s-switch|s-checkbox|s-text-field|s-select|s-choice-list)$/;
  const RISKY_HREF = /(?:^|\/)(?:charges|billing|subscriptions?|recurring_application_charges|application_charges|uninstall|oauth|authorize|confirm)(?:[\/?#]|$)/i;

  S.classify = function (text, role, opts) {
    const o = opts || {};
    if (o.disabled) return 'hover-only';
    if (!o.interactive) return 'hover-only';
    const t = String(text || '').trim();
    if (DO_NOT.test(t) || PERSISTING_ROLES.test(String(role || ''))) return 'do-not-click';
    if (o.externalHref || o.riskyHref) return 'do-not-click';
    if (o.scriptLink) return 'review';
    if (SAFE_EXACT.test(t) || SAFE.test(t) || role === 'tab' || o.inAppLink) return 'safe-to-open';
    return 'review';
  };

  S.unclip = function (minHeight) {
    const frame = document.querySelector('iframe[name="app-iframe"]')
      || [...document.querySelectorAll('iframe')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!frame) return { ok: false, reason: 'no iframe in this document (run unclip in the TOP admin document)' };
    const h = Math.max(minHeight || 3600, 600);
    frame.style.height = h + 'px'; frame.style.minHeight = h + 'px';
    let n = 0; let el = frame.parentElement;
    while (el && el !== document.documentElement) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; n += 1; el = el.parentElement; }
    document.body.style.overflow = 'auto';
    let sameOrigin = false; try { sameOrigin = !!frame.contentDocument; } catch (_) { sameOrigin = false; }
    return { ok: true, height: h, ancestorsUnclipped: n, sameOrigin, src: String(frame.src || '').split('?')[0].slice(0, 200) };
  };

  const SEL = 'a[href],button,[role=button],[role=tab],[role=link],[role=menuitem],[role=switch],[role=checkbox],[role=radio],input,select,textarea,summary,[tabindex]:not([tabindex="-1"]),[title],[aria-describedby],[data-tooltip],[aria-label],s-button,s-link,s-clickable,s-tooltip,s-badge,s-switch,s-checkbox,s-select,s-text-field,s-choice-list,s-icon';
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01; };
  const labelOf = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 140);

  S.inventory = function () {
    const seen = new Set(); const out = [];
    document.querySelectorAll(SEL).forEach((e) => {
      if (seen.has(e) || !visible(e)) return; seen.add(e);
      const r = e.getBoundingClientRect(); const tag = e.tagName.toLowerCase();
      const role = e.getAttribute('role') || (tag === 'a' ? 'link' : tag);
      const disabled = !!(e.disabled || e.getAttribute('aria-disabled') === 'true' || e.hasAttribute('disabled'));
      const describedBy = (e.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
        .map((id) => (document.getElementById(id) || {}).innerText || '').join(' ');
      const tooltip = (e.getAttribute('title') || e.getAttribute('data-tooltip') || describedBy || (tag === 's-tooltip' ? e.innerText : '') || '').trim().slice(0, 200);
      const interactive = /^(a|button|input|select|textarea|summary|s-button|s-link|s-clickable|s-switch|s-checkbox|s-select|s-text-field|s-choice-list)$/.test(tag) || /button|tab|link|menuitem|switch|checkbox|radio/.test(role);
      const href = e.getAttribute('href') || null;
      let host = null; let path = '';
      try { if (href) { const u = new URL(href, location.href); host = u.hostname; path = u.pathname; } } catch (_) { host = null; }
      const scriptLink = !!(href && /^\s*(#|javascript:)/i.test(href));
      const externalHref = !!(host && host !== location.hostname && host !== 'admin.shopify.com');
      const riskyHref = !!(href && RISKY_HREF.test(path));
      const text = labelOf(e);
      out.push({
        id: out.length + 1, tag, role, text, tooltip, href,
        box: { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
        disabled, polaris: tag.startsWith('s-') || /Polaris-/.test(String(e.className || '')),
        risk: S.classify(text, role, { disabled, interactive, externalHref, riskyHref, scriptLink, inAppLink: tag === 'a' && !!href && !externalHref && !scriptLink }),
        outcome: null,
      });
    });
    out.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    out.forEach((x, i) => { x.id = i + 1; });
    const counts = out.reduce((m, x) => (m[x.risk] = (m[x.risk] || 0) + 1, m), {});
    return { schema: 'clone-site/shopify-inventory@1', url: location.href.split(/[?#]/)[0], title: document.title, total: out.length, counts, elements: out };
  };

  S.tokens = function () {
    const inc = (m, k, n) => { if (k == null || k === '' || k === 'none' || k === 'normal' || k === '0px' || k === 'rgba(0, 0, 0, 0)') return; m[k] = (m[k] || 0) + (n || 1); };
    const T = { color: {}, background: {}, border: {}, fontFamily: {}, fontSize: {}, fontWeight: {}, lineHeight: {}, padding: {}, margin: {}, gap: {}, radius: {}, shadow: {}, transition: {}, animation: {} };
    let n = 0; let polaris = 0;
    const POLARIS = /^(s-[a-z-]+)$/;
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') continue; n += 1;
      if (POLARIS.test(e.tagName.toLowerCase()) || /Polaris-/.test(String(e.className || ''))) polaris += 1;
      if (!e.children.length && (e.textContent || '').trim()) { inc(T.color, s.color); inc(T.fontFamily, s.fontFamily.split(',')[0].trim()); inc(T.fontSize, s.fontSize); inc(T.fontWeight, s.fontWeight); inc(T.lineHeight, s.lineHeight); }
      inc(T.background, s.backgroundColor); if (s.backgroundImage !== 'none') inc(T.background, s.backgroundImage.slice(0, 120));
      if (s.borderTopWidth !== '0px') inc(T.border, s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor);
      ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach((p) => inc(T.padding, s[p]));
      ['marginTop', 'marginBottom'].forEach((p) => inc(T.margin, s[p]));
      inc(T.gap, s.rowGap); inc(T.gap, s.columnGap); inc(T.radius, s.borderTopLeftRadius); inc(T.shadow, s.boxShadow);
      if (s.transitionDuration !== '0s') inc(T.transition, s.transitionProperty + ' ' + s.transitionDuration + ' ' + s.transitionTimingFunction);
      if (s.animationName !== 'none') inc(T.animation, s.animationName + ' ' + s.animationDuration);
    }
    const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 40);
    const res = { schema: 'clone-site/shopify-tokens@1', url: location.href.split(/[?#]/)[0], elements: n };
    Object.keys(T).forEach((k) => { res[k] = top(T[k]); });
    res.polarisNodes = polaris; // visible only, same population as n
    res.customNodes = n - polaris;
    res.note = 'Computed styles inside s-* shadow roots are not readable here; measure those components by their host box and Polaris tokens.';
    return res;
  };

  return { ok: true, installed: ['shopify.classify', 'shopify.unclip', 'shopify.inventory', 'shopify.tokens'], v: root.v };
}
