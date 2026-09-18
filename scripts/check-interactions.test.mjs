import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkInteractions } from './check-interactions.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-interactions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  write('contract.json', { trigger: 'next', loop: true, requiredScenarios: [{ id: 'last-to-first', checks: ['wrap-neighbors'] }] });
  write('original.json', { sequence: ['last', 'next', 'first'], neighbors: 2 });
  write('clone.json', { sequence: ['last', 'next', 'first'], neighbors: 2 });
  write('comparison.json', { checks: [{ id: 'wrap-neighbors', passed: true, original: 2, clone: 2 }] });
  const ledger = {
    schema: 'clone-site/interactions@1',
    discovery: { complete: true, sections: ['carousel'], reviewedSections: ['carousel'] },
    interactions: [{ id: 'carousel-loop', section: 'carousel', kind: 'carousel', sourceSelector: '.source', cloneSelector: '.clone', status: 'verified', contract: 'contract.json', scenarios: [{ id: 'last-to-first', status: 'passed', original: 'original.json', clone: 'clone.json', comparison: 'comparison.json', checks: ['wrap-neighbors'] }] }]
  };
  const file = path.join(root, 'interactions.json');
  const run = () => { write('interactions.json', ledger); return checkInteractions(file); };
  return { root, write, ledger, file, run, item: ledger.interactions[0], scenario: ledger.interactions[0].scenarios[0] };
}

test('accepts complete discovery and distinct, passing paired evidence', t => {
  const f = fixture(t);
  assert.deepEqual(f.run(), { passed: true, verified: 1, total: 1, errors: [] });
});

test('rejects build-only success without compared interaction implementation', t => {
  const f = fixture(t); f.item.status = 'implemented';
  assert.equal(f.run().passed, false);
});

test('rejects an unvisited section even when all recorded checks pass', t => {
  const f = fixture(t); f.ledger.discovery.sections.push('header');
  assert.match(f.run().errors.join('\n'), /Section not reviewed: header/);
});

test('rejects missing source evidence and empty captures', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'contract.json'));
  fs.writeFileSync(path.join(f.root, 'original.json'), '');
  assert.equal(f.run().passed, false);
});

test('rejects failed boundary assertion despite passed scenario status', t => {
  const f = fixture(t);
  f.write('comparison.json', { checks: [{ id: 'wrap-neighbors', passed: false, original: 2, clone: 0 }] });
  assert.match(f.run().errors.join('\n'), /failed comparison/);
});

test('rejects omitted assertions and missing original observations', t => {
  const f = fixture(t); f.scenario.checks.push('centering');
  f.write('comparison.json', { checks: [{ id: 'wrap-neighbors', passed: true, clone: 2 }] });
  const errors = f.run().errors.join('\n');
  assert.match(errors, /omitted centering/); assert.match(errors, /missing comparison observations/);
});

test('rejects reusing the clone capture as original evidence', t => {
  const f = fixture(t); f.scenario.original = f.scenario.clone;
  assert.equal(f.run().passed, false);
});

test('requires actual user scope for an excluded interaction', t => {
  const f = fixture(t); f.item.status = 'excluded';
  assert.equal(f.run().passed, false);
  f.item.userScopeInstruction = 'Only clone the header; omit the carousel.';
  assert.equal(f.run().passed, true);
});

test('does not accept malformed ledger structures or duplicate IDs', t => {
  const f = fixture(t); f.ledger.interactions.push(structuredClone(f.item));
  assert.equal(f.run().passed, false);
  f.ledger.interactions = [null]; assert.equal(f.run().passed, false);
  fs.writeFileSync(f.file, 'null'); assert.equal(checkInteractions(f.file).passed, false);
  fs.writeFileSync(f.file, '{'); assert.equal(checkInteractions(f.file).passed, false);
});

test('allows a discovered noninteractive page without inventing interactions', t => {
  const f = fixture(t); f.ledger.interactions = [];
  assert.equal(f.run().passed, true);
  f.ledger.discovery.complete = false; assert.equal(f.run().passed, false);
});

test('CLI returns failure for incomplete evidence and handles relative paths outside cwd', t => {
  const f = fixture(t); f.run();
  const script = fileURLToPath(new URL('./check-interactions.mjs', import.meta.url));
  const good = spawnSync(process.execPath, [script, f.file], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).passed, true);
  f.item.status = 'unresolved'; f.run();
  const bad = spawnSync(process.execPath, [script, f.file], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(spawnSync(process.execPath, [script]).status, 2);
});

test('rejects first-item-only coverage when the source contract requires wrapping', t => {
  const f = fixture(t);
  f.scenario.id = 'first-item-visible';
  assert.match(f.run().errors.join('\n'), /required scenario not passed: last-to-first/);
});

test('rejects removing a required assertion from both scenario and comparison', t => {
  const f = fixture(t);
  f.write('contract.json', { requiredScenarios: [{ id: 'last-to-first', checks: ['wrap-neighbors', 'center-both-tracks'] }] });
  assert.match(f.run().errors.join('\n'), /required assertion omitted: center-both-tracks/);
});

test('a required scenario cannot be waived as not-applicable', t => {
  const f = fixture(t);
  Object.assign(f.scenario, { status: 'not-applicable', reason: 'Not implemented', evidence: 'original.json' });
  assert.equal(f.run().passed, false);
});
