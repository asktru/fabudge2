import { describe, expect, it } from 'vitest';

import { incomeVsSpending, monthRange, netWorthSeries, spendingByMonth } from '@/budget/analytics';
import type { Account, RateRow, Transaction } from '@/budget/types';

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

const rates: RateRow[] = [{ quote: 'USD', rate: 0.5, fetched_at: 1 }];

describe('monthRange', () => {
    it('produces ascending months ending at the given month', () => {
        expect(monthRange('2026-07', 3)).toEqual(['2026-05', '2026-06', '2026-07']);
    });
});

describe('spendingByMonth', () => {
    it('buckets converted outflows by month and category', () => {
        const result = spendingByMonth(['2026-06', '2026-07'], {
            accounts: [account({}), account({ id: 'usd', currency: 'USD' })],
            transactions: [
                transaction({ date: '2026-06-05', amount: -2000, category_id: 'c1' }),
                transaction({ date: '2026-07-05', amount: -3000, category_id: 'c1' }),
                transaction({ date: '2026-07-06', amount: -1000 }), // uncategorized
                transaction({ date: '2026-07-07', account_id: 'usd', amount: -500, category_id: 'c2' }), // ×2 CAD
                transaction({ date: '2026-07-08', amount: 99999 }), // income, not spending
            ],
            rates,
        });

        expect(result[0]).toMatchObject({ month: '2026-06', totalMinor: 2000 });
        expect(result[1].totalMinor).toBe(5000);
        expect(result[1].byCategory).toEqual({ c1: 3000, '': 1000, c2: 1000 });
    });

    it('excludes internal on-budget transfers but keeps transfers to off-budget accounts', () => {
        const result = spendingByMonth(['2026-07'], {
            accounts: [account({ id: 'a1' }), account({ id: 'a2' }), account({ id: 'inv', on_budget: false })],
            transactions: [
                transaction({ amount: -5000, transfer_pair_id: 'internal' }),
                transaction({ account_id: 'a2', amount: 5000, transfer_pair_id: 'internal' }),
                transaction({ amount: -7000, transfer_pair_id: 'to-invest' }),
                transaction({ account_id: 'inv', amount: 7000, transfer_pair_id: 'to-invest' }),
            ],
            rates: [],
        });

        expect(result[0].totalMinor).toBe(7000);
    });
});

describe('incomeVsSpending', () => {
    it('separates income and spending per month', () => {
        const result = incomeVsSpending(['2026-07'], {
            accounts: [account({})],
            transactions: [
                transaction({ amount: 500000 }),
                transaction({ amount: -120000, category_id: 'c1' }),
                transaction({ amount: -30000 }),
            ],
            rates: [],
        });

        expect(result[0]).toEqual({ month: '2026-07', incomeMinor: 500000, spendingMinor: 150000 });
    });
});

describe('netWorthSeries', () => {
    it('accumulates across all accounts including off-budget and prior history', () => {
        const result = netWorthSeries(['2026-06', '2026-07'], {
            accounts: [account({}), account({ id: 'inv', on_budget: false })],
            transactions: [
                transaction({ date: '2025-01-01', amount: 100000 }), // before range
                transaction({ date: '2026-06-10', amount: -20000 }),
                transaction({ date: '2026-07-10', account_id: 'inv', amount: 50000 }),
            ],
            rates: [],
        });

        expect(result).toEqual([
            { month: '2026-06', netWorthMinor: 80000 },
            { month: '2026-07', netWorthMinor: 130000 },
        ]);
    });

    it('ignores tombstoned transactions and deleted accounts', () => {
        const result = netWorthSeries(['2026-07'], {
            accounts: [account({}), account({ id: 'dead', deleted_at: 5 })],
            transactions: [
                transaction({ amount: 10000 }),
                transaction({ amount: 5000, deleted_at: 5 }),
                transaction({ account_id: 'dead', amount: 99999 }),
            ],
            rates: [],
        });

        expect(result[0].netWorthMinor).toBe(10000);
    });
});
