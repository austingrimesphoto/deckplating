const requiredKeys = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_PASSPHRASE_HASH',
  'ADMIN_SESSION_SECRET',
  'CREDENTIAL_PEPPER',
  'MAP_TILE_URL',
  'MAP_TILE_KEY',
  'MAP_DEFAULT_LATITUDE',
  'MAP_DEFAULT_LONGITUDE',
  'INSTALLATION_NAME',
];

export function validateHttpUrl(value, label, { optional = false, allowLoopbackHttp = true } = {}) {
  if (!value && optional) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(allowLoopbackHttp && url.protocol === 'http:' && loopback)) {
    throw new Error(`${label} must use HTTPS unless it targets the local machine.`);
  }
}

export function validateCoordinate(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be a number between ${minimum} and ${maximum}.`);
  }
}

export function buildEnvFile(values) {
  for (const key of requiredKeys) {
    if (!(key in values)) throw new Error(`Missing environment value: ${key}.`);
  }
  return `${requiredKeys.map((key) => `${key}=${JSON.stringify(String(values[key]))}`).join('\n')}\n`;
}
