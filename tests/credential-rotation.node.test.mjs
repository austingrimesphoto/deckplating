import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import * as ts from 'typescript';

const source = await fs.readFile(new URL('../netlify/functions/lib/credential-rotation.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const { credentialRotationBlockerCount, validCredentialRotationOverride } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
);

const counts = [
  { credentialType: 'team_member_pin', format: 'scrypt-v3', keyId: null, count: 3 },
  { credentialType: 'organization_admin', format: 'scrypt-v3', keyId: null, count: 1 },
  { credentialType: 'team_member_pin', format: 'scrypt-v2', keyId: null, count: 2 },
  { credentialType: 'team_member_pin', format: 'scrypt-v4-unkeyed', keyId: null, count: 4 },
  { credentialType: 'team_member_pin', format: 'scrypt-v4-keyed', keyId: 'old-key', count: 5 },
  { credentialType: 'team_member_pin', format: 'scrypt-v4-keyed', keyId: 'new-key', count: 7 },
];

test('rotation blocker totals conservatively include every dependent credential class', () => {
  assert.equal(credentialRotationBlockerCount(counts, 'admin-session-secret'), 4);
  assert.equal(credentialRotationBlockerCount(counts, 'credential-pepper', 'old-key'), 11);
  assert.equal(credentialRotationBlockerCount(counts, 'credential-pepper', 'new-key'), 13);
});

test('rotation override requires an explicit reviewed non-sensitive plan reference', () => {
  assert.equal(validCredentialRotationOverride(undefined), false);
  assert.equal(validCredentialRotationOverride({ reviewed: false, planReference: 'CHANGE-1234' }), false);
  assert.equal(validCredentialRotationOverride({ reviewed: true, planReference: 'short' }), false);
  assert.equal(validCredentialRotationOverride({ reviewed: true, planReference: 'CHANGE-1234' }), true);
});
