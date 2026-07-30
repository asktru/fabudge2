<script setup lang="ts">
import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Circle,
    Lock,
    Pencil,
    Plus,
    Scale,
} from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { accountBalances } from '@/budget/balances';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import {
    formatRegisterDate,
    groupRegisterRows,
    groupRowsByDate,
} from '@/budget/registerRows';
import type { RegisterRow } from '@/budget/registerRows';
import type { Account, Category, Payee, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import MoneyInput from './MoneyInput.vue';
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
const transactions = useLive<Transaction[]>(
    () => db.transactions.toArray(),
    [],
);

const formOpen = ref(false);
const editing = ref<Transaction | null>(null);
const expandedGroups = ref(new Set<string>());

const account = computed(
    () =>
        accounts.value.find((candidate) => candidate.id === props.accountId) ??
        null,
);

const accountsById = computed(
    () => new Map(accounts.value.map((candidate) => [candidate.id, candidate])),
);
const payeesById = computed(
    () => new Map(payees.value.map((payee) => [payee.id, payee])),
);
const categoriesById = computed(
    () => new Map(categories.value.map((category) => [category.id, category])),
);

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
            result.set(
                leg.id,
                other ? accountsById.value.get(other.account_id) : undefined,
            );
        }
    }

    return result;
});

const rows = computed<RegisterRow[]>(() =>
    groupRegisterRows(
        transactions.value
            .filter((transaction) => transaction.deleted_at === null)
            .filter(
                (transaction) =>
                    props.accountId === null ||
                    transaction.account_id === props.accountId,
            )
            .sort(
                (a, b) =>
                    b.date.localeCompare(a.date) || b.updated_at - a.updated_at,
            ),
    ),
);

const dateGroups = computed(() => groupRowsByDate(rows.value));

const columnCount = computed(() => (props.accountId === null ? 7 : 6));

const balances = computed(() => accountBalances(transactions.value));

const headerBalance = computed(() => {
    if (!account.value) {
        return null;
    }

    const balance = balances.value[account.value.id] ?? {
        workingMinor: 0,
        clearedMinor: 0,
    };

    return {
        clearedMinor: balance.clearedMinor,
        working: formatMoney(balance.workingMinor, account.value.currency),
        cleared: formatMoney(balance.clearedMinor, account.value.currency),
    };
});

// ——— Reconciliation ———

const reconciling = ref(false);
const actualBalanceMinor = ref<number | null>(null);
const reconcileMessage = ref<string | null>(null);

watch(
    () => props.accountId,
    () => {
        reconciling.value = false;
        actualBalanceMinor.value = null;
        reconcileMessage.value = null;
    },
);

const reconcileDifferenceMinor = computed(() =>
    actualBalanceMinor.value === null || !headerBalance.value
        ? null
        : actualBalanceMinor.value - headerBalance.value.clearedMinor,
);

async function finishReconciliation() {
    if (!account.value || actualBalanceMinor.value === null) {
        return;
    }

    const adjustment = await repo.finishReconciliation(
        account.value.id,
        actualBalanceMinor.value,
    );
    reconciling.value = false;
    actualBalanceMinor.value = null;
    reconcileMessage.value = adjustment
        ? `Reconciled — adjustment of ${formatMoney(adjustment.amount, account.value.currency)} created.`
        : 'Reconciled — everything matched.';
    setTimeout(() => (reconcileMessage.value = null), 6000);
}

// ——— Row helpers ———

function headOf(row: RegisterRow): Transaction {
    return row.kind === 'single' ? row.transaction : row.head;
}

function amountOf(row: RegisterRow): number {
    return row.kind === 'single' ? row.transaction.amount : row.totalMinor;
}

function payeeLabel(row: RegisterRow): string {
    const head = headOf(row);

    if (head.transfer_pair_id) {
        const other = pairAccountByTransactionId.value.get(head.id);

        return other ? `Transfer: ${other.name}` : 'Transfer';
    }

    return head.payee_id
        ? (payeesById.value.get(head.payee_id)?.name ?? '—')
        : '—';
}

function categoryLabel(row: RegisterRow): string {
    if (row.kind === 'split') {
        return `Split (${row.members.length})`;
    }

    return row.transaction.category_id
        ? (categoriesById.value.get(row.transaction.category_id)?.name ?? '—')
        : '';
}

function categoryNameOf(transaction: Transaction): string {
    return transaction.category_id
        ? (categoriesById.value.get(transaction.category_id)?.name ?? '—')
        : 'Uncategorized';
}

function currencyOf(row: RegisterRow): string {
    return accountsById.value.get(headOf(row).account_id)?.currency ?? 'CAD';
}

async function toggleCleared(row: RegisterRow) {
    const head = headOf(row);

    if (head.cleared === 'reconciled') {
        return;
    }

    const next = head.cleared === 'uncleared' ? 'cleared' : 'uncleared';

    if (row.kind === 'split') {
        await repo.updateSplitGroup(row.groupId, { cleared: next });
    } else {
        await repo.updateTransaction(head.id, { cleared: next });
    }
}

function toggleExpanded(groupId: string) {
    const next = new Set(expandedGroups.value);

    if (next.has(groupId)) {
        next.delete(groupId);
    } else {
        next.add(groupId);
    }

    expandedGroups.value = next;
}

function openEdit(row: RegisterRow) {
    editing.value = headOf(row);
    formOpen.value = true;
}

function openAdd() {
    editing.value = null;
    formOpen.value = true;
}

function rowKey(row: RegisterRow): string {
    return row.kind === 'single' ? row.transaction.id : row.groupId;
}
</script>

<template>
    <div class="flex h-full flex-col">
        <div class="flex flex-wrap items-center gap-4 border-b px-4 py-3">
            <div v-if="headerBalance" class="flex gap-6 text-sm">
                <div>
                    <div class="text-xs text-muted-foreground">Cleared</div>
                    <div
                        class="font-medium tabular-nums"
                        data-testid="cleared-balance"
                    >
                        {{ headerBalance.cleared }}
                    </div>
                </div>
                <div>
                    <div class="text-xs text-muted-foreground">Working</div>
                    <div
                        class="font-medium tabular-nums"
                        data-testid="working-balance"
                    >
                        {{ headerBalance.working }}
                    </div>
                </div>
            </div>

            <div class="ml-auto flex items-center gap-2">
                <Button
                    v-if="account && !reconciling"
                    variant="ghost"
                    size="sm"
                    data-testid="reconcile-start"
                    @click="reconciling = true"
                >
                    <Scale class="size-4" />
                    <span class="hidden sm:inline">Reconcile</span>
                </Button>
                <Button
                    v-if="account"
                    variant="ghost"
                    size="sm"
                    data-testid="edit-account"
                    @click="emit('editAccount', account)"
                >
                    <Pencil class="size-4" />
                    <span class="hidden sm:inline">Edit account</span>
                </Button>
                <Button
                    size="sm"
                    data-testid="add-transaction"
                    @click="openAdd"
                >
                    <Plus class="size-4" /> Add transaction
                </Button>
            </div>
        </div>

        <div
            v-if="reconciling && account"
            class="border-b bg-muted/40 px-4 py-3"
            data-testid="reconcile-banner"
        >
            <div class="flex flex-wrap items-end gap-4">
                <div class="grid gap-1">
                    <label
                        class="text-xs text-muted-foreground"
                        for="actual-balance"
                        >Actual balance at the bank ({{
                            account.currency
                        }})</label
                    >
                    <div class="w-40">
                        <MoneyInput
                            id="actual-balance"
                            v-model="actualBalanceMinor"
                            :currency="account.currency"
                        />
                    </div>
                </div>
                <div
                    v-if="reconcileDifferenceMinor !== null"
                    class="pb-1 text-sm"
                >
                    <span
                        v-if="reconcileDifferenceMinor === 0"
                        class="text-green-600"
                        >Matches the cleared balance.</span
                    >
                    <span
                        v-else
                        class="text-amber-600 dark:text-amber-500"
                        data-testid="reconcile-difference"
                    >
                        Difference:
                        {{
                            formatMoney(
                                reconcileDifferenceMinor,
                                account.currency,
                            )
                        }}
                        — clear/adjust transactions below, or finish to create
                        an adjustment.
                    </span>
                </div>
                <div class="ml-auto flex gap-2 pb-1">
                    <Button
                        variant="secondary"
                        size="sm"
                        @click="
                            reconciling = false;
                            actualBalanceMinor = null;
                        "
                        >Cancel</Button
                    >
                    <Button
                        size="sm"
                        data-testid="reconcile-finish"
                        :disabled="actualBalanceMinor === null"
                        @click="finishReconciliation"
                    >
                        Finish reconciliation
                    </Button>
                </div>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
                Tip: use the cleared toggles while comparing against your bank
                statement. Finishing marks all cleared transactions as
                reconciled.
            </p>
        </div>

        <div
            v-if="reconcileMessage"
            class="border-b bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-400"
        >
            {{ reconcileMessage }}
        </div>

        <div
            v-if="rows.length === 0"
            class="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground"
        >
            No transactions yet. Add your first one.
        </div>

        <!-- Desktop table -->
        <table v-else class="hidden w-full text-sm sm:table">
            <thead>
                <tr class="border-b text-left text-xs text-muted-foreground">
                    <th v-if="accountId === null" class="px-4 py-2 font-medium">
                        Account
                    </th>
                    <th
                        class="py-2 font-medium"
                        :class="accountId === null ? 'px-2' : 'px-4'"
                    >
                        Payee
                    </th>
                    <th class="px-2 py-2 font-medium">Category</th>
                    <th class="px-2 py-2 font-medium">Memo</th>
                    <th class="px-2 py-2 text-right font-medium">Outflow</th>
                    <th class="px-2 py-2 text-right font-medium">Inflow</th>
                    <th class="px-4 py-2 text-center font-medium">C</th>
                </tr>
            </thead>
            <tbody data-testid="register-table">
                <template v-for="group in dateGroups" :key="group.date">
                    <tr class="border-b bg-muted/40" data-testid="date-header">
                        <td
                            :colspan="columnCount"
                            class="px-4 py-1.5 text-xs font-medium text-muted-foreground"
                        >
                            {{ formatRegisterDate(group.date) }}
                        </td>
                    </tr>
                    <template v-for="row in group.rows" :key="rowKey(row)">
                        <tr
                            class="cursor-pointer border-b hover:bg-muted/50"
                            @click="openEdit(row)"
                        >
                            <td v-if="accountId === null" class="px-4 py-2">
                                {{
                                    accountsById.get(headOf(row).account_id)
                                        ?.name
                                }}
                            </td>
                            <td
                                class="py-2"
                                :class="accountId === null ? 'px-2' : 'px-4'"
                            >
                                {{ payeeLabel(row) }}
                            </td>
                            <td class="px-2 py-2 text-muted-foreground">
                                <button
                                    v-if="row.kind === 'split'"
                                    type="button"
                                    class="inline-flex items-center gap-1 hover:text-foreground"
                                    @click.stop="toggleExpanded(row.groupId)"
                                >
                                    <component
                                        :is="
                                            expandedGroups.has(row.groupId)
                                                ? ChevronDown
                                                : ChevronRight
                                        "
                                        class="size-3.5"
                                    />
                                    {{ categoryLabel(row) }}
                                </button>
                                <template v-else>{{
                                    categoryLabel(row)
                                }}</template>
                            </td>
                            <td
                                class="max-w-48 truncate px-2 py-2 text-muted-foreground"
                            >
                                {{ headOf(row).memo }}
                            </td>
                            <td class="px-2 py-2 text-right tabular-nums">
                                {{
                                    amountOf(row) < 0
                                        ? formatMoney(
                                              -amountOf(row),
                                              currencyOf(row),
                                          )
                                        : ''
                                }}
                            </td>
                            <td class="px-2 py-2 text-right tabular-nums">
                                {{
                                    amountOf(row) > 0
                                        ? formatMoney(
                                              amountOf(row),
                                              currencyOf(row),
                                          )
                                        : ''
                                }}
                            </td>
                            <td
                                class="px-4 py-2 text-center"
                                @click.stop="toggleCleared(row)"
                            >
                                <Lock
                                    v-if="headOf(row).cleared === 'reconciled'"
                                    class="inline size-4 text-muted-foreground"
                                />
                                <CheckCircle2
                                    v-else-if="
                                        headOf(row).cleared === 'cleared'
                                    "
                                    class="inline size-4 cursor-pointer text-green-600"
                                />
                                <Circle
                                    v-else
                                    class="inline size-4 cursor-pointer text-muted-foreground"
                                />
                            </td>
                        </tr>
                        <tr
                            v-for="member in row.kind === 'split' &&
                            expandedGroups.has(row.groupId)
                                ? row.members
                                : []"
                            :key="member.id"
                            class="border-b bg-muted/30 text-xs"
                        >
                            <td v-if="accountId === null" class="px-4 py-1.5" />
                            <td
                                class="py-1.5"
                                :class="accountId === null ? 'px-2' : 'px-4'"
                            />
                            <td class="px-2 py-1.5 pl-7 text-muted-foreground">
                                {{ categoryNameOf(member) }}
                            </td>
                            <td class="px-2 py-1.5" />
                            <td
                                class="px-2 py-1.5 text-right text-muted-foreground tabular-nums"
                            >
                                {{
                                    member.amount < 0
                                        ? formatMoney(
                                              -member.amount,
                                              currencyOf(row),
                                          )
                                        : ''
                                }}
                            </td>
                            <td
                                class="px-2 py-1.5 text-right text-muted-foreground tabular-nums"
                            >
                                {{
                                    member.amount > 0
                                        ? formatMoney(
                                              member.amount,
                                              currencyOf(row),
                                          )
                                        : ''
                                }}
                            </td>
                            <td class="px-4 py-1.5" />
                        </tr>
                    </template>
                </template>
            </tbody>
        </table>

        <!-- Mobile cards -->
        <div v-if="rows.length" class="sm:hidden" data-testid="register-cards">
            <template v-for="group in dateGroups" :key="group.date">
                <div
                    class="border-y bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground first:border-t-0"
                >
                    {{ formatRegisterDate(group.date) }}
                </div>
                <div
                    v-for="row in group.rows"
                    :key="rowKey(row)"
                    class="border-b last:border-b-0"
                >
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 px-4 py-3 text-left"
                        @click="openEdit(row)"
                    >
                        <span @click.stop="toggleCleared(row)">
                            <Lock
                                v-if="headOf(row).cleared === 'reconciled'"
                                class="size-5 text-muted-foreground"
                            />
                            <CheckCircle2
                                v-else-if="headOf(row).cleared === 'cleared'"
                                class="size-5 text-green-600"
                            />
                            <Circle
                                v-else
                                class="size-5 text-muted-foreground"
                            />
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium">{{
                                payeeLabel(row)
                            }}</span>
                            <span
                                class="block truncate text-xs text-muted-foreground"
                            >
                                <template v-if="accountId === null">{{
                                    accountsById.get(headOf(row).account_id)
                                        ?.name
                                }}</template>
                                <template
                                    v-if="
                                        accountId === null && categoryLabel(row)
                                    "
                                >
                                    ·
                                </template>
                                <template v-if="categoryLabel(row)">{{
                                    categoryLabel(row)
                                }}</template>
                            </span>
                        </span>
                        <span
                            class="text-sm font-medium tabular-nums"
                            :class="amountOf(row) > 0 ? 'text-green-600' : ''"
                        >
                            {{ formatMoney(amountOf(row), currencyOf(row)) }}
                        </span>
                    </button>
                </div>
            </template>
        </div>

        <TransactionFormDialog
            v-model:open="formOpen"
            :default-account-id="accountId"
            :transaction="editing"
        />
    </div>
</template>
