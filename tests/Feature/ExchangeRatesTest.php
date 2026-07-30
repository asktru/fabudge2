<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

test('rates:fetch stores CAD-based rates', function () {
    Http::fake([
        'open.er-api.com/*' => Http::response([
            'result' => 'success',
            'rates' => ['CAD' => 1, 'USD' => 0.73, 'UAH' => 30.4],
        ]),
    ]);

    $this->artisan('rates:fetch')->assertSuccessful();

    $rates = DB::table('exchange_rates')->pluck('rate', 'quote_currency');
    expect($rates)->toHaveCount(2)
        ->and((float) $rates['USD'])->toEqualWithDelta(0.73, 0.0001)
        ->and((float) $rates['UAH'])->toEqualWithDelta(30.4, 0.0001);
});

test('rates:fetch updates existing rates', function () {
    DB::table('exchange_rates')->insert(['quote_currency' => 'USD', 'rate' => 0.70, 'fetched_at' => now()->subDay()]);

    Http::fake([
        'open.er-api.com/*' => Http::response(['result' => 'success', 'rates' => ['USD' => 0.75]]),
    ]);

    $this->artisan('rates:fetch')->assertSuccessful();

    expect(DB::table('exchange_rates')->where('quote_currency', 'USD')->count())->toBe(1)
        ->and((float) DB::table('exchange_rates')->value('rate'))->toEqualWithDelta(0.75, 0.0001);
});

test('failed fetch keeps previously cached rates', function () {
    DB::table('exchange_rates')->insert(['quote_currency' => 'USD', 'rate' => 0.70, 'fetched_at' => now()->subDay()]);

    Http::fake(['open.er-api.com/*' => Http::response(null, 500)]);

    $this->artisan('rates:fetch')->assertFailed();

    expect((float) DB::table('exchange_rates')->value('rate'))->toEqualWithDelta(0.70, 0.0001);
});
