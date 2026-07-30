import { describe, expect, it } from 'vitest';
import {
    formatRegisterDate,
    groupRegisterRows,
    groupRowsByDate,
} from '@/budget/registerRows';
import type { Transaction } from '@/budget/types';

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

describe('groupRowsByDate', () => {
    it('buckets rows under their date, preserving row order', () => {
        const rows = groupRegisterRows([
            base({ id: 't1', date: '2026-07-30' }),
            base({ id: 't2', date: '2026-07-30' }),
            base({ id: 't3', date: '2026-07-28' }),
        ]);

        const groups = groupRowsByDate(rows);

        expect(groups).toHaveLength(2);
        expect(groups[0].date).toBe('2026-07-30');
        expect(
            groups[0].rows.map((row) =>
                row.kind === 'single' ? row.transaction.id : row.groupId,
            ),
        ).toEqual(['t1', 't2']);
        expect(groups[1].date).toBe('2026-07-28');
        expect(groups[1].rows).toHaveLength(1);
    });

    it('uses the split head date for split rows', () => {
        const rows = groupRegisterRows([
            base({ id: 's1', split_group_id: 'g1', date: '2026-07-29' }),
            base({ id: 's2', split_group_id: 'g1', date: '2026-07-29' }),
        ]);

        const groups = groupRowsByDate(rows);

        expect(groups).toHaveLength(1);
        expect(groups[0].date).toBe('2026-07-29');
        expect(groups[0].rows[0]).toMatchObject({
            kind: 'split',
            groupId: 'g1',
        });
    });

    it('returns no groups for no rows', () => {
        expect(groupRowsByDate([])).toEqual([]);
    });
});

describe('formatRegisterDate', () => {
    it('formats an ISO date without timezone drift', () => {
        expect(formatRegisterDate('2026-07-30', 'en-US')).toBe(
            'Thu, Jul 30, 2026',
        );
        expect(formatRegisterDate('2026-01-01', 'en-US')).toBe(
            'Thu, Jan 1, 2026',
        );
    });
});
