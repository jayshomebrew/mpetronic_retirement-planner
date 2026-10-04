import { CMAProfile } from '../types';

export const BUILT_IN_CMA_PROFILES: CMAProfile[] = [
  {
    id: 'consensus-2026',
    name: 'Industry Consensus',
    institution: 'Wall Street Research Consensus',
    editionYear: 2026,
    horizon: '30-Year Secular',
    description: 'Balanced median synthesis of premier institutional capital market assumptions (Vanguard, BlackRock, J.P. Morgan).',
    isBuiltIn: true,
    equityReturnRate: 0.070,
    equityVolatility: 0.155,
    fixedIncomeReturnRate: 0.046,
    fixedIncomeVolatility: 0.055,
    cashYieldRate: 0.035,
    cpiInflationRate: 0.025,
    cpiVolatility: 0.018,
    correlation: 0.16,
  },
  {
    id: 'vanguard-2026',
    name: 'Vanguard VCMM',
    institution: 'Vanguard Investment Strategy Group',
    editionYear: 2026,
    horizon: '30-Year Secular',
    description: 'Valuation-grounded secular outlook based on the Vanguard Capital Markets Model (VCMM), reflecting elevated starting multiples and long-term mean reversion.',
    sourceUrl: 'https://corporate.vanguard.com/content/corporatesite/us/en/corp/vemo/vemo-return-forecasts.html',
    isBuiltIn: true,
    equityReturnRate: 0.068,
    equityVolatility: 0.160,
    fixedIncomeReturnRate: 0.046,
    fixedIncomeVolatility: 0.055,
    cashYieldRate: 0.035,
    cpiInflationRate: 0.024,
    cpiVolatility: 0.018,
    correlation: 0.15,
  },
  {
    id: 'blackrock-2026',
    name: 'BlackRock BII',
    institution: 'BlackRock Investment Institute',
    editionYear: 2026,
    horizon: '30-Year Secular',
    description: 'Macro-thematic secular regime modeling structural inflation, persistent sovereign debt deficits, energy transition capex, and AI infrastructure buildout.',
    sourceUrl: 'https://www.blackrock.com/us/financial-professionals/insights/blackrock-investment-institute',
    isBuiltIn: true,
    equityReturnRate: 0.069,
    equityVolatility: 0.158,
    fixedIncomeReturnRate: 0.047,
    fixedIncomeVolatility: 0.057,
    cashYieldRate: 0.036,
    cpiInflationRate: 0.026,
    cpiVolatility: 0.019,
    correlation: 0.18,
  },
  {
    id: 'jpmorgan-2026',
    name: 'J.P. Morgan LTCMA',
    institution: 'J.P. Morgan Asset Management',
    editionYear: 2026,
    horizon: '30-Year Secular',
    description: 'Comprehensive 30-year multi-asset building blocks derived from corporate profit margins, labor productivity, and central bank policy reaction functions.',
    sourceUrl: 'https://am.jpmorgan.com/us/en/asset-management/adv/insights/portfolio-insights/ltcma/',
    isBuiltIn: true,
    equityReturnRate: 0.072,
    equityVolatility: 0.155,
    fixedIncomeReturnRate: 0.048,
    fixedIncomeVolatility: 0.055,
    cashYieldRate: 0.035,
    cpiInflationRate: 0.025,
    cpiVolatility: 0.018,
    correlation: 0.18,
  },
];

export const DEFAULT_CMA_PROFILE_ID = 'vanguard-2026';

/**
 * Calculates stochastic annual arithmetic drift from geometric compound return (CAGR)
 * adjusting for discrete annual volatility drag: mu = g + (sigma^2 / 2).
 */
export function calculateArithmeticDrift(geometricCagr: number, volatility: number): number {
  return geometricCagr + (volatility * volatility) / 2;
}

/**
 * Calculates expected geometric CAGR from arithmetic mean and volatility:
 * g = mu - (sigma^2 / 2).
 */
export function calculateGeometricCagr(arithmeticMean: number, volatility: number): number {
  return arithmeticMean - (volatility * volatility) / 2;
}

/**
 * Returns all available CMA profiles (built-in + user-imported).
 */
export function getAllCmaProfiles(customProfiles: CMAProfile[] = []): CMAProfile[] {
  return [...BUILT_IN_CMA_PROFILES, ...customProfiles];
}

/**
 * Finds a CMA profile by ID across built-in and custom profiles.
 */
export function getCmaProfile(id?: string | null, customProfiles: CMAProfile[] = []): CMAProfile | undefined {
  if (!id || id === 'custom') return undefined;
  return getAllCmaProfiles(customProfiles).find(p => p.id === id);
}

export interface CurrentParameterValues {
  equityReturnRate: number;
  equityVolatility: number;
  fixedIncomeReturnRate: number;
  fixedIncomeVolatility: number;
  cashYieldRate?: number | null;
  cpiInflationRate: number;
  correlation: number;
}

export type CMAFieldKey = keyof CurrentParameterValues;

export interface FieldDeviation {
  field: CMAFieldKey;
  currentValue: number;
  presetValue: number;
  delta: number;
  isModified: boolean;
}

const EPSILON = 0.0001;

/**
 * Compares current user inputs against a base CMA profile to detect modifications.
 */
export function getFieldDeviations(
  preset: CMAProfile,
  current: CurrentParameterValues
): Record<CMAFieldKey, FieldDeviation> {
  const checkField = (field: CMAFieldKey, curVal: number, preVal: number): FieldDeviation => {
    const delta = curVal - preVal;
    return {
      field,
      currentValue: curVal,
      presetValue: preVal,
      delta,
      isModified: Math.abs(delta) > EPSILON,
    };
  };

  const cashPreset = preset.cashYieldRate;
  const cashCurrent = current.cashYieldRate ?? current.fixedIncomeReturnRate;

  return {
    equityReturnRate: checkField('equityReturnRate', current.equityReturnRate, preset.equityReturnRate),
    equityVolatility: checkField('equityVolatility', current.equityVolatility, preset.equityVolatility),
    fixedIncomeReturnRate: checkField('fixedIncomeReturnRate', current.fixedIncomeReturnRate, preset.fixedIncomeReturnRate),
    fixedIncomeVolatility: checkField('fixedIncomeVolatility', current.fixedIncomeVolatility, preset.fixedIncomeVolatility),
    cashYieldRate: checkField('cashYieldRate', cashCurrent, cashPreset),
    cpiInflationRate: checkField('cpiInflationRate', current.cpiInflationRate, preset.cpiInflationRate),
    correlation: checkField('correlation', current.correlation, preset.correlation),
  };
}

/**
 * Determines whether any field deviates from the base profile.
 */
export function isProfileModified(
  preset?: CMAProfile | null,
  current?: CurrentParameterValues | null
): boolean {
  if (!preset || !current) return false;
  const deviations = getFieldDeviations(preset, current);
  return Object.values(deviations).some(d => d.isModified);
}
