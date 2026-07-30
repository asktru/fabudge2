<?php

namespace App\Models;

/**
 * Money assigned to a category for a month, in the budget's main currency.
 *
 * @property string $category_id
 * @property string $month
 * @property int $amount
 */
class Assignment extends SyncableModel
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
