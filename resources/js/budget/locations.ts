import type { PayeeLocation } from './types';

export interface Coordinates {
    latitude: number;
    longitude: number;
}

/** Payees with a saved spot within this range are suggested first. */
export const SUGGEST_RADIUS_M = 500;

/** A new association is skipped when one already exists within this range. */
export const ASSOCIATE_DEDUPE_RADIUS_M = 150;

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: Coordinates, b: Coordinates): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);

    const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLon * sinLon;

    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Unique payee ids with at least one live saved location within the radius, nearest first. */
export function nearbyPayeeIds(coords: Coordinates, locations: PayeeLocation[], radiusM = SUGGEST_RADIUS_M): string[] {
    const nearest = new Map<string, number>();

    for (const location of locations) {
        if (location.deleted_at !== null) {
            continue;
        }

        const distance = haversineMeters(coords, location);

        if (distance <= radiusM && distance < (nearest.get(location.payee_id) ?? Infinity)) {
            nearest.set(location.payee_id, distance);
        }
    }

    return [...nearest.entries()].sort((a, b) => a[1] - b[1]).map(([payeeId]) => payeeId);
}

export function hasNearbyAssociation(
    payeeId: string,
    coords: Coordinates,
    locations: PayeeLocation[],
    radiusM = ASSOCIATE_DEDUPE_RADIUS_M,
): boolean {
    return locations.some(
        (location) =>
            location.payee_id === payeeId && location.deleted_at === null && haversineMeters(coords, location) <= radiusM,
    );
}
