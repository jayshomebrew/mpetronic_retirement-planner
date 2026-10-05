import { describe, it, expect } from 'vitest';
import {
  calculateSSBenefit,
  calculateSpousalBenefit,
  calculateTaxableSS,
  solveRothConversionForTargetAGI,
  calculateFedTax,
  calculateMDStateTax,
  runRetirementSimulation,
  calculateFedTaxWithLTCG,
  getRMDStartAge,
} from './simulationEngine';
import { DEFAULT_DETAILED_EXPENSES, DEFAULT_EXPENSE_FREQUENCIES, normalizeDetailedExpenses, DetailedExpensesState, AppStateInputs } from '../types';

describe('calculateSSBenefit', () => {
  const PIA = 1000;

  it('should return 100% of PIA when claiming at Full Retirement Age (67)', () => {
    const benefit = calculateSSBenefit(PIA, 67);
    expect(benefit).toBeCloseTo(1000, 1);
  });

  it('should increase benefit by 8% per year delayed past FRA (67) up to age 70', () => {
    // 3 years delay: 3 * 8% = 24% increase
    const benefit70 = calculateSSBenefit(PIA, 70);
    expect(benefit70).toBeCloseTo(1240, 1);

    // Caps at 70 even if claimingAge is entered higher
    const benefit72 = calculateSSBenefit(PIA, 72);
    expect(benefit72).toBeCloseTo(1240, 1);
  });

  it('should apply the correct reduction schedule for early claiming', () => {
    // 3 years (36 months) early (age 64)
    // Reduction: 36 * (5/900) = 20%
    const benefit64 = calculateSSBenefit(PIA, 64);
    expect(benefit64).toBeCloseTo(800, 1);

    // 5 years (60 months) early (age 62)
    // Reduction: 36 * (5/900) + 24 * (5/1200) = 20% + 10% = 30%
    const benefit62 = calculateSSBenefit(PIA, 62);
    expect(benefit62).toBeCloseTo(700, 1);

    // Floors at age 62 claiming reduction even if claimingAge is entered lower
    const benefit60 = calculateSSBenefit(PIA, 60);
    expect(benefit60).toBeCloseTo(700, 1);
  });
});

describe('calculateSpousalBenefit', () => {
  const primaryPIA = 2000; // Base spousal benefit would be 1000 (50%)

  it('should return 50% of primary PIA at FRA (67)', () => {
    const benefit = calculateSpousalBenefit(primaryPIA, 67);
    expect(benefit).toBeCloseTo(1000, 1);
  });

  it('should not provide delayed credits past FRA (67)', () => {
    const benefit70 = calculateSpousalBenefit(primaryPIA, 70);
    expect(benefit70).toBeCloseTo(1000, 1);
  });

  it('should return 0 if primary PIA is 0 or negative', () => {
    expect(calculateSpousalBenefit(0, 67)).toBe(0);
    expect(calculateSpousalBenefit(-100, 67)).toBe(0);
  });

  it('should apply spousal early claim reduction schedule (25/36% first 36m, 5/12% next)', () => {
    // 3 years (36 months) early (age 64)
    // Reduction: 36 * (25/3600) = 25% reduction
    // Spousal benefit: 1000 * 0.75 = 750
    const benefit64 = calculateSpousalBenefit(primaryPIA, 64);
    expect(benefit64).toBeCloseTo(750, 1);

    // 5 years (60 months) early (age 62)
    // Reduction: 36 * (25/3600) + 24 * (5/1200) = 25% + 10% = 35% reduction
    // Spousal benefit: 1000 * 0.65 = 650
    const benefit62 = calculateSpousalBenefit(primaryPIA, 62);
    expect(benefit62).toBeCloseTo(650, 1);
  });
});

describe('calculateTaxableSS', () => {
  const totalSS = 10000;

  describe('Single filers', () => {
    it('should have 0% taxable SS when provisional income is <= $25,000', () => {
      // Provisional income: otherAGI + 0.5 * SS = 19000 + 5000 = 24000
      const taxable = calculateTaxableSS(totalSS, 19000, true);
      expect(taxable).toBe(0);
    });

    it('should calculate up to 50% taxable SS between $25,000 and $34,000 provisional income', () => {
      // Provisional income: 24000 + 5000 = 29000
      // Formula: min(0.5 * SS, 0.5 * (PI - 25000)) = min(5000, 0.5 * 4000) = 2000
      const taxable = calculateTaxableSS(totalSS, 24000, true);
      expect(taxable).toBeCloseTo(2000, 1);
    });

    it('should apply 85% rule correctly when provisional income is > $34,000', () => {
      // Provisional income: 45000 + 5000 = 50000
      // Base: min(4500, 0.5 * min(SS, 9000)) = min(4500, 4500) = 4500
      // Formula: min(0.85 * SS, base + 0.85 * (PI - 34000)) = min(8500, 4500 + 0.85 * 16000) = min(8500, 4500 + 13600) = 8500
      const taxable = calculateTaxableSS(totalSS, 45000, true);
      expect(taxable).toBeCloseTo(8500, 1);
    });
  });

  describe('MFJ filers', () => {
    it('should have 0% taxable SS when provisional income is <= $32,000', () => {
      // Provisional income: 26000 + 5000 = 31000
      const taxable = calculateTaxableSS(totalSS, 26000, false);
      expect(taxable).toBe(0);
    });

    it('should calculate up to 50% taxable SS between $32,000 and $44,000 provisional income', () => {
      // Provisional income: 33000 + 5000 = 38000
      // Formula: min(5000, 0.5 * 6000) = 3000
      const taxable = calculateTaxableSS(totalSS, 33000, false);
      expect(taxable).toBeCloseTo(3000, 1);
    });

    it('should apply 85% rule correctly when provisional income is > $44,000', () => {
      // Provisional income: 55000 + 5000 = 60000
      // Base: min(6000, 4500) = 4500
      // Formula: min(8500, 4500 + 0.85 * 16000) = 8500
      const taxable = calculateTaxableSS(totalSS, 55000, false);
      expect(taxable).toBeCloseTo(8500, 1);
    });
  });
});

describe('Tax calculations', () => {
  it('should calculate federal income tax correctly', () => {
    // 0 taxable income = 0 tax
    const zeroTax = calculateFedTax(0, false, 1.0);
    expect(zeroTax).toBe(0);

    // MFJ with 50,000 taxable income, 1.0 CPI factor
    // 2026 brackets MFJ: 10% on first $24,800, then 12% on the rest
    // Expected: 24800 * 0.10 + (50000 - 24800) * 0.12 = 2480 + 25200 * 0.12 = 2480 + 3024 = 5504
    const mfjTax = calculateFedTax(50000, false, 1.0);
    expect(mfjTax).toBeCloseTo(5504, 1);
  });

  it('should calculate Maryland state tax correctly with standard piggyback rate', () => {
    // AGI: 60000, taxableSS: 0, isSingle: false
    const mdTaxMFJ = calculateMDStateTax(60000, 0, false);
    expect(mdTaxMFJ).toBeGreaterThan(0);

    // AGI: 60000, taxableSS: 0, isSingle: true
    const mdTaxSingle = calculateMDStateTax(60000, 0, true);
    expect(mdTaxSingle).toBeGreaterThan(0);
  });
});

describe('runRetirementSimulation', () => {
  const getMockInputs = (): AppStateInputs => ({
    you: {
      name: 'John',
      birthDate: '1965-06-15',
      estimatedPIA: 2000,
      targetSSClaimingAge: 67,
      plannedRetirementAge: 65,
      activeSalary: 120000,
      preMedicareMonthlyPremium: 500,
    },
    wife: {
      name: 'Jane',
      birthDate: '1968-09-20',
      estimatedPIA: 1200,
      targetSSClaimingAge: 67,
      plannedRetirementAge: 62,
      activeSalary: 80000,
      preMedicareMonthlyPremium: 500,
    },
    portfolio: {
      yourPreTaxIRA: 500000,
      yourRothIRA: 100000,
      yourTaxableBrokerage: 200000,
      yourTaxableBasis: 150000,
      yourCash: 0,
      wifePreTaxIRA: 300000,
      wifeRothIRA: 50000,
      wifeTaxableBrokerage: 100000,
      wifeTaxableBasis: 80000,
      wifeCash: 0,
    },
    jurisdiction: {
      currentState: 'MD',
      targetState: 'FL',
      relocationYear: null,
    },
    growthAssumptions: {
      equityReturnRate: 0.07,
      fixedIncomeReturnRate: 0.04,
      cpiInflationRate: 0.025,
      healthcareInflationRate: 0.05,
    },
    annualLivingExpenses: 80000,
    annualRothConversion: 0,
    rothConversionStartYear: 2026,
    rothConversionEndYear: 2030,
    rothConversionStrategy: 'flat',
    rothConversionTargetValue: null,
    monteCarloSettings: {
      mode: 'monte-carlo',
      equityVolatility: 0.15,
      fixedIncomeVolatility: 0.05,
      correlation: 0.15,
      trials: 10,
      seed: 42,
    },
    isConfigured: true,
    isSingleFiler: false,
  });

  it('should run simulation and return a sequence of years starting from 2026', () => {
    const inputs = getMockInputs();
    const results = runRetirementSimulation(inputs);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].year).toBe(2026);
  });

  it('should correctly drop state income taxes to 0 when relocating to Florida', () => {
    const inputs = getMockInputs();
    // Relocate to Florida in 2030
    inputs.jurisdiction.relocationYear = 2030;
    inputs.jurisdiction.currentState = 'MD';
    inputs.jurisdiction.targetState = 'FL';

    const results = runRetirementSimulation(inputs);

    // Verify state taxes in MD (before 2030) are positive and become 0 starting in 2030
    const row2026 = results.find(r => r.year === 2026);
    const row2030 = results.find(r => r.year === 2030);

    expect(row2026).toBeDefined();
    expect(row2026!.stateIncomeTax).toBeGreaterThan(0);

    expect(row2030).toBeDefined();
    expect(row2030!.stateIncomeTax).toBe(0);
  });

  it('should calculate Social Security income starting at target claiming ages', () => {
    const inputs = getMockInputs();
    inputs.you.targetSSClaimingAge = 67; // John born 1965 => claims at 2032
    inputs.wife.targetSSClaimingAge = 66; // Jane born 1968 => claims at 2034

    const results = runRetirementSimulation(inputs);

    const row2026 = results.find(r => r.year === 2026); // John age 61, Jane age 58 => no SS
    const row2032 = results.find(r => r.year === 2032); // John age 67 => John claims SS
    const row2034 = results.find(r => r.year === 2034); // Jane age 66 => Jane claims SS

    expect(row2026!.yourSS).toBe(0);
    expect(row2026!.wifeSS).toBe(0);

    expect(row2032!.yourSS).toBeGreaterThan(0);
    expect(row2034!.wifeSS).toBeGreaterThan(0);
  });

  it('should calculate living expenses using detailed state-specific itemized entries and frequencies when useDetailedExpenses is true', () => {
    const inputs = getMockInputs();
    inputs.useDetailedExpenses = true;
    inputs.detailedExpenses = normalizeDetailedExpenses({
      MD: {
        ...DEFAULT_DETAILED_EXPENSES,
        amenityFee: 100, // Monthly
        water: 50,       // Monthly
        masterBedFurniture: 5000, // One-time
      },
      FL: {
        ...DEFAULT_DETAILED_EXPENSES,
        amenityFee: 150, // Monthly
        water: 60,       // Monthly
        masterBedFurniture: 8000, // One-time
      },
      frequencies: {
        ...DEFAULT_EXPENSE_FREQUENCIES,
        amenityFee: 12,
        water: 12,
      }
    });
    inputs.jurisdiction.currentState = 'MD';
    inputs.jurisdiction.targetState = 'FL';
    inputs.jurisdiction.relocationYear = 2030;

    const results = runRetirementSimulation(inputs);

    // In 2026 (first year, current state MD):
    // Recurring annual = (100 * 12) + (50 * 12) = 1200 + 600 = 1800
    // One-time MD = 5000
    // Total in 2026 (cpiFactor = 1.0) = 1800 + 5000 = 6800
    const row2026 = results.find(r => r.year === 2026);
    expect(row2026).toBeDefined();
    expect(row2026!.livingExpenses).toBeCloseTo(6800, 1);

    // In 2029 (still MD, cpiFactor):
    // Recurring annual = 1800 * cpiFactor
    // One-time = 0
    const row2029 = results.find(r => r.year === 2029);
    const cpiFactor2029 = Math.pow(1 + inputs.growthAssumptions.cpiInflationRate, 2029 - 2026);
    expect(row2029!.livingExpenses).toBeCloseTo(1800 * cpiFactor2029, 1);

    // In 2030 (relocated to FL, cpiFactor):
    // Recurring annual = (150 * 12) + (60 * 12) = 1800 + 720 = 2520
    // One-time occurred in 2026 start year, so 2030 has recurring base
    const row2030 = results.find(r => r.year === 2030);
    const cpiFactor2030 = Math.pow(1 + inputs.growthAssumptions.cpiInflationRate, 2030 - 2026);
    expect(row2030!.livingExpenses).toBeCloseTo(2520 * cpiFactor2030, 1);
  });

  it('should reinvest annual surplus cash inflows (when SS + RMD > total outflows) back into taxable brokerage accounts and cost basis', () => {
    const inputs = getMockInputs();
    
    // Tweak inputs to force a huge surplus:
    // Low annual living expenses, large starting pre-tax balances, high claiming age to trigger high RMDs
    inputs.annualLivingExpenses = 20000; // very low expenses
    inputs.you.estimatedPIA = 3500;
    inputs.you.targetSSClaimingAge = 70;
    inputs.wife.estimatedPIA = 3000;
    inputs.wife.targetSSClaimingAge = 70;
    
    // Large Traditional pre-tax IRAs to produce huge RMDs
    inputs.portfolio.yourPreTaxIRA = 5000000;
    inputs.portfolio.wifePreTaxIRA = 4000000;
    
    // Moderate taxable account to see the surplus addition clearly
    inputs.portfolio.yourTaxableBrokerage = 100000;
    inputs.portfolio.yourTaxableBasis = 80000;
    inputs.portfolio.wifeTaxableBrokerage = 50000;
    inputs.portfolio.wifeTaxableBasis = 40000;
    
    // Set retirement age so they are not earning salary at 75
    inputs.you.plannedRetirementAge = 60;
    inputs.wife.plannedRetirementAge = 60;

    const results = runRetirementSimulation(inputs);
    
    // RMDs start at Age 75. Let's find a year where RMDs are active (e.g. John age 75, born 1965 => year 2040)
    const row2040 = results.find(r => r.year === 2040);
    expect(row2040).toBeDefined();
    
    const totalSS = row2040!.yourSS + row2040!.wifeSS;
    const totalRMD = row2040!.yourRMD + row2040!.wifeRMD;
    const totalInflow = totalSS + totalRMD;
    const totalOutflow = row2040!.livingExpenses + row2040!.fedIncomeTax + row2040!.stateIncomeTax + row2040!.medicareBasePremiums + row2040!.combinedSurchargeAnnual + row2040!.preMedicareHealthcareCost;
    
    const surplus = totalInflow - totalOutflow;
    expect(surplus).toBeGreaterThan(0); // Confirm we set up a surplus year
    
    
    const actualEndTaxable = row2040!.endYourTaxableBrokerage + row2040!.endWifeTaxableBrokerage;
    // Expected value calibrated for the monthly-compounding engine without double-counted RMDs.
    expect(actualEndTaxable).toBeCloseTo(658264.9, 0);
  });

  it('should apply pre-Medicare premiums and detailed health expenses correctly based on age, work status, and retirement', () => {
    const inputs = getMockInputs();
    inputs.useDetailedExpenses = true;
    inputs.detailedExpenses = normalizeDetailedExpenses({
      MD: {
        ...DEFAULT_DETAILED_EXPENSES,
        pre65MedicalPremium: 400,
        pre65MedicalOOP: 1200,
        pre65DentalPremium: 30,
        pre65DentalOOP: 90,
        pre65VisionPremium: 20,
        pre65VisionOOP: 60,

        medicarePartDPremium: 40,
        medicarePartDDeductibleCopays: 300,
        supplementPremium: 150,
        supplementOOP: 300,
        post65HearingCare: 500,
        post65DentalPremium: 20,
        post65DentalOOP: 60,
        post65VisionPremium: 10,
        post65VisionOOP: 40,
      },
      FL: {
        ...DEFAULT_DETAILED_EXPENSES,
        pre65MedicalPremium: 350,
        pre65MedicalOOP: 1000,
        pre65DentalPremium: 25,
        pre65DentalOOP: 75,
        pre65VisionPremium: 15,
        pre65VisionOOP: 45,

        medicarePartDPremium: 35,
        medicarePartDDeductibleCopays: 250,
        supplementPremium: 130,
        supplementOOP: 230,
        post65HearingCare: 400,
        post65DentalPremium: 15,
        post65DentalOOP: 50,
        post65VisionPremium: 10,
        post65VisionOOP: 30,
      },
      frequencies: {
        ...DEFAULT_EXPENSE_FREQUENCIES,
        pre65MedicalPremium: 12,
        pre65MedicalOOP: 1,
        pre65DentalPremium: 12,
        pre65DentalOOP: 1,
        pre65VisionPremium: 12,
        pre65VisionOOP: 1,
        medicarePartBPremium: 12,
        medicarePartDPremium: 12,
        medicarePartDDeductibleCopays: 1,
        supplementPremium: 12,
        supplementOOP: 1,
        post65HearingCare: 1,
        post65DentalPremium: 12,
        post65DentalOOP: 1,
        post65VisionPremium: 12,
        post65VisionOOP: 1,
      }
    });

    // John: 62 => retired from 2027 onwards
    // Jane: 60 => retired from 2028 onwards
    inputs.you.plannedRetirementAge = 62;
    inputs.wife.plannedRetirementAge = 60;

    // Healthcare Config:
    inputs.you.healthcare = {
      medicarePartBPremium: 200,
      MD: {
        pre65MedicalPremium: 400,
        pre65MedicalOOP: 1200,
        pre65DentalPremium: 30,
        pre65DentalOOP: 90,
        pre65VisionPremium: 20,
        pre65VisionOOP: 60,

        medicarePartDPremium: 40,
        medicarePartDDeductibleCopays: 300,
        supplementPremium: 150,
        supplementOOP: 300,
        post65HearingCare: 500,
        post65DentalPremium: 20,
        post65DentalOOP: 60,
        post65VisionPremium: 10,
        post65VisionOOP: 40,
      },
      FL: {
        pre65MedicalPremium: 350,
        pre65MedicalOOP: 1000,
        pre65DentalPremium: 25,
        pre65DentalOOP: 75,
        pre65VisionPremium: 15,
        pre65VisionOOP: 45,

        medicarePartDPremium: 35,
        medicarePartDDeductibleCopays: 250,
        supplementPremium: 130,
        supplementOOP: 230,
        post65HearingCare: 400,
        post65DentalPremium: 15,
        post65DentalOOP: 50,
        post65VisionPremium: 10,
        post65VisionOOP: 30,
      }
    };

    inputs.wife.healthcare = {
      medicarePartBPremium: 200,
      MD: {
        pre65MedicalPremium: 300,
        pre65MedicalOOP: 1000,
        pre65DentalPremium: 15,
        pre65DentalOOP: 60,
        pre65VisionPremium: 15,
        pre65VisionOOP: 40,

        medicarePartDPremium: 30,
        medicarePartDDeductibleCopays: 250,
        supplementPremium: 120,
        supplementOOP: 230,
        post65HearingCare: 400,
        post65DentalPremium: 10,
        post65DentalOOP: 40,
        post65VisionPremium: 10,
        post65VisionOOP: 40,
      },
      FL: {
        pre65MedicalPremium: 280,
        pre65MedicalOOP: 900,
        pre65DentalPremium: 15,
        pre65DentalOOP: 50,
        pre65VisionPremium: 10,
        pre65VisionOOP: 30,

        medicarePartDPremium: 28,
        medicarePartDDeductibleCopays: 200,
        supplementPremium: 110,
        supplementOOP: 190,
        post65HearingCare: 350,
        post65DentalPremium: 10,
        post65DentalOOP: 40,
        post65VisionPremium: 8,
        post65VisionOOP: 30,
      }
    };

    inputs.you.birthDate = '1965-06-15';
    inputs.wife.birthDate = '1968-09-20';

    const results = runRetirementSimulation(inputs);

    // Years to test:
    // 2026: John is 61 (working, age < 62), Jane is 58 (working, age < 60)
    //       => both working, so healthcare costs (both pre-Medicare and detailed health) are ignored.
    const row2026 = results.find(r => r.year === 2026);
    expect(row2026!.preMedicareHealthcareCost).toBe(0);
    expect(row2026!.livingExpenses).toBe(0);

    // 2027: John is 62 (retired, under 65), Jane is 59 (working, age < 60)
    //       => John pays pre-Medicare premiums: (400 + 30) * 7 = 3150 * hcFactor. Jane is working, so 0.
    //       => John pays pre-Medicare OOP: (1200 + 90 + 60) * 7 / 12 * hcFactor = 787.5 * hcFactor.
    const row2027 = results.find(r => r.year === 2027);
    const hcFactor2027 = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, 2027 - 2026);
    expect(row2027!.preMedicareHealthcareCost).toBeCloseTo(3150 * hcFactor2027, 1);
    expect(row2027!.livingExpenses).toBeCloseTo(787.5 * hcFactor2027, 1);

    // 2028: John is 63 (retired, under 65), Jane is 60 (retired, under 65)
    //       => Both are retired & under 65.
    //       => John pre-Medicare Premium = 5400 * hcFactor, OOP = 1150 * hcFactor
    //       => Jane pre-Medicare Premium = 330 * 4 * hcFactor = 1320 * hcFactor
    const row2028 = results.find(r => r.year === 2028);
    const hcFactor2028 = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, 2028 - 2026);
    expect(row2028!.preMedicareHealthcareCost).toBeCloseTo(6720 * hcFactor2028, 1);
    expect(row2028!.livingExpenses).toBeCloseTo(1716.67 * hcFactor2028, 1);

    // 2030: John is 65 (on Medicare, retired), Jane is 62 (retired, under 65)
    //       => John turns 65 in June (retired for 7 months Medicare, 5 months pre-Medicare)
    //       => John pre-Medicare Premium: 5 months = 450 * 5 = 2250 * hcFactor
    //       => John pre-Medicare OOP: 5 months = 1150 / 12 * 5 = 479.167 * hcFactor
    //       => John Medicare Premium: 7 months = (200 + 40) * 7 + (150 + 30) * 7 * hcFactor = 1680 + 1260 * hcFactor
    //       => John Medicare OOP: 7 months = 1200 / 12 * 7 = 700 * hcFactor
    //       => Jane pre-Medicare Premium: 12 months = 330 * 12 = 3960 * hcFactor
    //       => Jane pre-Medicare OOP: 12 months = 900 * hcFactor
    //       => Combined pre-Medicare premium = (2250 + 3960) * hcFactor = 6210 * hcFactor
    //       => Combined Medicare base premium = 1680 + 1260 * hcFactor
    //       => Combined OOP = (479.167 + 700 + 900) * hcFactor = 2079.167 * hcFactor
    const row2030 = results.find(r => r.year === 2030);
    const hcFactor2030 = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, 2030 - 2026);
    expect(row2030!.preMedicareHealthcareCost).toBeCloseTo(6210 * hcFactor2030, 1);
    expect(row2030!.medicareBasePremiums).toBeCloseTo(2940 * hcFactor2030, 1);
    expect(row2030!.livingExpenses).toBeCloseTo(2362.5 * hcFactor2030, 1);

    // 2033: John is 68 (on Medicare, retired), Jane is 65 (on Medicare, retired)
    //       => John is on Medicare 12 months. Jane turns 65 in Sept (8 months pre-Medicare, 4 months Medicare).
    //       => Jane pre-Medicare Premium: 8 months = 330 * 8 = 2640 * hcFactor
    //       => Jane pre-Medicare OOP: 8 months = 900 / 12 * 8 = 600 * hcFactor
    //       => John Medicare premiums: (200 + 40 + 180) * 12 * hcFactor = 5040 * hcFactor
    //       => Jane Medicare premiums: (200 + 30 + 140) * 4 * hcFactor = 1480 * hcFactor
    //       => Combined Medicare base premium = 6520 * hcFactor
    //       => Combined OOP = (John Medicare OOP (1200) + Jane pre-Medicare OOP (600) + Jane Medicare OOP (320)) * hcFactor = 2120 * hcFactor
    const row2033 = results.find(r => r.year === 2033);
    const hcFactor2033 = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, 2033 - 2026);
    
    const johnPremiums = 5040 * hcFactor2033;
    const janePremiums = 1480 * hcFactor2033;
    
    expect(row2033!.preMedicareHealthcareCost).toBeCloseTo(2640 * hcFactor2033, 1);
    expect(row2033!.medicareBasePremiums).toBeCloseTo(johnPremiums + janePremiums, 1);
    expect(row2033!.livingExpenses).toBeCloseTo(2253.33 * hcFactor2033, 1);
  });

  it('should transition to target state healthcare costs upon relocation', () => {
    const inputs = getMockInputs();
    inputs.isSingleFiler = true;
    inputs.useDetailedExpenses = true;
    inputs.detailedExpenses = normalizeDetailedExpenses({
      MD: { ...DEFAULT_DETAILED_EXPENSES },
      FL: { ...DEFAULT_DETAILED_EXPENSES },
      frequencies: { ...DEFAULT_EXPENSE_FREQUENCIES }
    });

    inputs.you.birthDate = '1970-01-01'; // turns 65 in 2035.
    inputs.you.plannedRetirementAge = 60; // retired
    inputs.you.healthcare = {
      medicarePartBPremium: 200,
      MD: {
        pre65MedicalPremium: 500,
        pre65MedicalOOP: 1000,
        pre65DentalPremium: 20,
        pre65DentalOOP: 50,
        pre65VisionPremium: 10,
        pre65VisionOOP: 30,

        medicarePartDPremium: 40,
        medicarePartDDeductibleCopays: 300,
        supplementPremium: 150,
        supplementOOP: 300,
        post65HearingCare: 500,
        post65DentalPremium: 20,
        post65DentalOOP: 60,
        post65VisionPremium: 10,
        post65VisionOOP: 40,
      },
      FL: {
        pre65MedicalPremium: 400,
        pre65MedicalOOP: 800,
        pre65DentalPremium: 15,
        pre65DentalOOP: 40,
        pre65VisionPremium: 8,
        pre65VisionOOP: 20,

        medicarePartDPremium: 30,
        medicarePartDDeductibleCopays: 200,
        supplementPremium: 120,
        supplementOOP: 200,
        post65HearingCare: 400,
        post65DentalPremium: 15,
        post65DentalOOP: 40,
        post65VisionPremium: 8,
        post65VisionOOP: 30,
      }
    };

    inputs.jurisdiction.currentState = 'MD';
    inputs.jurisdiction.targetState = 'FL';
    inputs.jurisdiction.relocationYear = 2032;

    const results = runRetirementSimulation(inputs);

    // In 2031 (still MD): pre-Medicare premium should be MD rate = (500 + 20 + 10) * 12 = 6360 * hcFactor.
    const row2031 = results.find(r => r.year === 2031);
    const hcFactor2031 = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, 2031 - 2026);
    expect(row2031!.preMedicareHealthcareCost).toBeCloseTo(6360 * hcFactor2031, 1);

    // In 2032 (relocation year): pre-Medicare premium should switch to FL rate = (400 + 15 + 8) * 12 = 5076 * hcFactor.
    const row2032 = results.find(r => r.year === 2032);
    const hcFactor2032 = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, 2032 - 2026);
    expect(row2032!.preMedicareHealthcareCost).toBeCloseTo(5076 * hcFactor2032, 1);
  });

  it('should apply 50% step-up in basis in MD and 100% in FL on death, and generate annual dividends', () => {
    const inputs = getMockInputs();
    inputs.isConfigured = true;
    inputs.isSingleFiler = false;
    inputs.simulateSurvivor = true;
    inputs.you.birthDate = '1960-01-01'; // Turns 85 in 2045 (Death Year)
    inputs.wife.birthDate = '1964-01-01';

    inputs.portfolio.yourTaxableBrokerage = 500000;
    inputs.portfolio.yourTaxableBasis = 200000;
    inputs.portfolio.wifeTaxableBrokerage = 500000;
    inputs.portfolio.wifeTaxableBasis = 200000;

    // Yield configuration
    inputs.portfolio.taxableDividendYield = 0.02; // 2% yield
    inputs.portfolio.taxableNonQualifiedPortion = 0.30;

    // MD Relocation Year is null (remain in MD)
    inputs.jurisdiction.currentState = 'MD';
    inputs.jurisdiction.targetState = 'MD';
    inputs.jurisdiction.relocationYear = null;

    // Run simulation in MD
    const resultsMD = runRetirementSimulation(inputs, true);
    
    // Let's verify dividends generated in 2026:
    // Total taxable balance at start of 2026: 500k + 500k = 1,000,000.
    // Expected dividends: 1,000,000 * 2% = 20,000.
    const row2026 = resultsMD.find(r => r.year === 2026);
    expect(row2026!.incomeInflow).toBeGreaterThanOrEqual(19500);

    // Verify basis step-up in MD: 50% step-up (deceased's account stepped up to FMV at death).
    // Expected value calibrated for the monthly-compounding engine without double-counted RMDs.
    const row2045MD = resultsMD.find(r => r.year === 2045);
    expect(row2045MD!.endWifeTaxableBasis).toBeCloseTo(399761.8, 1);

    // Now set current and target state to FL
    inputs.jurisdiction.currentState = 'FL';
    inputs.jurisdiction.targetState = 'FL';
    const resultsFL = runRetirementSimulation(inputs, true);
    const row2045FL = resultsFL.find(r => r.year === 2045);
    
    // Expected values calibrated for the monthly-compounding engine without double-counted RMDs.
    expect(row2045FL!.endWifeTaxableBasis).toBeCloseTo(1341133.7, 1);
    expect(row2045FL!.endWifeTaxableBrokerage).toBeCloseTo(1393096.1, 1);
  });

  it('should draw from Cash Assets first and grow remaining cash at the fixed income rate', () => {
    const inputs = getMockInputs();
    inputs.growthAssumptions.minCashReserveDollars = 0; // Disable min cash reserve floor for legacy full drawdown test
    inputs.isSingleFiler = true;
    inputs.you.birthDate = '1960-01-01';
    inputs.you.plannedRetirementAge = 60; // retired
    inputs.annualLivingExpenses = 100000;
    
    // Set starting balances
    inputs.portfolio.yourCash = 50000;
    inputs.portfolio.yourTaxableBrokerage = 100000;
    inputs.portfolio.yourTaxableBasis = 80000;
    inputs.portfolio.yourPreTaxIRA = 0;
    inputs.portfolio.yourRothIRA = 0;

    const results = runRetirementSimulation(inputs);
    const row2026 = results.find(r => r.year === 2026);
    expect(row2026).toBeDefined();

    // Deficit will exhaust all 50k cash first.
    expect(row2026!.drawdownCash).toBeCloseTo(50409.35, 1);
    expect(row2026!.endYourCash).toBe(0);

    // Remaining deficit is drawn from Taxable Brokerage.
    expect(row2026!.drawdownTaxable).toBeGreaterThan(0);
  });

  it('should protect minimum cash reserve floor based on configured minCashReserveDollars', () => {
    const inputs = getMockInputs();
    inputs.growthAssumptions.minCashReserveDollars = 100000; // $100,000 cash reserve floor in today's dollars
    inputs.isSingleFiler = true;
    inputs.you.birthDate = '1960-01-01';
    inputs.you.plannedRetirementAge = 60;
    inputs.annualLivingExpenses = 100000;

    // Set starting balances
    inputs.portfolio.yourCash = 100000;
    inputs.portfolio.yourTaxableBrokerage = 200000;
    inputs.portfolio.yourTaxableBasis = 150000;
    inputs.portfolio.yourPreTaxIRA = 0;
    inputs.portfolio.yourRothIRA = 0;

    const results = runRetirementSimulation(inputs);
    const row2026 = results.find(r => r.year === 2026);
    expect(row2026).toBeDefined();

    // Cash reserve floor (100k) is protected: end cash remains at or above the 100k target floor
    expect(row2026!.endYourCash).toBeGreaterThanOrEqual(100000);
    expect(row2026!.drawdownTaxable).toBeGreaterThan(0);
  });
});

describe('calculateFedTaxWithLTCG', () => {
  it('should compute tax with LTCG stacked correctly', () => {
    // Single filer, taxable ordinary = 40,000, taxable LTCG = 20,000.
    // Expected ltcgTax: 9,800 * 0.15 = 1470.
    const res = calculateFedTaxWithLTCG(40000, 20000, true, 1);
    expect(res.ltcgTax).toBeCloseTo(1470, 1);
    expect(res.ordinaryTax).toBe(calculateFedTax(40000, true, 1));
    expect(res.totalTax).toBe(res.ordinaryTax + 1470);
  });
});

describe('getRMDStartAge', () => {
  it('should return correct RMD start age based on birth year', () => {
    expect(getRMDStartAge(1950)).toBe(72);
    expect(getRMDStartAge(1955)).toBe(73);
    expect(getRMDStartAge(1960)).toBe(75);
  });
});

describe('runRetirementSimulation fixes', () => {
  const getMockInputs = (): AppStateInputs => ({
    you: {
      name: 'John',
      birthDate: '1965-06-15',
      estimatedPIA: 0,
      targetSSClaimingAge: null,
      plannedRetirementAge: 65,
      activeSalary: 0,
    },
    wife: {
      name: 'Jane',
      birthDate: '1968-09-20',
      estimatedPIA: 0,
      targetSSClaimingAge: null,
      plannedRetirementAge: 65,
      activeSalary: 0,
    },
    portfolio: {
      yourPreTaxIRA: 0,
      yourRothIRA: 0,
      yourTaxableBrokerage: 0,
      yourTaxableBasis: 0,
      yourCash: 100000,
      wifePreTaxIRA: 0,
      wifeRothIRA: 0,
      wifeTaxableBrokerage: 0,
      wifeTaxableBasis: 0,
      wifeCash: 0,
    },
    jurisdiction: {
      currentState: 'FL',
      targetState: 'FL',
      relocationYear: null,
    },
    growthAssumptions: {
      equityReturnRate: 0.0,
      fixedIncomeReturnRate: 0.04,
      cpiInflationRate: 0.0,
      healthcareInflationRate: 0.0,
    },
    annualLivingExpenses: 1000,
    annualRothConversion: 0,
    rothConversionStrategy: 'flat',
    rothConversionTargetValue: null,
    monteCarloSettings: {
      mode: 'monte-carlo',
      equityVolatility: 0.0,
      fixedIncomeVolatility: 0.0,
      correlation: 0.0,
      trials: 1,
      seed: 42,
    },
    isConfigured: true,
    isSingleFiler: true,
  });

  it('should include cash interest in year-end AGI/MAGI', () => {
    const inputs = getMockInputs();
    const results = runRetirementSimulation(inputs);
    const row2026 = results[0];

    expect(row2026.taxableInterest).toBeGreaterThan(0);
    expect(row2026.fedAGI).toBeCloseTo(row2026.taxableInterest, 1);
    expect(row2026.magi).toBeCloseTo(row2026.taxableInterest, 1);
  });

  it('should check surviving spouse age for standard deduction age addition when single', () => {
    const inputs = getMockInputs();
    inputs.isSingleFiler = false;
    inputs.simulateSurvivor = true;
    const results = runRetirementSimulation(inputs, true);
    const row2051 = results.find(r => r.year === 2051);
    expect(row2051).toBeDefined();
    expect(row2051!.standardDeduction).toBeCloseTo(18050, 1);
  });

  it('should ensure Sankey cash flow sources and uses balance perfectly across all years', () => {
    const inputs = getMockInputs();
    inputs.annualRothConversion = 50000;
    inputs.rothConversionStartYear = 2027;
    inputs.rothConversionEndYear = 2034;
    const results = runRetirementSimulation(inputs);

    results.forEach(row => {
      const salary = (row.yourSalary ?? 0) + (row.wifeSalary ?? 0);
      const ss = row.yourSS + row.wifeSS;
      const rmd = row.yourRMD + row.wifeRMD;
      const divInterest = row.taxableDividends + row.taxableInterest;
      const drawBrokerage = row.drawdownTaxable ?? 0;
      const drawPreTax = row.drawdownPreTax ?? 0;
      const drawRoth = row.drawdownRoth ?? 0;
      const drawCash = row.drawdownCash ?? 0;
      const rothConv = row.intentionalRothConversion ?? 0;

      const living = row.livingExpenses ?? 0;
      const preMedicare = row.preMedicareHealthcareCost ?? 0;
      const medBase = row.medicareBasePremiums ?? 0;
      const medSurcharge = row.combinedSurchargeAnnual ?? 0;
      const taxes = row.fedIncomeTax + row.stateIncomeTax; // fedIncomeTax includes niitTax

      const totalExpenses = living + preMedicare + medBase + medSurcharge + taxes;
      const totalSourcesCash = salary + ss + rmd + divInterest + drawBrokerage + drawPreTax + drawRoth + drawCash;
      const surplus = Math.max(0, totalSourcesCash - totalExpenses);
      const unfundedDeficit = Math.max(0, totalExpenses - totalSourcesCash);

      const sumSources = totalSourcesCash + unfundedDeficit + rothConv;
      const sumUses = totalExpenses + rothConv + surplus;

      expect(sumUses).toBeCloseTo(sumSources, 2);
    });
  });

  it('should satisfy monthly deficits against upcoming RMD obligations before taking discretionary drawdowns', () => {
    const inputs = getMockInputs();
    inputs.isSingleFiler = true;
    inputs.you.birthDate = '1960-01-01';
    inputs.you.plannedRetirementAge = 60;
    // Estimated SS to provide partial monthly income
    inputs.you.estimatedPIA = 1500;
    inputs.you.targetSSClaimingAge = 70;
    // Set living expenses so that monthly deficit is less than annual RMD
    inputs.annualLivingExpenses = 36000;
    // Pre-tax IRA that generates ~40k+ RMD at age 75 (2035)
    inputs.portfolio.yourPreTaxIRA = 1000000;
    inputs.portfolio.yourTaxableBrokerage = 0;
    inputs.portfolio.yourTaxableBasis = 0;
    inputs.portfolio.yourCash = 0;
    inputs.portfolio.yourRothIRA = 0;

    const results = runRetirementSimulation(inputs);
    // Find RMD year (age 75 in 2035)
    const row2035 = results.find(r => r.year === 2035);
    expect(row2035).toBeDefined();

    // Verify statutory RMD is positive
    expect(row2035!.yourRMD).toBeGreaterThan(0);

    // Verify discretionary extra drawdown is 0 since RMD was sufficient to cover monthly cash needs
    expect(row2035!.drawdownPreTax).toBe(0);

    // Verify total pre-tax reduction corresponds to statutory RMD + growth rather than double withdrawal
    expect(row2035!.otherTaxableIncome).toBe(0);
  });

  it('should take discretionary pre-tax drawdowns only for the amount exceeding the statutory RMD obligation', () => {
    const inputs = getMockInputs();
    inputs.isSingleFiler = true;
    inputs.you.birthDate = '1960-01-01';
    inputs.you.plannedRetirementAge = 60;
    inputs.you.estimatedPIA = 0;
    inputs.you.targetSSClaimingAge = null;
    inputs.growthAssumptions.equityReturnRate = 0.07;
    inputs.growthAssumptions.fixedIncomeReturnRate = 0.04;
    // Large annual living expenses to exceed RMD in retirement
    inputs.annualLivingExpenses = 120000;
    // Large pre-tax IRA so account remains positive at age 75 (2035) with RMD ~30k-40k
    inputs.portfolio.yourPreTaxIRA = 1500000;
    inputs.portfolio.yourTaxableBrokerage = 0;
    inputs.portfolio.yourTaxableBasis = 0;
    inputs.portfolio.yourCash = 0;
    inputs.portfolio.yourRothIRA = 0;

    const results = runRetirementSimulation(inputs);
    const row2035 = results.find(r => r.year === 2035);
    expect(row2035).toBeDefined();

    // Verify statutory RMD is positive
    expect(row2035!.yourRMD).toBeGreaterThan(0);

    // Discretionary drawdown should be positive and equal only the excess above the statutory RMD
    expect(row2035!.drawdownPreTax).toBeGreaterThan(0);

    // The sum of RMD + extra drawdown should cover the total deficit
    const totalPreTaxDistributed = row2035!.yourRMD + row2035!.drawdownPreTax;
    expect(totalPreTaxDistributed).toBeGreaterThan(row2035!.yourRMD);
  });

  it('should apply custom asset allocations and cash yield rates across accounts', () => {
    // Configure inputs with distinct equity allocations per account
    const inputs = getMockInputs();
    inputs.isSingleFiler = true;
    inputs.growthAssumptions.equityReturnRate = 0.10;
    inputs.growthAssumptions.fixedIncomeReturnRate = 0.02;
    inputs.growthAssumptions.preTaxEquityPortion = 0.80;
    inputs.growthAssumptions.taxableEquityPortion = 0.20;
    inputs.growthAssumptions.rothEquityPortion = 1.00;
    inputs.growthAssumptions.cashYieldRate = 0.05;
    inputs.annualLivingExpenses = 0;
    inputs.annualRothConversion = 0;

    // Set initial account balances
    inputs.portfolio.yourPreTaxIRA = 100000;
    inputs.portfolio.yourTaxableBrokerage = 100000;
    inputs.portfolio.yourTaxableBasis = 100000;
    inputs.portfolio.yourRothIRA = 100000;
    inputs.portfolio.yourCash = 100000;

    inputs.portfolio.taxableDividendYield = 0;
    inputs.portfolio.taxableNonQualifiedPortion = 0;

    const results = runRetirementSimulation(inputs);
    const row1 = results[0];

    // Pre-Tax IRA effective rate should be 80% * 10% + 20% * 2% = 8.4%
    // Starting balance 100k grows to approximately 108.4k
    expect(row1.endYourPreTaxIRA).toBeGreaterThan(108000);
    expect(row1.endYourPreTaxIRA).toBeLessThan(109000);

    // Taxable Brokerage effective rate should be 20% * 10% + 80% * 2% = 3.6%
    // Starting balance 100k grows to approximately 103.6k
    expect(row1.endYourTaxableBrokerage).toBeGreaterThan(103000);
    expect(row1.endYourTaxableBrokerage).toBeLessThan(104000);

    // Roth IRA effective rate should be 100% * 10% = 10.0%
    // Starting balance 100k grows to 110.0k
    expect(row1.endYourRothIRA).toBeGreaterThan(109500);
    expect(row1.endYourRothIRA).toBeLessThan(110500);

    // Cash savings should grow at custom cashYieldRate of 5.0%
    // Starting balance 100k grows to 105.0k
    expect(row1.endYourCash).toBeGreaterThan(104800);
    expect(row1.endYourCash).toBeLessThan(105200);
  });

  describe('Configurable Simulation Start Year', () => {
    it('should anchor simulation timeline to a custom simulationStartYear (e.g. 2024)', () => {
      const inputs = getMockInputs();
      inputs.isSingleFiler = true;
      inputs.simulationStartYear = 2024;
      inputs.you.birthDate = '1960-01-01'; // Age 64 in 2024
      inputs.you.plannedRetirementAge = 65; // Retires in 2025
      inputs.you.activeSalary = 100000;
      inputs.you.estimatedPIA = 2000;
      inputs.you.targetSSClaimingAge = 67; // Claims in 2027
      inputs.you.longevityAge = 90; // 1960 + 90 = 2050

      const results = runRetirementSimulation(inputs);
      expect(results[0].year).toBe(2024);
      expect(results[0].yourAge).toBe(64);
      expect(results[results.length - 1].year).toBe(2050);

      // In 2024, salary is active, no SS
      expect(results[0].yourSalary).toBeGreaterThan(0);
      expect(results[0].yourSS).toBe(0);

      // In 2027 (age 67), SS starts
      const row2027 = results.find(r => r.year === 2027);
      expect(row2027).toBeDefined();
      expect(row2027!.yourSS).toBeGreaterThan(0);
    });

    it('should anchor simulation timeline to a future simulationStartYear (e.g. 2030)', () => {
      const inputs = getMockInputs();
      inputs.isSingleFiler = true;
      inputs.simulationStartYear = 2030;
      inputs.you.birthDate = '1970-01-01'; // Age 60 in 2030
      inputs.you.plannedRetirementAge = 62; // Retires in 2032
      inputs.you.activeSalary = 100000;
      inputs.you.estimatedPIA = 2000;
      inputs.you.targetSSClaimingAge = 70; // Claims in 2040
      inputs.you.longevityAge = 95; // 1970 + 95 = 2065

      const results = runRetirementSimulation(inputs);
      expect(results[0].year).toBe(2030);
      expect(results[0].yourAge).toBe(60);
      expect(results[results.length - 1].year).toBe(2065);

      const row2040 = results.find(r => r.year === 2040);
      expect(row2040).toBeDefined();
      expect(row2040!.yourAge).toBe(70);
      expect(row2040!.yourSS).toBeGreaterThan(0);
    });
  });

  describe('Customized Living Expenses & Catalog Normalization', () => {
    it('should normalize legacy detailedExpenses objects into standard dynamic catalog structure', () => {
      const legacy = {
        MD: { amenityFee: 150, electric: 200 },
        FL: { amenityFee: 190, electric: 180 },
        frequencies: { amenityFee: 12, electric: 12 }
      };

      const normalized = normalizeDetailedExpenses(legacy);
      expect(normalized.catalog).toBeDefined();
      expect(normalized.catalog.items.length).toBeGreaterThan(0);
      expect(normalized.catalog.categories).toContain('Housing');
      expect(normalized.costs.MD.amenityFee).toBe(150);
      expect(normalized.costs.FL.amenityFee).toBe(190);
      expect(normalized.frequencies.amenityFee).toBe(12);
    });

    it('should return default detailed expenses state when input is null or undefined', () => {
      const normalized = normalizeDetailedExpenses(undefined);
      expect(normalized.catalog).toBeDefined();
      expect(normalized.catalog.categories.length).toBeGreaterThan(0);
      expect(normalized.costs.MD).toBeDefined();
      expect(normalized.costs.FL).toBeDefined();
    });

    it('should accurately calculate living expenses from dynamic custom catalog items and categories', () => {
      const inputs = getMockInputs();
      inputs.useDetailedExpenses = true;
      inputs.jurisdiction = {
        currentState: 'MD',
        targetState: 'FL',
        relocationYear: null // stays in MD
      };

      // Set up custom catalog with custom categories and items
      const customExpenses: DetailedExpensesState = {
        catalog: {
          categories: ['Hobbies', 'Utilities'],
          items: [
            { id: 'boatDues', name: 'Boat Club Dues', category: 'Hobbies', defaultFrequency: 12 },
            { id: 'solarGrid', name: 'Solar Grid Fee', category: 'Utilities', defaultFrequency: 1 }
          ]
        },
        costs: {
          MD: { boatDues: 300, solarGrid: 1200 },
          FL: { boatDues: 200, solarGrid: 600 }
        },
        frequencies: {
          boatDues: 12, // 300 * 12 = 3,600
          solarGrid: 1   // 1200 * 1 = 1,200
        }
      };
      // Expected annual recurring living expenses = 3,600 + 1,200 = 4,800

      inputs.detailedExpenses = customExpenses;

      const results = runRetirementSimulation(inputs);
      expect(results[0].livingExpenses).toBeCloseTo(4800, 0);
    });

    it('should assess custom one-time setup costs in their configured target years', () => {
      const inputs = getMockInputs();
      inputs.useDetailedExpenses = true;
      inputs.simulationStartYear = 2026;
      inputs.growthAssumptions.cpiInflationRate = 0.025;
      inputs.jurisdiction = {
        currentState: 'MD',
        targetState: 'FL',
        relocationYear: 2030
      };

      const customExpenses: DetailedExpensesState = {
        catalog: {
          categories: ['Living', 'One-Time Setup Costs'],
          items: [
            { id: 'groceries', name: 'Groceries', category: 'Living', defaultFrequency: 12 },
            { id: 'mdFurniture', name: 'MD Living Room Set', category: 'One-Time Setup Costs', defaultFrequency: 1, isOneTime: true, targetYear: 2026 },
            { id: 'flGolfCart', name: 'FL Golf Cart Purchase', category: 'One-Time Setup Costs', defaultFrequency: 1, isOneTime: true, targetYear: 2030 }
          ]
        },
        costs: {
          MD: { groceries: 500, mdFurniture: 10000, flGolfCart: 0 },
          FL: { groceries: 400, mdFurniture: 0, flGolfCart: 15000 }
        },
        frequencies: {
          groceries: 12
        }
      };

      inputs.detailedExpenses = customExpenses;

      const results = runRetirementSimulation(inputs);

      // Year 1 (2026, MD): livingExpenses includes $10,000 one-time cost + (500 * 12 = 6,000) = $16,000
      const row2026 = results.find(r => r.year === 2026)!;
      expect(row2026.livingExpenses).toBeCloseTo(16000, 0);

      // Year 2 (2027, MD): No one-time costs -> ~$6,000 * 1.025 = ~6,150
      const row2027 = results.find(r => r.year === 2027)!;
      expect(row2027.livingExpenses).toBeCloseTo(6000 * 1.025, 0);

      // Relocation Year (2030, FL): Relocation one-time cost ($15,000 inflated) triggers + FL base living expenses (400 * 12 = 4,800 inflated)
      const row2030 = results.find(r => r.year === 2030)!;
      const cpiFactor2030 = Math.pow(1.025, 4);
      expect(row2030.livingExpenses).toBeCloseTo((4800 + 15000) * cpiFactor2030, 0);

      // Year after relocation (2031, FL): Back to base FL expenses without one-time costs
      const row2031 = results.find(r => r.year === 2031)!;
      const cpiFactor2031 = Math.pow(1.025, 5);
      expect(row2031.livingExpenses).toBeCloseTo(4800 * cpiFactor2031, 0);
    });
  });

  describe('Charitable Giving & Tithe Engine (with QCD)', () => {
    it('should track annual portfolio growth and calculate a 10% tithe when enabled', () => {
      const inputs = getMockInputs();
      inputs.charitySettings = {
        enabled: true,
        growthPercentage: 0.10,
        minAnnualTithe: null,
        maxAnnualTithe: null,
        useQCD: false, // Pure cash/taxable tithe for testing growth math
      };

      const results = runRetirementSimulation(inputs);
      const row1 = results[0];

      expect(row1.portfolioGrowth).toBeGreaterThan(0);
      expect(row1.charitableTithe).toBeCloseTo(row1.portfolioGrowth * 0.10, 0);
      expect(row1.nonQcdTithe).toBeCloseTo(row1.charitableTithe, 0);
      expect(row1.qcdAmount).toBe(0);
    });

    it('should enforce a $0 floor on tithe during flat or down return years unless a minAnnualTithe is set', () => {
      const inputs = getMockInputs();
      // Set zero growth rates
      inputs.growthAssumptions.equityReturnRate = 0.0;
      inputs.growthAssumptions.fixedIncomeReturnRate = 0.0;
      inputs.growthAssumptions.cashYieldRate = 0.0;
      inputs.portfolio.taxableDividendYield = 0.0;

      inputs.charitySettings = {
        enabled: true,
        growthPercentage: 0.10,
        minAnnualTithe: null,
        maxAnnualTithe: null,
        useQCD: false,
      };

      const results = runRetirementSimulation(inputs);
      const row1 = results[0];

      expect(row1.portfolioGrowth).toBe(0);
      expect(row1.charitableTithe).toBe(0);

      // Now set a minimum floor of $5,000
      inputs.charitySettings.minAnnualTithe = 5000;
      const resultsWithFloor = runRetirementSimulation(inputs);
      expect(resultsWithFloor[0].charitableTithe).toBe(5000);
    });

    it('should preserve negative portfolio growth in down-market years while keeping charitable tithe floored at zero', () => {
      const inputs = getMockInputs();
      // Configure portfolio assets to experience market returns
      inputs.portfolio.yourPreTaxIRA = 500000;
      inputs.portfolio.yourTaxableBrokerage = 200000;

      // Configure negative market returns for equities and fixed income
      inputs.growthAssumptions.equityReturnRate = -0.15;
      inputs.growthAssumptions.fixedIncomeReturnRate = -0.05;
      inputs.growthAssumptions.cashYieldRate = 0.0;
      inputs.portfolio.taxableDividendYield = 0.0;

      inputs.charitySettings = {
        enabled: true,
        growthPercentage: 0.10,
        minAnnualTithe: null,
        maxAnnualTithe: null,
        useQCD: false,
      };

      const results = runRetirementSimulation(inputs);
      const row1 = results[0];

      // Portfolio growth must preserve true negative losses for display in the ledger
      expect(row1.portfolioGrowth).toBeLessThan(0);
      // Charitable tithe must be floored at $0 so users do not tithe on market losses
      expect(row1.charitableTithe).toBe(0);
    });

    it('should respect custom percentage and maximum annual cap', () => {
      const inputs = getMockInputs();
      inputs.charitySettings = {
        enabled: true,
        growthPercentage: 0.20,
        minAnnualTithe: null,
        maxAnnualTithe: 15000,
        useQCD: false,
      };

      const results = runRetirementSimulation(inputs);
      const row1 = results[0];

      expect(row1.portfolioGrowth).toBeGreaterThan(0);
      // Even if 20% of growth is > $15,000, tithe should be capped at $15,000
      expect(row1.charitableTithe).toBeLessThanOrEqual(15000);
    });

    it('should execute tax-free QCDs starting at age 70.5 and satisfy RMDs dollar-for-dollar', () => {
      const inputs = getMockInputs();
      inputs.isSingleFiler = false;
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1953-01-01'; // Age 73 in 2026 (RMD active)
      inputs.you.targetSSClaimingAge = 70;
      inputs.wife.birthDate = '1953-01-01'; // Age 73 in 2026 (RMD active)
      inputs.portfolio.yourPreTaxIRA = 1000000;
      inputs.portfolio.wifePreTaxIRA = 500000;

      // Run baseline without charity
      inputs.charitySettings = { enabled: false, growthPercentage: 0.10, useQCD: false };
      const baselineResults = runRetirementSimulation(inputs);
      const baseRow = baselineResults[0];

      // Run with QCD enabled
      inputs.charitySettings = {
        enabled: true,
        growthPercentage: 0.10,
        minAnnualTithe: 20000,
        maxAnnualTithe: null,
        useQCD: true,
      };
      const qcdResults = runRetirementSimulation(inputs);
      const qcdRow = qcdResults[0];

      expect(qcdRow.qcdAmount).toBeGreaterThan(0);
      // QCD reduces taxable RMD dollar-for-dollar:
      expect(qcdRow.yourRMD).toBeLessThan(baseRow.yourRMD);
      // QCD reduces federal taxable AGI compared to baseline:
      expect(qcdRow.fedAGI).toBeLessThan(baseRow.fedAGI);
      // QCD generates direct tax savings:
      expect(qcdRow.qcdTaxSavings).toBeGreaterThan(0);
    });

    it('should prioritize Primary IRA for QCD first, then Spouse IRA second when both are age 70.5+', () => {
      const inputs = getMockInputs();
      inputs.isSingleFiler = false;
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1955-01-01'; // Age 71 (age >= 70.5)
      inputs.wife.birthDate = '1955-01-01'; // Age 71 (age >= 70.5)
      inputs.portfolio.yourPreTaxIRA = 10000; // Small primary IRA balance
      inputs.portfolio.wifePreTaxIRA = 500000; // Large wife IRA balance

      inputs.charitySettings = {
        enabled: true,
        growthPercentage: 0.10,
        minAnnualTithe: 25000, // Large tithe exceeding primary IRA
        maxAnnualTithe: null,
        useQCD: true,
      };

      const results = runRetirementSimulation(inputs);
      const row1 = results[0];

      // Primary IRA should be depleted by QCD, and spouse IRA should cover the remainder
      expect(row1.endYourPreTaxIRA).toBe(0);
      expect(row1.qcdAmount).toBeCloseTo(25000, 0);
      expect(row1.nonQcdTithe).toBe(0);
    });

    it('should optimize itemized deductions vs standard deduction for non-QCD charitable donations', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1970-01-01'; // Age 56 (under 70.5, no QCD)
      inputs.wife.birthDate = '1970-01-01';
      inputs.jurisdiction.currentState = 'MD';
      inputs.jurisdiction.relocationYear = null;

      // Run baseline without charity
      inputs.charitySettings = { enabled: false, growthPercentage: 0.10, useQCD: false };
      const baseResults = runRetirementSimulation(inputs);
      const baseStdDed = baseResults[0].standardDeduction;

      // Run with large non-QCD tithe ($50,000)
      inputs.charitySettings = {
        enabled: true,
        growthPercentage: 0.10,
        minAnnualTithe: 50000,
        maxAnnualTithe: null,
        useQCD: false,
      };
      const itemizedResults = runRetirementSimulation(inputs);
      const rowWithGifts = itemizedResults[0];

      // Standard deduction reported on the row should be elevated due to itemized optimization ($10k SALT + $50k charity = $60k > standard deduction)
      expect(rowWithGifts.standardDeduction).toBeGreaterThan(baseStdDed);
      expect(rowWithGifts.standardDeduction).toBeGreaterThanOrEqual(50000);
    });

    it('should contribute max pre-tax 401(k) and reduce taxable salary in pre-retirement working years', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1965-06-15'; // Age 61 in 2026 (age 60-63 SECURE 2.0 catchup: $23,500 + $11,250 = $34,750)
      inputs.you.plannedRetirementAge = 65; // working all of 2026
      inputs.you.activeSalary = 150000;
      inputs.isSingleFiler = true;
      inputs.portfolio.yourPreTaxIRA = 500000;

      const results = runRetirementSimulation(inputs);
      const row2026 = results[0];

      expect(row2026.employee401kContribution).toBeCloseTo(34750, 0);
      expect(row2026.ficaTaxesPaid).toBeGreaterThan(0);
      expect(row2026.incomeTaxWithheld).toBeGreaterThan(0);
      expect(row2026.netTakeHomeSalary).toBeGreaterThan(0);
      
      // Verify exact arithmetic: Gross - 401(k) - FICA - Withholdings === Net Take-Home
      const gross = (row2026.yourSalary ?? 0) + (row2026.wifeSalary ?? 0);
      const computedNet = gross - (row2026.employee401kContribution ?? 0) - (row2026.ficaTaxesPaid ?? 0) - (row2026.incomeTaxWithheld ?? 0);
      expect(row2026.netTakeHomeSalary).toBeCloseTo(computedNet, 2);

      // Taxable income should be based on gross salary minus 401k contribution
      expect(row2026.fedAGI).toBeLessThan(150000);
    });

    it('should preserve cash savings buffer ($0 cash drawdown) in transition year when full-year net salary exceeds full-year expenses', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1965-09-01'; // Turns 61 in Sept 2026
      inputs.you.plannedRetirementAge = 61; // Retires in Sept (works 8 months)
      inputs.you.activeSalary = 300000; // High salary
      inputs.annualLivingExpenses = 80000;
      inputs.portfolio.yourCash = 87485; // Starting cash buffer
      inputs.isSingleFiler = true;

      const results = runRetirementSimulation(inputs);
      const row2026 = results[0];

      // Cash savings buffer should NOT be drawn down because 8 months of net salary ($100k+)
      // is more than enough to cover full-year living expenses ($80k).
      expect(row2026.drawdownCash).toBe(0);
      // Starting cash balance should be preserved intact (+ interest)
      expect(row2026.endYourCash).toBeGreaterThanOrEqual(87485);
      // Surplus should be reinvested into Brokerage
      expect(row2026.reinvestedSurplus).toBeGreaterThan(0);
    });

    it('should pro-rate statutory RMDs across all 12 months to fund monthly expenses at age 75+', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2035;
      inputs.you.birthDate = '1960-01-01'; // Age 75 in 2035 (RMD age)
      inputs.you.plannedRetirementAge = 65; // fully retired
      inputs.portfolio.yourPreTaxIRA = 3000000;
      inputs.annualLivingExpenses = 60000;
      inputs.portfolio.yourCash = 50000;
      inputs.isSingleFiler = true;

      const results = runRetirementSimulation(inputs);
      const row2035 = results[0];

      expect(row2035.yourRMD).toBeGreaterThan(100000);
      // Because RMD is pro-rated monthly, monthly expenses are funded from monthly RMD,
      // so cash savings is not drained
      expect(row2035.drawdownCash).toBe(0);
      expect(row2035.endYourCash).toBeGreaterThanOrEqual(50000);
    });

    it('should apply Form SSA-44 Life-Changing Event (Work Stoppage) to reset 2-year lookback MAGI and avoid IRMAA surcharge penalties upon retirement', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1961-01-01'; // Turns 65 in 2026 (Medicare eligible)
      inputs.you.plannedRetirementAge = 65; // Retires in 2026
      inputs.you.activeSalary = 350000; // High pre-retirement salary
      inputs.isSingleFiler = true;
      inputs.fileSSA44LifeChangingEvent = true;

      const results = runRetirementSimulation(inputs);
      const row2026 = results[0];

      // SSA-44 should be active
      expect(row2026.isSSA44Applied).toBe(true);
      // Raw lookback would have included high salary ($350k)
      expect(row2026.rawLookbackMAGI).toBeGreaterThanOrEqual(300000);
      // Adjusted lookback excludes the pre-retirement salary
      expect(row2026.magiTwoYearsAgo).toBeLessThan(100000);
      // Surcharge tier should be 0 (no IRMAA penalty)
      expect(row2026.surchargeTier).toBe(0);
      expect(row2026.combinedSurchargeAnnual).toBe(0);
    });

    it('should subject retiree to high IRMAA tiers if Form SSA-44 is explicitly disabled', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1961-01-01'; // Turns 65 in 2026 (Medicare eligible)
      inputs.you.plannedRetirementAge = 65; // Retires in 2026
      inputs.you.activeSalary = 350000; // High pre-retirement salary
      inputs.isSingleFiler = true;
      inputs.fileSSA44LifeChangingEvent = false; // Disabled

      const results = runRetirementSimulation(inputs);
      const row2026 = results[0];

      // SSA-44 should not be applied
      expect(row2026.isSSA44Applied).toBe(false);
      // Lookback MAGI includes full pre-retirement income
      expect(row2026.magiTwoYearsAgo).toBeGreaterThanOrEqual(300000);
      // Should be subjected to elevated IRMAA tier
      expect(row2026.surchargeTier).toBeGreaterThanOrEqual(4);
      expect(row2026.combinedSurchargeAnnual).toBeGreaterThan(0);
    });

    it('should naturally transition to standard 2-year lookback when retired for 2+ full tax years', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1961-01-01'; // Age 65 in 2026
      inputs.you.plannedRetirementAge = 65; // Retires in 2026
      inputs.you.activeSalary = 300000;
      inputs.isSingleFiler = true;
      inputs.fileSSA44LifeChangingEvent = true;

      const results = runRetirementSimulation(inputs);
      
      // In 2029 (year 4), lookback year is 2027 (which had $0 salary)
      const row2029 = results.find(r => r.year === 2029);
      expect(row2029).toBeDefined();
      expect(row2029!.isSSA44Applied).toBe(false);
    });

    it('should ensure MAGI equals the exact sum of all itemized income components in RMD years without double-counting', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.you.birthDate = '1960-01-01'; // Age 75 in 2035
      inputs.you.plannedRetirementAge = 65;
      inputs.portfolio.yourPreTaxIRA = 2000000;
      inputs.portfolio.yourTaxableBrokerage = 500000;
      inputs.portfolio.yourCash = 100000;

      const results = runRetirementSimulation(inputs);
      const row2040 = results.find(r => r.year === 2040);
      expect(row2040).toBeDefined();

      const grossSalary = Math.max(0, (row2040!.yourSalary ?? 0) + (row2040!.wifeSalary ?? 0) - (row2040!.employee401kContribution ?? 0));
      const rmd = (row2040!.yourRMD ?? 0) + (row2040!.wifeRMD ?? 0);
      const extraPreTax = row2040!.otherTaxableIncome ?? 0;
      const rothConv = row2040!.intentionalRothConversion ?? 0;
      const capGains = row2040!.capitalGainsTriggered ?? 0;
      const divYield = row2040!.taxableDividends ?? 0;
      const interestYield = row2040!.taxableInterest ?? 0;
      const taxableSS = row2040!.taxableSS ?? 0;

      // In the UI: Gross Salary + RMD + Extra Pre-Tax + Roth Conv + Cap Gains + Dividends + Interest + Taxable SS
      const sumOfComponents = grossSalary + rmd + extraPreTax + rothConv + capGains + divYield + interestYield + taxableSS;
      expect(row2040!.magi).toBeCloseTo(sumOfComponents, 0);
    });

    it('should correctly account for active salary in 2026 when fill-to-target strategy is enabled so 2026 total AGI does not exceed target limit', () => {
      const getMockInputs = (): AppStateInputs => ({
        you: { birthDate: '1961-01-01', plannedRetirementAge: 66, activeSalary: 150000, targetSSClaimingAge: 67, estimatedPIA: 3000 },
        wife: { birthDate: '1965-01-01', plannedRetirementAge: 65, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 1500 },
        portfolio: { yourPreTaxIRA: 1000000, yourRothIRA: 100000, yourTaxableBrokerage: 500000, yourTaxableBasis: 0, yourCash: 0, wifePreTaxIRA: 0, wifeRothIRA: 0, wifeTaxableBrokerage: 0, wifeTaxableBasis: 0, wifeCash: 0 },
        jurisdiction: { currentState: 'FL', targetState: 'FL', relocationYear: null },
        growthAssumptions: { equityReturnRate: 0.07, fixedIncomeReturnRate: 0.04, cpiInflationRate: 0.025, healthcareInflationRate: 0.05 },
        annualLivingExpenses: 80000,
        annualRothConversion: 50000,
        simulationStartYear: 2026,
        rothConversionStartYear: 2026,
        rothConversionEndYear: 2032,
        rothConversionStrategy: 'fill-to-target',
        rothConversionTargetValue: 215000,
        monteCarloSettings: { mode: 'monte-carlo', trials: 10, equityVolatility: 0.15, fixedIncomeVolatility: 0.05, correlation: 0.15, seed: null },
        isConfigured: true,
        isSingleFiler: false,
      });

      const inputs = getMockInputs();
      const results = runRetirementSimulation(inputs);
      const row2026 = results.find(r => r.year === 2026);
      expect(row2026).toBeDefined();

      // Total AGI in 2026 must be kept at or below the target limit ($215,000)
      expect(row2026!.magi).toBeLessThanOrEqual(215000.5);
    });

    it('should fill exactly to 12% bracket taxable income ceiling without overshooting', () => {
      const getMockInputs = (): AppStateInputs => ({
        you: { birthDate: '1960-01-01', plannedRetirementAge: 65, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 3000 },
        wife: { birthDate: '1964-01-01', plannedRetirementAge: 61, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 1500 },
        portfolio: { yourPreTaxIRA: 1500000, yourRothIRA: 50000, yourTaxableBrokerage: 400000, yourTaxableBasis: 0, yourCash: 50000, wifePreTaxIRA: 0, wifeRothIRA: 0, wifeTaxableBrokerage: 0, wifeTaxableBasis: 0, wifeCash: 0 },
        jurisdiction: { currentState: 'FL', targetState: 'FL', relocationYear: null },
        growthAssumptions: { equityReturnRate: 0.07, fixedIncomeReturnRate: 0.04, cpiInflationRate: 0.025, healthcareInflationRate: 0.05 },
        annualLivingExpenses: 60000,
        annualRothConversion: 50000,
        simulationStartYear: 2026,
        rothConversionStartYear: 2026,
        rothConversionEndYear: 2030,
        rothConversionStrategy: 'fill-to-target',
        rothConversionTargetValue: 100800, // 12% Bracket ceiling ($100,800 Taxable Income)
        monteCarloSettings: { mode: 'monte-carlo', trials: 10, equityVolatility: 0.15, fixedIncomeVolatility: 0.05, correlation: 0.15, seed: null },
        isConfigured: true,
        isSingleFiler: false,
      });

      const inputs = getMockInputs();
      const results = runRetirementSimulation(inputs);
      
      const convRows = results.filter(r => r.year >= 2026 && r.year <= 2030);
      for (const row of convRows) {
        const expectedTaxableTarget = 100800 * row.cpiFactor;
        expect(row.intentionalRothConversion).toBeGreaterThan(0);
        // Taxable income must equal the target taxable ceiling within $1
        expect(row.taxableIncome).toBeCloseTo(expectedTaxableTarget, 0);
        expect(row.taxableIncome).toBeLessThanOrEqual(expectedTaxableTarget + 0.05);
      }
    });

    it('should fill exactly to IRMAA MAGI ceiling without overshooting', () => {
      const getMockInputs = (): AppStateInputs => ({
        you: { birthDate: '1960-01-01', plannedRetirementAge: 65, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 3000 },
        wife: { birthDate: '1964-01-01', plannedRetirementAge: 61, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 1500 },
        portfolio: { yourPreTaxIRA: 1500000, yourRothIRA: 50000, yourTaxableBrokerage: 400000, yourTaxableBasis: 0, yourCash: 50000, wifePreTaxIRA: 0, wifeRothIRA: 0, wifeTaxableBrokerage: 0, wifeTaxableBasis: 0, wifeCash: 0 },
        jurisdiction: { currentState: 'FL', targetState: 'FL', relocationYear: null },
        growthAssumptions: { equityReturnRate: 0.07, fixedIncomeReturnRate: 0.04, cpiInflationRate: 0.025, healthcareInflationRate: 0.05 },
        annualLivingExpenses: 60000,
        annualRothConversion: 50000,
        simulationStartYear: 2026,
        rothConversionStartYear: 2026,
        rothConversionEndYear: 2030,
        rothConversionStrategy: 'fill-to-target',
        rothConversionTargetValue: 218000, // IRMAA Tier 1 ceiling ($218,000 MAGI)
        monteCarloSettings: { mode: 'monte-carlo', trials: 10, equityVolatility: 0.15, fixedIncomeVolatility: 0.05, correlation: 0.15, seed: null },
        isConfigured: true,
        isSingleFiler: false,
      });

      const inputs = getMockInputs();
      const results = runRetirementSimulation(inputs);
      
      const convRows = results.filter(r => r.year >= 2026 && r.year <= 2030);
      for (const row of convRows) {
        const expectedMAGITarget = 218000 * row.cpiFactor;
        expect(row.intentionalRothConversion).toBeGreaterThan(0);
        // MAGI must equal the IRMAA target ceiling within $1
        expect(Math.abs(row.magi - expectedMAGITarget)).toBeLessThanOrEqual(1.0);
        expect(row.magi).toBeLessThanOrEqual(expectedMAGITarget + 0.05);
      }
    });

    it('should fill bracket target accurately when itemized charitable deductions exceed standard deduction', () => {
      const getMockInputs = (): AppStateInputs => ({
        you: { birthDate: '1960-01-01', plannedRetirementAge: 65, activeSalary: 0, targetSSClaimingAge: 70, estimatedPIA: 3000 },
        wife: { birthDate: '1964-01-01', plannedRetirementAge: 61, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 1500 },
        portfolio: { yourPreTaxIRA: 1500000, yourRothIRA: 50000, yourTaxableBrokerage: 500000, yourTaxableBasis: 500000, yourCash: 200000, wifePreTaxIRA: 0, wifeRothIRA: 0, wifeTaxableBrokerage: 0, wifeTaxableBasis: 0, wifeCash: 0 },
        jurisdiction: { currentState: 'MD', targetState: 'MD', relocationYear: null },
        growthAssumptions: { equityReturnRate: 0.06, fixedIncomeReturnRate: 0.04, cpiInflationRate: 0.024, healthcareInflationRate: 0.05 },
        annualLivingExpenses: 60000,
        annualRothConversion: 50000,
        simulationStartYear: 2026,
        rothConversionStartYear: 2027,
        rothConversionEndYear: 2029,
        rothConversionStrategy: 'fill-to-target',
        rothConversionTargetValue: 211400, // 22% bracket limit ($211,400 Taxable Income)
        charitySettings: { enabled: true, growthPercentage: 0.1, useQCD: true, minAnnualTithe: 30000, maxAnnualTithe: 50000 },
        monteCarloSettings: { mode: 'monte-carlo', trials: 10, equityVolatility: 0.15, fixedIncomeVolatility: 0.05, correlation: 0.15, seed: null },
        isConfigured: true,
        isSingleFiler: false,
      });

      const inputs = getMockInputs();
      const results = runRetirementSimulation(inputs);

      const convRows = results.filter(r => r.year >= 2027 && r.year <= 2029);
      for (const row of convRows) {
        const expectedTaxableTarget = 211400 * row.cpiFactor;
        expect(row.intentionalRothConversion).toBeGreaterThan(0);
        // Taxable income must reach within 1% of the bracket limit even with high itemized tithes
        expect(row.taxableIncome).toBeGreaterThan(expectedTaxableTarget * 0.99);
        expect(row.taxableIncome).toBeLessThanOrEqual(expectedTaxableTarget + 100);
      }
    });
  });

  describe('solveRothConversionForTargetAGI', () => {
    it('should return 0 if baseline AGI already meets or exceeds target', () => {
      const conv = solveRothConversionForTargetAGI(100000, 120000, 0, 0, false);
      expect(conv).toBe(0);
    });

    it('should compute exact headroom without Social Security', () => {
      const conv = solveRothConversionForTargetAGI(150000, 50000, 10000, 0, false);
      expect(conv).toBe(90000); // 150000 - 60000
    });

    it('should accurately account for Social Security taxability feedback loop', () => {
      // Total SS = 40,000. Target = 150,000. Baseline Ordinary = 40,000, Capital Gains = 0.
      const conv = solveRothConversionForTargetAGI(150000, 40000, 0, 40000, false);
      const taxableSS = calculateTaxableSS(40000, 40000 + conv, false);
      const resultingAGI = 40000 + conv + taxableSS;
      expect(resultingAGI).toBeCloseTo(150000, 0);
      expect(resultingAGI).toBeLessThanOrEqual(150000.01);
    });
  });

  describe('Actuals Tracking & Guardrail Plan Engine', () => {
    const getBaseActualsTestInputs = (): AppStateInputs => ({
      you: { birthDate: '1960-01-01', plannedRetirementAge: 65, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 3000 },
      wife: { birthDate: '1964-01-01', plannedRetirementAge: 61, activeSalary: 0, targetSSClaimingAge: 67, estimatedPIA: 1500 },
      portfolio: { yourPreTaxIRA: 1000000, yourRothIRA: 200000, yourTaxableBrokerage: 500000, yourTaxableBasis: 300000, yourCash: 100000, wifePreTaxIRA: 0, wifeRothIRA: 0, wifeTaxableBrokerage: 0, wifeTaxableBasis: 0, wifeCash: 0 },
      jurisdiction: { currentState: 'FL', targetState: 'FL', relocationYear: null },
      growthAssumptions: { equityReturnRate: 0.08, fixedIncomeReturnRate: 0.04, cpiInflationRate: 0.025, healthcareInflationRate: 0.05 },
      annualLivingExpenses: 80000,
      annualRothConversion: 0,
      simulationStartYear: 2026,
      rothConversionStrategy: 'flat',
      rothConversionTargetValue: null,
      monteCarloSettings: { mode: 'monte-carlo', trials: 10, equityVolatility: 0.15, fixedIncomeVolatility: 0.05, correlation: 0.15, seed: 42 },
      isConfigured: true,
      isSingleFiler: true,
    });

    it('should seamlessly substitute actual return rates and living expenses for recorded years', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.actualTracking = {
        2026: {
          year: 2026,
          equityReturnRate: 0.035,
          fixedIncomeReturnRate: 0.02,
          totalLivingExpenses: 72000,
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      expect(row2026).toBeDefined();
      expect(row2026?.isActual).toBe(true);
      expect(row2026?.livingExpenses).toBe(72000);
      expect(row2026?.isBridged).toBe(false);
    });

    it('should apply balance reconciliation overrides and carry them forward to future simulation years', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.actualTracking = {
        2026: {
          year: 2026,
          endYourPreTaxIRA: 950000,
          endYourRothIRA: 250000,
          endYourTaxableBrokerage: 600000,
          endYourTaxableBasis: 350000,
          endYourCash: 120000,
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      expect(row2026?.endYourPreTaxIRA).toBe(950000);
      expect(row2026?.endYourRothIRA).toBe(250000);
      expect(row2026?.endYourTaxableBrokerage).toBe(600000);
      expect(row2026?.endYourCash).toBe(120000);
      expect(row2026?.totalPortfolioValue).toBe(1920000);

      // Future projected year 2027 should begin growing from 2026 reconciled balances
      const row2027 = ledger.find(r => r.year === 2027);
      expect(row2027?.isActual).toBe(false);
      expect(row2027).toBeDefined();
    });

    it('should bridge missing intermediate actual years gracefully with model projections', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.actualTracking = {
        2026: { year: 2026, totalLivingExpenses: 70000 },
        2028: { year: 2028, totalLivingExpenses: 75000 },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      const row2027 = ledger.find(r => r.year === 2027);
      const row2028 = ledger.find(r => r.year === 2028);

      expect(row2026?.isActual).toBe(true);
      expect(row2026?.isBridged).toBe(false);

      expect(row2027?.isActual).toBe(false);
      expect(row2027?.isBridged).toBe(true);

      expect(row2028?.isActual).toBe(true);
      expect(row2028?.isBridged).toBe(false);
    });

    it('should compute Guardrail spending gap and bonus within configured upper/lower bounds', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.guardrailSettings = {
        enabled: true,
        upperGuardrailPct: 0.15,
        lowerGuardrailPct: 0.15,
        marketSurplusSharePct: 0.10,
        applyToSimulation: false,
      };
      inputs.annualLivingExpenses = 100000;
      inputs.actualTracking = {
        2026: {
          year: 2026,
          totalLivingExpenses: 85000, // $15k spending surplus
          equityReturnRate: 0.20,     // Strong outperformance
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      expect(row2026).toBeDefined();
      expect(row2026?.guardrailUpperLimit).toBeCloseTo(115000, 1); // 100k * 1.15
      expect(row2026?.guardrailLowerLimit).toBeCloseTo(85000, 1);  // 100k * 0.85
      expect(row2026?.actualSurplusGap).toBeGreaterThan(15000);
      expect(row2026?.permittedSpendingBonus).toBeLessThanOrEqual(15000.01); // Capped by upper guardrail ceiling ($115k - $100k = $15k)
    });

    it('should compute Guardrail planned budget from detailed expenses when useDetailedExpenses is true', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.guardrailSettings = {
        enabled: true,
        upperGuardrailPct: 0.15,
        lowerGuardrailPct: 0.15,
        marketSurplusSharePct: 0.10,
        applyToSimulation: false,
      };
      // Stale flat budget from prior configuration
      inputs.annualLivingExpenses = 54603;
      inputs.useDetailedExpenses = true;
      inputs.detailedExpenses = {
        catalog: {
          categories: ['Housing', 'Food'],
          items: [
            { id: 'rent', name: 'Rent', category: 'Housing', defaultFrequency: 12 },
            { id: 'groceries', name: 'Groceries', category: 'Food', defaultFrequency: 12 },
          ],
        },
        costs: {
          FL: {
            rent: 4000,     // 48,000 / yr
            groceries: 1817.75, // 21,813 / yr => Total $69,813 / yr
          },
        },
        frequencies: {
          rent: 12,
          groceries: 12,
        },
      };
      inputs.actualTracking = {
        2026: {
          year: 2026,
          totalLivingExpenses: 69813, // 100% on target with detailed budget
          equityReturnRate: 0.07,
          fixedIncomeReturnRate: 0.04,
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      expect(row2026).toBeDefined();

      // Guardrail upper/lower limits should be based on $69,813, NOT $54,603
      expect(row2026?.guardrailUpperLimit).toBeCloseTo(69813 * 1.15, 0);
      expect(row2026?.guardrailLowerLimit).toBeCloseTo(69813 * 0.85, 0);

      // Spending variance should be 0 because actuals exactly equaled the detailed budget
      // and surplus gap should not flag a false $15,210 deficit
      expect(row2026?.actualSurplusGap).toBeGreaterThanOrEqual(0);
    });

    it('should handle actual years with zero logged spending without injecting projected OOP maximum into actual living expenses', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.you.birthDate = '1965-01-01'; // Age 61 in 2026 (Pre-65)
      inputs.annualLivingExpenses = 61883;
      inputs.you.healthcare = {
        fileSSA44LifeChangingEvent: true,
        medicarePartBPremium: null,
        FL: {
          pre65MedicalPremium: 500,
          pre65MedicalOOP: 5000,
          pre65DentalPremium: 50,
          pre65DentalOOP: 1000,
          pre65VisionPremium: 20,
          pre65VisionOOP: 200,
          supplementPremium: null,
          supplementOOP: null,
          medicarePartDPremium: null,
          medicarePartDDeductibleCopays: null,
          post65HearingCare: null,
          post65DentalPremium: null,
          post65DentalOOP: null,
          post65VisionPremium: null,
          post65VisionOOP: null,
        },
        MD: {
          pre65MedicalPremium: 500,
          pre65MedicalOOP: 5000,
          pre65DentalPremium: 50,
          pre65DentalOOP: 1000,
          pre65VisionPremium: 20,
          pre65VisionOOP: 200,
          supplementPremium: null,
          supplementOOP: null,
          medicarePartDPremium: null,
          medicarePartDDeductibleCopays: null,
          post65HearingCare: null,
          post65DentalPremium: null,
          post65DentalOOP: null,
          post65VisionPremium: null,
          post65VisionOOP: null,
        },
      };

      // 2026 actual record with ZERO logged transactions / no totalLivingExpenses entered
      inputs.actualTracking = {
        2026: {
          year: 2026,
          equityReturnRate: 0.08,
          fixedIncomeReturnRate: 0.04,
          totalLivingExpenses: null,
          healthcareOOP: null,
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      expect(row2026).toBeDefined();

      // Living expenses and realized OOP should be 0 because nothing was logged/entered
      expect(row2026?.livingExpenses).toBe(0);
      expect(row2026?.healthcareOOP).toBe(0);

      // Planned OOP allowance is preserved as the planning ceiling (5000 + 1000 + 200 = 6200)
      expect(row2026?.plannedHealthcareOOP).toBeCloseTo(6200, 0);

      // Un-logged spending should NOT flag an overspending penalty
      expect(row2026?.actualSurplusGap).toBeGreaterThanOrEqual(0);
    });

    it('should track realized healthcare OOP against maximum planned allowance and calculate spending savings', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.you.birthDate = '1965-01-01'; // Age 61 in 2026 (Pre-65)
      inputs.annualLivingExpenses = 60000;
      inputs.you.healthcare = {
        fileSSA44LifeChangingEvent: true,
        medicarePartBPremium: null,
        FL: {
          pre65MedicalPremium: 500,
          pre65MedicalOOP: 5000,
          pre65DentalPremium: 50,
          pre65DentalOOP: 1000,
          pre65VisionPremium: 20,
          pre65VisionOOP: 200,
          supplementPremium: null,
          supplementOOP: null,
          medicarePartDPremium: null,
          medicarePartDDeductibleCopays: null,
          post65HearingCare: null,
          post65DentalPremium: null,
          post65DentalOOP: null,
          post65VisionPremium: null,
          post65VisionOOP: null,
        },
        MD: {
          pre65MedicalPremium: 500,
          pre65MedicalOOP: 5000,
          pre65DentalPremium: 50,
          pre65DentalOOP: 1000,
          pre65VisionPremium: 20,
          pre65VisionOOP: 200,
          supplementPremium: null,
          supplementOOP: null,
          medicarePartDPremium: null,
          medicarePartDDeductibleCopays: null,
          post65HearingCare: null,
          post65DentalPremium: null,
          post65DentalOOP: null,
          post65VisionPremium: null,
          post65VisionOOP: null,
        },
      };

      // User logged $55,000 living expenses and only $400 out-of-pocket medical co-pays
      inputs.actualTracking = {
        2026: {
          year: 2026,
          totalLivingExpenses: 55000,
          healthcareOOP: 400,
          equityReturnRate: 0.08,
          fixedIncomeReturnRate: 0.04,
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      expect(row2026).toBeDefined();

      expect(row2026?.livingExpenses).toBeCloseTo(55400, 1);
      expect(row2026?.healthcareOOP).toBeCloseTo(400, 1);
      expect(row2026?.plannedHealthcareOOP).toBeCloseTo(6200, 0);

      // Planned total budget = $60,000 base + $6,200 OOP max = $66,200
      // Actual total spend = $55,400
      // Spending savings = $66,200 - $55,400 = +$10,800 savings!
      expect(row2026?.actualSurplusGap).toBeGreaterThan(10000);
    });

    it('should use explicit priorTaxReturnMAGI for 2-year lookback IRMAA evaluation in initial simulation years', () => {
      const inputs = getBaseActualsTestInputs();
      inputs.isSingleFiler = true;
      // Primary is 66 in 2026 (born 1960), meaning on Medicare Part B
      inputs.you.birthDate = '1960-01-01';
      inputs.you.plannedRetirementAge = 65;

      // Provide explicit 2024 tax return MAGI that lands in IRMAA Tier 2 (> $133,000 for single in 2024)
      inputs.priorTaxReturnMAGI = {
        2024: 165000,
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find(r => r.year === 2026);
      expect(row2026).toBeDefined();

      // Lookback MAGI two years ago should be exactly 165,000
      expect(row2026?.magiTwoYearsAgo).toBe(165000);
      expect(row2026?.surchargeTier).toBeGreaterThan(0);
      expect(row2026?.combinedSurchargeAnnual).toBeGreaterThan(0);
    });
  });

  describe('Custom Roth Conversion Scenarios', () => {
    const getCustomTestInputs = (): AppStateInputs => ({
      you: {
        name: 'John',
        birthDate: '1965-06-15',
        estimatedPIA: 0,
        targetSSClaimingAge: null,
        plannedRetirementAge: 65,
        activeSalary: 0,
      },
      wife: {
        name: 'Jane',
        birthDate: '1968-09-20',
        estimatedPIA: 0,
        targetSSClaimingAge: null,
        plannedRetirementAge: 65,
        activeSalary: 0,
      },
      portfolio: {
        yourPreTaxIRA: 300000,
        yourRothIRA: 50000,
        yourTaxableBrokerage: 0,
        yourTaxableBasis: 0,
        yourCash: 50000,
        wifePreTaxIRA: 200000,
        wifeRothIRA: 20000,
        wifeTaxableBrokerage: 0,
        wifeTaxableBasis: 0,
        wifeCash: 0,
      },
      jurisdiction: {
        currentState: 'FL',
        targetState: 'FL',
        relocationYear: null,
      },
      growthAssumptions: {
        equityReturnRate: 0.05,
        fixedIncomeReturnRate: 0.03,
        cpiInflationRate: 0.025,
        healthcareInflationRate: 0.04,
      },
      annualLivingExpenses: 20000,
      annualRothConversion: 0,
      rothConversionTargetValue: null,
      rothConversionStartYear: 2027,
      rothConversionEndYear: 2030,
      rothConversionStrategy: 'custom',
      customRothScenarios: [
        {
          id: 'custom-plan-1',
          name: 'Frontloaded Custom Plan',
          schedule: {
            2027: 85000,
            2028: 95000,
            2029: 60000,
            2030: 40000,
          },
          createdAt: '2026-09-04T00:00:00.000Z',
          updatedAt: '2026-09-04T00:00:00.000Z',
        },
      ],
      activeCustomScenarioId: 'custom-plan-1',
      monteCarloSettings: {
        mode: 'monte-carlo',
        equityVolatility: 0.0,
        fixedIncomeVolatility: 0.0,
        correlation: 0.0,
        trials: 1,
        seed: 42,
      },
      isConfigured: true,
      isSingleFiler: false,
    });

    it('should convert exact nominal scheduled amounts each year and 0 in unconfigured years', () => {
      const inputs = getCustomTestInputs();
      const ledger = runRetirementSimulation(inputs);

      const row2026 = ledger.find(r => r.year === 2026);
      const row2027 = ledger.find(r => r.year === 2027);
      const row2028 = ledger.find(r => r.year === 2028);
      const row2029 = ledger.find(r => r.year === 2029);
      const row2030 = ledger.find(r => r.year === 2030);
      const row2031 = ledger.find(r => r.year === 2031);

      // 2026: Not in schedule -> 0
      expect(row2026?.intentionalRothConversion).toBe(0);

      // 2027: Exactly $85,000 nominal (without inflation scaling)
      expect(row2027?.intentionalRothConversion).toBe(85000);
      expect(row2027?.requestedCustomRothConversion).toBe(85000);
      expect(row2027?.isRothConversionCapped).toBe(false);

      // 2028: Exactly $95,000 nominal
      expect(row2028?.intentionalRothConversion).toBe(95000);
      expect(row2028?.requestedCustomRothConversion).toBe(95000);
      expect(row2028?.isRothConversionCapped).toBe(false);

      // 2029: Exactly $60,000 nominal
      expect(row2029?.intentionalRothConversion).toBe(60000);

      // 2030: Exactly $40,000 nominal
      expect(row2030?.intentionalRothConversion).toBe(40000);

      // 2031: Not in schedule -> 0
      expect(row2031?.intentionalRothConversion).toBe(0);
    });

    it('should cap conversion when pre-tax balances are exhausted and set warning flags', () => {
      const inputs = getCustomTestInputs();
      // Lower starting pre-tax balances so it exhausts in 2028
      inputs.portfolio.yourPreTaxIRA = 80000;
      inputs.portfolio.wifePreTaxIRA = 40000; // Total starting pre-tax = 120,000

      inputs.customRothScenarios = [
        {
          id: 'heavy-plan',
          name: 'Heavy Aggressive Plan',
          schedule: {
            2026: 100000,
            2027: 100000, // Starting pre-tax had ~120k, after 100k conversion in 2026, ~20k remains
          },
          createdAt: '2026-09-04T00:00:00.000Z',
          updatedAt: '2026-09-04T00:00:00.000Z',
        },
      ];
      inputs.activeCustomScenarioId = 'heavy-plan';

      const ledger = runRetirementSimulation(inputs);

      const row2026 = ledger.find(r => r.year === 2026);
      const row2027 = ledger.find(r => r.year === 2027);

      expect(row2026?.intentionalRothConversion).toBe(100000);
      expect(row2026?.isRothConversionCapped).toBe(false);

      // 2027 requested 100,000 but only ~20k plus growth remained
      expect(row2027).toBeDefined();
      expect(row2027?.requestedCustomRothConversion).toBe(100000);
      expect(row2027?.isRothConversionCapped).toBe(true);
      expect(row2027?.intentionalRothConversion).toBeLessThan(100000);
      expect(row2027?.intentionalRothConversion).toBeGreaterThan(0);
      expect(row2027?.rothConversionShortfall).toBeCloseTo(
        100000 - (row2027?.intentionalRothConversion || 0),
        1
      );
    });
  });

  describe('Itemized Expenses with Multi-Year Target Years', () => {
    it('should apply one-time expenses only in their designated target years with proper CPI inflation', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.useDetailedExpenses = true;
      inputs.growthAssumptions.cpiInflationRate = 0.03; // 3% inflation
      inputs.jurisdiction.currentState = 'MD';
      inputs.jurisdiction.targetState = 'FL';
      inputs.jurisdiction.relocationYear = null; // Stays in MD

      // Base recurring: $60,000/yr ($5,000/mo)
      // One-time 1: $10,000 in Year 1 (2026)
      // One-time 2: $25,000 roof in Year 5 (2030)
      inputs.detailedExpenses = {
        catalog: {
          categories: ['Housing', 'One-Time Setup Costs'],
          items: [
            {
              id: 'rent',
              name: 'Rent / Mortgage',
              category: 'Housing',
              defaultFrequency: 12,
              isOneTime: false,
            },
            {
              id: 'moving',
              name: 'Initial Moving Costs',
              category: 'One-Time Setup Costs',
              defaultFrequency: 1,
              isOneTime: true,
              targetYear: 2026,
            },
            {
              id: 'roof',
              name: 'New Roof',
              category: 'One-Time Setup Costs',
              defaultFrequency: 1,
              isOneTime: true,
              targetYear: 2030,
            },
          ],
        },
        costs: {
          MD: {
            rent: 5000,
            moving: 10000,
            roof: 25000,
          },
          FL: {
            rent: 5000,
            moving: 10000,
            roof: 25000,
          },
        },
        frequencies: {
          rent: 12,
          moving: 1,
          roof: 1,
        },
      };

      const ledger = runRetirementSimulation(inputs);

      const row2026 = ledger.find((r) => r.year === 2026);
      const row2027 = ledger.find((r) => r.year === 2027);
      const row2030 = ledger.find((r) => r.year === 2030);

      expect(row2026).toBeDefined();
      expect(row2027).toBeDefined();
      expect(row2030).toBeDefined();

      // 2026: base recurring $60k + $10k moving (cpiFactor = 1.0) = $70,000
      expect(row2026?.livingExpenses).toBeCloseTo(70000, 1);

      // 2027: base recurring $60k * 1.03 = $61,800 (no one-time expenses)
      expect(row2027?.livingExpenses).toBeCloseTo(60000 * 1.03, 1);

      // 2030 (4 years after 2026):
      // cpiFactor = (1.03)^4 = 1.12550881
      // base recurring = 60000 * (1.03)^4 = 67,530.53
      // roof one-time = 25000 * (1.03)^4 = 28,137.72
      // total = 67530.53 + 28137.72 = 95,668.25
      const expectedCPI = Math.pow(1.03, 4);
      const expected2030Expenses = 60000 * expectedCPI + 25000 * expectedCPI;
      expect(row2030?.livingExpenses).toBeCloseTo(expected2030Expenses, 1);
    });

    it('should resolve post-relocation state cost for one-time expenses scheduled in/after relocation year', () => {
      const inputs = getMockInputs();
      inputs.simulationStartYear = 2026;
      inputs.useDetailedExpenses = true;
      inputs.growthAssumptions.cpiInflationRate = 0.0; // 0% inflation for easy cost comparison
      inputs.jurisdiction.currentState = 'MD';
      inputs.jurisdiction.targetState = 'FL';
      inputs.jurisdiction.relocationYear = 2028; // Relocates to FL in 2028

      inputs.detailedExpenses = {
        catalog: {
          categories: ['Housing', 'One-Time Setup Costs'],
          items: [
            {
              id: 'base',
              name: 'Living Baseline',
              category: 'Housing',
              defaultFrequency: 12,
              isOneTime: false,
            },
            {
              id: 'pool',
              name: 'Install Pool',
              category: 'One-Time Setup Costs',
              defaultFrequency: 1,
              isOneTime: true,
              targetYear: 2029, // After relocation to FL
            },
          ],
        },
        costs: {
          MD: {
            base: 5000,
            pool: 50000,
          },
          FL: {
            base: 4000,
            pool: 35000, // FL pool cost is $35k vs MD $50k
          },
        },
        frequencies: {
          base: 12,
          pool: 1,
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2029 = ledger.find((r) => r.year === 2029);

      expect(row2029).toBeDefined();
      // In 2029 (FL), baseline = 4000 * 12 = 48000, pool = 35000 (from FL cost table)
      expect(row2029?.livingExpenses).toBeCloseTo(48000 + 35000, 1);
    });

    it('should correctly include and exclude line items based on applicableStates across relocation', () => {
      const inputs = getMockInputs();
      inputs.growthAssumptions.cpiInflationRate = 0; // Flat inflation for predictable math
      inputs.jurisdiction.currentState = 'MD';
      inputs.jurisdiction.targetState = 'FL';
      inputs.jurisdiction.relocationYear = 2028;
      inputs.useDetailedExpenses = true;
      inputs.detailedExpenses = {
        catalog: {
          categories: ['Living', 'Housing'],
          items: [
            {
              id: 'gas',
              name: 'Auto Gas',
              category: 'Living',
              defaultFrequency: 12,
              applicableStates: ['ALL'],
            },
            {
              id: 'snowPlow',
              name: 'Snow Plowing',
              category: 'Housing',
              defaultFrequency: 12,
              applicableStates: ['MD'],
            },
            {
              id: 'termite',
              name: 'Termite Bond',
              category: 'Housing',
              defaultFrequency: 12,
              applicableStates: ['FL'],
            },
          ],
        },
        costs: {
          MD: {
            gas: 200,
            snowPlow: 100,
            termite: 0,
          },
          FL: {
            gas: 200,
            snowPlow: 0,
            termite: 80,
          },
        },
        frequencies: {
          gas: 12,
          snowPlow: 12,
          termite: 12,
        },
      };

      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find((r) => r.year === 2026);
      const row2028 = ledger.find((r) => r.year === 2028);

      expect(row2026).toBeDefined();
      expect(row2028).toBeDefined();

      // 2026 in MD: Auto Gas ($200*12 = 2400) + Snow Plowing ($100*12 = 1200) = $3,600 (Termite excluded)
      expect(row2026?.livingExpenses).toBe(3600);

      // 2028 in FL: Auto Gas ($200*12 = 2400) + Termite ($80*12 = 960) = $3,360 (Snow Plowing excluded)
      expect(row2028?.livingExpenses).toBe(3360);
    });
  });

  describe('Spouse Healthcare Covered by Working Partner Plan', () => {
    const getBaseHealthcareInputs = (coveredByWorkingSpouse: boolean): AppStateInputs => ({
      you: {
        name: 'Primary',
        birthDate: '1960-06-27',
        plannedRetirementAge: 66,
        plannedRetirementMonth: 11, // Retires Nov 2026 (works Jan - Oct 2026, 10 months)
        targetSSClaimingAge: 70,
        estimatedPIA: 4000,
        activeSalary: 200000, // Working Jan - Oct 2026
        healthcare: {
          fileSSA44LifeChangingEvent: true,
          medicareStartMode: 'customDate' as const,
          medicareStartDate: '2026-11-01', // Starts Medicare Nov 2026
          MD: {
            pre65MedicalPremium: null,
            pre65MedicalOOP: null,
            pre65DentalPremium: null,
            pre65DentalOOP: null,
            pre65VisionPremium: null,
            pre65VisionOOP: null,
            medicarePartDPremium: null,
            medicarePartDDeductibleCopays: null,
            supplementPremium: 250,
            supplementOOP: 283,
            post65HearingCare: null,
            post65DentalPremium: 50,
            post65DentalOOP: 250,
            post65VisionPremium: 25,
            post65VisionOOP: 250,
          },
          FL: {
            pre65MedicalPremium: null,
            pre65MedicalOOP: null,
            pre65DentalPremium: null,
            pre65DentalOOP: null,
            pre65VisionPremium: null,
            pre65VisionOOP: null,
            medicarePartDPremium: null,
            medicarePartDDeductibleCopays: null,
            supplementPremium: 250,
            supplementOOP: 283,
            post65HearingCare: null,
            post65DentalPremium: 50,
            post65DentalOOP: 250,
            post65VisionPremium: 25,
            post65VisionOOP: 250,
          },
          medicarePartBPremium: null,
        },
      },
      wife: {
        name: 'Spouse',
        birthDate: '1964-03-11', // Age 62 in 2026, reaches 65 in 2029
        plannedRetirementAge: 61,
        plannedRetirementMonth: 6,
        targetSSClaimingAge: 70,
        estimatedPIA: 2500,
        activeSalary: 0,
        healthcare: {
          fileSSA44LifeChangingEvent: true,
          coveredByWorkingSpousePlan: coveredByWorkingSpouse,
          medicareStartMode: 'age65' as const,
          medicareStartDate: null,
          MD: {
            pre65MedicalPremium: 590,
            pre65DentalPremium: 30,
            pre65VisionPremium: 10,
            pre65MedicalOOP: 6000,
            pre65DentalOOP: 250,
            pre65VisionOOP: 250,
            medicarePartDPremium: null,
            medicarePartDDeductibleCopays: null,
            supplementPremium: 280,
            supplementOOP: 337,
            post65HearingCare: null,
            post65DentalPremium: 50,
            post65DentalOOP: 250,
            post65VisionPremium: 25,
            post65VisionOOP: 250,
          },
          FL: {
            pre65MedicalPremium: 590,
            pre65DentalPremium: 30,
            pre65VisionPremium: 10,
            pre65MedicalOOP: 6000,
            pre65DentalOOP: 250,
            pre65VisionOOP: 250,
            medicarePartDPremium: null,
            medicarePartDDeductibleCopays: null,
            supplementPremium: 280,
            supplementOOP: 337,
            post65HearingCare: null,
            post65DentalPremium: 50,
            post65DentalOOP: 250,
            post65VisionPremium: 25,
            post65VisionOOP: 250,
          },
          medicarePartBPremium: null,
        },
      },
      portfolio: {
        yourPreTaxIRA: 500000,
        yourRothIRA: 50000,
        yourTaxableBrokerage: 0,
        yourTaxableBasis: 0,
        yourCash: 50000,
        wifePreTaxIRA: 200000,
        wifeRothIRA: 20000,
        wifeTaxableBrokerage: 0,
        wifeTaxableBasis: 0,
        wifeCash: 0,
      },
      jurisdiction: {
        currentState: 'MD',
        targetState: 'MD',
        relocationYear: null,
      },
      growthAssumptions: {
        equityReturnRate: 0.05,
        fixedIncomeReturnRate: 0.03,
        cpiInflationRate: 0.0,
        healthcareInflationRate: 0.0,
      },
      annualLivingExpenses: 60000,
      annualRothConversion: 0,
      rothConversionTargetValue: null,
      rothConversionStartYear: 2027,
      rothConversionEndYear: 2030,
      rothConversionStrategy: 'flat' as const,
      monteCarloSettings: {
        mode: 'monte-carlo',
        equityVolatility: 0.0,
        fixedIncomeVolatility: 0.0,
        correlation: 0.0,
        trials: 1,
        seed: 42,
      },
      isConfigured: true,
      isSingleFiler: false,
    });

    it('should waive spouse pre-65 premiums and OOP during working months and activate post-retirement', () => {
      const inputs = getBaseHealthcareInputs(true);
      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find((r) => r.year === 2026);
      const row2027 = ledger.find((r) => r.year === 2027);

      expect(row2026).toBeDefined();
      expect(row2027).toBeDefined();

      // In 2026: Primary works Jan-Oct (10 mo). Spouse is covered on primary's plan for 10 mo ($0).
      // Spouse only pays Pre-65 for Nov & Dec (2 mo):
      // Monthly pre-65 = $590 + $30 + $10 = $630.
      // 2 mo pre-65 = $630 * 2 = $1,260.
      expect(row2026?.preMedicareHealthcareCost).toBe(1260);

      // Spouse planned OOP is pro-rated for 2 months: ($6,000 + $250 + $250) * (2/12) = $6,500 * (2/12) = $1,083.33
      // Primary Medicare OOP for 2 months (Nov & Dec): ($283 + $250 + $250) * (2/12) = $783 * (2/12) = $130.50
      // Total plannedHealthcareOOP = 1083.33 + 130.50 = $1,213.83
      expect(Math.round(row2026?.plannedHealthcareOOP ?? 0)).toBe(1214);

      // In 2027: Primary is fully retired all 12 months. Spouse is on pre-65 all 12 months:
      // Annual pre-65 = $630 * 12 = $7,560.
      expect(row2027?.preMedicareHealthcareCost).toBe(7560);
      // Annual spouse OOP = $6,500, primary Medicare OOP = $783 -> Total = $7,283
      expect(Math.round(row2027?.plannedHealthcareOOP ?? 0)).toBe(7283);
    });

    it('should charge full 12 months pre-65 premiums when option is disabled', () => {
      const inputs = getBaseHealthcareInputs(false);
      const ledger = runRetirementSimulation(inputs);
      const row2026 = ledger.find((r) => r.year === 2026);

      expect(row2026).toBeDefined();
      // When disabled, spouse incurs all 12 months of pre-65 premiums in 2026: $630 * 12 = $7,560
      expect(row2026?.preMedicareHealthcareCost).toBe(7560);
      // Spouse full year OOP ($6,500) + Primary 2 mo Medicare OOP ($130.50) = $6,630.50
      expect(Math.round(row2026?.plannedHealthcareOOP ?? 0)).toBe(6631);
    });
  });
});



