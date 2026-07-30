<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Base for client-authored rows mirrored via the sync protocol.
 *
 * IDs are client-generated UUIDv7 strings; Eloquent timestamps are disabled
 * because the wire clock is `updated_at_ms` (unix milliseconds, set by the
 * writing client) and `server_seq` orders accepted changes globally.
 *
 * @property string $id
 * @property string $budget_id
 * @property int $updated_at_ms
 * @property int|null $deleted_at_ms
 * @property int $server_seq
 * @property-read Budget $budget
 */
abstract class SyncableModel extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $guarded = ['server_seq'];

    /**
     * @return BelongsTo<Budget, $this>
     */
    public function budget(): BelongsTo
    {
        return $this->belongsTo(Budget::class);
    }
}
