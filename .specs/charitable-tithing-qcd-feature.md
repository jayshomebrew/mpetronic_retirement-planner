# Charitable Giving & Tithe Engine (with QCD) Requirements Specification

## 1. Executive Summary & Intent
This feature introduces a configurable **Charitable Giving & Tithe Engine** to the retirement planner. It enables users to tithe a configurable percentage (default 10%) of their **annual portfolio growth** (since contributions have already been tithed). It features a tax-optimized funding waterfall that utilizes **Qualified Charitable Distributions (QCDs)** starting at age 70.5 directly from Traditional IRAs to satisfy required minimum distributions (RMDs) tax-free and reduce Medicare IRMAA tiers.

---

## 2. Core Specifications & Grilling Decisions

### 2.1 Growth Calculation
- **Asset Scope**: All liquid portfolio accounts:
  - Primary & Spouse Pre-Tax IRAs
  - Primary & Spouse Roth IRAs
  - Primary & Spouse Taxable Brokerage accounts
  - Primary & Spouse Cash accounts
- **Formula**:
  `Annual Portfolio Growth = (PreTax Growth + Roth Growth + Taxable Capital Growth + Dividends + Cash Interest)`
- **Negative / Flat Market Years**:
  - Floored at `$0`. If annual portfolio growth is zero or negative, the calculated tithe from growth is `$0` (no negative carryforward or loss recovery requirements).

### 2.2 Charitable Engine Configuration (`CharitySettings`)
```typescript
export interface CharitySettings {
  enabled: boolean;                      // Toggle charity / tithing engine on/off
  growthPercentage: number;              // Percentage of annual growth to tithe (e.g., 0.10 for 10%)
  minAnnualTithe: number | null;         // Optional annual dollar floor (even if growth is 0)
  maxAnnualTithe: number | null;         // Optional annual dollar cap
  useQCD: boolean;                       // Enable QCD optimization starting at age 70.5 (default true)
}
```

### 2.3 Tax-Optimized Sourcing Waterfall & QCD Mechanics
1. **At Age 70.5+ (QCD Eligible)**:
   - For an individual turning 70.5 (month 6 of the year they turn 70), Traditional IRA distributions can be made directly to qualified 501(c)(3) charities as QCDs.
   - **QCD Statutory Limit**: Baseline $105,000/year per person (indexed for inflation via CPI).
   - **Execution Order**:
     1. Primary spouse Traditional IRA up to statutory cap and available IRA balance.
     2. If primary is under 70.5 or IRA balance/cap is reached, secondary spouse Traditional IRA (if spouse age >= 70.5) up to their statutory cap and IRA balance.
   - **RMD Offset**: QCDs satisfy statutory RMD obligations dollar-for-dollar without triggering taxable ordinary income.
   - **Income Tax & IRMAA Benefits**: QCD distributions are completely excluded from Gross Income / AGI / MAGI, reducing ordinary income tax brackets, state taxes, Social Security provisional income taxation, and 2-year lookback Medicare IRMAA surcharges.
2. **Prior to Age 70.5 or Overflow beyond QCDs**:
   - Funded first from Cash assets, then Taxable Brokerage assets.
   - **Tax Deductions**: The engine automatically compares `Standard Deduction` vs `Itemized Deductions (SALT up to $10k cap + Non-QCD charitable cash gifts)` and selects whichever provides greater tax savings.

### 2.4 UI & Dashboard Visibility
- **Input Sidebar**: Dedicated "Charitable Tithe & QCD" control section with interactive sliders, inputs, and real-time calculation preview.
- **Ledger Table**: Added columns:
  - `Portfolio Growth ($)`: Total dollar return across accounts.
  - `Charitable Tithe ($)`: Total calculated annual charitable gift.
  - `QCD Amount ($)`: Portion executed as tax-free QCDs from Traditional IRAs.
  - `Non-QCD Outflow ($)`: Portion funded from Cash / Taxable Brokerage.
- **Sankey Diagram**: Added dedicated "Charitable Tithe (QCD & Cash)" outflow node.
- **KPI Summary Card**: Lifetime Total Giving, Lifetime QCDs, and Lifetime Estimated Tax Savings from QCDs.
- **PDF & Excel Exports**: Included in simulation ledger sheets, configuration summary, and itemized exports.
