<?php

namespace App\Services\Dictation;

use Anthropic\Lib\Attributes\Constrained;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;

/**
 * Structured-output schema for a dictated transaction.
 */
class ParsedDictation implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    #[Constrained(description: 'Either "expense" or "income"')]
    public string $type;

    #[Constrained(description: 'Absolute amount in minor units (cents/kopiykas), e.g. $12.50 => 1250')]
    public int $amountMinor;

    #[Constrained(description: 'Payee name; use the exact known payee name when one clearly matches, otherwise the name as spoken; null if absent')]
    public ?string $payee = null;

    #[Constrained(description: 'Exact name of one of the known accounts, or null')]
    public ?string $account = null;

    #[Constrained(description: 'Exact name of one of the known categories, or null')]
    public ?string $category = null;

    #[Constrained(description: 'Transaction date as YYYY-MM-DD, resolving relative words like "yesterday"; null if not mentioned')]
    public ?string $date = null;

    #[Constrained(description: 'A short free-text note if any extra detail was spoken; null otherwise')]
    public ?string $memo = null;
}
