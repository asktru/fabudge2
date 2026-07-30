# Phase 5: Location-Based Payee Suggestions — Design

Date: 2026-07-30
Status: Approved (autonomous, per delegated review)

## Data model

New syncable table **payee_locations** (m-to-n: a payee can have many spots,
different rows can point to different payees near each other):
id, payee_id, latitude, longitude (decimal degrees, validated −90..90 /
−180..180). Server migration + SyncTables rules + Dexie v4 (`payee_id`
index).

## Behaviour

- **Capture**: when the transaction form opens, request the device position
  (via `useGeolocation` from @vueuse/core, already a dependency; browser
  permission prompt appears once). No position → everything degrades
  silently to phase-2 behaviour.
- **Associate**: when a payee is selected and a position is known, the form
  shows a small "Remember this location for {payee}" checkbox — checked by
  default only when the payee has no saved location within 150 m. On save,
  if checked and no existing association within 150 m, create a
  payee_locations row.
- **Suggest**: payee combobox ordering becomes: payees with a saved location
  within 500 m of the current position first (nearest recency order), then
  the rest by recency (existing behaviour). A small pin icon marks the
  location-matched group ("Nearby").

## Pure logic (`locations.ts`)

- `haversineMeters(a, b)` — great-circle distance.
- `nearbyPayeeIds(coords, locations, radiusM)` — unique payee ids with ≥1
  saved location within radius.
- `hasNearbyAssociation(payeeId, coords, locations, radiusM)` — dedupe check.

## Repo

- `addPayeeLocation(payeeId, latitude, longitude)` — plain insert.

## Testing

Vitest: haversine sanity (known city pair ≈ expected, symmetry, zero
distance), nearby filtering incl. tombstones, dedupe check, ranking helper.
Pest: sync round-trip + coordinate validation.
