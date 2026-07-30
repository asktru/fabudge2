import type { Transaction } from './types';

export type RegisterRow =
    | { kind: 'single'; transaction: Transaction }
    | {
          kind: 'split';
          groupId: string;
          /** Representative member (shared fields: account, date, payee, cleared). */
          head: Transaction;
          members: Transaction[];
          totalMinor: number;
      };

/**
 * Collapse split-group members into one display row each; plain transactions
 * pass through. Input should already be filtered to live rows; output keeps
 * the given order (position of a split = its first member's position).
 */
export function groupRegisterRows(transactions: Transaction[]): RegisterRow[] {
    const rows: RegisterRow[] = [];
    const splitIndex = new Map<string, { kind: 'split'; groupId: string; head: Transaction; members: Transaction[]; totalMinor: number }>();

    for (const transaction of transactions) {
        if (!transaction.split_group_id) {
            rows.push({ kind: 'single', transaction });
            continue;
        }

        const existing = splitIndex.get(transaction.split_group_id);

        if (existing) {
            existing.members.push(transaction);
            existing.totalMinor += transaction.amount;
        } else {
            const row = {
                kind: 'split' as const,
                groupId: transaction.split_group_id,
                head: transaction,
                members: [transaction],
                totalMinor: transaction.amount,
            };
            splitIndex.set(transaction.split_group_id, row);
            rows.push(row);
        }
    }

    return rows;
}
