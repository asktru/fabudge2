<script setup lang="ts">
import { Head, Link, usePage } from '@inertiajs/vue3';
import { Mic } from '@lucide/vue';
import { computed } from 'vue';
import AppLogoIcon from '@/components/AppLogoIcon.vue';
import { dashboard, login, register } from '@/routes';

const page = usePage();
const dashboardUrl = computed(() =>
    page.props.currentTeam ? dashboard(page.props.currentTeam.slug).url : '/',
);

const envelopes = [
    {
        name: 'Groceries',
        amount: '$640.00',
        fill: 'w-[72%]',
        delay: 'delay-300',
    },
    { name: 'Rent', amount: '$1,850.00', fill: 'w-full', delay: 'delay-400' },
    {
        name: 'Vacation fund',
        amount: '$320.00',
        fill: 'w-[45%]',
        delay: 'delay-500',
    },
    { name: 'Coffee', amount: '$58.00', fill: 'w-[88%]', delay: 'delay-600' },
];

const features = [
    {
        title: 'Works offline',
        body: 'The ledger lives on your device. Sync catches up whenever you are back online.',
    },
    {
        title: 'Say it, it is saved',
        body: '"Fourteen twenty at the bakery" becomes a categorized transaction.',
    },
    {
        title: 'Knows your spots',
        body: 'Walk into your usual grocery store and the payee is already filled in.',
    },
];
</script>

<template>
    <Head title="Welcome" />
    <div class="flex min-h-screen flex-col bg-background text-foreground">
        <header class="mx-auto w-full max-w-5xl px-6 py-6 lg:px-8">
            <nav class="flex items-center justify-between gap-4 text-sm">
                <div class="flex items-center gap-2">
                    <AppLogoIcon class="size-6 fill-current text-foreground" />
                    <span class="text-base font-semibold tracking-tight"
                        >fabudge</span
                    >
                </div>
                <div class="flex items-center gap-4">
                    <Link
                        v-if="$page.props.auth.user"
                        :href="dashboardUrl"
                        class="rounded-md bg-primary px-4 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Open your budget
                    </Link>
                    <template v-else>
                        <Link
                            :href="login()"
                            class="rounded-md px-4 py-1.5 font-medium text-muted-foreground hover:text-foreground"
                        >
                            Log in
                        </Link>
                        <Link
                            :href="register()"
                            class="rounded-md bg-primary px-4 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            Start budgeting
                        </Link>
                    </template>
                </div>
            </nav>
        </header>

        <main
            class="mx-auto flex w-full max-w-5xl grow flex-col justify-center px-6 py-10 lg:px-8"
        >
            <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                <section
                    class="opacity-100 transition-all duration-750 starting:opacity-0 motion-safe:starting:translate-y-4"
                >
                    <p
                        class="mb-4 text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
                    >
                        Envelope budgeting, offline first
                    </p>
                    <h1
                        class="mb-5 text-4xl leading-[1.1] font-semibold tracking-tight text-balance lg:text-5xl"
                    >
                        Every dollar gets an
                        <span class="text-amber-600 dark:text-amber-500"
                            >envelope</span
                        >.
                    </h1>
                    <p
                        class="mb-8 max-w-md text-base leading-relaxed text-muted-foreground"
                    >
                        Fabudge keeps your family's budget on your own devices.
                        Assign money to envelopes, record spending in any
                        currency — or just say it out loud — and let sync catch
                        up on its own.
                    </p>
                    <div class="flex items-center gap-3">
                        <Link
                            v-if="$page.props.auth.user"
                            :href="dashboardUrl"
                            class="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            Open your budget
                        </Link>
                        <template v-else>
                            <Link
                                :href="register()"
                                class="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                            >
                                Start budgeting
                            </Link>
                            <Link
                                :href="login()"
                                class="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
                            >
                                Log in
                            </Link>
                        </template>
                    </div>
                </section>

                <section class="relative" aria-hidden="true">
                    <div
                        class="absolute inset-x-3 top-3 -bottom-3 rotate-2 rounded-xl border border-border bg-muted opacity-100 transition-all delay-200 duration-750 starting:rotate-0 starting:opacity-0"
                    ></div>
                    <div
                        class="relative rounded-xl border border-border bg-card p-6 opacity-100 shadow-sm transition-all duration-750 starting:opacity-0 motion-safe:starting:translate-y-6"
                    >
                        <div
                            class="mb-5 flex items-center justify-between gap-4"
                        >
                            <h2 class="text-sm font-semibold">July budget</h2>
                            <span
                                class="rounded-full bg-amber-600/10 px-3 py-1 text-xs font-medium text-amber-700 tabular-nums dark:text-amber-500"
                            >
                                Ready to assign: $240.00
                            </span>
                        </div>
                        <ul class="flex flex-col gap-4">
                            <li
                                v-for="envelope in envelopes"
                                :key="envelope.name"
                            >
                                <div
                                    class="mb-1.5 flex items-baseline justify-between gap-4 text-sm"
                                >
                                    <span>{{ envelope.name }}</span>
                                    <span class="font-medium tabular-nums">{{
                                        envelope.amount
                                    }}</span>
                                </div>
                                <div class="h-1.5 rounded-full bg-muted">
                                    <div
                                        class="h-full rounded-full bg-blue-500 transition-all duration-750 starting:w-0"
                                        :class="[envelope.fill, envelope.delay]"
                                    ></div>
                                </div>
                            </li>
                        </ul>
                        <div
                            class="mt-6 flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm opacity-100 transition-opacity delay-700 duration-750 starting:opacity-0"
                        >
                            <Mic
                                class="size-4 shrink-0 text-amber-600 dark:text-amber-500"
                            />
                            <div class="min-w-0">
                                <p
                                    class="truncate text-muted-foreground italic"
                                >
                                    "fourteen twenty at the bakery"
                                </p>
                                <p class="truncate font-medium">
                                    Bakery · Eating out ·
                                    <span class="tabular-nums">−$14.20</span>
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <section
                class="mt-16 grid gap-8 border-t border-border pt-10 opacity-100 transition-opacity delay-300 duration-750 sm:grid-cols-3 lg:mt-24 starting:opacity-0"
            >
                <div v-for="feature in features" :key="feature.title">
                    <h3 class="mb-1.5 text-sm font-semibold">
                        {{ feature.title }}
                    </h3>
                    <p class="text-sm leading-relaxed text-muted-foreground">
                        {{ feature.body }}
                    </p>
                </div>
            </section>
        </main>

        <footer
            class="mx-auto w-full max-w-5xl px-6 pb-8 text-xs text-muted-foreground lg:px-8"
        >
            Your budget stays on your device.
        </footer>
    </div>
</template>
