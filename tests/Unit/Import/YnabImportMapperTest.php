<?php

use App\Services\Import\ImportPlan;
use App\Services\Import\Ynab\YnabCsvParser;
use App\Services\Import\Ynab\YnabImportMapper;
use Illuminate\Support\Facades\Date;

/** Map a register (and optional plan) file through the parser into an import plan. */
function mapExport(string $register, string $plan = ''): ImportPlan
{
    $parser = new YnabCsvParser;

    return (new YnabImportMapper)->map(
        $parser->parseRegister($register),
        $plan === '' ? [] : $parser->parsePlan($plan),
        'CAD',
    );
}

/** Build a register file from the given data lines, sharing one header. */
function registerFile(string ...$lines): string
{
    $header = '"Account","Flag","Date","Payee","Category Group","Category","Memo","Outflow","Inflow","Cleared"';

    return implode("\n", [$header, ...$lines]);
}

/** One register data line, in the header's column order. */
function line(string $account, string $date, string $payee, string $group, string $category, string $memo, string $outflow, string $inflow, string $cleared = 'Cleared'): string
{
    return '"'.implode('","', [$account, '', $date, $payee, $group, $category, $memo, $outflow, $inflow, $cleared]).'"';
}

test('creates one account per distinct account name', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/01/2026', 'Costco', 'Everyday', 'Groceries', '', '$10.00', '$0.00'),
        line('Savings', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$10.00', '$0.00'),
        line('Chequing', '07/03/2026', 'Costco', 'Everyday', 'Groceries', '', '$10.00', '$0.00'),
    ));

    expect(array_column($plan->rowsFor('accounts'), 'name'))->toBe(['Chequing', 'Savings']);
    expect($plan->rowsFor('accounts')[0]['currency'])->toBe('CAD');
});

test('creates category groups and categories, linking each category to its group', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/01/2026', 'Costco', 'Everyday', 'Groceries', '', '$10.00', '$0.00'),
        line('Chequing', '07/02/2026', 'Netflix', 'Bills', 'Subscriptions', '', '$10.00', '$0.00'),
    ));

    $groups = $plan->rowsFor('category_groups');
    $categories = $plan->rowsFor('categories');

    expect(array_column($groups, 'name'))->toBe(['Everyday', 'Bills']);
    expect(array_column($categories, 'name'))->toBe(['Groceries', 'Subscriptions']);
    expect($categories[0]['category_group_id'])->toBe($groups[0]['id']);
    expect($categories[1]['category_group_id'])->toBe($groups[1]['id']);
});

test('leaves income rows uncategorised rather than inventing a Ready to Assign category', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/01/2026', 'Employer', 'Inflow', 'Ready to Assign', '', '$0.00', '$2,500.00'),
    ));

    expect($plan->rowsFor('categories'))->toBe([]);
    expect($plan->rowsFor('category_groups'))->toBe([]);
    expect($plan->rowsFor('transactions')[0]['category_id'])->toBeNull();
    expect($plan->rowsFor('transactions')[0]['amount'])->toBe(250000);
});

test('creates payees for real payees only, not for transfers', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/01/2026', 'Costco', 'Everyday', 'Groceries', '', '$10.00', '$0.00'),
        line('Chequing', '07/02/2026', 'Transfer : Savings', '', '', '', '$50.00', '$0.00'),
        line('Savings', '07/02/2026', 'Transfer : Chequing', '', '', '', '$0.00', '$50.00'),
    ));

    expect(array_column($plan->rowsFor('payees'), 'name'))->toBe(['Costco']);
});

test('links the two sides of a transfer to each other', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Transfer : Savings', '', '', '', '$50.00', '$0.00'),
        line('Savings', '07/02/2026', 'Transfer : Chequing', '', '', '', '$0.00', '$50.00'),
    ));

    $transactions = $plan->rowsFor('transactions');

    expect($transactions)->toHaveCount(2);
    expect($transactions[0]['transfer_pair_id'])->toBe($transactions[1]['id']);
    expect($transactions[1]['transfer_pair_id'])->toBe($transactions[0]['id']);
    expect($transactions[0]['payee_id'])->toBeNull();
    expect($transactions[0]['amount'])->toBe(-5000);
    expect($transactions[1]['amount'])->toBe(5000);
});

test('does not cross-link two unrelated transfers between the same accounts', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Transfer : Savings', '', '', '', '$50.00', '$0.00'),
        line('Savings', '07/02/2026', 'Transfer : Chequing', '', '', '', '$0.00', '$50.00'),
        line('Chequing', '07/09/2026', 'Transfer : Savings', '', '', '', '$75.00', '$0.00'),
        line('Savings', '07/09/2026', 'Transfer : Chequing', '', '', '', '$0.00', '$75.00'),
    ));

    $transactions = $plan->rowsFor('transactions');
    $pairFor = fn (int $index) => $transactions[$index]['transfer_pair_id'];

    expect($pairFor(0))->toBe($transactions[1]['id']);
    expect($pairFor(2))->toBe($transactions[3]['id']);
});

test('warns and leaves the pair unset when only one side of a transfer was exported', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Transfer : Closed Account', '', '', '', '$50.00', '$0.00'),
    ));

    expect($plan->rowsFor('transactions')[0]['transfer_pair_id'])->toBeNull();
    expect($plan->warnings)->toContain('1 transfer had no matching row in the export and was imported as a one-sided transaction.');
});

test('groups the flattened rows of a split transaction under one split group', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', 'Split (1/2) food', '$40.00', '$0.00'),
        line('Chequing', '07/02/2026', 'Costco', 'Home', 'Supplies', 'Split (2/2) soap', '$15.00', '$0.00'),
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', 'unrelated', '$5.00', '$0.00'),
    ));

    $transactions = $plan->rowsFor('transactions');

    expect($transactions[0]['split_group_id'])->not->toBeNull();
    expect($transactions[1]['split_group_id'])->toBe($transactions[0]['split_group_id']);
    expect($transactions[2]['split_group_id'])->toBeNull();
    expect($transactions[0]['memo'])->toBe('food');
});

test('keeps two same-day splits at the same payee in separate groups', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', 'Split (1/2) a', '$40.00', '$0.00'),
        line('Chequing', '07/02/2026', 'Costco', 'Home', 'Supplies', 'Split (2/2) b', '$15.00', '$0.00'),
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', 'Split (1/2) c', '$20.00', '$0.00'),
        line('Chequing', '07/02/2026', 'Costco', 'Home', 'Supplies', 'Split (2/2) d', '$25.00', '$0.00'),
    ));

    $groups = array_column($plan->rowsFor('transactions'), 'split_group_id');

    expect($groups[0])->toBe($groups[1]);
    expect($groups[2])->toBe($groups[3]);
    expect($groups[0])->not->toBe($groups[2]);
});

test('carries date, memo, and cleared status onto the transaction', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', 'weekly', '$40.00', '$0.00', 'Reconciled'),
    ));

    $transaction = $plan->rowsFor('transactions')[0];

    expect($transaction['date'])->toBe('2026-07-02');
    expect($transaction['memo'])->toBe('weekly');
    expect($transaction['cleared'])->toBe('reconciled');
    expect($transaction['account_id'])->toBe($plan->rowsFor('accounts')[0]['id']);
    expect($transaction['payee_id'])->toBe($plan->rowsFor('payees')[0]['id']);
    expect($transaction['category_id'])->toBe($plan->rowsFor('categories')[0]['id']);
});

test('turns assigned plan amounts into assignments', function () {
    $register = registerFile(line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'));
    $planCsv = <<<'CSV'
    "Month","Category Group","Category","Budgeted","Activity","Available"
    "Jul 2026","Everyday","Groceries","$600.00","-$40.00","$560.00"
    "Aug 2026","Everyday","Groceries","$0.00","$0.00","$560.00"
    CSV;

    $plan = mapExport($register, $planCsv);
    $assignments = $plan->rowsFor('assignments');

    expect($assignments)->toHaveCount(1);
    expect($assignments[0]['month'])->toBe('2026-07');
    expect($assignments[0]['amount'])->toBe(60000);
    expect($assignments[0]['category_id'])->toBe($plan->rowsFor('categories')[0]['id']);
});

test('creates categories that appear only in the plan file', function () {
    $planCsv = <<<'CSV'
    "Month","Category Group","Category","Budgeted","Activity","Available"
    "Jul 2026","Savings Goals","Vacation","$250.00","$0.00","$250.00"
    CSV;

    $plan = mapExport(registerFile(), $planCsv);

    expect(array_column($plan->rowsFor('categories'), 'name'))->toBe(['Vacation']);
    expect($plan->rowsFor('assignments'))->toHaveCount(1);
});

test('warns that account types could not be recovered from the export', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
    ));

    expect($plan->warnings)->toContain('YNAB exports do not record account types, so all 1 account was imported as a chequing account.');
});

test('summarises what will be imported', function () {
    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
        line('Savings', '07/03/2026', 'Costco', 'Everyday', 'Groceries', '', '$10.00', '$0.00'),
    ));

    expect($plan->summary)->toMatchArray([
        'accounts' => 2,
        'categories' => 1,
        'payees' => 1,
        'transactions' => 2,
    ]);
});

test('does not import YNAB credit card payment categories', function () {
    $planCsv = <<<'CSV'
    "Month","Category Group","Category","Assigned","Activity","Available"
    "Jul 2026","Credit Card Payments","Store Card","$45.00","$0.00","$45.00"
    "Jul 2026","Everyday","Groceries","$600.00","$0.00","$600.00"
    CSV;

    $plan = mapExport(registerFile(
        line('Store Card', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
    ), $planCsv);

    expect(array_column($plan->rowsFor('categories'), 'name'))->toBe(['Groceries']);
    expect($plan->rowsFor('category_groups'))->toHaveCount(1);
    expect($plan->rowsFor('assignments'))->toHaveCount(1);
});

test('identifies credit card accounts from the credit card payment categories', function () {
    $planCsv = <<<'CSV'
    "Month","Category Group","Category","Assigned","Activity","Available"
    "Jul 2026","Credit Card Payments","Store Card","$0.00","$0.00","$0.00"
    CSV;

    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
        line('Store Card', '07/03/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
    ), $planCsv);

    $accounts = collect($plan->rowsFor('accounts'))->keyBy('name');

    expect($accounts['Store Card']['type'])->toBe('credit_card');
    expect($accounts['Chequing']['type'])->toBe('chequing');
});

test('says how many account types it had to guess and how many it recovered', function () {
    $planCsv = <<<'CSV'
    "Month","Category Group","Category","Assigned","Activity","Available"
    "Jul 2026","Credit Card Payments","Store Card","$0.00","$0.00","$0.00"
    CSV;

    $plan = mapExport(registerFile(
        line('Chequing', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
        line('Store Card', '07/03/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
    ), $planCsv);

    expect($plan->warnings)->toContain('1 credit card was recognised from your Credit Card Payments categories; the other 1 account was imported as a chequing account.');
});

test('warns when money assigned to credit card payments could not be carried over', function () {
    $planCsv = <<<'CSV'
    "Month","Category Group","Category","Assigned","Activity","Available"
    "Jul 2026","Credit Card Payments","Store Card","$45.00","$0.00","$45.00"
    CSV;

    $plan = mapExport(registerFile(
        line('Store Card', '07/02/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
    ), $planCsv);

    expect($plan->warnings)->toContain('YNAB tracks credit card payments as budget categories, which fabudge does not; 45.00 assigned to them was not imported.');
});

test('imports future-dated rows but warns that YNAB leaves them out of activity', function () {
    Date::setTestNow('2026-07-30');

    $plan = mapExport(registerFile(
        line('Chequing', '02/07/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
        line('Chequing', '27/08/2026', 'Bell', 'Bills', 'Phones', '', '$128.63', '$0.00'),
        line('Chequing', '28/08/2026', 'Bell', 'Bills', 'Phones', '', '$128.63', '$0.00'),
    ));

    expect($plan->rowsFor('transactions'))->toHaveCount(3);
    expect($plan->warnings)->toContain('2 transactions are dated in the future. YNAB keeps these as upcoming and leaves them out of category activity, so your plan totals may differ from YNAB until those dates arrive.');
});

test('says nothing about future dates when every row has already happened', function () {
    Date::setTestNow('2026-07-30');

    $plan = mapExport(registerFile(
        line('Chequing', '02/07/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
        line('Chequing', '30/07/2026', 'Costco', 'Everyday', 'Groceries', '', '$40.00', '$0.00'),
    ));

    expect($plan->warnings)->not->toContain(
        '1 transaction is dated in the future. YNAB keeps these as upcoming and leaves them out of category activity, so your plan totals may differ from YNAB until those dates arrive.',
    );
    expect(collect($plan->warnings)->filter(fn (string $warning) => str_contains($warning, 'future'))->all())->toBe([]);
});
