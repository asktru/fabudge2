<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ComboboxItem {
    value: string;
    label: string;
    /** Optional group heading rendered above consecutive items of the same group. */
    group?: string;
}

const props = defineProps<{
    items: ComboboxItem[];
    placeholder?: string;
    allowCreate?: boolean;
    createLabel?: (query: string) => string;
    id?: string;
}>();

const emit = defineEmits<{
    select: [item: ComboboxItem];
    create: [name: string];
}>();

/** Currently displayed text (selected label or in-progress query). */
const text = defineModel<string>({ default: '' });

const open = ref(false);
const highlighted = ref(0);
const inputElement = ref<InstanceType<typeof Input> | null>(null);

const filtered = computed(() => {
    const query = text.value.trim().toLowerCase();

    if (!query) {
        return props.items;
    }

    return props.items.filter((item) => item.label.toLowerCase().includes(query));
});

const showCreate = computed(
    () =>
        !!props.allowCreate &&
        text.value.trim().length > 0 &&
        !props.items.some((item) => item.label.toLowerCase() === text.value.trim().toLowerCase()),
);

const optionCount = computed(() => filtered.value.length + (showCreate.value ? 1 : 0));

watch([filtered, showCreate], () => {
    highlighted.value = 0;
});

function choose(index: number) {
    if (index < filtered.value.length) {
        const item = filtered.value[index];
        text.value = item.label;
        emit('select', item);
    } else if (showCreate.value) {
        emit('create', text.value.trim());
    }

    open.value = false;
}

function onKeydown(event: KeyboardEvent) {
    if (!open.value && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        open.value = true;

        return;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlighted.value = Math.min(highlighted.value + 1, optionCount.value - 1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlighted.value = Math.max(highlighted.value - 1, 0);
    } else if (event.key === 'Enter') {
        if (open.value && optionCount.value > 0) {
            event.preventDefault();
            choose(highlighted.value);
        }
    } else if (event.key === 'Escape') {
        open.value = false;
    }
}

function groupHeading(index: number): string | null {
    const item = filtered.value[index];

    if (!item.group) {
        return null;
    }

    return index === 0 || filtered.value[index - 1].group !== item.group ? item.group : null;
}
</script>

<template>
    <div class="relative">
        <Input
            :id="id"
            ref="inputElement"
            v-model="text"
            :placeholder="placeholder"
            autocomplete="off"
            @focus="open = true"
            @input="open = true"
            @blur="open = false"
            @keydown="onKeydown"
        />

        <div
            v-if="open && optionCount > 0"
            class="absolute z-50 mt-1 max-h-64 w-full min-w-48 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
            <template v-for="(item, index) in filtered" :key="item.value">
                <div v-if="groupHeading(index)" class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                    {{ groupHeading(index) }}
                </div>
                <button
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm',
                            index === highlighted ? 'bg-accent text-accent-foreground' : '',
                        )
                    "
                    @mousedown.prevent="choose(index)"
                    @mousemove="highlighted = index"
                >
                    {{ item.label }}
                </button>
            </template>

            <button
                v-if="showCreate"
                type="button"
                :class="
                    cn(
                        'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm',
                        highlighted === filtered.length ? 'bg-accent text-accent-foreground' : '',
                    )
                "
                @mousedown.prevent="choose(filtered.length)"
                @mousemove="highlighted = filtered.length"
            >
                {{ createLabel ? createLabel(text.trim()) : `Create “${text.trim()}”` }}
            </button>
        </div>
    </div>
</template>
