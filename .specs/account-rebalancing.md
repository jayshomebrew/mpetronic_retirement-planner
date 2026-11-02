# Account Rebalancing Workspace Specification

## 1. Overview

The **Account Rebalancing** workspace helps keep each IRA and brokerage account at its target fund
allocation. For each account the user defines a template: the funds held, a target percent for each,
and a single symmetric threshold. Periodically the user opens a worksheet, enters the current dollar
value of every fund, and the workspace shows whether the account needs rebalancing and exactly which
dollar amounts to sell and buy. The amounts are meant to be copied straight into the Fidelity trade
wizard.

Scope:
- Planner app only. The Expenser PWA is not involved.
- Mutual funds only, traded in dollars. No share counts, prices, or market data lookups.
- Account data is real household data, stored separately from the saved plan.

## 2. Navigation

- Sidebar group: **Workspaces**, directly below Bucket Management.
- Nav id: `rebalancing`. Label: "Account Rebalancing". Short label: "Rebalance". Description:
  "Fund targets & rebalance trades".
- Page header title: "Account Rebalancing".
- Icon: lucide-react, not the `Scale` icon (already used for Tax Filing Status).

## 3. Data Model

### 3.1 Owner and account type
- `owner`: `primary` | `spouse` | `joint`. Display names come from the plan's two profiles
  (`you.name`, `wife.name`, falling back to "Primary" / "Spouse") plus the literal "Joint".
  The stable role is stored, never the display name.
- `accountType`: `Rollover IRA` | `Roth IRA` | `Brokerage`.
- Account name is derived: `<owner display name> <account type>`, for example "Mark Rollover IRA".
  The pair (owner, accountType) must be unique among non-archived accounts. This means one account
  of each type per owner.

### 3.2 Account template
- `accountId` (generated), `owner`, `accountType`
- `thresholdPoints`: one number, absolute percentage points, applied symmetrically to every fund
- `funds`: ordered list of `{ symbol, targetPercent, isCash? }`, with at most one `isCash`
- `archived`: boolean
- `createdAt`, `updatedAt`

### 3.3 Snapshot
A snapshot is immutable except for the `executed` flag.
- `snapshotId`, `accountId`, `savedAt`
- Frozen copy of the template at save time: owner, owner display name, account type, account name,
  threshold, funds with targets
- `values`: dollar value entered per symbol
- Computed result: total, per-fund percent / deviation / status, account status, trades, and the exchange/buy/sell instructions (absent on snapshots saved before exchanges existed; history then shows only the per-fund trades)
- `note` (optional free text), `executed` (boolean, toggleable after saving)

## 4. Validation

Template (Save is blocked until valid):
- At least two funds. At most one fund is marked as the cash fund.
- Target percents sum to exactly 100.00, each between 0 and 100, precision 0.01.
- Symbols are trimmed and uppercased. Duplicates within a template are rejected. Symbols are not
  validated against any external fund list.
- Threshold above 0 and at most 50 percentage points. Default 5.
- Owner + account type unique among non-archived accounts.
- A running total of the targets is shown while editing.

Worksheet:
- Every fund needs a value. Zero is allowed. Negative and non-numeric values are rejected.
  Commas and dollar signs are tolerated.
- If the total is zero, show "Enter at least one value" and no results.
- Results update live as values change. Nothing is saved until the user clicks Save.
- The worksheet always opens blank. The most recent snapshot is shown only as a read-only reference.

## 5. Calculation Rules

All percentages are computed over the sum of the entered values (all holdings, including cash such as
SPAXX, are template funds).

1. `currentPercent = value / total * 100`
2. `deviation = currentPercent - targetPercent` (percentage points)
3. Fund status:
   - `HIGH` if `deviation > thresholdPoints`
   - `LOW` if `deviation < -thresholdPoints`
   - `IN_BAND` otherwise. A fund exactly on the edge is in band.
4. Account status:
   - `NEEDED` if any fund is HIGH or LOW
   - `OPTIONAL` if every fund is IN_BAND
5. Rebalance is always a full rebalance of every fund to its target, regardless of trade size:
   - `targetValue = total * targetPercent / 100`
   - `tradeAmount = targetValue - value` (positive = buy, negative = sell)
6. Rounding: each trade is rounded to the cent. Any residual so buys and sells net to exactly zero is
   applied to the largest trade in absolute value, and the totals line states that this was done.
7. A fund whose rounded trade is zero is shown as "No trade".

Worked example from the original request: A target 50, B target 25, C target 25, threshold 5.
Current A 65, B 30, C 5 (percent of account). A is +15 (HIGH), B is +5 (in band, exactly on the edge),
C is -20 (LOW). Account status is NEEDED. Trades: sell 15 points of A, sell 5 points of B, buy
20 points of C.

### 5.1 Exchanges and cash

All funds are mutual funds, so money can move between two funds with a Fidelity **exchange** instead of
a separate sell and buy. The per-fund trades from section 5 are turned into instructions:

- A template can mark at most one fund as its **cash fund** (a checkbox on the fund row, for example
  on SPAXX). No symbol is treated as cash by name; the app stays custodian-neutral. The cash fund is
  never exchanged. Money moves in and out of it with an ordinary buy or sell. A template with no cash
  fund pairs everything by exchange.
- **Excess cash** (cash fund above target) is spent first. Each instruction is a **Buy** into the fund
  with the largest remaining need, spilling into the next-largest need if the cash exceeds it.
- The remaining sells are paired with the remaining buys as **Exchanges**, largest sell into largest buy.
- Any sell left over after that is proceeds the under-target cash fund needs, and is a plain **Sell**
  into cash.
- Order shown: cash buys, then exchanges, then sells into cash. Amounts are exact to the cent and the
  instructions move the same dollars the per-fund trades require.
- Example: A sells $150,000 and B sells $50,000 to fund C, with no cash fund: exchange A to C $150,000
  and exchange B to C $50,000.
- No per-fund eligibility setting for now: every non-cash fund is assumed exchangeable.

## 6. User Interface

### 6.1 Overview (landing view)
- A "New account" button.
- A row per non-archived account: account name, last snapshot date, status from that snapshot labeled
  "as of <date>" (never presented as live), executed marker, **Open worksheet**, **Edit template**.
- No reminder or staleness logic.

### 6.2 Template editor
- Owner dropdown, account type dropdown, threshold input, editable fund table (symbol, target
  percent), running target total, Save and Cancel.
- Archive action with a confirmation. Archived accounts are hidden from the overview but their
  snapshots remain readable. A hard delete is a separate confirmed action that also removes the
  account's snapshots.

### 6.3 Worksheet
- One dollar input per fund (no bulk paste).
- Results table: symbol, current value, current percent, target percent, deviation, status badge.
- Account banner with a clear indicator:
  - **Rebalance needed** (prominent, warning color) when status is NEEDED
  - **Optional** (neutral/informational) when status is OPTIONAL, with the message "Within
    thresholds, no rebalance needed"
- Trades list, sells first then buys. Each row shows Sell/Buy, dollar amount, and percentage points of
  the account. Each has a copy button that copies a plain number such as `12345.67` with no dollar
  sign or commas. Funds already at target show "No trade".
- In OPTIONAL state the trades are hidden behind a "View trades anyway" toggle.
- Totals line: total sells, total buys, rounding residual note if any.
- Save snapshot with an optional note.
- Link to snapshot history, and a read-only reference to the most recent snapshot.

### 6.4 Snapshot history
- List per account: date, status, executed flag, note.
- Read-only view of the frozen template, values, and trades.
- Toggle the executed flag. Delete with a confirmation. No editing of any other field.

## 7. Storage

### 7.1 Client
- A dedicated storage interface for rebalancing data, separate from the expense `StorageAdapter`
  and separate from the plan document.
- Local implementation: its own IndexedDB database (does not touch the expense database version).
- Cloud implementation: wraps the local one and calls the API when authenticated and online,
  following the same selection rule as `getStorageAdapter` (localhost = local only).
- Snapshots and templates are written locally first, then pushed to the API.

### 7.2 Cloud (retirement-planner-cdk)
New items in the existing single-table design, partition `HOUSEHOLD#<householdId>`:
- Template: `SK = REBAL_ACCOUNT#<accountId>`, `entityType = REBAL_ACCOUNT`
- Snapshot: `SK = REBAL_SNAPSHOT#<accountId>#<snapshotId>`, `entityType = REBAL_SNAPSHOT`

New Lambda `rebalancing.ts` and routes (Cognito authorizer, same as the others):
- `GET /api/rebalancing/accounts`, `POST /api/rebalancing/accounts`
- `DELETE /api/rebalancing/accounts/{id}` (hard delete, also removes that account's snapshots)
- `GET /api/rebalancing/snapshots` (all, or `?accountId=`), `POST /api/rebalancing/snapshots`
- `DELETE /api/rebalancing/snapshots/{id}` (needs `accountId` query parameter)

### 7.3 Household archive
- `FullHouseholdArchive` gains optional `rebalancingAccounts` and `rebalancingSnapshots`.
- The local and cloud export paths include them. The cloud `export.ts` adds them to its response.
- Import: an account whose (owner, accountType) already exists among non-archived accounts is skipped
  and reported, along with its snapshots. Existing data is never overwritten.
- The saved plan file does not include any of this data.

## 8. Code Standards

- No magic numbers. Named constants for the 100% target sum, tolerance for the sum check, threshold
  minimum, maximum and default, and the cents scale.
- The calculation lives in a pure engine module under `src/engine/` with unit tests, including the
  worked example above, edge-of-band behavior, rounding residual, and zero totals.
- Run the linter after code changes.
