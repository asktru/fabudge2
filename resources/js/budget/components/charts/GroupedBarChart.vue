<script setup lang="ts">
import { computed, ref } from 'vue';
import ChartTooltip from './ChartTooltip.vue';

export interface GroupedBarPoint {
    key: string;
    label: string;
    values: number[];
    formatted: string[];
}

const props = defineProps<{
    points: GroupedBarPoint[];
    series: { name: string; color: string }[];
}>();

const hover = ref<{ index: number; x: number } | null>(null);

const max = computed(() => Math.max(1, ...props.points.flatMap((point) => point.values)));

function onEnter(index: number, event: MouseEvent) {
    const wrapper = (event.currentTarget as HTMLElement).closest('[data-chart]') as HTMLElement;
    const bar = event.currentTarget as HTMLElement;
    const wrapperRect = wrapper.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    hover.value = { index, x: barRect.left + barRect.width / 2 - wrapperRect.left };
}
</script>

<template>
    <div>
        <div class="mb-2 flex items-center gap-4 text-xs">
            <span v-for="entry in series" :key="entry.name" class="flex items-center gap-1.5">
                <span class="size-2.5 rounded-full" :style="{ background: entry.color }" />
                {{ entry.name }}
            </span>
        </div>

        <div class="relative" data-chart>
            <ChartTooltip
                :x="hover ? hover.x : null"
                :y="-4"
                :title="hover ? points[hover.index].label : ''"
                :lines="
                    hover
                        ? series.map((entry, seriesIndex) => ({
                              label: entry.name,
                              value: points[hover!.index].formatted[seriesIndex],
                              swatch: entry.color,
                          }))
                        : []
                "
            />

            <div class="flex h-40 items-end gap-1">
                <div
                    v-for="(point, index) in points"
                    :key="point.key"
                    class="flex h-full flex-1 items-end justify-center gap-0.5"
                    :aria-label="`${point.label}: ${point.formatted.join(', ')}`"
                    @mouseenter="onEnter(index, $event)"
                    @mouseleave="hover = null"
                >
                    <span
                        v-for="(value, seriesIndex) in point.values"
                        :key="seriesIndex"
                        class="w-full max-w-4 rounded-t-[4px]"
                        :style="{
                            height: `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%`,
                            background: series[seriesIndex].color,
                        }"
                    />
                </div>
            </div>

            <div class="mt-1 flex gap-1 border-t pt-1">
                <span v-for="point in points" :key="point.key" class="flex-1 truncate text-center text-[10px] text-muted-foreground">
                    {{ point.label }}
                </span>
            </div>
        </div>
    </div>
</template>
