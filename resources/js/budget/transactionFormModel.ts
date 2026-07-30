import type { CreateTransactionInput, CreateTransferInput } from './repo';
import type { Account, ClearedStatus, Transaction } from './types';

export type PayeeSelection =
    | { kind: 'payee'; id: string | null; name: string }
    | { kind: 'transfer'; accountId: string };

export interface TransactionFormState {
    accountId: string | null;
    date: string;
    payee: PayeeSelection | null;
    /** Positive minor units; at most one of outflow/inflow is set. */
    outflowMinor: number | null;
    inflowMinor: number | null;
    /** For cross-currency transfers: the amount on the other side (positive). */
    otherSideMinor: number | null;
    categoryId: string | null;
    memo: string;
    cleared: boolean;
}

export type Submission =
    | { kind: 'transaction'; input: CreateTransactionInput }
    | { kind: 'transfer'; input: CreateTransferInput }
    | { error: string };

export function emptyFormState(accountId: string | null, date: string): TransactionFormState {
    return {
        accountId,
        date,
        payee: null,
        outflowMinor: null,
        inflowMinor: null,
        otherSideMinor: null,
        categoryId: null,
        memo: '',
        cleared: false,
    };
}

export function isTransfer(state: TransactionFormState): boolean {
    return state.payee?.kind === 'transfer';
}

/** A transfer between accounts of different currencies needs both amounts entered. */
export function needsOtherSideAmount(state: TransactionFormState, accounts: Account[]): boolean {
    if (state.payee?.kind !== 'transfer' || state.accountId === null) {
        return false;
    }

    const source = accounts.find((account) => account.id === state.accountId);
    const target = accounts.find((account) => account.id === (state.payee as { accountId: string }).accountId);

    return !!source && !!target && source.currency !== target.currency;
}

/** Fields that stay editable when editing an existing transfer leg. */
export function editableTransferFields(): (keyof Transaction)[] {
    return ['date', 'memo', 'amount', 'cleared'];
}

export function buildSubmission(state: TransactionFormState, accounts: Account[]): Submission {
    if (state.accountId === null) {
        return { error: 'Choose an account' };
    }

    const amount = state.outflowMinor ?? state.inflowMinor;

    if (!amount || amount <= 0) {
        return { error: 'Enter an amount' };
    }

    const isOutflow = state.outflowMinor !== null && state.outflowMinor > 0;
    const cleared: ClearedStatus = state.cleared ? 'cleared' : 'uncleared';

    if (state.payee?.kind === 'transfer') {
        if (state.payee.accountId === state.accountId) {
            return { error: 'Cannot transfer to the same account' };
        }

        const needsBoth = needsOtherSideAmount(state, accounts);

        if (needsBoth && (!state.otherSideMinor || state.otherSideMinor <= 0)) {
            return { error: 'Enter the amount on the other side' };
        }

        const otherAmount = needsBoth ? state.otherSideMinor! : amount;

        // Outflow: money leaves this account toward the target.
        // Inflow: money arrives here from the target account.
        const input: CreateTransferInput = isOutflow
            ? {
                  from_account_id: state.accountId,
                  to_account_id: state.payee.accountId,
                  date: state.date,
                  outMinor: amount,
                  inMinor: otherAmount,
                  memo: state.memo || null,
                  clearedFrom: cleared,
              }
            : {
                  from_account_id: state.payee.accountId,
                  to_account_id: state.accountId,
                  date: state.date,
                  outMinor: otherAmount,
                  inMinor: amount,
                  memo: state.memo || null,
                  clearedTo: cleared,
              };

        return { kind: 'transfer', input };
    }

    return {
        kind: 'transaction',
        input: {
            account_id: state.accountId,
            date: state.date,
            amountMinor: isOutflow ? -amount : amount,
            payee_id: state.payee?.id ?? null,
            payeeName: state.payee && state.payee.id === null ? state.payee.name : null,
            category_id: state.categoryId,
            memo: state.memo || null,
            cleared,
        },
    };
}
