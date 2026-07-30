<?php

use App\Models\Budget;
use App\Models\Team;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

test('split_group_id round-trips through push and pull', function () {
    $splitGroupId = (string) Str::uuid7();
    $accountId = (string) Str::uuid7();

    $rows = collect([1, 2])->map(fn (int $index) => [
        'id' => (string) Str::uuid7(),
        'account_id' => $accountId,
        'date' => '2026-07-30',
        'amount' => -1000 * $index,
        'payee_id' => null,
        'category_id' => null,
        'memo' => null,
        'cleared' => 'uncleared',
        'transfer_pair_id' => null,
        'split_group_id' => $splitGroupId,
        'updated_at' => 1000,
        'deleted_at' => null,
    ]);

    pushAs($this->user, $this->team, $rows->map(fn (array $row) => ['table' => 'transactions', 'row' => $row])->all())
        ->assertOk()
        ->assertJsonPath('results.0.status', 'accepted')
        ->assertJsonPath('results.1.status', 'accepted');

    expect(Transaction::query()->where('split_group_id', $splitGroupId)->count())->toBe(2);

    $pulled = pullAs($this->user, $this->team)->json('changes');
    expect(collect($pulled)->pluck('row.split_group_id')->all())->toBe([$splitGroupId, $splitGroupId]);
});

test('invalid split_group_id is rejected', function () {
    pushAs($this->user, $this->team, [['table' => 'transactions', 'row' => [
        'id' => (string) Str::uuid7(),
        'account_id' => (string) Str::uuid7(),
        'date' => '2026-07-30',
        'amount' => -100,
        'payee_id' => null,
        'category_id' => null,
        'memo' => null,
        'cleared' => 'uncleared',
        'transfer_pair_id' => null,
        'split_group_id' => 'not-a-uuid',
        'updated_at' => 1000,
        'deleted_at' => null,
    ]]])->assertJsonPath('results.0.status', 'rejected');
});
