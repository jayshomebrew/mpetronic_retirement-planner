export const MONTHS_PER_YEAR = 12;
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const cumulate = (values: number[]): number[] => {
  let running = 0;
  return values.map((v) => (running += v));
};

export interface BudgetTrackerMetrics {
  hasElapsed: boolean;
  lastIdx: number;
  cumActual: number[];
  cumBudget: number[];
  ytdActual: number;
  ytdBudget: number;
  annualBudget: number;
  projectedYearEnd: number;
  projection: Array<number | null>;
  variance: Array<number | null>;
}

/**
 * Compares 12 monthly actuals against a 12 month budget schedule. Months after the current month
 * (for the current year) are treated as not yet elapsed. The year-end projection scales the remaining
 * budget schedule by the actual-to-budget pace so far, which respects lumpy due months.
 */
export const computeBudgetTracker = (
  monthlyActual: number[],
  monthlyBudget: number[],
  year: number,
  now: Date = new Date()
): BudgetTrackerMetrics => {
  const lastIdx = year < now.getFullYear() ? MONTHS_PER_YEAR - 1 : year > now.getFullYear() ? -1 : now.getMonth();
  const hasElapsed = lastIdx >= 0;

  const cumActual = cumulate(monthlyActual);
  const cumBudget = cumulate(monthlyBudget);
  const annualBudget = cumBudget[MONTHS_PER_YEAR - 1];
  const ytdActual = hasElapsed ? cumActual[lastIdx] : 0;
  const ytdBudget = hasElapsed ? cumBudget[lastIdx] : 0;

  const paceRatio = ytdBudget > 0 ? ytdActual / ytdBudget : 1;
  const projection: Array<number | null> = Array(MONTHS_PER_YEAR).fill(null);
  let projectedYearEnd = ytdActual;
  if (hasElapsed) {
    let running = ytdActual;
    projection[lastIdx] = running;
    for (let m = lastIdx + 1; m < MONTHS_PER_YEAR; m++) {
      running += monthlyBudget[m] * paceRatio;
      projection[m] = running;
    }
    projectedYearEnd = running;
  }

  const variance = monthlyBudget.map((b, m) => (m <= lastIdx ? b - monthlyActual[m] : null));

  return { hasElapsed, lastIdx, cumActual, cumBudget, ytdActual, ytdBudget, annualBudget, projectedYearEnd, projection, variance };
};
