import {
  AccountStatus,
  CENTS_PER_DOLLAR,
  FundResult,
  FundStatus,
  MAX_THRESHOLD_POINTS,
  MIN_FUNDS_PER_ACCOUNT,
  REBALANCE_ACCOUNT_TYPES,
  RebalanceAccountTemplate,
  RebalanceAccountType,
  RebalanceFund,
  RebalanceOwner,
  RebalanceResult,
  RebalanceTransaction,
  TARGET_PERCENT_TOTAL,
  TARGET_SUM_TOLERANCE,
  TradeAction,
} from '../shared/types/rebalancing';

const PERCENT_SCALE = 100;
const DEVIATION_COMPARE_DECIMALS = 6; // guards the on-the-edge-is-in-band rule against float noise
const OWNER_JOINT_LABEL = 'Joint';
const OWNER_PRIMARY_FALLBACK = 'Primary';
const OWNER_SPOUSE_FALLBACK = 'Spouse';

export function toCents(amount: number): number {
  return Math.round(amount * CENTS_PER_DOLLAR);
}

export function fromCents(cents: number): number {
  return cents / CENTS_PER_DOLLAR;
}

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** Parses a user-entered dollar string, tolerating commas and dollar signs. Returns null if invalid or negative. */
export function parseDollarInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getOwnerDisplayName(
  owner: RebalanceOwner,
  primaryName?: string,
  spouseName?: string
): string {
  if (owner === 'joint') return OWNER_JOINT_LABEL;
  if (owner === 'primary') return primaryName?.trim() || OWNER_PRIMARY_FALLBACK;
  return spouseName?.trim() || OWNER_SPOUSE_FALLBACK;
}

export function getAccountName(ownerDisplayName: string, accountType: RebalanceAccountType): string {
  return `${ownerDisplayName} ${accountType}`;
}

export function sumTargets(funds: RebalanceFund[]): number {
  return funds.reduce((sum, f) => sum + (Number.isFinite(f.targetPercent) ? f.targetPercent : 0), 0);
}

export function validateTemplate(
  draft: Pick<RebalanceAccountTemplate, 'owner' | 'accountType' | 'thresholdPoints' | 'funds'> & {
    accountId?: string;
  },
  existingAccounts: RebalanceAccountTemplate[]
): string[] {
  const errors: string[] = [];

  if (!REBALANCE_ACCOUNT_TYPES.includes(draft.accountType)) {
    errors.push('Choose an account type.');
  }

  const duplicate = existingAccounts.some(
    (a) =>
      !a.archived &&
      a.accountId !== draft.accountId &&
      a.owner === draft.owner &&
      a.accountType === draft.accountType
  );
  if (duplicate) {
    errors.push('An account with this owner and account type already exists.');
  }

  if (!(draft.thresholdPoints > 0) || draft.thresholdPoints > MAX_THRESHOLD_POINTS) {
    errors.push(`Threshold must be above 0 and at most ${MAX_THRESHOLD_POINTS} percentage points.`);
  }

  if (draft.funds.length < MIN_FUNDS_PER_ACCOUNT) {
    errors.push(`At least ${MIN_FUNDS_PER_ACCOUNT} funds are required.`);
  }

  const seen = new Set<string>();
  for (const fund of draft.funds) {
    const symbol = normalizeSymbol(fund.symbol);
    if (!symbol) {
      errors.push('Every fund needs a symbol.');
    } else if (seen.has(symbol)) {
      errors.push(`Duplicate symbol ${symbol}.`);
    }
    seen.add(symbol);
    if (!Number.isFinite(fund.targetPercent) || fund.targetPercent < 0 || fund.targetPercent > TARGET_PERCENT_TOTAL) {
      errors.push(`Target for ${symbol || 'a fund'} must be between 0 and ${TARGET_PERCENT_TOTAL}.`);
    }
  }

  if (draft.funds.filter((f) => f.isCash).length > 1) {
    errors.push('Only one fund can be marked as the cash fund.');
  }

  if (Math.abs(sumTargets(draft.funds) - TARGET_PERCENT_TOTAL) > TARGET_SUM_TOLERANCE) {
    errors.push(`Target percents must sum to ${TARGET_PERCENT_TOTAL}%.`);
  }

  return Array.from(new Set(errors));
}

interface TradeLeg {
  symbol: string;
  cents: number;
}

const byLargestFirst = (a: TradeLeg, b: TradeLeg) => b.cents - a.cents;

/**
 * Turns per-fund trades into Fidelity instructions. Excess cash buys into the funds that need the
 * most money first. Remaining sells are exchanged into remaining buys, largest to largest. A sell
 * left over after that is proceeds the cash fund needs, so it is a plain sell.
 */
export function buildTransactions(
  funds: FundResult[],
  cashSymbol: string | null,
  totalCents: number
): RebalanceTransaction[] {
  const make = (
    type: RebalanceTransaction['type'],
    fromSymbol: string | null,
    toSymbol: string | null,
    cents: number
  ): RebalanceTransaction => ({
    type,
    fromSymbol,
    toSymbol,
    amount: fromCents(cents),
    percentPoints: (cents / totalCents) * PERCENT_SCALE,
  });

  const cashFund = funds.find((f) => f.symbol === cashSymbol);
  const cashNetCents = cashFund ? toCents(cashFund.tradeAmount) : 0;

  const sells: TradeLeg[] = [];
  const buys: TradeLeg[] = [];
  for (const f of funds) {
    if (f.symbol === cashSymbol) continue;
    const cents = toCents(f.tradeAmount);
    if (cents < 0) sells.push({ symbol: f.symbol, cents: -cents });
    else if (cents > 0) buys.push({ symbol: f.symbol, cents });
  }
  sells.sort(byLargestFirst);
  buys.sort(byLargestFirst);

  const cashBuys: RebalanceTransaction[] = [];
  let excessCashCents = cashNetCents < 0 ? -cashNetCents : 0;
  while (excessCashCents > 0 && buys.length > 0) {
    buys.sort(byLargestFirst);
    const target = buys[0];
    const spend = Math.min(excessCashCents, target.cents);
    cashBuys.push(make('BUY', cashSymbol, target.symbol, spend));
    target.cents -= spend;
    excessCashCents -= spend;
    if (target.cents === 0) buys.shift();
  }

  const exchanges: RebalanceTransaction[] = [];
  while (sells.length > 0 && buys.length > 0) {
    const from = sells[0];
    const to = buys[0];
    const moved = Math.min(from.cents, to.cents);
    exchanges.push(make('EXCHANGE', from.symbol, to.symbol, moved));
    from.cents -= moved;
    to.cents -= moved;
    if (from.cents === 0) sells.shift();
    if (to.cents === 0) buys.shift();
  }

  const cashSells = sells.map((s) => make('SELL', s.symbol, cashSymbol, s.cents));
  // Any buy still unmet would mean buys and sells did not net to zero, which the rounding step prevents.
  return [...cashBuys, ...exchanges, ...cashSells];
}

/**
 * Calculates fund status and full-rebalance trades. Percentages are relative to the sum of entered
 * values. Returns null when the total is not positive.
 */
export function calculateRebalance(
  funds: RebalanceFund[],
  values: Record<string, number>,
  thresholdPoints: number
): RebalanceResult | null {
  const totalCents = funds.reduce((sum, f) => sum + toCents(values[f.symbol] || 0), 0);
  if (totalCents <= 0) return null;
  const total = fromCents(totalCents);

  const rows: FundResult[] = funds.map((fund) => {
    const valueCents = toCents(values[fund.symbol] || 0);
    const currentPercent = (valueCents / totalCents) * PERCENT_SCALE;
    const deviationPoints = currentPercent - fund.targetPercent;
    let status: FundStatus = 'IN_BAND';
    const comparable = Number(deviationPoints.toFixed(DEVIATION_COMPARE_DECIMALS));
    if (comparable > thresholdPoints) status = 'HIGH';
    else if (comparable < -thresholdPoints) status = 'LOW';

    const targetCents = Math.round((totalCents * fund.targetPercent) / PERCENT_SCALE);
    return {
      symbol: fund.symbol,
      value: fromCents(valueCents),
      currentPercent,
      targetPercent: fund.targetPercent,
      deviationPoints,
      status,
      tradeAmount: fromCents(targetCents - valueCents),
      tradePercentPoints: fund.targetPercent - currentPercent,
      action: 'NONE' as TradeAction,
    };
  });

  // Rounding each target independently can leave buys and sells off by a few cents; put the
  // difference on the largest trade so the account nets to exactly zero.
  const netCents = rows.reduce((sum, r) => sum + toCents(r.tradeAmount), 0);
  let residualAdjustment = 0;
  let residualSymbol: string | null = null;
  if (netCents !== 0) {
    const largest = rows.reduce((best, r) =>
      Math.abs(r.tradeAmount) > Math.abs(best.tradeAmount) ? r : best
    );
    largest.tradeAmount = fromCents(toCents(largest.tradeAmount) - netCents);
    residualAdjustment = fromCents(-netCents);
    residualSymbol = largest.symbol;
  }

  for (const r of rows) {
    const cents = toCents(r.tradeAmount);
    r.action = cents > 0 ? 'BUY' : cents < 0 ? 'SELL' : 'NONE';
  }

  const totalSells = fromCents(rows.reduce((s, r) => (r.action === 'SELL' ? s - toCents(r.tradeAmount) : s), 0));
  const totalBuys = fromCents(rows.reduce((s, r) => (r.action === 'BUY' ? s + toCents(r.tradeAmount) : s), 0));
  const accountStatus: AccountStatus = rows.some((r) => r.status !== 'IN_BAND') ? 'NEEDED' : 'OPTIONAL';

  const cashSymbol = funds.find((f) => f.isCash)?.symbol ?? null;
  const transactions = buildTransactions(rows, cashSymbol, totalCents);

  return {
    total,
    accountStatus,
    funds: rows,
    totalSells,
    totalBuys,
    residualAdjustment,
    residualSymbol,
    transactions,
  };
}
