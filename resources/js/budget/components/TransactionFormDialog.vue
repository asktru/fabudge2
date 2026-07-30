<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { today } from '@/budget/clock';
import { useBudget } from '@/budget/context';
import {
    buildSubmission,
    emptyFormState,
    needsOtherSideAmount
    
    
} from '@/budget/transactionFormModel';
import type {PayeeSelection, TransactionFormState} from '@/budget/transactionFormModel';
import type { Account, Category, Payee, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import MoneyInput from './MoneyInput.vue';
import SimpleCombobox from './SimpleCombobox.vue';
import type {ComboboxItem} from './SimpleCombobox.vue';

const props = defineProps<{
    /** Account preselected for new transactions (register context). */
    defaultAccountId: string | null;
    /** When set, the dialog edits this transaction. */
    transaction: Transaction | null;
}>();

const open = defineModel<boolean>('open', { default: false });

const { db, repo } = useBudget();
const isDesktop = useMediaQuery('(min-width: 640px)');

const accounts = useLive<Account[]>(() => db.accounts.toArray(), []);
const payees = useLive<Payee[]>(() => db.payees.toArray(), []);
const categories = useLive<Category[]>(() => db.categories.toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);

const liveAccounts = computed(() => accounts.value.filter((account) => account.deleted_at === null));

const state = ref<TransactionFormState>(emptyFormState(null, today()));
const payeeText = ref('');
const categoryText = ref('');
const error = ref<string | null>(null);
const saving = ref(false);

const editingTransfer = computed(() => props.transaction?.transfer_pair_id != null);

const selectedAccount = computed(() => liveAccounts.value.find((account) => account.id === state.value.accountId) ?? null);
const currency = computed(() => selectedAccount.value?.currency ?? 'CAD');

const transferTarget = computed(() =>
    state.value.payee?.kind === 'transfer'
        ? (liveAccounts.value.find((account) => account.id === (state.value.payee as { accountId: string }).accountId) ?? null)
        : null,
);

const needsOtherSide = computed(() => needsOtherSideAmount(state.value, liveAccounts.value));

/** Payees ordered by most recent use; transfer targets first. */
const payeeItems = computed<ComboboxItem[]>(() => {
    const lastUse = new Map<string, string>();

    for (const transaction of transactions.value) {
        if (transaction.payee_id && transaction.deleted_at === null) {
            const existing = lastUse.get(transaction.payee_id);

            if (!existing || transaction.date > existing) {
                lastUse.set(transaction.payee_id, transaction.date);
            }
        }
    }

    const payeeEntries = payees.value
        .filter((payee) => payee.deleted_at === null)
        .sort((a, b) => (lastUse.get(b.id) ?? '').localeCompare(lastUse.get(a.id) ?? '') || a.name.localeCompare(b.name))
        .map((payee) => ({ value: `payee:${payee.id}`, label: payee.name, group: 'Payees' }));

    const transferEntries = liveAccounts.value
        .filter((account) => account.id !== state.value.accountId)
        .map((account) => ({ value: `transfer:${account.id}`, label: `Transfer: ${account.name}`, group: 'Transfers' }));

    return [...transferEntries, ...payeeEntries];
});

const categoryItems = computed<ComboboxItem[]>(() =>
    categories.value
        .filter((category) => category.deleted_at === null)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((category) => ({ value: category.id, label: category.name })),
);

watch(open, (isOpen) => {
    if (!isOpen) {
        return;
    }

    error.value = null;

    if (props.transaction) {
        const transaction = props.transaction;
        const payee = payees.value.find((candidate) => candidate.id === transaction.payee_id);
        let selection: PayeeSelection | null = payee ? { kind: 'payee', id: payee.id, name: payee.name } : null;
        let label = payee?.name ?? '';

        if (transaction.transfer_pair_id) {
            const pairLeg = transactions.value.find(
                (candidate) => candidate.transfer_pair_id === transaction.transfer_pair_id && candidate.id !== transaction.id,
            );
            const pairAccount = accounts.value.find((account) => account.id === pairLeg?.account_id);
            selection = pairAccount ? { kind: 'transfer', accountId: pairAccount.id } : null;
            label = pairAccount ? `Transfer: ${pairAccount.name}` : 'Transfer';
        }

        state.value = {
            accountId: transaction.account_id,
            date: transaction.date,
            payee: selection,
            outflowMinor: transaction.amount < 0 ? -transaction.amount : null,
            inflowMinor: transaction.amount > 0 ? transaction.amount : null,
            otherSideMinor: null,
            categoryId: transaction.category_id,
            memo: transaction.memo ?? '',
            cleared: transaction.cleared !== 'uncleared',
        };
        payeeText.value = label;
        categoryText.value = categories.value.find((category) => category.id === transaction.category_id)?.name ?? '';
    } else {
        state.value = emptyFormState(props.defaultAccountId ?? liveAccounts.value[0]?.id ?? null, today());
        payeeText.value = '';
        categoryText.value = '';
    }
});

function onPayeeSelect(item: ComboboxItem) {
    const [kind, id] = item.value.split(':');

    if (kind === 'transfer') {
        state.value.payee = { kind: 'transfer', accountId: id };
        state.value.categoryId = null;
        categoryText.value = '';
    } else {
        state.value.payee = { kind: 'payee', id, name: item.label };
    }
}

function onPayeeCreate(name: string) {
    state.value.payee = { kind: 'payee', id: null, name };
}

function onPayeeTextChange(value: string) {
    // Typing free text after a selection reverts to "create by name" semantics.
    if (value.trim() === '') {
        state.value.payee = null;
    } else if (state.value.payee && state.value.payee.kind === 'payee' && state.value.payee.name !== value.trim()) {
        state.value.payee = { kind: 'payee', id: null, name: value.trim() };
    } else if (!state.value.payee) {
        state.value.payee = { kind: 'payee', id: null, name: value.trim() };
    }
}

async function save() {
    error.value = null;

    if (props.transaction) {
        await saveEdit();

        return;
    }

    const submission = buildSubmission(state.value, liveAccounts.value);

    if ('error' in submission) {
        error.value = submission.error;

        return;
    }

    saving.value = true;

    try {
        if (submission.kind === 'transfer') {
            await repo.createTransfer(submission.input);
        } else {
            await repo.createTransaction(submission.input);
        }

        open.value = false;
    } finally {
        saving.value = false;
    }
}

async function saveEdit() {
    const transaction = props.transaction!;
    const amount = state.value.outflowMinor ? -state.value.outflowMinor : state.value.inflowMinor;

    if (!amount) {
        error.value = 'Enter an amount';

        return;
    }

    saving.value = true;

    try {
        if (transaction.transfer_pair_id) {
            await repo.updateTransaction(transaction.id, {
                date: state.value.date,
                memo: state.value.memo || null,
                amount,
                cleared: state.value.cleared ? 'cleared' : 'uncleared',
            });
        } else {
            const payee = state.value.payee;
            const payeeId =
                payee?.kind === 'payee' ? (payee.id ?? (payee.name ? (await repo.resolvePayee(payee.name)).id : null)) : null;

            await repo.updateTransaction(transaction.id, {
                date: state.value.date,
                amount,
                payee_id: payeeId,
                category_id: state.value.categoryId,
                memo: state.value.memo || null,
                cleared: state.value.cleared ? 'cleared' : 'uncleared',
            });
        }

        open.value = false;
    } finally {
        saving.value = false;
    }
}

async function remove() {
    if (!props.transaction) {
        return;
    }

    saving.value = true;

    try {
        await repo.deleteTransaction(props.transaction.id);
        open.value = false;
    } finally {
        saving.value = false;
    }
}

const otherSideLabel = computed(() => {
    if (!transferTarget.value) {
        return '';
    }

    const receiving = state.value.outflowMinor !== null;
    const target = transferTarget.value;

    return receiving ? `Arrives in ${target.name} (${target.currency})` : `Leaves ${target.name} (${target.currency})`;
});

// Re-parse the inactive amount field to keep outflow/inflow mutually exclusive.
function onOutflowChange(value: number | null) {
    if (value !== null) {
        state.value.inflowMinor = null;
    }
}

function onInflowChange(value: number | null) {
    if (value !== null) {
        state.value.outflowMinor = null;
    }
}
</script>

<template>
    <component :is="isDesktop ? Dialog : Sheet" v-model:open="open">
        <component :is="isDesktop ? DialogContent : SheetContent" :side="isDesktop ? undefined : 'bottom'" class="sm:max-w-lg" :class="isDesktop ? '' : 'max-h-[90dvh] overflow-y-auto pb-6'">
            <component :is="isDesktop ? DialogHeader : SheetHeader">
                <component :is="isDesktop ? DialogTitle : SheetTitle">
                    {{ transaction ? 'Edit transaction' : 'Add transaction' }}
                </component>
            </component>

            <form class="space-y-4" :class="isDesktop ? '' : 'px-4'" @submit.prevent="save">
                <div class="grid grid-cols-2 gap-4">
                    <div class="grid gap-2">
                        <Label>Account</Label>
                        <Select v-model="state.accountId" :disabled="!!transaction">
                            <SelectTrigger data-testid="txn-account" class="w-full">
                                <SelectValue placeholder="Account" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="account in liveAccounts" :key="account.id" :value="account.id">
                                    {{ account.name }} ({{ account.currency }})
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div class="grid gap-2">
                        <Label for="txn-date">Date</Label>
                        <Input id="txn-date" v-model="state.date" data-testid="txn-date" type="date" required />
                    </div>
                </div>

                <div class="grid gap-2">
                    <Label for="txn-payee">Payee</Label>
                    <SimpleCombobox
                        id="txn-payee"
                        v-model="payeeText"
                        data-testid="txn-payee"
                        :items="payeeItems"
                        :allow-create="!editingTransfer"
                        placeholder="Payee or Transfer: Account"
                        :create-label="(query) => `New payee “${query}”`"
                        @select="onPayeeSelect"
                        @create="onPayeeCreate"
                        @update:model-value="onPayeeTextChange"
                    />
                </div>

                <div v-if="state.payee?.kind !== 'transfer'" class="grid gap-2">
                    <Label for="txn-category">Category</Label>
                    <SimpleCombobox
                        id="txn-category"
                        v-model="categoryText"
                        data-testid="txn-category"
                        :items="categoryItems"
                        placeholder="Category (optional)"
                        @select="(item) => (state.categoryId = item.value)"
                        @update:model-value="(value) => { if (!value.trim()) state.categoryId = null; }"
                    />
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="grid gap-2">
                        <Label for="txn-outflow">Outflow</Label>
                        <MoneyInput
                            id="txn-outflow"
                            :model-value="state.outflowMinor"
                            data-testid="txn-outflow"
                            :currency="currency"
                            sign="positive"
                            @update:model-value="(value) => { state.outflowMinor = value; onOutflowChange(value); }"
                        />
                    </div>
                    <div class="grid gap-2">
                        <Label for="txn-inflow">Inflow</Label>
                        <MoneyInput
                            id="txn-inflow"
                            :model-value="state.inflowMinor"
                            data-testid="txn-inflow"
                            :currency="currency"
                            sign="positive"
                            @update:model-value="(value) => { state.inflowMinor = value; onInflowChange(value); }"
                        />
                    </div>
                </div>

                <div v-if="needsOtherSide && !transaction" class="grid gap-2">
                    <Label for="txn-other-side">{{ otherSideLabel }}</Label>
                    <MoneyInput
                        id="txn-other-side"
                        v-model="state.otherSideMinor"
                        data-testid="txn-other-side"
                        :currency="transferTarget?.currency ?? 'CAD'"
                        sign="positive"
                    />
                </div>

                <div class="grid gap-2">
                    <Label for="txn-memo">Memo</Label>
                    <Input id="txn-memo" v-model="state.memo" data-testid="txn-memo" placeholder="Optional note" />
                </div>

                <label class="flex items-center gap-2 text-sm">
                    <Checkbox v-model="state.cleared" data-testid="txn-cleared" />
                    Cleared
                </label>

                <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

                <div class="flex items-center justify-between gap-2 pt-2">
                    <Button v-if="transaction" type="button" variant="ghost" class="text-destructive" :disabled="saving" @click="remove">
                        Delete
                    </Button>
                    <div class="ml-auto flex gap-2">
                        <Button type="button" variant="secondary" @click="open = false">Cancel</Button>
                        <Button type="submit" data-testid="txn-save" :disabled="saving">Save</Button>
                    </div>
                </div>
            </form>
        </component>
    </component>
</template>
