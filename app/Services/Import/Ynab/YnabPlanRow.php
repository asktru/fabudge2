<?php

namespace App\Services\Import\Ynab;

/**
 * One normalised row of YNAB's Plan.csv (older exports call it Budget.csv):
 * what a category was assigned, spent, and left holding in a given month.
 *
 * `month` is ISO "YYYY-MM"; the amounts are signed minor units.
 */
class YnabPlanRow
{
    public function __construct(
        public readonly string $month,
        public readonly string $categoryGroup,
        public readonly string $category,
        public readonly int $assigned,
        public readonly int $activity,
        public readonly int $available,
    ) {}
}
