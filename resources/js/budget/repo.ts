import { nowMs, today } from './clock';
import type { BudgetDatabase } from './db';
import { newId } from './ids';
import type { Account, AccountType, Category, CategoryGroup, ClearedStatus, Payee, SyncTableName, Target, TargetType, Transaction } from './types';

export const STARTING_BALANCE_PAYEE = 'Starting balance';

export interface CreateAccountInput {
    name: string;
    currency: string;
    type: AccountType;
    on_budget: boolean;
    note?: string | null;
    startingBalanceMinor?: number;
    startingDate?: string;
}

export interface CreateTransactionInput {
    account_id: string;
    date: string;
    amountMinor: number;
    payee_id?: string | null;
    payeeName?: string | null;
    category_id?: string | null;
    memo?: string | null;
    cleared?: ClearedStatus;
}

export interface CreateTransferInput {
    from_account_id: string;
    to_account_id: string;
    date: string;
    /** Positive minor units leaving the source account (its currency). */
    outMinor: number;
    /** Positive minor units arriving at the destination (its currency). */
    inMinor: number;
    memo?: string | null;
    clearedFrom?: ClearedStatus;
    clearedTo?: ClearedStatus;
}

export interface SplitLine {
    category_id: string | null;
    /** Signed minor units, like a plain transaction amount. */
    amountMinor: number;
}

export interface CreateSplitInput {
    account_id: string;
    date: string;
    payee_id?: string | null;
    payeeName?: string | null;
    memo?: string | null;
    cleared?: ClearedStatus;
    lines: SplitLine[];
}

export const RECONCILIATION_PAYEE = 'Reconciliation adjustment';

/**
 * All local mutations. Every write stamps a fresh `updated_at` and enqueues
 * the row into the outbox inside the same Dexie transaction, so the sync
 * engine can never observe a mutation without its outbox entry.
 */
export function createRepo(db: BudgetDatabase) {
    async function enqueue(table: SyncTableName, rowIds: string[]): Promise<void> {
        const enqueuedAt = nowMs();

        for (const rowId of rowIds) {
            await db.outbox.where('[table+row_id]').equals([table, rowId]).delete();
            await db.outbox.add({ table, row_id: rowId, enqueued_at: enqueuedAt });
        }
    }

    async function put<T extends { id: string; updated_at: number }>(
        table: SyncTableName,
        rows: T[],
    ): Promise<void> {
        const stamped = rows.map((row) => ({ ...row, updated_at: nowMs() }));
        await db.table(table).bulkPut(stamped);
        await enqueue(table, stamped.map((row) => row.id));
    }

    /** Case-insensitive find-or-create among live payees. */
    async function resolvePayee(name: string): Promise<Payee> {
        const trimmed = name.trim();
        const existing = (await db.payees.toArray()).find(
            (payee) => payee.deleted_at === null && payee.name.toLowerCase() === trimmed.toLowerCase(),
        );

        if (existing) {
            return existing;
        }

        const payee: Payee = { id: newId(), name: trimmed, updated_at: nowMs(), deleted_at: null };
        await put('payees', [payee]);

        return payee;
    }

    return {
        async createAccount(input: CreateAccountInput): Promise<Account> {
            return db.transaction('rw', [db.accounts, db.transactions, db.payees, db.outbox], async () => {
                const count = await db.accounts.count();
                const account: Account = {
                    id: newId(),
                    name: input.name.trim(),
                    currency: input.currency.toUpperCase(),
                    type: input.type,
                    on_budget: input.on_budget,
                    note: input.note ?? null,
                    sort_order: count,
                    updated_at: nowMs(),
                    deleted_at: null,
                };
                await put('accounts', [account]);

                if (input.startingBalanceMinor) {
                    const payee = await resolvePayee(STARTING_BALANCE_PAYEE);
                    const transaction: Transaction = {
                        id: newId(),
                        account_id: account.id,
                        date: input.startingDate ?? today(),
                        amount: input.startingBalanceMinor,
                        payee_id: payee.id,
                        category_id: null,
                        memo: null,
                        cleared: 'cleared',
                        transfer_pair_id: null,
                        split_group_id: null,
                        updated_at: nowMs(),
                        deleted_at: null,
                    };
                    await put('transactions', [transaction]);
                }

                return account;
            });
        },

        async updateAccount(id: string, patch: Partial<Pick<Account, 'name' | 'type' | 'on_budget' | 'note' | 'sort_order'>>): Promise<void> {
            await db.transaction('rw', [db.accounts, db.outbox], async () => {
                const account = await db.accounts.get(id);

                if (!account) {
throw new Error(`Account ${id} not found`);
}

                await put('accounts', [{ ...account, ...patch }]);
            });
        },

        /** Closing an account tombstones it and every transaction in it (incl. transfer pair legs). */
        async closeAccount(id: string): Promise<void> {
            await db.transaction('rw', [db.accounts, db.transactions, db.outbox], async () => {
                const account = await db.accounts.get(id);

                if (!account) {
throw new Error(`Account ${id} not found`);
}

                const stamp = nowMs();
                const own = (await db.transactions.where('account_id').equals(id).toArray()).filter(
                    (transaction) => transaction.deleted_at === null,
                );
                const pairIds = own.map((t) => t.transfer_pair_id).filter((v): v is string => v !== null);
                const pairLegs = pairIds.length
                    ? (await db.transactions.where('transfer_pair_id').anyOf(pairIds).toArray()).filter(
                          (t) => t.account_id !== id && t.deleted_at === null,
                      )
                    : [];

                const dead = [...own, ...pairLegs].map((t) => ({ ...t, deleted_at: stamp }));
                await put('transactions', dead);
                await put('accounts', [{ ...account, deleted_at: stamp }]);
            });
        },

        resolvePayee(name: string): Promise<Payee> {
            return db.transaction('rw', [db.payees, db.outbox], () => resolvePayee(name));
        },

        async createTransaction(input: CreateTransactionInput): Promise<Transaction> {
            return db.transaction('rw', [db.transactions, db.payees, db.outbox], async () => {
                const payeeId = input.payee_id ?? (input.payeeName ? (await resolvePayee(input.payeeName)).id : null);
                const transaction: Transaction = {
                    id: newId(),
                    account_id: input.account_id,
                    date: input.date,
                    amount: input.amountMinor,
                    payee_id: payeeId,
                    category_id: input.category_id ?? null,
                    memo: input.memo ?? null,
                    cleared: input.cleared ?? 'uncleared',
                    transfer_pair_id: null,
                    split_group_id: null,
                    updated_at: nowMs(),
                    deleted_at: null,
                };
                await put('transactions', [transaction]);

                return transaction;
            });
        },

        /**
         * Update a transaction. On a transfer leg, `date` and `memo` propagate
         * to the pair; `amount` and `cleared` stay per-side; `account_id`,
         * `category_id` and `transfer_pair_id` of a transfer cannot change here.
         */
        async updateTransaction(
            id: string,
            patch: Partial<Pick<Transaction, 'date' | 'amount' | 'payee_id' | 'category_id' | 'memo' | 'cleared' | 'account_id'>>,
        ): Promise<void> {
            await db.transaction('rw', [db.transactions, db.outbox], async () => {
                const transaction = await db.transactions.get(id);

                if (!transaction) {
throw new Error(`Transaction ${id} not found`);
}

                if (transaction.transfer_pair_id === null) {
                    await put('transactions', [{ ...transaction, ...patch }]);

                    return;
                }

                const allowed: Partial<Transaction> = {};

                if (patch.date !== undefined) {
allowed.date = patch.date;
}

                if (patch.memo !== undefined) {
allowed.memo = patch.memo;
}

                if (patch.amount !== undefined) {
allowed.amount = patch.amount;
}

                if (patch.cleared !== undefined) {
allowed.cleared = patch.cleared;
}

                const updates: Transaction[] = [{ ...transaction, ...allowed }];

                if (allowed.date !== undefined || allowed.memo !== undefined) {
                    const pair = (await db.transactions.where('transfer_pair_id').equals(transaction.transfer_pair_id).toArray()).find(
                        (t) => t.id !== id,
                    );

                    if (pair) {
                        updates.push({
                            ...pair,
                            ...(allowed.date !== undefined ? { date: allowed.date } : {}),
                            ...(allowed.memo !== undefined ? { memo: allowed.memo } : {}),
                        });
                    }
                }

                await put('transactions', updates);
            });
        },

        /** Deleting one leg of a transfer (or one member of a split) tombstones the whole set. */
        async deleteTransaction(id: string): Promise<void> {
            await db.transaction('rw', [db.transactions, db.outbox], async () => {
                const transaction = await db.transactions.get(id);

                if (!transaction) {
                    throw new Error(`Transaction ${id} not found`);
                }

                const stamp = nowMs();
                let rows = [transaction];

                if (transaction.transfer_pair_id) {
                    rows = await db.transactions.where('transfer_pair_id').equals(transaction.transfer_pair_id).toArray();
                } else if (transaction.split_group_id) {
                    rows = await db.transactions.where('split_group_id').equals(transaction.split_group_id).toArray();
                }

                await put('transactions', rows.map((row) => ({ ...row, deleted_at: stamp })));
            });
        },

        /** One purchase split across categories: N rows sharing a split_group_id. */
        async createSplit(input: CreateSplitInput): Promise<Transaction[]> {
            if (input.lines.length < 2) {
                throw new Error('A split needs at least two lines');
            }

            if (input.lines.some((line) => line.amountMinor === 0)) {
                throw new Error('Split lines cannot be zero');
            }

            return db.transaction('rw', [db.transactions, db.payees, db.outbox], async () => {
                const payeeId = input.payee_id ?? (input.payeeName ? (await resolvePayee(input.payeeName)).id : null);
                const groupId = newId();

                const rows: Transaction[] = input.lines.map((line) => ({
                    id: newId(),
                    account_id: input.account_id,
                    date: input.date,
                    amount: line.amountMinor,
                    payee_id: payeeId,
                    category_id: line.category_id,
                    memo: input.memo ?? null,
                    cleared: input.cleared ?? 'uncleared',
                    transfer_pair_id: null,
                    split_group_id: groupId,
                    updated_at: nowMs(),
                    deleted_at: null,
                }));

                await put('transactions', rows);

                return rows;
            });
        },

        /** Apply shared-field changes (date, memo, payee, cleared) to every live member. */
        async updateSplitGroup(
            groupId: string,
            patch: Partial<Pick<Transaction, 'date' | 'memo' | 'payee_id' | 'cleared'>>,
        ): Promise<void> {
            await db.transaction('rw', [db.transactions, db.outbox], async () => {
                const members = (await db.transactions.where('split_group_id').equals(groupId).toArray()).filter(
                    (member) => member.deleted_at === null,
                );

                await put('transactions', members.map((member) => ({ ...member, ...patch })));
            });
        },

        /**
         * Rewrite a split's lines. Existing members are reused by position,
         * surplus members are tombstoned, extra lines become new rows. A
         * single remaining line converts back to a plain transaction.
         */
        async replaceSplitLines(groupId: string, lines: SplitLine[]): Promise<void> {
            if (lines.length === 0) {
                throw new Error('A split needs at least one line');
            }

            if (lines.some((line) => line.amountMinor === 0)) {
                throw new Error('Split lines cannot be zero');
            }

            await db.transaction('rw', [db.transactions, db.outbox], async () => {
                const members = (await db.transactions.where('split_group_id').equals(groupId).toArray())
                    .filter((member) => member.deleted_at === null)
                    .sort((a, b) => a.id.localeCompare(b.id));

                if (members.length === 0) {
                    throw new Error(`Split group ${groupId} not found`);
                }

                const template = members[0];
                const stamp = nowMs();
                const updates: Transaction[] = [];

                lines.forEach((line, index) => {
                    const reused = members[index];
                    const base = reused ?? {
                        ...template,
                        id: newId(),
                    };

                    updates.push({
                        ...base,
                        amount: line.amountMinor,
                        category_id: line.category_id,
                        split_group_id: lines.length === 1 ? null : groupId,
                    });
                });

                for (const surplus of members.slice(lines.length)) {
                    updates.push({ ...surplus, deleted_at: stamp });
                }

                await put('transactions', updates);
            });
        },

        /**
         * Finish reconciling an account: create an adjustment for any
         * remaining difference, then mark every cleared transaction
         * reconciled. Returns the adjustment transaction, if one was needed.
         */
        async finishReconciliation(accountId: string, actualClearedMinor: number): Promise<Transaction | null> {
            return db.transaction('rw', [db.transactions, db.payees, db.outbox], async () => {
                const rows = (await db.transactions.where('account_id').equals(accountId).toArray()).filter(
                    (transaction) => transaction.deleted_at === null,
                );

                const clearedBalance = rows
                    .filter((transaction) => transaction.cleared !== 'uncleared')
                    .reduce((sum, transaction) => sum + transaction.amount, 0);

                const difference = actualClearedMinor - clearedBalance;
                let adjustment: Transaction | null = null;

                if (difference !== 0) {
                    const payee = await resolvePayee(RECONCILIATION_PAYEE);
                    adjustment = {
                        id: newId(),
                        account_id: accountId,
                        date: today(),
                        amount: difference,
                        payee_id: payee.id,
                        category_id: null,
                        memo: null,
                        cleared: 'cleared',
                        transfer_pair_id: null,
                        split_group_id: null,
                        updated_at: nowMs(),
                        deleted_at: null,
                    };
                    await put('transactions', [adjustment]);
                }

                const toReconcile = [...rows.filter((transaction) => transaction.cleared === 'cleared'), ...(adjustment ? [adjustment] : [])];
                await put('transactions', toReconcile.map((transaction) => ({ ...transaction, cleared: 'reconciled' as const })));

                return adjustment;
            });
        },

        async createTransfer(input: CreateTransferInput): Promise<{ from: Transaction; to: Transaction }> {
            if (input.outMinor <= 0 || input.inMinor <= 0) {
                throw new Error('Transfer amounts must be positive');
            }

            return db.transaction('rw', [db.transactions, db.outbox], async () => {
                const pairId = newId();
                const base = {
                    date: input.date,
                    payee_id: null,
                    category_id: null,
                    memo: input.memo ?? null,
                    transfer_pair_id: pairId,
                    split_group_id: null,
                    updated_at: nowMs(),
                    deleted_at: null,
                };
                const from: Transaction = {
                    ...base,
                    id: newId(),
                    account_id: input.from_account_id,
                    amount: -input.outMinor,
                    cleared: input.clearedFrom ?? 'uncleared',
                };
                const to: Transaction = {
                    ...base,
                    id: newId(),
                    account_id: input.to_account_id,
                    amount: input.inMinor,
                    cleared: input.clearedTo ?? 'uncleared',
                };
                await put('transactions', [from, to]);

                return { from, to };
            });
        },

        async createCategoryGroup(name: string): Promise<CategoryGroup> {
            return db.transaction('rw', [db.category_groups, db.outbox], async () => {
                const group: CategoryGroup = {
                    id: newId(),
                    name: name.trim(),
                    sort_order: await db.category_groups.count(),
                    updated_at: nowMs(),
                    deleted_at: null,
                };
                await put('category_groups', [group]);

                return group;
            });
        },

        async createCategory(name: string, groupId: string | null = null): Promise<Category> {
            return db.transaction('rw', [db.categories, db.outbox], async () => {
                const category: Category = {
                    id: newId(),
                    category_group_id: groupId,
                    name: name.trim(),
                    sort_order: await db.categories.count(),
                    updated_at: nowMs(),
                    deleted_at: null,
                };
                await put('categories', [category]);

                return category;
            });
        },

        async updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'category_group_id' | 'sort_order'>>): Promise<void> {
            await db.transaction('rw', [db.categories, db.outbox], async () => {
                const category = await db.categories.get(id);

                if (!category) {
throw new Error(`Category ${id} not found`);
}

                await put('categories', [{ ...category, ...patch }]);
            });
        },

        async updateCategoryGroup(id: string, patch: Partial<Pick<CategoryGroup, 'name' | 'sort_order'>>): Promise<void> {
            await db.transaction('rw', [db.category_groups, db.outbox], async () => {
                const group = await db.category_groups.get(id);

                if (!group) {
throw new Error(`Category group ${id} not found`);
}

                await put('category_groups', [{ ...group, ...patch }]);
            });
        },

        async hideCategory(id: string): Promise<void> {
            await db.transaction('rw', [db.categories, db.outbox], async () => {
                const category = await db.categories.get(id);

                if (!category) {
throw new Error(`Category ${id} not found`);
}

                await put('categories', [{ ...category, deleted_at: nowMs() }]);
            });
        },

        async hideCategoryGroup(id: string): Promise<void> {
            await db.transaction('rw', [db.category_groups, db.categories, db.outbox], async () => {
                const group = await db.category_groups.get(id);

                if (!group) {
throw new Error(`Category group ${id} not found`);
}

                const stamp = nowMs();
                const members = (await db.categories.where('category_group_id').equals(id).toArray()).filter(
                    (category) => category.deleted_at === null,
                );
                await put('categories', members.map((category) => ({ ...category, deleted_at: stamp })));
                await put('category_groups', [{ ...group, deleted_at: stamp }]);
            });
        },

        /** Upsert the amount assigned to a category for a month; 0 tombstones the row. */
        async setAssignment(categoryId: string, month: string, amountMinor: number): Promise<void> {
            await db.transaction('rw', [db.assignments, db.outbox], async () => {
                const existing = (await db.assignments.where('[category_id+month]').equals([categoryId, month]).toArray()).find(
                    (assignment) => assignment.deleted_at === null,
                );

                if (existing) {
                    await put('assignments', [
                        { ...existing, amount: amountMinor, deleted_at: amountMinor === 0 ? nowMs() : null },
                    ]);
                } else if (amountMinor !== 0) {
                    await put('assignments', [
                        { id: newId(), category_id: categoryId, month, amount: amountMinor, updated_at: nowMs(), deleted_at: null },
                    ]);
                }
            });
        },

        /**
         * Move money between categories for a month; null on either side
         * means Ready to Assign (which is derived, so only the category
         * sides get assignment adjustments).
         */
        async moveMoney(input: {
            fromCategoryId: string | null;
            toCategoryId: string | null;
            month: string;
            amountMinor: number;
        }): Promise<void> {
            if (input.amountMinor <= 0) {
                throw new Error('Move amount must be positive');
            }

            const adjust = async (categoryId: string, delta: number) => {
                const existing = (await db.assignments.where('[category_id+month]').equals([categoryId, input.month]).toArray()).find(
                    (assignment) => assignment.deleted_at === null,
                );
                const next = (existing?.amount ?? 0) + delta;

                if (existing) {
                    await put('assignments', [{ ...existing, amount: next, deleted_at: next === 0 ? nowMs() : null }]);
                } else if (next !== 0) {
                    await put('assignments', [
                        { id: newId(), category_id: categoryId, month: input.month, amount: next, updated_at: nowMs(), deleted_at: null },
                    ]);
                }
            };

            await db.transaction('rw', [db.assignments, db.outbox], async () => {
                if (input.fromCategoryId) {
                    await adjust(input.fromCategoryId, -input.amountMinor);
                }

                if (input.toCategoryId) {
                    await adjust(input.toCategoryId, input.amountMinor);
                }
            });
        },

        /** Create or replace the category's target (one live target per category). */
        async setTarget(categoryId: string, input: { type: TargetType; amountMinor: number; dueMonth?: string | null }): Promise<void> {
            await db.transaction('rw', [db.targets, db.outbox], async () => {
                const existing = (await db.targets.where('category_id').equals(categoryId).toArray()).find(
                    (target) => target.deleted_at === null,
                );

                const row: Target = {
                    id: existing?.id ?? newId(),
                    category_id: categoryId,
                    type: input.type,
                    amount: input.amountMinor,
                    due_month: input.type === 'by_date' ? (input.dueMonth ?? null) : null,
                    updated_at: nowMs(),
                    deleted_at: null,
                };

                await put('targets', [row]);
            });
        },

        async clearTarget(categoryId: string): Promise<void> {
            await db.transaction('rw', [db.targets, db.outbox], async () => {
                const existing = (await db.targets.where('category_id').equals(categoryId).toArray()).filter(
                    (target) => target.deleted_at === null,
                );

                await put('targets', existing.map((target) => ({ ...target, deleted_at: nowMs() })));
            });
        },

        async renamePayee(id: string, name: string): Promise<void> {
            await db.transaction('rw', [db.payees, db.outbox], async () => {
                const payee = await db.payees.get(id);

                if (!payee) {
throw new Error(`Payee ${id} not found`);
}

                await put('payees', [{ ...payee, name: name.trim() }]);
            });
        },

        /** Repoint every transaction from one payee to another, then tombstone the source. */
        async mergePayees(fromId: string, toId: string): Promise<void> {
            await db.transaction('rw', [db.payees, db.transactions, db.outbox], async () => {
                const from = await db.payees.get(fromId);
                const to = await db.payees.get(toId);

                if (!from || !to) {
throw new Error('Payee not found');
}

                const transactions = await db.transactions.where('payee_id').equals(fromId).toArray();
                await put('transactions', transactions.map((t) => ({ ...t, payee_id: toId })));
                await put('payees', [{ ...from, deleted_at: nowMs() }]);
            });
        },
    };
}

export type Repo = ReturnType<typeof createRepo>;
