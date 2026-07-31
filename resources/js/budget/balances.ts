import { convertToBase } from './money';
import type { Account, RateRow, Transaction } from './types';

export interface AccountBalance {
    workingMinor: number;
    clearedMinor: number;
}

/** Derive per-account balances from live (non-tombstoned) transactions. */
export function accountBalances(transactions: Transaction[]): Record<string, AccountBalance> {
    const balances: Record<string, AccountBalance> = {};

    for (const transaction of transactions) {
        if (transaction.deleted_at !== null) {
            continue;
        }

        const balance = (balances[transaction.account_id] ??= { workingMinor: 0, clearedMinor: 0 });
        balance.workingMinor += transaction.amount;

        if (transaction.cleared !== 'uncleared') {
            balance.clearedMinor += transaction.amount;
        }
    }

    return balances;
}

export interface TotalInBase {
    totalMinor: number;
    /** Currencies for which no exchange rate is cached (their balances are excluded). */
    missingRates: string[];
}

/** Sum working balances of live accounts, converted to the base currency. */
export function totalInBase(
    balances: Record<string, AccountBalance>,
    accounts: Account[],
    rates: RateRow[],
    base = 'CAD',
): TotalInBase {
    let totalMinor = 0;
    const missingRates = new Set<string>();

    for (const account of accounts) {
        if (account.deleted_at !== null) {
            continue;
        }

        const balance = balances[account.id];

        if (!balance || balance.workingMinor === 0) {
            continue;
        }

        const converted = convertToBase(balance.workingMinor, account.currency, rates, base);

        if (converted === null) {
            missingRates.add(account.currency);
        } else {
            totalMinor += converted;
        }
    }

    return { totalMinor, missingRates: [...missingRates] };
}

export interface AccountSummary {
    account: Account;
    workingMinor: number;
    clearedMinor: number;
}

export interface AccountGroup {
    /** 'budget' holds on-budget accounts, 'tracking' the rest. */
    id: 'budget' | 'tracking';
    label: string;
    accounts: AccountSummary[];
    total: TotalInBase;
}

/**
 * Build the accounts overview: live accounts in sidebar order, split into
 * on-budget and tracking groups, each with its balances and group total.
 *
 * Empty groups are omitted so a budget without tracking accounts shows one
 * plain list.
 *
 * @return array<int, AccountGroup>
 */
export function accountGroups(
    accounts: Account[],
    transactions: Transaction[],
    rates: RateRow[],
    base = 'CAD',
): AccountGroup[] {
    const balances = accountBalances(transactions);
    const live = accounts
        .filter((account) => account.deleted_at === null)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const groups: AccountGroup[] = [
        { id: 'budget', label: 'Budget', accounts: [], total: { totalMinor: 0, missingRates: [] } },
        { id: 'tracking', label: 'Tracking', accounts: [], total: { totalMinor: 0, missingRates: [] } },
    ];

    for (const account of live) {
        const balance = balances[account.id] ?? { workingMinor: 0, clearedMinor: 0 };
        const group = groups[account.on_budget ? 0 : 1];

        group.accounts.push({ account, ...balance });
    }

    for (const group of groups) {
        group.total = totalInBase(
            balances,
            group.accounts.map((summary) => summary.account),
            rates,
            base,
        );
    }

    return groups.filter((group) => group.accounts.length > 0);
}
