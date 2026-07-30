<script setup lang="ts">
defineProps<{
    /** Position in px relative to the chart wrapper; null hides the tooltip. */
    x: number | null;
    y: number;
    title: string;
    lines: { label: string; value: string; swatch?: string }[];
}>();
</script>

<template>
    <div
        v-if="x !== null"
        class="pointer-events-none absolute z-10 min-w-32 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
        :style="{ left: `${x}px`, top: `${y}px` }"
    >
        <div class="font-medium">{{ title }}</div>
        <div v-for="line in lines" :key="line.label" class="mt-0.5 flex items-center gap-1.5">
            <span v-if="line.swatch" class="size-2 rounded-full" :style="{ background: line.swatch }" />
            <span class="text-muted-foreground">{{ line.label }}</span>
            <span class="ml-auto pl-3 font-medium tabular-nums">{{ line.value }}</span>
        </div>
    </div>
</template>
