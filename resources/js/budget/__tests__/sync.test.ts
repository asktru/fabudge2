import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openBudgetDatabase  } from '@/budget/db';
import type {BudgetDatabase} from '@/budget/db';
import { createRepo  } from '@/budget/repo';
import type {Repo} from '@/budget/repo';
import { SyncEngine } from '@/budget/sync';
import type { PullResponse, PushResponse } from '@/budget/types';

let db: BudgetDatabase;
let repo: Repo;

const emptyRates = { base: 'CAD', fetched_at: null, quotes: {} };

function pullResponse(overrides: Partial<PullResponse> = {}): PullResponse {
    return { changes: [], cursor: 0, has_more: false, rates: emptyRates, ...overrides };
}

/** fetch stub that answers push with per-row `status` and pull with queued pages. */
function fakeServer({ pushStatus = 'accepted', pullPages = [pullResponse()] }: { pushStatus?: string; pullPages?: PullResponse[] } = {}) {
    const calls: { url: string; body?: unknown }[] = [];
    let pullIndex = 0;

    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        calls.push({ url, body });

        if (url.includes('/sync/push')) {
            const response: PushResponse = {
                results: body.changes.map((change: { table: string; row: { id: string } }) => ({
                    id: change.row.id,
                    table: change.table,
                    status: pushStatus,
                    reason: pushStatus === 'rejected' ? 'nope' : null,
                })),
                server_seq: 1,
            };

            return new Response(JSON.stringify(response), { status: 200 });
        }

        const page = pullPages[Math.min(pullIndex, pullPages.length - 1)];
        pullIndex += 1;

        return new Response(JSON.stringify(page), { status: 200 });
    });

    return { fetchFn, calls };
}

function engine(fetchFn: typeof fetch, online = true): SyncEngine {
    return new SyncEngine(db, { pushUrl: '/t/sync/push', pullUrl: '/t/sync/pull' }, { fetchFn, isOnline: () => online });
}

beforeEach(() => {
    db = openBudgetDatabase(`sync-test-${Math.random()}`);
    repo = createRepo(db);
});

describe('push', () => {
    it('drains the outbox and clears entries on acceptance', async () => {
        await repo.createAccount({ name: 'A', currency: 'CAD', type: 'cash', on_budget: true });
        const server = fakeServer();

        await engine(server.fetchFn).syncNow();

        expect(await db.outbox.count()).toBe(0);
        const pushCall = server.calls.find((call) => call.url.includes('push'));
        expect((pushCall?.body as { changes: unknown[] }).changes).toHaveLength(1);
    });

    it('quarantines rejected rows instead of retrying forever', async () => {
        await repo.createAccount({ name: 'A', currency: 'CAD', type: 'cash', on_budget: true });
        const server = fakeServer({ pushStatus: 'rejected' });
        const sync = engine(server.fetchFn);

        await sync.syncNow();

        expect(await db.outbox.count()).toBe(0);
        expect(sync.status.errorCount).toBe(1);
        const errors = (await db.sync_meta.get('errors'))?.value as { reason: string }[];
        expect(errors[0].reason).toBe('nope');
    });
});

describe('pull', () => {
    it('applies remote rows, saves the cursor, and stores rates', async () => {
        const remoteAccount = {
            id: '018f0000-0000-7000-8000-000000000001',
            name: 'Remote',
            currency: 'USD',
            type: 'chequing',
            on_budget: true,
            note: null,
            sort_order: 0,
            updated_at: 111,
            deleted_at: null,
        };
        const server = fakeServer({
            pullPages: [
                pullResponse({
                    changes: [{ table: 'accounts', row: remoteAccount }],
                    cursor: 42,
                    rates: { base: 'CAD', fetched_at: 999, quotes: { USD: 0.73 } },
                }),
            ],
        });

        await engine(server.fetchFn).syncNow();

        expect((await db.accounts.get(remoteAccount.id))?.name).toBe('Remote');
        expect((await db.sync_meta.get('cursor'))?.value).toBe(42);
        expect((await db.rates.get('USD'))?.rate).toBe(0.73);
    });

    it('follows has_more pagination', async () => {
        const server = fakeServer({
            pullPages: [pullResponse({ cursor: 10, has_more: true }), pullResponse({ cursor: 20 })],
        });

        await engine(server.fetchFn).syncNow();

        const pullCalls = server.calls.filter((call) => call.url.includes('pull'));
        expect(pullCalls).toHaveLength(2);
        expect(pullCalls[1].url).toContain('cursor=10');
        expect((await db.sync_meta.get('cursor'))?.value).toBe(20);
    });

    it('never overwrites locally-dirty rows', async () => {
        const account = await repo.createAccount({ name: 'Old', currency: 'CAD', type: 'cash', on_budget: true });
        const remote = { ...account, name: 'Remote name', updated_at: account.updated_at + 999_999 };

        // A local edit lands while the pull request is in flight, so the row is
        // dirty again when the page applies — the newer remote must not win.
        const sync = new SyncEngine(db, { pushUrl: '/t/sync/push', pullUrl: '/t/sync/pull' }, {
            fetchFn: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                if (String(input).includes('push')) {
                    const body = JSON.parse(init?.body as string) as { changes: { table: string; row: { id: string } }[] };

                    return new Response(
                        JSON.stringify({
                            results: body.changes.map((change) => ({ id: change.row.id, table: change.table, status: 'accepted', reason: null })),
                            server_seq: 1,
                        }),
                        { status: 200 },
                    );
                }

                await repo.updateAccount(account.id, { name: 'Local edit during pull' });

                return new Response(
                    JSON.stringify(pullResponse({ changes: [{ table: 'accounts', row: remote }], cursor: 1 })),
                    { status: 200 },
                );
            }) as typeof fetch,
            isOnline: () => true,
        });

        await sync.syncNow();

        expect((await db.accounts.get(account.id))?.name).toBe('Local edit during pull');
    });

    it('applies last-write-wins for clean rows', async () => {
        const account = await repo.createAccount({ name: 'Old', currency: 'CAD', type: 'cash', on_budget: true });
        const server = fakeServer(); // first sync pushes and clears outbox
        const sync = engine(server.fetchFn);
        await sync.syncNow();

        const older = { ...account, name: 'Stale remote', updated_at: account.updated_at - 1 };
        const newer = { ...account, name: 'Fresh remote', updated_at: account.updated_at + 1 };

        const server2 = fakeServer({
            pullPages: [pullResponse({ changes: [{ table: 'accounts', row: older }, { table: 'accounts', row: newer }], cursor: 2 })],
        });
        await engine(server2.fetchFn).syncNow();

        expect((await db.accounts.get(account.id))?.name).toBe('Fresh remote');
    });
});

describe('offline behaviour', () => {
    it('makes no requests and reports offline with pending count', async () => {
        await repo.createAccount({ name: 'A', currency: 'CAD', type: 'cash', on_budget: true });
        const server = fakeServer();
        const sync = engine(server.fetchFn, false);

        await sync.syncNow();

        expect(server.fetchFn).not.toHaveBeenCalled();
        expect(sync.status.state).toBe('offline');
        expect(sync.status.pendingCount).toBeGreaterThan(0);
    });

    it('schedules a retry after a failure', async () => {
        let failures = 0;
        const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
            if (String(input).includes('push')) {
                return new Response(JSON.stringify({ results: [], server_seq: 0 }), { status: 200 });
            }

            if (failures === 0) {
                failures += 1;

                return new Response(null, { status: 500 });
            }

            return new Response(JSON.stringify(pullResponse()), { status: 200 });
        }) as typeof fetch;

        const sync = new SyncEngine(
            db,
            { pushUrl: '/t/sync/push', pullUrl: '/t/sync/pull' },
            { fetchFn, isOnline: () => true, backoffBaseMs: 20 },
        );

        await sync.syncNow();
        expect(sync.status.state).toBe('error');

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sync.status.state).toBe('idle');
        sync.stop();
    });
});
