<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { Mic } from '@lucide/vue';
import { useGeolocation, useMediaQuery } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { today } from '@/budget/clock';
import { useBudget } from '@/budget/context';
import { parseDictation  } from '@/budget/dictation';
import type {ParsedDictation} from '@/budget/dictation';
import { hasNearbyAssociation, nearbyPayeeIds  } from '@/budget/locations';
import type {Coordinates} from '@/budget/locations';
import { formatAmount } from '@/budget/money';
import type { SplitLine } from '@/budget/repo';
import { suggestCategory } from '@/budget/suggestions';
import {
    buildSubmission,
    emptyFormState,
    needsOtherSideAmount
    
    
} from '@/budget/transactionFormModel';
import type {PayeeSelection, TransactionFormState} from '@/budget/transactionFormModel';
import type { Account, Category, Payee, PayeeLocation, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { useSpeech } from '@/budget/useSpeech';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { parse as dictationParse } from '@/routes/dictation';
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
const payeeLocations = useLive<PayeeLocation[]>(() => db.payee_locations.toArray(), []);

// Device position for location-aware payee suggestions; degrades silently
// when permission is denied or unavailable.
const geolocation = useGeolocation({ enableHighAccuracy: false, immediate: false });

const currentCoords = computed<Coordinates | null>(() => {
    const { latitude, longitude } = geolocation.coords.value;

    return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0
        ? { latitude, longitude }
        : null;
});

const rememberLocation = ref(false);

// ——— Voice dictation ———

const page = usePage();
const dictating = ref(false);

const speech = useSpeech((transcript) => {
    void applyDictation(transcript);
});

async function applyDictation(transcript: string) {
    dictating.value = true;

    try {
        const teamSlug = page.props.currentTeam!.slug;
        const parsed = await parseDictation(
            transcript,
            {
                accounts: liveAccounts.value.map((account) => account.name),
                categories: categories.value.filter((category) => category.deleted_at === null).map((category) => category.name),
                payees: payees.value.filter((payee) => payee.deleted_at === null).map((payee) => payee.name),
                today: today(),
            },
            dictationParse.url(teamSlug),
        );

        if (parsed) {
            fillFromDictation(parsed);
        }
    } finally {
        dictating.value = false;
    }
}

function fillFromDictation(parsed: ParsedDictation) {
    if (parsed.type === 'expense') {
        state.value.outflowMinor = parsed.amountMinor;
        state.value.inflowMinor = null;
    } else {
        state.value.inflowMinor = parsed.amountMinor;
        state.value.outflowMinor = null;
    }

    if (parsed.account) {
        const account = liveAccounts.value.find((candidate) => candidate.name.toLowerCase() === parsed.account!.toLowerCase());

        if (account) {
            state.value.accountId = account.id;
        }
    }

    if (parsed.payee) {
        const known = payees.value.find(
            (candidate) => candidate.deleted_at === null && candidate.name.toLowerCase() === parsed.payee!.toLowerCase(),
        );
        state.value.payee = known ? { kind: 'payee', id: known.id, name: known.name } : { kind: 'payee', id: null, name: parsed.payee };
        payeeText.value = known?.name ?? parsed.payee;
    }

    if (parsed.category) {
        const category = categories.value.find(
            (candidate) => candidate.deleted_at === null && candidate.name.toLowerCase() === parsed.category!.toLowerCase(),
        );

        if (category) {
            state.value.categoryId = category.id;
            categoryText.value = category.name;
        }
    }

    if (parsed.date) {
        state.value.date = parsed.date;
    }

    if (parsed.memo) {
        state.value.memo = parsed.memo;
    }
}

const canRememberLocation = computed(
    () =>
        currentCoords.value !== null &&
        state.value.payee?.kind === 'payee' &&
        !props.transaction &&
        (state.value.payee.id === null || !hasNearbyAssociation(state.value.payee.id, currentCoords.value, payeeLocations.value)),
);
const categories = useLive<Category[]>(() => db.categories.toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);

const liveAccounts = computed(() => accounts.value.filter((account) => account.deleted_at === null));

const state = ref<TransactionFormState>(emptyFormState(null, today()));
const payeeText = ref('');
const categoryText = ref('');
const error = ref<string | null>(null);
const saving = ref(false);

const editingTransfer = computed(() => props.transaction?.transfer_pair_id != null);
const editingSplit = computed(() => props.transaction?.split_group_id != null);

interface SplitLineDraft {
    categoryId: string | null;
    categoryText: string;
    /** Positive minor units; sign comes from the outflow/inflow choice. */
    amountMinor: number | null;
}

const splitMode = ref(false);
const splitLines = ref<SplitLineDraft[]>([]);

const splitMembers = computed(() =>
    props.transaction?.split_group_id
        ? transactions.value
              .filter((candidate) => candidate.split_group_id === props.transaction!.split_group_id && candidate.deleted_at === null)
              .sort((a, b) => a.id.localeCompare(b.id))
        : [],
);

const splitTotalMinor = computed(() => state.value.outflowMinor ?? state.value.inflowMinor ?? 0);

const splitAssignedMinor = computed(() => splitLines.value.reduce((sum, line) => sum + (line.amountMinor ?? 0), 0));

const splitRemainderMinor = computed(() => splitTotalMinor.value - splitAssignedMinor.value);

function enterSplitMode() {
    splitMode.value = true;

    if (splitLines.value.length === 0) {
        splitLines.value = [
            { categoryId: state.value.categoryId, categoryText: categoryText.value, amountMinor: splitTotalMinor.value || null },
            { categoryId: null, categoryText: '', amountMinor: null },
        ];
    }
}

function addSplitLine() {
    splitLines.value.push({ categoryId: null, categoryText: '', amountMinor: splitRemainderMinor.value > 0 ? splitRemainderMinor.value : null });
}

function removeSplitLine(index: number) {
    splitLines.value.splice(index, 1);

    if (splitLines.value.length === 0) {
        splitMode.value = false;
    }
}

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

    const livePayees = payees.value.filter((payee) => payee.deleted_at === null);

    // Payees associated with a spot near the current position jump to the top.
    const nearbyIds = currentCoords.value ? nearbyPayeeIds(currentCoords.value, payeeLocations.value) : [];
    const nearbySet = new Set(nearbyIds);

    const nearbyEntries = nearbyIds
        .map((payeeId) => livePayees.find((payee) => payee.id === payeeId))
        .filter((payee): payee is Payee => !!payee)
        .map((payee) => ({ value: `payee:${payee.id}`, label: payee.name, group: '📍 Nearby' }));

    const payeeEntries = livePayees
        .filter((payee) => !nearbySet.has(payee.id))
        .sort((a, b) => (lastUse.get(b.id) ?? '').localeCompare(lastUse.get(a.id) ?? '') || a.name.localeCompare(b.name))
        .map((payee) => ({ value: `payee:${payee.id}`, label: payee.name, group: 'Payees' }));

    const transferEntries = liveAccounts.value
        .filter((account) => account.id !== state.value.accountId)
        .map((account) => ({ value: `transfer:${account.id}`, label: `Transfer: ${account.name}`, group: 'Transfers' }));

    return [...nearbyEntries, ...transferEntries, ...payeeEntries];
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
    splitMode.value = false;
    splitLines.value = [];
    rememberLocation.value = false;
    geolocation.resume();

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

        if (transaction.split_group_id) {
            const members = splitMembers.value;
            const total = members.reduce((sum, member) => sum + member.amount, 0);
            state.value.outflowMinor = total < 0 ? -total : null;
            state.value.inflowMinor = total > 0 ? total : null;
            splitMode.value = true;
            splitLines.value = members.map((member) => ({
                categoryId: member.category_id,
                categoryText: categories.value.find((category) => category.id === member.category_id)?.name ?? '',
                amountMinor: Math.abs(member.amount),
            }));
        }
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
        rememberLocation.value = canRememberLocation.value;

        // Convenience: prefill the category from this payee's latest use.
        if (state.value.categoryId === null && !splitMode.value) {
            const suggested = suggestCategory(id, transactions.value);

            if (suggested) {
                state.value.categoryId = suggested;
                categoryText.value = categories.value.find((category) => category.id === suggested)?.name ?? '';
            }
        }
    }
}

function onPayeeCreate(name: string) {
    state.value.payee = { kind: 'payee', id: null, name };
    rememberLocation.value = canRememberLocation.value;
}

/** After a successful save, persist the payee↔location association if requested. */
async function maybeRememberLocation(payeeId: string | null) {
    const coords = currentCoords.value;

    if (!rememberLocation.value || !coords || !payeeId || hasNearbyAssociation(payeeId, coords, payeeLocations.value)) {
        return;
    }

    await repo.addPayeeLocation(payeeId, coords.latitude, coords.longitude);
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

/** Validate split lines against the entered total; returns signed lines or an error. */
function buildSplitLines(minLines = 2): SplitLine[] | { error: string } {
    if (splitTotalMinor.value <= 0) {
        return { error: 'Enter the total amount' };
    }

    const lines = splitLines.value.filter((line) => line.amountMinor !== null && line.amountMinor !== 0);

    if (lines.length < minLines) {
        return { error: 'A split needs at least two lines' };
    }

    if (splitRemainderMinor.value !== 0) {
        return { error: `Split lines must add up to the total (${formatAmount(splitRemainderMinor.value, currency.value)} left)` };
    }

    const sign = state.value.outflowMinor !== null ? -1 : 1;

    return lines.map((line) => ({ category_id: line.categoryId, amountMinor: sign * line.amountMinor! }));
}

async function save() {
    error.value = null;

    if (splitMode.value && !props.transaction) {
        const lines = buildSplitLines();

        if ('error' in lines) {
            error.value = lines.error;

            return;
        }

        if (state.value.accountId === null) {
            error.value = 'Choose an account';

            return;
        }

        saving.value = true;

        try {
            const payee = state.value.payee;
            const rows = await repo.createSplit({
                account_id: state.value.accountId,
                date: state.value.date,
                payee_id: payee?.kind === 'payee' ? payee.id : null,
                payeeName: payee?.kind === 'payee' && payee.id === null ? payee.name : null,
                memo: state.value.memo || null,
                cleared: state.value.cleared ? 'cleared' : 'uncleared',
                lines,
            });
            await maybeRememberLocation(rows[0]?.payee_id ?? null);
            open.value = false;
        } finally {
            saving.value = false;
        }

        return;
    }

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
            const created = await repo.createTransaction(submission.input);
            await maybeRememberLocation(created.payee_id);
        }

        open.value = false;
    } finally {
        saving.value = false;
    }
}

async function saveEdit() {
    const transaction = props.transaction!;

    if (transaction.split_group_id) {
        const lines = buildSplitLines(1);

        if ('error' in lines) {
            error.value = lines.error;

            return;
        }

        saving.value = true;

        try {
            const payee = state.value.payee;
            const payeeId =
                payee?.kind === 'payee' ? (payee.id ?? (payee.name ? (await repo.resolvePayee(payee.name)).id : null)) : null;

            await repo.updateSplitGroup(transaction.split_group_id, {
                date: state.value.date,
                memo: state.value.memo || null,
                payee_id: payeeId,
                cleared: state.value.cleared ? 'cleared' : 'uncleared',
            });
            await repo.replaceSplitLines(transaction.split_group_id, lines);
            open.value = false;
        } finally {
            saving.value = false;
        }

        return;
    }

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
                <component :is="isDesktop ? DialogTitle : SheetTitle" class="flex items-center gap-2">
                    {{ transaction ? 'Edit transaction' : 'Add transaction' }}
                    <button
                        v-if="speech.supported && !transaction"
                        type="button"
                        class="inline-flex size-7 items-center justify-center rounded-full transition-colors"
                        :class="speech.listening.value ? 'animate-pulse bg-red-500/15 text-red-500' : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
                        :title="speech.listening.value ? 'Stop dictation' : 'Dictate transaction'"
                        data-testid="txn-dictate"
                        @click="speech.listening.value ? speech.stop() : speech.start()"
                    >
                        <Mic class="size-4" />
                    </button>
                    <span v-if="dictating" class="text-xs font-normal text-muted-foreground">Parsing…</span>
                </component>
            </component>

            <p v-if="speech.interim.value" class="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground" :class="isDesktop ? '' : 'mx-4'">
                “{{ speech.interim.value }}”
            </p>

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

                <div v-if="state.payee?.kind !== 'transfer' && !splitMode" class="grid gap-2">
                    <div class="flex items-center justify-between">
                        <Label for="txn-category">Category</Label>
                        <button
                            v-if="!editingTransfer"
                            type="button"
                            class="text-xs text-muted-foreground underline-offset-2 hover:underline"
                            data-testid="txn-split-toggle"
                            @click="enterSplitMode"
                        >
                            Split into categories
                        </button>
                    </div>
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

                <div v-if="splitMode" class="space-y-2 rounded-md border p-3">
                    <div class="flex items-center justify-between text-sm font-medium">
                        <span>Split{{ editingSplit ? ` (${splitLines.length} lines)` : '' }}</span>
                        <span
                            class="text-xs tabular-nums"
                            :class="splitRemainderMinor === 0 ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-500'"
                            data-testid="split-remainder"
                        >
                            {{ formatAmount(splitRemainderMinor, currency) }} left to assign
                        </span>
                    </div>

                    <div v-for="(line, index) in splitLines" :key="index" class="flex items-center gap-2">
                        <div class="flex-1">
                            <SimpleCombobox
                                v-model="line.categoryText"
                                :items="categoryItems"
                                placeholder="Category"
                                @select="(item) => (line.categoryId = item.value)"
                                @update:model-value="(value) => { if (!value.trim()) line.categoryId = null; }"
                            />
                        </div>
                        <div class="w-28">
                            <MoneyInput v-model="line.amountMinor" :currency="currency" sign="positive" />
                        </div>
                        <Button type="button" variant="ghost" size="icon" class="size-8 shrink-0" @click="removeSplitLine(index)">✕</Button>
                    </div>

                    <Button type="button" variant="secondary" size="sm" data-testid="split-add-line" @click="addSplitLine">
                        Add line
                    </Button>
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

                <label v-if="canRememberLocation" class="flex items-center gap-2 text-sm">
                    <Checkbox v-model="rememberLocation" data-testid="txn-remember-location" />
                    <span>
                        Remember this location for
                        <span class="font-medium">{{ state.payee?.kind === 'payee' ? state.payee.name : '' }}</span>
                    </span>
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
