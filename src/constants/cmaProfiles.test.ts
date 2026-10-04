import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_CMA_PROFILES,
  calculateArithmeticDrift,
  calculateGeometricCagr,
  getAllCmaProfiles,
  getCmaProfile,
  getFieldDeviations,
  isProfileModified,
  DEFAULT_CMA_PROFILE_ID,
} from './cmaProfiles';
import { CMAProfile } from '../types';

describe('cmaProfiles registry and mathematical utilities', () => {
  it('contains the curated Big Three and Consensus profiles', () => {
    const ids = BUILT_IN_CMA_PROFILES.map(p => p.id);
    expect(ids).toContain('vanguard-2026');
    expect(ids).toContain('blackrock-2026');
    expect(ids).toContain('jpmorgan-2026');
    expect(ids).toContain('consensus-2026');
  });

  it('correctly calculates stochastic arithmetic drift accounting for volatility drag', () => {
    // 7.0% CAGR with 16.0% volatility
    // mu = 0.07 + (0.16^2) / 2 = 0.07 + 0.0128 = 0.0828 (8.28%)
    const drift = calculateArithmeticDrift(0.07, 0.16);
    expect(drift).toBeCloseTo(0.0828, 4);

    // In reverse: 8.28% arithmetic drift with 16% volatility recovers 7.0% CAGR
    const cagr = calculateGeometricCagr(drift, 0.16);
    expect(cagr).toBeCloseTo(0.07, 4);
  });

  it('retrieves profiles by ID and handles custom profiles', () => {
    const vanguard = getCmaProfile('vanguard-2026');
    expect(vanguard).toBeDefined();
    expect(vanguard?.name).toBe('Vanguard VCMM');
    expect(vanguard?.equityReturnRate).toBe(0.068);

    const customProfile: CMAProfile = {
      id: 'custom-adviser-2026',
      name: 'Adviser Custom 2026',
      institution: 'Independent RIA',
      editionYear: 2026,
      horizon: '30-Year Secular',
      isBuiltIn: false,
      equityReturnRate: 0.075,
      equityVolatility: 0.165,
      fixedIncomeReturnRate: 0.05,
      fixedIncomeVolatility: 0.06,
      cashYieldRate: 0.04,
      cpiInflationRate: 0.028,
      correlation: 0.20,
    };

    const retrievedCustom = getCmaProfile('custom-adviser-2026', [customProfile]);
    expect(retrievedCustom).toBeDefined();
    expect(retrievedCustom?.name).toBe('Adviser Custom 2026');

    const all = getAllCmaProfiles([customProfile]);
    expect(all.length).toBe(BUILT_IN_CMA_PROFILES.length + 1);
  });

  it('accurately identifies field deviations and modification states', () => {
    const preset = BUILT_IN_CMA_PROFILES.find(p => p.id === 'vanguard-2026')!;
    
    // Exact match: not modified
    const currentUnchanged = {
      equityReturnRate: preset.equityReturnRate,
      equityVolatility: preset.equityVolatility,
      fixedIncomeReturnRate: preset.fixedIncomeReturnRate,
      fixedIncomeVolatility: preset.fixedIncomeVolatility,
      cashYieldRate: preset.cashYieldRate,
      cpiInflationRate: preset.cpiInflationRate,
      correlation: preset.correlation,
    };

    expect(isProfileModified(preset, currentUnchanged)).toBe(false);

    // Modified equity return
    const currentModified = {
      ...currentUnchanged,
      equityReturnRate: 0.075,
    };

    expect(isProfileModified(preset, currentModified)).toBe(true);

    const deviations = getFieldDeviations(preset, currentModified);
    expect(deviations.equityReturnRate.isModified).toBe(true);
    expect(deviations.equityReturnRate.delta).toBeCloseTo(0.075 - 0.068, 4);
    expect(deviations.fixedIncomeReturnRate.isModified).toBe(false);
  });

  it('exports a valid default CMA profile ID that resolves to a built-in preset', () => {
    expect(DEFAULT_CMA_PROFILE_ID).toBe('vanguard-2026');
    const defaultProfile = getCmaProfile(DEFAULT_CMA_PROFILE_ID);
    expect(defaultProfile).toBeDefined();
    expect(defaultProfile?.isBuiltIn).toBe(true);
  });
});
