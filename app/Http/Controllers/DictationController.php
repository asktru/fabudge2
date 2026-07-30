<?php

namespace App\Http\Controllers;

use App\Services\Dictation\DictationParser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DictationController extends Controller
{
    /**
     * Parse a dictated sentence into transaction fields via the LLM parser.
     */
    public function parse(Request $request, DictationParser $parser): JsonResponse
    {
        $payload = $request->validate([
            'transcript' => ['required', 'string', 'min:1', 'max:500'],
            'context' => ['required', 'array'],
            'context.accounts' => ['present', 'array', 'max:100'],
            'context.accounts.*' => ['string', 'max:255'],
            'context.categories' => ['present', 'array', 'max:300'],
            'context.categories.*' => ['string', 'max:255'],
            'context.payees' => ['present', 'array', 'max:500'],
            'context.payees.*' => ['string', 'max:255'],
            'context.today' => ['required', 'date_format:Y-m-d'],
        ]);

        if (! $parser->isConfigured()) {
            return response()->json(['error' => 'not_configured'], 503);
        }

        return response()->json($parser->parse($payload['transcript'], $payload['context']));
    }
}
