import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SimulationResultRow, AppStateInputs, getSimulationStartYear } from '../types';
import { TableProperties, Info, AlertTriangle, X } from 'lucide-react';
import { IRMAA_TIERS_MFJ, IRMAA_TIERS_SINGLE, MD_PENSION_EXCLUSION_BASE_CAP } from '../engine/taxRates2026';
import { calculateFedTaxWithLTCG, calculateTaxableSS, calculateMDStateTax } from '../engine/simulationEngine';
import { RowInspectionDialog } from './RowInspectionDialog';

interface LookbackLedgerTableProps {
  ledger: SimulationResultRow[];
  inputs: AppStateInputs;
  simulateSurvivor: boolean;
  onNavigateToActuals?: (year: number) => void;
}

export const LookbackLedgerTable: React.FC<LookbackLedgerTableProps> = ({
  ledger,
  inputs,
  simulateSurvivor,
  onNavigateToActuals,
}) => {
  const [selectedRow, setSelectedRow] = useState<SimulationResultRow | null>(null);
  const simStartYear = getSimulationStartYear(inputs);
  const [showWarningsModal, setShowWarningsModal] = useState(false);
  const deathYear = useMemo(() => {
    if (!inputs.you.birthDate) return 2045;
    const year = parseInt(inputs.you.birthDate.split('-')[0], 10);
    return isNaN(year) ? 2045 : (year + (inputs.you.longevityAge ?? 85));
  }, [inputs.you.birthDate, inputs.you.longevityAge]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Find rows with a "Near-Cliff" violation (MAGI within $5,000 above any IRMAA cliff limit)
  const warnings = useMemo(() => {
    const activeWarnings: {
      year: number;
      magi: number;
      cliff: number;
      excess: number;
      penalty: number;
      affectedYear: number;
    }[] = [];

    ledger.forEach((r) => {
      const year = r.year;
      const magi = r.magi;
      
      const cpiFactor = r.cpiFactor;
      const isSingle = simulateSurvivor && year >= deathYear;
      const tiers = isSingle ? IRMAA_TIERS_SINGLE : IRMAA_TIERS_MFJ;

      // Find which tier the current MAGI falls into
      let currentTierIdx = 0;
      for (let i = tiers.length - 1; i >= 0; i--) {
        const prevTier = tiers[i - 1];
        const prevLimit = prevTier ? (prevTier.limit === Infinity ? Infinity : prevTier.limit * cpiFactor) : 0;
        if (magi > prevLimit) {
          currentTierIdx = i;
          break;
        }
      }

      if (currentTierIdx > 0) {
        const crossedTier = tiers[currentTierIdx - 1];
        let cliffLimit = crossedTier.limit;
        if (crossedTier.tierNumber < 4) {
          cliffLimit = crossedTier.limit * cpiFactor;
        }

        const excess = magi - cliffLimit;
        if (excess > 0 && excess <= 5000) {
          const currentTier = tiers[currentTierIdx];
          const prevTier = tiers[currentTierIdx - 1];
          
          const yourMedStartYear = inputs.you.healthcare?.medicareStartMode === 'customDate' && inputs.you.healthcare?.medicareStartDate
            ? parseInt(inputs.you.healthcare.medicareStartDate.split('-')[0], 10)
            : (inputs.you.birthDate ? parseInt(inputs.you.birthDate.split('-')[0], 10) + 65 : 1960 + 65);
          const wifeMedStartYear = inputs.wife.healthcare?.medicareStartMode === 'customDate' && inputs.wife.healthcare?.medicareStartDate
            ? parseInt(inputs.wife.healthcare.medicareStartDate.split('-')[0], 10)
            : (inputs.wife.birthDate ? parseInt(inputs.wife.birthDate.split('-')[0], 10) + 65 : 1964 + 65);
          const affectedYear = year + 2;
          const numOnMedicare = (affectedYear >= yourMedStartYear ? 1 : 0) + (!inputs.isSingleFiler && affectedYear >= wifeMedStartYear ? 1 : 0);
          const monthlyDiff = (currentTier.partBSurcharge + currentTier.partDSurcharge) - 
                              (prevTier.partBSurcharge + prevTier.partDSurcharge);
          
          const healthcareFactor = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, year - simStartYear);
          const penalty = monthlyDiff * 12 * numOnMedicare * healthcareFactor;

          if (penalty > 0) {
            activeWarnings.push({
              year,
              magi,
              cliff: cliffLimit,
              excess,
              penalty,
              affectedYear: year + 2,
            });
          }
        }
      }
    });

    return activeWarnings;
  }, [ledger, simulateSurvivor, inputs, deathYear, simStartYear]);

  return (
    <div className="glass-panel rounded-2xl p-3.5 space-y-3">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <TableProperties className="w-5 h-5 text-emerald-400" />
            Lookback Linkage Ledger Table
          </h3>
          <p className="text-xs text-slate-400">
            Under Medicare guidelines, your Modified Adjusted Gross Income (MAGI) in a tax year dictates your premium surcharges exactly 2 years later.
          </p>
        </div>
        {warnings.length > 0 && (
          <button
            onClick={() => setShowWarningsModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-semibold shadow-md transition-all duration-200 animate-pulse hover:animate-none cursor-pointer flex-shrink-0"
          >
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>{warnings.length} Surcharge Warning{warnings.length > 1 ? 's' : ''} Active</span>
          </button>
        )}
      </div>

      {/* Ledger Table */}
      <div className="overflow-auto max-h-[600px] rounded-xl border border-slate-800 bg-slate-950/20 custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs md:text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900">
            <tr className="bg-slate-900/95 border-b border-slate-800 text-slate-400 text-xs font-semibold uppercase tracking-wider leading-tight">
              <th className="px-2.5 py-3">Year (t)</th>
              <th className="px-2.5 py-3">MAGI<br /><span className="text-[10px] text-slate-500 font-normal normal-case">(Income)</span></th>
              <th className="px-2.5 py-3 text-emerald-400">Annual Growth<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Portfolio</span></th>
              {inputs.charitySettings?.enabled && (
                <th className="px-2.5 py-3 text-rose-400">Charitable Tithe<br /><span className="text-[10px] text-rose-500 font-normal normal-case">(QCD & Cash)</span></th>
              )}
              <th className="px-2.5 py-3">Roth Conv.<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Amount</span></th>
              <th className="px-2.5 py-3">Roth Conv.<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Tax</span></th>
              <th className="px-2.5 py-3">Total<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Expenses</span></th>
              <th className="px-2.5 py-3">Brokerage<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Assets</span></th>
              <th className="px-2.5 py-3">Cash<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Assets</span></th>
              <th className="px-2.5 py-3">Traditional<br /><span className="text-[10px] text-slate-500 font-normal normal-case">IRA</span></th>
              <th className="px-2.5 py-3">Roth<br /><span className="text-[10px] text-slate-500 font-normal normal-case">(Tax-Free)</span></th>
              <th className="px-2.5 py-3">Total<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Net Worth</span></th>
              <th className="px-2.5 py-3">IRMAA Tier<br /><span className="text-[10px] text-slate-500 font-normal normal-case">(t-2 Lookback)</span></th>
              <th className="px-2.5 py-3 text-right">Medicare<br /><span className="text-[10px] text-slate-500 font-normal normal-case">Surcharge</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40">
            {ledger.map((r, idx) => {
              const lookbackYear = r.year - 2;
              
              // Determine if this row is highlighted for crossing a cliff by < $5,000
              const isWarningRow = warnings.some((w) => w.year === r.year);

              const salary = (r.yourSalary || 0) + (r.wifeSalary || 0);
              const rmd = r.yourRMD + r.wifeRMD;
              const rothConv = r.intentionalRothConversion;
              const capitalGains = r.capitalGainsTriggered;
              const pretaxDrawdown = r.otherTaxableIncome;

              const taxableSS = r.taxableSS;
              const totalSS = r.yourSS + r.wifeSS;
              const ssTaxedPercent = totalSS > 0 && taxableSS > 0
                ? Math.round((taxableSS / totalSS) * 100)
                : 0;

              // Marginal-rate conversion tax: difference in federal tax with vs. without the conversion.
              // This is more accurate than the blended effective rate because conversions are stacked
              // on top of all other income and are taxed at the marginal bracket rate.
              const conversionTax = (() => {
                if (r.intentionalRothConversion <= 0) return 0;
                
                const cpiFactor = r.cpiFactor;
                const isSingle = simulateSurvivor && r.year >= deathYear;
                
                // Dividends and capital gains are unchanged by the conversion
                const taxableNonQualifiedPortion = inputs.portfolio.taxableNonQualifiedPortion !== undefined && inputs.portfolio.taxableNonQualifiedPortion !== null 
                  ? inputs.portfolio.taxableNonQualifiedPortion 
                  : 0.30;
                const qualifiedDividends = r.taxableDividends * (1 - taxableNonQualifiedPortion);
                const capitalGains = r.capitalGainsTriggered + qualifiedDividends;
                
                // 1. Calculate fedTaxWith (which matches r.fedIncomeTax)
                const fedTaxWith = r.fedIncomeTax;
                
                // 2. Calculate fedTaxWithout:
                const agiWithout = Math.max(0, r.fedAGI - r.intentionalRothConversion);
                const taxableOrdinaryWithout = Math.max(0, agiWithout - capitalGains - r.standardDeduction);
                
                const { totalTax: fedBaseTaxWithout } = calculateFedTaxWithLTCG(
                  taxableOrdinaryWithout, 
                  capitalGains, 
                  isSingle, 
                  cpiFactor
                );
                
                const niitThreshold = isSingle ? 200000 : 250000;
                const excessMAGIWithout = Math.max(0, agiWithout - niitThreshold);
                const netInvestmentIncome = r.capitalGainsTriggered + r.taxableDividends;
                const niitBaseWithout = Math.min(netInvestmentIncome, excessMAGIWithout);
                const niitTaxWithout = niitBaseWithout * 0.038;
                
                const fedTaxWithout = fedBaseTaxWithout + niitTaxWithout;
                
                return Math.max(0, fedTaxWith - fedTaxWithout);
              })();
 
              // Marginal state tax attributable to the Roth conversion.
              // Uses the same with/without AGI approach. Gated on stateIncomeTax > 0
              // so FL residents (who pay $0 state tax) always see $0 here.
              const conversionStateTax = (() => {
                if (r.intentionalRothConversion <= 0 || r.stateIncomeTax <= 0) return 0;
                const isSingle = simulateSurvivor && r.year >= deathYear;
                const cpiFactor = r.cpiFactor;
                
                // MD pension exclusion (doesn't change without conversion)
                const capExcl = MD_PENSION_EXCLUSION_BASE_CAP * cpiFactor;
                const mdPensionExclusion = (() => {
                  if (isSingle) {
                    const age = inputs.isSingleFiler ? r.yourAge : r.wifeAge;
                    const ss = inputs.isSingleFiler ? r.yourSS : r.wifeSS;
                    const rmdAndDraw = (inputs.isSingleFiler ? r.yourRMD : r.wifeRMD) + r.drawdownPreTax;
                    return (age >= 65) ? Math.min(rmdAndDraw, Math.max(0, capExcl - ss)) : 0;
                  } else {
                    const exclJohn = (r.yourAge >= 65) ? Math.min(r.yourRMD + r.drawdownPreTax, Math.max(0, capExcl - r.yourSS)) : 0;
                    const exclWife = (r.wifeAge >= 65) ? Math.min(r.wifeRMD + r.drawdownPreTax, Math.max(0, capExcl - r.wifeSS)) : 0;
                    return Math.min(exclJohn + exclWife, Math.max(0, capExcl - r.yourSS) + Math.max(0, capExcl - r.wifeSS));
                  }
                })();

                const otherAGIWithout = Math.max(0, r.fedAGI - r.taxableSS - r.intentionalRothConversion);
                const totalSS = r.yourSS + r.wifeSS;
                const taxableSSWithout = calculateTaxableSS(totalSS, otherAGIWithout, isSingle);
                const agiWithout = otherAGIWithout + taxableSSWithout;

                const stateTaxWith = r.stateIncomeTax;
                const stateTaxWithout = calculateMDStateTax(agiWithout, taxableSSWithout, isSingle, cpiFactor, mdPensionExclusion);
                return Math.max(0, stateTaxWith - stateTaxWithout);
              })();

              const isTopRow = idx < 4;

              const prevRow = idx > 0 ? ledger[idx - 1] : null;

              // Brokerage assets roll-forward
              const startBrokerage = prevRow
                ? prevRow.endYourTaxableBrokerage + prevRow.endWifeTaxableBrokerage
                : (inputs.portfolio.yourTaxableBrokerage || 0) + (!inputs.isSingleFiler ? (inputs.portfolio.wifeTaxableBrokerage || 0) : 0);
              const endBrokerage = r.endYourTaxableBrokerage + r.endWifeTaxableBrokerage;
              const surplusReinvested = r.reinvestedSurplus || 0;
              const drawsBrokerage = r.drawdownTaxable || 0;
              const brokerageGrowth = endBrokerage + drawsBrokerage - surplusReinvested - startBrokerage;

              // Cash assets roll-forward
              const startCash = prevRow
                ? prevRow.endYourCash + prevRow.endWifeCash
                : (inputs.portfolio.yourCash || 0) + (!inputs.isSingleFiler ? (inputs.portfolio.wifeCash || 0) : 0);
              const endCash = r.endYourCash + r.endWifeCash;
              const drawsCash = r.drawdownCash || 0;
              const cashInterest = endCash + drawsCash - startCash;

              // Traditional IRA roll-forward
              const startPreTax = prevRow
                ? prevRow.endYourPreTaxIRA + prevRow.endWifePreTaxIRA
                : (inputs.portfolio.yourPreTaxIRA || 0) + (!inputs.isSingleFiler ? (inputs.portfolio.wifePreTaxIRA || 0) : 0);
              const endPreTax = r.endYourPreTaxIRA + r.endWifePreTaxIRA;
              const totalRMDs = (r.yourRMD || 0) + (r.wifeRMD || 0);
              const pretaxDraws = r.drawdownPreTax || 0;
              const rothConversions = r.intentionalRothConversion || 0;
              const qcd = r.qcdAmount || 0;
              const contributions401k = r.employee401kContribution || 0;
              const totalPreTaxOutflows = totalRMDs + pretaxDraws + rothConversions + qcd;
              const preTaxGrowth = endPreTax + totalPreTaxOutflows - contributions401k - startPreTax;

              // Roth IRA roll-forward
              const startRoth = prevRow
                ? prevRow.endYourRothIRA + prevRow.endWifeRothIRA
                : (inputs.portfolio.yourRothIRA || 0) + (!inputs.isSingleFiler ? (inputs.portfolio.wifeRothIRA || 0) : 0);
              const endRoth = r.endYourRothIRA + r.endWifeRothIRA;
              const drawsRoth = r.drawdownRoth || 0;
              const rothGrowth = endRoth + drawsRoth - rothConversions - startRoth;

              return (
                 <tr
                   key={r.year}
                   onClick={() => setSelectedRow(r)}
                   className={`transition-colors hover:bg-slate-900/60 cursor-pointer ${
                     isWarningRow 
                       ? 'bg-amber-950/20 text-amber-200 border-l-4 border-l-amber-500 font-medium' 
                       : 'text-slate-300 hover:text-slate-100'
                   }`}
                 >
                  <td className="px-2.5 py-2.5 font-mono font-semibold whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{r.year}</span>
                      {r.isActual && (
                        <span
                          onClick={(e) => {
                            if (onNavigateToActuals) {
                              e.stopPropagation();
                              onNavigateToActuals(r.year);
                            }
                          }}
                          className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded text-[9px] font-sans font-bold hover:bg-emerald-500/30 cursor-pointer"
                          title="Click to edit actuals in Actuals & Guardrails Workspace"
                        >
                          ACTUAL
                        </span>
                      )}
                      {r.isBridged && (
                        <span
                          onClick={(e) => {
                            if (onNavigateToActuals) {
                              e.stopPropagation();
                              onNavigateToActuals(r.year);
                            }
                          }}
                          className="px-1.5 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[9px] font-sans font-bold hover:bg-amber-500/30 cursor-pointer"
                          title="Missing actuals — bridged via simulation"
                        >
                          BRIDGED
                        </span>
                      )}
                      <span className="text-[10px] font-normal text-slate-400">
                        {inputs.isSingleFiler 
                          ? `(${r.yourAge >= (inputs.you.longevityAge ?? 85) ? '-' : r.yourAge})` 
                          : `(${r.yourAge >= (inputs.you.longevityAge ?? 85) ? '-' : r.yourAge}/${r.wifeAge >= (inputs.wife?.longevityAge ?? 95) ? '-' : r.wifeAge})`}
                      </span>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5 font-mono relative group cursor-help text-slate-300">
                    <span>{formatCurrency(r.magi)}</span>
                    <div className={`absolute left-1/2 -translate-x-1/2 w-72 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-2 font-sans normal-case ${
                      isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1">
                        <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Income / MAGI Component</span>
                        <span className="font-bold text-emerald-400 uppercase tracking-wider text-[9px]">Amount</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Active Salary (Earned):</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(salary)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Required Minimum Dist. (RMD):</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(rmd)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Extra Pre-Tax Drawdowns:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(pretaxDrawdown)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Roth Conversions:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(rothConv)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Realized Capital Gains:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(capitalGains)}</span>
                      </div>
                      {r.taxableDividends > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Dividends:</span>
                          <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.taxableDividends)}</span>
                        </div>
                      )}
                      {r.taxableInterest > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Cash Interest:</span>
                          <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.taxableInterest)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Taxable Social Security:</span>
                        <span className="font-mono text-slate-200 font-medium">
                          {formatCurrency(taxableSS)}{' '}
                          {totalSS > 0 && (
                            <span className="text-[10px] text-slate-500 font-normal">
                              {ssTaxedPercent > 0
                                ? `(${ssTaxedPercent}% of ${formatCurrency(totalSS)} taxable)`
                                : '(0% taxable — below provisional income threshold)'}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-1 text-[11px] font-bold">
                        <span className="text-slate-200">Total MAGI (Income):</span>
                        <span className="font-mono text-emerald-400">{formatCurrency(r.magi)}</span>
                      </div>
                    </div>
                  </td>

                  {/* Portfolio Growth Return */}
                  <td className={`px-2.5 py-2.5 font-mono relative group cursor-help ${
                    (r.portfolioGrowth || 0) < 0
                      ? 'text-rose-400 font-semibold'
                      : (r.portfolioGrowth || 0) > 0
                        ? 'text-emerald-400/90'
                        : 'text-slate-500'
                  }`}>
                    <span>{formatCurrency(r.portfolioGrowth || 0)}</span>
                    <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-3.5 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-1.5 font-sans normal-case ${
                      isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1 mb-1">
                        <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">
                          {(r.portfolioGrowth || 0) < 0 ? 'Portfolio Loss' : 'Portfolio Growth Return'}
                        </span>
                        <span className={`font-mono text-[10px] font-bold ${(r.portfolioGrowth || 0) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {formatCurrency(r.portfolioGrowth || 0)}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {(r.portfolioGrowth || 0) < 0
                          ? `Net investment loss across all portfolio accounts in ${r.year} due to market downturn.`
                          : `Total investment gains, dividends, and interest generated across all portfolio accounts in ${r.year}.`}
                      </div>
                    </div>
                  </td>

                  {/* Charitable Tithe & QCD */}
                  {inputs.charitySettings?.enabled && (
                    <td className="px-2.5 py-2.5 font-mono text-rose-400 relative group cursor-help">
                      <span>{formatCurrency(r.charitableTithe || 0)}</span>
                      <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-3.5 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-1.5 font-sans normal-case ${
                        isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                      }`}>
                        <div className="flex items-center justify-between border-b border-slate-800/80 pb-1 mb-1">
                          <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Tithe Breakdown</span>
                          <span className="font-bold text-rose-400 font-mono text-[10px]">{formatCurrency(r.charitableTithe || 0)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">QCD (Tax-Free IRA):</span>
                          <span className="font-mono text-sky-300 font-medium">{formatCurrency(r.qcdAmount || 0)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Cash / Taxable Tithe:</span>
                          <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.nonQcdTithe || 0)}</span>
                        </div>
                        {r.qcdTaxSavings > 0 && (
                          <div className="flex justify-between items-center border-t border-slate-800/80 pt-1.5 mt-1 text-[11px] font-semibold text-emerald-400">
                            <span>Est. Tax Saved via QCD:</span>
                            <span className="font-mono">+{formatCurrency(r.qcdTaxSavings)}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  )}

                  <td className="px-2.5 py-2.5 font-mono text-slate-300">
                    {r.intentionalRothConversion > 0 ? (
                      <span className="text-slate-300 font-mono">
                        {formatCurrency(r.intentionalRothConversion)}
                      </span>
                    ) : (
                      <span className="text-slate-600 font-mono">$0</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 font-mono relative group cursor-help">
                    {r.intentionalRothConversion > 0 ? (
                      <>
                        <span className="text-amber-400/90 font-semibold font-mono">
                          {formatCurrency(conversionTax + conversionStateTax)}
                        </span>
                        <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-2 font-sans normal-case ${
                          isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                        }`}>
                          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1">
                            <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Conversion Tax Breakdown</span>
                            <span className="font-bold text-amber-400 uppercase tracking-wider text-[9px]">Amount</span>
                          </div>
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400">Conversion Amount:</span>
                            <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.intentionalRothConversion)}</span>
                          </div>
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400">Federal Marginal Tax:</span>
                            <span className="font-mono text-slate-200 font-medium">{formatCurrency(conversionTax)}</span>
                          </div>
                          {conversionStateTax > 0 && (
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-slate-400">State Marginal Tax:</span>
                              <span className="font-mono text-slate-200 font-medium">{formatCurrency(conversionStateTax)}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-1 text-[11px] font-bold">
                            <span className="text-slate-200">Total Tax Cost:</span>
                            <span className="font-mono text-amber-400">{formatCurrency(conversionTax + conversionStateTax)}</span>
                          </div>
                          <p className="text-[9px] text-slate-500 leading-relaxed border-t border-slate-800/40 pt-1.5">
                            Marginal bracket-accurate estimate. Hover Total Expenses for full tax breakdown.
                          </p>
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-600 font-mono">$0</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2.5 font-mono text-rose-400/90 relative group cursor-help">
                    <span>{formatCurrency(r.totalExpenses)}</span>
                    <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-2 font-sans normal-case ${
                      isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1">
                        <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Expense Component</span>
                        <span className="font-bold text-rose-400 uppercase tracking-wider text-[9px]">Amount</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Living Expenses:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.livingExpenses)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Federal Income Tax:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.fedIncomeTax)}</span>
                      </div>
                      {r.intentionalRothConversion > 0 && (
                        <>
                          <div className="flex justify-between items-center text-[10px] pl-3">
                            <span className="text-slate-500">↳ Other Income:</span>
                            <span className="font-mono text-slate-400">{formatCurrency(r.fedIncomeTax - conversionTax)}</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] pl-3">
                            <span className="text-amber-500/80">↳ Roth Conversion:</span>
                            <span className="font-mono text-amber-400/90">{formatCurrency(conversionTax)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">State Income Tax:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.stateIncomeTax)}</span>
                      </div>
                      {r.intentionalRothConversion > 0 && r.stateIncomeTax > 0 && (
                        <>
                          <div className="flex justify-between items-center text-[10px] pl-3">
                            <span className="text-slate-500">↳ Other Income:</span>
                            <span className="font-mono text-slate-400">{formatCurrency(r.stateIncomeTax - conversionStateTax)}</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] pl-3">
                            <span className="text-amber-500/80">↳ Roth Conversion:</span>
                            <span className="font-mono text-amber-400/90">{formatCurrency(conversionStateTax)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Medicare Base:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.medicareBasePremiums)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Medicare IRMAA Hikes:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.combinedSurchargeAnnual)}</span>
                      </div>
                      {r.preMedicareHealthcareCost > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Pre-Medicare Premium:</span>
                          <span className="font-mono text-slate-200 font-medium">{formatCurrency(r.preMedicareHealthcareCost)}</span>
                        </div>
                      )}
                      {r.nonQcdTithe > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Non-QCD Charitable Gift:</span>
                          <span className="font-mono text-rose-300 font-medium">{formatCurrency(r.nonQcdTithe)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-1 text-[11px] font-bold">
                        <span className="text-slate-200">Total Outflow:</span>
                        <span className="font-mono text-rose-400">{formatCurrency(r.totalExpenses)}</span>
                      </div>
                    </div>
                  </td>
                  {/* Brokerage Assets Cell */}
                  <td className="px-2.5 py-2.5 font-mono text-slate-300 relative group cursor-help">
                    <span>{formatCurrency(endBrokerage)}</span>
                    <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-2 font-sans normal-case ${
                      isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1">
                        <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Brokerage Asset Roll-Forward</span>
                        <span className="font-bold text-emerald-400 font-mono text-[10px]">{formatCurrency(endBrokerage)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Start Balance:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(startBrokerage)}</span>
                      </div>
                      {brokerageGrowth > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Investment Growth:</span>
                          <span className="font-mono text-emerald-400 font-medium">+{formatCurrency(brokerageGrowth)}</span>
                        </div>
                      )}
                      {surplusReinvested > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Reinvested Surplus:</span>
                          <span className="font-mono text-emerald-400 font-medium">+{formatCurrency(surplusReinvested)}</span>
                        </div>
                      )}
                      {drawsBrokerage > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Brokerage Drawdown:</span>
                          <span className="font-mono text-rose-400 font-medium">-{formatCurrency(drawsBrokerage)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-1 text-[11px] font-bold">
                        <span className="text-slate-200">Ending Balance:</span>
                        <span className="font-mono text-slate-100">{formatCurrency(endBrokerage)}</span>
                      </div>
                    </div>
                  </td>

                  {/* Cash Assets Cell */}
                  <td className="px-2.5 py-2.5 font-mono text-slate-300 relative group cursor-help">
                    <span>{formatCurrency(endCash)}</span>
                    <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-2 font-sans normal-case ${
                      isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1">
                        <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Cash Asset Roll-Forward</span>
                        <span className="font-bold text-emerald-400 font-mono text-[10px]">{formatCurrency(endCash)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Start Balance:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(startCash)}</span>
                      </div>
                      {cashInterest > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Interest Earned:</span>
                          <span className="font-mono text-emerald-400 font-medium">+{formatCurrency(cashInterest)}</span>
                        </div>
                      )}
                      {drawsCash > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Cash Drawdown:</span>
                          <span className="font-mono text-rose-400 font-medium">-{formatCurrency(drawsCash)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-1 text-[11px] font-bold">
                        <span className="text-slate-200">Ending Balance:</span>
                        <span className="font-mono text-slate-100">{formatCurrency(endCash)}</span>
                      </div>
                    </div>
                  </td>
                  {/* Traditional IRA Cell */}
                  <td className="px-2.5 py-2.5 font-mono text-slate-300 relative group cursor-help">
                    <span>{formatCurrency(endPreTax)}</span>
                    <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-2 font-sans normal-case ${
                      isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1">
                        <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Traditional IRA Roll-Forward</span>
                        <span className="font-bold text-emerald-400 font-mono text-[10px]">{formatCurrency(endPreTax)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Start Balance:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(startPreTax)}</span>
                      </div>
                      {preTaxGrowth > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Investment Growth:</span>
                          <span className="font-mono text-emerald-400 font-medium">+{formatCurrency(preTaxGrowth)}</span>
                        </div>
                      )}
                      {contributions401k > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Pre-Tax 401(k) Contrib.:</span>
                          <span className="font-mono text-emerald-400 font-medium">+{formatCurrency(contributions401k)}</span>
                        </div>
                      )}
                      {totalRMDs > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Forced RMDs:</span>
                          <span className="font-mono text-rose-400 font-medium">-{formatCurrency(totalRMDs)}</span>
                        </div>
                      )}
                      {pretaxDraws > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Extra Pre-Tax Drawdowns:</span>
                          <span className="font-mono text-rose-400 font-medium">-{formatCurrency(pretaxDraws)}</span>
                        </div>
                      )}
                      {rothConversions > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Roth Conversions:</span>
                          <span className="font-mono text-rose-400 font-medium">-{formatCurrency(rothConversions)}</span>
                        </div>
                      )}
                      {qcd > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">QCD Charitable Tithe:</span>
                          <span className="font-mono text-rose-400 font-medium">-{formatCurrency(qcd)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-1 text-[11px] font-bold">
                        <span className="text-slate-200">Ending Balance:</span>
                        <span className="font-mono text-slate-100">{formatCurrency(endPreTax)}</span>
                      </div>
                    </div>
                  </td>
                  {/* Roth (Tax-Free) Cell */}
                  <td className="px-2.5 py-2.5 font-mono text-emerald-400/90 relative group cursor-help">
                    <span>{formatCurrency(endRoth)}</span>
                    <div className={`absolute left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none space-y-2 font-sans normal-case ${
                      isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                    }`}>
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1">
                        <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">Roth IRA Roll-Forward</span>
                        <span className="font-bold text-emerald-400 font-mono text-[10px]">{formatCurrency(endRoth)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Start Balance:</span>
                        <span className="font-mono text-slate-200 font-medium">{formatCurrency(startRoth)}</span>
                      </div>
                      {rothGrowth > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Tax-Free Growth:</span>
                          <span className="font-mono text-emerald-400 font-medium">+{formatCurrency(rothGrowth)}</span>
                        </div>
                      )}
                      {rothConversions > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Roth Conversion Inflow:</span>
                          <span className="font-mono text-emerald-400 font-medium">+{formatCurrency(rothConversions)}</span>
                        </div>
                      )}
                      {drawsRoth > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-400">Tax-Free Drawdown:</span>
                          <span className="font-mono text-rose-400 font-medium">-{formatCurrency(drawsRoth)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-1 text-[11px] font-bold">
                        <span className="text-slate-200">Ending Balance:</span>
                        <span className="font-mono text-slate-100">{formatCurrency(endRoth)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5 font-mono font-bold text-slate-100">{formatCurrency(r.totalPortfolioValue)}</td>
                  <td className="px-2.5 py-2.5 whitespace-nowrap relative group cursor-help">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        r.surchargeTier > 0
                          ? 'bg-amber-600/10 text-amber-400 border border-amber-500/20'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      Tier {r.surchargeTier}
                    </span>
                    <span className="ml-1.5 font-mono text-[11px] text-slate-400">({lookbackYear} MAGI)</span>

                    {/* IRMAA Tier Reference Popup */}
                    {(() => {
                      const isSingle = simulateSurvivor && r.year >= deathYear;
                      const tiers = isSingle ? IRMAA_TIERS_SINGLE : IRMAA_TIERS_MFJ;
                      const cpiFactor = r.cpiFactor;
                      const healthcareFactor = Math.pow(1 + inputs.growthAssumptions.healthcareInflationRate, r.year - simStartYear);
                      return (
                        <div className={`absolute right-0 w-[380px] whitespace-normal bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-xs text-slate-300 pointer-events-none font-sans normal-case ${
                          isTopRow ? 'top-full mt-2' : 'bottom-full mb-2'
                        }`}>
                          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-2">
                            <span className="font-bold text-slate-200 uppercase tracking-wider text-[9px]">IRMAA Tier Reference — {r.year}</span>
                            <span className="font-bold text-amber-400 uppercase tracking-wider text-[9px]">{isSingle ? 'Single' : 'MFJ'}</span>
                          </div>
                          {/* Column headers */}
                          <div className="grid grid-cols-[60px_1fr_1.2fr] gap-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider px-1 mb-1">
                            <span>Tier</span>
                            <span className="text-right">MAGI Limit</span>
                            <span className="text-right">Mo. Surcharge/person</span>
                          </div>
                          <div className="space-y-0.5">
                            {tiers.map((tier) => {
                              const isActive = tier.tierNumber === r.surchargeTier;
                              const inflatedLimit = tier.limit === Infinity
                                ? null
                                : (tier.tierNumber < 4 ? tier.limit * cpiFactor : tier.limit);
                              const monthlySurcharge = (tier.partBSurcharge + tier.partDSurcharge) * healthcareFactor;
                              return (
                                <div
                                  key={tier.tierNumber}
                                  className={`grid grid-cols-[60px_1fr_1.2fr] gap-1 px-2 py-1 rounded-lg text-[10px] ${
                                    isActive
                                      ? 'bg-amber-500/15 border border-amber-500/30 text-amber-200'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  <span className={`font-semibold ${isActive ? 'text-amber-300' : 'text-slate-300'}`}>
                                    Tier {tier.tierNumber} {isActive ? '◀' : ''}
                                  </span>
                                  <span className="text-right font-mono">
                                    {inflatedLimit ? `≤ ${formatCurrency(inflatedLimit)}` : 'No limit'}
                                  </span>
                                  <span className={`text-right font-mono ${monthlySurcharge > 0 ? (isActive ? 'text-amber-300' : 'text-rose-400/70') : 'text-slate-600'}`}>
                                    {monthlySurcharge > 0 ? `+${formatCurrency(monthlySurcharge)}/mo` : 'No surcharge'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[9px] text-slate-500 leading-relaxed border-t border-slate-800/40 pt-1.5 mt-2">
                            MAGI limits inflated by CPI. Surcharges inflated by healthcare rate. Applied in {r.year} based on {lookbackYear} MAGI ({formatCurrency(r.magiTwoYearsAgo)}{r.isSSA44Applied ? ' via SSA-44 reset' : ''}).
                          </p>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-2.5 py-2.5 text-right font-mono whitespace-nowrap">
                    {r.combinedSurchargeMonthly > 0 ? (
                      <div className="leading-tight">
                        <span className="text-red-400 font-semibold block">
                          {formatCurrency(r.combinedSurchargeMonthly)}/mo
                        </span>
                        <span className="text-[10px] text-slate-400 block font-normal">
                          ({formatCurrency(r.combinedSurchargeAnnual)}/yr)
                        </span>
                      </div>
                    ) : (
                      <div className="leading-tight">
                        <span className="text-slate-500 block">$0/mo</span>
                        <span className="text-[10px] text-slate-600 block font-normal">($0/yr)</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Info Footnote */}
      <div className="flex gap-2 items-start text-xs text-slate-500 leading-relaxed">
        <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
        <p>
          MAGI is calculated as Federal Adjusted Gross Income (AGI) plus tax-exempt interest. Surcharges represent the combined Medicare Part B and Part D premium hikes applied directly to the spouses. In Survivor simulations, the surcharge calculation automatically switches to Single Filer thresholds starting in {deathYear} (after the projected passing of {inputs.you.name || 'You'}).
        </p>
      </div>

      <RowInspectionDialog
        isOpen={selectedRow !== null}
        onClose={() => setSelectedRow(null)}
        row={selectedRow}
        prevRow={selectedRow ? (ledger.indexOf(selectedRow) > 0 ? ledger[ledger.indexOf(selectedRow) - 1] : null) : null}
        inputs={inputs}
        simulateSurvivor={simulateSurvivor}
        deathYear={deathYear}
        ledger={ledger}
        onSelectRow={setSelectedRow}
      />

      {showWarningsModal && createPortal(
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[100]"
          onClick={() => setShowWarningsModal(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 border-b border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500 animate-bounce" />
                <h3 className="text-base font-bold text-slate-100">
                  IRMAA Surcharge Safety Warnings
                </h3>
              </div>
              <button
                onClick={() => setShowWarningsModal(false)}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto space-y-4 max-h-[60vh] custom-scrollbar">
              <p className="text-xs text-slate-400 leading-relaxed">
                The following years have projected MAGI amounts that are within $5,000 above an IRMAA surcharge threshold. Pushing your income below these thresholds can save significant premium surcharges.
              </p>
              <div className="space-y-3">
                {warnings.map((w, idx) => (
                  <div 
                    key={idx} 
                    className="bg-amber-950/20 border border-amber-500/20 p-4 rounded-2xl space-y-2 text-slate-300"
                  >
                    <div className="flex items-center justify-between text-xs border-b border-amber-500/10 pb-1.5 mb-1.5">
                      <span className="font-bold text-amber-400 uppercase tracking-wide">
                        🚨 Year {w.year} Warning
                      </span>
                      <span className="font-mono text-slate-400">
                        Affected Surcharge Year: {w.affectedYear}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-400 block">Computed MAGI:</span>
                        <strong className="font-mono text-slate-200">{formatCurrency(w.magi)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block">IRMAA Cliff Limit:</span>
                        <strong className="font-mono text-slate-200">{formatCurrency(w.cliff)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Excess Over Cliff:</span>
                        <strong className="font-mono text-amber-400 font-semibold">{formatCurrency(w.excess)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Projected Surcharge Cost:</span>
                        <strong className="font-mono text-red-400 font-semibold">{formatCurrency(w.penalty)}</strong>
                      </div>
                    </div>
                    <div className="text-xs text-amber-200/90 pt-2 border-t border-amber-500/10 leading-relaxed">
                      💡 <strong>Actionable Tip:</strong> Consider reducing conversions, liquidations, or other taxable distributions by <strong className="font-mono text-emerald-400">{formatCurrency(w.excess + 1)}</strong> to stay under the cliff and save this surcharge.
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-800 flex justify-end bg-slate-900/50">
              <button
                onClick={() => setShowWarningsModal(false)}
                className="px-5 py-2.5 text-xs font-bold text-slate-300 hover:text-slate-100 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 rounded-xl transition-all cursor-pointer"
              >
                Close Warnings
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
