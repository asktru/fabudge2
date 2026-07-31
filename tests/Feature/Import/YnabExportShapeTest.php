<?php

use App\Models\Account;
use App\Models\Assignment;
use App\Models\Budget;
use App\Models\Category;
use App\Models\CategoryGroup;
use App\Models\Team;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;

/**
 * Guards the quirks of a real YNAB export, byte for byte: a UTF-8 BOM, CRLF
 * line endings, unquoted amounts sitting between quoted fields, day-first
 * dates, emoji category names containing commas, "Split (n/m) " markers with
 * nothing after them, and a Credit Card Payments group that exists only in the
 * plan file.
 */
beforeEach(function () {
    Date::setTestNow('2026-07-30');

    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
    $this->budget = Budget::forTeam($this->team);

    $path = tempnam(sys_get_temp_dir(), 'shape').'.zip';
    $zip = new ZipArchive;
    $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString('My Plan as of 2026-07-30 22-48 - Register.csv', file_get_contents(base_path('tests/Fixtures/ynab/Register.csv')));
    $zip->addFromString('My Plan as of 2026-07-30 22-48 - Plan.csv', file_get_contents(base_path('tests/Fixtures/ynab/Plan.csv')));
    $zip->close();

    $this->actingAs($this->user)->post(
        route('import.store', ['current_team' => $this->team]),
        ['file' => new UploadedFile($path, 'YNAB Export.zip', 'application/zip', test: true)],
    )->assertSessionHasNoErrors();
});

test('reads day-first dates without being asked', function () {
    expect(Transaction::query()->orderBy('date')->pluck('date')->all())->toBe([
        '2026-06-08',
        '2026-07-10',
        '2026-07-10',
        '2026-07-12',
        '2026-07-15',
        '2026-07-15',
        '2026-08-24',
        '2026-08-27',
    ]);
});

test('reads unquoted amounts that sit between quoted fields', function () {
    expect(Transaction::query()->orderBy('amount')->pluck('amount')->all())->toBe([
        -50000, -12863, -4580, -3470, -2259, -1220, 50000, 993000,
    ]);
});

test('keeps emoji category names that contain commas intact', function () {
    expect(Category::query()->pluck('name')->all())->toContain('📺✨ Apple, Netflix, Amazon');
    expect(CategoryGroup::query()->pluck('name')->all())->toBe(['Bills', 'Needs', 'Wants']);
});

test('groups the split even though its marker has no memo after it', function () {
    $split = Transaction::query()->whereNotNull('split_group_id')->get();

    expect($split)->toHaveCount(2);
    expect($split->pluck('split_group_id')->unique())->toHaveCount(1);
    expect($split->sum('amount'))->toBe(-5800);
    expect($split->pluck('memo')->all())->toBe([null, null]);
});

test('types the credit card account from the plan-only payment category', function () {
    expect(Account::query()->pluck('type', 'name')->all())->toBe([
        'Chequing' => 'chequing',
        'Store Card' => 'credit_card',
    ]);
});

test('does not turn the credit card payment category into a real category', function () {
    expect(Category::query()->pluck('name')->all())->not->toContain('Store Card');
    expect(Assignment::query()->count())->toBe(4);
});

test('reproduces the activity YNAB itself calculated for past months', function () {
    $groceries = Category::query()->where('name', '🛒 Groceries')->sole();

    $july = Transaction::query()
        ->where('category_id', $groceries->id)
        ->whereBetween('date', ['2026-07-01', '2026-07-31'])
        ->sum('amount');

    expect($july)->toBe(-8050);
});

test('warns about everything the export could not carry across', function () {
    expect(session('import.warnings'))->toBe([
        '1 credit card was recognised from your Credit Card Payments categories; the other 1 account was imported as a chequing account.',
        'YNAB tracks credit card payments as budget categories, which fabudge does not; 45.00 assigned to them was not imported.',
        '2 transactions are dated in the future. YNAB keeps these as upcoming and leaves them out of category activity, so your plan totals may differ from YNAB until those dates arrive.',
        'YNAB exports split transactions as separate rows, so splits were regrouped by date and payee and may not match the original grouping exactly.',
    ]);
});
