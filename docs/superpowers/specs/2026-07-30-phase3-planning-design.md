# Phase 3: Planning (Envelope Budgeting) — Design

Date: 2026-07-30
Status: Approved (autonomous, per delegated review)

## Currency convention

Planning happens in the budget's main currency (CAD). Transactions in
foreign-currency on-budget accounts are converted at the **latest cached
rate** — same convention as the total-balance display. Rates drift slightly
over time; acceptable for a personal app and self-corrects as the user
resolves the flagged problems.

## Data model (new syncable tables)

- **assignments** — id, category_id, month (`YYYY-MM`), amount (CAD minor
  units, signed). One logical row per (category, month); the client upserts
  by looking up an existing live row first.
- **targets** — id, category_id (one live target per category), type:
  - `monthly`: assign `amount` every month
  - `by_date`: accumulate `amount` available by `due_month`
  - `refill`: top the category's available back up to `amount` each month
  amount (CAD minor), due_month (`YYYY-MM`, only for by_date).

Both ride the existing sync protocol (server migration, SyncTables rules,
Dexie v3 with indexes on category_id/month).

## Budget math (pure module `budgetMath.ts`)

Inputs: live accounts, transactions, assignments, rates. All amounts
converted to CAD.

- `onBudgetFunds` = Σ converted amounts of live transactions in live
  on-budget accounts (all time).
- `activity(C, M)` = Σ converted amounts of categorized live transactions
  (category C, month M) in on-budget accounts.
- `assigned(C, M)` = Σ assignment rows for (C, M).
- `available(C, M)` = Σ_{m ≤ M} [assigned(C, m) + activity(C, m)] — full
  carryover, including negatives.
- **Ready to Assign (global, not per-month)**:
  `RTA = onBudgetFunds − Σ_C [assignedAllMonths(C) + activityAllMonths(C)]`.
  Uncategorized income lands in RTA; assigning to any month (incl. future)
  reduces RTA; transfers between on-budget accounts cancel out.
- Problems: `RTA < 0` (over-assigned) and any `available(C, M) < 0` for the
  viewed month (overspent) are highlighted with a one-click fix path
  (move money).

## Repo methods

- `setAssignment(categoryId, month, amountMinor)` — upsert; amount 0
  tombstones the row.
- `moveMoney({fromCategoryId | null, toCategoryId | null, month, amountMinor})`
  — null side = Ready to Assign; adjusts one/two assignment rows atomically.
- `setTarget(categoryId, {type, amountMinor, dueMonth?})`, `clearTarget(categoryId)`.
- `autoAssign(month, categoryIds?)` — compute per-category need for the month
  (below), cap the total at max(0, RTA), assign in category sort order:
  - monthly: `max(0, amount − assigned(C, M))`
  - refill: `max(0, amount − availableBeforeThisMonthsAssignment)`
  - by_date: spread remaining shortfall evenly over months left through
    due_month: `max(0, ceil((amount − available(C, prevM)) / monthsLeft) − assigned(C, M))`

## UI: Plan view

New `plan` view in the shell (sidebar nav item "Plan", made the default
view). Month switcher (‹ month ›). Header: Ready to Assign (green/red) +
"Auto-assign" button (with target count). Table (desktop) / cards (mobile)
of category groups → categories: Assigned (inline MoneyInput, saves on
blur), Activity, Available (badge: green > 0, gray = 0, red < 0). Row
actions: target editor dialog; clicking an Available badge opens a
move-money dialog (from/to pickers defaulting to fix direction). Problem
banner at top when RTA < 0 or any available < 0, with jump-to-category.

## Testing

Vitest: budgetMath (funds/activity/available/RTA incl. multi-currency,
carryover, future assignments), setAssignment upsert/tombstone, moveMoney
both directions + RTA sides, autoAssign per target type + RTA cap.
Pest: sync round-trip + validation for both new tables.
