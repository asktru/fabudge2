<?php

namespace App\Models;

/**
 * A funding goal for a category.
 *
 * @property string $category_id
 * @property string $type
 * @property int $amount
 * @property string|null $due_month
 */
class Target extends SyncableModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount' => 'integer',
        ];
    }
}
