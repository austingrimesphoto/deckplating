import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import * as ts from 'typescript';

const source = await fs.readFile(
  new URL('../netlify/functions/lib/credential-codec.ts', import.meta.url),
  'utf8',
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const codecModule = await import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`);
const { createCredentialCodec, credentialHashPrefixes } = codecModule;

const context = 'pin:00000000-0000-4000-8000-000000000001:11111111-1111-4111-8111-111111111111';
const secret = '0427';
const sessionSecret = 'session-secret-0123456789abcdef-0123456789abcdef';
const dedicatedPepper = 'credential-pepper-0123456789abcdef-0123456789abcdef';
const wrongSecret = 'wrong-secret-0123456789abcdef-0123456789abcdef';
const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const expectedV1 = 'scrypt-v1$AAECAwQFBgcICQoLDA0ODw$Ou3vGcoqMgFD3Oik_cBZYqMrBqvU9CAhBBxEvjTScTg';
const expectedV2 = 'scrypt-v2$AAECAwQFBgcICQoLDA0ODw$Mg8irFBhXX5kbBqPsYl981WiZ0FPzeNWHt_5b8qZTGY';
const expectedV3 = 'scrypt-v3$AAECAwQFBgcICQoLDA0ODw$VTfC8cU4K9k0dAkJiqhL9XDL_I6pBAH-Pz2qpdxzB_E';
const expectedV4 = 'scrypt-v4$AAECAwQFBgcICQoLDA0ODw$8JOS1OD9gt8H8jJcfk4gXEWK64iCoeLXfgKtaF_b4ag';
const fixedRandomBytes = (size) => {
  assert.equal(size, salt.length);
  return Buffer.from(salt);
};

test('credential codec selects active prefixes and matches independent fixed vectors', async () => {
  const legacy = createCredentialCodec({ randomBytes: fixedRandomBytes });
  const sessionDerived = createCredentialCodec({
    adminSessionSecret: sessionSecret,
    randomBytes: fixedRandomBytes,
  });
  const dedicated = createCredentialCodec({
    adminSessionSecret: sessionSecret,
    credentialPepper: dedicatedPepper,
    randomBytes: fixedRandomBytes,
  });
  const dedicatedWithoutSession = createCredentialCodec({
    credentialPepper: dedicatedPepper,
    randomBytes: fixedRandomBytes,
  });

  assert.equal(legacy.activePrefix, credentialHashPrefixes.legacy);
  assert.equal(sessionDerived.activePrefix, credentialHashPrefixes.sessionDerived);
  assert.equal(dedicated.activePrefix, credentialHashPrefixes.dedicated);
  assert.equal(dedicatedWithoutSession.activePrefix, credentialHashPrefixes.dedicated);

  assert.equal(await legacy.createCredentialHash(context, secret), expectedV1);
  assert.equal(await sessionDerived.createCredentialHash(context, secret), expectedV3);
  assert.equal(await dedicated.createCredentialHash(context, secret), expectedV4);
  assert.equal(await dedicatedWithoutSession.createCredentialHash(context, secret), expectedV4);
  assert.equal(await dedicated.verifyCredentialHash(expectedV1, context, secret), true);
  assert.equal(await dedicated.verifyCredentialHash(expectedV3, context, secret), true);
  assert.equal(await dedicated.verifyCredentialHash(expectedV4, context, secret), true);
});

test('credential codec preserves released scrypt-v2 raw-pepper verification and upgrades it', async () => {
  const codec = createCredentialCodec({
    adminSessionSecret: sessionSecret,
    credentialPepper: dedicatedPepper,
    randomBytes: fixedRandomBytes,
  });
  assert.equal(codec.isVersionedCredentialHash(expectedV2), true);
  assert.equal(codec.isCurrentCredentialHash(expectedV2), false);
  assert.equal(await codec.verifyCredentialHash(expectedV2, context, secret), true);
  assert.match(await codec.createCredentialHash(context, secret), /^scrypt-v4\$/);
});

test('credential codec rejects wrong or missing keys for every peppered format', async () => {
  const noKeys = createCredentialCodec();
  const wrongSession = createCredentialCodec({ adminSessionSecret: wrongSecret });
  const wrongDedicated = createCredentialCodec({ credentialPepper: wrongSecret });
  assert.equal(await noKeys.verifyCredentialHash(expectedV2, context, secret), false);
  assert.equal(await noKeys.verifyCredentialHash(expectedV3, context, secret), false);
  assert.equal(await noKeys.verifyCredentialHash(expectedV4, context, secret), false);
  assert.equal(await wrongDedicated.verifyCredentialHash(expectedV2, context, secret), false);
  assert.equal(await wrongSession.verifyCredentialHash(expectedV3, context, secret), false);
  assert.equal(await wrongDedicated.verifyCredentialHash(expectedV4, context, secret), false);
});

test('credential codec rejects malformed hashes and retains explicit legacy-hash fallback', async () => {
  const codec = createCredentialCodec({
    adminSessionSecret: sessionSecret,
    credentialPepper: dedicatedPepper,
  });
  const malformed = [
    '',
    'scrypt-v5$AA$AA',
    'scrypt-v4$AA$AA',
    `scrypt-v4$${salt.toString('base64url')}$AA`,
    `scrypt-v4$${salt.toString('base64url')}$${Buffer.alloc(32).toString('base64url')}$extra`,
  ];
  for (const value of malformed) {
    assert.equal(await codec.verifyCredentialHash(value, context, secret), false);
  }
  assert.equal(await codec.verifyCredentialHash('legacy-hash', context, secret, ['legacy-hash']), true);
  assert.equal(await codec.verifyCredentialHash('legacy-hash', context, secret, ['different-hash']), false);
});
