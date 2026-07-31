<?php

use App\Enums\DateOrder;
use App\Services\Import\Ynab\YnabCsvParser;
use App\Services\Import\Ynab\YnabExportFormatException;

/** Build a register file from the given data lines, sharing one header. */
function register(string ...$lines): string
{
    $header = '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';

    return implode("\n", [$header, ...$lines]);
}

test('parses a US-locale register row into signed minor units', function () {
    $csv = <<<'CSV'
    "Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"
    "Chequing","","07/28/2026","Loblaws","Everyday: Groceries","Everyday","Groceries","weekly shop","$123.45","$0.00","Cleared"
    CSV;

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows)->toHaveCount(1);
    expect($rows[0]->account)->toBe('Chequing');
    expect($rows[0]->date)->toBe('2026-07-28');
    expect($rows[0]->payee)->toBe('Loblaws');
    expect($rows[0]->categoryGroup)->toBe('Everyday');
    expect($rows[0]->category)->toBe('Groceries');
    expect($rows[0]->memo)->toBe('weekly shop');
    expect($rows[0]->amount)->toBe(-12345);
    expect($rows[0]->cleared)->toBe('cleared');
});

test('reads inflow as a positive amount', function () {
    $csv = <<<'CSV'
    "Account","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"
    "Chequing","07/31/2026","Employer","Inflow","Ready to Assign","","$0.00","$2,500.00","Uncleared"
    CSV;

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->amount)->toBe(250000);
    expect($rows[0]->cleared)->toBe('uncleared');
});

test('parses a comma-decimal export delivered as TSV', function () {
    $csv = implode("\n", [
        implode("\t", ['Account', 'Date', 'Payee', 'Category Group', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared']),
        implode("\t", ['Girokonto', '28.02.2026', 'Rewe', 'Alltag', 'Lebensmittel', '', '1.234,56 €', '0,00 €', 'Cleared']),
    ]);

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->account)->toBe('Girokonto');
    expect($rows[0]->date)->toBe('2026-02-28');
    expect($rows[0]->amount)->toBe(-123456);
});

test('infers day-first dates from the whole file when one row disambiguates', function () {
    $csv = <<<'CSV'
    "Account","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"
    "Chequing","05/03/2026","A","G","C","","1,00","0,00","Cleared"
    "Chequing","28/03/2026","B","G","C","","1,00","0,00","Cleared"
    CSV;

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->date)->toBe('2026-03-05');
    expect($rows[1]->date)->toBe('2026-03-28');
});

test('infers month-first dates from the whole file when one row disambiguates', function () {
    $csv = <<<'CSV'
    "Account","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"
    "Chequing","05/03/2026","A","G","C","","1.00","0.00","Cleared"
    "Chequing","03/28/2026","B","G","C","","1.00","0.00","Cleared"
    CSV;

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->date)->toBe('2026-05-03');
    expect($rows[1]->date)->toBe('2026-03-28');
});

test('reports the detected date order so an ambiguous export can be flagged', function () {
    $parser = new YnabCsvParser;

    $header = '"Account","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"';
    $row = fn (string $date) => '"Chequing","'.$date.'","A","G","C","","1.00","0.00","Cleared"';

    expect($parser->detectDateOrder($header."\n".$row('2026-03-05')))->toBe(DateOrder::Iso);
    expect($parser->detectDateOrder($header."\n".$row('28/03/2026')))->toBe(DateOrder::DayFirst);
    expect($parser->detectDateOrder($header."\n".$row('03/28/2026')))->toBe(DateOrder::MonthFirst);
    expect($parser->detectDateOrder($header."\n".$row('05/03/2026')))->toBe(DateOrder::Ambiguous);
});

test('honours an explicit date order for an otherwise ambiguous export', function () {
    $csv = <<<'CSV'
    "Account","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"
    "Chequing","05/03/2026","A","G","C","","1.00","0.00","Cleared"
    CSV;

    expect((new YnabCsvParser)->parseRegister($csv, DateOrder::DayFirst)[0]->date)->toBe('2026-03-05');
    expect((new YnabCsvParser)->parseRegister($csv, DateOrder::MonthFirst)[0]->date)->toBe('2026-05-03');
});

test('reads parenthesised outflow as negative', function () {
    $csv = <<<'CSV'
    "Account","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"
    "Chequing","07/31/2026","Shop","Everyday","Fun","","($12.00)","$0.00","Reconciled"
    CSV;

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->amount)->toBe(-1200);
    expect($rows[0]->cleared)->toBe('reconciled');
});

test('extracts the paired account from a transfer payee', function () {
    $csv = register('"Chequing","","07/28/2026","Transfer : Savings","","","","","$100.00","$0.00","Cleared"');

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->transferAccount)->toBe('Savings');
    expect($rows[0]->amount)->toBe(-10000);
});

test('leaves transferAccount null for an ordinary payee', function () {
    $csv = register('"Chequing","","07/28/2026","Transfer Wise Ltd","","","","","$100.00","$0.00","Cleared"');

    expect((new YnabCsvParser)->parseRegister($csv)[0]->transferAccount)->toBeNull();
});

test('extracts split position from the memo and strips the marker', function () {
    $csv = register('"Chequing","","07/28/2026","Costco","Everyday: Groceries","Everyday","Groceries","Split (2/3) household","$40.00","$0.00","Cleared"');

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->splitIndex)->toBe(2);
    expect($rows[0]->splitCount)->toBe(3);
    expect($rows[0]->memo)->toBe('household');
});

test('leaves split fields null and memo intact for an unsplit row', function () {
    $csv = register('"Chequing","","07/28/2026","Costco","Everyday: Groceries","Everyday","Groceries","household","$40.00","$0.00","Cleared"');

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->splitIndex)->toBeNull();
    expect($rows[0]->splitCount)->toBeNull();
    expect($rows[0]->memo)->toBe('household');
});

test('falls back to the combined category column when the split columns are absent', function () {
    $csv = <<<'CSV'
    "Account","Date","Payee","Category Group/Category","Memo","Outflow","Inflow","Cleared"
    "Chequing","07/28/2026","Costco","Everyday: Groceries","","$40.00","$0.00","Cleared"
    CSV;

    $rows = (new YnabCsvParser)->parseRegister($csv);

    expect($rows[0]->categoryGroup)->toBe('Everyday');
    expect($rows[0]->category)->toBe('Groceries');
});

test('captures the flag colour', function () {
    $csv = register('"Chequing","Red","07/28/2026","Costco","","","","","$40.00","$0.00","Cleared"');

    expect((new YnabCsvParser)->parseRegister($csv)[0]->flag)->toBe('Red');
});

test('strips a UTF-8 byte order mark from the header', function () {
    $csv = "\u{FEFF}".register('"Chequing","","07/28/2026","Costco","","","","","$40.00","$0.00","Cleared"');

    expect((new YnabCsvParser)->parseRegister($csv)[0]->account)->toBe('Chequing');
});

test('treats a missing cleared column as uncleared', function () {
    $csv = <<<'CSV'
    "Account","Date","Payee","Category Group","Category","Memo","Outflow","Inflow"
    "Chequing","07/28/2026","Costco","Everyday","Groceries","","$40.00","$0.00"
    CSV;

    expect((new YnabCsvParser)->parseRegister($csv)[0]->cleared)->toBe('uncleared');
});

test('returns no rows for a header-only export', function () {
    expect((new YnabCsvParser)->parseRegister(register()))->toBe([]);
});

test('rejects a file that is missing the columns a register must have', function () {
    $csv = <<<'CSV'
    "Date","Payee","Amount"
    "07/28/2026","Costco","-40.00"
    CSV;

    expect(fn () => (new YnabCsvParser)->parseRegister($csv))
        ->toThrow(YnabExportFormatException::class);
});
