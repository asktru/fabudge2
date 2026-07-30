<?php

use App\Models\Budget;
use App\Models\PayeeLocation;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

test('payee locations round-trip through push and pull', function () {
    $row = [
        'id' => (string) Str::uuid7(),
        'payee_id' => (string) Str::uuid7(),
        'latitude' => 43.6532001,
        'longitude' => -79.3831999,
        'updated_at' => 1000,
        'deleted_at' => null,
    ];

    pushAs($this->user, $this->team, [['table' => 'payee_locations', 'row' => $row]])
        ->assertOk()
        ->assertJsonPath('results.0.status', 'accepted');

    expect(PayeeLocation::query()->first()->latitude)->toEqualWithDelta(43.6532001, 0.0000001);

    $pulled = collect(pullAs($this->user, $this->team)->json('changes'))->firstWhere('table', 'payee_locations');
    expect((float) $pulled['row']['longitude'])->toEqualWithDelta(-79.3831999, 0.0000001);
});

test('out-of-range coordinates are rejected', function () {
    pushAs($this->user, $this->team, [['table' => 'payee_locations', 'row' => [
        'id' => (string) Str::uuid7(),
        'payee_id' => (string) Str::uuid7(),
        'latitude' => 91,
        'longitude' => 0,
        'updated_at' => 1000,
        'deleted_at' => null,
    ]]])->assertJsonPath('results.0.status', 'rejected');
});
