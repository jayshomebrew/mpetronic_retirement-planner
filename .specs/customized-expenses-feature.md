# Goal

Make the Detailed Living Expenses Configuration fully configurable. The line items were previously hardcoded to a specific personal scenario; this feature makes categories and line items completely customizable so any user can adapt the living expenses model to their own retirement scenario.


# Finalized Requirements & Specifications

### 1. Data Model & Plan Scope
- **Plan-Scoped Catalog:** The catalog of expense definitions (categories, line items, default frequencies, descriptions, and one-time flags) is stored directly inside `AppStateInputs` / `SavedPlan`.
- **Self-Contained Portability:** Exporting a plan to JSON or switching saved comparison plans preserves each plan's custom line items and categories without cross-plan contamination or orphaned state values.
- **Item Identification:** Each line item has an immutable unique identifier (`id`). Renaming an item or category never breaks or resets entered dollar amounts across states.
- **Data Model Structure:**
  - `ExpenseItemDefinition`: `{ id: string; name: string; category: string; description?: string; defaultFrequency: number; isOneTime?: boolean; }`
  - `ExpenseCatalog`: `{ categories: string[]; items: ExpenseItemDefinition[]; }`
  - `DetailedExpensesState`: `{ catalog: ExpenseCatalog; costs: { [stateCode: string]: Record<string, number> }; frequencies: Record<string, number>; }` (with backward compatibility mapping for `MD`, `FL`).

### 2. UI Layout & Navigation Workflow
- **Unified Two-Tab Modal:** Detailed Living Expenses dialog provides two dedicated tabs:
  - **Tab 1 ("State Expenses & Comparison"):** Side-by-side comparison table for the active jurisdiction states (e.g., Maryland vs. Florida), showing category groupings, subtotals, frequency controls, monthly amortized totals, and one-time totals.
  - **Tab 2 ("Categories & Line Items Catalog"):** Dedicated management interface to add, edit, rename, and delete categories and line items, customize descriptions, set default frequencies, and toggle one-time flags.
- **Inline Quick Add:** Tab 1 includes a quick `+ Add Item` shortcut to define and append a new line item without having to leave the data entry table.
- **Immediate UI Reactivity:** All additions, deletions, or cost changes immediately update dynamic subtotals, monthly amortized living expense rollups, and the main dashboard.

### 3. State Comparison, Presets & Cloning
- **Jurisdiction Sync:** The comparison table automatically displays the active `currentState` and `targetState` defined in the jurisdiction sidebar.
- **Template Presets:** Users can load predefined templates per state (e.g., *Default Maryland*, *Florida The Villages*, *Clean Slate / Blank*).
- **State Cloning:** A *"Copy from State A to State B"* action enables instantly copying all item amounts from one state to another as a quick starting baseline.

### 4. Frequency Controls
- **Shared Cadence Column:** A single `Freq/Yr` column is displayed in the comparison table, maintaining a clean 4-column layout (`Expense Name | Freq/Yr | State A Cost | State B Cost`).
- **Smart Presets & Custom Input:** Supports one-click selection of common frequencies (Monthly [12], Annually [1], Quarterly [4], Semi-Annually [2], Bi-Weekly [26]) while allowing any custom integer (1–365).

### 5. Categories & One-Time Costs
- **Dynamic Categories:** Users can use default categories (Housing, Transportation, Living, Insurance, Leisure, Charities) or create custom categories.
- **Category Subtotals:** Each category dynamically computes annualized and monthly subtotals for both states.
- **Safe Category Deletion:** Attempting to delete a category containing line items prompts the user to either reassign the items to another category or confirm bulk deletion.
- **Dedicated One-Time Section:** One-time setup costs are visually distinguished in a dedicated amber section with its own subtotal. One-time items are excluded from the recurring monthly burn rate, but are accounted for in Year 1 / Relocation Year capital drawdowns in the simulation engine.

### 6. Validation & UX Details
- **Duplicate Prevention:** Case-insensitive duplicate name validation prevents creating multiple expense items with the same name.
- **Description Tooltips:** Item descriptions are displayed via clean hover icons (`ℹ`) next to the expense name in the table to keep the UI scannable.

### 7. Downstream Systems (Simulation, Migration & Exports)
- **Backward Compatibility & Auto-Migration:** Legacy `detailedExpenses` data from saved plans or local storage is automatically migrated to the new catalog format with 100% data fidelity.
- **Simulation Engine:** `simulationEngine.ts` dynamically rolls up recurring expenses by iterating over all active catalog items, and applies one-time costs at retirement start (`simStartYear`) or relocation (`relocationYear`).
- **PDF & Excel Exports:** `ConfigurationPDF.tsx` and `excelExport.ts` dynamically group expenses by custom category, rendering line items, frequencies, state costs, and subtotals.
