import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildEnvFile, validateCoordinate, validateHttpUrl } from '../scripts/lib/setup-env.mjs';
import { createJsonClient, normalizeLiveCheckBaseUrl } from '../scripts/lib/live-check.mjs';

test('live checks reject insecure remote targets and production hostname variants', () => {
  assert.throws(
    () => normalizeLiveCheckBaseUrl('http://preview.example.com', { productionHostname: 'deckplating.netlify.app' }),
    /must use HTTPS/,
  );
  assert.throws(
    () => normalizeLiveCheckBaseUrl('https://DECKPLATING.NETLIFY.APP./', { productionHostname: 'deckplating.netlify.app' }),
    /Refusing to run against production/,
  );
  assert.equal(
    normalizeLiveCheckBaseUrl('https://deckplating.netlify.app', {
      allowProduction: true,
      productionHostname: 'deckplating.netlify.app',
    }),
    'https://deckplating.netlify.app',
  );
});

test('live checks require explicit mutation approval for every remote origin and allow loopback HTTP', () => {
  assert.throws(() => normalizeLiveCheckBaseUrl('https://deploy-preview-1--deckplating.netlify.app'), /remote target/);
  assert.equal(
    normalizeLiveCheckBaseUrl('https://deploy-preview-1--deckplating.netlify.app', { allowProduction: true }),
    'https://deploy-preview-1--deckplating.netlify.app',
  );
  assert.equal(normalizeLiveCheckBaseUrl('http://127.0.0.1:8888'), 'http://127.0.0.1:8888');
  assert.equal(normalizeLiveCheckBaseUrl('http://[::1]:8888'), 'http://[::1]:8888');
  assert.throws(() => normalizeLiveCheckBaseUrl('https://user:secret@example.com'), /must not contain credentials/);
  assert.throws(() => normalizeLiveCheckBaseUrl('https://example.com/api'), /only an origin/);
});

test('JSON client times out stalled requests', async () => {
  const request = createJsonClient('https://preview.example.com', {
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  await assert.rejects(() => request('/api/health'), /timed out after 10ms/);
  await assert.rejects(() => request('https://other.example.com/api/health'), /must stay on the configured origin/);
});

test('production smoke cleanup rediscovers an ambiguously submitted request by slug', async () => {
  const source = await fs.readFile(new URL('../scripts/first-pilot-smoke-check.mjs', import.meta.url), 'utf8');
  assert.match(source, /async function findPendingSmokeRequest\(\)/);
  assert.match(source, /candidate\.preferred_workspace_slug === slug/);
  assert.match(source, /workspaceRequestId = pendingRequest\?\.id \?\? ''/);
});

test('environment file serialization prevents line injection and validates setup inputs', () => {
  const env = buildEnvFile({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'role-key',
    ADMIN_PASSPHRASE_HASH: 'hash',
    ADMIN_SESSION_SECRET: 'secret',
    MAP_TILE_URL: '',
    MAP_TILE_KEY: '',
    MAP_DEFAULT_LATITUDE: '24.57',
    MAP_DEFAULT_LONGITUDE: '-81.78',
    INSTALLATION_NAME: 'Example #1\nSecond line',
  });
  assert.match(env, /INSTALLATION_NAME="Example #1\\nSecond line"/);
  assert.equal(env.trimEnd().split('\n').length, 9);
  assert.doesNotThrow(() => validateHttpUrl('http://localhost:54321', 'Supabase URL'));
  assert.throws(() => validateHttpUrl('http://example.com', 'Supabase URL'), /must use HTTPS/);
  assert.doesNotThrow(() => validateCoordinate('24.57', 'Latitude', -90, 90));
  assert.throws(() => validateCoordinate('91', 'Latitude', -90, 90), /between -90 and 90/);
});

test('both Netlify deployments define baseline security and cache headers', async () => {
  const [appConfig, setupHeaders] = await Promise.all([
    fs.readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
    fs.readFile(new URL('../setup-site/_headers', import.meta.url), 'utf8'),
  ]);
  for (const source of [appConfig, setupHeaders]) {
    for (const header of [
      'Content-Security-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ]) {
      assert.match(source, new RegExp(header));
    }
    assert.match(source, /frame-ancestors 'none'/);
    assert.match(source, /max-age=31536000/);
    assert.match(source, /strict-origin-when-cross-origin/);
  }
  assert.match(appConfig, /worker-src 'self' blob:/);
  assert.match(appConfig, /geolocation=\(self\)/);
  assert.match(setupHeaders, /https:\/\/deckplating\.netlify\.app/);
  assert.match(setupHeaders, /\/assets\/\*/);
});

test('database CI resets an isolated Supabase stack and preserves teardown and concurrency gates', async () => {
  const [workflow, runner, behavior, config] = await Promise.all([
    fs.readFile(new URL('../.github/workflows/database-behavior.yml', import.meta.url), 'utf8'),
    fs.readFile(new URL('../scripts/run-database-behavior-suite.sh', import.meta.url), 'utf8'),
    fs.readFile(new URL('../scripts/database-behavior-check.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
  ]);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /supabase\/setup-cli@v1/);
  assert.match(workflow, /supabase stop --no-backup/);
  assert.doesNotMatch(workflow, /upload-artifact/);
  assert.match(runner, /supabase db reset --local --no-seed/);
  assert.match(runner, /011_security_reliability_hardening\.sql/);
  assert.match(runner, /trap cleanup EXIT INT TERM/);
  assert.match(behavior, /async function runOverlapping/);
  assert.match(behavior, /expectedCompositeConstraints/);
  assert.match(behavior, /assertLoopbackUrl/);
  assert.match(config, /major_version = 17/);
});
