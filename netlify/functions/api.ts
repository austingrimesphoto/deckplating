import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

type Status = 'green' | 'yellow' | 'red' | 'gray';
type FixedVoidReason = 'accidental' | 'wrong_unit' | 'duplicate' | 'incorrect_datetime' | 'incorrect_member';

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const adminPassphraseHash = process.env.ADMIN_PASSPHRASE_HASH ?? '';
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET ?? serviceRoleKey;

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

const pinHash = (teamMemberId: string, pin: string) => sha256(`${teamMemberId}:${pin}`);

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

const requireAdmin = (event: HandlerEvent) => {
  const header = event.headers.authorization ?? event.headers.Authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = hmac(expires);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

const createAdminToken = () => {
  const expires = String(Date.now() + 1000 * 60 * 60 * 8);
  return `${expires}.${hmac(expires)}`;
};

const createUserToken = (teamMemberId: string, deviceToken: string) => {
  const payload = base64url(
    JSON.stringify({
      teamMemberId,
      deviceHash: sha256(deviceToken),
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

  let parsed: { teamMemberId?: string; deviceHash?: string; expires?: number };
  try {
    parsed = JSON.parse(fromBase64url(payload));
  } catch {
    return null;
  }

  if (!parsed.teamMemberId || !parsed.deviceHash || !parsed.expires || parsed.expires < Date.now()) return null;
  const { data, error } = await supabase
    .from('devices')
    .select('id, team_member_id, team_members!inner(id, name, active)')
    .eq('team_member_id', parsed.teamMemberId)
    .eq('device_token_hash', parsed.deviceHash)
    .eq('active', true)
    .single();
  if (error || !data) return null;

  const member = data.team_members as { active?: boolean } | null;
  if (!member?.active) return null;
  await supabase.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  return { teamMemberId: parsed.teamMemberId, deviceId: data.id };
}

async function getCoverage() {
  const [{ data: areas, error: areaError }, { data: units, error: unitError }, { data: checkins, error: checkinError }] =
    await Promise.all([
      supabase.from('areas').select('*').order('sort_order'),
      supabase
        .from('units')
        .select('*, locations(*, areas(*))')
        .eq('active', true)
        .order('name'),
      supabase
        .from('checkins')
        .select('unit_id, checked_in_at, team_members!checkins_team_member_id_fkey(name)')
        .is('voided_at', null)
        .order('checked_in_at', { ascending: false }),
    ]);

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

async function getLocationSummaries() {
  const coverage = await getCoverage();
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

async function verifyDevice(teamMemberId: string, deviceToken: string) {
  const deviceHash = sha256(deviceToken);
  const { data, error } = await supabase
    .from('devices')
    .select('*')
    .eq('team_member_id', teamMemberId)
    .eq('device_token_hash', deviceHash)
    .eq('active', true)
    .single();
  if (error) return null;
  await supabase.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  return data;
}

async function registerDevice(body: { teamMemberId: string; pin: string; deviceToken: string; deviceLabel?: string }) {
  if (!body.teamMemberId || !/^\d{4}$/.test(body.pin) || !body.deviceToken) {
    return json(400, { error: 'teamMemberId, 4-digit pin, and deviceToken are required.' });
  }
  const { data: member, error: memberError } = await supabase
    .from('team_members')
    .select('*')
    .eq('id', body.teamMemberId)
    .eq('active', true)
    .single();
  if (memberError || !member) return json(404, { error: 'Team member not found.' });
  const nextPinHash = pinHash(body.teamMemberId, body.pin);
  if (member.pin_hash && member.pin_hash !== nextPinHash) return json(403, { error: 'PIN does not match.' });
  if (!member.pin_hash) await supabase.from('team_members').update({ pin_hash: nextPinHash }).eq('id', body.teamMemberId);
  const { data: device, error } = await supabase
    .from('devices')
    .upsert(
      {
        team_member_id: body.teamMemberId,
        device_token_hash: sha256(body.deviceToken),
        device_label: body.deviceLabel ?? null,
        active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'device_token_hash' },
    )
    .select('id')
    .single();
  if (error) return json(500, { error: error.message });
  return json(200, {
    deviceId: device.id,
    sessionToken: createUserToken(body.teamMemberId, body.deviceToken),
    teamMember: { id: member.id, name: member.name },
  });
}

async function route(event: HandlerEvent) {
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Supabase environment variables are missing.' });

  const path = normalizePath(event);
  const method = event.httpMethod;

  if (method === 'GET' && path === '/team-members') {
    const { data: teamMembers, error } = await supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
      .order('name');
    if (error) return json(500, { error: error.message });
    return json(200, { teamMembers: (teamMembers ?? []).map((member) => ({ ...member, role: null })) });
  }

  if (method === 'GET' && path === '/bootstrap') {
    if (!(await requireUser(event))) return json(403, { error: 'Authentication required.' });
    const [{ data: teamMembers, error }, coverage] = await Promise.all([
      supabase.from('team_members').select('id, name, role').eq('active', true).order('name'),
      getCoverage(),
    ]);
    if (error) return json(500, { error: error.message });
    return json(200, {
      areas: coverage.areas,
      teamMembers: teamMembers ?? [],
      units: coverage.units,
      mapTileUrl: (process.env.MAP_TILE_URL ?? '').replace('{key}', process.env.MAP_TILE_KEY ?? ''),
      mapDefaultLatitude: envNumber(process.env.MAP_DEFAULT_LATITUDE, 24.57),
      mapDefaultLongitude: envNumber(process.env.MAP_DEFAULT_LONGITUDE, -81.78),
      installationName: process.env.INSTALLATION_NAME ?? 'Naval Air Station Key West',
    });
  }

  if (method === 'POST' && path === '/device/register') {
    const body = readBody<{ teamMemberId: string; pin: string; deviceToken: string; deviceLabel?: string }>(event);
    return registerDevice(body);
  }

  if (method === 'POST' && path === '/device/change-identity') {
    const body = readBody<{ currentTeamMemberId: string; pin: string; newTeamMemberId: string; newPin: string; deviceToken: string }>(event);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.currentTeamMemberId) return json(403, { error: 'Authentication required.' });
    const { data: current } = await supabase.from('team_members').select('*').eq('id', body.currentTeamMemberId).single();
    if (!current?.pin_hash || current.pin_hash !== pinHash(body.currentTeamMemberId, body.pin)) {
      return json(403, { error: 'Current PIN does not match.' });
    }
    await supabase.from('devices').update({ active: false }).eq('device_token_hash', sha256(body.deviceToken));
    return registerDevice({
      teamMemberId: body.newTeamMemberId,
      pin: body.newPin,
      deviceToken: body.deviceToken,
      deviceLabel: 'Changed identity',
    });
  }

  if (method === 'GET' && path === '/nearby-locations') {
    if (!(await requireUser(event))) return json(403, { error: 'Authentication required.' });
    const lat = Number(event.queryStringParameters?.lat);
    const lon = Number(event.queryStringParameters?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(400, { error: 'lat and lon are required.' });
    const locations = await getLocationSummaries();
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
      latitude?: number;
      longitude?: number;
      manual?: boolean;
    }>(event);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.teamMemberId) return json(403, { error: 'Authentication required.' });
    const device = await verifyDevice(body.teamMemberId, body.deviceToken);
    if (!device) return json(403, { error: 'Device is not registered for this team member.' });
    if (!Array.isArray(body.unitIds) || body.unitIds.length === 0) return json(400, { error: 'unitIds are required.' });

    const results = [];
    for (const unitId of body.unitIds) {
      const { data: unit, error } = await supabase
        .from('units')
        .select('*, locations(*)')
        .eq('id', unitId)
        .eq('active', true)
        .single();
      if (error || !unit) return json(404, { error: `Unit not found: ${unitId}` });

      const location = unit.locations;
      let distance: number | null = null;
      let geofenceVerified = false;
      if (!body.manual && location && Number.isFinite(body.latitude) && Number.isFinite(body.longitude)) {
        distance = Math.round(distanceMeters(Number(body.latitude), Number(body.longitude), location.latitude, location.longitude));
        geofenceVerified = distance <= location.radius_meters;
      }

      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data: recent } = await supabase
        .from('checkins')
        .select('id')
        .eq('unit_id', unitId)
        .is('voided_at', null)
        .gte('checked_in_at', fourteenDaysAgo)
        .limit(1);

      let score = 0;
      const coverage = await getCoverage();
      const summary = coverage.units.find((candidate: any) => candidate.id === unitId);
      if (!recent?.length) {
        score = 1;
        if (summary?.status === 'yellow') score += 1;
        if (summary?.status === 'red' || summary?.status === 'gray') score += 2;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('checkins')
        .insert({
          unit_id: unitId,
          location_id: unit.location_id,
          team_member_id: body.teamMemberId,
          device_id: device.id,
          geofence_verified: geofenceVerified,
          distance_meters: distance,
          score_awarded: score,
        })
        .select('id, score_awarded')
        .single();
      if (insertError) return json(500, { error: insertError.message });
      results.push(inserted);
    }
    return json(200, { checkins: results, totalScore: results.reduce((sum, row) => sum + row.score_awarded, 0) });
  }

  if (method === 'POST' && path === '/checkins/undo') {
    const body = readBody<{ teamMemberId: string; checkinIds: string[] }>(event);
    const user = await requireUser(event);
    if (!user || user.teamMemberId !== body.teamMemberId) return json(403, { error: 'Authentication required.' });
    if (!Array.isArray(body.checkinIds) || body.checkinIds.length === 0) {
      return json(400, { error: 'checkinIds are required.' });
    }

    const { data: owned, error: ownedError } = await supabase
      .from('checkins')
      .select('id')
      .in('id', body.checkinIds)
      .eq('team_member_id', user.teamMemberId)
      .is('voided_at', null);
    if (ownedError) return json(500, { error: ownedError.message });
    if ((owned ?? []).length !== body.checkinIds.length) {
      return json(403, { error: 'Only your own active check-ins can be undone.' });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
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
    if (error) return json(500, { error: error.message });
    return json(200, { undone: body.checkinIds.length, coverage: await getCoverage() });
  }

  if (method === 'GET' && path === '/dashboard') {
    if (!(await requireUser(event))) return json(403, { error: 'Authentication required.' });
    return json(200, await getCoverage());
  }

  if (method === 'GET' && path === '/leaderboard') {
    if (!(await requireUser(event))) return json(403, { error: 'Authentication required.' });
    const month = event.queryStringParameters?.month ?? new Date().toISOString().slice(0, 7);
    const start = `${month}-01T00:00:00.000Z`;
    const endDate = new Date(start);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    const { data, error } = await supabase
      .from('checkins')
      .select('unit_id, score_awarded, team_members!checkins_team_member_id_fkey(id, name)')
      .is('voided_at', null)
      .gte('checked_in_at', start)
      .lt('checked_in_at', endDate.toISOString());
    if (error) return json(500, { error: error.message });
    const rows = new Map<string, any>();
    for (const checkin of data ?? []) {
      const member = checkin.team_members as any;
      if (!member) continue;
      const row = rows.get(member.id) ?? {
        team_member_id: member.id,
        name: member.name,
        qualifying_checkins: 0,
        distinct_units: new Set<string>(),
        recovered_units: 0,
        score: 0,
      };
      if (checkin.score_awarded > 0) row.qualifying_checkins += 1;
      if (checkin.score_awarded >= 3) row.recovered_units += 1;
      row.distinct_units.add(checkin.unit_id);
      row.score += checkin.score_awarded;
      rows.set(member.id, row);
    }
    return json(200, {
      month,
      rows: Array.from(rows.values())
        .map((row) => ({ ...row, distinct_units: row.distinct_units.size }))
        .sort((a, b) => b.score - a.score),
    });
  }

  if (method === 'POST' && path === '/admin/login') {
    const body = readBody<{ passphrase: string }>(event);
    if (!adminPassphraseHash || sha256(body.passphrase ?? '') !== adminPassphraseHash) {
      return json(403, { error: 'Invalid admin passphrase.' });
    }
    return json(200, { token: createAdminToken() });
  }

  if (path.startsWith('/admin/') && !requireAdmin(event)) return json(403, { error: 'Admin authorization required.' });

  if (method === 'GET' && path === '/admin/locations') {
    const [areas, locations, units, members] = await Promise.all([
      supabase.from('areas').select('*').order('sort_order'),
      supabase.from('locations').select('*, areas(*)').order('name'),
      supabase.from('units').select('*').order('name'),
      supabase.from('team_members').select('id, name, role, active, created_at').order('name'),
    ]);
    const error = areas.error ?? locations.error ?? units.error ?? members.error;
    if (error) return json(500, { error: error.message });
    return json(200, { areas: areas.data, locations: locations.data, units: units.data, teamMembers: members.data });
  }

  if (method === 'GET' && path === '/admin/checkins') {
    const params = event.queryStringParameters ?? {};
    let query = supabase
      .from('checkins')
      .select(
        'id, unit_id, location_id, team_member_id, checked_in_at, geofence_verified, score_awarded, voided_at, void_reason, updated_at, units(id, name, unit_type, location_id, locations(id, name, area_id, areas(id, name))), locations(id, name, area_id, areas(id, name)), team_members!checkins_team_member_id_fkey(id, name)',
      )
      .order('checked_in_at', { ascending: false })
      .limit(300);

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
        };
      })
      .filter((checkin) => !params.areaId || checkin.area_id === params.areaId);

    return json(200, { checkins });
  }

  const adminCheckinMatch = path.match(/^\/admin\/checkins\/([^/]+)$/);
  if (method === 'PATCH' && adminCheckinMatch) {
    const body = readBody<{
      unit_id?: string;
      checked_in_at?: string;
      team_member_id?: string;
      voided?: boolean;
      void_reason?: FixedVoidReason;
      adminTeamMemberId?: string;
    }>(event);
    if (!body.adminTeamMemberId) return json(400, { error: 'adminTeamMemberId is required.' });

    const { data: existing, error: existingError } = await supabase
      .from('checkins')
      .select('id, unit_id, voided_at')
      .eq('id', adminCheckinMatch[1])
      .single();
    if (existingError || !existing) return json(404, { error: 'Check-in not found.' });

    const update: Record<string, unknown> = { updated_by_team_member_id: body.adminTeamMemberId };

    if (body.unit_id && body.unit_id !== existing.unit_id) {
      const { data: unit, error: unitError } = await supabase
        .from('units')
        .select('id, location_id')
        .eq('id', body.unit_id)
        .single();
      if (unitError || !unit) return json(404, { error: 'Replacement unit not found.' });
      update.unit_id = body.unit_id;
      update.location_id = unit.location_id;
      update.geofence_verified = false;
      update.score_awarded = 0;
    }

    if (body.checked_in_at) update.checked_in_at = body.checked_in_at;
    if (body.team_member_id) update.team_member_id = body.team_member_id;

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

    const { data, error } = await supabase
      .from('checkins')
      .update(update)
      .eq('id', adminCheckinMatch[1])
      .select('id')
      .single();
    if (error) return json(500, { error: error.message });
    return json(200, { checkin: data, coverage: await getCoverage() });
  }

  if (method === 'POST' && path === '/admin/locations') {
    const body = readBody<any>(event);
    const { unitIds = [], ...locationValues } = body;
    const { data, error } = await supabase.from('locations').insert(locationValues).select('*').single();
    if (error) return json(500, { error: error.message });
    if (unitIds.length) await supabase.from('units').update({ location_id: data.id }).in('id', unitIds);
    return json(200, { location: data });
  }

  const locationMatch = path.match(/^\/admin\/locations\/([^/]+)$/);
  if (method === 'PATCH' && locationMatch) {
    const body = readBody<any>(event);
    const { unitIds, ...locationValues } = body;
    const { data, error } = await supabase.from('locations').update(locationValues).eq('id', locationMatch[1]).select('*').single();
    if (error) return json(500, { error: error.message });
    if (Array.isArray(unitIds)) await supabase.from('units').update({ location_id: data.id }).in('id', unitIds);
    return json(200, { location: data });
  }

  if (method === 'POST' && path === '/admin/units') {
    const body = readBody<any>(event);
    const { data, error } = await supabase.from('units').insert(body).select('*').single();
    if (error) return json(500, { error: error.message });
    return json(200, { unit: data });
  }

  const unitMatch = path.match(/^\/admin\/units\/([^/]+)$/);
  if (method === 'PATCH' && unitMatch) {
    const body = readBody<any>(event);
    const { data, error } = await supabase.from('units').update(body).eq('id', unitMatch[1]).select('*').single();
    if (error) return json(500, { error: error.message });
    return json(200, { unit: data });
  }

  if (method === 'POST' && path === '/admin/team-members') {
    const body = readBody<any>(event);
    const { data, error } = await supabase.from('team_members').insert(body).select('id, name, role, active').single();
    if (error) return json(500, { error: error.message });
    return json(200, { teamMember: data });
  }

  const memberMatch = path.match(/^\/admin\/team-members\/([^/]+)$/);
  if (method === 'PATCH' && memberMatch) {
    const body = readBody<any>(event);
    const { data, error } = await supabase.from('team_members').update(body).eq('id', memberMatch[1]).select('id, name, role, active').single();
    if (error) return json(500, { error: error.message });
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
