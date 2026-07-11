import crypto from 'node:crypto';

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

function normalizedHostname(url) {
  return url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

export function normalizeLiveCheckBaseUrl(rawValue, { allowProduction = false, productionHostname } = {}) {
  const value = String(rawValue ?? '').trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The live-check base URL must be a valid absolute URL.');
  }

  const hostname = normalizedHostname(url);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The live-check base URL must use HTTP or HTTPS.');
  }
  if (url.protocol !== 'https:' && !loopbackHosts.has(hostname)) {
    throw new Error('The live-check base URL must use HTTPS unless it targets the local machine.');
  }
  if (url.username || url.password) {
    throw new Error('The live-check base URL must not contain credentials.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The live-check base URL must contain only an origin, without a path, query, or fragment.');
  }

  const productionHost = String(productionHostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!loopbackHosts.has(hostname) && !allowProduction) {
    const target = productionHost && hostname === productionHost ? 'production' : 'a remote target';
    throw new Error(`Refusing to run against ${target} unless the matching ALLOW_PROD variable is set to YES for mutating checks.`);
  }

  return url.origin;
}

export function liveCheckSuffix(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${timestamp}-${crypto.randomBytes(3).toString('hex')}`;
}

export function createJsonClient(baseUrl, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive number.');

  return async function request(path, { method = 'GET', token, body, expected = [200] } = {}) {
    const requestUrl = new URL(path, `${baseUrl}/`);
    if (requestUrl.origin !== baseUrl) throw new Error('Live-check requests must stay on the configured origin.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let responseText;
    try {
      response = await fetchImpl(requestUrl, {
        method,
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(body == null ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${method} ${path} timed out after ${timeoutMs}ms.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    let data = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        if (expected.includes(response.status)) {
          throw new Error(`${method} ${path} returned ${response.status} with a non-JSON response.`);
        }
        data = { error: responseText.slice(0, 200) };
      }
    }

    if (!expected.includes(response.status)) {
      const detail = typeof data?.error === 'string' ? data.error : 'Unexpected response.';
      throw new Error(`${method} ${path} returned ${response.status}: ${detail}`);
    }
    return data;
  };
}
