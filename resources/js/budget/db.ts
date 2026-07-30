import Dexie from 'dexie';
import type {EntityTable} from 'dexie';

import type { Account, Assignment, Category, CategoryGroup, OutboxEntry, Payee, RateRow, Target, Transaction } from './types';

export interface SyncMetaEntry {
    key: string;
    value: unknown;
}

export class BudgetDatabase extends Dexie {
    accounts!: EntityTable<Account, 'id'>;
    category_groups!: EntityTable<CategoryGroup, 'id'>;
    categories!: EntityTable<Category, 'id'>;
    payees!: EntityTable<Payee, 'id'>;
    transactions!: EntityTable<Transaction, 'id'>;
    outbox!: EntityTable<OutboxEntry, 'seq'>;
    sync_meta!: EntityTable<SyncMetaEntry, 'key'>;
    rates!: EntityTable<RateRow, 'quote'>;
    assignments!: EntityTable<Assignment, 'id'>;
    targets!: EntityTable<Target, 'id'>;

    constructor(name: string) {
        super(name);

        this.version(1).stores({
            accounts: 'id, sort_order',
            category_groups: 'id, sort_order',
            categories: 'id, category_group_id, sort_order',
            payees: 'id, name',
            transactions: 'id, account_id, date, payee_id, category_id, transfer_pair_id',
            outbox: '++seq, [table+row_id]',
            sync_meta: 'key',
            rates: 'quote',
        });

        this.version(2)
            .stores({
                transactions: 'id, account_id, date, payee_id, category_id, transfer_pair_id, split_group_id',
            })
            .upgrade((transaction) =>
                transaction
                    .table('transactions')
                    .toCollection()
                    .modify((row) => {
                        row.split_group_id ??= null;
                    }),
            );

        this.version(3).stores({
            assignments: 'id, category_id, month, [category_id+month]',
            targets: 'id, category_id',
        });
    }
}

/** One local database per budget (keyed by team slug) so switching teams never mixes data. */
export function openBudgetDatabase(teamSlug: string): BudgetDatabase {
    return new BudgetDatabase(`fabudge-${teamSlug}`);
}
