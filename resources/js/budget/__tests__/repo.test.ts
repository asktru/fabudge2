import { beforeEach, describe, expect, it } from 'vitest';

import { openBudgetDatabase  } from '@/budget/db';
import type {BudgetDatabase} from '@/budget/db';
import { createRepo, STARTING_BALANCE_PAYEE  } from '@/budget/repo';
import type {Repo} from '@/budget/repo';

let db: BudgetDatabase;
let repo: Repo;

beforeEach(() => {
    db = openBudgetDatabase(`repo-test-${Math.random()}`);
    repo = createRepo(db);
});

async function outboxKeys(): Promise<string[]> {
    return (await db.outbox.toArray()).map((entry) => `${entry.table}:${entry.row_id}`);
}

describe('createAccount', () => {
    it('creates the account and enqueues it', async () => {
        const account = await repo.createAccount({ name: 'Chequing', currency: 'cad', type: 'chequing', on_budget: true });

        expect(account.currency).toBe('CAD');
        expect(await db.accounts.count()).toBe(1);
        expect(await outboxKeys()).toContain(`accounts:${account.id}`);
    });

    it('records a starting balance as a cleared transaction with the reserved payee', async () => {
        const account = await repo.createAccount({
            name: 'Cash',
            currency: 'CAD',
            type: 'cash',
            on_budget: true,
            startingBalanceMinor: 10000,
            startingDate: '2026-07-01',
        });

        const transactions = await db.transactions.toArray();
        const payees = await db.payees.toArray();

        expect(transactions).toHaveLength(1);
        expect(transactions[0]).toMatchObject({ account_id: account.id, amount: 10000, cleared: 'cleared', category_id: null });
        expect(payees[0].name).toBe(STARTING_BALANCE_PAYEE);
        expect(await outboxKeys()).toEqual(
            expect.arrayContaining([`accounts:${account.id}`, `payees:${payees[0].id}`, `transactions:${transactions[0].id}`]),
        );
    });
});

describe('payees', () => {
    it('resolvePayee is case-insensitive and reuses live payees', async () => {
        const first = await repo.resolvePayee('Metro');
        const second = await repo.resolvePayee('  metro ');

        expect(second.id).toBe(first.id);
        expect(await db.payees.count()).toBe(1);
    });

    it('mergePayees repoints transactions and tombstones the source', async () => {
        const account = await repo.createAccount({ name: 'A', currency: 'CAD', type: 'cash', on_budget: true });
        const metro = await repo.resolvePayee('Metro');
        const metroInc = await repo.resolvePayee('Metro Inc');
        await repo.createTransaction({ account_id: account.id, date: '2026-07-01', amountMinor: -500, payee_id: metroInc.id });

        await repo.mergePayees(metroInc.id, metro.id);

        const transactions = await db.transactions.toArray();
        expect(transactions[0].payee_id).toBe(metro.id);
        expect((await db.payees.get(metroInc.id))?.deleted_at).not.toBeNull();
    });
});

describe('transactions', () => {
    it('createTransaction resolves payee by name', async () => {
        const account = await repo.createAccount({ name: 'A', currency: 'CAD', type: 'cash', on_budget: true });

        const transaction = await repo.createTransaction({
            account_id: account.id,
            date: '2026-07-02',
            amountMinor: -1250,
            payeeName: 'Tim Hortons',
            cleared: 'cleared',
        });

        const payees = await db.payees.toArray();
        expect(payees.map((p) => p.name)).toContain('Tim Hortons');
        expect(transaction.payee_id).toBe(payees.find((p) => p.name === 'Tim Hortons')?.id);
    });

    it('deleteTransaction tombstones instead of removing', async () => {
        const account = await repo.createAccount({ name: 'A', currency: 'CAD', type: 'cash', on_budget: true });
        const transaction = await repo.createTransaction({ account_id: account.id, date: '2026-07-02', amountMinor: -100 });

        await repo.deleteTransaction(transaction.id);

        const stored = await db.transactions.get(transaction.id);
        expect(stored?.deleted_at).not.toBeNull();
    });
});

describe('transfers', () => {
    async function twoAccounts() {
        const from = await repo.createAccount({ name: 'USD', currency: 'USD', type: 'chequing', on_budget: true });
        const to = await repo.createAccount({ name: 'CAD', currency: 'CAD', type: 'chequing', on_budget: true });

        return { from, to };
    }

    it('creates two linked legs with entered amounts preserved', async () => {
        const { from, to } = await twoAccounts();

        const transfer = await repo.createTransfer({
            from_account_id: from.id,
            to_account_id: to.id,
            date: '2026-07-03',
            outMinor: 10000,
            inMinor: 13650,
            clearedFrom: 'cleared',
        });

        expect(transfer.from.amount).toBe(-10000);
        expect(transfer.to.amount).toBe(13650);
        expect(transfer.from.transfer_pair_id).toBe(transfer.to.transfer_pair_id);
        expect(transfer.from.cleared).toBe('cleared');
        expect(transfer.to.cleared).toBe('uncleared');
        expect(transfer.from.category_id).toBeNull();
    });

    it('propagates date and memo to the pair, but not amount or cleared', async () => {
        const { from, to } = await twoAccounts();
        const transfer = await repo.createTransfer({
            from_account_id: from.id,
            to_account_id: to.id,
            date: '2026-07-03',
            outMinor: 100,
            inMinor: 100,
        });

        await repo.updateTransaction(transfer.from.id, { date: '2026-07-04', memo: 'moved', amount: -200, cleared: 'cleared' });

        const pair = await db.transactions.get(transfer.to.id);
        const source = await db.transactions.get(transfer.from.id);

        expect(source).toMatchObject({ date: '2026-07-04', memo: 'moved', amount: -200, cleared: 'cleared' });
        expect(pair).toMatchObject({ date: '2026-07-04', memo: 'moved', amount: 100, cleared: 'uncleared' });
    });

    it('deleting one leg tombstones both', async () => {
        const { from, to } = await twoAccounts();
        const transfer = await repo.createTransfer({
            from_account_id: from.id,
            to_account_id: to.id,
            date: '2026-07-03',
            outMinor: 100,
            inMinor: 100,
        });

        await repo.deleteTransaction(transfer.to.id);

        expect((await db.transactions.get(transfer.from.id))?.deleted_at).not.toBeNull();
        expect((await db.transactions.get(transfer.to.id))?.deleted_at).not.toBeNull();
    });

    it('rejects non-positive amounts', async () => {
        const { from, to } = await twoAccounts();

        await expect(
            repo.createTransfer({ from_account_id: from.id, to_account_id: to.id, date: '2026-07-03', outMinor: 0, inMinor: 100 }),
        ).rejects.toThrow();
    });
});

describe('closeAccount', () => {
    it('tombstones the account, its transactions, and pair legs in other accounts', async () => {
        const a = await repo.createAccount({ name: 'A', currency: 'CAD', type: 'cash', on_budget: true });
        const b = await repo.createAccount({ name: 'B', currency: 'CAD', type: 'cash', on_budget: true });
        await repo.createTransaction({ account_id: a.id, date: '2026-07-01', amountMinor: -100 });
        const transfer = await repo.createTransfer({
            from_account_id: a.id,
            to_account_id: b.id,
            date: '2026-07-02',
            outMinor: 50,
            inMinor: 50,
        });

        await repo.closeAccount(a.id);

        expect((await db.accounts.get(a.id))?.deleted_at).not.toBeNull();
        const live = (await db.transactions.toArray()).filter((t) => t.deleted_at === null);
        expect(live).toHaveLength(0);
        expect((await db.transactions.get(transfer.to.id))?.deleted_at).not.toBeNull();
    });
});

describe('categories', () => {
    it('creates groups and categories and hides a group with its members', async () => {
        const group = await repo.createCategoryGroup('Everyday');
        const groceries = await repo.createCategory('Groceries', group.id);
        const other = await repo.createCategory('Solo', null);

        await repo.hideCategoryGroup(group.id);

        expect((await db.category_groups.get(group.id))?.deleted_at).not.toBeNull();
        expect((await db.categories.get(groceries.id))?.deleted_at).not.toBeNull();
        expect((await db.categories.get(other.id))?.deleted_at).toBeNull();
    });
});
