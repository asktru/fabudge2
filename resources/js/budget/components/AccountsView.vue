<script setup lang="ts">
import { ArrowDownUp, Check, ChevronRight, GripVertical, Landmark, Pencil, Plus } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { accountBalances, accountGroups, totalInBase } from '@/budget/balances';
import type { AccountSummary } from '@/budget/balances';
import { useBudget } from '@/budget/context';
import { formatMoney } from '@/budget/money';
import { indexForPointer, moveItem } from '@/budget/reorder';
import type { Account, RateRow, Transaction } from '@/budget/types';
import { useLive } from '@/budget/useLive';
import { Button } from '@/components/ui/button';

const emit = defineEmits<{ addAccount: []; editAccount: [account: Account] }>();

const { db, repo, navigate } = useBudget();

const accounts = useLive<Account[]>(() => db.accounts.orderBy('sort_order').toArray(), []);
const transactions = useLive<Transaction[]>(() => db.transactions.toArray(), []);
const rates = useLive<RateRow[]>(() => db.rates.toArray(), []);

const groups = computed(() => accountGroups(accounts.value, transactions.value, rates.value));

const total = computed(() =>
    totalInBase(
        accountBalances(transactions.value),
        accounts.value.filter((account) => account.deleted_at === null),
        rates.value,
    ),
);

const reordering = ref(false);

/**
 * Reorder mode edits a local copy so a drag stays smooth while the Dexie
 * write and its live query round-trip.
 */
const draft = ref<{ id: string; label: string; accounts: AccountSummary[] }[]>([]);

const drag = ref<{ groupId: string; index: number; pointerId: number } | null>(null);
const lists = new Map<string, HTMLElement>();

function setList(groupId: string, el: unknown): void {
    if (el instanceof HTMLElement) {
        lists.set(groupId, el);
    } else {
        lists.delete(groupId);
    }
}

function draftIds(): string[] {
    return draft.value.flatMap((group) => group.accounts.map((summary) => summary.account.id));
}

function buildDraft(): void {
    draft.value = groups.value.map((group) => ({
        id: group.id,
        label: group.label,
        accounts: [...group.accounts],
    }));
}

// Accounts added, closed or moved between groups elsewhere rebuild the draft;
// a pending reorder of the same accounts must not be clobbered by the live
// query still reporting the pre-write order.
watch(groups, (next) => {
    if (!reordering.value || drag.value) {
        return;
    }

    const live = next.flatMap((group) => group.accounts.map((summary) => summary.account.id));
    const current = draftIds();

    if (live.length !== current.length || live.some((id) => !current.includes(id))) {
        buildDraft();
    }
});

function toggleReordering(): void {
    reordering.value = !reordering.value;

    if (reordering.value) {
        buildDraft();
    } else {
        drag.value = null;
    }
}

async function persist(): Promise<void> {
    await repo.reorderAccounts(draftIds());
}

function groupAt(groupId: string) {
    return draft.value.find((group) => group.id === groupId);
}

function onPointerDown(groupId: string, index: number, event: PointerEvent): void {
    const handle = event.currentTarget;

    if (!(handle instanceof HTMLElement)) {
        return;
    }

    handle.setPointerCapture(event.pointerId);
    drag.value = { groupId, index, pointerId: event.pointerId };
}

function onPointerMove(event: PointerEvent): void {
    const active = drag.value;

    if (!active || active.pointerId !== event.pointerId) {
        return;
    }

    const list = lists.get(active.groupId);
    const group = groupAt(active.groupId);

    if (!list || !group) {
        return;
    }

    const bounds = [...list.children].map((row) => {
        const rect = row.getBoundingClientRect();

        return { top: rect.top, bottom: rect.bottom };
    });

    const target = indexForPointer(event.clientY, bounds);

    if (target === null || target === active.index) {
        return;
    }

    group.accounts = moveItem(group.accounts, active.index, target);
    active.index = target;
}

async function onPointerUp(event: PointerEvent): Promise<void> {
    if (!drag.value || drag.value.pointerId !== event.pointerId) {
        return;
    }

    drag.value = null;
    await persist();
}

/** Arrow keys move the focused account, so reordering works without a pointer. */
async function moveByKey(groupId: string, index: number, delta: number): Promise<void> {
    const group = groupAt(groupId);

    if (!group) {
        return;
    }

    const target = index + delta;

    if (target < 0 || target >= group.accounts.length) {
        return;
    }

    group.accounts = moveItem(group.accounts, index, target);
    await persist();
}

/** Rows are inert while reordering: a stray tap must not navigate away mid-drag. */
function openAccount(account: Account): void {
    if (!reordering.value) {
        navigate({ view: 'register', accountId: account.id });
    }
}

function isDragging(groupId: string, index: number): boolean {
    return drag.value?.groupId === groupId && drag.value.index === index;
}
</script>

<template>
    <div class="mx-auto w-full max-w-2xl p-4" data-testid="accounts-view">
        <div class="mb-4 flex items-end justify-between gap-3">
            <div>
                <div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Total balance</div>
                <div class="text-2xl font-semibold tabular-nums">{{ formatMoney(total.totalMinor, 'CAD') }}</div>
                <div v-if="total.missingRates.length" class="text-xs text-amber-600 dark:text-amber-500">
                    No rate for {{ total.missingRates.join(', ') }}
                </div>
            </div>

            <div class="flex items-center gap-2">
                <Button
                    v-if="accounts.some((account) => account.deleted_at === null)"
                    size="sm"
                    :variant="reordering ? 'default' : 'outline'"
                    data-testid="accounts-reorder"
                    @click="toggleReordering"
                >
                    <component :is="reordering ? Check : ArrowDownUp" class="size-4" />
                    {{ reordering ? 'Done' : 'Reorder' }}
                </Button>

                <Button v-if="!reordering" size="sm" variant="outline" data-testid="accounts-add" @click="emit('addAccount')">
                    <Plus class="size-4" /> Add account
                </Button>
            </div>
        </div>

        <p v-if="reordering" class="mb-3 text-xs text-muted-foreground">
            Drag the handles to reorder. Accounts stay within their group.
        </p>

        <div v-if="groups.length === 0" class="rounded-lg border p-8 text-center text-sm text-muted-foreground">
            No accounts yet. Add one to start tracking your money.
        </div>

        <section v-for="group in (reordering ? draft : groups)" :key="group.id" class="mb-6">
            <div class="mb-1 flex items-baseline justify-between px-1">
                <h2 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{{ group.label }}</h2>
                <span v-if="!reordering" class="text-xs tabular-nums text-muted-foreground">
                    {{ formatMoney(groups.find((live) => live.id === group.id)?.total.totalMinor ?? 0, 'CAD') }}
                </span>
            </div>

            <ul :ref="(el) => setList(group.id, el)" class="divide-y rounded-lg border">
                <li
                    v-for="(summary, index) in group.accounts"
                    :key="summary.account.id"
                    class="flex items-center bg-background transition-shadow"
                    :class="isDragging(group.id, index) ? 'relative z-10 rounded-md shadow-lg ring-2 ring-primary' : ''"
                >
                    <button
                        v-if="reordering"
                        type="button"
                        class="flex cursor-grab touch-none items-center px-2 py-3 text-muted-foreground active:cursor-grabbing"
                        :aria-label="`Reorder ${summary.account.name}`"
                        :data-testid="`account-handle-${summary.account.id}`"
                        @pointerdown="onPointerDown(group.id, index, $event)"
                        @pointermove="onPointerMove"
                        @pointerup="onPointerUp"
                        @pointercancel="onPointerUp"
                        @keydown.up.prevent="moveByKey(group.id, index, -1)"
                        @keydown.down.prevent="moveByKey(group.id, index, 1)"
                    >
                        <GripVertical class="size-4" />
                    </button>

                    <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left"
                        :class="reordering ? 'cursor-default' : 'transition-colors hover:bg-muted/50'"
                        :tabindex="reordering ? -1 : undefined"
                        :data-testid="`account-row-${summary.account.id}`"
                        @click="openAccount(summary.account)"
                    >
                        <Landmark v-if="!reordering" class="size-4 shrink-0 text-muted-foreground" />

                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium">{{ summary.account.name }}</span>
                            <span class="block text-xs text-muted-foreground">
                                {{ formatMoney(summary.clearedMinor, summary.account.currency) }} cleared
                            </span>
                        </span>

                        <span class="shrink-0 text-right">
                            <span
                                class="block text-sm font-semibold tabular-nums"
                                :class="summary.workingMinor < 0 ? 'text-red-600 dark:text-red-400' : ''"
                            >
                                {{ formatMoney(summary.workingMinor, summary.account.currency) }}
                            </span>
                            <span class="block text-xs text-muted-foreground">{{ summary.account.currency }}</span>
                        </span>

                        <ChevronRight v-if="!reordering" class="size-4 shrink-0 text-muted-foreground" />
                    </button>

                    <Button
                        v-if="!reordering"
                        variant="ghost"
                        size="icon"
                        class="mr-2 size-8 shrink-0"
                        title="Edit account"
                        @click="emit('editAccount', summary.account)"
                    >
                        <Pencil class="size-3.5" />
                    </Button>
                </li>
            </ul>
        </section>
    </div>
</template>
