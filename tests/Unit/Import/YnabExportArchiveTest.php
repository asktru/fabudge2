<?php

use App\Services\Import\Ynab\YnabExportArchive;
use App\Services\Import\Ynab\YnabExportFormatException;

/** Write a zip containing the given entries and return its path. */
function zipFixture(array $entries): string
{
    $path = tempnam(sys_get_temp_dir(), 'ynab').'.zip';
    $zip = new ZipArchive;
    $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);

    foreach ($entries as $name => $contents) {
        $zip->addFromString($name, $contents);
    }

    $zip->close();

    return $path;
}

afterEach(function () {
    array_map(unlink(...), glob(sys_get_temp_dir().'/ynab*.zip') ?: []);
});

test('reads the register and plan out of an export archive', function () {
    $path = zipFixture([
        'My Budget as of 2026-07-30 - Register.csv' => 'register-contents',
        'My Budget as of 2026-07-30 - Plan.csv' => 'plan-contents',
    ]);

    $archive = YnabExportArchive::open($path);

    expect($archive->register)->toBe('register-contents');
    expect($archive->plan)->toBe('plan-contents');
});

test('recognises the older Budget.csv name for the plan', function () {
    $path = zipFixture([
        'Budget as of 2026-07-30 - Register.csv' => 'register-contents',
        'Budget as of 2026-07-30 - Budget.csv' => 'plan-contents',
    ]);

    expect(YnabExportArchive::open($path)->plan)->toBe('plan-contents');
});

test('imports a register-only archive with an empty plan', function () {
    $path = zipFixture(['Register.csv' => 'register-contents']);

    $archive = YnabExportArchive::open($path);

    expect($archive->register)->toBe('register-contents');
    expect($archive->plan)->toBe('');
});

test('ignores macOS resource forks', function () {
    $path = zipFixture([
        '__MACOSX/._Register.csv' => 'junk',
        'Register.csv' => 'register-contents',
    ]);

    expect(YnabExportArchive::open($path)->register)->toBe('register-contents');
});

test('accepts a bare register CSV that was unzipped first', function () {
    $path = tempnam(sys_get_temp_dir(), 'ynab').'.csv';
    file_put_contents($path, '"Account","Date"');

    $archive = YnabExportArchive::open($path);

    expect($archive->register)->toBe('"Account","Date"');
    expect($archive->plan)->toBe('');

    unlink($path);
});

test('rejects an archive with no register file', function () {
    $path = zipFixture(['Plan.csv' => 'plan-contents']);

    expect(fn () => YnabExportArchive::open($path))->toThrow(YnabExportFormatException::class);
});

test('rejects a file that is not a zip or a csv', function () {
    $path = tempnam(sys_get_temp_dir(), 'ynab').'.zip';
    file_put_contents($path, 'not a zip at all');

    expect(fn () => YnabExportArchive::open($path))->toThrow(YnabExportFormatException::class);
});
