#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SENSITIVE_TEXT_RULES = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
  ['authorization_header', /(?:["'])?(?:proxy[-_])?authorization(?:["'])?\s*[:=]/i],
  ['cookie_header', /(?:["'])?(?:set[-_])?cookie(?:["'])?\s*[:=]/i],
  ['basic_bearer_token', /(?:\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{12,})/i],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['provider_api_key', /\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/],
  [
    'credential_assignment',
    /(?:["'])?(?:(?:x[-_])?(?:api[-_]?key|auth[-_]?token|csrf[-_]?token)|access[-_]?token|refresh[-_]?token|session[-_]?token|password|secret|client[-_]?secret|private[-_]?key)(?:["'])?\s*[:=]/i,
  ],
];

const SHA256_RE = /^[0-9a-f]{64}$/;
const UTC_RE = /Z$/;

const scanText = (text, location) => {
  const findings = [];
  for (const [rule, pattern] of SENSITIVE_TEXT_RULES) {
    if (pattern.test(text)) {
      findings.push({ rule, location });
    }
  }
  return findings;
};

const scanJsonStrings = (value, findings, breadcrumb) => {
  if (typeof value === 'string') {
    for (const [rule, pattern] of SENSITIVE_TEXT_RULES) {
      if (pattern.test(value)) {
        findings.push({ rule, location: breadcrumb || '(manifest root string)' });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJsonStrings(item, findings, `${breadcrumb}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      scanJsonStrings(child, findings, breadcrumb ? `${breadcrumb}.${key}` : key);
    }
  }
};

const normalizePortablePath = (value, description) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${description} must be a non-empty string`);
  }
  if (value.includes('\\') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${description} must be a portable relative path`);
  }
  const normalized = path.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${description} escapes the evidence directory`);
  }
  return normalized;
};

const requireString = (value, description) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${description} must be a non-empty string`);
  }
  return value;
};

const requireUtcTime = (value, description) => {
  if (typeof value !== 'string' || !UTC_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${description} must be a UTC ISO-8601 timestamp ending in Z`);
  }
};

const requireHash = (value, description) => {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new Error(`${description} must be a lowercase SHA-256 hex digest`);
  }
};

const readOptionalArtifact = async (absolutePath) => {
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EISDIR') {
      return null;
    }
    throw error;
  }
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const isLikelyText = (buffer) => {
  const text = buffer.toString('utf8');
  return !text.includes('\uFFFD');
};

const args = process.argv.slice(2);
const mode = args.includes('--redaction') ? 'redaction' : 'validate';

const manifestPath = path.resolve(process.env.CHAT_EVIDENCE_MANIFEST ?? '');
if (!manifestPath || !process.env.CHAT_EVIDENCE_MANIFEST) {
  console.error('chat-evidence gate: blocked - CHAT_EVIDENCE_MANIFEST must point to a manifest JSON file');
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  console.error(`chat-evidence gate: blocked - cannot read manifest JSON: ${error.message}`);
  process.exit(2);
}

const manifestDir = path.dirname(manifestPath);
const failures = [];
const findings = [];

scanJsonStrings(manifest, findings, 'manifest');

const cases = manifest.cases;
if (mode === 'validate') {
  if (!Array.isArray(cases) || cases.length === 0) {
    failures.push('manifest must contain a non-empty cases array');
  }
}

if (Array.isArray(cases)) {
  for (const [caseIndex, entry] of cases.entries()) {
    const casePath = `cases[${caseIndex}]`;
    const entryObject = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null;
    if (!entryObject) {
      if (mode === 'validate') failures.push(`${casePath} must be an object`);
      continue;
    }

    if (mode === 'validate') {
      try {
        requireString(entryObject.name, `${casePath}.name`);
        requireString(entryObject.status, `${casePath}.status`);
        requireUtcTime(entryObject.startedAt, `${casePath}.startedAt`);
        requireUtcTime(entryObject.completedAt, `${casePath}.completedAt`);
      } catch (error) {
        failures.push(error.message);
      }
    }

    const assertions = entryObject.assertions;
    if (mode === 'validate' && (!Array.isArray(assertions) || assertions.length === 0)) {
      failures.push(`${casePath}.assertions must be a non-empty array`);
      continue;
    }

    if (!Array.isArray(assertions)) continue;

    for (const [assertionIndex, assertion] of assertions.entries()) {
      const assertionPath = `${casePath}.assertions[${assertionIndex}]`;
      const assertionObject = assertion && typeof assertion === 'object' && !Array.isArray(assertion) ? assertion : null;
      if (!assertionObject) {
        if (mode === 'validate') failures.push(`${assertionPath} must be an object`);
        continue;
      }

      if (mode === 'validate') {
        try {
          requireString(assertionObject.name, `${assertionPath}.name`);
          requireString(assertionObject.status, `${assertionPath}.status`);
          requireUtcTime(assertionObject.utcTime, `${assertionPath}.utcTime`);
          requireHash(assertionObject.hash, `${assertionPath}.hash`);
        } catch (error) {
          failures.push(error.message);
        }
      }

      let artifactPath;
      try {
        artifactPath = normalizePortablePath(assertionObject.artifactPath, `${assertionPath}.artifactPath`);
      } catch (error) {
        if (mode === 'validate') failures.push(error.message);
        continue;
      }

      const absoluteArtifact = path.resolve(manifestDir, artifactPath);
      const artifactBuffer = await readOptionalArtifact(absoluteArtifact);
      if (mode === 'validate') {
        if (artifactBuffer === null) {
          failures.push(`${assertionPath}.artifactPath is missing: ${artifactPath}`);
          continue;
        }
        if (typeof assertionObject.hash === 'string' && SHA256_RE.test(assertionObject.hash) && sha256(artifactBuffer) !== assertionObject.hash) {
          failures.push(`${assertionPath}.hash does not match artifact content: ${artifactPath}`);
        }
      }

      if (artifactBuffer !== null && isLikelyText(artifactBuffer)) {
        findings.push(...scanText(artifactBuffer.toString('utf8'), artifactPath));
      }
    }
  }
}

const redactionFindings = findings.map((finding) => `${finding.rule} at ${finding.location}`);
const allFailures = mode === 'redaction' ? redactionFindings : [...failures, ...redactionFindings];

const report = {
  mode,
  manifestPath,
  status: allFailures.length > 0 ? 'failed' : 'passed',
  findings: redactionFindings,
  failures,
};

console.log(`chat-evidence gate (${mode}): ${report.status}`);
console.log(JSON.stringify(report, null, 2));

if (allFailures.length > 0) {
  process.exitCode = 1;
}
