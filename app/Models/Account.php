<?php

namespace App\Models;

/**
 * @property string $name
 * @property string $currency
 * @property string $type
 * @property bool $on_budget
 * @property string|null $note
 * @property int $sort_order
 */
class Account extends SyncableModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'on_budget' => 'boolean',
        ];
    }
}
