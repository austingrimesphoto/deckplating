import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import type {
  AdminCheckin,
  Area,
  Bootstrap,
  Identity,
  GamificationTone,
  IndicatorReportRow,
  LeaderboardRow,
  LeaderboardWinner,
  LocationSummary,
  MissionBoardSummary,
  MissionBadge,
  PendingVisitBatch,
  TeamMember,
  UnitSummary,
  UnitType,
  CoverageDetail,
  VisitIndicatorState,
  WorkspaceContext,
} from './types';
import {
  countBlockingPendingBatches,
  findCachedNearbyLocations,
  getCachedLocationSummaries,
  getBootstrapSnapshot,
  getPendingBatch,
  getPendingBatches,
  removePendingBatch,
  saveBootstrapSnapshot,
  savePendingBatch,
  updatePendingBatchIndicators,
} from './offline';
import { briefForDate } from './content/deckplateBriefs';
import { acquireFreshPosition } from './fresh-location-bridge';

type Screen = 'checkin' | 'coverage' | 'map' | 'admin' | 'scoreboard' | 'settings';

type AdminData = {
  areas: Area[];
  locations: Array<{ id: string; name: string; area_id: string; latitude: number; longitude: number; radius_meters: number; active: boolean }>;
  units: Array<{ id: string; name: string; unit_type: UnitType; visit_interval_days: number; location_id: string | null; active: boolean }>;
  teamMembers: Array<{ id: string; name: string; role: string | null; active: boolean }>;
};

type OnboardingSummary = {
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

type OperatorSetupCode = {
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

type OperatorOrganization = WorkspaceContext & {
  active: boolean;
  created_at: string;
  updated_at: string;
  onboarding: OnboardingSummary | null;
  setupCodes: OperatorSetupCode[];
  setupCodeSummary: {
    total: number;
    activeUnused: number;
    used: number;
  };
};

type OperatorAuditEvent = {
  id: string;
  organization_id: string | null;
  actor: string;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  organization: Pick<WorkspaceContext, 'id' | 'slug' | 'name'> | null;
};

type OperatorWorkspaceRequest = {
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
  status: 'pending' | 'approved' | 'rejected';
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
  organizations?: Pick<WorkspaceContext, 'id' | 'slug' | 'name'> & { active: boolean };
  organization_setup_codes?: OperatorSetupCode | null;
};

type WorkspaceRequestApprovalForm = {
  workspaceName: string;
  workspaceSlug: string;
  expiresInDays: string;
  operatorNote: string;
};

type PageMetadata = {
  limit: number;
  offset: number;
  returned: number;
  total: number | null;
  hasMore: boolean;
};

let maplibrePromise: Promise<typeof import('maplibre-gl')> | null = null;

const loadMapLibre = () => {
  maplibrePromise ??= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([maplibre]) => maplibre);
  return maplibrePromise;
};

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

type CheckinConfirmation = {
  clientBatchId: string;
  checkinIds: string[];
  units: string[];
  locationId: string | null;
  locationName: string | null;
  checkedInAt: string;
  totalScore: number;
  syncStatus: 'synced' | 'queued';
  indicators: VisitIndicatorState;
};

type SyncState = 'synced' | 'offline' | 'pending' | 'auth' | 'failed';

type BatchSyncedDetail = {
  clientBatchId: string;
  organizationId: string | null;
  teamMemberId: string;
  checkinIds: string[];
  totalScore: number;
};

const batchSyncedEvent = 'deckplate:batch-synced';

const safeUseSummary =
  'Deckplating is an unofficial open-source prototype, not approved by DON or DoD. Use only for unclassified, non-sensitive coverage awareness unless authorized by local IT/N6.';

const safeUseItems = [
  'Deckplating is not approved for operational Navy use unless authorized by local IT/N6, privacy, records, OPSEC, and command guidance.',
  'Store only the minimum information needed to track ministry presence.',
  'Do not enter CUI, classified information, counseling notes, case management, medical details, incident details, family information, home addresses, phone numbers, dates of birth, setup codes, passphrases, or official records.',
  'Team display names should be limited to practical ministry workflow identity, such as rank/last name or role/name.',
  'Map only publicly identifiable facilities, buildings, or general areas.',
  'Do not map SCIFs, restricted spaces, deployed operational locations, residences, or other sensitive locations.',
  'When uncertain, do not map the location. Use manual check-in.',
  'Deckplating is a coverage-awareness tool, not a counseling record, case-management system, or official system of record.',
];

const locationMappingNotice =
  'Map only public/general locations. Do not map restricted rooms, SCIFs, residences, deployed locations, or sensitive operational spaces. When uncertain, leave the location unmapped and use manual check-in.';

const identityKey = 'deckplate.identity';
const workspaceKey = 'deckplate.workspace';
const operatorKey = 'deckplate.operator';
const feedbackUrl = 'https://deckplatingsetup.netlify.app/#feedback';
const ministryIndicatorsEnabled = /^true$/i.test(import.meta.env.VITE_ENABLE_MINISTRY_INDICATORS ?? '');

function readLocalValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocalValue(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

function readSessionValue(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // The in-memory session can continue when browser storage is unavailable.
  }
}

function removeSessionValue(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The in-memory session can continue when browser storage is unavailable.
  }
}

function readStoredJson<T>(key: string): T | null {
  try {
    const value = readLocalValue(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch {
    removeLocalValue(key);
    return null;
  }
}

function writeStoredJson(key: string, value: unknown) {
  return writeLocalValue(key, JSON.stringify(value));
}

function readStoredIdentity() {
  const value = readStoredJson<Identity>(identityKey);
  if (!value || typeof value.sessionToken !== 'string' || typeof value.teamMemberId !== 'string') return null;
  if (value.organizationId) return value;
  const migrated = { ...value, organizationId: readStoredWorkspace()?.id ?? defaultWorkspace.id };
  writeStoredJson(identityKey, migrated);
  return migrated;
}

function readStoredWorkspace() {
  const value = readStoredJson<WorkspaceContext>(workspaceKey);
  return value && typeof value.id === 'string' && typeof value.slug === 'string' && typeof value.name === 'string' ? value : null;
}

const defaultWorkspace: WorkspaceContext = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'default',
  name: 'Default Workspace',
};

const workspaceParam = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('workspace') || params.get('org') || params.get('organization');
};

const operatorParamEnabled = () => new URLSearchParams(window.location.search).get('operator') === '1';

const operatorRequestParam = () => new URLSearchParams(window.location.search).get('request') ?? '';

const kioskParamEnabled = () => new URLSearchParams(window.location.search).get('kiosk') === '1';

const slugPreview = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const setOperatorQueryParam = (enabled: boolean) => {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set('operator', '1');
  else url.searchParams.delete('operator');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};

const kioskLinkForWorkspace = (workspace: WorkspaceContext | null) => {
  const workspaceKey = workspace?.slug || workspace?.id;
  return workspaceKey ? `/?workspace=${encodeURIComponent(workspaceKey)}&kiosk=1` : '/?kiosk=1';
};

const workspaceHomeLink = (workspace: WorkspaceContext | null) => {
  const key = workspace?.slug || workspace?.id;
  return key ? `/?workspace=${encodeURIComponent(key)}` : '/';
};

const looksLikeUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const workspaceQuery = (workspace: WorkspaceContext | null) =>
  workspace?.id ? `?organizationId=${encodeURIComponent(workspace.id)}` : '';

const leaderboardPath = (month: string) => {
  const params = new URLSearchParams({ month });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timeZone) params.set('timeZone', timeZone);
  return `/api/leaderboard?${params.toString()}`;
};

async function api<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10000, signal: externalSignal, ...requestOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const forwardExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardExternalAbort();
  else externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true });
  try {
    const response = await fetch(path, {
      ...requestOptions,
      headers: { 'content-type': 'application/json', ...(requestOptions.headers ?? {}) },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(`API route ${path} did not return JSON. Run the app with netlify dev so /api routes are available.`);
    }
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      const error = new Error(data.error ?? 'Request failed.');
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return data;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', forwardExternalAbort);
  }
}

const newToken = () => crypto.randomUUID();

const authHeaders = (identity: Identity) => ({ authorization: `Bearer ${identity.sessionToken}` });

const isNetworkFailure = (error: unknown) => {
  const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
  return status == null;
};

const indicatorPayload = (indicators: VisitIndicatorState) => ({
  confidentialCareProvided: ministryIndicatorsEnabled ? indicators.confidentialCareProvided : null,
  referralProvided: ministryIndicatorsEnabled ? indicators.referralProvided : null,
});

const statusText: Record<UnitSummary['status'], string> = {
  gray: 'Never visited',
  red: 'Overdue',
  yellow: 'Due soon',
  green: 'Current',
};

const statusLabel = (unit: UnitSummary) => statusText[unit.status];

const parsedDate = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);

const niceDate = (date: string | null) => {
  if (!date) return 'Never';
  const value = parsedDate(date);
  return Number.isNaN(value.getTime()) ? 'Unknown' : value.toLocaleDateString();
};

const niceDateTime = (date: string | null) => {
  if (!date) return 'Never';
  const value = parsedDate(date);
  return Number.isNaN(value.getTime()) ? 'Unknown' : value.toLocaleString();
};

const matchesSearch = (query: string, values: unknown[]) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
};

const datetimeLocalValue = (date: string) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const offsetMs = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
};

const localDateTimeToIso = (value: string) => (value ? new Date(value).toISOString() : '');

const statusColor = {
  green: '#287a3e',
  yellow: '#b47b13',
  red: '#bd3030',
  gray: '#68717a',
};

const statusPriority: Record<UnitSummary['status'], number> = {
  gray: 4,
  red: 3,
  yellow: 2,
  green: 1,
};

const minLocationRadiusMeters = 25;
const maxLocationRadiusMeters = 750;

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const validLatitude = (value: unknown): value is number => finiteNumber(value) && value >= -90 && value <= 90;

const validLongitude = (value: unknown): value is number => finiteNumber(value) && value >= -180 && value <= 180;

const validLocationRadius = (value: unknown): value is number =>
  finiteNumber(value) && value >= minLocationRadiusMeters && value <= maxLocationRadiusMeters;

const numberFromInput = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text === '' ? Number.NaN : Number(text);
};

const locationInputError = (latitude: number, longitude: number, radiusMeters: number) => {
  if (!validLatitude(latitude)) return 'Latitude must be a number from -90 to 90.';
  if (!validLongitude(longitude)) return 'Longitude must be a number from -180 to 180.';
  if (!validLocationRadius(radiusMeters)) return `Radius must be between ${minLocationRadiusMeters}m and ${maxLocationRadiusMeters}m.`;
  return '';
};

const unitTypeLabel: Record<UnitType, string> = {
  department: 'Department',
  division: 'Division',
  tenant: 'Tenant command',
};

const badgeLabel: Record<MissionBadge, string> = {
  first_rounds: 'First Rounds',
  recovery_team: 'Recovery Team',
  gray_to_green: 'Gray to Green',
  wide_coverage: 'Wide Coverage',
  sustained_presence: 'Sustained Presence',
  coverage_sweep: 'Coverage Sweep',
};

const badgeDetails: Record<MissionBadge, { title: string; description: string; icon: string }> = {
  first_rounds: {
    title: 'First Rounds',
    description: 'First qualifying check-in by that team member in the current calendar month.',
    icon: 'FR',
  },
  recovery_team: {
    title: 'Recovery Team',
    description: 'Recovered at least one overdue or never-visited unit using meaningful recovery scoring.',
    icon: 'RT',
  },
  gray_to_green: {
    title: 'Gray to Green',
    description: 'Completed a first-ever visit to a previously never-visited unit.',
    icon: 'G2',
  },
  wide_coverage: {
    title: 'Wide Coverage',
    description: 'Reached five distinct units visited in the current calendar month.',
    icon: 'WC',
  },
  sustained_presence: {
    title: 'Sustained Presence',
    description: 'Completed qualifying check-ins on four distinct local calendar days this month.',
    icon: 'SP',
  },
  coverage_sweep: {
    title: 'Coverage Sweep',
    description: 'Contributed to coverage in an area that has no overdue or never-visited active units remaining.',
    icon: 'CS',
  },
};

type MissionBriefContext = 'gray' | 'red' | 'yellow' | 'recovery' | 'current';

const missionBriefMessages: Record<GamificationTone, Record<MissionBriefContext, string[]>> = {
  professional: {
    gray: ['Prioritize first visits to units with no recorded coverage.'],
    red: ['Prioritize overdue units before repeating recent visits.'],
    yellow: ['Several units are approaching their coverage interval.'],
    recovery: ['Recent recovery progress is improving coverage readiness.'],
    current: ['Coverage is current. Maintain steady presence across the command.'],
  },
  friendly: {
    gray: ['A first visit can turn an unknown space into real coverage.'],
    red: ['A quick round through an overdue space can move the whole board.'],
    yellow: ['A few due-soon visits now can prevent a red board later.'],
    recovery: ['Good recovery work. Keep the momentum moving across the deckplates.'],
    current: ['Coverage is looking healthy. Keep the rhythm steady.'],
  },
  banter: {
    gray: [
      'The gray boxes are calling. They have been calling for some time.',
      'Somewhere, a neglected deckplate is wondering where you went.',
      'This mission, should you choose to accept it: one meaningful visit.',
      'May the force of actual presence be with you.',
      'Excellent day to turn gray boxes into actual ministry presence.',
    ],
    red: [
      'I feel the need-the need for deckplating.',
      'Talk to me, Goose: which red unit are we visiting?',
      'The board has entered the danger zone. Time for a visit.',
      "I'm going to need a bigger coverage plan.",
      'Show me the coverage.',
      "You can't handle the red-unless you go visit it.",
      'There is no try. There is only getting out of the office.',
      "What we've got here is a failure to communicate-perhaps with that overdue unit.",
      'Nobody puts deckplating in a corner.',
      'Keep your friends close and your overdue units closer.',
      'The red units are not going to visit themselves.',
    ],
    yellow: [
      'You can be my wingman on the next overdue unit.',
      'Fresh air, real people, fewer red cards. Strong plan.',
      'The map has opinions. It thinks you should go outside.',
    ],
    recovery: [
      'One recovered unit beats five victory laps around the same hallway.',
      'The leaderboard respects meaningful coverage, not hallway cardio.',
      'This mission, should you choose to accept it: one meaningful visit.',
    ],
    current: [
      'Fresh air, real people, fewer red cards. Strong plan.',
      'The map has opinions. It thinks you should go outside.',
      'May the force of actual presence be with you.',
    ],
  },
};

const missionBriefDateKey = 'deckplate.missionBrief.lastExpandedDate';
const badgeCelebrationsKey = 'deckplate.badgeCelebrations';
const currentReleaseNote = {
  id: '2026-07-08-quality-controls-winners',
  title: 'Quality controls, safer exports, and Mission Board winners',
  items: [
    'Mission Board now shows weekly leaders and the selected month leader.',
    'Admin Activity Log and Operator Audit can load older pages instead of stopping at the first batch.',
    'System Administration includes a safe export that excludes secrets, hashes, device records, and detailed/sensitive fields.',
    'Map code now loads only when a map view is opened, which keeps the main app lighter.',
  ],
};

function localDateKey(date = new Date()) {
  return date.toLocaleDateString('en-CA');
}

function localDayBoundaryIso(value: string, endOfDay = false) {
  if (!value) return '';
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
  return new Date(`${value}T${time}`).toISOString();
}

function missionNudge(tone: GamificationTone, context: MissionBriefContext, key: string) {
  const messages = missionBriefMessages[tone]?.[context] ?? missionBriefMessages.professional[context];
  let total = 0;
  for (const character of key) total += character.charCodeAt(0);
  return messages[total % messages.length];
}

function missionContextFromUnits(units: UnitSummary[], recentRecovery = false): MissionBriefContext {
  if (recentRecovery) return 'recovery';
  if (units.some((unit) => unit.status === 'gray')) return 'gray';
  if (units.some((unit) => unit.status === 'red')) return 'red';
  if (units.some((unit) => unit.status === 'yellow')) return 'yellow';
  return 'current';
}

function readCelebratedBadges() {
  return readStoredJson<Record<string, true>>(badgeCelebrationsKey) ?? {};
}

function celebrationKey(teamMemberId: string, month: string, badge: MissionBadge) {
  return `${teamMemberId}:${month}:${badge}`;
}

function circlePolygon(longitude: number, latitude: number, radiusMeters: number) {
  const points = 64;
  const earthRadius = 6371000;
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  const distance = radiusMeters / earthRadius;
  const coordinates: number[][] = [];

  for (let i = 0; i <= points; i += 1) {
    const bearing = (2 * Math.PI * i) / points;
    const pointLat = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(distance) * Math.cos(lat),
        Math.cos(distance) - Math.sin(lat) * Math.sin(pointLat),
      );
    coordinates.push([(pointLon * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }

  return coordinates;
}

function mapPopupContent(location: LocationSummary) {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = location.name;
  content.append(title);

  const details = [location.area_name, `Radius: ${location.radius_meters}m`];
  for (const detail of details) {
    if (!detail) continue;
    content.append(document.createElement('br'), document.createTextNode(detail));
  }
  for (const unit of location.units) {
    content.append(
      document.createElement('br'),
      document.createTextNode(`${unit.name}: ${statusLabel(unit)} (${niceDate(unit.last_visit_at)})`),
    );
  }
  return content;
}

function IdentitySetup({
  members,
  workspace,
  onWorkspaceChange,
  onRegistered,
}: {
  members: TeamMember[];
  workspace: WorkspaceContext | null;
  onWorkspaceChange: () => void;
  onRegistered: (identity: Identity) => void;
}) {
  const [teamMemberId, setTeamMemberId] = useState(members[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const member = members.find((candidate) => candidate.id === teamMemberId);
    if (!member) return;
    const deviceToken = newToken();
    try {
      const result = await api<{ deviceId: string; sessionToken: string; organizationId?: string | null; organization?: WorkspaceContext | null }>('/api/device/register', {
        method: 'POST',
        body: JSON.stringify({
          teamMemberId,
          pin,
          deviceToken,
          deviceLabel: navigator.userAgent.slice(0, 120),
          organizationId: workspace?.id ?? null,
        }),
      });
      const identity = {
        organizationId: result.organizationId ?? null,
        organization: result.organization ?? workspace ?? null,
        teamMemberId,
        teamMemberName: member.name,
        deviceToken,
        deviceId: result.deviceId,
        sessionToken: result.sessionToken,
      };
      writeStoredJson(identityKey, identity);
      onRegistered(identity);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    }
  }

  return (
    <main className="center-shell">
      <section className="panel">
        <p className="eyebrow">Deckplating</p>
        <h1>Select your name</h1>
        <p className="muted">Workspace: {workspace?.name ?? 'Default Workspace'}</p>
        <p className="safe-summary">{safeUseSummary}</p>
        <form onSubmit={submit} className="stack">
          <label>
            Team member
            <select value={teamMemberId} onChange={(event) => setTeamMemberId(event.target.value)} required>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            4-digit PIN
            <input
              type="password"
              autoComplete="current-password"
              value={pin}
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">
            Continue
          </button>
          <button className="secondary" type="button" onClick={onWorkspaceChange}>
            Change or activate workspace
          </button>
        </form>
      </section>
    </main>
  );
}

function WorkspaceEntry({
  workspace,
  teamMembers,
  notice,
  onBack,
  onWorkspace,
  onAdminToken,
  onOpenAdmin,
}: {
  workspace: WorkspaceContext | null;
  teamMembers: TeamMember[];
  notice?: string;
  onBack: () => void;
  onWorkspace: (workspace: WorkspaceContext | null) => boolean | Promise<boolean>;
  onAdminToken: (token: string) => void;
  onOpenAdmin: () => void;
}) {
  const [mode, setMode] = useState<'choose' | 'activate'>('choose');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [organizationName, setOrganizationName] = useState(workspace?.name ?? '');
  const [installationQuery, setInstallationQuery] = useState(workspace?.installationName ?? workspace?.name ?? '');
  const [installationResults, setInstallationResults] = useState<InstallationSearchResult[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<InstallationSearchResult | null>(null);
  const [searchingInstallation, setSearchingInstallation] = useState(false);
  const [leadLabel, setLeadLabel] = useState('');
  const [adminPassphrase, setAdminPassphrase] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function useDefaultWorkspace() {
    await onWorkspace(defaultWorkspace);
  }

  async function resolveWorkspace(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await api<{ organization: WorkspaceContext | null }>(`/api/workspaces/resolve?slug=${encodeURIComponent(workspaceSlug)}`);
      if (!result.organization) throw new Error('Workspace was not found. Check the slug and try again.');
      const next = result.organization;
      if (!(await onWorkspace(next))) return;
      setMessage(`Workspace set to ${next.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace was not found.');
    }
  }

  async function searchInstallation(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSearchingInstallation(true);
    try {
      const result = await api<{ results: InstallationSearchResult[] }>(`/api/installations/search?q=${encodeURIComponent(installationQuery)}`);
      setInstallationResults(result.results);
      setSelectedInstallation(result.results[0] ?? null);
      if (result.results[0]) {
        setMessage(`Found ${result.results.length} installation result${result.results.length === 1 ? '' : 's'}.`);
      } else {
        setMessage('No installation results found. Try the full official name or nearby city.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation lookup failed.');
    } finally {
      setSearchingInstallation(false);
    }
  }

  async function activateWorkspace(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await api<{ token: string; organizationId: string; organization: WorkspaceContext | null }>('/api/workspaces/activate', {
        method: 'POST',
        body: JSON.stringify({
          setupCode,
          adminPassphrase,
          organizationName,
          leadLabel,
          installationName: selectedInstallation?.display_name ?? installationQuery,
          installationLatitude: selectedInstallation ? Number(selectedInstallation.lat) : undefined,
          installationLongitude: selectedInstallation ? Number(selectedInstallation.lon) : undefined,
        }),
      });
      const next = result.organization ?? {
        id: result.organizationId,
        slug: '',
        name: organizationName.trim() || 'Activated Workspace',
        installationName: selectedInstallation?.display_name ?? installationQuery,
        mapDefaultLatitude: selectedInstallation ? Number(selectedInstallation.lat) : undefined,
        mapDefaultLongitude: selectedInstallation ? Number(selectedInstallation.lon) : undefined,
      };
      if (!(await onWorkspace(next))) return;
      writeSessionValue('deckplate.admin', result.token);
      onAdminToken(result.token);
      setSetupCode('');
      setAdminPassphrase('');
      setMessage('Workspace activated. Continue to local setup to build areas, locations, units, and the roster.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace activation failed.');
    }
  }

  return (
    <main className="center-shell">
      <section className="panel">
        <p className="eyebrow">Deckplating</p>
        <h1>Workspace setup</h1>
        <p className="muted">Current workspace: {workspace?.name ?? 'Default Workspace'}</p>
        <p className="notice">
          Demonstration sequence: select or request your controlled demonstration workspace, enter the one-time setup code, confirm the installation map center, set the local admin passphrase, then continue to local setup.
        </p>
        {notice && <p className="warning-notice">{notice}</p>}
        <p className="safe-summary">{safeUseSummary}</p>
        {teamMembers.length > 0 && (
          <p className="notice">
            This workspace already has a roster. Go back and select your name, or change workspaces below.
          </p>
        )}
        {teamMembers.length === 0 && workspace && (
          <p className="notice">
            If this workspace is already activated but the roster is not ready yet, open local Admin and enter the workspace admin passphrase.
          </p>
        )}
        {teamMembers.length > 0 && (
          <button className="secondary" type="button" onClick={onBack}>
            Back to names
          </button>
        )}
        {teamMembers.length === 0 && workspace && (
          <button className="secondary" type="button" onClick={onOpenAdmin}>
            Open local Admin
          </button>
        )}
        <div className="tab-row">
          <button className={mode === 'choose' ? 'active' : ''} onClick={() => setMode('choose')}>
            Select workspace
          </button>
          <button className={mode === 'activate' ? 'active' : ''} onClick={() => setMode('activate')}>
            Activate workspace
          </button>
        </div>
        {mode === 'choose' ? (
          <form className="stack" onSubmit={resolveWorkspace}>
            <p className="muted">
              Use this if your controlled demonstration workspace has already been approved and you know its slug. This is not open signup.
            </p>
            <label>
              Workspace slug
              <input
                value={workspaceSlug}
                placeholder="example-rmt"
                autoCapitalize="none"
                autoComplete="off"
                onChange={(event) => setWorkspaceSlug(event.target.value.trim().toLowerCase())}
                required
              />
            </label>
            <button className="primary">Use workspace</button>
            <button className="secondary" type="button" onClick={useDefaultWorkspace}>
              Use default workspace
            </button>
          </form>
        ) : (
          <form className="stack" onSubmit={activateWorkspace}>
            <p className="muted">
              Use the one-time setup code from the Deckplating operator. This does not create an email account or open signup; it activates the already approved workspace for local setup.
            </p>
            <p className="warning-notice">
              Do not use government-furnished equipment or government networks unless authorized by local IT/N6. Do not enter CUI, official records, sensitive locations, setup codes, or passphrases anywhere except the intended activation fields.
            </p>
            <label>
              One-time setup code
              <input
                type="password"
                autoComplete="one-time-code"
                spellCheck={false}
                value={setupCode}
                autoCapitalize="characters"
                onChange={(event) => setSetupCode(event.target.value.toUpperCase())}
                required
              />
            </label>
            <label>
              Workspace display name
              <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Example RMT" />
            </label>
            <label>
              Installation name
              <span className="admin-hint">Search for the public installation or command area that should center the map.</span>
              <input
                value={installationQuery}
                onChange={(event) => {
                  setInstallationQuery(event.target.value);
                  setSelectedInstallation(null);
                  setInstallationResults([]);
                }}
                placeholder="NAS Pensacola, Naval Air Station Pensacola, or a typo close to it"
              />
            </label>
            <button className="secondary" type="button" onClick={searchInstallation} disabled={searchingInstallation}>
              {searchingInstallation ? 'Searching...' : 'Find installation'}
            </button>
            {installationResults.length > 0 && (
              <div className="stack">
                {installationResults.map((result) => (
                  <button
                    key={result.place_id}
                    type="button"
                    className={selectedInstallation?.place_id === result.place_id ? 'secondary active' : 'secondary'}
                    onClick={() => setSelectedInstallation(result)}
                  >
                    <strong>{result.display_name}</strong>
                    <small>
                      {result.lat}, {result.lon}
                    </small>
                  </button>
                ))}
              </div>
            )}
            <label>
              Local lead label
              <input value={leadLabel} onChange={(event) => setLeadLabel(event.target.value)} placeholder="Optional" />
            </label>
            <label>
              Local admin passphrase
              <span className="admin-hint">Keep this with the approved local lead. It unlocks Admin settings for this workspace only.</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={adminPassphrase}
                onChange={(event) => setAdminPassphrase(event.target.value)}
                required
              />
            </label>
            <button className="primary">Activate workspace</button>
          </form>
        )}
        {message && <p className="notice">{message}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

function OnboardingChecklist({
  onboarding,
  onComplete,
}: {
  onboarding: OnboardingSummary | null;
  onComplete: () => void;
}) {
  const steps = [
    { label: 'Local admin passphrase', done: Boolean(onboarding?.organizationAdminConfigured), detail: 'Protect this workspace admin area.' },
    { label: 'Areas', done: (onboarding?.areaCount ?? 0) > 0, detail: `${onboarding?.areaCount ?? 0} created` },
    { label: 'Locations', done: (onboarding?.locationCount ?? 0) > 0, detail: `${onboarding?.locationCount ?? 0} created` },
    { label: 'Units', done: (onboarding?.unitCount ?? 0) > 0, detail: `${onboarding?.unitCount ?? 0} active` },
    { label: 'Team members', done: (onboarding?.teamMemberCount ?? 0) > 0, detail: `${onboarding?.teamMemberCount ?? 0} active` },
  ];

  return (
    <section className="panel">
      <p className="eyebrow">Guided onboarding</p>
      <h2>{onboarding?.readyForCheckins ? 'Workspace ready for sign-in' : 'Finish workspace setup'}</h2>
      <p className="muted">
        Complete the local roster and mapping here before handing the workspace link to the rest of the command.
      </p>
      <div className="activity-list">
        {steps.map((step) => (
          <article key={step.label} className="activity-row">
            <div className="activity-summary">
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
              <span className="status-pill">{step.done ? 'Done' : 'Pending'}</span>
            </div>
          </article>
        ))}
      </div>
      <button className="secondary" type="button" onClick={onComplete}>
        {onboarding?.readyForCheckins ? 'Complete onboarding' : 'Hide checklist'}
      </button>
    </section>
  );
}

function WhatChangedPanel({ audience }: { audience: 'admin' | 'operator' }) {
  const storageKey = `deckplate.releaseNote.${audience}.${currentReleaseNote.id}`;
  const [dismissed, setDismissed] = useState(() => readLocalValue(storageKey) === 'dismissed');
  if (dismissed) return null;
  return (
    <section className="panel release-note-panel">
      <div className="screen-title inline-title">
        <div>
          <p className="eyebrow">What changed</p>
          <h2>{currentReleaseNote.title}</h2>
        </div>
        <button
          className="secondary"
          onClick={() => {
            writeLocalValue(storageKey, 'dismissed');
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
      <ul className="plain-list">
        {currentReleaseNote.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function OperatorConsole({
  onClose,
  onSuperuserAdmin,
}: {
  onClose: () => void;
  onSuperuserAdmin: (token: string, organization: WorkspaceContext) => void;
}) {
  const [token, setToken] = useState(readSessionValue(operatorKey) ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [organizations, setOrganizations] = useState<OperatorOrganization[]>([]);
  const [workspaceRequests, setWorkspaceRequests] = useState<OperatorWorkspaceRequest[]>([]);
  const [workspaceRequestSearch, setWorkspaceRequestSearch] = useState(operatorRequestParam());
  const [workspaceRequestStatus, setWorkspaceRequestStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [workspaceRequestPage, setWorkspaceRequestPage] = useState<PageMetadata | null>(null);
  const [workspaceRequestForms, setWorkspaceRequestForms] = useState<Record<string, WorkspaceRequestApprovalForm>>({});
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [auditEvents, setAuditEvents] = useState<OperatorAuditEvent[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState<PageMetadata | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditQueryKey, setAuditQueryKey] = useState('');
  const [auditMessage, setAuditMessage] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [organizationForm, setOrganizationForm] = useState({ name: '', slug: '' });
  const [setupForms, setSetupForms] = useState<Record<string, { label: string; expiresInDays: string }>>({});
  const [lastIssuedCode, setLastIssuedCode] = useState<Record<string, { code: string; link: string }>>({});
  const [recoveryForms, setRecoveryForms] = useState<Record<string, { passphrase: string; confirmPassphrase: string }>>({});

  function handleOperatorLoadError(err: unknown, fallback: string) {
    const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
    if (status === 403) {
      removeSessionValue(operatorKey);
      setToken('');
      setError('Operator session expired. Unlock the console again.');
      return;
    }
    setError(err instanceof Error ? err.message : fallback);
  }

  async function loadOrganizations(currentToken = token) {
    try {
      const result = await api<{ organizations: OperatorOrganization[] }>('/api/operator/organizations', {
        headers: { authorization: `Bearer ${currentToken}` },
      });
      setOrganizations(result.organizations);
    } catch (err) {
      handleOperatorLoadError(err, 'Unable to load workspaces.');
    }
  }

  async function loadWorkspaceRequests(currentToken = token, nextOffset = 0, append = false) {
    try {
      const params = new URLSearchParams({ limit: '100', offset: String(nextOffset) });
      if (workspaceRequestStatus !== 'all') params.set('status', workspaceRequestStatus);
      const result = await api<{ requests: OperatorWorkspaceRequest[]; page?: PageMetadata }>(`/api/operator/workspace-requests?${params.toString()}`, {
        headers: { authorization: `Bearer ${currentToken}` },
      });
      setWorkspaceRequests((current) => (append ? [...current, ...result.requests] : result.requests));
      setWorkspaceRequestPage(result.page ?? null);
      setWorkspaceRequestForms((current) => {
        const next = { ...current };
        for (const request of result.requests) {
          if (!next[request.id]) {
            next[request.id] = {
              workspaceName: request.installation_or_command,
              workspaceSlug: request.preferred_workspace_slug ?? slugPreview(request.installation_or_command),
              expiresInDays: '14',
              operatorNote: '',
            };
          }
        }
        return next;
      });
    } catch (err) {
      handleOperatorLoadError(err, 'Unable to load workspace requests.');
    }
  }

  async function loadAuditEvents(currentToken = token, nextOffset = 0, append = false) {
    setAuditMessage('');
    setAuditLoading(true);
    const queryKey = auditSearch.trim();
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(nextOffset) });
      if (queryKey) params.set('search', queryKey);
      const result = await api<{ events: OperatorAuditEvent[]; page?: PageMetadata }>(`/api/operator/audit-events?${params.toString()}`, {
        headers: { authorization: `Bearer ${currentToken}` },
      });
      setAuditEvents((current) => (append ? [...current, ...result.events] : result.events));
      setAuditPage(result.page ?? null);
      setAuditQueryKey(queryKey);
      if (!result.events.length && !append) setAuditMessage('No operator audit events found.');
    } catch (err) {
      setAuditMessage(err instanceof Error ? err.message : 'Unable to load the operator audit.');
      handleOperatorLoadError(err, 'Unable to load the operator audit.');
    } finally {
      setAuditLoading(false);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ token: string }>('/api/operator/login', {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
      });
      writeSessionValue(operatorKey, result.token);
      setToken(result.token);
      setPassphrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operator login failed.');
    }
  }

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await api('/api/operator/organizations', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(organizationForm),
      });
      setOrganizationForm({ name: '', slug: '' });
      setMessage('Workspace created.');
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace creation failed.');
    }
  }

  async function createSetupCode(organization: OperatorOrganization) {
    setError('');
    setMessage('');
    const form = setupForms[organization.id] ?? { label: '', expiresInDays: '14' };
    try {
      const result = await api<{ code?: string; setupCode?: { code?: string } }>('/api/operator/organizations/' + organization.id + '/setup-codes', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          label: form.label,
          expiresInDays: Number(form.expiresInDays || '14'),
        }),
      });
      const code = result.code ?? result.setupCode?.code;
      if (!code) throw new Error('Setup code was created but not returned by the API.');
      setLastIssuedCode((current) => ({
        ...current,
        [organization.id]: {
          code,
          link: `${window.location.origin}${window.location.pathname}?workspace=${encodeURIComponent(organization.slug)}`,
        },
      }));
      setMessage(`Setup code issued for ${organization.name}.`);
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup code creation failed.');
    }
  }

  async function approveWorkspaceRequest(request: OperatorWorkspaceRequest) {
    setError('');
    setMessage('');
    const form = workspaceRequestForms[request.id] ?? {
      workspaceName: request.installation_or_command,
      workspaceSlug: request.preferred_workspace_slug ?? slugPreview(request.installation_or_command),
      expiresInDays: '14',
      operatorNote: '',
    };
    const confirmed = window.confirm(
      `Approve workspace request for ${request.installation_or_command}?\n\nThis sends the workspace link/setup information to the administrative contact email if notifications are enabled. Do not send to personal email unless authorized. Do not include CUI, counseling details, sensitive operational data, or official records.`,
    );
    if (!confirmed) return;
    try {
      const result = await api<{
        organization: Pick<WorkspaceContext, 'id' | 'slug' | 'name'> & { active: boolean };
        code: string;
        requestorNotificationStatus: string;
        notification?: {
          status: string;
          subject: string;
          text: string;
          mailtoUrl?: string;
        };
      }>(`/api/operator/workspace-requests/${request.id}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          workspaceName: form.workspaceName,
          workspaceSlug: form.workspaceSlug,
          expiresInDays: Number(form.expiresInDays || '14'),
          operatorNote: form.operatorNote,
        }),
      });
      setLastIssuedCode((current) => ({
        ...current,
        [result.organization.id]: {
          code: result.code,
          link: `${window.location.origin}${window.location.pathname}?workspace=${encodeURIComponent(result.organization.slug)}`,
        },
      }));
      setMessage(
        `Approved ${request.installation_or_command}. Notification ${result.requestorNotificationStatus}. ${
          result.notification?.mailtoUrl ? `Open mailto link: ${result.notification.mailtoUrl}` : result.notification?.text ?? ''
        }`,
      );
      await Promise.all([loadWorkspaceRequests(), loadOrganizations(), loadAuditEvents(token)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace request approval failed.');
    }
  }

  async function rejectWorkspaceRequest(request: OperatorWorkspaceRequest) {
    setError('');
    setMessage('');
    const form = workspaceRequestForms[request.id] ?? {
      workspaceName: request.installation_or_command,
      workspaceSlug: request.preferred_workspace_slug ?? slugPreview(request.installation_or_command),
      expiresInDays: '14',
      operatorNote: '',
    };
    if (form.operatorNote.trim().length < 3) {
      setError('Add an operator note before rejecting a request.');
      return;
    }
    const confirmed = window.confirm(`Reject workspace request for ${request.installation_or_command}?`);
    if (!confirmed) return;
    try {
      const result = await api<{ requestorNotificationStatus: string }>(`/api/operator/workspace-requests/${request.id}/reject`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ operatorNote: form.operatorNote }),
      });
      setMessage(`Rejected ${request.installation_or_command}. Requestor email ${result.requestorNotificationStatus}.`);
      await Promise.all([loadWorkspaceRequests(), loadAuditEvents(token)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace request rejection failed.');
    }
  }

  async function revokeSetupCode(codeId: string) {
    setError('');
    setMessage('');
    try {
      await api('/api/operator/setup-codes/' + codeId + '/revoke', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      setMessage('Setup code revoked.');
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup code revocation failed.');
    }
  }

  async function setWorkspaceActiveState(organization: OperatorOrganization, nextActive: boolean) {
    setError('');
    setMessage('');
    const actionLabel = nextActive ? 'reactivate' : 'suspend';
    const confirmation = window.prompt(
      `${nextActive ? 'Reactivating' : 'Suspending'} ${organization.name} will ${
        nextActive ? 'require every admin and member to sign in again.' : 'block workspace resolution, activation, device registration, and current member/admin sessions.'
      }\n\nType the workspace slug "${organization.slug}" to ${actionLabel} this workspace.`,
      '',
    );
    if (confirmation !== organization.slug) {
      setMessage(`Workspace ${actionLabel} cancelled.`);
      return;
    }
    try {
      await api(`/api/operator/organizations/${organization.id}/status`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ active: nextActive }),
      });
      setMessage(`Workspace ${nextActive ? 'reactivated' : 'suspended'}.`);
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Workspace ${actionLabel} failed.`);
    }
  }

  async function recoverLocalAdminPassphrase(organization: OperatorOrganization) {
    setError('');
    setMessage('');
    const form = recoveryForms[organization.id] ?? { passphrase: '', confirmPassphrase: '' };
    if (form.passphrase.length < 12) {
      setError('Recovery passphrase must be at least 12 characters.');
      return;
    }
    if (form.passphrase !== form.confirmPassphrase) {
      setError('Recovery passphrase confirmation does not match.');
      return;
    }
    const confirmed = window.confirm(
      `Set a new temporary local admin passphrase for ${organization.name}?\n\nThis is an emergency recovery action. Existing local admin sessions for this workspace will stop working. Deliver the temporary passphrase directly to the approved local lead.`,
    );
    if (!confirmed) return;
    try {
      await api(`/api/operator/organizations/${organization.id}/admin-passphrase`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ passphrase: form.passphrase }),
      });
      setRecoveryForms((current) => ({
        ...current,
        [organization.id]: { passphrase: '', confirmPassphrase: '' },
      }));
      setMessage('Temporary local admin recovery passphrase saved.');
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local admin recovery failed.');
    }
  }

  async function deleteWorkspace(organization: OperatorOrganization) {
    setError('');
    setMessage('');
    const confirmation = window.prompt(
      `Type the workspace slug "${organization.slug}" to permanently delete ${organization.name} and all of its data.`,
      '',
    );
    if (confirmation !== organization.slug) {
      setMessage('Workspace deletion cancelled.');
      return;
    }
    const reallyDelete = window.confirm(
      `Delete ${organization.name} now?\n\nThis permanently removes the workspace and all of its roster, locations, units, check-ins, setup codes, and admin credentials.`,
    );
    if (!reallyDelete) return;
    try {
      await api(`/api/operator/organizations/${organization.id}/delete`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmSlug: organization.slug }),
      });
      setMessage(`Workspace ${organization.name} deleted.`);
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace deletion failed.');
    }
  }

  async function openSuperuserAdmin(organization: OperatorOrganization) {
    setError('');
    setMessage('');
    const confirmed = window.confirm(
      `Open ${organization.name} as system administrator?\n\nThis starts an audited superuser admin session scoped to this workspace.`,
    );
    if (!confirmed) return;
    try {
      const result = await api<{ token: string; organization: WorkspaceContext | null; authMethod: string }>(
        `/api/operator/organizations/${organization.id}/admin-session`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        },
      );
      onSuperuserAdmin(result.token, result.organization ?? organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open workspace admin.');
    }
  }

  async function downloadWorkspaceExport(organization: OperatorOrganization) {
    setError('');
    setMessage('');
    const confirmed = window.confirm(
      `Download a safe JSON export for ${organization.name}?\n\nThis excludes setup codes, credential hashes, PIN hashes, device-token hashes, and detailed notes. Treat the file as controlled operational data.`,
    );
    if (!confirmed) return;
    try {
      const payload = await api<Record<string, unknown>>(`/api/operator/organizations/${organization.id}/export`, {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: 15000,
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const datestamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `deckplating-${organization.slug}-safe-export-${datestamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Safe export downloaded for ${organization.name}.`);
      await loadAuditEvents(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Safe export failed.');
    }
  }

  useEffect(() => {
    if (!token) return;
    void loadOrganizations(token);
    void loadAuditEvents(token);
  }, [token]);

  useEffect(() => {
    if (token) void loadWorkspaceRequests(token);
  }, [token, workspaceRequestStatus]);

  const filteredOrganizations = useMemo(
    () =>
      organizations.filter((organization) =>
        matchesSearch(workspaceSearch, [
          organization.name,
          organization.slug,
          organization.active ? 'active' : 'suspended',
          organization.onboarding?.readyForCheckins ? 'ready' : 'setup in progress',
          organization.onboarding?.lastCheckinTeamMemberName,
          organization.onboarding?.lastCheckinUnitName,
          organization.setupCodeSummary.activeUnused ? 'active setup code' : '',
        ]),
      ),
    [organizations, workspaceSearch],
  );

  const filteredWorkspaceRequests = useMemo(
    () =>
      workspaceRequests.filter((request) =>
        matchesSearch(workspaceRequestSearch, [
          request.id,
          request.installation_or_command,
          request.preferred_workspace_slug,
          request.lead_name,
          request.lead_role,
          request.official_contact_email,
          request.status,
          request.short_use_case,
          request.organizations?.name,
          request.organizations?.slug,
          request.operator_note,
        ]),
      ),
    [workspaceRequests, workspaceRequestSearch],
  );

  const filteredAuditEvents = useMemo(
    () =>
      auditEvents.filter((event) =>
        matchesSearch(auditSearch, [
          event.action,
          event.actor,
          event.organization?.name,
          event.organization?.slug,
          event.organization_id,
          event.created_at,
          JSON.stringify(event.detail ?? {}),
        ]),
      ),
    [auditEvents, auditSearch],
  );

  if (!token) {
    return (
      <main className="center-shell">
        <section className="panel">
          <p className="eyebrow">System administrator</p>
          <h1>Operator access</h1>
          <form onSubmit={login} className="stack">
            <label>
              Central operator passphrase
              <input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required />
            </label>
            <button className="primary">Unlock operator console</button>
            <button className="secondary" type="button" onClick={onClose}>
              Back and lock
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">System administrator</p>
          <h1>System Administration</h1>
        </div>
        <button
          className="secondary"
          onClick={() => {
            onClose();
          }}
        >
          Back and lock
        </button>
      </div>
      {message && <p className="notice">{message}</p>}
      {error && <p className="error">{error}</p>}
      <WhatChangedPanel audience="operator" />
      <section className="panel">
        <div className="screen-title inline-title">
          <div>
            <p className="eyebrow">Workspace requests</p>
            <h2>Approval queue</h2>
          </div>
          <button className="secondary" onClick={() => void loadWorkspaceRequests()}>
            Refresh requests
          </button>
        </div>
        <div className="filters">
          <input
            aria-label="Search workspace requests"
            placeholder="Search requests by command, lead, email, status, or request ID"
            value={workspaceRequestSearch}
            onChange={(event) => setWorkspaceRequestSearch(event.target.value)}
          />
          <select aria-label="Workspace request status" value={workspaceRequestStatus} onChange={(event) => setWorkspaceRequestStatus(event.target.value as typeof workspaceRequestStatus)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All requests</option>
          </select>
        </div>
        <div className="activity-list">
          {filteredWorkspaceRequests.map((request) => {
            const form = workspaceRequestForms[request.id] ?? {
              workspaceName: request.installation_or_command,
              workspaceSlug: request.preferred_workspace_slug ?? slugPreview(request.installation_or_command),
              expiresInDays: '14',
              operatorNote: '',
            };
            return (
              <article key={request.id} className="activity-row">
                <div className="activity-summary">
                  <div>
                    <strong>{request.installation_or_command}</strong>
                    <small>
                      {request.lead_name} - {request.lead_role} - {request.official_contact_email}
                    </small>
                    <small>
                      Requested {niceDateTime(request.created_at)} - Pilot start {niceDate(request.expected_pilot_start_date)} - RMT size {request.rmt_size}
                    </small>
                  </div>
                  <span className="status-pill">{request.status}</span>
                </div>
                <p className="muted">{request.short_use_case}</p>
                <div className="safe-summary">
                  Preferred slug: {request.preferred_workspace_slug ?? 'none'}.
                  Operator notice: {request.operator_notification_status ?? 'not recorded'}.
                  Requestor notice: {request.requestor_notification_status ?? 'not recorded'}.
                </div>
                {request.status === 'approved' && request.organizations && (
                  <p className="notice">
                    Approved workspace: {request.organizations.name} ({request.organizations.slug})
                  </p>
                )}
                {request.operator_note && <p className="warning-notice">Operator note: {request.operator_note}</p>}
                {request.status === 'pending' && (
                  <div className="stack">
                    <div className="filters">
                      <input
                        aria-label={`Workspace name for ${request.installation_or_command}`}
                        placeholder="Workspace name"
                        value={form.workspaceName}
                        onChange={(event) =>
                          setWorkspaceRequestForms((current) => ({
                            ...current,
                            [request.id]: {
                              ...form,
                              workspaceName: event.target.value,
                              workspaceSlug: form.workspaceSlug || slugPreview(event.target.value),
                            },
                          }))
                        }
                      />
                      <input
                        aria-label={`Workspace slug for ${request.installation_or_command}`}
                        placeholder="workspace-slug"
                        autoCapitalize="none"
                        value={form.workspaceSlug}
                        onChange={(event) =>
                          setWorkspaceRequestForms((current) => ({
                            ...current,
                            [request.id]: {
                              ...form,
                              workspaceSlug: slugPreview(event.target.value),
                            },
                          }))
                        }
                      />
                      <input
                        aria-label={`Setup code duration for ${request.installation_or_command}`}
                        inputMode="numeric"
                        placeholder="Setup code days"
                        value={form.expiresInDays}
                        onChange={(event) =>
                          setWorkspaceRequestForms((current) => ({
                            ...current,
                            [request.id]: {
                              ...form,
                              expiresInDays: event.target.value.replace(/\D/g, '').slice(0, 2) || '14',
                            },
                          }))
                        }
                      />
                    </div>
                    <textarea
                      aria-label={`Operator note for ${request.installation_or_command}`}
                      placeholder="Operator note, required for rejection and optional for approval"
                      value={form.operatorNote}
                      onChange={(event) =>
                        setWorkspaceRequestForms((current) => ({
                          ...current,
                          [request.id]: {
                            ...form,
                            operatorNote: event.target.value,
                          },
                        }))
                      }
                    />
                    <div className="action-row">
                      <button className="primary" onClick={() => void approveWorkspaceRequest(request)}>
                        Approve and send welcome
                      </button>
                      <button className="secondary danger-text" onClick={() => void rejectWorkspaceRequest(request)}>
                        Reject or needs info
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          {workspaceRequests.length > 0 && !filteredWorkspaceRequests.length && <p className="notice">No workspace requests match that search.</p>}
          {!workspaceRequests.length && <p className="notice">No workspace requests in this view.</p>}
        </div>
        {workspaceRequestPage?.hasMore && (
          <button
            className="secondary"
            onClick={() => void loadWorkspaceRequests(token, workspaceRequestPage.offset + workspaceRequestPage.returned, true)}
          >
            Load more requests
          </button>
        )}
      </section>
      <section className="panel">
        <h2>Create approved workspace</h2>
        <form onSubmit={createOrganization} className="stack">
          <input
            aria-label="New workspace name"
            placeholder="Workspace name"
            value={organizationForm.name}
            onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })}
          />
          <input
            aria-label="New workspace slug"
            placeholder="workspace-slug"
            autoCapitalize="none"
            value={organizationForm.slug}
            onChange={(event) => setOrganizationForm({ ...organizationForm, slug: event.target.value })}
          />
          <button className="primary">Create workspace</button>
        </form>
      </section>
      <section className="filters">
        <input
          aria-label="Search workspaces"
          placeholder="Search workspaces by name, slug, status, or latest activity"
          value={workspaceSearch}
          onChange={(event) => setWorkspaceSearch(event.target.value)}
        />
        <button className="secondary" onClick={() => void loadOrganizations()}>
          Refresh workspaces
        </button>
      </section>
      <section className="panel">
        <div className="screen-title inline-title">
          <div>
            <p className="eyebrow">Operator audit</p>
            <h2>Recent system administration actions</h2>
          </div>
          <button className="secondary" onClick={() => void loadAuditEvents()}>
            Refresh audit
          </button>
        </div>
        <div className="filters">
          <input
            aria-label="Search operator audit"
            placeholder="Search audit by action, workspace, or detail"
            value={auditSearch}
            onChange={(event) => setAuditSearch(event.target.value)}
          />
          <button className="secondary" onClick={() => void loadAuditEvents(token)}>
            Search audit
          </button>
        </div>
        {auditMessage && <p className="notice">{auditMessage}</p>}
        <div className="activity-list">
          {filteredAuditEvents.map((event) => (
            <article key={event.id} className="activity-row">
              <div className="activity-summary">
                <div>
                  <strong>{event.action.replace(/_/g, ' ')}</strong>
                  <small>
                    {event.organization?.name ?? 'System'} - {niceDateTime(event.created_at)}
                  </small>
                  {event.detail && <small>{JSON.stringify(event.detail)}</small>}
                </div>
                <span className="status-pill">{event.actor}</span>
              </div>
            </article>
          ))}
          {auditEvents.length > 0 && !filteredAuditEvents.length && <p className="notice">No audit events match that search.</p>}
        </div>
        {auditPage?.hasMore && auditQueryKey === auditSearch.trim() && (
          <button
            className="secondary"
            onClick={() => void loadAuditEvents(token, auditPage.offset + auditPage.returned, true)}
            disabled={auditLoading}
          >
            {auditLoading ? 'Loading...' : 'Load more audit events'}
          </button>
        )}
      </section>
      <section className="coverage-list">
        {filteredOrganizations.map((organization) => {
          const form = setupForms[organization.id] ?? { label: '', expiresInDays: '14' };
          const issued = lastIssuedCode[organization.id];
          return (
            <article key={organization.id} className="panel">
              <div className="screen-title inline-title">
                <div>
                  <p className="eyebrow">{organization.slug}</p>
                  <h2>{organization.name}</h2>
                </div>
                <span className="status-pill">
                  {organization.active ? (organization.onboarding?.readyForCheckins ? 'Active and ready' : 'Active setup in progress') : 'Suspended'}
                </span>
              </div>
              <dl className="mission-stats">
                <div>
                  <dt>Areas</dt>
                  <dd>{organization.onboarding?.areaCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Locations</dt>
                  <dd>{organization.onboarding?.locationCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>{organization.onboarding?.unitCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Team</dt>
                  <dd>{organization.onboarding?.teamMemberCount ?? 0}</dd>
                </div>
              </dl>
              <p className="muted">
                Status: {organization.active ? 'active' : 'suspended'}. Admin passphrase:{' '}
                {organization.onboarding?.organizationAdminConfigured ? 'configured' : 'not configured'}. Setup codes:{' '}
                {organization.setupCodeSummary.activeUnused} active unused, {organization.setupCodeSummary.used} used.
              </p>
              <p className="muted">
                Last check-in:{' '}
                {organization.onboarding?.lastCheckinAt
                  ? `${niceDateTime(organization.onboarding.lastCheckinAt)} by ${
                      organization.onboarding.lastCheckinTeamMemberName ?? 'unknown member'
                    } at ${organization.onboarding.lastCheckinUnitName ?? 'unknown command'}`
                  : 'none recorded yet'}.
              </p>
              <div className="filters">
                <input
                  aria-label={`Setup code label for ${organization.name}`}
                  placeholder="Lead or request label"
                  value={form.label}
                  onChange={(event) =>
                    setSetupForms((current) => ({
                      ...current,
                      [organization.id]: { ...form, label: event.target.value },
                    }))
                  }
                />
                <input
                  aria-label={`Setup code duration in days for ${organization.name}`}
                  inputMode="numeric"
                  placeholder="14"
                  value={form.expiresInDays}
                  onChange={(event) =>
                    setSetupForms((current) => ({
                      ...current,
                      [organization.id]: { ...form, expiresInDays: event.target.value.replace(/\D/g, '').slice(0, 2) || '14' },
                    }))
                  }
                />
                <button className="secondary" onClick={() => void createSetupCode(organization)}>
                  Issue setup code
                </button>
                <button
                  className={organization.active ? 'secondary danger-text' : 'secondary'}
                  onClick={() => void setWorkspaceActiveState(organization, !organization.active)}
                >
                  {organization.active ? 'Suspend workspace' : 'Reactivate workspace'}
                </button>
                <button
                  className="secondary"
                  onClick={() => void openSuperuserAdmin(organization)}
                  disabled={!organization.active}
                >
                  Open admin as system administrator
                </button>
                <button className="secondary" onClick={() => void downloadWorkspaceExport(organization)}>
                  Download safe export
                </button>
                <button className="secondary danger-text" onClick={() => void deleteWorkspace(organization)}>
                  Delete workspace and data
                </button>
              </div>
              <div className="stack">
                <p className="muted">
                  Emergency local admin recovery: set a temporary workspace-admin passphrase, then deliver it directly to the approved local lead.
                </p>
                <input
                  type="password"
                  autoComplete="new-password"
                  aria-label={`Temporary recovery passphrase for ${organization.name}`}
                  placeholder="Temporary recovery passphrase"
                  value={recoveryForms[organization.id]?.passphrase ?? ''}
                  minLength={12}
                  onChange={(event) =>
                    setRecoveryForms((current) => ({
                      ...current,
                      [organization.id]: {
                        ...(current[organization.id] ?? { passphrase: '', confirmPassphrase: '' }),
                        passphrase: event.target.value,
                      },
                    }))
                  }
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  aria-label={`Confirm recovery passphrase for ${organization.name}`}
                  placeholder="Confirm recovery passphrase"
                  value={recoveryForms[organization.id]?.confirmPassphrase ?? ''}
                  minLength={12}
                  onChange={(event) =>
                    setRecoveryForms((current) => ({
                      ...current,
                      [organization.id]: {
                        ...(current[organization.id] ?? { passphrase: '', confirmPassphrase: '' }),
                        confirmPassphrase: event.target.value,
                      },
                    }))
                  }
                />
                <button className="secondary" onClick={() => void recoverLocalAdminPassphrase(organization)}>
                  Set temporary recovery passphrase
                </button>
              </div>
              {issued && (
                <div className="notice">
                  Setup link: {issued.link}
                  <br />
                  Setup code: {issued.code}
                </div>
              )}
              <div className="activity-list">
                {organization.setupCodes.map((code) => (
                  <article key={code.id} className="activity-row">
                    <div className="activity-summary">
                      <div>
                        <strong>{code.label || 'Setup code'}</strong>
                        <small>
                          {code.used_at ? `Used ${niceDateTime(code.used_at)}` : `Expires ${niceDateTime(code.expires_at)}`}
                        </small>
                      </div>
                      {!code.used_at && code.active ? (
                        <button className="secondary danger-text" onClick={() => void revokeSetupCode(code.id)}>
                          Revoke
                        </button>
                      ) : (
                        <span className="status-pill">{code.used_at ? 'Used' : 'Inactive'}</span>
                      )}
                    </div>
                  </article>
                ))}
                {!organization.setupCodes.length && <p className="notice">No setup codes issued yet.</p>}
              </div>
            </article>
          );
        })}
        {organizations.length > 0 && !filteredOrganizations.length && <p className="notice">No workspaces match that search.</p>}
      </section>
      <nav className="bottom-nav">
        <button className="active">Operator</button>
        <button onClick={onClose}>Back and lock</button>
      </nav>
    </main>
  );
}

function CheckInScreen({
  identity,
  bootstrap,
  cachedMode,
  gamificationTone,
  refresh,
  onPendingChanged,
}: {
  identity: Identity;
  bootstrap: Bootstrap;
  cachedMode: boolean;
  gamificationTone: GamificationTone;
  refresh: () => void;
  onPendingChanged: () => void;
}) {
  const [coords, setCoords] = useState<{ lat: number; lon: number; accuracyMeters: number } | null>(null);
  const [matches, setMatches] = useState<LocationSummary[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualLocationId, setManualLocationId] = useState('');
  const [manualQuery, setManualQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<CheckinConfirmation | null>(null);
  const [unlockedBadges, setUnlockedBadges] = useState<MissionBadge[]>([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const cancelLocationRequest = useRef<(() => void) | null>(null);
  const locationRequestId = useRef(0);
  const brief = useMemo(() => briefForDate(identity.teamMemberId), [identity.teamMemberId]);
  const locationSummaries = useMemo(() => getCachedLocationSummaries(bootstrap.units), [bootstrap.units]);
  const unmappedUnits = bootstrap.units.filter((unit) => !unit.location_id);

  async function locate() {
    const requestId = locationRequestId.current + 1;
    locationRequestId.current = requestId;
    cancelLocationRequest.current?.();
    cancelLocationRequest.current = null;
    setMessage('');
    setConfirmation(null);
    setLocating(true);
    setManualMode(false);
    if (!navigator.geolocation) {
      setLocating(false);
      setMessage('Location is not available on this device. Use manual unit lookup.');
      setManualMode(true);
      return;
    }
    cancelLocationRequest.current = acquireFreshPosition(
      async (position) => {
        if (locationRequestId.current !== requestId) return;
        cancelLocationRequest.current = null;
        const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0;
        const next = { lat: position.coords.latitude, lon: position.coords.longitude, accuracyMeters: accuracy };
        setCoords(next);
        try {
          const cachedMatches = findCachedNearbyLocations(bootstrap.units, next.lat, next.lon, accuracy);
          const result = cachedMode
            ? { matches: cachedMatches }
            : await api<{ matches: LocationSummary[] }>(`/api/nearby-locations?lat=${next.lat}&lon=${next.lon}&accuracy=${accuracy}`, {
                headers: authHeaders(identity),
                timeoutMs: 3500,
              });
          if (locationRequestId.current !== requestId) return;
          const matches = result.matches.length ? result.matches : cachedMatches;
          setMatches(matches);
          setSelected(matches[0]?.units.map((unit) => unit.id) ?? []);
          if (!matches.length) {
            setManualMode(true);
            setMessage(`No saved locations nearby. GPS accuracy: ${Math.round(accuracy)}m. Manual lookup is available.`);
          }
        } catch (err) {
          if (locationRequestId.current !== requestId) return;
          const cachedMatches = findCachedNearbyLocations(bootstrap.units, next.lat, next.lon, accuracy);
          setMatches(cachedMatches);
          setSelected(cachedMatches[0]?.units.map((unit) => unit.id) ?? []);
          if (!cachedMatches.length) setManualMode(true);
          setMessage(
            cachedMatches.length
              ? `Using cached location data. GPS accuracy: ${Math.round(accuracy)}m.`
              : `No saved locations nearby. GPS accuracy: ${Math.round(accuracy)}m. Manual lookup is available.`,
          );
        } finally {
          if (locationRequestId.current === requestId) setLocating(false);
        }
      },
      (error) => {
        if (locationRequestId.current !== requestId) return;
        cancelLocationRequest.current = null;
        setLocating(false);
        setManualMode(true);
        const reason =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was not granted.'
            : error.code === error.POSITION_UNAVAILABLE
              ? 'A current location could not be determined.'
              : 'Location timed out.';
        setMessage(`${reason} Use manual unit lookup.`);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }

  function startManualLookup() {
    setManualMode(true);
    setSelected([]);
    setMessage('');
  }

  function selectedUnitsForSubmit() {
    return bootstrap.units.filter((unit) => selected.includes(unit.id));
  }

  async function queueBatch(batch: PendingVisitBatch) {
    await savePendingBatch(batch);
    onPendingChanged();
    setConfirmation({
      clientBatchId: batch.clientBatchId,
      checkinIds: [],
      units: batch.unitNames,
      locationId: batch.locationId,
      locationName: batch.locationName,
      checkedInAt: batch.occurredAt,
      totalScore: 0,
      syncStatus: 'queued',
      indicators: {
        confidentialCareProvided: batch.confidentialCareProvided,
        referralProvided: batch.referralProvided,
      },
    });
    setMessage('Saved on this device. Waiting to upload.');
  }

  async function submit(manual = false) {
    if (!selected.length) return;
    setLoading(true);
    setMessage('');
    setConfirmation(null);
    setUnlockedBadges([]);
    const selectedUnits = selectedUnitsForSubmit();
    const locationIds = Array.from(new Set(selectedUnits.map((unit) => unit.location_id ?? null)));
    if (locationIds.length > 1) {
      setLoading(false);
      setMessage('Choose units from one location per visit.');
      return;
    }
    if (locationIds[0] === null && selectedUnits.length > 1) {
      setLoading(false);
      setMessage('Unmapped units must be checked in one at a time.');
      return;
    }
    const occurredAt = new Date().toISOString();
    const clientBatchId = crypto.randomUUID();
    const locationId = locationIds[0] ?? null;
    const locationName = selectedUnits[0]?.location_name ?? null;
    const pendingBatch: PendingVisitBatch = {
      clientBatchId,
      organizationId: identity.organizationId ?? null,
      teamMemberId: identity.teamMemberId,
      teamMemberName: identity.teamMemberName,
      deviceToken: identity.deviceToken,
      unitIds: selected,
      unitNames: selectedUnits.map((unit) => unit.name),
      locationId,
      locationName,
      latitude: coords?.lat,
      longitude: coords?.lon,
      accuracyMeters: coords?.accuracyMeters,
      manual,
      occurredAt,
      confidentialCareProvided: null,
      referralProvided: null,
      syncStatus: 'pending',
      lastSyncError: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    if (cachedMode || !navigator.onLine) {
      try {
        await queueBatch(pendingBatch);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to save this visit on the device.');
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const result = await api<{
        batchId: string;
        clientBatchId: string;
        locationId: string | null;
        checkins: Array<{ id: string; score_awarded: number }>;
        totalScore: number;
        indicators: VisitIndicatorState;
      }>('/api/checkins', {
        method: 'POST',
        headers: authHeaders(identity),
        body: JSON.stringify({
          teamMemberId: identity.teamMemberId,
          deviceToken: identity.deviceToken,
          clientBatchId,
          occurredAt,
          locationId,
          unitIds: selected,
          latitude: coords?.lat,
          longitude: coords?.lon,
          accuracyMeters: coords?.accuracyMeters,
          manual,
          confidentialCareProvided: null,
          referralProvided: null,
        }),
        timeoutMs: 4500,
      });
      setConfirmation({
        clientBatchId: result.clientBatchId,
        checkinIds: result.checkins.map((checkin) => checkin.id),
        units: selectedUnits.map((unit) => unit.name),
        locationId: result.locationId,
        locationName,
        checkedInAt: occurredAt,
        totalScore: result.totalScore,
        syncStatus: 'synced',
        indicators: result.indicators,
      });
      void loadNewBadgeCelebrations();
      refresh();
    } catch (err) {
      if (isNetworkFailure(err)) {
        try {
          await queueBatch(pendingBatch);
        } catch (storageError) {
          setMessage(storageError instanceof Error ? storageError.message : 'Unable to save this visit on the device.');
        }
      } else {
        setMessage(err instanceof Error ? err.message : 'Check-in failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadNewBadgeCelebrations() {
    if (!navigator.onLine) return;
    try {
      const month = localDateKey().slice(0, 7);
      const result = await api<{ rows: LeaderboardRow[] }>(leaderboardPath(month), {
        headers: authHeaders(identity),
        timeoutMs: 5000,
      });
      const row = result.rows.find((candidate) => candidate.team_member_id === identity.teamMemberId);
      if (!row?.badges.length) return;
      const celebrated = readCelebratedBadges();
      const fresh = row.badges.filter((badge) => !celebrated[celebrationKey(identity.teamMemberId, month, badge)]);
      if (!fresh.length) return;
      for (const badge of fresh) celebrated[celebrationKey(identity.teamMemberId, month, badge)] = true;
      writeStoredJson(badgeCelebrationsKey, celebrated);
      setUnlockedBadges(fresh);
    } catch {
      setUnlockedBadges([]);
    }
  }

  async function undoCheckin() {
    if (!confirmation) return;
    if (confirmation.syncStatus === 'queued') {
      try {
        const pending = await getPendingBatch(confirmation.clientBatchId);
        const ownedPending = pending &&
          pending.teamMemberId === identity.teamMemberId &&
          (pending.organizationId ?? null) === (identity.organizationId ?? null)
          ? pending
          : null;
        if (ownedPending) {
          await removePendingBatch(confirmation.clientBatchId);
          setConfirmation(null);
          setUnlockedBadges([]);
          setSelected([]);
          setMessage('Queued visit removed from this device.');
          onPendingChanged();
          return;
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to inspect the queued visit on this device.');
        return;
      }
    }
    if (!navigator.onLine) {
      setMessage('Reconnect to undo an uploaded check-in.');
      return;
    }
    if (!window.confirm('Undo this check-in? The records will be voided and removed from active coverage and score calculations.')) return;
    setLoading(true);
    setMessage('');
    try {
      await api('/api/checkins/undo', {
        method: 'POST',
        headers: authHeaders(identity),
        body: JSON.stringify({
          teamMemberId: identity.teamMemberId,
          ...(confirmation.checkinIds.length
            ? { checkinIds: confirmation.checkinIds }
            : { clientBatchId: confirmation.clientBatchId }),
        }),
      });
      setConfirmation(null);
      setUnlockedBadges([]);
      setSelected([]);
      setMessage('Check-in undone. Coverage and scores have been refreshed.');
      refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Undo failed.');
    } finally {
      setLoading(false);
    }
  }

  async function updateIndicators(next: VisitIndicatorState) {
    if (!confirmation) return;
    setConfirmation({ ...confirmation, indicators: next });
    if (confirmation.syncStatus === 'queued') {
      try {
        const pending = await getPendingBatch(confirmation.clientBatchId);
        if (
          pending &&
          pending.teamMemberId === identity.teamMemberId &&
          (pending.organizationId ?? null) === (identity.organizationId ?? null)
        ) {
          const updated = await updatePendingBatchIndicators(confirmation.clientBatchId, next, identity.organizationId ?? null);
          if (!updated) throw new Error('The queued visit is no longer available on this device.');
          return;
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to update the saved visit on this device.');
        return;
      }
      if (!navigator.onLine) {
        setMessage('Reconnect to update a visit that has already uploaded.');
        return;
      }
    }
    try {
      await api(`/api/checkin-batches/${confirmation.clientBatchId}/indicators`, {
        method: 'PATCH',
        headers: authHeaders(identity),
        body: JSON.stringify(indicatorPayload(next)),
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Indicator update will need to be retried when online.');
    }
  }

  useEffect(() => {
    void locate();
    return () => {
      locationRequestId.current += 1;
      cancelLocationRequest.current?.();
      cancelLocationRequest.current = null;
    };
  }, []);

  useEffect(() => {
    const handleBatchSynced = (event: Event) => {
      const detail = (event as CustomEvent<BatchSyncedDetail>).detail;
      if (
        !detail ||
        detail.teamMemberId !== identity.teamMemberId ||
        detail.organizationId !== (identity.organizationId ?? null)
      ) {
        return;
      }
      setConfirmation((current) =>
        current?.clientBatchId === detail.clientBatchId
          ? {
              ...current,
              checkinIds: detail.checkinIds,
              totalScore: detail.totalScore,
              syncStatus: 'synced',
            }
          : current,
      );
    };
    window.addEventListener(batchSyncedEvent, handleBatchSynced);
    return () => window.removeEventListener(batchSyncedEvent, handleBatchSynced);
  }, [identity.organizationId, identity.teamMemberId]);

  const activeLocation = manualMode ? undefined : matches[0];
  const manualLocationMatches = locationSummaries.filter((location) =>
    matchesSearch(manualQuery, [
      location.name,
      location.area_name,
      ...location.units.flatMap((unit) => [unit.name, unitTypeLabel[unit.unit_type], statusLabel(unit)]),
    ]),
  );
  const manualUnmappedMatches = unmappedUnits.filter((unit) =>
    matchesSearch(manualQuery, [unit.name, unit.area_name, unit.location_name, unitTypeLabel[unit.unit_type], statusLabel(unit)]),
  );

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Check In</p>
          <h1>{identity.teamMemberName}</h1>
        </div>
        <button className="secondary" onClick={locate} disabled={locating}>
          {locating ? 'Locating...' : 'Locate Me'}
        </button>
      </div>

      {activeLocation ? (
        <section className="panel">
          <p className="eyebrow">{activeLocation.area_name}</p>
          <h2>{activeLocation.name}</h2>
          <p className="muted">{Math.round(activeLocation.distance_meters ?? 0)} meters away</p>
          <div className="unit-picker">
            {activeLocation.units.map((unit) => (
              <label key={unit.id} className={`check-row ${unit.status}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(unit.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked ? [...current, unit.id] : current.filter((id) => id !== unit.id),
                    )
                  }
                />
                <span>
                  <strong>{unit.name}</strong>
                  <small>
                    {statusLabel(unit)} - Last visit {niceDate(unit.last_visit_at)}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <button className="primary big" onClick={() => submit(false)} disabled={loading || !selected.length}>
            Check In
          </button>
          <button className="secondary" type="button" onClick={startManualLookup} disabled={loading}>
            Choose another location or unit
          </button>
        </section>
      ) : (
        <section className="panel">
          <h2>{matches.length ? 'Choose another location or unit' : 'No saved location nearby'}</h2>
          <p className="muted">
            {matches.length
              ? 'Search all saved locations or choose an unmapped unit.'
              : 'Use manual lookup when the unit is not mapped or GPS is unavailable.'}
          </p>
          {!manualMode && <button className="secondary" onClick={startManualLookup}>
            Manual unit lookup
          </button>}
          {manualMode && (
            <div className="unit-picker">
              <input
                aria-label="Search locations and units"
                placeholder="Search units"
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
              />
              <select aria-label="Manual check-in location" value={manualLocationId} onChange={(event) => {
                setManualLocationId(event.target.value);
                setSelected([]);
              }}>
                <option value="">Choose mapped location</option>
                {manualLocationMatches.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} - {location.area_name}
                  </option>
                ))}
                <option value="unmapped">Unmapped unit</option>
              </select>
              {manualLocationId && manualLocationId !== 'unmapped' &&
                locationSummaries.find((location) => location.id === manualLocationId)?.units.map((unit) => (
                  <label key={unit.id} className={`check-row ${unit.status}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(unit.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked ? [...current, unit.id] : current.filter((id) => id !== unit.id),
                        )
                      }
                    />
                    <span>
                      <strong>{unit.name}</strong>
                      <small>{unit.location_name} - manual</small>
                    </span>
                  </label>
                ))}
              {manualLocationId === 'unmapped' &&
                manualUnmappedMatches.map((unit) => (
                  <label key={unit.id} className={`check-row ${unit.status}`}>
                    <input
                      type="radio"
                      name="unmapped-unit"
                      checked={selected.includes(unit.id)}
                      onChange={() => setSelected([unit.id])}
                    />
                    <span>
                      <strong>{unit.name}</strong>
                      <small>Unmapped - manual</small>
                    </span>
                  </label>
                ))}
              <button className="primary big" onClick={() => submit(true)} disabled={!selected.length || loading}>
                Submit Manual Check-In
              </button>
            </div>
          )}
          <p className="admin-hint">Admin-only Create Location is available on the Admin tab.</p>
        </section>
      )}
      {confirmation && (
        <section className="panel confirmation-panel">
          <p className="eyebrow">{confirmation.syncStatus === 'queued' ? 'Saved on this device' : 'Check-in saved'}</p>
          <h2>{confirmation.units.length} unit{confirmation.units.length === 1 ? '' : 's'} checked in</h2>
          <ul className="plain-list">
            {confirmation.units.map((unit) => (
              <li key={unit}>{unit}</li>
            ))}
          </ul>
          <dl className="confirmation-details">
            <div>
              <dt>Date/time</dt>
              <dd>{niceDateTime(confirmation.checkedInAt)}</dd>
            </div>
            <div>
              <dt>Points awarded</dt>
              <dd>{confirmation.syncStatus === 'queued' ? 'Waiting to upload' : confirmation.totalScore}</dd>
            </div>
          </dl>
          <section className="mission-nudge">
            <p className="eyebrow">Mission nudge</p>
            <p>
              {missionNudge(
                gamificationTone,
                confirmation.totalScore >= 3 ? 'recovery' : missionContextFromUnits(selectedUnitsForSubmit()),
                `${confirmation.clientBatchId}:${confirmation.totalScore}`,
              )}
            </p>
          </section>
          {unlockedBadges.length > 0 && (
            <section className="achievement-card">
              <p className="eyebrow">Achievement unlocked</p>
              <div className="achievement-list">
                {unlockedBadges.slice(0, 2).map((badge) => (
                  <article key={badge} className="badge-card">
                    <span className="badge-icon">{badgeDetails[badge].icon}</span>
                    <div>
                      <strong>{badgeDetails[badge].title}</strong>
                      <small>{badgeDetails[badge].description}</small>
                    </div>
                  </article>
                ))}
              </div>
              {unlockedBadges.length > 2 && <small>+{unlockedBadges.length - 2} more on Mission Board</small>}
            </section>
          )}
          {ministryIndicatorsEnabled && (
            <section className="optional-indicators">
              <h3>Optional visit flags</h3>
              <p className="muted">Generic yes/no flags only. Do not add names, circumstances, notes, medical information, or other sensitive information.</p>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={confirmation.indicators.confidentialCareProvided === true}
                  onChange={(event) =>
                    updateIndicators({ ...confirmation.indicators, confidentialCareProvided: event.target.checked ? true : null })
                  }
                />
                Follow-up flag
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={confirmation.indicators.referralProvided === true}
                  onChange={(event) =>
                    updateIndicators({ ...confirmation.indicators, referralProvided: event.target.checked ? true : null })
                  }
                />
                External support flag
              </label>
            </section>
          )}
          <section className="brief-card">
            <p className="eyebrow">Deckplate Brief</p>
            <p>{brief.text}</p>
            <small>
              {brief.attribution} - {brief.sourceTitle}
            </small>
          </section>
          <div className="action-row">
            <button className="secondary danger-text" onClick={undoCheckin} disabled={loading}>
              Undo this check-in
            </button>
            <button
              className="primary"
              onClick={() => {
                setConfirmation(null);
                setUnlockedBadges([]);
                setSelected([]);
              }}
              disabled={loading}
            >
              Done
            </button>
          </div>
        </section>
      )}
      {message && <p className="notice">{message}</p>}
    </main>
  );
}

function SyncStatusBar({
  state,
  pendingCount,
  cachedAt,
  message,
  updateReady,
  canReload,
  onSyncNow,
  onReload,
}: {
  state: SyncState;
  pendingCount: number;
  cachedAt: string | null;
  message: string;
  updateReady: boolean;
  canReload: boolean;
  onSyncNow: () => void;
  onReload: () => void;
}) {
  const label =
    pendingCount > 0
      ? `${pendingCount} visit${pendingCount === 1 ? '' : 's'} waiting to upload`
      : state === 'auth'
        ? 'Sync needs PIN refresh'
        : state === 'failed'
          ? 'Sync failed - retry available'
          : state === 'offline'
            ? 'Offline - cached data'
            : 'Online and synced';
  return (
    <div className={`sync-bar ${state}`}>
      <span role="status" aria-live="polite">
        {label}
        {cachedAt ? ` - Last synced ${niceDateTime(cachedAt)}` : ''}
        {message && pendingCount === 0 ? ` - ${message}` : ''}
      </span>
      <button className="secondary" onClick={onSyncNow}>
        Sync Now
      </button>
      {updateReady && (
        <button className="secondary" onClick={onReload} disabled={!canReload}>
          Update available
        </button>
      )}
    </div>
  );
}

function MissionBrief({
  units,
  tone,
  recentRecovery,
}: {
  units: UnitSummary[];
  tone: GamificationTone;
  recentRecovery: boolean;
}) {
  const today = localDateKey();
  const [expanded, setExpanded] = useState(() => readLocalValue(missionBriefDateKey) !== today);
  const context = missionContextFromUnits(units, recentRecovery);
  const counts = useMemo(
    () => ({
      gray: units.filter((unit) => unit.status === 'gray').length,
      red: units.filter((unit) => unit.status === 'red').length,
      yellow: units.filter((unit) => unit.status === 'yellow').length,
    }),
    [units],
  );
  const message = useMemo(
    () => missionNudge(tone, context, `${today}:${context}:${counts.gray}:${counts.red}:${counts.yellow}`),
    [context, counts.gray, counts.red, counts.yellow, today, tone],
  );

  useEffect(() => {
    if (!expanded) return;
    writeLocalValue(missionBriefDateKey, today);
    const timeout = window.setTimeout(() => setExpanded(false), 9000);
    return () => window.clearTimeout(timeout);
  }, [expanded, today]);

  return (
    <section className={`mission-brief ${expanded ? 'expanded' : 'collapsed'}`}>
      {expanded ? (
        <>
          <div>
            <p className="eyebrow">Mission Brief</p>
            <p>{message}</p>
          </div>
          <button className="secondary" onClick={() => setExpanded(false)} aria-label="Collapse Mission Brief">
            Close
          </button>
        </>
      ) : (
        <button className="mission-brief-pill" onClick={() => setExpanded(true)}>
          Mission Brief
        </button>
      )}
    </section>
  );
}

function CoverageBoard({
  identity,
  areas,
  units,
  cachedAt,
  cachedMode,
  gamificationTone,
}: {
  identity: Identity;
  areas: Area[];
  units: UnitSummary[];
  cachedAt: string | null;
  cachedMode: boolean;
  gamificationTone: GamificationTone;
}) {
  const [area, setArea] = useState('');
  const [unitType, setUnitType] = useState('');
  const [unitSearch, setUnitSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [neverOnly, setNeverOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<UnitSummary | null>(null);
  const [detail, setDetail] = useState<CoverageDetail | null>(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [reportRows, setReportRows] = useState<IndicatorReportRow[]>([]);
  const [reportMessage, setReportMessage] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSearch, setReportSearch] = useState('');
  const [reportFrom, setReportFrom] = useState(localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [reportTo, setReportTo] = useState(localDateKey());
  const detailRequest = useRef<AbortController | null>(null);

  const filtered = useMemo(() => {
    const fromBoundary = from ? localDayBoundaryIso(from) : '';
    const toBoundary = to ? localDayBoundaryIso(to, true) : '';
    return units
      .filter((unit) => !area || unit.area_id === area)
      .filter((unit) => !unitType || unit.unit_type === unitType)
      .filter((unit) => !overdueOnly || unit.status === 'red')
      .filter((unit) => !neverOnly || unit.status === 'gray')
      .filter((unit) => !fromBoundary || (unit.last_visit_at && unit.last_visit_at >= fromBoundary))
      .filter((unit) => !toBoundary || (unit.last_visit_at && unit.last_visit_at <= toBoundary))
      .filter((unit) =>
        matchesSearch(unitSearch, [
          unit.name,
          unit.location_name,
          unit.area_name,
          unitTypeLabel[unit.unit_type],
          statusLabel(unit),
          unit.last_visitor,
        ]),
      )
      .sort((a, b) => {
        const rank = { gray: 4, red: 3, yellow: 2, green: 1 };
        return rank[b.status] - rank[a.status] || a.name.localeCompare(b.name);
      });
  }, [area, from, neverOnly, overdueOnly, to, unitSearch, unitType, units]);

  const filteredReportRows = useMemo(
    () =>
      reportRows.filter((row) =>
        matchesSearch(reportSearch, [row.location_name, row.area_name, row.visits, row.confidential_care_count, row.referral_count]),
      ),
    [reportRows, reportSearch],
  );

  const missionSummary = useMemo(() => {
    const neverVisited = units.filter((unit) => unit.status === 'gray').length;
    const overdue = units.filter((unit) => unit.status === 'red').length;
    const dueSoon = units.filter((unit) => unit.status === 'yellow').length;
    const current = units.filter((unit) => unit.status === 'green').length;
    const topNeeds = units
      .filter((unit) => unit.status === 'gray' || unit.status === 'red' || unit.status === 'yellow')
      .sort((a, b) => {
        const rank = { gray: 3, red: 2, yellow: 1, green: 0 };
        return rank[b.status] - rank[a.status] || (b.days_since_last_visit ?? 9999) - (a.days_since_last_visit ?? 9999);
      })
      .slice(0, 3);
    return { neverVisited, overdue, dueSoon, current, topNeeds };
  }, [units]);

  async function openUnit(unit: UnitSummary) {
    detailRequest.current?.abort();
    detailRequest.current = null;
    setSelectedUnit(unit);
    setDetail(null);
    setDetailMessage('Loading recent check-ins...');
    if (cachedMode || !navigator.onLine) {
      setDetailMessage('Recent check-ins need a live connection.');
      return;
    }
    const controller = new AbortController();
    detailRequest.current = controller;
    try {
      const result = await api<CoverageDetail>(`/api/coverage-detail?unitId=${unit.id}`, {
        headers: authHeaders(identity),
        timeoutMs: 5000,
        signal: controller.signal,
      });
      if (detailRequest.current !== controller) return;
      setDetail(result);
      setDetailMessage('');
    } catch (err) {
      if (controller.signal.aborted) return;
      setDetailMessage(err instanceof Error ? err.message : 'Unable to load recent check-ins.');
    } finally {
      if (detailRequest.current === controller) detailRequest.current = null;
    }
  }

  async function loadReport() {
    if (!ministryIndicatorsEnabled) return;
    if (reportFrom && reportTo && reportFrom > reportTo) {
      setReportMessage('The report start date must be on or before the end date.');
      return;
    }
    if (cachedMode || !navigator.onLine) {
      setReportMessage('Visit flag reporting needs a live connection.');
      return;
    }
    setReportMessage('');
    setReportLoading(true);
    try {
      const params = new URLSearchParams();
      if (reportFrom) {
        params.set('from', reportFrom);
        params.set('fromIso', localDayBoundaryIso(reportFrom));
      }
      if (reportTo) {
        params.set('to', reportTo);
        params.set('toIso', localDayBoundaryIso(reportTo, true));
      }
      const result = await api<{ rows: IndicatorReportRow[] }>(`/api/reports/indicators?${params.toString()}`, {
        headers: authHeaders(identity),
        timeoutMs: 6000,
      });
      setReportRows(result.rows);
      if (!result.rows.length) setReportMessage('No indicator activity found for this date range.');
    } catch (err) {
      setReportMessage(err instanceof Error ? err.message : 'Unable to load indicator report.');
    } finally {
      setReportLoading(false);
    }
  }

  function closeUnitDetail() {
    detailRequest.current?.abort();
    detailRequest.current = null;
    setSelectedUnit(null);
    setDetail(null);
    setDetailMessage('');
  }

  useEffect(() => () => detailRequest.current?.abort(), []);

  function renderUnitDetail(unit: UnitSummary) {
    if (selectedUnit?.id !== unit.id) return null;
    return (
      <section className="panel detail-panel inline-detail-panel">
        <div className="screen-title inline-title">
          <div>
            <p className="eyebrow">Command detail</p>
            <h2>{selectedUnit.name}</h2>
          </div>
          <button className="secondary" onClick={closeUnitDetail}>
            Close
          </button>
        </div>
        <dl className="confirmation-details">
          <div>
            <dt>Status</dt>
            <dd>{statusLabel(selectedUnit)}</dd>
          </div>
          <div>
            <dt>Last visit</dt>
            <dd>{niceDate(selectedUnit.last_visit_at)}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{selectedUnit.location_name ?? 'Unmapped'}</dd>
          </div>
          <div>
            <dt>Visitor</dt>
            <dd>{selectedUnit.last_visitor ?? 'None'}</dd>
          </div>
        </dl>
        {detailMessage && <p className="notice">{detailMessage}</p>}
        {detail && (
          <div className="activity-list">
            {detail.checkins.map((checkin) => (
              <article key={checkin.id} className={`activity-row ${checkin.voided_at ? 'voided' : ''}`}>
                <div className="activity-summary">
                  <div>
                    <strong>{niceDateTime(checkin.checked_in_at)}</strong>
                    <small>
                      {checkin.team_member_name} - {checkin.geofence_verified ? 'geofence verified' : 'manual/unverified'} -{' '}
                      {checkin.score_awarded} point{checkin.score_awarded === 1 ? '' : 's'}
                    </small>
                  </div>
                  {checkin.voided_at && <span className="status-pill">Voided</span>}
                  {ministryIndicatorsEnabled && (checkin.confidential_care_provided || checkin.referral_provided) && (
                    <span className="status-pill">
                      {checkin.confidential_care_provided ? 'Follow-up' : ''}
                      {checkin.confidential_care_provided && checkin.referral_provided ? ' / ' : ''}
                      {checkin.referral_provided ? 'External support' : ''}
                    </span>
                  )}
                </div>
              </article>
            ))}
            {!detail.checkins.length && <p className="notice">No check-ins recorded for this command.</p>}
          </div>
        )}
      </section>
    );
  }

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Coverage Board</p>
          <h1>Needs attention first</h1>
          {cachedAt && <small>Last synced {niceDateTime(cachedAt)}</small>}
        </div>
      </div>
      <section className="filters">
        <input
          aria-label="Search coverage"
          className="filter-search"
          placeholder="Search units, locations, or visitors"
          value={unitSearch}
          onChange={(event) => setUnitSearch(event.target.value)}
        />
        <select aria-label="Filter coverage by area" value={area} onChange={(event) => setArea(event.target.value)}>
          <option value="">All areas</option>
          {areas.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter coverage by unit type" value={unitType} onChange={(event) => setUnitType(event.target.value)}>
          <option value="">All types</option>
          <option value="department">Departments</option>
          <option value="division">Divisions</option>
          <option value="tenant">Tenant commands</option>
        </select>
        <label className="toggle">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => {
              setOverdueOnly(event.target.checked);
              if (event.target.checked) setNeverOnly(false);
            }}
          />
          Overdue
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={neverOnly}
            onChange={(event) => {
              setNeverOnly(event.target.checked);
              if (event.target.checked) setOverdueOnly(false);
            }}
          />
          Never
        </label>
        <input aria-label="Coverage last visit from date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input aria-label="Coverage last visit through date" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </section>
      <section className="panel mission-panel">
        <div>
          <p className="eyebrow">Mission Board</p>
          <h2>Meaningful coverage</h2>
          <p className="muted">
            {missionNudge(
              gamificationTone,
              missionContextFromUnits(units),
              `${missionSummary.overdue}:${missionSummary.neverVisited}:${cachedAt ?? ''}`,
            )}
          </p>
        </div>
        <dl className="mission-stats">
          <div>
            <dt>Never</dt>
            <dd>{missionSummary.neverVisited}</dd>
          </div>
          <div>
            <dt>Overdue</dt>
            <dd>{missionSummary.overdue}</dd>
          </div>
          <div>
            <dt>Due soon</dt>
            <dd>{missionSummary.dueSoon}</dd>
          </div>
          <div>
            <dt>Current</dt>
            <dd>{missionSummary.current}</dd>
          </div>
        </dl>
        {missionSummary.topNeeds.length > 0 && (
          <div className="mission-needs">
            <strong>Top needs today</strong>
            {missionSummary.topNeeds.map((unit) => (
              <div key={unit.id} className="card-with-detail">
                <button
                  className={`unit-card unit-button ${unit.status}`}
                  onClick={() => void openUnit(unit)}
                  aria-expanded={selectedUnit?.id === unit.id}
                >
                  <span>
                    <strong>{unit.name}</strong>
                    <small>
                      {statusLabel(unit)} - {unit.location_name ?? 'Unmapped'} - Last visit {niceDate(unit.last_visit_at)}
                    </small>
                  </span>
                </button>
                {renderUnitDetail(unit)}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="coverage-list">
        {ministryIndicatorsEnabled && (
          <section className="panel report-panel">
            <p className="eyebrow">Reports</p>
            <h2>Visit flags</h2>
            <p className="muted">Generic location-level yes/no counts only. Multi-unit visits are not attributed to each selected command.</p>
            <div className="filters">
              <input
                aria-label="Search visit flag report"
                placeholder="Search report rows"
                value={reportSearch}
                onChange={(event) => setReportSearch(event.target.value)}
              />
              <input aria-label="Visit flag report from date" type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} />
              <input aria-label="Visit flag report through date" type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} />
              <button className="secondary" onClick={loadReport} disabled={reportLoading}>
                {reportLoading ? 'Loading report...' : 'Load visit flag report'}
              </button>
            </div>
            {reportMessage && <p className="notice">{reportMessage}</p>}
            {reportRows.length > 0 && (
              <div className="report-list">
                {filteredReportRows.map((row) => (
                  <article key={row.key} className="report-row">
                    <div>
                      <strong>{row.location_name}</strong>
                      <small>{row.area_name}</small>
                    </div>
                    <dl>
                      <div>
                        <dt>Visits</dt>
                        <dd>{row.visits}</dd>
                      </div>
                      <div>
                        <dt>Follow-up</dt>
                        <dd>{row.confidential_care_count}</dd>
                      </div>
                      <div>
                        <dt>External support</dt>
                        <dd>{row.referral_count}</dd>
                      </div>
                      <div>
                        <dt>Multi-unit</dt>
                        <dd>{row.multi_unit_indicator_visits}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
                {!filteredReportRows.length && <p className="notice">No report rows match that search.</p>}
              </div>
            )}
          </section>
        )}
        {areas.map((candidate) => {
          const areaUnits = filtered.filter((unit) => unit.area_id === candidate.id);
          if (!areaUnits.length) return null;
          return (
            <div key={candidate.id} className="area-group">
              <h2>{candidate.name}</h2>
              {areaUnits.map((unit) => (
                <div key={unit.id} className="card-with-detail">
                  <button
                    className={`unit-card unit-button ${unit.status}`}
                    onClick={() => void openUnit(unit)}
                    aria-expanded={selectedUnit?.id === unit.id}
                  >
                    <div>
                      <strong>{unit.name}</strong>
                      <span>{unitTypeLabel[unit.unit_type]}</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Last</dt>
                        <dd>{niceDate(unit.last_visit_at)}</dd>
                      </div>
                      <div>
                        <dt>Visitor</dt>
                        <dd>{unit.last_visitor ?? 'None'}</dd>
                      </div>
                      <div>
                        <dt>Days</dt>
                        <dd>{unit.days_since_last_visit ?? 'Never'}</dd>
                      </div>
                    </dl>
                  </button>
                  {renderUnitDetail(unit)}
                </div>
              ))}
            </div>
          );
        })}
        {filtered.some((unit) => !unit.area_id) && (
          <div className="area-group">
            <h2>Unassigned</h2>
            {filtered
              .filter((unit) => !unit.area_id)
              .map((unit) => (
                <div key={unit.id} className="card-with-detail">
                  <button
                    className={`unit-card unit-button ${unit.status}`}
                    onClick={() => void openUnit(unit)}
                    aria-expanded={selectedUnit?.id === unit.id}
                  >
                    <strong>{unit.name}</strong>
                    <span>No mapped location</span>
                  </button>
                  {renderUnitDetail(unit)}
                </div>
              ))}
          </div>
        )}
        {!filtered.length && <p className="notice">No commands match the current coverage filters.</p>}
      </section>
    </main>
  );
}

function MapScreen({
  units,
  mapTileUrl,
  mapDefaultLatitude,
  mapDefaultLongitude,
  offlineMode,
}: {
  units: UnitSummary[];
  mapTileUrl: string;
  mapDefaultLatitude: number;
  mapDefaultLongitude: number;
  offlineMode: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);
  const [mapSearch, setMapSearch] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const safeMapDefaultLatitude = validLatitude(mapDefaultLatitude) ? mapDefaultLatitude : 24.57;
  const safeMapDefaultLongitude = validLongitude(mapDefaultLongitude) ? mapDefaultLongitude : -81.78;
  const locations = useMemo(() => getCachedLocationSummaries(units), [units]);
  const filteredLocations = useMemo(
    () =>
      locations.filter((location) =>
        matchesSearch(mapSearch, [
          location.name,
          location.area_name,
          location.radius_meters,
          location.status,
          ...location.units.flatMap((unit) => [unit.name, unitTypeLabel[unit.unit_type], statusLabel(unit), unit.last_visitor]),
        ]),
      ),
    [locations, mapSearch],
  );

  useEffect(() => {
    if (offlineMode || !container.current || map.current) return;
    let cancelled = false;
    setMapError('');
    void loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !container.current || map.current) return;
        const nextMap = new maplibregl.Map({
          container: container.current,
          style: mapTileUrl || {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
              },
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
          },
          center: [safeMapDefaultLongitude, safeMapDefaultLatitude],
          zoom: 11,
        });
        nextMap.once('load', () => {
          if (!cancelled) setMapReady(true);
        });
        nextMap.once('error', () => {
          if (!cancelled && !nextMap.isStyleLoaded()) setMapError('The map could not be loaded. Saved locations are still available below.');
        });
        map.current = nextMap;
      })
      .catch(() => {
        if (!cancelled) setMapError('The map could not be loaded. Saved locations are still available below.');
      });
    return () => {
      cancelled = true;
      setMapReady(false);
      map.current?.remove();
      map.current = null;
    };
  }, [safeMapDefaultLatitude, safeMapDefaultLongitude, mapTileUrl, offlineMode]);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    let cancelled = false;
    const markers: MapLibreMarker[] = [];
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !map.current) return;
      const drawRadii = () => {
        if (cancelled || !map.current) return;
        const sourceData = {
          type: 'FeatureCollection' as const,
          features: filteredLocations.map((location) => ({
            type: 'Feature' as const,
            properties: { status: location.status },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [circlePolygon(location.longitude, location.latitude, location.radius_meters)],
            },
          })),
        };
        const existing = map.current.getSource('location-radii') as GeoJSONSource | undefined;
        if (existing) {
          existing.setData(sourceData);
          return;
        }
        map.current.addSource('location-radii', { type: 'geojson', data: sourceData });
        map.current.addLayer({
          id: 'location-radii-fill',
          type: 'fill',
          source: 'location-radii',
          paint: {
            'fill-color': [
              'match',
              ['get', 'status'],
              'red',
              statusColor.red,
              'yellow',
              statusColor.yellow,
              'green',
              statusColor.green,
              statusColor.gray,
            ],
            'fill-opacity': 0.15,
          },
        });
        map.current.addLayer({
          id: 'location-radii-line',
          type: 'line',
          source: 'location-radii',
          paint: {
            'line-color': [
              'match',
              ['get', 'status'],
              'red',
              statusColor.red,
              'yellow',
              statusColor.yellow,
              'green',
              statusColor.green,
              statusColor.gray,
            ],
            'line-width': 2,
            'line-opacity': 0.55,
          },
        });
      };
      if (map.current.isStyleLoaded()) drawRadii();
      else map.current.once('load', drawRadii);
      filteredLocations.forEach((location) => {
        const marker = new maplibregl.Marker({ color: statusColor[location.status] })
          .setLngLat([location.longitude, location.latitude])
          .setPopup(new maplibregl.Popup().setDOMContent(mapPopupContent(location)))
          .addTo(map.current!);
        markers.push(marker);
      });
    });
    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.remove());
    };
  }, [filteredLocations, mapReady]);

  return (
    <main className="screen map-screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Map</p>
          <h1>Mapped locations</h1>
        </div>
      </div>
      {offlineMode ? (
        <section className="panel">
          <h2>Offline map view</h2>
          <p className="muted">Map tiles are unavailable offline. Cached mapped locations are listed below.</p>
        </section>
      ) : (
        <>
          <div ref={container} className="map-canvas" aria-label="Map of saved workspace locations" />
          {!mapReady && !mapError && <p className="notice" role="status">Loading map...</p>}
          {mapError && <p className="warning-notice" role="alert">{mapError}</p>}
        </>
      )}
      <section className="filters">
        <input
          aria-label="Search mapped locations"
          placeholder="Search mapped locations, areas, or commands"
          value={mapSearch}
          onChange={(event) => setMapSearch(event.target.value)}
        />
      </section>
      <div className="map-list">
        {filteredLocations.map((location) => (
          <div key={location.id} className="card-with-detail">
            <button
              className={`unit-card unit-button ${location.status}`}
              onClick={() => setExpandedLocationId((current) => (current === location.id ? null : location.id))}
              aria-expanded={expandedLocationId === location.id}
            >
              <strong>{location.name}</strong>
              <span>
                {location.area_name} - {location.radius_meters}m - {location.units.length} unit
                {location.units.length === 1 ? '' : 's'}
              </span>
            </button>
            {expandedLocationId === location.id && (
              <section className="panel detail-panel inline-detail-panel map-detail-panel">
                <div className="screen-title inline-title">
                  <div>
                    <p className="eyebrow">Mapped location</p>
                    <h2>{location.name}</h2>
                  </div>
                  <button className="secondary" onClick={() => setExpandedLocationId(null)}>
                    Close
                  </button>
                </div>
                <dl className="confirmation-details">
                  <div>
                    <dt>Area</dt>
                    <dd>{location.area_name || 'Unassigned'}</dd>
                  </div>
                  <div>
                    <dt>Radius</dt>
                    <dd>{location.radius_meters}m</dd>
                  </div>
                </dl>
                <div className="map-detail-list">
                  {location.units.map((unit) => (
                    <article key={unit.id} className={`activity-row ${unit.status}`}>
                      <div className="activity-summary">
                        <div>
                          <strong>{unit.name}</strong>
                          <small>
                            {unitTypeLabel[unit.unit_type]} - {statusLabel(unit)} - Last visit {niceDate(unit.last_visit_at)}
                          </small>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        ))}
        {!filteredLocations.length && <p className="notice">No mapped locations match that search.</p>}
      </div>
    </main>
  );
}

type KioskProjectedMarker = {
  location: LocationSummary;
  x: number;
  y: number;
};

function sameKioskProjectedMarkers(current: KioskProjectedMarker[], next: KioskProjectedMarker[]) {
  if (current.length !== next.length) return false;
  return next.every((marker, index) => {
    const existing = current[index];
    return (
      existing?.location.id === marker.location.id &&
      existing.x === marker.x &&
      existing.y === marker.y &&
      existing.location.status === marker.location.status &&
      existing.location.units.length === marker.location.units.length
    );
  });
}

function KioskMap({
  locations,
  mapTileUrl,
  mapDefaultLatitude,
  mapDefaultLongitude,
  priorityLocationIds,
  offlineMode,
}: {
  locations: LocationSummary[];
  mapTileUrl: string;
  mapDefaultLatitude: number;
  mapDefaultLongitude: number;
  priorityLocationIds: Set<string>;
  offlineMode: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [resizeTick, setResizeTick] = useState(0);
  const [projectedMarkers, setProjectedMarkers] = useState<KioskProjectedMarker[]>([]);
  const resizeFrame = useRef<number | null>(null);
  const projectionFrame = useRef<number | null>(null);
  const safeMapDefaultLatitude = validLatitude(mapDefaultLatitude) ? mapDefaultLatitude : 24.57;
  const safeMapDefaultLongitude = validLongitude(mapDefaultLongitude) ? mapDefaultLongitude : -81.78;
  const displayLocations = useMemo(
    () => locations.filter((location) => validLatitude(location.latitude) && validLongitude(location.longitude)),
    [locations],
  );
  const displayLocationsRef = useRef(displayLocations);
  displayLocationsRef.current = displayLocations;

  function updateProjectedMarkers() {
    const element = container.current;
    if (!map.current || !element || element.clientWidth === 0 || element.clientHeight === 0) {
      setProjectedMarkers((current) => (current.length ? [] : current));
      return;
    }
    const next = displayLocationsRef.current.map((location) => {
      const point = map.current!.project([location.longitude, location.latitude]);
      return {
        location,
        x: Math.round(point.x * 10) / 10,
        y: Math.round(point.y * 10) / 10,
      } satisfies KioskProjectedMarker;
    });
    setProjectedMarkers((current) => (sameKioskProjectedMarkers(current, next) ? current : next));
  }

  function scheduleMarkerProjection() {
    if (projectionFrame.current != null) window.cancelAnimationFrame(projectionFrame.current);
    projectionFrame.current = window.requestAnimationFrame(() => {
      projectionFrame.current = null;
      updateProjectedMarkers();
    });
  }

  function scheduleMapResize() {
    if (resizeFrame.current != null) window.cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = window.requestAnimationFrame(() => {
      resizeFrame.current = null;
      const element = container.current;
      if (!map.current || !element || element.clientWidth === 0 || element.clientHeight === 0) return;
      map.current.resize();
      scheduleMarkerProjection();
      setResizeTick((current) => current + 1);
    });
  }

  function removeKioskMapLayers() {
    if (!map.current?.isStyleLoaded()) return;
    [
      'kiosk-location-point-label',
      'kiosk-location-point-count',
      'kiosk-location-point',
      'kiosk-location-point-halo',
      'kiosk-location-radii-line',
      'kiosk-location-radii-fill',
    ].forEach((layerId) => {
      if (map.current?.getLayer(layerId)) map.current.removeLayer(layerId);
    });
    ['kiosk-location-points', 'kiosk-location-radii'].forEach((sourceId) => {
      if (map.current?.getSource(sourceId)) map.current.removeSource(sourceId);
    });
  }

  useEffect(() => {
    if (offlineMode) {
      setMapFailed(true);
      return;
    }
    if (!container.current || map.current) return;
    let cancelled = false;
    setMapFailed(false);
    void loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !container.current || map.current) return;
        const nextMap = new maplibregl.Map({
          container: container.current,
          style: mapTileUrl || {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
              },
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
          },
          center: [safeMapDefaultLongitude, safeMapDefaultLatitude],
          zoom: 12,
          interactive: false,
          attributionControl: false,
        });
        nextMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
        nextMap.on('error', () => {
          if (!cancelled) setMapFailed(true);
        });
        nextMap.once('load', () => {
          if (cancelled) return;
          scheduleMapResize();
          scheduleMarkerProjection();
          setMapReady(true);
        });
        map.current = nextMap;
      })
      .catch(() => {
        if (!cancelled) setMapFailed(true);
      });
    return () => {
      cancelled = true;
      setMapReady(false);
      map.current?.remove();
      map.current = null;
      if (resizeFrame.current != null) {
        window.cancelAnimationFrame(resizeFrame.current);
        resizeFrame.current = null;
      }
      if (projectionFrame.current != null) {
        window.cancelAnimationFrame(projectionFrame.current);
        projectionFrame.current = null;
      }
    };
  }, [safeMapDefaultLatitude, safeMapDefaultLongitude, mapTileUrl, offlineMode]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(scheduleMapResize);
    observer.observe(element);
    window.addEventListener('resize', scheduleMapResize);
    document.addEventListener('fullscreenchange', scheduleMapResize);
    scheduleMapResize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleMapResize);
      document.removeEventListener('fullscreenchange', scheduleMapResize);
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    let cancelled = false;
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !map.current) return;
      const element = container.current;
      if (!element || element.clientWidth === 0 || element.clientHeight === 0) return;
      map.current.resize();
      removeKioskMapLayers();

      if (displayLocations.length === 1) {
        map.current.setCenter([displayLocations[0].longitude, displayLocations[0].latitude]);
        map.current.setZoom(15);
      } else if (displayLocations.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        displayLocations.forEach((location) => bounds.extend([location.longitude, location.latitude]));
        const horizontalPadding = Math.max(58, Math.min(100, element.clientWidth * 0.12));
        const verticalPadding = Math.max(62, Math.min(100, element.clientHeight * 0.13));
        map.current.fitBounds(bounds, {
          padding: { top: verticalPadding, right: horizontalPadding, bottom: verticalPadding, left: horizontalPadding },
          maxZoom: 15,
          duration: 0,
        });
      } else {
        map.current.setCenter([safeMapDefaultLongitude, safeMapDefaultLatitude]);
        map.current.setZoom(12);
      }

      const scheduleAfterCameraChange = () => scheduleMarkerProjection();
      map.current.once('moveend', scheduleAfterCameraChange);
      map.current.once('idle', scheduleAfterCameraChange);
      scheduleMarkerProjection();
    });
    return () => {
      cancelled = true;
    };
  }, [displayLocations, safeMapDefaultLatitude, safeMapDefaultLongitude, mapReady, resizeTick]);

  return (
    <div
      ref={container}
      className="kiosk-map-stage"
      aria-label="Color-coded map with workspace pins"
      data-marker-count={displayLocations.length}
    >
      <div className="kiosk-map-overlay" aria-hidden="true">
        {projectedMarkers.map((marker) => {
          const priority = priorityLocationIds.has(marker.location.id);
          return (
            <div
              key={marker.location.id}
              className={`kiosk-map-marker ${marker.location.status} ${priority ? 'priority' : ''}`}
              data-testid="kiosk-map-marker"
              data-location-id={marker.location.id}
              data-status={marker.location.status}
              style={{ left: `${marker.x}px`, top: `${marker.y}px` }}
            >
              <div className="kiosk-map-pin" aria-hidden="true">
                <span className="kiosk-map-pin-count">
                  <span>{marker.location.units.length}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {mapFailed && <p className="kiosk-map-empty">{offlineMode ? 'Map unavailable offline. Use the priority list.' : 'Map tiles are unavailable.'}</p>}
      {!mapFailed && !displayLocations.length && <p className="kiosk-map-empty">No mapped locations yet.</p>}
    </div>
  );
}

function KioskDashboard({
  identity,
  bootstrap,
  workspace,
  cachedAt,
  cachedMode,
  onRefresh,
}: {
  identity: Identity;
  bootstrap: Bootstrap;
  workspace: WorkspaceContext | null;
  cachedAt: string | null;
  cachedMode: boolean;
  onRefresh: () => void;
}) {
  const [phase, setPhase] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [summary, setSummary] = useState<MissionBoardSummary | null>(null);
  const [winners, setWinners] = useState<{ weeks: LeaderboardWinner[]; month: LeaderboardWinner | null }>({ weeks: [], month: null });
  const [leaderboardMessage, setLeaderboardMessage] = useState('');
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [fullscreenMessage, setFullscreenMessage] = useState('');
  const activeUnits = useMemo(() => bootstrap.units.filter((unit) => unit.active), [bootstrap.units]);
  const locations = useMemo(() => getCachedLocationSummaries(activeUnits), [activeUnits]);
  const workspaceTitle = bootstrap.installationName || workspace?.installationName || workspace?.name || 'Deckplating';
  const month = localDateKey(now).slice(0, 7);

  const statusCounts = useMemo(
    () => ({
      gray: activeUnits.filter((unit) => unit.status === 'gray').length,
      red: activeUnits.filter((unit) => unit.status === 'red').length,
      yellow: activeUnits.filter((unit) => unit.status === 'yellow').length,
      green: activeUnits.filter((unit) => unit.status === 'green').length,
    }),
    [activeUnits],
  );
  const coveragePercent = activeUnits.length ? Math.round((statusCounts.green / activeUnits.length) * 100) : 0;

  const priorityUnits = useMemo(() => {
    const needs = activeUnits.filter((unit) => unit.status !== 'green');
    const source = needs.length ? needs : activeUnits;
    return [...source]
      .sort((a, b) => {
        const daysA = a.days_since_last_visit ?? (a.status === 'gray' ? 9999 : -1);
        const daysB = b.days_since_last_visit ?? (b.status === 'gray' ? 9999 : -1);
        return statusPriority[b.status] - statusPriority[a.status] || daysB - daysA || a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }, [activeUnits]);

  const priorityLocationIds = useMemo(
    () => new Set(priorityUnits.map((unit) => unit.location_id).filter((id): id is string => Boolean(id))),
    [priorityUnits],
  );
  const displayPriorityUnits = useMemo(() => priorityUnits.slice(0, 3), [priorityUnits]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60000);
    const morph = window.setInterval(() => setPhase((current) => (current + 1) % 6), 90000);
    const refresh = window.setInterval(onRefresh, 300000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(morph);
      window.clearInterval(refresh);
    };
  }, [onRefresh]);

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadLeaderboard() {
      if (cachedMode || !navigator.onLine) {
        setLeaderboardMessage('Scores need a live connection.');
        return;
      }
      try {
        const result = await api<{
          rows: LeaderboardRow[];
          summary: MissionBoardSummary;
          winners?: { weeks: LeaderboardWinner[]; month: LeaderboardWinner | null };
        }>(leaderboardPath(month), { headers: authHeaders(identity), timeoutMs: 6000 });
        if (cancelled) return;
        setRows(result.rows);
        setSummary(result.summary);
        setWinners(result.winners ?? { weeks: [], month: null });
        setLeaderboardMessage('');
      } catch (err) {
        if (!cancelled) setLeaderboardMessage(err instanceof Error ? err.message : 'Unable to load scores.');
      }
    }
    void loadLeaderboard();
    const timer = window.setInterval(loadLeaderboard, 300000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [cachedMode, identity, month]);

  function actionLabel(unit: UnitSummary) {
    if (unit.status === 'gray') return 'First visit';
    if (unit.status === 'red') return 'Overdue recovery';
    if (unit.status === 'yellow') return 'Due soon';
    return 'Sustain presence';
  }

  async function toggleFullscreen() {
    setFullscreenMessage('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setFullscreenMessage('Fullscreen is not available in this browser.');
    } catch {
      setFullscreenMessage('Fullscreen could not be opened.');
    }
  }

  const featuredWeek = winners.weeks.length ? winners.weeks[winners.weeks.length - 1] : null;

  return (
    <main className={`kiosk-dashboard phase-${phase}`}>
      <div className="kiosk-shell">
        <header className="kiosk-header">
          <div>
            <p className="eyebrow">Deckplating Kiosk</p>
            <h1>{workspaceTitle}</h1>
            <small>
              {cachedMode ? 'Cached workspace data' : 'Live workspace data'}
              {cachedAt ? ` - synced ${niceDateTime(cachedAt)}` : ''}
            </small>
            {fullscreenMessage && <small role="status">{fullscreenMessage}</small>}
          </div>
          <div className="kiosk-header-actions">
            <div className="kiosk-clock">
              <strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
              <span>{now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </div>
            <button className="kiosk-ghost" onClick={() => void toggleFullscreen()}>
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </header>

        <section className="kiosk-status-strip" aria-label="Coverage status summary">
          <div>
            <span>Current</span>
            <strong>{statusCounts.green}</strong>
          </div>
          <div>
            <span>Due soon</span>
            <strong>{statusCounts.yellow}</strong>
          </div>
          <div>
            <span>Overdue</span>
            <strong>{statusCounts.red}</strong>
          </div>
          <div>
            <span>Never</span>
            <strong>{statusCounts.gray}</strong>
          </div>
          <div>
            <span>Coverage</span>
            <strong>{coveragePercent}%</strong>
          </div>
        </section>

        <div className="kiosk-main">
          <section className="kiosk-panel kiosk-map-panel">
            <div className="kiosk-panel-title">
              <div>
                <p className="eyebrow">Map</p>
                <h2>Coverage picture</h2>
              </div>
              <div className="kiosk-legend">
                {(['green', 'yellow', 'red', 'gray'] as const).map((status) => (
                  <span key={status}>
                    <i style={{ background: statusColor[status] }} />
                    {statusText[status]}
                  </span>
                ))}
              </div>
            </div>
            <KioskMap
              locations={locations}
              mapTileUrl={bootstrap.mapTileUrl}
              mapDefaultLatitude={bootstrap.mapDefaultLatitude}
              mapDefaultLongitude={bootstrap.mapDefaultLongitude}
              priorityLocationIds={priorityLocationIds}
              offlineMode={cachedMode || !navigator.onLine}
            />
          </section>

          <section className="kiosk-panel kiosk-actions-panel">
            <div className="kiosk-panel-title">
              <div>
                <p className="eyebrow">Next best actions</p>
                <h2>Go here first</h2>
              </div>
            </div>
            <div className="kiosk-actions-list">
              {displayPriorityUnits.map((unit, index) => (
                <article key={unit.id} className={`kiosk-action ${unit.status}`}>
                  <span className="kiosk-action-number">{index + 1}</span>
                  <div className="kiosk-action-body">
                    <div className="kiosk-action-heading">
                      <strong>{unit.name}</strong>
                      <span className="status-pill">{statusLabel(unit)}</span>
                    </div>
                    <small>
                      {actionLabel(unit)} - {unit.location_name ?? 'Manual lookup'} - Last visit {niceDate(unit.last_visit_at)}
                    </small>
                  </div>
                </article>
              ))}
              {!displayPriorityUnits.length && <p className="notice">Add active commands to start showing priorities.</p>}
            </div>
          </section>

          <section className="kiosk-panel kiosk-leaderboard-panel">
            <div className="kiosk-panel-title">
              <div>
                <p className="eyebrow">Leaderboard</p>
                <h2>Meaningful coverage</h2>
              </div>
              {summary && (
                <span className="kiosk-score-summary">
                  {summary.units_recovered_this_month} recovered / {summary.distinct_units_covered} covered
                </span>
              )}
            </div>
            {(winners.month || featuredWeek) && (
              <div className="kiosk-winners">
                {featuredWeek && (
                  <article>
                    <span>{featuredWeek.final ? 'Week winner' : 'Week leader'}</span>
                    <strong>{featuredWeek.winner?.name ?? 'No activity yet'}</strong>
                    <small>{featuredWeek.label}</small>
                  </article>
                )}
                {winners.month && (
                  <article>
                    <span>{winners.month.final ? 'Month winner' : 'Month leader'}</span>
                    <strong>{winners.month.winner?.name ?? 'No activity yet'}</strong>
                    <small>{winners.month.label}</small>
                  </article>
                )}
              </div>
            )}
            <div className="kiosk-score-list">
              {rows.slice(0, 5).map((row, index) => (
                <article key={row.team_member_id} className="kiosk-score-row">
                  <span className="rank">{index + 1}</span>
                  <div>
                    <strong>{row.name}</strong>
                    <small>
                      {row.distinct_units} units - {row.recovered_units} recovered - {row.active_days} active day
                      {row.active_days === 1 ? '' : 's'}
                    </small>
                  </div>
                  <strong>{row.score}</strong>
                </article>
              ))}
              {leaderboardMessage && <p className="notice">{leaderboardMessage}</p>}
              {!rows.length && !leaderboardMessage && <p className="notice">No Mission Board activity for this month yet.</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Scoreboard({ identity, gamificationTone }: { identity: Identity; gamificationTone: GamificationTone }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [summary, setSummary] = useState<MissionBoardSummary | null>(null);
  const [winners, setWinners] = useState<{ weeks: LeaderboardWinner[]; month: LeaderboardWinner | null }>({ weeks: [], month: null });
  const [month, setMonth] = useState(localDateKey().slice(0, 7));
  const [selectedBadge, setSelectedBadge] = useState<{ memberId: string; badge: MissionBadge } | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMessage('');
    void api<{ rows: LeaderboardRow[]; summary: MissionBoardSummary; winners?: { weeks: LeaderboardWinner[]; month: LeaderboardWinner | null } }>(leaderboardPath(month), {
      headers: authHeaders(identity),
      signal: controller.signal,
    })
      .then((result) => {
        setRows(result.rows);
        setSummary(result.summary);
        setWinners(result.winners ?? { weeks: [], month: null });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setMessage(err instanceof Error ? err.message : 'Unable to load the Mission Board.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [identity, month]);

  function renderWinner(winner: LeaderboardWinner) {
    return (
      <article key={`${winner.type}:${winner.start}`} className="winner-row">
        <div>
          <strong>{winner.label}</strong>
          <small>{winner.final ? 'Winner' : 'Current leader'}</small>
        </div>
        {winner.winner ? (
          <div>
            <strong>{winner.winner.name}</strong>
            <small>
              {winner.winner.score} points - {winner.winner.distinct_units} units - {winner.winner.recovered_units} recovered
            </small>
          </div>
        ) : (
          <div>
            <strong>No activity yet</strong>
            <small>No scored visits in this period.</small>
          </div>
        )}
      </article>
    );
  }

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Mission Board</p>
          <h1>Meaningful coverage</h1>
        </div>
      </div>
      <label>
        Mission Board month
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
      </label>
      {loading && <p className="notice" role="status">Loading Mission Board...</p>}
      {message && <p className="error" role="alert">{message}</p>}
      <section className="panel mission-panel">
        <p className="eyebrow">Monthly focus</p>
        <h2>Recover overdue and never-visited units</h2>
        <p className="muted">
          {missionNudge(gamificationTone, rows.some((row) => row.recovered_units > 0) ? 'recovery' : 'red', `${month}:${rows[0]?.score ?? 0}:${rows.length}`)}
        </p>
        {summary && (
          <dl className="mission-stats">
            <div>
              <dt>Recovered</dt>
              <dd>{summary.units_recovered_this_month}</dd>
            </div>
            <div>
              <dt>Covered</dt>
              <dd>{summary.distinct_units_covered}</dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd>{summary.overdue_remaining}</dd>
            </div>
            <div>
              <dt>Never</dt>
              <dd>{summary.never_visited_remaining}</dd>
            </div>
          </dl>
        )}
      </section>
      {(winners.month || winners.weeks.length > 0) && (
        <section className="panel mission-panel">
          <div>
            <p className="eyebrow">Winners</p>
            <h2>Weekly and monthly leaders</h2>
            <p className="muted">Winners use the same meaningful coverage score as the Mission Board.</p>
          </div>
          {winners.month && <div className="winner-list monthly-winner">{renderWinner(winners.month)}</div>}
          {winners.weeks.length > 0 && <div className="winner-list">{winners.weeks.map(renderWinner)}</div>}
        </section>
      )}
      <section className="coverage-list">
        {rows.map((row, index) => (
          <article key={row.team_member_id} className="score-row mission-row">
            <div className="mission-row-main">
              <span className="rank">{index + 1}</span>
              <div className="mission-row-body">
                <div>
                  <strong>{row.name}</strong>
                  <small>
                    {row.qualifying_checkins} meaningful - {row.distinct_units} units - {row.recovered_units} recovered - {row.active_days} active day
                    {row.active_days === 1 ? '' : 's'}
                  </small>
                </div>
                {row.badges.length > 0 && (
                  <div className="badge-list">
                    {row.badges.slice(0, 3).map((badge) => (
                      <button
                        key={badge}
                        type="button"
                        className="status-pill mission-badge"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedBadge((current) =>
                            current?.memberId === row.team_member_id && current.badge === badge
                              ? null
                              : { memberId: row.team_member_id, badge },
                          );
                        }}
                        aria-expanded={selectedBadge?.memberId === row.team_member_id && selectedBadge.badge === badge}
                      >
                        <span className="mini-badge-icon">{badgeDetails[badge].icon}</span>
                        {badgeLabel[badge]}
                      </button>
                    ))}
                    {row.badges.length > 3 && <span className="status-pill">+{row.badges.length - 3}</span>}
                  </div>
                )}
              </div>
              <strong className="score-points">{row.score}</strong>
            </div>
            {selectedBadge?.memberId === row.team_member_id && (
              <section className="badge-detail">
                <span className="badge-icon">{badgeDetails[selectedBadge.badge].icon}</span>
                <div>
                  <strong>{badgeDetails[selectedBadge.badge].title}</strong>
                  <small>{badgeDetails[selectedBadge.badge].description}</small>
                </div>
              </section>
            )}
          </article>
        ))}
        {!rows.length && !loading && !message && <p className="notice">No Mission Board activity for this month yet.</p>}
      </section>
    </main>
  );
}

function AdminMapPicker({
  latitude,
  longitude,
  mapTileUrl,
  onChange,
}: {
  latitude: number;
  longitude: number;
  mapTileUrl?: string;
  onChange: (coords: { latitude: number; longitude: number }) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<MapLibreMarker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !container.current || map.current) return;
      const nextMap = new maplibregl.Map({
        container: container.current,
        style: mapTileUrl || {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        center: [longitude, latitude],
        zoom: 13,
      });
      map.current = nextMap;
      const nextMarker = new maplibregl.Marker({ draggable: true, color: statusColor.red })
        .setLngLat([longitude, latitude])
        .addTo(nextMap);
      marker.current = nextMarker;
      nextMarker.on('dragend', () => {
        const point = nextMarker.getLngLat();
        onChangeRef.current({ latitude: point.lat, longitude: point.lng });
      });
      nextMap.on('click', (event) => {
        nextMarker.setLngLat(event.lngLat);
        onChangeRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [mapTileUrl]);

  useEffect(() => {
    if (!validLatitude(latitude) || !validLongitude(longitude)) return;
    marker.current?.setLngLat([longitude, latitude]);
    map.current?.setCenter([longitude, latitude]);
  }, [latitude, longitude]);

  return <div ref={container} className="admin-map" aria-label="Map picker for the new location" />;
}

function AdminCheckinRow({
  checkin,
  units,
  teamMembers,
  actingTeamMemberId,
  onPatch,
}: {
  checkin: AdminCheckin;
  units: AdminData['units'];
  teamMembers: AdminData['teamMembers'];
  actingTeamMemberId: string;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [unitId, setUnitId] = useState(checkin.unit_id);
  const [teamMemberId, setTeamMemberId] = useState(checkin.team_member_id);
  const [checkedInAt, setCheckedInAt] = useState(datetimeLocalValue(checkin.checked_in_at));
  const [confidentialCareProvided, setConfidentialCareProvided] = useState(checkin.confidential_care_provided === true);
  const [referralProvided, setReferralProvided] = useState(checkin.referral_provided === true);
  const [voidReason, setVoidReason] = useState('accidental');
  const [saving, setSaving] = useState(false);
  const voided = Boolean(checkin.voided_at);

  useEffect(() => {
    setUnitId(checkin.unit_id);
    setTeamMemberId(checkin.team_member_id);
    setCheckedInAt(datetimeLocalValue(checkin.checked_in_at));
    setConfidentialCareProvided(checkin.confidential_care_provided === true);
    setReferralProvided(checkin.referral_provided === true);
  }, [checkin]);

  async function saveCorrections() {
    setSaving(true);
    try {
      await onPatch(checkin.id, {
        adminTeamMemberId: actingTeamMemberId,
        unit_id: unitId,
        team_member_id: teamMemberId,
        checked_in_at: localDateTimeToIso(checkedInAt),
        ...(ministryIndicatorsEnabled
          ? {
              confidentialCareProvided: confidentialCareProvided ? true : null,
              referralProvided: referralProvided ? true : null,
            }
          : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  async function voidCheckin() {
    if (!window.confirm('Void this check-in? It will stay in the log but no longer count for coverage or scores.')) return;
    setSaving(true);
    try {
      await onPatch(checkin.id, {
        adminTeamMemberId: actingTeamMemberId,
        voided: true,
        void_reason: voidReason,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`activity-row ${voided ? 'voided' : ''}`}>
      <div className="activity-summary">
        <div>
          <strong>{checkin.unit_name}</strong>
          <small>
            {checkin.area_name ?? 'Unassigned'} - {checkin.location_name} - {checkin.team_member_name}
          </small>
          <small>
            {niceDateTime(checkin.checked_in_at)} - {checkin.score_awarded} point{checkin.score_awarded === 1 ? '' : 's'} -{' '}
            {checkin.geofence_verified ? 'geofence verified' : 'manual/unverified'}
          </small>
        </div>
        {voided && <span className="status-pill">Voided: {checkin.void_reason ?? 'no reason'}</span>}
        {ministryIndicatorsEnabled && (checkin.confidential_care_provided || checkin.referral_provided) && (
          <span className="status-pill">
            {checkin.confidential_care_provided ? 'Follow-up' : ''}
            {checkin.confidential_care_provided && checkin.referral_provided ? ' / ' : ''}
            {checkin.referral_provided ? 'External support' : ''}
          </span>
        )}
      </div>
      {!voided && (
        <div className="activity-edit">
          <select aria-label={`Unit for check-in at ${niceDateTime(checkin.checked_in_at)}`} value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
          <select aria-label={`Team member for ${checkin.unit_name} check-in`} value={teamMemberId} onChange={(event) => setTeamMemberId(event.target.value)}>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <input aria-label={`Date and time for ${checkin.unit_name} check-in`} type="datetime-local" value={checkedInAt} onChange={(event) => setCheckedInAt(event.target.value)} required />
          {ministryIndicatorsEnabled && (
            <section className="optional-indicators admin-indicators">
              <h3>Optional visit flags</h3>
              <p className="muted">Counts only. Do not add notes, details, names, or sensitive information.</p>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={confidentialCareProvided}
                  onChange={(event) => setConfidentialCareProvided(event.target.checked)}
                />
                Follow-up flag
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={referralProvided}
                  onChange={(event) => setReferralProvided(event.target.checked)}
                />
                External support flag
              </label>
            </section>
          )}
          <button className="secondary" onClick={saveCorrections} disabled={!actingTeamMemberId || !checkedInAt || saving}>
            {saving ? 'Saving...' : 'Save edit'}
          </button>
          <select aria-label={`Void reason for ${checkin.unit_name} check-in`} value={voidReason} onChange={(event) => setVoidReason(event.target.value)}>
            <option value="accidental">Accidental</option>
            <option value="wrong_unit">Wrong unit</option>
            <option value="duplicate">Duplicate</option>
            <option value="incorrect_datetime">Incorrect date/time</option>
            <option value="incorrect_member">Incorrect member</option>
          </select>
          <button className="secondary danger-text" onClick={voidCheckin} disabled={!actingTeamMemberId || saving}>
            Void
          </button>
        </div>
      )}
    </article>
  );
}

function AdminScreen({
  refresh,
  mapDefaultLatitude,
  mapDefaultLongitude,
  mapTileUrl,
  workspace,
}: {
  refresh: () => void;
  mapDefaultLatitude: number;
  mapDefaultLongitude: number;
  mapTileUrl?: string;
  workspace: WorkspaceContext | null;
}) {
  const [token, setToken] = useState(readSessionValue('deckplate.admin') ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState('');
  const [areaForm, setAreaForm] = useState({ name: '', sort_order: '0' });
  const [locationForm, setLocationForm] = useState({
    name: '',
    area_id: '',
    latitude: String(mapDefaultLatitude),
    longitude: String(mapDefaultLongitude),
    radius_meters: '120',
  });
  const [unitForm, setUnitForm] = useState({ name: '', unit_type: 'department' as UnitType, visit_interval_days: '30', location_id: '' });
  const [memberForm, setMemberForm] = useState({ name: '', role: '' });
  const [attachUnitIds, setAttachUnitIds] = useState<string[]>([]);
  const [adminSection, setAdminSection] = useState<'setup' | 'activity' | 'settings'>('setup');
  const [setupSearch, setSetupSearch] = useState('');
  const [activity, setActivity] = useState<AdminCheckin[]>([]);
  const [activityFilters, setActivityFilters] = useState({
    search: '',
    from: '',
    to: '',
    teamMemberId: '',
    areaId: '',
    unitId: '',
    includeVoided: false,
  });
  const [activityPage, setActivityPage] = useState<PageMetadata | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityQueryKey, setActivityQueryKey] = useState('');
  const [actingTeamMemberId, setActingTeamMemberId] = useState('');
  const [gamificationTone, setGamificationTone] = useState<GamificationTone>('professional');
  const [adminAuthMethod, setAdminAuthMethod] = useState('');
  const [organizationAdminAvailable, setOrganizationAdminAvailable] = useState(false);
  const [organizationAdminPassphrase, setOrganizationAdminPassphrase] = useState('');
  const [onboardingSummary, setOnboardingSummary] = useState<OnboardingSummary | null>(null);
  const [showOnboardingChecklist, setShowOnboardingChecklist] = useState(false);
  const kioskHref = kioskLinkForWorkspace(workspace);
  const onboardingChecklistStorageKey = `deckplate.onboardingChecklist.${workspace?.id ?? 'default'}`;

  function lockAdmin() {
    removeSessionValue('deckplate.admin');
    setToken('');
    setData(null);
    setPassphrase('');
    setAdminAuthMethod('');
    setMessage('Admin is locked.');
  }

  function dismissOnboardingChecklist() {
    writeLocalValue(onboardingChecklistStorageKey, 'dismissed');
    setShowOnboardingChecklist(false);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api<{ token: string; authMethod?: string; organization?: WorkspaceContext | null }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ passphrase, organizationId: workspace?.id ?? null }),
      });
      writeSessionValue('deckplate.admin', result.token);
      if (result.organization) {
        writeStoredJson(workspaceKey, result.organization);
      }
      setToken(result.token);
      setAdminAuthMethod(result.authMethod ?? '');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Admin unlock failed.');
    }
  }

  async function loadAdminSettings() {
    try {
      return await api<{
        gamificationTone: GamificationTone;
        adminAuthMethod?: string;
        organizationAdminAvailable?: boolean;
        onboarding?: OnboardingSummary | null;
      }>('/api/admin/settings', { headers: { authorization: `Bearer ${token}` } });
    } catch {
      return { gamificationTone: 'professional' as GamificationTone, adminAuthMethod: '', organizationAdminAvailable: false, onboarding: null };
    }
  }

  async function load() {
    try {
      const [result, settings] = await Promise.all([
        api<AdminData>('/api/admin/locations', { headers: { authorization: `Bearer ${token}` } }),
        loadAdminSettings(),
      ]);
      setData(result);
      setGamificationTone(settings.gamificationTone);
      setAdminAuthMethod(settings.adminAuthMethod ?? adminAuthMethod);
      setOrganizationAdminAvailable(Boolean(settings.organizationAdminAvailable));
      setOnboardingSummary(settings.onboarding ?? null);
      const checklistDismissed = readLocalValue(onboardingChecklistStorageKey) === 'dismissed';
      setShowOnboardingChecklist(Boolean(settings.onboarding && !settings.onboarding.readyForCheckins && !checklistDismissed));
      setLocationForm((current) => ({ ...current, area_id: result.areas[0]?.id ?? current.area_id }));
      setActingTeamMemberId((current) => current || result.teamMembers[0]?.id || '');
    } catch (err) {
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      if (status === 403) {
        removeSessionValue('deckplate.admin');
        setToken('');
        setData(null);
        setAdminAuthMethod('');
        setMessage('Admin session expired. Unlock Admin again.');
        return;
      }
      setMessage(err instanceof Error ? err.message : 'Unable to load Admin.');
    }
  }

  async function saveSettings() {
    try {
      const result = await api<{ gamificationTone: GamificationTone }>('/api/admin/settings', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ gamificationTone }),
      });
      setGamificationTone(result.gamificationTone);
      setMessage('Mission Board tone saved. Users will receive it on their next refresh.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save Mission Board settings.');
    }
  }

  async function saveOrganizationAdminPassphrase() {
    if (organizationAdminPassphrase.length < 12) {
      setMessage('Local admin passphrase must be at least 12 characters.');
      return;
    }
    try {
      const result = await api<{ authMethod: string; token?: string }>('/api/admin/organization-admin/passphrase', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ passphrase: organizationAdminPassphrase }),
      });
      if (result.token) {
        writeSessionValue('deckplate.admin', result.token);
        setToken(result.token);
      }
      setAdminAuthMethod(result.authMethod);
      setOrganizationAdminPassphrase('');
      setMessage('Local admin passphrase saved. Future admin logins can use it.');
      if (!result.token) await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save the local admin passphrase.');
    }
  }

  async function copyKioskLink() {
    const url = new URL(kioskHref, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setMessage('TV dashboard link copied.');
    } catch {
      setMessage(url);
    }
  }

  useEffect(() => {
    if (token) load();
  }, [token]);

  async function createLocation(event: FormEvent) {
    event.preventDefault();
    const latitude = numberFromInput(locationForm.latitude);
    const longitude = numberFromInput(locationForm.longitude);
    const radiusMeters = numberFromInput(locationForm.radius_meters);
    const validationError = locationInputError(latitude, longitude, radiusMeters);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    try {
      await api('/api/admin/locations', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...locationForm,
          latitude,
          longitude,
          radius_meters: radiusMeters,
          active: true,
          unitIds: attachUnitIds,
        }),
      });
      setMessage('Location saved.');
      setLocationForm((current) => ({ ...current, name: '' }));
      setAttachUnitIds([]);
      refresh();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save the location.');
    }
  }

  async function createArea(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/api/admin/areas', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: areaForm.name,
          sort_order: Number(areaForm.sort_order || '0'),
        }),
      });
      setAreaForm({ name: '', sort_order: '0' });
      setMessage('Area saved.');
      refresh();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save the area.');
    }
  }

  async function createUnit(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/api/admin/units', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...unitForm,
          location_id: unitForm.location_id || null,
          visit_interval_days: Number(unitForm.visit_interval_days),
          active: true,
        }),
      });
      setUnitForm((current) => ({ ...current, name: '' }));
      setMessage('Unit saved.');
      refresh();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save the unit.');
    }
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ temporaryPin?: string | null }>('/api/admin/team-members', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...memberForm, active: true }),
      });
      setMemberForm({ name: '', role: '' });
      setMessage(
        result.temporaryPin
          ? `Team member saved. Initial PIN: ${result.temporaryPin}. Deliver it directly and do not include it in screenshots or messages.`
          : 'Team member saved. The member can choose a PIN the first time they sign in.',
      );
      refresh();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save the team member.');
    }
  }

  async function patch(path: string, body: unknown) {
    try {
      await api(path, { method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      setMessage('Changes saved.');
      refresh();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to save changes.');
    }
  }

  async function patchLocation(location: AdminData['locations'][number], values: Record<string, unknown>) {
    const latitude = values.latitude === undefined ? location.latitude : Number(values.latitude);
    const longitude = values.longitude === undefined ? location.longitude : Number(values.longitude);
    const radiusMeters = values.radius_meters === undefined ? location.radius_meters : Number(values.radius_meters);
    const validationError = locationInputError(latitude, longitude, radiusMeters);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    await patch(`/api/admin/locations/${location.id}`, values);
  }

  async function resetMemberPin(memberId: string, memberName: string) {
    const confirmed = window.confirm(
      `Reset PIN and revoke devices for ${memberName}?\n\nThis disables that member's existing devices and issues a replacement PIN. Deliver it directly to the member.`,
    );
    if (!confirmed) return;
    try {
      const result = await api<{ temporaryPin: string }>(`/api/admin/team-members/${memberId}/reset-pin`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      setMessage(
        `PIN reset and devices revoked for ${memberName}. Replacement PIN: ${result.temporaryPin}. Deliver it directly and do not include it in screenshots or messages.`,
      );
      refresh();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to reset the member PIN.');
    }
  }

  async function loadActivity(nextOffset = 0, append = false) {
    if (activityFilters.from && activityFilters.to && activityFilters.from > activityFilters.to) {
      setMessage('The activity start date must be on or before the end date.');
      return;
    }
    const params = new URLSearchParams();
    const queryKey = JSON.stringify(activityFilters);
    params.set('limit', '75');
    params.set('offset', String(nextOffset));
    if (activityFilters.search.trim()) params.set('search', activityFilters.search.trim());
    if (activityFilters.from) {
      params.set('from', activityFilters.from);
      params.set('fromIso', localDayBoundaryIso(activityFilters.from));
    }
    if (activityFilters.to) {
      params.set('to', activityFilters.to);
      params.set('toIso', localDayBoundaryIso(activityFilters.to, true));
    }
    if (activityFilters.teamMemberId) params.set('teamMemberId', activityFilters.teamMemberId);
    if (activityFilters.areaId) params.set('areaId', activityFilters.areaId);
    if (activityFilters.unitId) params.set('unitId', activityFilters.unitId);
    if (activityFilters.includeVoided) params.set('includeVoided', 'true');
    setActivityLoading(true);
    try {
      const result = await api<{ checkins: AdminCheckin[]; page?: PageMetadata }>(`/api/admin/checkins?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      setActivity((current) => (append ? [...current, ...result.checkins] : result.checkins));
      setActivityPage(result.page ?? null);
      setActivityQueryKey(queryKey);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to load the activity log.');
    } finally {
      setActivityLoading(false);
    }
  }

  async function patchCheckin(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/admin/checkins/${id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      setMessage('Activity log updated.');
      refresh();
      await load();
      await loadActivity(0, false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to update the activity log.');
    }
  }

  const filteredActivity = useMemo(
    () =>
      activity.filter((checkin) =>
        matchesSearch(activityFilters.search, [
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
      ),
    [activity, activityFilters.search],
  );

  const filteredAdminAreas = useMemo(
    () => data?.areas.filter((area) => matchesSearch(setupSearch, [area.name, area.sort_order])) ?? [],
    [data?.areas, setupSearch],
  );
  const filteredAdminLocations = useMemo(
    () => {
      if (!data) return [];
      return data.locations.filter((location) => {
        const areaName = data.areas.find((area) => area.id === location.area_id)?.name;
        return matchesSearch(setupSearch, [location.name, areaName, location.latitude, location.longitude, location.active ? 'active' : 'inactive']);
      });
    },
    [data, setupSearch],
  );
  const filteredAdminUnits = useMemo(
    () => {
      if (!data) return [];
      return data.units.filter((unit) => {
        const location = data.locations.find((candidate) => candidate.id === unit.location_id);
        const areaName = data.areas.find((area) => area.id === location?.area_id)?.name;
        return matchesSearch(setupSearch, [
          unit.name,
          unitTypeLabel[unit.unit_type],
          location?.name,
          areaName,
          unit.visit_interval_days,
          unit.active ? 'active' : 'inactive',
        ]);
      });
    },
    [data, setupSearch],
  );
  const filteredAdminTeamMembers = useMemo(
    () => data?.teamMembers.filter((member) => matchesSearch(setupSearch, [member.name, member.role, member.active ? 'active' : 'inactive'])) ?? [],
    [data?.teamMembers, setupSearch],
  );

  useEffect(() => {
    if (token && adminSection === 'activity') void loadActivity();
  }, [token, adminSection]);

  if (!token) {
    return (
      <main className="center-shell">
        <section className="panel">
          <h1>Admin</h1>
          <p className="muted">Workspace: {workspace?.name ?? 'Default Workspace'}</p>
          <form onSubmit={login} className="stack">
            <p className="muted">Enter the local admin passphrase for this workspace. This is not a public account login.</p>
            <label>
              Local admin passphrase
              <input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required />
            </label>
            <button className="primary">Unlock</button>
          </form>
          {message && <p className="notice">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{adminSection === 'setup' ? 'Manage mapping' : adminSection === 'activity' ? 'Activity Log' : 'Admin settings'}</h1>
        </div>
        <button className="secondary" type="button" onClick={lockAdmin}>
          Lock Admin
        </button>
      </div>
      {message && <p className="notice">{message}</p>}
      {adminAuthMethod === 'superuser' && (
        <p className="warning-notice">
          System administrator mode is active for {workspace?.name ?? 'this workspace'}. Changes are scoped to this workspace.
        </p>
      )}
      <WhatChangedPanel audience="admin" />
      <div className="tab-row">
        <button className={adminSection === 'setup' ? 'active' : ''} onClick={() => setAdminSection('setup')}>
          Locations
        </button>
        <button className={adminSection === 'activity' ? 'active' : ''} onClick={() => setAdminSection('activity')}>
          Activity Log
        </button>
        <button className={adminSection === 'settings' ? 'active' : ''} onClick={() => setAdminSection('settings')}>
          Admin settings
        </button>
      </div>
      {adminSection === 'settings' && (
        <>
          <section className="panel">
            <p className="eyebrow">Mission Board</p>
            <h2>Tone</h2>
            <p className="muted">Controls curated in-app nudges only. No notifications, live AI text, or public shaming.</p>
            <label>
              Nudge tone
              <select value={gamificationTone} onChange={(event) => setGamificationTone(event.target.value as GamificationTone)}>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="banter">Deckplate Banter</option>
              </select>
            </label>
            <section className="mission-nudge">
              <p className="eyebrow">Preview</p>
              <p>{missionNudge(gamificationTone, 'red', 'admin-preview')}</p>
            </section>
            <button className="primary" onClick={saveSettings}>
              Save tone
            </button>
          </section>
          <section className="panel">
            <p className="eyebrow">Display</p>
            <h2>TV dashboard</h2>
            <p className="muted">Use this workspace-specific link on the browser connected to the office display.</p>
            <div className="stack">
              <a className="primary link-button" href={kioskHref}>
                Open TV dashboard
              </a>
              <button className="secondary" type="button" onClick={() => void copyKioskLink()}>
                Copy TV dashboard link
              </button>
            </div>
          </section>
          <section className="panel">
            <p className="eyebrow">Managed hosting foundation</p>
            <h2>Local admin passphrase</h2>
            <p className="muted">
              Current admin mode: {adminAuthMethod || 'environment passphrase'}. Managed workspaces should use a local admin passphrase scoped to this workspace.
            </p>
            {organizationAdminAvailable ? (
              <div className="stack">
                <label>
                  New local admin passphrase
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={organizationAdminPassphrase}
                    minLength={12}
                    onChange={(event) => setOrganizationAdminPassphrase(event.target.value)}
                  />
                </label>
                <button className="secondary" onClick={saveOrganizationAdminPassphrase}>
                  Save local admin passphrase
                </button>
              </div>
            ) : (
              <p className="notice">Run migration 006 before using workspace-scoped local admin passphrases.</p>
            )}
          </section>
        </>
      )}
      {adminSection === 'activity' && data && (
        <>
          <section className="panel">
            <h2>Filter activity</h2>
            <div className="filters">
              <input
                aria-label="Search activity log"
                placeholder="Search unit, location, area, or team member"
                value={activityFilters.search}
                onChange={(event) => setActivityFilters({ ...activityFilters, search: event.target.value })}
              />
              <input aria-label="Activity from date" type="date" value={activityFilters.from} onChange={(event) => setActivityFilters({ ...activityFilters, from: event.target.value })} />
              <input aria-label="Activity through date" type="date" value={activityFilters.to} onChange={(event) => setActivityFilters({ ...activityFilters, to: event.target.value })} />
              <select aria-label="Filter activity by team member" value={activityFilters.teamMemberId} onChange={(event) => setActivityFilters({ ...activityFilters, teamMemberId: event.target.value })}>
                <option value="">All team members</option>
                {data.teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <select aria-label="Filter activity by area" value={activityFilters.areaId} onChange={(event) => setActivityFilters({ ...activityFilters, areaId: event.target.value })}>
                <option value="">All areas</option>
                {data.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
              <select aria-label="Filter activity by unit" value={activityFilters.unitId} onChange={(event) => setActivityFilters({ ...activityFilters, unitId: event.target.value })}>
                <option value="">All units</option>
                {data.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={activityFilters.includeVoided}
                  onChange={(event) => setActivityFilters({ ...activityFilters, includeVoided: event.target.checked })}
                />
                Include voided
              </label>
            </div>
            <label>
              Admin acting as
              <select value={actingTeamMemberId} onChange={(event) => setActingTeamMemberId(event.target.value)}>
                {data.teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={() => void loadActivity(0, false)}>
              Apply filters
            </button>
          </section>
          <section className="coverage-list">
            {filteredActivity.map((checkin) => (
              <AdminCheckinRow
                key={checkin.id}
                checkin={checkin}
                units={data.units}
                teamMembers={data.teamMembers}
                actingTeamMemberId={actingTeamMemberId}
                onPatch={patchCheckin}
              />
            ))}
            {!filteredActivity.length && !activityLoading && <p className="notice">No check-ins match the current filters.</p>}
            {activityLoading && !activity.length && <p className="notice" role="status">Loading activity...</p>}
            {activityPage?.hasMore && activityQueryKey === JSON.stringify(activityFilters) && (
              <button
                className="secondary"
                onClick={() => void loadActivity(activityPage.offset + activityPage.returned, true)}
                disabled={activityLoading}
              >
                {activityLoading ? 'Loading...' : 'Load more activity'}
              </button>
            )}
          </section>
        </>
      )}
      {adminSection === 'setup' && (
        <>
          {showOnboardingChecklist && (
            <OnboardingChecklist onboarding={onboardingSummary} onComplete={dismissOnboardingChecklist} />
          )}
          <section className="filters">
            <input
              aria-label="Search admin setup records"
              placeholder="Search saved areas, locations, commands, or team members"
              value={setupSearch}
              onChange={(event) => setSetupSearch(event.target.value)}
            />
          </section>
          <section className="panel">
            <h2>Create area</h2>
            <p className="muted">Use broad, non-sensitive area names. Do not enter restricted room names, deployed locations, or sensitive operational details.</p>
            <form onSubmit={createArea} className="stack">
              <input aria-label="New area name" placeholder="Area name" value={areaForm.name} onChange={(event) => setAreaForm({ ...areaForm, name: event.target.value })} minLength={2} required />
              <input
                aria-label="New area sort order"
                inputMode="numeric"
                placeholder="Sort order"
                value={areaForm.sort_order}
                onChange={(event) => setAreaForm({ ...areaForm, sort_order: event.target.value.replace(/[^0-9-]/g, '') })}
              />
              <button className="primary">Save area</button>
            </form>
          </section>

          <section className="panel">
            <h2>Create location</h2>
            <p className="warning-notice">{locationMappingNotice}</p>
            <form onSubmit={createLocation} className="stack">
              <select aria-label="Area for new location" value={locationForm.area_id} onChange={(event) => setLocationForm({ ...locationForm, area_id: event.target.value })} required>
                {data?.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
              {!data?.areas.length && <p className="notice">Create an area first. Locations are assigned to areas.</p>}
              <input aria-label="New location name" placeholder="Location name" value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} required />
              <AdminMapPicker
                latitude={Number(locationForm.latitude)}
                longitude={Number(locationForm.longitude)}
                mapTileUrl={mapTileUrl}
                onChange={(coords) =>
                  setLocationForm((current) => ({
                    ...current,
                    latitude: coords.latitude.toFixed(6),
                    longitude: coords.longitude.toFixed(6),
                  }))
                }
              />
              <div className="grid-two">
                <label>
                  Latitude
                  <input
                    inputMode="decimal"
                    placeholder="24.570000"
                    value={locationForm.latitude}
                    onChange={(event) => setLocationForm({ ...locationForm, latitude: event.target.value })}
                  />
                </label>
                <label>
                  Longitude
                  <input
                    inputMode="decimal"
                    placeholder="-81.780000"
                    value={locationForm.longitude}
                    onChange={(event) => setLocationForm({ ...locationForm, longitude: event.target.value })}
                  />
                </label>
              </div>
              <label>
                Radius {locationForm.radius_meters}m
                <input
                  type="range"
                  min={minLocationRadiusMeters}
                  max={maxLocationRadiusMeters}
                  value={locationForm.radius_meters}
                  onChange={(event) => setLocationForm({ ...locationForm, radius_meters: event.target.value })}
                />
              </label>
              <label>
                Attach units
                <select
                  multiple
                  value={attachUnitIds}
                  onChange={(event) => setAttachUnitIds(Array.from(event.target.selectedOptions).map((option) => option.value))}
                >
                  {data?.units
                    .filter((unit) => !unit.location_id)
                    .map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                </select>
              </label>
              <button className="primary" disabled={!data?.areas.length}>
                Save location
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Create unit</h2>
            <p className="muted">Do not enter sensitive mission details. Use ordinary department, division, or tenant-command labels only when they are not sensitive.</p>
            <form onSubmit={createUnit} className="stack">
              <input aria-label="New unit name" placeholder="Unit name" value={unitForm.name} onChange={(event) => setUnitForm({ ...unitForm, name: event.target.value })} required />
              <select aria-label="New unit type" value={unitForm.unit_type} onChange={(event) => setUnitForm({ ...unitForm, unit_type: event.target.value as UnitType })}>
                <option value="department">Department</option>
                <option value="division">Division</option>
                <option value="tenant">Tenant command</option>
              </select>
              <select aria-label="Location for new unit" value={unitForm.location_id} onChange={(event) => setUnitForm({ ...unitForm, location_id: event.target.value })}>
                <option value="">Unassigned</option>
                {data?.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <input aria-label="Visit interval in days" type="number" min="1" max="3650" inputMode="numeric" value={unitForm.visit_interval_days} onChange={(event) => setUnitForm({ ...unitForm, visit_interval_days: event.target.value })} required />
              <button className="primary">Save unit</button>
            </form>
          </section>

          <section className="panel">
            <h2>Create team member</h2>
            <p className="muted">
              Create the roster entry, send the workspace link, and deliver any initial PIN directly to the member. On local development
              installs that do not issue an initial PIN, the member creates one on first sign-in.
            </p>
            <p className="warning-notice">
              Use minimum practical display identity, such as rank/last name or role/name. Do not enter phone, DOB, family details, or personal contact info.
            </p>
            <form onSubmit={createMember} className="stack">
              <input aria-label="New team member name" placeholder="Name" value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} required />
              <input aria-label="New team member role" placeholder="Role" value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })} />
              <button className="primary">Save member</button>
            </form>
          </section>

          <section className="coverage-list">
            {filteredAdminAreas.map((area) => (
              <article key={area.id} className="admin-row">
                <input
                  aria-label={`Area name for ${area.name}`}
                  defaultValue={area.name}
                  onBlur={(event) => {
                    if (event.target.value.trim() !== area.name) void patch(`/api/admin/areas/${area.id}`, { name: event.target.value });
                  }}
                />
                <input
                  aria-label={`Sort order for ${area.name}`}
                  inputMode="numeric"
                  defaultValue={area.sort_order}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value !== area.sort_order) void patch(`/api/admin/areas/${area.id}`, { sort_order: value });
                  }}
                />
              </article>
            ))}
            {filteredAdminLocations.map((location) => (
              <article key={location.id} className="admin-row">
                <input
                  aria-label={`Location name for ${location.name}`}
                  defaultValue={location.name}
                  onBlur={(event) => {
                    if (event.target.value.trim() !== location.name) void patchLocation(location, { name: event.target.value });
                  }}
                />
                <div className="grid-two">
                  <label>
                    Latitude
                    <input
                      inputMode="decimal"
                      placeholder="24.570000"
                      defaultValue={location.latitude}
                      onBlur={(event) => patchLocation(location, { latitude: numberFromInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Longitude
                    <input
                      inputMode="decimal"
                      placeholder="-81.780000"
                      defaultValue={location.longitude}
                      onBlur={(event) => patchLocation(location, { longitude: numberFromInput(event.target.value) })}
                    />
                  </label>
                </div>
                <button className="secondary" onClick={() => patchLocation(location, { active: !location.active })}>
                  {location.active ? 'Deactivate' : 'Activate'}
                </button>
              </article>
            ))}
            {filteredAdminUnits.map((unit) => (
              <article key={unit.id} className="admin-row">
                <div>
                  <input
                    aria-label={`Unit name for ${unit.name}`}
                    defaultValue={unit.name}
                    onBlur={(event) => {
                      if (event.target.value.trim() !== unit.name) void patch(`/api/admin/units/${unit.id}`, { name: event.target.value });
                    }}
                  />
                  <input
                    aria-label={`Visit interval in days for ${unit.name}`}
                    inputMode="numeric"
                    defaultValue={unit.visit_interval_days}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value > 0 && value !== unit.visit_interval_days) {
                        void patch(`/api/admin/units/${unit.id}`, { visit_interval_days: value });
                      }
                    }}
                  />
                </div>
                <select aria-label={`Location assignment for ${unit.name}`} value={unit.location_id ?? ''} onChange={(event) => void patch(`/api/admin/units/${unit.id}`, { location_id: event.target.value || null })}>
                  <option value="">Unassigned</option>
                  {data?.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <button className="secondary" onClick={() => patch(`/api/admin/units/${unit.id}`, { active: !unit.active })}>
                  {unit.active ? 'Deactivate' : 'Activate'}
                </button>
              </article>
            ))}
            {filteredAdminTeamMembers.map((member) => (
              <article key={member.id} className="admin-row">
                <div className="stack">
                  <input
                    aria-label={`Team member name for ${member.name}`}
                    defaultValue={member.name}
                    onBlur={(event) => {
                      if (event.target.value.trim() !== member.name) void patch(`/api/admin/team-members/${member.id}`, { name: event.target.value });
                    }}
                  />
                  <input
                    aria-label={`Role for ${member.name}`}
                    defaultValue={member.role ?? ''}
                    onBlur={(event) => {
                      if (event.target.value.trim() !== (member.role ?? '')) void patch(`/api/admin/team-members/${member.id}`, { role: event.target.value });
                    }}
                  />
                  <p className="muted">{member.active ? 'Active roster entry.' : 'Inactive roster entry.'}</p>
                </div>
                <div className="stack">
                  <button className="secondary" onClick={() => patch(`/api/admin/team-members/${member.id}`, { active: !member.active })}>
                    {member.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button className="secondary danger-text" onClick={() => void resetMemberPin(member.id, member.name)}>
                    Reset PIN and revoke devices
                  </button>
                </div>
              </article>
            ))}
            {data &&
              !filteredAdminAreas.length &&
              !filteredAdminLocations.length &&
              !filteredAdminUnits.length &&
              !filteredAdminTeamMembers.length && <p className="notice">No setup records match that search.</p>}
          </section>
        </>
      )}
    </main>
  );
}

function Settings({
  identity,
  workspace,
  members,
  pendingCount,
  onIdentity,
  onSignOut,
  onSwitchWorkspace,
  onOpenSystemAdministration,
  showSystemAdministration,
}: {
  identity: Identity;
  workspace: WorkspaceContext | null;
  members: TeamMember[];
  pendingCount: number;
  onIdentity: (identity: Identity) => void;
  onSignOut: () => Promise<void>;
  onSwitchWorkspace: () => Promise<void>;
  onOpenSystemAdministration: () => void;
  showSystemAdministration: boolean;
}) {
  const [pin, setPin] = useState('');
  const [newMember, setNewMember] = useState(members[0]?.id ?? '');
  const [newPin, setNewPin] = useState('');
  const [currentPinForChange, setCurrentPinForChange] = useState('');
  const [replacementPin, setReplacementPin] = useState('');
  const [replacementPinConfirmation, setReplacementPinConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const kioskHref = kioskLinkForWorkspace(workspace);

  async function changePin(event: FormEvent) {
    event.preventDefault();
    if (replacementPin !== replacementPinConfirmation) {
      setMessage('New PINs do not match.');
      return;
    }
    try {
      await api('/api/device/change-pin', {
        method: 'POST',
        headers: authHeaders(identity),
        body: JSON.stringify({
          currentPin: currentPinForChange,
          newPin: replacementPin,
          deviceToken: identity.deviceToken,
        }),
      });
      setCurrentPinForChange('');
      setReplacementPin('');
      setReplacementPinConfirmation('');
      setMessage('PIN changed. Other signed-in devices for this name were revoked.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to change PIN.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingCount > 0) {
      setMessage('Upload pending visits before changing identity.');
      return;
    }
    const member = members.find((candidate) => candidate.id === newMember);
    if (!member) return;
    try {
      const result = await api<{ deviceId: string; sessionToken: string; organizationId?: string | null }>('/api/device/change-identity', {
        method: 'POST',
        headers: authHeaders(identity),
        body: JSON.stringify({
          currentTeamMemberId: identity.teamMemberId,
          pin,
          newTeamMemberId: newMember,
          newPin,
          deviceToken: identity.deviceToken,
        }),
      });
      const next = {
        ...identity,
        teamMemberId: newMember,
        teamMemberName: member.name,
        organizationId: result.organizationId ?? identity.organizationId ?? null,
        deviceId: result.deviceId,
        sessionToken: result.sessionToken,
      };
      writeStoredJson(identityKey, next);
      onIdentity(next);
      setMessage('Identity changed.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Identity change failed.');
    }
  }

  async function copyKioskLink() {
    const url = new URL(kioskHref, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setMessage('TV dashboard link copied.');
    } catch {
      setMessage(url);
    }
  }

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Account</p>
          <h1>{identity.teamMemberName}</h1>
        </div>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      <section className="panel">
        <h2>Change PIN</h2>
        <p className="muted">Replace an administrator-issued or existing PIN. This device stays signed in; other devices using this name are revoked.</p>
        <form onSubmit={changePin} className="stack">
          <label>
            Current PIN
            <input
              type="password"
              autoComplete="current-password"
              value={currentPinForChange}
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              onChange={(event) => setCurrentPinForChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
          </label>
          <label>
            New PIN
            <input
              type="password"
              autoComplete="new-password"
              value={replacementPin}
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              onChange={(event) => setReplacementPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
          </label>
          <label>
            Confirm new PIN
            <input
              type="password"
              autoComplete="new-password"
              value={replacementPinConfirmation}
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              onChange={(event) => setReplacementPinConfirmation(event.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
          </label>
          <button className="primary">Change PIN</button>
        </form>
      </section>
      <section className="panel">
        <h2>Change identity</h2>
        <form onSubmit={submit} className="stack">
          <label>
            Current PIN
            <input type="password" autoComplete="current-password" value={pin} inputMode="numeric" pattern="\d{4}" maxLength={4} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} required />
          </label>
          <label>
            New name
            <select value={newMember} onChange={(event) => setNewMember(event.target.value)}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            New PIN
            <input type="password" autoComplete="new-password" value={newPin} inputMode="numeric" pattern="\d{4}" maxLength={4} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 4))} required />
          </label>
          <button className="primary">Change</button>
        </form>
      </section>
      <section className="panel">
        <h2>Account</h2>
        <p className="muted">Use these controls to leave the current name or move to another workspace without losing the app state.</p>
        <div className="stack">
          {pendingCount > 0 && <p className="warning-notice">Upload pending visits before signing out or switching workspaces.</p>}
          <button className="secondary" type="button" onClick={() => void onSignOut()} disabled={pendingCount > 0}>
            Sign out of this account
          </button>
          <button className="secondary" type="button" onClick={() => void onSwitchWorkspace()} disabled={pendingCount > 0}>
            Switch workspace
          </button>
          <a className="secondary link-button" href={feedbackUrl} target="_blank" rel="noreferrer">
            Send feedback
          </a>
        </div>
      </section>
      <section className="panel">
        <h2>TV dashboard</h2>
        <p className="muted">Open the workspace kiosk view for a large office display.</p>
        <div className="stack">
          <a className="primary link-button" href={kioskHref}>
            Open TV dashboard
          </a>
          <button className="secondary" type="button" onClick={() => void copyKioskLink()}>
            Copy TV dashboard link
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Safe Use</h2>
        <ul className="plain-list safe-list">
          {safeUseItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      {showSystemAdministration && (
        <section className="panel">
          <h2>System Administration</h2>
          <p className="muted">
            Locked central operator console for workspace approvals, emergency recovery actions, and pilot workspace status.
          </p>
          <button className="secondary" onClick={onOpenSystemAdministration}>
            Open system administration
          </button>
        </section>
      )}
    </main>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [cachedMode, setCachedMode] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(() => readStoredWorkspace() ?? defaultWorkspace);
  const [showWorkspaceEntry, setShowWorkspaceEntry] = useState(false);
  const [showAdminSetup, setShowAdminSetup] = useState(() => Boolean(readSessionValue('deckplate.admin')));
  const [showOperatorConsole, setShowOperatorConsole] = useState(() => Boolean(readSessionValue(operatorKey)) || operatorParamEnabled());
  const [identity, setIdentity] = useState<Identity | null>(() => readStoredIdentity());
  const [screen, setScreen] = useState<Screen>('checkin');
  const [error, setError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [failedBatches, setFailedBatches] = useState<PendingVisitBatch[]>([]);
  const [syncState, setSyncState] = useState<SyncState>('synced');
  const [syncMessage, setSyncMessage] = useState('');
  const [refreshPin, setRefreshPin] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);
  const syncInFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const syncStateRef = useRef(syncState);
  const contextEpoch = useRef(0);
  syncStateRef.current = syncState;

  async function setActiveWorkspace(nextWorkspace: WorkspaceContext | null) {
    const normalized = nextWorkspace ?? defaultWorkspace;
    const currentIdentity = readStoredIdentity();
    const switchingWorkspace = Boolean(
      currentIdentity && (currentIdentity.organizationId ?? defaultWorkspace.id) !== normalized.id,
    );
    if (currentIdentity && switchingWorkspace) {
      try {
        const pending = await countBlockingPendingBatches(
          currentIdentity.teamMemberId,
          currentIdentity.organizationId ?? null,
        );
        if (pending > 0) {
          const notice = 'Upload pending visits before opening another workspace. Your current workspace is still active.';
          setWorkspaceNotice(notice);
          setSyncState('pending');
          setSyncMessage(notice);
          setShowWorkspaceEntry(false);
          setIdentity(currentIdentity);
          await load(currentIdentity);
          return false;
        }
      } catch {
        const notice = 'Offline visit storage could not be checked. Return to the current workspace before switching.';
        setWorkspaceNotice(notice);
        setSyncState('failed');
        setSyncMessage(notice);
        setShowWorkspaceEntry(false);
        setIdentity(currentIdentity);
        await load(currentIdentity);
        return false;
      }
      if (navigator.onLine) {
        try {
          await api('/api/device/logout', {
            method: 'POST',
            headers: authHeaders(currentIdentity),
            timeoutMs: 2500,
          });
        } catch {
          // A local workspace switch can continue when an expired session cannot be revoked.
        }
      }
    }
    contextEpoch.current += 1;
    writeStoredJson(workspaceKey, normalized);
    setWorkspace(normalized);
    setShowWorkspaceEntry(false);
    setWorkspaceNotice('');
    setTeamMembers([]);
    setBootstrap(null);
    setCachedAt(null);
    setCachedMode(false);
    if (!currentIdentity || switchingWorkspace) {
      setPendingCount(0);
      setFailedBatches([]);
      setSyncState('synced');
      setSyncMessage('');
    }
    if (currentIdentity) {
      if ((currentIdentity.organizationId ?? defaultWorkspace.id) !== normalized.id) {
        removeLocalValue(identityKey);
        setIdentity(null);
      } else {
        setIdentity(currentIdentity);
        void load(currentIdentity);
        void refreshPendingCount(currentIdentity);
      }
    }
    removeSessionValue('deckplate.admin');
    removeSessionValue(operatorKey);
    setShowAdminSetup(false);
    setShowOperatorConsole(false);
    setOperatorQueryParam(false);
    void loadTeamMembers(normalized);
    return true;
  }

  function openOperatorConsole() {
    setOperatorQueryParam(true);
    setShowOperatorConsole(true);
  }

  function closeOperatorConsole() {
    removeSessionValue(operatorKey);
    setShowOperatorConsole(false);
    setOperatorQueryParam(false);
  }

  function openWorkspaceAdminFromOperator(adminToken: string, organization: WorkspaceContext) {
    contextEpoch.current += 1;
    writeStoredJson(workspaceKey, organization);
    writeSessionValue('deckplate.admin', adminToken);
    setWorkspace(organization);
    setShowOperatorConsole(false);
    setOperatorQueryParam(false);
    setShowAdminSetup(true);
    setShowWorkspaceEntry(false);
    setTeamMembers([]);
    setBootstrap(null);
    setCachedAt(null);
    setCachedMode(false);
    setScreen('admin');
    const currentIdentity = readStoredIdentity();
    if (currentIdentity) {
      if ((currentIdentity.organizationId ?? defaultWorkspace.id) !== organization.id) {
        removeLocalValue(identityKey);
        setIdentity(null);
      }
    }
    void loadTeamMembers(organization);
  }

  async function signOutIdentity(showWorkspacePicker = false) {
    if (identity && navigator.onLine && pendingCount === 0) {
      try {
        await api('/api/device/logout', {
          method: 'POST',
          headers: authHeaders(identity),
          timeoutMs: 2500,
        });
      } catch {
        // Local sign-out must still work when the network or session is unavailable.
      }
    }
    contextEpoch.current += 1;
    removeLocalValue(identityKey);
    removeSessionValue('deckplate.admin');
    setIdentity(null);
    setShowAdminSetup(false);
    setShowWorkspaceEntry(showWorkspacePicker);
    setScreen('checkin');
    setError('');
    setWorkspaceNotice('');
    setSyncState('synced');
    setSyncMessage('');
    setRefreshPin('');
    setPendingCount(0);
    setFailedBatches([]);
  }

  function handleWorkspaceUnavailable(message = 'This workspace is unavailable. Select or activate a workspace to continue.') {
    contextEpoch.current += 1;
    removeLocalValue(identityKey);
    removeSessionValue('deckplate.admin');
    setIdentity(null);
    setBootstrap(null);
    setTeamMembers([]);
    setFailedBatches([]);
    setShowAdminSetup(false);
    setShowWorkspaceEntry(true);
    setScreen('checkin');
    setError('');
    setWorkspaceNotice(message);
    setSyncState('synced');
    setSyncMessage(message);
  }

  async function loadWorkspaceFromUrl() {
    const requested = workspaceParam();
    if (!requested) return;
    const requestEpoch = contextEpoch.current;
    try {
      const query = looksLikeUuid(requested) ? `organizationId=${encodeURIComponent(requested)}` : `slug=${encodeURIComponent(requested)}`;
      const result = await api<{ organization: WorkspaceContext | null }>(`/api/workspaces/resolve?${query}`);
      if (contextEpoch.current !== requestEpoch) return;
      if (result.organization) await setActiveWorkspace(result.organization);
    } catch (err) {
      if (contextEpoch.current !== requestEpoch) return;
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      if (status === 400 || status === 404) {
        handleWorkspaceUnavailable(err instanceof Error ? err.message : 'Workspace link could not be opened.');
        return;
      }
      setWorkspaceNotice('The workspace link could not be verified. Continuing with the saved workspace until connectivity returns.');
      if (identity) {
        await load(identity);
        await refreshPendingCount(identity);
      } else {
        await loadTeamMembers(workspace);
      }
    }
  }

  async function loadTeamMembers(currentWorkspace = workspace) {
    const requestEpoch = contextEpoch.current;
    try {
      const result = await api<{ teamMembers: TeamMember[]; organization?: WorkspaceContext | null }>(`/api/team-members${workspaceQuery(currentWorkspace)}`);
      if (contextEpoch.current !== requestEpoch) return;
      if (result.organization) {
        writeStoredJson(workspaceKey, result.organization);
        setWorkspace(result.organization);
      }
      setTeamMembers(result.teamMembers);
      setShowWorkspaceEntry(result.teamMembers.length === 0);
      setError('');
      setWorkspaceNotice('');
    } catch (err) {
      if (contextEpoch.current !== requestEpoch) return;
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      if (status === 400 || status === 404) {
        handleWorkspaceUnavailable(err instanceof Error ? err.message : 'Workspace unavailable.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Unable to load team members.');
    }
  }

  async function load(currentIdentity = identity) {
    if (!currentIdentity) return;
    const requestEpoch = contextEpoch.current;
    const requestIsStale = () => contextEpoch.current !== requestEpoch;
    let cached: Awaited<ReturnType<typeof getBootstrapSnapshot>> = null;
    try {
      cached = await getBootstrapSnapshot(currentIdentity.organizationId);
    } catch {
      if (requestIsStale()) return;
      setCachedMode(false);
      setCachedAt(null);
      setSyncMessage('Offline storage is unavailable in this browser.');
      if (!navigator.onLine) {
        setSyncState('failed');
        setError('Offline storage is unavailable. Reconnect and try again, or allow site storage in this browser.');
        return;
      }
    }
    if (requestIsStale()) return;
    if (cached) {
      setBootstrap(cached);
      setTeamMembers(cached.teamMembers);
      setCachedAt(cached.cachedAt);
      setCachedMode(true);
      if (!navigator.onLine) {
        setSyncState('offline');
        setSyncMessage('Offline - cached data.');
        return;
      }
    }
    try {
      setError('');
      const result = await api<Bootstrap>('/api/bootstrap', { headers: authHeaders(currentIdentity), timeoutMs: cached ? 3500 : 10000 });
      if (requestIsStale()) return;
      const nextBootstrap = {
        ...result,
        organizationId: result.organizationId ?? currentIdentity.organizationId ?? null,
      };
      setBootstrap(nextBootstrap);
      setTeamMembers(nextBootstrap.teamMembers);
      if (nextBootstrap.organization) {
        writeStoredJson(workspaceKey, nextBootstrap.organization);
        setWorkspace(nextBootstrap.organization);
      }
      setCachedMode(false);
      setCachedAt(null);
      try {
        await saveBootstrapSnapshot(nextBootstrap);
        if (requestIsStale()) return;
        setSyncMessage('');
      } catch {
        if (requestIsStale()) return;
        setSyncMessage('Online, but offline storage is unavailable in this browser.');
      }
    } catch (err) {
      if (requestIsStale()) return;
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      if (status === 403) {
        if (cached) {
          setBootstrap(cached);
          setTeamMembers(cached.teamMembers);
          setCachedAt(cached.cachedAt);
          setCachedMode(true);
          setSyncState('auth');
          setSyncMessage('Sync needs PIN refresh.');
          return;
        }
        const pending = await countBlockingPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null);
        if (requestIsStale()) return;
        if (pending > 0) {
          setSyncState('auth');
          setSyncMessage('Sync needs PIN refresh.');
        } else {
          contextEpoch.current += 1;
          removeLocalValue(identityKey);
          setIdentity(null);
          setBootstrap(null);
          setSyncMessage('Session expired. Select your name and enter your PIN again.');
          await loadTeamMembers();
        }
        return;
      }
      if (cached) {
        setBootstrap(cached);
        setTeamMembers(cached.teamMembers);
        setCachedAt(cached.cachedAt);
        setCachedMode(true);
        setSyncState('offline');
        setSyncMessage('Offline - cached data.');
      } else {
        setError('Deckplating needs one online launch before offline use.');
      }
    }
  }

  async function refreshPendingCount(currentIdentity = identity) {
    if (!currentIdentity) return;
    const requestEpoch = contextEpoch.current;
    try {
      const batches = await getPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null);
      if (contextEpoch.current !== requestEpoch) return null;
      const blocking = batches.filter((batch) => batch.syncStatus !== 'synced');
      setPendingCount(blocking.length);
      setFailedBatches(
        blocking
          .filter((batch) => batch.syncStatus === 'failed')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      );
      if (blocking.length > 0 && syncStateRef.current === 'synced') setSyncState('pending');
      return blocking.length;
    } catch {
      if (contextEpoch.current !== requestEpoch) return null;
      setSyncMessage('Offline visit storage is unavailable in this browser.');
      return null;
    }
  }

  async function syncPendingOnce(currentIdentity = identity) {
    if (!currentIdentity) return;
    let batches: PendingVisitBatch[];
    try {
      const storedBatches = await getPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null);
      const syncedBatches = storedBatches.filter((batch) => batch.syncStatus === 'synced');
      await Promise.allSettled(syncedBatches.map((batch) => removePendingBatch(batch.clientBatchId)));
      batches = storedBatches
        .filter((batch) => batch.syncStatus !== 'synced')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      setSyncState('failed');
      setSyncMessage('Offline visit storage is unavailable in this browser.');
      return;
    }
    setPendingCount(batches.length);
    setFailedBatches(batches.filter((batch) => batch.syncStatus === 'failed'));
    if (!batches.length) {
      if (syncStateRef.current !== 'auth') {
        setSyncState(cachedMode ? 'offline' : 'synced');
        setSyncMessage('');
      }
      return;
    }
    setSyncState('pending');
    const persistBatch = async (next: PendingVisitBatch) => {
      try {
        await savePendingBatch(next);
        return true;
      } catch {
        setSyncState('failed');
        setSyncMessage('Offline visit storage is unavailable in this browser.');
        return false;
      }
    };
    let deterministicFailures = 0;
    for (const batch of batches) {
      if (!(await persistBatch({ ...batch, syncStatus: 'syncing', lastSyncError: null }))) return;
      try {
        const result = await api<{
          batchId: string;
          checkins: Array<{ id: string; score_awarded: number }>;
          totalScore: number;
        }>('/api/checkins', {
          method: 'POST',
          headers: authHeaders(currentIdentity),
          body: JSON.stringify({
            teamMemberId: currentIdentity.teamMemberId,
            deviceToken: batch.deviceToken,
            clientBatchId: batch.clientBatchId,
            occurredAt: batch.occurredAt,
            locationId: batch.locationId,
            unitIds: batch.unitIds,
            latitude: batch.latitude,
            longitude: batch.longitude,
            accuracyMeters: batch.accuracyMeters,
            manual: batch.manual,
            ...indicatorPayload({
              confidentialCareProvided: batch.confidentialCareProvided,
              referralProvided: batch.referralProvided,
            }),
          }),
        });
        if (
          !(await persistBatch({
            ...batch,
            syncStatus: 'synced',
            serverBatchId: result.batchId,
            checkinIds: result.checkins.map((checkin) => checkin.id),
            totalScore: result.totalScore,
            lastSyncError: null,
          }))
        ) {
          return;
        }
        window.dispatchEvent(new CustomEvent<BatchSyncedDetail>(batchSyncedEvent, {
          detail: {
            clientBatchId: batch.clientBatchId,
            organizationId: currentIdentity.organizationId ?? null,
            teamMemberId: currentIdentity.teamMemberId,
            checkinIds: result.checkins.map((checkin) => checkin.id),
            totalScore: result.totalScore,
          },
        }));
        try {
          await removePendingBatch(batch.clientBatchId);
        } catch {
          setSyncState('failed');
          setSyncMessage('The uploaded visit could not be cleared from offline storage. Retry sync to reconcile it safely.');
          return;
        }
      } catch (err) {
        const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
        if (status === 403) {
          if (!(await persistBatch({ ...batch, syncStatus: 'auth', lastSyncError: 'PIN refresh required.' }))) return;
          setSyncState('auth');
          setSyncMessage('Sync needs PIN refresh.');
          await refreshPendingCount(currentIdentity);
          return;
        }
        if (isNetworkFailure(err)) {
          if (!(await persistBatch({ ...batch, syncStatus: 'pending', lastSyncError: 'Waiting for connectivity.' }))) return;
          setSyncState('offline');
          setSyncMessage('Offline - cached data.');
          await refreshPendingCount(currentIdentity);
          return;
        }
        const deterministicClientFailure = status != null && status >= 400 && status < 500 && status !== 429;
        if (!deterministicClientFailure) {
          if (!(await persistBatch({
            ...batch,
            syncStatus: 'pending',
            lastSyncError: err instanceof Error ? err.message : 'Temporary sync failure.',
          }))) return;
          setSyncState('failed');
          setSyncMessage('Sync is temporarily unavailable. Retry is available.');
          await refreshPendingCount(currentIdentity);
          return;
        }
        if (
          !(await persistBatch({
            ...batch,
            syncStatus: 'failed',
            lastSyncError: err instanceof Error ? err.message : 'Sync failed.',
          }))
        ) {
          return;
        }
        deterministicFailures += 1;
      }
    }
    await refreshPendingCount(currentIdentity);
    if (deterministicFailures > 0) {
      setSyncState('failed');
      setSyncMessage(`${deterministicFailures} saved visit${deterministicFailures === 1 ? '' : 's'} need attention. Other visits were uploaded.`);
    } else {
      setSyncState('synced');
      setSyncMessage('Online and synced.');
    }
    await load(currentIdentity);
  }

  async function discardFailedBatch(batch: PendingVisitBatch) {
    if (!identity) return;
    const confirmed = window.confirm(
      `Remove this failed saved visit from this device?\n\n${batch.unitNames.join(', ')}\n${niceDateTime(batch.occurredAt)}\n\nRetry first if the visit should be recorded. Removing it cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const latest = await getPendingBatch(batch.clientBatchId);
      if (
        !latest ||
        latest.syncStatus !== 'failed' ||
        latest.teamMemberId !== identity.teamMemberId ||
        (latest.organizationId ?? null) !== (identity.organizationId ?? null)
      ) {
        setSyncMessage('That saved visit changed. Refreshing the pending list.');
        await refreshPendingCount(identity);
        return;
      }
      await removePendingBatch(batch.clientBatchId);
      setSyncMessage('Failed saved visit removed from this device.');
      const remaining = await refreshPendingCount(identity);
      if (remaining === 0) setSyncState(cachedMode || !navigator.onLine ? 'offline' : 'synced');
      else setSyncState('pending');
    } catch (err) {
      setSyncState('failed');
      setSyncMessage(err instanceof Error ? err.message : 'Unable to remove the failed saved visit.');
    }
  }

  async function syncPending(currentIdentity = identity) {
    if (!currentIdentity) return;
    const key = `${currentIdentity.organizationId ?? 'default'}:${currentIdentity.teamMemberId}:${currentIdentity.sessionToken}`;
    if (syncInFlight.current?.key === key) return syncInFlight.current.promise;
    const promise = syncPendingOnce(currentIdentity);
    syncInFlight.current = { key, promise };
    try {
      await promise;
    } finally {
      if (syncInFlight.current?.promise === promise) syncInFlight.current = null;
    }
  }

  async function refreshSession(event: FormEvent) {
    event.preventDefault();
    if (!identity || !/^\d{4}$/.test(refreshPin)) return;
    try {
      const result = await api<{ deviceId: string; sessionToken: string; organizationId?: string | null }>('/api/device/register', {
        method: 'POST',
        body: JSON.stringify({
          teamMemberId: identity.teamMemberId,
          pin: refreshPin,
          deviceToken: identity.deviceToken,
          deviceLabel: navigator.userAgent.slice(0, 120),
          organizationId: identity.organizationId ?? workspace?.id ?? null,
        }),
      });
      const next = {
        ...identity,
        organizationId: result.organizationId ?? identity.organizationId ?? null,
        deviceId: result.deviceId,
        sessionToken: result.sessionToken,
      };
      contextEpoch.current += 1;
      writeStoredJson(identityKey, next);
      setIdentity(next);
      setRefreshPin('');
      setSyncState('pending');
      await syncPending(next);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'PIN refresh failed.');
    }
  }

  function handleIdentity(nextIdentity: Identity) {
    contextEpoch.current += 1;
    removeSessionValue('deckplate.admin');
    setShowAdminSetup(false);
    setIdentity(nextIdentity);
    if (nextIdentity.organization) {
      writeStoredJson(workspaceKey, nextIdentity.organization);
      setWorkspace(nextIdentity.organization);
    }
    void load(nextIdentity);
  }

  useEffect(() => {
    const requestedWorkspace = workspaceParam();
    if (operatorParamEnabled()) {
      setShowOperatorConsole(true);
    }
    if (requestedWorkspace) {
      void loadWorkspaceFromUrl();
      return;
    }
    if (identity) {
      void load(identity);
      void refreshPendingCount(identity);
    } else {
      void loadTeamMembers(workspace);
    }
  }, []);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdateReady(true);
        setApplyUpdate(() => () => updateSW(true));
      },
    });
  }, []);

  useEffect(() => {
    if (!identity) return;
    const sync = () => void syncPending(identity);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', sync);
    void syncPending(identity);
    return () => {
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', sync);
    };
  }, [cachedMode, identity?.organizationId, identity?.teamMemberId, identity?.sessionToken]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [screen]);

  if (showOperatorConsole) {
    return <OperatorConsole onClose={closeOperatorConsole} onSuperuserAdmin={openWorkspaceAdminFromOperator} />;
  }
  if (error) {
    return (
      <main className="center-shell">
        <section className="panel stack">
          <h1>Deckplating could not load</h1>
          <p className="error" role="alert">{error}</p>
          <button
            className="primary"
            type="button"
            onClick={() => {
              setError('');
              if (identity) void load(identity);
              else void loadTeamMembers(workspace);
            }}
          >
            Try again
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              if (identity) void signOutIdentity(true);
              else {
                setError('');
                setShowWorkspaceEntry(true);
              }
            }}
          >
            Choose a workspace
          </button>
        </section>
      </main>
    );
  }
  if (!identity) {
    if (showAdminSetup) {
      return (
        <>
          <AdminScreen
            refresh={() => void loadTeamMembers(workspace)}
            mapDefaultLatitude={workspace?.mapDefaultLatitude ?? 24.57}
            mapDefaultLongitude={workspace?.mapDefaultLongitude ?? -81.78}
            mapTileUrl={undefined}
            workspace={workspace}
          />
          <nav className="bottom-nav" aria-label="Admin navigation">
            <button className="active" aria-current="page">Admin</button>
            <button onClick={() => {
              removeSessionValue('deckplate.admin');
              setShowAdminSetup(false);
              void loadTeamMembers(workspace);
            }}>
              Lock Admin
            </button>
          </nav>
        </>
      );
    }
    if (showWorkspaceEntry) {
      return (
        <WorkspaceEntry
          workspace={workspace}
          teamMembers={teamMembers}
          notice={workspaceNotice}
          onBack={() => setShowWorkspaceEntry(false)}
          onWorkspace={setActiveWorkspace}
          onAdminToken={() => {
            setShowAdminSetup(true);
          }}
          onOpenAdmin={() => {
            setShowAdminSetup(true);
          }}
        />
      );
    }
    if (!teamMembers.length) return <main className="center-shell"><p role="status">Loading Deckplating...</p></main>;
    return (
      <IdentitySetup
        members={teamMembers}
        workspace={workspace}
        onWorkspaceChange={() => setShowWorkspaceEntry(true)}
        onRegistered={handleIdentity}
      />
    );
  }
  if (!bootstrap) return <main className="center-shell"><p role="status">Loading Deckplating...</p></main>;

  if (kioskParamEnabled()) {
    return (
      <>
        <KioskDashboard
          identity={identity}
          bootstrap={bootstrap}
          workspace={workspace}
          cachedAt={cachedAt}
          cachedMode={cachedMode}
          onRefresh={() => void load(identity)}
        />
        {syncState === 'auth' && (
          <div className="kiosk-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="kiosk-auth-title">
            <section className="panel stack">
              <h2 id="kiosk-auth-title">Dashboard session needs PIN refresh</h2>
              <p className="muted">Enter the current PIN for {identity.teamMemberName}, or exit the dashboard to choose another identity.</p>
              <form className="stack" onSubmit={refreshSession}>
                <label>
                  Current PIN
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={refreshPin}
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    onChange={(event) => setRefreshPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    required
                  />
                </label>
                <button className="primary">Refresh dashboard</button>
              </form>
              <a className="secondary link-button" href={workspaceHomeLink(workspace)}>Exit dashboard</a>
            </section>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <SyncStatusBar
        state={syncState}
        pendingCount={pendingCount}
        cachedAt={cachedAt}
        message={syncMessage}
        updateReady={updateReady}
        canReload={pendingCount === 0}
        onSyncNow={() => void syncPending(identity)}
        onReload={() => {
          if (pendingCount === 0) void applyUpdate?.();
        }}
      />
      {failedBatches.length > 0 && (
        <section className="sync-recovery" aria-labelledby="sync-recovery-title">
          <div>
            <p className="eyebrow" id="sync-recovery-title">Saved visits need attention</p>
            <p>Retry after correcting the workspace data, or remove a visit that should not be recorded.</p>
          </div>
          <div className="sync-recovery-list">
            {failedBatches.map((batch) => (
              <article key={batch.clientBatchId} className="sync-recovery-row">
                <div>
                  <strong>{batch.unitNames.join(', ')}</strong>
                  <small>{niceDateTime(batch.occurredAt)} - {batch.lastSyncError ?? 'Upload rejected.'}</small>
                </div>
                <button className="secondary danger-text" type="button" onClick={() => void discardFailedBatch(batch)}>
                  Remove
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      {syncState !== 'auth' && (
        <MissionBrief units={bootstrap.units} tone={bootstrap.gamificationTone ?? 'professional'} recentRecovery={false} />
      )}
      {syncState === 'auth' && (
        <form className="pin-refresh" onSubmit={refreshSession}>
          <label>
            Enter your current PIN to refresh sync
            <input
              type="password"
              autoComplete="current-password"
              value={refreshPin}
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              onChange={(event) => setRefreshPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </label>
          <button className="primary">Refresh</button>
        </form>
      )}
      {screen === 'checkin' && (
        <CheckInScreen
          identity={identity}
          bootstrap={bootstrap}
          cachedMode={cachedMode}
          gamificationTone={bootstrap.gamificationTone ?? 'professional'}
          refresh={() => void load(identity)}
          onPendingChanged={() => void refreshPendingCount(identity)}
        />
      )}
      {screen === 'coverage' && (
        <CoverageBoard
          identity={identity}
          areas={bootstrap.areas}
          units={bootstrap.units}
          cachedAt={cachedAt}
          cachedMode={cachedMode}
          gamificationTone={bootstrap.gamificationTone ?? 'professional'}
        />
      )}
      {screen === 'map' && (
        <MapScreen
          units={bootstrap.units}
          mapTileUrl={bootstrap.mapTileUrl}
          mapDefaultLatitude={bootstrap.mapDefaultLatitude}
          mapDefaultLongitude={bootstrap.mapDefaultLongitude}
          offlineMode={cachedMode || !navigator.onLine}
        />
      )}
      {screen === 'admin' && (
        <AdminScreen
          refresh={load}
          mapDefaultLatitude={bootstrap.mapDefaultLatitude}
          mapDefaultLongitude={bootstrap.mapDefaultLongitude}
          mapTileUrl={bootstrap.mapTileUrl}
          workspace={workspace}
        />
      )}
      {screen === 'scoreboard' && (
        cachedMode ? (
          <main className="screen">
            <p className="notice">Mission Board needs a live connection.</p>
          </main>
        ) : (
          <Scoreboard identity={identity} gamificationTone={bootstrap.gamificationTone ?? 'professional'} />
        )
      )}
      {screen === 'settings' && (
        <Settings
          identity={identity}
          workspace={workspace}
          members={bootstrap.teamMembers}
          pendingCount={pendingCount}
          onIdentity={handleIdentity}
          onSignOut={() => signOutIdentity(false)}
          onSwitchWorkspace={() => signOutIdentity(true)}
          onOpenSystemAdministration={openOperatorConsole}
          showSystemAdministration={Boolean(readSessionValue(operatorKey))}
        />
      )}
      <nav className="bottom-nav" aria-label="Primary navigation">
        {[
          ['checkin', 'Check In'],
          ['coverage', 'Coverage'],
          ['map', 'Map'],
          ['scoreboard', 'Scores'],
          ['admin', 'Admin'],
          ['settings', 'Account'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={screen === id ? 'active' : ''}
            onClick={() => setScreen(id as Screen)}
            aria-current={screen === id ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}
