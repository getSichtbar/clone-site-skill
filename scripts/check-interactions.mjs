#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Coverage/evidence validation, not a substitute for browser comparisons.
export function checkInteractions(file) {
  const errors = [];
  const fail = message => errors.push(message);
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { return { passed: false, verified: 0, total: 0, errors: [`Cannot read ledger: ${error.message}`] }; }
  const root = path.dirname(path.resolve(file));
  const evidence = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) { fail(`${label}: missing evidence path`); return null; }
    const resolved = path.resolve(root, value);
    try {
      if (!fs.statSync(resolved).isFile() || !fs.readFileSync(resolved).toString().trim().length) throw new Error('empty or not a file');
      return resolved;
    } catch { fail(`${label}: missing or empty evidence ${value}`); return null; }
  };
  const array = (value, label, nonempty = false) => {
    if (!Array.isArray(value) || (nonempty && !value.length)) { fail(`${label}: expected ${nonempty ? 'nonempty ' : ''}array`); return []; }
    return value;
  };
  if (ledger?.schema !== 'clone-site/interactions@1') fail('Unsupported ledger schema');
  if (ledger?.discovery?.complete !== true) fail('Interaction discovery is incomplete');
  const sections = array(ledger?.discovery?.sections, 'discovery.sections', true);
  const reviewed = array(ledger?.discovery?.reviewedSections, 'discovery.reviewedSections');
  for (const section of sections) if (!reviewed.includes(section)) fail(`Section not reviewed: ${section}`);
  const interactions = array(ledger?.interactions, 'interactions');
  const ids = new Set();
  let verified = 0;
  for (const item of interactions) {
    if (!item || typeof item !== 'object') { fail('Invalid interaction'); continue; }
    const label = item.id || '(unnamed interaction)';
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) fail(`Missing or duplicate interaction ID: ${label}`);
    ids.add(item.id);
    if (!sections.includes(item.section)) fail(`${label}: unknown section`);
    if (item.status === 'excluded') {
      if (typeof item.userScopeInstruction !== 'string' || !item.userScopeInstruction.trim()) fail(`${label}: exclusion needs the user scope instruction`);
      continue;
    }
    const before = errors.length;
    if (item.status !== 'verified') fail(`${label}: status is ${item.status || 'missing'}, not verified`);
    for (const key of ['kind', 'sourceSelector', 'cloneSelector']) if (typeof item[key] !== 'string' || !item[key].trim()) fail(`${label}: missing ${key}`);
    const contractFile = evidence(item.contract, `${label} contract`);
    let requirements = [];
    if (contractFile) {
      try {
        const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
        requirements = array(contract?.requiredScenarios, `${label} contract.requiredScenarios`, true);
      } catch (error) { fail(`${label}: invalid contract JSON: ${error.message}`); }
    }
    const scenarios = array(item.scenarios, `${label} scenarios`, true);
    const requiredIds = new Set();
    for (const requirement of requirements) {
      if (!requirement || typeof requirement.id !== 'string' || !requirement.id.trim() || requiredIds.has(requirement.id)) {
        fail(`${label}: missing or duplicate required scenario ID`); continue;
      }
      requiredIds.add(requirement.id);
      const expectedChecks = array(requirement.checks, `${label}/${requirement.id} required checks`, true);
      if (expectedChecks.some(id => typeof id !== 'string' || !id.trim()) || new Set(expectedChecks).size !== expectedChecks.length) fail(`${label}/${requirement.id}: invalid required check IDs`);
      const actual = scenarios.find(scenario => scenario?.id === requirement.id);
      if (!actual || actual.status !== 'passed') fail(`${label}: required scenario not passed: ${requirement.id}`);
      for (const id of expectedChecks) if (!Array.isArray(actual?.checks) || !actual.checks.includes(id)) fail(`${label}/${requirement.id}: required assertion omitted: ${id}`);
    }
    const scenarioIds = new Set();
    for (const scenario of scenarios) {
      if (!scenario || typeof scenario !== 'object') { fail(`${label}: invalid scenario`); continue; }
      const name = `${label}/${scenario.id || '(unnamed scenario)'}`;
      if (typeof scenario.id !== 'string' || !scenario.id.trim() || scenarioIds.has(scenario.id)) fail(`${name}: missing or duplicate scenario ID`);
      scenarioIds.add(scenario.id);
      if (scenario.status === 'not-applicable') {
        if (typeof scenario.reason !== 'string' || !scenario.reason.trim()) fail(`${name}: missing reason`);
        evidence(scenario.evidence, name);
        continue;
      }
      if (scenario.status !== 'passed') fail(`${name}: scenario not passed`);
      const original = evidence(scenario.original, `${name} original`);
      const clone = evidence(scenario.clone, `${name} clone`);
      const comparison = evidence(scenario.comparison, `${name} comparison`);
      if (original && clone && original === clone) fail(`${name}: original and clone evidence must be distinct`);
      const checks = array(scenario.checks, `${name} checks`, true);
      if (checks.some(id => typeof id !== 'string' || !id.trim()) || new Set(checks).size !== checks.length) fail(`${name}: check IDs must be nonempty and unique`);
      if (!comparison) continue;
      try {
        const result = JSON.parse(fs.readFileSync(comparison, 'utf8'));
        const recorded = array(result?.checks, `${name} comparison checks`, true);
        const recordedIds = new Set();
        for (const check of recorded) {
          if (!check || typeof check.id !== 'string' || recordedIds.has(check.id)) { fail(`${name}: invalid or duplicate recorded check`); continue; }
          recordedIds.add(check.id);
          if (check.passed !== true) fail(`${name}/${check.id}: failed comparison`);
          if (!Object.hasOwn(check, 'original') || !Object.hasOwn(check, 'clone')) fail(`${name}/${check.id}: missing comparison observations`);
        }
        for (const id of checks) if (!recordedIds.has(id)) fail(`${name}: comparison omitted ${id}`);
      } catch (error) { fail(`${name}: invalid comparison JSON: ${error.message}`); }
    }
    if (errors.length === before) verified++;
  }
  return { passed: errors.length === 0, verified, total: interactions.filter(item => item?.status !== 'excluded').length, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    console.error('Usage: node check-interactions.mjs /project/.clone/interactions.json');
    process.exitCode = 2;
  } else {
    const result = checkInteractions(file);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  }
}
