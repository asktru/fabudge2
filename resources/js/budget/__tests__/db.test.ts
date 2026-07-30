import { describe, expect, it } from 'vitest';

import { openBudgetDatabase } from '@/budget/db';
import { newId } from '@/budget/ids';

describe('BudgetDatabase', () => {
    it('opens and round-trips an account row', async () => {
        const db = openBudgetDatabase(`test-${Math.random()}`);
        const id = newId();

        await db.accounts.add({
            id,
            name: 'Chequing',
            currency: 'CAD',
            type: 'chequing',
            on_budget: true,
            note: null,
            sort_order: 0,
            updated_at: 1000,
            deleted_at: null,
        });

        const stored = await db.accounts.get(id);
        expect(stored?.name).toBe('Chequing');

        db.close();
    });

    it('keeps separate databases per team slug', async () => {
        const dbA = openBudgetDatabase(`team-a-${Math.random()}`);
        const dbB = openBudgetDatabase(`team-b-${Math.random()}`);

        await dbA.payees.add({ id: newId(), name: 'Metro', updated_at: 1, deleted_at: null });

        expect(await dbA.payees.count()).toBe(1);
        expect(await dbB.payees.count()).toBe(0);

        dbA.close();
        dbB.close();
    });
});
