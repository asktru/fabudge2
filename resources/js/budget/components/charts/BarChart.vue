<script setup lang="ts">
import { computed, ref } from 'vue';
import ChartTooltip from './ChartTooltip.vue';

export interface BarPoint {
    key: string;
    label: string;
    value: number;
    formatted: string;
}

const props = defineProps<{
    points: BarPoint[];
    color?: string;
    selectedKey?: string | null;
}>();

const emit = defineEmits<{ select: [key: string] }>();

const hover = ref<{ index: number; x: number } | null>(null);

const max = computed(() => Math.max(1, ...props.points.map((point) => point.value)));

function barHeight(value: number): string {
    return `${Math.max(value > 0 ? 2 : 0, (value / max.value) * 100)}%`;
}

function onEnter(index: number, event: MouseEvent) {
    const wrapper = (event.currentTarget as HTMLElement).closest('[data-chart]') as HTMLElement;
    const bar = event.currentTarget as HTMLElement;
    const wrapperRect = wrapper.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    hover.value = { index, x: barRect.left + barRect.width / 2 - wrapperRect.left };
}
</script>

<template>
    <div class="relative" data-chart>
        <ChartTooltip
            :x="hover ? hover.x : null"
            :y="-4"
            :title="hover ? points[hover.index].label : ''"
            :lines="hover ? [{ label: 'Total', value: points[hover.index].formatted }] : []"
        />

        <div class="flex h-40 items-end gap-0.5">
            <button
                v-for="(point, index) in points"
                :key="point.key"
                type="button"
                class="group flex h-full flex-1 flex-col justify-end"
                :aria-label="`${point.label}: ${point.formatted}`"
                @mouseenter="onEnter(index, $event)"
                @mouseleave="hover = null"
                @click="emit('select', point.key)"
            >
                <span
                    class="mx-auto w-full max-w-8 rounded-t-[4px] transition-opacity"
                    :class="selectedKey && selectedKey !== point.key ? 'opacity-40' : ''"
                    :style="{ height: barHeight(point.value), background: color ?? '#3b82f6' }"
                />
            </button>
        </div>

        <div class="mt-1 flex gap-0.5 border-t pt-1">
            <span v-for="point in points" :key="point.key" class="flex-1 truncate text-center text-[10px] text-muted-foreground">
                {{ point.label }}
            </span>
        </div>
    </div>
</template>
