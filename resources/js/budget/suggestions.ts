import type { Transaction } from './types';

/**
 * Suggest a category for a payee: the category of the most recent live,
 * categorized transaction with that payee (by date, then updated_at).
 */
export function suggestCategory(payeeId: string, transactions: Transaction[]): string | null {
    let best: Transaction | null = null;

    for (const transaction of transactions) {
        if (transaction.payee_id !== payeeId || transaction.deleted_at !== null || transaction.category_id === null) {
            continue;
        }

        if (!best || transaction.date > best.date || (transaction.date === best.date && transaction.updated_at > best.updated_at)) {
            best = transaction;
        }
    }

    return best?.category_id ?? null;
}
