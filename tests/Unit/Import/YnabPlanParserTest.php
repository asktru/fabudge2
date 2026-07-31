<?php

use App\Services\Import\Ynab\YnabCsvParser;
use App\Services\Import\Ynab\YnabExportFormatException;

test('parses a plan row into a month and signed minor units', function () {
    $csv = <<<'CSV'
    "Month","Category Group/Category","Category Group","Category","Budgeted","Activity","Available"
    "Jul 2026","Everyday: Groceries","Everyday","Groceries","$600.00","-$412.30","$187.70"
    CSV;

    $rows = (new YnabCsvParser)->parsePlan($csv);

    expect($rows)->toHaveCount(1);
    expect($rows[0]->month)->toBe('2026-07');
    expect($rows[0]->categoryGroup)->toBe('Everyday');
    expect($rows[0]->category)->toBe('Groceries');
    expect($rows[0]->assigned)->toBe(60000);
    expect($rows[0]->activity)->toBe(-41230);
    expect($rows[0]->available)->toBe(18770);
});

test('accepts the Assigned column name as well as Budgeted', function () {
    $csv = <<<'CSV'
    "Month","Category Group","Category","Assigned","Activity","Available"
    "Jul 2026","Everyday","Groceries","$600.00","$0.00","$600.00"
    CSV;

    expect((new YnabCsvParser)->parsePlan($csv)[0]->assigned)->toBe(60000);
});

test('reads full month names and ISO months', function () {
    $csv = <<<'CSV'
    "Month","Category Group","Category","Budgeted","Activity","Available"
    "July 2026","Everyday","Groceries","$1.00","$0.00","$1.00"
    "2026-08","Everyday","Groceries","$1.00","$0.00","$1.00"
    CSV;

    $rows = (new YnabCsvParser)->parsePlan($csv);

    expect($rows[0]->month)->toBe('2026-07');
    expect($rows[1]->month)->toBe('2026-08');
});

test('reads a comma-decimal negative activity', function () {
    $csv = <<<'CSV'
    "Month","Category Group","Category","Budgeted","Activity","Available"
    "Jul 2026","Alltag","Lebensmittel","600,00 €","-412,30 €","187,70 €"
    CSV;

    expect((new YnabCsvParser)->parsePlan($csv)[0]->activity)->toBe(-41230);
});

test('rejects a file that is missing the columns a plan must have', function () {
    $csv = <<<'CSV'
    "Category","Budgeted"
    "Groceries","$600.00"
    CSV;

    expect(fn () => (new YnabCsvParser)->parsePlan($csv))
        ->toThrow(YnabExportFormatException::class);
});
