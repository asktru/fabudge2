import { CalendarRange, ChartColumn, Landmark, Wallet } from '@lucide/vue';
import type { Component } from 'vue';

import type { BudgetView } from './context';

export type BudgetTabId = 'plan' | 'spending' | 'accounts' | 'reflect';

export interface BudgetTab {
    id: BudgetTabId;
    label: string;
    icon: Component;
    view: BudgetView;
}

/**
 * The primary sections of the budget app, in the order they appear in the
 * mobile tab bar and the desktop sidebar.
 *
 * @var array<int, BudgetTab>
 */
export const budgetTabs: BudgetTab[] = [
    { id: 'plan', label: 'Plan', icon: CalendarRange, view: { view: 'plan' } },
    { id: 'spending', label: 'Spending', icon: Wallet, view: { view: 'register', accountId: null } },
    { id: 'accounts', label: 'Accounts', icon: Landmark, view: { view: 'accounts' } },
    { id: 'reflect', label: 'Reflect', icon: ChartColumn, view: { view: 'analytics' } },
];

/**
 * The account a quick-add transaction should default to for the given view:
 * the account whose register is open, and none anywhere else.
 */
export function quickAddAccountId(view: BudgetView): string | null {
    return view.view === 'register' ? view.accountId : null;
}

/**
 * The tab that should be highlighted for the given view, or null when the view
 * lives outside the primary sections (category and payee management).
 *
 * A single-account register keeps Accounts highlighted, since that is where
 * accounts are drilled into; the all-accounts register belongs to Spending.
 */
export function activeTabId(view: BudgetView): BudgetTabId | null {
    switch (view.view) {
        case 'plan':
            return 'plan';
        case 'register':
            return view.accountId === null ? 'spending' : 'accounts';
        case 'accounts':
            return 'accounts';
        case 'analytics':
            return 'reflect';
        default:
            return null;
    }
}
