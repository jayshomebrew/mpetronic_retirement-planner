import * as XLSX from 'xlsx';
import { AppStateInputs, SimulationResultRow, normalizeDetailedExpenses, getSimulationStartYear } from '../types';

export const generateExcelWorkbook = (ledger: SimulationResultRow[], inputs: AppStateInputs): XLSX.WorkBook => {
  const wb = XLSX.utils.book_new();
  const simStartYear = getSimulationStartYear(inputs);

  // Helper to safely format healthcare values
  const getHCVal = (person: 'you' | 'wife', state: 'MD' | 'FL', key: string) => {
    const hc = person === 'you' ? inputs.you.healthcare : inputs.wife.healthcare;
    if (!hc) return "N/A";
    const stateObj = state === 'MD' ? hc.MD : hc.FL;
    return (stateObj as unknown as Record<string, unknown> | undefined)?.[key] ?? 0;
  };

  // Tab 1: Configuration Summary (AOA - Array of Arrays)
  const configData: (string | number | boolean | null)[][] = [
    ["Retirement Plan Configuration Summary"],
    [],
    ["Date Generated", new Date().toLocaleDateString('en-US')],
    ["Simulation Start Year", simStartYear],
    [],
    ["PROFILE & SPOUSAL TIMELINES"],
    ["Filing Status", inputs.isSingleFiler ? "Single Filer" : "Married Filing Jointly (MFJ)"],
    ["Primary Person Name", inputs.you.name || "Primary"],
    ["Primary Birth Date", inputs.you.birthDate],
    ["Primary Planned Retirement Age", inputs.you.plannedRetirementAge ?? 67],
    ["Primary Planned Retirement Month", inputs.you.plannedRetirementMonth ?? 1],
    ["Primary Projected Longevity Age", inputs.you.longevityAge ?? 95],
    ["Primary Active Work Salary", inputs.you.activeSalary ?? 0],
    ["Primary Target SS Claiming Age", inputs.you.targetSSClaimingAge ?? 67],
    ["Primary Estimated SS Benefit (PIA / monthly)", inputs.you.estimatedPIA ?? 0],
    ["Primary Pre-Medicare Monthly Premium", inputs.you.healthcare ? "N/A (Detailed Active)" : (inputs.you.preMedicareMonthlyPremium ?? 0)],
  ];

  if (!inputs.isSingleFiler) {
    configData.push(
      [],
      ["Spouse Name", inputs.wife.name || "Spouse"],
      ["Spouse Birth Date", inputs.wife.birthDate],
      ["Planned Retirement Age", inputs.wife.plannedRetirementAge ?? 67],
      ["Planned Retirement Month", inputs.wife.plannedRetirementMonth ?? 1],
      ["Projected Longevity Age", inputs.wife.longevityAge ?? 95],
      ["Active Work Salary", inputs.wife.activeSalary ?? 0],
      ["Target SS Claiming Age", inputs.wife.targetSSClaimingAge ?? 67],
      ["Estimated SS Benefit (PIA / monthly)", inputs.wife.estimatedPIA ?? 0],
      ["Pre-Medicare Monthly Premium", inputs.wife.healthcare ? "N/A (Detailed Active)" : (inputs.wife.preMedicareMonthlyPremium ?? 0)]
    );
  }

  configData.push(
    [],
    [`STARTING ASSET BALANCES (${simStartYear})`],
    ["Your Taxable Brokerage Balance", inputs.portfolio.yourTaxableBrokerage ?? 0],
    ["Your Taxable Account Cost Basis", inputs.portfolio.yourTaxableBasis ?? 0],
    ["Spouse Taxable Brokerage Balance", inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeTaxableBrokerage ?? 0)],
    ["Spouse Taxable Account Cost Basis", inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeTaxableBasis ?? 0)],
    ["Your Traditional IRA (Pre-Tax)", inputs.portfolio.yourPreTaxIRA ?? 0],
    ["Spouse Traditional IRA (Pre-Tax)", inputs.isSingleFiler ? 0 : (inputs.portfolio.wifePreTaxIRA ?? 0)],
    ["Your Roth IRA (Tax-Free)", inputs.portfolio.yourRothIRA ?? 0],
    ["Spouse Roth IRA (Tax-Free)", inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeRothIRA ?? 0)],
    ["Your Cash Savings", inputs.portfolio.yourCash ?? 0],
    ["Spouse Cash Savings", inputs.isSingleFiler ? 0 : (inputs.portfolio.wifeCash ?? 0)],
    ["Taxable Dividend Yield", inputs.portfolio.taxableDividendYield ?? 0.02],
    ["Non-Qualified Dividend Portion", inputs.portfolio.taxableNonQualifiedPortion ?? 0],
    [],
    ["GROWTH & CPI ASSUMPTIONS"],
    ["Equity / Stock Growth Rate (Mean)", inputs.growthAssumptions.equityReturnRate ?? 0.07],
    ["Fixed Income / Bond Return Rate (Mean)", inputs.growthAssumptions.fixedIncomeReturnRate ?? 0.04],
    ["CPI Inflation Rate", inputs.growthAssumptions.cpiInflationRate ?? 0.025],
    ["Healthcare Inflation Rate", inputs.growthAssumptions.healthcareInflationRate ?? 0.05],
    ["Pre-Tax IRA Stock Allocation", `${Math.round((inputs.growthAssumptions.preTaxEquityPortion ?? 0.50) * 100)}% Stocks / ${Math.round((1 - (inputs.growthAssumptions.preTaxEquityPortion ?? 0.50)) * 100)}% Bonds`],
    ["Taxable Brokerage Stock Allocation", `${Math.round((inputs.growthAssumptions.taxableEquityPortion ?? 0.60) * 100)}% Stocks / ${Math.round((1 - (inputs.growthAssumptions.taxableEquityPortion ?? 0.60)) * 100)}% Bonds`],
    ["Roth IRA Stock Allocation", `${Math.round((inputs.growthAssumptions.rothEquityPortion ?? 1.00) * 100)}% Stocks / ${Math.round((1 - (inputs.growthAssumptions.rothEquityPortion ?? 1.00)) * 100)}% Bonds`],
    ["Cash Yield Rate", inputs.growthAssumptions.cashYieldRate ?? inputs.growthAssumptions.fixedIncomeReturnRate],
    ["Minimum Cash Reserve Target", `$${(inputs.growthAssumptions.minCashReserveDollars ?? 100000).toLocaleString()} (CPI-Indexed)`],
    [],
    ["MONTE CARLO STOCHASTIC SETTINGS"],
    ["Simulation Mode", inputs.monteCarloSettings.mode],
    ["Number of Trials", inputs.monteCarloSettings.trials ?? 1000],
    ["Equity Volatility", inputs.monteCarloSettings.equityVolatility ?? 0.15],
    ["Fixed Income Volatility", inputs.monteCarloSettings.fixedIncomeVolatility ?? 0.05],
    ["Asset Class Correlation", inputs.monteCarloSettings.correlation ?? 0.15],
    ["Randomizer Seed", inputs.monteCarloSettings.seed ?? "N/A (Standard Random)"],
    ["CPI Inflation Modeling", inputs.monteCarloSettings.randomizeCPI !== false ? "Randomized (Historical)" : `Constant (${(((inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate) * 100)).toFixed(2)}%)`],
    ["Regime Switching & Mean Reversion", inputs.monteCarloSettings.enableRegimeSwitching !== false ? "Enabled (Markov 2-State + Mean Reversion)" : "Disabled (i.i.d. Random Walk)"],
    ["Historical Sampling Strategy", (inputs.monteCarloSettings.historicalSamplingStrategy ?? 'hybrid').toUpperCase()],
    ["Historical Mean Calibration", inputs.monteCarloSettings.calibrateHistoricalMeans !== false ? "Calibrated (Aligned to Baseline)" : "Raw History (12.3% Stock)"],
    ["Historical Fat-Tail Modeling", inputs.monteCarloSettings.enableHistoricalStudentT ? "Student-t (df=5 Fat Tails)" : "Standard (Empirical History)"],
    [],
    ["STATE TAX RELOCATION"],
    ["Current Home State", inputs.jurisdiction.currentState],
    ["Relocating In Retirement", inputs.jurisdiction.relocationYear !== null ? "Yes" : "No"],
    ["Target Destination State", inputs.jurisdiction.targetState || "N/A"],
    ["Relocation Year Target", inputs.jurisdiction.relocationYear ?? "N/A"],
    [],
    ["ROTH CONVERSION STRATEGY"],
    ["Strategy Category", inputs.rothConversionStrategy],
    ["Annual Flat Conversion Amount", inputs.annualRothConversion ?? 0],
    ["Target MAGI Limit (Fill-To-Target)", inputs.rothConversionTargetValue ?? 0],
    ["Strategy Active Start Year", inputs.rothConversionStartYear ?? simStartYear],
    ["Strategy Active End Year", inputs.rothConversionEndYear ?? (simStartYear + 9)],
    [],
    ["CHARITABLE GIVING & TITHING (WITH QCD)"],
    ["Tithing Engine Enabled", inputs.charitySettings?.enabled ? "Yes" : "No"],
    ["Tithe Percentage of Growth", `${(((inputs.charitySettings?.growthPercentage ?? 0.10) * 100)).toFixed(1)}%`],
    ["Annual Minimum Floor", inputs.charitySettings?.minAnnualTithe ? `$${inputs.charitySettings.minAnnualTithe.toLocaleString()}` : "None ($0 in down years)"],
    ["Annual Maximum Cap", inputs.charitySettings?.maxAnnualTithe ? `$${inputs.charitySettings.maxAnnualTithe.toLocaleString()}` : "None"],
    ["QCD Optimization (Age 70.5+)", inputs.charitySettings?.useQCD !== false ? "Enabled (Traditional IRA to Charity)" : "Disabled"]
  );

  // Add healthcare specifics if configured
  if (inputs.you.healthcare || (!inputs.isSingleFiler && inputs.wife.healthcare)) {
    configData.push(
      [],
      ["HEALTHCARE PREMIUM & OUT-OF-POCKET CONFIGURATIONS"]
    );
    if (inputs.you.healthcare) {
      configData.push(
        ["Primary - Custom Part B Base Premium", inputs.you.healthcare.medicarePartBPremium ?? "Default"],
        ["Primary - MD Pre-65 Medical Premium / OOP", `${getHCVal('you', 'MD', 'pre65MedicalPremium')} / ${getHCVal('you', 'MD', 'pre65MedicalOOP')}`],
        ["Primary - MD Post-65 Supplemental Premium / OOP", `${getHCVal('you', 'MD', 'supplementPremium')} / ${getHCVal('you', 'MD', 'supplementOOP')}`],
        ["Primary - FL Pre-65 Medical Premium / OOP", `${getHCVal('you', 'FL', 'pre65MedicalPremium')} / ${getHCVal('you', 'FL', 'pre65MedicalOOP')}`],
        ["Primary - FL Post-65 Supplemental Premium / OOP", `${getHCVal('you', 'FL', 'supplementPremium')} / ${getHCVal('you', 'FL', 'supplementOOP')}`]
      );
    }
    if (!inputs.isSingleFiler && inputs.wife.healthcare) {
      configData.push(
        ["Spouse - Custom Part B Base Premium", inputs.wife.healthcare.medicarePartBPremium ?? "Default"],
        ["Spouse - MD Pre-65 Medical Premium / OOP", `${getHCVal('wife', 'MD', 'pre65MedicalPremium')} / ${getHCVal('wife', 'MD', 'pre65MedicalOOP')}`],
        ["Spouse - MD Post-65 Supplemental Premium / OOP", `${getHCVal('wife', 'MD', 'supplementPremium')} / ${getHCVal('wife', 'MD', 'supplementOOP')}`],
        ["Spouse - FL Pre-65 Medical Premium / OOP", `${getHCVal('wife', 'FL', 'pre65MedicalPremium')} / ${getHCVal('wife', 'FL', 'pre65MedicalOOP')}`],
        ["Spouse - FL Post-65 Supplemental Premium / OOP", `${getHCVal('wife', 'FL', 'supplementPremium')} / ${getHCVal('wife', 'FL', 'supplementOOP')}`]
      );
    }
  }

  configData.push(
    [],
    ["GUARDRAIL SPENDING POLICY"],
    ["Guardrail Policy Enabled", inputs.guardrailSettings?.enabled !== false ? "Yes" : "No"],
    ["Upper Guardrail Ceiling (+%)", `+${(((inputs.guardrailSettings?.upperGuardrailPct ?? 0.15) * 100)).toFixed(0)}%`],
    ["Lower Guardrail Floor (-%)", `-${(((inputs.guardrailSettings?.lowerGuardrailPct ?? 0.15) * 100)).toFixed(0)}%`],
    ["Market Surplus Share", `${(((inputs.guardrailSettings?.marketSurplusSharePct ?? 0.10) * 100)).toFixed(0)}%`],
    ["Apply to Forward Simulation", inputs.guardrailSettings?.applyToSimulation ? "Yes" : "No"],
    ["Recorded Actual Years Logged", Object.keys(inputs.actualTracking || {}).join(", ") || "None"]
  );

  const wsConfig = XLSX.utils.aoa_to_sheet(configData);
  XLSX.utils.book_append_sheet(wb, wsConfig, "Configuration Summary");

  // Tab 2: Simulation Ledger
  const ledgerData = ledger.map(row => ({
    "Year": row.year,
    "Status": row.isActual ? "Actual" : row.isBridged ? "Bridged" : "Projected",
    "Your Age": row.yourAge,
    "Spouse Age": inputs.isSingleFiler ? "-" : row.wifeAge,
    "Portfolio Value": Math.round(row.totalPortfolioValue),
    "Annual Portfolio Growth": Math.round(row.portfolioGrowth ?? 0),
    "Charitable Tithe (Total)": Math.round(row.charitableTithe ?? 0),
    "QCD Distributed (Tax-Free)": Math.round(row.qcdAmount ?? 0),
    "Non-QCD Charitable Gift": Math.round(row.nonQcdTithe ?? 0),
    "Estimated QCD Tax Savings": Math.round(row.qcdTaxSavings ?? 0),
    "Total MAGI": Math.round(row.magi),
    "Federal Taxable Income": Math.round(row.taxableIncome),
    "Federal Income Tax": Math.round(row.fedIncomeTax),
    "State Income Tax": Math.round(row.stateIncomeTax),
    "NIIT Tax": Math.round(row.niitTax),
    "Total Tax Bill": Math.round(row.fedIncomeTax + row.stateIncomeTax),
    "Ordinary Dividends": Math.round(row.taxableDividends),
    "Cash Interest": Math.round(row.taxableInterest),
    "Social Security Inflow": Math.round(row.yourSS + row.wifeSS),
    "Salary Inflow": Math.round((row.yourSalary ?? 0) + (row.wifeSalary ?? 0)),
    "RMD Distributed": Math.round(row.yourRMD + row.wifeRMD),
    "Roth Conversion Added": Math.round(row.intentionalRothConversion),
    "Capital Gains Triggered": Math.round(row.capitalGainsTriggered),
    "Base Living Expenses": Math.round(row.livingExpenses),
    "Guardrail Upper Limit": Math.round(row.guardrailUpperLimit ?? 0),
    "Guardrail Lower Limit": Math.round(row.guardrailLowerLimit ?? 0),
    "Spending Surplus Gap": Math.round(row.actualSurplusGap ?? 0),
    "Permitted Spending Bonus": Math.round(row.permittedSpendingBonus ?? 0),
    "Pre-Medicare Premiums": Math.round(row.preMedicareHealthcareCost),
    "Medicare Base Premiums": Math.round(row.medicareBasePremiums),
    "Medicare Surcharges": Math.round(row.combinedSurchargeAnnual),
    "Your Brokerage Balance": Math.round(row.endYourTaxableBrokerage),
    "Spouse Brokerage Balance": inputs.isSingleFiler ? 0 : Math.round(row.endWifeTaxableBrokerage),
    "Your Pre-Tax IRA Balance": Math.round(row.endYourPreTaxIRA),
    "Spouse Pre-Tax IRA Balance": inputs.isSingleFiler ? 0 : Math.round(row.endWifePreTaxIRA),
    "Your Roth IRA Balance": Math.round(row.endYourRothIRA),
    "Spouse Roth IRA Balance": inputs.isSingleFiler ? 0 : Math.round(row.endWifeRothIRA),
    "Your Cash Balance": Math.round(row.endYourCash),
    "Spouse Cash Balance": inputs.isSingleFiler ? 0 : Math.round(row.endWifeCash),
    "IRMAA Surcharge Tier": row.surchargeTier,
    "MAGI Lookback Year (t-2)": Math.round(row.magiTwoYearsAgo)
  }));

  const wsLedger = XLSX.utils.json_to_sheet(ledgerData);
  XLSX.utils.book_append_sheet(wb, wsLedger, "Simulation Ledger");

  // Tab 3: Detailed Expenses (if enabled)
  if (inputs.useDetailedExpenses && inputs.detailedExpenses) {
    const expensesSheetData: Record<string, unknown>[] = [];
    const stateA = inputs.jurisdiction.currentState || 'MD';
    const stateB = inputs.jurisdiction.targetState || 'FL';
    const normExpenses = normalizeDetailedExpenses(inputs.detailedExpenses);
    const catalog = normExpenses.catalog;
    const costs = normExpenses.costs;
    const frequencies = normExpenses.frequencies;

    catalog.items.forEach((item) => {
      const costA = costs[stateA]?.[item.id] ?? 0;
      const costB = costs[stateB]?.[item.id] ?? 0;
      const freq = item.isOneTime ? 1 : (frequencies[item.id] ?? item.defaultFrequency ?? 12);

      if (costA > 0 || costB > 0) {
        expensesSheetData.push({
          "Description": item.name,
          "Category": item.category,
          "Type": item.isOneTime ? "One-Time" : "Recurring",
          "Target Year": item.isOneTime ? (item.targetYear ?? (inputs.simulationStartYear || 2026)) : "Annual Recurring",
          "Frequency / Year": freq,
          [`Cost (${stateA})`]: costA,
          [`Cost (${stateB})`]: costB,
          [`Annualized Cost (${stateA})`]: costA * freq,
          [`Annualized Cost (${stateB})`]: costB * freq,
        });
      }
    });

    if (expensesSheetData.length > 0) {
      const wsExpenses = XLSX.utils.json_to_sheet(expensesSheetData);
      XLSX.utils.book_append_sheet(wb, wsExpenses, "Itemized Expenses");
    }
  }

  return wb;
};

export const generateExcelBlob = (ledger: SimulationResultRow[], inputs: AppStateInputs): Blob => {
  const wb = generateExcelWorkbook(ledger, inputs);
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

export const exportToExcel = (ledger: SimulationResultRow[], inputs: AppStateInputs, filename: string = "Retirement_Simulation_Ledger_Export.xlsx") => {
  const wb = generateExcelWorkbook(ledger, inputs);
  XLSX.writeFile(wb, filename);
};
