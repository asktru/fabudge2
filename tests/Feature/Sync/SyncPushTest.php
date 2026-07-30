<?php

use App\Models\Account;
use App\Models\Budget;
use App\Models\Payee;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Str;

function pushAs(User $user, Team $team, array $changes)
{
    return test()->actingAs($user)->postJson("/{$team->slug}/sync/push", ['changes' => $changes]);
}

function accountRow(array $overrides = []): array
{
    return [
        'id' => (string) Str::uuid7(),
        'name' => 'Chequing',
        'currency' => 'CAD',
        'type' => 'chequing',
        'on_budget' => true,
        'note' => null,
        'sort_order' => 0,
        'updated_at' => 1000,
        'deleted_at' => null,
        ...$overrides,
    ];
}

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

test('push creates a new row with server_seq', function () {
    $row = accountRow();

    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => $row]])
        ->assertOk()
        ->assertJsonPath('results.0.status', 'accepted');

    $account = Account::findOrFail($row['id']);
    expect($account->budget_id)->toBe($this->budget->id)
        ->and($account->name)->toBe('Chequing')
        ->and($account->updated_at_ms)->toBe(1000)
        ->and($account->server_seq)->toBeGreaterThan(0);
});

test('newer update wins, older is stale', function () {
    $row = accountRow();
    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => $row]]);

    $newer = [...$row, 'name' => 'Renamed', 'updated_at' => 2000];
    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => $newer]])
        ->assertJsonPath('results.0.status', 'accepted');
    expect(Account::findOrFail($row['id'])->name)->toBe('Renamed');

    $older = [...$row, 'name' => 'Ancient', 'updated_at' => 500];
    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => $older]])
        ->assertJsonPath('results.0.status', 'stale');
    expect(Account::findOrFail($row['id'])->name)->toBe('Renamed');
});

test('replaying an identical push reports stale and changes nothing', function () {
    $row = accountRow();
    $change = [['table' => 'accounts', 'row' => $row]];

    pushAs($this->user, $this->team, $change)->assertJsonPath('results.0.status', 'accepted');
    $seq = Account::findOrFail($row['id'])->server_seq;

    pushAs($this->user, $this->team, $change)->assertJsonPath('results.0.status', 'stale');
    expect(Account::findOrFail($row['id'])->server_seq)->toBe($seq);
});

test('tombstones are accepted', function () {
    $row = accountRow();
    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => $row]]);

    $dead = [...$row, 'updated_at' => 2000, 'deleted_at' => 2000];
    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => $dead]])
        ->assertJsonPath('results.0.status', 'accepted');

    expect(Account::findOrFail($row['id'])->deleted_at_ms)->toBe(2000);
});

test('unknown table is rejected', function () {
    pushAs($this->user, $this->team, [['table' => 'users', 'row' => ['id' => (string) Str::uuid7(), 'updated_at' => 1]]])
        ->assertOk()
        ->assertJsonPath('results.0.status', 'rejected');
});

test('invalid enum value is rejected', function () {
    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => accountRow(['type' => 'yacht'])]])
        ->assertJsonPath('results.0.status', 'rejected');
});

test('budget_id in payload is ignored and forced from the team', function () {
    $foreign = Budget::forTeam(Team::factory()->create());
    $row = [...accountRow(), 'budget_id' => $foreign->id];

    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => $row]]);

    expect(Account::findOrFail($row['id'])->budget_id)->toBe($this->budget->id);
});

test('non-members cannot push', function () {
    $outsider = User::factory()->create();

    test()->actingAs($outsider)
        ->postJson("/{$this->team->slug}/sync/push", ['changes' => [['table' => 'accounts', 'row' => accountRow()]]])
        ->assertForbidden();
});

test('a member cannot overwrite a row belonging to another budget', function () {
    $otherTeam = Team::factory()->create();
    $otherUser = User::factory()->create();
    $otherTeam->members()->attach($otherUser, ['role' => 'owner']);
    $row = accountRow();
    pushAs($otherUser, $otherTeam, [['table' => 'accounts', 'row' => $row]]);

    pushAs($this->user, $this->team, [['table' => 'accounts', 'row' => [...$row, 'name' => 'Hijack', 'updated_at' => 9999]]])
        ->assertJsonPath('results.0.status', 'rejected');

    expect(Account::findOrFail($row['id'])->name)->toBe('Chequing');
});

test('server_seq strictly increases across accepted changes', function () {
    pushAs($this->user, $this->team, [
        ['table' => 'accounts', 'row' => accountRow()],
        ['table' => 'payees', 'row' => ['id' => (string) Str::uuid7(), 'name' => 'Metro', 'updated_at' => 1000, 'deleted_at' => null]],
    ])->assertOk();

    $seqs = collect([
        Account::query()->first()->server_seq,
        Payee::query()->first()->server_seq,
    ]);

    expect($seqs->unique())->toHaveCount(2)
        ->and($seqs->sort()->values()->all())->toBe($seqs->all());
});

test('batch size is limited to 500 changes', function () {
    $changes = array_fill(0, 501, ['table' => 'payees', 'row' => ['id' => (string) Str::uuid7(), 'name' => 'x', 'updated_at' => 1, 'deleted_at' => null]]);

    pushAs($this->user, $this->team, $changes)->assertUnprocessable();
});
