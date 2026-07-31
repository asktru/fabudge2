import { describe, expect, it } from 'vitest';

import { accountBalances, accountGroups, totalInBase } from '@/budget/balances';
import type { Account, RateRow, Transaction } from '@/budget/types';

function transaction(overrides: Partial<Transaction>): Transaction {
    return {
        id: Math.random().toString(),
        account_id: 'a1',
        date: '2026-07-01',
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

describe('accountBalances', () => {
    it('sums working and cleared balances per account, skipping tombstones', function () {
        const balances = accountBalances([
            transaction({ amount: 10000, cleared: 'cleared' }),
            transaction({ amount: -2500, cleared: 'uncleared' }),
            transaction({ amount: -1000, cleared: 'reconciled' }),
            transaction({ amount: -9999, deleted_at: 5 }),
            transaction({ account_id: 'a2', amount: 700 }),
        ]);

        expect(balances['a1']).toEqual({ workingMinor: 6500, clearedMinor: 9000 });
        expect(balances['a2']).toEqual({ workingMinor: 700, clearedMinor: 0 });
    });
});

describe('totalInBase', () => {
    const rates: RateRow[] = [{ quote: 'USD', rate: 0.73, fetched_at: 1 }];

    it('converts foreign balances and reports missing rates', () => {
        const accounts = [
            account({ id: 'a1', currency: 'CAD' }),
            account({ id: 'a2', currency: 'USD' }),
            account({ id: 'a3', currency: 'UAH' }),
        ];
        const balances = {
            a1: { workingMinor: 10000, clearedMinor: 0 },
            a2: { workingMinor: 7300, clearedMinor: 0 },
            a3: { workingMinor: 500, clearedMinor: 0 },
        };

        const total = totalInBase(balances, accounts, rates);

        expect(total.totalMinor).toBe(20000);
        expect(total.missingRates).toEqual(['UAH']);
    });

    it('ignores tombstoned accounts', () => {
        const total = totalInBase(
            { a1: { workingMinor: 10000, clearedMinor: 0 } },
            [account({ id: 'a1', deleted_at: 5 })],
            rates,
        );

        expect(total.totalMinor).toBe(0);
    });
});

describe('accountGroups', () => {
    const rates: RateRow[] = [{ quote: 'USD', rate: 0.73, fetched_at: 1 }];

    it('splits live accounts into budget and tracking, in sort order, with balances', () => {
        const groups = accountGroups(
            [
                account({ id: 'a2', name: 'Savings', sort_order: 2 }),
                account({ id: 'a1', name: 'Chequing', sort_order: 1 }),
                account({ id: 'a3', name: 'Brokerage', on_budget: false, sort_order: 3 }),
                account({ id: 'a4', name: 'Closed', sort_order: 4, deleted_at: 9 }),
            ],
            [
                transaction({ account_id: 'a1', amount: 10000, cleared: 'cleared' }),
                transaction({ account_id: 'a1', amount: -2500 }),
                transaction({ account_id: 'a3', amount: 500 }),
            ],
            rates,
        );

        expect(groups.map((group) => group.id)).toEqual(['budget', 'tracking']);
        expect(groups[0].accounts.map((summary) => summary.account.id)).toEqual(['a1', 'a2']);
        expect(groups[0].accounts[0]).toMatchObject({ workingMinor: 7500, clearedMinor: 10000 });
        expect(groups[0].accounts[1]).toMatchObject({ workingMinor: 0, clearedMinor: 0 });
        expect(groups[1].accounts.map((summary) => summary.account.id)).toEqual(['a3']);
    });

    it('totals each group separately in the base currency', () => {
        const groups = accountGroups(
            [
                account({ id: 'a1', currency: 'USD' }),
                account({ id: 'a2', on_budget: false, sort_order: 1 }),
            ],
            [transaction({ account_id: 'a1', amount: 7300 }), transaction({ account_id: 'a2', amount: 400 })],
            rates,
        );

        expect(groups[0].total.totalMinor).toBe(10000);
        expect(groups[1].total.totalMinor).toBe(400);
    });

    it('omits groups with no accounts', () => {
        const groups = accountGroups([account({ id: 'a1' })], [], rates);

        expect(groups.map((group) => group.id)).toEqual(['budget']);
    });
});
