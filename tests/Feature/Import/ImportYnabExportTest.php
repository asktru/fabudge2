<?php

use App\Models\Account;
use App\Models\Assignment;
use App\Models\Budget;
use App\Models\Category;
use App\Models\Team;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Inertia\Testing\AssertableInertia;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

/** A minimal but complete YNAB register export. */
function registerCsv(string ...$lines): string
{
    return implode("\n", [
        '"Account","Flag","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
        ...($lines ?: [
            '"Chequing","","07/28/2026","Costco","Everyday","Groceries","weekly","$40.00","$0.00","Cleared"',
            '"Chequing","","07/30/2026","Employer","Inflow","Ready to Assign","","$0.00","$2,500.00","Cleared"',
        ]),
    ]);
}

/** Zip a register (and optionally a plan) into an uploadable YNAB export. */
function exportZip(string $register, ?string $plan = null): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'export').'.zip';
    $zip = new ZipArchive;
    $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString('My Budget as of 2026-07-30 - Register.csv', $register);

    if ($plan !== null) {
        $zip->addFromString('My Budget as of 2026-07-30 - Plan.csv', $plan);
    }

    $zip->close();

    return new UploadedFile($path, 'ynab-export.zip', 'application/zip', test: true);
}

/** Post an export to the import endpoint as the acting user. */
function importExport(UploadedFile $file, array $extra = [])
{
    return test()->actingAs(test()->user)->post(
        route('import.store', ['current_team' => test()->team]),
        ['file' => $file, ...$extra],
    );
}

test('the import page is reachable', function () {
    $this->actingAs($this->user)
        ->get(route('import.create', ['current_team' => $this->team]))
        ->assertOk();
});

test('imports accounts, categories, and transactions from an export zip', function () {
    importExport(exportZip(registerCsv()))
        ->assertRedirect(route('import.create', ['current_team' => $this->team]));

    expect(Account::query()->pluck('name')->all())->toBe(['Chequing']);
    expect(Category::query()->pluck('name')->all())->toBe(['Groceries']);
    expect(Transaction::query()->orderBy('date')->pluck('amount')->all())->toBe([-4000, 250000]);
});

test('imports assignments from the plan file', function () {
    $plan = implode("\n", [
        '"Month","Category Group","Category","Budgeted","Activity","Available"',
        '"Jul 2026","Everyday","Groceries","$600.00","-$40.00","$560.00"',
    ]);

    importExport(exportZip(registerCsv(), $plan))->assertSessionHasNoErrors();

    expect(Assignment::query()->pluck('amount')->all())->toBe([60000]);
});

test('accepts a bare register csv', function () {
    $path = tempnam(sys_get_temp_dir(), 'export').'.csv';
    file_put_contents($path, registerCsv());

    importExport(new UploadedFile($path, 'Register.csv', 'text/csv', test: true))
        ->assertSessionHasNoErrors();

    expect(Transaction::query()->count())->toBe(2);
});

test('rejects a file that is not a YNAB export', function () {
    $path = tempnam(sys_get_temp_dir(), 'export').'.csv';
    file_put_contents($path, "not,a,ynab,export\n1,2,3,4");

    importExport(new UploadedFile($path, 'random.csv', 'text/csv', test: true))
        ->assertSessionHasErrors('file');

    expect(Transaction::query()->count())->toBe(0);
});

test('asks which way round ambiguous dates are instead of guessing', function () {
    $register = registerCsv('"Chequing","","05/03/2026","Costco","Everyday","Groceries","","$40.00","$0.00","Cleared"');

    importExport(exportZip($register))->assertSessionHasErrors('date_order');

    expect(Transaction::query()->count())->toBe(0);
});

test('uses the date order the user picked for an ambiguous export', function () {
    $register = registerCsv('"Chequing","","05/03/2026","Costco","Everyday","Groceries","","$40.00","$0.00","Cleared"');

    importExport(exportZip($register), ['date_order' => 'day-first'])->assertSessionHasNoErrors();

    expect(Transaction::query()->value('date'))->toBe('2026-03-05');
});

test('reports the row counts and the lossiness warnings to the user', function () {
    importExport(exportZip(registerCsv()))
        ->assertSessionHas('import.summary.transactions', 2)
        ->assertSessionHas('import.summary.accounts', 1);

    expect(session('import.warnings'))
        ->toContain('YNAB exports do not record account types, so all 1 account was imported as a chequing account.');
});

test('does not let a non-member import into a team', function () {
    $otherUser = User::factory()->create();

    $this->actingAs($otherUser)->post(
        route('import.store', ['current_team' => $this->team]),
        ['file' => exportZip(registerCsv())],
    )->assertForbidden();

    expect(Transaction::query()->count())->toBe(0);
});

test('the import page shows the result of the import that just ran', function () {
    importExport(exportZip(registerCsv()));

    $this->actingAs($this->user)
        ->get(route('import.create', ['current_team' => $this->team]))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Import')
            ->where('result.summary.transactions', 2)
            ->where('result.warnings.0', 'YNAB exports do not record account types, so all 1 account was imported as a chequing account.')
            ->etc(),
        );
});
