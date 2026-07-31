<?php

namespace App\Services\Import\Ynab;

/**
 * One normalised row of YNAB's Register.csv.
 *
 * Locale-specific encodings are already resolved here: `date` is ISO-8601 and
 * `amount` is signed minor units (outflow negative, inflow positive). YNAB also
 * encodes two relationships as strings rather than columns, so those are pulled
 * out too: a "Transfer : X" payee becomes `transferAccount`, and a
 * "Split (n/m)" memo prefix becomes `splitIndex`/`splitCount`.
 */
class YnabRegisterRow
{
    public function __construct(
        public readonly string $account,
        public readonly string $date,
        public readonly string $payee,
        public readonly string $categoryGroup,
        public readonly string $category,
        public readonly string $memo,
        public readonly int $amount,
        public readonly string $cleared,
        public readonly string $flag = '',
        public readonly ?string $transferAccount = null,
        public readonly ?int $splitIndex = null,
        public readonly ?int $splitCount = null,
    ) {}

    public function isTransfer(): bool
    {
        return $this->transferAccount !== null;
    }

    public function isSplit(): bool
    {
        return $this->splitCount !== null;
    }
}
