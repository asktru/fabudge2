<?php

use App\Models\Assignment;
use App\Models\Budget;
use App\Models\Target;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

test('assignments and targets round-trip through push and pull', function () {
    $categoryId = (string) Str::uuid7();

    pushAs($this->user, $this->team, [
        ['table' => 'assignments', 'row' => [
            'id' => (string) Str::uuid7(),
            'category_id' => $categoryId,
            'month' => '2026-07',
            'amount' => 30000,
            'updated_at' => 1000,
            'deleted_at' => null,
        ]],
        ['table' => 'targets', 'row' => [
            'id' => (string) Str::uuid7(),
            'category_id' => $categoryId,
            'type' => 'by_date',
            'amount' => 300000,
            'due_month' => '2026-12',
            'updated_at' => 1000,
            'deleted_at' => null,
        ]],
    ])->assertOk()
        ->assertJsonPath('results.0.status', 'accepted')
        ->assertJsonPath('results.1.status', 'accepted');

    expect(Assignment::query()->count())->toBe(1)
        ->and(Target::query()->first()->due_month)->toBe('2026-12');

    $pulled = collect(pullAs($this->user, $this->team)->json('changes'));
    expect($pulled->pluck('table')->sort()->values()->all())->toBe(['assignments', 'targets'])
        ->and($pulled->firstWhere('table', 'assignments')['row']['month'])->toBe('2026-07');
});

test('invalid month format and target type are rejected', function () {
    pushAs($this->user, $this->team, [
        ['table' => 'assignments', 'row' => [
            'id' => (string) Str::uuid7(),
            'category_id' => (string) Str::uuid7(),
            'month' => '2026-7',
            'amount' => 100,
            'updated_at' => 1000,
            'deleted_at' => null,
        ]],
        ['table' => 'targets', 'row' => [
            'id' => (string) Str::uuid7(),
            'category_id' => (string) Str::uuid7(),
            'type' => 'weekly',
            'amount' => 100,
            'due_month' => null,
            'updated_at' => 1000,
            'deleted_at' => null,
        ]],
    ])->assertJsonPath('results.0.status', 'rejected')
        ->assertJsonPath('results.1.status', 'rejected');
});
