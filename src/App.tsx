import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { registerSW } from 'virtual:pwa-register';
import type {
  AdminCheckin,
  Area,
  Bootstrap,
  Identity,
  IndicatorReportRow,
  LeaderboardRow,
  LocationSummary,
  PendingVisitBatch,
  TeamMember,
  UnitSummary,
  UnitType,
  CoverageDetail,
  VisitIndicatorState,
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
  'Use Deckplate Coverage only for unclassified, non-sensitive coverage tracking. Do not enter CUI, classified information, sensitive personal information, home addresses, counseling or medical details, or sensitive operational locations.';

const safeUseItems = [
  'Deckplate Coverage is not approved for CUI, classified information, or sensitive operational data.',
  'Store only the minimum information needed to track ministry presence.',
  'Do not enter counseling notes, medical information, incident details, family information, addresses, phone numbers, email addresses, dates of birth, or other sensitive PII.',
  'Team display names should be limited to practical operational identity, such as rank and last name.',
  'Map only publicly identifiable facilities, buildings, or general areas.',
  'Do not map SCIFs, restricted spaces, operational locations in theater, residences, or other sensitive locations.',
  'When uncertain, do not map the location. Use manual check-in.',
  'Deckplate Coverage is a coverage-awareness tool, not a counseling record, case-management system, or official system of record.',
];

const locationMappingNotice =
  'Map only publicly identifiable buildings or general areas. Do not pin SCIFs, sensitive operational spaces, deployed-unit locations, homes, or any location that should not be broadly shared. When uncertain, leave the location unmapped and use manual check-in.';

const identityKey = 'deckplate.identity';

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
  onRegistered,
}: {
  members: TeamMember[];
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
      const result = await api<{ deviceId: string; sessionToken: string }>('/api/device/register', {
        method: 'POST',
        body: JSON.stringify({
          teamMemberId,
          pin,
          deviceToken,
          deviceLabel: navigator.userAgent.slice(0, 120),
        }),
      });
      const identity = { teamMemberId, teamMemberName: member.name, deviceToken, deviceId: result.deviceId, sessionToken: result.sessionToken };
      localStorage.setItem(identityKey, JSON.stringify(identity));
      onRegistered(identity);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    }
  }

  return (
    <main className="center-shell">
      <section className="panel">
        <p className="eyebrow">Deckplate Coverage</p>
        <h1>Select your name</h1>
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
        </form>
      </section>
    </main>
  );
}

function CheckInScreen({
  identity,
  bootstrap,
  cachedMode,
  refresh,
  onPendingChanged,
}: {
  identity: Identity;
  bootstrap: Bootstrap;
  cachedMode: boolean;
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

  async function undoCheckin() {
    if (!confirmation) return;
    if (confirmation.syncStatus === 'queued') {
      await removePendingBatch(confirmation.clientBatchId);
      setConfirmation(null);
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
      await updatePendingBatchIndicators(confirmation.clientBatchId, next);
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
                placeholder="Search locations or units"
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
              />
              <select value={manualLocationId} onChange={(event) => {
                setManualLocationId(event.target.value);
                setSelected([]);
              }}>
                <option value="">Choose mapped location</option>
                {locationSummaries
                  .filter((location) => `${location.name} ${location.area_name}`.toLowerCase().includes(manualQuery.toLowerCase()))
                  .map((location) => (
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
                unmappedUnits
                  .filter((unit) => unit.name.toLowerCase().includes(manualQuery.toLowerCase()))
                  .map((unit) => (
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
            <button className="primary" onClick={() => setConfirmation(null)} disabled={loading}>
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

function CoverageBoard({
  identity,
  areas,
  units,
  cachedAt,
  cachedMode,
}: {
  identity: Identity;
  areas: Area[];
  units: UnitSummary[];
  cachedAt: string | null;
  cachedMode: boolean;
}) {
  const [area, setArea] = useState('');
  const [unitType, setUnitType] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [neverOnly, setNeverOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<UnitSummary | null>(null);
  const [detail, setDetail] = useState<CoverageDetail | null>(null);
  const [detailMessage, setDetailMessage] = useState('');
  const [reportRows, setReportRows] = useState<IndicatorReportRow[]>([]);
  const [reportMessage, setReportMessage] = useState('');
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
      .sort((a, b) => {
        const rank = { gray: 4, red: 3, yellow: 2, green: 1 };
        return rank[b.status] - rank[a.status] || a.name.localeCompare(b.name);
      });
  }, [area, from, neverOnly, overdueOnly, to, unitType, units]);

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
      <section className="coverage-list">
        <section className="panel report-panel">
          <p className="eyebrow">Reports</p>
          <h2>Referrals and confidential care</h2>
          <p className="muted">Generic location-level counts only. Multi-unit visits are not attributed to each selected command.</p>
          <div className="filters">
            <input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} />
            <input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} />
            <button className="secondary" onClick={loadReport}>Load referral/care report</button>
          </div>
          {reportMessage && <p className="notice">{reportMessage}</p>}
          {reportRows.length > 0 && (
            <div className="report-list">
              {reportRows.map((row) => (
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
  const map = useRef<maplibregl.Map | null>(null);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);
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

  useEffect(() => {
    if (offlineMode || !container.current || map.current) return;
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
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [mapDefaultLatitude, mapDefaultLongitude, mapTileUrl, offlineMode]);

  useEffect(() => {
    if (!map.current) return;
    const markers: maplibregl.Marker[] = [];
    const drawRadii = () => {
      const sourceData = {
        type: 'FeatureCollection' as const,
        features: locations.map((location) => ({
          type: 'Feature' as const,
          properties: { status: location.status },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [circlePolygon(location.longitude, location.latitude, location.radius_meters)],
          },
        })),
      };
      const existing = map.current!.getSource('location-radii') as maplibregl.GeoJSONSource | undefined;
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
    locations.forEach((location) => {
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
    return () => markers.forEach((marker) => marker.remove());
  }, [locations]);

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
      <div className="map-list">
        {locations.map((location) => (
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
      </div>
    </main>
  );
}

function Scoreboard({ identity }: { identity: Identity }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    api<{ rows: LeaderboardRow[] }>(`/api/leaderboard?month=${month}`, { headers: authHeaders(identity) }).then((result) =>
      setRows(result.rows),
    );
  }, [identity, month]);

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Team Scoreboard</p>
          <h1>Monthly leaderboard</h1>
        </div>
      </div>
      <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
      <section className="coverage-list">
        {rows.map((row, index) => (
          <article key={row.team_member_id} className="score-row">
            <span className="rank">{index + 1}</span>
            <div>
              <strong>{row.name}</strong>
              <small>
                {row.qualifying_checkins} qualifying - {row.distinct_units} units - {row.recovered_units} recovered
              </small>
            </div>
            <strong>{row.score}</strong>
          </article>
        ))}
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
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = new maplibregl.Map({
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
    marker.current = new maplibregl.Marker({ draggable: true, color: statusColor.red })
      .setLngLat([longitude, latitude])
      .addTo(map.current);
    marker.current.on('dragend', () => {
      const point = marker.current!.getLngLat();
      onChange({ latitude: point.lat, longitude: point.lng });
    });
    map.current.on('click', (event) => {
      marker.current!.setLngLat(event.lngLat);
      onChange({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    });
    return () => {
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
  const [voidReason, setVoidReason] = useState('accidental');
  const voided = Boolean(checkin.voided_at);

  async function saveCorrections() {
    await onPatch(checkin.id, {
      adminTeamMemberId: actingTeamMemberId,
      unit_id: unitId,
      team_member_id: teamMemberId,
      checked_in_at: localDateTimeToIso(checkedInAt),
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
}: {
  refresh: () => void;
  mapDefaultLatitude: number;
  mapDefaultLongitude: number;
}) {
  const [token, setToken] = useState(sessionStorage.getItem('deckplate.admin') ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState('');
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
  const [adminSection, setAdminSection] = useState<'setup' | 'activity'>('setup');
  const [activity, setActivity] = useState<AdminCheckin[]>([]);
  const [activityFilters, setActivityFilters] = useState({
    from: '',
    to: '',
    teamMemberId: '',
    areaId: '',
    unitId: '',
    includeVoided: false,
  });
  const [actingTeamMemberId, setActingTeamMemberId] = useState('');

  async function login(event: FormEvent) {
    event.preventDefault();
    const result = await api<{ token: string }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ passphrase }) });
    sessionStorage.setItem('deckplate.admin', result.token);
    setToken(result.token);
  }

  async function load() {
    const result = await api<AdminData>('/api/admin/locations', { headers: { authorization: `Bearer ${token}` } });
    setData(result);
    setLocationForm((current) => ({ ...current, area_id: result.areas[0]?.id ?? current.area_id }));
    setActingTeamMemberId((current) => current || result.teamMembers[0]?.id || '');
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

  async function loadActivity() {
    const params = new URLSearchParams();
    if (activityFilters.from) params.set('from', activityFilters.from);
    if (activityFilters.to) params.set('to', activityFilters.to);
    if (activityFilters.teamMemberId) params.set('teamMemberId', activityFilters.teamMemberId);
    if (activityFilters.areaId) params.set('areaId', activityFilters.areaId);
    if (activityFilters.unitId) params.set('unitId', activityFilters.unitId);
    if (activityFilters.includeVoided) params.set('includeVoided', 'true');
    const result = await api<{ checkins: AdminCheckin[] }>(`/api/admin/checkins?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    setActivity(result.checkins);
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
    await loadActivity();
  }

  useEffect(() => {
    if (token && adminSection === 'activity') void loadActivity();
  }, [token, adminSection]);

  if (!token) {
    return (
      <main className="center-shell">
        <section className="panel">
          <h1>Admin</h1>
          <form onSubmit={login} className="stack">
            <label>
              Shared passphrase
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
            </label>
            <button className="primary">Unlock</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{adminSection === 'setup' ? 'Manage mapping' : 'Activity Log'}</h1>
        </div>
      </div>
      {message && <p className="notice">{message}</p>}
      <div className="tab-row">
        <button className={adminSection === 'setup' ? 'active' : ''} onClick={() => setAdminSection('setup')}>
          Locations
        </button>
        <button className={adminSection === 'activity' ? 'active' : ''} onClick={() => setAdminSection('activity')}>
          Activity Log
        </button>
      </div>
      {adminSection === 'activity' && data && (
        <>
          <section className="panel">
            <h2>Filter activity</h2>
            <div className="filters">
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
            <button className="primary" onClick={loadActivity}>
              Apply filters
            </button>
          </section>
          <section className="coverage-list">
            {activity.map((checkin) => (
              <AdminCheckinRow
                key={checkin.id}
                checkin={checkin}
                units={data.units}
                teamMembers={data.teamMembers}
                actingTeamMemberId={actingTeamMemberId}
                onPatch={patchCheckin}
              />
            ))}
            {!activity.length && <p className="notice">No check-ins match the current filters.</p>}
          </section>
        </>
      )}
      {adminSection === 'setup' && (
        <>
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
          <button className="primary">Save location</button>
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
        <form onSubmit={createMember} className="stack">
          <input placeholder="Name" value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} />
          <input placeholder="Role" value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })} />
          <button className="primary">Save member</button>
        </form>
      </section>

      <section className="coverage-list">
        {data?.locations.map((location) => (
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
        {data?.units.map((unit) => (
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
              {data.locations.map((location) => (
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
        {data?.teamMembers.map((member) => (
          <article key={member.id} className="admin-row">
            <input defaultValue={member.name} onBlur={(event) => patch(`/api/admin/team-members/${member.id}`, { name: event.target.value })} />
            <input defaultValue={member.role ?? ''} onBlur={(event) => patch(`/api/admin/team-members/${member.id}`, { role: event.target.value })} />
            <button className="secondary" onClick={() => patch(`/api/admin/team-members/${member.id}`, { active: !member.active })}>
              {member.active ? 'Deactivate' : 'Activate'}
            </button>
          </article>
        ))}
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
}: {
  identity: Identity;
  members: TeamMember[];
  pendingCount: number;
  onIdentity: (identity: Identity) => void;
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
      const result = await api<{ deviceId: string; sessionToken: string }>('/api/device/change-identity', {
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
          <p className="eyebrow">Settings</p>
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
        <h2>Safe Use</h2>
        <ul className="plain-list safe-list">
          {safeUseItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [cachedMode, setCachedMode] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [identity, setIdentity] = useState<Identity | null>(() => {
    const stored = localStorage.getItem(identityKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Identity;
    return parsed.sessionToken ? parsed : null;
  });
  const [screen, setScreen] = useState<Screen>('checkin');
  const [error, setError] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>('synced');
  const [syncMessage, setSyncMessage] = useState('');
  const [refreshPin, setRefreshPin] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null);

  async function loadTeamMembers() {
    try {
      const result = await api<{ teamMembers: TeamMember[] }>('/api/team-members');
      setTeamMembers(result.teamMembers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load team members.');
    }
  }

  async function load(currentIdentity = identity) {
    if (!currentIdentity) return;
    const cached = await getBootstrapSnapshot();
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
        const pending = await countBlockingPendingBatches(currentIdentity.teamMemberId);
        if (pending > 0) {
          setSyncState('auth');
          setSyncMessage('Sync needs PIN refresh.');
        } else {
          localStorage.removeItem(identityKey);
          setIdentity(null);
          setBootstrap(null);
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
        setError('Deckplate Coverage needs one online launch before offline use.');
      }
    }
  }

  async function refreshPendingCount(currentIdentity = identity) {
    if (!currentIdentity) return;
    const count = await countBlockingPendingBatches(currentIdentity.teamMemberId);
    setPendingCount(count);
    if (count > 0 && syncState === 'synced') setSyncState('pending');
  }

  async function syncPending(currentIdentity = identity) {
    if (!currentIdentity) return;
    const batches = (await getPendingBatches(currentIdentity.teamMemberId)).filter((batch) => batch.syncStatus !== 'synced');
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
      const result = await api<{ deviceId: string; sessionToken: string }>('/api/device/register', {
        method: 'POST',
        body: JSON.stringify({
          teamMemberId: identity.teamMemberId,
          pin: refreshPin,
          deviceToken: identity.deviceToken,
          deviceLabel: navigator.userAgent.slice(0, 120),
        }),
      });
      const next = { ...identity, deviceId: result.deviceId, sessionToken: result.sessionToken };
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
    void load(nextIdentity);
  }

  useEffect(() => {
    if (identity) {
      void load(identity);
      void refreshPendingCount(identity);
    } else {
      void loadTeamMembers();
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

  if (error) return <main className="center-shell"><p className="error">{error}</p></main>;
  if (!identity) {
    if (!teamMembers.length) return <main className="center-shell"><p>Loading Deckplate Coverage...</p></main>;
    return <IdentitySetup members={teamMembers} onRegistered={handleIdentity} />;
  }
  if (!bootstrap) return <main className="center-shell"><p>Loading Deckplate Coverage...</p></main>;

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
        />
      )}
      {screen === 'scoreboard' && (cachedMode ? <main className="screen"><p className="notice">Scoreboard needs a live connection.</p></main> : <Scoreboard identity={identity} />)}
      {screen === 'settings' && <Settings identity={identity} members={bootstrap.teamMembers} pendingCount={pendingCount} onIdentity={handleIdentity} />}
      <nav className="bottom-nav">
        {[
          ['checkin', 'Check In'],
          ['coverage', 'Coverage'],
          ['map', 'Map'],
          ['scoreboard', 'Scores'],
          ['admin', 'Admin'],
          ['settings', 'Settings'],
        ].map(([id, label]) => (
          <button key={id} className={screen === id ? 'active' : ''} onClick={() => setScreen(id as Screen)}>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}
