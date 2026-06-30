import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Area, Bootstrap, Identity, LeaderboardRow, LocationSummary, TeamMember, UnitSummary, UnitType } from './types';

type Screen = 'checkin' | 'coverage' | 'map' | 'admin' | 'scoreboard' | 'settings';

type AdminData = {
  areas: Area[];
  locations: Array<{ id: string; name: string; area_id: string; latitude: number; longitude: number; radius_meters: number; active: boolean }>;
  units: Array<{ id: string; name: string; unit_type: UnitType; visit_interval_days: number; location_id: string | null; active: boolean }>;
  teamMembers: Array<{ id: string; name: string; role: string | null; active: boolean }>;
};

const identityKey = 'deckplate.identity';

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`API route ${path} did not return JSON. Run the app with netlify dev so /api routes are available.`);
  }
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}

const newToken = () => crypto.randomUUID();

const statusLabel = (unit: UnitSummary) => {
  if (unit.status === 'gray') return 'Never visited';
  if (unit.status === 'red') return 'Overdue';
  if (unit.status === 'yellow') return 'Due soon';
  return 'Current';
};

const niceDate = (date: string | null) => (date ? new Date(date).toLocaleDateString() : 'Never');

const statusColor = {
  green: '#287a3e',
  yellow: '#b47b13',
  red: '#bd3030',
  gray: '#68717a',
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
      const result = await api<{ deviceId: string }>('/api/device/register', {
        method: 'POST',
        body: JSON.stringify({
          teamMemberId,
          pin,
          deviceToken,
          deviceLabel: navigator.userAgent.slice(0, 120),
        }),
      });
      const identity = { teamMemberId, teamMemberName: member.name, deviceToken, deviceId: result.deviceId };
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

function CheckInScreen({ identity, refresh }: { identity: Identity; refresh: () => void }) {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [matches, setMatches] = useState<LocationSummary[]>([]);
  const [manualUnits, setManualUnits] = useState<UnitSummary[]>([]);
  const [manualQuery, setManualQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function locate() {
    setMessage('');
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const next = { lat: position.coords.latitude, lon: position.coords.longitude };
        setCoords(next);
        try {
          const result = await api<{ matches: LocationSummary[] }>(`/api/nearby-locations?lat=${next.lat}&lon=${next.lon}`);
          setMatches(result.matches);
          setSelected(result.matches[0]?.units.map((unit) => unit.id) ?? []);
        } catch (err) {
          setMessage(err instanceof Error ? err.message : 'Location lookup failed.');
        } finally {
          setLoading(false);
        }
      },
      () => {
        setLoading(false);
        setMessage('Location permission was not granted.');
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  async function loadManualUnits() {
    const result = await api<{ units: UnitSummary[] }>('/api/dashboard');
    setManualUnits(result.units);
  }

  async function submit(manual = false) {
    if (!selected.length) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await api<{ totalScore: number }>('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({
          teamMemberId: identity.teamMemberId,
          deviceToken: identity.deviceToken,
          unitIds: selected,
          latitude: coords?.lat,
          longitude: coords?.lon,
          manual,
        }),
      });
      setMessage(`Check-in saved. ${result.totalScore} point${result.totalScore === 1 ? '' : 's'} awarded.`);
      refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Check-in failed.');
    } finally {
      setLoading(false);
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
        <button className="secondary" onClick={locate} disabled={loading}>
          Locate Me
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
          <button className="secondary" onClick={loadManualUnits}>
            Manual unit lookup
          </button>
          {manualUnits.length > 0 && (
            <div className="unit-picker">
              <input
                placeholder="Search units"
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
              />
              {manualUnits.filter((unit) => unit.name.toLowerCase().includes(manualQuery.toLowerCase())).map((unit) => (
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
                    <small>{unit.area_name ?? 'Unassigned'} - manual</small>
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
      {message && <p className="notice">{message}</p>}
    </main>
  );
}

function CoverageBoard({ areas, units }: { areas: Area[]; units: UnitSummary[] }) {
  const [area, setArea] = useState('');
  const [unitType, setUnitType] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [neverOnly, setNeverOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

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

  return (
    <main className="screen">
      <p className="eyebrow">Coverage Board</p>
      <h1>Needs attention first</h1>
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
        {areas.map((candidate) => {
          const areaUnits = filtered.filter((unit) => unit.area_id === candidate.id);
          if (!areaUnits.length) return null;
          return (
            <div key={candidate.id} className="area-group">
              <h2>{candidate.name}</h2>
              {areaUnits.map((unit) => (
                <article key={unit.id} className={`unit-card ${unit.status}`}>
                  <div>
                    <strong>{unit.name}</strong>
                    <span>{unit.unit_type === 'department' ? 'Department' : 'Tenant command'}</span>
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
                </article>
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
                <article key={unit.id} className={`unit-card ${unit.status}`}>
                  <strong>{unit.name}</strong>
                  <span>No mapped location</span>
                </article>
              ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MapScreen({ units, mapTileUrl }: { units: UnitSummary[]; mapTileUrl: string }) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
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
    if (!container.current || map.current) return;
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
      center: [-81.78, 24.57],
      zoom: 11,
    });
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [mapTileUrl]);

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
      <p className="eyebrow">Map</p>
      <h1>Mapped locations</h1>
      <div ref={container} className="map-canvas" />
      <div className="map-list">
        {locations.map((location) => (
          <article key={location.id} className={`unit-card ${location.status}`}>
            <strong>{location.name}</strong>
            <span>
              {location.area_name} - {location.radius_meters}m - {location.units.length} unit
              {location.units.length === 1 ? '' : 's'}
            </span>
          </article>
        ))}
      </div>
    </main>
  );
}

function Scoreboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    api<{ rows: LeaderboardRow[] }>(`/api/leaderboard?month=${month}`).then((result) => setRows(result.rows));
  }, [month]);

  return (
    <main className="screen">
      <p className="eyebrow">Team Scoreboard</p>
      <h1>Monthly leaderboard</h1>
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

function AdminScreen({ refresh }: { refresh: () => void }) {
  const [token, setToken] = useState(sessionStorage.getItem('deckplate.admin') ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [message, setMessage] = useState('');
  const [locationForm, setLocationForm] = useState({ name: '', area_id: '', latitude: '24.57', longitude: '-81.78', radius_meters: '120' });
  const [unitForm, setUnitForm] = useState({ name: '', unit_type: 'department' as UnitType, visit_interval_days: '30', location_id: '' });
  const [memberForm, setMemberForm] = useState({ name: '', role: '' });
  const [attachUnitIds, setAttachUnitIds] = useState<string[]>([]);

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
      <p className="eyebrow">Admin Locations</p>
      <h1>Manage mapping</h1>
      {message && <p className="notice">{message}</p>}
      <section className="panel">
        <h2>Create location</h2>
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
    </main>
  );
}

function Settings({ identity, members, onIdentity }: { identity: Identity; members: TeamMember[]; onIdentity: (identity: Identity) => void }) {
  const [pin, setPin] = useState('');
  const [newMember, setNewMember] = useState(members[0]?.id ?? '');
  const [newPin, setNewPin] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const member = members.find((candidate) => candidate.id === newMember);
    if (!member) return;
    try {
      const result = await api<{ deviceId: string }>('/api/device/change-identity', {
        method: 'POST',
        body: JSON.stringify({
          currentTeamMemberId: identity.teamMemberId,
          pin,
          newTeamMemberId: newMember,
          newPin,
          deviceToken: identity.deviceToken,
        }),
      });
      const next = { ...identity, teamMemberId: newMember, teamMemberName: member.name, deviceId: result.deviceId };
      localStorage.setItem(identityKey, JSON.stringify(next));
      onIdentity(next);
      setMessage('Identity changed.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Identity change failed.');
    }
  }

  return (
    <main className="screen">
      <p className="eyebrow">Settings</p>
      <h1>{identity.teamMemberName}</h1>
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
    </main>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(() => {
    const stored = localStorage.getItem(identityKey);
    return stored ? (JSON.parse(stored) as Identity) : null;
  });
  const [screen, setScreen] = useState<Screen>('checkin');
  const [error, setError] = useState('');

  async function load() {
    try {
      setBootstrap(await api<Bootstrap>('/api/bootstrap'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load app data.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <main className="center-shell"><p className="error">{error}</p></main>;
  if (!bootstrap) return <main className="center-shell"><p>Loading Deckplate Coverage...</p></main>;
  if (!identity) return <IdentitySetup members={bootstrap.teamMembers} onRegistered={setIdentity} />;

  return (
    <>
      {screen === 'checkin' && <CheckInScreen identity={identity} refresh={load} />}
      {screen === 'coverage' && <CoverageBoard areas={bootstrap.areas} units={bootstrap.units} />}
      {screen === 'map' && <MapScreen units={bootstrap.units} mapTileUrl={bootstrap.mapTileUrl} />}
      {screen === 'admin' && <AdminScreen refresh={load} />}
      {screen === 'scoreboard' && <Scoreboard />}
      {screen === 'settings' && <Settings identity={identity} members={bootstrap.teamMembers} onIdentity={setIdentity} />}
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
