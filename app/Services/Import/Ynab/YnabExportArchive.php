<?php

namespace App\Services\Import\Ynab;

use ZipArchive;

/**
 * The two files that make up a YNAB export, pulled out of the downloaded zip.
 *
 * File names carry the plan name and export date ("My Budget as of 2026-07-30 -
 * Register.csv") and the plan file has been called both Plan.csv and Budget.csv
 * over the years, so entries are matched on the suffix rather than the whole
 * name. A bare CSV is accepted too, since people often unzip before uploading.
 */
class YnabExportArchive
{
    public function __construct(
        public readonly string $register,
        public readonly string $plan,
    ) {}

    public static function open(string $path): self
    {
        $zip = new ZipArchive;

        if ($zip->open($path) !== true) {
            return static::fromLooseFile($path);
        }

        $entries = [];

        for ($index = 0; $index < $zip->numFiles; $index++) {
            $name = (string) $zip->getNameIndex($index);

            if (str_starts_with($name, '__MACOSX/') || str_starts_with(basename($name), '.')) {
                continue;
            }

            $entries[$name] = (string) $zip->getFromIndex($index);
        }

        $zip->close();

        $register = static::match($entries, ['register']);

        if ($register === null) {
            throw new YnabExportFormatException('That zip does not contain a YNAB Register.csv file.');
        }

        return new self($register, static::match($entries, ['plan', 'budget']) ?? '');
    }

    /**
     * Treat a non-zip upload as the register file itself.
     */
    protected static function fromLooseFile(string $path): self
    {
        $contents = (string) file_get_contents($path);

        if (! str_contains(strtolower(explode("\n", $contents)[0]), 'account')) {
            throw new YnabExportFormatException('That file is neither a YNAB export zip nor a Register.csv file.');
        }

        return new self($contents, '');
    }

    /**
     * The contents of the first entry whose name ends with one of the given stems.
     *
     * @param  array<string, string>  $entries
     * @param  list<string>  $stems
     */
    protected static function match(array $entries, array $stems): ?string
    {
        foreach ($entries as $name => $contents) {
            $base = strtolower(pathinfo($name, PATHINFO_FILENAME));

            if (array_any($stems, fn (string $stem) => str_ends_with($base, $stem))) {
                return $contents;
            }
        }

        return null;
    }
}
