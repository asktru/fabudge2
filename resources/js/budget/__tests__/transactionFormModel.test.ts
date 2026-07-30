import { describe, expect, it } from 'vitest';

import { buildSubmission, emptyFormState, needsOtherSideAmount  } from '@/budget/transactionFormModel';
import type {TransactionFormState} from '@/budget/transactionFormModel';
import type { Account } from '@/budget/types';

function account(id: string, currency: string): Account {
    return { id, name: id, currency, type: 'chequing', on_budget: true, note: null, sort_order: 0, updated_at: 1, deleted_at: null };
}

const accounts = [account('cad', 'CAD'), account('cad2', 'CAD'), account('usd', 'USD')];

function state(overrides: Partial<TransactionFormState>): TransactionFormState {
    return { ...emptyFormState('cad', '2026-07-29'), ...overrides };
}

describe('buildSubmission — plain transactions', () => {
    it('builds an expense from an outflow', () => {
        const result = buildSubmission(state({ payee: { kind: 'payee', id: null, name: 'Metro' }, outflowMinor: 1250, categoryId: 'c1' }), accounts);

        expect(result).toMatchObject({
            kind: 'transaction',
            input: { account_id: 'cad', amountMinor: -1250, payeeName: 'Metro', category_id: 'c1', cleared: 'uncleared' },
        });
    });

    it('builds an income from an inflow with an existing payee', () => {
        const result = buildSubmission(state({ payee: { kind: 'payee', id: 'p1', name: 'Employer' }, inflowMinor: 500000, cleared: true }), accounts);

        expect(result).toMatchObject({ kind: 'transaction', input: { amountMinor: 500000, payee_id: 'p1', payeeName: null, cleared: 'cleared' } });
    });

    it('requires an amount and an account', () => {
        expect(buildSubmission(state({}), accounts)).toHaveProperty('error');
        expect(buildSubmission(state({ accountId: null, outflowMinor: 1 }), accounts)).toHaveProperty('error');
    });
});

describe('buildSubmission — transfers', () => {
    it('same-currency outflow transfer mirrors the amount', () => {
        const result = buildSubmission(state({ payee: { kind: 'transfer', accountId: 'cad2' }, outflowMinor: 5000 }), accounts);

        expect(result).toMatchObject({
            kind: 'transfer',
            input: { from_account_id: 'cad', to_account_id: 'cad2', outMinor: 5000, inMinor: 5000 },
        });
    });

    it('inflow transfer reverses direction', () => {
        const result = buildSubmission(state({ payee: { kind: 'transfer', accountId: 'cad2' }, inflowMinor: 5000, cleared: true }), accounts);

        expect(result).toMatchObject({
            kind: 'transfer',
            input: { from_account_id: 'cad2', to_account_id: 'cad', outMinor: 5000, inMinor: 5000, clearedTo: 'cleared' },
        });
    });

    it('cross-currency transfer requires both amounts and keeps them', () => {
        const missing = buildSubmission(state({ payee: { kind: 'transfer', accountId: 'usd' }, outflowMinor: 13650 }), accounts);
        expect(missing).toHaveProperty('error');

        const result = buildSubmission(
            state({ payee: { kind: 'transfer', accountId: 'usd' }, outflowMinor: 13650, otherSideMinor: 10000 }),
            accounts,
        );

        expect(result).toMatchObject({
            kind: 'transfer',
            input: { from_account_id: 'cad', to_account_id: 'usd', outMinor: 13650, inMinor: 10000 },
        });
    });

    it('cross-currency inflow transfer maps the other side to the source account', () => {
        const result = buildSubmission(
            state({ payee: { kind: 'transfer', accountId: 'usd' }, inflowMinor: 13650, otherSideMinor: 10000 }),
            accounts,
        );

        expect(result).toMatchObject({
            kind: 'transfer',
            input: { from_account_id: 'usd', to_account_id: 'cad', outMinor: 10000, inMinor: 13650 },
        });
    });

    it('rejects a transfer into the same account', () => {
        expect(buildSubmission(state({ payee: { kind: 'transfer', accountId: 'cad' }, outflowMinor: 100 }), accounts)).toHaveProperty('error');
    });
});

describe('needsOtherSideAmount', () => {
    it('is true only for cross-currency transfers', () => {
        expect(needsOtherSideAmount(state({ payee: { kind: 'transfer', accountId: 'usd' } }), accounts)).toBe(true);
        expect(needsOtherSideAmount(state({ payee: { kind: 'transfer', accountId: 'cad2' } }), accounts)).toBe(false);
        expect(needsOtherSideAmount(state({ payee: { kind: 'payee', id: null, name: 'x' } }), accounts)).toBe(false);
    });
});
