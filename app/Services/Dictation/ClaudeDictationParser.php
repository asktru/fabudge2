<?php

namespace App\Services\Dictation;

use Anthropic\Client;

class ClaudeDictationParser implements DictationParser
{
    public function isConfigured(): bool
    {
        return (bool) config('services.anthropic.key');
    }

    public function parse(string $transcript, array $context): array
    {
        $client = new Client(apiKey: (string) config('services.anthropic.key'));

        $prompt = <<<PROMPT
        Parse this dictated personal-finance transaction into structured fields.

        Dictation: "{$transcript}"

        Today's date: {$context['today']}
        Known accounts: {$this->joined($context['accounts'])}
        Known categories: {$this->joined($context['categories'])}
        Known payees: {$this->joined($context['payees'])}

        Rules:
        - amountMinor is the absolute amount in minor units (e.g. "$12.50" or "12 dollars 50" => 1250).
        - type is "income" only when money is clearly received (salary, refund, got paid); otherwise "expense".
        - For payee/account/category, prefer an exact name from the known lists when the dictation clearly refers to it (any language, fuzzy match ok). Use null when nothing matches; for payee you may return the spoken name even if unknown.
        - Resolve relative dates ("yesterday", "last Monday") against today's date; null when no date is spoken.
        PROMPT;

        $message = $client->messages->create(
            maxTokens: 1024,
            messages: [['role' => 'user', 'content' => $prompt]],
            model: 'claude-haiku-4-5',
            outputConfig: ['format' => ParsedDictation::class],
        );

        /** @var ParsedDictation $parsed */
        $parsed = $message->parsedOutput();

        return [
            'type' => in_array($parsed->type, ['expense', 'income'], true) ? $parsed->type : 'expense',
            'amountMinor' => max(0, $parsed->amountMinor),
            'payee' => $parsed->payee,
            'account' => $parsed->account,
            'category' => $parsed->category,
            'date' => $parsed->date,
            'memo' => $parsed->memo,
        ];
    }

    /**
     * @param  list<string>  $names
     */
    protected function joined(array $names): string
    {
        return $names === [] ? '(none)' : implode(', ', array_map(fn (string $name) => '"'.$name.'"', $names));
    }
}
