<?php

use App\Models\Budget;
use App\Models\Team;

test('creating a team does not provision a budget', function () {
    $team = Team::factory()->create();

    expect(Budget::query()->where('team_id', $team->id)->exists())->toBeFalse();
});

test('forTeam creates a budget on first access', function () {
    $team = Team::factory()->create(['name' => 'Household']);

    $budget = Budget::forTeam($team);

    expect($budget->team_id)->toBe($team->id)
        ->and($budget->name)->toBe('Household')
        ->and($budget->currency)->toBe('CAD')
        ->and($budget->id)->toBeUuid();
});

test('forTeam is idempotent', function () {
    $team = Team::factory()->create();

    $first = Budget::forTeam($team);
    $second = Budget::forTeam($team);

    expect($second->id)->toBe($first->id)
        ->and(Budget::query()->count())->toBe(1);
});

test('budgets are scoped per team', function () {
    $teamA = Team::factory()->create();
    $teamB = Team::factory()->create();

    expect(Budget::forTeam($teamA)->id)->not->toBe(Budget::forTeam($teamB)->id);
});
