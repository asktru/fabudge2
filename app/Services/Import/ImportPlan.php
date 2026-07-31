<?php

namespace App\Services\Import;

/**
 * A source-agnostic description of everything an import will write.
 *
 * Rows are held in the same wire shape the sync protocol uses, so an import is
 * applied through exactly the same validation and last-write-wins path as a
 * client push. Anything that produces this (the YNAB CSV mapper today, a YNAB
 * API mapper later) gets the writer and its guarantees for free.
 */
class ImportPlan
{
    /**
     * @param  list<array{table: string, row: array<string, mixed>}>  $changes
     * @param  list<string>  $warnings  Lossiness the user should know about before committing.
     * @param  array<string, int>  $summary  Row counts per table, for the confirmation screen.
     */
    public function __construct(
        public readonly array $changes = [],
        public readonly array $warnings = [],
        public readonly array $summary = [],
    ) {}

    /**
     * The rows destined for one sync table, in insertion order.
     *
     * @return list<array<string, mixed>>
     */
    public function rowsFor(string $table): array
    {
        return array_values(array_map(
            fn (array $change) => $change['row'],
            array_filter($this->changes, fn (array $change) => $change['table'] === $table),
        ));
    }

    public function isEmpty(): bool
    {
        return $this->changes === [];
    }
}
