<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BudgetShell from '@/budget/components/BudgetShell.vue';
import { provideBudget  } from '@/budget/context';
import type {BudgetView} from '@/budget/context';
import { openBudgetDatabase } from '@/budget/db';
import { createRepo } from '@/budget/repo';
import { SyncEngine } from '@/budget/sync';
import { pull, push } from '@/routes/sync';

const page = usePage();
const teamSlug = page.props.currentTeam!.slug;

const db = openBudgetDatabase(teamSlug);
const repo = createRepo(db);
const sync = new SyncEngine(db, {
    pushUrl: push.url(teamSlug),
    pullUrl: pull.url(teamSlug),
});

const current = ref<BudgetView>({ view: 'register', accountId: null });

provideBudget({
    db,
    repo,
    sync,
    current,
    navigate: (view) => {
        current.value = view;
    },
});

// Any repo mutation lands in the outbox; sync shortly after each Dexie write.
db.outbox.hook('creating', () => {
    setTimeout(() => sync.requestSync(), 0);
});

onMounted(() => sync.start());
onBeforeUnmount(() => {
    sync.stop();
    db.close();
});
</script>

<template>
    <Head title="Budget" />

    <BudgetShell />
</template>
