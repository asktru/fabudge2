<?php

namespace App\Models;

/**
 * A geographic spot associated with a payee (m-to-n via multiple rows).
 *
 * @property string $payee_id
 * @property float $latitude
 * @property float $longitude
 */
class PayeeLocation extends SyncableModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
        ];
    }
}
