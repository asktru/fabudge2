<?php

namespace App\Services\Dictation;

interface DictationParser
{
    /**
     * Whether the parser can actually run (e.g. an API key is configured).
     */
    public function isConfigured(): bool;

    /**
     * Parse a dictated sentence into transaction fields.
     *
     * @param  array{accounts: list<string>, categories: list<string>, payees: list<string>, today: string}  $context
     * @return array{type: string, amountMinor: int, payee: string|null, account: string|null, category: string|null, date: string|null, memo: string|null}
     */
    public function parse(string $transcript, array $context): array;
}
