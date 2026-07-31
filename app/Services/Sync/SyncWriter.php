<?php

namespace App\Services\Sync;

use App\Models\Budget;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Applies one wire row to its table using row-level last-write-wins.
 *
 * Both the sync endpoint and the importer write through here, so imported rows
 * get the same validation, budget ownership check, and sequence numbering that
 * a client push does — and therefore show up in the next pull like any other
 * change.
 */
class SyncWriter
{
    /**
     * Apply a single change. Callers must already hold a database transaction.
     *
     * @param  array<string, mixed>  $row
     * @return array{id: string|null, table: string, status: string, reason: string|null}
     */
    public function apply(Budget $budget, string $table, array $row): array
    {
        $result = fn (string $status, ?string $reason = null) => [
            'id' => $row['id'] ?? null,
            'table' => $table,
            'status' => $status,
            'reason' => $reason,
        ];

        if (! SyncTables::isKnown($table)) {
            return $result('rejected', 'unknown table');
        }

        $validator = Validator::make($row, SyncTables::rules($table));

        if ($validator->fails()) {
            return $result('rejected', $validator->errors()->first());
        }

        $data = $validator->validated();
        $model = SyncTables::MODELS[$table];
        $existing = $model::query()->find($data['id']);

        if ($existing && $existing->budget_id !== $budget->id) {
            return $result('rejected', 'row belongs to another budget');
        }

        if ($existing && $existing->updated_at_ms >= $data['updated_at']) {
            return $result('stale');
        }

        $attributes = [
            ...array_diff_key($data, array_flip(['id', 'updated_at', 'deleted_at'])),
            'budget_id' => $budget->id,
            'updated_at_ms' => $data['updated_at'],
            'deleted_at_ms' => $data['deleted_at'] ?? null,
            'server_seq' => $this->nextServerSeq(),
        ];

        if ($existing) {
            $existing->forceFill($attributes)->save();
        } else {
            $instance = new $model;
            $instance->id = $data['id'];
            $instance->forceFill($attributes)->save();
        }

        return $result('accepted');
    }

    /**
     * Allocate the next global sequence number (caller must hold a transaction).
     */
    public function nextServerSeq(): int
    {
        DB::table('sync_sequence')->where('id', 1)->lockForUpdate()->increment('value');

        return (int) DB::table('sync_sequence')->where('id', 1)->value('value');
    }
}
