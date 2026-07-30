<script setup lang="ts">
import { ref, watch } from 'vue';
import { formatAmount, parseAmount } from '@/budget/money';
import { Input } from '@/components/ui/input';

const props = defineProps<{
    currency: string;
    placeholder?: string;
    id?: string;
    /** Force sign: 'negative' turns any entry into an outflow, 'positive' into an inflow. */
    sign?: 'negative' | 'positive';
}>();

const model = defineModel<number | null>({ default: null });

const text = ref(model.value === null ? '' : formatAmount(model.value, props.currency));

watch(model, (value) => {
    const parsed = parseAmount(text.value, props.currency);

    if (value === null) {
        if (text.value !== '') {
text.value = '';
}
    } else if (parsed === null || applySign(parsed) !== value) {
        text.value = formatAmount(value, props.currency);
    }
});

function applySign(amount: number): number {
    if (props.sign === 'negative') {
return -Math.abs(amount);
}

    if (props.sign === 'positive') {
return Math.abs(amount);
}

    return amount;
}

function onInput(value: string | number) {
    text.value = String(value);
    const parsed = parseAmount(text.value, props.currency);
    model.value = parsed === null ? null : applySign(parsed);
}

function onBlur() {
    if (model.value !== null) {
        text.value = formatAmount(props.sign ? Math.abs(model.value) : model.value, props.currency);
    }
}
</script>

<template>
    <Input
        :id="id"
        :model-value="text"
        inputmode="decimal"
        autocomplete="off"
        :placeholder="placeholder ?? '0.00'"
        class="text-right tabular-nums"
        @update:model-value="onInput"
        @blur="onBlur"
    />
</template>
