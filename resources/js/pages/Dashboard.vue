<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { ArrowRight, Wallet } from '@lucide/vue';
import PendingInvitationsModal from '@/components/PendingInvitationsModal.vue';
import { budget, dashboard } from '@/routes';
import type { DashboardInvitation, Team } from '@/types';

defineProps<{
    pendingInvitations?: DashboardInvitation[];
}>();

defineOptions({
    layout: (props: { currentTeam?: Team | null }) => ({
        breadcrumbs: [
            {
                title: 'Dashboard',
                href: props.currentTeam
                    ? dashboard(props.currentTeam.slug)
                    : '/',
            },
        ],
    }),
});
</script>

<template>
    <Head title="Dashboard" />

    <PendingInvitationsModal
        v-if="pendingInvitations && pendingInvitations.length > 0"
        :invitations="pendingInvitations"
    />

    <div class="flex h-full flex-1 flex-col gap-4 p-4">
        <Link
            v-if="$page.props.currentTeam"
            :href="budget($page.props.currentTeam.slug).url"
            class="group flex max-w-xl items-center gap-4 rounded-xl border border-sidebar-border/70 p-6 transition-colors hover:bg-accent dark:border-sidebar-border"
        >
            <div class="flex size-12 items-center justify-center rounded-lg bg-primary/10">
                <Wallet class="size-6 text-primary" />
            </div>
            <div>
                <div class="text-lg font-semibold">Open your budget</div>
                <div class="text-sm text-muted-foreground">
                    Accounts, transactions, and balances — works offline and syncs automatically.
                </div>
            </div>
            <ArrowRight class="ml-auto size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
    </div>
</template>
