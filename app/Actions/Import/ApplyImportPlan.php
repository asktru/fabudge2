<?php

namespace App\Actions\Import;

use App\Models\Budget;
use App\Services\Import\ImportFailedException;
use App\Services\Import\ImportPlan;
use App\Services\Sync\SyncWriter;
use Illuminate\Support\Facades\DB;

/**
 * Writes an {@see ImportPlan} into a budget, all or nothing.
 *
 * A partially applied import is worse than no import: the user cannot tell what
 * landed, and re-running would duplicate whatever did. So any rejected row
 * rolls the whole batch back.
 */
class ApplyImportPlan
{
    public function __construct(protected SyncWriter $writer) {}

    /**
     * @return int The number of rows written.
     *
     * @throws ImportFailedException
     */
    public function handle(Budget $budget, ImportPlan $plan): int
    {
        return DB::transaction(function () use ($budget, $plan) {
            $applied = 0;

            foreach ($plan->changes as $change) {
                $result = $this->writer->apply($budget, $change['table'], $change['row']);

                if ($result['status'] === 'rejected') {
                    throw ImportFailedException::rowRejected($change['table'], $result['reason']);
                }

                $applied++;
            }

            return $applied;
        });
    }
}
