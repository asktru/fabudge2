<?php

use App\Actions\Import\ApplyImportPlan;
use App\Models\Account;
use App\Models\Budget;
use App\Models\Team;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Import\ImportFailedException;
use App\Services\Import\ImportPlan;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

/** An import plan holding one account and one transaction against it. */
function tinyPlan(int $amount = -1250): ImportPlan
{
    $accountId = (string) Str::uuid7();

    return new ImportPlan([
        ['table' => 'accounts', 'row' => [
            'id' => $accountId,
            'name' => 'Chequing',
            'currency' => 'CAD',
            'type' => 'chequing',
            'on_budget' => true,
            'note' => null,
            'sort_order' => 0,
            'updated_at' => 1000,
            'deleted_at' => null,
        ]],
        ['table' => 'transactions', 'row' => [
            'id' => (string) Str::uuid7(),
            'account_id' => $accountId,
            'date' => '2026-07-02',
            'amount' => $amount,
            'payee_id' => null,
            'category_id' => null,
            'memo' => 'imported',
            'cleared' => 'cleared',
            'transfer_pair_id' => null,
            'split_group_id' => null,
            'updated_at' => 1000,
            'deleted_at' => null,
        ]],
    ]);
}

test('writes the plan into the budget', function () {
    $applied = app(ApplyImportPlan::class)->handle($this->budget, tinyPlan());

    expect($applied)->toBe(2);
    expect(Account::query()->where('budget_id', $this->budget->id)->value('name'))->toBe('Chequing');
    expect(Transaction::query()->where('budget_id', $this->budget->id)->value('amount'))->toBe(-1250);
});

test('gives imported rows sequence numbers so clients pull them', function () {
    app(ApplyImportPlan::class)->handle($this->budget, tinyPlan());

    $changes = $this->actingAs($this->user)
        ->getJson(route('sync.pull', ['current_team' => $this->team, 'cursor' => 0]))
        ->json('changes');

    expect(collect($changes)->pluck('table')->all())->toBe(['accounts', 'transactions']);
});

test('rolls the whole import back when any row is invalid', function () {
    $plan = new ImportPlan([
        ...tinyPlan()->changes,
        ['table' => 'transactions', 'row' => [
            'id' => (string) Str::uuid7(),
            'account_id' => 'not-a-uuid',
            'date' => '2026-07-02',
            'amount' => -100,
            'cleared' => 'cleared',
            'updated_at' => 1000,
            'deleted_at' => null,
        ]],
    ]);

    expect(fn () => app(ApplyImportPlan::class)->handle($this->budget, $plan))
        ->toThrow(ImportFailedException::class);

    expect(Account::query()->count())->toBe(0);
    expect(Transaction::query()->count())->toBe(0);
});

test('refuses to write rows belonging to another budget', function () {
    $otherTeam = Team::factory()->create();
    $otherBudget = Budget::forTeam($otherTeam);
    app(ApplyImportPlan::class)->handle($otherBudget, $plan = tinyPlan());

    expect(fn () => app(ApplyImportPlan::class)->handle($this->budget, $plan))
        ->toThrow(ImportFailedException::class);

    expect(Account::query()->where('budget_id', $this->budget->id)->count())->toBe(0);
});
