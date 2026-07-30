<?php

use App\Models\Team;
use App\Models\User;
use App\Services\Dictation\DictationParser;

class FakeDictationParser implements DictationParser
{
    public array $lastContext = [];

    public function __construct(protected bool $configured = true) {}

    public function isConfigured(): bool
    {
        return $this->configured;
    }

    public function parse(string $transcript, array $context): array
    {
        $this->lastContext = $context;

        return [
            'type' => 'expense',
            'amountMinor' => 1250,
            'payee' => 'Tim Hortons',
            'account' => null,
            'category' => 'Coffee',
            'date' => null,
            'memo' => null,
        ];
    }
}

function dictationPayload(): array
{
    return [
        'transcript' => 'twelve fifty at tim hortons',
        'context' => [
            'accounts' => ['Chequing'],
            'categories' => ['Coffee'],
            'payees' => ['Tim Hortons'],
            'today' => '2026-07-30',
        ],
    ];
}

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = Team::factory()->create();
    $this->team->members()->attach($this->user, ['role' => 'owner']);
});

test('parses a transcript through the bound parser', function () {
    $fake = new FakeDictationParser;
    app()->instance(DictationParser::class, $fake);

    $this->actingAs($this->user)
        ->postJson("/{$this->team->slug}/dictation/parse", dictationPayload())
        ->assertOk()
        ->assertJson(['type' => 'expense', 'amountMinor' => 1250, 'payee' => 'Tim Hortons']);

    expect($fake->lastContext['today'])->toBe('2026-07-30');
});

test('returns 503 when no API key is configured', function () {
    app()->instance(DictationParser::class, new FakeDictationParser(configured: false));

    $this->actingAs($this->user)
        ->postJson("/{$this->team->slug}/dictation/parse", dictationPayload())
        ->assertStatus(503)
        ->assertJson(['error' => 'not_configured']);
});

test('validates the transcript and context', function () {
    app()->instance(DictationParser::class, new FakeDictationParser);

    $this->actingAs($this->user)
        ->postJson("/{$this->team->slug}/dictation/parse", ['transcript' => '', 'context' => []])
        ->assertUnprocessable();
});

test('non-members cannot use dictation', function () {
    app()->instance(DictationParser::class, new FakeDictationParser);
    $outsider = User::factory()->create();

    $this->actingAs($outsider)
        ->postJson("/{$this->team->slug}/dictation/parse", dictationPayload())
        ->assertForbidden();
});
