import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { normalizeNotificationMode, sendWorkspaceApprovedNotification } from '../../src/lib/notifications';
import { createCredentialCodec } from './lib/credential-codec';
import { collectCursorPages, collectKeysetPages } from './lib/cursor-pagination';

type Status = 'green' | 'yellow' | 'red' | 'gray';
type FixedVoidReason = 'accidental' | 'wrong_unit' | 'duplicate' | 'incorrect_datetime' | 'incorrect_member';
type IndicatorValue = true | null;
type GamificationTone = 'professional' | 'friendly' | 'banter';
type AdminContext = {
  organizationId: string | null;
  authMethod: 'organization' | 'environment' | 'legacy' | 'superuser';
  organizationUpdatedAt: string | null;
  adminCredentialUpdatedAt: string | null;
};
type OperatorContext = {
  authMethod: 'central_operator';
};
type WorkspaceOnboardingSummary = {
  areaCount: number;
  locationCount: number;
  unitCount: number;
  teamMemberCount: number;
  organizationAdminConfigured: boolean;
  readyForCheckins: boolean;
  lastCheckinAt: string | null;
  lastCheckinTeamMemberName: string | null;
  lastCheckinUnitName: string | null;
};
type WorkspaceRequestStatus = 'pending' | 'approved' | 'rejected';
type OrganizationSetupCodeRow = {
  id: string;
  organization_id: string;
  label: string | null;
  purpose: string;
  active: boolean;
  expires_at: string | null;
  used_at: string | null;
  used_by_label: string | null;
  created_at: string;
};
type WorkspaceRequestRow = {
  id: string;
  installation_or_command: string;
  preferred_workspace_slug: string | null;
  lead_name: string;
  lead_role: string;
  official_contact_email: string;
  rmt_size: number;
  expected_pilot_start_date: string;
  short_use_case: string;
  safe_use_boundaries_confirmed: boolean;
  no_sensitive_data_acknowledged: boolean;
  status: WorkspaceRequestStatus;
  operator_note: string | null;
  organization_id: string | null;
  setup_code_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  operator_notified_at: string | null;
  requestor_notified_at: string | null;
  operator_notification_status: string | null;
  requestor_notification_status: string | null;
  created_at: string;
  updated_at: string;
  organizations?: { id: string; slug: string; name: string; active: boolean } | null;
  organization_setup_codes?: OrganizationSetupCodeRow | null;
};

class RequestValidationError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const adminPassphraseHash = process.env.ADMIN_PASSPHRASE_HASH ?? '';
const configuredAdminSessionSecret = process.env.ADMIN_SESSION_SECRET?.trim() ?? '';
const adminSessionSecret = configuredAdminSessionSecret || serviceRoleKey;
const centralOperatorPassphraseHash = process.env.CENTRAL_OPERATOR_PASSPHRASE_HASH ?? '';
const configuredCredentialPepper = process.env.CREDENTIAL_PEPPER?.trim() ?? '';
const managedHostRequested = /^true$/i.test(process.env.DECKPLATING_MANAGED_HOST ?? '');
const managedHostEnabled = managedHostRequested || Boolean(centralOperatorPassphraseHash);
const defaultOrganizationId =
  process.env.DECKPLATING_DEFAULT_ORGANIZATION_ID ?? '00000000-0000-4000-8000-000000000001';
const appBaseUrl = (process.env.DECKPLATING_APP_BASE_URL ?? 'https://deckplating.netlify.app').replace(/\/+$/, '');
const setupSiteBaseUrl = (process.env.DECKPLATING_SETUP_SITE_BASE_URL ?? 'https://deckplatingsetup.netlify.app').replace(/\/+$/, '');
const operatorEmail = process.env.DECKPLATING_OPERATOR_EMAIL ?? '';
const fromEmail = process.env.DECKPLATING_FROM_EMAIL ?? '';
const resendApiKey = process.env.RESEND_API_KEY ?? '';
const ministryIndicatorsEnabled = /^true$/i.test(process.env.ENABLE_MINISTRY_INDICATORS ?? '');
const notificationMode = process.env.NOTIFICATION_MODE ?? 'disabled';
const normalizedNotificationMode = normalizeNotificationMode(notificationMode);
const notificationFrom = process.env.NOTIFICATION_FROM ?? fromEmail;
const notificationReplyTo = process.env.NOTIFICATION_REPLY_TO ?? '';
const notificationProviderApiKey = process.env.NOTIFICATION_PROVIDER_API_KEY ?? resendApiKey;

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : (null as unknown as ReturnType<typeof createClient>);

const json = (statusCode: number, body: unknown, additionalHeaders: Record<string, string> = {}) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    ...additionalHeaders,
  },
  body: JSON.stringify(body),
});

const empty = (statusCode: number) => ({
  statusCode,
  headers: {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  },
  body: '',
});

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unexpected error.';
};

const maxRequestBodyBytes = 100_000;

const parseJsonObject = <T>(body: string): T => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RequestValidationError(400, 'Request body must contain valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequestValidationError(400, 'Request body must be a JSON object.');
  }
  return parsed as T;
};

const assertBodySize = (body: string) => {
  if (Buffer.byteLength(body, 'utf8') > maxRequestBodyBytes) {
    throw new RequestValidationError(413, 'Request body is too large.');
  }
};

const readBody = <T>(event: HandlerEvent): T => {
  if (!event.body) return {} as T;
  assertBodySize(event.body);
  return parseJsonObject<T>(event.body);
};

const readRequestBody = <T>(event: HandlerEvent): T => {
  if (!event.body) return {} as T;
  assertBodySize(event.body);
  const contentType = event.headers['content-type'] ?? event.headers['Content-Type'] ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(event.body)) as T;
  }
  return parseJsonObject<T>(event.body);
};

const boundedInteger = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
};

const matchesSearch = (query: string, values: unknown[]) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
};

const truthyFormValue = (value: unknown) => value === true || value === 'true' || value === 'on' || value === 'yes' || value === '1';

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const clampText = (value: unknown, max = 2000) => String(value ?? '').trim().slice(0, max);

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const constantTimeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const matchesSha256 = (value: string, expectedHash: string) =>
  Boolean(expectedHash) && constantTimeEqual(sha256(value), expectedHash);

const {
  createCredentialHash,
  isCurrentCredentialHash,
  verifyCredentialHash,
} = createCredentialCodec({
  adminSessionSecret: configuredAdminSessionSecret,
  credentialPepper: configuredCredentialPepper,
});

const legacyPinHash = (teamMemberId: string, pin: string) => sha256(`${teamMemberId}:${pin}`);

const pinHash = (teamMemberId: string, pin: string, organizationId: string | null) =>
  sha256(`${organizationId ?? 'single-org'}:${teamMemberId}:${pin}`);

const pinCredentialContext = (teamMemberId: string, organizationId: string | null) =>
  `pin:${organizationId ?? 'single-org'}:${teamMemberId}`;

let organizationSchemaEnabledCache: boolean | null = null;
let organizationAdminSchemaEnabledCache: boolean | null = null;

const isMissingRelationError = (error: unknown) => {
  const value = error as { code?: string; message?: string } | null;
  const message = value?.message?.toLowerCase() ?? '';
  return (
    value?.code === '42P01' ||
    value?.code === '42883' ||
    value?.code === 'PGRST202' ||
    value?.code === 'PGRST205' ||
    message.includes('does not exist')
  );
};

async function organizationSchemaEnabled() {
  if (organizationSchemaEnabledCache !== null) return organizationSchemaEnabledCache;
  const { error } = await supabase.from('organizations').select('id').limit(1);
  if (error) {
    if (managedHostEnabled || !isMissingRelationError(error)) throw error;
    organizationSchemaEnabledCache = false;
    return organizationSchemaEnabledCache;
  }
  organizationSchemaEnabledCache = true;
  return organizationSchemaEnabledCache;
}

async function currentOrganizationId() {
  return (await organizationSchemaEnabled()) ? defaultOrganizationId : null;
}

async function resolveOrganizationId(value?: string | null) {
  if (!(await organizationSchemaEnabled())) return null;
  const requested = value?.trim();
  if (!requested) return defaultOrganizationId;
  if (!isUuid(requested)) throw new RequestValidationError(400, 'organizationId must be a UUID.');
  const { data, error } = await supabase
    .from('organizations')
    .select('id, active')
    .eq('id', requested)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.active) throw new RequestValidationError(404, 'Workspace not found or inactive.');
  return data.id as string;
}

async function resolveOrganizationSlug(slug: string) {
  if (!(await organizationSchemaEnabled())) return null;
  const normalized = slugify(slug);
  if (!normalized) throw new RequestValidationError(400, 'workspace slug is required.');
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, active')
    .eq('slug', normalized)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.active) throw new RequestValidationError(404, 'Workspace not found or inactive.');
  return (await organizationSummary(data.id)) as Awaited<ReturnType<typeof organizationSummary>>;
}

async function organizationSummary(organizationId: string | null) {
  if (!organizationId || !(await organizationSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, active')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.active) return null;
  const mapSettings = await getWorkspaceMapSettings(organizationId);
  return { ...data, ...mapSettings } as {
    id: string;
    slug: string;
    name: string;
    active: boolean;
    installationName: string;
    mapDefaultLatitude: number;
    mapDefaultLongitude: number;
  };
}

async function organizationAdminSchemaEnabled() {
  if (organizationAdminSchemaEnabledCache !== null) return organizationAdminSchemaEnabledCache;
  const { error } = await supabase.from('organization_admin_credentials').select('id').limit(1);
  if (error) {
    if (managedHostEnabled || !isMissingRelationError(error)) throw error;
    organizationAdminSchemaEnabledCache = false;
    return organizationAdminSchemaEnabledCache;
  }
  organizationAdminSchemaEnabledCache = true;
  return organizationAdminSchemaEnabledCache;
}

const fallbackInstallationName = process.env.INSTALLATION_NAME ?? 'Naval Air Station Key West';
const fallbackMapDefaultLatitude = Number.isFinite(Number(process.env.MAP_DEFAULT_LATITUDE))
  ? Number(process.env.MAP_DEFAULT_LATITUDE)
  : 24.57;
const fallbackMapDefaultLongitude = Number.isFinite(Number(process.env.MAP_DEFAULT_LONGITUDE))
  ? Number(process.env.MAP_DEFAULT_LONGITUDE)
  : -81.78;

type InstallationSearchResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  class?: string;
  type?: string;
  importance?: number;
  address?: Record<string, string>;
};

const installationSearchCache = new Map<string, { expiresAt: number; results: InstallationSearchResult[] }>();

async function getWorkspaceMapSettings(organizationId: string | null) {
  if (!organizationId || !(await organizationSchemaEnabled())) {
    return {
      installationName: fallbackInstallationName,
      mapDefaultLatitude: fallbackMapDefaultLatitude,
      mapDefaultLongitude: fallbackMapDefaultLongitude,
    };
  }
  const { data, error } = await scoped(
    supabase.from('app_settings').select('key, value').in('key', ['installation_name', 'map_default_latitude', 'map_default_longitude']),
    organizationId,
  );
  if (error) {
    if (managedHostEnabled) throw error;
    return {
      installationName: fallbackInstallationName,
      mapDefaultLatitude: fallbackMapDefaultLatitude,
      mapDefaultLongitude: fallbackMapDefaultLongitude,
    };
  }
  const settings = new Map((data ?? []).map((row: any) => [row.key, row.value] as const));
  const mapDefaultLatitude = Number(settings.get('map_default_latitude'));
  const mapDefaultLongitude = Number(settings.get('map_default_longitude'));
  return {
    installationName: settings.get('installation_name') || fallbackInstallationName,
    mapDefaultLatitude: Number.isFinite(mapDefaultLatitude) ? mapDefaultLatitude : fallbackMapDefaultLatitude,
    mapDefaultLongitude: Number.isFinite(mapDefaultLongitude) ? mapDefaultLongitude : fallbackMapDefaultLongitude,
  };
}

async function searchInstallations(query: string, event: HandlerEvent) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const cached = installationSearchCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  const upstreamLimit = await consumeRateLimit(event, 'nominatim-search-global', 1, 1, 'public-search', false);
  if (!upstreamLimit.allowed) {
    throw new RequestValidationError(429, 'Installation search is busy. Try again in a moment.');
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('limit', '5');

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Deckplating/0.1 (+https://deckplating.netlify.app)',
      referer: 'https://deckplating.netlify.app',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Installation lookup failed with status ${response.status}.`);
  }
  const data = (await response.json()) as InstallationSearchResult[];
  const results = (Array.isArray(data) ? data : [])
    .map((result) => ({
      ...result,
      lat: String(result.lat),
      lon: String(result.lon),
    }))
    .filter((result) => result.display_name && Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon)));
  installationSearchCache.set(normalized, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, results });
  return results;
}

const scoped = (query: any, organizationId: string | null) =>
  organizationId ? query.eq('organization_id', organizationId) : query;

const withOrganization = <T extends Record<string, unknown>>(values: T, organizationId: string | null) =>
  organizationId ? { ...values, organization_id: organizationId } : values;

const allById = <T extends { id: string }>(buildQuery: (afterId: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>) =>
  collectCursorPages<T>(buildQuery);

const uniqueUuidValues = (values: unknown[]) => {
  const nonEmptyValues = values.filter((value) => value != null && value !== '');
  if (nonEmptyValues.some((value) => typeof value !== 'string')) {
    throw new RequestValidationError(400, 'Referenced IDs must be UUIDs.');
  }
  const ids = Array.from(new Set(nonEmptyValues.map((value) => String(value))));
  if (ids.some((id) => !isUuid(id))) throw new RequestValidationError(400, 'Referenced IDs must be UUIDs.');
  return ids;
};

async function ensureScopedIds(table: string, ids: string[], organizationId: string | null, message: string) {
  if (!ids.length) return;
  const { data, error } = await scoped(supabase.from(table).select('id').in('id', ids), organizationId);
  if (error) throw error;
  if ((data ?? []).length !== ids.length) throw new RequestValidationError(404, message);
}

async function validateUnitReferences(values: Record<string, unknown>, organizationId: string | null) {
  if (values.location_id == null || values.location_id === '') return;
  const [locationId] = uniqueUuidValues([values.location_id]);
  await ensureScopedIds('locations', [locationId], organizationId, 'Location not found.');
}

const organizationAdminHash = (organizationId: string, passphrase: string) =>
  sha256(`${organizationId}:admin:${passphrase}`);

const organizationAdminCredentialContext = (organizationId: string) => `organization-admin:${organizationId}`;

async function organizationSessionState(organizationId: string | null) {
  if (!organizationId || !(await organizationSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organizations')
    .select('id, active, updated_at')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.active) return null;
  return data as { id: string; active: boolean; updated_at: string };
}

async function organizationAdminCredentialState(organizationId: string | null) {
  if (!organizationId || !(await organizationAdminSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organization_admin_credentials')
    .select('id, active, updated_at')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as { id: string; active: boolean; updated_at: string };
}

const hmac = (value: string) =>
  crypto.createHmac('sha256', adminSessionSecret).update(value).digest('hex');

const base64url = (value: string) => Buffer.from(value).toString('base64url');

const fromBase64url = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const getBearerToken = (event: HandlerEvent) => {
  const header = event.headers.authorization ?? event.headers.Authorization ?? '';
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? '';
};

const readSignedPayload = (event: HandlerEvent) => {
  const token = getBearerToken(event);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  const expected = hmac(payload);
  if (!constantTimeEqual(signature, expected)) return null;
  return payload;
};

const tokenTimesAreValid = (
  claims: { issuedAt?: number; expires?: number },
  maximumLifetimeMs: number,
) => {
  const now = Date.now();
  const clockSkewMs = 60_000;
  if (!Number.isSafeInteger(claims.expires) || claims.expires! <= now || claims.expires! > now + maximumLifetimeMs + clockSkewMs) {
    return false;
  }
  if (claims.issuedAt === undefined) return true;
  if (
    !Number.isSafeInteger(claims.issuedAt) ||
    claims.issuedAt! > now + clockSkewMs ||
    claims.issuedAt! < now - maximumLifetimeMs - clockSkewMs ||
    claims.expires! <= claims.issuedAt! ||
    claims.expires! - claims.issuedAt! > maximumLifetimeMs + clockSkewMs
  ) {
    return false;
  }
  return true;
};

const createSignedToken = (claims: Record<string, unknown>) => {
  const payload = base64url(JSON.stringify(claims));
  return `${payload}.${hmac(payload)}`;
};

type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const localRateLimits = new Map<string, { count: number; expiresAt: number }>();

const clientAddress = (event: HandlerEvent) => {
  const netlifyAddress = event.headers['x-nf-client-connection-ip'];
  if (netlifyAddress) return netlifyAddress.trim();
  const forwarded = event.headers['x-forwarded-for'] ?? event.headers['X-Forwarded-For'];
  return forwarded?.split(',')[0]?.trim() || 'unknown';
};

const consumeLocalRateLimit = (key: string, limit: number, windowSeconds: number): RateLimitResult => {
  const now = Date.now();
  const existing = localRateLimits.get(key);
  const entry = !existing || existing.expiresAt <= now
    ? { count: 1, expiresAt: now + windowSeconds * 1000 }
    : { count: existing.count + 1, expiresAt: existing.expiresAt };
  localRateLimits.set(key, entry);
  return {
    allowed: entry.count <= limit,
    retryAfterSeconds: entry.count <= limit ? 0 : Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
  };
};

async function consumeRateLimit(
  event: HandlerEvent,
  scope: string,
  limit: number,
  windowSeconds: number,
  discriminator = '',
  includeClientAddress = true,
): Promise<RateLimitResult> {
  const address = includeClientAddress ? clientAddress(event) : 'all-clients';
  const keyHash = hmac(`rate-limit:${scope}:${address}:${discriminator}`);
  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_scope: scope,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    if (isMissingRelationError(error) && !managedHostEnabled) {
      return consumeLocalRateLimit(`${scope}:${keyHash}`, limit, windowSeconds);
    }
    console.error('Rate-limit check failed.', { scope, code: error.code });
    throw new RequestValidationError(503, 'Authentication service is temporarily unavailable.');
  }
  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: result?.allowed === true,
    retryAfterSeconds: Math.max(1, Number(result?.retry_after_seconds) || windowSeconds),
  };
}

async function rateLimitResponse(
  event: HandlerEvent,
  scope: string,
  limit: number,
  windowSeconds: number,
  discriminator = '',
  includeClientAddress = true,
) {
  const result = await consumeRateLimit(event, scope, limit, windowSeconds, discriminator, includeClientAddress);
  if (result.allowed) return null;
  return json(
    429,
    { error: 'Too many attempts. Try again later.', retryAfterSeconds: result.retryAfterSeconds },
    { 'retry-after': String(result.retryAfterSeconds) },
  );
}

const normalizePath = (event: HandlerEvent) => {
  const raw = event.path.replace('/.netlify/functions/api', '').replace(/^\/api/, '');
  return raw === '' ? '/' : raw;
};

const distanceMeters = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const minLocationRadiusMeters = 25;
const maxLocationRadiusMeters = 750;

const hasOwn = (values: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(values, key);

const assertAllowedFields = (values: Record<string, unknown>, allowedFields: readonly string[]) => {
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(values).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new RequestValidationError(400, `Unexpected request field: ${unexpected[0]}.`);
  }
};

const requiredText = (value: unknown, label: string, minLength: number, maxLength: number) => {
  if (typeof value !== 'string') throw new RequestValidationError(400, `${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new RequestValidationError(400, `${label} must contain ${minLength} to ${maxLength} characters.`);
  }
  return normalized;
};

const optionalText = (value: unknown, label: string, maxLength: number) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new RequestValidationError(400, `${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new RequestValidationError(400, `${label} is too long.`);
  return normalized || null;
};

const positiveInteger = (value: unknown, label: string, minimum: number, maximum: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RequestValidationError(400, `${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
};

const parseDateOnly = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestValidationError(400, `${label} must use YYYY-MM-DD format.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RequestValidationError(400, `${label} must be a real calendar date.`);
  }
  return value;
};

const parseIsoInstant = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.length > 40 || !value.includes('T')) {
    throw new RequestValidationError(400, `${label} must be an ISO timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new RequestValidationError(400, `${label} must be an ISO timestamp.`);
  return parsed.toISOString();
};

const dateRangeFilters = (params: Record<string, string | undefined>) => {
  const from = params.fromIso
    ? parseIsoInstant(params.fromIso, 'fromIso')
    : params.from
      ? `${parseDateOnly(params.from, 'from')}T00:00:00.000Z`
      : null;
  const to = params.toIso
    ? parseIsoInstant(params.toIso, 'toIso')
    : params.to
      ? `${parseDateOnly(params.to, 'to')}T23:59:59.999Z`
      : null;
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    throw new RequestValidationError(400, 'The start of the date range must not be after the end.');
  }
  return { from, to };
};

const parseTimeZone = (value: string | undefined) => {
  const timeZone = value?.trim() || 'UTC';
  if (timeZone.length > 100) throw new RequestValidationError(400, 'timeZone is invalid.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    throw new RequestValidationError(400, 'timeZone must be a valid IANA time zone.');
  }
  return timeZone;
};

const zonedMidnight = (calendarDate: Date, timeZone: string) => {
  const year = calendarDate.getUTCFullYear();
  const month = calendarDate.getUTCMonth();
  const day = calendarDate.getUTCDate();
  const target = Date.UTC(year, month, day);
  const formatter = new Intl.DateTimeFormat('en-GB-u-hc-h23', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(candidate)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const rendered = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    const adjustment = target - rendered;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
};

const isLatitude = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;

const isLongitude = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

const isLocationRadius = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minLocationRadiusMeters && value <= maxLocationRadiusMeters;

const payloadNumber = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RequestValidationError(400, `${label} must be a finite number.`);
  }
  return value;
};

async function rejectLikelySwappedCoordinates(latitude: number, longitude: number, organizationId: string | null) {
  if (!isLatitude(longitude) || !isLongitude(latitude)) return;
  const settings = await getWorkspaceMapSettings(organizationId);
  if (!isLatitude(settings.mapDefaultLatitude) || !isLongitude(settings.mapDefaultLongitude)) return;
  const directDistance = distanceMeters(settings.mapDefaultLatitude, settings.mapDefaultLongitude, latitude, longitude);
  const swappedDistance = distanceMeters(settings.mapDefaultLatitude, settings.mapDefaultLongitude, longitude, latitude);
  if (directDistance > 50000 && swappedDistance < 10000 && directDistance > swappedDistance * 5) {
    throw new RequestValidationError(400, 'Latitude and longitude look reversed.');
  }
}

async function validateLocationCoordinates(
  values: Record<string, unknown>,
  organizationId: string | null,
  requireAll: boolean,
  existing?: { latitude: number; longitude: number; radius_meters: number } | null,
) {
  const hasLatitude = hasOwn(values, 'latitude');
  const hasLongitude = hasOwn(values, 'longitude');
  const hasRadius = hasOwn(values, 'radius_meters');

  if (requireAll && !hasLatitude) throw new RequestValidationError(400, 'Latitude is required.');
  if (requireAll && !hasLongitude) throw new RequestValidationError(400, 'Longitude is required.');
  if (requireAll && !hasRadius) throw new RequestValidationError(400, 'Radius is required.');

  if (hasLatitude) {
    values.latitude = payloadNumber(values.latitude, 'Latitude');
    if (!isLatitude(values.latitude)) throw new RequestValidationError(400, 'Latitude must be between -90 and 90.');
  }
  if (hasLongitude) {
    values.longitude = payloadNumber(values.longitude, 'Longitude');
    if (!isLongitude(values.longitude)) throw new RequestValidationError(400, 'Longitude must be between -180 and 180.');
  }
  if (hasRadius) {
    values.radius_meters = payloadNumber(values.radius_meters, 'Radius');
    if (!isLocationRadius(values.radius_meters)) {
      throw new RequestValidationError(400, `Radius must be between ${minLocationRadiusMeters}m and ${maxLocationRadiusMeters}m.`);
    }
  }

  const latitude = hasLatitude ? (values.latitude as number) : existing?.latitude;
  const longitude = hasLongitude ? (values.longitude as number) : existing?.longitude;
  if ((hasLatitude || hasLongitude || requireAll) && isLatitude(latitude) && isLongitude(longitude)) {
    await rejectLikelySwappedCoordinates(latitude, longitude, organizationId);
  }
}

const normalizeAreaMutation = (body: Record<string, unknown>, requireName: boolean) => {
  assertAllowedFields(body, ['name', 'sort_order']);
  const values: Record<string, unknown> = {};
  if (hasOwn(body, 'name')) values.name = requiredText(body.name, 'Area name', 2, 120);
  if (hasOwn(body, 'sort_order')) values.sort_order = positiveInteger(body.sort_order, 'sort_order', 0, 100_000);
  if (requireName && !values.name) throw new RequestValidationError(400, 'Area name is required.');
  if (!Object.keys(values).length) throw new RequestValidationError(400, 'At least one editable area field is required.');
  return values;
};

const normalizeLocationMutation = (body: Record<string, unknown>, requireAll: boolean) => {
  assertAllowedFields(body, ['name', 'area_id', 'latitude', 'longitude', 'radius_meters', 'active', 'unitIds']);
  const values: Record<string, unknown> = {};
  if (hasOwn(body, 'name')) values.name = requiredText(body.name, 'Location name', 2, 160);
  if (hasOwn(body, 'area_id')) {
    if (!isUuid(body.area_id)) throw new RequestValidationError(400, 'area_id must be a UUID.');
    values.area_id = body.area_id;
  }
  if (hasOwn(body, 'latitude')) values.latitude = body.latitude;
  if (hasOwn(body, 'longitude')) values.longitude = body.longitude;
  if (hasOwn(body, 'radius_meters')) values.radius_meters = body.radius_meters;
  if (hasOwn(body, 'active')) {
    if (typeof body.active !== 'boolean') throw new RequestValidationError(400, 'active must be true or false.');
    values.active = body.active;
  }
  if (requireAll && !values.name) throw new RequestValidationError(400, 'Location name is required.');
  if (requireAll && !values.area_id) throw new RequestValidationError(400, 'area_id is required.');
  if (!requireAll && !Object.keys(values).length && !hasOwn(body, 'unitIds')) {
    throw new RequestValidationError(400, 'At least one editable location field is required.');
  }
  return values;
};

const normalizeUnitMutation = (body: Record<string, unknown>, requireAll: boolean) => {
  assertAllowedFields(body, ['name', 'location_id', 'unit_type', 'visit_interval_days', 'active']);
  const values: Record<string, unknown> = {};
  if (hasOwn(body, 'name')) values.name = requiredText(body.name, 'Unit name', 2, 160);
  if (hasOwn(body, 'location_id')) {
    if (body.location_id !== null && !isUuid(body.location_id)) {
      throw new RequestValidationError(400, 'location_id must be a UUID or null.');
    }
    values.location_id = body.location_id;
  }
  if (hasOwn(body, 'unit_type')) {
    if (!['department', 'division', 'tenant'].includes(String(body.unit_type))) {
      throw new RequestValidationError(400, 'unit_type must be department, division, or tenant.');
    }
    values.unit_type = body.unit_type;
  }
  if (hasOwn(body, 'visit_interval_days')) {
    values.visit_interval_days = positiveInteger(body.visit_interval_days, 'visit_interval_days', 1, 3650);
  }
  if (hasOwn(body, 'active')) {
    if (typeof body.active !== 'boolean') throw new RequestValidationError(400, 'active must be true or false.');
    values.active = body.active;
  }
  if (requireAll && !values.name) throw new RequestValidationError(400, 'Unit name is required.');
  if (requireAll && !values.unit_type) throw new RequestValidationError(400, 'unit_type is required.');
  if (!Object.keys(values).length) throw new RequestValidationError(400, 'At least one editable unit field is required.');
  return values;
};

const normalizeTeamMemberMutation = (body: Record<string, unknown>, requireName: boolean) => {
  assertAllowedFields(body, ['name', 'role', 'active']);
  const values: Record<string, unknown> = {};
  if (hasOwn(body, 'name')) values.name = requiredText(body.name, 'Team member name', 2, 120);
  if (hasOwn(body, 'role')) values.role = optionalText(body.role, 'Role', 120);
  if (hasOwn(body, 'active')) {
    if (typeof body.active !== 'boolean') throw new RequestValidationError(400, 'active must be true or false.');
    values.active = body.active;
  }
  if (requireName && !values.name) throw new RequestValidationError(400, 'Team member name is required.');
  if (!Object.keys(values).length) throw new RequestValidationError(400, 'At least one editable team member field is required.');
  return values;
};

const statusFromDays = (days: number | null, interval: number): Status => {
  if (days === null) return 'gray';
  const ratio = days / interval;
  if (ratio >= 1) return 'red';
  if (ratio >= 0.75) return 'yellow';
  return 'green';
};

const worstStatus = (statuses: Status[]): Status => {
  const rank: Record<Status, number> = { gray: 4, red: 3, yellow: 2, green: 1 };
  return statuses.sort((a, b) => rank[b] - rank[a])[0] ?? 'gray';
};

const fixedVoidReasons = new Set<FixedVoidReason>([
  'accidental',
  'wrong_unit',
  'duplicate',
  'incorrect_datetime',
  'incorrect_member',
]);

const gamificationTones = new Set<GamificationTone>(['professional', 'friendly', 'banter']);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeIndicator = (value: unknown): IndicatorValue => {
  if (value === true) return true;
  if (value == null) return null;
  throw new Error('Indicators may only be true or null.');
};

const parseOccurredAt = (value: unknown) => {
  const now = Date.now();
  const occurred = value == null || value === '' ? new Date(now) : new Date(String(value));
  const time = occurred.getTime();
  if (!Number.isFinite(time)) throw new Error('occurredAt must be a valid timestamp.');
  if (time > now + 10 * 60000) throw new Error('occurredAt cannot be more than 10 minutes in the future.');
  if (time < now - 90 * 86400000) throw new Error('Queued visits older than 90 days cannot be uploaded.');
  return occurred.toISOString();
};

async function getGamificationTone(organizationId: string | null): Promise<GamificationTone> {
  const query = supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'gamification_tone');
  const { data, error } = await scoped(query, organizationId).maybeSingle();
  if (error || !gamificationTones.has(data?.value as GamificationTone)) return 'professional';
  return data!.value as GamificationTone;
}

async function getWorkspaceOnboardingSummary(organizationId: string | null): Promise<WorkspaceOnboardingSummary> {
  const [areas, locations, units, teamMembers, adminCredential, latestCheckins] = await Promise.all([
    scoped(supabase.from('areas').select('id', { count: 'exact', head: true }), organizationId),
    scoped(supabase.from('locations').select('id', { count: 'exact', head: true }), organizationId),
    scoped(supabase.from('units').select('id', { count: 'exact', head: true }).eq('active', true), organizationId),
    scoped(supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('active', true), organizationId),
    organizationId && (await organizationAdminSchemaEnabled())
      ? supabase
          .from('organization_admin_credentials')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('active', true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    scoped(
      supabase
        .from('checkins')
        .select('checked_in_at, team_members!checkins_team_member_id_fkey(name), units(id, name)')
        .is('voided_at', null)
        .order('checked_in_at', { ascending: false })
        .limit(1),
      organizationId,
    ),
  ]);
  const error = areas.error ?? locations.error ?? units.error ?? teamMembers.error ?? adminCredential.error ?? latestCheckins.error;
  if (error) throw error;
  const areaCount = areas.count ?? 0;
  const locationCount = locations.count ?? 0;
  const unitCount = units.count ?? 0;
  const teamMemberCount = teamMembers.count ?? 0;
  const organizationAdminConfigured = Boolean(adminCredential.data);
  const latestCheckin = ((latestCheckins.data ?? []) as any[])[0] ?? null;
  return {
    areaCount,
    locationCount,
    unitCount,
    teamMemberCount,
    organizationAdminConfigured,
    readyForCheckins: areaCount > 0 && locationCount > 0 && unitCount > 0 && teamMemberCount > 0,
    lastCheckinAt: latestCheckin?.checked_in_at ?? null,
    lastCheckinTeamMemberName: latestCheckin?.team_members?.name ?? null,
    lastCheckinUnitName: latestCheckin?.units?.name ?? null,
  };
}

type AdminTokenContext = Pick<AdminContext, 'organizationId' | 'authMethod'> &
  Partial<Pick<AdminContext, 'organizationUpdatedAt' | 'adminCredentialUpdatedAt'>>;

const createAdminToken = async (context: AdminTokenContext) => {
  const organizationUpdatedAt = context.organizationUpdatedAt !== undefined
    ? context.organizationUpdatedAt
    : (await organizationSessionState(context.organizationId))?.updated_at ?? null;
  const adminCredentialUpdatedAt = context.authMethod === 'organization'
    ? context.adminCredentialUpdatedAt !== undefined
      ? context.adminCredentialUpdatedAt
      : (await organizationAdminCredentialState(context.organizationId))?.updated_at ?? null
    : null;
  const issuedAt = Date.now();
  return createSignedToken({
    version: 1,
    kind: 'admin',
    organizationId: context.organizationId,
    authMethod: context.authMethod,
    organizationUpdatedAt,
    adminCredentialUpdatedAt,
    issuedAt,
    expires: issuedAt + 1000 * 60 * 60 * 8,
  });
};

async function requireAdmin(event: HandlerEvent): Promise<AdminContext | null> {
  const payloadOrExpires = readSignedPayload(event);
  if (!payloadOrExpires) return null;

  const legacyExpires = Number(payloadOrExpires);
  if (Number.isFinite(legacyExpires)) {
    if (!tokenTimesAreValid({ expires: legacyExpires }, 1000 * 60 * 60 * 8)) return null;
    const organizationId = await currentOrganizationId();
    const organizationState = await organizationSessionState(organizationId);
    if (organizationId && !organizationState) return null;
    return {
      organizationId,
      authMethod: 'legacy',
      organizationUpdatedAt: organizationState?.updated_at ?? null,
      adminCredentialUpdatedAt: null,
    };
  }

  let parsed: {
    organizationId?: string | null;
    authMethod?: AdminContext['authMethod'];
    organizationUpdatedAt?: string | null;
    adminCredentialUpdatedAt?: string | null;
    kind?: string;
    version?: number;
    issuedAt?: number;
    expires?: number;
  };
  try {
    parsed = JSON.parse(fromBase64url(payloadOrExpires));
  } catch {
    return null;
  }
  const allowedAuthMethods = new Set<AdminContext['authMethod']>(['organization', 'environment', 'superuser']);
  if (
    !parsed.authMethod ||
    !allowedAuthMethods.has(parsed.authMethod) ||
    (parsed.kind !== undefined && (parsed.kind !== 'admin' || parsed.version !== 1)) ||
    !tokenTimesAreValid(parsed, 1000 * 60 * 60 * 8)
  ) {
    return null;
  }
  if (parsed.organizationId && !isUuid(parsed.organizationId)) return null;
  const organizationId = parsed.organizationId ?? (await currentOrganizationId());
  if ((parsed.authMethod === 'organization' || parsed.authMethod === 'superuser') && !organizationId) return null;
  const organizationState = await organizationSessionState(organizationId);
  if (organizationId && (!organizationState || organizationState.updated_at !== (parsed.organizationUpdatedAt ?? null))) {
    return null;
  }
  if (parsed.authMethod === 'organization') {
    const credentialState = await organizationAdminCredentialState(organizationId);
    if (!credentialState || credentialState.updated_at !== (parsed.adminCredentialUpdatedAt ?? null)) {
      return null;
    }
  }
  return {
    organizationId,
    authMethod: parsed.authMethod,
    organizationUpdatedAt: organizationState?.updated_at ?? null,
    adminCredentialUpdatedAt:
      parsed.authMethod === 'organization' ? parsed.adminCredentialUpdatedAt ?? null : null,
  };
}

async function tryOrganizationAdminLogin(
  organizationId: string | null,
  passphrase: string,
  organizationUpdatedAt: string | null,
): Promise<AdminContext | null> {
  if (!organizationId || !(await organizationAdminSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organization_admin_credentials')
    .select('id, passphrase_hash, updated_at')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const modernHash = isCurrentCredentialHash(data.passphrase_hash);
  const matches = await verifyCredentialHash(
    data.passphrase_hash,
    organizationAdminCredentialContext(organizationId),
    passphrase,
    [organizationAdminHash(organizationId, passphrase)],
  );
  if (!matches) return null;
  let credentialUpdatedAt = data.updated_at ?? null;
  if (!modernHash) {
    const { data: upgraded, error: upgradeError } = await supabase
      .from('organization_admin_credentials')
      .update({ passphrase_hash: await createCredentialHash(organizationAdminCredentialContext(organizationId), passphrase) })
      .eq('id', data.id)
      .eq('organization_id', organizationId)
      .eq('passphrase_hash', data.passphrase_hash)
      .select('updated_at')
      .maybeSingle();
    if (upgradeError) throw upgradeError;
    if (!upgraded) return null;
    credentialUpdatedAt = upgraded.updated_at ?? null;
  }
  return {
    organizationId,
    authMethod: 'organization',
    organizationUpdatedAt,
    adminCredentialUpdatedAt: credentialUpdatedAt,
  };
}

function tryEnvironmentAdminLogin(
  passphrase: string,
  organizationId: string | null,
  organizationUpdatedAt: string | null,
): AdminContext | null {
  if (managedHostEnabled && organizationId) return null;
  if (!matchesSha256(passphrase, adminPassphraseHash)) return null;
  return {
    organizationId,
    authMethod: 'environment',
    organizationUpdatedAt,
    adminCredentialUpdatedAt: null,
  };
}

const setupCodeHash = (code: string) => sha256(`setup-code:${code.trim()}`);

const operatorCredentialVersion = () => hmac(`operator-credential:${centralOperatorPassphraseHash}`);

const createOperatorToken = () => {
  const issuedAt = Date.now();
  return createSignedToken({
    version: 1,
    kind: 'operator',
    authMethod: 'central_operator',
    credentialVersion: operatorCredentialVersion(),
    issuedAt,
    expires: issuedAt + 1000 * 60 * 60 * 4,
  });
};

async function requireOperator(event: HandlerEvent): Promise<OperatorContext | null> {
  const payload = readSignedPayload(event);
  if (!payload) return null;
  let parsed: {
    authMethod?: string;
    credentialVersion?: string;
    kind?: string;
    version?: number;
    issuedAt?: number;
    expires?: number;
  };
  try {
    parsed = JSON.parse(fromBase64url(payload));
  } catch {
    return null;
  }
  if (
    parsed.authMethod !== 'central_operator' ||
    !constantTimeEqual(parsed.credentialVersion ?? '', operatorCredentialVersion()) ||
    (parsed.kind !== undefined && (parsed.kind !== 'operator' || parsed.version !== 1)) ||
    !tokenTimesAreValid(parsed, 1000 * 60 * 60 * 4)
  ) {
    return null;
  }
  return { authMethod: 'central_operator' };
}

async function recordOperatorAudit(
  organizationId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
) {
  const { error } = await supabase.from('operator_audit_events').insert({
    organization_id: organizationId,
    actor: 'central_operator',
    action,
    detail,
  });
  if (error) throw error;
}

async function tryRecordOperatorAudit(
  organizationId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
) {
  try {
    await recordOperatorAudit(organizationId, action, detail);
  } catch (error) {
    console.error('Operator audit write failed.', {
      action,
      organizationId,
      code: (error as { code?: string } | null)?.code,
    });
    if (managedHostEnabled) throw error;
  }
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const createSetupCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let value = '';
  for (let i = 0; i < 16; i += 1) value += alphabet[bytes[i] % alphabet.length];
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
};

const createTemporaryPin = () => crypto.randomInt(0, 10_000).toString().padStart(4, '0');

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const emailRecipients = (value: string) =>
  value
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);

async function sendEmail({
  to,
  subject,
  text,
  html,
  idempotencyKey,
  apiKey = resendApiKey,
  sender = fromEmail,
  replyTo,
}: {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  apiKey?: string;
  sender?: string;
  replyTo?: string;
}) {
  const recipients = Array.isArray(to) ? to : emailRecipients(to);
  if (!apiKey || !sender || !recipients.length) return 'skipped: email environment not configured';
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey.slice(0, 256),
        'user-agent': 'deckplating/1.0',
      },
      body: JSON.stringify({
        from: sender,
        to: recipients,
        subject,
        text,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error('Email provider request failed.', { error: errorMessage(error) });
    return 'failed: email provider unavailable';
  }
  if (!response.ok) {
    const body = await response.text();
    console.error('Email provider rejected a request.', { status: response.status, detail: body.slice(0, 180) });
    return `failed: email provider returned ${response.status}`;
  }
  return 'sent';
}

async function uniqueWorkspaceSlug(baseValue: string) {
  const base = slugify(baseValue) || 'workspace';
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    const { data, error } = await supabase.from('organizations').select('id').eq('slug', candidate).maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
  }
  return `${base.slice(0, 39)}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeWorkspaceRequestBody(body: Record<string, unknown>) {
  assertAllowedFields(body, [
    'installation_or_command',
    'installationOrCommand',
    'preferred_workspace_slug',
    'preferredWorkspaceSlug',
    'lead_name',
    'leadName',
    'lead_role',
    'leadRole',
    'official_contact_email',
    'officialContactEmail',
    'rmt_size',
    'rmtSize',
    'expected_pilot_start_date',
    'expectedPilotStartDate',
    'short_use_case',
    'shortUseCase',
    'safe_use_boundaries_confirmed',
    'safeUseBoundariesConfirmed',
    'no_sensitive_data_acknowledged',
    'noSensitiveDataAcknowledged',
    'form-name',
    'bot-field',
  ]);
  if (clampText(body['bot-field'], 200)) throw new RequestValidationError(400, 'Workspace request could not be accepted.');
  if (body['form-name'] != null && body['form-name'] !== 'deckplating-workspace-request') {
    throw new RequestValidationError(400, 'Workspace request form is invalid.');
  }
  const installationOrCommand = clampText(body.installation_or_command ?? body.installationOrCommand, 160);
  const preferredWorkspaceSlug = slugify(clampText(body.preferred_workspace_slug ?? body.preferredWorkspaceSlug, 80));
  const leadName = clampText(body.lead_name ?? body.leadName, 120);
  const leadRole = clampText(body.lead_role ?? body.leadRole, 120);
  const officialContactEmail = clampText(body.official_contact_email ?? body.officialContactEmail, 254).toLowerCase();
  const rmtSize = Number(body.rmt_size ?? body.rmtSize);
  const expectedPilotStartDate = parseDateOnly(
    body.expected_pilot_start_date ?? body.expectedPilotStartDate,
    'Expected pilot start date',
  );
  const shortUseCase = clampText(body.short_use_case ?? body.shortUseCase, 2000);
  const safeUseBoundariesConfirmed = truthyFormValue(body.safe_use_boundaries_confirmed ?? body.safeUseBoundariesConfirmed);
  const noSensitiveDataAcknowledged = truthyFormValue(body.no_sensitive_data_acknowledged ?? body.noSensitiveDataAcknowledged);

  if (installationOrCommand.length < 2) throw new RequestValidationError(400, 'Installation or command name is required.');
  if (preferredWorkspaceSlug && preferredWorkspaceSlug.length < 2) throw new RequestValidationError(400, 'Preferred workspace slug is too short.');
  if (leadName.length < 2) throw new RequestValidationError(400, 'Lead name is required.');
  if (leadRole.length < 2) throw new RequestValidationError(400, 'Lead role is required.');
  if (!isEmail(officialContactEmail)) throw new RequestValidationError(400, 'A valid official contact email is required.');
  if (!Number.isInteger(rmtSize) || rmtSize < 1 || rmtSize > 999) throw new RequestValidationError(400, 'RMT size must be between 1 and 999.');
  if (shortUseCase.length < 10) throw new RequestValidationError(400, 'Short use case must include at least 10 characters.');
  if (!safeUseBoundariesConfirmed || !noSensitiveDataAcknowledged) {
    throw new RequestValidationError(400, 'Safe-use acknowledgements are required.');
  }

  return {
    installation_or_command: installationOrCommand,
    preferred_workspace_slug: preferredWorkspaceSlug || null,
    lead_name: leadName,
    lead_role: leadRole,
    official_contact_email: officialContactEmail,
    rmt_size: rmtSize,
    expected_pilot_start_date: expectedPilotStartDate,
    short_use_case: shortUseCase,
    safe_use_boundaries_confirmed: safeUseBoundariesConfirmed,
    no_sensitive_data_acknowledged: noSensitiveDataAcknowledged,
  };
}

async function notifyOperatorOfWorkspaceRequest(request: WorkspaceRequestRow) {
  const operatorLink = `${appBaseUrl}/?operator=1&request=${encodeURIComponent(request.id)}`;
  const text = [
    `Deckplating workspace request: ${request.installation_or_command}`,
    '',
    `Lead: ${request.lead_name}`,
    `Role: ${request.lead_role}`,
    `Email: ${request.official_contact_email}`,
    `RMT size: ${request.rmt_size}`,
    `Expected pilot start: ${request.expected_pilot_start_date}`,
    `Preferred slug: ${request.preferred_workspace_slug ?? 'none provided'}`,
    '',
    'Use case:',
    request.short_use_case,
    '',
    `Review: ${operatorLink}`,
  ].join('\n');
  const html = `
    <h1>Deckplating workspace request</h1>
    <p><strong>${escapeHtml(request.installation_or_command)}</strong></p>
    <ul>
      <li>Lead: ${escapeHtml(request.lead_name)}</li>
      <li>Role: ${escapeHtml(request.lead_role)}</li>
      <li>Email: ${escapeHtml(request.official_contact_email)}</li>
      <li>RMT size: ${escapeHtml(request.rmt_size)}</li>
      <li>Expected pilot start: ${escapeHtml(request.expected_pilot_start_date)}</li>
      <li>Preferred slug: ${escapeHtml(request.preferred_workspace_slug ?? 'none provided')}</li>
    </ul>
    <p>${escapeHtml(request.short_use_case)}</p>
    <p><a href="${escapeHtml(operatorLink)}">Review in System Administration</a></p>
  `;
  if (normalizedNotificationMode !== 'provider') {
    return normalizedNotificationMode === 'mailto' ? 'mailto: operator delivery required' : 'skipped: notifications disabled';
  }
  return sendEmail({
    to: operatorEmail,
    subject: `Deckplating workspace request: ${request.installation_or_command}`,
    text,
    html,
    idempotencyKey: `workspace-request-operator-${request.id}`,
    apiKey: notificationProviderApiKey,
    sender: notificationFrom,
    replyTo: notificationReplyTo,
  });
}

async function notifyRequestorOfApproval({
  request,
  organization,
  setupCode,
}: {
  request: WorkspaceRequestRow;
  organization: { id: string; slug: string; name: string; active: boolean };
  setupCode: string;
}) {
  return sendWorkspaceApprovedNotification(
    {
      workspaceDisplayName: organization.name,
      workspaceSlug: organization.slug,
      recipientEmail: request.official_contact_email,
      setupCode,
      includeSetupCode: true,
    },
    {
      mode: notificationMode,
      from: notificationFrom,
      replyTo: notificationReplyTo,
      appBaseUrl,
      setupSiteBaseUrl,
      providerApiKey: notificationProviderApiKey,
    },
    normalizedNotificationMode === 'provider'
      ? ({ to, subject, text, from, replyTo }) =>
          sendEmail({
            to,
            subject,
            text,
            html: `<pre style="font-family: sans-serif; white-space: pre-wrap">${escapeHtml(text)}</pre>`,
            idempotencyKey: `workspace-request-approved-${request.id}`,
            apiKey: notificationProviderApiKey,
            sender: from,
            replyTo,
          })
      : undefined,
  );
}

async function notifyRequestorOfRejection(request: WorkspaceRequestRow) {
  const text = [
    `Deckplating workspace request update: ${request.installation_or_command}`,
    '',
    'Your request was not approved as submitted.',
    request.operator_note ? `Operator note: ${request.operator_note}` : '',
    '',
    `You can submit a revised request at ${setupSiteBaseUrl}/#request.`,
  ]
    .filter(Boolean)
    .join('\n');
  const html = `
    <h1>Deckplating workspace request update</h1>
    <p>Your request for <strong>${escapeHtml(request.installation_or_command)}</strong> was not approved as submitted.</p>
    ${request.operator_note ? `<p>Operator note: ${escapeHtml(request.operator_note)}</p>` : ''}
    <p>You can submit a revised request at <a href="${escapeHtml(`${setupSiteBaseUrl}/#request`)}">${escapeHtml(`${setupSiteBaseUrl}/#request`)}</a>.</p>
  `;
  if (normalizedNotificationMode !== 'provider') {
    return normalizedNotificationMode === 'mailto' ? 'mailto: operator delivery required' : 'skipped: notifications disabled';
  }
  return sendEmail({
    to: request.official_contact_email,
    subject: `Deckplating request update: ${request.installation_or_command}`,
    text,
    html,
    idempotencyKey: `workspace-request-rejected-${request.id}`,
    apiKey: notificationProviderApiKey,
    sender: notificationFrom,
    replyTo: notificationReplyTo,
  });
}

async function issueOrganizationSetupCode({
  organizationId,
  organization,
  label,
  expiresInDays,
  purpose = 'workspace_setup',
}: {
  organizationId: string;
  organization: { slug: string };
  label?: string | null;
  expiresInDays: number;
  purpose?: 'workspace_setup' | 'pilot_setup';
}) {
  const code = createSetupCode();
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
  const { data, error } = await supabase
    .from('organization_setup_codes')
    .insert({
      organization_id: organizationId,
      code_hash: setupCodeHash(code),
      label: label?.trim() || null,
      purpose,
      active: true,
      expires_at: expiresAt,
    })
    .select('id, organization_id, label, purpose, active, expires_at, used_at, used_by_label, created_at')
    .single();
  if (error) throw error;
  await tryRecordOperatorAudit(organizationId, 'setup_code_issued', {
    setupCodeId: data.id,
    slug: organization.slug,
    expiresAt,
  });
  return { code, setupCode: data, expiresAt };
}

async function verifySetupCode(code: string) {
  if (!(await organizationAdminSchemaEnabled())) return null;
  const hash = setupCodeHash(code);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('organization_setup_codes')
    .select('id, organization_id, active, expires_at, used_at')
    .eq('code_hash', hash)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.used_at) return null;
  if (data.expires_at && data.expires_at < now) return null;
  return data as { id: string; organization_id: string };
}

/*
 * Legacy tokens are still accepted above so current beta sessions do not break.
 * New logins receive a signed JSON token with organization scope.
 */
const createUserToken = async (teamMemberId: string, deviceToken: string, organizationId: string | null) => {
  const organizationState = await organizationSessionState(organizationId);
  const issuedAt = Date.now();
  return createSignedToken({
    version: 1,
    kind: 'user',
    teamMemberId,
    deviceHash: sha256(deviceToken),
    organizationId,
    organizationUpdatedAt: organizationState?.updated_at ?? null,
    issuedAt,
    expires: issuedAt + 1000 * 60 * 60 * 24 * 30,
  });
};

async function requireUser(event: HandlerEvent) {
  const payload = readSignedPayload(event);
  if (!payload) return null;

  let parsed: {
    teamMemberId?: string;
    deviceHash?: string;
    organizationId?: string | null;
    organizationUpdatedAt?: string | null;
    kind?: string;
    version?: number;
    issuedAt?: number;
    expires?: number;
  };
  try {
    parsed = JSON.parse(fromBase64url(payload));
  } catch {
    return null;
  }

  if (
    !isUuid(parsed.teamMemberId) ||
    !parsed.deviceHash ||
    !/^[0-9a-f]{64}$/i.test(parsed.deviceHash) ||
    (parsed.kind !== undefined && (parsed.kind !== 'user' || parsed.version !== 1)) ||
    !tokenTimesAreValid(parsed, 1000 * 60 * 60 * 24 * 30)
  ) {
    return null;
  }
  if (parsed.organizationId != null && !isUuid(parsed.organizationId)) return null;
  const organizationId = (await organizationSchemaEnabled()) ? parsed.organizationId ?? defaultOrganizationId : null;
  const organizationState = await organizationSessionState(organizationId);
  if (organizationId && (!organizationState || organizationState.updated_at !== (parsed.organizationUpdatedAt ?? null))) {
    return null;
  }
  const baseQuery = supabase
    .from('devices')
    .select(
      organizationId
        ? 'id, team_member_id, organization_id, last_seen_at, team_members!inner(id, name, active, organization_id)'
        : 'id, team_member_id, last_seen_at, team_members!inner(id, name, active)',
    )
    .eq('team_member_id', parsed.teamMemberId)
    .eq('device_token_hash', parsed.deviceHash)
    .eq('active', true);
  const { data, error } = await scoped(baseQuery, organizationId).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const member = data.team_members as { active?: boolean; organization_id?: string } | null;
  if (!member?.active) return null;
  if (organizationId && member.organization_id !== organizationId) return null;
  const lastSeenAt = data.last_seen_at ? new Date(data.last_seen_at).getTime() : 0;
  if (!Number.isFinite(lastSeenAt) || lastSeenAt < Date.now() - 5 * 60_000) {
    let update = supabase.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
    update = scoped(update, organizationId);
    await update;
  }
  return { teamMemberId: parsed.teamMemberId, deviceId: data.id, organizationId };
}

async function getLatestActiveCheckins(organizationId: string | null) {
  if (organizationId && (await organizationSchemaEnabled())) {
    try {
      return await allById<{ id: string; unit_id: string; checked_in_at: string; visitor: string | null }>((afterId, limit) =>
        supabase.rpc('get_latest_active_checkins_page', {
          p_organization_id: organizationId,
          p_after_unit_id: afterId,
          p_page_size: limit,
        }),
      );
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
    }
  }
  const data = await allById<any>((afterId, limit) => {
    let query = scoped(
      supabase
        .from('checkins')
        .select('id, unit_id, checked_in_at, team_members!checkins_team_member_id_fkey(name)')
        .is('voided_at', null),
      organizationId,
    ).order('id').limit(limit);
    if (afterId) query = query.gt('id', afterId);
    return query;
  });
  data.sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at) || b.id.localeCompare(a.id));
  const latest = new Map<string, { unit_id: string; checked_in_at: string; visitor: string | null }>();
  for (const checkin of data) {
    if (latest.has(checkin.unit_id)) continue;
    const member = checkin.team_members as { name?: string } | null;
    latest.set(checkin.unit_id, {
      unit_id: checkin.unit_id,
      checked_in_at: checkin.checked_in_at,
      visitor: member?.name ?? null,
    });
  }
  return Array.from(latest.values());
}

async function getCoverage(organizationId: string | null) {
  const [areas, units, checkins] = await Promise.all([
    allById<any>((afterId, limit) => {
      let query = scoped(supabase.from('areas').select('*'), organizationId).order('id').limit(limit);
      if (afterId) query = query.gt('id', afterId);
      return query;
    }),
    allById<any>((afterId, limit) => {
      let query = scoped(
        supabase.from('units').select('*, locations(*, areas(*))').eq('active', true),
        organizationId,
      ).order('id').limit(limit);
      if (afterId) query = query.gt('id', afterId);
      return query;
    }),
    getLatestActiveCheckins(organizationId),
  ]);
  areas.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  units.sort((a, b) => a.name.localeCompare(b.name));

  const latest = new Map<string, { checked_in_at: string; visitor: string | null }>();
  for (const checkin of checkins) {
    if (!latest.has(checkin.unit_id)) {
      latest.set(checkin.unit_id, {
        checked_in_at: checkin.checked_in_at,
        visitor: checkin.visitor,
      });
    }
  }

  const now = Date.now();
  const summaries = units.map((unit: any) => {
    const last = latest.get(unit.id);
    const days =
      last?.checked_in_at != null
        ? Math.floor((now - new Date(last.checked_in_at).getTime()) / 86400000)
        : null;
    const location = unit.locations?.active ? unit.locations : null;
    const area = location?.areas;
    const status = statusFromDays(days, unit.visit_interval_days);
    return {
      id: unit.id,
      name: unit.name,
      unit_type: unit.unit_type,
      visit_interval_days: unit.visit_interval_days,
      active: unit.active,
      location_id: location?.id ?? null,
      location_name: location?.name ?? null,
      area_id: area?.id ?? null,
      area_name: area?.name ?? null,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      radius_meters: location?.radius_meters ?? null,
      last_visit_at: last?.checked_in_at ?? null,
      last_visitor: last?.visitor ?? null,
      days_since_last_visit: days,
      status,
    };
  });

  return { areas, units: summaries };
}

async function getLocationSummaries(organizationId: string | null) {
  const coverage = await getCoverage(organizationId);
  const byLocation = new Map<string, any>();
  for (const unit of coverage.units) {
    if (!unit.location_id || unit.latitude == null || unit.longitude == null) continue;
    const existing = byLocation.get(unit.location_id);
    if (existing) {
      existing.units.push(unit);
      existing.status = worstStatus(existing.units.map((u: any) => u.status));
    } else {
      byLocation.set(unit.location_id, {
        id: unit.location_id,
        area_id: unit.area_id,
        area_name: unit.area_name,
        name: unit.location_name,
        latitude: unit.latitude,
        longitude: unit.longitude,
        radius_meters: unit.radius_meters,
        status: unit.status,
        units: [unit],
      });
    }
  }
  return Array.from(byLocation.values());
}

async function verifyDevice(teamMemberId: string, deviceToken: string, organizationId: string | null) {
  const deviceHash = sha256(deviceToken);
  const query = supabase
    .from('devices')
    .select('*')
    .eq('team_member_id', teamMemberId)
    .eq('device_token_hash', deviceHash)
    .eq('active', true);
  const { data, error } = await scoped(query, organizationId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data;
}

async function registerDevice(body: { teamMemberId: string; pin: string; deviceToken: string; deviceLabel?: string; organizationId?: string | null }) {
  if (!isUuid(body.teamMemberId) || !/^\d{4}$/.test(body.pin) || !isUuid(body.deviceToken)) {
    return json(400, { error: 'teamMemberId, 4-digit pin, and deviceToken are required.' });
  }
  let organizationId: string | null;
  try {
    organizationId = await resolveOrganizationId(body.organizationId);
  } catch (error) {
    if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
    throw error;
  }
  const memberQuery = supabase
    .from('team_members')
    .select('*')
    .eq('id', body.teamMemberId)
    .eq('active', true);
  const { data: member, error: memberError } = await scoped(memberQuery, organizationId).maybeSingle();
  if (memberError) throw memberError;
  if (!member) return json(404, { error: 'Team member not found.' });
  if (!member.pin_hash && managedHostEnabled) {
    return json(403, { error: 'This roster entry needs an initial PIN from the local administrator.' });
  }
  const existingPinIsModern = Boolean(member.pin_hash && isCurrentCredentialHash(member.pin_hash));
  const pinMatches = member.pin_hash
    ? await verifyCredentialHash(
        member.pin_hash,
        pinCredentialContext(body.teamMemberId, organizationId),
        body.pin,
        [pinHash(body.teamMemberId, body.pin, organizationId), legacyPinHash(body.teamMemberId, body.pin)],
      )
    : true;
  if (!pinMatches) {
    return json(403, { error: 'PIN does not match.' });
  }
  const nextPinHash = !member.pin_hash || !existingPinIsModern
    ? await createCredentialHash(pinCredentialContext(body.teamMemberId, organizationId), body.pin)
    : null;
  const deviceTokenHash = sha256(body.deviceToken);
  const deviceLabel = clampText(body.deviceLabel, 120) || null;
  const lastSeenAt = new Date().toISOString();
  let deviceId: string | null = null;

  if (organizationId) {
    const { data: registrationRows, error: registrationError } = await supabase.rpc('register_member_device', {
      p_organization_id: organizationId,
      p_team_member_id: body.teamMemberId,
      p_expected_pin_hash: member.pin_hash ?? null,
      p_next_pin_hash: nextPinHash,
      p_device_token_hash: deviceTokenHash,
      p_device_label: deviceLabel,
      p_last_seen_at: lastSeenAt,
    });
    if (!registrationError) {
      const registration = (Array.isArray(registrationRows) ? registrationRows[0] : registrationRows) as
        | { device_id?: string }
        | null;
      if (!registration?.device_id) {
        return json(403, { error: 'PIN no longer matches. Enter the current administrator-issued PIN.' });
      }
      deviceId = registration.device_id;
    } else if (managedHostEnabled || !isMissingRelationError(registrationError)) {
      throw registrationError;
    }
  }

  // Compatibility path for local databases that predate the transactional helper.
  if (!deviceId && (!organizationId || !managedHostEnabled)) {
    if (nextPinHash) {
    let update = supabase.from('team_members').update({ pin_hash: nextPinHash }).eq('id', body.teamMemberId);
    update = scoped(update, organizationId);
    const { error: updateError } = await update;
    if (updateError) throw updateError;
    }
    const deviceValues = withOrganization(
      {
        team_member_id: body.teamMemberId,
        device_token_hash: deviceTokenHash,
        device_label: deviceLabel,
        active: true,
        last_seen_at: lastSeenAt,
      },
      organizationId,
    );
    const { data: device, error } = await supabase
      .from('devices')
      .upsert(deviceValues, { onConflict: organizationId ? 'organization_id,device_token_hash' : 'device_token_hash' })
      .select('id')
      .single();
    if (error) throw error;
    deviceId = device.id;
  }
  if (!deviceId) throw new Error('Device registration did not return a device.');
  return json(200, {
    organizationId,
    organization: await organizationSummary(organizationId),
    deviceId,
    sessionToken: await createUserToken(body.teamMemberId, body.deviceToken, organizationId),
    teamMember: { id: member.id, name: member.name },
  });
}

async function route(event: HandlerEvent) {
  if (event.httpMethod === 'OPTIONS') return empty(204);
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase environment variables are missing.');
  if (
    Buffer.byteLength(adminSessionSecret, 'utf8') < 32 ||
    (managedHostEnabled && Buffer.byteLength(configuredAdminSessionSecret, 'utf8') < 32) ||
    (configuredCredentialPepper && Buffer.byteLength(configuredCredentialPepper, 'utf8') < 32) ||
    (managedHostRequested && !centralOperatorPassphraseHash)
  ) {
    throw new Error('Server token signing is not configured securely.');
  }

  const path = normalizePath(event);
  const method = event.httpMethod;

  if (method === 'POST' && path === '/workspace-requests') {
    const limited = await rateLimitResponse(event, 'workspace-request', 5, 60 * 60);
    if (limited) return limited;
    let values: ReturnType<typeof normalizeWorkspaceRequestBody>;
    try {
      values = normalizeWorkspaceRequestBody(readRequestBody<Record<string, unknown>>(event));
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const { data, error } = await supabase.from('workspace_requests').insert(values).select('*').single();
    if (error) {
      if (isMissingRelationError(error)) return json(503, { error: 'Workspace request queue is not configured yet.' });
      throw error;
    }
    const request = data as WorkspaceRequestRow;
    const notificationStatus = await notifyOperatorOfWorkspaceRequest(request);
    await supabase
      .from('workspace_requests')
      .update({
        operator_notification_status: notificationStatus,
        operator_notified_at: notificationStatus === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', request.id);
    return json(201, {
      request: {
        id: request.id,
        status: request.status,
        installation_or_command: request.installation_or_command,
        created_at: request.created_at,
      },
      notificationStatus,
    });
  }

  if (method === 'GET' && path === '/installations/search') {
    const query = event.queryStringParameters?.q?.trim() ?? '';
    if (query.length < 2 || query.length > 160) return json(400, { error: 'q must contain 2 to 160 characters.' });
    const limited = await rateLimitResponse(event, 'installation-search', 30, 60);
    if (limited) return limited;
    try {
      return json(200, { results: await searchInstallations(query, event) });
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      return json(502, { error: errorMessage(error) });
    }
  }

  if (method === 'POST' && path === '/operator/login') {
    const body = readBody<Record<string, unknown>>(event);
    assertAllowedFields(body, ['passphrase']);
    if (!centralOperatorPassphraseHash) {
      return json(503, { error: 'Central operator access is not configured.' });
    }
    if (typeof body.passphrase !== 'string' || body.passphrase.length > 256) {
      return json(400, { error: 'Central operator passphrase is required.' });
    }
    const limited = await rateLimitResponse(event, 'operator-login', 6, 15 * 60);
    if (limited) return limited;
    const distributedLimit = await rateLimitResponse(event, 'operator-login-global', 30, 24 * 60 * 60, 'central-operator', false);
    if (distributedLimit) return distributedLimit;
    if (!matchesSha256(body.passphrase, centralOperatorPassphraseHash)) {
      return json(403, { error: 'Invalid central operator passphrase.' });
    }
    return json(200, { token: createOperatorToken(), authMethod: 'central_operator' });
  }

  if (path.startsWith('/operator/')) {
    const operator = await requireOperator(event);
    if (!operator) return json(403, { error: 'Central operator authorization required.' });
    if (!(await organizationSchemaEnabled()) || !(await organizationAdminSchemaEnabled())) {
      return json(400, { error: 'Organization workspace tables are not available for this database yet.' });
    }
  }

  if (method === 'GET' && path === '/operator/workspace-requests') {
    const params = event.queryStringParameters ?? {};
    const limit = boundedInteger(params.limit, 100, 1, 250);
    const offset = boundedInteger(params.offset, 0, 0, 100000);
    const status = params.status?.trim();
    let query = supabase
      .from('workspace_requests')
      .select(
        '*, organizations(id, slug, name, active), organization_setup_codes(id, label, purpose, active, expires_at, used_at, used_by_label, created_at)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (status && ['pending', 'approved', 'rejected'].includes(status)) query = query.eq('status', status);
    const { data, error, count } = await query;
    if (error) {
      if (isMissingRelationError(error)) return json(503, { error: 'Workspace request queue is not configured yet.' });
      throw error;
    }
    const returned = data?.length ?? 0;
    return json(200, {
      requests: data ?? [],
      page: {
        limit,
        offset,
        returned,
        total: count ?? returned,
        hasMore: count == null ? returned === limit : offset + returned < count,
      },
    });
  }

  const operatorRequestApproveMatch = path.match(/^\/operator\/workspace-requests\/([^/]+)\/approve$/);
  if (method === 'POST' && operatorRequestApproveMatch) {
    const requestId = operatorRequestApproveMatch[1];
    if (!isUuid(requestId)) return json(400, { error: 'Workspace request ID must be a UUID.' });
    const body = readBody<Record<string, unknown>>(event);
    assertAllowedFields(body, ['workspaceName', 'workspaceSlug', 'expiresInDays', 'operatorNote']);
    const { data: request, error: requestError } = await supabase
      .from('workspace_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request) return json(404, { error: 'Workspace request not found.' });
    const workspaceRequest = request as WorkspaceRequestRow;
    if (workspaceRequest.status !== 'pending') return json(400, { error: 'Only pending workspace requests can be approved.' });

    const workspaceName = clampText(body.workspaceName, 160) || workspaceRequest.installation_or_command;
    const slugBase = clampText(body.workspaceSlug, 80) || workspaceRequest.preferred_workspace_slug || workspaceName;
    const workspaceSlug = await uniqueWorkspaceSlug(slugBase);
    const expiresInDays = body.expiresInDays == null
      ? 14
      : positiveInteger(body.expiresInDays, 'expiresInDays', 1, 90);
    const organizationId = crypto.randomUUID();
    const setupCodeId = crypto.randomUUID();
    const setupCode = createSetupCode();
    const setupExpiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
    const setupLabel = `${workspaceRequest.lead_name} approval setup`;
    const approvedAt = new Date().toISOString();
    const { data: approvalRows, error: approvalError } = await supabase.rpc('approve_workspace_request', {
      p_request_id: workspaceRequest.id,
      p_organization_id: organizationId,
      p_organization_name: workspaceName,
      p_organization_slug: workspaceSlug,
      p_setup_code_id: setupCodeId,
      p_setup_code_hash: setupCodeHash(setupCode),
      p_setup_label: setupLabel,
      p_setup_expires_at: setupExpiresAt,
      p_operator_note: clampText(body.operatorNote, 1000) || null,
      p_approved_at: approvedAt,
    });
    if (approvalError) {
      if (approvalError.code === '23505') return json(409, { error: 'An organization with that slug already exists.' });
      if (approvalError.message?.includes('workspace_request_not_found')) {
        return json(404, { error: 'Workspace request not found.' });
      }
      if (approvalError.message?.includes('workspace_request_not_pending')) {
        return json(409, { error: 'Only pending workspace requests can be approved.' });
      }
      if (isMissingRelationError(approvalError)) {
        return json(503, { error: 'Workspace approval transaction is not configured yet.' });
      }
      throw approvalError;
    }
    const approval = (Array.isArray(approvalRows) ? approvalRows[0] : approvalRows) as
      | { organization?: Record<string, unknown>; setup_code?: Record<string, unknown>; workspace_request?: Record<string, unknown> }
      | null;
    if (!approval?.organization || !approval.setup_code || !approval.workspace_request) {
      throw new Error('Workspace approval transaction returned an incomplete result.');
    }
    const organization = approval.organization as { id: string; slug: string; name: string; active: boolean };
    const setupCodeRecord = approval.setup_code as OrganizationSetupCodeRow;
    const updatedRequest = approval.workspace_request as WorkspaceRequestRow;

    await tryRecordOperatorAudit(organization.id, 'workspace_created', {
      slug: organization.slug,
      workspaceRequestId: workspaceRequest.id,
    });
    await tryRecordOperatorAudit(organization.id, 'setup_code_issued', {
      setupCodeId: setupCodeRecord.id,
      slug: organization.slug,
      expiresAt: setupExpiresAt,
    });
    await tryRecordOperatorAudit(organization.id, 'workspace_request_approved', {
      workspaceRequestId: workspaceRequest.id,
      slug: organization.slug,
      setupCodeId: setupCodeRecord.id,
    });

    const requestorNotification = await notifyRequestorOfApproval({
      request: updatedRequest,
      organization,
      setupCode,
    });
    const requestorNotificationStatus = requestorNotification.status;
    await tryRecordOperatorAudit(organization.id, 'workspace_approval_notification_prepared', {
      workspaceRequestId: workspaceRequest.id,
      slug: organization.slug,
      recipientEmail: requestorNotification.recipientEmail,
      status: requestorNotification.status,
      timestamp: requestorNotification.timestamp,
    });
    await supabase
      .from('workspace_requests')
      .update({
        requestor_notification_status: requestorNotificationStatus,
        requestor_notified_at: requestorNotificationStatus === 'sent' ? requestorNotification.timestamp : null,
      })
      .eq('id', workspaceRequest.id);

    return json(200, {
      request: updatedRequest,
      organization,
      code: setupCode,
      setupCode: { ...setupCodeRecord, code: setupCode },
      requestorNotificationStatus,
      notification: {
        status: requestorNotification.status,
        recipientEmail: requestorNotification.recipientEmail,
        workspaceSlug: requestorNotification.workspaceSlug,
        timestamp: requestorNotification.timestamp,
        subject: requestorNotification.subject,
        text: requestorNotification.text,
        mailtoUrl: requestorNotification.mailtoUrl,
      },
    });
  }

  const operatorRequestRejectMatch = path.match(/^\/operator\/workspace-requests\/([^/]+)\/reject$/);
  if (method === 'POST' && operatorRequestRejectMatch) {
    const requestId = operatorRequestRejectMatch[1];
    if (!isUuid(requestId)) return json(400, { error: 'Workspace request ID must be a UUID.' });
    const body = readBody<{ operatorNote?: string }>(event);
    const operatorNote = clampText(body.operatorNote, 1000);
    if (operatorNote.length < 3) return json(400, { error: 'An operator note is required when rejecting a request.' });
    const { data: rejectionRows, error: rejectionError } = await supabase.rpc('reject_workspace_request', {
      p_request_id: requestId,
      p_operator_note: operatorNote,
      p_rejected_at: new Date().toISOString(),
    });
    if (rejectionError) {
      if (rejectionError.message?.includes('workspace_request_not_found')) {
        return json(404, { error: 'Workspace request not found.' });
      }
      if (rejectionError.message?.includes('workspace_request_not_pending')) {
        return json(409, { error: 'Only pending workspace requests can be rejected.' });
      }
      if (isMissingRelationError(rejectionError)) {
        return json(503, { error: 'Workspace rejection transaction is not configured yet.' });
      }
      throw rejectionError;
    }
    const rejection = (Array.isArray(rejectionRows) ? rejectionRows[0] : rejectionRows) as
      | { workspace_request?: Record<string, unknown> }
      | null;
    if (!rejection?.workspace_request) {
      throw new Error('Workspace rejection transaction returned an incomplete result.');
    }
    const updatedRequest = rejection.workspace_request as unknown as WorkspaceRequestRow;
    const requestorNotificationStatus = await notifyRequestorOfRejection(updatedRequest);
    await supabase
      .from('workspace_requests')
      .update({
        requestor_notification_status: requestorNotificationStatus,
        requestor_notified_at: requestorNotificationStatus === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', requestId);
    return json(200, { request: updatedRequest, requestorNotificationStatus });
  }

  if (method === 'GET' && path === '/operator/audit-events') {
    const params = event.queryStringParameters ?? {};
    const limit = boundedInteger(params.limit, 50, 1, 250);
    const offset = boundedInteger(params.offset, 0, 0, 100000);
    const search = (params.search ?? '').trim();
    const scanLimit = search ? Math.min(Math.max(offset + limit + 100, 250), 1000) : limit;
    let query = supabase
      .from('operator_audit_events')
      .select('id, organization_id, actor, action, detail, created_at')
      .order('created_at', { ascending: false });
    query = search ? query.limit(scanLimit) : query.range(offset, offset + limit - 1);
    const { data: events, error } = await query;
    if (error) throw error;
    const organizationIds = Array.from(
      new Set(
        (events ?? [])
          .map((event: any) => event.organization_id)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    let organizationById = new Map<string, any>();
    if (organizationIds.length) {
      const { data: organizations, error: orgError } = await supabase
        .from('organizations')
        .select('id, slug, name')
        .in('id', organizationIds);
      if (orgError) throw orgError;
      organizationById = new Map((organizations ?? []).map((organization: any) => [organization.id, organization]));
    }
    const mapped = (events ?? []).map((event: any) => ({
      ...event,
      organization: event.organization_id ? organizationById.get(event.organization_id) ?? null : null,
    }));
    const filtered = mapped.filter((auditEvent: any) =>
      matchesSearch(search, [
        auditEvent.action,
        auditEvent.actor,
        auditEvent.organization?.name,
        auditEvent.organization?.slug,
        auditEvent.organization_id,
        auditEvent.created_at,
        JSON.stringify(auditEvent.detail ?? {}),
      ]),
    );
    const paged = search ? filtered.slice(offset, offset + limit) : filtered;
    return json(200, {
      events: paged,
      page: {
        limit,
        offset,
        returned: paged.length,
        total: search && events && events.length < scanLimit ? filtered.length : null,
        hasMore: search ? filtered.length > offset + limit || (events ?? []).length === scanLimit : paged.length === limit,
        truncated: Boolean(search && (events ?? []).length === scanLimit),
        scanLimit: search ? scanLimit : null,
      },
    });
  }

  if (method === 'GET' && path === '/operator/organizations') {
    const [organizations, setupCodes] = await Promise.all([
      allById<any>((afterId, limit) => {
        let query = supabase.from('organizations').select('id, slug, name, active, created_at, updated_at').order('id').limit(limit);
        if (afterId) query = query.gt('id', afterId);
        return query;
      }),
      allById<any>((afterId, limit) => {
        let query = supabase
          .from('organization_setup_codes')
          .select('id, organization_id, label, purpose, active, expires_at, used_at, used_by_label, created_at')
          .order('id')
          .limit(limit);
        if (afterId) query = query.gt('id', afterId);
        return query;
      }),
    ]);
    organizations.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    setupCodes.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const onboardingByOrg = new Map<string, WorkspaceOnboardingSummary>();
    await Promise.all(
      organizations.map(async (organization: any) => {
        onboardingByOrg.set(organization.id, await getWorkspaceOnboardingSummary(organization.id));
      }),
    );
    const codesByOrg = new Map<string, any[]>();
    for (const code of setupCodes) {
      const values = codesByOrg.get(code.organization_id) ?? [];
      values.push(code);
      codesByOrg.set(code.organization_id, values);
    }
    return json(200, {
      organizations: organizations.map((organization: any) => {
        const codes = codesByOrg.get(organization.id) ?? [];
        return {
          ...organization,
          onboarding: onboardingByOrg.get(organization.id) ?? null,
          setupCodes: codes,
          setupCodeSummary: {
            total: codes.length,
            activeUnused: codes.filter((code) => code.active && !code.used_at).length,
            used: codes.filter((code) => code.used_at).length,
          },
        };
      }),
    });
  }

  if (method === 'POST' && path === '/operator/organizations') {
    const body = readBody<{ name?: string; slug?: string; active?: boolean }>(event);
    const name = body.name?.trim();
    if (!name || name.length < 2) return json(400, { error: 'Organization name is required.' });
    const slug = slugify(body.slug || name);
    if (!slug || slug.length < 2) return json(400, { error: 'Organization slug must contain letters or numbers.' });
    const { data, error } = await supabase
      .from('organizations')
      .insert({ name, slug, active: body.active ?? true })
      .select('id, slug, name, active, created_at, updated_at')
      .single();
    if (error) {
      if (error.code === '23505') return json(409, { error: 'An organization with that slug already exists.' });
      throw error;
    }
    await tryRecordOperatorAudit(data.id, 'workspace_created', { slug: data.slug });
    return json(201, { organization: data });
  }

  const operatorAdminSessionMatch = path.match(/^\/operator\/organizations\/([^/]+)\/admin-session$/);
  if (method === 'POST' && operatorAdminSessionMatch) {
    const organizationId = operatorAdminSessionMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('id, slug, name, active, created_at, updated_at')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!organization || !organization.active) return json(404, { error: 'Active organization not found.' });
    await recordOperatorAudit(organizationId, 'superuser_admin_session_started', { slug: organization.slug });
    return json(200, {
      token: await createAdminToken({ organizationId, authMethod: 'superuser' }),
      organization: await organizationSummary(organizationId),
      authMethod: 'superuser',
    });
  }

  const operatorExportMatch = path.match(/^\/operator\/organizations\/([^/]+)\/export$/);
  if (method === 'GET' && operatorExportMatch) {
    const organizationId = operatorExportMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('id, slug, name, active, created_at, updated_at')
      .eq('id', organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization) return json(404, { error: 'Organization not found.' });

    const byId = <T extends { id: string }>(table: string, columns: string) =>
      allById<T>((afterId, limit) => {
        let query = scoped(supabase.from(table).select(columns), organizationId).order('id').limit(limit);
        if (afterId) query = query.gt('id', afterId);
        return query;
      });
    const [settings, areas, locations, units, teamMembers, batches, checkins] = await Promise.all([
      collectKeysetPages<any>((afterKey, limit) => {
        let query = scoped(supabase.from('app_settings').select('key, value'), organizationId).order('key').limit(limit);
        if (afterKey) query = query.gt('key', afterKey);
        return query;
      }, (row) => row.key),
      byId<any>('areas', 'id, name, sort_order'),
      byId<any>('locations', 'id, area_id, name, latitude, longitude, radius_meters, active, created_at, updated_at'),
      byId<any>('units', 'id, location_id, name, unit_type, visit_interval_days, active, created_at, updated_at'),
      byId<any>('team_members', 'id, name, role, active, created_at'),
      byId<any>('checkin_batches', 'id, client_batch_id, location_id, team_member_id, occurred_at, received_at, confidential_care_provided, referral_provided, outcomes_recorded_at, created_at, updated_at, updated_by_team_member_id'),
      byId<any>('checkins', 'id, unit_id, location_id, team_member_id, checked_in_at, geofence_verified, distance_meters, score_awarded, batch_id, voided_at, voided_by_team_member_id, void_reason, created_at, updated_at, updated_by_team_member_id'),
    ]);
    areas.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    locations.sort((a, b) => a.name.localeCompare(b.name));
    units.sort((a, b) => a.name.localeCompare(b.name));
    teamMembers.sort((a, b) => a.name.localeCompare(b.name));
    batches.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id));
    checkins.sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at) || b.id.localeCompare(a.id));
    await tryRecordOperatorAudit(organizationId, 'workspace_safe_export_downloaded', { slug: organization.slug });
    return json(200, {
      generatedAt: new Date().toISOString(),
      format: 'deckplating-safe-operator-export-v1',
      boundary: {
        included:
          'Workspace metadata, non-sensitive setup records, roster display names, visit timestamps, scores, void metadata, and generic legacy visit flags.',
        excluded:
          'Setup-code plaintext, setup-code hashes, passphrase hashes, PIN hashes, device-token hashes, devices, service keys, counseling notes, referral details, medical details, personal details, and sensitive operational details.',
      },
      organization,
      pagination: { strategy: 'keyset', pageSize: 500, complete: true },
      settings,
      areas,
      locations,
      units,
      teamMembers,
      checkinBatches: batches,
      checkins,
    });
  }

  const operatorSetupCodeMatch = path.match(/^\/operator\/organizations\/([^/]+)\/setup-codes$/);
  if (method === 'POST' && operatorSetupCodeMatch) {
    const organizationId = operatorSetupCodeMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const body = readBody<{ label?: string; purpose?: string; expiresInDays?: number }>(event);
    const { data: organization, error: orgError } = await supabase
      .from('organizations')
      .select('id, slug, name, active')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!organization) return json(404, { error: 'Organization not found.' });
    if (!organization.active) return json(400, { error: 'Cannot create setup codes for an inactive organization.' });
    if (body.purpose && !['workspace_setup', 'pilot_setup'].includes(body.purpose)) {
      return json(400, { error: 'purpose must be workspace_setup or pilot_setup.' });
    }
    const purpose = body.purpose === 'pilot_setup' ? 'pilot_setup' : 'workspace_setup';
    const expiresInDays = body.expiresInDays == null ? 14 : Number(body.expiresInDays);
    if (expiresInDays < 1 || expiresInDays > 90) return json(400, { error: 'expiresInDays must be between 1 and 90.' });
    const setup = await issueOrganizationSetupCode({
      organizationId,
      organization,
      label: body.label,
      expiresInDays,
      purpose,
    });
    return json(201, { organization, code: setup.code, setupCode: { ...setup.setupCode, code: setup.code } });
  }

  const operatorCodeRevokeMatch = path.match(/^\/operator\/setup-codes\/([^/]+)\/revoke$/);
  if (method === 'POST' && operatorCodeRevokeMatch) {
    const setupCodeId = operatorCodeRevokeMatch[1];
    if (!isUuid(setupCodeId)) return json(400, { error: 'Setup code ID must be a UUID.' });
    const { data, error } = await supabase.rpc('revoke_setup_code_with_audit', { p_setup_code_id: setupCodeId });
    if (error) {
      if (error.message?.includes('operator_setup_code_not_found')) return json(404, { error: 'Unused setup code not found.' });
      if (isMissingRelationError(error)) return json(503, { error: 'Setup code revocation transaction is not configured yet.' });
      throw error;
    }
    return json(200, { setupCode: data });
  }

  const operatorOrganizationStatusMatch = path.match(/^\/operator\/organizations\/([^/]+)\/status$/);
  if (method === 'POST' && operatorOrganizationStatusMatch) {
    const organizationId = operatorOrganizationStatusMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const body = readBody<{ active?: boolean }>(event);
    if (typeof body.active !== 'boolean') return json(400, { error: 'active must be true or false.' });
    const { data, error } = await supabase.rpc('set_organization_status_with_audit', {
      p_organization_id: organizationId,
      p_active: body.active,
    });
    if (error) {
      if (error.message?.includes('operator_organization_not_found')) return json(404, { error: 'Organization not found.' });
      if (isMissingRelationError(error)) return json(503, { error: 'Workspace status transaction is not configured yet.' });
      throw error;
    }
    return json(200, { organization: data });
  }

  const operatorAdminRecoveryMatch = path.match(/^\/operator\/organizations\/([^/]+)\/admin-passphrase$/);
  if (method === 'POST' && operatorAdminRecoveryMatch) {
    const organizationId = operatorAdminRecoveryMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const body = readBody<Record<string, unknown>>(event);
    assertAllowedFields(body, ['passphrase']);
    if (typeof body.passphrase !== 'string' || body.passphrase.length < 12 || body.passphrase.length > 256) {
      return json(400, { error: 'Passphrase must be at least 12 characters.' });
    }
    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('id, slug, name, active, created_at, updated_at')
      .eq('id', organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization) return json(404, { error: 'Organization not found.' });
    const { data, error } = await supabase.rpc('recover_organization_admin_with_audit', {
      p_organization_id: organizationId,
      p_passphrase_hash: await createCredentialHash(organizationAdminCredentialContext(organizationId), body.passphrase),
    });
    if (error) {
      if (error.message?.includes('operator_organization_not_found')) return json(404, { error: 'Organization not found.' });
      if (isMissingRelationError(error)) return json(503, { error: 'Administrator recovery transaction is not configured yet.' });
      throw error;
    }
    return json(200, { organization: data });
  }

  const operatorDeleteOrganizationMatch = path.match(/^\/operator\/organizations\/([^/]+)\/delete$/);
  if (method === 'DELETE' && operatorDeleteOrganizationMatch) {
    const organizationId = operatorDeleteOrganizationMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const body = readBody<{ confirmSlug?: string }>(event);
    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('id, slug, name, active')
      .eq('id', organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization) return json(404, { error: 'Organization not found.' });
    if (body.confirmSlug?.trim() !== organization.slug) {
      return json(400, { error: 'confirmSlug must match the workspace slug.' });
    }

    const { data: deleted, error: deleteError } = await supabase.rpc('delete_deckplating_organization', {
      p_organization_id: organizationId,
    });
    if (deleteError) {
      if (isMissingRelationError(deleteError)) {
        return json(503, { error: 'Workspace deletion transaction is not configured yet.' });
      }
      throw deleteError;
    }
    if (deleted !== true) return json(404, { error: 'Organization not found.' });
    return json(200, { deletedOrganization: organization });
  }

  if (method === 'GET' && path === '/workspaces/resolve') {
    try {
      const slug = event.queryStringParameters?.slug;
      const organizationId = event.queryStringParameters?.organizationId;
      if (slug) return json(200, { organization: await resolveOrganizationSlug(slug) });
      const resolvedId = await resolveOrganizationId(organizationId);
      return json(200, { organization: await organizationSummary(resolvedId) });
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
  }

  if (method === 'GET' && path === '/team-members') {
    let organizationId: string | null;
    try {
      organizationId = await resolveOrganizationId(event.queryStringParameters?.organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const teamMembers = await allById<any>((afterId, limit) => {
      let query = scoped(
        supabase.from('team_members').select('id, name').eq('active', true),
        organizationId,
      ).order('id').limit(limit);
      if (afterId) query = query.gt('id', afterId);
      return query;
    });
    teamMembers.sort((a, b) => a.name.localeCompare(b.name));
    return json(200, {
      organizationId,
      organization: await organizationSummary(organizationId),
      teamMembers: teamMembers.map((member: any) => ({ ...member, role: null })),
    });
  }

  if (method === 'GET' && path === '/bootstrap') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const [teamMembers, coverage, gamificationTone] = await Promise.all([
      allById<any>((afterId, limit) => {
        let query = scoped(
          supabase.from('team_members').select('id, name, role').eq('active', true),
          user.organizationId,
        ).order('id').limit(limit);
        if (afterId) query = query.gt('id', afterId);
        return query;
      }),
      getCoverage(user.organizationId),
      getGamificationTone(user.organizationId),
    ]);
    teamMembers.sort((a, b) => a.name.localeCompare(b.name));
    const mapSettings = await getWorkspaceMapSettings(user.organizationId);
    return json(200, {
      organizationId: user.organizationId,
      organization: await organizationSummary(user.organizationId),
      areas: coverage.areas,
      teamMembers,
      units: coverage.units,
      mapTileUrl: (process.env.MAP_TILE_URL ?? '').replace('{key}', process.env.MAP_TILE_KEY ?? ''),
      ...mapSettings,
      gamificationTone,
    });
  }

  if (method === 'POST' && path === '/device/register') {
    const body = readBody<{ teamMemberId: string; pin: string; deviceToken: string; deviceLabel?: string; organizationId?: string | null }>(event);
    assertAllowedFields(body as Record<string, unknown>, ['teamMemberId', 'pin', 'deviceToken', 'deviceLabel', 'organizationId']);
    const globalLimit = await rateLimitResponse(event, 'device-register-ip', 40, 15 * 60);
    if (globalLimit) return globalLimit;
    const canonicalOrganizationId = typeof body.organizationId === 'string' && isUuid(body.organizationId)
      ? body.organizationId.toLowerCase()
      : body.organizationId;
    const canonicalTeamMemberId = typeof body.teamMemberId === 'string' && isUuid(body.teamMemberId)
      ? body.teamMemberId.toLowerCase()
      : body.teamMemberId;
    const canonicalDeviceToken = typeof body.deviceToken === 'string' && isUuid(body.deviceToken)
      ? body.deviceToken.toLowerCase()
      : body.deviceToken;
    const targetKey = `${canonicalOrganizationId ?? 'default'}:${canonicalTeamMemberId ?? 'invalid'}`;
    const targetLimit = await rateLimitResponse(
      event,
      'device-register-member',
      8,
      15 * 60,
      targetKey,
    );
    if (targetLimit) return targetLimit;
    const distributedLimit = await rateLimitResponse(
      event,
      'device-register-member-global',
      12,
      60 * 60,
      targetKey,
      false,
    );
    if (distributedLimit) return distributedLimit;
    const dailyLimit = await rateLimitResponse(
      event,
      'device-register-member-daily',
      30,
      24 * 60 * 60,
      targetKey,
      false,
    );
    if (dailyLimit) return dailyLimit;
    return registerDevice({
      ...body,
      teamMemberId: canonicalTeamMemberId,
      deviceToken: canonicalDeviceToken,
      organizationId: canonicalOrganizationId,
    });
  }

  if (method === 'POST' && path === '/device/logout') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const deviceUpdate = supabase.from('devices').update({ active: false }).eq('id', user.deviceId);
    const { data, error } = await scoped(deviceUpdate, user.organizationId).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return json(404, { error: 'Active device session not found.' });
    return json(200, { signedOut: true });
  }

  if (method === 'POST' && path === '/device/change-pin') {
    const body = readBody<Record<string, unknown>>(event);
    assertAllowedFields(body, ['currentPin', 'newPin', 'deviceToken']);
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const currentPin = typeof body.currentPin === 'string' ? body.currentPin : '';
    const newPin = typeof body.newPin === 'string' ? body.newPin : '';
    const deviceToken = typeof body.deviceToken === 'string' ? body.deviceToken : '';
    if (
      !/^\d{4}$/.test(currentPin) ||
      !/^\d{4}$/.test(newPin) ||
      !isUuid(deviceToken)
    ) {
      return json(400, { error: 'The current PIN, a new 4-digit PIN, and the authenticated device token are required.' });
    }
    if (currentPin === newPin) return json(400, { error: 'Choose a different new PIN.' });
    const limited = await rateLimitResponse(event, 'device-change-pin', 8, 15 * 60, `${user.organizationId}:${user.deviceId}`, false);
    if (limited) return limited;
    const currentDevice = await verifyDevice(user.teamMemberId, deviceToken, user.organizationId);
    if (!currentDevice || currentDevice.id !== user.deviceId) {
      return json(403, { error: 'The authenticated device token is required.' });
    }
    const memberQuery = supabase.from('team_members').select('id, pin_hash').eq('id', user.teamMemberId).eq('active', true);
    const { data: member, error: memberError } = await scoped(memberQuery, user.organizationId).maybeSingle();
    if (memberError) throw memberError;
    if (!member?.pin_hash) return json(403, { error: 'Current PIN does not match.' });
    const currentPinMatches = await verifyCredentialHash(
      member.pin_hash,
      pinCredentialContext(user.teamMemberId, user.organizationId),
      currentPin,
      [
        pinHash(user.teamMemberId, currentPin, user.organizationId),
        legacyPinHash(user.teamMemberId, currentPin),
      ],
    );
    if (!currentPinMatches) return json(403, { error: 'Current PIN does not match.' });
    const nextPinHash = await createCredentialHash(
      pinCredentialContext(user.teamMemberId, user.organizationId),
      newPin,
    );
    if (user.organizationId) {
      const { data: changed, error: changeError } = await supabase.rpc('change_member_pin', {
        p_organization_id: user.organizationId,
        p_team_member_id: user.teamMemberId,
        p_current_device_id: user.deviceId,
        p_expected_pin_hash: member.pin_hash,
        p_pin_hash: nextPinHash,
      });
      if (!changeError) {
        if (changed !== true) {
          return json(409, { error: 'The PIN or device session changed. Sign in again with the current PIN.' });
        }
        return json(200, { changed: true, otherDevicesRevoked: true });
      }
      if (managedHostEnabled || !isMissingRelationError(changeError)) throw changeError;
    }

    // Compatibility path for local databases that predate the transactional helper.
    const memberUpdate = supabase.from('team_members').update({ pin_hash: nextPinHash }).eq('id', user.teamMemberId);
    const otherDevicesUpdate = supabase
      .from('devices')
      .update({ active: false })
      .eq('team_member_id', user.teamMemberId)
      .neq('id', user.deviceId);
    const [{ error: pinUpdateError }, { error: deviceUpdateError }] = await Promise.all([
      scoped(memberUpdate, user.organizationId),
      scoped(otherDevicesUpdate, user.organizationId),
    ]);
    if (pinUpdateError || deviceUpdateError) {
      throw pinUpdateError ?? deviceUpdateError ?? new Error('Unable to change PIN.');
    }
    return json(200, { changed: true, otherDevicesRevoked: true });
  }

  if (method === 'POST' && path === '/device/change-identity') {
    const body = readBody<{ currentTeamMemberId: string; pin: string; newTeamMemberId: string; newPin: string; deviceToken: string }>(event);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.currentTeamMemberId) return json(403, { error: 'Authentication required.' });
    const limited = await rateLimitResponse(event, 'device-change-identity', 8, 15 * 60, `${user.organizationId}:${user.deviceId}`, false);
    if (limited) return limited;
    if (!isUuid(body.deviceToken) || !isUuid(body.newTeamMemberId) || !/^\d{4}$/.test(body.pin) || !/^\d{4}$/.test(body.newPin)) {
      return json(400, { error: 'Valid member IDs, device token, and 4-digit PINs are required.' });
    }
    const currentDevice = await verifyDevice(body.currentTeamMemberId, body.deviceToken, user.organizationId);
    if (!currentDevice || currentDevice.id !== user.deviceId) {
      return json(403, { error: 'The authenticated device token is required.' });
    }
    const currentQuery = supabase.from('team_members').select('*').eq('id', body.currentTeamMemberId);
    const { data: current, error: currentError } = await scoped(currentQuery, user.organizationId).maybeSingle();
    if (currentError) throw currentError;
    if (!current?.pin_hash) {
      return json(403, { error: 'Current PIN does not match.' });
    }
    const currentPinMatches = await verifyCredentialHash(
      current.pin_hash,
      pinCredentialContext(body.currentTeamMemberId, user.organizationId),
      body.pin,
      [
        pinHash(body.currentTeamMemberId, body.pin, user.organizationId),
        legacyPinHash(body.currentTeamMemberId, body.pin),
      ],
    );
    if (!currentPinMatches) return json(403, { error: 'Current PIN does not match.' });
    return registerDevice({
      teamMemberId: body.newTeamMemberId,
      pin: body.newPin,
      deviceToken: body.deviceToken,
      deviceLabel: 'Changed identity',
      organizationId: user.organizationId,
    });
  }

  if (method === 'GET' && path === '/nearby-locations') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const lat = Number(event.queryStringParameters?.lat);
    const lon = Number(event.queryStringParameters?.lon);
    const suppliedAccuracy = Number(event.queryStringParameters?.accuracy ?? 0);
    if (!isLatitude(lat) || !isLongitude(lon)) return json(400, { error: 'Valid lat and lon are required.' });
    if (!Number.isFinite(suppliedAccuracy) || suppliedAccuracy < 0 || suppliedAccuracy > 10_000) {
      return json(400, { error: 'accuracy must be between 0 and 10000 meters.' });
    }
    const accuracyTolerance = Math.min(suppliedAccuracy, 300);
    const locations = await getLocationSummaries(user.organizationId);
    const matches = locations
      .map((location) => ({ ...location, distance_meters: distanceMeters(lat, lon, location.latitude, location.longitude) }))
      .filter((location) => location.distance_meters <= location.radius_meters + accuracyTolerance)
      .sort((a, b) => a.distance_meters - b.distance_meters);
    return json(200, { matches });
  }

  if (method === 'POST' && path === '/checkins') {
    const body = readBody<{
      teamMemberId: string;
      deviceToken: string;
      unitIds: string[];
      clientBatchId?: string;
      occurredAt?: string;
      locationId?: string | null;
      latitude?: number;
      longitude?: number;
      accuracyMeters?: number;
      manual?: boolean;
      confidentialCareProvided?: IndicatorValue;
      referralProvided?: IndicatorValue;
    }>(event);
    assertAllowedFields(body as unknown as Record<string, unknown>, [
      'teamMemberId',
      'deviceToken',
      'unitIds',
      'clientBatchId',
      'occurredAt',
      'locationId',
      'latitude',
      'longitude',
      'accuracyMeters',
      'manual',
      'confidentialCareProvided',
      'referralProvided',
    ]);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.teamMemberId) return json(403, { error: 'Authentication required.' });
    const device = await verifyDevice(body.teamMemberId, body.deviceToken, user.organizationId);
    if (!device || device.id !== user.deviceId) return json(403, { error: 'The authenticated device token is required.' });
    if (!Array.isArray(body.unitIds) || body.unitIds.length === 0) return json(400, { error: 'unitIds are required.' });
    if (body.unitIds.length > 100) return json(400, { error: 'A visit batch cannot include more than 100 units.' });
    if (body.manual !== undefined && typeof body.manual !== 'boolean') return json(400, { error: 'manual must be true or false.' });
    if (!body.manual && (!isLatitude(body.latitude) || !isLongitude(body.longitude))) {
      return json(400, { error: 'Valid latitude and longitude are required for a geofenced check-in.' });
    }
    const suppliedAccuracy = body.accuracyMeters ?? 0;
    if (typeof suppliedAccuracy !== 'number' || !Number.isFinite(suppliedAccuracy) || suppliedAccuracy < 0 || suppliedAccuracy > 10_000) {
      return json(400, { error: 'accuracyMeters must be between 0 and 10000.' });
    }
    const accuracyTolerance = Math.min(suppliedAccuracy, 300);
    const clientBatchId = body.clientBatchId ?? crypto.randomUUID();
    if (!isUuid(clientBatchId)) return json(400, { error: 'clientBatchId must be a UUID.' });

    let occurredAt: string;
    let confidentialCareProvided: IndicatorValue;
    let referralProvided: IndicatorValue;
    try {
      occurredAt = parseOccurredAt(body.occurredAt);
      confidentialCareProvided = ministryIndicatorsEnabled ? normalizeIndicator(body.confidentialCareProvided) : null;
      referralProvided = ministryIndicatorsEnabled ? normalizeIndicator(body.referralProvided) : null;
    } catch (error) {
      return json(400, { error: errorMessage(error) });
    }

    let requestedUnitIds: string[];
    try {
      requestedUnitIds = uniqueUuidValues(body.unitIds);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const unitsQuery = supabase
      .from('units')
      .select('*, locations(*)')
      .in('id', requestedUnitIds)
      .eq('active', true);
    const { data: units, error: unitError } = await scoped(unitsQuery, user.organizationId);
    if (unitError) throw unitError;
    if ((units ?? []).length !== requestedUnitIds.length) return json(404, { error: 'One or more units were not found.' });

    const unitLocationIds = Array.from(
      new Set((units ?? []).map((unit: any) => (unit.locations?.active ? unit.location_id : null))),
    );
    if (unitLocationIds.length > 1) return json(400, { error: 'A visit batch can only include units from one location.' });
    const batchLocationId = unitLocationIds[0] ?? null;
    if (body.locationId !== undefined && (body.locationId ?? null) !== batchLocationId) {
      return json(400, { error: 'locationId must match the selected units.' });
    }
    if (batchLocationId === null && requestedUnitIds.length > 1) {
      return json(400, { error: 'Unmapped manual check-ins must be submitted one unit at a time.' });
    }
    const requestFingerprint = sha256(
      JSON.stringify({
        teamMemberId: body.teamMemberId,
        deviceId: device.id,
        unitIds: [...requestedUnitIds].sort(),
        locationId: batchLocationId,
        occurredAt,
        manual: body.manual === true,
        latitude: body.manual ? null : body.latitude,
        longitude: body.manual ? null : body.longitude,
        accuracyMeters: body.manual ? null : accuracyTolerance,
      }),
    );

    if (!user.organizationId) {
      return json(503, { error: 'Transactional check-ins require the current database migration.' });
    }
    const unitsById = new Map<string, any>((units ?? []).map((unit: any): [string, any] => [unit.id, unit]));
    const geofenceValues: boolean[] = [];
    const distanceValues: Array<number | null> = [];
    for (const unitId of requestedUnitIds) {
      const unit = unitsById.get(unitId);
      const location = unit?.locations?.active ? unit.locations : null;
      let distance: number | null = null;
      let geofenceVerified = false;
      if (!body.manual && location && Number.isFinite(body.latitude) && Number.isFinite(body.longitude)) {
        distance = Math.round(distanceMeters(Number(body.latitude), Number(body.longitude), location.latitude, location.longitude));
        geofenceVerified = distance <= location.radius_meters + accuracyTolerance;
      }
      geofenceValues.push(geofenceVerified);
      distanceValues.push(distance);
    }

    const { data: transactionRows, error: transactionError } = await supabase.rpc('create_checkin_batch', {
      p_organization_id: user.organizationId,
      p_team_member_id: body.teamMemberId,
      p_device_id: device.id,
      p_client_batch_id: clientBatchId,
      p_request_fingerprint: requestFingerprint,
      p_occurred_at: occurredAt,
      p_location_id: batchLocationId,
      p_unit_ids: requestedUnitIds,
      p_geofence_verified: geofenceValues,
      p_distance_meters: distanceValues,
      p_confidential_care_provided: confidentialCareProvided,
      p_referral_provided: referralProvided,
    });
    if (transactionError) {
      if (transactionError.message?.includes('checkin_device_inactive')) {
        return json(403, { error: 'The authenticated device session is no longer active.' });
      }
      if (transactionError.message?.includes('checkin_units_invalid')) {
        return json(404, { error: 'One or more units or their location changed. Refresh and try again.' });
      }
      if (transactionError.message?.includes('checkin_batch_owner_mismatch')) {
        return json(403, { error: 'This client batch belongs to another user or device.' });
      }
      if (transactionError.message?.includes('checkin_batch_conflict')) {
        return json(409, { error: 'clientBatchId was already used for a different visit.' });
      }
      if (transactionError.message?.includes('checkin_request_invalid')) {
        return json(400, { error: 'The visit batch is invalid.' });
      }
      if (isMissingRelationError(transactionError)) {
        return json(503, { error: 'Transactional check-ins are not configured yet.' });
      }
      throw transactionError;
    }
    const transaction = (Array.isArray(transactionRows) ? transactionRows[0] : transactionRows) as
      | {
          batch?: {
            id?: string;
            location_id?: string | null;
            confidential_care_provided?: IndicatorValue;
            referral_provided?: IndicatorValue;
          };
          checkin_rows?: Array<{ id: string; unit_id: string; score_awarded: number }>;
        }
      | null;
    const batch = transaction?.batch;
    const allRows = Array.isArray(transaction?.checkin_rows) ? transaction.checkin_rows : [];
    if (!batch?.id || allRows.length !== requestedUnitIds.length) {
      throw new Error('Check-in transaction returned an incomplete result.');
    }
    return json(200, {
      batchId: batch.id,
      clientBatchId,
      locationId: batch.location_id ?? null,
      checkins: allRows.map((row) => ({ id: row.id, score_awarded: row.score_awarded })),
      totalScore: allRows.reduce((sum, row) => sum + row.score_awarded, 0),
      indicators: {
        confidentialCareProvided: batch.confidential_care_provided ?? null,
        referralProvided: batch.referral_provided ?? null,
      },
    });
  }

  if (method === 'POST' && path === '/checkins/undo') {
    const body = readBody<{ teamMemberId?: string; checkinIds?: string[]; clientBatchId?: string }>(event);
    assertAllowedFields(body as Record<string, unknown>, ['teamMemberId', 'checkinIds', 'clientBatchId']);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.teamMemberId) return json(403, { error: 'Authentication required.' });
    const hasCheckinIds = Array.isArray(body.checkinIds) && body.checkinIds.length > 0;
    const hasClientBatchId = typeof body.clientBatchId === 'string' && body.clientBatchId.length > 0;
    if (hasCheckinIds === hasClientBatchId) {
      return json(400, { error: 'Provide either checkinIds or clientBatchId.' });
    }
    if (hasCheckinIds && body.checkinIds!.length > 100) {
      return json(400, { error: 'No more than 100 check-ins can be undone at once.' });
    }
    let checkinIds: string[];
    try {
      if (hasCheckinIds) {
        checkinIds = uniqueUuidValues(body.checkinIds!);
      } else {
        if (!isUuid(body.clientBatchId)) throw new RequestValidationError(400, 'clientBatchId must be a UUID.');
        const batchQuery = supabase
          .from('checkin_batches')
          .select('id')
          .eq('client_batch_id', body.clientBatchId!)
          .eq('team_member_id', user.teamMemberId);
        const { data: batch, error: batchError } = await scoped(batchQuery, user.organizationId).maybeSingle();
        if (batchError) throw batchError;
        if (!batch) return json(404, { error: 'Uploaded visit not found.' });
        const batchCheckinsQuery = supabase
          .from('checkins')
          .select('id')
          .eq('batch_id', batch.id)
          .eq('team_member_id', user.teamMemberId)
          .is('voided_at', null);
        const { data: batchCheckins, error: batchCheckinsError } = await scoped(batchCheckinsQuery, user.organizationId);
        if (batchCheckinsError) throw batchCheckinsError;
        checkinIds = (batchCheckins ?? []).map((checkin: { id: string }) => checkin.id);
        if (!checkinIds.length) return json(409, { error: 'This visit has already been undone.' });
      }
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }

    const ownedQuery = supabase
      .from('checkins')
      .select('id, created_at')
      .in('id', checkinIds)
      .eq('team_member_id', user.teamMemberId)
      .is('voided_at', null);
    const { data: owned, error: ownedError } = await scoped(ownedQuery, user.organizationId);
    if (ownedError) throw ownedError;
    if ((owned ?? []).length !== checkinIds.length) {
      return json(403, { error: 'Only your own active check-ins can be undone.' });
    }
    const undoCutoff = Date.now() - 15 * 60000;
    if ((owned ?? []).some((checkin: any) => new Date(checkin.created_at).getTime() < undoCutoff)) {
      return json(400, { error: 'Immediate undo is available only for check-ins created within the last 15 minutes.' });
    }

    const now = new Date().toISOString();
    const undoQuery = supabase
      .from('checkins')
      .update({
        voided_at: now,
        voided_by_team_member_id: user.teamMemberId,
        void_reason: 'immediate_undo',
        score_awarded: 0,
        updated_by_team_member_id: user.teamMemberId,
      })
      .in('id', checkinIds)
      .eq('team_member_id', user.teamMemberId)
      .is('voided_at', null);
    const { error } = await scoped(undoQuery, user.organizationId);
    if (error) throw error;
    return json(200, { undone: checkinIds.length, coverage: await getCoverage(user.organizationId) });
  }

  const indicatorMatch = path.match(/^\/checkin-batches\/([^/]+)\/indicators$/);
  if (method === 'PATCH' && indicatorMatch) {
    if (!ministryIndicatorsEnabled) return json(404, { error: 'Visit flags are not enabled for this demonstration instance.' });
    const body = readBody<Record<string, unknown>>(event);
    const allowed = new Set(['confidentialCareProvided', 'referralProvided']);
    const extra = Object.keys(body).filter((key) => !allowed.has(key));
    if (extra.length) return json(400, { error: 'Only the two indicator fields are accepted.' });
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    if (!isUuid(indicatorMatch[1])) return json(400, { error: 'Client batch ID must be a UUID.' });

    let confidentialCareProvided: IndicatorValue;
    let referralProvided: IndicatorValue;
    try {
      confidentialCareProvided = normalizeIndicator(body.confidentialCareProvided);
      referralProvided = normalizeIndicator(body.referralProvided);
    } catch (error) {
      return json(400, { error: errorMessage(error) });
    }

    const batchQuery = supabase
      .from('checkin_batches')
      .select('id, team_member_id, device_id')
      .eq('client_batch_id', indicatorMatch[1]);
    const { data: batch, error: batchError } = await scoped(batchQuery, user.organizationId).single();
    if (batchError || !batch) return json(404, { error: 'Check-in batch not found.' });
    if (batch.team_member_id !== user.teamMemberId || batch.device_id !== user.deviceId) {
      return json(403, { error: 'This check-in batch belongs to another user or device.' });
    }

    const indicatorQuery = supabase
      .from('checkin_batches')
      .update({
        confidential_care_provided: confidentialCareProvided,
        referral_provided: referralProvided,
        outcomes_recorded_at: confidentialCareProvided || referralProvided ? new Date().toISOString() : null,
        updated_by_team_member_id: user.teamMemberId,
      })
      .eq('id', batch.id);
    const { data, error } = await scoped(indicatorQuery, user.organizationId)
      .select('client_batch_id, confidential_care_provided, referral_provided, outcomes_recorded_at')
      .single();
    if (error) throw error;
    return json(200, {
      clientBatchId: data.client_batch_id,
      indicators: {
        confidentialCareProvided: data.confidential_care_provided,
        referralProvided: data.referral_provided,
      },
      outcomesRecordedAt: data.outcomes_recorded_at,
    });
  }

  if (method === 'GET' && path === '/dashboard') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    return json(200, await getCoverage(user.organizationId));
  }

  if (method === 'GET' && path === '/coverage-detail') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const unitId = event.queryStringParameters?.unitId;
    if (!unitId) return json(400, { error: 'unitId is required.' });
    const coverage = await getCoverage(user.organizationId);
    const unit = coverage.units.find((candidate: any) => candidate.id === unitId);
    if (!unit) return json(404, { error: 'Unit not found.' });
    const detailQuery = supabase
      .from('checkins')
      .select(
        'id, checked_in_at, geofence_verified, score_awarded, voided_at, void_reason, team_members!checkins_team_member_id_fkey(name), checkin_batches!checkins_batch_id_fkey(confidential_care_provided, referral_provided)',
      )
      .eq('unit_id', unitId);
    const detailLimit = 100;
    const { data, error } = await scoped(detailQuery, user.organizationId)
      .order('checked_in_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(detailLimit + 1);
    if (error) throw error;
    const detailRows = (data ?? []).slice(0, detailLimit);
    return json(200, {
      unit,
      checkins: detailRows.map((checkin: any) => ({
        id: checkin.id,
        checked_in_at: checkin.checked_in_at,
        team_member_name: checkin.team_members?.name ?? 'Unknown member',
        geofence_verified: checkin.geofence_verified,
        score_awarded: checkin.score_awarded,
        voided_at: checkin.voided_at,
        void_reason: checkin.void_reason,
        confidential_care_provided: checkin.checkin_batches?.confidential_care_provided ?? null,
        referral_provided: checkin.checkin_batches?.referral_provided ?? null,
      })),
      page: {
        limit: detailLimit,
        returned: detailRows.length,
        hasMore: (data ?? []).length > detailLimit,
        truncated: (data ?? []).length > detailLimit,
      },
    });
  }

  if (method === 'GET' && path === '/reports/indicators') {
    if (!ministryIndicatorsEnabled) return json(404, { error: 'Visit flag reports are not enabled for this demonstration instance.' });
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const params = event.queryStringParameters ?? {};
    const range = dateRangeFilters(params);
    const rows = await allById<any>((afterId, limit) => supabase.rpc('get_indicator_report_page', {
      p_organization_id: user.organizationId,
      p_from: range.from,
      p_to: range.to,
      p_after_key: afterId,
      p_page_size: limit,
    }));
    rows.sort((a, b) =>
      b.confidential_care_count + b.referral_count - (a.confidential_care_count + a.referral_count) ||
      a.key.localeCompare(b.key),
    );
    return json(200, {
      rows: rows.map(({ id: _cursor, ...row }) => row),
      page: { strategy: 'keyset', complete: true, returned: rows.length },
    });
  }

  if (method === 'GET' && path === '/leaderboard') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const params = event.queryStringParameters ?? {};
    const month = params.month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json(400, { error: 'month must use YYYY-MM format.' });
    const timeZone = parseTimeZone(params.timeZone);
    const [year, monthNumber] = month.split('-').map(Number);
    const calendarMonthStart = new Date(Date.UTC(year, monthNumber - 1, 1));
    const calendarMonthEnd = new Date(Date.UTC(year, monthNumber, 1));
    const monthStart = zonedMidnight(calendarMonthStart, timeZone);
    const monthEnd = zonedMidnight(calendarMonthEnd, timeZone);
    const now = new Date();
    const coverage = await getCoverage(user.organizationId);
    const sweptAreaIds =
      (coverage.areas ?? [])
        .filter((area: any) =>
          coverage.units
            .filter((unit: any) => unit.area_id === area.id)
            .every((unit: any) => unit.status !== 'red' && unit.status !== 'gray'),
        )
        .map((area: any) => area.id);

    const readPeriod = async (periodStart: Date, periodEnd: Date) => {
      const { data, error } = await supabase.rpc('get_leaderboard_period', {
        p_organization_id: user.organizationId,
        p_start: periodStart.toISOString(),
        p_end: periodEnd.toISOString(),
        p_time_zone: timeZone,
        p_swept_area_ids: sweptAreaIds,
      });
      if (error) throw error;
      const result = (data ?? { rows: [], units_recovered: 0, distinct_units_covered: 0 }) as any;
      result.rows = (result.rows ?? []).map((row: any) => {
        const badges = [];
        if (row.qualifying_checkins > 0) badges.push('first_rounds');
        if (row.recovered_units > 0) badges.push('recovery_team');
        if (row.gray_to_green_units > 0) badges.push('gray_to_green');
        if (row.distinct_units >= 5) badges.push('wide_coverage');
        if (row.active_days >= 4) badges.push('sustained_presence');
        if (row.coverage_sweep_areas > 0) badges.push('coverage_sweep');
        return { ...row, badges };
      });
      return result;
    };
    const monthly = await readPeriod(monthStart, monthEnd);

    const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone });
    const labelPeriod = (periodStart: Date, periodEndExclusive: Date) => {
      const endInclusive = new Date(periodEndExclusive.getTime() - 1);
      return `${dateFormatter.format(periodStart)}-${dateFormatter.format(endInclusive)}`;
    };
    const periodWinner = async (type: 'week' | 'month', periodStart: Date, periodEndExclusive: Date, result?: any) => {
      const period = result ?? await readPeriod(periodStart, periodEndExclusive);
      return {
        type,
        label: type === 'month' ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone }).format(periodStart) : labelPeriod(periodStart, periodEndExclusive),
        start: periodStart.toISOString(),
        end: periodEndExclusive.toISOString(),
        final: periodEndExclusive <= now,
        winner: period.rows[0] ?? null,
      };
    };

    const weeklyWinners = [];
    let calendarPeriodStart = new Date(calendarMonthStart);
    while (calendarPeriodStart < calendarMonthEnd) {
      const day = calendarPeriodStart.getUTCDay();
      const daysThroughSunday = day === 0 ? 1 : 8 - day;
      const calendarPeriodEnd = new Date(calendarPeriodStart);
      calendarPeriodEnd.setUTCDate(calendarPeriodEnd.getUTCDate() + daysThroughSunday);
      if (calendarPeriodEnd > calendarMonthEnd) calendarPeriodEnd.setTime(calendarMonthEnd.getTime());
      const periodStart = zonedMidnight(calendarPeriodStart, timeZone);
      const periodEnd = zonedMidnight(calendarPeriodEnd, timeZone);
      if (periodStart <= now) weeklyWinners.push(await periodWinner('week', periodStart, periodEnd));
      calendarPeriodStart = calendarPeriodEnd;
    }

    return json(200, {
      month,
      timeZone,
      rows: monthly.rows,
      winners: {
        weeks: weeklyWinners,
        month: await periodWinner('month', monthStart, monthEnd, monthly),
      },
      summary: {
        units_recovered_this_month: monthly.units_recovered,
        distinct_units_covered: monthly.distinct_units_covered,
        overdue_remaining: coverage.units.filter((unit: any) => unit.status === 'red').length,
        never_visited_remaining: coverage.units.filter((unit: any) => unit.status === 'gray').length,
      },
    });
  }

  if (method === 'POST' && path === '/workspaces/activate') {
    const body = readBody<Record<string, unknown>>(event);
    assertAllowedFields(body, [
      'setupCode',
      'adminPassphrase',
      'organizationName',
      'leadLabel',
      'installationName',
      'installationLatitude',
      'installationLongitude',
    ]);
    if (
      typeof body.setupCode !== 'string' ||
      body.setupCode.length > 80 ||
      typeof body.adminPassphrase !== 'string' ||
      body.adminPassphrase.length < 12 ||
      body.adminPassphrase.length > 256
    ) {
      return json(400, { error: 'setupCode and an adminPassphrase of at least 12 characters are required.' });
    }
    const organizationName = optionalText(body.organizationName, 'Organization name', 160);
    if (organizationName && organizationName.length < 2) {
      return json(400, { error: 'Organization name must contain at least 2 characters.' });
    }
    const leadLabel = optionalText(body.leadLabel, 'Lead label', 120);
    const requestedInstallationName = optionalText(body.installationName, 'Installation name', 200) ?? organizationName;
    const hasInstallationLatitude = hasOwn(body, 'installationLatitude');
    const hasInstallationLongitude = hasOwn(body, 'installationLongitude');
    if (hasInstallationLatitude !== hasInstallationLongitude) {
      return json(400, { error: 'Installation latitude and longitude must be provided together.' });
    }
    if (hasInstallationLatitude && (!isLatitude(body.installationLatitude) || !isLongitude(body.installationLongitude))) {
      return json(400, { error: 'Installation coordinates are invalid.' });
    }
    const limited = await rateLimitResponse(event, 'workspace-activation', 8, 30 * 60);
    if (limited) return limited;
    const setupCode = await verifySetupCode(body.setupCode);
    if (!setupCode) return json(403, { error: 'Setup code is invalid, expired, or already used.' });
    const organizationId = setupCode.organization_id;
    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('id, slug, active')
      .eq('id', organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization?.active) return json(403, { error: 'Setup code is invalid, expired, or already used.' });

    let resolvedInstallationName = requestedInstallationName;
    let resolvedLatitude = hasInstallationLatitude ? (body.installationLatitude as number) : null;
    let resolvedLongitude = hasInstallationLongitude ? (body.installationLongitude as number) : null;
    if (resolvedInstallationName && (resolvedLatitude == null || resolvedLongitude == null)) {
      const matches = await searchInstallations(resolvedInstallationName, event);
      const match = matches[0];
      if (!match) {
        return json(404, {
          error: 'Installation name could not be resolved. Use the installation search to choose a match.',
        });
      }
      resolvedInstallationName = match.display_name;
      resolvedLatitude = Number(match.lat);
      resolvedLongitude = Number(match.lon);
    }
    const credentialHash = await createCredentialHash(
      organizationAdminCredentialContext(organizationId),
      body.adminPassphrase,
    );
    const activatedAt = new Date().toISOString();
    const { data: activationRows, error: activationError } = await supabase.rpc('activate_deckplating_workspace', {
      p_setup_code_id: setupCode.id,
      p_organization_id: organizationId,
      p_used_by_label: leadLabel,
      p_organization_name: organizationName,
      p_installation_name: resolvedInstallationName,
      p_installation_latitude: resolvedLatitude,
      p_installation_longitude: resolvedLongitude,
      p_admin_passphrase_hash: credentialHash,
      p_activated_at: activatedAt,
    });
    if (activationError) {
      if (isMissingRelationError(activationError)) {
        return json(503, { error: 'Workspace activation transaction is not configured yet.' });
      }
      throw activationError;
    }
    const activation = (Array.isArray(activationRows) ? activationRows[0] : activationRows) as
      | { organization_updated_at?: string; admin_credential_updated_at?: string }
      | null;
    if (!activation?.organization_updated_at || !activation.admin_credential_updated_at) {
      return json(403, { error: 'Setup code is invalid, expired, or already used.' });
    }
    await tryRecordOperatorAudit(organizationId, 'workspace_activated', { setupCodeId: setupCode.id, slug: organization.slug });
    return json(200, {
      organizationId,
      organization: await organizationSummary(organizationId),
      token: await createAdminToken({
        organizationId,
        authMethod: 'organization',
        organizationUpdatedAt: activation.organization_updated_at,
        adminCredentialUpdatedAt: activation.admin_credential_updated_at,
      }),
    });
  }

  if (method === 'POST' && path === '/admin/login') {
    const body = readBody<Record<string, unknown>>(event);
    assertAllowedFields(body, ['passphrase', 'organizationId']);
    if (typeof body.passphrase !== 'string' || body.passphrase.length > 256) {
      return json(400, { error: 'Admin passphrase is required.' });
    }
    if (body.organizationId != null && !isUuid(body.organizationId)) {
      return json(400, { error: 'organizationId must be a UUID.' });
    }
    let organizationId: string | null;
    try {
      organizationId = await resolveOrganizationId(body.organizationId as string | null | undefined);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const organizationStateAtLogin = await organizationSessionState(organizationId);
    if (organizationId && !organizationStateAtLogin) {
      return json(403, { error: 'Workspace not found or inactive.' });
    }
    const ipLimit = await rateLimitResponse(event, 'admin-login-ip', 30, 15 * 60);
    if (ipLimit) return ipLimit;
    const targetKey = organizationId ?? 'single-org';
    const targetLimit = await rateLimitResponse(
      event,
      'admin-login-workspace',
      8,
      15 * 60,
      targetKey,
    );
    if (targetLimit) return targetLimit;
    const distributedLimit = await rateLimitResponse(
      event,
      'admin-login-workspace-global',
      50,
      15 * 60,
      targetKey,
      false,
    );
    if (distributedLimit) return distributedLimit;
    const adminContext =
      (await tryOrganizationAdminLogin(organizationId, body.passphrase, organizationStateAtLogin?.updated_at ?? null)) ??
      tryEnvironmentAdminLogin(body.passphrase, organizationId, organizationStateAtLogin?.updated_at ?? null);
    if (!adminContext) {
      return json(403, { error: 'Invalid admin passphrase.' });
    }
    return json(200, {
      token: await createAdminToken(adminContext),
      organizationId: adminContext.organizationId,
      organization: await organizationSummary(adminContext.organizationId),
      authMethod: adminContext.authMethod,
    });
  }

  const adminContext = path.startsWith('/admin/') ? await requireAdmin(event) : null;
  if (path.startsWith('/admin/') && !adminContext) return json(403, { error: 'Admin authorization required.' });

  if (method === 'POST' && path === '/admin/organization-admin/passphrase') {
    const organizationId = adminContext!.organizationId;
    const body = readBody<Record<string, unknown>>(event);
    assertAllowedFields(body, ['passphrase']);
    if (!organizationId || !(await organizationAdminSchemaEnabled())) {
      return json(400, { error: 'Organization admin credentials are not available for this database yet.' });
    }
    if (typeof body.passphrase !== 'string' || body.passphrase.length < 12 || body.passphrase.length > 256) {
      return json(400, { error: 'Passphrase must be at least 12 characters.' });
    }
    const nextPassphraseHash = await createCredentialHash(organizationAdminCredentialContext(organizationId), body.passphrase);
    let credential: { updated_at: string } | null = null;
    if (adminContext!.authMethod === 'organization') {
      const { data, error } = await supabase
        .from('organization_admin_credentials')
        .update({ passphrase_hash: nextPassphraseHash, active: true })
        .eq('organization_id', organizationId)
        .eq('active', true)
        .eq('updated_at', adminContext!.adminCredentialUpdatedAt)
        .select('updated_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(409, { error: 'The administrator credential changed. Unlock Admin again before rotating it.' });
      credential = data;
    } else {
      const { data, error } = await supabase
        .from('organization_admin_credentials')
        .upsert(
          { organization_id: organizationId, passphrase_hash: nextPassphraseHash, active: true },
          { onConflict: 'organization_id' },
        )
        .select('updated_at')
        .single();
      if (error) throw error;
      credential = data;
    }
    return json(200, {
      organizationId,
      authMethod: 'organization',
      token: await createAdminToken({
        organizationId,
        authMethod: 'organization',
        organizationUpdatedAt: adminContext!.organizationUpdatedAt,
        adminCredentialUpdatedAt: credential.updated_at,
      }),
    });
  }

  if (method === 'GET' && path === '/admin/settings') {
    const organizationId = adminContext!.organizationId;
    return json(200, {
      organizationId,
      adminAuthMethod: adminContext!.authMethod,
      organizationAdminAvailable: await organizationAdminSchemaEnabled(),
      gamificationTone: await getGamificationTone(organizationId),
      onboarding: await getWorkspaceOnboardingSummary(organizationId),
    });
  }

  if (method === 'PATCH' && path === '/admin/settings') {
    const organizationId = adminContext!.organizationId;
    const body = readBody<{ gamificationTone?: GamificationTone }>(event);
    if (!body.gamificationTone || !gamificationTones.has(body.gamificationTone)) {
      return json(400, { error: 'gamificationTone must be professional, friendly, or banter.' });
    }
    const { error } = await supabase.from('app_settings').upsert(
      withOrganization({ key: 'gamification_tone', value: body.gamificationTone }, organizationId),
      { onConflict: organizationId ? 'organization_id,key' : 'key' },
    );
    if (error) throw error;
    return json(200, { gamificationTone: body.gamificationTone });
  }

  if (method === 'GET' && path === '/admin/locations') {
    const organizationId = adminContext!.organizationId;
    const readTable = <T extends { id: string }>(table: string, columns: string) => allById<T>((afterId, limit) => {
      let query = scoped(supabase.from(table).select(columns), organizationId).order('id').limit(limit);
      if (afterId) query = query.gt('id', afterId);
      return query;
    });
    const [areas, locations, units, members] = await Promise.all([
      readTable<any>('areas', '*'),
      readTable<any>('locations', '*, areas(*)'),
      readTable<any>('units', '*'),
      readTable<any>('team_members', 'id, name, role, active, created_at'),
    ]);
    areas.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    locations.sort((a, b) => a.name.localeCompare(b.name));
    units.sort((a, b) => a.name.localeCompare(b.name));
    members.sort((a, b) => a.name.localeCompare(b.name));
    return json(200, { areas, locations, units, teamMembers: members });
  }

  if (method === 'POST' && path === '/admin/areas') {
    const organizationId = adminContext!.organizationId;
    const values = normalizeAreaMutation(readBody<Record<string, unknown>>(event), true);
    const { data, error } = await supabase
      .from('areas')
      .insert(withOrganization(values, organizationId))
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') return json(409, { error: 'An area with that name already exists in this workspace.' });
      throw error;
    }
    return json(200, { area: data });
  }

  const areaMatch = path.match(/^\/admin\/areas\/([^/]+)$/);
  if (method === 'PATCH' && areaMatch) {
    const organizationId = adminContext!.organizationId;
    if (!isUuid(areaMatch[1])) return json(400, { error: 'Area ID must be a UUID.' });
    const values = normalizeAreaMutation(readBody<Record<string, unknown>>(event), false);
    const areaUpdate = supabase.from('areas').update(values).eq('id', areaMatch[1]);
    const { data, error } = await scoped(areaUpdate, organizationId).select('*').maybeSingle();
    if (error) {
      if (error.code === '23505') return json(409, { error: 'An area with that name already exists in this workspace.' });
      throw error;
    }
    if (!data) return json(404, { error: 'Area not found.' });
    return json(200, { area: data });
  }

  if (method === 'GET' && path === '/admin/checkins') {
    const organizationId = adminContext!.organizationId;
    const params = event.queryStringParameters ?? {};
    const limit = boundedInteger(params.limit, 75, 1, 250);
    const offset = boundedInteger(params.offset, 0, 0, 100000);
    const search = (params.search ?? '').trim();
    const range = dateRangeFilters(params);
    const needsMappedFiltering = Boolean(params.areaId || search);
    const scanLimit = needsMappedFiltering ? Math.min(Math.max(offset + limit + 200, 500), 2000) : limit;
    let query = scoped(
      supabase
        .from('checkins')
        .select(
          'id, unit_id, location_id, team_member_id, checked_in_at, geofence_verified, score_awarded, voided_at, void_reason, updated_at, batch_id, checkin_batches!checkins_batch_id_fkey(client_batch_id, confidential_care_provided, referral_provided), units(id, name, unit_type, location_id, locations(id, name, area_id, areas(id, name))), locations(id, name, area_id, areas(id, name)), team_members!checkins_team_member_id_fkey(id, name)',
          { count: 'exact' },
        )
        .order('checked_in_at', { ascending: false }),
      organizationId,
    );

    if (range.from) query = query.gte('checked_in_at', range.from);
    if (range.to) query = query.lte('checked_in_at', range.to);
    if (params.teamMemberId) query = query.eq('team_member_id', params.teamMemberId);
    if (params.unitId) query = query.eq('unit_id', params.unitId);
    if (params.includeVoided !== 'true') query = query.is('voided_at', null);
    query = needsMappedFiltering ? query.limit(scanLimit) : query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const mapped = (data ?? []).map((checkin: any) => {
      const directLocation = checkin.locations;
      const unitLocation = checkin.units?.locations;
      const location = directLocation ?? unitLocation ?? null;
      const area = location?.areas ?? null;
      return {
        id: checkin.id,
        unit_id: checkin.unit_id,
        unit_name: checkin.units?.name ?? 'Unknown unit',
        location_id: checkin.location_id,
        location_name: location?.name ?? 'Unmapped',
        area_id: area?.id ?? null,
        area_name: area?.name ?? null,
        team_member_id: checkin.team_member_id,
        team_member_name: checkin.team_members?.name ?? 'Unknown member',
        checked_in_at: checkin.checked_in_at,
        geofence_verified: checkin.geofence_verified,
        score_awarded: checkin.score_awarded,
        voided_at: checkin.voided_at,
        void_reason: checkin.void_reason,
        updated_at: checkin.updated_at,
        batch_id: checkin.batch_id,
        client_batch_id: checkin.checkin_batches?.client_batch_id ?? null,
        confidential_care_provided: checkin.checkin_batches?.confidential_care_provided ?? null,
        referral_provided: checkin.checkin_batches?.referral_provided ?? null,
      };
    });
    const filtered = mapped
      .filter((checkin: any) => !params.areaId || checkin.area_id === params.areaId)
      .filter((checkin: any) =>
        matchesSearch(search, [
          checkin.unit_name,
          checkin.location_name,
          checkin.area_name,
          checkin.team_member_name,
          checkin.checked_in_at,
          checkin.geofence_verified ? 'geofence verified' : 'manual unverified',
          checkin.void_reason,
          ministryIndicatorsEnabled && checkin.confidential_care_provided ? 'follow-up flag' : '',
          ministryIndicatorsEnabled && checkin.referral_provided ? 'external support flag' : '',
        ]),
      );
    const checkins = needsMappedFiltering ? filtered.slice(offset, offset + limit) : filtered;
    return json(200, {
      checkins,
      page: {
        limit,
        offset,
        returned: checkins.length,
        total: needsMappedFiltering && (data ?? []).length < scanLimit ? filtered.length : needsMappedFiltering ? null : count,
        hasMore: needsMappedFiltering
          ? filtered.length > offset + limit || (data ?? []).length === scanLimit
          : count == null
            ? checkins.length === limit
            : offset + checkins.length < count,
        truncated: needsMappedFiltering && (data ?? []).length === scanLimit,
        scanLimit: needsMappedFiltering ? scanLimit : null,
      },
    });
  }

  const adminCheckinMatch = path.match(/^\/admin\/checkins\/([^/]+)$/);
  if (method === 'PATCH' && adminCheckinMatch) {
    const organizationId = adminContext!.organizationId;
    const body = readBody<{
      unit_id?: string;
      checked_in_at?: string;
      team_member_id?: string;
      voided?: boolean;
      void_reason?: FixedVoidReason;
      confidentialCareProvided?: unknown;
      referralProvided?: unknown;
      adminTeamMemberId?: string;
    }>(event);
    assertAllowedFields(body as Record<string, unknown>, [
      'unit_id',
      'checked_in_at',
      'team_member_id',
      'voided',
      'void_reason',
      'confidentialCareProvided',
      'referralProvided',
      'adminTeamMemberId',
    ]);
    if (!isUuid(adminCheckinMatch[1])) return json(400, { error: 'Check-in ID must be a UUID.' });
    if (!isUuid(body.adminTeamMemberId)) return json(400, { error: 'adminTeamMemberId must be a UUID.' });
    if (body.unit_id !== undefined && !isUuid(body.unit_id)) return json(400, { error: 'unit_id must be a UUID.' });
    if (body.team_member_id !== undefined && !isUuid(body.team_member_id)) {
      return json(400, { error: 'team_member_id must be a UUID.' });
    }
    if (body.voided !== undefined && typeof body.voided !== 'boolean') {
      return json(400, { error: 'voided must be true or false.' });
    }
    if (body.checked_in_at !== undefined) {
      try {
        body.checked_in_at = parseIsoInstant(body.checked_in_at, 'checked_in_at');
      } catch (error) {
        if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
        throw error;
      }
    }
    if (
      !['unit_id', 'checked_in_at', 'team_member_id', 'voided', 'confidentialCareProvided', 'referralProvided'].some((key) =>
        hasOwn(body as Record<string, unknown>, key),
      )
    ) {
      return json(400, { error: 'At least one editable check-in field is required.' });
    }
    const indicatorFieldsProvided =
      Object.prototype.hasOwnProperty.call(body, 'confidentialCareProvided') ||
      Object.prototype.hasOwnProperty.call(body, 'referralProvided');
    let confidentialCareProvided: IndicatorValue = null;
    let referralProvided: IndicatorValue = null;
    if (indicatorFieldsProvided) {
      if (!ministryIndicatorsEnabled) {
        return json(400, { error: 'Visit flags are not enabled for this demonstration instance.' });
      }
      if (
        !Object.prototype.hasOwnProperty.call(body, 'confidentialCareProvided') ||
        !Object.prototype.hasOwnProperty.call(body, 'referralProvided')
      ) {
        return json(400, { error: 'Both visit flag fields are required when editing visit flags.' });
      }
      try {
        confidentialCareProvided = normalizeIndicator(body.confidentialCareProvided);
        referralProvided = normalizeIndicator(body.referralProvided);
      } catch (error) {
        return json(400, { error: errorMessage(error) });
      }
    }

    if (body.voided === true) {
      if (!body.void_reason || !fixedVoidReasons.has(body.void_reason)) {
        return json(400, { error: 'A fixed void_reason is required.' });
      }
    }

    const changedAt = new Date().toISOString();
    const { data, error } = await supabase.rpc('admin_correct_checkin', {
      p_organization_id: organizationId,
      p_checkin_id: adminCheckinMatch[1],
      p_admin_team_member_id: body.adminTeamMemberId,
      p_has_unit: hasOwn(body as Record<string, unknown>, 'unit_id'),
      p_unit_id: body.unit_id ?? null,
      p_has_checked_in_at: hasOwn(body as Record<string, unknown>, 'checked_in_at'),
      p_checked_in_at: body.checked_in_at ?? null,
      p_has_team_member: hasOwn(body as Record<string, unknown>, 'team_member_id'),
      p_team_member_id: body.team_member_id ?? null,
      p_has_voided: hasOwn(body as Record<string, unknown>, 'voided'),
      p_voided: body.voided ?? false,
      p_void_reason: body.void_reason ?? null,
      p_has_indicators: indicatorFieldsProvided,
      p_confidential_care_provided: confidentialCareProvided,
      p_referral_provided: referralProvided,
      p_changed_at: changedAt,
    });
    if (error) {
      if (error.message?.includes('admin_checkin_not_found')) return json(404, { error: 'Check-in not found.' });
      if (error.message?.includes('admin_actor_not_found')) return json(404, { error: 'Administrator team member not found.' });
      if (error.message?.includes('admin_replacement_member_not_found')) return json(404, { error: 'Replacement team member not found.' });
      if (error.message?.includes('admin_replacement_unit_not_found')) return json(404, { error: 'Replacement unit not found.' });
      if (error.message?.includes('admin_checkin_batch_missing')) return json(400, { error: 'This check-in does not have an editable visit batch.' });
      if (error.message?.includes('admin_checkin_batch_not_found')) return json(409, { error: 'The visit batch changed or no longer exists.' });
      if (error.message?.includes('admin_void_reason_invalid')) return json(400, { error: 'A fixed void_reason is required.' });
      if (error.code === '23505') return json(409, { error: 'That unit is already present in this visit batch.' });
      if (isMissingRelationError(error)) return json(503, { error: 'Check-in correction transaction is not configured yet.' });
      throw error;
    }
    return json(200, { checkin: data?.checkin ?? data, coverage: await getCoverage(organizationId) });
  }

  if (method === 'POST' && path === '/admin/locations') {
    const organizationId = adminContext!.organizationId;
    const body = readBody<Record<string, unknown>>(event);
    const unitIds = body.unitIds ?? [];
    if (!Array.isArray(unitIds)) return json(400, { error: 'unitIds must be an array.' });
    const locationValues = normalizeLocationMutation(body, true);
    let assignedUnitIds: string[];
    try {
      await validateLocationCoordinates(locationValues, organizationId, true);
      assignedUnitIds = uniqueUuidValues(unitIds);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const { data, error } = await supabase.rpc('admin_mutate_location', {
      p_organization_id: organizationId,
      p_create: true,
      p_location_id: null,
      p_has_name: true,
      p_name: locationValues.name,
      p_has_area: true,
      p_area_id: locationValues.area_id,
      p_has_latitude: true,
      p_latitude: locationValues.latitude,
      p_has_longitude: true,
      p_longitude: locationValues.longitude,
      p_has_radius: true,
      p_radius_meters: locationValues.radius_meters,
      p_has_active: hasOwn(locationValues, 'active'),
      p_active: locationValues.active ?? true,
      p_has_unit_ids: true,
      p_unit_ids: assignedUnitIds,
    });
    if (error) {
      if (error.message?.includes('admin_location_area_not_found')) return json(404, { error: 'Area not found.' });
      if (error.message?.includes('admin_location_unit_not_found')) return json(404, { error: 'One or more units were not found.' });
      if (error.message?.includes('admin_location_unit_ids_duplicate')) return json(400, { error: 'unitIds must not contain duplicates.' });
      if (error.message?.includes('admin_location_required_fields_missing')) return json(400, { error: 'Required location fields are missing.' });
      if (error.message?.includes('admin_location_unit_assignment_failed')) return json(409, { error: 'Unit assignment changed concurrently.' });
      if (error.code === '23505') return json(409, { error: 'A location with those unique fields already exists.' });
      if (isMissingRelationError(error)) return json(503, { error: 'Location mutation transaction is not configured yet.' });
      throw error;
    }
    return json(200, { location: data });
  }

  const locationMatch = path.match(/^\/admin\/locations\/([^/]+)$/);
  if (method === 'PATCH' && locationMatch) {
    const organizationId = adminContext!.organizationId;
    if (!isUuid(locationMatch[1])) return json(400, { error: 'Location ID must be a UUID.' });
    const body = readBody<Record<string, unknown>>(event);
    const unitIds = body.unitIds;
    if (unitIds !== undefined && !Array.isArray(unitIds)) return json(400, { error: 'unitIds must be an array.' });
    const locationValues = normalizeLocationMutation(body, false);
    let assignedUnitIds: string[] | undefined;
    try {
      let existingLocationForValidation: { latitude: number; longitude: number; radius_meters: number } | null = null;
      const needsExistingCoordinates =
        (hasOwn(locationValues, 'latitude') && !hasOwn(locationValues, 'longitude')) ||
        (!hasOwn(locationValues, 'latitude') && hasOwn(locationValues, 'longitude'));
      if (needsExistingCoordinates) {
        const existingQuery = supabase
          .from('locations')
          .select('latitude, longitude, radius_meters')
          .eq('id', locationMatch[1]);
        const { data: existing, error: existingError } = await scoped(existingQuery, organizationId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) return json(404, { error: 'Location not found.' });
        existingLocationForValidation = existing;
      }
      await validateLocationCoordinates(locationValues, organizationId, false, existingLocationForValidation);
      if (Array.isArray(unitIds)) assignedUnitIds = uniqueUuidValues(unitIds);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const { data, error } = await supabase.rpc('admin_mutate_location', {
      p_organization_id: organizationId,
      p_create: false,
      p_location_id: locationMatch[1],
      p_has_name: hasOwn(locationValues, 'name'),
      p_name: locationValues.name ?? null,
      p_has_area: hasOwn(locationValues, 'area_id'),
      p_area_id: locationValues.area_id ?? null,
      p_has_latitude: hasOwn(locationValues, 'latitude'),
      p_latitude: locationValues.latitude ?? null,
      p_has_longitude: hasOwn(locationValues, 'longitude'),
      p_longitude: locationValues.longitude ?? null,
      p_has_radius: hasOwn(locationValues, 'radius_meters'),
      p_radius_meters: locationValues.radius_meters ?? null,
      p_has_active: hasOwn(locationValues, 'active'),
      p_active: locationValues.active ?? false,
      p_has_unit_ids: assignedUnitIds !== undefined,
      p_unit_ids: assignedUnitIds ?? [],
    });
    if (error) {
      if (error.message?.includes('admin_location_not_found')) return json(404, { error: 'Location not found.' });
      if (error.message?.includes('admin_location_area_not_found')) return json(404, { error: 'Area not found.' });
      if (error.message?.includes('admin_location_unit_not_found')) return json(404, { error: 'One or more units were not found.' });
      if (error.message?.includes('admin_location_unit_ids_duplicate')) return json(400, { error: 'unitIds must not contain duplicates.' });
      if (error.message?.includes('admin_location_unit_assignment_failed')) return json(409, { error: 'Unit assignment changed concurrently.' });
      if (error.code === '23505') return json(409, { error: 'A location with those unique fields already exists.' });
      if (isMissingRelationError(error)) return json(503, { error: 'Location mutation transaction is not configured yet.' });
      throw error;
    }
    return json(200, { location: data });
  }

  if (method === 'POST' && path === '/admin/units') {
    const organizationId = adminContext!.organizationId;
    const values = normalizeUnitMutation(readBody<Record<string, unknown>>(event), true);
    try {
      await validateUnitReferences(values, organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const { data, error } = await supabase.from('units').insert(withOrganization(values, organizationId)).select('*').single();
    if (error) throw error;
    return json(200, { unit: data });
  }

  const unitMatch = path.match(/^\/admin\/units\/([^/]+)$/);
  if (method === 'PATCH' && unitMatch) {
    const organizationId = adminContext!.organizationId;
    if (!isUuid(unitMatch[1])) return json(400, { error: 'Unit ID must be a UUID.' });
    const values = normalizeUnitMutation(readBody<Record<string, unknown>>(event), false);
    try {
      await validateUnitReferences(values, organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      throw error;
    }
    const unitUpdate = supabase.from('units').update(values).eq('id', unitMatch[1]);
    const { data, error } = await scoped(unitUpdate, organizationId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return json(404, { error: 'Unit not found.' });
    return json(200, { unit: data });
  }

  if (method === 'POST' && path === '/admin/team-members') {
    const organizationId = adminContext!.organizationId;
    const values = normalizeTeamMemberMutation(readBody<Record<string, unknown>>(event), true);
    const memberId = crypto.randomUUID();
    const temporaryPin = managedHostEnabled ? createTemporaryPin() : null;
    const pinHashValue = temporaryPin
      ? await createCredentialHash(pinCredentialContext(memberId, organizationId), temporaryPin)
      : null;
    const { data, error } = await supabase
      .from('team_members')
      .insert(withOrganization({ ...values, id: memberId, ...(pinHashValue ? { pin_hash: pinHashValue } : {}) }, organizationId))
      .select('id, name, role, active')
      .single();
    if (error) throw error;
    return json(200, { teamMember: data, temporaryPin });
  }

  const memberMatch = path.match(/^\/admin\/team-members\/([^/]+)$/);
  if (method === 'PATCH' && memberMatch) {
    const organizationId = adminContext!.organizationId;
    if (!isUuid(memberMatch[1])) return json(400, { error: 'Team member ID must be a UUID.' });
    const values = normalizeTeamMemberMutation(readBody<Record<string, unknown>>(event), false);
    const { data, error } = await supabase.rpc('admin_update_team_member', {
      p_organization_id: organizationId,
      p_team_member_id: memberMatch[1],
      p_has_name: hasOwn(values, 'name'),
      p_name: values.name ?? null,
      p_has_role: hasOwn(values, 'role'),
      p_role: values.role ?? null,
      p_has_active: hasOwn(values, 'active'),
      p_active: values.active ?? false,
    });
    if (error) {
      if (error.message?.includes('admin_team_member_not_found')) return json(404, { error: 'Team member not found.' });
      if (isMissingRelationError(error)) return json(503, { error: 'Team member update transaction is not configured yet.' });
      throw error;
    }
    return json(200, { teamMember: data });
  }

  const memberResetPinMatch = path.match(/^\/admin\/team-members\/([^/]+)\/reset-pin$/);
  if (method === 'POST' && memberResetPinMatch) {
    const organizationId = adminContext!.organizationId;
    const memberId = memberResetPinMatch[1];
    if (!isUuid(memberId)) return json(400, { error: 'Team member ID must be a UUID.' });
    const memberQuery = supabase.from('team_members').select('id, name').eq('id', memberId);
    const { data: member, error: memberError } = await scoped(memberQuery, organizationId).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return json(404, { error: 'Team member not found.' });
    const temporaryPin = createTemporaryPin();
    const replacementPinHash = await createCredentialHash(pinCredentialContext(memberId, organizationId), temporaryPin);
    if (organizationId) {
      const { data: reset, error: resetTransactionError } = await supabase.rpc('reset_member_pin', {
        p_organization_id: organizationId,
        p_team_member_id: memberId,
        p_pin_hash: replacementPinHash,
      });
      if (!resetTransactionError) {
        if (reset !== true) return json(404, { error: 'Active team member not found.' });
        return json(200, { teamMember: { id: member.id, name: member.name }, temporaryPin });
      }
      if (managedHostEnabled || !isMissingRelationError(resetTransactionError)) throw resetTransactionError;
    }

    // Compatibility path for local databases that predate the transactional helper.
    const memberUpdate = supabase.from('team_members').update({ pin_hash: replacementPinHash }).eq('id', memberId);
    const deviceUpdate = supabase.from('devices').update({ active: false }).eq('team_member_id', memberId);
    const [{ error: resetError }, { error: deviceError }] = await Promise.all([
      scoped(memberUpdate, organizationId),
      scoped(deviceUpdate, organizationId),
    ]);
    if (resetError || deviceError) {
      throw resetError ?? deviceError ?? new Error('Unable to reset member PIN.');
    }
    return json(200, { teamMember: { id: member.id, name: member.name }, temporaryPin });
  }

  return json(404, { error: 'Route not found.' });
}

const allowedCorsOrigins = new Set<string>();
const addAllowedCorsOrigin = (candidate: string) => {
  try {
    const url = new URL(candidate);
    const localDevelopmentOrigin = !managedHostEnabled && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && localDevelopmentOrigin)) {
      allowedCorsOrigins.add(url.origin);
    }
  } catch {
    // Invalid optional origins are ignored instead of widening CORS.
  }
};
for (const candidate of (process.env.DECKPLATING_ALLOWED_ORIGINS ?? '').split(',')) {
  if (candidate.trim()) addAllowedCorsOrigin(candidate.trim());
}
for (const candidate of [appBaseUrl, setupSiteBaseUrl]) {
  addAllowedCorsOrigin(candidate);
}
if (!managedHostEnabled) {
  allowedCorsOrigins.add('http://localhost:5173');
  allowedCorsOrigins.add('http://127.0.0.1:5173');
  allowedCorsOrigins.add('http://localhost:4173');
  allowedCorsOrigins.add('http://127.0.0.1:4173');
}

const applyCors = <T extends { headers?: Record<string, string> }>(event: HandlerEvent, response: T): T => {
  const origin = event.headers.origin ?? event.headers.Origin;
  const headers = { ...(response.headers ?? {}) };
  delete headers['access-control-allow-origin'];
  const localWizardSearch = origin === 'null' && normalizePath(event) === '/installations/search';
  if (origin && (allowedCorsOrigins.has(origin) || localWizardSearch)) headers['access-control-allow-origin'] = origin;
  headers.vary = headers.vary ? `${headers.vary}, Origin` : 'Origin';
  return { ...response, headers };
};

export const handler: Handler = async (event) => {
  try {
    return applyCors(event, await route(event));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return applyCors(event, json(error.statusCode, { error: error.message }));
    }
    const requestId = crypto.randomUUID();
    console.error('Unhandled API error.', {
      requestId,
      method: event.httpMethod,
      path: normalizePath(event),
      error: errorMessage(error),
    });
    return applyCors(event, json(500, { error: 'An internal server error occurred.', requestId }));
  }
};
