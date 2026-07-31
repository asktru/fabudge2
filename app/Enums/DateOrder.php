<?php

namespace App\Enums;

/**
 * The order a date string puts its components in.
 *
 * Exports from other tools rarely say which convention they used, and
 * "05/03/2026" is a valid date under either reading, so this is carried around
 * explicitly rather than assumed.
 */
enum DateOrder: string
{
    case Iso = 'iso';
    case DayFirst = 'day-first';
    case MonthFirst = 'month-first';

    /**
     * The file never revealed its order; a caller must choose one.
     */
    case Ambiguous = 'ambiguous';

    /**
     * The reading to fall back on when the user has not chosen one, matching
     * YNAB's own default locale.
     */
    public function orDefault(): self
    {
        return $this === self::Ambiguous ? self::MonthFirst : $this;
    }
}
