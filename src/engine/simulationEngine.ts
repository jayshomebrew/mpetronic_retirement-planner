import { AppStateInputs, SimulationResultRow, LockedReturnSequence, getSimulationStartYear, BASE_QCD_LIMIT, normalizeDetailedExpenses, StateHealthcareConfig } from '../types';
import {
  BASE_MEDICARE_PART_B,
  BASE_MEDICARE_PART_D,
  FED_BRACKETS_MFJ,
  FED_BRACKETS_SINGLE,
  FED_STANDARD_DEDUCTION_MFJ,
  FED_STANDARD_DEDUCTION_SINGLE,
  IRMAA_TIERS_MFJ,
  IRMAA_TIERS_SINGLE,
  getIRSUniformLifetimeFactor,
  MD_PIGGYBACK_RATE,
  FED_LTCG_BRACKETS_SINGLE,
  FED_LTCG_BRACKETS_MFJ,
  MD_PENSION_EXCLUSION_BASE_CAP,
  getTargetPresetInfo,
} from './taxRates2026';
import { getEffectiveLocalTaxRate, calculateStateAndLocalTax, getStateTaxProfile } from './stateTaxRegistry';

const BASE_401K_LIMIT = 23500;
const CATCHUP_401K_LIMIT = 7500;
const ENHANCED_CATCHUP_401K_LIMIT = 11250;
const OASDI_WAGE_BASE = 176100;

// Helper to calculate Social Security benefit based on claiming age
export function calculateSSBenefit(pia: number, claimingAge: number): number {
  const FRA = 67;
  if (claimingAge < 62) claimingAge = 62;
  if (claimingAge > 70) claimingAge = 70;

  if (claimingAge < FRA) {
    // 5/9 of 1% per month for first 36 months before FRA
    // 5/12 of 1% per month for any additional months
    const totalMonthsBefore = (FRA - claimingAge) * 12;
    const first36Months = Math.min(totalMonthsBefore, 36);
    const additionalMonths = Math.max(0, totalMonthsBefore - 36);

    const first36Reduction = first36Months * (5 / 900);
    const additionalReduction = additionalMonths * (5 / 1200);
    const totalReduction = first36Reduction + additionalReduction;

    return pia * (1 - totalReduction);
  } else if (claimingAge > FRA) {
    // Delayed retirement credits: 2/3 of 1% per month (8% per year)
    const yearsAfter = claimingAge - FRA;
    const credit = yearsAfter * 0.08;
    return pia * (1 + credit);
  } else {
    return pia;
  }
}

/**
 * Calculates the spousal benefit amount for the lower-earning spouse.
 */
export function calculateSpousalBenefit(primaryPIA: number, spouseClaimingAge: number): number {
  if (primaryPIA <= 0) return 0;

  const FRA = 67;
  const baseSpousal = primaryPIA * 0.50;

  if (spouseClaimingAge >= FRA) {
    return baseSpousal;
  }

  const claimAge = Math.max(62, spouseClaimingAge);
  const totalMonthsBefore = (FRA - claimAge) * 12;
  const first36 = Math.min(totalMonthsBefore, 36);
  const additional = Math.max(0, totalMonthsBefore - 36);

  const reduction = (first36 * (25 / 3600)) + (additional * (5 / 1200));
  return baseSpousal * (1 - reduction);
}

// Calculate Social Security Taxability based on Provisional Income
export function calculateTaxableSS(
  totalSS: number,
  otherAGI: number,
  isSingle: boolean
): number {
  if (totalSS <= 0) return 0;
  
  const provisionalIncome = otherAGI + (totalSS * 0.5);
  
  let taxableSS = 0;
  if (isSingle) {
    if (provisionalIncome <= 25000) {
      taxableSS = 0;
    } else if (provisionalIncome <= 34000) {
      taxableSS = Math.min(0.5 * totalSS, 0.5 * (provisionalIncome - 25000));
    } else {
      const base = Math.min(4500, 0.5 * Math.min(totalSS, 9000));
      taxableSS = Math.min(0.85 * totalSS, base + 0.85 * (provisionalIncome - 34000));
    }
  } else {
    if (provisionalIncome <= 32000) {
      taxableSS = 0;
    } else if (provisionalIncome <= 44000) {
      taxableSS = Math.min(0.5 * totalSS, 0.5 * (provisionalIncome - 32000));
    } else {
      const base = Math.min(6000, 0.5 * Math.min(totalSS, 12000));
      taxableSS = Math.min(0.85 * totalSS, base + 0.85 * (provisionalIncome - 44000));
    }
  }
  return Math.max(0, taxableSS);
}

/**
 * Solves for the exact Roth conversion amount needed to reach target AGI (or MAGI),
 * accurately accounting for the progressive 0% / 50% / 85% Social Security provisional income taxability.
 */
export function solveRothConversionForTargetAGI(
  targetAGI: number,
  baselineOrdinary: number,
  baselineCapitalGains: number,
  totalSS: number,
  isSingle: boolean
): number {
  const baseOtherAGI = baselineOrdinary + baselineCapitalGains;
  const baseTaxableSS = calculateTaxableSS(totalSS, baseOtherAGI, isSingle);
  const baseAGI = baselineOrdinary + baseTaxableSS + baselineCapitalGains;

  if (baseAGI >= targetAGI) {
    return 0;
  }

  let low = 0;
  let high = Math.max(0, targetAGI - baseAGI);
  let bestConv = 0;

  // 30 bisection iterations provide sub-cent accuracy
  for (let iter = 0; iter < 30; iter++) {
    const mid = (low + high) / 2;
    const testOtherAGI = baseOtherAGI + mid;
    const testTaxableSS = calculateTaxableSS(totalSS, testOtherAGI, isSingle);
    const testAGI = baselineOrdinary + mid + testTaxableSS + baselineCapitalGains;

    if (testAGI <= targetAGI) {
      bestConv = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.round(bestConv * 100) / 100;
}

// Helper to compute Federal Income Tax
export function calculateFedTax(
  taxableIncome: number,
  isSingle: boolean,
  cpiFactor: number
): number {
  if (taxableIncome <= 0) return 0;
  
  const brackets = isSingle ? FED_BRACKETS_SINGLE : FED_BRACKETS_MFJ;
  let tax = 0;
  let previousLimit = 0;
  
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    const inflatedLimit = bracket.limit === Infinity ? Infinity : bracket.limit * cpiFactor;
    
    if (taxableIncome > inflatedLimit) {
      tax += (inflatedLimit - previousLimit) * bracket.rate;
      previousLimit = inflatedLimit;
    } else {
      tax += (taxableIncome - previousLimit) * bracket.rate;
      break;
    }
  }
  
  return tax;
}

// Helper to compute Federal Income Tax separating ordinary income and capital gains
export function calculateFedTaxWithLTCG(
  taxableOrdinaryIncome: number,
  taxableCapitalGains: number,
  isSingle: boolean,
  cpiFactor: number
): { ordinaryTax: number; ltcgTax: number; totalTax: number } {
  const ordinaryTax = calculateFedTax(taxableOrdinaryIncome, isSingle, cpiFactor);

  if (taxableCapitalGains <= 0) {
    return {
      ordinaryTax,
      ltcgTax: 0,
      totalTax: ordinaryTax,
    };
  }

  const ltcgBrackets = isSingle ? FED_LTCG_BRACKETS_SINGLE : FED_LTCG_BRACKETS_MFJ;
  
  const limit0 = ltcgBrackets[0].limit * cpiFactor;
  const limit15 = ltcgBrackets[1].limit * cpiFactor;

  const totalTaxable = taxableOrdinaryIncome + taxableCapitalGains;

  const ltcg15Start = Math.max(taxableOrdinaryIncome, limit0);
  const ltcg15End = Math.min(totalTaxable, limit15);
  const ltcg15 = Math.max(0, ltcg15End - ltcg15Start);

  const ltcg20Start = Math.max(taxableOrdinaryIncome, limit15);
  const ltcg20 = Math.max(0, totalTaxable - ltcg20Start);

  const ltcgTax = (ltcg15 * 0.15) + (ltcg20 * 0.20);
  
  return {
    ordinaryTax,
    ltcgTax,
    totalTax: ordinaryTax + ltcgTax,
  };
}

export function getRMDStartAge(birthYear: number): number {
  if (birthYear < 1951) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

// Helper to compute Maryland State Tax (delegates to universal state tax registry)
export function calculateMDStateTax(
  fedAGI: number,
  taxableSS: number,
  isSingle: boolean,
  cpiFactor: number = 1,
  mdPensionExclusion: number = 0,
  effectiveLocalRate: number = MD_PIGGYBACK_RATE
): number {
  return calculateStateAndLocalTax(
    'MD',
    {
      fedAGI,
      taxableSS,
      isSingle,
      cpiFactor,
      pensionExclusion: mdPensionExclusion,
    },
    effectiveLocalRate
  ).totalTax;
}

/**
 * Applies the 3-Bucket Liquidity Constraint to a candidate Roth conversion:
 * Bucket 1 Cash Reserve is prioritized to protect 2 years of living expenses
 * (targetRunwayMonths, default 24).
 * The conversion is constrained so that the incremental taxes generated do not
 * reduce total taxable liquidity below this 2-year living expense reserve floor.
 */
export function applyBucketLiquidityConstraintToConversion(
  targetConversion: number,
  totalTaxableAssets: number,
  reserveFloor: number,
  baselineOrdinary: number,
  capitalGains: number,
  totalSS: number,
  isSingle: boolean,
  cpiFactor: number,
  standardDeductionTotal: number,
  nonQcdTithe: number,
  isStateFLOrActiveState: boolean | string,
  mdPensionExclusion: number = 0,
  effectiveLocalRate: number = MD_PIGGYBACK_RATE
): number {
  if (targetConversion <= 0) return 0;

  // Available capacity in taxable accounts above the living expense reserve floor
  const taxCapacity = Math.max(0, totalTaxableAssets - reserveFloor);
  if (taxCapacity <= 0) return 0;

  const activeState = typeof isStateFLOrActiveState === 'string'
    ? isStateFLOrActiveState
    : (isStateFLOrActiveState ? 'FL' : 'MD');

  const computeTax = (conv: number): number => {
    const ordinary = baselineOrdinary + conv;
    const otherAGI = ordinary + capitalGains;
    const taxableSS = calculateTaxableSS(totalSS, otherAGI, isSingle);
    const fedAGI = ordinary + taxableSS + capitalGains;

    const stateTaxResult = calculateStateAndLocalTax(
      activeState,
      {
        fedAGI,
        taxableSS,
        isSingle,
        cpiFactor,
        pensionExclusion: mdPensionExclusion,
        ordinaryIncome: ordinary,
        capitalGains,
        retirementDistributions: conv,
      },
      effectiveLocalRate
    );
    const stateTax = stateTaxResult.totalTax;

    const saltCap = 10000 * cpiFactor;
    const saltDeduction = Math.min(saltCap, stateTax);
    const itemizedDeduction = saltDeduction + nonQcdTithe;
    const stdDeduction = Math.max(standardDeductionTotal, itemizedDeduction);

    const taxableOrdinary = Math.max(0, fedAGI - capitalGains - stdDeduction);
    const { totalTax: fedBaseTax } = calculateFedTaxWithLTCG(taxableOrdinary, capitalGains, isSingle, cpiFactor);

    const niitThreshold = isSingle ? 200000 : 250000;
    const excessMAGI = Math.max(0, fedAGI - niitThreshold);
    const niitTax = Math.min(capitalGains, excessMAGI) * 0.038;

    return fedBaseTax + niitTax + stateTax;
  };

  const baseTax = computeTax(0);
  const fullConversionTax = computeTax(targetConversion);
  const incrementalTax = fullConversionTax - baseTax;

  // If the incremental tax generated by the conversion fits within taxCapacity,
  // the 2-year reserve is fully preserved.
  if (incrementalTax <= taxCapacity) {
    return targetConversion;
  }

  // Otherwise, solve for the maximum conversion whose incremental tax <= taxCapacity
  let low = 0;
  let high = targetConversion;
  let safeConversion = 0;

  for (let iter = 0; iter < 20; iter++) {
    const mid = (low + high) / 2;
    const taxAtMid = computeTax(mid);
    const incTaxAtMid = taxAtMid - baseTax;

    if (incTaxAtMid <= taxCapacity) {
      safeConversion = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.round(safeConversion * 100) / 100;
}

function parseBirthYearAndMonth(dateStr: string | undefined, defaultYear: number): { year: number; month: number } {
  if (!dateStr) return { year: defaultYear, month: 0 };
  const parts = dateStr.split('-');
  if (parts.length < 2) return { year: defaultYear, month: 0 };
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed (Jan = 0, Dec = 11)
  return { year: isNaN(year) ? defaultYear : year, month: isNaN(month) ? 0 : month };
}

// Full multi-decade simulation runner
export function runRetirementSimulation(
  inputs: AppStateInputs,
  simulateSurvivor: boolean = false,
  activeSequence?: LockedReturnSequence | null
): SimulationResultRow[] {
  if (!inputs.isConfigured) {
    return []; // Bypass calculations if not configured
  }

  const ledger: SimulationResultRow[] = [];
  
  // Initial portfolio balances
  let yourPreTax = inputs.portfolio.yourPreTaxIRA || 0;
  let yourRoth = inputs.portfolio.yourRothIRA || 0;
  let yourTaxable = inputs.portfolio.yourTaxableBrokerage || 0;
  let yourBasis = inputs.portfolio.yourTaxableBasis || 0;
  let yourCash = inputs.portfolio.yourCash || 0;
  
  let wifePreTax = inputs.isSingleFiler ? 0 : (inputs.portfolio.wifePreTaxIRA || 0);
  let wifeRoth = inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeRothIRA || 0);
  let wifeTaxable = inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeTaxableBrokerage || 0);
  let wifeBasis = inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeTaxableBasis || 0);
  let wifeCash = inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeCash || 0);
  
  const taxableDividendYield = inputs.portfolio.taxableDividendYield !== undefined && inputs.portfolio.taxableDividendYield !== null ? inputs.portfolio.taxableDividendYield : 0.02;
  const taxableNonQualifiedPortion = inputs.portfolio.taxableNonQualifiedPortion !== undefined && inputs.portfolio.taxableNonQualifiedPortion !== null ? inputs.portfolio.taxableNonQualifiedPortion : 0.30;
  
  // Actuarial death year definition for survivor mode:
  const { year: yourBirthYear, month: yourBirthMonth } = parseBirthYearAndMonth(inputs.you.birthDate, 1960);
  const { year: wifeBirthYear, month: wifeBirthMonth } = parseBirthYearAndMonth(inputs.wife.birthDate, 1964);
  const DEATH_YEAR = yourBirthYear + (inputs.you.longevityAge ?? 85);
  const WIFE_DEATH_YEAR = inputs.isSingleFiler ? 0 : (wifeBirthYear + (inputs.wife.longevityAge ?? 95));

  const simStartYear = getSimulationStartYear(inputs);
  const startYear = inputs.rothConversionStartYear !== undefined ? inputs.rothConversionStartYear : (simStartYear + 1);
  const endYear = inputs.rothConversionEndYear !== undefined ? inputs.rothConversionEndYear : (simStartYear + 8);

  // The simulation runs until the last survivor passes away
  const endSimulationYear = Math.max(simStartYear, inputs.isSingleFiler ? DEATH_YEAR : Math.max(DEATH_YEAR, WIFE_DEATH_YEAR));

  // Check if a stochastic sequence of returns is active
  const activeSeq = activeSequence;

  let cpiFactor = 1.0;
  let healthcareFactor = 1.0;
  let priorMonthlyTithe = 0;
  let isTitheInitialized = false;
  let titheReserveBank = 0;

  // Let's run year-by-year from simStartYear to endSimulationYear
  for (let year = simStartYear; year <= endSimulationYear; year++) {
    const yearsElapsed = year - simStartYear;
    const actualRec = inputs.actualTracking?.[year];
    const hasLaterActual = Object.keys(inputs.actualTracking || {}).some(
      (y) => Number(y) > year && Boolean(inputs.actualTracking?.[Number(y)])
    );
    const isBridged = !actualRec && hasLaterActual;
    
    // Accumulate inflation index (CPI) dynamically based on co-sampled rates if available or actuals
    let annualInflation = inputs.growthAssumptions.cpiInflationRate;
    if (yearsElapsed > 0) {
      const prevYear = year - 1;
      const prevActualRec = inputs.actualTracking?.[prevYear];
      if (prevActualRec?.cpiInflationRate !== undefined && prevActualRec?.cpiInflationRate !== null) {
        annualInflation = prevActualRec.cpiInflationRate;
      } else if (activeSeq && activeSeq.inflationRates) {
        const prevYearElapsed = yearsElapsed - 1;
        if (activeSeq.inflationRates[prevYearElapsed] !== undefined) {
          annualInflation = activeSeq.inflationRates[prevYearElapsed];
        }
      }
      cpiFactor *= (1 + annualInflation);

      let annualHcInflation = inputs.growthAssumptions.healthcareInflationRate;
      if (prevActualRec?.healthcareInflationRate !== undefined && prevActualRec?.healthcareInflationRate !== null) {
        annualHcInflation = prevActualRec.healthcareInflationRate;
      }
      healthcareFactor *= (1 + annualHcInflation);
    }
    
    // Growth rates by account type (Equities vs Fixed Income allocation)
    let equityRate = inputs.growthAssumptions.equityReturnRate;
    let bondRate = inputs.growthAssumptions.fixedIncomeReturnRate;
    
    if (actualRec?.equityReturnRate !== undefined && actualRec?.equityReturnRate !== null) {
      equityRate = actualRec.equityReturnRate;
    } else if (activeSeq) {
      equityRate = activeSeq.equityReturns[yearsElapsed] !== undefined ? activeSeq.equityReturns[yearsElapsed] : equityRate;
    }

    if (actualRec?.fixedIncomeReturnRate !== undefined && actualRec?.fixedIncomeReturnRate !== null) {
      bondRate = actualRec.fixedIncomeReturnRate;
    } else if (activeSeq) {
      bondRate = activeSeq.fixedIncomeReturns[yearsElapsed] !== undefined ? activeSeq.fixedIncomeReturns[yearsElapsed] : bondRate;
    }

    const preTaxEquityPortion = inputs.growthAssumptions.preTaxEquityPortion ?? 0.50;
    const taxableEquityPortion = inputs.growthAssumptions.taxableEquityPortion ?? 0.60;
    const rothEquityPortion = inputs.growthAssumptions.rothEquityPortion ?? 1.00;

    const taxableGrowthRate = taxableEquityPortion * equityRate + (1 - taxableEquityPortion) * bondRate;
    const preTaxGrowthRate = preTaxEquityPortion * equityRate + (1 - preTaxEquityPortion) * bondRate;
    const rothGrowthRate = rothEquityPortion * equityRate + (1 - rothEquityPortion) * bondRate;

    // Monthly Rates
    const monthlyTaxableRate = Math.pow(1 + taxableGrowthRate, 1 / 12) - 1;
    const monthlyPreTaxRate = Math.pow(1 + preTaxGrowthRate, 1 / 12) - 1;
    const monthlyRothRate = Math.pow(1 + rothGrowthRate, 1 / 12) - 1;
    const cashRate = inputs.growthAssumptions.cashYieldRate ?? inputs.growthAssumptions.fixedIncomeReturnRate;
    const monthlyCashRate = Math.pow(1 + cashRate, 1 / 12) - 1;

    // State determination
    const isRelocated = inputs.jurisdiction.relocationYear !== null && year >= inputs.jurisdiction.relocationYear;
    const isIntraStateRelocation = Boolean(
      inputs.jurisdiction.targetState === inputs.jurisdiction.currentState &&
      inputs.jurisdiction.targetCounty &&
      inputs.jurisdiction.targetCounty !== inputs.jurisdiction.currentCounty
    );

    const resolvedTargetState = isIntraStateRelocation
      ? inputs.jurisdiction.targetState
      : (inputs.jurisdiction.targetState && inputs.jurisdiction.targetState !== inputs.jurisdiction.currentState)
        ? inputs.jurisdiction.targetState
        : (inputs.jurisdiction.currentState === 'MD' ? 'FL' : 'MD');

    const activeState = isRelocated
      ? resolvedTargetState
      : inputs.jurisdiction.currentState;

    const activeCounty = isRelocated ? inputs.jurisdiction.targetCounty : inputs.jurisdiction.currentCounty;
    const activeCustomRate = isRelocated ? inputs.jurisdiction.targetLocalTaxRate : inputs.jurisdiction.currentLocalTaxRate;
    const effectiveLocalRate = getEffectiveLocalTaxRate(activeState, activeCounty, activeCustomRate);

    const isStateFL = activeState === 'FL';

    const youDeceased = simulateSurvivor && (year >= DEATH_YEAR);
    const wifeDeceased = inputs.isSingleFiler || (simulateSurvivor && (year >= WIFE_DEATH_YEAR));
    const firstDeathYear = Math.min(DEATH_YEAR, WIFE_DEATH_YEAR);
    const isSingle = (simulateSurvivor && (year > (inputs.isSingleFiler ? DEATH_YEAR : firstDeathYear))) || inputs.isSingleFiler;

    if (simulateSurvivor && youDeceased && wifeDeceased) {
      break;
    }

    const isSurvivorActive = youDeceased || wifeDeceased;

    // Spousal transition on primary death
    if (youDeceased && year === DEATH_YEAR && !inputs.isSingleFiler && !wifeDeceased) {
      wifePreTax += yourPreTax;
      yourPreTax = 0;
      wifeRoth += yourRoth;
      yourRoth = 0;

      if (isStateFL) {
        wifeBasis = wifeTaxable + yourTaxable;
      } else {
        wifeBasis += yourTaxable;
      }
      wifeTaxable += yourTaxable;
      yourTaxable = 0;
      yourBasis = 0;

      wifeCash += yourCash;
      yourCash = 0;
    }

    // Spousal transition on spouse death
    if (wifeDeceased && year === WIFE_DEATH_YEAR && !inputs.isSingleFiler && !youDeceased) {
      yourPreTax += wifePreTax;
      wifePreTax = 0;
      yourRoth += wifeRoth;
      yourRoth = 0;

      if (isStateFL) {
        yourBasis = yourTaxable + wifeTaxable;
      } else {
        yourBasis += wifeTaxable;
      }
      yourTaxable += wifeTaxable;
      wifeTaxable = 0;
      wifeBasis = 0;

      yourCash += wifeCash;
      yourCash = 0;
    }

    // Standard spouse ages for year
    const yourAge = year - yourBirthYear;
    const wifeAge = year - wifeBirthYear;
    const youRetireAge = inputs.you.plannedRetirementAge ?? 67;
    const wifeRetireAge = inputs.isSingleFiler ? 0 : (inputs.wife.plannedRetirementAge ?? 67);

    // Event month indexes relative to 2026 start
    // If plannedRetirementMonth is set (1-12), use it as the within-year month offset (0-indexed).
    // Otherwise fall back to birth month, which preserves the existing behavior.
    const youRetireMonth = (inputs.you.plannedRetirementMonth != null)
      ? inputs.you.plannedRetirementMonth - 1
      : yourBirthMonth;
    const wifeRetireMonth = (!inputs.isSingleFiler && inputs.wife.plannedRetirementMonth != null)
      ? inputs.wife.plannedRetirementMonth - 1
      : wifeBirthMonth;

    const yourRetireMonthIdx = (yourBirthYear + youRetireAge - simStartYear) * 12 + youRetireMonth;
    const wifeRetireMonthIdx = (wifeBirthYear + wifeRetireAge - simStartYear) * 12 + wifeRetireMonth;
    const yourSSClaimMonthIdx = inputs.you.targetSSClaimingAge
      ? (yourBirthYear + inputs.you.targetSSClaimingAge - simStartYear) * 12 + yourBirthMonth
      : Infinity;
    const wifeSSClaimMonthIdx = (!inputs.isSingleFiler && inputs.wife.targetSSClaimingAge)
      ? (wifeBirthYear + inputs.wife.targetSSClaimingAge - simStartYear) * 12 + wifeBirthMonth
      : Infinity;

    let yourMedicareMonthIdx = (yourBirthYear + 65 - simStartYear) * 12 + yourBirthMonth;
    if (inputs.you.healthcare?.medicareStartMode === 'customDate' && inputs.you.healthcare?.medicareStartDate) {
      const parts = inputs.you.healthcare.medicareStartDate.split('-');
      const customYear = parseInt(parts[0], 10);
      const customMonth = parts.length > 1 ? parseInt(parts[1], 10) - 1 : 0;
      if (!isNaN(customYear)) {
        yourMedicareMonthIdx = (customYear - simStartYear) * 12 + (isNaN(customMonth) ? 0 : customMonth);
      }
    }

    let wifeMedicareMonthIdx = (wifeBirthYear + 65 - simStartYear) * 12 + wifeBirthMonth;
    if (inputs.wife.healthcare?.medicareStartMode === 'customDate' && inputs.wife.healthcare?.medicareStartDate) {
      const parts = inputs.wife.healthcare.medicareStartDate.split('-');
      const customYear = parseInt(parts[0], 10);
      const customMonth = parts.length > 1 ? parseInt(parts[1], 10) - 1 : 0;
      if (!isNaN(customYear)) {
        wifeMedicareMonthIdx = (customYear - simStartYear) * 12 + (isNaN(customMonth) ? 0 : customMonth);
      }
    }
    const wifeSurvivorMonthIdx = (wifeBirthYear + 60 - simStartYear) * 12 + wifeBirthMonth;

    const yourRmdStartAge = getRMDStartAge(yourBirthYear);
    const wifeRmdStartAge = getRMDStartAge(wifeBirthYear);

    // Calculate baseline SS benefits
    const yourSSAnnualBase = calculateSSBenefit(inputs.you.estimatedPIA || 0, inputs.you.targetSSClaimingAge || 67) * 12 * cpiFactor;
    const wifeSSAnnualBase = calculateSSBenefit(inputs.wife.estimatedPIA || 0, inputs.wife.targetSSClaimingAge || 67) * 12 * cpiFactor;
    const spousalSSAnnualFloor = calculateSpousalBenefit(inputs.you.estimatedPIA || 0, inputs.wife.targetSSClaimingAge || 67) * 12 * cpiFactor;

    const survivorSSAnnualBase = calculateSSBenefit(inputs.you.estimatedPIA || 0, inputs.you.targetSSClaimingAge || 67) * 12 * cpiFactor;
    const survivorWifeSSAnnualBase = calculateSSBenefit(inputs.wife.estimatedPIA || 0, inputs.wife.targetSSClaimingAge || 67) * 12 * cpiFactor;
    const survivorFloor = (inputs.you.estimatedPIA || 0) * 0.825 * 12 * cpiFactor;
    const wifeSurvivorSSBenefit = Math.max(survivorSSAnnualBase, survivorWifeSSAnnualBase, survivorFloor);

    // 2. RMDs calculations (based on start-of-year balances)
    let yourRMD = 0;
    let wifeRMD = 0;
    if (!youDeceased && yourAge >= yourRmdStartAge) {
      const factor = getIRSUniformLifetimeFactor(yourAge);
      if (factor > 0) yourRMD = yourPreTax / factor;
    }
    if (!wifeDeceased && wifeAge >= wifeRmdStartAge) {
      const factor = getIRSUniformLifetimeFactor(wifeAge);
      if (factor > 0) wifeRMD = wifePreTax / factor;
    }

    // Pre-Retirement 401(k) and Working Months Calculation
    let yourWorkingMonthsThisYear = 0;
    let wifeWorkingMonthsThisYear = 0;
    for (let m = 0; m < 12; m++) {
      const mIdx = (year - simStartYear) * 12 + m;
      if (!youDeceased && mIdx < yourRetireMonthIdx && ((inputs.you.activeSalary ?? 0) > 0)) yourWorkingMonthsThisYear++;
      if (!wifeDeceased && !inputs.isSingleFiler && mIdx < wifeRetireMonthIdx && ((inputs.wife.activeSalary ?? 0) > 0)) wifeWorkingMonthsThisYear++;
    }

    let annualYourGrossSalary = 0;
    let annualYour401k = 0;
    let annualYourFICA = 0;
    let monthlyYourGrossSalary = 0;
    let monthlyYour401k = 0;
    let monthlyYourFICA = 0;
    let monthlyYourNetSalary = 0;
    let taxableYourSalary = 0;
    let monthlyYourTaxWithholding = 0;

    if (!youDeceased && yourWorkingMonthsThisYear > 0 && inputs.you.activeSalary && inputs.you.activeSalary > 0) {
      const fullYearSalary = (inputs.you.activeSalary * cpiFactor);
      annualYourGrossSalary = fullYearSalary * (yourWorkingMonthsThisYear / 12);
      monthlyYourGrossSalary = fullYearSalary / 12;

      let your401kLimit = BASE_401K_LIMIT * cpiFactor;
      if (yourAge >= 60 && yourAge <= 63) {
        your401kLimit += ENHANCED_CATCHUP_401K_LIMIT * cpiFactor;
      } else if (yourAge >= 50) {
        your401kLimit += CATCHUP_401K_LIMIT * cpiFactor;
      }

      annualYour401k = Math.min(annualYourGrossSalary, your401kLimit);
      monthlyYour401k = annualYour401k / yourWorkingMonthsThisYear;

      const ssTax = 0.062 * Math.min(annualYourGrossSalary, OASDI_WAGE_BASE * cpiFactor);
      const medTax = 0.0145 * annualYourGrossSalary;
      const addMedTax = (annualYourGrossSalary > 200000 * cpiFactor) ? 0.009 * (annualYourGrossSalary - 200000 * cpiFactor) : 0;
      annualYourFICA = ssTax + medTax + addMedTax;
      monthlyYourFICA = annualYourFICA / yourWorkingMonthsThisYear;

      taxableYourSalary = Math.max(0, annualYourGrossSalary - annualYour401k);

      const estFedRate = taxableYourSalary > 100000 * cpiFactor ? 0.22 : 0.12;
      const activeProfile = getStateTaxProfile(activeState);
      const estStateRate = activeProfile?.hasIncomeTax ? (activeProfile.topRate + effectiveLocalRate) : (effectiveLocalRate > 0 ? effectiveLocalRate : 0);
      const annualEstTaxWithholding = taxableYourSalary * (estFedRate + estStateRate);
      monthlyYourTaxWithholding = annualEstTaxWithholding / yourWorkingMonthsThisYear;

      monthlyYourNetSalary = Math.max(0, monthlyYourGrossSalary - monthlyYour401k - monthlyYourFICA - monthlyYourTaxWithholding);
    }

    let annualWifeGrossSalary = 0;
    let annualWife401k = 0;
    let annualWifeFICA = 0;
    let monthlyWifeGrossSalary = 0;
    let monthlyWife401k = 0;
    let monthlyWifeFICA = 0;
    let monthlyWifeNetSalary = 0;
    let taxableWifeSalary = 0;
    let monthlyWifeTaxWithholding = 0;

    if (!wifeDeceased && !inputs.isSingleFiler && wifeWorkingMonthsThisYear > 0 && inputs.wife.activeSalary && inputs.wife.activeSalary > 0) {
      const fullYearSalary = (inputs.wife.activeSalary * cpiFactor);
      annualWifeGrossSalary = fullYearSalary * (wifeWorkingMonthsThisYear / 12);
      monthlyWifeGrossSalary = fullYearSalary / 12;

      let wife401kLimit = BASE_401K_LIMIT * cpiFactor;
      if (wifeAge >= 60 && wifeAge <= 63) {
        wife401kLimit += ENHANCED_CATCHUP_401K_LIMIT * cpiFactor;
      } else if (wifeAge >= 50) {
        wife401kLimit += CATCHUP_401K_LIMIT * cpiFactor;
      }

      annualWife401k = Math.min(annualWifeGrossSalary, wife401kLimit);
      monthlyWife401k = annualWife401k / wifeWorkingMonthsThisYear;

      const ssTax = 0.062 * Math.min(annualWifeGrossSalary, OASDI_WAGE_BASE * cpiFactor);
      const medTax = 0.0145 * annualWifeGrossSalary;
      const addMedTax = (annualWifeGrossSalary > 200000 * cpiFactor) ? 0.009 * (annualWifeGrossSalary - 200000 * cpiFactor) : 0;
      annualWifeFICA = ssTax + medTax + addMedTax;
      monthlyWifeFICA = annualWifeFICA / wifeWorkingMonthsThisYear;

      taxableWifeSalary = Math.max(0, annualWifeGrossSalary - annualWife401k);

      const estFedRate = taxableWifeSalary > 100000 * cpiFactor ? 0.22 : 0.12;
      const wifeActiveProfile = getStateTaxProfile(activeState);
      const estStateRate = wifeActiveProfile?.hasIncomeTax ? (wifeActiveProfile.topRate + effectiveLocalRate) : (effectiveLocalRate > 0 ? effectiveLocalRate : 0);
      const annualEstTaxWithholding = taxableWifeSalary * (estFedRate + estStateRate);
      monthlyWifeTaxWithholding = annualEstTaxWithholding / wifeWorkingMonthsThisYear;

      monthlyWifeNetSalary = Math.max(0, monthlyWifeGrossSalary - monthlyWife401k - monthlyWifeFICA - monthlyWifeTaxWithholding);
    }

    const annualTotal401k = annualYour401k + annualWife401k;
    const annualTotalFICA = annualYourFICA + annualWifeFICA;
    const annualTotalTaxWithholding = (monthlyYourTaxWithholding * yourWorkingMonthsThisYear) + (monthlyWifeTaxWithholding * wifeWorkingMonthsThisYear);

    // Define healthcare parameters once per year
    let yourPreMedicareAnnual = 0;
    let yourPreMedicareOOP = 0;
    let yourMedicarePremiums = 0;
    let yourMedicareOOP = 0;
    if (inputs.you.healthcare) {
      const hcRecord = inputs.you.healthcare as unknown as Record<string, StateHealthcareConfig | undefined>;
      const stateHc = hcRecord[activeState]
        || (activeState === inputs.jurisdiction.currentState ? hcRecord[inputs.jurisdiction.currentState] : undefined)
        || (activeState === inputs.jurisdiction.targetState ? hcRecord[inputs.jurisdiction.targetState] : undefined);
      const itemizedPre65 = ((stateHc?.pre65MedicalPremium ?? 0) + (stateHc?.pre65DentalPremium ?? 0) + (stateHc?.pre65VisionPremium ?? 0));
      yourPreMedicareAnnual = (itemizedPre65 > 0 ? itemizedPre65 : (inputs.you.preMedicareMonthlyPremium ?? 0)) * 12 * healthcareFactor;
      yourPreMedicareOOP = ((stateHc?.pre65MedicalOOP ?? 0) + (stateHc?.pre65DentalOOP ?? 0) + (stateHc?.pre65VisionOOP ?? 0)) * healthcareFactor;
      
      const customB = inputs.you.healthcare.medicarePartBPremium;
      const partB_current = (customB !== null && customB !== undefined) ? customB * healthcareFactor : BASE_MEDICARE_PART_B * healthcareFactor;
      const customD = stateHc?.medicarePartDPremium;
      const partD_current = (customD !== null && customD !== undefined) ? customD * healthcareFactor : BASE_MEDICARE_PART_D * healthcareFactor;
      const suppPrem = (stateHc?.supplementPremium ?? 0) * 12 * healthcareFactor;
      const dentalPrem = (stateHc?.post65DentalPremium ?? 0) * 12 * healthcareFactor;
      const visionPrem = (stateHc?.post65VisionPremium ?? 0) * 12 * healthcareFactor;
      yourMedicarePremiums = (partB_current + partD_current) * 12 + suppPrem + dentalPrem + visionPrem;
      yourMedicareOOP = ((stateHc?.medicarePartDDeductibleCopays ?? 0) + (stateHc?.supplementOOP ?? 0) + (stateHc?.post65HearingCare ?? 0) + (stateHc?.post65DentalOOP ?? 0) + (stateHc?.post65VisionOOP ?? 0)) * healthcareFactor;
    } else {
      yourPreMedicareAnnual = (inputs.you.preMedicareMonthlyPremium ?? 0) * 12 * healthcareFactor;
      yourMedicarePremiums = (BASE_MEDICARE_PART_B + BASE_MEDICARE_PART_D) * 12 * healthcareFactor;
    }

    let wifePreMedicareAnnual = 0;
    let wifePreMedicareOOP = 0;
    let wifeMedicarePremiums = 0;
    let wifeMedicareOOP = 0;
    if (!wifeDeceased) {
      if (inputs.wife.healthcare) {
        const wifeHcRecord = inputs.wife.healthcare as unknown as Record<string, StateHealthcareConfig | undefined>;
        const stateHc = wifeHcRecord[activeState]
          || (activeState === inputs.jurisdiction.currentState ? wifeHcRecord[inputs.jurisdiction.currentState] : undefined)
          || (activeState === inputs.jurisdiction.targetState ? wifeHcRecord[inputs.jurisdiction.targetState] : undefined);
        const itemizedPre65 = ((stateHc?.pre65MedicalPremium ?? 0) + (stateHc?.pre65DentalPremium ?? 0) + (stateHc?.pre65VisionPremium ?? 0));
        wifePreMedicareAnnual = (itemizedPre65 > 0 ? itemizedPre65 : (inputs.wife.preMedicareMonthlyPremium ?? 0)) * 12 * healthcareFactor;
        wifePreMedicareOOP = ((stateHc?.pre65MedicalOOP ?? 0) + (stateHc?.pre65DentalOOP ?? 0) + (stateHc?.pre65VisionOOP ?? 0)) * healthcareFactor;
        
        const customB = inputs.wife.healthcare.medicarePartBPremium;
        const partB_current = (customB !== null && customB !== undefined) ? customB * healthcareFactor : BASE_MEDICARE_PART_B * healthcareFactor;
        const customD = stateHc?.medicarePartDPremium;
        const partD_current = (customD !== null && customD !== undefined) ? customD * healthcareFactor : BASE_MEDICARE_PART_D * healthcareFactor;
        const suppPrem = (stateHc?.supplementPremium ?? 0) * 12 * healthcareFactor;
        const dentalPrem = (stateHc?.post65DentalPremium ?? 0) * 12 * healthcareFactor;
        const visionPrem = (stateHc?.post65VisionPremium ?? 0) * 12 * healthcareFactor;
        wifeMedicarePremiums = (partB_current + partD_current) * 12 + suppPrem + dentalPrem + visionPrem;
        wifeMedicareOOP = ((stateHc?.medicarePartDDeductibleCopays ?? 0) + (stateHc?.supplementOOP ?? 0) + (stateHc?.post65HearingCare ?? 0) + (stateHc?.post65DentalOOP ?? 0) + (stateHc?.post65VisionOOP ?? 0)) * healthcareFactor;
      } else {
        wifePreMedicareAnnual = (inputs.wife.preMedicareMonthlyPremium ?? 0) * 12 * healthcareFactor;
        wifeMedicarePremiums = (BASE_MEDICARE_PART_B + BASE_MEDICARE_PART_D) * 12 * healthcareFactor;
      }
    }

    if (actualRec?.preMedicareHealthcareCost !== undefined && actualRec?.preMedicareHealthcareCost !== null) {
      yourPreMedicareAnnual = actualRec.preMedicareHealthcareCost;
      wifePreMedicareAnnual = 0;
    }
    if (actualRec?.medicareBasePremiums !== undefined && actualRec?.medicareBasePremiums !== null) {
      yourMedicarePremiums = actualRec.medicareBasePremiums;
      wifeMedicarePremiums = 0;
    }

    const decMonthIdx = (year - simStartYear) * 12 + 11;
    const isYouWorkingDec = !youDeceased && (decMonthIdx < yourRetireMonthIdx) && ((inputs.you.activeSalary ?? 0) > 0);
    const isWifeWorkingDec = !wifeDeceased && !inputs.isSingleFiler && (decMonthIdx < wifeRetireMonthIdx) && ((inputs.wife.activeSalary ?? 0) > 0);

    const startYearMonthIdx = (year - simStartYear) * 12;

    // Determine planned annual healthcare OOP maximum allowance for this year
    let yourPlannedAnnualOOP = 0;
    for (let m = 0; m < 12; m++) {
      const mIdx = startYearMonthIdx + m;
      const isWorking = !youDeceased && (mIdx < yourRetireMonthIdx) && ((inputs.you.activeSalary ?? 0) > 0);
      const isSpouseWorking = !wifeDeceased && !inputs.isSingleFiler && (mIdx < wifeRetireMonthIdx) && ((inputs.wife.activeSalary ?? 0) > 0);
      
      if (!youDeceased && !isWorking) {
        if (mIdx < yourMedicareMonthIdx) {
          if (inputs.you.healthcare?.coveredByWorkingSpousePlan && isSpouseWorking) {
            // Covered under working spouse's employer plan
          } else {
            yourPlannedAnnualOOP += yourPreMedicareOOP / 12;
          }
        } else {
          yourPlannedAnnualOOP += yourMedicareOOP / 12;
        }
      }
    }

    let wifePlannedAnnualOOP = 0;
    for (let m = 0; m < 12; m++) {
      const mIdx = startYearMonthIdx + m;
      const isWorking = !wifeDeceased && !inputs.isSingleFiler && (mIdx < wifeRetireMonthIdx) && ((inputs.wife.activeSalary ?? 0) > 0);
      const isPrimaryWorking = !youDeceased && (mIdx < yourRetireMonthIdx) && ((inputs.you.activeSalary ?? 0) > 0);
      
      if (!wifeDeceased && !isWorking) {
        if (mIdx < wifeMedicareMonthIdx) {
          if (inputs.wife.healthcare?.coveredByWorkingSpousePlan && isPrimaryWorking) {
            // Covered under working spouse's employer plan
          } else {
            wifePlannedAnnualOOP += wifePreMedicareOOP / 12;
          }
        } else {
          wifePlannedAnnualOOP += wifeMedicareOOP / 12;
        }
      }
    }
    const plannedHealthcareOOP = yourPlannedAnnualOOP + wifePlannedAnnualOOP;

    let realizedHealthcareOOP = plannedHealthcareOOP;
    if (actualRec) {
      if (actualRec.healthcareOOP !== undefined && actualRec.healthcareOOP !== null) {
        realizedHealthcareOOP = actualRec.healthcareOOP;
      } else {
        realizedHealthcareOOP = 0;
      }
    }

    let plannedBaseLivingExpensesAnnual = inputs.annualLivingExpenses ?? 100000;
    let oneTimeCosts = 0;
    const monthlyLivingExpensesBase = new Array(12).fill(0);

    if (inputs.useDetailedExpenses && inputs.detailedExpenses) {
      const de = normalizeDetailedExpenses(inputs.detailedExpenses);
      const items = de.catalog?.items ?? [];
      const stateCosts = de.costs?.[activeState];
      const allCosts = de.costs?.['ALL'];
      const defaultStateCosts = de.costs?.[inputs.jurisdiction.currentState];
      const freqs = de.frequencies || {};

      let detailedRecurringAnnual = 0;
      for (const item of items) {
        const applies = !item.applicableStates || item.applicableStates.includes('ALL') || item.applicableStates.includes(activeState);
        if (!applies) continue;

        const cost = stateCosts?.[item.id] ?? allCosts?.[item.id] ?? defaultStateCosts?.[item.id] ?? 0;

        if (item.isOneTime) {
          const itemYear = item.targetYear ?? simStartYear;
          if (itemYear === year) {
            oneTimeCosts += cost;
            if (item.dueMonths && item.dueMonths.length > 0) {
              item.dueMonths.forEach((mNum) => {
                if (mNum >= 1 && mNum <= 12) {
                  monthlyLivingExpensesBase[mNum - 1] += cost;
                }
              });
            } else {
              monthlyLivingExpensesBase[0] += cost;
            }
          }
        } else {
          const freq = freqs[item.id] ?? item.defaultFrequency ?? 12;
          const annualItemCost = cost * freq;
          detailedRecurringAnnual += annualItemCost;

          if (freq === 12) {
            for (let m = 0; m < 12; m++) {
              monthlyLivingExpensesBase[m] += cost;
            }
          } else if (item.dueMonths && item.dueMonths.length > 0) {
            item.dueMonths.forEach((mNum) => {
              if (mNum >= 1 && mNum <= 12) {
                monthlyLivingExpensesBase[mNum - 1] += cost;
              }
            });
          } else {
            const monthlyPortion = annualItemCost / 12;
            for (let m = 0; m < 12; m++) {
              monthlyLivingExpensesBase[m] += monthlyPortion;
            }
          }
        }
      }

      plannedBaseLivingExpensesAnnual = detailedRecurringAnnual;

      for (let m = 0; m < 12; m++) {
        monthlyLivingExpensesBase[m] *= cpiFactor;
      }
    } else {
      const monthlyPortion = ((inputs.annualLivingExpenses ?? 100000) * cpiFactor) / 12;
      for (let m = 0; m < 12; m++) {
        monthlyLivingExpensesBase[m] = monthlyPortion;
      }
    }

    let baseLivingExpensesAnnual = plannedBaseLivingExpensesAnnual;
    if (actualRec) {
      if (actualRec.totalLivingExpenses !== undefined && actualRec.totalLivingExpenses !== null) {
        baseLivingExpensesAnnual = actualRec.totalLivingExpenses / (cpiFactor || 1);
        const currentSum = monthlyLivingExpensesBase.reduce((a, b) => a + b, 0);
        if (currentSum > 0) {
          const scale = actualRec.totalLivingExpenses / currentSum;
          for (let m = 0; m < 12; m++) monthlyLivingExpensesBase[m] *= scale;
        } else {
          for (let m = 0; m < 12; m++) monthlyLivingExpensesBase[m] = actualRec.totalLivingExpenses / 12;
        }
      } else {
        baseLivingExpensesAnnual = 0;
        for (let m = 0; m < 12; m++) monthlyLivingExpensesBase[m] = 0;
      }
    }

    // Dynamic Guardrail policy adjustment during forward simulation (post-actuals)
    let guardrailAdjustment = 0;
    if (!actualRec && inputs.guardrailSettings?.enabled && inputs.guardrailSettings?.applyToSimulation && ledger.length > 0) {
      const prevRow = ledger[ledger.length - 1];
      if (prevRow.actualSurplusGap !== undefined && prevRow.actualSurplusGap !== 0) {
        guardrailAdjustment = prevRow.permittedSpendingBonus || 0;
        baseLivingExpensesAnnual = Math.max(0, baseLivingExpensesAnnual + (guardrailAdjustment / (cpiFactor || 1)));
        if (plannedBaseLivingExpensesAnnual > 0) {
          const ratio = (baseLivingExpensesAnnual * cpiFactor) / (plannedBaseLivingExpensesAnnual * cpiFactor);
          for (let m = 0; m < 12; m++) monthlyLivingExpensesBase[m] *= ratio;
        }
      }
    }

    const targetRunwayMonths = inputs.bucketSettings?.cash?.targetRunwayMonths ?? 24;
    const bucket1LivingReserveAnnual = (targetRunwayMonths / 12) * plannedBaseLivingExpensesAnnual;
    const baseMinCashDollars = inputs.growthAssumptions.minCashReserveDollars !== undefined && inputs.growthAssumptions.minCashReserveDollars !== null
      ? inputs.growthAssumptions.minCashReserveDollars
      : bucket1LivingReserveAnnual;
    const minCashReserveTarget = Math.max(0, baseMinCashDollars * cpiFactor);

    // Declaring yearly loop scope variables
    let targetConversion = 0;
    let combinedRothConversion = 0;
    let yourConverted = 0;
    let wifeConverted = 0;
    let drawdownCash = 0;
    let drawdownTaxable = 0;
    let drawdownPreTax = 0;
    let drawdownRoth = 0;
    let capitalGainsTriggered = 0;
    let requestedCustomAmount: number | undefined = undefined;
    let isRothConversionCapped: boolean | undefined = undefined;
    let rothConversionShortfall: number | undefined = undefined;
    let nonQcdTithe = 0;

    // 1. Custom Roth Conversion Schedule
    if (inputs.rothConversionStrategy === 'custom') {
      const activeCustomScenario = inputs.customRothScenarios?.find(
        (s) => s.id === inputs.activeCustomScenarioId
      ) || inputs.customRothScenarios?.[0];

      if (activeCustomScenario && activeCustomScenario.schedule[year] !== undefined) {
        requestedCustomAmount = activeCustomScenario.schedule[year] || 0;
        targetConversion = requestedCustomAmount;
      }
    } 
    // 2. Flat Roth Conversion (pre-determined annual conversion executed on Jan 1)
    else if (inputs.rothConversionStrategy === 'flat' && year >= startYear && year <= endYear) {
      const conversionInflationFactor = Math.pow(1 + inputs.growthAssumptions.cpiInflationRate, year - startYear);
      targetConversion = inputs.annualRothConversion * conversionInflationFactor;
    }

    if (targetConversion > 0) {
      const totalAvailablePreTax = isSurvivorActive || youDeceased ? wifePreTax : (yourPreTax + (wifeDeceased ? 0 : wifePreTax));

      if (inputs.rothConversionStrategy === 'custom') {
        if (targetConversion > totalAvailablePreTax + 0.01) {
          isRothConversionCapped = true;
          rothConversionShortfall = Math.max(0, targetConversion - totalAvailablePreTax);
        } else {
          isRothConversionCapped = false;
        }
      }

      // Cap conversion by available pre-tax assets
      targetConversion = Math.min(targetConversion, totalAvailablePreTax);

      if (inputs.rothConversionStrategy === 'flat') {
        const estLiving = baseLivingExpensesAnnual * cpiFactor;
        const reserveFloor = (targetRunwayMonths / 12) * estLiving;
        const totalTaxable = (yourCash + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeCash)) +
          (yourTaxable + (wifeDeceased ? 0 : wifeTaxable));

        const capExcl = MD_PENSION_EXCLUSION_BASE_CAP * cpiFactor;
        const exclusionCapJohn = Math.max(0, capExcl - yourSSAnnualBase);
        const exclusionCapWife = Math.max(0, capExcl - wifeSSAnnualBase);
        const exclJohn = (!youDeceased && yourAge >= 65) ? Math.min(yourRMD, exclusionCapJohn) : 0;
        const exclWife = (!wifeDeceased && wifeAge >= 65) ? Math.min(wifeRMD, exclusionCapWife) : 0;
        const estMdPensionExcl = exclJohn + exclWife;

        const estDiv = (yourTaxable + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeTaxable)) * taxableDividendYield;
        const estInterest = (yourCash + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeCash)) * cashRate;
        const estBaselineOrdinary = (taxableYourSalary + taxableWifeSalary) + (yourRMD + wifeRMD) +
          (estDiv * taxableNonQualifiedPortion) + estInterest;
        const estCapitalGains = estDiv * (1 - taxableNonQualifiedPortion);
        const estTotalSS = (!youDeceased ? yourSSAnnualBase : 0) + (!wifeDeceased ? wifeSSAnnualBase : 0);

        const stdDeductionBase = isSingle ? FED_STANDARD_DEDUCTION_SINGLE * cpiFactor : FED_STANDARD_DEDUCTION_MFJ * cpiFactor;
        let ageAddition = 0;
        if (isSingle) {
          const activeSurvivorAge = inputs.isSingleFiler ? yourAge : wifeAge;
          if (activeSurvivorAge >= 65) ageAddition += 1950 * cpiFactor;
        } else {
          if (yourAge >= 65) ageAddition += 1650 * cpiFactor;
          if (!wifeDeceased && wifeAge >= 65) ageAddition += 1650 * cpiFactor;
        }
        const estStdDeductionTotal = stdDeductionBase + ageAddition;

        targetConversion = applyBucketLiquidityConstraintToConversion(
          targetConversion,
          totalTaxable,
          reserveFloor,
          estBaselineOrdinary,
          estCapitalGains,
          estTotalSS,
          isSingle,
          cpiFactor,
          estStdDeductionTotal,
          nonQcdTithe,
          activeState,
          estMdPensionExcl,
          effectiveLocalRate
        );
      }

      if (targetConversion > 0) {
        if (isSurvivorActive || youDeceased) {
          wifeConverted = Math.min(targetConversion, wifePreTax);
          wifePreTax -= wifeConverted;
          wifeRoth += wifeConverted;
        } else {
          const halfTarget = targetConversion / 2;
          const husbandDrawn = Math.min(halfTarget, yourPreTax);
          yourConverted += husbandDrawn;
          yourPreTax -= husbandDrawn;
          yourRoth += husbandDrawn;

          const wifeDrawn = Math.min(halfTarget, wifePreTax);
          wifeConverted += wifeDrawn;
          wifePreTax -= wifeDrawn;
          wifeRoth += wifeDrawn;

          const totalDrawn = husbandDrawn + wifeDrawn;
          const remainder = targetConversion - totalDrawn;
          if (remainder > 0.01) {
            if (yourPreTax > 0) {
              const extra = Math.min(remainder, yourPreTax);
              yourConverted += extra;
              yourPreTax -= extra;
              yourRoth += extra;
            } else if (wifePreTax > 0) {
              const extra = Math.min(remainder, wifePreTax);
              wifeConverted += extra;
              wifePreTax -= extra;
              wifeRoth += extra;
            }
          }
        }
        combinedRothConversion = yourConverted + wifeConverted;
      }
    }

    // Surcharges (lookback) with Form SSA-44 Life-Changing Event (Work Stoppage) support
    const isSSA44Enabled = inputs.fileSSA44LifeChangingEvent !== false && inputs.you.healthcare?.fileSSA44LifeChangingEvent !== false;
    let magiTwoYearsAgo = 0;
    let rawLookbackMAGI = 0;
    let isSSA44Applied = false;

    const isYouRetiredThisYear = youDeceased || (yourAge >= youRetireAge && yourWorkingMonthsThisYear < 12);
    const isWifeRetiredThisYear = wifeDeceased || inputs.isSingleFiler || (wifeAge >= wifeRetireAge && wifeWorkingMonthsThisYear < 12);

    const lookbackIndex = ledger.length - 2;
    if (lookbackIndex >= 0) {
      const lookbackRow = ledger[lookbackIndex];
      rawLookbackMAGI = lookbackRow.magi;
      const lookbackSalary = (lookbackRow.yourSalary ?? 0) + (lookbackRow.wifeSalary ?? 0);

      // Check if Form SSA-44 Life-Changing Event (Work Stoppage) resets the lookback MAGI
      if (isSSA44Enabled && lookbackSalary > 0 && (isYouRetiredThisYear || isWifeRetiredThisYear)) {
        // Exclude ceased pre-retirement wages from the 2-year lookback determination
        magiTwoYearsAgo = Math.max(0, rawLookbackMAGI - lookbackSalary);
        isSSA44Applied = true;
      } else {
        magiTwoYearsAgo = rawLookbackMAGI;
      }
    } else {
      const lookbackYear = year - 2;
      const explicitPriorMAGI = inputs.priorTaxReturnMAGI?.[lookbackYear] ?? inputs.actualTracking?.[lookbackYear]?.magi;
      if (explicitPriorMAGI !== undefined && explicitPriorMAGI !== null) {
        rawLookbackMAGI = explicitPriorMAGI;
        magiTwoYearsAgo = explicitPriorMAGI;
      } else {
        const lookbackYourAge = yourAge - 2;
        const lookbackWifeAge = wifeAge - 2;

        let estSS = 0;
        if (!youDeceased && lookbackYourAge >= (inputs.you.targetSSClaimingAge || 67)) estSS += yourSSAnnualBase;
        if (!wifeDeceased) {
          if (youDeceased) {
            if (lookbackWifeAge >= 60) estSS += wifeSurvivorSSBenefit;
          } else if (lookbackWifeAge >= (inputs.wife.targetSSClaimingAge || 67)) {
            estSS += Math.max(wifeSSAnnualBase, spousalSSAnnualFloor);
          }
        }

        let estRMD = 0;
        if (!youDeceased && lookbackYourAge >= yourRmdStartAge) estRMD += yourRMD;
        if (!wifeDeceased && lookbackWifeAge >= wifeRmdStartAge) estRMD += wifeRMD;

        const preSimYourSalary = inputs.you.activeSalary ?? 0;
        const preSimWifeSalary = (!inputs.isSingleFiler ? inputs.wife.activeSalary : 0) ?? 0;
        const preSimSalary = preSimYourSalary + preSimWifeSalary;

        const cashRate = inputs.growthAssumptions.cashYieldRate ?? inputs.growthAssumptions.fixedIncomeReturnRate;
        const estInterest = (yourCash + (wifeDeceased ? 0 : wifeCash)) * cashRate;
        const estDividends = (yourTaxable + (wifeDeceased ? 0 : wifeTaxable)) * taxableDividendYield;
        const baseNonSalaryIncome = estSS * 0.85 + estRMD + estDividends + estInterest;
        rawLookbackMAGI = preSimSalary + baseNonSalaryIncome;

        if (isSSA44Enabled && preSimSalary > 0 && (isYouRetiredThisYear || isWifeRetiredThisYear)) {
          magiTwoYearsAgo = baseNonSalaryIncome;
          isSSA44Applied = true;
        } else {
          magiTwoYearsAgo = rawLookbackMAGI;
        }
      }
    }

    let yourPartBSurcharge = 0;
    let yourPartDSurcharge = 0;
    let wifePartBSurcharge = 0;
    let wifePartDSurcharge = 0;
    let surchargeTier = 0;
    const irmaaTiers = (isSurvivorActive || inputs.isSingleFiler) ? IRMAA_TIERS_SINGLE : IRMAA_TIERS_MFJ;
    const lookbackCpi = (lookbackIndex >= 0) ? ledger[lookbackIndex].cpiFactor : cpiFactor;
    for (let i = irmaaTiers.length - 1; i >= 0; i--) {
      const prevTier = irmaaTiers[i - 1];
      const prevLimit = prevTier ? (prevTier.limit === Infinity ? Infinity : prevTier.limit * lookbackCpi) : 0;
      if (magiTwoYearsAgo > prevLimit) {
        surchargeTier = irmaaTiers[i].tierNumber;
        const basePartB = irmaaTiers[i].partBSurcharge * healthcareFactor;
        const basePartD = irmaaTiers[i].partDSurcharge * healthcareFactor;
        yourPartBSurcharge = basePartB;
        yourPartDSurcharge = basePartD;
        wifePartBSurcharge = basePartB;
        wifePartDSurcharge = basePartD;
        break;
      }
    }

    if (actualRec?.surchargeTier !== undefined && actualRec?.surchargeTier !== null) {
      surchargeTier = actualRec.surchargeTier;
      const tierDef = irmaaTiers.find((t) => t.tierNumber === surchargeTier) || irmaaTiers[0];
      const basePartB = tierDef.partBSurcharge * healthcareFactor;
      const basePartD = tierDef.partDSurcharge * healthcareFactor;
      yourPartBSurcharge = basePartB;
      yourPartDSurcharge = basePartD;
      wifePartBSurcharge = basePartB;
      wifePartDSurcharge = basePartD;
    }

    // Running monthly accumulators for ledger rollups
    let annualYourSalary = 0;
    let annualWifeSalary = 0;
    let annualYourSS = 0;
    let annualWifeSS = 0;
    let annualYourDividends = 0;
    let annualWifeDividends = 0;
    let annualYourInterest = 0;
    let annualWifeInterest = 0;
    let annualPreMedicarePremium = 0;
    let annualMedicareBasePremiums = 0;
    let annualMedicareSurcharges = 0;
    let annualLivingExpenses = 0;
    let annualHealthcareOOP = 0;
    let annualDrawdownCash = 0;
    let annualDrawdownTaxable = 0;
    let annualDrawdownPreTax = 0;
    let annualDrawdownRoth = 0;
    let annualYourTradDraw = 0;
    let annualWifeTradDraw = 0;
    let annualCapitalGainsTriggered = 0;

    let annualPreTaxGrowth = 0;
    let annualRothGrowth = 0;
    let annualTaxableGrowth = 0;

    let annualCashBuffer = 0;
    let yourMedicareMonthCount = 0;
    let wifeMedicareMonthCount = 0;
    let annualQcdAmount = 0;
    let yourAnnualQCD = 0;
    let wifeAnnualQCD = 0;
    let annualNonQcdTithe = 0;

    // Pre-compute baseline predictable tax and quarterly estimated tax vouchers
    const predictableSalary = Math.max(0, (annualYourGrossSalary + annualWifeGrossSalary) - annualTotal401k);
    const predictableSS = (!youDeceased && (startYearMonthIdx + 11 >= yourSSClaimMonthIdx) ? yourSSAnnualBase : 0) +
      (!wifeDeceased && (startYearMonthIdx + 11 >= wifeSSClaimMonthIdx) ? wifeSSAnnualBase : 0);
    const estTaxableTotal = yourTaxable + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeTaxable);
    const estDividends = estTaxableTotal * taxableDividendYield;
    const estOrdDividends = estDividends * taxableNonQualifiedPortion;
    const estCapGains = estDividends * (1 - taxableNonQualifiedPortion);
    const estCashTotal = yourCash + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeCash);
    const estInterest = estCashTotal * monthlyCashRate * 12;
    const predictableConversion = (inputs.rothConversionStrategy === 'flat' || inputs.rothConversionStrategy === 'custom') ? targetConversion : 0;

    const baseOrdinary = predictableSalary + (yourRMD + wifeRMD) + estOrdDividends + estInterest + predictableConversion;
    const baseOtherAGI = baseOrdinary + estCapGains;
    const estTaxableSS = calculateTaxableSS(predictableSS, baseOtherAGI, isSingle);
    const estFedAGI = baseOrdinary + estTaxableSS + estCapGains;

    const stdDeductionBaseYear = isSingle ? FED_STANDARD_DEDUCTION_SINGLE * cpiFactor : FED_STANDARD_DEDUCTION_MFJ * cpiFactor;
    let ageAdditionYear = 0;
    if (isSingle) {
      const activeSurvivorAge = inputs.isSingleFiler ? yourAge : wifeAge;
      if (activeSurvivorAge >= 65) ageAdditionYear += 1950 * cpiFactor;
    } else {
      if (yourAge >= 65) ageAdditionYear += 1650 * cpiFactor;
      if (!wifeDeceased && wifeAge >= 65) ageAdditionYear += 1650 * cpiFactor;
    }
    const standardDeductionTotalYear = stdDeductionBaseYear + ageAdditionYear;

    const capExclYear = MD_PENSION_EXCLUSION_BASE_CAP * cpiFactor;
    const exclCapJohn = Math.max(0, capExclYear - yourSSAnnualBase);
    const exclCapWife = Math.max(0, capExclYear - wifeSSAnnualBase);
    const exclJohnYear = (!youDeceased && yourAge >= 65) ? Math.min(yourRMD, exclCapJohn) : 0;
    const exclWifeYear = (!wifeDeceased && wifeAge >= 65) ? Math.min(wifeRMD, exclCapWife) : 0;
    const estMdPensionExclusion = exclJohnYear + exclWifeYear;

    const estStateTaxResult = calculateStateAndLocalTax(
      activeState,
      {
        fedAGI: estFedAGI,
        taxableSS: estTaxableSS,
        isSingle,
        cpiFactor,
        pensionExclusion: estMdPensionExclusion,
        ordinaryIncome: Math.max(0, estFedAGI - estCapGains),
        capitalGains: estCapGains,
        retirementDistributions: yourRMD + wifeRMD,
      },
      effectiveLocalRate
    );
    const estStateTax = estStateTaxResult.totalTax;
    const activeProfileEst = getStateTaxProfile(activeState);
    const saltCapYear = (activeProfileEst?.hasIncomeTax || effectiveLocalRate > 0) ? 10000 * cpiFactor : 0;
    const estItemized = Math.min(saltCapYear, estStateTax);
    const estDeduction = Math.max(standardDeductionTotalYear, estItemized);

    const estTaxableOrdinary = Math.max(0, estFedAGI - estCapGains - estDeduction);
    const { totalTax: estFedBaseTax } = calculateFedTaxWithLTCG(estTaxableOrdinary, estCapGains, isSingle, cpiFactor);
    const expectedAnnualTax = estFedBaseTax + estStateTax;

    const expectedNetTaxDue = Math.max(0, expectedAnnualTax - annualTotalTaxWithholding);
    const quarterlyEstimatedTax = expectedNetTaxDue / 4;
    let quarterlyEstimatedTaxesPaid = 0;

    // Monthly Loop: Months 0 to 11 (Unified across all 12 months)
    for (let month = 0; month < 12; month++) {
      const monthIdx = (year - simStartYear) * 12 + month;

      // Working flags
      const isYouWorking = !youDeceased && (monthIdx < yourRetireMonthIdx) && ((inputs.you.activeSalary ?? 0) > 0);
      const isWifeWorking = !wifeDeceased && !inputs.isSingleFiler && (monthIdx < wifeRetireMonthIdx) && ((inputs.wife.activeSalary ?? 0) > 0);

      // In working months, deposit 401(k) pre-tax contribution into pre-tax accounts
      if (isYouWorking && monthlyYour401k > 0) {
        yourPreTax += monthlyYour401k;
      }
      if (isWifeWorking && monthlyWife401k > 0) {
        wifePreTax += monthlyWife401k;
      }

      // Gross salaries for ledger rollups
      const curYourSalary = isYouWorking ? monthlyYourGrossSalary : 0;
      const curWifeSalary = isWifeWorking ? monthlyWifeGrossSalary : 0;
      annualYourSalary += curYourSalary;
      annualWifeSalary += curWifeSalary;

      // Social Security benefit
      let monthlyYourSS = 0;
      let monthlyWifeSS = 0;

      if (!youDeceased && (monthIdx >= yourSSClaimMonthIdx)) {
        monthlyYourSS = yourSSAnnualBase / 12;
      }
      if (!wifeDeceased) {
        if (youDeceased) {
          if (monthIdx >= wifeSurvivorMonthIdx) {
            monthlyWifeSS = wifeSurvivorSSBenefit / 12;
          }
        } else if (monthIdx >= wifeSSClaimMonthIdx) {
          const ownSS = wifeSSAnnualBase / 12;
          if (monthIdx >= yourSSClaimMonthIdx) {
            monthlyWifeSS = Math.max(ownSS, spousalSSAnnualFloor / 12);
          } else {
            monthlyWifeSS = ownSS;
          }
        }
      }

      annualYourSS += monthlyYourSS;
      annualWifeSS += monthlyWifeSS;

      // Dividends
      const monthlyYourDividends = youDeceased ? 0 : yourTaxable * taxableDividendYield / 12;
      const monthlyWifeDividends = wifeDeceased ? 0 : wifeTaxable * taxableDividendYield / 12;
      annualYourDividends += monthlyYourDividends;
      annualWifeDividends += monthlyWifeDividends;

      yourTaxable = Math.max(0, yourTaxable - monthlyYourDividends);
      wifeTaxable = Math.max(0, wifeTaxable - monthlyWifeDividends);

      // Tithing Engine (Positive Gains Reserve with Yale Hybrid Smoothed Rule on Growth)
      let monthlyQcd = 0;
      let monthlyNonQcd = 0;

      if (inputs.charitySettings?.enabled) {
        const targetRate = inputs.charitySettings.growthPercentage ?? 0.10;
        const totalTaxable = yourTaxable + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeTaxable);
        const totalPreTax = yourPreTax + (wifeDeceased || inputs.isSingleFiler ? 0 : wifePreTax);
        const totalRoth = yourRoth + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeRoth);
        const totalCash = yourCash + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeCash);
        const currentPortfolio = totalTaxable + totalPreTax + totalRoth + totalCash;

        // Portfolio expected annual return rate (weighted across accounts)
        const expectedAnnualReturnRate = currentPortfolio > 0
          ? ((totalTaxable * (taxableGrowthRate + taxableDividendYield)) +
             (totalPreTax * preTaxGrowthRate) +
             (totalRoth * rothGrowthRate) +
             (totalCash * cashRate)) / currentPortfolio
          : 0;

        // Baseline rate for reserve runway / initial capitalization
        const baselineRate = Math.max(0.05, expectedAnnualReturnRate);

        if (!isTitheInitialized) {
          const initialTargetAnnual = targetRate * currentPortfolio * baselineRate;
          const initialFloor = (inputs.charitySettings.minAnnualTithe ?? 0) * cpiFactor;
          titheReserveBank = Math.max(initialFloor, initialTargetAnnual);
          priorMonthlyTithe = titheReserveBank / 12;
          if (inputs.charitySettings.maxAnnualTithe !== null && inputs.charitySettings.maxAnnualTithe !== undefined && inputs.charitySettings.maxAnnualTithe > 0) {
            priorMonthlyTithe = Math.min(priorMonthlyTithe, (inputs.charitySettings.maxAnnualTithe * cpiFactor) / 12);
          }
          isTitheInitialized = true;
        }

        const monthlyInflation = Math.pow(1 + annualInflation, 1 / 12) - 1;
        // Target monthly tithe based on growth (first fruits) rather than total portfolio principal
        const targetAnnualGrowthTithe = targetRate * currentPortfolio * Math.max(0, expectedAnnualReturnRate);
        const targetMonthlyTithe = targetAnnualGrowthTithe / 12;

        const rawMonthlyTithe = (0.70 * priorMonthlyTithe * (1 + monthlyInflation)) + (0.30 * targetMonthlyTithe);
        let smoothedMonthlyTithe = rawMonthlyTithe;
        let monthlyFloor = 0;
        if (inputs.charitySettings.minAnnualTithe !== null && inputs.charitySettings.minAnnualTithe !== undefined && inputs.charitySettings.minAnnualTithe > 0) {
          monthlyFloor = (inputs.charitySettings.minAnnualTithe * cpiFactor) / 12;
          smoothedMonthlyTithe = Math.max(smoothedMonthlyTithe, monthlyFloor);
        }
        if (inputs.charitySettings.maxAnnualTithe !== null && inputs.charitySettings.maxAnnualTithe !== undefined && inputs.charitySettings.maxAnnualTithe > 0) {
          const maxMonthly = (inputs.charitySettings.maxAnnualTithe * cpiFactor) / 12;
          smoothedMonthlyTithe = Math.min(smoothedMonthlyTithe, maxMonthly);
          monthlyFloor = Math.min(monthlyFloor, maxMonthly);
        }

        // Bounded by available accumulated Tithe Reserve Bank, but guaranteeing at least the configured minimum floor as long as portfolio has assets
        let monthlyTithe = Math.max(monthlyFloor, Math.min(smoothedMonthlyTithe, titheReserveBank));
        if (currentPortfolio <= 0) {
          monthlyTithe = 0;
        } else {
          monthlyTithe = Math.min(monthlyTithe, currentPortfolio);
        }
        titheReserveBank = Math.max(0, titheReserveBank - monthlyTithe);
        priorMonthlyTithe = monthlyTithe > 0 ? monthlyTithe : (priorMonthlyTithe * 0.90);

        let remTithe = monthlyTithe;
        const useQCD = inputs.charitySettings.useQCD !== false;
        const your70_5_MonthIdx = (yourBirthYear + 70 - simStartYear) * 12 + yourBirthMonth + 6;
        const wife70_5_MonthIdx = (wifeBirthYear + 70 - simStartYear) * 12 + wifeBirthMonth + 6;
        const isYouQCDEligible = !youDeceased && (monthIdx >= your70_5_MonthIdx);
        const isWifeQCDEligible = !wifeDeceased && !inputs.isSingleFiler && (monthIdx >= wife70_5_MonthIdx);
        const qcdLimit = BASE_QCD_LIMIT * cpiFactor;

        if (useQCD && remTithe > 0) {
          // Primary Traditional IRA QCD
          if (isYouQCDEligible && yourPreTax > 0 && yourAnnualQCD < qcdLimit) {
            const draw = Math.min(remTithe, qcdLimit - yourAnnualQCD, yourPreTax);
            yourPreTax -= draw;
            yourAnnualQCD += draw;
            remTithe -= draw;
            monthlyQcd += draw;
          }
          // Secondary Spouse Traditional IRA QCD
          if (remTithe > 0 && isWifeQCDEligible && wifePreTax > 0 && wifeAnnualQCD < qcdLimit) {
            const draw = Math.min(remTithe, qcdLimit - wifeAnnualQCD, wifePreTax);
            wifePreTax -= draw;
            wifeAnnualQCD += draw;
            remTithe -= draw;
            monthlyQcd += draw;
          }
        }
        monthlyNonQcd = remTithe;
      }
      annualQcdAmount += monthlyQcd;
      annualNonQcdTithe += monthlyNonQcd;

      // Pro-rated monthly RMD distributions (cash distribution is reduced by any QCD offsetting)
      let monthlyYourRmdDraw = 0;
      let monthlyWifeRmdDraw = 0;
      if (yourRMD > 0 && yourPreTax > 0) {
        const targetMonthlyRMD = yourRMD / 12;
        const cashRmdDraw = Math.max(0, targetMonthlyRMD - monthlyQcd);
        monthlyYourRmdDraw = Math.min(cashRmdDraw, yourPreTax);
        yourPreTax -= monthlyYourRmdDraw;
      }
      if (wifeRMD > 0 && wifePreTax > 0) {
        const targetMonthlyRMD = wifeRMD / 12;
        const spouseQcdOffset = monthlyQcd > 0 ? Math.max(0, monthlyQcd - (yourRMD / 12)) : 0;
        const cashRmdDraw = Math.max(0, targetMonthlyRMD - spouseQcdOffset);
        monthlyWifeRmdDraw = Math.min(cashRmdDraw, wifePreTax);
        wifePreTax -= monthlyWifeRmdDraw;
      }

      // Base expenses
      const monthlyBaseExpenses = monthlyLivingExpensesBase[month];
      let monthlyYourOOP = 0;
      let monthlyWifeOOP = 0;
      if (actualRec) {
        const monthlyActualOOP = realizedHealthcareOOP / 12;
        monthlyYourOOP = (wifeDeceased || inputs.isSingleFiler) ? monthlyActualOOP : (monthlyActualOOP / 2);
        monthlyWifeOOP = (!wifeDeceased && !inputs.isSingleFiler) ? (monthlyActualOOP / 2) : 0;
      } else {
        if (!youDeceased && !isYouWorking) {
          if (monthIdx < yourMedicareMonthIdx) {
            if (inputs.you.healthcare?.coveredByWorkingSpousePlan && isWifeWorking) {
              monthlyYourOOP = 0;
            } else {
              monthlyYourOOP = yourPreMedicareOOP / 12;
            }
          } else {
            monthlyYourOOP = yourMedicareOOP / 12;
          }
        }
        if (!wifeDeceased && !isWifeWorking) {
          if (monthIdx < wifeMedicareMonthIdx) {
            if (inputs.wife.healthcare?.coveredByWorkingSpousePlan && isYouWorking) {
              monthlyWifeOOP = 0;
            } else {
              monthlyWifeOOP = wifePreMedicareOOP / 12;
            }
          } else {
            monthlyWifeOOP = wifeMedicareOOP / 12;
          }
        }
      }
      annualHealthcareOOP += monthlyYourOOP + monthlyWifeOOP;
      const monthlyLiving = monthlyBaseExpenses + monthlyYourOOP + monthlyWifeOOP;
      annualLivingExpenses += monthlyLiving;

      // Premiums & IRMAA Surcharges (Strict qualification: Medicare enrolled & not active employer plan)
      const youEligibleForMedicare = !youDeceased && (monthIdx >= yourMedicareMonthIdx) && !isYouWorking && !(inputs.you.healthcare?.coveredByWorkingSpousePlan && isWifeWorking);
      const wifeEligibleForMedicare = !wifeDeceased && !inputs.isSingleFiler && (monthIdx >= wifeMedicareMonthIdx) && !isWifeWorking && !(inputs.wife.healthcare?.coveredByWorkingSpousePlan && isYouWorking);

      let monthlyYourPremium = 0;
      let monthlyYourSurcharge = 0;
      if (youEligibleForMedicare) {
        monthlyYourPremium = yourMedicarePremiums / 12;
        monthlyYourSurcharge = yourPartBSurcharge + yourPartDSurcharge;
        yourMedicareMonthCount++;
      } else if (!youDeceased && !isYouWorking && !(inputs.you.healthcare?.coveredByWorkingSpousePlan && isWifeWorking)) {
        monthlyYourPremium = yourPreMedicareAnnual / 12;
        monthlyYourSurcharge = 0;
      }

      let monthlyWifePremium = 0;
      let monthlyWifeSurcharge = 0;
      if (wifeEligibleForMedicare) {
        monthlyWifePremium = wifeMedicarePremiums / 12;
        monthlyWifeSurcharge = wifePartBSurcharge + wifePartDSurcharge;
        wifeMedicareMonthCount++;
      } else if (!wifeDeceased && !isWifeWorking && !(inputs.wife.healthcare?.coveredByWorkingSpousePlan && isYouWorking)) {
        monthlyWifePremium = wifePreMedicareAnnual / 12;
        monthlyWifeSurcharge = 0;
      }

      const monthlyPreMed = (!youEligibleForMedicare && !youDeceased && !isYouWorking && !(inputs.you.healthcare?.coveredByWorkingSpousePlan && isWifeWorking) ? monthlyYourPremium : 0) +
        (!wifeEligibleForMedicare && !wifeDeceased && !isWifeWorking && !(inputs.wife.healthcare?.coveredByWorkingSpousePlan && isYouWorking) ? monthlyWifePremium : 0);
      const monthlyMedicare = (youEligibleForMedicare ? monthlyYourPremium : 0) + (wifeEligibleForMedicare ? monthlyWifePremium : 0);

      annualPreMedicarePremium += monthlyPreMed;
      annualMedicareBasePremiums += monthlyMedicare;
      annualMedicareSurcharges += monthlyYourSurcharge + monthlyWifeSurcharge;

      // Quarterly Estimated Tax Vouchers in April (month 3), June (5), September (8), and December (11)
      const isVoucherMonth = (month === 3 || month === 5 || month === 8 || month === 11);
      const voucherTax = isVoucherMonth ? quarterlyEstimatedTax : 0;
      quarterlyEstimatedTaxesPaid += voucherTax;

      // Monthly cash inflows available to spend
      const monthlyTakeHomeInflow = (isYouWorking ? monthlyYourNetSalary : 0) + (isWifeWorking ? monthlyWifeNetSalary : 0);
      const totalInflows = monthlyTakeHomeInflow + monthlyYourSS + monthlyWifeSS + monthlyYourRmdDraw + monthlyWifeRmdDraw + monthlyYourDividends + monthlyWifeDividends;
      const totalOutflows = monthlyLiving + monthlyPreMed + monthlyMedicare + monthlyYourSurcharge + monthlyWifeSurcharge + monthlyNonQcd + voucherTax;

      const netMonthlyCash = totalInflows - totalOutflows;
      if (netMonthlyCash > 0) {
        annualCashBuffer += netMonthlyCash;
      } else if (netMonthlyCash < 0) {
        let deficit = -netMonthlyCash;

        // Step 0: Draw from salary / RMD cash accumulated earlier this year in the transition buffer
        if (annualCashBuffer > 0) {
          const bufferDraw = Math.min(deficit, annualCashBuffer);
          annualCashBuffer -= bufferDraw;
          deficit -= bufferDraw;
        }

        // Step 1: Draw from pre-existing Cash savings
        // In bear markets (negative equity return), freeze equity sales from brokerage and allow cash
        // runway to deplete to absorb living deficits. In up markets, protect the minCashReserveTarget floor.
        const isBearMarket = equityRate < 0;
        if (deficit > 0) {
          const currentTotalCash = (youDeceased ? 0 : yourCash) + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeCash);
          const availableCashForDraw = isBearMarket ? currentTotalCash : Math.max(0, currentTotalCash - minCashReserveTarget);

          if (availableCashForDraw > 0) {
            if (!youDeceased && yourCash > 0) {
              const draw = Math.min(deficit, availableCashForDraw, yourCash);
              annualDrawdownCash += draw;
              deficit -= draw;
              yourCash -= draw;
            }
            if (deficit > 0 && !wifeDeceased && wifeCash > 0) {
              const remAvail = isBearMarket ? wifeCash : Math.max(0, (yourCash + wifeCash) - minCashReserveTarget);
              const draw = Math.min(deficit, remAvail, wifeCash);
              annualDrawdownCash += draw;
              deficit -= draw;
              wifeCash -= draw;
            }
          }
        }

        // Step 2: Brokerage second
        if (deficit > 0) {
          if (!youDeceased && yourTaxable > 0) {
            const draw = Math.min(deficit, yourTaxable);
            const basisRatio = yourTaxable > 0 ? (yourBasis / yourTaxable) : 0;
            annualCapitalGainsTriggered += Math.max(0, draw * (1 - basisRatio));
            annualDrawdownTaxable += draw;
            deficit -= draw;
            yourTaxable -= draw;
            yourBasis -= draw * basisRatio;
          }
          if (deficit > 0 && wifeTaxable > 0) {
            const draw = Math.min(deficit, wifeTaxable);
            const basisRatio = wifeTaxable > 0 ? (wifeBasis / wifeTaxable) : 0;
            annualCapitalGainsTriggered += Math.max(0, draw * (1 - basisRatio));
            annualDrawdownTaxable += draw;
            deficit -= draw;
            wifeTaxable -= draw;
            wifeBasis -= draw * basisRatio;
          }
        }

        // Step 3: Discretionary Pre-tax IRA drawdowns
        if (deficit > 0) {
          if (!youDeceased && yourPreTax > 0) {
            const draw = Math.min(deficit, yourPreTax);
            annualYourTradDraw += draw;
            annualDrawdownPreTax += draw;
            deficit -= draw;
            yourPreTax -= draw;
          }
          if (deficit > 0 && !wifeDeceased && wifePreTax > 0) {
            const draw = Math.min(deficit, wifePreTax);
            annualWifeTradDraw += draw;
            annualDrawdownPreTax += draw;
            deficit -= draw;
            wifePreTax -= draw;
          }
        }

        // Step 4: Roth fourth
        if (deficit > 0) {
          if (!youDeceased && yourRoth > 0) {
            const draw = Math.min(deficit, yourRoth);
            annualDrawdownRoth += draw;
            deficit -= draw;
            yourRoth -= draw;
          }
          if (deficit > 0 && wifeRoth > 0) {
            const draw = Math.min(deficit, wifeRoth);
            annualDrawdownRoth += draw;
            deficit -= draw;
            wifeRoth -= draw;
          }
        }

        // Step 5: Emergency Cash Fallback (if Brokerage, Pre-Tax, and Roth are exhausted, draw remaining core cash reserve)
        if (deficit > 0) {
          if (!youDeceased && yourCash > 0) {
            const draw = Math.min(deficit, yourCash);
            annualDrawdownCash += draw;
            deficit -= draw;
            yourCash -= draw;
          }
          if (deficit > 0 && wifeCash > 0) {
            const draw = Math.min(deficit, wifeCash);
            annualDrawdownCash += draw;
            deficit -= draw;
            wifeCash -= draw;
          }
        }
      }

      // Apply monthly growth at the end of the month
      const startPreTax = yourPreTax + wifePreTax;
      const startRoth = yourRoth + wifeRoth;
      const startTaxable = yourTaxable + wifeTaxable;

      yourTaxable = yourTaxable * (1 + monthlyTaxableRate);
      yourBasis = Math.max(0, yourBasis);
      yourPreTax = yourPreTax * (1 + monthlyPreTaxRate);
      yourRoth = yourRoth * (1 + monthlyRothRate);

      const yourInterest = youDeceased ? 0 : yourCash * monthlyCashRate;
      annualYourInterest += yourInterest;
      yourCash = yourCash + yourInterest;

      wifeTaxable = wifeTaxable * (1 + monthlyTaxableRate);
      wifeBasis = Math.max(0, wifeBasis);
      wifePreTax = wifePreTax * (1 + monthlyPreTaxRate);
      wifeRoth = wifeRoth * (1 + monthlyRothRate);

      const wifeInterest = wifeDeceased ? 0 : wifeCash * monthlyCashRate;
      annualWifeInterest += wifeInterest;
      wifeCash = wifeCash + wifeInterest;

      // Unspent intra-year cash buffer and dividend float earns monthly cash yield
      let bufferInterest = 0;
      if (annualCashBuffer > 0 && monthlyCashRate > 0) {
        bufferInterest = annualCashBuffer * monthlyCashRate;
        annualCashBuffer += bufferInterest;
        if (!youDeceased) {
          annualYourInterest += bufferInterest;
        } else if (!wifeDeceased && !inputs.isSingleFiler) {
          annualWifeInterest += bufferInterest;
        }
      }

      const monthlyPreTaxGain = (yourPreTax + wifePreTax) - startPreTax;
      const monthlyRothGain = (yourRoth + wifeRoth) - startRoth;
      const monthlyTaxableGain = (yourTaxable + wifeTaxable) - startTaxable;
      const monthlyDivGain = monthlyYourDividends + monthlyWifeDividends;
      const monthlyIntGain = yourInterest + wifeInterest + bufferInterest;
      const totalMonthlyInvestmentReturn = monthlyPreTaxGain + monthlyRothGain + monthlyTaxableGain + monthlyDivGain + monthlyIntGain;

      if (inputs.charitySettings?.enabled && totalMonthlyInvestmentReturn > 0) {
        const targetRate = inputs.charitySettings.growthPercentage ?? 0.10;
        titheReserveBank += targetRate * totalMonthlyInvestmentReturn;
      }

      annualPreTaxGrowth += monthlyPreTaxGain;
      annualRothGrowth += monthlyRothGain;
      annualTaxableGrowth += monthlyTaxableGain;
    }

    // ---------------------------------------------------------
    // Post-Compounding Year-End Settlement (Month 11 true-up)
    // ---------------------------------------------------------

    // Under IRS rules, QCDs satisfy statutory RMDs dollar-for-dollar
    const taxableYourRMD = Math.max(0, yourRMD - yourAnnualQCD);
    const taxableWifeRMD = Math.max(0, wifeRMD - wifeAnnualQCD);
    const taxableCombinedRMD = taxableYourRMD + taxableWifeRMD;

    // 1. Fill-to-Target Roth Conversion (executed with full hindsight of realized income/gains)
    if (year >= startYear && year <= endYear && inputs.rothConversionStrategy === 'fill-to-target' && inputs.rothConversionTargetValue !== null) {
      const presetInfo = getTargetPresetInfo(inputs.rothConversionTargetValue);
      const isBracketTarget = presetInfo?.type === 'bracket';

      const totalDividendsRealized = annualYourDividends + annualWifeDividends;
      const qualifiedDividendsRealized = totalDividendsRealized * (1 - taxableNonQualifiedPortion);
      const ordinaryDividendsRealized = totalDividendsRealized * taxableNonQualifiedPortion;
      const currentCapitalGains = annualCapitalGainsTriggered + qualifiedDividendsRealized;
      const currentTradDraw = annualYourTradDraw + annualWifeTradDraw;
      const currentInterest = annualYourInterest + annualWifeInterest;
      const currentBaselineOrdinary = (annualYourSalary + annualWifeSalary - annualTotal401k) +
        taxableCombinedRMD + ordinaryDividendsRealized + currentInterest + currentTradDraw;

      const stdDeductionBase = isSingle ? FED_STANDARD_DEDUCTION_SINGLE * cpiFactor : FED_STANDARD_DEDUCTION_MFJ * cpiFactor;
      let ageAddition = 0;
      if (isSingle) {
        const activeSurvivorAge = inputs.isSingleFiler ? yourAge : wifeAge;
        if (activeSurvivorAge >= 65) ageAddition += 1950 * cpiFactor;
      } else {
        if (yourAge >= 65) ageAddition += 1650 * cpiFactor;
        if (!wifeDeceased && wifeAge >= 65) ageAddition += 1650 * cpiFactor;
      }
      const currentStdDeduction = stdDeductionBase + ageAddition;
      const activeProfileMid = getStateTaxProfile(activeState);
      const saltCap = (activeProfileMid?.hasIncomeTax || effectiveLocalRate > 0) ? 10000 * cpiFactor : 0;
      const estimatedItemized = saltCap + annualNonQcdTithe;
      const effectiveDeduction = Math.max(currentStdDeduction, estimatedItemized);

      let targetAGI: number;
      if (isBracketTarget && presetInfo) {
        const targetTaxable = (isSingle ? presetInfo.singleBase : presetInfo.jointBase) * cpiFactor;
        targetAGI = targetTaxable + effectiveDeduction;
      } else if (presetInfo) {
        const targetMAGI = (isSingle ? presetInfo.singleBase : presetInfo.jointBase) * cpiFactor;
        targetAGI = targetMAGI;
      } else {
        targetAGI = inputs.rothConversionTargetValue * cpiFactor;
      }

      targetConversion = solveRothConversionForTargetAGI(
        targetAGI,
        currentBaselineOrdinary,
        currentCapitalGains,
        annualYourSS + annualWifeSS,
        isSingle
      );

      // Bucket 1 Liquidity Constraint
      if (targetConversion > 0) {
        const estLiving = baseLivingExpensesAnnual * cpiFactor;
        const reserveFloor = (targetRunwayMonths / 12) * estLiving;
        const totalTaxable = (yourCash + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeCash)) +
          (yourTaxable + (wifeDeceased ? 0 : wifeTaxable));

        const capExcl = MD_PENSION_EXCLUSION_BASE_CAP * cpiFactor;
        const exclusionCapJohn = Math.max(0, capExcl - annualYourSS);
        const exclusionCapWife = Math.max(0, capExcl - annualWifeSS);
        const exclJohn = (!youDeceased && yourAge >= 65) ? Math.min(taxableYourRMD + annualYourTradDraw, exclusionCapJohn) : 0;
        const exclWife = (!wifeDeceased && wifeAge >= 65) ? Math.min(taxableWifeRMD + annualWifeTradDraw, exclusionCapWife) : 0;
        const estMdPensionExcl = exclJohn + exclWife;

        targetConversion = applyBucketLiquidityConstraintToConversion(
          targetConversion,
          totalTaxable,
          reserveFloor,
          currentBaselineOrdinary,
          currentCapitalGains,
          annualYourSS + annualWifeSS,
          isSingle,
          cpiFactor,
          effectiveDeduction,
          annualNonQcdTithe,
          activeState,
          estMdPensionExcl,
          effectiveLocalRate
        );
      }

      if (targetConversion > 0) {
        const totalAvailablePreTax = isSurvivorActive || youDeceased ? wifePreTax : (yourPreTax + (wifeDeceased ? 0 : wifePreTax));
        if (targetConversion > totalAvailablePreTax + 0.01) {
          isRothConversionCapped = true;
          rothConversionShortfall = Math.max(0, targetConversion - totalAvailablePreTax);
          targetConversion = totalAvailablePreTax;
        } else {
          isRothConversionCapped = false;
        }

        if (isSurvivorActive || youDeceased) {
          wifeConverted = Math.min(targetConversion, wifePreTax);
          wifePreTax -= wifeConverted;
          wifeRoth += wifeConverted;
        } else {
          const halfTarget = targetConversion / 2;
          const husbandDrawn = Math.min(halfTarget, yourPreTax);
          yourConverted += husbandDrawn;
          yourPreTax -= husbandDrawn;
          yourRoth += husbandDrawn;

          const wifeDrawn = Math.min(halfTarget, wifePreTax);
          wifeConverted += wifeDrawn;
          wifePreTax -= wifeDrawn;
          wifeRoth += wifeDrawn;

          const totalDrawn = husbandDrawn + wifeDrawn;
          const remainder = targetConversion - totalDrawn;
          if (remainder > 0.01) {
            if (yourPreTax > 0) {
              const extra = Math.min(remainder, yourPreTax);
              yourConverted += extra;
              yourPreTax -= extra;
              yourRoth += extra;
            } else if (wifePreTax > 0) {
              const extra = Math.min(remainder, wifePreTax);
              wifeConverted += extra;
              wifePreTax -= extra;
              wifeRoth += extra;
            }
          }
        }
      }
      combinedRothConversion = yourConverted + wifeConverted;
    }

    // 2. Compute Exact Final Taxes
    const totalSS = annualYourSS + annualWifeSS;
    const grossSalary = annualYourSalary + annualWifeSalary;
    const taxableSalary = Math.max(0, grossSalary - annualTotal401k);
    const rmd = taxableCombinedRMD;
    const rothConv = combinedRothConversion;
    const tradDraw = annualYourTradDraw + annualWifeTradDraw;
    const totalDividends = annualYourDividends + annualWifeDividends;
    const ordinaryDividends = totalDividends * taxableNonQualifiedPortion;
    const qualifiedDividends = totalDividends * (1 - taxableNonQualifiedPortion);
    const totalCashInterest = annualYourInterest + annualWifeInterest;

    const nonSSOrdinary = taxableSalary + rmd + rothConv + ordinaryDividends + totalCashInterest + tradDraw;
    const capitalGains = annualCapitalGainsTriggered + qualifiedDividends;
    const otherAGI = nonSSOrdinary + capitalGains;
    const taxableSS = calculateTaxableSS(totalSS, otherAGI, isSingle);
    const fedAGI = nonSSOrdinary + taxableSS + capitalGains;

    const stdDeductionBaseFinal = isSingle ? FED_STANDARD_DEDUCTION_SINGLE * cpiFactor : FED_STANDARD_DEDUCTION_MFJ * cpiFactor;
    let ageAdditionFinal = 0;
    if (isSingle) {
      const activeSurvivorAge = inputs.isSingleFiler ? yourAge : wifeAge;
      if (activeSurvivorAge >= 65) ageAdditionFinal += 1950 * cpiFactor;
    } else {
      if (yourAge >= 65) ageAdditionFinal += 1650 * cpiFactor;
      if (!wifeDeceased && wifeAge >= 65) ageAdditionFinal += 1650 * cpiFactor;
    }
    const standardDeductionTotalFinal = stdDeductionBaseFinal + ageAdditionFinal;

    const capExclFinal = MD_PENSION_EXCLUSION_BASE_CAP * cpiFactor;
    const exclusionCapJohnFinal = Math.max(0, capExclFinal - annualYourSS);
    const exclusionCapWifeFinal = Math.max(0, capExclFinal - annualWifeSS);
    const exclJohnFinal = (!youDeceased && yourAge >= 65) ? Math.min(taxableYourRMD + annualYourTradDraw, exclusionCapJohnFinal) : 0;
    const exclWifeFinal = (!wifeDeceased && wifeAge >= 65) ? Math.min(taxableWifeRMD + annualWifeTradDraw, exclusionCapWifeFinal) : 0;
    const mdPensionExclusion = exclJohnFinal + exclWifeFinal;

    const stateTaxResult = calculateStateAndLocalTax(
      activeState,
      {
        fedAGI,
        taxableSS,
        isSingle,
        cpiFactor,
        pensionExclusion: mdPensionExclusion,
        ordinaryIncome: Math.max(0, fedAGI - capitalGains),
        capitalGains,
        retirementDistributions: taxableYourRMD + taxableWifeRMD + annualYourTradDraw + annualWifeTradDraw + combinedRothConversion,
      },
      effectiveLocalRate
    );
    const stateIncomeTax = stateTaxResult.totalTax;

    const saltCapFinal = 10000 * cpiFactor;
    const saltDeduction = Math.min(saltCapFinal, stateIncomeTax);
    const itemizedDeduction = saltDeduction + annualNonQcdTithe;
    const stdDeduction = Math.max(standardDeductionTotalFinal, itemizedDeduction);

    const taxableOrdinary = Math.max(0, fedAGI - capitalGains - stdDeduction);
    const { totalTax: fedBaseTax } = calculateFedTaxWithLTCG(taxableOrdinary, capitalGains, isSingle, cpiFactor);
    let fedIncomeTax = fedBaseTax;

    const niitThreshold = isSingle ? 200000 : 250000;
    const excessMAGI = Math.max(0, fedAGI - niitThreshold);
    const netInvestmentIncome = annualCapitalGainsTriggered + totalDividends;
    const niitBase = Math.min(netInvestmentIncome, excessMAGI);
    const niitTax = niitBase * 0.038;
    fedIncomeTax += niitTax;

    const totalTaxBill = fedIncomeTax + stateIncomeTax;

    // 3. Settle Net Tax Due / Refund
    const totalTaxesPaidDuringYear = annualTotalTaxWithholding + quarterlyEstimatedTaxesPaid;
    const netTaxSettlement = totalTaxBill - totalTaxesPaidDuringYear;

    if (netTaxSettlement > 0) {
      let deficit = netTaxSettlement;
      // Step 0: Buffer
      if (annualCashBuffer > 0) {
        const draw = Math.min(deficit, annualCashBuffer);
        annualCashBuffer -= draw;
        deficit -= draw;
      }
      // Step 1: Cash savings (in bear markets, pay from cash first; in up markets, protect minCashReserveTarget floor)
      if (deficit > 0) {
        const isBearMarket = equityRate < 0;
        const currentTotalCash = (youDeceased ? 0 : yourCash) + (wifeDeceased || inputs.isSingleFiler ? 0 : wifeCash);
        const availableCashForDraw = isBearMarket ? currentTotalCash : Math.max(0, currentTotalCash - minCashReserveTarget);
        if (availableCashForDraw > 0) {
          if (!youDeceased && yourCash > 0) {
            const draw = Math.min(deficit, availableCashForDraw, yourCash);
            annualDrawdownCash += draw;
            deficit -= draw;
            yourCash -= draw;
          }
          if (deficit > 0 && !wifeDeceased && wifeCash > 0) {
            const remAvail = isBearMarket ? wifeCash : Math.max(0, (yourCash + wifeCash) - minCashReserveTarget);
            const draw = Math.min(deficit, remAvail, wifeCash);
            annualDrawdownCash += draw;
            deficit -= draw;
            wifeCash -= draw;
          }
        }
      }
      // Step 2: Brokerage
      if (deficit > 0) {
        if (!youDeceased && yourTaxable > 0) {
          const draw = Math.min(deficit, yourTaxable);
          const basisRatio = yourTaxable > 0 ? (yourBasis / yourTaxable) : 0;
          annualCapitalGainsTriggered += Math.max(0, draw * (1 - basisRatio));
          annualDrawdownTaxable += draw;
          deficit -= draw;
          yourTaxable -= draw;
          yourBasis -= draw * basisRatio;
        }
        if (deficit > 0 && wifeTaxable > 0) {
          const draw = Math.min(deficit, wifeTaxable);
          const basisRatio = wifeTaxable > 0 ? (wifeBasis / wifeTaxable) : 0;
          annualCapitalGainsTriggered += Math.max(0, draw * (1 - basisRatio));
          annualDrawdownTaxable += draw;
          deficit -= draw;
          wifeTaxable -= draw;
          wifeBasis -= draw * basisRatio;
        }
      }
      // Step 3: Discretionary Pre-Tax
      if (deficit > 0) {
        if (!youDeceased && yourPreTax > 0) {
          const draw = Math.min(deficit, yourPreTax);
          annualYourTradDraw += draw;
          annualDrawdownPreTax += draw;
          deficit -= draw;
          yourPreTax -= draw;
        }
        if (deficit > 0 && !wifeDeceased && wifePreTax > 0) {
          const draw = Math.min(deficit, wifePreTax);
          annualWifeTradDraw += draw;
          annualDrawdownPreTax += draw;
          deficit -= draw;
          wifePreTax -= draw;
        }
      }
      // Step 4: Roth
      if (deficit > 0) {
        if (!youDeceased && yourRoth > 0) {
          const draw = Math.min(deficit, yourRoth);
          annualDrawdownRoth += draw;
          deficit -= draw;
          yourRoth -= draw;
        }
        if (deficit > 0 && wifeRoth > 0) {
          const draw = Math.min(deficit, wifeRoth);
          annualDrawdownRoth += draw;
          deficit -= draw;
          wifeRoth -= draw;
        }
      }
      // Step 5: Core Emergency Cash Fallback
      if (deficit > 0) {
        if (!youDeceased && yourCash > 0) {
          const draw = Math.min(deficit, yourCash);
          annualDrawdownCash += draw;
          deficit -= draw;
          yourCash -= draw;
        }
        if (deficit > 0 && wifeCash > 0) {
          const draw = Math.min(deficit, wifeCash);
          annualDrawdownCash += draw;
          deficit -= draw;
          wifeCash -= draw;
        }
      }
    } else if (netTaxSettlement < 0) {
      // Overpayment refund credited to buffer
      annualCashBuffer += (-netTaxSettlement);
    }

    // 4. Sweep remaining unspent annual surplus into Taxable Brokerage
    let reinvestedSurplus = 0;
    if (annualCashBuffer > 0) {
      reinvestedSurplus = annualCashBuffer;
      if (youDeceased && !wifeDeceased && !inputs.isSingleFiler) {
        wifeTaxable += annualCashBuffer;
        wifeBasis += annualCashBuffer;
      } else if (inputs.isSingleFiler || wifeDeceased) {
        yourTaxable += annualCashBuffer;
        yourBasis += annualCashBuffer;
      } else {
        const half = annualCashBuffer / 2;
        yourTaxable += half;
        yourBasis += half;
        wifeTaxable += half;
        wifeBasis += half;
      }
      annualCashBuffer = 0;
    }

    // Balance reconciliation overrides if this year is an actual record
    if (actualRec) {
      if (actualRec.endYourPreTaxIRA !== undefined && actualRec.endYourPreTaxIRA !== null) yourPreTax = actualRec.endYourPreTaxIRA;
      if (actualRec.endYourRothIRA !== undefined && actualRec.endYourRothIRA !== null) yourRoth = actualRec.endYourRothIRA;
      if (actualRec.endYourTaxableBrokerage !== undefined && actualRec.endYourTaxableBrokerage !== null) yourTaxable = actualRec.endYourTaxableBrokerage;
      if (actualRec.endYourTaxableBasis !== undefined && actualRec.endYourTaxableBasis !== null) yourBasis = actualRec.endYourTaxableBasis;
      if (actualRec.endYourCash !== undefined && actualRec.endYourCash !== null) yourCash = actualRec.endYourCash;

      if (actualRec.endWifePreTaxIRA !== undefined && actualRec.endWifePreTaxIRA !== null) wifePreTax = actualRec.endWifePreTaxIRA;
      if (actualRec.endWifeRothIRA !== undefined && actualRec.endWifeRothIRA !== null) wifeRoth = actualRec.endWifeRothIRA;
      if (actualRec.endWifeTaxableBrokerage !== undefined && actualRec.endWifeTaxableBrokerage !== null) wifeTaxable = actualRec.endWifeTaxableBrokerage;
      if (actualRec.endWifeTaxableBasis !== undefined && actualRec.endWifeTaxableBasis !== null) wifeBasis = actualRec.endWifeTaxableBasis;
      if (actualRec.endWifeCash !== undefined && actualRec.endWifeCash !== null) wifeCash = actualRec.endWifeCash;
    }

    // Negative checking safety
    if (yourTaxable < 0.01) { yourTaxable = 0; yourBasis = 0; }
    if (yourPreTax < 0.01) yourPreTax = 0;
    if (yourRoth < 0.01) yourRoth = 0;
    if (yourCash < 0.01) yourCash = 0;
    if (wifeTaxable < 0.01) { wifeTaxable = 0; wifeBasis = 0; }
    if (wifePreTax < 0.01) wifePreTax = 0;
    if (wifeRoth < 0.01) wifeRoth = 0;
    if (wifeCash < 0.01) wifeCash = 0;

    const totalPortfolioValue = yourTaxable + yourPreTax + yourRoth + yourCash + wifeTaxable + wifePreTax + wifeRoth + wifeCash;
    const portfolioGrowth = annualPreTaxGrowth + annualRothGrowth + annualTaxableGrowth + totalDividends + totalCashInterest;

    if (actualRec?.irmaaSurcharges !== undefined && actualRec?.irmaaSurcharges !== null) {
      annualMedicareSurcharges = actualRec.irmaaSurcharges;
    }

    const magi = (actualRec?.magi !== undefined && actualRec?.magi !== null) ? actualRec.magi : fedAGI;
    drawdownCash = annualDrawdownCash;
    drawdownTaxable = annualDrawdownTaxable;
    drawdownPreTax = annualDrawdownPreTax;
    drawdownRoth = annualDrawdownRoth;
    capitalGainsTriggered = annualCapitalGainsTriggered;

    let qcdTaxSavings = 0;
    if (annualQcdAmount > 0) {
      const marginalFedRate = fedAGI > (isSingle ? 100000 * cpiFactor : 200000 * cpiFactor) ? 0.22 : 0.12;
      const qcdProfile = getStateTaxProfile(activeState);
      const stateRate = qcdProfile?.hasIncomeTax ? (qcdProfile.effectiveTaxRateEstimate + effectiveLocalRate) : (effectiveLocalRate > 0 ? effectiveLocalRate : 0);
      qcdTaxSavings = annualQcdAmount * (marginalFedRate + stateRate);
    }

    let finalTotalTax = fedIncomeTax + stateIncomeTax;
    let finalFedTax = fedIncomeTax;
    let finalStateTax = stateIncomeTax;
    if (actualRec?.totalIncomeTax !== undefined && actualRec?.totalIncomeTax !== null) {
      finalTotalTax = actualRec.totalIncomeTax;
      finalFedTax = actualRec.totalIncomeTax;
      finalStateTax = 0;
    }

    const charitableTithe = annualQcdAmount + annualNonQcdTithe;
    const qcdAmount = annualQcdAmount;
    nonQcdTithe = annualNonQcdTithe;

    const totalExpenses = annualLivingExpenses + nonQcdTithe + finalTotalTax + annualMedicareBasePremiums + annualMedicareSurcharges + annualPreMedicarePremium;
    const incomeInflow = totalSS + taxableCombinedRMD + grossSalary + totalDividends;
    const deficit = Math.max(0, totalExpenses - incomeInflow);
    const netTakeHomeSalary = Math.max(0, grossSalary - annualTotal401k - annualTotalFICA - annualTotalTaxWithholding);

    // Guardrails calculation
    const plannedLivingExpenses = (plannedBaseLivingExpensesAnnual + oneTimeCosts) * cpiFactor + plannedHealthcareOOP;
    const hasActualSpendRecorded = Boolean(actualRec && (
      (actualRec.totalLivingExpenses !== undefined && actualRec.totalLivingExpenses !== null) ||
      (actualRec.healthcareOOP !== undefined && actualRec.healthcareOOP !== null)
    ));
    const spendingVariance = hasActualSpendRecorded
      ? (plannedLivingExpenses - annualLivingExpenses)
      : 0;
    const modeledGrowthRate = (preTaxEquityPortion * inputs.growthAssumptions.equityReturnRate) + ((1 - preTaxEquityPortion) * inputs.growthAssumptions.fixedIncomeReturnRate);
    const startYearPortfolio = (ledger.length > 0) ? ledger[ledger.length - 1].totalPortfolioValue : (
      (inputs.portfolio.yourPreTaxIRA || 0) + (inputs.portfolio.yourRothIRA || 0) + (inputs.portfolio.yourTaxableBrokerage || 0) + (inputs.portfolio.yourCash || 0) +
      (inputs.isSingleFiler ? 0 : ((inputs.portfolio.wifePreTaxIRA || 0) + (inputs.portfolio.wifeRothIRA || 0) + (inputs.portfolio.wifeTaxableBrokerage || 0) + (inputs.portfolio.wifeCash || 0)))
    );
    const estimatedBaselineGrowth = startYearPortfolio * modeledGrowthRate;
    const surplusGrowth = Math.max(0, portfolioGrowth - estimatedBaselineGrowth);
    const marketSurplusShare = (inputs.guardrailSettings?.marketSurplusSharePct ?? 0.10) * surplusGrowth;
    const actualSurplusGap = actualRec ? (spendingVariance + marketSurplusShare) : 0;
    const upperGuardrailLimit = plannedLivingExpenses * (1 + (inputs.guardrailSettings?.upperGuardrailPct ?? 0.15));
    const lowerGuardrailLimit = plannedLivingExpenses * (1 - (inputs.guardrailSettings?.lowerGuardrailPct ?? 0.15));
    const permittedSpendingBonus = actualRec ? Math.min(Math.max(0, actualSurplusGap), upperGuardrailLimit - plannedLivingExpenses) : 0;

    ledger.push({
      year,
      yourAge,
      wifeAge,
      yourSS: annualYourSS,
      wifeSS: annualWifeSS,
      yourRMD: taxableYourRMD,
      wifeRMD: taxableWifeRMD,
      yourSalary: annualYourSalary,
      wifeSalary: annualWifeSalary,
      employee401kContribution: annualTotal401k,
      ficaTaxesPaid: annualTotalFICA,
      incomeTaxWithheld: annualTotalTaxWithholding,
      quarterlyEstimatedTaxesPaid,
      netTakeHomeSalary,
      reinvestedSurplus,
      capitalGainsTriggered,
      intentionalRothConversion: combinedRothConversion,
      requestedCustomRothConversion: requestedCustomAmount,
      isRothConversionCapped,
      rothConversionShortfall,
      otherTaxableIncome: drawdownPreTax,
      magi,
      fedAGI,
      standardDeduction: stdDeduction,
      taxableIncome: Math.max(0, fedAGI - stdDeduction),
      fedIncomeTax: finalFedTax,
      stateIncomeTax: finalStateTax,
      totalIncomeTax: finalTotalTax,
      niitTax,
      taxableSS,
      taxableDividends: totalDividends,
      taxableInterest: totalCashInterest,
      cpiFactor,
      activeState,
      activeCounty,
      effectiveLocalTaxRate: effectiveLocalRate,
      magiTwoYearsAgo,
      rawLookbackMAGI,
      isSSA44Applied,
      surchargeTier,
      yourPartBSurcharge: yourMedicareMonthCount > 0 && !isYouWorkingDec ? yourPartBSurcharge : 0,
      yourPartDSurcharge: yourMedicareMonthCount > 0 && !isYouWorkingDec ? yourPartDSurcharge : 0,
      wifePartBSurcharge: wifeMedicareMonthCount > 0 && !isWifeWorkingDec ? wifePartBSurcharge : 0,
      wifePartDSurcharge: wifeMedicareMonthCount > 0 && !isWifeWorkingDec ? wifePartDSurcharge : 0,
      combinedSurchargeMonthly: (yourMedicareMonthCount > 0 && !isYouWorkingDec ? yourPartBSurcharge + yourPartDSurcharge : 0) + (wifeMedicareMonthCount > 0 && !isWifeWorkingDec ? wifePartBSurcharge + wifePartDSurcharge : 0),
      combinedSurchargeAnnual: annualMedicareSurcharges,
      livingExpenses: annualLivingExpenses,
      plannedBaseLivingExpenses: (plannedBaseLivingExpensesAnnual + oneTimeCosts) * cpiFactor,
      plannedLivingExpenses,
      healthcareOOP: annualHealthcareOOP,
      plannedHealthcareOOP,
      medicareBasePremiums: annualMedicareBasePremiums,
      preMedicareHealthcareCost: annualPreMedicarePremium,
      totalExpenses,
      incomeInflow,
      deficit,
      drawdownTaxable,
      drawdownPreTax,
      drawdownRoth,
      drawdownCash,
      portfolioGrowth,
      charitableTithe,
      qcdAmount,
      nonQcdTithe,
      qcdTaxSavings,
      titheReserveBank,
      endYourPreTaxIRA: yourPreTax,
      endYourRothIRA: yourRoth,
      endYourTaxableBrokerage: yourTaxable,
      endYourTaxableBasis: yourBasis,
      endYourCash: yourCash,
      endWifePreTaxIRA: wifePreTax,
      endWifeRothIRA: wifeRoth,
      endWifeTaxableBrokerage: wifeTaxable,
      endWifeTaxableBasis: wifeBasis,
      endWifeCash: wifeCash,
      totalPortfolioValue,
      isActual: Boolean(actualRec),
      isBridged: Boolean(isBridged),
      actualSurplusGap,
      guardrailUpperLimit: upperGuardrailLimit,
      guardrailLowerLimit: lowerGuardrailLimit,
      permittedSpendingBonus,
    });
  }
  
  return ledger;
}
