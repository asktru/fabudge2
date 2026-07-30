import { nowMs } from './clock';
import type { BudgetDatabase } from './db';
import { createSyncStatus  } from './syncStatus';
import type {SyncStatus} from './syncStatus';
import type { OutboxEntry, PullResponse, PushChange, PushResponse, SyncableRow, SyncTableName } from './types';

export interface SyncEndpoints {
    pushUrl: string;
    pullUrl: string;
}

export interface SyncEngineOptions {
    fetchFn?: typeof fetch;
    isOnline?: () => boolean;
    /** Debounce for requestSync, ms. */
    debounceMs?: number;
    /** Periodic sync interval, ms. */
    intervalMs?: number;
    pageLimit?: number;
    /** Exponential-backoff base after failures, ms. */
    backoffBaseMs?: number;
}

const PUSH_BATCH_LIMIT = 500;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 300_000;

function xsrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);

    return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Push local outbox rows / pull remote changes by cursor. All conflict
 * handling is last-write-wins on `updated_at`; locally-dirty rows (still in
 * the outbox) are never overwritten by pulls — their push settles first.
 */
export class SyncEngine {
    readonly status: SyncStatus = createSyncStatus();

    private readonly fetchFn: typeof fetch;
    private readonly isOnline: () => boolean;
    private readonly debounceMs: number;
    private readonly intervalMs: number;
    private readonly pageLimit: number;
    private readonly backoffBaseMs: number;

    private running = false;
    private queued = false;
    private failureCount = 0;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private intervalTimer: ReturnType<typeof setInterval> | null = null;
    private readonly onOnline = () => {
        this.status.state = 'idle';
        void this.syncNow();
    };
    private readonly onOffline = () => {
        this.status.state = 'offline';
    };

    constructor(
        private readonly db: BudgetDatabase,
        private readonly endpoints: SyncEndpoints,
        options: SyncEngineOptions = {},
    ) {
        this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
        this.isOnline = options.isOnline ?? (() => navigator.onLine);
        this.debounceMs = options.debounceMs ?? 3_000;
        this.intervalMs = options.intervalMs ?? 60_000;
        this.pageLimit = options.pageLimit ?? 1_000;
        this.backoffBaseMs = options.backoffBaseMs ?? BACKOFF_BASE_MS;
    }

    /** Begin periodic + connectivity-triggered syncing (and sync immediately). */
    start(): void {
        window.addEventListener('online', this.onOnline);
        window.addEventListener('offline', this.onOffline);
        this.intervalTimer = setInterval(() => void this.syncNow(), this.intervalMs);
        void this.syncNow();
    }

    stop(): void {
        window.removeEventListener('online', this.onOnline);
        window.removeEventListener('offline', this.onOffline);

        if (this.intervalTimer) {
clearInterval(this.intervalTimer);
}

        if (this.debounceTimer) {
clearTimeout(this.debounceTimer);
}

        if (this.retryTimer) {
clearTimeout(this.retryTimer);
}
    }

    /** Debounced sync — call after local writes. */
    requestSync(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => void this.syncNow(), this.debounceMs);
    }

    /** Push then pull, serialized: overlapping calls coalesce into one follow-up run. */
    async syncNow(): Promise<void> {
        if (this.running) {
            this.queued = true;

            return;
        }

        await this.refreshPendingCount();

        if (!this.isOnline()) {
            this.status.state = 'offline';

            return;
        }

        this.running = true;
        this.status.state = 'syncing';

        try {
            await this.push();
            await this.pull();

            this.failureCount = 0;
            this.status.state = 'idle';
            this.status.lastSyncedAt = nowMs();
        } catch {
            this.failureCount += 1;
            this.status.state = this.isOnline() ? 'error' : 'offline';
            this.scheduleRetry();
        } finally {
            this.running = false;
            await this.refreshPendingCount();

            if (this.queued) {
                this.queued = false;
                void this.syncNow();
            }
        }
    }

    private scheduleRetry(): void {
        const delay = Math.min(this.backoffBaseMs * 2 ** (this.failureCount - 1), BACKOFF_MAX_MS);

        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
        }

        this.retryTimer = setTimeout(() => void this.syncNow(), delay);
    }

    private async refreshPendingCount(): Promise<void> {
        this.status.pendingCount = await this.db.outbox.count();
        this.status.errorCount = ((await this.db.sync_meta.get('errors'))?.value as unknown[] | undefined)?.length ?? 0;
    }

    private async push(): Promise<void> {
        for (;;) {
            const entries = await this.db.outbox.orderBy('seq').limit(PUSH_BATCH_LIMIT).toArray();

            if (entries.length === 0) {
                return;
            }

            const changes: PushChange[] = [];
            const changeEntries: OutboxEntry[] = [];

            for (const entry of entries) {
                const row = (await this.db.table(entry.table).get(entry.row_id)) as SyncableRow | undefined;

                if (!row) {
                    await this.db.outbox.delete(entry.seq!);
                    continue;
                }

                changes.push({ table: entry.table, row });
                changeEntries.push(entry);
            }

            if (changes.length === 0) {
                continue;
            }

            const response = await this.fetchFn(this.endpoints.pushUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-XSRF-TOKEN': xsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({ changes }),
            });

            if (!response.ok) {
                throw new Error(`push failed: ${response.status}`);
            }

            const result = (await response.json()) as PushResponse;

            if (result.results.length !== changes.length) {
                throw new Error('push made no progress: result count mismatch');
            }

            for (const [index, rowResult] of result.results.entries()) {
                const entry = changeEntries[index];

                if (rowResult.status === 'rejected') {
                    await this.recordRejection(entry.table, entry.row_id, rowResult.reason);
                }

                // Deleting by seq: if the row was edited mid-flight its outbox
                // entry has a new seq and survives for the next push.
                await this.db.outbox.delete(entry.seq!);
            }
        }
    }

    private async recordRejection(table: SyncTableName, rowId: string, reason: string | null): Promise<void> {
        const existing = ((await this.db.sync_meta.get('errors'))?.value as object[] | undefined) ?? [];

        await this.db.sync_meta.put({
            key: 'errors',
            value: [...existing, { table, row_id: rowId, reason, at: nowMs() }],
        });
    }

    private async pull(): Promise<void> {
        for (;;) {
            const cursor = ((await this.db.sync_meta.get('cursor'))?.value as number | undefined) ?? 0;
            const url = `${this.endpoints.pullUrl}?${new URLSearchParams({ cursor: String(cursor), limit: String(this.pageLimit) })}`;

            const response = await this.fetchFn(url, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            });

            if (!response.ok) {
                throw new Error(`pull failed: ${response.status}`);
            }

            const page = (await response.json()) as PullResponse;

            await this.applyPage(page);

            if (!page.has_more) {
                return;
            }
        }
    }

    private async applyPage(page: PullResponse): Promise<void> {
        const tables = [...new Set(page.changes.map((change) => change.table))].map((table) => this.db.table(table));

        await this.db.transaction('rw', [...tables, this.db.sync_meta, this.db.outbox, this.db.rates], async () => {
            for (const change of page.changes) {
                const dirty = await this.db.outbox.where('[table+row_id]').equals([change.table, change.row.id]).count();

                if (dirty > 0) {
                    continue;
                }

                const local = (await this.db.table(change.table).get(change.row.id)) as SyncableRow | undefined;

                if (!local || change.row.updated_at > local.updated_at) {
                    await this.db.table(change.table).put(change.row);
                }
            }

            await this.db.sync_meta.put({ key: 'cursor', value: page.cursor });

            if (page.rates.fetched_at !== null) {
                await this.db.rates.bulkPut(
                    Object.entries(page.rates.quotes).map(([quote, rate]) => ({
                        quote,
                        rate,
                        fetched_at: page.rates.fetched_at,
                    })),
                );
            }
        });

        this.status.ratesFetchedAt = page.rates.fetched_at ?? this.status.ratesFetchedAt;
    }
}
