# Capital Market Assumptions (CMA) Integration Specification

## 1. Overview & Vision

The **Capital Market Assumptions (CMA) Integration** enhances the Retirement Planner application by anchoring both deterministic projections and Monte Carlo stochastic simulations to authoritative, forward-looking research published by premier institutional asset managers.

Rather than relying solely on backward-looking historical returns or unguided user inputs, users can select from curated annual institutional outlooks—specifically the **"Big Three"** global asset managers (**Vanguard**, **BlackRock**, **J.P. Morgan**) and an **Industry Consensus Benchmark**—or create, edit, and import custom CMA profiles.

### Core Objectives:
1. **Institutional Grounding:** Align simulated market trajectories with forward-looking 30-year secular expectations calibrated for today's market valuations, interest rate environment, and demographic realities.
2. **Mathematical Rigor (Volatility Drag Correction):** Accurately translate published geometric compound growth rates (CAGRs) into stochastic annual arithmetic drift parameters, preventing simulated median returns from suffering from artificial volatility drag.
3. **Macroeconomic Consistency:** Anchor forward inflation distributions to institutional expectations using zero-centered empirical shocks, preventing synthetic stagflation distortions.
4. **Single Source of Truth (SSOT):** Ensure a single configuration controls both deterministic baseline runs ("Flat" mode) and stochastic percentiles ("P10", "P50", "P90") across all application workspaces.
5. **Seamless Lifecycle & Persistence:** Support annual updates via JSON import/export, auto-forking to "Custom (Modified)" with clear visual deviation badges, and automatic cloud persistence in DynamoDB via `PlanSyncService`.

---

## 2. Institutional CMA Profiles & Data Schema

### 2.1 The "Big Three" + Consensus Curated Profiles (30-Year Secular Outlook)

The application ships with four pre-loaded, versioned profiles:

1. **Vanguard VCMM (30-Year Secular Outlook)**
   - *Philosophy:* Valuation-grounded (sensitive to current CAPE multiples), forecasting lower real equity returns over the intermediate term with mean-reversion over 30 years.
   - Equities Expected Geometric CAGR: `6.8%` | Volatility: `16.0%`
   - Fixed Income Expected Geometric CAGR: `4.6%` | Volatility: `5.5%`
   - Cash Yield / Money Market: `3.5%`
   - Expected CPI Inflation: `2.4%` | CPI Volatility: `1.8%`
   - Stock-Bond Correlation: `+0.15`

2. **BlackRock Investment Institute (BII Secular Outlook)**
   - *Philosophy:* Macro-thematic "New Regime", factoring in structural inflation pressures, large-scale AI capital expenditures, energy transition capex, and higher long-term bond yields from persistent sovereign debt deficits.
   - Equities Expected Geometric CAGR: `6.9%` | Volatility: `15.8%`
   - Fixed Income Expected Geometric CAGR: `4.7%` | Volatility: `5.7%`
   - Cash Yield / Money Market: `3.6%`
   - Expected CPI Inflation: `2.6%` | CPI Volatility: `1.9%`
   - Stock-Bond Correlation: `+0.18`

3. **J.P. Morgan LTCMA (30-Year Secular Edition)**
   - *Philosophy:* Multi-asset institutional benchmark built from building-block economic productivity, global corporate earnings margins, and central bank policy reaction functions.
   - Equities Expected Geometric CAGR: `7.2%` | Volatility: `15.5%`
   - Fixed Income Expected Geometric CAGR: `4.8%` | Volatility: `5.5%`
   - Cash Yield / Money Market: `3.5%`
   - Expected CPI Inflation: `2.5%` | CPI Volatility: `1.8%`
   - Stock-Bond Correlation: `+0.18`

4. **Industry Consensus Benchmark**
   - *Philosophy:* The balanced median of premier Wall Street research, providing a balanced, institution-neutral baseline.
   - Equities Expected Geometric CAGR: `7.0%` | Volatility: `15.5%`
   - Fixed Income Expected Geometric CAGR: `4.6%` | Volatility: `5.5%`
   - Cash Yield / Money Market: `3.5%`
   - Expected CPI Inflation: `2.5%` | CPI Volatility: `1.8%`
   - Stock-Bond Correlation: `+0.16`

---

### 2.2 Data Schema

```typescript
export interface CMAProfile {
  id: string; // e.g. 'vanguard-2026', 'blackrock-2026', 'jpmorgan-2026', 'consensus-2026', 'custom'
  name: string; // e.g. 'Vanguard VCMM'
  institution: string; // e.g. 'Vanguard Investment Strategy Group'
  editionYear: number; // e.g. 2026
  horizon: string; // e.g. '30-Year Secular'
  description?: string;
  sourceUrl?: string;
  isBuiltIn: boolean; // true for bundled, false for user-imported

  // Asset return parameters (Geometric CAGR)
  equityReturnRate: number;      // Stated 30-year geometric CAGR (e.g. 0.068 for 6.8%)
  equityVolatility: number;      // Annual standard deviation (e.g. 0.160 for 16.0%)
  fixedIncomeReturnRate: number; // Stated 30-year geometric CAGR (e.g. 0.046 for 4.6%)
  fixedIncomeVolatility: number; // Annual standard deviation (e.g. 0.055 for 5.5%)
  cashYieldRate: number;         // Money market / short-term cash yield (e.g. 0.035 for 3.5%)
  cpiInflationRate: number;      // Secular headline CPI expected rate (e.g. 0.024 for 2.4%)
  cpiVolatility?: number;        // Annual inflation standard deviation (default ~0.018)
  correlation: number;           // Stock-Bond correlation coefficient (e.g. 0.15)
}
```

---

## 3. Mathematical Foundations & Volatility Drag Correction

### 3.1 The Volatility Drag Adjustment

When an institution publishes an expected return of `g` (Geometric CAGR), an investor expects $10,000 to compound into `$10,000 * (1 + g)^T` after `T` years.

However, in discrete-time Monte Carlo simulations, annual returns `R_t` are drawn randomly with variance `sigma^2`. Due to the compounding of fluctuating percentages, the realized median compound growth rate of a simulated portfolio suffers from **volatility drag**:
```
Realized Median CAGR ≈ mu - (sigma^2 / 2)
```
where `mu` is the arithmetic mean of the distribution draws.

If an engine naively inputs the published CAGR `g` as `mu`, the simulation will systematically compound at:
```
Realized CAGR ≈ g - (sigma^2 / 2)
```
For stocks with `g = 7.0%` and `sigma = 16%`:
- Volatility Drag: `(0.16^2) / 2 = 0.0256 / 2 = 1.28% (128 basis points)`.
- Realized Median CAGR: `7.0% - 1.28% = 5.72%`.

#### The Engine Solution:
To ensure the simulated median matches the stated institutional expectation, the simulation engine calculates the **Arithmetic Distribution Drift (`mu`)**:
```
mu = g + (sigma^2 / 2)
```
- In the UI, the user configures or views the **Target CAGR (`g`)** (e.g., 7.0%).
- The engine internally evaluates `mu = 7.0% + 1.28% = 8.28%` for the annual random draws.
- In **Flat** mode, the engine uses the exact Target CAGR (`g`), guaranteeing that Flat projections and Monte Carlo median (P50) trajectories converge over long horizons.

---

### 3.2 Calibrated Forward Inflation Distribution (Zero-Centered Shocks)

To ensure inflation remains macroeconomically consistent with nominal returns without losing realistic fat-tailed shocks, the engine adopts **Zero-Centered Historical Shocks**:

1. Let `I_hist` be the historical annual inflation rate from the 1970–2025 dataset (mean = 4.0%).
2. For each historical year `t`, the empirical shock is:
   ```
   Shock_t = I_hist,t - Mean(I_hist)
   ```
3. When simulating annual inflation for a trial year:
   ```
   Simulated_CPI = Clamp(CMA_Target_CPI + Shock_t, INFLATION_RATE_MIN, INFLATION_RATE_MAX)
   ```
4. In crisis / stagflation states within the Markov regime-switching generator, stagflation shocks (1973, 1974, 1980, 2022) are added directly to `CMA_Target_CPI`.

This preserves real-world clustering, fat tails, and historical crises while centering long-term purchasing power decay exactly on the institution's forecast.

---

## 4. Single Source of Truth (SSOT) State Architecture

### 4.1 State Structure in `AppStateInputs`

All CMA-related state is integrated into `AppStateInputs`:

```typescript
export interface MonteCarloSettings {
  mode: 'monte-carlo' | 'historical';
  equityVolatility: number;
  fixedIncomeVolatility: number;
  correlation: number;
  trials: number;
  seed: number | null;
  nonce?: number;
  stressTest?: StressTestConfig;
  randomizeCPI?: boolean;
  constantCPIRate?: number | null;
  enableRegimeSwitching?: boolean;
  historicalSamplingStrategy?: 'hybrid' | 'block' | 'random';
  calibrateHistoricalMeans?: boolean;

  // New CMA Fields:
  activeCmaProfileId: string; // e.g. 'vanguard-2026' or 'custom'
  baseCmaProfileId?: string | null; // Tracks parent preset if modified (e.g. 'vanguard-2026')
  customCmaProfiles: CMAProfile[]; // User imported/created profiles
}
```

### 4.2 Parameter Synchronization Flow
1. **Selecting a Preset:**
   When the user selects a preset (e.g. `vanguard-2026`):
   - `growthAssumptions.equityReturnRate` ← Preset `equityReturnRate`
   - `growthAssumptions.fixedIncomeReturnRate` ← Preset `fixedIncomeReturnRate`
   - `growthAssumptions.cashYieldRate` ← Preset `cashYieldRate`
   - `growthAssumptions.cpiInflationRate` ← Preset `cpiInflationRate`
   - `monteCarloSettings.equityVolatility` ← Preset `equityVolatility`
   - `monteCarloSettings.fixedIncomeVolatility` ← Preset `fixedIncomeVolatility`
   - `monteCarloSettings.correlation` ← Preset `correlation`
   - `monteCarloSettings.activeCmaProfileId` ← `vanguard-2026`
   - `monteCarloSettings.baseCmaProfileId` ← `vanguard-2026`

2. **Global Scenario Propagation:**
   - In **Flat** mode: `parallelLedgers.flat` uses these exact rates deterministically.
   - In **P10 / P50 / P90** modes: `parallelLedgers[globalScenario]` runs the stochastic sequences derived from these same parameters.
   - All workspaces (Main Dashboard, Plan, Cash Flow, Tax, Roth Optimizer, Actuals) automatically reflect the active scenario ledger.

---

## 5. User Overrides & Auto-Forking UX

### 5.1 Auto-Forking Behavior
If a user selects an institutional preset (e.g., `Vanguard 2026`) and adjusts any slider or input:
1. `activeCmaProfileId` immediately switches to `'custom'`.
2. `baseCmaProfileId` remains `'vanguard-2026'`.
3. The UI displays an informative status banner:
   `"Custom Portfolio (Modified from Vanguard VCMM 2026)"` with a **"Reset to Original Preset"** button.

### 5.2 Delta Indicators & Visual Diff Badges
For each parameter slider in the Monte Carlo Workspace:
- If the current value matches the baseline profile, display the value normally.
- If the current value deviates from the baseline profile:
  - Display a distinct deviation badge: e.g., `7.5% (was 6.8%, +0.7%)`.
  - Provide a subtle inline reset icon (`Undo` / `Snap Back`) next to the slider to revert only that specific parameter back to its preset value.

---

## 6. Data Persistence, Versioning & Annual Import/Export

### 6.1 Cloud Persistence via `PlanSyncService`
Because `customCmaProfiles`, `activeCmaProfileId`, and `baseCmaProfileId` reside within `AppStateInputs.monteCarloSettings`:
- Any imported profile or active selection is automatically serialized into `RemotePlanDocument`.
- [`PlanSyncService.scheduleAutoSave`](file:///home/mpetronic/repos/retirement-planner/src/shared/storage/PlanSyncService.ts#L65) writes the payload to DynamoDB.
- When opening the application on another device or reloading the SPA from S3, all imported profiles and active selections are restored seamlessly.

### 6.2 JSON Import / Export Specification
- **Exporting:** Users can click **"Export CMA Profile"** to download a clean `.json` file of any active or custom profile.
- **Importing:** Users can click **"Import CMA Profile"** to select a JSON file or paste JSON text into a modal.
- **Schema Validation:** The importer verifies:
  - Valid string identifiers and names.
  - Return rates clamped within `[-0.10, +0.30]`.
  - Volatilities clamped within `[0.01, +0.50]`.
  - Correlations clamped within `[-0.90, +0.90]`.
- Upon successful validation, the profile is prepended to `monteCarloSettings.customCmaProfiles`, saved to DynamoDB, and selected as the active profile.

---

## 7. Monte Carlo Workspace UI Layout

The CMA controls are completely self-contained within the **Monte Carlo Workspace**, placed at the top of the parameter controls:

```
+----------------------------------------------------------------------------------------------------+
| Capital Market Assumptions (CMA)                                                                   |
| Ground forward projections in forward-looking 30-year institutional research                       |
+----------------------------------------------------------------------------------------------------+
|  [ Active Profile Dropdown: Vanguard VCMM (2026 Secular) v ]   [ + Import JSON ]  [ Down Export ]  |
|                                                                                                    |
|  * Status: Modified from Vanguard VCMM 2026                     [ Reset All to Vanguard Defaults ] |
|  * Source: Vanguard Investment Strategy Group (December 2025) [External Link]                      |
+----------------------------------------------------------------------------------------------------+
| Asset Return & Volatility Parameters                                                               |
|                                                                                                    |
| [ Equities Target CAGR: 7.5% ]                  [ Equity Volatility: 16.0% ]                       |
|   Delta: was 6.8% (+0.7%) [Reset]                  Matches Preset                                  |
|   Internal Drift (mu): 8.78% (drag-adjusted)                                                       |
|                                                                                                    |
| [ Fixed Income Target CAGR: 4.6% ]              [ Fixed Income Volatility: 5.5% ]                  |
|   Matches Preset                                   Matches Preset                                  |
|                                                                                                    |
| [ Cash Yield Rate: 3.5% ]                       [ Stock-Bond Correlation: +0.15 ]                  |
|                                                                                                    |
| [ Secular CPI Inflation: 2.4% ]                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 8. Backward Compatibility & Migration Strategy

1. **Existing Plans:** For plans loaded from local storage or DynamoDB that lack `activeCmaProfileId`:
   - `activeCmaProfileId` initializes to `'custom'`.
   - `baseCmaProfileId` initializes to `null`.
   - `customCmaProfiles` initializes to `[]`.
   - Existing values of `growthAssumptions` and `monteCarloSettings` are preserved 100% without modification.
2. **Deterministic Baseline Integrity:** Users who prefer to work exclusively with manual flat returns experience zero disruption; their manual numbers operate identically in Flat mode as they do today.

---

## 9. Implementation Plan & Milestones

### Milestone 1: Core Types & Curated CMA Registry
- Define `CMAProfile` and updated `MonteCarloSettings` in `src/types/index.ts`.
- Create `src/constants/cmaProfiles.ts` housing the Big Three + Consensus bundled profiles and helper functions (`getCmaProfile`, `isProfileModified`).

### Milestone 2: Engine Volatility Drag & Inflation Calibration
- Update `src/engine/monteCarloEngine.ts` to compute arithmetic drift from target geometric CAGRs: `mu = g + (sigma^2 / 2)`.
- Update `generateSyntheticSequence` and `generateHistoricalSequence` to use zero-centered inflation shocks anchored to target CPI.
- Add comprehensive engine unit tests verifying median trajectory alignment and inflation distribution properties.

### Milestone 3: Monte Carlo Workspace UI & Auto-Forking
- Build the CMA Profile selector header in `src/components/MonteCarloWorkspace.tsx`.
- Implement deviation detection with delta badges and single-parameter snap-back buttons.
- Connect preset selection to update `growthAssumptions` and `monteCarloSettings` synchronously.

### Milestone 4: Import / Export Modal & PlanSyncService Integration
- Implement the JSON file import and export dialog with schema validation.
- Verify automatic serialization and persistence to DynamoDB via `PlanSyncService`.

### Milestone 5: Verification & End-to-End Testing
- Validate Flat vs P50 convergence in long-term simulations.
- Verify full test suite and run linter clean.
