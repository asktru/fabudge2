import { describe, expect, it } from 'vitest';

import type { BudgetView } from '@/budget/context';
import { activeTabId, budgetTabs, quickAddAccountId } from '@/budget/navigation';

describe('budgetTabs', () => {
    it('exposes Plan, Spending, Accounts and Reflect in order', () => {
        expect(budgetTabs.map((tab) => [tab.id, tab.label])).toEqual([
            ['plan', 'Plan'],
            ['spending', 'Spending'],
            ['accounts', 'Accounts'],
            ['reflect', 'Reflect'],
        ]);
    });

    it('points Spending at the all-accounts register', () => {
        expect(budgetTabs.find((tab) => tab.id === 'spending')?.view).toEqual({ view: 'register', accountId: null });
    });

    it('highlights the tab it navigates to', () => {
        for (const tab of budgetTabs) {
            expect(activeTabId(tab.view)).toBe(tab.id);
        }
    });
});

describe('quickAddAccountId', () => {
    it('preselects the account whose register is open', () => {
        expect(quickAddAccountId({ view: 'register', accountId: 'acc-1' })).toBe('acc-1');
    });

    it('preselects nothing outside a single-account register', () => {
        const views: BudgetView[] = [
            { view: 'plan' },
            { view: 'analytics' },
            { view: 'register', accountId: null },
            { view: 'accounts' },
            { view: 'categories' },
            { view: 'payees' },
        ];

        for (const view of views) {
            expect(quickAddAccountId(view)).toBeNull();
        }
    });
});

describe('activeTabId', () => {
    it('keeps Accounts active while drilled into a single account', () => {
        expect(activeTabId({ view: 'register', accountId: 'acc-1' })).toBe('accounts');
    });

    it('keeps Spending active for the all-accounts register', () => {
        expect(activeTabId({ view: 'register', accountId: null })).toBe('spending');
    });

    it('highlights nothing for management views', () => {
        const views: BudgetView[] = [{ view: 'categories' }, { view: 'payees' }];

        for (const view of views) {
            expect(activeTabId(view)).toBeNull();
        }
    });
});
