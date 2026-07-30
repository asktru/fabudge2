<script setup lang="ts">
import { ChevronLeft, ChevronRight, Crosshair, Sparkles, TriangleAlert } from '@lucide/vue';
import { computed, ref } from 'vue';
import { addMonths, computeAutoAssignNeeds, computeBudgetMonth } from '@/budget/budgetMath';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import type { Account, Assignment, Category, CategoryGroup, RateRow, Target, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import MoneyInput from './MoneyInput.vue';
import MoveMoneyDialog from './MoveMoneyDialog.vue';
import TargetDialog from './TargetDialog.vue';

const { db, repo } = useBudget();

const accounts = useLive<Account[]>(() => db.accounts.toArray(), []);
const groups = useLive<CategoryGroup[]>(() => db.category_groups.orderBy('sort_order').toArray(), []);
const categories = useLive<Category[]>(() => db.categories.orderBy('sort_order').toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);
const assignments = useLive<Assignment[]>(() => db.assignments.toArray(), []);
const targets = useLive<Target[]>(() => db.targets.toArray(), []);
const rates = useLive<RateRow[]>(() => db.rates.toArray(), []);

const month = ref(new Date().toISOString().slice(0, 7));

const budgetMonth = computed(() =>
    computeBudgetMonth(month.value, {
        accounts: accounts.value,
        transactions: transactions.value,
        assignments: assignments.value,
        rates: rates.value,
    }),
);

const liveCategories = computed(() => categories.value.filter((category) => category.deleted_at === null));
const liveTargets = computed(() => targets.value.filter((target) => target.deleted_at === null));

const targetByCategory = computed(() => new Map(liveTargets.value.map((target) => [target.category_id, target])));

const buckets = computed(() => {
    const liveGroups = groups.value.filter((group) => group.deleted_at === null);
    const result: { group: CategoryGroup | null; categories: Category[] }[] = liveGroups.map((group) => ({
        group,
        categories: liveCategories.value.filter((category) => category.category_group_id === group.id),
    }));

    const ungrouped = liveCategories.value.filter(
        (category) => !category.category_group_id || !liveGroups.some((group) => group.id === category.category_group_id),
    );

    if (ungrouped.length) {
        result.push({ group: null, categories: ungrouped });
    }

    return result.filter((entry) => entry.categories.length > 0);
});

const availableByCategory = computed(() =>
    Object.fromEntries(liveCategories.value.map((category) => [category.id, budgetMonth.value.categories[category.id]?.availableMinor ?? 0])),
);

const overspentNames = computed(() =>
    budgetMonth.value.overspent
        .map((categoryId) => liveCategories.value.find((category) => category.id === categoryId)?.name)
        .filter((name): name is string => !!name),
);

const autoAssignNeeds = computed(() => computeAutoAssignNeeds(month.value, liveTargets.value, budgetMonth.value));

const autoAssignTotal = computed(() => autoAssignNeeds.value.reduce((sum, line) => sum + line.neededMinor, 0));

// ——— Editing state ———

const assignDrafts = ref<Record<string, number | null>>({});
const targetDialogOpen = ref(false);
const targetCategory = ref<Category | null>(null);
const moveOpen = ref(false);
const moveFromId = ref<string | null>(null);
const moveToId = ref<string | null>(null);
const moveSuggested = ref<number | null>(null);

function cellFor(categoryId: string) {
    return budgetMonth.value.categories[categoryId] ?? { assignedMinor: 0, activityMinor: 0, availableMinor: 0 };
}

async function commitAssignment(categoryId: string) {
    const draft = assignDrafts.value[categoryId];

    if (draft === undefined) {
return;
}

    const current = cellFor(categoryId).assignedMinor;

    if (draft !== null && draft !== current) {
        await repo.setAssignment(categoryId, month.value, draft);
    } else if (draft === null && current !== 0) {
        await repo.setAssignment(categoryId, month.value, 0);
    }

    delete assignDrafts.value[categoryId];
}

function openTarget(category: Category) {
    targetCategory.value = category;
    targetDialogOpen.value = true;
}

function openMove(categoryId: string | null, availableMinor: number) {
    if (availableMinor < 0) {
        // Fix an overspent category: move money into it.
        moveFromId.value = null;
        moveToId.value = categoryId;
        moveSuggested.value = -availableMinor;
    } else {
        moveFromId.value = categoryId;
        moveToId.value = null;
        moveSuggested.value = null;
    }

    moveOpen.value = true;
}

async function autoAssign() {
    let remaining = Math.max(0, budgetMonth.value.readyToAssignMinor);

    // Assign in category display order so the top of the plan fills first.
    const ordered = liveCategories.value
        .map((category) => autoAssignNeeds.value.find((line) => line.categoryId === category.id))
        .filter((line): line is NonNullable<typeof line> => !!line);

    for (const line of ordered) {
        if (remaining <= 0) {
break;
}

        const amount = Math.min(line.neededMinor, remaining);
        await repo.moveMoney({ fromCategoryId: null, toCategoryId: line.categoryId, month: month.value, amountMinor: amount });
        remaining -= amount;
    }
}

function monthLabel(value: string): string {
    const [year, monthPart] = value.split('-').map(Number);

    return new Date(year, monthPart - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function targetSummary(target: Target): string {
    if (target.type === 'monthly') {
return `${formatMoney(target.amount, 'CAD')}/month`;
}

    if (target.type === 'refill') {
return `Refill to ${formatMoney(target.amount, 'CAD')}`;
}

    return `${formatMoney(target.amount, 'CAD')} by ${target.due_month}`;
}
</script>

<template>
    <div class="flex h-full flex-col">
        <div class="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <div class="flex items-center gap-1">
                <Button variant="ghost" size="icon" class="size-8" data-testid="month-prev" @click="month = addMonths(month, -1)">
                    <ChevronLeft class="size-4" />
                </Button>
                <span class="min-w-36 text-center text-sm font-semibold" data-testid="plan-month">{{ monthLabel(month) }}</span>
                <Button variant="ghost" size="icon" class="size-8" data-testid="month-next" @click="month = addMonths(month, 1)">
                    <ChevronRight class="size-4" />
                </Button>
            </div>

            <div
                class="ml-auto flex items-center gap-3 rounded-lg px-3 py-1.5"
                :class="budgetMonth.readyToAssignMinor >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'"
            >
                <div>
                    <div class="text-xs text-muted-foreground">Ready to assign</div>
                    <div
                        class="text-lg font-semibold tabular-nums"
                        :class="budgetMonth.readyToAssignMinor >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
                        data-testid="ready-to-assign"
                    >
                        {{ formatMoney(budgetMonth.readyToAssignMinor, 'CAD') }}
                    </div>
                </div>
                <Button
                    v-if="autoAssignTotal > 0 && budgetMonth.readyToAssignMinor > 0"
                    size="sm"
                    data-testid="auto-assign"
                    @click="autoAssign"
                >
                    <Sparkles class="size-4" />
                    Auto-assign {{ formatMoney(Math.min(autoAssignTotal, budgetMonth.readyToAssignMinor), 'CAD') }}
                </Button>
            </div>
        </div>

        <div
            v-if="budgetMonth.readyToAssignMinor < 0 || overspentNames.length"
            class="flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400"
            data-testid="plan-problems"
        >
            <TriangleAlert class="size-4 shrink-0" />
            <span v-if="budgetMonth.readyToAssignMinor < 0">
                You've assigned {{ formatMoney(-budgetMonth.readyToAssignMinor, 'CAD') }} more than you have — unassign or move money back.
            </span>
            <span v-if="overspentNames.length">Overspent: {{ overspentNames.join(', ') }} — click the red amount to cover it.</span>
        </div>

        <div v-if="liveCategories.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p class="text-sm text-muted-foreground">Create categories first — then assign money to them here.</p>
        </div>

        <div v-else class="flex-1 overflow-y-auto">
            <div v-for="bucket in buckets" :key="bucket.group?.id ?? 'ungrouped'">
                <div class="sticky top-0 border-b bg-muted/60 px-4 py-1.5 text-xs font-semibold backdrop-blur">
                    {{ bucket.group?.name ?? 'Ungrouped' }}
                    <span class="ml-2 hidden text-muted-foreground sm:inline">
                        {{ formatMoney(bucket.categories.reduce((sum, c) => sum + cellFor(c.id).availableMinor, 0), 'CAD') }} available
                    </span>
                </div>

                <div
                    v-for="category in bucket.categories"
                    :key="category.id"
                    class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2"
                    :data-testid="`plan-row-${category.name}`"
                >
                    <div class="min-w-0 flex-1 basis-40">
                        <button type="button" class="group flex items-center gap-1.5 text-left text-sm font-medium" @click="openTarget(category)">
                            <span class="truncate">{{ category.name }}</span>
                            <Crosshair class="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                        <div v-if="targetByCategory.get(category.id)" class="text-xs text-muted-foreground">
                            {{ targetSummary(targetByCategory.get(category.id)!) }}
                        </div>
                    </div>

                    <div class="w-28">
                        <MoneyInput
                            :model-value="assignDrafts[category.id] ?? (cellFor(category.id).assignedMinor || null)"
                            currency="CAD"
                            placeholder="0.00"
                            @update:model-value="(value) => (assignDrafts[category.id] = value)"
                            @blur="commitAssignment(category.id)"
                        />
                    </div>

                    <div class="hidden w-24 text-right text-sm tabular-nums text-muted-foreground sm:block">
                        {{ formatMoney(cellFor(category.id).activityMinor, 'CAD') }}
                    </div>

                    <button
                        type="button"
                        class="w-28 rounded-full px-2 py-0.5 text-right text-sm font-medium tabular-nums"
                        :class="
                            cellFor(category.id).availableMinor > 0
                                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                : cellFor(category.id).availableMinor < 0
                                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                  : 'text-muted-foreground'
                        "
                        :data-testid="`available-${category.name}`"
                        @click="openMove(category.id, cellFor(category.id).availableMinor)"
                    >
                        {{ formatMoney(cellFor(category.id).availableMinor, 'CAD') }}
                    </button>
                </div>
            </div>

            <div class="px-4 py-2 text-right text-xs text-muted-foreground">Assigned · Activity · Available (click to move money)</div>
        </div>

        <TargetDialog v-model:open="targetDialogOpen" :category="targetCategory" :month="month" />
        <MoveMoneyDialog
            v-model:open="moveOpen"
            :month="month"
            :categories="liveCategories"
            :initial-from-id="moveFromId"
            :initial-to-id="moveToId"
            :suggested-minor="moveSuggested"
            :available-by-category="availableByCategory"
            :ready-to-assign-minor="budgetMonth.readyToAssignMinor"
        />
    </div>
</template>
