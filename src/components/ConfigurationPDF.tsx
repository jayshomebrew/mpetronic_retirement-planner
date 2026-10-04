import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { AppStateInputs, normalizeDetailedExpenses, getSimulationStartYear } from '../types';

// Create stylesheet for PDF formatting
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    lineHeight: 1.4,
    padding: 35,
    color: '#1e293b', // slate-800
    backgroundColor: '#ffffff',
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1', // slate-300
    paddingBottom: 10,
    marginBottom: 15,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a', // slate-900
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 7.5,
    color: '#64748b', // slate-500
    marginTop: 6,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#0284c7', // sky-600
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0', // slate-200
    paddingBottom: 3,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  col2: {
    width: '50%',
    paddingHorizontal: 4,
  },
  col3: {
    width: '33.33%',
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#f8fafc', // slate-50
    borderWidth: 1,
    borderColor: '#e2e8f0', // slate-200
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#334155', // slate-700
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 3,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f1f5f9',
  },
  rowLabel: {
    color: '#475569', // slate-600
    width: '46%',
    fontSize: 8,
    lineHeight: 1.25,
  },
  rowValue: {
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    width: '54%',
    textAlign: 'right',
    fontSize: 8,
    lineHeight: 1.25,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    fontFamily: 'Helvetica-Bold',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  tableCellHeader: {
    color: '#334155',
    fontSize: 8,
  },
  tableCell: {
    color: '#0f172a',
    fontSize: 8,
  },
  colAsset: { width: '40%' },
  colOwner: { width: '30%', textAlign: 'right' },
  colSpouse: { width: '30%', textAlign: 'right' },
  
  colExpName: { width: '40%' },
  colExpCat: { width: '20%' },
  colExpFreq: { width: '15%', textAlign: 'center' },
  colExpMD: { width: '12.5%', textAlign: 'right' },
  colExpFL: { width: '12.5%', textAlign: 'right' },

  footer: {
    position: 'absolute',
    bottom: 20,
    left: 35,
    right: 35,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: '#94a3b8',
  }
});

// Standard Medicare Part B and Part D baseline monthly rates
const BASE_MEDICARE_PART_B_RATE = 202.90;
const BASE_MEDICARE_PART_D_RATE = 34.50;

/**
 * Calculates pre-65 (Pre-Medicare) annual healthcare costs for a person in a specific state.
 */
const getPersonPre65HealthcareAnnual = (
  person: AppStateInputs['you'] | AppStateInputs['wife'],
  stateKey: 'MD' | 'FL'
): number => {
  if (person.healthcare) {
    const stateHc = person.healthcare[stateKey];
    const monthlyPrem = (stateHc?.pre65MedicalPremium ?? 0) + (stateHc?.pre65DentalPremium ?? 0) + (stateHc?.pre65VisionPremium ?? 0);
    const annualOOP = (stateHc?.pre65MedicalOOP ?? 0) + (stateHc?.pre65DentalOOP ?? 0) + (stateHc?.pre65VisionOOP ?? 0);
    return monthlyPrem * 12 + annualOOP;
  }
  return (person.preMedicareMonthlyPremium ?? 0) * 12;
};

/**
 * Calculates post-65 (Medicare) annual healthcare costs for a person in a specific state.
 */
const getPersonPost65HealthcareAnnual = (
  person: AppStateInputs['you'] | AppStateInputs['wife'],
  stateKey: 'MD' | 'FL'
): number => {
  if (person.healthcare) {
    const stateHc = person.healthcare[stateKey];
    const customB = person.healthcare.medicarePartBPremium;
    const partB = (customB !== null && customB !== undefined) ? customB : BASE_MEDICARE_PART_B_RATE;
    const customD = stateHc?.medicarePartDPremium;
    const partD = (customD !== null && customD !== undefined) ? customD : BASE_MEDICARE_PART_D_RATE;
    const monthlyPrem = partB + partD + (stateHc?.supplementPremium ?? 0) + (stateHc?.post65DentalPremium ?? 0) + (stateHc?.post65VisionPremium ?? 0);
    const annualOOP = (stateHc?.medicarePartDDeductibleCopays ?? 0) + (stateHc?.supplementOOP ?? 0) + (stateHc?.post65HearingCare ?? 0) + (stateHc?.post65DentalOOP ?? 0) + (stateHc?.post65VisionOOP ?? 0);
    return monthlyPrem * 12 + annualOOP;
  }
  return (BASE_MEDICARE_PART_B_RATE + BASE_MEDICARE_PART_D_RATE) * 12;
};

interface PDFProps {
  inputs: AppStateInputs;
}

/**
 * Renders the executive PDF retirement plan configuration report.
 */
export const ConfigurationPDF: React.FC<PDFProps> = ({ inputs }) => {
  const stateA = inputs.jurisdiction.currentState || 'MD';
  const stateB = inputs.jurisdiction.targetState || 'FL';
  const normExpenses = normalizeDetailedExpenses(inputs.detailedExpenses);
  const catalog = normExpenses.catalog;
  const costs = normExpenses.costs;
  const frequencies = normExpenses.frequencies;

  const recurringItems = catalog.items.filter((i) => !i.isOneTime);
  const oneTimeItems = catalog.items.filter((i) => i.isOneTime);

  const mdRecurringAnnual = recurringItems.reduce((sum, item) => {
    const cost = costs[stateA]?.[item.id] ?? 0;
    const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
    return sum + cost * freq;
  }, 0);

  const flRecurringAnnual = recurringItems.reduce((sum, item) => {
    const cost = costs[stateB]?.[item.id] ?? 0;
    const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
    return sum + cost * freq;
  }, 0);

  const mdRecurringMonthly = mdRecurringAnnual / 12;
  const flRecurringMonthly = flRecurringAnnual / 12;

  const mdOneTime = oneTimeItems.reduce((sum, item) => {
    return sum + (costs[stateA]?.[item.id] ?? 0);
  }, 0);

  const flOneTime = oneTimeItems.reduce((sum, item) => {
    return sum + (costs[stateB]?.[item.id] ?? 0);
  }, 0);

  /**
   * Formats a numeric value into USD currency format without decimal places.
   */
  const formatCurrency = (val: number | null | undefined) => {
    if (val === undefined || val === null) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  /**
   * Formats a numeric ratio into a percentage string formatted to 2 decimal places.
   */
  const formatPercent = (val: number | undefined | null) => {
    if (val === undefined || val === null) return '0.00%';
    return (val * 100).toFixed(2) + '%';
  };

  /**
   * Converts a 1-based month index to a formatted string.
   */
  const formatMonth = (m: number | undefined | null) => {
    if (m === undefined || m === null) return 'Birth Month';
    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${m} (${MONTH_NAMES[m - 1] ?? ''})`;
  };

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const hasDetailedHealthcare = !!(inputs.you.healthcare || (!inputs.isSingleFiler && inputs.wife.healthcare));
  const simStartYear = getSimulationStartYear(inputs);

  // Calculate Primary annual healthcare totals for stateA and stateB
  const youPre65_A = getPersonPre65HealthcareAnnual(inputs.you, stateA as 'MD' | 'FL');
  const youPost65_A = getPersonPost65HealthcareAnnual(inputs.you, stateA as 'MD' | 'FL');
  const youPre65_B = getPersonPre65HealthcareAnnual(inputs.you, stateB as 'MD' | 'FL');
  const youPost65_B = getPersonPost65HealthcareAnnual(inputs.you, stateB as 'MD' | 'FL');

  // Calculate Spouse annual healthcare totals for stateA and stateB
  const wifePre65_A = inputs.isSingleFiler ? 0 : getPersonPre65HealthcareAnnual(inputs.wife, stateA as 'MD' | 'FL');
  const wifePost65_A = inputs.isSingleFiler ? 0 : getPersonPost65HealthcareAnnual(inputs.wife, stateA as 'MD' | 'FL');
  const wifePre65_B = inputs.isSingleFiler ? 0 : getPersonPre65HealthcareAnnual(inputs.wife, stateB as 'MD' | 'FL');
  const wifePost65_B = inputs.isSingleFiler ? 0 : getPersonPost65HealthcareAnnual(inputs.wife, stateB as 'MD' | 'FL');

  // Combine household annual healthcare totals per state
  const totalPre65_A = youPre65_A + wifePre65_A;
  const totalPost65_A = youPost65_A + wifePost65_A;
  const totalPre65_B = youPre65_B + wifePre65_B;
  const totalPost65_B = youPost65_B + wifePost65_B;

  // Calculate annual living expenses for stateA and stateB
  const livingAnnual_A = inputs.useDetailedExpenses ? mdRecurringAnnual : (inputs.annualLivingExpenses ?? 0);
  const livingAnnual_B = inputs.useDetailedExpenses ? flRecurringAnnual : (inputs.annualLivingExpenses ?? 0);

  // Calculate overall total annual expenses (Living + Healthcare)
  const overallPre65_A = livingAnnual_A + totalPre65_A;
  const overallPost65_A = livingAnnual_A + totalPost65_A;
  const overallPre65_B = livingAnnual_B + totalPre65_B;
  const overallPost65_B = livingAnnual_B + totalPost65_B;

  /**
   * Renders the final Overall Total Annual Expenses section combining living and healthcare costs.
   */
  const renderOverallTotalExpensesSection = (sectionNumber: number) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{sectionNumber}. Overall Total Annual Expenses (Living & Healthcare)</Text>
      <View style={styles.grid}>
        {/* State A Overall Totals Card */}
        <View style={styles.col2}>
          <View style={[styles.card, { borderColor: '#0284c7', backgroundColor: '#f8fafc', borderWidth: 1.5 }]}>
            <Text style={[styles.cardTitle, { color: '#0369a1', borderBottomColor: '#cbd5e1', fontSize: 9.5 }]}>
              {stateA} Total Annual Expenses
            </Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Annual Living Expenses:</Text>
              <Text style={styles.rowValue}>{formatCurrency(livingAnnual_A)}/yr</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Pre-65 Annual Healthcare:</Text>
              <Text style={styles.rowValue}>{formatCurrency(totalPre65_A)}/yr</Text>
            </View>
            <View style={[styles.row, { backgroundColor: '#e0f2fe', marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 3 }]}>
              <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                Pre-65 Total Expenses:
              </Text>
              <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                {formatCurrency(overallPre65_A)}/yr ({formatCurrency(overallPre65_A / 12)}/mo)
              </Text>
            </View>
            <View style={[styles.row, { marginTop: 4 }]}>
              <Text style={styles.rowLabel}>Post-65 Annual Healthcare:</Text>
              <Text style={styles.rowValue}>{formatCurrency(totalPost65_A)}/yr</Text>
            </View>
            <View style={[styles.row, { backgroundColor: '#e0f2fe', marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 3, borderBottomWidth: 0 }]}>
              <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                Post-65 Total Expenses:
              </Text>
              <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                {formatCurrency(overallPost65_A)}/yr ({formatCurrency(overallPost65_A / 12)}/mo)
              </Text>
            </View>
          </View>
        </View>

        {/* State B Overall Totals Card */}
        <View style={styles.col2}>
          <View style={[styles.card, { borderColor: '#0284c7', backgroundColor: '#f8fafc', borderWidth: 1.5 }]}>
            <Text style={[styles.cardTitle, { color: '#0369a1', borderBottomColor: '#cbd5e1', fontSize: 9.5 }]}>
              {stateB} Total Annual Expenses
            </Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Annual Living Expenses:</Text>
              <Text style={styles.rowValue}>{formatCurrency(livingAnnual_B)}/yr</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Pre-65 Annual Healthcare:</Text>
              <Text style={styles.rowValue}>{formatCurrency(totalPre65_B)}/yr</Text>
            </View>
            <View style={[styles.row, { backgroundColor: '#e0f2fe', marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 3 }]}>
              <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                Pre-65 Total Expenses:
              </Text>
              <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                {formatCurrency(overallPre65_B)}/yr ({formatCurrency(overallPre65_B / 12)}/mo)
              </Text>
            </View>
            <View style={[styles.row, { marginTop: 4 }]}>
              <Text style={styles.rowLabel}>Post-65 Annual Healthcare:</Text>
              <Text style={styles.rowValue}>{formatCurrency(totalPost65_B)}/yr</Text>
            </View>
            <View style={[styles.row, { backgroundColor: '#e0f2fe', marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 3, borderBottomWidth: 0 }]}>
              <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                Post-65 Total Expenses:
              </Text>
              <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                {formatCurrency(overallPost65_B)}/yr ({formatCurrency(overallPost65_B / 12)}/mo)
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <Document>
      {/* Page 1: Profiles & Portfolio Assets */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Retirement Planner - Plan Configuration Report</Text>
          <Text style={styles.subtitle}>Generated on {dateStr} | Timeline Anchor: {simStartYear} | Comprehensive settings controlling simulation model</Text>
        </View>

        {/* Section 1: Personal Profiles */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Personal Profiles & SS Claiming Settings</Text>
          <View style={styles.grid}>
            {/* Primary User Card */}
            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{inputs.you.name || 'Primary User'} (You)</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Birth Date:</Text>
                  <Text style={styles.rowValue}>{inputs.you.birthDate || 'N/A'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Planned Retirement Age / Month:</Text>
                  <Text style={styles.rowValue}>{inputs.you.plannedRetirementAge ?? 67} / {formatMonth(inputs.you.plannedRetirementMonth)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Projected Longevity Age:</Text>
                  <Text style={styles.rowValue}>{inputs.you.longevityAge ?? 85} yrs</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Active Work Annual Salary:</Text>
                  <Text style={styles.rowValue}>{formatCurrency(inputs.you.activeSalary)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Target SS Claiming Age:</Text>
                  <Text style={styles.rowValue}>{inputs.you.targetSSClaimingAge ?? 67}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>SS PIA Benefit (Monthly at FRA):</Text>
                  <Text style={styles.rowValue}>{formatCurrency(inputs.you.estimatedPIA)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Pre-Medicare Premium/mo:</Text>
                  <Text style={styles.rowValue}>{inputs.you.healthcare ? 'N/A (Detailed Active)' : formatCurrency(inputs.you.preMedicareMonthlyPremium)}</Text>
                </View>
              </View>
            </View>

            {/* Spouse Card */}
            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{inputs.isSingleFiler ? 'Filing Status Mode' : (inputs.wife.name || 'Spouse')}</Text>
                {inputs.isSingleFiler ? (
                  <View style={{ padding: 10 }}>
                    <Text style={{ fontFamily: 'Helvetica-Bold', color: '#b91c1c', fontSize: 10 }}>Single Filer Mode Active</Text>
                    <Text style={{ marginTop: 8, color: '#64748b', fontSize: 8.5, lineHeight: 1.4 }}>
                      No spouse details are modeled. Tax brackets, standard deductions, and lookbacks are evaluated under Single status.
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Birth Date:</Text>
                      <Text style={styles.rowValue}>{inputs.wife.birthDate || 'N/A'}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Planned Retirement Age / Month:</Text>
                      <Text style={styles.rowValue}>{inputs.wife.plannedRetirementAge ?? 67} / {formatMonth(inputs.wife.plannedRetirementMonth)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Projected Longevity Age:</Text>
                      <Text style={styles.rowValue}>{inputs.wife.longevityAge ?? 95} yrs</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Active Work Annual Salary:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.wife.activeSalary)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Target SS Claiming Age:</Text>
                      <Text style={styles.rowValue}>{inputs.wife.targetSSClaimingAge ?? 67}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>SS PIA Benefit (Monthly at FRA):</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.wife.estimatedPIA)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Pre-Medicare Premium/mo:</Text>
                      <Text style={styles.rowValue}>{inputs.wife.healthcare ? 'N/A (Detailed Active)' : formatCurrency(inputs.wife.preMedicareMonthlyPremium)}</Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Section 2: Asset Balances */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Starting Portfolio Asset Balances & Cost Basis ({simStartYear})</Text>
          <View style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
            <View style={styles.tableHeader}>
              <Text style={[styles.colAsset, styles.tableCellHeader]}>Account Category</Text>
              <Text style={[styles.colOwner, styles.tableCellHeader]}>{inputs.you.name || 'You'}</Text>
              <Text style={[styles.colSpouse, styles.tableCellHeader]}>{inputs.isSingleFiler ? 'N/A' : (inputs.wife.name || 'Spouse')}</Text>
            </View>

            <View style={styles.tableRow}>
              <Text style={[styles.colAsset, styles.tableCell]}>Taxable Brokerage Balance</Text>
              <Text style={[styles.colOwner, styles.tableCell]}>{formatCurrency(inputs.portfolio.yourTaxableBrokerage)}</Text>
              <Text style={[styles.colSpouse, styles.tableCell]}>{inputs.isSingleFiler ? '-' : formatCurrency(inputs.portfolio.wifeTaxableBrokerage)}</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.colAsset, styles.tableCell, { color: '#64748b', paddingLeft: 10 }]}>• Taxable Account Cost Basis</Text>
              <Text style={[styles.colOwner, styles.tableCell, { color: '#64748b' }]}>{formatCurrency(inputs.portfolio.yourTaxableBasis)}</Text>
              <Text style={[styles.colSpouse, styles.tableCell, { color: '#64748b' }]}>{inputs.isSingleFiler ? '-' : formatCurrency(inputs.portfolio.wifeTaxableBasis)}</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.colAsset, styles.tableCell]}>Traditional IRA (Pre-Tax)</Text>
              <Text style={[styles.colOwner, styles.tableCell]}>{formatCurrency(inputs.portfolio.yourPreTaxIRA)}</Text>
              <Text style={[styles.colSpouse, styles.tableCell]}>{inputs.isSingleFiler ? '-' : formatCurrency(inputs.portfolio.wifePreTaxIRA)}</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.colAsset, styles.tableCell]}>Roth IRA (Tax-Free)</Text>
              <Text style={[styles.colOwner, styles.tableCell]}>{formatCurrency(inputs.portfolio.yourRothIRA)}</Text>
              <Text style={[styles.colSpouse, styles.tableCell]}>{inputs.isSingleFiler ? '-' : formatCurrency(inputs.portfolio.wifeRothIRA)}</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.colAsset, styles.tableCell]}>Cash Savings / Liquid Accounts</Text>
              <Text style={[styles.colOwner, styles.tableCell]}>{formatCurrency(inputs.portfolio.yourCash)}</Text>
              <Text style={[styles.colSpouse, styles.tableCell]}>{inputs.isSingleFiler ? '-' : formatCurrency(inputs.portfolio.wifeCash)}</Text>
            </View>

            <View style={[styles.tableRow, { backgroundColor: '#f8fafc', borderBottomWidth: 0 }]}>
              <Text style={[styles.colAsset, styles.tableCell, { fontFamily: 'Helvetica-Bold' }]}>Account Subtotals</Text>
              <Text style={[styles.colOwner, styles.tableCell, { fontFamily: 'Helvetica-Bold' }]}>
                {formatCurrency(
                  (inputs.portfolio.yourTaxableBrokerage ?? 0) +
                  (inputs.portfolio.yourPreTaxIRA ?? 0) +
                  (inputs.portfolio.yourRothIRA ?? 0) +
                  (inputs.portfolio.yourCash ?? 0)
                )}
              </Text>
              <Text style={[styles.colSpouse, styles.tableCell, { fontFamily: 'Helvetica-Bold' }]}>
                {inputs.isSingleFiler ? '-' : formatCurrency(
                  (inputs.portfolio.wifeTaxableBrokerage ?? 0) +
                  (inputs.portfolio.wifePreTaxIRA ?? 0) +
                  (inputs.portfolio.wifeRothIRA ?? 0) +
                  (inputs.portfolio.wifeCash ?? 0)
                )}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: 8, paddingHorizontal: 4, flexDirection: 'row', justifyContent: 'space-between', fontSize: 9.5, fontFamily: 'Helvetica-Bold' }}>
            <Text style={{ color: '#475569' }}>Total Portfolio Value:</Text>
            <Text style={{ color: '#0284c7' }}>
              {formatCurrency(
                (inputs.portfolio.yourTaxableBrokerage ?? 0) +
                (inputs.portfolio.yourPreTaxIRA ?? 0) +
                (inputs.portfolio.yourRothIRA ?? 0) +
                (inputs.portfolio.yourCash ?? 0) +
                (inputs.isSingleFiler ? 0 : (
                  (inputs.portfolio.wifeTaxableBrokerage ?? 0) +
                  (inputs.portfolio.wifePreTaxIRA ?? 0) +
                  (inputs.portfolio.wifeRothIRA ?? 0) +
                  (inputs.portfolio.wifeCash ?? 0)
                ))
              )}
            </Text>
          </View>
        </View>

        {/* Section 3: Assumptions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Growth, Inflation & Market Assumptions</Text>
          <View style={styles.grid}>
            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Baseline Means & Inflation</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Equities (Stock) Return (Mean):</Text>
                  <Text style={styles.rowValue}>{formatPercent(inputs.growthAssumptions.equityReturnRate)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Fixed Income / Bonds (Mean):</Text>
                  <Text style={styles.rowValue}>{formatPercent(inputs.growthAssumptions.fixedIncomeReturnRate)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Compound Inflation Rate (CPI):</Text>
                  <Text style={styles.rowValue}>{formatPercent(inputs.growthAssumptions.cpiInflationRate)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Medical / Healthcare Inflation:</Text>
                  <Text style={styles.rowValue}>{formatPercent(inputs.growthAssumptions.healthcareInflationRate)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Account Asset Allocations</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Pre-Tax IRA Allocation:</Text>
                  <Text style={styles.rowValue}>{Math.round((inputs.growthAssumptions.preTaxEquityPortion ?? 0.50) * 100)}% Stock / {Math.round((1 - (inputs.growthAssumptions.preTaxEquityPortion ?? 0.50)) * 100)}% Bond</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Taxable Brokerage Allocation:</Text>
                  <Text style={styles.rowValue}>{Math.round((inputs.growthAssumptions.taxableEquityPortion ?? 0.60) * 100)}% Stock / {Math.round((1 - (inputs.growthAssumptions.taxableEquityPortion ?? 0.60)) * 100)}% Bond</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Roth IRA Allocation:</Text>
                  <Text style={styles.rowValue}>{Math.round((inputs.growthAssumptions.rothEquityPortion ?? 1.00) * 100)}% Stock / {Math.round((1 - (inputs.growthAssumptions.rothEquityPortion ?? 1.00)) * 100)}% Bond</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Cash Savings Yield:</Text>
                  <Text style={styles.rowValue}>{formatPercent(inputs.growthAssumptions.cashYieldRate ?? inputs.growthAssumptions.fixedIncomeReturnRate)}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Min Cash Reserve Floor:</Text>
                  <Text style={styles.rowValue}>{formatCurrency(inputs.growthAssumptions.minCashReserveDollars ?? 100000)} (CPI-Indexed)</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.footer} render={({ pageNumber }) => `Retirement Plan Configuration Summary  |  Page ${pageNumber}`} />
      </Page>

      {/* Page 2: Tax Relocation, Strategy, and Healthcare Details */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Retirement Planner - Plan Configuration Report</Text>
          <Text style={styles.subtitle}>Generated on {dateStr} | Comprehensive settings controlling simulation model</Text>
        </View>

        {/* Section 4: Relocation & Monte Carlo */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Tax Jurisdiction, Relocation & Monte Carlo Parameters</Text>
          
          {/* Top: Monte Carlo & Volatility Settings */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Monte Carlo & Volatility Settings</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Simulation Mode:</Text>
              <Text style={styles.rowValue}>{inputs.monteCarloSettings.mode === 'historical' ? 'Historical Returns Block' : 'Synthetic (Geometric Brownian)'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Number of Trials:</Text>
              <Text style={styles.rowValue}>{inputs.monteCarloSettings.trials} runs</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Randomizer Seed:</Text>
              <Text style={styles.rowValue}>{inputs.monteCarloSettings.seed !== null ? inputs.monteCarloSettings.seed : 'Standard Random'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Equity Volatility:</Text>
              <Text style={styles.rowValue}>{formatPercent(inputs.monteCarloSettings.equityVolatility ?? 0.15)} (Annual Std Dev)</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Bond Volatility:</Text>
              <Text style={styles.rowValue}>{formatPercent(inputs.monteCarloSettings.fixedIncomeVolatility ?? 0.05)} (Annual Std Dev)</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Asset Correlation:</Text>
              <Text style={styles.rowValue}>{(inputs.monteCarloSettings.correlation ?? 0.15).toFixed(2)} (Stock / Bond)</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>CPI Inflation Modeling:</Text>
              <Text style={styles.rowValue}>
                {inputs.monteCarloSettings.randomizeCPI !== false 
                  ? 'Randomized (Historical)' 
                  : `Constant (${formatPercent(inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate)})`}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Regime Switching & Drift:</Text>
              <Text style={styles.rowValue}>
                {inputs.monteCarloSettings.enableRegimeSwitching !== false ? 'Enabled (Markov 2-State + Reversion)' : 'Disabled (Random Walk)'}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Historical Sampling:</Text>
              <Text style={styles.rowValue}>
                {inputs.monteCarloSettings.historicalSamplingStrategy === 'block' 
                  ? '100% Contiguous Blocks' 
                  : inputs.monteCarloSettings.historicalSamplingStrategy === 'random' 
                    ? '100% Random Resampling' 
                    : 'Hybrid (35% Block / 65% Random)'}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Historical Calibration:</Text>
              <Text style={styles.rowValue}>
                {inputs.monteCarloSettings.calibrateHistoricalMeans !== false ? 'Calibrated (Baseline Means)' : 'Raw History (12.3% Stock)'}
              </Text>
            </View>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Text style={styles.rowLabel}>Historical Fat Tails:</Text>
              <Text style={styles.rowValue}>
                {inputs.monteCarloSettings.enableHistoricalStudentT ? 'Student-t (df = 5)' : 'Standard (Empirical History)'}
              </Text>
            </View>
          </View>

          {/* Bottom: Side-by-side cards */}
          <View style={styles.grid}>
            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Jurisdiction Relocation</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Current Home State:</Text>
                  <Text style={styles.rowValue}>{inputs.jurisdiction.currentState}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Relocate In Retirement?:</Text>
                  <Text style={styles.rowValue}>{inputs.jurisdiction.relocationYear !== null ? 'Yes' : 'No'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Target Destination State:</Text>
                  <Text style={styles.rowValue}>{inputs.jurisdiction.targetState || 'N/A'}</Text>
                </View>
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Text style={styles.rowLabel}>Relocation Target Year:</Text>
                  <Text style={styles.rowValue}>{inputs.jurisdiction.relocationYear !== null ? inputs.jurisdiction.relocationYear : 'N/A'}</Text>
                </View>
              </View>
            </View>

            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Sequence Risk & Stress Testing</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Stress Test Status:</Text>
                  <Text style={styles.rowValue}>
                    {inputs.monteCarloSettings.stressTest?.enabled ? 'Active Custom Shock' : 'Disabled (Standard)'}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Shock Mode:</Text>
                  <Text style={styles.rowValue}>
                    {inputs.monteCarloSettings.stressTest?.enabled 
                      ? (inputs.monteCarloSettings.stressTest.mode === 'relative' ? 'Relative Delta Offset (±%)' : 'Absolute Return Override (%)') 
                      : 'N/A'}
                  </Text>
                </View>
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Text style={styles.rowLabel}>Overridden Years:</Text>
                  <Text style={styles.rowValue}>
                    {inputs.monteCarloSettings.stressTest?.enabled && inputs.monteCarloSettings.stressTest.overrides.length > 0
                      ? `${inputs.monteCarloSettings.stressTest.overrides.length} Year(s) Defined`
                      : 'None'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Section 5: Strategies & Base Living Expenses */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Withdrawal & Roth Conversion Strategy</Text>
          <View style={styles.grid}>
            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Roth Conversion Settings</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Strategy Selected:</Text>
                  <Text style={styles.rowValue}>
                    {inputs.rothConversionStrategy === 'flat' ? 'Flat Annual Conversions' : 'Fill-To-Target Bracket'}
                  </Text>
                </View>
                {inputs.rothConversionStrategy === 'flat' ? (
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Annual Conversion Value:</Text>
                    <Text style={styles.rowValue}>{formatCurrency(inputs.annualRothConversion)}/yr</Text>
                  </View>
                ) : (
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Target Income Limit (MAGI):</Text>
                    <Text style={styles.rowValue}>{formatCurrency(inputs.rothConversionTargetValue)}</Text>
                  </View>
                )}
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Start Year / End Year:</Text>
                  <Text style={styles.rowValue}>{inputs.rothConversionStartYear ?? simStartYear} / {inputs.rothConversionEndYear ?? (simStartYear + 9)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Living Expenses Summary</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Living Expenses Type:</Text>
                  <Text style={styles.rowValue}>{inputs.useDetailedExpenses ? 'Itemized Checklist' : 'Flat Annual Budget'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>
                    Annual Expense Target{inputs.useDetailedExpenses ? ' (Inactive)' : ''}:
                  </Text>
                  <Text style={[
                    styles.rowValue,
                    inputs.useDetailedExpenses ? { color: '#94a3b8', fontFamily: 'Helvetica' } : {}
                  ]}>
                    {inputs.useDetailedExpenses 
                      ? `${formatCurrency(inputs.annualLivingExpenses)}/yr (Ignored)` 
                      : `${formatCurrency(inputs.annualLivingExpenses)}/yr`
                    }
                  </Text>
                </View>
              </View>
            </View>

            {/* Charity & QCD Card */}
            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Charitable Tithe & QCD Engine</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Tithing Engine Status:</Text>
                  <Text style={styles.rowValue}>{inputs.charitySettings?.enabled ? 'Enabled' : 'Disabled'}</Text>
                </View>
                {inputs.charitySettings?.enabled && (
                  <>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Tithe % of Annual Growth:</Text>
                      <Text style={styles.rowValue}>{(((inputs.charitySettings?.growthPercentage ?? 0.10) * 100)).toFixed(1)}%</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Min Floor / Max Cap:</Text>
                      <Text style={styles.rowValue}>
                        {inputs.charitySettings?.minAnnualTithe ? formatCurrency(inputs.charitySettings.minAnnualTithe) : '$0'} / {inputs.charitySettings?.maxAnnualTithe ? formatCurrency(inputs.charitySettings.maxAnnualTithe) : 'None'}
                      </Text>
                    </View>
                    <View style={[styles.row, { borderBottomWidth: 0 }]}>
                      <Text style={styles.rowLabel}>QCD Sourcing (Age 70.5+):</Text>
                      <Text style={styles.rowValue}>{inputs.charitySettings?.useQCD !== false ? 'Active (Tax-Free IRA)' : 'Disabled'}</Text>
                    </View>
                  </>
                )}
              </View>
            </View>

            {/* Guardrail Plan Card */}
            <View style={styles.col2}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Guardrail Spending Plan</Text>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Policy Status:</Text>
                  <Text style={styles.rowValue}>{inputs.guardrailSettings?.enabled !== false ? 'Active' : 'Disabled'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Upper / Lower Guardrails:</Text>
                  <Text style={styles.rowValue}>+{(((inputs.guardrailSettings?.upperGuardrailPct ?? 0.15) * 100)).toFixed(0)}% / -{(((inputs.guardrailSettings?.lowerGuardrailPct ?? 0.15) * 100)).toFixed(0)}%</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Market Surplus Allocation:</Text>
                  <Text style={styles.rowValue}>{(((inputs.guardrailSettings?.marketSurplusSharePct ?? 0.10) * 100)).toFixed(0)}%</Text>
                </View>
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Text style={styles.rowLabel}>Actual Years Logged:</Text>
                  <Text style={styles.rowValue}>{Object.keys(inputs.actualTracking || {}).length} Year(s)</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Section 6: Healthcare details & annual totals */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>6. Detailed Healthcare Configurations & State-Level Annual Totals</Text>
          
          {hasDetailedHealthcare ? (
            <View style={styles.grid}>
              {inputs.you.healthcare && (
                <View style={styles.col2}>
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{inputs.you.name || 'Primary'}'s Detailed Healthcare</Text>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Medicare Part B Base Premium:</Text>
                      <Text style={styles.rowValue}>{inputs.you.healthcare.medicarePartBPremium !== null ? `${formatCurrency(inputs.you.healthcare.medicarePartBPremium)}/mo` : 'Default'}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateA} Pre-65 Med Premium / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.you.healthcare[stateA as 'MD' | 'FL']?.pre65MedicalPremium)} / {formatCurrency(inputs.you.healthcare[stateA as 'MD' | 'FL']?.pre65MedicalOOP)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateA} Post-65 Supp Prem / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.you.healthcare[stateA as 'MD' | 'FL']?.supplementPremium)} / {formatCurrency(inputs.you.healthcare[stateA as 'MD' | 'FL']?.supplementOOP)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateB} Pre-65 Med Premium / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.you.healthcare[stateB as 'MD' | 'FL']?.pre65MedicalPremium)} / {formatCurrency(inputs.you.healthcare[stateB as 'MD' | 'FL']?.pre65MedicalOOP)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateB} Post-65 Supp Prem / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.you.healthcare[stateB as 'MD' | 'FL']?.supplementPremium)} / {formatCurrency(inputs.you.healthcare[stateB as 'MD' | 'FL']?.supplementOOP)}</Text>
                    </View>
                    <View style={[styles.row, { borderTopWidth: 0.5, borderTopColor: '#cbd5e1', marginTop: 4, paddingTop: 4 }]}>
                      <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{stateA} Annual (Pre / Post):</Text>
                      <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{formatCurrency(youPre65_A)} / {formatCurrency(youPost65_A)}</Text>
                    </View>
                    <View style={[styles.row, { borderBottomWidth: 0 }]}>
                      <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{stateB} Annual (Pre / Post):</Text>
                      <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{formatCurrency(youPre65_B)} / {formatCurrency(youPost65_B)}</Text>
                    </View>
                  </View>
                </View>
              )}

              {!inputs.isSingleFiler && inputs.wife.healthcare && (
                <View style={styles.col2}>
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{inputs.wife.name || 'Spouse'}'s Detailed Healthcare</Text>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Medicare Part B Base Premium:</Text>
                      <Text style={styles.rowValue}>{inputs.wife.healthcare.medicarePartBPremium !== null ? `${formatCurrency(inputs.wife.healthcare.medicarePartBPremium)}/mo` : 'Default'}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateA} Pre-65 Med Premium / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.wife.healthcare[stateA as 'MD' | 'FL']?.pre65MedicalPremium)} / {formatCurrency(inputs.wife.healthcare[stateA as 'MD' | 'FL']?.pre65MedicalOOP)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateA} Post-65 Supp Prem / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.wife.healthcare[stateA as 'MD' | 'FL']?.supplementPremium)} / {formatCurrency(inputs.wife.healthcare[stateA as 'MD' | 'FL']?.supplementOOP)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateB} Pre-65 Med Premium / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.wife.healthcare[stateB as 'MD' | 'FL']?.pre65MedicalPremium)} / {formatCurrency(inputs.wife.healthcare[stateB as 'MD' | 'FL']?.pre65MedicalOOP)}</Text>
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>{stateB} Post-65 Supp Prem / OOP:</Text>
                      <Text style={styles.rowValue}>{formatCurrency(inputs.wife.healthcare[stateB as 'MD' | 'FL']?.supplementPremium)} / {formatCurrency(inputs.wife.healthcare[stateB as 'MD' | 'FL']?.supplementOOP)}</Text>
                    </View>
                    <View style={[styles.row, { borderTopWidth: 0.5, borderTopColor: '#cbd5e1', marginTop: 4, paddingTop: 4 }]}>
                      <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{stateA} Annual (Pre / Post):</Text>
                      <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{formatCurrency(wifePre65_A)} / {formatCurrency(wifePost65_A)}</Text>
                    </View>
                    <View style={[styles.row, { borderBottomWidth: 0 }]}>
                      <Text style={[styles.rowLabel, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{stateB} Annual (Pre / Post):</Text>
                      <Text style={[styles.rowValue, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>{formatCurrency(wifePre65_B)} / {formatCurrency(wifePost65_B)}</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Standard Healthcare Overview</Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Primary Pre-65 Premium:</Text>
                <Text style={styles.rowValue}>{formatCurrency(inputs.you.preMedicareMonthlyPremium)}/mo ({formatCurrency((inputs.you.preMedicareMonthlyPremium ?? 0) * 12)}/yr)</Text>
              </View>
              {!inputs.isSingleFiler && (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Spouse Pre-65 Premium:</Text>
                  <Text style={styles.rowValue}>{formatCurrency(inputs.wife.preMedicareMonthlyPremium)}/mo ({formatCurrency((inputs.wife.preMedicareMonthlyPremium ?? 0) * 12)}/yr)</Text>
                </View>
              )}
              <View style={[styles.row, { borderBottomWidth: 0 }]}>
                <Text style={styles.rowLabel}>Medicare Base Premiums (B+D):</Text>
                <Text style={styles.rowValue}>Default Base Rates ({formatCurrency(BASE_MEDICARE_PART_B_RATE + BASE_MEDICARE_PART_D_RATE)}/mo per person)</Text>
              </View>
            </View>
          )}

          {/* Household Healthcare Annual Totals Card Grid */}
          <View style={{ marginTop: 6 }}>
            <View style={styles.grid}>
              <View style={styles.col2}>
                <View style={[styles.card, { borderColor: '#bae6fd', backgroundColor: '#f0f9ff' }]}>
                  <Text style={[styles.cardTitle, { color: '#0369a1', borderBottomColor: '#bae6fd' }]}>{stateA} Healthcare Annual Totals</Text>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Pre-Medicare (Under 65):</Text>
                    <Text style={[styles.rowValue, { color: '#0f172a' }]}>{formatCurrency(totalPre65_A)}/yr ({formatCurrency(totalPre65_A / 12)}/mo)</Text>
                  </View>
                  <View style={[styles.row, { borderBottomWidth: 0 }]}>
                    <Text style={styles.rowLabel}>Post-Medicare (Age 65+):</Text>
                    <Text style={[styles.rowValue, { color: '#0f172a' }]}>{formatCurrency(totalPost65_A)}/yr ({formatCurrency(totalPost65_A / 12)}/mo)</Text>
                  </View>
                </View>
              </View>

              <View style={styles.col2}>
                <View style={[styles.card, { borderColor: '#bae6fd', backgroundColor: '#f0f9ff' }]}>
                  <Text style={[styles.cardTitle, { color: '#0369a1', borderBottomColor: '#bae6fd' }]}>{stateB} Healthcare Annual Totals</Text>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Pre-Medicare (Under 65):</Text>
                    <Text style={[styles.rowValue, { color: '#0f172a' }]}>{formatCurrency(totalPre65_B)}/yr ({formatCurrency(totalPre65_B / 12)}/mo)</Text>
                  </View>
                  <View style={[styles.row, { borderBottomWidth: 0 }]}>
                    <Text style={styles.rowLabel}>Post-Medicare (Age 65+):</Text>
                    <Text style={[styles.rowValue, { color: '#0f172a' }]}>{formatCurrency(totalPost65_B)}/yr ({formatCurrency(totalPost65_B / 12)}/mo)</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* If detailed expenses is not enabled, render Overall Total Annual Expenses section here on Page 2 */}
        {!inputs.useDetailedExpenses && renderOverallTotalExpensesSection(7)}

        <Text style={styles.footer} render={({ pageNumber }) => `Retirement Plan Configuration Summary  |  Page ${pageNumber}`} />
      </Page>

      {/* Page 3: Itemized detailed expenses & overall total expenses (if detailed expenses active) */}
      {inputs.useDetailedExpenses && (
        <Page size="LETTER" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.title}>Retirement Planner - Plan Configuration Report</Text>
            <Text style={styles.subtitle}>Generated on {dateStr} | Itemized Detailed Monthly/Annual Expenses</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>7. Detailed Expenses & Frequencies List</Text>
            
            <View style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
              <View style={styles.tableHeader}>
                <Text style={[styles.colExpName, styles.tableCellHeader]}>Expense Item Description</Text>
                <Text style={[styles.colExpCat, styles.tableCellHeader]}>Category</Text>
                <Text style={[styles.colExpFreq, styles.tableCellHeader]}>Freq/yr</Text>
                <Text style={[styles.colExpMD, styles.tableCellHeader]}>Cost ({stateA})</Text>
                <Text style={[styles.colExpFL, styles.tableCellHeader]}>Cost ({stateB})</Text>
              </View>

              {catalog.categories.map((catName) => {
                const catItems = recurringItems.filter((i) => i.category === catName);
                if (catItems.length === 0) return null;

                const subtotalA = catItems.reduce((sum, item) => {
                  const cost = costs[stateA]?.[item.id] ?? 0;
                  const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
                  return sum + cost * freq;
                }, 0);

                const subtotalB = catItems.reduce((sum, item) => {
                  const cost = costs[stateB]?.[item.id] ?? 0;
                  const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
                  return sum + cost * freq;
                }, 0);

                return (
                  <React.Fragment key={catName}>
                    {/* Category Header Row */}
                    <View style={[styles.tableRow, { backgroundColor: '#f8fafc', borderBottomColor: '#cbd5e1' }]}>
                      <Text style={[styles.colExpName, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#0369a1' }]}>
                        {catName} Expenses
                      </Text>
                      <Text style={styles.colExpCat} />
                      <Text style={styles.colExpFreq} />
                      <Text style={styles.colExpMD} />
                      <Text style={styles.colExpFL} />
                    </View>

                    {/* Expense Item Rows */}
                    {catItems.map((item) => {
                      const costA = costs[stateA]?.[item.id] ?? 0;
                      const costB = costs[stateB]?.[item.id] ?? 0;
                      const freq = frequencies[item.id] ?? item.defaultFrequency ?? 12;
                      return (
                        <View style={styles.tableRow} key={item.id}>
                          <Text style={[styles.colExpName, styles.tableCell]}>{item.name}</Text>
                          <Text style={[styles.colExpCat, styles.tableCell]}>{item.category}</Text>
                          <Text style={[styles.colExpFreq, styles.tableCell]}>{freq}x</Text>
                          <Text style={[styles.colExpMD, styles.tableCell]}>{formatCurrency(costA)}</Text>
                          <Text style={[styles.colExpFL, styles.tableCell]}>{formatCurrency(costB)}</Text>
                        </View>
                      );
                    })}

                    {/* Category Subtotal Row */}
                    <View style={[styles.tableRow, { backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#cbd5e1' }]}>
                      <Text style={[styles.colExpName, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#0284c7' }]}>
                        Subtotal ({catName} - Annualized)
                      </Text>
                      <Text style={[styles.colExpCat, styles.tableCell, { color: '#64748b' }]}>-</Text>
                      <Text style={[styles.colExpFreq, styles.tableCell, { color: '#64748b', textAlign: 'center' }]}>-</Text>
                      <Text style={[styles.colExpMD, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#0284c7' }]}>
                        {formatCurrency(subtotalA)}
                      </Text>
                      <Text style={[styles.colExpFL, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#0284c7' }]}>
                        {formatCurrency(subtotalB)}
                      </Text>
                    </View>
                  </React.Fragment>
                );
              })}

              {oneTimeItems.length > 0 && (
                <React.Fragment>
                  {/* One-Time Header Row */}
                  <View style={[styles.tableRow, { backgroundColor: '#fffbeb', borderBottomColor: '#fde68a' }]}>
                    <Text style={[styles.colExpName, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#b45309' }]}>
                      One-Time & Capital Expenses (Today's $)
                    </Text>
                    <Text style={styles.colExpCat} />
                    <Text style={styles.colExpFreq} />
                    <Text style={styles.colExpMD} />
                    <Text style={styles.colExpFL} />
                  </View>

                  {/* One-Time Item Rows */}
                  {oneTimeItems.map((item) => {
                    const costA = costs[stateA]?.[item.id] ?? 0;
                    const costB = costs[stateB]?.[item.id] ?? 0;
                    const targetYr = item.targetYear ?? (inputs.simulationStartYear || 2026);
                    return (
                      <View style={styles.tableRow} key={item.id}>
                        <Text style={[styles.colExpName, styles.tableCell, { fontFamily: 'Helvetica-Bold' }]}>{item.name}</Text>
                        <Text style={[styles.colExpCat, styles.tableCell]}>Year {targetYr}</Text>
                        <Text style={[styles.colExpFreq, styles.tableCell]}>1x</Text>
                        <Text style={[styles.colExpMD, styles.tableCell]}>{formatCurrency(costA)}</Text>
                        <Text style={[styles.colExpFL, styles.tableCell]}>{formatCurrency(costB)}</Text>
                      </View>
                    );
                  })}

                  {/* One-Time Subtotal Row */}
                  <View style={[styles.tableRow, { backgroundColor: '#fffbeb', borderBottomWidth: 1, borderBottomColor: '#fde68a' }]}>
                    <Text style={[styles.colExpName, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#b45309' }]}>
                      Total One-Time Expenses
                    </Text>
                    <Text style={[styles.colExpCat, styles.tableCell, { color: '#64748b' }]}>-</Text>
                    <Text style={[styles.colExpFreq, styles.tableCell, { color: '#64748b', textAlign: 'center' }]}>-</Text>
                    <Text style={[styles.colExpMD, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#b45309' }]}>
                      {formatCurrency(mdOneTime)}
                    </Text>
                    <Text style={[styles.colExpFL, styles.tableCell, { fontFamily: 'Helvetica-Bold', color: '#b45309' }]}>
                      {formatCurrency(flOneTime)}
                    </Text>
                  </View>
                </React.Fragment>
              )}
            </View>
          </View>

          {/* Expense Grand Totals Card Section */}
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.sectionTitle, { fontSize: 10, borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingBottom: 2, marginBottom: 5 }]}>
              Expense Grand Totals
            </Text>
            <View style={styles.grid}>
              {/* MD Totals Card */}
              <View style={styles.col2}>
                <View style={[styles.card, { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' }]}>
                  <Text style={[styles.cardTitle, { color: '#0f172a', borderBottomColor: '#cbd5e1' }]}>Maryland (MD) Totals</Text>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Recurring Monthly Cost:</Text>
                    <Text style={styles.rowValue}>{formatCurrency(mdRecurringMonthly)}/mo</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Recurring Annualized Cost:</Text>
                    <Text style={styles.rowValue}>{formatCurrency(mdRecurringAnnual)}/yr</Text>
                  </View>
                  <View style={[styles.row, { borderBottomWidth: 0 }]}>
                    <Text style={styles.rowLabel}>One-Time Setup Costs:</Text>
                    <Text style={[styles.rowValue, { color: '#b45309' }]}>{formatCurrency(mdOneTime)}</Text>
                  </View>
                </View>
              </View>

              {/* FL Totals Card */}
              <View style={styles.col2}>
                <View style={[styles.card, { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' }]}>
                  <Text style={[styles.cardTitle, { color: '#0f172a', borderBottomColor: '#cbd5e1' }]}>Florida (FL) Totals</Text>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Recurring Monthly Cost:</Text>
                    <Text style={styles.rowValue}>{formatCurrency(flRecurringMonthly)}/mo</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Recurring Annualized Cost:</Text>
                    <Text style={styles.rowValue}>{formatCurrency(flRecurringAnnual)}/yr</Text>
                  </View>
                  <View style={[styles.row, { borderBottomWidth: 0 }]}>
                    <Text style={styles.rowLabel}>One-Time Setup Costs:</Text>
                    <Text style={[styles.rowValue, { color: '#b45309' }]}>{formatCurrency(flOneTime)}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Render Overall Total Annual Expenses section here on Page 3 */}
          {renderOverallTotalExpensesSection(8)}

          <Text style={styles.footer} render={({ pageNumber }) => `Retirement Plan Configuration Summary  |  Page ${pageNumber}`} />
        </Page>
      )}
    </Document>
  );
};
