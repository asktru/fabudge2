<script setup lang="ts">
import { computed, ref } from 'vue';
import ChartTooltip from './ChartTooltip.vue';

export interface LinePoint {
    key: string;
    label: string;
    value: number;
    formatted: string;
}

const props = defineProps<{
    points: LinePoint[];
    color?: string;
}>();

const WIDTH = 600;
const HEIGHT = 160;
const PAD = 8;

const hover = ref<{ index: number; x: number } | null>(null);

const bounds = computed(() => {
    const values = props.points.map((point) => point.value);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);

    return { min, max };
});

function xAt(index: number): number {
    const count = Math.max(1, props.points.length - 1);

    return PAD + (index / count) * (WIDTH - PAD * 2);
}

function yAt(value: number): number {
    const { min, max } = bounds.value;
    const span = max - min || 1;

    return HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2);
}

const linePath = computed(() =>
    props.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(point.value).toFixed(1)}`).join(' '),
);

const areaPath = computed(() => {
    if (props.points.length === 0) {
        return '';
    }

    const baseline = yAt(Math.max(0, bounds.value.min));

    return `${linePath.value} L${xAt(props.points.length - 1).toFixed(1)},${baseline} L${xAt(0).toFixed(1)},${baseline} Z`;
});

function onMove(event: MouseEvent) {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const count = Math.max(1, props.points.length - 1);
    const index = Math.round(((relative - PAD) / (WIDTH - PAD * 2)) * count);
    const clamped = Math.max(0, Math.min(props.points.length - 1, index));

    hover.value = { index: clamped, x: (xAt(clamped) / WIDTH) * rect.width };
}
</script>

<template>
    <div class="relative" data-chart>
        <ChartTooltip
            :x="hover ? hover.x : null"
            :y="-4"
            :title="hover ? points[hover.index].label : ''"
            :lines="hover ? [{ label: 'Net worth', value: points[hover.index].formatted }] : []"
        />

        <svg
            :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
            class="h-40 w-full"
            preserveAspectRatio="none"
            role="img"
            @mousemove="onMove"
            @mouseleave="hover = null"
        >
            <line :x1="PAD" :x2="WIDTH - PAD" :y1="yAt(0)" :y2="yAt(0)" stroke="currentColor" stroke-opacity="0.15" stroke-width="1" />
            <path :d="areaPath" :fill="color ?? '#3b82f6'" fill-opacity="0.12" />
            <path :d="linePath" fill="none" :stroke="color ?? '#3b82f6'" stroke-width="2" vector-effect="non-scaling-stroke" />
            <template v-if="hover">
                <line
                    :x1="xAt(hover.index)"
                    :x2="xAt(hover.index)"
                    :y1="PAD"
                    :y2="HEIGHT - PAD"
                    stroke="currentColor"
                    stroke-opacity="0.3"
                    stroke-width="1"
                    vector-effect="non-scaling-stroke"
                />
                <circle :cx="xAt(hover.index)" :cy="yAt(points[hover.index].value)" r="4" :fill="color ?? '#3b82f6'" />
            </template>
        </svg>

        <div class="mt-1 flex justify-between border-t pt-1 text-[10px] text-muted-foreground">
            <span>{{ points[0]?.label }}</span>
            <span>{{ points[points.length - 1]?.label }}</span>
        </div>
    </div>
</template>
