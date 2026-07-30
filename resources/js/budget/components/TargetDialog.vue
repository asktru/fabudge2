<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { addMonths } from '@/budget/budgetMath';
import { useBudget } from '@/budget/context';
import type { Category, Target, TargetType } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import MoneyInput from './MoneyInput.vue';

const props = defineProps<{
    category: Category | null;
    /** Month currently shown in the plan (default due month suggestions). */
    month: string;
}>();

const open = defineModel<boolean>('open', { default: false });

const { db, repo } = useBudget();
const targets = useLive<Target[]>(() => db.targets.toArray(), []);

const existing = computed(
    () => targets.value.find((candidate) => candidate.category_id === props.category?.id && candidate.deleted_at === null) ?? null,
);

const type = ref<TargetType>('monthly');
const amountMinor = ref<number | null>(null);
const dueMonth = ref('');
const saving = ref(false);

watch(open, (isOpen) => {
    if (!isOpen) {
return;
}

    type.value = existing.value?.type ?? 'monthly';
    amountMinor.value = existing.value?.amount ?? null;
    dueMonth.value = existing.value?.due_month ?? addMonths(props.month, 5);
});

const TYPE_LABELS: { value: TargetType; label: string; hint: string }[] = [
    { value: 'monthly', label: 'Set aside monthly', hint: 'Assign this amount every month.' },
    { value: 'by_date', label: 'Save by date', hint: 'Accumulate this amount by the chosen month.' },
    { value: 'refill', label: 'Refill up to', hint: 'Top the available back up to this amount each month.' },
];

const hint = computed(() => TYPE_LABELS.find((entry) => entry.value === type.value)?.hint ?? '');

async function save() {
    if (!props.category || !amountMinor.value || amountMinor.value <= 0) {
return;
}

    saving.value = true;

    try {
        await repo.setTarget(props.category.id, {
            type: type.value,
            amountMinor: amountMinor.value,
            dueMonth: type.value === 'by_date' ? dueMonth.value : null,
        });
        open.value = false;
    } finally {
        saving.value = false;
    }
}

async function remove() {
    if (!props.category) {
return;
}

    saving.value = true;

    try {
        await repo.clearTarget(props.category.id);
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
                <DialogTitle>Target for {{ category?.name }}</DialogTitle>
                <DialogDescription>{{ hint }}</DialogDescription>
            </DialogHeader>

            <form class="space-y-4" @submit.prevent="save">
                <div class="grid gap-2">
                    <Label>Type</Label>
                    <Select v-model="type">
                        <SelectTrigger class="w-full" data-testid="target-type">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="entry in TYPE_LABELS" :key="entry.value" :value="entry.value">
                                {{ entry.label }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div class="grid gap-2">
                    <Label for="target-amount">Amount (CAD)</Label>
                    <MoneyInput id="target-amount" v-model="amountMinor" data-testid="target-amount" currency="CAD" sign="positive" />
                </div>

                <div v-if="type === 'by_date'" class="grid gap-2">
                    <Label for="target-due">By month</Label>
                    <Input id="target-due" v-model="dueMonth" data-testid="target-due" type="month" :min="month" required />
                </div>

                <DialogFooter class="gap-2 sm:justify-between">
                    <Button v-if="existing" type="button" variant="ghost" class="text-destructive" :disabled="saving" @click="remove">
                        Remove target
                    </Button>
                    <div class="ml-auto flex gap-2">
                        <Button type="button" variant="secondary" @click="open = false">Cancel</Button>
                        <Button type="submit" data-testid="target-save" :disabled="saving || !amountMinor">Save</Button>
                    </div>
                </DialogFooter>
            </form>
        </DialogContent>
    </Dialog>
</template>
