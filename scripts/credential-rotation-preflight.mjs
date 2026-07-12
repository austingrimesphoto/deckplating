import { createJsonClient, normalizeLiveCheckBaseUrl } from './lib/live-check.mjs';

const baseUrlValue = process.env.DECKPLATING_CREDENTIAL_PREFLIGHT_BASE_URL ?? '';
const operatorPassphrase = process.env.DECKPLATING_CREDENTIAL_PREFLIGHT_OPERATOR_PASSPHRASE ?? '';
const target = process.env.DECKPLATING_CREDENTIAL_PREFLIGHT_TARGET ?? 'admin-session-secret';
const allowProd = process.env.DECKPLATING_CREDENTIAL_PREFLIGHT_ALLOW_PROD === 'YES';
const reviewed = process.env.DECKPLATING_CREDENTIAL_PREFLIGHT_OVERRIDE_REVIEWED === 'YES';
const planReference = process.env.DECKPLATING_CREDENTIAL_PREFLIGHT_PLAN_REFERENCE ?? '';
const retiringKeyId = process.env.DECKPLATING_CREDENTIAL_PREFLIGHT_RETIRING_KEY_ID ?? '';

if (!baseUrlValue || !operatorPassphrase) {
  console.error('Set DECKPLATING_CREDENTIAL_PREFLIGHT_BASE_URL and DECKPLATING_CREDENTIAL_PREFLIGHT_OPERATOR_PASSPHRASE.');
  process.exit(1);
}
if (!['admin-session-secret', 'credential-pepper'].includes(target)) {
  console.error('DECKPLATING_CREDENTIAL_PREFLIGHT_TARGET must be admin-session-secret or credential-pepper.');
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = normalizeLiveCheckBaseUrl(baseUrlValue, {
    allowProduction: allowProd,
    productionHostname: 'deckplating.netlify.app',
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const request = createJsonClient(baseUrl);
try {
  const login = await request('/api/operator/login', {
    method: 'POST',
    body: { passphrase: operatorPassphrase },
  });
  if (typeof login.token !== 'string' || !login.token) throw new Error('Operator login did not return a token.');

  const status = await request('/api/operator/credential-rotation/status', { token: login.token });
  console.log(JSON.stringify({ configuration: status.configuration, inventory: status.inventory }, null, 2));

  const result = await request('/api/operator/credential-rotation/preflight', {
    method: 'POST',
    token: login.token,
    expected: [200, 409],
    body: {
      target,
      ...(retiringKeyId ? { retiringKeyId } : {}),
      ...(reviewed ? { override: { reviewed: true, planReference } } : {}),
    },
  });
  if (result.allowed !== true) {
    console.error(`BLOCKED ${target}: ${result.error ?? 'dependent credentials remain'} (${result.blockerCount ?? 'unknown'} blockers)`);
    process.exitCode = 2;
  } else {
    console.log(`PASS ${target} rotation preflight${result.overrideUsed ? ' with reviewed reset-plan override' : ''}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
