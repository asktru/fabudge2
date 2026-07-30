<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class ExchangeRateService
{
    protected const string ENDPOINT = 'https://open.er-api.com/v6/latest/CAD';

    /**
     * Fetch fresh CAD-based rates and upsert them; on failure the previously
     * cached rates are left untouched.
     *
     * @return bool whether fresh rates were stored
     */
    public function refresh(): bool
    {
        $response = Http::timeout(15)->get(self::ENDPOINT);

        if (! $response->successful() || $response->json('result') !== 'success') {
            return false;
        }

        /** @var array<string, float|int> $rates */
        $rates = $response->json('rates', []);
        $fetchedAt = now();

        $rows = collect($rates)
            ->reject(fn ($rate, $currency) => $currency === 'CAD' || ! is_numeric($rate))
            ->map(fn ($rate, $currency) => [
                'quote_currency' => $currency,
                'rate' => $rate,
                'fetched_at' => $fetchedAt,
            ])
            ->values()
            ->all();

        if ($rows === []) {
            return false;
        }

        DB::table('exchange_rates')
            ->upsert($rows, ['quote_currency'], ['rate', 'fetched_at']);

        return true;
    }

    /**
     * Latest cached rates in wire format.
     *
     * @return array{base: string, fetched_at: int|null, quotes: array<string, float>}
     */
    public function current(): array
    {
        $rows = DB::table('exchange_rates')->get();

        return [
            'base' => 'CAD',
            'fetched_at' => $rows->max(fn ($row) => strtotime($row->fetched_at) * 1000),
            'quotes' => $rows->mapWithKeys(fn ($row) => [$row->quote_currency => (float) $row->rate])->all(),
        ];
    }
}
