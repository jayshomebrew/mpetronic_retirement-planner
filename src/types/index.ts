export interface StateHealthcareConfig {
  pre65MedicalPremium: number | null;
  pre65MedicalOOP: number | null;

  pre65DentalPremium: number | null;
  pre65DentalOOP: number | null;

  pre65VisionPremium: number | null;
  pre65VisionOOP: number | null;

  medicarePartDPremium: number | null;
  medicarePartDDeductibleCopays: number | null;
  supplementPremium: number | null;
  supplementOOP: number | null;
  post65HearingCare: number | null;

  post65DentalPremium: number | null;
  post65DentalOOP: number | null;

  post65VisionPremium: number | null;
  post65VisionOOP: number | null;
}

export interface HealthcareConfig {
  medicarePartBPremium: number | null;
  fileSSA44LifeChangingEvent?: boolean; // Form SSA-44 Life-Changing Event (Work Stoppage / Wage Reduction)
  medicareStartMode?: 'age65' | 'customDate'; // 'age65' (default) or 'customDate'
  medicareStartDate?: string | null; // YYYY-MM-DD or YYYY-MM when customDate mode is chosen
  coveredByWorkingSpousePlan?: boolean; // Under-65 spouse covered under working spouse's employer health plan until primary retires
  MD: StateHealthcareConfig;
  FL: StateHealthcareConfig;
}

export interface SpouseProfile {
  name?: string; // Customizable display name
  birthDate: string; // YYYY-MM-DD
  estimatedPIA: number | null; // Primary Insurance Amount at Full Retirement Age (FRA)
  targetSSClaimingAge: number | null; // Claiming age (62 to 70)
  plannedRetirementAge?: number | null; // Planned retirement age (55 to 75)
  plannedRetirementMonth?: number | null; // 1-12: month within retirement year (null = use birth month)
  activeSalary?: number | null; // Pre-retirement annual active salary
  preMedicareMonthlyPremium?: number | null; // Pre-Medicare monthly premium (e.g. $800)
  healthcare?: HealthcareConfig;
  longevityAge?: number | null; // Configurable projected death age
}

export interface PortfolioBalances {
  yourPreTaxIRA: number | null;
  yourRothIRA: number | null;
  yourTaxableBrokerage: number | null;
  yourTaxableBasis: number | null;
  yourCash?: number | null;
  wifePreTaxIRA: number | null;
  wifeRothIRA: number | null;
  wifeTaxableBrokerage: number | null;
  wifeTaxableBasis: number | null;
  wifeCash?: number | null;
  taxableDividendYield?: number | null;
  taxableNonQualifiedPortion?: number | null;
}


export interface LockedReturnSequence {
  id: string; // Unique timestamp or ID of the sequence
  mode: 'monte-carlo' | 'historical';
  equityReturns: number[]; // Array of 35 rates (2026 to 2060)
  fixedIncomeReturns: number[]; // Array of 35 rates (2026 to 2060)
  inflationRates?: number[]; // Array of 35 inflation rates (2026 to 2060)
}

export interface StressTestYearOverride {
  year: number;            // e.g. 2028 (2026 to 2060)
  equityReturn: number;    // e.g. -0.25 (-25%)
  fixedIncomeReturn: number; // e.g. -0.05 (-5%)
}

export interface StressTestConfig {
  enabled: boolean;
  mode: 'absolute' | 'relative'; // 'absolute' fixed rate vs 'relative' shock delta offset
  overrides: StressTestYearOverride[];
}

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

export interface MonteCarloSettings {
  mode: 'monte-carlo' | 'historical';
  equityVolatility: number;      // e.g. 0.15 (15%)
  fixedIncomeVolatility: number; // e.g. 0.05 (5%)
  correlation: number;           // e.g. 0.15
  trials: number;                // e.g. 1000
  seed: number | null;           // Null for standard random, integer for deterministic reproducibility
  nonce?: number;                // Incremental counter to regenerate standard random sequences
  stressTest?: StressTestConfig; // Optional multi-year sequence of returns stress test config
  randomizeCPI?: boolean;        // If true (default), randomize annual CPI per trial; if false, hold constant
  constantCPIRate?: number | null; // Optional custom constant CPI rate if held constant (e.g. 0.025)
  enableRegimeSwitching?: boolean; // If true (default), apply Markov 2-state regime switching and Ornstein-Uhlenbeck mean reversion
  historicalSamplingStrategy?: 'hybrid' | 'block' | 'random'; // Historical bootstrap strategy (hybrid: 35% block / 65% random, block: 100% contiguous, random: 100% random resampled)
  calibrateHistoricalMeans?: boolean; // If true (default), calibrate historical return shocks to match user configured baseline means (e.g. 7% equity / 4% bond)
  enableHistoricalStudentT?: boolean; // If true, apply Student-t fat-tail scaling (df=5) to historical bootstrap shocks. Only applicable in historical mode (not CMA/synthetic).
  activeCmaProfileId?: string;   // e.g. 'vanguard-2026', 'consensus-2026', or 'custom'
  baseCmaProfileId?: string | null; // Tracks parent preset if modified (e.g. 'vanguard-2026')
  customCmaProfiles?: CMAProfile[]; // User imported/created profiles
}

export interface ExpenseItemDefinition {
  id: string;
  name: string;
  category: string;
  description?: string;
  defaultFrequency: number;
  isOneTime?: boolean;
  targetYear?: number | null; // The specific year a one-time expense occurs (in today's dollars)
  applicableStates?: string[]; // ['ALL'] (default) or specific state codes (e.g. ['FL'], ['MD'])
  dueMonths?: number[]; // Array of 1-based month numbers (1 to 12) when this non-monthly expense is due
}

export interface ExpenseCatalog {
  categories: string[];
  items: ExpenseItemDefinition[];
}

export interface DetailedExpensesState {
  catalog: ExpenseCatalog;
  states?: string[]; // Configured state roster (e.g. ['MD', 'FL'])
  costs: {
    [stateCode: string]: Record<string, number>;
  };
  frequencies: Record<string, number>;
  MD?: Record<string, number>;
  FL?: Record<string, number>;
}

// Backward compatibility types
export type DetailedStateExpenses = Record<string, number>;
export type DetailedExpenseFrequencies = Record<string, number>;

export interface RecurringExpenseMetadata {
  key: string;
  label: string;
  category: string;
  defaultFrequency: number;
}

export interface OneTimeExpenseMetadata {
  key: string;
  label: string;
}

export const DEFAULT_EXPENSE_CATEGORIES: string[] = [
  'Housing',
  'Transportation',
  'Living',
  'Insurance',
  'Leisure',
  'Charities'
];

export const DEFAULT_EXPENSE_ITEMS: ExpenseItemDefinition[] = [];

export const DEFAULT_EXPENSE_CATALOG: ExpenseCatalog = {
  categories: [...DEFAULT_EXPENSE_CATEGORIES],
  items: [...DEFAULT_EXPENSE_ITEMS]
};

// Legacy compatibility arrays for components that read metadata
export const RECURRING_EXPENSE_ITEMS: RecurringExpenseMetadata[] = DEFAULT_EXPENSE_ITEMS
  .filter((i) => !i.isOneTime)
  .map((i) => ({
    key: i.id,
    label: i.name,
    category: i.category,
    defaultFrequency: i.defaultFrequency
  }));

export const ONE_TIME_EXPENSE_ITEMS: OneTimeExpenseMetadata[] = DEFAULT_EXPENSE_ITEMS
  .filter((i) => i.isOneTime)
  .map((i) => ({
    key: i.id,
    label: i.name
  }));

export const DEFAULT_EXPENSE_FREQUENCIES: Record<string, number> = DEFAULT_EXPENSE_ITEMS.reduce(
  (acc, item) => {
    acc[item.id] = item.defaultFrequency;
    return acc;
  },
  {} as Record<string, number>
);

export const DEFAULT_DETAILED_EXPENSES: Record<string, number> = DEFAULT_EXPENSE_ITEMS.reduce(
  (acc, item) => {
    acc[item.id] = 0;
    return acc;
  },
  {} as Record<string, number>
);

export const DEFAULT_DETAILED_EXPENSES_STATE: DetailedExpensesState = {
  catalog: {
    categories: [...DEFAULT_EXPENSE_CATEGORIES],
    items: []
  },
  states: ['MD', 'FL'],
  costs: {
    MD: {},
    FL: {}
  },
  frequencies: {},
  MD: {},
  FL: {}
};

/**
 * Normalizes any detailed expenses object (legacy or new) to guaranteed DetailedExpensesState
 */
export function normalizeDetailedExpenses(raw?: unknown): DetailedExpensesState {
  if (!raw || typeof raw !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_DETAILED_EXPENSES_STATE));
  }

  const rawObj = raw as Record<string, unknown>;
  const rawCatalog = rawObj.catalog as { items?: ExpenseItemDefinition[]; categories?: string[] } | undefined;

  // If already in new format with catalog
  if (rawCatalog && Array.isArray(rawCatalog.items) && Array.isArray(rawCatalog.categories)) {
    const rawCosts = (rawObj.costs || {}) as Record<string, Record<string, number>>;
    const costs: Record<string, Record<string, number>> = { ...rawCosts };
    if (rawObj.MD && !costs.MD) costs.MD = { ...(rawObj.MD as Record<string, number>) };
    if (rawObj.FL && !costs.FL) costs.FL = { ...(rawObj.FL as Record<string, number>) };
    
    // Ensure default MD and FL objects exist
    if (!costs.MD) costs.MD = {};
    if (!costs.FL) costs.FL = {};

    const rawStates = Array.isArray(rawObj.states) && rawObj.states.length > 0 
      ? (rawObj.states as string[]) 
      : ['MD', 'FL'];
    const stateSet = new Set<string>(rawStates);
    Object.keys(costs).forEach(s => stateSet.add(s));

    const frequencies: Record<string, number> = {
      ...((rawObj.frequencies as Record<string, number>) || {})
    };

    const normalizedItems: ExpenseItemDefinition[] = rawCatalog.items.map((item) => {
      const applicableStates = Array.isArray(item.applicableStates) && item.applicableStates.length > 0
        ? [...item.applicableStates]
        : ['ALL'];
      return {
        ...item,
        applicableStates
      };
    });

    return {
      catalog: {
        categories: rawCatalog.categories.length > 0 ? [...rawCatalog.categories] : [...DEFAULT_EXPENSE_CATEGORIES],
        items: normalizedItems
      },
      states: Array.from(stateSet),
      costs,
      frequencies,
      MD: costs.MD,
      FL: costs.FL
    };
  }

  // Legacy format migration
  const legacyMD = (rawObj.MD || {}) as Record<string, number>;
  const legacyFL = (rawObj.FL || {}) as Record<string, number>;
  const legacyFreqs = (rawObj.frequencies || {}) as Record<string, number>;

  const knownOneTimeKeys = new Set([
    'masterBedFurniture', 'masterBedCloset', 'livingRoomFurniture', 'windowTreatments',
    'areaRugs', 'lanaiFurnishings', 'shippingExpenses', 'storageExpenses', 'washer',
    'dryer', 'golfCartPurchase'
  ]);

  const healthcareKeys = new Set([
    'pre65MedicalPremium', 'pre65MedicalOOP', 'pre65DentalPremium', 'pre65DentalOOP',
    'pre65VisionPremium', 'pre65VisionOOP', 'medicarePartBPremium', 'medicarePartDPremium',
    'medicarePartDDeductibleCopays', 'supplementPremium', 'supplementOOP', 'post65HearingCare',
    'post65DentalPremium', 'post65DentalOOP', 'post65VisionPremium', 'post65VisionOOP'
  ]);

  // Infer legacy items if legacy keys exist in raw.MD or raw.FL (excluding healthcare keys)
  const legacyKeys = Array.from(new Set([...Object.keys(legacyMD), ...Object.keys(legacyFL)]))
    .filter((key) => !healthcareKeys.has(key));
  const legacyItems: ExpenseItemDefinition[] = legacyKeys.map((key) => {
    const isOneTime = knownOneTimeKeys.has(key);
    return {
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
      category: isOneTime ? 'One-Time Setup Costs' : 'Living',
      defaultFrequency: legacyFreqs[key] ?? 12,
      isOneTime,
      applicableStates: ['ALL']
    };
  });

  const costs: Record<string, Record<string, number>> = {
    MD: { ...legacyMD },
    FL: { ...legacyFL }
  };

  const frequencies: Record<string, number> = {
    ...legacyFreqs
  };

  return {
    catalog: {
      categories: [...DEFAULT_EXPENSE_CATEGORIES],
      items: legacyItems
    },
    states: ['MD', 'FL'],
    costs,
    frequencies,
    MD: costs.MD,
    FL: costs.FL
  };
}

export interface GrowthAssumptions {
  equityReturnRate: number;
  fixedIncomeReturnRate: number;
  cpiInflationRate: number;
  healthcareInflationRate: number;
  preTaxEquityPortion?: number;
  taxableEquityPortion?: number;
  rothEquityPortion?: number;
  cashYieldRate?: number | null;
  minCashReserveDollars?: number;
}

export interface CharitySettings {
  enabled: boolean;
  growthPercentage: number; // e.g. 0.10 for 10%
  minAnnualTithe?: number | null; // Optional annual dollar floor (even if growth is 0)
  maxAnnualTithe?: number | null; // Optional annual dollar cap
  useQCD: boolean; // Enable Qualified Charitable Distributions (QCDs) at age 70.5+
}

export const DEFAULT_CHARITY_SETTINGS: CharitySettings = {
  enabled: false,
  growthPercentage: 0.10,
  minAnnualTithe: null,
  maxAnnualTithe: null,
  useQCD: true,
};

export const BASE_QCD_LIMIT = 105000;

export interface YearActualsRecord {
  year: number;
  
  // Realized macro returns & inflation rates
  equityReturnRate?: number | null;
  fixedIncomeReturnRate?: number | null;
  cpiInflationRate?: number | null;
  healthcareInflationRate?: number | null;
  
  // Realized expenses & inflows
  totalLivingExpenses?: number | null;
  categoryExpenses?: Record<string, number>;
  healthcareOOP?: number | null; // Realized healthcare out-of-pocket (deductibles, co-pays, prescriptions)
  preMedicareHealthcareCost?: number | null;
  medicareBasePremiums?: number | null;
  irmaaSurcharges?: number | null; // Realized Medicare IRMAA Part B & D surcharges paid
  earnedSalaryYou?: number | null;
  earnedSalaryWife?: number | null;
  charitableTithe?: number | null;
  
  // Realized tax & surcharge overrides
  magi?: number | null;
  totalIncomeTax?: number | null;
  surchargeTier?: number | null;
  
  // Realized balance reconciliation overrides (ending balances after growth/drawdowns)
  endYourPreTaxIRA?: number | null;
  endYourRothIRA?: number | null;
  endYourTaxableBrokerage?: number | null;
  endYourTaxableBasis?: number | null;
  endYourCash?: number | null;
  endWifePreTaxIRA?: number | null;
  endWifeRothIRA?: number | null;
  endWifeTaxableBrokerage?: number | null;
  endWifeTaxableBasis?: number | null;
  endWifeCash?: number | null;
}

export type ActualTrackingState = Record<number, YearActualsRecord>;

export interface GuardrailSettings {
  enabled: boolean;
  upperGuardrailPct: number; // e.g. 0.15 for +15% above budgeted expenses
  lowerGuardrailPct: number; // e.g. 0.15 for -15% below budgeted expenses
  marketSurplusSharePct: number; // e.g. 0.10 for 10% share of excess market growth
  applyToSimulation: boolean; // if true, applies guardrail adjustment dynamically during forward simulation
}

export const DEFAULT_GUARDRAIL_SETTINGS: GuardrailSettings = {
  enabled: true,
  upperGuardrailPct: 0.15,
  lowerGuardrailPct: 0.15,
  marketSurplusSharePct: 0.10,
  applyToSimulation: false,
};

export interface CustomRothScenario {
  id: string;
  name: string;
  description?: string;
  schedule: Record<number, number>; // year -> nominal conversion amount
  createdAt: string;
  updatedAt: string;
}

export interface AppStateInputs {
  isConfigured: boolean;
  isSingleFiler: boolean;
  simulationStartYear?: number | null; // Configured base simulation start year (defaults to current year when initialized)
  useDetailedExpenses?: boolean;
  simulateSurvivor?: boolean;
  lockedReturnSequence?: LockedReturnSequence | null;
  you: SpouseProfile;
  wife: SpouseProfile;
  portfolio: PortfolioBalances;
  jurisdiction: {
    currentState: 'MD' | 'FL';
    targetState: 'MD' | 'FL';
    relocationYear: number | null;
  };
  growthAssumptions: GrowthAssumptions;
  annualLivingExpenses: number | null;
  annualRothConversion: number;
  rothConversionStartYear?: number;
  rothConversionEndYear?: number;
  rothConversionStrategy: 'flat' | 'fill-to-target' | 'custom';
  rothConversionTargetValue: number | null;
  customRothScenarios?: CustomRothScenario[];
  activeCustomScenarioId?: string | null;
  monteCarloSettings: MonteCarloSettings;
  detailedExpenses?: DetailedExpensesState;
  charitySettings?: CharitySettings;
  fileSSA44LifeChangingEvent?: boolean; // Form SSA-44 Life-Changing Event (Work Stoppage / Wage Reduction)
  actualTracking?: ActualTrackingState;
  guardrailSettings?: GuardrailSettings;
  bucketSettings?: BucketStrategySettings;
  priorTaxReturnMAGI?: Record<number, number | null>; // Historical 2-year lookback tax return MAGI (e.g. 2024 for 2026, 2025 for 2027)
}

/**
 * Resolves the starting year for a retirement plan simulation.
 * If explicitly configured on the plan inputs, returns that constant year.
 * Otherwise, defaults to current calendar year (e.g. 2026).
 */
export function getSimulationStartYear(inputs?: { simulationStartYear?: number | null } | null): number {
  if (inputs?.simulationStartYear !== undefined && inputs?.simulationStartYear !== null && !isNaN(inputs.simulationStartYear) && inputs.simulationStartYear > 1900) {
    return inputs.simulationStartYear;
  }
  return new Date().getFullYear();
}


export interface SimulationResultRow {
  year: number;
  
  // Ages
  yourAge: number;
  wifeAge: number;
  
  // Incomes (Today's inflated values)
  yourSS: number;
  wifeSS: number;
  yourRMD: number;
  wifeRMD: number;
  yourSalary?: number; // Pre-retirement annual active salary earned
  wifeSalary?: number; // Pre-retirement annual active salary earned
  capitalGainsTriggered: number;
  intentionalRothConversion: number;
  requestedCustomRothConversion?: number;
  isRothConversionCapped?: boolean;
  rothConversionShortfall?: number;
  otherTaxableIncome: number; // Placeholder if needed
  
  // MAGI & Tax Calculations
  magi: number;
  fedAGI: number;
  standardDeduction: number;
  taxableIncome: number;
  fedIncomeTax: number;
  stateIncomeTax: number;
  totalIncomeTax: number;
  niitTax: number;
  taxableSS: number;
  taxableDividends: number;
  taxableInterest: number;
  cpiFactor: number;
  
  // Medicare Surcharges (applied in Year t based on Year t-2 MAGI)
  magiTwoYearsAgo: number;
  rawLookbackMAGI?: number; // Unadjusted 2-year lookback MAGI before Form SSA-44 life changing event adjustment
  isSSA44Applied?: boolean; // True if Form SSA-44 Work Stoppage adjustment was applied to reduce lookback MAGI
  surchargeTier: number;
  yourPartBSurcharge: number;
  yourPartDSurcharge: number;
  wifePartBSurcharge: number;
  wifePartDSurcharge: number;
  combinedSurchargeMonthly: number;
  combinedSurchargeAnnual: number;
  
  // Expenses & Cashflow
  livingExpenses: number;
  plannedBaseLivingExpenses?: number; // Base recurring living budget before OOP and one-time
  plannedLivingExpenses?: number; // Total planned living expenses including healthcare OOP allowance
  healthcareOOP?: number; // Realized or modeled healthcare OOP cost (deductibles, co-pays, coinsurance)
  plannedHealthcareOOP?: number; // Maximum planned annual healthcare OOP ceiling / allowance
  medicareBasePremiums: number;
  preMedicareHealthcareCost: number; // Annual pre-Medicare healthcare premium expenses
  totalExpenses: number; // Expenses + Taxes + Medicare Base & Surcharges + Pre-Medicare Premium
  incomeInflow: number; // SS + RMD
  deficit: number; // totalExpenses - incomeInflow
  
  // Drawdowns
  drawdownTaxable: number;
  drawdownPreTax: number;
  drawdownRoth: number;
  drawdownCash: number;
  reinvestedSurplus?: number; // Total annual surplus reinvested into Taxable Brokerage

  // Pre-Retirement Contributions & Payroll
  employee401kContribution?: number; // Total annual employee pre-tax 401(k) contributions
  ficaTaxesPaid?: number; // Social Security (6.2%) + Medicare (1.45% + 0.9%) payroll taxes paid
  incomeTaxWithheld?: number; // Estimated federal and state paycheck income tax withholdings
  netTakeHomeSalary?: number; // Net take-home salary available for expenses

  // Charitable Giving & Tithing (with QCD)
  portfolioGrowth: number; // Total dollar return across accounts in the year
  charitableTithe: number; // Total annual tithe amount from growth
  qcdAmount: number; // Portion funded via tax-free QCDs from Traditional IRAs (offsets RMDs)
  nonQcdTithe: number; // Portion funded from Cash and Taxable Brokerage
  qcdTaxSavings: number; // Estimated direct tax savings via QCD vs taking taxable RMDs
  
  // Ending Balances (after growth and drawdowns)
  endYourPreTaxIRA: number;
  endYourRothIRA: number;
  endYourTaxableBrokerage: number;
  endYourTaxableBasis: number;
  endYourCash: number;
  
  endWifePreTaxIRA: number;
  endWifeRothIRA: number;
  endWifeTaxableBrokerage: number;
  endWifeTaxableBasis: number;
  endWifeCash: number;
  
  totalPortfolioValue: number;

  // Actual Tracking & Guardrails Metadata
  isActual?: boolean; // True if this row reflects verified historical actuals
  isBridged?: boolean; // True if this row was bridged via simulation between actual years
  actualSurplusGap?: number; // Net spending surplus/deficit gap for guardrail tracking
  guardrailUpperLimit?: number; // Upper spending guardrail ceiling
  guardrailLowerLimit?: number; // Lower spending guardrail floor
  permittedSpendingBonus?: number; // Calculated permission to spend bonus for next year
}

export interface SavedPlan {
  id: string;
  name: string;
  inputs: AppStateInputs;
  createdAt: string;
}

export type BondLadderAssetType = 'treasury' | 'cd' | 'corporate' | 'agency' | 'other';

export interface BondLadderHolding {
  id: string;
  rungNumber: number; // 1 to N
  targetYear: number;
  cusipOrName?: string;
  assetType: BondLadderAssetType;
  principal: number;
  couponRate: number; // e.g. 0.045 for 4.5%
  maturityDate?: string; // YYYY-MM-DD
  status?: 'active' | 'matured' | 'paused';
  notes?: string;
}

export interface BondLadderConfig {
  rungsCount: number; // default: 5
  rebuildMode: 'active' | 'paused';
  targetRungFundingMode: 'match-expenses' | 'custom';
  customRungAmount?: number | null;
  defaultYieldRate: number; // e.g. 0.04 (4%)
  holdings: BondLadderHolding[];
}

export interface CashBucketConfig {
  targetRunwayMonths: number; // default: 24 (2 years)
  customLivingReserveAmount?: number | null;
  useDynamicExpenses: boolean; // default: true
  rothTaxReserveMode: 'auto' | 'manual'; // default: 'auto'
  customRothTaxReserveAmount?: number | null;
  externalCheckingTransferFrequency: 'monthly' | 'quarterly' | 'annual';
  customMonthlyTransferAmount?: number | null;
}

export interface GrowthBucketConfig {
  targetEquityPercentage: number; // default: 1.0 (100%)
  unencumberedHorizonYears: number; // default: 8
}

export interface BucketActionItem {
  id: string;
  year: number;
  type:
    | 'rung-maturity-distribute'
    | 'external-checking-transfer'
    | 'roth-tax-payment'
    | 'ladder-rebuild'
    | 'roth-conversion';
  title: string;
  description: string;
  amount: number;
  sourceBucket: 1 | 2 | 3 | 'none';
  destBucket: 1 | 2 | 3 | 'checking' | 'tax-authority';
  status: 'pending' | 'completed' | 'skipped';
  completedDate?: string;
}

export type InitialFundingSource = 'cash-savings' | 'selling-equities';
export type InitialEquityAccount = 'taxable' | 'pre-tax' | 'roth';

export interface BucketStrategySettings {
  strategyStartYear?: number; // e.g. 2027 (first full calendar year of 3-bucket strategy)
  initialFundingSource?: InitialFundingSource;
  initialEquitySourceAccount?: InitialEquityAccount;
  initialStagedAmount?: number | null;
  cash: CashBucketConfig;
  income: BondLadderConfig;
  growth: GrowthBucketConfig;
  actionLedger: Record<number, BucketActionItem[]>;
}

export const DEFAULT_BUCKET_STRATEGY_SETTINGS: BucketStrategySettings = {
  strategyStartYear: 2026,
  initialFundingSource: 'cash-savings',
  initialEquitySourceAccount: 'taxable',
  initialStagedAmount: null,
  cash: {
    targetRunwayMonths: 24,
    customLivingReserveAmount: null,
    useDynamicExpenses: true,
    rothTaxReserveMode: 'auto',
    customRothTaxReserveAmount: null,
    externalCheckingTransferFrequency: 'monthly',
    customMonthlyTransferAmount: null,
  },
  income: {
    rungsCount: 5,
    rebuildMode: 'active',
    targetRungFundingMode: 'match-expenses',
    customRungAmount: null,
    defaultYieldRate: 0.04,
    holdings: [],
  },
  growth: {
    targetEquityPercentage: 1.0,
    unencumberedHorizonYears: 8,
  },
  actionLedger: {},
};
