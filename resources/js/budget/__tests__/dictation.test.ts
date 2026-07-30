import { describe, expect, it, vi } from 'vitest';

import { localParseDictation, parseDictation  } from '@/budget/dictation';
import type {DictationContext} from '@/budget/dictation';

const context: DictationContext = {
    accounts: ['RBC Chequing', 'Cash'],
    categories: ['Groceries', 'Coffee'],
    payees: ['Tim Hortons', 'Metro'],
    today: '2026-07-30',
};

describe('localParseDictation', () => {
    it('extracts amount, payee, and category', () => {
        const parsed = localParseDictation('12.50 at Tim Hortons for coffee', context);

        expect(parsed).toMatchObject({ type: 'expense', amountMinor: 1250, payee: 'Tim Hortons', category: 'Coffee' });
    });

    it('handles decimal commas and detects income', () => {
        const parsed = localParseDictation('received salary 2500,00 to RBC Chequing', context);

        expect(parsed).toMatchObject({ type: 'income', amountMinor: 250000, account: 'RBC Chequing' });
    });

    it('resolves yesterday against today', () => {
        expect(localParseDictation('spent 5 at Metro yesterday', context)?.date).toBe('2026-07-29');
    });

    it('returns null without an amount', () => {
        expect(localParseDictation('bought some stuff at Metro', context)).toBeNull();
    });
});

describe('parseDictation', () => {
    it('prefers the server result', async () => {
        const fetchFn = vi.fn(async () =>
            new Response(
                JSON.stringify({ type: 'expense', amountMinor: 999, payee: 'Metro', account: null, category: null, date: null, memo: null }),
                { status: 200 },
            ),
        ) as unknown as typeof fetch;

        const parsed = await parseDictation('whatever 9.99 metro', context, '/t/dictation/parse', fetchFn);

        expect(parsed?.amountMinor).toBe(999);
    });

    it('falls back to the local parser on 503 and network errors', async () => {
        const unavailable = vi.fn(async () => new Response('{"error":"not_configured"}', { status: 503 })) as unknown as typeof fetch;
        expect((await parseDictation('7.25 at Metro', context, '/t/dictation/parse', unavailable))?.amountMinor).toBe(725);

        const offline = vi.fn(async () => {
            throw new TypeError('network');
        }) as unknown as typeof fetch;
        expect((await parseDictation('7.25 at Metro', context, '/t/dictation/parse', offline))?.amountMinor).toBe(725);
    });
});
