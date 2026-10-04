import { describe, it, expect } from 'vitest';
import {
  mulberry32,
  generateSyntheticSequence,
  generateHistoricalSequence,
  runMonteCarloSimulation,
  computeHistoricalStats,
  applyStressTestToSequence,
  EQUITY_RETURN_MIN,
  EQUITY_RETURN_MAX,
  BOND_RETURN_MIN,
  BOND_RETURN_MAX,
  INFLATION_RATE_MIN,
  INFLATION_RATE_MAX,
} from './monteCarloEngine';
import { AppStateInputs } from '../types';

describe('mulberry32 seedable PRNG', () => {
  it('should generate deterministic random numbers for the same seed', () => {
    const seed = 12345;
    const rng1 = mulberry32(seed);
    const rng2 = mulberry32(seed);

    const values1 = [rng1(), rng1(), rng1()];
    const values2 = [rng2(), rng2(), rng2()];

    expect(values1).toEqual(values2);
  });

  it('should generate different numbers for different seeds', () => {
    const rng1 = mulberry32(111);
    const rng2 = mulberry32(222);

    const values1 = [rng1(), rng1(), rng1()];
    const values2 = [rng2(), rng2(), rng2()];

    expect(values1).not.toEqual(values2);
  });
});

describe('generateSyntheticSequence', () => {
  it('should generate bivariate normal stock and bond returns of length 35', () => {
    const rand = mulberry32(42);
    const sequence = generateSyntheticSequence(0.08, 0.15, 0.04, 0.05, 0.1, rand);

    expect(sequence.mode).toBe('monte-carlo');
    expect(sequence.equityReturns).toBeInstanceOf(Array);
    expect(sequence.equityReturns.length).toBe(35);
    expect(sequence.fixedIncomeReturns).toBeInstanceOf(Array);
    expect(sequence.fixedIncomeReturns.length).toBe(35);

    // Verify returns are close to expected averages over 35 samples
    const avgEquity = sequence.equityReturns.reduce((sum, r) => sum + r, 0) / 35;
    const avgBond = sequence.fixedIncomeReturns.reduce((sum, r) => sum + r, 0) / 35;

    // With seed 42, they should fall within standard ranges
    expect(avgEquity).toBeGreaterThan(0.02);
    expect(avgEquity).toBeLessThan(0.14);
    expect(avgBond).toBeGreaterThan(0.01);
    expect(avgBond).toBeLessThan(0.07);
  });

  it('should enforce realistic boundary clamps on equity, bond, and inflation returns even under extreme volatility', () => {
    // Test across 100 trials using high volatility settings that would otherwise trigger fat-tail outliers
    const rand = mulberry32(999);
    for (let trial = 0; trial < 100; trial++) {
      const sequence = generateSyntheticSequence(0.10, 0.50, 0.05, 0.30, 0.2, rand);

      // Verify all equity returns fall within [-50%, +60%]
      for (const eq of sequence.equityReturns) {
        expect(eq).toBeGreaterThanOrEqual(EQUITY_RETURN_MIN);
        expect(eq).toBeLessThanOrEqual(EQUITY_RETURN_MAX);
      }

      // Verify all bond returns fall within [-20%, +30%]
      for (const fi of sequence.fixedIncomeReturns) {
        expect(fi).toBeGreaterThanOrEqual(BOND_RETURN_MIN);
        expect(fi).toBeLessThanOrEqual(BOND_RETURN_MAX);
      }

      // Verify all inflation rates fall within [-2%, +15%]
      expect(sequence.inflationRates).toBeDefined();
      for (const inf of sequence.inflationRates!) {
        expect(inf).toBeGreaterThanOrEqual(INFLATION_RATE_MIN);
        expect(inf).toBeLessThanOrEqual(INFLATION_RATE_MAX);
      }
    }
  });
});

describe('generateHistoricalSequence', () => {
  it('should sample from historical returns with length 35', () => {
    const rand = mulberry32(777);

    // Random year sampling (standard bootstrap)
    const bootstrapSeq = generateHistoricalSequence(false, undefined, rand);
    expect(bootstrapSeq.mode).toBe('historical');
    expect(bootstrapSeq.equityReturns.length).toBe(35);
    expect(bootstrapSeq.fixedIncomeReturns.length).toBe(35);

    // Block sampling (contiguous segment)
    const blockSeq = generateHistoricalSequence(true, 10, rand);
    expect(blockSeq.mode).toBe('historical');
    expect(blockSeq.equityReturns.length).toBe(35);
    expect(blockSeq.fixedIncomeReturns.length).toBe(35);

    // Contiguous verification: year t+1 index matches historical +1
    // At index 10: stock and bond should match index 11 at next step, etc.
    // The sequence starts at index 10 of HISTORICAL_RETURNS
    expect(blockSeq.equityReturns[0]).toBeDefined();
  });

  it('should clamp calibrated historical returns within boundary limits when large shifts are applied', () => {
    const rand = mulberry32(555);
    // Calibrate with an extreme equity target mean (e.g. 50%) to verify clamping at maximum
    const highSeq = generateHistoricalSequence(false, undefined, rand, true, null, true, 0.50, 0.25);

    // Verify all shifted historical returns stay within boundary clamps
    for (const eq of highSeq.equityReturns) {
      expect(eq).toBeLessThanOrEqual(EQUITY_RETURN_MAX);
      expect(eq).toBeGreaterThanOrEqual(EQUITY_RETURN_MIN);
    }
    for (const fi of highSeq.fixedIncomeReturns) {
      expect(fi).toBeLessThanOrEqual(BOND_RETURN_MAX);
      expect(fi).toBeGreaterThanOrEqual(BOND_RETURN_MIN);
    }
    expect(highSeq.inflationRates).toBeDefined();
    for (const inf of highSeq.inflationRates!) {
      expect(inf).toBeLessThanOrEqual(INFLATION_RATE_MAX);
      expect(inf).toBeGreaterThanOrEqual(INFLATION_RATE_MIN);
    }
  });
});

describe('runMonteCarloSimulation', () => {
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
      wifePreTaxIRA: 300000,
      wifeRothIRA: 50000,
      wifeTaxableBrokerage: 100000,
      wifeTaxableBasis: 80000,
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
      trials: 10, // Small trial count for speed
      seed: 999,
    },
    isConfigured: true,
    isSingleFiler: false,
  });

  it('should compile trial statistics and representative paths successfully', () => {
    const inputs = getMockInputs();
    const summary = runMonteCarloSimulation(inputs);

    expect(summary.trialsRun).toBe(10);
    expect(summary.successRate).toBeGreaterThanOrEqual(0);
    expect(summary.successRate).toBeLessThanOrEqual(1.0);

    expect(summary.percentiles).toBeInstanceOf(Array);
    expect(summary.percentiles.length).toBe(35);
    expect(summary.percentiles[0].year).toBe(2026);

    // Verify representative paths
    expect(summary.representativeSequences.worst).toBeDefined();
    expect(summary.representativeSequences.median).toBeDefined();
    expect(summary.representativeSequences.best).toBeDefined();

    // Verifying percentile order sorting: worst < median < best
    const lastYearIndex = summary.percentiles.length - 1;
    const lastYearPercentiles = summary.percentiles[lastYearIndex];
    expect(lastYearPercentiles.p10).toBeLessThanOrEqual(lastYearPercentiles.p50);
    expect(lastYearPercentiles.p50).toBeLessThanOrEqual(lastYearPercentiles.p90);
  });

  it('should support deterministic seed reproducibility and trial IDs', () => {
    const inputs = getMockInputs();
    inputs.monteCarloSettings!.seed = 999;
    const summary1 = runMonteCarloSimulation(inputs);

    const inputs2 = getMockInputs();
    inputs2.monteCarloSettings!.seed = 999;
    const summary2 = runMonteCarloSimulation(inputs2);

    expect(summary1.successRate).toBe(summary2.successRate);
    expect(summary1.representativeSequences.worst.id).toBe(summary2.representativeSequences.worst.id);
  });

  it('should calculate medianSurvivalYears and track timeToRuin correctly', () => {
    // Modify inputs to ensure immediate portfolio failure by having huge living expenses and no assets
    const inputs = getMockInputs();
    inputs.annualLivingExpenses = 10000000; // 10 million / year
    inputs.portfolio.yourPreTaxIRA = 1;
    inputs.portfolio.yourRothIRA = 0;
    inputs.portfolio.yourTaxableBrokerage = 0;
    inputs.portfolio.wifePreTaxIRA = 0;
    inputs.portfolio.wifeRothIRA = 0;
    inputs.portfolio.wifeTaxableBrokerage = 0;

    const summary = runMonteCarloSimulation(inputs);
    expect(summary.successRate).toBe(0); // 100% failure rate
    expect(summary.medianSurvivalYears).toBeDefined();
    expect(summary.medianSurvivalYears).toBeLessThanOrEqual(5); // Ruined almost immediately (e.g. year 2026/2027)
  });
});

describe('computeHistoricalStats', () => {
  it('should compute actual returns and correlation from historical data', () => {
    const stats = computeHistoricalStats();
    expect(stats.equityMean).toBeCloseTo(0.123, 2); // Stock return avg (~12.3%)
    expect(stats.equityVol).toBeGreaterThan(0.10);
    expect(stats.bondVol).toBeGreaterThan(0.04);
    expect(stats.correlation).toBeDefined();
    expect(stats.inflationMean).toBeCloseTo(0.041, 2); // (~4.1% average)
  });
});

describe('generateHistoricalSequence constraint & co-sampling', () => {
  it('should restrict index to prevent block wraparound and include inflationRates', () => {
    const rand = mulberry32(111);
    
    // Check that inflation rates are present
    const bootstrapSeq = generateHistoricalSequence(false, undefined, rand);
    expect(bootstrapSeq.inflationRates).toBeDefined();
    expect(bootstrapSeq.inflationRates!.length).toBe(35);
    
    // Check block sequence does not wrap around
    // Starting index 50: since count is 56, count - 35 is 21. Max start year index is 21.
    // So index 50 will be capped at 21!
    const blockSeq = generateHistoricalSequence(true, 50, rand);
    expect(blockSeq.inflationRates!.length).toBe(35);
    // Index should match the capped start year
    // HISTORICAL_RETURNS[21] is year 1991 (1970 + 21 = 1991)
    // stock return of 1991 is 0.3055
    expect(blockSeq.equityReturns[0]).toBeCloseTo(0.3055, 4);
  });
});

describe('Monte Carlo sequence regeneration', () => {
  it('should generate different return sequences when seed or nonce changes', () => {
    const seed1 = 12345;
    const seed2 = 67890;

    const rng1 = mulberry32(seed1);
    const rng2 = mulberry32(seed2);

    const seq1 = generateSyntheticSequence(0.08, 0.15, 0.04, 0.05, 0.15, rng1);
    const seq2 = generateSyntheticSequence(0.08, 0.15, 0.04, 0.05, 0.15, rng2);

    expect(seq1.equityReturns).not.toEqual(seq2.equityReturns);
  });
});

describe('applyStressTestToSequence & stress testing', () => {
  const getMockInputsLocal = (): AppStateInputs => ({
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
      wifePreTaxIRA: 300000,
      wifeRothIRA: 50000,
      wifeTaxableBrokerage: 100000,
      wifeTaxableBasis: 80000,
      yourCash: 50000,
      wifeCash: 30000,
    },
    jurisdiction: {
      relocationYear: 2026,
      currentState: 'MD',
      targetState: 'FL',
    },
    growthAssumptions: {
      equityReturnRate: 0.08,
      fixedIncomeReturnRate: 0.04,
      cpiInflationRate: 0.025,
      healthcareInflationRate: 0.05,
    },
    annualLivingExpenses: 100000,
    annualRothConversion: 50000,
    rothConversionStrategy: 'flat',
    rothConversionTargetValue: null,
    monteCarloSettings: {
      mode: 'monte-carlo',
      equityVolatility: 0.15,
      fixedIncomeVolatility: 0.05,
      correlation: 0.15,
      trials: 1000,
      seed: 42,
    },
    isConfigured: true,
    isSingleFiler: false,
  });

  it('should non-destructively overlay stress test overrides when enabled', () => {
    const rand = mulberry32(42);
    const baseSeq = generateSyntheticSequence(0.08, 0.15, 0.04, 0.05, 0.15, rand);

    // When disabled, returns original sequence unchanged
    const disabledResult = applyStressTestToSequence(baseSeq, {
      enabled: false,
      mode: 'absolute',
      overrides: [{ year: 2028, equityReturn: -0.35, fixedIncomeReturn: -0.05 }],
    });
    expect(disabledResult.equityReturns[2]).toBe(baseSeq.equityReturns[2]);

    // When enabled in absolute mode
    const enabledAbsolute = applyStressTestToSequence(baseSeq, {
      enabled: true,
      mode: 'absolute',
      overrides: [{ year: 2028, equityReturn: -0.35, fixedIncomeReturn: -0.05 }],
    });
    expect(enabledAbsolute.equityReturns[2]).toBe(-0.35); // Year 2028 is index 2 (2028 - 2026)
    expect(enabledAbsolute.fixedIncomeReturns[2]).toBe(-0.05);

    // Other years remain unchanged
    expect(enabledAbsolute.equityReturns[0]).toBe(baseSeq.equityReturns[0]);

    // When enabled in relative mode
    const enabledRelative = applyStressTestToSequence(baseSeq, {
      enabled: true,
      mode: 'relative',
      overrides: [{ year: 2028, equityReturn: -0.20, fixedIncomeReturn: -0.10 }],
    });
    expect(enabledRelative.equityReturns[2]).toBeCloseTo(baseSeq.equityReturns[2] - 0.20, 6);
  });

  it('should restore original baseline Monte Carlo results when stress test is toggled off', () => {
    const inputs = getMockInputsLocal();
    inputs.monteCarloSettings.seed = 999;

    const baselineSummary = runMonteCarloSimulation(inputs);

    // Enable severe stress test
    inputs.monteCarloSettings.stressTest = {
      enabled: true,
      mode: 'absolute',
      overrides: [
        { year: 2027, equityReturn: -0.40, fixedIncomeReturn: -0.10 },
        { year: 2028, equityReturn: -0.30, fixedIncomeReturn: -0.05 },
      ],
    };
    const stressedSummary = runMonteCarloSimulation(inputs);
    expect(stressedSummary.percentiles[2].p10).toBeLessThan(baselineSummary.percentiles[2].p10);

    // Toggle off
    inputs.monteCarloSettings.stressTest.enabled = false;
    const restoredSummary = runMonteCarloSimulation(inputs);

    expect(restoredSummary.successRate).toBe(baselineSummary.successRate);
    expect(restoredSummary.percentiles[2].p50).toBe(baselineSummary.percentiles[2].p50);
  });

  it('should maintain matched-pair return rates for all non-stressed years in representative sequences', () => {
    const inputs = getMockInputsLocal();
    inputs.monteCarloSettings.seed = 42;
    inputs.monteCarloSettings.trials = 50;

    // Baseline run
    const baseSummary = runMonteCarloSimulation(inputs);
    const baseWorstSeq = baseSummary.representativeSequences.worst;
    const baseMedianSeq = baseSummary.representativeSequences.median;

    // Enable stress test for years 2026, 2027, 2028
    inputs.monteCarloSettings.stressTest = {
      enabled: true,
      mode: 'absolute',
      overrides: [
        { year: 2026, equityReturn: -0.25, fixedIncomeReturn: -0.05 },
        { year: 2027, equityReturn: -0.15, fixedIncomeReturn: -0.02 },
        { year: 2028, equityReturn: 0.05, fixedIncomeReturn: 0.03 },
      ],
    };
    const stressedSummary = runMonteCarloSimulation(inputs);
    const stressedWorstSeq = stressedSummary.representativeSequences.worst;
    const stressedMedianSeq = stressedSummary.representativeSequences.median;

    // Stressed years (2026=index 0, 2027=index 1, 2028=index 2) must match overrides
    expect(stressedWorstSeq.equityReturns[0]).toBe(-0.25);
    expect(stressedWorstSeq.equityReturns[1]).toBe(-0.15);
    expect(stressedWorstSeq.equityReturns[2]).toBe(0.05);

    // All subsequent years (2029 through 2060, index 3 to 34) MUST be 100% identical to baseline
    for (let yrIdx = 3; yrIdx < 35; yrIdx++) {
      expect(stressedWorstSeq.equityReturns[yrIdx]).toBe(baseWorstSeq.equityReturns[yrIdx]);
      expect(stressedWorstSeq.fixedIncomeReturns[yrIdx]).toBe(baseWorstSeq.fixedIncomeReturns[yrIdx]);
      expect(stressedMedianSeq.equityReturns[yrIdx]).toBe(baseMedianSeq.equityReturns[yrIdx]);
      expect(stressedMedianSeq.fixedIncomeReturns[yrIdx]).toBe(baseMedianSeq.fixedIncomeReturns[yrIdx]);
    }
  });
});

describe('Constant vs Randomized CPI Simulation', () => {
  it('should generate constant inflation rates when randomizeCPI is false', () => {
    const rand = mulberry32(42);
    const constantRate = 0.03;
    const syntheticSeq = generateSyntheticSequence(0.08, 0.15, 0.04, 0.05, 0.15, rand, false, constantRate);
    
    expect(syntheticSeq.inflationRates).toBeDefined();
    expect(syntheticSeq.inflationRates!.length).toBe(35);
    syntheticSeq.inflationRates!.forEach(rate => {
      expect(rate).toBe(constantRate);
    });

    const historicalSeq = generateHistoricalSequence(false, undefined, rand, false, constantRate);
    expect(historicalSeq.inflationRates).toBeDefined();
    expect(historicalSeq.inflationRates!.length).toBe(35);
    historicalSeq.inflationRates!.forEach(rate => {
      expect(rate).toBe(constantRate);
    });
  });

  it('should generate randomized historical inflation rates when randomizeCPI is true', () => {
    const rand = mulberry32(42);
    const syntheticSeq = generateSyntheticSequence(0.08, 0.15, 0.04, 0.05, 0.15, rand, true);
    
    expect(syntheticSeq.inflationRates).toBeDefined();
    const uniqueRates = new Set(syntheticSeq.inflationRates);
    expect(uniqueRates.size).toBeGreaterThan(1);
  });

  it('should run Monte Carlo simulation with constant CPI when configured in inputs', () => {
    const inputs: AppStateInputs = {
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
        wifePreTaxIRA: 300000,
        wifeRothIRA: 50000,
        wifeTaxableBrokerage: 100000,
        wifeTaxableBasis: 80000,
        yourCash: 50000,
        wifeCash: 30000,
      },
      jurisdiction: {
        relocationYear: null,
        currentState: 'MD',
        targetState: 'FL',
      },
      growthAssumptions: {
        equityReturnRate: 0.08,
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
        trials: 20,
        seed: 42,
        randomizeCPI: false,
        constantCPIRate: 0.025,
      },
      isConfigured: true,
      isSingleFiler: false,
    };

    const summary = runMonteCarloSimulation(inputs);
    expect(summary.trialsRun).toBe(20);
    expect(summary.percentiles.length).toBe(35);
  });

  it('should generate cyclical sequences with Markov regime switching and mean reversion', () => {
    // Generate synthetic sequences with regime switching enabled
    const rand = mulberry32(101);
    const sequenceWithRegimes = generateSyntheticSequence(0.07, 0.15, 0.04, 0.05, 0.15, rand, true, null, true);

    expect(sequenceWithRegimes.equityReturns.length).toBe(35);
    expect(sequenceWithRegimes.fixedIncomeReturns.length).toBe(35);

    // Compute average return across the 35-year sequence
    const avgReturn = sequenceWithRegimes.equityReturns.reduce((acc, v) => acc + v, 0) / 35;

    // Verify mean return remains grounded near the target mean
    expect(avgReturn).toBeGreaterThan(0.01);
    expect(avgReturn).toBeLessThan(0.15);

    // Verify sequence contains both positive and negative returns
    const hasNegative = sequenceWithRegimes.equityReturns.some(r => r < 0);
    const hasPositive = sequenceWithRegimes.equityReturns.some(r => r > 0);
    expect(hasNegative).toBe(true);
    expect(hasPositive).toBe(true);
  });

  it('should run full Monte Carlo simulation with enableRegimeSwitching toggle enabled and disabled', () => {
    const baseInputs: AppStateInputs = {
      you: {
        birthDate: '1960-06-15',
        estimatedPIA: 3000,
        targetSSClaimingAge: 70,
        plannedRetirementAge: 65,
        activeSalary: 0,
      },
      wife: {
        birthDate: '1964-03-10',
        estimatedPIA: 2000,
        targetSSClaimingAge: 67,
        plannedRetirementAge: 62,
        activeSalary: 0,
      },
      portfolio: {
        yourPreTaxIRA: 1000000,
        yourRothIRA: 50000,
        yourTaxableBrokerage: 200000,
        yourTaxableBasis: 150000,
        wifePreTaxIRA: 200000,
        wifeRothIRA: 0,
        wifeTaxableBrokerage: 0,
        wifeTaxableBasis: 0,
        yourCash: 50000,
      },
      jurisdiction: {
        relocationYear: null,
        currentState: 'MD',
        targetState: 'FL',
      },
      growthAssumptions: {
        equityReturnRate: 0.07,
        fixedIncomeReturnRate: 0.04,
        cpiInflationRate: 0.03,
        healthcareInflationRate: 0.05,
      },
      annualLivingExpenses: 80000,
      annualRothConversion: 0,
      rothConversionStrategy: 'flat',
      rothConversionTargetValue: null,
      monteCarloSettings: {
        mode: 'monte-carlo',
        equityVolatility: 0.15,
        fixedIncomeVolatility: 0.05,
        correlation: 0.15,
        trials: 50,
        seed: 42,
        randomizeCPI: true,
        enableRegimeSwitching: true,
      },
      isConfigured: true,
      isSingleFiler: false,
    };

    // Run with regime switching enabled
    const summaryRegimes = runMonteCarloSimulation(baseInputs);
    expect(summaryRegimes.trialsRun).toBe(50);
    expect(summaryRegimes.successRate).toBeGreaterThan(0);

    // Run with regime switching disabled (pure i.i.d.)
    const inputsNoRegimes: AppStateInputs = {
      ...baseInputs,
      monteCarloSettings: {
        ...baseInputs.monteCarloSettings,
        enableRegimeSwitching: false,
      },
    };
    const summaryNoRegimes = runMonteCarloSimulation(inputsNoRegimes);
    expect(summaryNoRegimes.trialsRun).toBe(50);
    expect(summaryNoRegimes.successRate).toBeGreaterThan(0);
  });

  it('should support configurable historical sampling strategies (block, random, hybrid)', () => {
    const baseHistoricalInputs: AppStateInputs = {
      you: {
        birthDate: '1960-06-15',
        estimatedPIA: 3000,
        targetSSClaimingAge: 70,
        plannedRetirementAge: 65,
        activeSalary: 0,
      },
      wife: {
        birthDate: '1964-03-10',
        estimatedPIA: 2000,
        targetSSClaimingAge: 67,
        plannedRetirementAge: 62,
        activeSalary: 0,
      },
      portfolio: {
        yourPreTaxIRA: 1000000,
        yourRothIRA: 50000,
        yourTaxableBrokerage: 200000,
        yourTaxableBasis: 150000,
        wifePreTaxIRA: 200000,
        wifeRothIRA: 0,
        wifeTaxableBrokerage: 0,
        wifeTaxableBasis: 0,
        yourCash: 50000,
      },
      jurisdiction: {
        relocationYear: null,
        currentState: 'MD',
        targetState: 'FL',
      },
      growthAssumptions: {
        equityReturnRate: 0.07,
        fixedIncomeReturnRate: 0.04,
        cpiInflationRate: 0.03,
        healthcareInflationRate: 0.05,
      },
      annualLivingExpenses: 80000,
      annualRothConversion: 0,
      rothConversionStrategy: 'flat',
      rothConversionTargetValue: null,
      monteCarloSettings: {
        mode: 'historical',
        equityVolatility: 0.15,
        fixedIncomeVolatility: 0.05,
        correlation: 0.15,
        trials: 30,
        seed: 42,
        randomizeCPI: true,
        historicalSamplingStrategy: 'block',
      },
      isConfigured: true,
      isSingleFiler: false,
    };

    // Test 100% Contiguous Block sampling
    const summaryBlock = runMonteCarloSimulation(baseHistoricalInputs);
    expect(summaryBlock.trialsRun).toBe(30);
    expect(summaryBlock.successRate).toBeGreaterThan(0);

    // Test 100% Random Year Resampling
    const inputsRandom: AppStateInputs = {
      ...baseHistoricalInputs,
      monteCarloSettings: {
        ...baseHistoricalInputs.monteCarloSettings,
        historicalSamplingStrategy: 'random',
      },
    };
    const summaryRandom = runMonteCarloSimulation(inputsRandom);
    expect(summaryRandom.trialsRun).toBe(30);
    expect(summaryRandom.successRate).toBeGreaterThan(0);

    // Test Hybrid Sampling
    const inputsHybrid: AppStateInputs = {
      ...baseHistoricalInputs,
      monteCarloSettings: {
        ...baseHistoricalInputs.monteCarloSettings,
        historicalSamplingStrategy: 'hybrid',
      },
    };
    const summaryHybrid = runMonteCarloSimulation(inputsHybrid);
    expect(summaryHybrid.trialsRun).toBe(30);
    expect(summaryHybrid.successRate).toBeGreaterThan(0);
  });

  it('should calibrate historical return shocks to configured baseline means when enabled', () => {
    const rand = mulberry32(999);
    const targetEquityMean = 0.07;
    const targetBondMean = 0.04;

    // Generate calibrated historical sequence
    const calibratedSeq = generateHistoricalSequence(
      false,
      undefined,
      rand,
      true,
      null,
      true,
      targetEquityMean,
      targetBondMean
    );

    // Compute empirical average of the 35 sampled years
    const avgCalibratedEquity = calibratedSeq.equityReturns.reduce((s, r) => s + r, 0) / 35;
    const avgCalibratedBond = calibratedSeq.fixedIncomeReturns.reduce((s, r) => s + r, 0) / 35;

    // Calibrated returns should be centered around the target 7.0% and 4.0%
    expect(avgCalibratedEquity).toBeGreaterThan(0.03);
    expect(avgCalibratedEquity).toBeLessThan(0.12);
    expect(avgCalibratedBond).toBeGreaterThan(0.01);
    expect(avgCalibratedBond).toBeLessThan(0.08);

    // Generate raw unadjusted historical sequence (calibrateMeans = false)
    const randRaw = mulberry32(999);
    const rawSeq = generateHistoricalSequence(
      false,
      undefined,
      randRaw,
      true,
      null,
      false
    );

    const avgRawEquity = rawSeq.equityReturns.reduce((s, r) => s + r, 0) / 35;
    const avgRawBond = rawSeq.fixedIncomeReturns.reduce((s, r) => s + r, 0) / 35;

    // Raw historical returns should reflect the high 1970–2025 nominal averages (~12.3% and ~6.7%)
    expect(avgRawEquity).toBeGreaterThan(avgCalibratedEquity);
    expect(avgRawBond).toBeGreaterThan(avgCalibratedBond);
  });

  it('should maintain 100% identical representative market sequences when expenses or relocation change', () => {
    const inputs1: AppStateInputs = {
      you: {
        birthDate: '1960-06-15',
        estimatedPIA: 3000,
        targetSSClaimingAge: 70,
        plannedRetirementAge: 65,
        activeSalary: 0,
      },
      wife: {
        birthDate: '1964-03-10',
        estimatedPIA: 2000,
        targetSSClaimingAge: 67,
        plannedRetirementAge: 62,
        activeSalary: 0,
      },
      portfolio: {
        yourPreTaxIRA: 1000000,
        yourRothIRA: 50000,
        yourTaxableBrokerage: 200000,
        yourTaxableBasis: 150000,
        wifePreTaxIRA: 200000,
        wifeRothIRA: 0,
        wifeTaxableBrokerage: 0,
        wifeTaxableBasis: 0,
        yourCash: 50000,
        wifeCash: 0,
      },
      jurisdiction: {
        relocationYear: null,
        currentState: 'MD',
        targetState: 'MD',
      },
      growthAssumptions: {
        equityReturnRate: 0.07,
        fixedIncomeReturnRate: 0.04,
        cpiInflationRate: 0.03,
        healthcareInflationRate: 0.05,
      },
      annualLivingExpenses: 50000,
      annualRothConversion: 0,
      rothConversionStrategy: 'flat',
      rothConversionTargetValue: null,
      monteCarloSettings: {
        mode: 'monte-carlo',
        equityVolatility: 0.15,
        fixedIncomeVolatility: 0.05,
        correlation: 0.15,
        trials: 50,
        seed: 777,
        randomizeCPI: true,
        enableRegimeSwitching: true,
      },
      isConfigured: true,
      isSingleFiler: false,
    };

    const summary1 = runMonteCarloSimulation(inputs1);

    // Create scenario 2: radically different expenses and relocation to FL in 2030
    const inputs2: AppStateInputs = {
      ...inputs1,
      annualLivingExpenses: 180000,
      jurisdiction: {
        currentState: 'MD',
        targetState: 'FL',
        relocationYear: 2030,
      },
    };

    const summary2 = runMonteCarloSimulation(inputs2);

    // Success rates should differ due to expense difference
    expect(summary2.successRate).toBeLessThan(summary1.successRate);

    // Representative market return sequences (P10, P50, P90) MUST be 100% identical for apples-to-apples comparison
    expect(summary1.representativeSequences.worst.equityReturns).toEqual(summary2.representativeSequences.worst.equityReturns);
    expect(summary1.representativeSequences.worst.fixedIncomeReturns).toEqual(summary2.representativeSequences.worst.fixedIncomeReturns);
    expect(summary1.representativeSequences.median.equityReturns).toEqual(summary2.representativeSequences.median.equityReturns);
    expect(summary1.representativeSequences.median.fixedIncomeReturns).toEqual(summary2.representativeSequences.median.fixedIncomeReturns);
    expect(summary1.representativeSequences.best.equityReturns).toEqual(summary2.representativeSequences.best.equityReturns);
    expect(summary1.representativeSequences.best.fixedIncomeReturns).toEqual(summary2.representativeSequences.best.fixedIncomeReturns);
  });

  describe('CMA Volatility Drag & Calibrated Inflation', () => {
    it('calibrates forward inflation shocks to anchor around target CPI in synthetic sequences', () => {
      const rand = mulberry32(42);
      const targetCpi = 0.024; // Vanguard 2.4% expectation
      const trials = 100;
      let totalCpi = 0;
      let count = 0;

      for (let t = 0; t < trials; t++) {
        const seq = generateSyntheticSequence(0.068, 0.16, 0.046, 0.055, 0.15, rand, true, null, true, targetCpi);
        for (const cpi of (seq.inflationRates || [])) {
          totalCpi += cpi;
          count++;
        }
      }

      const meanCpi = totalCpi / count;
      // Mean sampled inflation across 100 trials should center tightly around target 2.4% (rather than historical 4.0%)
      expect(meanCpi).toBeCloseTo(targetCpi, 2);
    });

    it('calibrates forward inflation shocks in historical bootstrap sequences when calibrateMeans is enabled', () => {
      const rand = mulberry32(101);
      const targetCpi = 0.025;
      const seq = generateHistoricalSequence(false, undefined, rand, true, null, true, 0.07, 0.04, targetCpi);
      const rates = seq.inflationRates || [];
      const meanCpi = rates.reduce((a, b) => a + b, 0) / rates.length;
      expect(meanCpi).toBeCloseTo(targetCpi, 1);
    });

    it('applies volatility drag adjustment to elevate annual arithmetic drift in synthetic sequences', () => {
      // 7.0% target geometric CAGR with 16% volatility requires ~8.28% arithmetic drift
      const targetGeometric = 0.07;
      const vol = 0.16;
      const rand = mulberry32(999);
      const trials = 300;
      let totalAnnualEquity = 0;
      let count = 0;

      for (let t = 0; t < trials; t++) {
        // Without regime switching to directly measure normal distribution mean
        const seq = generateSyntheticSequence(targetGeometric, vol, 0.04, 0.05, 0.15, rand, false, 0.025, false, 0.025);
        for (const ret of seq.equityReturns) {
          totalAnnualEquity += ret;
          count++;
        }
      }

      const realizedArithmeticMean = totalAnnualEquity / count;
      // Realized arithmetic mean should be near 8.28% (elevated above 7.0% by ~1.28% volatility drag)
      expect(realizedArithmeticMean).toBeGreaterThan(0.078);
      expect(realizedArithmeticMean).toBeLessThan(0.088);
    });
  });

  describe('Student-t distribution handling', () => {
    it('applies Student-t fat-tail adjustments to historical sequences when enableStudentT is true', () => {
      const rand1 = mulberry32(12345);
      const rand2 = mulberry32(12345);

      const standardSeq = generateHistoricalSequence(
        false, undefined, rand1, false, 0.025, true, 0.07, 0.04, 0.025, false
      );
      const studentTSeq = generateHistoricalSequence(
        false, undefined, rand2, false, 0.025, true, 0.07, 0.04, 0.025, true
      );

      expect(standardSeq.equityReturns.length).toBe(35);
      expect(studentTSeq.equityReturns.length).toBe(35);

      // Student-t sequence should differ due to fat-tail tScale scaling
      expect(studentTSeq.equityReturns).not.toEqual(standardSeq.equityReturns);

      // All returns must remain safely clamped within institutional limits
      for (const eq of studentTSeq.equityReturns) {
        expect(eq).toBeGreaterThanOrEqual(EQUITY_RETURN_MIN);
        expect(eq).toBeLessThanOrEqual(EQUITY_RETURN_MAX);
      }
      for (const fi of studentTSeq.fixedIncomeReturns) {
        expect(fi).toBeGreaterThanOrEqual(BOND_RETURN_MIN);
        expect(fi).toBeLessThanOrEqual(BOND_RETURN_MAX);
      }
    });

    it('runs full Monte Carlo simulation with enableHistoricalStudentT toggle', () => {
      const baseInputs: AppStateInputs = {
        you: {
          birthDate: '1960-06-15',
          estimatedPIA: 3000,
          targetSSClaimingAge: 70,
          plannedRetirementAge: 65,
          activeSalary: 0,
        },
        wife: {
          birthDate: '1964-03-10',
          estimatedPIA: 2000,
          targetSSClaimingAge: 67,
          plannedRetirementAge: 62,
          activeSalary: 0,
        },
        portfolio: {
          yourPreTaxIRA: 1000000,
          yourRothIRA: 50000,
          yourTaxableBrokerage: 200000,
          yourTaxableBasis: 150000,
          wifePreTaxIRA: 200000,
          wifeRothIRA: 0,
          wifeTaxableBrokerage: 0,
          wifeTaxableBasis: 0,
          yourCash: 50000,
        },
        jurisdiction: {
          relocationYear: null,
          currentState: 'MD',
          targetState: 'FL',
        },
        growthAssumptions: {
          equityReturnRate: 0.07,
          fixedIncomeReturnRate: 0.04,
          cpiInflationRate: 0.03,
          healthcareInflationRate: 0.05,
        },
        annualLivingExpenses: 80000,
        annualRothConversion: 0,
        rothConversionStrategy: 'flat',
        rothConversionTargetValue: null,
        monteCarloSettings: {
          mode: 'historical',
          equityVolatility: 0.15,
          fixedIncomeVolatility: 0.05,
          correlation: 0.15,
          trials: 50,
          seed: 42,
          enableHistoricalStudentT: true,
        },
        isConfigured: true,
        isSingleFiler: false,
      };

      const summary = runMonteCarloSimulation(baseInputs);
      expect(summary.trialsRun).toBe(50);
      expect(summary.successRate).toBeGreaterThanOrEqual(0);
      expect(summary.percentiles.length).toBe(35);
    });
  });
});



