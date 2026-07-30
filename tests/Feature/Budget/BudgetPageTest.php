<?php

use App\Models\Team;
use App\Models\User;

test('members can open the budget page', function () {
    $user = User::factory()->create();
    $team = Team::factory()->create();
    $team->members()->attach($user, ['role' => 'owner']);

    $this->actingAs($user)
        ->get("/{$team->slug}/budget")
        ->assertOk()
        ->assertInertia(fn ($page) => $page->component('Budget'));
});

test('guests are redirected to login', function () {
    $team = Team::factory()->create();

    $this->get("/{$team->slug}/budget")->assertRedirect('/login');
});

test('non-members cannot open the budget page', function () {
    $user = User::factory()->create();
    $team = Team::factory()->create();

    $this->actingAs($user)->get("/{$team->slug}/budget")->assertForbidden();
});
