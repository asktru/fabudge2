<?php

namespace App\Models;

/**
 * @property string $account_id
 * @property string $date
 * @property int $amount
 * @property string|null $payee_id
 * @property string|null $category_id
 * @property string|null $memo
 * @property string $cleared
 * @property string|null $transfer_pair_id
 */
class Transaction extends SyncableModel
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
