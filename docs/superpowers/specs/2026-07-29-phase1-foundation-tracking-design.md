# Phase 1: Foundation + Tracking Basics — Design

Date: 2026-07-29
Status: Approved (user delegated review; phases 2–6 tracked as roadmap below)

## Product context

Fabudge is a YNAB-style envelope budgeting app for personal use: offline-first,
multi-currency (CAD main, plus USD and UAH), single user editing from multiple
devices (Mac web/Electron, iOS Capacitor). This phase builds the foundation:
local-first data layer with sync, accounts, categories, payees, transactions
(including cross-currency transfers), currency-rate caching, and a usable,
adaptive register UI.

## Architecture

- The budget app is a Vue SPA mounted from a single Inertia page (`Budget.vue`).
  Auth, settings, and teams remain classic Inertia pages.
- All UI reads/writes go to a local Dexie (IndexedDB) database. Every
  interaction is instant and fully functional offline.
- A hand-rolled sync engine reconciles with Laravel in the background:
  push local mutations, pull remote changes since a cursor.
- Laravel is the authoritative mirror: auth, sync endpoints, validation,
  currency-rate caching. No business logic on the server beyond validation.
- Conflict resolution: row-level last-write-wins by `updated_at` (single user,
  conflicts rare). Server stamps accepted changes with a global monotonically
  increasing `server_seq`; clients pull `server_seq > cursor`.

## Data model

Conventions for all syncable tables:

- `id`: UUIDv7, client-generated.
- `budget_id`: scope. One budget per team in phase 1 (auto-created).
- `updated_at`: unix milliseconds, set by the writer on every change.
- `deleted_at`: nullable tombstone (soft delete); tombstoned rows are filtered
  from all UI queries but still sync.
- `server_seq`: server-only global sequence, assigned on accept.
- Money: signed integers in minor units, in the owning account's currency.

Tables:

- **budgets** — name, main currency (`CAD`).
- **accounts** — name, currency (ISO 4217), type (`chequing|savings|cash|credit_card`),
  `on_budget` bool, note, sort_order. Starting balance = ordinary transaction
  with payee "Starting balance", no category.
- **category_groups** — name, sort_order. (Schema now; minimal UI.)
- **categories** — category_group_id, name, sort_order.
- **payees** — name (unique per budget, case-insensitive).
- **transactions** — account_id, date (YYYY-MM-DD), amount (signed; negative =
  outflow), payee_id (nullable), category_id (nullable), memo,
  cleared (`uncleared|cleared|reconciled`), transfer_pair_id (nullable UUID).
- **exchange_rates** — server-managed, read-only to clients: quote currency,
  rate relative to CAD, fetched_at. Delivered via the pull response.

### Transfers

A transfer is two transaction rows sharing a `transfer_pair_id`, one per
account, each in its own account's currency with its own amount (user enters
both amounts for cross-currency; one amount mirrored with opposite sign for
same-currency). Each side has independent `cleared` status. Neither side has a
category. Editing date/memo on one side propagates to the other; amounts and
cleared status are always per-side. Deleting one side tombstones both.

### Balances

Always derived, never stored: account balance = sum of its transactions
(cleared balance = sum of cleared+reconciled only). Total balance = sum of
account balances converted to CAD at the latest cached rates (display only;
rates never persist into transactions).

## Client architecture

- **Dexie schema** mirrors the tables, plus `sync_meta` (pull cursor, budget id)
  and `outbox` (table name + row id + enqueued_at).
- **Repository layer** wraps Dexie; UI never touches sync concerns. All
  mutations are atomic Dexie transactions that update rows (stamping
  `updated_at`) and enqueue outbox entries together. Transfer legs are written
  atomically.
- **Live queries**: Dexie `liveQuery` bridged to Vue refs; local edits and
  incoming sync both update the UI reactively.
- **Sync engine**:
  - Push: drain outbox, `POST /api/sync/push` with full row snapshots, server
    applies LWW per row and reports per-row accept/reject. Idempotent.
  - Pull: `GET /api/sync/pull?cursor=N` returns rows with `server_seq > N`
    (paginated) + next cursor + exchange rates. Rows apply to Dexie only if
    remote `updated_at` wins and the row is not dirty in the outbox.
  - Triggers: app start; connectivity regained (`navigator.onLine` + backoff);
    debounced after local writes (~3s); periodic poll (~60s) while online.
  - Offline: outbox accumulates; subtle "n pending changes" indicator.
- **Bootstrap**: new device = pull from cursor 0. No special case.

## Server architecture

- Migrations for mirror tables (columns above + `server_seq` bigint from a
  global sequence; index on `(budget_id, server_seq)`).
- `SyncController`: `push` and `pull`, session-auth'd, scoped to the current
  team's budget. Validation: row ownership, known table names, integer amounts,
  valid enums/dates. Rejections returned per row with reasons.
- Exchange rates: scheduled daily command fetching CAD-based rates from
  https://open.er-api.com/v6/latest/CAD (covers USD, UAH), stored in
  `exchange_rates`. On fetch failure keep last cached rates; client shows rate
  age when > 48h.

## Phase 1 UI

Adaptive layout (desktop sidebar ⇄ mobile bottom-nav/drawer) from the start.

- **Sidebar**: total balance in CAD, accounts grouped by on-budget/off-budget
  with native-currency balances, add-account button.
- **Register**: per-account and all-accounts transaction table — date, payee,
  category, memo, outflow/inflow, cleared toggle; cleared vs working balance in
  header; sorted date desc. On narrow screens rows collapse to a two-line
  card layout.
- **Transaction form**: inline row (modal sheet on mobile) — amount, payee
  combobox (create on the fly; "Transfer: {account}" entries make it a
  transfer), category combobox, account, date (default today), memo, cleared
  toggle. Cross-currency transfer asks for both amounts.
- **Management**: accounts (edit/close), categories & groups (create, rename,
  reorder, hide), payees (rename, merge).
- New account flow asks for starting balance.

## Error handling

- Sync failures: silent retry with exponential backoff; persistent failure
  surfaces a non-blocking banner. Outbox is durable across reloads.
- Per-row server rejections mark rows "sync error" locally (bug surface, not
  retried forever).
- Rate API failure: serve last cached rates, show staleness after 48h.

## Testing

- Pest feature tests: push idempotency, LWW conflicts, tombstones, cursor
  pagination, cross-team isolation, validation rejections, rate-fetch job
  (Http::fake).
- Vitest unit tests (fake-indexeddb): sync engine push/pull/conflict/offline
  scenarios, transfer pairing, balance derivation, currency conversion,
  repository atomicity.
- One Pest browser smoke test: create account → expense → transfer → reload →
  data persists.

## Roadmap (later phases, out of scope here)

2. Tracking conveniences: reconciliation mode, split transactions (rows
   sharing a split group, displayed as one), payee→category auto-suggest.
3. Planning: monthly category assignments, ready-to-assign, problem
   highlighting, move money, targets + auto-assign.
4. Analytics: spending by category/group, income vs spending, net worth trend.
5. Location-based payee suggestions (payee↔location m-to-n, ranked suggest).
6. Voice dictation (STT + transaction parsing).

Schema decisions here anticipate these (category groups, `on_budget`,
`reconciled` cleared state) so later phases don't require sync migrations.
