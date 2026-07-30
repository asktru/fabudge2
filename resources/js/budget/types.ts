export type AccountType = 'chequing' | 'savings' | 'cash' | 'credit_card';
export type ClearedStatus = 'uncleared' | 'cleared' | 'reconciled';

/** Fields shared by every synced entity. Timestamps are unix milliseconds. */
export interface Syncable {
    id: string;
    updated_at: number;
    deleted_at: number | null;
}

export interface Account extends Syncable {
    name: string;
    currency: string;
    type: AccountType;
    on_budget: boolean;
    note: string | null;
    sort_order: number;
}

export interface CategoryGroup extends Syncable {
    name: string;
    sort_order: number;
}

export interface Category extends Syncable {
    category_group_id: string | null;
    name: string;
    sort_order: number;
}

export interface Payee extends Syncable {
    name: string;
}

export interface Transaction extends Syncable {
    account_id: string;
    /** YYYY-MM-DD */
    date: string;
    /** Signed minor units in the account's currency; negative = outflow. */
    amount: number;
    payee_id: string | null;
    category_id: string | null;
    memo: string | null;
    cleared: ClearedStatus;
    transfer_pair_id: string | null;
    /** Members of one real-world purchase split across categories share this id. */
    split_group_id: string | null;
}

export interface Assignment extends Syncable {
    category_id: string;
    /** YYYY-MM */
    month: string;
    /** Minor units in the budget's main currency (CAD). */
    amount: number;
}

export type TargetType = 'monthly' | 'by_date' | 'refill';

export interface Target extends Syncable {
    category_id: string;
    type: TargetType;
    /** Minor units in the budget's main currency (CAD). */
    amount: number;
    /** YYYY-MM, only for by_date targets. */
    due_month: string | null;
}

export type SyncTableName = 'accounts' | 'category_groups' | 'categories' | 'payees' | 'transactions' | 'assignments' | 'targets';

export type SyncableRow = Account | CategoryGroup | Category | Payee | Transaction | Assignment | Target;

export interface OutboxEntry {
    seq?: number;
    table: SyncTableName;
    row_id: string;
    enqueued_at: number;
}

export interface RateRow {
    quote: string;
    rate: number;
    fetched_at: number | null;
}

// ——— Wire formats (must match SyncController exactly) ———

export interface PushChange {
    table: SyncTableName;
    row: SyncableRow;
}

export interface PushResponse {
    results: {
        id: string | null;
        table: string;
        status: 'accepted' | 'stale' | 'rejected';
        reason: string | null;
    }[];
    server_seq: number;
}

export interface PullResponse {
    changes: { table: SyncTableName; row: SyncableRow }[];
    cursor: number;
    has_more: boolean;
    rates: {
        base: string;
        fetched_at: number | null;
        quotes: Record<string, number>;
    };
}
