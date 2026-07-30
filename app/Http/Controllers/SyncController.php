<?php

namespace App\Http\Controllers;

use App\Models\Budget;
use App\Models\SyncableModel;
use App\Models\Team;
use App\Services\ExchangeRateService;
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
     * Return all changes after the client's cursor, ordered by server_seq,
     * plus the latest cached exchange rates.
     */
    public function pull(Request $request, Team $current_team, ExchangeRateService $rates): JsonResponse
    {
        $params = $request->validate([
            'cursor' => ['required', 'integer', 'min:0'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:1000'],
        ]);

        $budget = Budget::forTeam($current_team);
        $cursor = (int) $params['cursor'];
        $limit = (int) ($params['limit'] ?? 1000);

        $changes = collect(SyncTables::MODELS)
            ->flatMap(fn (string $model, string $table) => $model::query()
                ->where('budget_id', $budget->id)
                ->where('server_seq', '>', $cursor)
                ->orderBy('server_seq')
                ->limit($limit + 1)
                ->get()
                ->map(fn (SyncableModel $row) => [
                    'table' => $table,
                    'server_seq' => $row->server_seq,
                    'row' => $this->toWire($table, $row),
                ]))
            ->sortBy('server_seq')
            ->values();

        $page = $changes->take($limit);

        return response()->json([
            'changes' => $page->map(fn (array $change) => [
                'table' => $change['table'],
                'row' => $change['row'],
            ])->all(),
            'cursor' => $page->max('server_seq') ?? $cursor,
            'has_more' => $changes->count() > $limit,
            'rates' => $rates->current(),
        ]);
    }

    /**
     * Convert a stored row to wire format.
     *
     * @return array<string, mixed>
     */
    protected function toWire(string $table, SyncableModel $row): array
    {
        $wire = ['id' => $row->id, 'updated_at' => $row->updated_at_ms, 'deleted_at' => $row->deleted_at_ms];

        foreach (SyncTables::fields($table) as $field) {
            if (! array_key_exists($field, $wire)) {
                $wire[$field] = $row->getAttribute($field);
            }
        }

        return $wire;
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
