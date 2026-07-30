<?php

namespace App\Http\Controllers;

use App\Models\Budget;
use App\Models\Team;
use App\Services\Sync\SyncTables;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class SyncController extends Controller
{
    /**
     * Apply a batch of client changes using row-level last-write-wins.
     */
    public function push(Request $request, Team $current_team): JsonResponse
    {
        $payload = $request->validate([
            'changes' => ['required', 'array', 'max:500'],
            'changes.*.table' => ['required', 'string'],
            'changes.*.row' => ['required', 'array'],
        ]);

        $budget = Budget::forTeam($current_team);

        $results = DB::transaction(function () use ($payload, $budget) {
            $results = [];

            foreach ($payload['changes'] as $change) {
                $results[] = $this->applyChange($budget, $change['table'], $change['row']);
            }

            return $results;
        });

        return response()->json([
            'results' => $results,
            'server_seq' => DB::table('sync_sequence')->value('value'),
        ]);
    }

    /**
     * Apply one row change; returns its wire result.
     *
     * @param  array<string, mixed>  $row
     * @return array{id: string|null, table: string, status: string, reason: string|null}
     */
    protected function applyChange(Budget $budget, string $table, array $row): array
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
    protected function nextServerSeq(): int
    {
        DB::table('sync_sequence')->where('id', 1)->lockForUpdate()->increment('value');

        return (int) DB::table('sync_sequence')->where('id', 1)->value('value');
    }
}
