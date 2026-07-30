<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

defineOptions({
    inheritAttrs: false,
});

type Props = {
    className?: HTMLAttributes['class'];
};

defineProps<Props>();
</script>

<template>
    <!-- Fabudge mark: an F built from budget bars — the top bar fully funded, the second in progress -->
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 40 40"
        :class="className"
        v-bind="$attrs"
    >
        <path
            fill="currentColor"
            d="M9 7.5A3.5 3.5 0 0 1 12.5 4h20a3.5 3.5 0 1 1 0 7H16v21.5a3.5 3.5 0 1 1-7 0V7.5Z"
        />
        <path fill="#d97706" d="M16 17h9.5a3.5 3.5 0 1 1 0 7H16v-7Z" />
    </svg>
</template>
