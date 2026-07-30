<?php

namespace App\Services\Sync;

use App\Models\Account;
use App\Models\Assignment;
use App\Models\Category;
use App\Models\CategoryGroup;
use App\Models\Payee;
use App\Models\SyncableModel;
use App\Models\Target;
use App\Models\Transaction;

/**
 * Registry of tables that participate in the sync protocol: model classes,
 * per-table validation rules, and the wire-to-column field lists.
 */
class SyncTables
{
    /** @var array<string, class-string<SyncableModel>> */
    public const array MODELS = [
        'accounts' => Account::class,
        'category_groups' => CategoryGroup::class,
        'categories' => Category::class,
        'payees' => Payee::class,
        'transactions' => Transaction::class,
        'assignments' => Assignment::class,
        'targets' => Target::class,
    ];

    public static function isKnown(string $table): bool
    {
        return array_key_exists($table, self::MODELS);
    }

    /**
     * Validation rules for one row of the given table (wire format).
     *
     * @return array<string, mixed>
     */
    public static function rules(string $table): array
    {
        $base = [
            'id' => ['required', 'uuid'],
            'updated_at' => ['required', 'integer', 'min:1'],
            'deleted_at' => ['nullable', 'integer', 'min:1'],
        ];

        $perTable = match ($table) {
            'accounts' => [
                'name' => ['required', 'string', 'max:255'],
                'currency' => ['required', 'string', 'size:3'],
                'type' => ['required', 'in:chequing,savings,cash,credit_card'],
                'on_budget' => ['required', 'boolean'],
                'note' => ['nullable', 'string'],
                'sort_order' => ['required', 'integer'],
            ],
            'category_groups' => [
                'name' => ['required', 'string', 'max:255'],
                'sort_order' => ['required', 'integer'],
            ],
            'categories' => [
                'category_group_id' => ['nullable', 'uuid'],
                'name' => ['required', 'string', 'max:255'],
                'sort_order' => ['required', 'integer'],
            ],
            'payees' => [
                'name' => ['required', 'string', 'max:255'],
            ],
            'transactions' => [
                'account_id' => ['required', 'uuid'],
                'date' => ['required', 'date_format:Y-m-d'],
                'amount' => ['required', 'integer'],
                'payee_id' => ['nullable', 'uuid'],
                'category_id' => ['nullable', 'uuid'],
                'memo' => ['nullable', 'string'],
                'cleared' => ['required', 'in:uncleared,cleared,reconciled'],
                'transfer_pair_id' => ['nullable', 'uuid'],
                'split_group_id' => ['nullable', 'uuid'],
            ],
            'assignments' => [
                'category_id' => ['required', 'uuid'],
                'month' => ['required', 'date_format:Y-m'],
                'amount' => ['required', 'integer'],
            ],
            'targets' => [
                'category_id' => ['required', 'uuid'],
                'type' => ['required', 'in:monthly,by_date,refill'],
                'amount' => ['required', 'integer', 'min:0'],
                'due_month' => ['nullable', 'date_format:Y-m'],
            ],
            default => [],
        };

        return [...$base, ...$perTable];
    }

    /**
     * Wire fields (beyond id/updated_at/deleted_at) persisted for a table.
     *
     * @return list<string>
     */
    public static function fields(string $table): array
    {
        return array_keys(self::rules($table));
    }
}
