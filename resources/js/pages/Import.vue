<script setup lang="ts">
import { Form, Head, Link, usePage } from '@inertiajs/vue3';
import { CircleAlert, CircleCheck, Upload } from '@lucide/vue';
import { computed, ref } from 'vue';
import ImportController from '@/actions/App/Http/Controllers/ImportController';
import AlertError from '@/components/AlertError.vue';
import Heading from '@/components/Heading.vue';
import InputError from '@/components/InputError.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { budget } from '@/routes';

type ImportResult = {
    summary: Record<string, number>;
    warnings: string[];
};

const props = defineProps<{
    budgetCurrency: string;
    result: ImportResult | null;
}>();

const page = usePage();

/** Human labels for the sync tables an import writes to. */
const rowLabels: Record<string, string> = {
    accounts: 'accounts',
    category_groups: 'category groups',
    categories: 'categories',
    payees: 'payees',
    transactions: 'transactions',
    assignments: 'monthly assignments',
};

const imported = computed(() =>
    Object.entries(props.result?.summary ?? {})
        .filter(([, count]) => count > 0)
        .map(([table, count]) => ({
            table,
            count,
            label: rowLabels[table] ?? table,
        })),
);

const teamSlug = computed(() => page.props.currentTeam!.slug);
const budgetUrl = computed(() => budget(teamSlug.value).url);

const fileName = ref<string | null>(null);
const dateOrder = ref<string | undefined>(undefined);

function onFileChange(event: Event): void {
    fileName.value =
        (event.target as HTMLInputElement).files?.[0]?.name ?? null;
}
</script>

<template>
    <Head title="Import from YNAB" />

    <div class="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4">
        <Heading
            title="Import from YNAB"
            description="Bring your accounts, categories, and transaction history across from YNAB."
        />

        <section
            v-if="result"
            class="rounded-xl border border-emerald-600/30 bg-emerald-500/5 p-5"
        >
            <div class="flex items-start gap-3">
                <CircleCheck class="mt-0.5 size-5 shrink-0 text-emerald-600" />
                <div class="flex-1 space-y-4">
                    <div class="space-y-1">
                        <h2 class="font-medium">Import complete</h2>
                        <ul class="text-sm text-muted-foreground">
                            <li v-for="row in imported" :key="row.table">
                                {{ row.count }} {{ row.label }}
                            </li>
                        </ul>
                    </div>

                    <div v-if="result.warnings.length" class="space-y-2">
                        <p class="flex items-center gap-2 text-sm font-medium">
                            <CircleAlert class="size-4 text-amber-600" />
                            What the export could not tell us
                        </p>
                        <ul
                            class="list-inside list-disc space-y-1 text-sm text-muted-foreground"
                        >
                            <li
                                v-for="(warning, index) in result.warnings"
                                :key="index"
                            >
                                {{ warning }}
                            </li>
                        </ul>
                    </div>

                    <Button as-child size="sm">
                        <Link :href="budgetUrl">Open your budget</Link>
                    </Button>
                </div>
            </div>
        </section>

        <section class="space-y-2 text-sm text-muted-foreground">
            <h2 class="font-medium text-foreground">Getting your export</h2>
            <ol class="list-inside list-decimal space-y-1">
                <li>In YNAB, open your plan and choose Export budget data.</li>
                <li>
                    YNAB emails or downloads a .zip containing two CSV files.
                </li>
                <li>Upload that .zip below — no need to unpack it.</li>
            </ol>
            <p>
                Everything is imported into this team's budget in
                {{ budgetCurrency }}. Nothing already in your budget is changed
                or removed.
            </p>
        </section>

        <Form
            v-bind="ImportController.store.form(teamSlug)"
            class="space-y-6"
            v-slot="{ errors, processing }"
        >
            <div class="grid gap-2">
                <Label for="file">YNAB export</Label>
                <Input
                    id="file"
                    type="file"
                    name="file"
                    accept=".zip,.csv,.tsv,.txt"
                    class="cursor-pointer"
                    @change="onFileChange"
                />
                <p v-if="fileName" class="text-xs text-muted-foreground">
                    {{ fileName }}
                </p>
                <InputError :message="errors.file" />
            </div>

            <div v-if="errors.date_order" class="grid gap-2">
                <Label for="date_order">Date order</Label>
                <Select v-model="dateOrder" name="date_order">
                    <SelectTrigger id="date_order">
                        <SelectValue
                            placeholder="Choose how YNAB wrote dates"
                        />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="month-first">
                            Month first — 05/03/2026 is 3 May 2026
                        </SelectItem>
                        <SelectItem value="day-first">
                            Day first — 05/03/2026 is 5 March 2026
                        </SelectItem>
                    </SelectContent>
                </Select>
                <InputError :message="errors.date_order" />
                <p class="text-xs text-muted-foreground">
                    Pick the order, then upload the same file again.
                </p>
            </div>

            <AlertError
                v-if="errors.file && !errors.date_order"
                :errors="[errors.file]"
                title="That export could not be read."
            />

            <Button type="submit" :disabled="processing">
                <Upload class="size-4" />
                Import
            </Button>
        </Form>
    </div>
</template>
