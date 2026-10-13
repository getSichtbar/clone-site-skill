import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const payload = fs.readFileSync(path.join(here, 'extract-shopify.js'), 'utf8');

function install() {
  const window = {};
  const fn = new Function('window', `return (${payload})();`);
  const res = fn(window);
  return { res, S: window.__clone.shopify };
}

test('installs the four passes', () => {
  const { res, S } = install();
  assert.equal(res.ok, true);
  for (const k of ['classify', 'hrefFlags', 'unclip', 'inventory', 'tokens']) assert.equal(typeof S[k], 'function');
});

test('blocks writes, billing and persisting controls (EN + DE)', () => {
  const { S } = install();
  const live = { interactive: true };
  for (const label of ['Upgrade', 'Start free trial', 'Try free for 7 days', 'Fix now', 'Save', 'Apply', 'Publish', 'Delete', 'Connect Google Search Console', 'Generate', 'Optimize all', 'Jetzt beheben', 'Speichern', 'Veröffentlichen', 'Kostenlos testen', 'Verbinden']) {
    assert.equal(S.classify(label, 'button', live), 'do-not-click', label);
  }
  assert.equal(S.classify('Enable auto-optimization', 's-switch', live), 'do-not-click');
  assert.equal(S.classify('anything', 'checkbox', live), 'do-not-click');
  assert.equal(S.classify('Read more', 'link', { interactive: true, externalHref: true }), 'do-not-click');
});

test('lets read-only navigation through and keeps unknowns for review', () => {
  const { S } = install();
  const live = { interactive: true };
  for (const label of ['Learn more', 'How to use', 'View guide', 'Watch tutorial', 'Details', 'Anleitung ansehen', 'Mehr erfahren']) {
    assert.equal(S.classify(label, 'button', live), 'safe-to-open', label);
  }
  assert.equal(S.classify('Keyword Research', 'tab', live), 'safe-to-open');
  assert.equal(S.classify('Content Optimization', 'link', { interactive: true, inAppLink: true, navLink: true }), 'safe-to-open');
  assert.equal(S.classify('Content Optimization', 'link', { interactive: true, inAppLink: true }), 'review');
  assert.equal(S.classify('Blog Generator', 'button', live), 'review');
});

test('regressions from review: cancellation, umlauts, wizard steps, script links, risky hrefs', () => {
  const { S } = install();
  const live = { interactive: true };
  for (const label of ['Cancel subscription', 'Cancel plan', 'Übernehmen', 'Änderungen übernehmen', 'Abo kündigen', 'Get started', 'Start 14-day free trial', 'Add keyword', 'Create blog post', 'Mark as complete', 'Dismiss', 'Turn on', 'Approve', 'Accept', 'Einschalten', 'Hinzufügen']) {
    assert.equal(S.classify(label, 'button', live), 'do-not-click', label);
  }
  for (const label of ['Cancel', 'Close', 'Abbrechen', 'Schließen', 'Back']) assert.equal(S.classify(label, 'button', live), 'safe-to-open', label);
  for (const label of ['Next', 'Continue', 'Weiter']) assert.equal(S.classify(label, 'button', live), 'review', label);
  assert.equal(S.classify('Open', 'link', { interactive: true, scriptLink: true }), 'review');
  assert.equal(S.classify('Plans', 'link', { interactive: true, inAppLink: true, riskyHref: true }), 'do-not-click');
  assert.equal(S.classify('Read more', 'link', { interactive: true, inAppLink: true }), 'safe-to-open');
});

test('round-2 regressions: DE billing verbs, long help-ish labels, plain in-app links', () => {
  const { S } = install();
  const live = { interactive: true };
  for (const label of ['Jetzt kaufen', 'Bezahlen', 'Bestellen', 'Installieren', 'Deinstallieren', 'Plan wählen', 'Tarif ändern', 'Als erledigt markieren', 'Freischalten']) {
    assert.equal(S.classify(label, 'button', live), 'do-not-click', label);
  }
  assert.equal(S.classify('Help me write a description', 'button', live), 'review');
  assert.equal(S.classify('Learn more about this feature today please', 'button', live), 'review');
  assert.equal(S.classify('Plans', 'link', { interactive: true, inAppLink: true }), 'review');
  for (const role of ['s-text-area', 's-number-field', 's-search-field', 'searchbox']) assert.equal(S.classify('Field', role, live), 'do-not-click', role);
});

test('hrefFlags strips tokens and classifies link targets', () => {
  const { S } = install();
  const page = 'https://seo.example.app/dashboard?shop=x.myshopify.com&host=abc&id_token=SECRET';
  const a = S.hrefFlags('/content-seo?shop=x.myshopify.com&hmac=123&session=SECRET#tab', page);
  assert.equal(a.href, 'https://seo.example.app/content-seo');
  assert.equal(a.inAppLink, true); assert.equal(a.externalHref, false);
  assert.doesNotMatch(JSON.stringify(a), /SECRET|hmac|shop=/);
  assert.equal(S.hrefFlags('https://other.com/x', page).externalHref, true);
  assert.equal(S.hrefFlags('https://other.com/?r=admin.shopify.com', page).externalHref, true);
  assert.equal(S.hrefFlags('https://admin.shopify.com/store/x/apps/y', page).externalHref, false);
  assert.equal(S.hrefFlags('mailto:hi@example.com', page).externalHref, true);
  assert.equal(S.hrefFlags('#', page).scriptLink, true);
  assert.equal(S.hrefFlags('javascript:void(0)', page).scriptLink, true);
  assert.equal(S.hrefFlags('/admin/charges/123/confirm', page).riskyHref, true);
  assert.equal(S.hrefFlags('/billing', page).riskyHref, true);
  assert.equal(S.hrefFlags(null, page).href, null);
});

test('payload never clicks, types or submits', () => {
  assert.doesNotMatch(payload, /\.click\(|dispatchEvent\(|requestSubmit|\.submit\(|\.value\s*=|\.checked\s*=|\.focus\(/);
  const code = payload.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\.value\b/, 'payload must not read form values');
});

test('disabled or non-interactive elements are hover-only', () => {
  const { S } = install();
  assert.equal(S.classify('Upgrade', 'button', { interactive: true, disabled: true }), 'hover-only');
  assert.equal(S.classify('Info', 's-tooltip', { interactive: false }), 'hover-only');
});
