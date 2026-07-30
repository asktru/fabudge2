# Phase 1: Foundation + Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local-first budget tracking: accounts, categories, payees, transactions (incl. cross-currency transfers), Dexie + LWW sync against Laravel, currency rates, adaptive register UI.

**Architecture:** Vue SPA mounted from one Inertia page reads/writes a local Dexie DB through a repository layer; a sync engine pushes outbox rows / pulls by server cursor to Laravel mirror tables (`server_seq` global sequence, row-level LWW by `updated_at` ms). Laravel: auth, validation, rates job.

**Tech Stack:** Laravel 13, Inertia v3, Vue 3, Tailwind v4, reka-ui components, Dexie 4, uuid (v7), Vitest + fake-indexeddb, Pest 5 (+ browser tests).

## Global Constraints

- Money: signed integers, minor units, account's currency. Never floats.
- IDs: UUIDv7 strings client-generated; server accepts client IDs.
- All syncable rows: `budget_id`, `updated_at` (unix ms int), `deleted_at` (unix ms int, nullable), server adds `server_seq`.
- Syncable tables: `accounts`, `category_groups`, `categories`, `payees`, `transactions`.
- Server never mutates business data except LWW accept/reject; validation only.
- All UI reads via Dexie `liveQuery`; no Inertia round-trips inside the SPA.
- Adaptive: desktop sidebar layout ⇄ mobile bottom-nav + sheets. Tailwind breakpoints, no separate mobile pages.
- Run `vendor/bin/pint --dirty --format agent` before each commit touching PHP; `npm run lint` + `npm run types:check` for TS.
- Dates on transactions: `YYYY-MM-DD` strings.
- New deps (approved via design): prod `dexie`, `uuid`; dev `vitest`, `fake-indexeddb`, `happy-dom`, `@vitest/coverage-v8` (optional), `@vue/test-utils` (only if component tests needed later).

---

### Task 1: Server schema + Budget model

**Files:**
- Create migration `create_budget_tables` (budgets, accounts, category_groups, categories, payees, transactions, exchange_rates, sync_sequence)
- Create: `app/Models/Budget.php`, factories `database/factories/BudgetFactory.php`
- Modify: `app/Models/Team.php` (hasOne Budget), team-created hook or lazy accessor to auto-create budget
- Test: `tests/Feature/Budget/BudgetProvisioningTest.php`

**Schema details:**
- `budgets`: id uuid pk, team_id FK unique, name string, currency char(3) default 'CAD', timestamps.
- Mirror tables share: id uuid pk, budget_id FK indexed, `updated_at_ms` unsignedBigInteger, `deleted_at_ms` nullable unsignedBigInteger, `server_seq` unsignedBigInteger indexed together with budget_id. (Column named `updated_at_ms` server-side to avoid clashing with Eloquent timestamps; wire format uses `updated_at`.)
- `accounts`: name, currency char(3), type string, on_budget bool, note text nullable, sort_order int.
- `category_groups`: name, sort_order.
- `categories`: category_group_id uuid nullable, name, sort_order.
- `payees`: name.
- `transactions`: account_id uuid indexed, date date, amount bigInteger, payee_id nullable, category_id nullable, memo text nullable, cleared string default 'uncleared', transfer_pair_id uuid nullable indexed.
- `exchange_rates`: id, quote_currency char(3) unique, rate decimal(18,8), fetched_at timestamp.
- `sync_sequence`: single-row table (id=1, value bigint) — next `server_seq` allocated inside the push DB transaction.
- No cross-table FK constraints on mirror tables beyond budget_id (rows can arrive in any order within a push).

**Interfaces (produces):** `Budget::forTeam(Team $team): Budget` (creates on first access); models `Account`, `CategoryGroup`, `Category`, `Payee`, `Transaction` as plain Eloquent with `$table`-appropriate casts, `HasUuids` off (client IDs), `public $incrementing = false; protected $keyType = 'string'`.

**Steps (TDD):**
- [ ] Test: creating a team provisions no budget rows; `Budget::forTeam($team)` creates budget once and is idempotent; budget scoped per team.
- [ ] Migration + models minimal to pass. Run `php artisan test --compact --filter=BudgetProvisioning`.
- [ ] Pint, commit.

### Task 2: Sync push endpoint (LWW)

**Files:**
- Create: `app/Http/Controllers/Api/SyncController.php`, `app/Services/Sync/SyncTables.php` (table registry + validation rules), `routes/api.php` entries under `auth` + team middleware (`/api/{current_team}/sync/push`)
- Test: `tests/Feature/Sync/SyncPushTest.php`

**Wire format (produces — client depends on this exactly):**
```json
POST /api/{team}/sync/push
{"changes": [{"table": "accounts", "row": {"id": "...", "name": "...", "currency": "CAD", "type": "chequing", "on_budget": true, "note": null, "sort_order": 0, "updated_at": 1722297600000, "deleted_at": null}}]}
→ 200 {"results": [{"id": "...", "table": "accounts", "status": "accepted"|"rejected"|"stale", "reason": null|"..."}], "server_seq": 42}
```
- LWW: upsert if row absent or incoming `updated_at` > stored `updated_at_ms`; equal/older → status `stale` (not an error).
- Every accepted row gets fresh `server_seq` from `sync_sequence` (locked increment inside transaction).
- `budget_id` always forced server-side from route team — never trusted from payload.
- Validation per table via `SyncTables::rules(table)`; unknown table/invalid row → `rejected` with reason; batch limited to 500 changes.

**Steps:**
- [ ] Tests: create new row; LWW newer wins; stale older ignored; tombstone accepted; unknown table rejected; invalid enum rejected; foreign team gets 403/404 via middleware; idempotent replay (same push twice → second all `stale`); server_seq strictly increases.
- [ ] Implement controller + registry until green: `php artisan test --compact --filter=SyncPush`.
- [ ] Pint, commit.

### Task 3: Sync pull endpoint + exchange rates service

**Files:**
- Create: `app/Console/Commands/FetchExchangeRates.php`, `app/Services/ExchangeRateService.php`, pull method in `SyncController`, schedule entry in `routes/console.php`
- Test: `tests/Feature/Sync/SyncPullTest.php`, `tests/Feature/ExchangeRatesTest.php`

**Wire format (produces):**
```json
GET /api/{team}/sync/pull?cursor=0&limit=1000
→ 200 {"changes": [{"table": "transactions", "row": {...same shape as push, plus no server fields...}}], "cursor": 129, "has_more": false, "rates": {"base": "CAD", "fetched_at": 1722297600000, "quotes": {"USD": 0.73, "UAH": 30.4}}}
```
- Ordered by `server_seq` asc across all five tables (union), `limit` capped at 1000, `has_more` signals continuation.
- Rates always attached (empty quotes if none fetched yet).
- `ExchangeRateService::refresh()` pulls `https://open.er-api.com/v6/latest/CAD`, upserts rows for all quote currencies; failure leaves existing rows untouched. Scheduled daily. `Http::fake` in tests.

**Steps:**
- [ ] Tests: pull from 0 returns everything in seq order; cursor skips seen; pagination + has_more; other team's data never returned; tombstones included; rates included; refresh command upserts/keeps-on-failure.
- [ ] Implement until green; Pint; commit.

### Task 4: Frontend tooling + client data core (types, db, money)

**Files:**
- Modify: `package.json` (add dexie, uuid; dev vitest, fake-indexeddb, happy-dom), add `vitest.config.ts`, script `"test:js": "vitest run"`
- Create: `resources/js/budget/types.ts` (entity interfaces + wire types mirroring Task 2/3 exactly), `resources/js/budget/db.ts` (Dexie schema v1), `resources/js/budget/money.ts` (parse/format minor units per currency, `convertToBase(amountMinor, currency, rates)`), `resources/js/budget/ids.ts` (uuidv7 wrapper), `resources/js/budget/clock.ts` (`nowMs()`)
- Test: `resources/js/budget/__tests__/money.test.ts`, `db.test.ts`

**Dexie schema (produces):**
```ts
db.version(1).stores({
  accounts: 'id, sort_order', category_groups: 'id, sort_order',
  categories: 'id, category_group_id, sort_order', payees: 'id, name',
  transactions: 'id, account_id, date, payee_id, category_id, transfer_pair_id',
  outbox: '++seq, [table+row_id]', sync_meta: 'key', rates: 'quote',
})
```
- `outbox` rows: `{seq, table, row_id, enqueued_at}`; dedupe per (table,row_id) — re-enqueue moves to tail.
- `sync_meta`: `{key: 'cursor', value: number}`, `{key: 'budget', value: {teamSlug}}`.

**Steps:**
- [ ] Install deps; vitest config with `environment: 'happy-dom'`, setup file importing `fake-indexeddb/auto`.
- [ ] Tests for money (format/parse CAD/UAH/USD incl. negative, rounding rejection, conversion with missing rate → null) and db open/roundtrip.
- [ ] Implement; `npm run test:js`; lint+types; commit.

### Task 5: Repository layer + balances

**Files:**
- Create: `resources/js/budget/repo.ts` — all mutations; `resources/js/budget/balances.ts` — derivations
- Test: `resources/js/budget/__tests__/repo.test.ts`, `balances.test.ts`

**Interfaces (produces):**
```ts
// every mutation stamps updated_at=nowMs() and enqueues outbox atomically
createAccount(input: {name, currency, type, on_budget, startingBalanceMinor}): Promise<Account> // starting balance ⇒ transaction w/ payee 'Starting balance' (payee created on demand), no category
updateAccount(id, patch); softDelete(table, id) // tombstone; deleting account tombstones its transactions; deleting a transfer leg tombstones both
createTransaction(input: {account_id, date, amountMinor, payeeName?|payee_id?, category_id?, memo?, cleared}) // payeeName resolves-or-creates case-insensitively
updateTransaction(id, patch) // if leg of transfer: date/memo propagate to pair; amount/cleared do not
createTransfer(input: {from_account_id, to_account_id, date, outMinor, inMinor, memo?, clearedFrom, clearedTo}) // two rows, shared transfer_pair_id, out negative / in positive
createCategoryGroup/createCategory/renameCategory/reorder…, createPayee/renamePayee/mergePayees(fromId, toId) // merge repoints transactions then tombstones source
accountBalances(): {[accountId]: {workingMinor, clearedMinor}} // excludes tombstones
totalInBase(balances, accounts, rates): {totalMinor, missingRates: string[]}
```

**Steps:**
- [ ] Tests: atomicity (row+outbox), tombstone filtering, transfer pairing rules (edit propagation matrix, delete both), FX transfer keeps both entered amounts, merge payees, balances working vs cleared, conversion sum.
- [ ] Implement; green; lint; commit.

### Task 6: Sync engine (client)

**Files:**
- Create: `resources/js/budget/sync.ts` (`SyncEngine` class), `resources/js/budget/syncStatus.ts` (reactive status: `idle|syncing|offline|error`, pendingCount, ratesFetchedAt)
- Test: `resources/js/budget/__tests__/sync.test.ts` (mock `fetch`)

**Behavior:**
- `push()`: read outbox in seq order → load current rows (tombstoned included) → POST push wire format → on accepted/stale/rejected remove outbox entries; `rejected` rows recorded in `sync_meta` key `errors` (kept out of retry).
- `pull()`: GET with stored cursor; apply rows where `remote.updated_at > local.updated_at` AND no outbox entry for that row; save cursor after each page; upsert rates table.
- `syncNow()` = push then pull, serialized (no concurrent runs). Debounced trigger `requestSync()` (3s) called by repo hook; interval 60s; `online` event; exponential backoff 5s→5min on failure.
- CSRF: reuse Inertia's XSRF cookie header handling (plain `fetch` with `X-XSRF-TOKEN` from cookie).

**Steps:**
- [ ] Tests: outbox drain removes entries; rejected quarantined; pull respects cursor + dirty-row protection; LWW apply; rates stored; offline → no fetch calls and pending grows; backoff after failure (fake timers).
- [ ] Implement; green; lint; commit.

### Task 7: SPA shell + adaptive layout + sidebar balances

**Files:**
- Create: `resources/js/pages/Budget.vue` (Inertia entry, boots db+sync via provide/inject), `resources/js/budget/components/BudgetShell.vue` (adaptive: `lg:` persistent sidebar / mobile top bar + bottom nav + drawer), `BudgetSidebar.vue` (total in CAD via `totalInBase`, on/off-budget account groups, native-currency balances, add account button, sync status dot), `resources/js/budget/useLive.ts` (liveQuery→ref bridge)
- Modify: `routes/web.php` (`Route::get('budget', ...)` in team group → `Inertia::render('Budget', ['teamSlug' => ...])`), Dashboard nav link
- Test: `tests/Feature/Budget/BudgetPageTest.php` (route renders, auth+team scoping)

**Steps:**
- [ ] Feature test for route; implement page + shell with placeholder panes; verify `npm run build` passes and page renders (dev server).
- [ ] Wire liveQuery sidebar balances (unit-test `useLive` bridge minimally).
- [ ] Lint, types, pint, commit.

### Task 8: Accounts UI

**Files:**
- Create: `resources/js/budget/components/AccountFormDialog.vue` (create/edit; name, type select, currency select CAD/USD/UAH+custom, on_budget switch, starting balance money input on create; Dialog on desktop / Sheet on mobile via `useMediaQuery`), `MoneyInput.vue` (currency-aware minor-units input)
- Test: extend `repo.test.ts` where logic added; visual check via dev server

**Steps:**
- [ ] Implement MoneyInput (parse on blur, formats minor units; unit test parse edge cases in money.test.ts if new logic).
- [ ] Implement dialog + open from sidebar; account edit/close (close = tombstone with confirm).
- [ ] Lint, commit.

### Task 9: Register + transaction entry

**Files:**
- Create: `resources/js/budget/components/RegisterView.vue` (per-account + all-accounts; header balances; date-desc list; desktop table row / mobile card list), `TransactionRow.vue`, `TransactionForm.vue` (inline desktop row / mobile bottom Sheet), `PayeeCombobox.vue` (recent-first, create-on-type, `Transfer: {account}` entries), `CategoryCombobox.vue`
- Test: `resources/js/budget/__tests__/transactionForm.logic.test.ts` — extract form state machine to `resources/js/budget/transactionFormModel.ts` (pure): payee selection → type resolution (expense/income/transfer), FX transfer dual amount requirement, edit-transfer field locking
- Modify: `BudgetShell.vue` routing state (selected account)

**Steps:**
- [ ] Test + implement `transactionFormModel.ts` pure logic first.
- [ ] Build components consuming the model; cleared toggle cycles uncleared→cleared (reconciled shown as lock, not togglable — phase 2).
- [ ] Manual verify all flows on dev server (expense, income, same-currency transfer, FX transfer, edit each, delete).
- [ ] Lint, types, commit.

### Task 10: Management screens (categories, payees)

**Files:**
- Create: `resources/js/budget/components/ManageCategories.vue` (groups + categories: create/rename/reorder/hide=tombstone), `ManagePayees.vue` (rename, merge), reachable from shell nav
- Test: repo functions already covered; extend if new repo logic (reorder)

**Steps:**
- [ ] Implement reorder as sort_order reassignment (test in repo.test.ts).
- [ ] Build screens; default seed on first budget open: create default groups/categories? — NO (YAGNI; user creates their own).
- [ ] Lint, commit.

### Task 11: E2E smoke + full verification pass

**Files:**
- Create: `tests/Browser/BudgetSmokeTest.php` (Pest browser test: login → budget → create account w/ starting balance → add expense → transfer → reload → data persists & sidebar totals correct)
- Modify: whatever the pass finds

**Steps:**
- [ ] Write + run browser test (`php artisan test --compact tests/Browser/BudgetSmokeTest.php`).
- [ ] Full: `php artisan test --compact`, `npm run test:js`, `npm run lint:check`, `npm run types:check`, `npm run build`, pint.
- [ ] Fix anything; commit; mark phase 1 done.
