import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanSyncService } from '../PlanSyncService';
import { AuthService } from '../../auth/AuthService';
import { DEFAULT_CHARITY_SETTINGS, AppStateInputs } from '../../../types';

describe('PlanSyncService', () => {
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key in mockStorage) delete mockStorage[key];

    const storageObj = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
    };

    vi.stubGlobal('localStorage', storageObj);
    vi.stubGlobal('window', {
      localStorage: storageObj,
      location: { hostname: 'app.myretirement.com' },
      dispatchEvent: vi.fn(),
    });
  });

  it('starts with initial status and notifies subscribers', () => {
    const statusListener = vi.fn();
    const unsub = PlanSyncService.subscribe(statusListener);
    expect(statusListener).toHaveBeenCalledWith(
      expect.objectContaining({
        isSyncing: false,
      })
    );
    unsub();
  });

  it('returns null for fetchRemotePlan when unauthenticated', async () => {
    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(false);
    const plan = await PlanSyncService.fetchRemotePlan();
    expect(plan).toBeNull();
  });

  it('saves remote plan when authenticated and receives 200 response', async () => {
    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock-token-xyz');
    vi.spyOn(AuthService, 'getSession').mockReturnValue({
      sub: 'user-sub-123',
      email: 'test@example.com',
      householdId: 'household-123',
      idToken: 'mock-token-xyz',
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      expiresAt: Date.now() + 3600000,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const mockInputs: AppStateInputs = {
      you: { name: 'Primary', birthDate: '1960-01-01', plannedRetirementAge: 65, targetSSClaimingAge: 67, estimatedPIA: 3000, activeSalary: 0, preMedicareMonthlyPremium: null },
      wife: { name: 'Spouse', birthDate: '1964-01-01', plannedRetirementAge: 67, targetSSClaimingAge: 67, estimatedPIA: 1500, activeSalary: 0, preMedicareMonthlyPremium: null },
      portfolio: { yourPreTaxIRA: 0, yourRothIRA: 0, yourTaxableBrokerage: 0, yourTaxableBasis: 0, yourCash: 0, wifePreTaxIRA: 0, wifeRothIRA: 0, wifeTaxableBrokerage: 0, wifeTaxableBasis: 0, wifeCash: 0, taxableDividendYield: 0, taxableNonQualifiedPortion: 0 },
      jurisdiction: { currentState: 'MD', targetState: 'FL', relocationYear: null },
      growthAssumptions: { equityReturnRate: 0.07, fixedIncomeReturnRate: 0.04, cpiInflationRate: 0.025, healthcareInflationRate: 0.05, minCashReserveDollars: 100000 },
      annualLivingExpenses: 100000,
      annualRothConversion: 0,
      simulationStartYear: 2026,
      rothConversionStartYear: 2027,
      rothConversionEndYear: 2032,
      rothConversionStrategy: 'flat',
      rothConversionTargetValue: null,
      isConfigured: true,
      isSingleFiler: false,
      useDetailedExpenses: false,
      charitySettings: DEFAULT_CHARITY_SETTINGS,
      monteCarloSettings: { 
        mode: 'monte-carlo', 
        equityVolatility: 0.155, 
        fixedIncomeVolatility: 0.055, 
        correlation: 0.15, 
        trials: 1000, 
        seed: null,
        activeCmaProfileId: 'vanguard-2026',
        baseCmaProfileId: 'vanguard-2026',
        customCmaProfiles: [{
          id: 'custom-imported-2027',
          name: 'My Firm 2027',
          institution: 'RIA',
          editionYear: 2027,
          horizon: '30-Year Secular',
          isBuiltIn: false,
          equityReturnRate: 0.07,
          equityVolatility: 0.16,
          fixedIncomeReturnRate: 0.045,
          fixedIncomeVolatility: 0.055,
          cashYieldRate: 0.035,
          cpiInflationRate: 0.024,
          correlation: 0.15,
        }],
      },
    };

    const result = await PlanSyncService.saveRemotePlan(mockInputs);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody.inputs.monteCarloSettings.activeCmaProfileId).toBe('vanguard-2026');
    expect(requestBody.inputs.monteCarloSettings.customCmaProfiles).toHaveLength(1);
    expect(requestBody.inputs.monteCarloSettings.customCmaProfiles[0].id).toBe('custom-imported-2027');
  });

  it('correctly detects meaningful vs empty plan data', () => {
    expect(PlanSyncService.hasMeaningfulPlanData(null)).toBe(false);
    expect(
      PlanSyncService.hasMeaningfulPlanData({
        isConfigured: false,
      } as unknown as AppStateInputs)
    ).toBe(false);

    const emptyConfigured: Partial<AppStateInputs> = {
      isConfigured: true,
      annualLivingExpenses: 100000,
      portfolio: {
        yourPreTaxIRA: 0,
        yourRothIRA: 0,
        yourTaxableBrokerage: 0,
        yourTaxableBasis: 0,
        yourCash: 0,
        wifePreTaxIRA: 0,
        wifeRothIRA: 0,
        wifeTaxableBrokerage: 0,
        wifeTaxableBasis: 0,
        wifeCash: 0,
        taxableDividendYield: 0,
        taxableNonQualifiedPortion: 0,
      },
      you: { name: 'You', birthDate: '1960-01-01', plannedRetirementAge: 67, targetSSClaimingAge: 67, estimatedPIA: 0, activeSalary: 0, preMedicareMonthlyPremium: null },
      wife: { name: 'Spouse', birthDate: '1960-01-01', plannedRetirementAge: 67, targetSSClaimingAge: 67, estimatedPIA: 0, activeSalary: 0, preMedicareMonthlyPremium: null },
    };

    expect(PlanSyncService.hasMeaningfulPlanData(emptyConfigured as AppStateInputs)).toBe(false);

    const populatedPlan = {
      ...emptyConfigured,
      portfolio: {
        ...emptyConfigured.portfolio!,
        yourPreTaxIRA: 500000,
      },
    };
    expect(PlanSyncService.hasMeaningfulPlanData(populatedPlan as AppStateInputs)).toBe(true);
  });
});

