<?php

namespace App\Services\Import;

use RuntimeException;

/**
 * Thrown when an import could not be applied and was rolled back in full.
 */
class ImportFailedException extends RuntimeException
{
    public static function rowRejected(string $table, ?string $reason): self
    {
        return new self(sprintf(
            'The import was cancelled and nothing was saved: a %s row was rejected (%s).',
            $table,
            $reason ?? 'no reason given',
        ));
    }
}
