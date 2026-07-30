# Phase 4: Analytics — Design

Date: 2026-07-30
Status: Approved (autonomous, per delegated review)

All figures in CAD (latest-rate conversion, same convention as planning).
Charts are hand-rolled inline SVG (no new dependencies), themed for light and
dark, palette validated with the dataviz checks: `#3b82f6` (primary series) and
`#d97706` (secondary series).

## Pure module `analytics.ts`

Shared filters: live transactions in live accounts; "internal transfers"
(both legs in live on-budget accounts) are excluded from cash-flow numbers;
every amount converted to CAD.

- `spendingByMonth(months, inputs)` — per month: total spending (positive
  number = money out, from categorized + uncategorized non-internal outflows
  in on-budget accounts) and per-category net outflow map.
- `incomeVsSpending(months, inputs)` — per month `{incomeMinor, spendingMinor}`
  from non-internal on-budget transactions (income = positive sum, spending =
  |negative sum|).
- `netWorthSeries(months, inputs)` — cumulative balance of ALL live accounts
  (on- and off-budget) converted, at each month end.
- `monthRange(endMonth, count)` — helper producing the last N months.

## UI: Analytics view

New `analytics` view (sidebar item "Analytics", chart icon). Range picker
(6/12/24 months) + tabs:

1. **Spending** — vertical bar chart of monthly spending (single hue, hover
   tooltip, click selects month) + breakdown for the selected month (or whole
   range): category groups with horizontal magnitude bars, expandable into
   categories. Doubles as the accessible table view.
2. **Cash flow** — grouped bars income vs spending per month (two validated
   hues, legend), plus a compact monthly table (income, spending, net).
3. **Net worth** — line+area chart of month-end net worth with hover
   crosshair, plus a compact monthly table.

Chart components (`charts/` folder): `BarChart.vue`, `GroupedBarChart.vue`,
`LineChart.vue` — thin marks, rounded data ends, 2px gaps, recessive axes,
HTML tooltip layer, `currentColor`-based text so themes just work.

## Testing

Vitest for analytics.ts: internal-transfer exclusion, multi-currency
conversion, month bucketing, net worth cumulative math incl. off-budget
accounts, month range helper. Chart components stay logic-free (data in →
svg out), no component tests.
