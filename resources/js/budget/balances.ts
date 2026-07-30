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
