<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import type { Category } from '@/budget/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import MoneyInput from './MoneyInput.vue';

const RTA = '__rta__';

const props = defineProps<{
    month: string;
    categories: Category[];
    /** Prefilled source (null = Ready to Assign). */
    initialFromId: string | null;
    /** Prefilled destination (null = Ready to Assign). */
    initialToId: string | null;
    /** Suggested amount, e.g. the overspent gap. */
    suggestedMinor?: number | null;
    /** Available per category, to show context in the pickers. */
    availableByCategory: Record<string, number>;
    readyToAssignMinor: number;
}>();

const open = defineModel<boolean>('open', { default: false });

const { repo } = useBudget();

const fromId = ref<string>(RTA);
const toId = ref<string>(RTA);
const amountMinor = ref<number | null>(null);
const saving = ref(false);

watch(open, (isOpen) => {
    if (!isOpen) {
return;
}

    fromId.value = props.initialFromId ?? RTA;
    toId.value = props.initialToId ?? RTA;
    amountMinor.value = props.suggestedMinor && props.suggestedMinor > 0 ? props.suggestedMinor : null;
});

const options = computed(() => [
    { id: RTA, label: `Ready to Assign (${formatMoney(props.readyToAssignMinor, 'CAD')})` },
    ...props.categories.map((category) => ({
        id: category.id,
        label: `${category.name} (${formatMoney(props.availableByCategory[category.id] ?? 0, 'CAD')})`,
    })),
]);

const valid = computed(() => amountMinor.value !== null && amountMinor.value > 0 && fromId.value !== toId.value);

async function save() {
    if (!valid.value) {
return;
}

    saving.value = true;

    try {
        await repo.moveMoney({
            fromCategoryId: fromId.value === RTA ? null : fromId.value,
            toCategoryId: toId.value === RTA ? null : toId.value,
            month: props.month,
            amountMinor: amountMinor.value!,
        });
        open.value = false;
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-sm">
            <DialogHeader>
                <DialogTitle>Move money</DialogTitle>
                <DialogDescription>Shift assigned money between categories for {{ month }}.</DialogDescription>
            </DialogHeader>

            <form class="space-y-4" @submit.prevent="save">
                <div class="grid gap-2">
                    <Label>From</Label>
                    <Select v-model="fromId">
                        <SelectTrigger class="w-full" data-testid="move-from">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="option in options" :key="option.id" :value="option.id">{{ option.label }}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="grid gap-2">
                    <Label>To</Label>
                    <Select v-model="toId">
                        <SelectTrigger class="w-full" data-testid="move-to">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="option in options" :key="option.id" :value="option.id">{{ option.label }}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="grid gap-2">
                    <Label for="move-amount">Amount (CAD)</Label>
                    <MoneyInput id="move-amount" v-model="amountMinor" data-testid="move-amount" currency="CAD" sign="positive" />
                </div>

                <DialogFooter class="gap-2">
                    <Button type="button" variant="secondary" @click="open = false">Cancel</Button>
                    <Button type="submit" data-testid="move-save" :disabled="saving || !valid">Move</Button>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
