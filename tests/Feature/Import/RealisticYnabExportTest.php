<?php

use App\Models\Account;
use App\Models\Assignment;
use App\Models\Budget;
use App\Models\Category;
use App\Models\CategoryGroup;
use App\Models\Payee;
use App\Models\Team;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\UploadedFile;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);
});

/**
 * A tab-separated, comma-decimal, day-first export — the shape YNAB produces
 * for a euro plan — exercising splits, a transfer, income, and reconciliation
 * in one file.
 */
function germanExport(): UploadedFile
{
    $register = implode("\n", array_map(fn (array $fields) => implode("\t", $fields), [
        ['Account', 'Flag', 'Date', 'Payee', 'Category Group/Category', 'Category Group', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared'],
        ['Girokonto', '', '01.07.2026', 'Starting Balance', 'Inflow: Ready to Assign', 'Inflow', 'Ready to Assign', '', '0,00 €', '2.500,00 €', 'Reconciled'],
        ['Girokonto', '', '03.07.2026', 'Rewe', 'Alltag: Lebensmittel', 'Alltag', 'Lebensmittel', 'Split (1/2) Essen', '45,80 €', '0,00 €', 'Cleared'],
        ['Girokonto', '', '03.07.2026', 'Rewe', 'Haushalt: Reinigung', 'Haushalt', 'Reinigung', 'Split (2/2) Seife', '12,20 €', '0,00 €', 'Cleared'],
        ['Girokonto', '', '15.07.2026', 'Transfer : Sparkonto', '', '', '', '', '500,00 €', '0,00 €', 'Cleared'],
        ['Sparkonto', '', '15.07.2026', 'Transfer : Girokonto', '', '', '', '', '0,00 €', '500,00 €', 'Cleared'],
        ['Girokonto', 'Red', '28.07.2026', 'Netflix', 'Rechnungen: Abos', 'Rechnungen', 'Abos', '', '17,99 €', '0,00 €', 'Uncleared'],
    ]));

    $plan = implode("\n", array_map(fn (array $fields) => implode("\t", $fields), [
        ['Month', 'Category Group/Category', 'Category Group', 'Category', 'Budgeted', 'Activity', 'Available'],
        ['Jul 2026', 'Alltag: Lebensmittel', 'Alltag', 'Lebensmittel', '400,00 €', '-45,80 €', '354,20 €'],
        ['Jul 2026', 'Haushalt: Reinigung', 'Haushalt', 'Reinigung', '50,00 €', '-12,20 €', '37,80 €'],
        ['Jul 2026', 'Rechnungen: Abos', 'Rechnungen', 'Abos', '20,00 €', '-17,99 €', '2,01 €'],
        ['Jul 2026', 'Urlaub: Reise', 'Urlaub', 'Reise', '250,00 €', '0,00 €', '250,00 €'],
    ]));

    $path = tempnam(sys_get_temp_dir(), 'german').'.zip';
    $zip = new ZipArchive;
    $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString('Mein Budget as of 2026-07-30 - Register.csv', $register);
    $zip->addFromString('Mein Budget as of 2026-07-30 - Plan.csv', $plan);
    $zip->close();

    return new UploadedFile($path, 'ynab-export.zip', 'application/zip', test: true);
}

test('imports a full euro-locale export end to end', function () {
    $this->actingAs($this->user)
        ->post(route('import.store', ['current_team' => $this->team]), ['file' => germanExport()])
        ->assertSessionHasNoErrors();

    expect(Account::query()->pluck('name')->all())->toBe(['Girokonto', 'Sparkonto']);
    expect(CategoryGroup::query()->pluck('name')->all())->toBe(['Alltag', 'Haushalt', 'Rechnungen', 'Urlaub']);
    expect(Category::query()->pluck('name')->all())->toBe(['Lebensmittel', 'Reinigung', 'Abos', 'Reise']);
    expect(Payee::query()->pluck('name')->all())->toBe(['Starting Balance', 'Rewe', 'Netflix']);
    expect(Transaction::query()->count())->toBe(6);
});

test('reads day-first dates and comma decimals correctly', function () {
    $this->actingAs($this->user)
        ->post(route('import.store', ['current_team' => $this->team]), ['file' => germanExport()]);

    $netflix = Transaction::query()->where('amount', -1799)->sole();

    expect($netflix->date)->toBe('2026-07-28');
    expect($netflix->cleared)->toBe('uncleared');

    expect(Transaction::query()->where('cleared', 'reconciled')->value('amount'))->toBe(250000);
});

test('rebuilds the split and the transfer from the flattened rows', function () {
    $this->actingAs($this->user)
        ->post(route('import.store', ['current_team' => $this->team]), ['file' => germanExport()]);

    $split = Transaction::query()->whereNotNull('split_group_id')->orderBy('amount')->get();

    expect($split)->toHaveCount(2);
    expect($split[0]->split_group_id)->toBe($split[1]->split_group_id);
    expect($split->sum('amount'))->toBe(-5800);
    expect($split->pluck('memo')->all())->toBe(['Essen', 'Seife']);

    $transfers = Transaction::query()->whereNotNull('transfer_pair_id')->orderBy('amount')->get();

    expect($transfers->pluck('amount')->all())->toBe([-50000, 50000]);
    expect($transfers[0]->transfer_pair_id)->toBe($transfers[1]->id);
    expect($transfers[1]->transfer_pair_id)->toBe($transfers[0]->id);
    expect($transfers->pluck('payee_id')->filter()->all())->toBe([]);
});

test('imports every assigned month including categories with no activity', function () {
    $this->actingAs($this->user)
        ->post(route('import.store', ['current_team' => $this->team]), ['file' => germanExport()]);

    expect(Assignment::query()->pluck('amount')->all())->toBe([40000, 5000, 2000, 25000]);
    expect(Assignment::query()->pluck('month')->unique()->all())->toBe(['2026-07']);

    $reise = Category::query()->where('name', 'Reise')->sole();

    expect(Assignment::query()->where('category_id', $reise->id)->value('amount'))->toBe(25000);
});

test('an import is visible to a syncing client on the next pull', function () {
    $this->actingAs($this->user)
        ->post(route('import.store', ['current_team' => $this->team]), ['file' => germanExport()]);

    $changes = $this->actingAs($this->user)
        ->getJson(route('sync.pull', ['current_team' => $this->team, 'cursor' => 0]))
        ->json('changes');

    expect(collect($changes)->countBy('table')->sortKeys()->all())->toBe([
        'accounts' => 2,
        'assignments' => 4,
        'categories' => 4,
        'category_groups' => 4,
        'payees' => 3,
        'transactions' => 6,
    ]);
});
