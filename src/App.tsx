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
  getBootstrapSnapshot,
  getPendingBatches,
  removePendingBatch,
  saveBootstrapSnapshot,
  savePendingBatch,
  updatePendingBatchIndicators,
} from './offline';
import { briefForDate } from './content/deckplateBriefs';

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
  maplibrePromise ??= import('maplibre-gl');
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

const safeUseSummary =
  'Use Deckplating only for unclassified, non-sensitive coverage tracking. Do not enter CUI, classified information, sensitive personal information, home addresses, counseling or medical details, or sensitive operational locations.';

const safeUseItems = [
  'Deckplating is not approved for CUI, classified information, or sensitive operational data.',
  'Store only the minimum information needed to track ministry presence.',
  'Do not enter counseling notes, medical information, incident details, family information, addresses, phone numbers, email addresses, dates of birth, or other sensitive PII.',
  'Team display names should be limited to practical operational identity, such as rank and last name.',
  'Map only publicly identifiable facilities, buildings, or general areas.',
  'Do not map SCIFs, restricted spaces, operational locations in theater, residences, or other sensitive locations.',
  'When uncertain, do not map the location. Use manual check-in.',
  'Deckplating is a coverage-awareness tool, not a counseling record, case-management system, or official system of record.',
];

const locationMappingNotice =
  'Map only publicly identifiable buildings or general areas. Do not pin SCIFs, sensitive operational spaces, deployed-unit locations, homes, or any location that should not be broadly shared. When uncertain, leave the location unmapped and use manual check-in.';

const identityKey = 'deckplate.identity';
const workspaceKey = 'deckplate.workspace';
const operatorKey = 'deckplate.operator';
const feedbackUrl = 'https://deckplatingsetup.netlify.app/#feedback';

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

const looksLikeUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const workspaceQuery = (workspace: WorkspaceContext | null) =>
  workspace?.id ? `?organizationId=${encodeURIComponent(workspace.id)}` : '';

async function api<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...requestOptions,
      headers: { 'content-type': 'application/json', ...(requestOptions.headers ?? {}) },
      signal: requestOptions.signal ?? controller.signal,
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
  }
}

const newToken = () => crypto.randomUUID();

const authHeaders = (identity: Identity) => ({ authorization: `Bearer ${identity.sessionToken}` });

const isNetworkFailure = (error: unknown) => {
  const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
  return status == null;
};

const indicatorPayload = (indicators: VisitIndicatorState) => ({
  confidentialCareProvided: indicators.confidentialCareProvided,
  referralProvided: indicators.referralProvided,
});

const statusLabel = (unit: UnitSummary) => {
  if (unit.status === 'gray') return 'Never visited';
  if (unit.status === 'red') return 'Overdue';
  if (unit.status === 'yellow') return 'Due soon';
  return 'Current';
};

const niceDate = (date: string | null) => (date ? new Date(date).toLocaleDateString() : 'Never');

const niceDateTime = (date: string | null) => (date ? new Date(date).toLocaleString() : 'Never');

const matchesSearch = (query: string, values: unknown[]) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
};

const datetimeLocalValue = (date: string) => {
  const parsed = new Date(date);
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

const unitTypeLabel: Record<UnitType, string> = {
  department: 'Department',
  division: 'Division',
  tenant: 'Tenant command',
};

const toneLabel: Record<GamificationTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  banter: 'Deckplate Banter',
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
const missionBriefLastMessageKey = 'deckplate.missionBrief.lastMessage';
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

function missionNudge(tone: GamificationTone, context: MissionBriefContext, key: string) {
  const messages = missionBriefMessages[tone]?.[context] ?? missionBriefMessages.professional[context];
  let total = 0;
  for (const character of key) total += character.charCodeAt(0);
  let message = messages[total % messages.length];
  const lastMessage = localStorage.getItem(missionBriefLastMessageKey);
  if (messages.length > 1 && message === lastMessage) message = messages[(total + 1) % messages.length];
  localStorage.setItem(missionBriefLastMessageKey, message);
  return message;
}

function missionContextFromUnits(units: UnitSummary[], recentRecovery = false): MissionBriefContext {
  if (recentRecovery) return 'recovery';
  if (units.some((unit) => unit.status === 'gray')) return 'gray';
  if (units.some((unit) => unit.status === 'red')) return 'red';
  if (units.some((unit) => unit.status === 'yellow')) return 'yellow';
  return 'current';
}

function readCelebratedBadges() {
  try {
    return JSON.parse(localStorage.getItem(badgeCelebrationsKey) ?? '{}') as Record<string, true>;
  } catch {
    return {};
  }
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
      localStorage.setItem(identityKey, JSON.stringify(identity));
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
  onWorkspace: (workspace: WorkspaceContext | null) => void;
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
    localStorage.removeItem(workspaceKey);
    onWorkspace(defaultWorkspace);
  }

  async function resolveWorkspace(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await api<{ organization: WorkspaceContext | null }>(`/api/workspaces/resolve?slug=${encodeURIComponent(workspaceSlug)}`);
      const next = result.organization ?? defaultWorkspace;
      localStorage.setItem(workspaceKey, JSON.stringify(next));
      onWorkspace(next);
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
      onWorkspace(next);
      sessionStorage.setItem('deckplate.admin', result.token);
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
          Managed pilot sequence: select or request your approved workspace, enter the one-time setup code, confirm the installation map center, set the local admin passphrase, then continue to local setup.
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
              Use this if your workspace has already been approved and you know its slug. New pilots should request access on the setup site before expecting a workspace slug or setup code.
            </p>
            <label>
              Workspace slug
              <input
                value={workspaceSlug}
                placeholder="example-rmt"
                autoCapitalize="none"
                onChange={(event) => setWorkspaceSlug(event.target.value)}
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
              Use the one-time setup code from the Deckplating operator. This does not create an email account or public signup; it activates the already approved workspace for local setup.
            </p>
            <label>
              One-time setup code
              <input
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
                minLength={8}
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
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === 'dismissed');
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
            localStorage.setItem(storageKey, 'dismissed');
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
  const [token, setToken] = useState(sessionStorage.getItem(operatorKey) ?? '');
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

  async function loadOrganizations(currentToken = token) {
    const result = await api<{ organizations: OperatorOrganization[] }>('/api/operator/organizations', {
      headers: { authorization: `Bearer ${currentToken}` },
    });
    setOrganizations(result.organizations);
  }

  async function loadWorkspaceRequests(currentToken = token, nextOffset = 0, append = false) {
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
      sessionStorage.setItem(operatorKey, result.token);
      setToken(result.token);
      setPassphrase('');
      await Promise.all([loadOrganizations(result.token), loadWorkspaceRequests(result.token), loadAuditEvents(result.token)]);
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
      `Approve workspace request for ${request.installation_or_command}?\n\nThis creates the workspace, issues a setup code, sends the welcome email if email is configured, and records an operator audit event.`,
    );
    if (!confirmed) return;
    try {
      const result = await api<{
        organization: Pick<WorkspaceContext, 'id' | 'slug' | 'name'> & { active: boolean };
        code: string;
        requestorNotificationStatus: string;
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
      setMessage(`Approved ${request.installation_or_command}. Requestor email ${result.requestorNotificationStatus}.`);
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
    if (form.passphrase.length < 8) {
      setError('Recovery passphrase must be at least 8 characters.');
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
    void Promise.all([loadOrganizations(token), loadWorkspaceRequests(token), loadAuditEvents(token)]).catch((err) => {
      setError(err instanceof Error ? err.message : 'Unable to load operator console.');
    });
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
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
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
            placeholder="Search requests by command, lead, email, status, or request ID"
            value={workspaceRequestSearch}
            onChange={(event) => setWorkspaceRequestSearch(event.target.value)}
          />
          <select value={workspaceRequestStatus} onChange={(event) => setWorkspaceRequestStatus(event.target.value as typeof workspaceRequestStatus)}>
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
            placeholder="Workspace name"
            value={organizationForm.name}
            onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })}
          />
          <input
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
                  placeholder="Temporary recovery passphrase"
                  value={recoveryForms[organization.id]?.passphrase ?? ''}
                  minLength={8}
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
                  placeholder="Confirm recovery passphrase"
                  value={recoveryForms[organization.id]?.confirmPassphrase ?? ''}
                  minLength={8}
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
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
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
  const brief = useMemo(() => briefForDate(identity.teamMemberId), [identity.teamMemberId]);
  const locationSummaries = useMemo(() => {
    const grouped = new Map<string, LocationSummary>();
    const rank = { gray: 4, red: 3, yellow: 2, green: 1 };
    for (const unit of bootstrap.units) {
      if (!unit.location_id || unit.latitude == null || unit.longitude == null || unit.radius_meters == null) continue;
      const existing = grouped.get(unit.location_id);
      if (existing) {
        existing.units.push(unit);
        existing.status = rank[unit.status] > rank[existing.status] ? unit.status : existing.status;
      } else {
        grouped.set(unit.location_id, {
          id: unit.location_id,
          area_id: unit.area_id ?? '',
          area_name: unit.area_name ?? '',
          name: unit.location_name ?? '',
          latitude: unit.latitude,
          longitude: unit.longitude,
          radius_meters: unit.radius_meters,
          status: unit.status,
          units: [unit],
        });
      }
    }
    return Array.from(grouped.values());
  }, [bootstrap.units]);
  const unmappedUnits = bootstrap.units.filter((unit) => !unit.location_id);

  async function locate() {
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
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const next = { lat: position.coords.latitude, lon: position.coords.longitude };
        const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0;
        setCoords(next);
        try {
          const cachedMatches = findCachedNearbyLocations(bootstrap.units, next.lat, next.lon, accuracy);
          const result = cachedMode
            ? { matches: cachedMatches }
            : await api<{ matches: LocationSummary[] }>(`/api/nearby-locations?lat=${next.lat}&lon=${next.lon}`, {
                headers: authHeaders(identity),
                timeoutMs: 3500,
              });
          const matches = result.matches.length ? result.matches : cachedMatches;
          setMatches(matches);
          setSelected(matches[0]?.units.map((unit) => unit.id) ?? []);
          if (!matches.length) {
            setManualMode(true);
            setMessage(`No saved locations nearby. GPS accuracy: ${Math.round(accuracy)}m. Manual lookup is available.`);
          }
        } catch (err) {
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
          setLocating(false);
        }
      },
      (error) => {
        setLocating(false);
        setManualMode(true);
        const reason = error.code === error.TIMEOUT ? 'Location timed out.' : 'Location permission was not granted.';
        setMessage(`${reason} Use manual unit lookup.`);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 },
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
      await queueBatch(pendingBatch);
      setLoading(false);
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
        await queueBatch(pendingBatch);
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
      const month = new Date().toISOString().slice(0, 7);
      const result = await api<{ rows: LeaderboardRow[] }>(`/api/leaderboard?month=${month}`, {
        headers: authHeaders(identity),
        timeoutMs: 5000,
      });
      const row = result.rows.find((candidate) => candidate.team_member_id === identity.teamMemberId);
      if (!row?.badges.length) return;
      const celebrated = readCelebratedBadges();
      const fresh = row.badges.filter((badge) => !celebrated[celebrationKey(identity.teamMemberId, month, badge)]);
      if (!fresh.length) return;
      for (const badge of fresh) celebrated[celebrationKey(identity.teamMemberId, month, badge)] = true;
      localStorage.setItem(badgeCelebrationsKey, JSON.stringify(celebrated));
      setUnlockedBadges(fresh);
    } catch {
      setUnlockedBadges([]);
    }
  }

  async function undoCheckin() {
    if (!confirmation) return;
    if (confirmation.syncStatus === 'queued') {
      await removePendingBatch(confirmation.clientBatchId);
      setConfirmation(null);
      setUnlockedBadges([]);
      setSelected([]);
      setMessage('Queued visit removed from this device.');
      onPendingChanged();
      return;
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
        body: JSON.stringify({ teamMemberId: identity.teamMemberId, checkinIds: confirmation.checkinIds }),
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
      await updatePendingBatchIndicators(confirmation.clientBatchId, next, identity.organizationId ?? null);
      return;
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
    locate();
  }, []);

  const activeLocation = matches[0];
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
        </section>
      ) : (
        <section className="panel">
          <h2>No saved location nearby</h2>
          <p className="muted">Use manual lookup when the unit is not mapped or GPS is unavailable.</p>
          <button className="secondary" onClick={startManualLookup}>
            Manual unit lookup
          </button>
          {manualMode && (
            <div className="unit-picker">
              <input
                placeholder="Search command, department, building, or area"
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
              />
              <select value={manualLocationId} onChange={(event) => {
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
          <section className="optional-indicators">
            <h3>Optional visit indicators</h3>
            <p className="muted">Optional counts only. Do not add names, circumstances, counseling details, medical information, or other sensitive information.</p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={confirmation.indicators.confidentialCareProvided === true}
                onChange={(event) =>
                  updateIndicators({ ...confirmation.indicators, confidentialCareProvided: event.target.checked ? true : null })
                }
              />
              Confidential care provided
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={confirmation.indicators.referralProvided === true}
                onChange={(event) =>
                  updateIndicators({ ...confirmation.indicators, referralProvided: event.target.checked ? true : null })
                }
              />
              Referral provided
            </label>
          </section>
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
      <span>
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
  const [expanded, setExpanded] = useState(() => localStorage.getItem(missionBriefDateKey) !== today);
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
    localStorage.setItem(missionBriefDateKey, today);
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
  const [reportSearch, setReportSearch] = useState('');
  const [reportFrom, setReportFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));

  const filtered = useMemo(() => {
    return units
      .filter((unit) => !area || unit.area_id === area)
      .filter((unit) => !unitType || unit.unit_type === unitType)
      .filter((unit) => !overdueOnly || unit.status === 'red')
      .filter((unit) => !neverOnly || unit.status === 'gray')
      .filter((unit) => !from || (unit.last_visit_at && unit.last_visit_at >= from))
      .filter((unit) => !to || (unit.last_visit_at && unit.last_visit_at <= `${to}T23:59:59`))
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
    setSelectedUnit(unit);
    setDetail(null);
    setDetailMessage('');
    if (cachedMode || !navigator.onLine) {
      setDetailMessage('Recent check-ins need a live connection.');
      return;
    }
    try {
      const result = await api<CoverageDetail>(`/api/coverage-detail?unitId=${unit.id}`, {
        headers: authHeaders(identity),
        timeoutMs: 5000,
      });
      setDetail(result);
    } catch (err) {
      setDetailMessage(err instanceof Error ? err.message : 'Unable to load recent check-ins.');
    }
  }

  async function loadReport() {
    if (cachedMode || !navigator.onLine) {
      setReportMessage('Referral and care reporting needs a live connection.');
      return;
    }
    setReportMessage('');
    try {
      const params = new URLSearchParams();
      if (reportFrom) params.set('from', reportFrom);
      if (reportTo) params.set('to', reportTo);
      const result = await api<{ rows: IndicatorReportRow[] }>(`/api/reports/indicators?${params.toString()}`, {
        headers: authHeaders(identity),
        timeoutMs: 6000,
      });
      setReportRows(result.rows);
      if (!result.rows.length) setReportMessage('No indicator activity found for this date range.');
    } catch (err) {
      setReportMessage(err instanceof Error ? err.message : 'Unable to load indicator report.');
    }
  }

  function closeUnitDetail() {
    setSelectedUnit(null);
    setDetail(null);
    setDetailMessage('');
  }

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
                  {(checkin.confidential_care_provided || checkin.referral_provided) && (
                    <span className="status-pill">
                      {checkin.confidential_care_provided ? 'Care' : ''}
                      {checkin.confidential_care_provided && checkin.referral_provided ? ' / ' : ''}
                      {checkin.referral_provided ? 'Referral' : ''}
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
          placeholder="Search command, department, building, area, or visitor"
          value={unitSearch}
          onChange={(event) => setUnitSearch(event.target.value)}
        />
        <select value={area} onChange={(event) => setArea(event.target.value)}>
          <option value="">All areas</option>
          {areas.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        <select value={unitType} onChange={(event) => setUnitType(event.target.value)}>
          <option value="">All types</option>
          <option value="department">Departments</option>
          <option value="division">Divisions</option>
          <option value="tenant">Tenant commands</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />
          Overdue
        </label>
        <label className="toggle">
          <input type="checkbox" checked={neverOnly} onChange={(event) => setNeverOnly(event.target.checked)} />
          Never
        </label>
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
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
        <section className="panel report-panel">
          <p className="eyebrow">Reports</p>
          <h2>Referrals and confidential care</h2>
          <p className="muted">Generic location-level counts only. Multi-unit visits are not attributed to each selected command.</p>
          <div className="filters">
            <input
              placeholder="Search report rows"
              value={reportSearch}
              onChange={(event) => setReportSearch(event.target.value)}
            />
            <input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} />
            <input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} />
            <button className="secondary" onClick={loadReport}>Load referral/care report</button>
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
                      <dt>Care</dt>
                      <dd>{row.confidential_care_count}</dd>
                    </div>
                    <div>
                      <dt>Referrals</dt>
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
  const locations = useMemo(() => {
    const grouped = new Map<string, LocationSummary>();
    for (const unit of units) {
      if (!unit.location_id || unit.latitude == null || unit.longitude == null || unit.radius_meters == null) continue;
      const existing = grouped.get(unit.location_id);
      const rank = { gray: 4, red: 3, yellow: 2, green: 1 };
      if (existing) {
        existing.units.push(unit);
        existing.status = rank[unit.status] > rank[existing.status] ? unit.status : existing.status;
      } else {
        grouped.set(unit.location_id, {
          id: unit.location_id,
          area_id: unit.area_id ?? '',
          area_name: unit.area_name ?? '',
          name: unit.location_name ?? '',
          latitude: unit.latitude,
          longitude: unit.longitude,
          radius_meters: unit.radius_meters,
          status: unit.status,
          units: [unit],
        });
      }
    }
    return Array.from(grouped.values());
  }, [units]);
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
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !container.current || map.current) return;
      map.current = new maplibregl.Map({
        container: container.current,
        style: mapTileUrl || {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: 'OpenStreetMap',
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        center: [mapDefaultLongitude, mapDefaultLatitude],
        zoom: 11,
      });
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      setMapReady(false);
      map.current?.remove();
      map.current = null;
    };
  }, [mapDefaultLatitude, mapDefaultLongitude, mapTileUrl, offlineMode]);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    let cancelled = false;
    const markers: MapLibreMarker[] = [];
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !map.current) return;
      const drawRadii = () => {
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
        const existing = map.current!.getSource('location-radii') as GeoJSONSource | undefined;
        if (existing) {
          existing.setData(sourceData);
          return;
        }
        map.current!.addSource('location-radii', { type: 'geojson', data: sourceData });
        map.current!.addLayer({
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
        map.current!.addLayer({
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
          .setPopup(
            new maplibregl.Popup().setHTML(
              `<strong>${location.name}</strong><br>${location.area_name}<br>Radius: ${location.radius_meters}m<br>${location.units
                .map((unit) => `${unit.name}: ${statusLabel(unit)} (${niceDate(unit.last_visit_at)})`)
                .join('<br>')}`,
            ),
          )
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
        <div ref={container} className="map-canvas" />
      )}
      <section className="filters">
        <input
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

function Scoreboard({ identity, gamificationTone }: { identity: Identity; gamificationTone: GamificationTone }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [summary, setSummary] = useState<MissionBoardSummary | null>(null);
  const [winners, setWinners] = useState<{ weeks: LeaderboardWinner[]; month: LeaderboardWinner | null }>({ weeks: [], month: null });
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedBadge, setSelectedBadge] = useState<{ memberId: string; badge: MissionBadge } | null>(null);

  useEffect(() => {
    api<{ rows: LeaderboardRow[]; summary: MissionBoardSummary; winners?: { weeks: LeaderboardWinner[]; month: LeaderboardWinner | null } }>(`/api/leaderboard?month=${month}`, { headers: authHeaders(identity) }).then(
      (result) => {
        setRows(result.rows);
        setSummary(result.summary);
        setWinners(result.winners ?? { weeks: [], month: null });
      },
    );
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
      <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
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
          <article
            key={row.team_member_id}
            className="score-row mission-row"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedBadge({ memberId: row.team_member_id, badge: row.badges[0] ?? 'first_rounds' })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setSelectedBadge({ memberId: row.team_member_id, badge: row.badges[0] ?? 'first_rounds' });
            }}
          >
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
                      <span
                        key={badge}
                        className="status-pill mission-badge"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedBadge({ memberId: row.team_member_id, badge });
                        }}
                      >
                        <span className="mini-badge-icon">{badgeDetails[badge].icon}</span>
                        {badgeLabel[badge]}
                      </span>
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
        {!rows.length && <p className="notice">No Mission Board activity for this month yet.</p>}
      </section>
    </main>
  );
}

function AdminMapPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number;
  longitude: number;
  onChange: (coords: { latitude: number; longitude: number }) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<MapLibreMarker | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !container.current || map.current) return;
      const nextMap = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: 'OpenStreetMap',
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
        onChange({ latitude: point.lat, longitude: point.lng });
      });
      nextMap.on('click', (event) => {
        nextMarker.setLngLat(event.lngLat);
        onChange({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([longitude, latitude]);
    map.current?.setCenter([longitude, latitude]);
  }, [latitude, longitude]);

  return <div ref={container} className="admin-map" />;
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
  const voided = Boolean(checkin.voided_at);

  async function saveCorrections() {
    await onPatch(checkin.id, {
      adminTeamMemberId: actingTeamMemberId,
      unit_id: unitId,
      team_member_id: teamMemberId,
      checked_in_at: localDateTimeToIso(checkedInAt),
      confidentialCareProvided: confidentialCareProvided ? true : null,
      referralProvided: referralProvided ? true : null,
    });
  }

  async function voidCheckin() {
    if (!window.confirm('Void this check-in? It will stay in the log but no longer count for coverage or scores.')) return;
    await onPatch(checkin.id, {
      adminTeamMemberId: actingTeamMemberId,
      voided: true,
      void_reason: voidReason,
    });
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
        {(checkin.confidential_care_provided || checkin.referral_provided) && (
          <span className="status-pill">
            {checkin.confidential_care_provided ? 'Care' : ''}
            {checkin.confidential_care_provided && checkin.referral_provided ? ' / ' : ''}
            {checkin.referral_provided ? 'Referral' : ''}
          </span>
        )}
      </div>
      {!voided && (
        <div className="activity-edit">
          <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
          <select value={teamMemberId} onChange={(event) => setTeamMemberId(event.target.value)}>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <input type="datetime-local" value={checkedInAt} onChange={(event) => setCheckedInAt(event.target.value)} />
          <section className="optional-indicators admin-indicators">
            <h3>Optional visit indicators</h3>
            <p className="muted">Counts only. Do not add counseling notes, referral details, names, or sensitive information.</p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={confidentialCareProvided}
                onChange={(event) => setConfidentialCareProvided(event.target.checked)}
              />
              Counseling or confidential care happened
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={referralProvided}
                onChange={(event) => setReferralProvided(event.target.checked)}
              />
              Referral happened
            </label>
          </section>
          <button className="secondary" onClick={saveCorrections} disabled={!actingTeamMemberId}>
            Save edit
          </button>
          <select value={voidReason} onChange={(event) => setVoidReason(event.target.value)}>
            <option value="accidental">Accidental</option>
            <option value="wrong_unit">Wrong unit</option>
            <option value="duplicate">Duplicate</option>
            <option value="incorrect_datetime">Incorrect date/time</option>
            <option value="incorrect_member">Incorrect member</option>
          </select>
          <button className="secondary danger-text" onClick={voidCheckin} disabled={!actingTeamMemberId}>
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
  workspace,
}: {
  refresh: () => void;
  mapDefaultLatitude: number;
  mapDefaultLongitude: number;
  workspace: WorkspaceContext | null;
}) {
  const [token, setToken] = useState(sessionStorage.getItem('deckplate.admin') ?? '');
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
  const [showOnboardingChecklist, setShowOnboardingChecklist] = useState(true);

  async function login(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api<{ token: string; authMethod?: string; organization?: WorkspaceContext | null }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ passphrase, organizationId: workspace?.id ?? null }),
      });
      sessionStorage.setItem('deckplate.admin', result.token);
      if (result.organization) {
        localStorage.setItem(workspaceKey, JSON.stringify(result.organization));
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
      if (!settings.onboarding?.readyForCheckins) {
        setShowOnboardingChecklist(true);
      }
      setLocationForm((current) => ({ ...current, area_id: result.areas[0]?.id ?? current.area_id }));
      setActingTeamMemberId((current) => current || result.teamMembers[0]?.id || '');
    } catch (err) {
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      if (status === 403) {
        sessionStorage.removeItem('deckplate.admin');
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
    const result = await api<{ gamificationTone: GamificationTone }>('/api/admin/settings', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ gamificationTone }),
    });
    setGamificationTone(result.gamificationTone);
    setMessage('Mission Board tone saved. Users will receive it on their next refresh.');
  }

  async function saveOrganizationAdminPassphrase() {
    if (organizationAdminPassphrase.length < 8) {
      setMessage('Local admin passphrase must be at least 8 characters.');
      return;
    }
    const result = await api<{ authMethod: string }>('/api/admin/organization-admin/passphrase', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ passphrase: organizationAdminPassphrase }),
    });
    setAdminAuthMethod(result.authMethod);
    setOrganizationAdminPassphrase('');
    setMessage('Local admin passphrase saved. Future admin logins can use it.');
    await load();
  }

  useEffect(() => {
    if (token) load();
  }, [token]);

  async function createLocation(event: FormEvent) {
    event.preventDefault();
    await api('/api/admin/locations', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...locationForm,
        latitude: Number(locationForm.latitude),
        longitude: Number(locationForm.longitude),
        radius_meters: Number(locationForm.radius_meters),
        active: true,
        unitIds: attachUnitIds,
      }),
    });
    setMessage('Location saved.');
    setAttachUnitIds([]);
    refresh();
    load();
  }

  async function createArea(event: FormEvent) {
    event.preventDefault();
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
    load();
  }

  async function createUnit(event: FormEvent) {
    event.preventDefault();
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
    setMessage('Unit saved.');
    refresh();
    load();
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    await api('/api/admin/team-members', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...memberForm, active: true }),
    });
    setMessage('Team member saved.');
    refresh();
    load();
  }

  async function patch(path: string, body: unknown) {
    await api(path, { method: 'PATCH', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    refresh();
    load();
  }

  async function resetMemberPin(memberId: string, memberName: string) {
    const confirmed = window.confirm(
      `Reset PIN and revoke devices for ${memberName}?\n\nThis clears the current PIN, disables that member's existing devices in this workspace, and forces the member to choose a new PIN the next time they select their name.`,
    );
    if (!confirmed) return;
    await api(`/api/admin/team-members/${memberId}/reset-pin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    setMessage(`PIN reset and devices revoked for ${memberName}.`);
    refresh();
    await load();
  }

  async function loadActivity(nextOffset = 0, append = false) {
    const params = new URLSearchParams();
    const queryKey = JSON.stringify(activityFilters);
    params.set('limit', '75');
    params.set('offset', String(nextOffset));
    if (activityFilters.search.trim()) params.set('search', activityFilters.search.trim());
    if (activityFilters.from) params.set('from', activityFilters.from);
    if (activityFilters.to) params.set('to', activityFilters.to);
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
    } finally {
      setActivityLoading(false);
    }
  }

  async function patchCheckin(id: string, body: Record<string, unknown>) {
    await api(`/api/admin/checkins/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    setMessage('Activity log updated.');
    refresh();
    await load();
    await loadActivity(0, false);
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
          checkin.confidential_care_provided ? 'care counseling confidential' : '',
          checkin.referral_provided ? 'referral' : '',
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
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
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
                    value={organizationAdminPassphrase}
                    minLength={8}
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
                placeholder="Search unit, location, area, team member, care, referral"
                value={activityFilters.search}
                onChange={(event) => setActivityFilters({ ...activityFilters, search: event.target.value })}
              />
              <input type="date" value={activityFilters.from} onChange={(event) => setActivityFilters({ ...activityFilters, from: event.target.value })} />
              <input type="date" value={activityFilters.to} onChange={(event) => setActivityFilters({ ...activityFilters, to: event.target.value })} />
              <select value={activityFilters.teamMemberId} onChange={(event) => setActivityFilters({ ...activityFilters, teamMemberId: event.target.value })}>
                <option value="">All team members</option>
                {data.teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <select value={activityFilters.areaId} onChange={(event) => setActivityFilters({ ...activityFilters, areaId: event.target.value })}>
                <option value="">All areas</option>
                {data.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
              <select value={activityFilters.unitId} onChange={(event) => setActivityFilters({ ...activityFilters, unitId: event.target.value })}>
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
            {!filteredActivity.length && <p className="notice">No check-ins match the current filters.</p>}
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
            <OnboardingChecklist onboarding={onboardingSummary} onComplete={() => setShowOnboardingChecklist(false)} />
          )}
          <section className="filters">
            <input
              placeholder="Search saved areas, locations, commands, or team members"
              value={setupSearch}
              onChange={(event) => setSetupSearch(event.target.value)}
            />
          </section>
          <section className="panel">
            <h2>Create area</h2>
            <form onSubmit={createArea} className="stack">
              <input placeholder="Area name" value={areaForm.name} onChange={(event) => setAreaForm({ ...areaForm, name: event.target.value })} />
              <input
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
              <select value={locationForm.area_id} onChange={(event) => setLocationForm({ ...locationForm, area_id: event.target.value })}>
                {data?.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
              {!data?.areas.length && <p className="notice">Create an area first. Locations are assigned to areas.</p>}
              <input placeholder="Location name" value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} />
              <AdminMapPicker
                latitude={Number(locationForm.latitude)}
                longitude={Number(locationForm.longitude)}
                onChange={(coords) =>
                  setLocationForm({
                    ...locationForm,
                    latitude: coords.latitude.toFixed(6),
                    longitude: coords.longitude.toFixed(6),
                  })
                }
              />
              <div className="grid-two">
                <input inputMode="decimal" value={locationForm.latitude} onChange={(event) => setLocationForm({ ...locationForm, latitude: event.target.value })} />
                <input inputMode="decimal" value={locationForm.longitude} onChange={(event) => setLocationForm({ ...locationForm, longitude: event.target.value })} />
              </div>
              <label>
                Radius {locationForm.radius_meters}m
                <input type="range" min="25" max="750" value={locationForm.radius_meters} onChange={(event) => setLocationForm({ ...locationForm, radius_meters: event.target.value })} />
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
            <form onSubmit={createUnit} className="stack">
              <input placeholder="Unit name" value={unitForm.name} onChange={(event) => setUnitForm({ ...unitForm, name: event.target.value })} />
              <select value={unitForm.unit_type} onChange={(event) => setUnitForm({ ...unitForm, unit_type: event.target.value as UnitType })}>
                <option value="department">Department</option>
                <option value="division">Division</option>
                <option value="tenant">Tenant command</option>
              </select>
              <select value={unitForm.location_id} onChange={(event) => setUnitForm({ ...unitForm, location_id: event.target.value })}>
                <option value="">Unassigned</option>
                {data?.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <input inputMode="numeric" value={unitForm.visit_interval_days} onChange={(event) => setUnitForm({ ...unitForm, visit_interval_days: event.target.value })} />
              <button className="primary">Save unit</button>
            </form>
          </section>

          <section className="panel">
            <h2>Create team member</h2>
            <p className="muted">
              This is the current grant-access workflow: create the roster entry here, send the workspace link, then the member selects
              their name and creates their own PIN on first sign-in.
            </p>
            <form onSubmit={createMember} className="stack">
              <input placeholder="Name" value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} />
              <input placeholder="Role" value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })} />
              <button className="primary">Save member</button>
            </form>
          </section>

          <section className="coverage-list">
            {filteredAdminAreas.map((area) => (
              <article key={area.id} className="admin-row">
                <input defaultValue={area.name} onBlur={(event) => patch(`/api/admin/areas/${area.id}`, { name: event.target.value })} />
                <input
                  inputMode="numeric"
                  defaultValue={area.sort_order}
                  onBlur={(event) => patch(`/api/admin/areas/${area.id}`, { sort_order: Number(event.target.value) })}
                />
              </article>
            ))}
            {filteredAdminLocations.map((location) => (
              <article key={location.id} className="admin-row">
                <input defaultValue={location.name} onBlur={(event) => patch(`/api/admin/locations/${location.id}`, { name: event.target.value })} />
                <div className="grid-two">
                  <input
                    inputMode="decimal"
                    defaultValue={location.latitude}
                    onBlur={(event) => patch(`/api/admin/locations/${location.id}`, { latitude: Number(event.target.value) })}
                  />
                  <input
                    inputMode="decimal"
                    defaultValue={location.longitude}
                    onBlur={(event) => patch(`/api/admin/locations/${location.id}`, { longitude: Number(event.target.value) })}
                  />
                </div>
                <button className="secondary" onClick={() => patch(`/api/admin/locations/${location.id}`, { active: !location.active })}>
                  {location.active ? 'Deactivate' : 'Activate'}
                </button>
              </article>
            ))}
            {filteredAdminUnits.map((unit) => (
              <article key={unit.id} className="admin-row">
                <div>
                  <input defaultValue={unit.name} onBlur={(event) => patch(`/api/admin/units/${unit.id}`, { name: event.target.value })} />
                  <input
                    inputMode="numeric"
                    defaultValue={unit.visit_interval_days}
                    onBlur={(event) => patch(`/api/admin/units/${unit.id}`, { visit_interval_days: Number(event.target.value) })}
                  />
                </div>
                <select value={unit.location_id ?? ''} onChange={(event) => patch(`/api/admin/units/${unit.id}`, { location_id: event.target.value || null })}>
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
                  <input defaultValue={member.name} onBlur={(event) => patch(`/api/admin/team-members/${member.id}`, { name: event.target.value })} />
                  <input defaultValue={member.role ?? ''} onBlur={(event) => patch(`/api/admin/team-members/${member.id}`, { role: event.target.value })} />
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
  members,
  pendingCount,
  onIdentity,
  onSignOut,
  onSwitchWorkspace,
  onOpenSystemAdministration,
  showSystemAdministration,
}: {
  identity: Identity;
  members: TeamMember[];
  pendingCount: number;
  onIdentity: (identity: Identity) => void;
  onSignOut: () => void;
  onSwitchWorkspace: () => void;
  onOpenSystemAdministration: () => void;
  showSystemAdministration: boolean;
}) {
  const [pin, setPin] = useState('');
  const [newMember, setNewMember] = useState(members[0]?.id ?? '');
  const [newPin, setNewPin] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingCount > 0) {
      setMessage('Sync or intentionally discard pending visits before changing identity.');
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
      localStorage.setItem(identityKey, JSON.stringify(next));
      onIdentity(next);
      setMessage('Identity changed.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Identity change failed.');
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
      <section className="panel">
        <h2>Change identity</h2>
        <form onSubmit={submit} className="stack">
          <label>
            Current PIN
            <input value={pin} inputMode="numeric" pattern="\d{4}" maxLength={4} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} />
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
            <input value={newPin} inputMode="numeric" pattern="\d{4}" maxLength={4} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 4))} />
          </label>
          <button className="primary">Change</button>
        </form>
        {message && <p className="notice">{message}</p>}
      </section>
      <section className="panel">
        <h2>Account</h2>
        <p className="muted">Use these controls to leave the current name or move to another workspace without losing the app state.</p>
        <div className="stack">
          <button className="secondary" type="button" onClick={onSignOut}>
            Sign out of this account
          </button>
          <button className="secondary" type="button" onClick={onSwitchWorkspace}>
            Switch workspace
          </button>
          <a className="secondary link-button" href={feedbackUrl} target="_blank" rel="noreferrer">
            Send feedback
          </a>
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
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(() => {
    const stored = localStorage.getItem(workspaceKey);
    if (!stored) return defaultWorkspace;
    try {
      return JSON.parse(stored) as WorkspaceContext;
    } catch {
      return defaultWorkspace;
    }
  });
  const [showWorkspaceEntry, setShowWorkspaceEntry] = useState(false);
  const [showAdminSetup, setShowAdminSetup] = useState(() => Boolean(sessionStorage.getItem('deckplate.admin')));
  const [showOperatorConsole, setShowOperatorConsole] = useState(() => Boolean(sessionStorage.getItem(operatorKey)) || operatorParamEnabled());
  const [identity, setIdentity] = useState<Identity | null>(() => {
    const stored = localStorage.getItem(identityKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Identity;
    return parsed.sessionToken ? parsed : null;
  });
  const [screen, setScreen] = useState<Screen>('checkin');
  const [error, setError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>('synced');
  const [syncMessage, setSyncMessage] = useState('');
  const [refreshPin, setRefreshPin] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);

  function setActiveWorkspace(nextWorkspace: WorkspaceContext | null) {
    const normalized = nextWorkspace ?? defaultWorkspace;
    localStorage.setItem(workspaceKey, JSON.stringify(normalized));
    setWorkspace(normalized);
    setShowWorkspaceEntry(false);
    setWorkspaceNotice('');
    setTeamMembers([]);
    setBootstrap(null);
    setCachedAt(null);
    setCachedMode(false);
    const currentIdentity = localStorage.getItem(identityKey);
    if (currentIdentity) {
      try {
        const parsed = JSON.parse(currentIdentity) as Identity;
        if ((parsed.organizationId ?? defaultWorkspace.id) !== normalized.id) {
          localStorage.removeItem(identityKey);
          setIdentity(null);
        } else {
          setIdentity(parsed);
          void load(parsed);
        }
      } catch {
        localStorage.removeItem(identityKey);
        setIdentity(null);
      }
    }
    sessionStorage.removeItem('deckplate.admin');
    sessionStorage.removeItem(operatorKey);
    setShowAdminSetup(false);
    setShowOperatorConsole(false);
    setOperatorQueryParam(false);
    void loadTeamMembers(normalized);
  }

  function openOperatorConsole() {
    setOperatorQueryParam(true);
    setShowOperatorConsole(true);
  }

  function closeOperatorConsole() {
    sessionStorage.removeItem(operatorKey);
    setShowOperatorConsole(false);
    setOperatorQueryParam(false);
  }

  function openWorkspaceAdminFromOperator(adminToken: string, organization: WorkspaceContext) {
    localStorage.setItem(workspaceKey, JSON.stringify(organization));
    sessionStorage.setItem('deckplate.admin', adminToken);
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
    const currentIdentity = localStorage.getItem(identityKey);
    if (currentIdentity) {
      try {
        const parsed = JSON.parse(currentIdentity) as Identity;
        if ((parsed.organizationId ?? defaultWorkspace.id) !== organization.id) {
          localStorage.removeItem(identityKey);
          setIdentity(null);
        }
      } catch {
        localStorage.removeItem(identityKey);
        setIdentity(null);
      }
    }
    void loadTeamMembers(organization);
  }

  function signOutIdentity(showWorkspacePicker = false) {
    localStorage.removeItem(identityKey);
    sessionStorage.removeItem('deckplate.admin');
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
  }

  function handleWorkspaceUnavailable(message = 'This workspace is unavailable. Select or activate a workspace to continue.') {
    localStorage.removeItem(identityKey);
    sessionStorage.removeItem('deckplate.admin');
    setIdentity(null);
    setBootstrap(null);
    setTeamMembers([]);
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
    try {
      const query = looksLikeUuid(requested) ? `organizationId=${encodeURIComponent(requested)}` : `slug=${encodeURIComponent(requested)}`;
      const result = await api<{ organization: WorkspaceContext | null }>(`/api/workspaces/resolve?${query}`);
      if (result.organization) setActiveWorkspace(result.organization);
    } catch (err) {
      handleWorkspaceUnavailable(err instanceof Error ? err.message : 'Workspace link could not be opened.');
    }
  }

  async function loadTeamMembers(currentWorkspace = workspace) {
    try {
      const result = await api<{ teamMembers: TeamMember[]; organization?: WorkspaceContext | null }>(`/api/team-members${workspaceQuery(currentWorkspace)}`);
      if (result.organization) {
        localStorage.setItem(workspaceKey, JSON.stringify(result.organization));
        setWorkspace(result.organization);
      }
      setTeamMembers(result.teamMembers);
      setShowWorkspaceEntry(result.teamMembers.length === 0);
      setError('');
      setWorkspaceNotice('');
    } catch (err) {
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
    const cached = await getBootstrapSnapshot(currentIdentity.organizationId);
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
      const nextBootstrap = await api<Bootstrap>('/api/bootstrap', { headers: authHeaders(currentIdentity), timeoutMs: cached ? 3500 : 10000 });
      setBootstrap(nextBootstrap);
      if (nextBootstrap.organization) {
        localStorage.setItem(workspaceKey, JSON.stringify(nextBootstrap.organization));
        setWorkspace(nextBootstrap.organization);
      }
      setCachedMode(false);
      setCachedAt(null);
      await saveBootstrapSnapshot(nextBootstrap);
    } catch (err) {
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
        if (pending > 0) {
          setSyncState('auth');
          setSyncMessage('Sync needs PIN refresh.');
        } else {
          localStorage.removeItem(identityKey);
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
    const count = await countBlockingPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null);
    setPendingCount(count);
    if (count > 0 && syncState === 'synced') setSyncState('pending');
  }

  async function syncPending(currentIdentity = identity) {
    if (!currentIdentity) return;
    const batches = (await getPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null)).filter(
      (batch) => batch.syncStatus !== 'synced',
    );
    setPendingCount(batches.length);
    if (!batches.length) {
      setSyncState(cachedMode ? 'offline' : 'synced');
      setSyncMessage('');
      return;
    }
    setSyncState('pending');
    for (const batch of batches) {
      try {
        await savePendingBatch({ ...batch, syncStatus: 'syncing', lastSyncError: null });
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
            manual: batch.manual,
            ...indicatorPayload({
              confidentialCareProvided: batch.confidentialCareProvided,
              referralProvided: batch.referralProvided,
            }),
          }),
        });
        await savePendingBatch({
          ...batch,
          syncStatus: 'synced',
          serverBatchId: result.batchId,
          checkinIds: result.checkins.map((checkin) => checkin.id),
          totalScore: result.totalScore,
          lastSyncError: null,
        });
        await removePendingBatch(batch.clientBatchId);
      } catch (err) {
        const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
        if (status === 403) {
          await savePendingBatch({ ...batch, syncStatus: 'auth', lastSyncError: 'PIN refresh required.' });
          setSyncState('auth');
          setSyncMessage('Sync needs PIN refresh.');
          await refreshPendingCount(currentIdentity);
          return;
        }
        if (isNetworkFailure(err)) {
          await savePendingBatch({ ...batch, syncStatus: 'pending', lastSyncError: 'Waiting for connectivity.' });
          setSyncState('offline');
          setSyncMessage('Offline - cached data.');
          await refreshPendingCount(currentIdentity);
          return;
        }
        await savePendingBatch({ ...batch, syncStatus: 'failed', lastSyncError: err instanceof Error ? err.message : 'Sync failed.' });
        setSyncState('failed');
        setSyncMessage('Sync failed - retry available.');
        await refreshPendingCount(currentIdentity);
        return;
      }
    }
    setSyncState('synced');
    setSyncMessage('Online and synced.');
    await refreshPendingCount(currentIdentity);
    await load(currentIdentity);
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
      localStorage.setItem(identityKey, JSON.stringify(next));
      setIdentity(next);
      setRefreshPin('');
      setSyncState('pending');
      await syncPending(next);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'PIN refresh failed.');
    }
  }

  function handleIdentity(nextIdentity: Identity) {
    setIdentity(nextIdentity);
    if (nextIdentity.organization) {
      localStorage.setItem(workspaceKey, JSON.stringify(nextIdentity.organization));
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
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync();
    });
    window.addEventListener('focus', sync);
    void syncPending(identity);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
    };
  }, [identity?.teamMemberId, identity?.sessionToken]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [screen]);

  if (showOperatorConsole) {
    return <OperatorConsole onClose={closeOperatorConsole} onSuperuserAdmin={openWorkspaceAdminFromOperator} />;
  }
  if (error) return <main className="center-shell"><p className="error">{error}</p></main>;
  if (!identity) {
    if (showAdminSetup) {
      return (
        <>
          <AdminScreen
            refresh={() => void loadTeamMembers(workspace)}
            mapDefaultLatitude={workspace?.mapDefaultLatitude ?? 24.57}
            mapDefaultLongitude={workspace?.mapDefaultLongitude ?? -81.78}
            workspace={workspace}
          />
          <nav className="bottom-nav">
            <button className="active">Admin</button>
            <button onClick={() => {
              sessionStorage.removeItem('deckplate.admin');
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
    if (!teamMembers.length) return <main className="center-shell"><p>Loading Deckplating...</p></main>;
    return (
      <IdentitySetup
        members={teamMembers}
        workspace={workspace}
        onWorkspaceChange={() => setShowWorkspaceEntry(true)}
        onRegistered={handleIdentity}
      />
    );
  }
  if (!bootstrap) return <main className="center-shell"><p>Loading Deckplating...</p></main>;

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
      <MissionBrief units={bootstrap.units} tone={bootstrap.gamificationTone ?? 'professional'} recentRecovery={false} />
      {syncState === 'auth' && (
        <form className="pin-refresh" onSubmit={refreshSession}>
          <label>
            Enter your current PIN to refresh sync
            <input
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
          members={bootstrap.teamMembers}
          pendingCount={pendingCount}
          onIdentity={handleIdentity}
          onSignOut={() => signOutIdentity(false)}
          onSwitchWorkspace={() => signOutIdentity(true)}
          onOpenSystemAdministration={openOperatorConsole}
          showSystemAdministration={Boolean(sessionStorage.getItem(operatorKey))}
        />
      )}
      <nav className="bottom-nav">
        {[
          ['checkin', 'Check In'],
          ['coverage', 'Coverage'],
          ['map', 'Map'],
          ['scoreboard', 'Scores'],
          ['admin', 'Admin'],
          ['settings', 'Account'],
        ].map(([id, label]) => (
          <button key={id} className={screen === id ? 'active' : ''} onClick={() => setScreen(id as Screen)}>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}
