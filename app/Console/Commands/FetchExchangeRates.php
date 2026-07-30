<?php

namespace App\Console\Commands;

use App\Services\ExchangeRateService;
use Illuminate\Console\Command;

class FetchExchangeRates extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'rates:fetch';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Fetch and cache CAD-based exchange rates';

    /**
     * Execute the console command.
     */
    public function handle(ExchangeRateService $rates): int
    {
        if (! $rates->refresh()) {
            $this->warn('Rate fetch failed; keeping previously cached rates.');

            return self::FAILURE;
        }

        $this->info('Exchange rates refreshed.');

        return self::SUCCESS;
    }
}
