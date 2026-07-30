import { describe, expect, it } from 'vitest';

import { hasNearbyAssociation, haversineMeters, nearbyPayeeIds } from '@/budget/locations';
import type { PayeeLocation } from '@/budget/types';

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const OTTAWA = { latitude: 45.4215, longitude: -75.6972 };

function location(overrides: Partial<PayeeLocation>): PayeeLocation {
    return {
        id: Math.random().toString(),
        payee_id: 'p1',
        latitude: TORONTO.latitude,
        longitude: TORONTO.longitude,
        updated_at: 1,
        deleted_at: null,
        ...overrides,
    };
}

describe('haversineMeters', () => {
    it('matches a known city distance and is symmetric', () => {
        const distance = haversineMeters(TORONTO, OTTAWA);

        expect(distance).toBeGreaterThan(340_000);
        expect(distance).toBeLessThan(360_000);
        expect(haversineMeters(OTTAWA, TORONTO)).toBeCloseTo(distance, 5);
        expect(haversineMeters(TORONTO, TORONTO)).toBe(0);
    });

    it('resolves ~100m differences', () => {
        const nearby = { latitude: TORONTO.latitude + 0.0009, longitude: TORONTO.longitude };

        expect(haversineMeters(TORONTO, nearby)).toBeGreaterThan(90);
        expect(haversineMeters(TORONTO, nearby)).toBeLessThan(110);
    });
});

describe('nearbyPayeeIds', () => {
    it('returns unique payees within radius, nearest first, skipping tombstones', () => {
        const locations = [
            location({ payee_id: 'far', latitude: OTTAWA.latitude, longitude: OTTAWA.longitude }),
            location({ payee_id: 'close', latitude: TORONTO.latitude + 0.001, longitude: TORONTO.longitude }),
            location({ payee_id: 'closest' }),
            location({ payee_id: 'closest', latitude: TORONTO.latitude + 0.002 }), // duplicate payee, farther spot
            location({ payee_id: 'dead', deleted_at: 5 }),
        ];

        expect(nearbyPayeeIds(TORONTO, locations)).toEqual(['closest', 'close']);
    });
});

describe('hasNearbyAssociation', () => {
    it('detects an existing association within the dedupe radius', () => {
        const locations = [location({ payee_id: 'p1' })];

        expect(hasNearbyAssociation('p1', TORONTO, locations)).toBe(true);
        expect(hasNearbyAssociation('p2', TORONTO, locations)).toBe(false);
        expect(hasNearbyAssociation('p1', OTTAWA, locations)).toBe(false);
    });
});
