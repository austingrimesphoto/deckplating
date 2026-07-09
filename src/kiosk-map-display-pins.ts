import * as maplibregl from 'maplibre-gl';

const POINT_SOURCE_ID = 'kiosk-location-points';
const STYLE_ID = 'deckplating-kiosk-map-display-pins';

const HIDDEN_KIOSK_LAYER_IDS = new Set([
  'kiosk-location-radii-fill',
  'kiosk-location-radii-line',
  'kiosk-location-point-halo',
  'kiosk-location-point',
  'kiosk-location-point-count',
  'kiosk-location-point-label',
]);

const VALID_STATUSES = new Set(['red', 'yellow', 'green', 'gray'] as const);

type KioskPinStatus = 'red' | 'yellow' | 'green' | 'gray';

type KioskPin = {
  id: string;
  name: string;
  area: string;
  status: KioskPinStatus;
  count: string;
  priority: boolean;
  longitude: number;
  latitude: number;
};

type ProjectedPoint = {
  x: number;
  y: number;
};

type KioskMapInstance = {
  getContainer(): HTMLElement;
  getSource(id: string): unknown;
  on(event: string, listener: () => void): unknown;
  project(coordinates: [number, number]): ProjectedPoint;
  remove(): void;
};

type PointFeature = {
  properties?: Record<string, unknown> | null;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  } | null;
};

type FeatureCollection = {
  type?: unknown;
  features?: unknown;
};

type PatchableMapPrototype = {
  addLayer(this: KioskMapInstance, layer: { id?: string }, beforeId?: string): KioskMapInstance;
  addSource(this: KioskMapInstance, id: string, source: unknown): KioskMapInstance;
  remove(this: KioskMapInstance): void;
};

type PatchableGeoJSONSource = {
  setData(data: unknown): unknown;
};

const pinsByMap = new WeakMap<KioskMapInstance, KioskPin[]>();
const framesByMap = new WeakMap<KioskMapInstance, number>();
const patchedSources = new WeakSet<object>();
const mapsWithListeners = new WeakSet<KioskMapInstance>();

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validLatitude = (value: unknown): value is number => finiteNumber(value) && value >= -90 && value <= 90;
const validLongitude = (value: unknown): value is number => finiteNumber(value) && value >= -180 && value <= 180;

function kioskModeEnabled() {
  return new URLSearchParams(window.location.search).get('kiosk') === '1';
}

function statusFrom(value: unknown): KioskPinStatus {
  return VALID_STATUSES.has(value as KioskPinStatus) ? (value as KioskPinStatus) : 'gray';
}

function textFrom(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function pinFeaturesFrom(data: unknown): KioskPin[] {
  if (!data || typeof data !== 'object') return [];
  const collection = data as FeatureCollection;
  if (!Array.isArray(collection.features)) return [];

  return collection.features.flatMap((feature, index): KioskPin[] => {
    if (!feature || typeof feature !== 'object') return [];
    const point = feature as PointFeature;
    if (point.geometry?.type !== 'Point' || !Array.isArray(point.geometry.coordinates)) return [];

    const [rawLongitude, rawLatitude] = point.geometry.coordinates;
    const longitude = Number(rawLongitude);
    const latitude = Number(rawLatitude);
    if (!validLongitude(longitude) || !validLatitude(latitude)) return [];

    const properties: Record<string, unknown> = point.properties ?? {};
    return [
      {
        id: textFrom(properties.id, `${longitude.toFixed(6)},${latitude.toFixed(6)},${index}`),
        name: textFrom(properties.name, 'Mapped location'),
        area: textFrom(properties.area, 'Mapped area'),
        status: statusFrom(properties.status),
        count: textFrom(properties.count, '1'),
        priority: properties.priority === true || properties.priority === 'true',
        longitude,
        latitude,
      },
    ];
  });
}

function rememberPointData(map: KioskMapInstance, data: unknown) {
  pinsByMap.set(map, pinFeaturesFrom(data));
}

function markerOverlayFor(container: HTMLElement) {
  let overlay = container.querySelector<HTMLElement>('[data-kiosk-map-overlay="true"]');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'kiosk-map-overlay';
    overlay.dataset.kioskMapOverlay = 'true';
    container.append(overlay);
  }
  return overlay;
}

function renderPins(map: KioskMapInstance) {
  const container = map.getContainer();
  if (!container.classList.contains('kiosk-map-stage')) return;

  const overlay = markerOverlayFor(container);
  const width = container.clientWidth;
  const height = container.clientHeight;
  const pins = pinsByMap.get(map) ?? [];

  if (!width || !height || !pins.length) {
    overlay.replaceChildren();
    overlay.dataset.markerCount = '0';
    return;
  }

  const markers: HTMLElement[] = [];
  for (const pin of pins) {
    const point = map.project([pin.longitude, pin.latitude]);
    if (!finiteNumber(point.x) || !finiteNumber(point.y)) continue;

    const margin = 10;
    if (point.x < margin || point.x > width - margin || point.y < margin || point.y > height - margin) continue;

    const marker = document.createElement('div');
    marker.className = `kiosk-map-marker ${pin.status}${pin.priority ? ' priority' : ''}`;
    marker.style.left = `${point.x}px`;
    marker.style.top = `${point.y}px`;
    marker.dataset.testid = 'kiosk-map-marker';
    marker.dataset.locationId = pin.id;
    marker.dataset.status = pin.status;

    const anchor = document.createElement('div');
    anchor.className = 'kiosk-map-marker-anchor';

    const icon = document.createElement('span');
    icon.className = 'kiosk-map-marker-pin';
    icon.setAttribute('aria-hidden', 'true');

    const count = document.createElement('span');
    count.className = 'kiosk-map-marker-count';
    count.textContent = pin.count;
    icon.append(count);

    const label = document.createElement('span');
    label.className = 'kiosk-map-marker-label';

    const name = document.createElement('strong');
    name.textContent = pin.name;
    label.append(name);

    const area = document.createElement('small');
    area.textContent = pin.area;
    label.append(area);

    anchor.append(icon, label);
    marker.append(anchor);
    markers.push(marker);
  }

  overlay.replaceChildren(...markers);
  overlay.dataset.markerCount = String(markers.length);
}

function scheduleRender(map: KioskMapInstance) {
  const existingFrame = framesByMap.get(map);
  if (existingFrame != null) window.cancelAnimationFrame(existingFrame);

  const frame = window.requestAnimationFrame(() => {
    framesByMap.delete(map);
    renderPins(map);
  });
  framesByMap.set(map, frame);
}

function installMapListeners(map: KioskMapInstance) {
  if (mapsWithListeners.has(map)) return;
  mapsWithListeners.add(map);

  map.on('load', () => scheduleRender(map));
  map.on('move', () => scheduleRender(map));
  map.on('moveend', () => scheduleRender(map));
  map.on('resize', () => scheduleRender(map));
  map.on('idle', () => scheduleRender(map));
}

function patchPointSource(map: KioskMapInstance) {
  const source = map.getSource(POINT_SOURCE_ID) as PatchableGeoJSONSource | undefined;
  if (!source || typeof source !== 'object' || patchedSources.has(source)) return;

  const originalSetData = source.setData.bind(source);
  source.setData = (data: unknown) => {
    rememberPointData(map, data);
    const result = originalSetData(data);
    scheduleRender(map);
    return result;
  };

  patchedSources.add(source);
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.kiosk-map-stage {
  isolation: isolate;
}

.kiosk-map-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow: hidden;
  pointer-events: none;
}

.kiosk-map-marker {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}

.kiosk-map-marker-anchor {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  transform: translate(-50%, -100%);
  filter: drop-shadow(0 8px 16px rgba(23, 50, 77, 0.22));
}

.kiosk-map-marker-pin {
  position: relative;
  display: grid;
  width: clamp(34px, 2.3vw, 46px);
  height: clamp(34px, 2.3vw, 46px);
  flex: 0 0 auto;
  place-items: center;
  border: 3px solid #fff;
  border-radius: 999px;
  background: var(--gray, #68717a);
  color: #fff;
  box-shadow: 0 3px 0 rgba(23, 50, 77, 0.18);
}

.kiosk-map-marker-pin::after {
  position: absolute;
  left: 50%;
  bottom: -8px;
  width: 14px;
  height: 14px;
  border-right: 3px solid #fff;
  border-bottom: 3px solid #fff;
  background: inherit;
  content: '';
  transform: translateX(-50%) rotate(45deg);
  transform-origin: center;
}

.kiosk-map-marker-count {
  position: relative;
  z-index: 1;
  font-size: clamp(0.95rem, 1vw, 1.2rem);
  font-weight: 950;
  line-height: 1;
}

.kiosk-map-marker-label {
  display: grid;
  max-width: min(240px, 24vw);
  min-width: 0;
  gap: 1px;
  padding: 7px 9px;
  border: 1px solid rgba(23, 50, 77, 0.14);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.95);
  color: #17324d;
  line-height: 1.05;
  box-shadow: 0 8px 22px rgba(23, 50, 77, 0.14);
}

.kiosk-map-marker-label strong,
.kiosk-map-marker-label small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kiosk-map-marker-label strong {
  font-size: clamp(0.78rem, 0.9vw, 1.02rem);
  font-weight: 950;
}

.kiosk-map-marker-label small {
  color: var(--muted, #5e6b76);
  font-size: clamp(0.62rem, 0.72vw, 0.82rem);
  font-weight: 850;
}

.kiosk-map-marker.red .kiosk-map-marker-pin {
  background: var(--red, #bd3030);
}

.kiosk-map-marker.yellow .kiosk-map-marker-pin {
  background: var(--yellow, #b47b13);
}

.kiosk-map-marker.green .kiosk-map-marker-pin {
  background: var(--green, #287a3e);
}

.kiosk-map-marker.gray .kiosk-map-marker-pin {
  background: var(--gray, #68717a);
}

.kiosk-map-marker.priority .kiosk-map-marker-pin {
  outline: 3px solid rgba(255, 255, 255, 0.58);
  outline-offset: 3px;
}

@media (max-width: 760px) {
  .kiosk-map-marker-label {
    display: none;
  }
}
`;

  document.head.append(style);
}

function patchMapLibreForKioskPins() {
  if (!kioskModeEnabled()) return;

  const globalWindow = window as typeof window & { __deckplatingKioskMapPinsPatched?: boolean };
  if (globalWindow.__deckplatingKioskMapPinsPatched) return;
  globalWindow.__deckplatingKioskMapPinsPatched = true;

  installStyles();

  const prototype = maplibregl.Map.prototype as unknown as PatchableMapPrototype;
  const originalAddLayer = prototype.addLayer;
  const originalAddSource = prototype.addSource;
  const originalRemove = prototype.remove;

  prototype.addLayer = function addLayer(this: KioskMapInstance, layer: { id?: string }, beforeId?: string) {
    if (layer.id && HIDDEN_KIOSK_LAYER_IDS.has(layer.id)) return this;
    return originalAddLayer.call(this, layer, beforeId);
  };

  prototype.addSource = function addSource(this: KioskMapInstance, id: string, source: unknown) {
    if (id === POINT_SOURCE_ID && source && typeof source === 'object' && 'data' in source) {
      rememberPointData(this, (source as { data?: unknown }).data);
    }

    const result = originalAddSource.call(this, id, source);

    if (id === POINT_SOURCE_ID) {
      installMapListeners(this);
      patchPointSource(this);
      scheduleRender(this);
    }

    return result;
  };

  prototype.remove = function remove(this: KioskMapInstance) {
    const frame = framesByMap.get(this);
    if (frame != null) window.cancelAnimationFrame(frame);
    framesByMap.delete(this);
    pinsByMap.delete(this);
    this.getContainer().querySelector('[data-kiosk-map-overlay="true"]')?.remove();
    return originalRemove.call(this);
  };
}

patchMapLibreForKioskPins();
