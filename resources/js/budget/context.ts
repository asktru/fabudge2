import { inject, provide   } from 'vue';
import type {InjectionKey, Ref} from 'vue';

import type { BudgetDatabase } from './db';
import type { Repo } from './repo';
import type { SyncEngine } from './sync';

export type BudgetView =
    | { view: 'plan' }
    | { view: 'analytics' }
    | { view: 'accounts' }
    | { view: 'register'; accountId: string | null }
    | { view: 'categories' }
    | { view: 'payees' };

export interface BudgetContext {
    db: BudgetDatabase;
    repo: Repo;
    sync: SyncEngine;
    current: Ref<BudgetView>;
    navigate: (view: BudgetView) => void;
}

const key: InjectionKey<BudgetContext> = Symbol('budget');

export function provideBudget(context: BudgetContext): void {
    provide(key, context);
}

export function useBudget(): BudgetContext {
    const context = inject(key);

    if (!context) {
        throw new Error('useBudget() called outside the budget app');
    }

    return context;
}
