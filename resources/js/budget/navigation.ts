import { CalendarRange, ChartColumn, Wallet } from '@lucide/vue';
import type { Component } from 'vue';

import type { BudgetView } from './context';

export type BudgetTabId = 'plan' | 'spending' | 'reflect';

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
    { id: 'reflect', label: 'Reflect', icon: ChartColumn, view: { view: 'analytics' } },
];

/**
 * The tab that should be highlighted for the given view, or null when the view
 * lives outside the primary sections (category and payee management).
 *
 * Drilling into a single account keeps Spending highlighted: an account
 * register is a narrowed version of the same section.
 */
export function activeTabId(view: BudgetView): BudgetTabId | null {
    switch (view.view) {
        case 'plan':
            return 'plan';
        case 'register':
            return 'spending';
        case 'analytics':
            return 'reflect';
        default:
            return null;
    }
}
