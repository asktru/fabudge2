<?php

use App\Models\Budget;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function pullAs(User $user, Team $team, int $cursor = 0, ?int $limit = null)
{
    $query = http_build_query(['cursor' => $cursor] + ($limit !== null ? ['limit' => $limit] : []));

    return test()->actingAs($user)->getJson("/{$team->slug}/sync/pull?{$query}");
}

function payeeRow(string $name): array
{
    return ['id' => (string) Str::uuid7(), 'name' => $name, 'updated_at' => 1000, 'deleted_at' => null];
}

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

test('pull from zero returns all changes in server_seq order with cursor', function () {
    pushAs($this->user, $this->team, [
        ['table' => 'payees', 'row' => payeeRow('Metro')],
        ['table' => 'accounts', 'row' => accountRow()],
        ['table' => 'payees', 'row' => payeeRow('Amazon')],
    ]);

    $response = pullAs($this->user, $this->team)->assertOk()->json();

    expect($response['changes'])->toHaveCount(3)
        ->and(array_column($response['changes'], 'table'))->toBe(['payees', 'accounts', 'payees'])
        ->and($response['has_more'])->toBeFalse()
        ->and($response['cursor'])->toBeGreaterThanOrEqual(3)
        ->and($response['changes'][0]['row']['name'])->toBe('Metro')
        ->and($response['changes'][0]['row']['updated_at'])->toBe(1000)
        ->and($response['changes'][0]['row'])->not->toHaveKeys(['budget_id', 'server_seq', 'updated_at_ms']);
});

test('cursor skips already-seen changes', function () {
    pushAs($this->user, $this->team, [['table' => 'payees', 'row' => payeeRow('Metro')]]);
    $cursor = pullAs($this->user, $this->team)->json('cursor');

    pushAs($this->user, $this->team, [['table' => 'payees', 'row' => payeeRow('Amazon')]]);

    $response = pullAs($this->user, $this->team, $cursor)->json();

    expect($response['changes'])->toHaveCount(1)
        ->and($response['changes'][0]['row']['name'])->toBe('Amazon');
});

test('pagination respects limit and signals has_more', function () {
    pushAs($this->user, $this->team, [
        ['table' => 'payees', 'row' => payeeRow('One')],
        ['table' => 'payees', 'row' => payeeRow('Two')],
        ['table' => 'payees', 'row' => payeeRow('Three')],
    ]);

    $page1 = pullAs($this->user, $this->team, 0, 2)->json();
    expect($page1['changes'])->toHaveCount(2)->and($page1['has_more'])->toBeTrue();

    $page2 = pullAs($this->user, $this->team, $page1['cursor'], 2)->json();
    expect($page2['changes'])->toHaveCount(1)->and($page2['has_more'])->toBeFalse();

    $names = array_merge(
        array_column(array_column($page1['changes'], 'row'), 'name'),
        array_column(array_column($page2['changes'], 'row'), 'name'),
    );
    expect($names)->toBe(['One', 'Two', 'Three']);
});

test('other teams data is never returned', function () {
    $otherTeam = Team::factory()->create();
    $otherUser = User::factory()->create();
    $otherTeam->members()->attach($otherUser, ['role' => 'owner']);
    pushAs($otherUser, $otherTeam, [['table' => 'payees', 'row' => payeeRow('Secret')]]);
    pushAs($this->user, $this->team, [['table' => 'payees', 'row' => payeeRow('Mine')]]);

    $response = pullAs($this->user, $this->team)->json();

    expect($response['changes'])->toHaveCount(1)
        ->and($response['changes'][0]['row']['name'])->toBe('Mine');
});

test('tombstones are included in pull', function () {
    $row = payeeRow('Metro');
    pushAs($this->user, $this->team, [['table' => 'payees', 'row' => $row]]);
    pushAs($this->user, $this->team, [['table' => 'payees', 'row' => [...$row, 'updated_at' => 2000, 'deleted_at' => 2000]]]);

    $response = pullAs($this->user, $this->team)->json();

    expect($response['changes'])->toHaveCount(1)
        ->and($response['changes'][0]['row']['deleted_at'])->toBe(2000);
});

test('rates ride along with the pull response', function () {
    DB::table('exchange_rates')->insert([
        ['quote_currency' => 'USD', 'rate' => 0.73, 'fetched_at' => now()],
        ['quote_currency' => 'UAH', 'rate' => 30.4, 'fetched_at' => now()],
    ]);

    $response = pullAs($this->user, $this->team)->json();

    expect($response['rates']['base'])->toBe('CAD')
        ->and($response['rates']['quotes']['USD'])->toEqualWithDelta(0.73, 0.0001)
        ->and($response['rates']['quotes']['UAH'])->toEqualWithDelta(30.4, 0.0001);
});

test('non-members cannot pull', function () {
    $outsider = User::factory()->create();

    test()->actingAs($outsider)->getJson("/{$this->team->slug}/sync/pull?cursor=0")->assertForbidden();
});
