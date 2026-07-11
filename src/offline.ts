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

const legacyDefaultOrganizationId = '00000000-0000-4000-8000-000000000001';

const dbPromise = openDB<DeckplateOfflineDb>('deckplate-coverage-offline', 3, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (oldVersion < 1) {
      db.createObjectStore('bootstrap');
      const pending = db.createObjectStore('pendingBatches', { keyPath: 'clientBatchId' });
      pending.createIndex('by-team', 'teamMemberId');
      pending.createIndex('by-status', 'syncStatus');
    }
    if (oldVersion < 2) {
      transaction.objectStore('bootstrap').delete('latest');
    }
    if (oldVersion < 3) {
      const store = transaction.objectStore('pendingBatches');
      const migrate = async () => {
        let cursor = await store.openCursor();
        while (cursor) {
          const batch = cursor.value;
          if (batch.syncStatus === 'synced') {
            await cursor.delete();
          } else if (batch.organizationId == null) {
            await cursor.update({ ...batch, organizationId: legacyDefaultOrganizationId });
          }
          cursor = await cursor.continue();
        }
      };
      void migrate().catch(() => transaction.abort());
    }
  },
});

const bootstrapKey = (organizationId?: string | null) => `workspace:${organizationId ?? 'default'}`;

export async function saveBootstrapSnapshot(bootstrap: Bootstrap) {
  const db = await dbPromise;
  const snapshot = { ...bootstrap, cachedAt: new Date().toISOString() };
  await db.put('bootstrap', snapshot, bootstrapKey(bootstrap.organizationId));
}

export async function getBootstrapSnapshot(organizationId?: string | null) {
  const db = await dbPromise;
  return (await db.get('bootstrap', bootstrapKey(organizationId))) ?? null;
}

export async function savePendingBatch(batch: PendingVisitBatch) {
  const db = await dbPromise;
  await db.put('pendingBatches', { ...batch, updatedAt: new Date().toISOString() });
}

export async function getPendingBatches(teamMemberId?: string, organizationId?: string | null) {
  const db = await dbPromise;
  const all = teamMemberId
    ? await db.getAllFromIndex('pendingBatches', 'by-team', teamMemberId)
    : await db.getAll('pendingBatches');
  const active = all.filter((batch) => batch.syncStatus !== 'synced');
  await Promise.allSettled(
    all.filter((batch) => batch.syncStatus === 'synced').map((batch) => db.delete('pendingBatches', batch.clientBatchId)),
  );
  return active.filter((batch) => {
    if (organizationId !== undefined && (batch.organizationId ?? null) !== (organizationId ?? null)) return false;
    return true;
  });
}

export async function getPendingBatch(clientBatchId: string) {
  const db = await dbPromise;
  return (await db.get('pendingBatches', clientBatchId)) ?? null;
}

export async function updatePendingBatchIndicators(clientBatchId: string, indicators: VisitIndicatorState, organizationId?: string | null) {
  const batch = await getPendingBatch(clientBatchId);
  if (!batch) return null;
  if ((batch.organizationId ?? null) !== (organizationId ?? null)) return null;
  const next = { ...batch, ...indicators, updatedAt: new Date().toISOString() };
  await savePendingBatch(next);
  return next;
}

export async function removePendingBatch(clientBatchId: string) {
  const db = await dbPromise;
  await db.delete('pendingBatches', clientBatchId);
}

export async function countBlockingPendingBatches(teamMemberId: string, organizationId?: string | null) {
  const pending = await getPendingBatches(teamMemberId, organizationId);
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
  const normalized = Math.min(1, Math.max(0, x));
  return earthRadius * 2 * Math.atan2(Math.sqrt(normalized), Math.sqrt(1 - normalized));
}

export function getCachedLocationSummaries(units: UnitSummary[]) {
  const grouped = new Map<string, LocationSummary>();
  const rank = { gray: 4, red: 3, yellow: 2, green: 1 };
  for (const unit of units) {
    const { latitude, longitude, radius_meters: radiusMeters } = unit;
    if (
      !unit.location_id ||
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      typeof radiusMeters !== 'number' ||
      !Number.isFinite(radiusMeters) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      radiusMeters < 25 ||
      radiusMeters > 750
    ) {
      continue;
    }
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
        latitude,
        longitude,
        radius_meters: radiusMeters,
        status: unit.status,
        units: [unit],
      });
    }
  }
  return Array.from(grouped.values());
}

export function findCachedNearbyLocations(units: UnitSummary[], lat: number, lon: number, accuracyMeters = 0) {
  const toleranceMeters = Math.min(Math.max(accuracyMeters, 0), 300);
  return getCachedLocationSummaries(units)
    .map((location) => ({ ...location, distance_meters: distanceMeters(lat, lon, location.latitude, location.longitude) }))
    .filter((location) => location.distance_meters <= location.radius_meters + toleranceMeters)
    .sort((a, b) => (a.distance_meters ?? 0) - (b.distance_meters ?? 0));
}
