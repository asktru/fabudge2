<script setup lang="ts">
import { Merge, Pencil } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useBudget } from '@/budget/context';
import type { Payee, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const { db, repo } = useBudget();

const payees = useLive<Payee[]>(() => db.payees.toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);

const livePayees = computed(() =>
    payees.value.filter((payee) => payee.deleted_at === null).sort((a, b) => a.name.localeCompare(b.name)),
);

const usageCount = computed(() => {
    const counts = new Map<string, number>();

    for (const transaction of transactions.value) {
        if (transaction.payee_id && transaction.deleted_at === null) {
            counts.set(transaction.payee_id, (counts.get(transaction.payee_id) ?? 0) + 1);
        }
    }

    return counts;
});

const renamingId = ref<string | null>(null);
const renameText = ref('');
const mergingId = ref<string | null>(null);
const mergeTargetId = ref<string | null>(null);

async function commitRename() {
    if (renamingId.value && renameText.value.trim()) {
        await repo.renamePayee(renamingId.value, renameText.value);
    }

    renamingId.value = null;
}

async function commitMerge() {
    if (mergingId.value && mergeTargetId.value && mergingId.value !== mergeTargetId.value) {
        await repo.mergePayees(mergingId.value, mergeTargetId.value);
    }

    mergingId.value = null;
    mergeTargetId.value = null;
}
</script>

<template>
    <div class="mx-auto w-full max-w-2xl p-4">
        <div v-if="livePayees.length === 0" class="p-8 text-center text-sm text-muted-foreground">
            Payees appear here as you enter transactions.
        </div>

        <ul v-else class="divide-y rounded-lg border">
            <li v-for="payee in livePayees" :key="payee.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <template v-if="renamingId === payee.id">
                    <Input v-model="renameText" class="h-8 max-w-64" autofocus @keydown.enter.prevent="commitRename" @blur="commitRename" />
                </template>
                <template v-else>
                    <span class="font-medium">{{ payee.name }}</span>
                    <span class="text-xs text-muted-foreground">{{ usageCount.get(payee.id) ?? 0 }} uses</span>
                    <span class="ml-auto flex items-center gap-1">
                        <Button variant="ghost" size="icon" class="size-7" @click="renamingId = payee.id; renameText = payee.name">
                            <Pencil class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-7"
                            title="Merge into another payee"
                            @click="mergingId = mergingId === payee.id ? null : payee.id"
                        >
                            <Merge class="size-3.5" />
                        </Button>
                    </span>
                </template>

                <div v-if="mergingId === payee.id" class="flex w-full items-center gap-2 pt-1">
                    <span class="text-xs text-muted-foreground">Merge “{{ payee.name }}” into:</span>
                    <Select v-model="mergeTargetId">
                        <SelectTrigger class="h-8 w-56">
                            <SelectValue placeholder="Choose payee" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem
                                v-for="candidate in livePayees.filter((other) => other.id !== payee.id)"
                                :key="candidate.id"
                                :value="candidate.id"
                            >
                                {{ candidate.name }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <Button size="sm" :disabled="!mergeTargetId" @click="commitMerge">Merge</Button>
                </div>
            </li>
        </ul>
    </div>
</template>
