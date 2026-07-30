<script setup lang="ts">
import { ArrowDown, ArrowUp, EyeOff, Pencil, Plus } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useBudget } from '@/budget/context';
import type { Category, CategoryGroup } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const { db, repo } = useBudget();

const groups = useLive<CategoryGroup[]>(() => db.category_groups.orderBy('sort_order').toArray(), []);
const categories = useLive<Category[]>(() => db.categories.orderBy('sort_order').toArray(), []);

const liveGroups = computed(() => groups.value.filter((group) => group.deleted_at === null));
const liveCategories = computed(() => categories.value.filter((category) => category.deleted_at === null));

const newGroupName = ref('');
const newCategoryName = ref<Record<string, string>>({});
const renamingId = ref<string | null>(null);
const renameText = ref('');

/** Buckets: one per group plus an "ungrouped" bucket keyed ''. */
const buckets = computed(() => {
    const result: { group: CategoryGroup | null; categories: Category[] }[] = liveGroups.value.map((group) => ({
        group,
        categories: liveCategories.value.filter((category) => category.category_group_id === group.id),
    }));

    const ungrouped = liveCategories.value.filter(
        (category) => !category.category_group_id || !liveGroups.value.some((group) => group.id === category.category_group_id),
    );

    if (ungrouped.length) {
        result.push({ group: null, categories: ungrouped });
    }

    return result;
});

async function addGroup() {
    if (!newGroupName.value.trim()) {
return;
}

    await repo.createCategoryGroup(newGroupName.value);
    newGroupName.value = '';
}

async function addCategory(groupId: string | null) {
    const key = groupId ?? '';
    const name = (newCategoryName.value[key] ?? '').trim();

    if (!name) {
return;
}

    await repo.createCategory(name, groupId);
    newCategoryName.value[key] = '';
}

function startRename(id: string, current: string) {
    renamingId.value = id;
    renameText.value = current;
}

async function commitRename(kind: 'group' | 'category') {
    const id = renamingId.value;

    if (!id || !renameText.value.trim()) {
        renamingId.value = null;

        return;
    }

    if (kind === 'group') {
        await repo.updateCategoryGroup(id, { name: renameText.value.trim() });
    } else {
        await repo.updateCategory(id, { name: renameText.value.trim() });
    }

    renamingId.value = null;
}

/** Swap sort_order with the neighbour within the same bucket. */
async function move(category: Category, direction: -1 | 1, bucket: Category[]) {
    const index = bucket.findIndex((candidate) => candidate.id === category.id);
    const neighbour = bucket[index + direction];

    if (!neighbour) {
return;
}

    await repo.updateCategory(category.id, { sort_order: neighbour.sort_order });
    await repo.updateCategory(neighbour.id, { sort_order: category.sort_order });
}
</script>

<template>
    <div class="mx-auto w-full max-w-2xl space-y-6 p-4">
        <div v-for="bucket in buckets" :key="bucket.group?.id ?? 'ungrouped'" class="rounded-lg border">
            <div class="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <template v-if="renamingId === bucket.group?.id">
                    <Input
                        v-model="renameText"
                        class="h-7"
                        autofocus
                        @keydown.enter.prevent="commitRename('group')"
                        @blur="commitRename('group')"
                    />
                </template>
                <template v-else>
                    <span class="text-sm font-semibold">{{ bucket.group?.name ?? 'Ungrouped' }}</span>
                    <Button
                        v-if="bucket.group"
                        variant="ghost"
                        size="icon"
                        class="size-6"
                        @click="startRename(bucket.group.id, bucket.group.name)"
                    >
                        <Pencil class="size-3" />
                    </Button>
                    <Button
                        v-if="bucket.group"
                        variant="ghost"
                        size="icon"
                        class="ml-auto size-6"
                        title="Hide group and its categories"
                        @click="repo.hideCategoryGroup(bucket.group.id)"
                    >
                        <EyeOff class="size-3" />
                    </Button>
                </template>
            </div>

            <ul class="divide-y">
                <li v-for="category in bucket.categories" :key="category.id" class="flex items-center gap-1 px-3 py-1.5 text-sm">
                    <template v-if="renamingId === category.id">
                        <Input
                            v-model="renameText"
                            class="h-7"
                            autofocus
                            @keydown.enter.prevent="commitRename('category')"
                            @blur="commitRename('category')"
                        />
                    </template>
                    <template v-else>
                        <span>{{ category.name }}</span>
                        <Button variant="ghost" size="icon" class="size-6" @click="startRename(category.id, category.name)">
                            <Pencil class="size-3" />
                        </Button>
                        <span class="ml-auto flex items-center">
                            <Button variant="ghost" size="icon" class="size-6" @click="move(category, -1, bucket.categories)">
                                <ArrowUp class="size-3" />
                            </Button>
                            <Button variant="ghost" size="icon" class="size-6" @click="move(category, 1, bucket.categories)">
                                <ArrowDown class="size-3" />
                            </Button>
                            <Button variant="ghost" size="icon" class="size-6" title="Hide category" @click="repo.hideCategory(category.id)">
                                <EyeOff class="size-3" />
                            </Button>
                        </span>
                    </template>
                </li>
            </ul>

            <div class="flex gap-2 p-2">
                <Input
                    v-model="newCategoryName[bucket.group?.id ?? '']"
                    placeholder="New category"
                    class="h-8"
                    @keydown.enter.prevent="addCategory(bucket.group?.id ?? null)"
                />
                <Button size="sm" variant="secondary" @click="addCategory(bucket.group?.id ?? null)">
                    <Plus class="size-4" />
                </Button>
            </div>
        </div>

        <div class="flex gap-2">
            <Input
                v-model="newGroupName"
                data-testid="new-group-name"
                placeholder="New category group"
                class="h-9"
                @keydown.enter.prevent="addGroup"
            />
            <Button data-testid="add-group" @click="addGroup"><Plus class="size-4" /> Add group</Button>
        </div>

        <p class="text-xs text-muted-foreground">
            Hiding a category keeps its history but removes it from pickers.
        </p>
    </div>
</template>
