<script setup lang="ts">
import { ChevronDown, ChevronRight } from '@lucide/vue';
import { computed, ref } from 'vue';
import { incomeVsSpending, monthRange, netWorthSeries, spendingByMonth } from '@/budget/analytics';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import type { Account, Category, CategoryGroup, RateRow, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import BarChart from './charts/BarChart.vue';
import GroupedBarChart from './charts/GroupedBarChart.vue';
import LineChart from './charts/LineChart.vue';

const SERIES_PRIMARY = '#3b82f6';
const SERIES_SECONDARY = '#d97706';

const { db } = useBudget();

const accounts = useLive<Account[]>(() => db.accounts.toArray(), []);
const groups = useLive<CategoryGroup[]>(() => db.category_groups.orderBy('sort_order').toArray(), []);
const categories = useLive<Category[]>(() => db.categories.toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);
const rates = useLive<RateRow[]>(() => db.rates.toArray(), []);

type Tab = 'spending' | 'cashflow' | 'networth';
const tab = ref<Tab>('spending');
const rangeCount = ref(12);
const selectedMonth = ref<string | null>(null);
const expandedGroups = ref(new Set<string>());

const TABS: { value: Tab; label: string }[] = [
    { value: 'spending', label: 'Spending' },
    { value: 'cashflow', label: 'Cash flow' },
    { value: 'networth', label: 'Net worth' },
];

const months = computed(() => monthRange(new Date().toISOString().slice(0, 7), rangeCount.value));

const inputs = computed(() => ({
    accounts: accounts.value,
    transactions: transactions.value,
    rates: rates.value,
}));

const spending = computed(() => spendingByMonth(months.value, inputs.value));
const cashflow = computed(() => incomeVsSpending(months.value, inputs.value));
const netWorth = computed(() => netWorthSeries(months.value, inputs.value));

function shortMonth(month: string): string {
    const [year, monthPart] = month.split('-').map(Number);

    return new Date(year, monthPart - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

function longMonth(month: string): string {
    const [year, monthPart] = month.split('-').map(Number);

    return new Date(year, monthPart - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const money = (minor: number) => formatMoney(minor, 'CAD');

const spendingBars = computed(() =>
    spending.value.map((entry) => ({ key: entry.month, label: shortMonth(entry.month), value: entry.totalMinor, formatted: money(entry.totalMinor) })),
);

const cashflowBars = computed(() =>
    cashflow.value.map((entry) => ({
        key: entry.month,
        label: shortMonth(entry.month),
        values: [entry.incomeMinor, entry.spendingMinor],
        formatted: [money(entry.incomeMinor), money(entry.spendingMinor)],
    })),
);

const netWorthLine = computed(() =>
    netWorth.value.map((entry) => ({ key: entry.month, label: shortMonth(entry.month), value: entry.netWorthMinor, formatted: money(entry.netWorthMinor) })),
);

/** Breakdown of the selected month (or whole range) into groups → categories. */
const breakdown = computed(() => {
    const relevant = selectedMonth.value ? spending.value.filter((entry) => entry.month === selectedMonth.value) : spending.value;

    const byCategory = new Map<string, number>();

    for (const entry of relevant) {
        for (const [categoryId, amount] of Object.entries(entry.byCategory)) {
            byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + amount);
        }
    }

    const liveGroups = groups.value.filter((group) => group.deleted_at === null);
    const categoryById = new Map(categories.value.map((category) => [category.id, category]));

    interface GroupRow {
        id: string;
        name: string;
        totalMinor: number;
        categories: { id: string; name: string; totalMinor: number }[];
    }

    const groupRows = new Map<string, GroupRow>();

    const rowFor = (groupId: string, name: string): GroupRow => {
        const existing = groupRows.get(groupId) ?? { id: groupId, name, totalMinor: 0, categories: [] };
        groupRows.set(groupId, existing);

        return existing;
    };

    for (const [categoryId, totalMinor] of byCategory) {
        if (totalMinor === 0) {
            continue;
        }

        const category = categoryById.get(categoryId);
        const group = category?.category_group_id ? liveGroups.find((candidate) => candidate.id === category.category_group_id) : null;
        const row = category
            ? rowFor(group?.id ?? 'ungrouped', group?.name ?? 'Ungrouped')
            : rowFor('uncategorized', 'Uncategorized');

        row.totalMinor += totalMinor;
        row.categories.push({ id: categoryId, name: category?.name ?? 'Uncategorized', totalMinor });
    }

    const rows = [...groupRows.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    rows.forEach((row) => row.categories.sort((a, b) => b.totalMinor - a.totalMinor));

    const maxMinor = Math.max(1, ...rows.map((row) => row.totalMinor));

    return { rows, maxMinor };
});

function toggleGroup(id: string) {
    const next = new Set(expandedGroups.value);

    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }

    expandedGroups.value = next;
}

function selectMonth(key: string) {
    selectedMonth.value = selectedMonth.value === key ? null : key;
}
</script>

<template>
    <div class="mx-auto w-full max-w-3xl space-y-4 p-4">
        <div class="flex flex-wrap items-center gap-2">
            <div class="flex rounded-lg border p-0.5">
                <Button
                    v-for="entry in TABS"
                    :key="entry.value"
                    :variant="tab === entry.value ? 'secondary' : 'ghost'"
                    size="sm"
                    :data-testid="`analytics-tab-${entry.value}`"
                    @click="tab = entry.value"
                >
                    {{ entry.label }}
                </Button>
            </div>

            <div class="ml-auto flex rounded-lg border p-0.5">
                <Button
                    v-for="count in [6, 12, 24]"
                    :key="count"
                    :variant="rangeCount === count ? 'secondary' : 'ghost'"
                    size="sm"
                    @click="rangeCount = count"
                >
                    {{ count }}m
                </Button>
            </div>
        </div>

        <!-- Spending -->
        <template v-if="tab === 'spending'">
            <div class="rounded-lg border p-4">
                <h2 class="mb-3 text-sm font-semibold">Monthly spending</h2>
                <BarChart :points="spendingBars" :color="SERIES_PRIMARY" :selected-key="selectedMonth" @select="selectMonth" />
            </div>

            <div class="rounded-lg border p-4" data-testid="spending-breakdown">
                <h2 class="mb-1 text-sm font-semibold">
                    {{ selectedMonth ? longMonth(selectedMonth) : `Last ${rangeCount} months` }} by category
                </h2>
                <p v-if="selectedMonth" class="mb-2 text-xs text-muted-foreground">Click the bar again to see the whole range.</p>

                <div v-if="breakdown.rows.length === 0" class="py-6 text-center text-sm text-muted-foreground">No spending in this period.</div>

                <div v-for="row in breakdown.rows" :key="row.id" class="border-b py-1.5 last:border-b-0">
                    <button type="button" class="flex w-full items-center gap-2 text-sm" @click="toggleGroup(row.id)">
                        <component :is="expandedGroups.has(row.id) ? ChevronDown : ChevronRight" class="size-3.5 text-muted-foreground" />
                        <span class="w-40 truncate text-left font-medium sm:w-56">{{ row.name }}</span>
                        <span class="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                            <span
                                class="block h-full rounded-sm"
                                :style="{ width: `${(row.totalMinor / breakdown.maxMinor) * 100}%`, background: SERIES_PRIMARY }"
                            />
                        </span>
                        <span class="w-24 text-right tabular-nums">{{ money(row.totalMinor) }}</span>
                    </button>

                    <div v-if="expandedGroups.has(row.id)" class="mt-1 space-y-1 pl-6">
                        <div v-for="category in row.categories" :key="category.id" class="flex items-center gap-2 text-xs text-muted-foreground">
                            <span class="w-36 truncate sm:w-52">{{ category.name }}</span>
                            <span class="h-2 flex-1 overflow-hidden rounded-sm bg-muted">
                                <span
                                    class="block h-full rounded-sm opacity-70"
                                    :style="{ width: `${(category.totalMinor / breakdown.maxMinor) * 100}%`, background: SERIES_PRIMARY }"
                                />
                            </span>
                            <span class="w-24 text-right tabular-nums">{{ money(category.totalMinor) }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <!-- Cash flow -->
        <template v-else-if="tab === 'cashflow'">
            <div class="rounded-lg border p-4">
                <h2 class="mb-3 text-sm font-semibold">Income vs spending</h2>
                <GroupedBarChart
                    :points="cashflowBars"
                    :series="[
                        { name: 'Income', color: SERIES_PRIMARY },
                        { name: 'Spending', color: SERIES_SECONDARY },
                    ]"
                />
            </div>

            <div class="overflow-x-auto rounded-lg border">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b text-left text-xs text-muted-foreground">
                            <th class="px-3 py-2 font-medium">Month</th>
                            <th class="px-3 py-2 text-right font-medium">Income</th>
                            <th class="px-3 py-2 text-right font-medium">Spending</th>
                            <th class="px-3 py-2 text-right font-medium">Net</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="entry in [...cashflow].reverse()" :key="entry.month" class="border-b last:border-b-0">
                            <td class="px-3 py-1.5">{{ longMonth(entry.month) }}</td>
                            <td class="px-3 py-1.5 text-right tabular-nums">{{ money(entry.incomeMinor) }}</td>
                            <td class="px-3 py-1.5 text-right tabular-nums">{{ money(entry.spendingMinor) }}</td>
                            <td
                                class="px-3 py-1.5 text-right font-medium tabular-nums"
                                :class="entry.incomeMinor - entry.spendingMinor >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
                            >
                                {{ money(entry.incomeMinor - entry.spendingMinor) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>

        <!-- Net worth -->
        <template v-else>
            <div class="rounded-lg border p-4">
                <h2 class="mb-1 text-sm font-semibold">Net worth</h2>
                <p class="mb-3 text-xs text-muted-foreground">All accounts, converted to CAD at today's rates.</p>
                <LineChart :points="netWorthLine" :color="SERIES_PRIMARY" />
            </div>

            <div class="overflow-x-auto rounded-lg border">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b text-left text-xs text-muted-foreground">
                            <th class="px-3 py-2 font-medium">Month</th>
                            <th class="px-3 py-2 text-right font-medium">Net worth</th>
                            <th class="px-3 py-2 text-right font-medium">Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(entry, index) in [...netWorth].reverse()" :key="entry.month" class="border-b last:border-b-0">
                            <td class="px-3 py-1.5">{{ longMonth(entry.month) }}</td>
                            <td class="px-3 py-1.5 text-right tabular-nums">{{ money(entry.netWorthMinor) }}</td>
                            <td class="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                {{ index < netWorth.length - 1 ? money(entry.netWorthMinor - [...netWorth].reverse()[index + 1].netWorthMinor) : '—' }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </div>
</template>
