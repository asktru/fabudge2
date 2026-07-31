<?php

namespace App\Services\Import\Ynab;

use RuntimeException;

/**
 * Thrown when a file does not look like the YNAB export it claims to be.
 */
class YnabExportFormatException extends RuntimeException
{
    /**
     * @param  list<string>  $missing
     */
    public static function missingColumns(string $file, array $missing): self
    {
        return new self(sprintf(
            'This does not look like a YNAB %s export: missing the %s column(s).',
            $file,
            implode(', ', $missing),
        ));
    }
}
