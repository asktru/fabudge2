<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { ArrowLeft, CalendarRange, ChartColumn, Landmark, List, Plus, Shapes, Users } from '@lucide/vue';
import { computed } from 'vue';
import { accountBalances, totalInBase } from '@/budget/balances';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import type { Account, RateRow, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from '@/components/ui/sidebar';
import { dashboard } from '@/routes';

const emit = defineEmits<{ addAccount: [] }>();

const page = usePage();
const { db, current, navigate } = useBudget();
const { isMobile, setOpenMobile } = useSidebar();

const accounts = useLive<Account[]>(() => db.accounts.orderBy('sort_order').toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);
const rates = useLive<RateRow[]>(() => db.rates.toArray(), []);

const liveAccounts = computed(() => accounts.value.filter((account) => account.deleted_at === null));
const balances = computed(() => accountBalances(transactions.value));
const total = computed(() => totalInBase(balances.value, liveAccounts.value, rates.value));

const onBudgetAccounts = computed(() => liveAccounts.value.filter((account) => account.on_budget));
const offBudgetAccounts = computed(() => liveAccounts.value.filter((account) => !account.on_budget));

function go(view: Parameters<typeof navigate>[0]) {
    navigate(view);

    if (isMobile.value) {
        setOpenMobile(false);
    }
}

function isCurrentAccount(accountId: string | null): boolean {
    return current.value.view === 'register' && current.value.accountId === accountId;
}
</script>

<template>
    <Sidebar>
        <SidebarHeader>
            <div class="px-2 pt-2">
                <Link
                    :href="page.props.currentTeam ? dashboard(page.props.currentTeam.slug).url : '/'"
                    class="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft class="size-3" /> Dashboard
                </Link>
                <div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Total balance</div>
                <div class="text-2xl font-semibold tabular-nums" data-testid="total-balance">
                    {{ formatMoney(total.totalMinor, 'CAD') }}
                </div>
                <div v-if="total.missingRates.length" class="text-xs text-amber-600 dark:text-amber-500">
                    No rate for {{ total.missingRates.join(', ') }}
                </div>
            </div>
        </SidebarHeader>

        <SidebarContent>
            <SidebarGroup>
                <SidebarGroupContent>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton :is-active="current.view === 'plan'" data-testid="nav-plan" @click="go({ view: 'plan' })">
                                <CalendarRange /> Plan
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                :is-active="current.view === 'analytics'"
                                data-testid="nav-analytics"
                                @click="go({ view: 'analytics' })"
                            >
                                <ChartColumn /> Analytics
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton :is-active="isCurrentAccount(null)" @click="go({ view: 'register', accountId: null })">
                                <List /> All accounts
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup v-for="group in [
                { label: 'Budget', items: onBudgetAccounts },
                { label: 'Tracking', items: offBudgetAccounts },
            ]" :key="group.label">
                <template v-if="group.items.length">
                    <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem v-for="account in group.items" :key="account.id">
                                <SidebarMenuButton
                                    :is-active="isCurrentAccount(account.id)"
                                    class="justify-between"
                                    @click="go({ view: 'register', accountId: account.id })"
                                >
                                    <span class="flex items-center gap-2 truncate"><Landmark class="size-4 shrink-0" />{{ account.name }}</span>
                                    <SidebarMenuBadge class="static tabular-nums">
                                        {{ formatMoney(balances[account.id]?.workingMinor ?? 0, account.currency) }}
                                    </SidebarMenuBadge>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </template>
            </SidebarGroup>

            <SidebarGroup>
                <SidebarGroupLabel>Manage</SidebarGroupLabel>
                <SidebarGroupContent>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton :is-active="current.view === 'categories'" @click="go({ view: 'categories' })">
                                <Shapes /> Categories
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton :is-active="current.view === 'payees'" @click="go({ view: 'payees' })">
                                <Users /> Payees
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton data-testid="add-account" @click="emit('addAccount')">
                                <Plus /> Add account
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
            <slot name="footer" />
        </SidebarFooter>
    </Sidebar>
</template>
