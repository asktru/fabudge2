import { beforeEach, describe, expect, it } from 'vitest';

import { addMonths, computeAutoAssignNeeds, computeBudgetMonth, monthsBetweenInclusive } from '@/budget/budgetMath';
import { openBudgetDatabase } from '@/budget/db';
import type { BudgetDatabase } from '@/budget/db';
import { createRepo } from '@/budget/repo';
import type { Repo } from '@/budget/repo';
import type { Account, Assignment, RateRow, Target, Transaction } from '@/budget/types';

function account(overrides: Partial<Account>): Account {
    return {
        id: 'a1',
        name: 'A',
        currency: 'CAD',
        type: 'chequing',
        on_budget: true,
        note: null,
        sort_order: 0,
        updated_at: 1,
        deleted_at: null,
        ...overrides,
    };
}

function transaction(overrides: Partial<Transaction>): Transaction {
    return {
        id: Math.random().toString(),
        account_id: 'a1',
        date: '2026-07-15',
        amount: 0,
        payee_id: null,
        category_id: null,
        memo: null,
        cleared: 'uncleared',
        transfer_pair_id: null,
        split_group_id: null,
        updated_at: 1,
        deleted_at: null,
        ...overrides,
    };
}

function assignment(overrides: Partial<Assignment>): Assignment {
    return {
        id: Math.random().toString(),
        category_id: 'c1',
        month: '2026-07',
        amount: 0,
        updated_at: 1,
        deleted_at: null,
        ...overrides,
    };
}

function target(overrides: Partial<Target>): Target {
    return {
        id: Math.random().toString(),
        category_id: 'c1',
        type: 'monthly',
        amount: 0,
        due_month: null,
        updated_at: 1,
        deleted_at: null,
        ...overrides,
    };
}

describe('month helpers', () => {
    it('adds months across year boundaries', () => {
        expect(addMonths('2026-11', 2)).toBe('2027-01');
        expect(addMonths('2026-01', -1)).toBe('2025-12');
    });

    it('counts inclusive months', () => {
        expect(monthsBetweenInclusive('2026-07', '2026-12')).toBe(6);
        expect(monthsBetweenInclusive('2026-07', '2026-07')).toBe(1);
        expect(monthsBetweenInclusive('2026-08', '2026-07')).toBe(0);
    });
});

describe('computeBudgetMonth', () => {
    const rates: RateRow[] = [{ quote: 'USD', rate: 0.5, fetched_at: 1 }];

    it('computes RTA from funds minus assignments and categorized activity', () => {
        const result = computeBudgetMonth('2026-07', {
            accounts: [account({})],
            transactions: [
                transaction({ amount: 100000 }), // uncategorized income
                transaction({ amount: -20000, category_id: 'c1' }),
            ],
            assignments: [assignment({ category_id: 'c1', amount: 30000 })],
            rates: [],
        });

        // funds 80000 − assigned 30000 − activity (−20000) = 70000
        expect(result.readyToAssignMinor).toBe(70000);
        expect(result.categories['c1']).toEqual({ assignedMinor: 30000, activityMinor: -20000, availableMinor: 10000 });
        expect(result.overspent).toEqual([]);
    });

    it('carries available across months and flags overspending', () => {
        const inputs = {
            accounts: [account({})],
            transactions: [
                transaction({ date: '2026-06-10', amount: -5000, category_id: 'c1' }),
                transaction({ date: '2026-07-10', amount: -4000, category_id: 'c1' }),
            ],
            assignments: [assignment({ month: '2026-06', amount: 6000 })],
            rates: [],
        };

        const june = computeBudgetMonth('2026-06', inputs);
        expect(june.categories['c1'].availableMinor).toBe(1000);

        const july = computeBudgetMonth('2026-07', inputs);
        expect(july.categories['c1'].availableMinor).toBe(-3000);
        expect(july.overspent).toEqual(['c1']);
    });

    it('future-month assignments reduce global RTA but not past availables', () => {
        const inputs = {
            accounts: [account({})],
            transactions: [transaction({ amount: 50000 })],
            assignments: [assignment({ month: '2026-09', amount: 20000 })],
            rates: [],
        };

        const july = computeBudgetMonth('2026-07', inputs);
        expect(july.readyToAssignMinor).toBe(30000);
        expect(july.categories['c1'].availableMinor).toBe(0);

        const september = computeBudgetMonth('2026-09', inputs);
        expect(september.categories['c1'].availableMinor).toBe(20000);
    });

    it('converts foreign on-budget accounts and ignores off-budget ones', () => {
        const result = computeBudgetMonth('2026-07', {
            accounts: [
                account({ id: 'usd', currency: 'USD' }),
                account({ id: 'off', on_budget: false }),
            ],
            transactions: [
                transaction({ account_id: 'usd', amount: 5000 }), // 1 USD = 2 CAD
                transaction({ account_id: 'off', amount: 999999 }),
            ],
            assignments: [],
            rates,
        });

        expect(result.readyToAssignMinor).toBe(10000);
    });

    it('transfers between on-budget accounts cancel out of RTA', () => {
        const result = computeBudgetMonth('2026-07', {
            accounts: [account({ id: 'a1' }), account({ id: 'a2' })],
            transactions: [
                transaction({ account_id: 'a1', amount: -5000, transfer_pair_id: 'p' }),
                transaction({ account_id: 'a2', amount: 5000, transfer_pair_id: 'p' }),
            ],
            assignments: [],
            rates: [],
        });

        expect(result.readyToAssignMinor).toBe(0);
    });
});

describe('computeAutoAssignNeeds', () => {
    it('monthly target needs the gap up to the monthly amount', () => {
        const month = computeBudgetMonth('2026-07', {
            accounts: [account({})],
            transactions: [],
            assignments: [assignment({ category_id: 'c1', amount: 10000 })],
            rates: [],
        });

        const needs = computeAutoAssignNeeds('2026-07', [target({ type: 'monthly', amount: 30000 })], month);
        expect(needs).toEqual([{ categoryId: 'c1', neededMinor: 20000 }]);
    });

    it('refill target tops available back up to the amount', () => {
        const month = computeBudgetMonth('2026-07', {
            accounts: [account({})],
            transactions: [transaction({ date: '2026-06-01', amount: -30000, category_id: 'c1' })],
            assignments: [assignment({ month: '2026-06', category_id: 'c1', amount: 42000 })],
            rates: [],
        });

        // available carried into July = 12000; refill to 50000 → need 38000
        const needs = computeAutoAssignNeeds('2026-07', [target({ type: 'refill', amount: 50000 })], month);
        expect(needs).toEqual([{ categoryId: 'c1', neededMinor: 38000 }]);
    });

    it('by_date target spreads the shortfall over remaining months', () => {
        const month = computeBudgetMonth('2026-07', {
            accounts: [account({})],
            transactions: [],
            assignments: [],
            rates: [],
        });

        // Need 300000 by December, nothing saved, 6 months left → 50000/month.
        const needs = computeAutoAssignNeeds('2026-07', [target({ type: 'by_date', amount: 300000, due_month: '2026-12' })], month);
        expect(needs).toEqual([{ categoryId: 'c1', neededMinor: 50000 }]);
    });

    it('by_date target past its due month needs nothing', () => {
        const month = computeBudgetMonth('2027-01', { accounts: [], transactions: [], assignments: [], rates: [] });

        const needs = computeAutoAssignNeeds('2027-01', [target({ type: 'by_date', amount: 300000, due_month: '2026-12' })], month);
        expect(needs).toEqual([]);
    });

    it('satisfied targets need nothing', () => {
        const month = computeBudgetMonth('2026-07', {
            accounts: [account({})],
            transactions: [],
            assignments: [assignment({ category_id: 'c1', amount: 30000 })],
            rates: [],
        });

        expect(computeAutoAssignNeeds('2026-07', [target({ type: 'monthly', amount: 30000 })], month)).toEqual([]);
    });
});

describe('assignment repo methods', () => {
    let db: BudgetDatabase;
    let repo: Repo;

    beforeEach(() => {
        db = openBudgetDatabase(`phase3-test-${Math.random()}`);
        repo = createRepo(db);
    });

    it('setAssignment upserts a single live row per category-month', async () => {
        await repo.setAssignment('c1', '2026-07', 10000);
        await repo.setAssignment('c1', '2026-07', 25000);

        const rows = (await db.assignments.toArray()).filter((row) => row.deleted_at === null);
        expect(rows).toHaveLength(1);
        expect(rows[0].amount).toBe(25000);
    });

    it('setAssignment to zero tombstones the row', async () => {
        await repo.setAssignment('c1', '2026-07', 10000);
        await repo.setAssignment('c1', '2026-07', 0);

        expect((await db.assignments.toArray()).filter((row) => row.deleted_at === null)).toHaveLength(0);
    });

    it('moveMoney between categories adjusts both rows', async () => {
        await repo.setAssignment('c1', '2026-07', 10000);

        await repo.moveMoney({ fromCategoryId: 'c1', toCategoryId: 'c2', month: '2026-07', amountMinor: 4000 });

        const byCategory = Object.fromEntries(
            (await db.assignments.toArray()).filter((row) => row.deleted_at === null).map((row) => [row.category_id, row.amount]),
        );
        expect(byCategory).toEqual({ c1: 6000, c2: 4000 });
    });

    it('moveMoney from RTA only touches the destination', async () => {
        await repo.moveMoney({ fromCategoryId: null, toCategoryId: 'c2', month: '2026-07', amountMinor: 4000 });

        const rows = (await db.assignments.toArray()).filter((row) => row.deleted_at === null);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ category_id: 'c2', amount: 4000 });
    });

    it('setTarget replaces the live target and clearTarget tombstones it', async () => {
        await repo.setTarget('c1', { type: 'monthly', amountMinor: 30000 });
        await repo.setTarget('c1', { type: 'by_date', amountMinor: 90000, dueMonth: '2026-12' });

        const live = (await db.targets.toArray()).filter((row) => row.deleted_at === null);
        expect(live).toHaveLength(1);
        expect(live[0]).toMatchObject({ type: 'by_date', amount: 90000, due_month: '2026-12' });

        await repo.clearTarget('c1');
        expect((await db.targets.toArray()).filter((row) => row.deleted_at === null)).toHaveLength(0);
    });
});
