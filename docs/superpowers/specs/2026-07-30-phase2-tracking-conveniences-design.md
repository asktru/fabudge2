# Phase 2: Tracking Conveniences — Design

Date: 2026-07-30
Status: Approved (autonomous, per delegated review)

Builds on phase 1. Three features: payee→category suggestion, split
transactions, and balance reconciliation.

## 1. Payee → category suggestion

When a payee is chosen in the transaction form and no category is set yet,
prefill the category from the most recent live transaction with that payee
that has a category (by date, then updated_at). Pure function
`suggestCategory(payeeId, transactions): string | null` in
`resources/js/budget/suggestions.ts`; wired into `TransactionFormDialog` on
payee select. The user can always override; suggestion never overwrites an
explicit choice.

## 2. Split transactions

One real-world purchase split across categories, stored as N ordinary
transaction rows sharing a `split_group_id` (UUID) — same account, date,
payee, cleared status; each row has its own category and amount; amounts sum
to the real total.

- Schema: nullable `split_group_id` column on `transactions` (server
  migration + sync validation + wire field; Dexie schema v2 with index).
  A transaction cannot be both a transfer leg and a split member.
- Repo: `createSplit({account_id, date, payeeName|payee_id, memo, cleared,
  lines: [{category_id, amountMinor}]})` writes all rows atomically (≥2
  lines, all amounts same sign not required, but no zero lines);
  `updateSplitGroup(groupId, patch)` propagates shared fields (date, payee,
  memo, cleared) to all members; `deleteTransaction` on a member tombstones
  the whole group.
- Register: members collapse into one visual row — total amount, "Split (n)"
  as category, expandable chevron showing per-line category/amount. Editing
  opens the form in split mode with editable lines (add/remove/change,
  must stay ≥1 line; single remaining line converts the row back to a plain
  transaction by clearing `split_group_id`).
- Form: "Split" toggle switches the single category+amount into a lines
  editor; the running remainder is shown; save requires remainder = 0.
- Cleared: toggling any collapsed row toggles every member together.

## 3. Balance reconciliation

Register-level flow for one account:

1. "Reconcile" button → input: the account's actual current balance
   (cleared money, from the bank).
2. Banner shows: app cleared balance, entered actual balance, difference.
   Live-updates while the user clears/unclears/edits/adds transactions.
3. "Finish reconciliation": if a difference remains, create an adjustment
   transaction (payee "Reconciliation adjustment", no category, amount =
   difference, cleared) dated today. Then every `cleared` transaction in the
   account becomes `reconciled`. Reconciled rows lock their cleared toggle
   (already in phase 1 UI).
- Repo: `finishReconciliation(accountId, actualClearedMinor)` — atomic;
  returns the adjustment (or null). Difference = actual − current cleared
  balance at finish time.
- Cancel exits the mode with no changes.

## Testing

- Vitest: suggestCategory recency logic; createSplit atomicity + sum
  invariants + collapse grouping helper; updateSplitGroup propagation;
  group tombstone; finishReconciliation (no diff → no adjustment; diff →
  adjustment row; cleared→reconciled transition; uncleared rows untouched).
- Pest: sync accepts/validates `split_group_id` (round-trips through
  push/pull).
- Register grouping display logic extracted into a pure helper
  (`groupRegisterRows`) and unit tested.
