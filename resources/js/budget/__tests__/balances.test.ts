import { describe, expect, it } from 'vitest';

import { accountBalances, totalInBase } from '@/budget/balances';
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
