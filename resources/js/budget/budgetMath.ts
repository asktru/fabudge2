import { convertToBase } from './money';
import type { Account, Assignment, RateRow, Target, Transaction } from './types';

/** Everything here is in the budget's main currency (CAD), latest-rate converted. */

export interface CategoryMonth {
    assignedMinor: number;
    activityMinor: number;
    availableMinor: number;
}

export interface BudgetMonth {
    month: string;
    readyToAssignMinor: number;
    /** Per category id. Categories with no activity/assignments ever are omitted. */
    categories: Record<string, CategoryMonth>;
    /** Category ids with availableMinor < 0 in this month. */
    overspent: string[];
}

export function monthOf(date: string): string {
    return date.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
    const [year, monthIndex] = month.split('-').map(Number);
    const total = year * 12 + (monthIndex - 1) + delta;
    const newYear = Math.floor(total / 12);
    const newMonth = (total % 12) + 1;

    return `${newYear}-${String(newMonth).padStart(2, '0')}`;
}

/** Whole months from `from` to `to` inclusive of both; 0 if `to` is before `from`. */
export function monthsBetweenInclusive(from: string, to: string): number {
    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);

    return Math.max(0, toYear * 12 + toMonth - (fromYear * 12 + fromMonth) + 1);
}

interface BudgetInputs {
    accounts: Account[];
    transactions: Transaction[];
    assignments: Assignment[];
    rates: RateRow[];
}

function liveOnBudgetAccountCurrency(accounts: Account[]): Map<string, string> {
    const map = new Map<string, string>();

    for (const account of accounts) {
        if (account.deleted_at === null && account.on_budget) {
            map.set(account.id, account.currency);
        }
    }

    return map;
}

function convert(amountMinor: number, currency: string, rates: RateRow[]): number {
    return convertToBase(amountMinor, currency, rates) ?? 0;
}

/**
 * Compute the plan numbers for one month.
 *
 * Ready to Assign is global (not per-month): total on-budget funds minus
 * everything assigned in any month and all categorized on-budget activity.
 * Available carries over across months, negatives included.
 */
export function computeBudgetMonth(month: string, inputs: BudgetInputs): BudgetMonth {
    const onBudget = liveOnBudgetAccountCurrency(inputs.accounts);

    let fundsMinor = 0;
    /** category -> month -> {assigned, activity} */
    const perCategory = new Map<string, Map<string, { assigned: number; activity: number }>>();

    const bucket = (categoryId: string, bucketMonth: string) => {
        const months = perCategory.get(categoryId) ?? new Map<string, { assigned: number; activity: number }>();
        perCategory.set(categoryId, months);
        const entry = months.get(bucketMonth) ?? { assigned: 0, activity: 0 };
        months.set(bucketMonth, entry);

        return entry;
    };

    for (const transaction of inputs.transactions) {
        const currency = onBudget.get(transaction.account_id);

        if (transaction.deleted_at !== null || currency === undefined) {
            continue;
        }

        const converted = convert(transaction.amount, currency, inputs.rates);
        fundsMinor += converted;

        if (transaction.category_id !== null) {
            bucket(transaction.category_id, monthOf(transaction.date)).activity += converted;
        }
    }

    let totalAssignedMinor = 0;
    let totalActivityMinor = 0;

    for (const assignment of inputs.assignments) {
        if (assignment.deleted_at !== null) {
            continue;
        }

        bucket(assignment.category_id, assignment.month).assigned += assignment.amount;
        totalAssignedMinor += assignment.amount;
    }

    const categories: Record<string, CategoryMonth> = {};
    const overspent: string[] = [];

    for (const [categoryId, months] of perCategory) {
        let assignedThisMonth = 0;
        let activityThisMonth = 0;
        let availableMinor = 0;

        for (const [bucketMonth, entry] of months) {
            totalActivityMinor += entry.activity;

            if (bucketMonth <= month) {
                availableMinor += entry.assigned + entry.activity;
            }

            if (bucketMonth === month) {
                assignedThisMonth = entry.assigned;
                activityThisMonth = entry.activity;
            }
        }

        categories[categoryId] = {
            assignedMinor: assignedThisMonth,
            activityMinor: activityThisMonth,
            availableMinor,
        };

        if (availableMinor < 0) {
            overspent.push(categoryId);
        }
    }

    return {
        month,
        readyToAssignMinor: fundsMinor - totalAssignedMinor - totalActivityMinor,
        categories,
        overspent,
    };
}

export interface AutoAssignPlanLine {
    categoryId: string;
    neededMinor: number;
}

/**
 * How much each targeted category still needs for `month`. Pure planning —
 * capping at Ready to Assign happens at apply time.
 */
export function computeAutoAssignNeeds(month: string, targets: Target[], budgetMonth: BudgetMonth): AutoAssignPlanLine[] {
    const lines: AutoAssignPlanLine[] = [];

    for (const target of targets) {
        if (target.deleted_at !== null) {
            continue;
        }

        const current = budgetMonth.categories[target.category_id] ?? { assignedMinor: 0, activityMinor: 0, availableMinor: 0 };
        let neededMinor = 0;

        if (target.type === 'monthly') {
            neededMinor = Math.max(0, target.amount - current.assignedMinor);
        } else if (target.type === 'refill') {
            const availableBeforeAssignment = current.availableMinor - current.assignedMinor;
            neededMinor = Math.max(0, target.amount - availableBeforeAssignment - current.assignedMinor);
        } else if (target.type === 'by_date') {
            if (target.due_month !== null && month <= target.due_month) {
                const monthsLeft = monthsBetweenInclusive(month, target.due_month);
                const shortfall = target.amount - (current.availableMinor - current.assignedMinor);
                const perMonth = Math.ceil(Math.max(0, shortfall) / monthsLeft);
                neededMinor = Math.max(0, perMonth - current.assignedMinor);
            }
        }

        if (neededMinor > 0) {
            lines.push({ categoryId: target.category_id, neededMinor });
        }
    }

    return lines;
}
