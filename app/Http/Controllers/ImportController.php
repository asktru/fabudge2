<?php

namespace App\Http\Controllers;

use App\Actions\Import\ApplyImportPlan;
use App\Enums\DateOrder;
use App\Http\Requests\Import\ImportYnabExportRequest;
use App\Models\Budget;
use App\Models\Team;
use App\Services\Import\ImportFailedException;
use App\Services\Import\Ynab\YnabCsvParser;
use App\Services\Import\Ynab\YnabExportArchive;
use App\Services\Import\Ynab\YnabExportFormatException;
use App\Services\Import\Ynab\YnabImportMapper;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class ImportController extends Controller
{
    public function create(Request $request, Team $current_team): Response
    {
        return Inertia::render('Import', [
            'budgetCurrency' => Budget::forTeam($current_team)->currency,
            'result' => $request->session()->get('import'),
        ]);
    }

    /**
     * Read an uploaded YNAB export and write it into the team's budget.
     */
    public function store(
        ImportYnabExportRequest $request,
        Team $current_team,
        YnabCsvParser $parser,
        YnabImportMapper $mapper,
        ApplyImportPlan $applyImportPlan,
    ): RedirectResponse {
        $budget = Budget::forTeam($current_team);

        try {
            $archive = YnabExportArchive::open($request->file('file')->getRealPath());
            $dateOrder = $this->resolveDateOrder($parser, $archive, $request->input('date_order'));

            $plan = $mapper->map(
                $parser->parseRegister($archive->register, $dateOrder),
                $archive->plan === '' ? [] : $parser->parsePlan($archive->plan),
                $budget->currency,
            );

            $applyImportPlan->handle($budget, $plan);
        } catch (YnabExportFormatException|ImportFailedException $exception) {
            throw ValidationException::withMessages(['file' => $exception->getMessage()]);
        }

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Import complete.')]);

        return to_route('import.create', ['current_team' => $current_team])
            ->with('import', ['summary' => $plan->summary, 'warnings' => $plan->warnings]);
    }

    /**
     * Settle how the export writes its dates, asking the user when the file
     * itself never disambiguates: a wrong guess silently moves transactions to
     * the wrong day for up to twelve days of every month.
     */
    protected function resolveDateOrder(YnabCsvParser $parser, YnabExportArchive $archive, ?string $chosen): DateOrder
    {
        $detected = $parser->detectDateOrder($archive->register);

        if ($detected !== DateOrder::Ambiguous) {
            return $detected;
        }

        $chosenOrder = $chosen === null ? null : DateOrder::tryFrom($chosen);

        if ($chosenOrder === null) {
            throw ValidationException::withMessages([
                'date_order' => __('Every date in this export could be read either way round, for example 05/03/2026. Tell us which order YNAB used.'),
            ]);
        }

        return $chosenOrder;
    }
}
