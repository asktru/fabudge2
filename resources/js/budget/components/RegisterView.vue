<script setup lang="ts">
import { CheckCircle2, Circle, Lock, Pencil, Plus } from '@lucide/vue';
import { computed, ref } from 'vue';
import { accountBalances } from '@/budget/balances';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import type { Account, Category, Payee, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import TransactionFormDialog from './TransactionFormDialog.vue';

const props = defineProps<{
    /** null = all accounts */
    accountId: string | null;
}>();

const emit = defineEmits<{ editAccount: [account: Account] }>();

const { db, repo } = useBudget();

const accounts = useLive<Account[]>(() => db.accounts.toArray(), []);
const payees = useLive<Payee[]>(() => db.payees.toArray(), []);
const categories = useLive<Category[]>(() => db.categories.toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);

const formOpen = ref(false);
const editing = ref<Transaction | null>(null);

const account = computed(() => accounts.value.find((candidate) => candidate.id === props.accountId) ?? null);

const accountsById = computed(() => new Map(accounts.value.map((candidate) => [candidate.id, candidate])));
const payeesById = computed(() => new Map(payees.value.map((payee) => [payee.id, payee])));
const categoriesById = computed(() => new Map(categories.value.map((category) => [category.id, category])));

const pairAccountByTransactionId = computed(() => {
    const legsByPair = new Map<string, Transaction[]>();

    for (const transaction of transactions.value) {
        if (transaction.transfer_pair_id) {
            const legs = legsByPair.get(transaction.transfer_pair_id) ?? [];
            legs.push(transaction);
            legsByPair.set(transaction.transfer_pair_id, legs);
        }
    }

    const result = new Map<string, Account | undefined>();

    for (const legs of legsByPair.values()) {
        for (const leg of legs) {
            const other = legs.find((candidate) => candidate.id !== leg.id);
            result.set(leg.id, other ? accountsById.value.get(other.account_id) : undefined);
        }
    }

    return result;
});

const rows = computed(() =>
    transactions.value
        .filter((transaction) => transaction.deleted_at === null)
        .filter((transaction) => props.accountId === null || transaction.account_id === props.accountId)
        .sort((a, b) => b.date.localeCompare(a.date) || b.updated_at - a.updated_at),
);

const balances = computed(() => accountBalances(transactions.value));

const headerBalance = computed(() => {
    if (!account.value) {
        return null;
    }

    const balance = balances.value[account.value.id] ?? { workingMinor: 0, clearedMinor: 0 };

    return {
        working: formatMoney(balance.workingMinor, account.value.currency),
        cleared: formatMoney(balance.clearedMinor, account.value.currency),
    };
});

function payeeLabel(transaction: Transaction): string {
    if (transaction.transfer_pair_id) {
        const other = pairAccountByTransactionId.value.get(transaction.id);

        return other ? `Transfer: ${other.name}` : 'Transfer';
    }

    return transaction.payee_id ? (payeesById.value.get(transaction.payee_id)?.name ?? '—') : '—';
}

function categoryLabel(transaction: Transaction): string {
    return transaction.category_id ? (categoriesById.value.get(transaction.category_id)?.name ?? '—') : '';
}

function currencyOf(transaction: Transaction): string {
    return accountsById.value.get(transaction.account_id)?.currency ?? 'CAD';
}

async function toggleCleared(transaction: Transaction) {
    if (transaction.cleared === 'reconciled') {
        return;
    }

    await repo.updateTransaction(transaction.id, {
        cleared: transaction.cleared === 'uncleared' ? 'cleared' : 'uncleared',
    });
}

function openEdit(transaction: Transaction) {
    editing.value = transaction;
    formOpen.value = true;
}

function openAdd() {
    editing.value = null;
    formOpen.value = true;
}
</script>

<template>
    <div class="flex h-full flex-col">
        <div class="flex flex-wrap items-center gap-4 border-b px-4 py-3">
            <div v-if="headerBalance" class="flex gap-6 text-sm">
                <div>
                    <div class="text-xs text-muted-foreground">Cleared</div>
                    <div class="font-medium tabular-nums" data-testid="cleared-balance">{{ headerBalance.cleared }}</div>
                </div>
                <div>
                    <div class="text-xs text-muted-foreground">Working</div>
                    <div class="font-medium tabular-nums" data-testid="working-balance">{{ headerBalance.working }}</div>
                </div>
            </div>

            <div class="ml-auto flex items-center gap-2">
                <Button v-if="account" variant="ghost" size="sm" data-testid="edit-account" @click="emit('editAccount', account)">
                    <Pencil class="size-4" /> <span class="hidden sm:inline">Edit account</span>
                </Button>
                <Button size="sm" data-testid="add-transaction" @click="openAdd">
                    <Plus class="size-4" /> Add transaction
                </Button>
            </div>
        </div>

        <div v-if="rows.length === 0" class="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            No transactions yet. Add your first one.
        </div>

        <!-- Desktop table -->
        <table v-else class="hidden w-full text-sm sm:table">
            <thead>
                <tr class="border-b text-left text-xs text-muted-foreground">
                    <th class="px-4 py-2 font-medium">Date</th>
                    <th v-if="accountId === null" class="px-2 py-2 font-medium">Account</th>
                    <th class="px-2 py-2 font-medium">Payee</th>
                    <th class="px-2 py-2 font-medium">Category</th>
                    <th class="px-2 py-2 font-medium">Memo</th>
                    <th class="px-2 py-2 text-right font-medium">Outflow</th>
                    <th class="px-2 py-2 text-right font-medium">Inflow</th>
                    <th class="px-4 py-2 text-center font-medium">C</th>
                </tr>
            </thead>
            <tbody data-testid="register-table">
                <tr
                    v-for="transaction in rows"
                    :key="transaction.id"
                    class="cursor-pointer border-b hover:bg-muted/50"
                    @click="openEdit(transaction)"
                >
                    <td class="px-4 py-2 whitespace-nowrap tabular-nums">{{ transaction.date }}</td>
                    <td v-if="accountId === null" class="px-2 py-2">{{ accountsById.get(transaction.account_id)?.name }}</td>
                    <td class="px-2 py-2">{{ payeeLabel(transaction) }}</td>
                    <td class="px-2 py-2 text-muted-foreground">{{ categoryLabel(transaction) }}</td>
                    <td class="max-w-48 truncate px-2 py-2 text-muted-foreground">{{ transaction.memo }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">
                        {{ transaction.amount < 0 ? formatMoney(-transaction.amount, currencyOf(transaction)) : '' }}
                    </td>
                    <td class="px-2 py-2 text-right tabular-nums">
                        {{ transaction.amount > 0 ? formatMoney(transaction.amount, currencyOf(transaction)) : '' }}
                    </td>
                    <td class="px-4 py-2 text-center" @click.stop="toggleCleared(transaction)">
                        <Lock v-if="transaction.cleared === 'reconciled'" class="inline size-4 text-muted-foreground" />
                        <CheckCircle2 v-else-if="transaction.cleared === 'cleared'" class="inline size-4 cursor-pointer text-green-600" />
                        <Circle v-else class="inline size-4 cursor-pointer text-muted-foreground" />
                    </td>
                </tr>
            </tbody>
        </table>

        <!-- Mobile cards -->
        <div v-if="rows.length" class="divide-y sm:hidden" data-testid="register-cards">
            <button
                v-for="transaction in rows"
                :key="transaction.id"
                type="button"
                class="flex w-full items-center gap-3 px-4 py-3 text-left"
                @click="openEdit(transaction)"
            >
                <span @click.stop="toggleCleared(transaction)">
                    <Lock v-if="transaction.cleared === 'reconciled'" class="size-5 text-muted-foreground" />
                    <CheckCircle2 v-else-if="transaction.cleared === 'cleared'" class="size-5 text-green-600" />
                    <Circle v-else class="size-5 text-muted-foreground" />
                </span>
                <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{{ payeeLabel(transaction) }}</span>
                    <span class="block truncate text-xs text-muted-foreground">
                        {{ transaction.date }}
                        <template v-if="accountId === null"> · {{ accountsById.get(transaction.account_id)?.name }}</template>
                        <template v-if="categoryLabel(transaction)"> · {{ categoryLabel(transaction) }}</template>
                    </span>
                </span>
                <span class="text-sm font-medium tabular-nums" :class="transaction.amount > 0 ? 'text-green-600' : ''">
                    {{ formatMoney(transaction.amount, currencyOf(transaction)) }}
                </span>
            </button>
        </div>

        <TransactionFormDialog v-model:open="formOpen" :default-account-id="accountId" :transaction="editing" />
    </div>
</template>
