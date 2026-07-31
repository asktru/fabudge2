<script setup lang="ts">
import { ChevronRight, Landmark, Pencil, Plus } from '@lucide/vue';
import { computed } from 'vue';
import { accountGroups, totalInBase, accountBalances } from '@/budget/balances';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import type { Account, RateRow, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';

const emit = defineEmits<{ addAccount: []; editAccount: [account: Account] }>();

const { db, navigate } = useBudget();

const accounts = useLive<Account[]>(() => db.accounts.orderBy('sort_order').toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);
const rates = useLive<RateRow[]>(() => db.rates.toArray(), []);

const groups = computed(() => accountGroups(accounts.value, transactions.value, rates.value));

const total = computed(() =>
    totalInBase(
        accountBalances(transactions.value),
        accounts.value.filter((account) => account.deleted_at === null),
        rates.value,
    ),
);
</script>

<template>
    <div class="mx-auto w-full max-w-2xl p-4" data-testid="accounts-view">
        <div class="mb-4 flex items-end justify-between gap-3">
            <div>
                <div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Total balance</div>
                <div class="text-2xl font-semibold tabular-nums">{{ formatMoney(total.totalMinor, 'CAD') }}</div>
                <div v-if="total.missingRates.length" class="text-xs text-amber-600 dark:text-amber-500">
                    No rate for {{ total.missingRates.join(', ') }}
                </div>
            </div>

            <Button size="sm" variant="outline" data-testid="accounts-add" @click="emit('addAccount')">
                <Plus class="size-4" /> Add account
            </Button>
        </div>

        <div v-if="groups.length === 0" class="rounded-lg border p-8 text-center text-sm text-muted-foreground">
            No accounts yet. Add one to start tracking your money.
        </div>

        <section v-for="group in groups" :key="group.id" class="mb-6">
            <div class="mb-1 flex items-baseline justify-between px-1">
                <h2 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{{ group.label }}</h2>
                <span class="text-xs tabular-nums text-muted-foreground">
                    {{ formatMoney(group.total.totalMinor, 'CAD') }}
                </span>
            </div>

            <ul class="divide-y rounded-lg border">
                <li v-for="summary in group.accounts" :key="summary.account.id" class="flex items-center">
                    <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50"
                        :data-testid="`account-row-${summary.account.id}`"
                        @click="navigate({ view: 'register', accountId: summary.account.id })"
                    >
                        <Landmark class="size-4 shrink-0 text-muted-foreground" />

                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium">{{ summary.account.name }}</span>
                            <span class="block text-xs text-muted-foreground">
                                {{ formatMoney(summary.clearedMinor, summary.account.currency) }} cleared
                            </span>
                        </span>

                        <span class="shrink-0 text-right">
                            <span
                                class="block text-sm font-semibold tabular-nums"
                                :class="summary.workingMinor < 0 ? 'text-red-600 dark:text-red-400' : ''"
                            >
                                {{ formatMoney(summary.workingMinor, summary.account.currency) }}
                            </span>
                            <span class="block text-xs text-muted-foreground">{{ summary.account.currency }}</span>
                        </span>

                        <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    <Button
                        variant="ghost"
                        size="icon"
                        class="mr-2 size-8 shrink-0"
                        title="Edit account"
                        @click="emit('editAccount', summary.account)"
                    >
                        <Pencil class="size-3.5" />
                    </Button>
                </li>
            </ul>
        </section>
    </div>
</template>
