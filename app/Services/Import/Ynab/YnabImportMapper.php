<?php

namespace App\Services\Import\Ynab;

use App\Services\Import\ImportPlan;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;

/**
 * Turns parsed YNAB export rows into an {@see ImportPlan}.
 *
 * This is where the export's lossiness is dealt with. YNAB's CSV carries no
 * identifiers, so entities are keyed by name; it flattens splits into sibling
 * rows and duplicates transfers across both accounts, so both relationships are
 * reconstructed here by inference. Every inference that could be wrong is
 * recorded as a warning rather than applied silently.
 */
class YnabImportMapper
{
    /** Categories YNAB writes for money that is not in a real category. */
    protected const array PSEUDO_CATEGORIES = ['ready to assign', 'uncategorized', 'uncategorised', 'inflow', 'to be budgeted'];

    /**
     * YNAB's per-card payment group. Its "categories" are really accounts, and
     * the machinery behind them has no equivalent here, so the group is skipped
     * as a category source and mined for account types instead.
     */
    protected const string CREDIT_CARD_GROUP = 'credit card payments';

    /** Account type every import starts at, because the export omits types. */
    protected const string DEFAULT_ACCOUNT_TYPE = 'chequing';

    /** @var array<string, string> */
    protected array $accounts = [];

    /** @var array<string, string> */
    protected array $groups = [];

    /** @var array<string, string> */
    protected array $categories = [];

    /** @var array<string, string> */
    protected array $payees = [];

    /** @var list<string> Account names YNAB tracks a payment category for. */
    protected array $creditCardAccounts = [];

    /** @var list<array{table: string, row: array<string, mixed>}> */
    protected array $changes = [];

    /** @var list<string> */
    protected array $warnings = [];

    protected int $timestamp = 0;

    /**
     * @param  list<YnabRegisterRow>  $register
     * @param  list<YnabPlanRow>  $plan
     */
    public function map(array $register, array $plan, string $currency): ImportPlan
    {
        $this->reset();
        $this->creditCardAccounts = $this->creditCardAccountsIn($plan);

        foreach ($register as $row) {
            $this->accountId($row->account, $currency);
            $this->categoryId($row->categoryGroup, $row->category);

            if (! $row->isTransfer() && $row->payee !== '') {
                $this->payeeId($row->payee);
            }
        }

        foreach ($plan as $row) {
            $this->categoryId($row->categoryGroup, $row->category);
        }

        $transactions = $this->mapTransactions($register);

        foreach ($transactions as $transaction) {
            $this->push('transactions', $transaction);
        }

        $this->mapAssignments($plan);
        $this->warnAboutLossiness($register, $plan);

        return new ImportPlan($this->changes, $this->warnings, $this->summarise());
    }

    protected function reset(): void
    {
        $this->accounts = $this->groups = $this->categories = $this->payees = [];
        $this->changes = $this->warnings = $this->creditCardAccounts = [];
        $this->timestamp = (int) (microtime(true) * 1000);
    }

    /**
     * Build every transaction row, then reconstruct splits and transfer pairs.
     *
     * @param  list<YnabRegisterRow>  $register
     * @return list<array<string, mixed>>
     */
    protected function mapTransactions(array $register): array
    {
        $transactions = array_map(fn (YnabRegisterRow $row) => [
            'id' => (string) Str::uuid7(),
            'account_id' => $this->accounts[$row->account] ?? null,
            'date' => $row->date,
            'amount' => $row->amount,
            'payee_id' => $row->isTransfer() ? null : ($this->payees[$row->payee] ?? null),
            'category_id' => $this->categories[$this->categoryKey($row->categoryGroup, $row->category)] ?? null,
            'memo' => $row->memo === '' ? null : $row->memo,
            'cleared' => $row->cleared,
            'transfer_pair_id' => null,
            'split_group_id' => null,
            'updated_at' => $this->timestamp,
            'deleted_at' => null,
        ], $register);

        $this->assignSplitGroups($register, $transactions);
        $this->pairTransfers($register, $transactions);

        return $transactions;
    }

    /**
     * Rebuild split parents from the "Split (n/m)" markers.
     *
     * The rows of one split are always consecutive and share an account, date,
     * and payee; a marker numbered 1 starts a new group. That is the strongest
     * signal the export offers — there is no parent row to recover.
     *
     * @param  list<YnabRegisterRow>  $register
     * @param  list<array<string, mixed>>  $transactions
     */
    protected function assignSplitGroups(array $register, array &$transactions): void
    {
        $groupId = null;
        $previous = null;

        foreach ($register as $index => $row) {
            if (! $row->isSplit()) {
                $groupId = $previous = null;

                continue;
            }

            $continues = $previous !== null
                && $row->splitIndex === $previous->splitIndex + 1
                && $row->splitCount === $previous->splitCount
                && $row->account === $previous->account
                && $row->date === $previous->date
                && $row->payee === $previous->payee;

            $groupId = $continues ? $groupId : (string) Str::uuid7();
            $transactions[$index]['split_group_id'] = $groupId;
            $previous = $row;
        }
    }

    /**
     * Link the two exported halves of each transfer.
     *
     * YNAB writes a transfer once per account, so rows are bucketed by the
     * unordered account pair, date, and magnitude, and then matched off one
     * outflow against one inflow. Anything left over means the counterpart
     * account was not part of the export.
     *
     * @param  list<YnabRegisterRow>  $register
     * @param  list<array<string, mixed>>  $transactions
     */
    protected function pairTransfers(array $register, array &$transactions): void
    {
        $buckets = [];

        foreach ($register as $index => $row) {
            if (! $row->isTransfer()) {
                continue;
            }

            $pair = [$row->account, (string) $row->transferAccount];
            sort($pair);
            $key = implode("\0", [...$pair, $row->date, (string) abs($row->amount)]);
            $buckets[$key][$row->amount < 0 ? 'out' : 'in'][] = $index;
        }

        $unpaired = 0;

        foreach ($buckets as $bucket) {
            $outflows = $bucket['out'] ?? [];
            $inflows = $bucket['in'] ?? [];

            foreach ($outflows as $position => $outflow) {
                if (! isset($inflows[$position])) {
                    $unpaired++;

                    continue;
                }

                $inflow = $inflows[$position];
                $transactions[$outflow]['transfer_pair_id'] = $transactions[$inflow]['id'];
                $transactions[$inflow]['transfer_pair_id'] = $transactions[$outflow]['id'];
            }

            $unpaired += max(0, count($inflows) - count($outflows));
        }

        if ($unpaired > 0) {
            $this->warnings[] = $unpaired === 1
                ? '1 transfer had no matching row in the export and was imported as a one-sided transaction.'
                : sprintf('%d transfers had no matching row in the export and were imported as one-sided transactions.', $unpaired);
        }
    }

    /**
     * The accounts YNAB keeps a credit card payment category for.
     *
     * This is the only place an export says anything about account types, so it
     * is worth mining: everything else has to fall back to a default.
     *
     * @param  list<YnabPlanRow>  $plan
     * @return list<string>
     */
    protected function creditCardAccountsIn(array $plan): array
    {
        return array_values(array_unique(array_map(
            fn (YnabPlanRow $row) => $row->category,
            array_filter($plan, fn (YnabPlanRow $row) => strtolower($row->categoryGroup) === self::CREDIT_CARD_GROUP),
        )));
    }

    /**
     * @param  list<YnabPlanRow>  $plan
     */
    protected function mapAssignments(array $plan): void
    {
        foreach ($plan as $row) {
            $categoryId = $this->categories[$this->categoryKey($row->categoryGroup, $row->category)] ?? null;

            if ($categoryId === null || $row->assigned === 0) {
                continue;
            }

            $this->push('assignments', [
                'id' => (string) Str::uuid7(),
                'category_id' => $categoryId,
                'month' => $row->month,
                'amount' => $row->assigned,
            ]);
        }
    }

    /**
     * @param  list<YnabRegisterRow>  $register
     * @param  list<YnabPlanRow>  $plan
     */
    protected function warnAboutLossiness(array $register, array $plan): void
    {
        $this->warnAboutAccountTypes();
        $this->warnAboutCreditCardAssignments($plan);
        $this->warnAboutFutureDates($register);

        if (array_any($register, fn (YnabRegisterRow $row) => $row->isSplit())) {
            $this->warnings[] = 'YNAB exports split transactions as separate rows, so splits were regrouped by date and payee and may not match the original grouping exactly.';
        }
    }

    /**
     * YNAB exports upcoming scheduled transactions into the register but leaves
     * them out of the plan's Activity, so an imported budget legitimately
     * disagrees with YNAB's own numbers until those dates pass.
     *
     * @param  list<YnabRegisterRow>  $register
     */
    protected function warnAboutFutureDates(array $register): void
    {
        $today = Date::today()->toDateString();
        $future = count(array_filter($register, fn (YnabRegisterRow $row) => $row->date > $today));

        if ($future === 0) {
            return;
        }

        $this->warnings[] = sprintf(
            '%d %s dated in the future. YNAB keeps these as upcoming and leaves them out of category activity, so your plan totals may differ from YNAB until those dates arrive.',
            $future,
            $future === 1 ? 'transaction is' : 'transactions are',
        );
    }

    protected function warnAboutAccountTypes(): void
    {
        $total = count($this->accounts);

        if ($total === 0) {
            return;
        }

        $cards = count(array_filter(
            array_keys($this->accounts),
            fn (string $name) => in_array($name, $this->creditCardAccounts, strict: true),
        ));
        $guessed = $total - $cards;

        if ($cards === 0) {
            $this->warnings[] = sprintf(
                'YNAB exports do not record account types, so all %d %s imported as a %s account.',
                $total,
                $total === 1 ? 'account was' : 'accounts were',
                self::DEFAULT_ACCOUNT_TYPE,
            );

            return;
        }

        $this->warnings[] = sprintf(
            '%d credit %s recognised from your Credit Card Payments categories; the other %d %s imported as a %s account.',
            $cards,
            $cards === 1 ? 'card was' : 'cards were',
            $guessed,
            $guessed === 1 ? 'account was' : 'accounts were',
            self::DEFAULT_ACCOUNT_TYPE,
        );
    }

    /**
     * @param  list<YnabPlanRow>  $plan
     */
    protected function warnAboutCreditCardAssignments(array $plan): void
    {
        $assigned = array_sum(array_map(
            fn (YnabPlanRow $row) => $row->assigned,
            array_filter($plan, fn (YnabPlanRow $row) => strtolower($row->categoryGroup) === self::CREDIT_CARD_GROUP),
        ));

        if ($assigned === 0) {
            return;
        }

        $this->warnings[] = sprintf(
            'YNAB tracks credit card payments as budget categories, which fabudge does not; %s assigned to them was not imported.',
            number_format($assigned / 100, 2),
        );
    }

    protected function accountId(string $name, string $currency): ?string
    {
        if ($name === '') {
            return null;
        }

        return $this->accounts[$name] ??= $this->push('accounts', [
            'id' => (string) Str::uuid7(),
            'name' => $name,
            'currency' => $currency,
            'type' => in_array($name, $this->creditCardAccounts, strict: true) ? 'credit_card' : self::DEFAULT_ACCOUNT_TYPE,
            'on_budget' => true,
            'note' => null,
            'sort_order' => count($this->accounts),
        ]);
    }

    protected function categoryId(string $group, string $name): ?string
    {
        if ($this->isPseudoCategory($group, $name)) {
            return null;
        }

        return $this->categories[$this->categoryKey($group, $name)] ??= $this->push('categories', [
            'id' => (string) Str::uuid7(),
            'category_group_id' => $this->groupId($group),
            'name' => $name,
            'sort_order' => count($this->categories),
        ]);
    }

    protected function groupId(string $name): ?string
    {
        if ($name === '') {
            return null;
        }

        return $this->groups[$name] ??= $this->push('category_groups', [
            'id' => (string) Str::uuid7(),
            'name' => $name,
            'sort_order' => count($this->groups),
        ]);
    }

    protected function payeeId(string $name): string
    {
        return $this->payees[$name] ??= $this->push('payees', [
            'id' => (string) Str::uuid7(),
            'name' => $name,
        ]);
    }

    /**
     * A category is only identified by its name within its group, so both parts
     * form the key; two groups may each have a "Fun".
     */
    protected function categoryKey(string $group, string $name): string
    {
        return $group."\0".$name;
    }

    protected function isPseudoCategory(string $group, string $name): bool
    {
        return $name === ''
            || strtolower($group) === self::CREDIT_CARD_GROUP
            || in_array(strtolower($name), self::PSEUDO_CATEGORIES, strict: true)
            || in_array(strtolower($group), self::PSEUDO_CATEGORIES, strict: true);
    }

    /**
     * Queue a row for its table and hand back its id.
     *
     * @param  array<string, mixed>  $row
     */
    protected function push(string $table, array $row): string
    {
        $this->changes[] = [
            'table' => $table,
            'row' => [...$row, 'updated_at' => $row['updated_at'] ?? $this->timestamp, 'deleted_at' => null],
        ];

        return $row['id'];
    }

    /**
     * @return array<string, int>
     */
    protected function summarise(): array
    {
        $counts = [];

        foreach ($this->changes as $change) {
            $counts[$change['table']] = ($counts[$change['table']] ?? 0) + 1;
        }

        return $counts;
    }
}
