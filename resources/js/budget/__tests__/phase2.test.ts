import { beforeEach, describe, expect, it } from 'vitest';

import { openBudgetDatabase } from '@/budget/db';
import type { BudgetDatabase } from '@/budget/db';
import { createRepo, RECONCILIATION_PAYEE } from '@/budget/repo';
import type { Repo } from '@/budget/repo';
import { groupRegisterRows } from '@/budget/registerRows';
import { suggestCategory } from '@/budget/suggestions';
import type { Transaction } from '@/budget/types';

let db: BudgetDatabase;
let repo: Repo;
let accountId: string;

beforeEach(async () => {
    db = openBudgetDatabase(`phase2-test-${Math.random()}`);
    repo = createRepo(db);
    accountId = (await repo.createAccount({ name: 'A', currency: 'CAD', type: 'chequing', on_budget: true })).id;
});

describe('suggestCategory', () => {
    it('returns the category of the most recent categorized transaction with the payee', async () => {
        const payee = await repo.resolvePayee('Metro');
        const groceries = await repo.createCategory('Groceries');
        const household = await repo.createCategory('Household');

        await repo.createTransaction({ account_id: accountId, date: '2026-07-01', amountMinor: -100, payee_id: payee.id, category_id: household.id });
        await repo.createTransaction({ account_id: accountId, date: '2026-07-10', amountMinor: -100, payee_id: payee.id, category_id: groceries.id });
        await repo.createTransaction({ account_id: accountId, date: '2026-07-20', amountMinor: -100, payee_id: payee.id }); // uncategorized

        expect(suggestCategory(payee.id, await db.transactions.toArray())).toBe(groceries.id);
        expect(suggestCategory('nonexistent', await db.transactions.toArray())).toBeNull();
    });
});

describe('splits', () => {
    it('createSplit writes members sharing a group with shared fields', async () => {
        const groceries = await repo.createCategory('Groceries');

        const rows = await repo.createSplit({
            account_id: accountId,
            date: '2026-07-30',
            payeeName: 'Costco',
            cleared: 'cleared',
            lines: [
                { category_id: groceries.id, amountMinor: -6000 },
                { category_id: null, amountMinor: -4000 },
            ],
        });

        expect(rows).toHaveLength(2);
        expect(rows[0].split_group_id).toBe(rows[1].split_group_id);
        expect(rows[0].payee_id).toBe(rows[1].payee_id);
        expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(-10000);
    });

    it('rejects fewer than two lines or zero lines', async () => {
        await expect(
            repo.createSplit({ account_id: accountId, date: '2026-07-30', lines: [{ category_id: null, amountMinor: -100 }] }),
        ).rejects.toThrow();

        await expect(
            repo.createSplit({
                account_id: accountId,
                date: '2026-07-30',
                lines: [
                    { category_id: null, amountMinor: -100 },
                    { category_id: null, amountMinor: 0 },
                ],
            }),
        ).rejects.toThrow();
    });

    it('updateSplitGroup propagates shared fields to all members', async () => {
        const rows = await repo.createSplit({
            account_id: accountId,
            date: '2026-07-30',
            lines: [
                { category_id: null, amountMinor: -100 },
                { category_id: null, amountMinor: -200 },
            ],
        });

        await repo.updateSplitGroup(rows[0].split_group_id!, { date: '2026-07-31', cleared: 'cleared' });

        const members = await db.transactions.where('split_group_id').equals(rows[0].split_group_id!).toArray();
        expect(members.every((member) => member.date === '2026-07-31' && member.cleared === 'cleared')).toBe(true);
    });

    it('replaceSplitLines reuses, adds, and tombstones members', async () => {
        const rows = await repo.createSplit({
            account_id: accountId,
            date: '2026-07-30',
            lines: [
                { category_id: null, amountMinor: -100 },
                { category_id: null, amountMinor: -200 },
            ],
        });
        const groupId = rows[0].split_group_id!;

        await repo.replaceSplitLines(groupId, [
            { category_id: null, amountMinor: -50 },
            { category_id: null, amountMinor: -150 },
            { category_id: null, amountMinor: -300 },
        ]);

        const live = (await db.transactions.where('split_group_id').equals(groupId).toArray()).filter((t) => t.deleted_at === null);
        expect(live).toHaveLength(3);
        expect(live.reduce((sum, t) => sum + t.amount, 0)).toBe(-500);
    });

    it('replaceSplitLines with one line converts back to a plain transaction', async () => {
        const rows = await repo.createSplit({
            account_id: accountId,
            date: '2026-07-30',
            lines: [
                { category_id: null, amountMinor: -100 },
                { category_id: null, amountMinor: -200 },
            ],
        });
        const groupId = rows[0].split_group_id!;

        await repo.replaceSplitLines(groupId, [{ category_id: null, amountMinor: -300 }]);

        const all = await db.transactions.where('account_id').equals(accountId).toArray();
        const live = all.filter((t) => t.deleted_at === null);
        expect(live).toHaveLength(1);
        expect(live[0].split_group_id).toBeNull();
        expect(live[0].amount).toBe(-300);
    });

    it('deleting one member tombstones the whole group', async () => {
        const rows = await repo.createSplit({
            account_id: accountId,
            date: '2026-07-30',
            lines: [
                { category_id: null, amountMinor: -100 },
                { category_id: null, amountMinor: -200 },
            ],
        });

        await repo.deleteTransaction(rows[1].id);

        const live = (await db.transactions.toArray()).filter((t) => t.deleted_at === null);
        expect(live).toHaveLength(0);
    });

    it('groupRegisterRows collapses members into one row', () => {
        const base = (overrides: Partial<Transaction>): Transaction => ({
            id: Math.random().toString(),
            account_id: 'a',
            date: '2026-07-30',
            amount: -100,
            payee_id: null,
            category_id: null,
            memo: null,
            cleared: 'uncleared',
            transfer_pair_id: null,
            split_group_id: null,
            updated_at: 1,
            deleted_at: null,
            ...overrides,
        });

        const rows = groupRegisterRows([
            base({ id: 't1' }),
            base({ id: 's1', split_group_id: 'g1', amount: -300 }),
            base({ id: 's2', split_group_id: 'g1', amount: -700 }),
            base({ id: 't2' }),
        ]);

        expect(rows).toHaveLength(3);
        expect(rows[1]).toMatchObject({ kind: 'split', groupId: 'g1', totalMinor: -1000 });
        expect((rows[1] as { members: Transaction[] }).members).toHaveLength(2);
    });
});

describe('finishReconciliation', () => {
    it('marks cleared transactions reconciled without an adjustment when balances match', async () => {
        await repo.createTransaction({ account_id: accountId, date: '2026-07-01', amountMinor: 10000, cleared: 'cleared' });
        await repo.createTransaction({ account_id: accountId, date: '2026-07-02', amountMinor: -2000, cleared: 'uncleared' });

        const adjustment = await repo.finishReconciliation(accountId, 10000);

        expect(adjustment).toBeNull();
        const rows = await db.transactions.where('account_id').equals(accountId).toArray();
        expect(rows.find((t) => t.amount === 10000)?.cleared).toBe('reconciled');
        expect(rows.find((t) => t.amount === -2000)?.cleared).toBe('uncleared');
    });

    it('creates a reconciled adjustment for the difference', async () => {
        await repo.createTransaction({ account_id: accountId, date: '2026-07-01', amountMinor: 10000, cleared: 'cleared' });

        const adjustment = await repo.finishReconciliation(accountId, 9500);

        expect(adjustment).not.toBeNull();
        expect(adjustment!.amount).toBe(-500);
        expect((await db.transactions.get(adjustment!.id))?.cleared).toBe('reconciled');

        const payees = await db.payees.toArray();
        expect(payees.map((p) => p.name)).toContain(RECONCILIATION_PAYEE);
    });

    it('already-reconciled rows count toward the cleared balance and stay reconciled', async () => {
        await repo.createTransaction({ account_id: accountId, date: '2026-07-01', amountMinor: 5000, cleared: 'cleared' });
        await repo.finishReconciliation(accountId, 5000);

        const again = await repo.finishReconciliation(accountId, 5000);

        expect(again).toBeNull();
        const rows = (await db.transactions.toArray()).filter((t) => t.deleted_at === null);
        expect(rows).toHaveLength(1);
        expect(rows[0].cleared).toBe('reconciled');
    });
});
