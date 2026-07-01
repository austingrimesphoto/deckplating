import { openDB, type DBSchema } from 'idb';
import type { Bootstrap, LocationSummary, PendingVisitBatch, UnitSummary, VisitIndicatorState } from './types';

export type CachedBootstrap = Bootstrap & {
  cachedAt: string;
};

interface DeckplateOfflineDb extends DBSchema {
  bootstrap: {
    key: string;
    value: CachedBootstrap;
  };
  pendingBatches: {
    key: string;
    value: PendingVisitBatch;
    indexes: {
      'by-team': string;
      'by-status': string;
    };
  };
}

const dbPromise = openDB<DeckplateOfflineDb>('deckplate-coverage-offline', 1, {
  upgrade(db) {
    db.createObjectStore('bootstrap');
    const pending = db.createObjectStore('pendingBatches', { keyPath: 'clientBatchId' });
    pending.createIndex('by-team', 'teamMemberId');
    pending.createIndex('by-status', 'syncStatus');
  },
});

export async function saveBootstrapSnapshot(bootstrap: Bootstrap) {
  const db = await dbPromise;
  await db.put('bootstrap', { ...bootstrap, cachedAt: new Date().toISOString() }, 'latest');
}

export async function getBootstrapSnapshot() {
  const db = await dbPromise;
  return (await db.get('bootstrap', 'latest')) ?? null;
}

export async function savePendingBatch(batch: PendingVisitBatch) {
  const db = await dbPromise;
  await db.put('pendingBatches', { ...batch, updatedAt: new Date().toISOString() });
}

export async function getPendingBatches(teamMemberId?: string) {
  const db = await dbPromise;
  const all = await db.getAll('pendingBatches');
  return teamMemberId ? all.filter((batch) => batch.teamMemberId === teamMemberId) : all;
}

export async function getPendingBatch(clientBatchId: string) {
  const db = await dbPromise;
  return (await db.get('pendingBatches', clientBatchId)) ?? null;
}

export async function updatePendingBatchIndicators(clientBatchId: string, indicators: VisitIndicatorState) {
  const batch = await getPendingBatch(clientBatchId);
  if (!batch) return null;
  const next = { ...batch, ...indicators, updatedAt: new Date().toISOString() };
  await savePendingBatch(next);
  return next;
}

export async function removePendingBatch(clientBatchId: string) {
  const db = await dbPromise;
  await db.delete('pendingBatches', clientBatchId);
}

export async function countBlockingPendingBatches(teamMemberId: string) {
  const pending = await getPendingBatches(teamMemberId);
  return pending.filter((batch) => batch.syncStatus !== 'synced').length;
}

export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
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
}

export function getCachedLocationSummaries(units: UnitSummary[]) {
  const grouped = new Map<string, LocationSummary>();
  const rank = { gray: 4, red: 3, yellow: 2, green: 1 };
  for (const unit of units) {
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
}

export function findCachedNearbyLocations(units: UnitSummary[], lat: number, lon: number) {
  return getCachedLocationSummaries(units)
    .map((location) => ({ ...location, distance_meters: distanceMeters(lat, lon, location.latitude, location.longitude) }))
    .filter((location) => location.distance_meters <= location.radius_meters)
    .sort((a, b) => (a.distance_meters ?? 0) - (b.distance_meters ?? 0));
}
