import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

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
  organization_setup_codes?: {
    id: string;
    label: string | null;
    purpose: string;
    active: boolean;
    expires_at: string | null;
    used_at: string | null;
    used_by_label: string | null;
    created_at: string;
  } | null;
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
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET ?? serviceRoleKey;
const centralOperatorPassphraseHash = process.env.CENTRAL_OPERATOR_PASSPHRASE_HASH ?? '';
const managedHostEnabled = Boolean(centralOperatorPassphraseHash);
const defaultOrganizationId =
  process.env.DECKPLATING_DEFAULT_ORGANIZATION_ID ?? '00000000-0000-4000-8000-000000000001';
const appBaseUrl = (process.env.DECKPLATING_APP_BASE_URL ?? 'https://deckplating.netlify.app').replace(/\/+$/, '');
const setupSiteBaseUrl = (process.env.DECKPLATING_SETUP_SITE_BASE_URL ?? 'https://deckplatingsetup.netlify.app').replace(/\/+$/, '');
const operatorEmail = process.env.DECKPLATING_OPERATOR_EMAIL ?? '';
const fromEmail = process.env.DECKPLATING_FROM_EMAIL ?? '';
const resendApiKey = process.env.RESEND_API_KEY ?? '';

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : (null as unknown as ReturnType<typeof createClient>);

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  },
  body: JSON.stringify(body),
});

const empty = (statusCode: number) => ({
  statusCode,
  headers: {
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
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

const readBody = <T>(event: HandlerEvent): T => {
  if (!event.body) return {} as T;
  return JSON.parse(event.body) as T;
};

const readRequestBody = <T>(event: HandlerEvent): T => {
  if (!event.body) return {} as T;
  const contentType = event.headers['content-type'] ?? event.headers['Content-Type'] ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(event.body)) as T;
  }
  return JSON.parse(event.body) as T;
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

const legacyPinHash = (teamMemberId: string, pin: string) => sha256(`${teamMemberId}:${pin}`);

const pinHash = (teamMemberId: string, pin: string, organizationId: string | null) =>
  sha256(`${organizationId ?? 'single-org'}:${teamMemberId}:${pin}`);

let organizationSchemaEnabledCache: boolean | null = null;
let organizationAdminSchemaEnabledCache: boolean | null = null;

const isMissingRelationError = (error: unknown) => {
  const value = error as { code?: string; message?: string } | null;
  const message = value?.message?.toLowerCase() ?? '';
  return value?.code === '42P01' || value?.code === 'PGRST205' || message.includes('does not exist');
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
  if (!isUuid(requested)) throw new Error('organizationId must be a UUID.');
  const { data, error } = await supabase
    .from('organizations')
    .select('id, active')
    .eq('id', requested)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.active) throw new Error('Workspace not found or inactive.');
  return data.id as string;
}

async function resolveOrganizationSlug(slug: string) {
  if (!(await organizationSchemaEnabled())) return null;
  const normalized = slugify(slug);
  if (!normalized) throw new Error('workspace slug is required.');
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, active')
    .eq('slug', normalized)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.active) throw new Error('Workspace not found or inactive.');
  return (await organizationSummary(data.id)) as Awaited<ReturnType<typeof organizationSummary>>;
}

async function organizationSummary(organizationId: string | null) {
  if (!organizationId || !(await organizationSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, active')
    .eq('id', organizationId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
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

async function searchInstallations(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const cached = installationSearchCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('limit', '5');

  const response = await fetch(url, {
    headers: {
      'user-agent': 'Deckplating managed pilot',
      referer: 'https://deckplating.netlify.app',
    },
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

async function validateLocationReferences(values: Record<string, unknown>, organizationId: string | null) {
  if (values.area_id == null || values.area_id === '') return;
  const [areaId] = uniqueUuidValues([values.area_id]);
  await ensureScopedIds('areas', [areaId], organizationId, 'Area not found.');
}

async function validateUnitReferences(values: Record<string, unknown>, organizationId: string | null) {
  if (values.location_id == null || values.location_id === '') return;
  const [locationId] = uniqueUuidValues([values.location_id]);
  await ensureScopedIds('locations', [locationId], organizationId, 'Location not found.');
}

async function validateUnitAssignment(unitIds: unknown[], organizationId: string | null) {
  const ids = uniqueUuidValues(unitIds);
  await ensureScopedIds('units', ids, organizationId, 'One or more units were not found.');
  return ids;
}

async function validateTeamMemberReferences(ids: unknown[], organizationId: string | null) {
  const teamMemberIds = uniqueUuidValues(ids);
  await ensureScopedIds('team_members', teamMemberIds, organizationId, 'Team member not found.');
}

const organizationAdminHash = (organizationId: string, passphrase: string) =>
  sha256(`${organizationId}:admin:${passphrase}`);

async function organizationSessionState(organizationId: string | null) {
  if (!organizationId || !(await organizationSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organizations')
    .select('id, active, updated_at')
    .eq('id', organizationId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
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
  if (error || !data) return null;
  return data as { id: string; active: boolean; updated_at: string };
}

const hmac = (value: string) =>
  crypto.createHmac('sha256', adminSessionSecret).update(value).digest('hex');

const base64url = (value: string) => Buffer.from(value).toString('base64url');

const fromBase64url = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

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

const envNumber = (value: string | undefined, fallback: number) => {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const fixedVoidReasons = new Set<FixedVoidReason>([
  'accidental',
  'wrong_unit',
  'duplicate',
  'incorrect_datetime',
  'incorrect_member',
]);

const gamificationTones = new Set<GamificationTone>(['professional', 'friendly', 'banter']);

const isUuid = (value: unknown) =>
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

const statusBefore = (checkedInAt: string | null, occurredAt: string, interval: number): Status => {
  if (!checkedInAt) return 'gray';
  const days = Math.floor((new Date(occurredAt).getTime() - new Date(checkedInAt).getTime()) / 86400000);
  return statusFromDays(days, interval);
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

const createAdminToken = async (context: Pick<AdminContext, 'organizationId' | 'authMethod'>) => {
  const organizationState = await organizationSessionState(context.organizationId);
  const adminCredentialState =
    context.authMethod === 'organization' ? await organizationAdminCredentialState(context.organizationId) : null;
  const payload = base64url(
    JSON.stringify({
      organizationId: context.organizationId,
      authMethod: context.authMethod,
      organizationUpdatedAt: organizationState?.updated_at ?? null,
      adminCredentialUpdatedAt: adminCredentialState?.updated_at ?? null,
      expires: Date.now() + 1000 * 60 * 60 * 8,
    }),
  );
  return `${payload}.${hmac(payload)}`;
};

async function requireAdmin(event: HandlerEvent): Promise<AdminContext | null> {
  const header = event.headers.authorization ?? event.headers.Authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const [payloadOrExpires, signature] = token.split('.');
  if (!payloadOrExpires || !signature) return null;
  const expected = hmac(payloadOrExpires);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const legacyExpires = Number(payloadOrExpires);
  if (Number.isFinite(legacyExpires)) {
    if (legacyExpires < Date.now()) return null;
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
    expires?: number;
  };
  try {
    parsed = JSON.parse(fromBase64url(payloadOrExpires));
  } catch {
    return null;
  }
  if (!parsed.expires || parsed.expires < Date.now()) return null;
  if (parsed.organizationId && !isUuid(parsed.organizationId)) return null;
  const organizationId = parsed.organizationId ?? (await currentOrganizationId());
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
    authMethod:
      parsed.authMethod === 'organization'
        ? 'organization'
        : parsed.authMethod === 'superuser'
          ? 'superuser'
          : 'environment',
    organizationUpdatedAt: organizationState?.updated_at ?? null,
    adminCredentialUpdatedAt:
      parsed.authMethod === 'organization' ? parsed.adminCredentialUpdatedAt ?? null : null,
  };
}

async function tryOrganizationAdminLogin(organizationId: string | null, passphrase: string): Promise<AdminContext | null> {
  if (!organizationId || !(await organizationAdminSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organization_admin_credentials')
    .select('id, passphrase_hash, updated_at')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  if (data.passphrase_hash !== organizationAdminHash(organizationId, passphrase)) return null;
  await supabase
    .from('organization_admin_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .eq('organization_id', organizationId);
  return {
    organizationId,
    authMethod: 'organization',
    organizationUpdatedAt: null,
    adminCredentialUpdatedAt: data.updated_at ?? null,
  };
}

function tryEnvironmentAdminLogin(passphrase: string, organizationId: string | null): AdminContext | null {
  if (managedHostEnabled && organizationId) return null;
  if (!adminPassphraseHash || sha256(passphrase) !== adminPassphraseHash) return null;
  return {
    organizationId,
    authMethod: 'environment',
    organizationUpdatedAt: null,
    adminCredentialUpdatedAt: null,
  };
}

const setupCodeHash = (code: string) => sha256(`setup-code:${code.trim()}`);

const createOperatorToken = () => {
  const payload = base64url(
    JSON.stringify({
      authMethod: 'central_operator',
      expires: Date.now() + 1000 * 60 * 60 * 4,
    }),
  );
  return `${payload}.${hmac(payload)}`;
};

async function requireOperator(event: HandlerEvent): Promise<OperatorContext | null> {
  const header = event.headers.authorization ?? event.headers.Authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = hmac(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let parsed: { authMethod?: string; expires?: number };
  try {
    parsed = JSON.parse(fromBase64url(payload));
  } catch {
    return null;
  }
  if (parsed.authMethod !== 'central_operator' || !parsed.expires || parsed.expires < Date.now()) return null;
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
  } catch {
    // Audit table is introduced in migration 008. Do not block older self-hosted support paths.
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
}: {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}) {
  const recipients = Array.isArray(to) ? to : emailRecipients(to);
  if (!resendApiKey || !fromEmail || !recipients.length) return 'skipped: email environment not configured';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resendApiKey}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey.slice(0, 256),
      'user-agent': 'deckplating/1.0',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipients,
      subject,
      text,
      html,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    return `failed: resend ${response.status} ${body.slice(0, 180)}`;
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
  const installationOrCommand = clampText(body.installation_or_command ?? body.installationOrCommand, 160);
  const preferredWorkspaceSlug = slugify(clampText(body.preferred_workspace_slug ?? body.preferredWorkspaceSlug, 80));
  const leadName = clampText(body.lead_name ?? body.leadName, 120);
  const leadRole = clampText(body.lead_role ?? body.leadRole, 120);
  const officialContactEmail = clampText(body.official_contact_email ?? body.officialContactEmail, 254).toLowerCase();
  const rmtSize = Number(body.rmt_size ?? body.rmtSize);
  const expectedPilotStartDate = clampText(body.expected_pilot_start_date ?? body.expectedPilotStartDate, 10);
  const shortUseCase = clampText(body.short_use_case ?? body.shortUseCase, 2000);
  const safeUseBoundariesConfirmed = truthyFormValue(body.safe_use_boundaries_confirmed ?? body.safeUseBoundariesConfirmed);
  const noSensitiveDataAcknowledged = truthyFormValue(body.no_sensitive_data_acknowledged ?? body.noSensitiveDataAcknowledged);

  if (installationOrCommand.length < 2) throw new RequestValidationError(400, 'Installation or command name is required.');
  if (preferredWorkspaceSlug && preferredWorkspaceSlug.length < 2) throw new RequestValidationError(400, 'Preferred workspace slug is too short.');
  if (leadName.length < 2) throw new RequestValidationError(400, 'Lead name is required.');
  if (leadRole.length < 2) throw new RequestValidationError(400, 'Lead role is required.');
  if (!isEmail(officialContactEmail)) throw new RequestValidationError(400, 'A valid official contact email is required.');
  if (!Number.isInteger(rmtSize) || rmtSize < 1 || rmtSize > 999) throw new RequestValidationError(400, 'RMT size must be between 1 and 999.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedPilotStartDate)) throw new RequestValidationError(400, 'Expected pilot start date is required.');
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
  return sendEmail({
    to: operatorEmail,
    subject: `Deckplating workspace request: ${request.installation_or_command}`,
    text,
    html,
    idempotencyKey: `workspace-request-operator-${request.id}`,
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
  const workspaceLink = `${appBaseUrl}/?workspace=${encodeURIComponent(organization.slug)}`;
  const userGuide = `${setupSiteBaseUrl}/user-guide.html`;
  const setupGuide = `${setupSiteBaseUrl}/`;
  const text = [
    `Welcome to Deckplating, ${request.lead_name}.`,
    '',
    `Your workspace is approved: ${organization.name}`,
    `Workspace link: ${workspaceLink}`,
    `One-time setup code: ${setupCode}`,
    '',
    `Setup guide: ${setupGuide}`,
    `User guide: ${userGuide}`,
    '',
    'First steps:',
    '1. Open the workspace link.',
    '2. Select Activate workspace.',
    '3. Enter the one-time setup code.',
    '4. Set the local admin passphrase.',
    '5. Create areas, public/general locations, units, and team members.',
    '',
    'Safe-use reminder: Deckplating is only for unclassified, non-sensitive coverage tracking. Do not enter counseling notes, medical details, personal details, CUI, classified information, setup codes, passphrases, or sensitive operational locations.',
  ].join('\n');
  const html = `
    <h1>Welcome to Deckplating</h1>
    <p>Your workspace is approved: <strong>${escapeHtml(organization.name)}</strong></p>
    <p>Workspace link: <a href="${escapeHtml(workspaceLink)}">${escapeHtml(workspaceLink)}</a></p>
    <p>One-time setup code: <strong>${escapeHtml(setupCode)}</strong></p>
    <p><a href="${escapeHtml(setupGuide)}">Setup guide</a> | <a href="${escapeHtml(userGuide)}">User guide</a></p>
    <ol>
      <li>Open the workspace link.</li>
      <li>Select Activate workspace.</li>
      <li>Enter the one-time setup code.</li>
      <li>Set the local admin passphrase.</li>
      <li>Create areas, public/general locations, units, and team members.</li>
    </ol>
    <p><strong>Safe-use reminder:</strong> Deckplating is only for unclassified, non-sensitive coverage tracking. Do not enter counseling notes, medical details, personal details, CUI, classified information, setup codes, passphrases, or sensitive operational locations.</p>
  `;
  return sendEmail({
    to: request.official_contact_email,
    subject: `Deckplating workspace approved: ${organization.name}`,
    text,
    html,
    idempotencyKey: `workspace-request-approved-${request.id}`,
  });
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
  return sendEmail({
    to: request.official_contact_email,
    subject: `Deckplating request update: ${request.installation_or_command}`,
    text,
    html,
    idempotencyKey: `workspace-request-rejected-${request.id}`,
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
  if (error || !data || data.used_at) return null;
  if (data.expires_at && data.expires_at < now) return null;
  return data as { id: string; organization_id: string };
}

const markSetupCodeUsed = async (id: string, organizationId: string, usedByLabel: string | null) => {
  await supabase
    .from('organization_setup_codes')
    .update({ used_at: new Date().toISOString(), used_by_label: usedByLabel, active: false })
    .eq('id', id)
    .eq('organization_id', organizationId);
};

/*
 * Legacy tokens are still accepted above so current beta sessions do not break.
 * New logins receive a signed JSON token with organization scope.
 */
const createUserToken = async (teamMemberId: string, deviceToken: string, organizationId: string | null) => {
  const organizationState = await organizationSessionState(organizationId);
  const payload = base64url(
    JSON.stringify({
      teamMemberId,
      deviceHash: sha256(deviceToken),
      organizationId,
      organizationUpdatedAt: organizationState?.updated_at ?? null,
      expires: Date.now() + 1000 * 60 * 60 * 24 * 30,
    }),
  );
  return `${payload}.${hmac(payload)}`;
};

async function requireUser(event: HandlerEvent) {
  const header = event.headers.authorization ?? event.headers.Authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = hmac(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  let parsed: {
    teamMemberId?: string;
    deviceHash?: string;
    organizationId?: string | null;
    organizationUpdatedAt?: string | null;
    expires?: number;
  };
  try {
    parsed = JSON.parse(fromBase64url(payload));
  } catch {
    return null;
  }

  if (!parsed.teamMemberId || !parsed.deviceHash || !parsed.expires || parsed.expires < Date.now()) return null;
  const organizationId = (await organizationSchemaEnabled()) ? parsed.organizationId ?? defaultOrganizationId : null;
  const organizationState = await organizationSessionState(organizationId);
  if (organizationId && (!organizationState || organizationState.updated_at !== (parsed.organizationUpdatedAt ?? null))) {
    return null;
  }
  const baseQuery = supabase
    .from('devices')
    .select(
      organizationId
        ? 'id, team_member_id, organization_id, team_members!inner(id, name, active, organization_id)'
        : 'id, team_member_id, team_members!inner(id, name, active)',
    )
    .eq('team_member_id', parsed.teamMemberId)
    .eq('device_token_hash', parsed.deviceHash)
    .eq('active', true);
  const { data, error } = await scoped(baseQuery, organizationId).single();
  if (error || !data) return null;

  const member = data.team_members as { active?: boolean; organization_id?: string } | null;
  if (!member?.active) return null;
  if (organizationId && member.organization_id !== organizationId) return null;
  let update = supabase.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  update = scoped(update, organizationId);
  await update;
  return { teamMemberId: parsed.teamMemberId, deviceId: data.id, organizationId };
}

async function getCoverage(organizationId: string | null) {
  const areaQuery = scoped(supabase.from('areas').select('*'), organizationId).order('sort_order');
  const unitQuery = scoped(
    supabase
      .from('units')
      .select('*, locations(*, areas(*))')
      .eq('active', true),
    organizationId,
  ).order('name');
  const checkinQuery = scoped(
    supabase
      .from('checkins')
      .select('unit_id, checked_in_at, team_members!checkins_team_member_id_fkey(name)')
      .is('voided_at', null),
    organizationId,
  ).order('checked_in_at', { ascending: false });
  const [{ data: areas, error: areaError }, { data: units, error: unitError }, { data: checkins, error: checkinError }] =
    await Promise.all([areaQuery, unitQuery, checkinQuery]);

  if (areaError || unitError || checkinError) {
    throw areaError ?? unitError ?? checkinError;
  }

  const latest = new Map<string, { checked_in_at: string; visitor: string | null }>();
  for (const checkin of checkins ?? []) {
    if (!latest.has(checkin.unit_id)) {
      const tm = checkin.team_members as { name?: string } | null;
      latest.set(checkin.unit_id, {
        checked_in_at: checkin.checked_in_at,
        visitor: tm?.name ?? null,
      });
    }
  }

  const now = Date.now();
  const summaries = (units ?? []).map((unit: any) => {
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
      location_id: unit.location_id,
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

  return { areas: areas ?? [], units: summaries };
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
  const { data, error } = await scoped(query, organizationId).single();
  if (error) return null;
  let update = supabase.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  update = scoped(update, organizationId);
  await update;
  return data;
}

async function registerDevice(body: { teamMemberId: string; pin: string; deviceToken: string; deviceLabel?: string; organizationId?: string | null }) {
  if (!body.teamMemberId || !/^\d{4}$/.test(body.pin) || !body.deviceToken) {
    return json(400, { error: 'teamMemberId, 4-digit pin, and deviceToken are required.' });
  }
  let organizationId: string | null;
  try {
    organizationId = await resolveOrganizationId(body.organizationId);
  } catch (error) {
    return json(400, { error: errorMessage(error) });
  }
  const memberQuery = supabase
    .from('team_members')
    .select('*')
    .eq('id', body.teamMemberId)
    .eq('active', true);
  const { data: member, error: memberError } = await scoped(memberQuery, organizationId).single();
  if (memberError || !member) return json(404, { error: 'Team member not found.' });
  const nextPinHash = pinHash(body.teamMemberId, body.pin, organizationId);
  const oldPinHash = legacyPinHash(body.teamMemberId, body.pin);
  if (member.pin_hash && member.pin_hash !== nextPinHash && member.pin_hash !== oldPinHash) {
    return json(403, { error: 'PIN does not match.' });
  }
  if (!member.pin_hash || member.pin_hash === oldPinHash) {
    let update = supabase.from('team_members').update({ pin_hash: nextPinHash }).eq('id', body.teamMemberId);
    update = scoped(update, organizationId);
    await update;
  }
  const deviceValues = withOrganization(
    {
        team_member_id: body.teamMemberId,
        device_token_hash: sha256(body.deviceToken),
        device_label: body.deviceLabel ?? null,
        active: true,
        last_seen_at: new Date().toISOString(),
      },
    organizationId,
  );
  const { data: device, error } = await supabase
    .from('devices')
    .upsert(deviceValues, { onConflict: organizationId ? 'organization_id,device_token_hash' : 'device_token_hash' })
    .select('id')
    .single();
  if (error) return json(500, { error: error.message });
  return json(200, {
    organizationId,
    organization: await organizationSummary(organizationId),
    deviceId: device.id,
    sessionToken: await createUserToken(body.teamMemberId, body.deviceToken, organizationId),
    teamMember: { id: member.id, name: member.name },
  });
}

async function route(event: HandlerEvent) {
  if (event.httpMethod === 'OPTIONS') return empty(204);
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Supabase environment variables are missing.' });

  const path = normalizePath(event);
  const method = event.httpMethod;

  if (method === 'POST' && path === '/workspace-requests') {
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
      return json(500, { error: error.message });
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
    if (query.length < 2) return json(400, { error: 'q is required.' });
    try {
      return json(200, { results: await searchInstallations(query) });
    } catch (error) {
      return json(502, { error: errorMessage(error) });
    }
  }

  if (method === 'POST' && path === '/operator/login') {
    const body = readBody<{ passphrase?: string }>(event);
    if (!centralOperatorPassphraseHash) {
      return json(503, { error: 'Central operator access is not configured.' });
    }
    if (sha256(body.passphrase ?? '') !== centralOperatorPassphraseHash) {
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
      return json(500, { error: error.message });
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
    const body = readBody<{ workspaceName?: string; workspaceSlug?: string; expiresInDays?: number; operatorNote?: string }>(event);
    const { data: request, error: requestError } = await supabase
      .from('workspace_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (requestError) return json(500, { error: requestError.message });
    if (!request) return json(404, { error: 'Workspace request not found.' });
    const workspaceRequest = request as WorkspaceRequestRow;
    if (workspaceRequest.status !== 'pending') return json(400, { error: 'Only pending workspace requests can be approved.' });

    const workspaceName = clampText(body.workspaceName, 160) || workspaceRequest.installation_or_command;
    const slugBase = clampText(body.workspaceSlug, 80) || workspaceRequest.preferred_workspace_slug || workspaceName;
    const workspaceSlug = await uniqueWorkspaceSlug(slugBase);
    const expiresInDays = body.expiresInDays == null ? 14 : Number(body.expiresInDays);
    if (expiresInDays < 1 || expiresInDays > 90) return json(400, { error: 'expiresInDays must be between 1 and 90.' });

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .insert({ name: workspaceName, slug: workspaceSlug, active: true })
      .select('id, slug, name, active, created_at, updated_at')
      .single();
    if (organizationError) {
      if (organizationError.code === '23505') return json(409, { error: 'An organization with that slug already exists.' });
      return json(500, { error: organizationError.message });
    }

    await tryRecordOperatorAudit(organization.id, 'workspace_created', { slug: organization.slug, workspaceRequestId: workspaceRequest.id });
    const setup = await issueOrganizationSetupCode({
      organizationId: organization.id,
      organization,
      label: `${workspaceRequest.lead_name} approval setup`,
      expiresInDays,
      purpose: 'pilot_setup',
    });

    const approvedAt = new Date().toISOString();
    const { data: updatedRequest, error: updateError } = await supabase
      .from('workspace_requests')
      .update({
        status: 'approved',
        organization_id: organization.id,
        setup_code_id: setup.setupCode.id,
        approved_at: approvedAt,
        rejected_at: null,
        operator_note: clampText(body.operatorNote, 1000) || null,
      })
      .eq('id', workspaceRequest.id)
      .select('*')
      .single();
    if (updateError) return json(500, { error: updateError.message });
    await tryRecordOperatorAudit(organization.id, 'workspace_request_approved', {
      workspaceRequestId: workspaceRequest.id,
      slug: organization.slug,
      setupCodeId: setup.setupCode.id,
    });

    const requestorNotificationStatus = await notifyRequestorOfApproval({
      request: updatedRequest as WorkspaceRequestRow,
      organization,
      setupCode: setup.code,
    });
    await supabase
      .from('workspace_requests')
      .update({
        requestor_notification_status: requestorNotificationStatus,
        requestor_notified_at: requestorNotificationStatus === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', workspaceRequest.id);

    return json(200, {
      request: updatedRequest,
      organization,
      code: setup.code,
      setupCode: { ...setup.setupCode, code: setup.code },
      requestorNotificationStatus,
    });
  }

  const operatorRequestRejectMatch = path.match(/^\/operator\/workspace-requests\/([^/]+)\/reject$/);
  if (method === 'POST' && operatorRequestRejectMatch) {
    const requestId = operatorRequestRejectMatch[1];
    if (!isUuid(requestId)) return json(400, { error: 'Workspace request ID must be a UUID.' });
    const body = readBody<{ operatorNote?: string }>(event);
    const operatorNote = clampText(body.operatorNote, 1000);
    if (operatorNote.length < 3) return json(400, { error: 'An operator note is required when rejecting a request.' });
    const { data: existing, error: existingError } = await supabase.from('workspace_requests').select('*').eq('id', requestId).maybeSingle();
    if (existingError) return json(500, { error: existingError.message });
    if (!existing) return json(404, { error: 'Workspace request not found.' });
    const workspaceRequest = existing as WorkspaceRequestRow;
    if (workspaceRequest.status !== 'pending') return json(400, { error: 'Only pending workspace requests can be rejected.' });
    const { data: updatedRequest, error: updateError } = await supabase
      .from('workspace_requests')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        operator_note: operatorNote,
      })
      .eq('id', requestId)
      .select('*')
      .single();
    if (updateError) return json(500, { error: updateError.message });
    await tryRecordOperatorAudit(null, 'workspace_request_rejected', { workspaceRequestId: requestId });
    const requestorNotificationStatus = await notifyRequestorOfRejection(updatedRequest as WorkspaceRequestRow);
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
    if (error) return json(500, { error: error.message });
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
      if (orgError) return json(500, { error: orgError.message });
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
      },
    });
  }

  if (method === 'GET' && path === '/operator/organizations') {
    const [{ data: organizations, error: orgError }, { data: setupCodes, error: codeError }] = await Promise.all([
      supabase.from('organizations').select('id, slug, name, active, created_at, updated_at').order('created_at', { ascending: false }),
      supabase
        .from('organization_setup_codes')
        .select('id, organization_id, label, purpose, active, expires_at, used_at, used_by_label, created_at')
        .order('created_at', { ascending: false }),
    ]);
    if (orgError) return json(500, { error: orgError.message });
    if (codeError) return json(500, { error: codeError.message });
    const onboardingByOrg = new Map<string, WorkspaceOnboardingSummary>();
    await Promise.all(
      (organizations ?? []).map(async (organization: any) => {
        onboardingByOrg.set(organization.id, await getWorkspaceOnboardingSummary(organization.id));
      }),
    );
    const codesByOrg = new Map<string, any[]>();
    for (const code of setupCodes ?? []) {
      const values = codesByOrg.get(code.organization_id) ?? [];
      values.push(code);
      codesByOrg.set(code.organization_id, values);
    }
    return json(200, {
      organizations: (organizations ?? []).map((organization: any) => {
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
      return json(500, { error: error.message });
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
    if (orgError) return json(500, { error: orgError.message });
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
    if (organizationError) return json(500, { error: organizationError.message });
    if (!organization) return json(404, { error: 'Organization not found.' });

    const [settings, areas, locations, units, teamMembers, batches, checkins] = await Promise.all([
      scoped(supabase.from('app_settings').select('key, value').order('key'), organizationId),
      scoped(supabase.from('areas').select('id, name, sort_order').order('sort_order'), organizationId),
      scoped(
        supabase
          .from('locations')
          .select('id, area_id, name, latitude, longitude, radius_meters, active, created_at, updated_at')
          .order('name'),
        organizationId,
      ),
      scoped(
        supabase
          .from('units')
          .select('id, location_id, name, unit_type, visit_interval_days, active, created_at, updated_at')
          .order('name'),
        organizationId,
      ),
      scoped(supabase.from('team_members').select('id, name, role, active, created_at').order('name'), organizationId),
      scoped(
        supabase
          .from('checkin_batches')
          .select(
            'id, client_batch_id, location_id, team_member_id, occurred_at, received_at, confidential_care_provided, referral_provided, outcomes_recorded_at, created_at, updated_at, updated_by_team_member_id',
          )
          .order('occurred_at', { ascending: false }),
        organizationId,
      ),
      scoped(
        supabase
          .from('checkins')
          .select(
            'id, unit_id, location_id, team_member_id, checked_in_at, geofence_verified, distance_meters, score_awarded, batch_id, voided_at, voided_by_team_member_id, void_reason, created_at, updated_at, updated_by_team_member_id',
          )
          .order('checked_in_at', { ascending: false }),
        organizationId,
      ),
    ]);
    const error =
      settings.error ?? areas.error ?? locations.error ?? units.error ?? teamMembers.error ?? batches.error ?? checkins.error;
    if (error) return json(500, { error: error.message });
    await tryRecordOperatorAudit(organizationId, 'workspace_safe_export_downloaded', { slug: organization.slug });
    return json(200, {
      generatedAt: new Date().toISOString(),
      format: 'deckplating-safe-operator-export-v1',
      boundary: {
        included:
          'Workspace metadata, non-sensitive setup records, roster display names, visit timestamps, scores, void metadata, and generic care/referral indicators.',
        excluded:
          'Setup-code plaintext, setup-code hashes, passphrase hashes, PIN hashes, device-token hashes, devices, service keys, counseling notes, referral details, medical details, personal details, and sensitive operational details.',
      },
      organization,
      settings: settings.data ?? [],
      areas: areas.data ?? [],
      locations: locations.data ?? [],
      units: units.data ?? [],
      teamMembers: teamMembers.data ?? [],
      checkinBatches: batches.data ?? [],
      checkins: checkins.data ?? [],
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
    if (orgError) return json(500, { error: orgError.message });
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
    const { data, error } = await supabase
      .from('organization_setup_codes')
      .update({ active: false })
      .eq('id', setupCodeId)
      .is('used_at', null)
      .select('id, organization_id, label, purpose, active, expires_at, used_at, used_by_label, created_at')
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: 'Unused setup code not found.' });
    await tryRecordOperatorAudit(data.organization_id, 'setup_code_revoked', { setupCodeId: data.id });
    return json(200, { setupCode: data });
  }

  const operatorOrganizationStatusMatch = path.match(/^\/operator\/organizations\/([^/]+)\/status$/);
  if (method === 'POST' && operatorOrganizationStatusMatch) {
    const organizationId = operatorOrganizationStatusMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const body = readBody<{ active?: boolean }>(event);
    if (typeof body.active !== 'boolean') return json(400, { error: 'active must be true or false.' });
    const { data, error } = await supabase
      .from('organizations')
      .update({ active: body.active })
      .eq('id', organizationId)
      .select('id, slug, name, active, created_at, updated_at')
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: 'Organization not found.' });
    await tryRecordOperatorAudit(organizationId, body.active ? 'workspace_reactivated' : 'workspace_suspended', {
      slug: data.slug,
    });
    return json(200, { organization: data });
  }

  const operatorAdminRecoveryMatch = path.match(/^\/operator\/organizations\/([^/]+)\/admin-passphrase$/);
  if (method === 'POST' && operatorAdminRecoveryMatch) {
    const organizationId = operatorAdminRecoveryMatch[1];
    if (!isUuid(organizationId)) return json(400, { error: 'Organization ID must be a UUID.' });
    const body = readBody<{ passphrase?: string }>(event);
    if (!body.passphrase || body.passphrase.length < 8) {
      return json(400, { error: 'Passphrase must be at least 8 characters.' });
    }
    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('id, slug, name, active, created_at, updated_at')
      .eq('id', organizationId)
      .maybeSingle();
    if (organizationError) return json(500, { error: organizationError.message });
    if (!organization) return json(404, { error: 'Organization not found.' });
    const { error } = await supabase.from('organization_admin_credentials').upsert(
      {
        organization_id: organizationId,
        passphrase_hash: organizationAdminHash(organizationId, body.passphrase),
        active: true,
      },
      { onConflict: 'organization_id' },
    );
    if (error) return json(500, { error: error.message });
    await tryRecordOperatorAudit(organizationId, 'local_admin_recovery_passphrase_set', { slug: organization.slug });
    return json(200, { organization });
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
    if (organizationError) return json(500, { error: organizationError.message });
    if (!organization) return json(404, { error: 'Organization not found.' });
    if (body.confirmSlug?.trim() !== organization.slug) {
      return json(400, { error: 'confirmSlug must match the workspace slug.' });
    }

    const deleteSteps: Array<{ table: string; query: any }> = [
      { table: 'checkins', query: supabase.from('checkins').delete() },
      { table: 'checkin_batches', query: supabase.from('checkin_batches').delete() },
      { table: 'devices', query: supabase.from('devices').delete() },
      { table: 'units', query: supabase.from('units').delete() },
      { table: 'locations', query: supabase.from('locations').delete() },
      { table: 'team_members', query: supabase.from('team_members').delete() },
      { table: 'areas', query: supabase.from('areas').delete() },
      { table: 'app_settings', query: supabase.from('app_settings').delete() },
      { table: 'workspace_requests', query: supabase.from('workspace_requests').delete() },
      { table: 'organization_setup_codes', query: supabase.from('organization_setup_codes').delete() },
      { table: 'organization_admin_credentials', query: supabase.from('organization_admin_credentials').delete() },
    ];

    for (const step of deleteSteps) {
      const { error } = await scoped(step.query.eq('organization_id', organizationId), organizationId);
      if (error) return json(500, { error: `Failed to delete ${step.table}. ${error.message}` });
    }

    const { error } = await supabase.from('organizations').delete().eq('id', organizationId);
    if (error) return json(500, { error: error.message });
    await tryRecordOperatorAudit(null, 'workspace_deleted', { organizationId, slug: organization.slug });
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
      return json(404, { error: errorMessage(error) });
    }
  }

  if (method === 'GET' && path === '/team-members') {
    let organizationId: string | null;
    try {
      organizationId = await resolveOrganizationId(event.queryStringParameters?.organizationId);
    } catch (error) {
      return json(400, { error: errorMessage(error) });
    }
    const query = supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
      .order('name');
    const { data: teamMembers, error } = await scoped(query, organizationId);
    if (error) return json(500, { error: error.message });
    return json(200, {
      organizationId,
      organization: await organizationSummary(organizationId),
      teamMembers: (teamMembers ?? []).map((member: any) => ({ ...member, role: null })),
    });
  }

  if (method === 'GET' && path === '/bootstrap') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const teamMemberQuery = scoped(
      supabase.from('team_members').select('id, name, role').eq('active', true),
      user.organizationId,
    ).order('name');
    const [{ data: teamMembers, error }, coverage, gamificationTone] = await Promise.all([
      teamMemberQuery,
      getCoverage(user.organizationId),
      getGamificationTone(user.organizationId),
    ]);
    if (error) return json(500, { error: error.message });
    const mapSettings = await getWorkspaceMapSettings(user.organizationId);
    return json(200, {
      organizationId: user.organizationId,
      organization: await organizationSummary(user.organizationId),
      areas: coverage.areas,
      teamMembers: teamMembers ?? [],
      units: coverage.units,
      mapTileUrl: (process.env.MAP_TILE_URL ?? '').replace('{key}', process.env.MAP_TILE_KEY ?? ''),
      ...mapSettings,
      gamificationTone,
    });
  }

  if (method === 'POST' && path === '/device/register') {
    const body = readBody<{ teamMemberId: string; pin: string; deviceToken: string; deviceLabel?: string; organizationId?: string | null }>(event);
    return registerDevice(body);
  }

  if (method === 'POST' && path === '/device/change-identity') {
    const body = readBody<{ currentTeamMemberId: string; pin: string; newTeamMemberId: string; newPin: string; deviceToken: string }>(event);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.currentTeamMemberId) return json(403, { error: 'Authentication required.' });
    const currentQuery = supabase.from('team_members').select('*').eq('id', body.currentTeamMemberId);
    const { data: current } = await scoped(currentQuery, user.organizationId).single();
    if (
      !current?.pin_hash ||
      (current.pin_hash !== pinHash(body.currentTeamMemberId, body.pin, user.organizationId) &&
        current.pin_hash !== legacyPinHash(body.currentTeamMemberId, body.pin))
    ) {
      return json(403, { error: 'Current PIN does not match.' });
    }
    let update = supabase.from('devices').update({ active: false }).eq('device_token_hash', sha256(body.deviceToken));
    update = scoped(update, user.organizationId);
    await update;
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
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(400, { error: 'lat and lon are required.' });
    const locations = await getLocationSummaries(user.organizationId);
    const matches = locations
      .map((location) => ({ ...location, distance_meters: distanceMeters(lat, lon, location.latitude, location.longitude) }))
      .filter((location) => location.distance_meters <= location.radius_meters)
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
      manual?: boolean;
      confidentialCareProvided?: IndicatorValue;
      referralProvided?: IndicatorValue;
    }>(event);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.teamMemberId) return json(403, { error: 'Authentication required.' });
    const device = await verifyDevice(body.teamMemberId, body.deviceToken, user.organizationId);
    if (!device) return json(403, { error: 'Device is not registered for this team member.' });
    if (!Array.isArray(body.unitIds) || body.unitIds.length === 0) return json(400, { error: 'unitIds are required.' });
    const clientBatchId = body.clientBatchId ?? crypto.randomUUID();
    if (!isUuid(clientBatchId)) return json(400, { error: 'clientBatchId must be a UUID.' });

    let occurredAt: string;
    let confidentialCareProvided: IndicatorValue;
    let referralProvided: IndicatorValue;
    try {
      occurredAt = parseOccurredAt(body.occurredAt);
      confidentialCareProvided = normalizeIndicator(body.confidentialCareProvided);
      referralProvided = normalizeIndicator(body.referralProvided);
    } catch (error) {
      return json(400, { error: errorMessage(error) });
    }

    const requestedUnitIds = Array.from(new Set(body.unitIds));
    const unitsQuery = supabase
      .from('units')
      .select('*, locations(*)')
      .in('id', requestedUnitIds)
      .eq('active', true);
    const { data: units, error: unitError } = await scoped(unitsQuery, user.organizationId);
    if (unitError) return json(500, { error: unitError.message });
    if ((units ?? []).length !== requestedUnitIds.length) return json(404, { error: 'One or more units were not found.' });

    const unitLocationIds = Array.from(new Set((units ?? []).map((unit: any) => unit.location_id ?? null)));
    if (unitLocationIds.length > 1) return json(400, { error: 'A visit batch can only include units from one location.' });
    const batchLocationId = unitLocationIds[0] ?? null;
    if (body.locationId !== undefined && (body.locationId ?? null) !== batchLocationId) {
      return json(400, { error: 'locationId must match the selected units.' });
    }
    if (batchLocationId === null && requestedUnitIds.length > 1) {
      return json(400, { error: 'Unmapped manual check-ins must be submitted one unit at a time.' });
    }

    const batchLookupQuery = supabase
      .from('checkin_batches')
      .select('*')
      .eq('client_batch_id', clientBatchId);
    let { data: batch, error: batchLookupError } = await scoped(batchLookupQuery, user.organizationId).maybeSingle();
    if (batchLookupError) return json(500, { error: batchLookupError.message });
    if (!batch) {
      const { data: insertedBatch, error: batchError } = await supabase
        .from('checkin_batches')
        .insert(withOrganization({
          client_batch_id: clientBatchId,
          location_id: batchLocationId,
          team_member_id: body.teamMemberId,
          device_id: device.id,
          occurred_at: occurredAt,
          confidential_care_provided: confidentialCareProvided,
          referral_provided: referralProvided,
          outcomes_recorded_at: confidentialCareProvided || referralProvided ? new Date().toISOString() : null,
          updated_by_team_member_id: body.teamMemberId,
        }, user.organizationId))
        .select('*')
        .single();
      if (batchError) {
        const retryQuery = supabase.from('checkin_batches').select('*').eq('client_batch_id', clientBatchId);
        const retry = await scoped(retryQuery, user.organizationId).single();
        if (retry.error || !retry.data) return json(500, { error: batchError.message });
        batch = retry.data;
      } else {
        batch = insertedBatch;
      }
    } else {
      if (batch.team_member_id !== body.teamMemberId || batch.device_id !== device.id) {
        return json(403, { error: 'This client batch belongs to another user or device.' });
      }
      const batchUpdateQuery = supabase
        .from('checkin_batches')
        .update({
          confidential_care_provided: confidentialCareProvided,
          referral_provided: referralProvided,
          outcomes_recorded_at: confidentialCareProvided || referralProvided ? new Date().toISOString() : null,
          updated_by_team_member_id: body.teamMemberId,
        })
        .eq('id', batch.id);
      const { data: updatedBatch, error: indicatorUpdateError } = await scoped(batchUpdateQuery, user.organizationId)
        .select('*')
        .single();
      if (indicatorUpdateError) return json(500, { error: indicatorUpdateError.message });
      batch = updatedBatch;
    }
    if (batch.team_member_id !== body.teamMemberId || batch.device_id !== device.id) {
      return json(403, { error: 'This client batch belongs to another user or device.' });
    }

    const existingQuery = supabase
      .from('checkins')
      .select('id, unit_id, score_awarded')
      .eq('batch_id', batch.id);
    const { data: existingRows, error: existingError } = await scoped(existingQuery, user.organizationId);
    if (existingError) return json(500, { error: existingError.message });

    const existingUnitIds = new Set((existingRows ?? []).map((row: any) => row.unit_id));
    const rowsToInsert = [];
    for (const unit of units ?? []) {
      if (existingUnitIds.has(unit.id)) continue;
      const location = unit.locations;
      let distance: number | null = null;
      let geofenceVerified = false;
      if (!body.manual && location && Number.isFinite(body.latitude) && Number.isFinite(body.longitude)) {
        distance = Math.round(distanceMeters(Number(body.latitude), Number(body.longitude), location.latitude, location.longitude));
        geofenceVerified = distance <= location.radius_meters;
      }

      const cooldownStart = new Date(new Date(occurredAt).getTime() - 14 * 86400000).toISOString();
      const recentQuery = supabase
        .from('checkins')
        .select('id')
        .eq('unit_id', unit.id)
        .is('voided_at', null)
        .lt('checked_in_at', occurredAt)
        .gte('checked_in_at', cooldownStart);
      const { data: recent } = await scoped(recentQuery, user.organizationId).limit(1);

      const priorQuery = supabase
        .from('checkins')
        .select('checked_in_at')
        .eq('unit_id', unit.id)
        .is('voided_at', null)
        .lt('checked_in_at', occurredAt)
        .order('checked_in_at', { ascending: false });
      const { data: prior } = await scoped(priorQuery, user.organizationId).limit(1).maybeSingle();

      let score = 0;
      if (!recent?.length) {
        const status = statusBefore(prior?.checked_in_at ?? null, occurredAt, unit.visit_interval_days);
        score = 1;
        if (status === 'yellow') score += 1;
        if (status === 'red' || status === 'gray') score += 2;
      }

      rowsToInsert.push(withOrganization({
        batch_id: batch.id,
        unit_id: unit.id,
        location_id: unit.location_id,
        team_member_id: body.teamMemberId,
        device_id: device.id,
        checked_in_at: occurredAt,
        geofence_verified: geofenceVerified,
        distance_meters: distance,
        score_awarded: score,
      }, user.organizationId));
    }

    let insertedRows: Array<{ id: string; unit_id: string; score_awarded: number }> = [];
    if (rowsToInsert.length) {
      const { data: inserted, error: insertError } = await supabase
        .from('checkins')
        .insert(rowsToInsert)
        .select('id, unit_id, score_awarded');
      if (insertError) return json(500, { error: insertError.message });
      insertedRows = inserted ?? [];
    }

    const allRows = [...(existingRows ?? []), ...insertedRows].filter((row) => requestedUnitIds.includes(row.unit_id));
    return json(200, {
      batchId: batch.id,
      clientBatchId,
      locationId: batchLocationId,
      checkins: allRows.map((row) => ({ id: row.id, score_awarded: row.score_awarded })),
      totalScore: allRows.reduce((sum, row) => sum + row.score_awarded, 0),
      indicators: {
        confidentialCareProvided: batch.confidential_care_provided,
        referralProvided: batch.referral_provided,
      },
    });
  }

  if (method === 'POST' && path === '/checkins/undo') {
    const body = readBody<{ teamMemberId: string; checkinIds: string[] }>(event);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.teamMemberId) return json(403, { error: 'Authentication required.' });
    if (!Array.isArray(body.checkinIds) || body.checkinIds.length === 0) {
      return json(400, { error: 'checkinIds are required.' });
    }

    const ownedQuery = supabase
      .from('checkins')
      .select('id, created_at')
      .in('id', body.checkinIds)
      .eq('team_member_id', user.teamMemberId)
      .is('voided_at', null);
    const { data: owned, error: ownedError } = await scoped(ownedQuery, user.organizationId);
    if (ownedError) return json(500, { error: ownedError.message });
    if ((owned ?? []).length !== body.checkinIds.length) {
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
      .in('id', body.checkinIds)
      .eq('team_member_id', user.teamMemberId)
      .is('voided_at', null);
    const { error } = await scoped(undoQuery, user.organizationId);
    if (error) return json(500, { error: error.message });
    return json(200, { undone: body.checkinIds.length, coverage: await getCoverage(user.organizationId) });
  }

  const indicatorMatch = path.match(/^\/checkin-batches\/([^/]+)\/indicators$/);
  if (method === 'PATCH' && indicatorMatch) {
    const body = readBody<Record<string, unknown>>(event);
    const allowed = new Set(['confidentialCareProvided', 'referralProvided']);
    const extra = Object.keys(body).filter((key) => !allowed.has(key));
    if (extra.length) return json(400, { error: 'Only the two indicator fields are accepted.' });
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });

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
    if (error) return json(500, { error: error.message });
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
    const { data, error } = await scoped(detailQuery, user.organizationId).order('checked_in_at', { ascending: false }).limit(100);
    if (error) return json(500, { error: error.message });
    return json(200, {
      unit,
      checkins: (data ?? []).map((checkin: any) => ({
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
    });
  }

  if (method === 'GET' && path === '/reports/indicators') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const params = event.queryStringParameters ?? {};
    let query = scoped(
      supabase
      .from('checkins')
      .select(
        'id, batch_id, checked_in_at, location_id, checkin_batches!checkins_batch_id_fkey(id, location_id, occurred_at, confidential_care_provided, referral_provided), units(id, location_id, locations(id, name, area_id, areas(id, name))), locations(id, name, area_id, areas(id, name))',
      )
      .not('batch_id', 'is', null)
      .is('voided_at', null)
      .order('checked_in_at', { ascending: false })
      .limit(2000),
      user.organizationId,
    );
    if (params.from) query = query.gte('checked_in_at', `${params.from}T00:00:00.000Z`);
    if (params.to) query = query.lte('checked_in_at', `${params.to}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) return json(500, { error: error.message });

    const batches = new Map<string, any[]>();
    for (const row of data ?? []) {
      if (!row.batch_id) continue;
      const rows = batches.get(row.batch_id) ?? [];
      rows.push(row);
      batches.set(row.batch_id, rows);
    }

    const reports = new Map<string, any>();
    for (const [batchId, rows] of batches) {
      const first: any = rows[0];
      const batch = first.checkin_batches;
      const directLocation = first.locations;
      const unitLocation = first.units?.locations;
      const location = directLocation ?? unitLocation ?? null;
      const area = location?.areas ?? null;
      const key = `${area?.id ?? 'none'}:${location?.id ?? batch?.location_id ?? 'unmapped'}`;
      const row = reports.get(key) ?? {
        key,
        area_id: area?.id ?? null,
        area_name: area?.name ?? 'Unassigned',
        location_id: location?.id ?? batch?.location_id ?? null,
        location_name: location?.name ?? 'Unmapped',
        visits: 0,
        confidential_care_count: 0,
        referral_count: 0,
        single_unit_indicator_visits: 0,
        multi_unit_indicator_visits: 0,
      };
      row.visits += 1;
      if (batch?.confidential_care_provided === true) row.confidential_care_count += 1;
      if (batch?.referral_provided === true) row.referral_count += 1;
      if (batch?.confidential_care_provided === true || batch?.referral_provided === true) {
        if (rows.length === 1) row.single_unit_indicator_visits += 1;
        else row.multi_unit_indicator_visits += 1;
      }
      reports.set(key, row);
    }

    return json(200, {
      rows: Array.from(reports.values()).sort(
        (a, b) => b.confidential_care_count + b.referral_count - (a.confidential_care_count + a.referral_count),
      ),
    });
  }

  if (method === 'GET' && path === '/leaderboard') {
    const user = await requireUser(event);
    if (!user) return json(403, { error: 'Authentication required.' });
    const month = event.queryStringParameters?.month ?? new Date().toISOString().slice(0, 7);
    const start = `${month}-01T00:00:00.000Z`;
    const endDate = new Date(start);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    const end = endDate.toISOString();
    const now = new Date();
    const [monthlyResult, allBeforeEndResult, coverage] = await Promise.all([
      scoped(
        supabase
        .from('checkins')
        .select('unit_id, checked_in_at, score_awarded, team_members!checkins_team_member_id_fkey(id, name), units(id, location_id, locations(id, area_id))')
        .is('voided_at', null)
        .gte('checked_in_at', start)
        .lt('checked_in_at', end),
        user.organizationId,
      ),
      scoped(
        supabase
        .from('checkins')
        .select('unit_id, checked_in_at')
        .is('voided_at', null)
        .lt('checked_in_at', end)
        .order('checked_in_at', { ascending: true }),
        user.organizationId,
      ),
      getCoverage(user.organizationId),
    ]);
    const error = monthlyResult.error ?? allBeforeEndResult.error;
    if (error) return json(500, { error: error.message });
    const monthlyCheckins = monthlyResult.data ?? [];

    const firstVisitByUnit = new Map<string, string>();
    for (const checkin of allBeforeEndResult.data ?? []) {
      if (!firstVisitByUnit.has(checkin.unit_id)) firstVisitByUnit.set(checkin.unit_id, checkin.checked_in_at);
    }

    const sweptAreaIds = new Set(
      (coverage.areas ?? [])
        .filter((area: any) =>
          coverage.units
            .filter((unit: any) => unit.area_id === area.id)
            .every((unit: any) => unit.status !== 'red' && unit.status !== 'gray'),
        )
        .map((area: any) => area.id),
    );

    const buildLeaderboardRows = (checkins: any[]) => {
      const rows = new Map<string, any>();
      for (const checkin of checkins) {
        const member = checkin.team_members as any;
        if (!member) continue;
        const row = rows.get(member.id) ?? {
          team_member_id: member.id,
          name: member.name,
          qualifying_checkins: 0,
          distinct_units: new Set<string>(),
          recovered_units: 0,
          gray_to_green_units: new Set<string>(),
          coverage_sweep_areas: new Set<string>(),
          active_days: new Set<string>(),
          score: 0,
        };
        if (checkin.score_awarded > 0) row.qualifying_checkins += 1;
        if (checkin.score_awarded >= 3) row.recovered_units += 1;
        if (checkin.score_awarded > 0 && firstVisitByUnit.get(checkin.unit_id) === checkin.checked_in_at) {
          row.gray_to_green_units.add(checkin.unit_id);
        }
        const areaId = (checkin.units as any)?.locations?.area_id ?? null;
        if (checkin.score_awarded > 0 && areaId && sweptAreaIds.has(areaId)) {
          row.coverage_sweep_areas.add(areaId);
        }
        row.distinct_units.add(checkin.unit_id);
        row.active_days.add(String(checkin.checked_in_at).slice(0, 10));
        row.score += checkin.score_awarded;
        rows.set(member.id, row);
      }
      return Array.from(rows.values())
        .map((row) => {
          const distinctUnits = row.distinct_units.size;
          const activeDays = row.active_days.size;
          const grayToGreenUnits = row.gray_to_green_units.size;
          const coverageSweepAreas = row.coverage_sweep_areas.size;
          const badges = [];
          if (row.qualifying_checkins > 0) badges.push('first_rounds');
          if (row.recovered_units > 0) badges.push('recovery_team');
          if (grayToGreenUnits > 0) badges.push('gray_to_green');
          if (distinctUnits >= 5) badges.push('wide_coverage');
          if (activeDays >= 4) badges.push('sustained_presence');
          if (coverageSweepAreas > 0) badges.push('coverage_sweep');
          return {
            ...row,
            distinct_units: distinctUnits,
            active_days: activeDays,
            gray_to_green_units: grayToGreenUnits,
            coverage_sweep_areas: coverageSweepAreas,
            badges,
          };
        })
        .sort((a, b) => b.score - a.score || b.recovered_units - a.recovered_units || b.distinct_units - a.distinct_units || a.name.localeCompare(b.name));
    };

    const recoveredUnitsThisMonth = new Set<string>();
    const distinctUnitsCovered = new Set<string>();
    for (const checkin of monthlyCheckins) {
      if (checkin.score_awarded >= 3) recoveredUnitsThisMonth.add(checkin.unit_id);
      distinctUnitsCovered.add(checkin.unit_id);
    }

    const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const labelPeriod = (periodStart: Date, periodEndExclusive: Date) => {
      const endInclusive = new Date(periodEndExclusive.getTime() - 1);
      return `${dateFormatter.format(periodStart)}-${dateFormatter.format(endInclusive)}`;
    };
    const periodWinner = (type: 'week' | 'month', periodStart: Date, periodEndExclusive: Date) => {
      const rows = buildLeaderboardRows(
        monthlyCheckins.filter((checkin: any) => {
          const checkedInAt = new Date(checkin.checked_in_at);
          return checkedInAt >= periodStart && checkedInAt < periodEndExclusive;
        }),
      );
      return {
        type,
        label: type === 'month' ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(periodStart) : labelPeriod(periodStart, periodEndExclusive),
        start: periodStart.toISOString(),
        end: periodEndExclusive.toISOString(),
        final: periodEndExclusive <= now,
        winner: rows[0] ?? null,
      };
    };

    const monthStart = new Date(start);
    const monthEnd = new Date(end);
    const weeklyWinners = [];
    let periodStart = new Date(monthStart);
    while (periodStart < monthEnd) {
      const day = periodStart.getUTCDay();
      const daysThroughSunday = day === 0 ? 1 : 8 - day;
      const periodEnd = new Date(periodStart);
      periodEnd.setUTCDate(periodEnd.getUTCDate() + daysThroughSunday);
      if (periodEnd > monthEnd) periodEnd.setTime(monthEnd.getTime());
      if (periodStart <= now) weeklyWinners.push(periodWinner('week', periodStart, periodEnd));
      periodStart = new Date(periodEnd);
    }

    const rows = buildLeaderboardRows(monthlyCheckins);
    return json(200, {
      month,
      rows,
      winners: {
        weeks: weeklyWinners,
        month: periodWinner('month', monthStart, monthEnd),
      },
      summary: {
        units_recovered_this_month: recoveredUnitsThisMonth.size,
        distinct_units_covered: distinctUnitsCovered.size,
        overdue_remaining: coverage.units.filter((unit: any) => unit.status === 'red').length,
        never_visited_remaining: coverage.units.filter((unit: any) => unit.status === 'gray').length,
      },
    });
  }

  if (method === 'POST' && path === '/workspaces/activate') {
    const body = readBody<{
      setupCode?: string;
      adminPassphrase?: string;
      organizationName?: string;
      leadLabel?: string;
      installationName?: string;
      installationLatitude?: number;
      installationLongitude?: number;
    }>(event);
    if (!body.setupCode || !body.adminPassphrase || body.adminPassphrase.length < 8) {
      return json(400, { error: 'setupCode and an adminPassphrase of at least 8 characters are required.' });
    }
    const setupCode = await verifySetupCode(body.setupCode);
    if (!setupCode) return json(403, { error: 'Setup code is invalid, expired, or already used.' });
    const organizationId = setupCode.organization_id;
    if (body.organizationName?.trim()) {
      await supabase.from('organizations').update({ name: body.organizationName.trim() }).eq('id', organizationId);
    }
    const installationName = body.installationName?.trim() || body.organizationName?.trim();
    const installationLatitude = Number(body.installationLatitude);
    const installationLongitude = Number(body.installationLongitude);
    let resolvedInstallationName = installationName ?? null;
    let resolvedLatitude = Number.isFinite(installationLatitude) ? installationLatitude : null;
    let resolvedLongitude = Number.isFinite(installationLongitude) ? installationLongitude : null;
    if (resolvedInstallationName && (resolvedLatitude == null || resolvedLongitude == null)) {
      const matches = await searchInstallations(resolvedInstallationName);
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
    if (resolvedInstallationName && resolvedLatitude != null && resolvedLongitude != null) {
      await Promise.all([
        supabase.from('app_settings').upsert(
          withOrganization({ key: 'installation_name', value: resolvedInstallationName }, organizationId),
          { onConflict: 'organization_id,key' },
        ),
        supabase.from('app_settings').upsert(
          withOrganization({ key: 'map_default_latitude', value: String(resolvedLatitude) }, organizationId),
          { onConflict: 'organization_id,key' },
        ),
        supabase.from('app_settings').upsert(
          withOrganization({ key: 'map_default_longitude', value: String(resolvedLongitude) }, organizationId),
          { onConflict: 'organization_id,key' },
        ),
      ]);
    }
    const { error } = await supabase.from('organization_admin_credentials').upsert(
      {
        organization_id: organizationId,
        passphrase_hash: organizationAdminHash(organizationId, body.adminPassphrase),
        active: true,
      },
      { onConflict: 'organization_id' },
    );
    if (error) return json(500, { error: error.message });
    await markSetupCodeUsed(setupCode.id, organizationId, body.leadLabel?.trim() || null);
    return json(200, {
      organizationId,
      organization: await organizationSummary(organizationId),
      token: await createAdminToken({ organizationId, authMethod: 'organization' }),
    });
  }

  if (method === 'POST' && path === '/admin/login') {
    const body = readBody<{ passphrase: string; organizationId?: string | null }>(event);
    let organizationId: string | null;
    try {
      organizationId = await resolveOrganizationId(body.organizationId);
    } catch (error) {
      return json(400, { error: errorMessage(error) });
    }
    const adminContext =
      (await tryOrganizationAdminLogin(organizationId, body.passphrase ?? '')) ??
      tryEnvironmentAdminLogin(body.passphrase ?? '', organizationId);
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
    const body = readBody<{ passphrase?: string }>(event);
    if (!organizationId || !(await organizationAdminSchemaEnabled())) {
      return json(400, { error: 'Organization admin credentials are not available for this database yet.' });
    }
    if (!body.passphrase || body.passphrase.length < 8) {
      return json(400, { error: 'Passphrase must be at least 8 characters.' });
    }
    const { error } = await supabase.from('organization_admin_credentials').upsert(
      {
        organization_id: organizationId,
        passphrase_hash: organizationAdminHash(organizationId, body.passphrase),
        active: true,
      },
      { onConflict: 'organization_id' },
    );
    if (error) return json(500, { error: error.message });
    return json(200, { organizationId, authMethod: 'organization' });
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
    if (error) return json(500, { error: error.message });
    return json(200, { gamificationTone: body.gamificationTone });
  }

  if (method === 'GET' && path === '/admin/locations') {
    const organizationId = adminContext!.organizationId;
    const [areas, locations, units, members] = await Promise.all([
      scoped(supabase.from('areas').select('*'), organizationId).order('sort_order'),
      scoped(supabase.from('locations').select('*, areas(*)'), organizationId).order('name'),
      scoped(supabase.from('units').select('*'), organizationId).order('name'),
      scoped(supabase.from('team_members').select('id, name, role, active, created_at'), organizationId).order('name'),
    ]);
    const error = areas.error ?? locations.error ?? units.error ?? members.error;
    if (error) return json(500, { error: error.message });
    return json(200, { areas: areas.data, locations: locations.data, units: units.data, teamMembers: members.data });
  }

  if (method === 'POST' && path === '/admin/areas') {
    const organizationId = adminContext!.organizationId;
    const body = readBody<{ name?: string; sort_order?: number }>(event);
    const name = body.name?.trim();
    if (!name || name.length < 2) return json(400, { error: 'Area name is required.' });
    const sortOrder = Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0;
    const { data, error } = await supabase
      .from('areas')
      .insert(withOrganization({ name, sort_order: sortOrder }, organizationId))
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') return json(409, { error: 'An area with that name already exists in this workspace.' });
      return json(500, { error: error.message });
    }
    return json(200, { area: data });
  }

  const areaMatch = path.match(/^\/admin\/areas\/([^/]+)$/);
  if (method === 'PATCH' && areaMatch) {
    const organizationId = adminContext!.organizationId;
    const body = readBody<{ name?: string; sort_order?: number }>(event);
    const values: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name || name.length < 2) return json(400, { error: 'Area name is required.' });
      values.name = name;
    }
    if (body.sort_order !== undefined) values.sort_order = Number(body.sort_order);
    const areaUpdate = supabase.from('areas').update(values).eq('id', areaMatch[1]);
    const { data, error } = await scoped(areaUpdate, organizationId).select('*').maybeSingle();
    if (error) {
      if (error.code === '23505') return json(409, { error: 'An area with that name already exists in this workspace.' });
      return json(500, { error: error.message });
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

    if (params.from) query = query.gte('checked_in_at', `${params.from}T00:00:00.000Z`);
    if (params.to) query = query.lte('checked_in_at', `${params.to}T23:59:59.999Z`);
    if (params.teamMemberId) query = query.eq('team_member_id', params.teamMemberId);
    if (params.unitId) query = query.eq('unit_id', params.unitId);
    if (params.includeVoided !== 'true') query = query.is('voided_at', null);
    query = needsMappedFiltering ? query.limit(scanLimit) : query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) return json(500, { error: error.message });

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
          checkin.confidential_care_provided ? 'care counseling confidential' : '',
          checkin.referral_provided ? 'referral' : '',
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
    if (!body.adminTeamMemberId) return json(400, { error: 'adminTeamMemberId is required.' });
    try {
      await validateTeamMemberReferences([body.adminTeamMemberId, body.team_member_id].filter(Boolean), organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      return json(500, { error: errorMessage(error) });
    }

    const existingQuery = supabase
      .from('checkins')
      .select('id, unit_id, voided_at, batch_id')
      .eq('id', adminCheckinMatch[1]);
    const { data: existing, error: existingError } = await scoped(existingQuery, organizationId).single();
    if (existingError || !existing) return json(404, { error: 'Check-in not found.' });

    const update: Record<string, unknown> = { updated_by_team_member_id: body.adminTeamMemberId };
    const indicatorFieldsProvided =
      Object.prototype.hasOwnProperty.call(body, 'confidentialCareProvided') ||
      Object.prototype.hasOwnProperty.call(body, 'referralProvided');
    let indicatorUpdate: Record<string, unknown> | null = null;
    if (indicatorFieldsProvided) {
      if (
        !Object.prototype.hasOwnProperty.call(body, 'confidentialCareProvided') ||
        !Object.prototype.hasOwnProperty.call(body, 'referralProvided')
      ) {
        return json(400, { error: 'Both indicator fields are required when editing visit indicators.' });
      }
      if (!existing.batch_id) {
        return json(400, { error: 'This check-in does not have an editable visit batch.' });
      }
      let confidentialCareProvided: IndicatorValue;
      let referralProvided: IndicatorValue;
      try {
        confidentialCareProvided = normalizeIndicator(body.confidentialCareProvided);
        referralProvided = normalizeIndicator(body.referralProvided);
      } catch (error) {
        return json(400, { error: errorMessage(error) });
      }
      indicatorUpdate = {
        confidential_care_provided: confidentialCareProvided,
        referral_provided: referralProvided,
        outcomes_recorded_at: confidentialCareProvided || referralProvided ? new Date().toISOString() : null,
        updated_by_team_member_id: body.adminTeamMemberId,
      };
    }

    if (body.unit_id && body.unit_id !== existing.unit_id) {
      const unitQuery = supabase
        .from('units')
        .select('id, location_id')
        .eq('id', body.unit_id);
      const { data: unit, error: unitError } = await scoped(unitQuery, organizationId).single();
      if (unitError || !unit) return json(404, { error: 'Replacement unit not found.' });
      update.unit_id = body.unit_id;
      update.location_id = unit.location_id;
      update.geofence_verified = false;
      update.score_awarded = 0;
    }

    if (body.checked_in_at) {
      update.checked_in_at = body.checked_in_at;
      update.score_awarded = 0;
    }
    if (body.team_member_id) {
      update.team_member_id = body.team_member_id;
      update.score_awarded = 0;
    }

    if (body.voided === true) {
      if (!body.void_reason || !fixedVoidReasons.has(body.void_reason)) {
        return json(400, { error: 'A fixed void_reason is required.' });
      }
      update.voided_at = existing.voided_at ?? new Date().toISOString();
      update.voided_by_team_member_id = body.adminTeamMemberId;
      update.void_reason = body.void_reason;
      update.score_awarded = 0;
    } else if (body.voided === false) {
      update.voided_at = null;
      update.voided_by_team_member_id = null;
      update.void_reason = null;
    }

    const checkinUpdateQuery = supabase
      .from('checkins')
      .update(update)
      .eq('id', adminCheckinMatch[1]);
    const { data, error } = await scoped(checkinUpdateQuery, organizationId).select('id').maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: 'Check-in not found.' });
    if (indicatorUpdate) {
      const batchUpdate = supabase
        .from('checkin_batches')
        .update(indicatorUpdate)
        .eq('id', existing.batch_id);
      const { error: batchUpdateError } = await scoped(batchUpdate, organizationId);
      if (batchUpdateError) return json(500, { error: batchUpdateError.message });
    }
    return json(200, { checkin: data, coverage: await getCoverage(organizationId) });
  }

  if (method === 'POST' && path === '/admin/locations') {
    const organizationId = adminContext!.organizationId;
    const body = readBody<any>(event);
    const { unitIds = [], ...locationValues } = body;
    delete locationValues.organization_id;
    if (!Array.isArray(unitIds)) return json(400, { error: 'unitIds must be an array.' });
    try {
      await validateLocationReferences(locationValues, organizationId);
      if (unitIds.length) await validateUnitAssignment(unitIds, organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      return json(500, { error: errorMessage(error) });
    }
    const { data, error } = await supabase
      .from('locations')
      .insert(withOrganization(locationValues, organizationId))
      .select('*')
      .single();
    if (error) return json(500, { error: error.message });
    if (unitIds.length) {
      const update = supabase.from('units').update({ location_id: data.id }).in('id', unitIds);
      await scoped(update, organizationId);
    }
    return json(200, { location: data });
  }

  const locationMatch = path.match(/^\/admin\/locations\/([^/]+)$/);
  if (method === 'PATCH' && locationMatch) {
    const organizationId = adminContext!.organizationId;
    const body = readBody<any>(event);
    const { unitIds, ...locationValues } = body;
    delete locationValues.organization_id;
    if (unitIds !== undefined && !Array.isArray(unitIds)) return json(400, { error: 'unitIds must be an array.' });
    try {
      await validateLocationReferences(locationValues, organizationId);
      if (Array.isArray(unitIds)) await validateUnitAssignment(unitIds, organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      return json(500, { error: errorMessage(error) });
    }
    const locationUpdate = supabase.from('locations').update(locationValues).eq('id', locationMatch[1]);
    const { data, error } = await scoped(locationUpdate, organizationId).select('*').maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: 'Location not found.' });
    if (Array.isArray(unitIds)) {
      const unitUpdate = supabase.from('units').update({ location_id: data.id }).in('id', unitIds);
      await scoped(unitUpdate, organizationId);
    }
    return json(200, { location: data });
  }

  if (method === 'POST' && path === '/admin/units') {
    const organizationId = adminContext!.organizationId;
    const body = readBody<any>(event);
    delete body.organization_id;
    try {
      await validateUnitReferences(body, organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      return json(500, { error: errorMessage(error) });
    }
    const { data, error } = await supabase.from('units').insert(withOrganization(body, organizationId)).select('*').single();
    if (error) return json(500, { error: error.message });
    return json(200, { unit: data });
  }

  const unitMatch = path.match(/^\/admin\/units\/([^/]+)$/);
  if (method === 'PATCH' && unitMatch) {
    const organizationId = adminContext!.organizationId;
    const body = readBody<any>(event);
    delete body.organization_id;
    try {
      await validateUnitReferences(body, organizationId);
    } catch (error) {
      if (error instanceof RequestValidationError) return json(error.statusCode, { error: error.message });
      return json(500, { error: errorMessage(error) });
    }
    const unitUpdate = supabase.from('units').update(body).eq('id', unitMatch[1]);
    const { data, error } = await scoped(unitUpdate, organizationId).select('*').maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: 'Unit not found.' });
    return json(200, { unit: data });
  }

  if (method === 'POST' && path === '/admin/team-members') {
    const organizationId = adminContext!.organizationId;
    const body = readBody<any>(event);
    delete body.organization_id;
    const { data, error } = await supabase
      .from('team_members')
      .insert(withOrganization(body, organizationId))
      .select('id, name, role, active')
      .single();
    if (error) return json(500, { error: error.message });
    return json(200, { teamMember: data });
  }

  const memberMatch = path.match(/^\/admin\/team-members\/([^/]+)$/);
  if (method === 'PATCH' && memberMatch) {
    const organizationId = adminContext!.organizationId;
    const body = readBody<any>(event);
    delete body.organization_id;
    const memberUpdate = supabase.from('team_members').update(body).eq('id', memberMatch[1]);
    const { data, error } = await scoped(memberUpdate, organizationId).select('id, name, role, active').maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: 'Team member not found.' });
    return json(200, { teamMember: data });
  }

  const memberResetPinMatch = path.match(/^\/admin\/team-members\/([^/]+)\/reset-pin$/);
  if (method === 'POST' && memberResetPinMatch) {
    const organizationId = adminContext!.organizationId;
    const memberId = memberResetPinMatch[1];
    if (!isUuid(memberId)) return json(400, { error: 'Team member ID must be a UUID.' });
    const memberQuery = supabase.from('team_members').select('id, name').eq('id', memberId);
    const { data: member, error: memberError } = await scoped(memberQuery, organizationId).maybeSingle();
    if (memberError) return json(500, { error: memberError.message });
    if (!member) return json(404, { error: 'Team member not found.' });
    const memberUpdate = supabase.from('team_members').update({ pin_hash: null }).eq('id', memberId);
    const deviceUpdate = supabase.from('devices').update({ active: false }).eq('team_member_id', memberId);
    const [{ error: resetError }, { error: deviceError }] = await Promise.all([
      scoped(memberUpdate, organizationId),
      scoped(deviceUpdate, organizationId),
    ]);
    if (resetError || deviceError) {
      return json(500, { error: resetError?.message ?? deviceError?.message ?? 'Unable to reset member PIN.' });
    }
    return json(200, { teamMember: { id: member.id, name: member.name } });
  }

  return json(404, { error: 'Route not found.' });
}

export const handler: Handler = async (event) => {
  try {
    return await route(event);
  } catch (error) {
    return json(500, { error: errorMessage(error) });
  }
};
