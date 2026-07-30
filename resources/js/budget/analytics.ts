import { addMonths, monthOf } from './budgetMath';
import { convertToBase } from './money';
import type { Account, RateRow, Transaction } from './types';

/** All outputs in CAD minor units, latest-rate converted. */

export interface AnalyticsInputs {
    accounts: Account[];
    transactions: Transaction[];
    rates: RateRow[];
}

export interface SpendingMonth {
    month: string;
    /** Positive number: money spent this month. */
    totalMinor: number;
    /** Net outflow per category id (positive = spent). Uncategorized under ''. */
    byCategory: Record<string, number>;
}

export interface CashflowMonth {
    month: string;
    incomeMinor: number;
    spendingMinor: number;
}

export interface NetWorthMonth {
    month: string;
    netWorthMinor: number;
}

/** The last `count` months ending at `endMonth`, ascending. */
export function monthRange(endMonth: string, count: number): string[] {
    return Array.from({ length: count }, (_, index) => addMonths(endMonth, index - (count - 1)));
}

function liveAccountById(accounts: Account[]): Map<string, Account> {
    return new Map(accounts.filter((account) => account.deleted_at === null).map((account) => [account.id, account]));
}

/**
 * Transfer pairs where both legs live in on-budget accounts move money
 * around inside the budget — they are not income or spending.
 */
function internalTransferIds(transactions: Transaction[], accounts: Map<string, Account>): Set<string> {
    const legsByPair = new Map<string, Transaction[]>();

    for (const transaction of transactions) {
        if (transaction.transfer_pair_id && transaction.deleted_at === null) {
            const legs = legsByPair.get(transaction.transfer_pair_id) ?? [];
            legs.push(transaction);
            legsByPair.set(transaction.transfer_pair_id, legs);
        }
    }

    const internal = new Set<string>();

    for (const legs of legsByPair.values()) {
        if (legs.length === 2 && legs.every((leg) => accounts.get(leg.account_id)?.on_budget)) {
            legs.forEach((leg) => internal.add(leg.id));
        }
    }

    return internal;
}

function convertedCashflowRows(inputs: AnalyticsInputs): { transaction: Transaction; convertedMinor: number }[] {
    const accounts = liveAccountById(inputs.accounts);
    const internal = internalTransferIds(inputs.transactions, accounts);

    return inputs.transactions
        .filter((transaction) => {
            const account = accounts.get(transaction.account_id);

            return transaction.deleted_at === null && !!account?.on_budget && !internal.has(transaction.id);
        })
        .map((transaction) => ({
            transaction,
            convertedMinor: convertToBase(transaction.amount, accounts.get(transaction.account_id)!.currency, inputs.rates) ?? 0,
        }));
}

export function spendingByMonth(months: string[], inputs: AnalyticsInputs): SpendingMonth[] {
    const rows = convertedCashflowRows(inputs);
    const byMonth = new Map<string, SpendingMonth>(months.map((month) => [month, { month, totalMinor: 0, byCategory: {} }]));

    for (const { transaction, convertedMinor } of rows) {
        const entry = byMonth.get(monthOf(transaction.date));

        if (!entry || convertedMinor >= 0) {
            continue;
        }

        const spent = -convertedMinor;
        entry.totalMinor += spent;
        const key = transaction.category_id ?? '';
        entry.byCategory[key] = (entry.byCategory[key] ?? 0) + spent;
    }

    return months.map((month) => byMonth.get(month)!);
}

export function incomeVsSpending(months: string[], inputs: AnalyticsInputs): CashflowMonth[] {
    const rows = convertedCashflowRows(inputs);
    const byMonth = new Map<string, CashflowMonth>(months.map((month) => [month, { month, incomeMinor: 0, spendingMinor: 0 }]));

    for (const { transaction, convertedMinor } of rows) {
        const entry = byMonth.get(monthOf(transaction.date));

        if (!entry) {
            continue;
        }

        if (convertedMinor > 0) {
            entry.incomeMinor += convertedMinor;
        } else {
            entry.spendingMinor += -convertedMinor;
        }
    }

    return months.map((month) => byMonth.get(month)!);
}

/** Month-end net worth across ALL live accounts (tracking accounts included). */
export function netWorthSeries(months: string[], inputs: AnalyticsInputs): NetWorthMonth[] {
    const accounts = liveAccountById(inputs.accounts);

    const monthlyDeltas = new Map<string, number>();
    let beforeFirstMonth = 0;
    const firstMonth = months[0];

    for (const transaction of inputs.transactions) {
        const account = accounts.get(transaction.account_id);

        if (transaction.deleted_at !== null || !account) {
            continue;
        }

        const converted = convertToBase(transaction.amount, account.currency, inputs.rates) ?? 0;
        const month = monthOf(transaction.date);

        if (month < firstMonth) {
            beforeFirstMonth += converted;
        } else {
            monthlyDeltas.set(month, (monthlyDeltas.get(month) ?? 0) + converted);
        }
    }

    let running = beforeFirstMonth;

    return months.map((month) => {
        running += monthlyDeltas.get(month) ?? 0;

        return { month, netWorthMinor: running };
    });
}
