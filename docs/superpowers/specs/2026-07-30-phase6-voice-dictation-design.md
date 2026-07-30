# Phase 6: Voice Dictation — Design

Date: 2026-07-30
Status: Approved (autonomous, per delegated review)

## Flow

1. Mic button in the transaction form starts browser speech recognition
   (`webkitSpeechRecognition` / `SpeechRecognition` — native on-device STT on
   iOS/macOS, no audio leaves the app for transcription). Unsupported
   browsers simply don't show the button.
2. The final transcript goes to `POST /{team}/dictation/parse` with context
   (live account/category/payee names + today's date). The server asks
   Claude (`claude-opus-5`, official PHP SDK, structured output via
   `output_config.format` json_schema) to extract fields.
3. If the server is not configured (no `ANTHROPIC_API_KEY`) or the request
   fails, the client falls back to a local heuristic parser — the feature
   still works offline, just less cleverly.
4. Parsed fields prefill the open transaction form; the user reviews and
   saves. Nothing is auto-committed.

## Parsed shape (server and local parser agree)

```json
{
  "amountMinor": 1250,            // positive; sign comes from type
  "type": "expense" | "income",
  "payee": "Tim Hortons" | null,  // matched to an existing name when close
  "account": "RBC Chequing" | null,
  "category": "Coffee" | null,
  "date": "2026-07-30" | null,    // resolves "yesterday", "on Monday"
  "memo": null
}
```

## Server

- `DictationParser` interface bound in the container:
  - `ClaudeDictationParser` (real; `config('services.anthropic.key')`).
  - Tests swap in a fake — the Claude call itself is not unit-tested.
- `DictationController`: validates transcript (1..500 chars) + context
  arrays; 503 `{error: "not_configured"}` without an API key; team-scoped
  route in the existing group.
- New dev-approved dependency: `anthropic-ai/sdk` (official PHP SDK).

## Client

- `dictation.ts`:
  - `localParseDictation(transcript, context)` — heuristics: first number
    (supports decimals/commas) → amount; income keywords ("received",
    "salary", "income") → type; fuzzy containment match of known payee /
    account / category names; "yesterday"/"today" date words.
  - `parseDictation()` — server first, local fallback.
- `useSpeech.ts` — thin wrapper over SpeechRecognition (start/stop,
  interim + final transcript, `supported` flag).
- `TransactionFormDialog`: mic button (pulses while listening, shows the
  live transcript), fills amount/payee/category/account/date on completion.

## Testing

- Vitest: localParseDictation (amounts incl. "13.50"/"13,50", income
  detection, fuzzy name matching, date words, no-match passthrough).
- Pest: endpoint validation, 503 when unconfigured, parsed passthrough with
  a container-bound fake parser, team scoping.
