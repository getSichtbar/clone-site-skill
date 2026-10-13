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
  for (const k of ['classify', 'unclip', 'inventory', 'tokens']) assert.equal(typeof S[k], 'function');
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
  for (const label of ['Learn more', 'How to use', 'View guide', 'Watch tutorial', 'Details', 'Cancel', 'Anleitung ansehen', 'Mehr erfahren']) {
    assert.equal(S.classify(label, 'button', live), 'safe-to-open', label);
  }
  assert.equal(S.classify('Keyword Research', 'tab', live), 'safe-to-open');
  assert.equal(S.classify('Content Optimization', 'link', { interactive: true, inAppLink: true }), 'safe-to-open');
  assert.equal(S.classify('Blog Generator', 'button', live), 'review');
});

test('disabled or non-interactive elements are hover-only', () => {
  const { S } = install();
  assert.equal(S.classify('Upgrade', 'button', { interactive: true, disabled: true }), 'hover-only');
  assert.equal(S.classify('Info', 's-tooltip', { interactive: false }), 'hover-only');
});
