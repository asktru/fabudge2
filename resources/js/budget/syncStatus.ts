import { reactive } from 'vue';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
    state: SyncState;
    /** Local changes not yet accepted by the server. */
    pendingCount: number;
    /** Rows the server rejected (bug surface — kept out of retry). */
    errorCount: number;
    lastSyncedAt: number | null;
    ratesFetchedAt: number | null;
}

export function createSyncStatus(): SyncStatus {
    return reactive({
        state: 'idle',
        pendingCount: 0,
        errorCount: 0,
        lastSyncedAt: null,
        ratesFetchedAt: null,
    });
}
