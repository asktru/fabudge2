<?php

namespace App\Services\Import\Ynab;

use App\Enums\DateOrder;

/**
 * Reads YNAB's "Export budget data" CSV/TSV files into normalised rows.
 *
 * YNAB publishes no schema for these files, so everything here is defensive:
 * columns are looked up by name (never position), the delimiter is sniffed
 * (comma-decimal currencies export as TSV), and money and dates are parsed
 * without assuming the exporting plan's locale.
 */
class YnabCsvParser
{
    /** English month abbreviations, in the order the plan file's labels use. */
    protected const array MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    /**
     * @param  DateOrder|null  $dateOrder  Overrides detection.
     * @return list<YnabRegisterRow>
     */
    public function parseRegister(string $contents, ?DateOrder $dateOrder = null): array
    {
        $records = $this->records($contents);
        $this->assertColumns('Register.csv', $contents, ['account', 'date', 'payee', 'outflow', 'inflow']);
        $order = ($dateOrder ?? $this->detectDateOrder($contents))->orDefault();

        return array_map(function (array $record) use ($order) {
            $payee = $this->value($record, 'payee');
            [$group, $category] = $this->categoryOf($record);
            [$memo, $splitIndex, $splitCount] = $this->splitOf($this->value($record, 'memo'));

            return new YnabRegisterRow(
                account: $this->value($record, 'account'),
                date: $this->parseDate($this->value($record, 'date'), $order),
                payee: $payee,
                categoryGroup: $group,
                category: $category,
                memo: $memo,
                amount: $this->parseMagnitude($this->value($record, 'inflow')) - $this->parseMagnitude($this->value($record, 'outflow')),
                cleared: $this->parseCleared($this->value($record, 'cleared')),
                flag: $this->value($record, 'flag'),
                transferAccount: $this->transferAccountOf($payee),
                splitIndex: $splitIndex,
                splitCount: $splitCount,
            );
        }, $records);
    }

    /**
     * @return list<YnabPlanRow>
     */
    public function parsePlan(string $contents): array
    {
        $this->assertColumns('Plan.csv', $contents, ['month', 'category']);

        return array_map(function (array $record) {
            [$group, $category] = $this->categoryOf($record);

            return new YnabPlanRow(
                month: $this->parseMonth($this->value($record, 'month')),
                categoryGroup: $group,
                category: $category,
                assigned: $this->parseMoney($this->value($record, 'budgeted') ?: $this->value($record, 'assigned')),
                activity: $this->parseMoney($this->value($record, 'activity')),
                available: $this->parseMoney($this->value($record, 'available')),
            );
        }, $this->records($contents));
    }

    /**
     * Convert a plan month label such as "Jul 2026" or "July 2026" to "2026-07".
     */
    protected function parseMonth(string $value): string
    {
        if (preg_match('/^(\d{4})\D(\d{1,2})/', $value, $matches) === 1) {
            return sprintf('%04d-%02d', $matches[1], $matches[2]);
        }

        if (preg_match('/^([A-Za-z]+)\s+(\d{4})$/', trim($value), $matches) === 1) {
            $month = array_search(strtolower(substr($matches[1], 0, 3)), self::MONTH_ABBREVIATIONS, strict: true);

            if ($month !== false) {
                return sprintf('%04d-%02d', $matches[2], $month + 1);
            }
        }

        return $value;
    }

    /**
     * Resolve the category group and name, preferring the dedicated columns and
     * falling back to the combined "Group: Category" column that older exports
     * ship instead.
     *
     * @param  array<string, string>  $record
     * @return array{string, string}
     */
    protected function categoryOf(array $record): array
    {
        $group = $this->value($record, 'categorygroup');
        $category = $this->value($record, 'category');

        if ($group !== '' || $category !== '') {
            return [$group, $category];
        }

        $combined = $this->value($record, 'categorygroup/category');

        if (! str_contains($combined, ':')) {
            return ['', $combined];
        }

        [$combinedGroup, $combinedCategory] = explode(':', $combined, 2);

        return [trim($combinedGroup), trim($combinedCategory)];
    }

    /**
     * YNAB flattens splits into one row each, recording the position in the memo
     * as "Split (2/3) note". Pull the position out and hand back a clean memo.
     *
     * @return array{string, int|null, int|null}
     */
    protected function splitOf(string $memo): array
    {
        if (preg_match('/^Split\s*\((\d+)\/(\d+)\)\s*(.*)$/s', $memo, $matches) !== 1) {
            return [$memo, null, null];
        }

        return [trim($matches[3]), (int) $matches[1], (int) $matches[2]];
    }

    /**
     * A transfer's counterpart account, encoded by YNAB as a "Transfer : X" payee.
     */
    protected function transferAccountOf(string $payee): ?string
    {
        return preg_match('/^Transfers?\s*:\s*(.+)$/', $payee, $matches) === 1
            ? trim($matches[1])
            : null;
    }

    /**
     * @param  list<string>  $required
     */
    protected function assertColumns(string $file, string $contents, array $required): void
    {
        $missing = array_values(array_diff($required, $this->headers($contents)));

        if ($missing !== []) {
            throw YnabExportFormatException::missingColumns($file, $missing);
        }
    }

    /**
     * Work out how a file orders its date components.
     *
     * A single day-of-month above 12 settles the whole file, so evidence is
     * gathered across every row rather than judged per row. Files that never
     * disambiguate come back as "ambiguous" for the caller to resolve or warn
     * about, because guessing silently corrupts up to 12 days in every month.
     */
    public function detectDateOrder(string $contents): DateOrder
    {
        $dates = array_filter(array_map(
            fn (array $record) => $this->value($record, 'date'),
            $this->records($contents),
        ));

        $dayFirst = false;
        $monthFirst = false;

        foreach ($dates as $date) {
            if (preg_match('/^(\d{1,2})\D(\d{1,2})\D\d{4}$/', $date, $matches) !== 1) {
                continue;
            }

            $dayFirst = $dayFirst || (int) $matches[1] > 12;
            $monthFirst = $monthFirst || (int) $matches[2] > 12;
        }

        return match (true) {
            $dayFirst && $monthFirst => DateOrder::Ambiguous,
            $dayFirst => DateOrder::DayFirst,
            $monthFirst => DateOrder::MonthFirst,
            default => $this->allIso($dates) ? DateOrder::Iso : DateOrder::Ambiguous,
        };
    }

    /**
     * @param  array<int, string>  $dates
     */
    protected function allIso(array $dates): bool
    {
        return $dates !== [] && array_all($dates, fn (string $date) => preg_match('/^\d{4}\D/', $date) === 1);
    }

    /**
     * Strip the BOM, sniff the delimiter, and split into raw field arrays.
     *
     * Comma-decimal currencies are exported tab-separated rather than
     * comma-separated, so the separator is decided by whichever character the
     * file actually uses more.
     *
     * @return list<list<string|null>>
     */
    protected function grid(string $contents): array
    {
        $contents = preg_replace('/^\x{FEFF}/u', '', $contents) ?? $contents;
        $delimiter = substr_count($contents, "\t") > substr_count($contents, ',') ? "\t" : ',';

        $lines = preg_split('/\R/', trim($contents)) ?: [];

        return array_values(array_filter(array_map(
            fn (string $line) => str_getcsv($line, $delimiter, '"', ''),
            $lines,
        ), fn (array $fields) => $fields !== [null] && $fields !== ['']));
    }

    /**
     * The file's normalised header names.
     *
     * @return list<string>
     */
    protected function headers(string $contents): array
    {
        return array_map($this->normaliseHeader(...), $this->grid($contents)[0] ?? []);
    }

    /**
     * Split the file into records keyed by normalised header name.
     *
     * @return list<array<string, string>>
     */
    protected function records(string $contents): array
    {
        $rows = $this->grid($contents);

        if ($rows === []) {
            return [];
        }

        $headers = array_map($this->normaliseHeader(...), array_shift($rows));

        return array_map(function (array $fields) use ($headers) {
            $record = [];

            foreach ($headers as $index => $header) {
                $record[$header] = trim((string) ($fields[$index] ?? ''));
            }

            return $record;
        }, $rows);
    }

    /**
     * Reduce a header to a comparison key: "Category Group/Category" => "categorygroup/category".
     */
    protected function normaliseHeader(?string $header): string
    {
        return strtolower(preg_replace('/[^A-Za-z\/]/', '', (string) $header) ?? '');
    }

    /**
     * @param  array<string, string>  $record
     */
    protected function value(array $record, string $key): string
    {
        return $record[$key] ?? '';
    }

    /**
     * Parse a locale-formatted money string into positive minor units.
     *
     * The final separator followed by one or two digits is the decimal mark;
     * every other separator is a grouping mark, so "1.234,56" and "1,234.56"
     * both yield 123456.
     */
    protected function parseMoney(string $value): int
    {
        $negative = str_contains($value, '(') || str_contains($value, '-');
        $digits = preg_replace('/[^0-9.,]/', '', $value) ?? '';

        if ($digits === '') {
            return 0;
        }

        $whole = $digits;
        $fraction = '';

        if (preg_match('/^(.*)[.,](\d{1,2})$/', $digits, $matches) === 1) {
            [, $whole, $fraction] = $matches;
        }

        $minor = (int) (preg_replace('/\D/', '', $whole) ?? '0') * 100
            + (int) str_pad($fraction, 2, '0');

        return $negative ? -$minor : $minor;
    }

    /**
     * Parse a column that carries its sign structurally rather than in the text,
     * such as Outflow and Inflow, which are always positive magnitudes.
     */
    protected function parseMagnitude(string $value): int
    {
        return abs($this->parseMoney($value));
    }

    /**
     * Convert an exported date to ISO-8601 using the file's component order.
     */
    protected function parseDate(string $value, DateOrder $order): string
    {
        if (preg_match('/^(\d{4})\D(\d{1,2})\D(\d{1,2})$/', $value, $matches) === 1) {
            return sprintf('%04d-%02d-%02d', $matches[1], $matches[2], $matches[3]);
        }

        if (preg_match('/^(\d{1,2})\D(\d{1,2})\D(\d{4})$/', $value, $matches) === 1) {
            [$day, $month] = $order === DateOrder::DayFirst
                ? [$matches[1], $matches[2]]
                : [$matches[2], $matches[1]];

            return sprintf('%04d-%02d-%02d', $matches[3], $month, $day);
        }

        return $value;
    }

    protected function parseCleared(string $value): string
    {
        return match (strtolower(trim($value))) {
            'cleared', 'c' => 'cleared',
            'reconciled', 'r' => 'reconciled',
            default => 'uncleared',
        };
    }
}
