<script setup lang="ts">
import { computed } from 'vue';
import { useBudget } from '@/budget/context';
import { activeTabId, budgetTabs } from '@/budget/navigation';

const { current, navigate } = useBudget();

const active = computed(() => activeTabId(current.value));
</script>

<template>
    <nav
        class="fixed inset-x-0 bottom-0 z-20 grid border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
        :style="{ gridTemplateColumns: `repeat(${budgetTabs.length}, minmax(0, 1fr))` }"
        data-testid="budget-tab-bar"
    >
        <button
            v-for="tab in budgetTabs"
            :key="tab.id"
            type="button"
            class="flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors"
            :class="active === tab.id ? 'text-primary' : 'text-muted-foreground'"
            :aria-current="active === tab.id ? 'page' : undefined"
            :data-testid="`tab-${tab.id}`"
            @click="navigate(tab.view)"
        >
            <component :is="tab.icon" class="size-5" />
            {{ tab.label }}
        </button>
    </nav>
</template>
