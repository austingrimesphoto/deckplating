import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

type Status = 'green' | 'yellow' | 'red' | 'gray';
type FixedVoidReason = 'accidental' | 'wrong_unit' | 'duplicate' | 'incorrect_datetime' | 'incorrect_member';
type IndicatorValue = true | null;
type GamificationTone = 'professional' | 'friendly' | 'banter';
type AdminContext = {
  organizationId: string | null;
  authMethod: 'organization' | 'environment' | 'legacy';
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
const defaultOrganizationId =
  process.env.DECKPLATING_DEFAULT_ORGANIZATION_ID ?? '00000000-0000-4000-8000-000000000001';

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
  },
  body: JSON.stringify(body),
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

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const legacyPinHash = (teamMemberId: string, pin: string) => sha256(`${teamMemberId}:${pin}`);

const pinHash = (teamMemberId: string, pin: string, organizationId: string | null) =>
  sha256(`${organizationId ?? 'single-org'}:${teamMemberId}:${pin}`);

let organizationSchemaEnabledCache: boolean | null = null;
let organizationAdminSchemaEnabledCache: boolean | null = null;

async function organizationSchemaEnabled() {
  if (organizationSchemaEnabledCache !== null) return organizationSchemaEnabledCache;
  const { error } = await supabase.from('organizations').select('id').limit(1);
  organizationSchemaEnabledCache = !error;
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
  return data as { id: string; slug: string; name: string; active: boolean };
}

async function organizationSummary(organizationId: string | null) {
  if (!organizationId || !(await organizationSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, active')
    .eq('id', organizationId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return data as { id: string; slug: string; name: string; active: boolean };
}

async function organizationAdminSchemaEnabled() {
  if (organizationAdminSchemaEnabledCache !== null) return organizationAdminSchemaEnabledCache;
  const { error } = await supabase.from('organization_admin_credentials').select('id').limit(1);
  organizationAdminSchemaEnabledCache = !error;
  return organizationAdminSchemaEnabledCache;
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
  const [areas, locations, units, teamMembers, adminCredential] = await Promise.all([
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
  ]);
  const error = areas.error ?? locations.error ?? units.error ?? teamMembers.error ?? adminCredential.error;
  if (error) throw error;
  const areaCount = areas.count ?? 0;
  const locationCount = locations.count ?? 0;
  const unitCount = units.count ?? 0;
  const teamMemberCount = teamMembers.count ?? 0;
  const organizationAdminConfigured = Boolean(adminCredential.data);
  return {
    areaCount,
    locationCount,
    unitCount,
    teamMemberCount,
    organizationAdminConfigured,
    readyForCheckins: areaCount > 0 && locationCount > 0 && unitCount > 0 && teamMemberCount > 0,
  };
}

const createAdminToken = (context: AdminContext) => {
  const payload = base64url(
    JSON.stringify({
      organizationId: context.organizationId,
      authMethod: context.authMethod,
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
    return { organizationId: await currentOrganizationId(), authMethod: 'legacy' };
  }

  let parsed: { organizationId?: string | null; authMethod?: AdminContext['authMethod']; expires?: number };
  try {
    parsed = JSON.parse(fromBase64url(payloadOrExpires));
  } catch {
    return null;
  }
  if (!parsed.expires || parsed.expires < Date.now()) return null;
  if (parsed.organizationId && !isUuid(parsed.organizationId)) return null;
  return {
    organizationId: parsed.organizationId ?? (await currentOrganizationId()),
    authMethod: parsed.authMethod === 'organization' ? 'organization' : 'environment',
  };
}

async function tryOrganizationAdminLogin(organizationId: string | null, passphrase: string): Promise<AdminContext | null> {
  if (!organizationId || !(await organizationAdminSchemaEnabled())) return null;
  const { data, error } = await supabase
    .from('organization_admin_credentials')
    .select('id, passphrase_hash')
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
  return { organizationId, authMethod: 'organization' };
}

function tryEnvironmentAdminLogin(passphrase: string, organizationId: string | null): AdminContext | null {
  if (!adminPassphraseHash || sha256(passphrase) !== adminPassphraseHash) return null;
  return { organizationId, authMethod: 'environment' };
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
const createUserToken = (teamMemberId: string, deviceToken: string, organizationId: string | null) => {
  const payload = base64url(
    JSON.stringify({
      teamMemberId,
      deviceHash: sha256(deviceToken),
      organizationId,
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

  let parsed: { teamMemberId?: string; deviceHash?: string; organizationId?: string | null; expires?: number };
  try {
    parsed = JSON.parse(fromBase64url(payload));
  } catch {
    return null;
  }

  if (!parsed.teamMemberId || !parsed.deviceHash || !parsed.expires || parsed.expires < Date.now()) return null;
  const organizationId = (await organizationSchemaEnabled()) ? parsed.organizationId ?? defaultOrganizationId : null;
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
    sessionToken: createUserToken(body.teamMemberId, body.deviceToken, organizationId),
    teamMember: { id: member.id, name: member.name },
  });
}

async function route(event: HandlerEvent) {
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Supabase environment variables are missing.' });

  const path = normalizePath(event);
  const method = event.httpMethod;

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
    return json(201, { organization: data });
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
    const code = createSetupCode();
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
    const { data, error } = await supabase
      .from('organization_setup_codes')
      .insert({
        organization_id: organizationId,
        code_hash: setupCodeHash(code),
        label: body.label?.trim() || null,
        purpose,
        active: true,
        expires_at: expiresAt,
      })
      .select('id, organization_id, label, purpose, active, expires_at, used_at, used_by_label, created_at')
      .single();
    if (error) return json(500, { error: error.message });
    return json(201, { organization, code, setupCode: { ...data, code } });
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
    return json(200, { setupCode: data });
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
    return json(200, {
      organizationId: user.organizationId,
      organization: await organizationSummary(user.organizationId),
      areas: coverage.areas,
      teamMembers: teamMembers ?? [],
      units: coverage.units,
      mapTileUrl: (process.env.MAP_TILE_URL ?? '').replace('{key}', process.env.MAP_TILE_KEY ?? ''),
      mapDefaultLatitude: envNumber(process.env.MAP_DEFAULT_LATITUDE, 24.57),
      mapDefaultLongitude: envNumber(process.env.MAP_DEFAULT_LONGITUDE, -81.78),
      installationName: process.env.INSTALLATION_NAME ?? 'Naval Air Station Key West',
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

    const rows = new Map<string, any>();
    const recoveredUnitsThisMonth = new Set<string>();
    const distinctUnitsCovered = new Set<string>();
    for (const checkin of monthlyResult.data ?? []) {
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
      if (checkin.score_awarded >= 3) {
        row.recovered_units += 1;
        recoveredUnitsThisMonth.add(checkin.unit_id);
      }
      if (checkin.score_awarded > 0 && firstVisitByUnit.get(checkin.unit_id) === checkin.checked_in_at) {
        row.gray_to_green_units.add(checkin.unit_id);
      }
      const areaId = (checkin.units as any)?.locations?.area_id ?? null;
      if (checkin.score_awarded > 0 && areaId && sweptAreaIds.has(areaId)) {
        row.coverage_sweep_areas.add(areaId);
      }
      row.distinct_units.add(checkin.unit_id);
      distinctUnitsCovered.add(checkin.unit_id);
      row.active_days.add(String(checkin.checked_in_at).slice(0, 10));
      row.score += checkin.score_awarded;
      rows.set(member.id, row);
    }
    return json(200, {
      month,
      rows: Array.from(rows.values())
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
        .sort((a, b) => b.score - a.score),
      summary: {
        units_recovered_this_month: recoveredUnitsThisMonth.size,
        distinct_units_covered: distinctUnitsCovered.size,
        overdue_remaining: coverage.units.filter((unit: any) => unit.status === 'red').length,
        never_visited_remaining: coverage.units.filter((unit: any) => unit.status === 'gray').length,
      },
    });
  }

  if (method === 'POST' && path === '/workspaces/activate') {
    const body = readBody<{ setupCode?: string; adminPassphrase?: string; organizationName?: string; leadLabel?: string }>(event);
    if (!body.setupCode || !body.adminPassphrase || body.adminPassphrase.length < 8) {
      return json(400, { error: 'setupCode and an adminPassphrase of at least 8 characters are required.' });
    }
    const setupCode = await verifySetupCode(body.setupCode);
    if (!setupCode) return json(403, { error: 'Setup code is invalid, expired, or already used.' });
    const organizationId = setupCode.organization_id;
    if (body.organizationName?.trim()) {
      await supabase.from('organizations').update({ name: body.organizationName.trim() }).eq('id', organizationId);
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
      token: createAdminToken({ organizationId, authMethod: 'organization' }),
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
      token: createAdminToken(adminContext),
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
    let query = scoped(
      supabase
        .from('checkins')
        .select(
          'id, unit_id, location_id, team_member_id, checked_in_at, geofence_verified, score_awarded, voided_at, void_reason, updated_at, batch_id, checkin_batches!checkins_batch_id_fkey(client_batch_id, confidential_care_provided, referral_provided), units(id, name, unit_type, location_id, locations(id, name, area_id, areas(id, name))), locations(id, name, area_id, areas(id, name)), team_members!checkins_team_member_id_fkey(id, name)',
        )
        .order('checked_in_at', { ascending: false })
        .limit(300),
      organizationId,
    );

    if (params.from) query = query.gte('checked_in_at', `${params.from}T00:00:00.000Z`);
    if (params.to) query = query.lte('checked_in_at', `${params.to}T23:59:59.999Z`);
    if (params.teamMemberId) query = query.eq('team_member_id', params.teamMemberId);
    if (params.unitId) query = query.eq('unit_id', params.unitId);
    if (params.includeVoided !== 'true') query = query.is('voided_at', null);

    const { data, error } = await query;
    if (error) return json(500, { error: error.message });

    const checkins = (data ?? [])
      .map((checkin: any) => {
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
      })
      .filter((checkin: any) => !params.areaId || checkin.area_id === params.areaId);

    return json(200, { checkins });
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
      .select('id, unit_id, voided_at')
      .eq('id', adminCheckinMatch[1]);
    const { data: existing, error: existingError } = await scoped(existingQuery, organizationId).single();
    if (existingError || !existing) return json(404, { error: 'Check-in not found.' });

    const update: Record<string, unknown> = { updated_by_team_member_id: body.adminTeamMemberId };

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

  return json(404, { error: 'Route not found.' });
}

export const handler: Handler = async (event) => {
  try {
    return await route(event);
  } catch (error) {
    return json(500, { error: errorMessage(error) });
  }
};
