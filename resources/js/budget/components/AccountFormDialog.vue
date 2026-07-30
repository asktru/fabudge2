<script setup lang="ts">
import { ref, watch } from 'vue';
import { today } from '@/budget/clock';
import { useBudget } from '@/budget/context';
import type { Account, AccountType } from '@/budget/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import MoneyInput from './MoneyInput.vue';

const props = defineProps<{
    /** null = create mode */
    account: Account | null;
}>();

const open = defineModel<boolean>('open', { default: false });

const { repo } = useBudget();

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
    { value: 'chequing', label: 'Chequing' },
    { value: 'savings', label: 'Savings' },
    { value: 'cash', label: 'Cash' },
    { value: 'credit_card', label: 'Credit card' },
];

const CURRENCIES = ['CAD', 'USD', 'UAH'];

const name = ref('');
const type = ref<AccountType>('chequing');
const currency = ref('CAD');
const customCurrency = ref('');
const onBudget = ref(true);
const startingBalance = ref<number | null>(null);
const saving = ref(false);
const confirmingClose = ref(false);

watch(open, (isOpen) => {
    if (!isOpen) {
return;
}

    confirmingClose.value = false;
    name.value = props.account?.name ?? '';
    type.value = props.account?.type ?? 'chequing';
    onBudget.value = props.account?.on_budget ?? true;
    startingBalance.value = null;

    const accountCurrency = props.account?.currency ?? 'CAD';
    currency.value = CURRENCIES.includes(accountCurrency) ? accountCurrency : 'other';
    customCurrency.value = CURRENCIES.includes(accountCurrency) ? '' : accountCurrency;
});

async function save() {
    const resolvedCurrency = (currency.value === 'other' ? customCurrency.value : currency.value).trim().toUpperCase();

    if (!name.value.trim() || resolvedCurrency.length !== 3) {
return;
}

    saving.value = true;

    try {
        if (props.account) {
            await repo.updateAccount(props.account.id, {
                name: name.value,
                type: type.value,
                on_budget: onBudget.value,
            });
        } else {
            await repo.createAccount({
                name: name.value,
                currency: resolvedCurrency,
                type: type.value,
                on_budget: onBudget.value,
                startingBalanceMinor: startingBalance.value ?? undefined,
                startingDate: today(),
            });
        }

        open.value = false;
    } finally {
        saving.value = false;
    }
}

async function closeAccount() {
    if (!props.account) {
return;
}

    saving.value = true;

    try {
        await repo.closeAccount(props.account.id);
        open.value = false;
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>{{ account ? 'Edit account' : 'Add account' }}</DialogTitle>
                <DialogDescription>
                    {{ account ? 'Rename, retype, or close this account.' : 'Track a bank account, card, or cash.' }}
                </DialogDescription>
            </DialogHeader>

            <form class="space-y-4" @submit.prevent="save">
                <div class="grid gap-2">
                    <Label for="account-name">Name</Label>
                    <Input id="account-name" v-model="name" data-testid="account-name" placeholder="Chequing" required />
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="grid gap-2">
                        <Label>Type</Label>
                        <Select v-model="type">
                            <SelectTrigger data-testid="account-type" class="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="option in ACCOUNT_TYPES" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div v-if="!account" class="grid gap-2">
                        <Label>Currency</Label>
                        <Select v-model="currency">
                            <SelectTrigger data-testid="account-currency" class="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="code in CURRENCIES" :key="code" :value="code">{{ code }}</SelectItem>
                                <SelectItem value="other">Other…</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            v-if="currency === 'other'"
                            v-model="customCurrency"
                            placeholder="EUR"
                            maxlength="3"
                            class="uppercase"
                        />
                    </div>
                </div>

                <label class="flex items-center gap-2 text-sm">
                    <Checkbox v-model="onBudget" />
                    On budget (money you plan with)
                </label>

                <div v-if="!account" class="grid gap-2">
                    <Label for="starting-balance">Starting balance (optional)</Label>
                    <MoneyInput
                        id="starting-balance"
                        v-model="startingBalance"
                        data-testid="starting-balance"
                        :currency="currency === 'other' ? customCurrency || 'CAD' : currency"
                    />
                </div>

                <DialogFooter class="gap-2 sm:justify-between">
                    <div v-if="account">
                        <Button v-if="!confirmingClose" type="button" variant="ghost" class="text-destructive" @click="confirmingClose = true">
                            Close account…
                        </Button>
                        <Button v-else type="button" variant="destructive" :disabled="saving" @click="closeAccount">
                            Really close &amp; delete transactions
                        </Button>
                    </div>
                    <div class="flex gap-2">
                        <Button type="button" variant="secondary" @click="open = false">Cancel</Button>
                        <Button type="submit" data-testid="account-save" :disabled="saving">
                            {{ account ? 'Save' : 'Add account' }}
                        </Button>
                    </div>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
