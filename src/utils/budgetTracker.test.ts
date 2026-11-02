import { describe, it, expect } from 'vitest';
import { computeBudgetTracker, cumulate } from './budgetTracker';

describe('computeBudgetTracker', () => {
  const budget = Array(12).fill(100);

  it('treats a past year as fully elapsed', () => {
    const actual = Array(12).fill(120);
    const m = computeBudgetTracker(actual, budget, 2024, new Date(2026, 5, 15));
    expect(m.lastIdx).toBe(11);
    expect(m.ytdActual).toBe(1440);
    expect(m.ytdBudget).toBe(1200);
    expect(m.projectedYearEnd).toBe(1440);
  });

  it('stops at the current month and projects the rest at pace', () => {
    const actual = [150, 150, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const m = computeBudgetTracker(actual, budget, 2026, new Date(2026, 1, 10));
    expect(m.lastIdx).toBe(1);
    expect(m.ytdActual).toBe(300);
    expect(m.ytdBudget).toBe(200);
    // pace 1.5 applied to the 10 remaining budget months
    expect(m.projectedYearEnd).toBe(300 + 10 * 100 * 1.5);
    expect(m.variance[2]).toBeNull();
    expect(m.variance[0]).toBe(-50);
  });

  it('has nothing elapsed for a future year', () => {
    const m = computeBudgetTracker(Array(12).fill(0), budget, 2027, new Date(2026, 5, 15));
    expect(m.hasElapsed).toBe(false);
    expect(m.ytdActual).toBe(0);
    expect(m.projection.every((v) => v === null)).toBe(true);
  });

  it('cumulates', () => {
    expect(cumulate([1, 2, 3])).toEqual([1, 3, 6]);
  });
});
