<script setup lang="ts">
import { CloudAlert, CloudOff, Plus, RefreshCw } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useBudget } from '@/budget/context';
import { quickAddAccountId } from '@/budget/navigation';
import type { Account } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import AccountFormDialog from './AccountFormDialog.vue';
import AccountsView from './AccountsView.vue';
import AnalyticsView from './AnalyticsView.vue';
import BudgetSidebar from './BudgetSidebar.vue';
import BudgetTabBar from './BudgetTabBar.vue';
import ManageCategories from './ManageCategories.vue';
import ManagePayees from './ManagePayees.vue';
import PlanView from './PlanView.vue';
import RegisterView from './RegisterView.vue';
import TransactionFormDialog from './TransactionFormDialog.vue';

const { db, current, sync } = useBudget();

const accountDialogOpen = ref(false);
const editingAccount = ref<Account | null>(null);

// Quick add lives in the shell so the mobile FAB works from every tab.
const quickAddOpen = ref(false);
const quickAddAccount = computed(() => quickAddAccountId(current.value));

const accounts = useLive<Account[]>(() => db.accounts.toArray(), []);

const title = computed(() => {
    if (current.value.view === 'plan') {
        return 'Plan';
    }

    if (current.value.view === 'analytics') {
        return 'Reflect';
    }

    if (current.value.view === 'accounts') {
        return 'Accounts';
    }

    if (current.value.view === 'categories') {
        return 'Categories';
    }

    if (current.value.view === 'payees') {
        return 'Payees';
    }

    const accountId = current.value.accountId;

    return accountId === null ? 'Spending' : (accounts.value.find((account) => account.id === accountId)?.name ?? 'Account');
});

function openAccountDialog(account: Account | null) {
    editingAccount.value = account;
    accountDialogOpen.value = true;
}
</script>

<template>
    <SidebarProvider>
        <BudgetSidebar @add-account="openAccountDialog(null)" />

        <SidebarInset class="min-w-0">
            <header class="flex h-14 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger class="-ml-1" />
                <h1 class="truncate text-base font-semibold">{{ title }}</h1>

                <div class="ml-auto flex items-center gap-2 text-xs text-muted-foreground" data-testid="sync-status">
                    <template v-if="sync.status.state === 'offline'">
                        <CloudOff class="size-4" />
                        <span v-if="sync.status.pendingCount">{{ sync.status.pendingCount }} pending</span>
                        <span v-else>Offline</span>
                    </template>
                    <template v-else-if="sync.status.state === 'error'">
                        <CloudAlert class="size-4 text-amber-500" />
                        <span>Retrying…</span>
                    </template>
                    <template v-else-if="sync.status.state === 'syncing'">
                        <RefreshCw class="size-4 animate-spin" />
                    </template>
                    <span v-else-if="sync.status.pendingCount">{{ sync.status.pendingCount }} pending</span>
                </div>
            </header>

            <main class="min-w-0 flex-1 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
                <RegisterView
                    v-if="current.view === 'register'"
                    :account-id="current.accountId"
                    @edit-account="openAccountDialog($event)"
                />
                <PlanView v-else-if="current.view === 'plan'" />
                <AccountsView
                    v-else-if="current.view === 'accounts'"
                    @add-account="openAccountDialog(null)"
                    @edit-account="openAccountDialog($event)"
                />
                <AnalyticsView v-else-if="current.view === 'analytics'" />
                <ManageCategories v-else-if="current.view === 'categories'" />
                <ManagePayees v-else-if="current.view === 'payees'" />
            </main>

            <button
                type="button"
                class="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 md:hidden"
                aria-label="Add transaction"
                data-testid="quick-add"
                @click="quickAddOpen = true"
            >
                <Plus class="size-6" />
            </button>

            <BudgetTabBar />
        </SidebarInset>

        <AccountFormDialog v-model:open="accountDialogOpen" :account="editingAccount" />

        <TransactionFormDialog v-model:open="quickAddOpen" :default-account-id="quickAddAccount" :transaction="null" />
    </SidebarProvider>
</template>
