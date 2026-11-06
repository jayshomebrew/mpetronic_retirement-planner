import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AwsCloudStorageAdapter } from '../AwsCloudStorageAdapter';
import { InMemoryStorageAdapter } from '../InMemoryStorageAdapter';
import { AuthService } from '../../auth/AuthService';

import { IndexedDbStorageAdapter } from '../IndexedDbStorageAdapter';

const createMockStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

describe('AwsCloudStorageAdapter', () => {
  let adapter: AwsCloudStorageAdapter;
  let mockLocal: InMemoryStorageAdapter;

  beforeEach(() => {
    const mockStorage = createMockStorage();
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('navigator', {
      onLine: true,
    });
    AuthService.signOut();
    vi.restoreAllMocks();
    mockLocal = new InMemoryStorageAdapter();
    adapter = new AwsCloudStorageAdapter(mockLocal as unknown as IndexedDbStorageAdapter);
  });

  it('saves and retrieves expenses locally', async () => {
    const expense = await adapter.saveExpense({
      date: '2026-09-25',
      amount: 45.5,
      categoryId: 'cat_groceries',
      categoryName: 'Living - Groceries',
      enteredBy: 'Mike',
    });

    expect(expense.expenseId).toBeDefined();
    expect(expense.syncStatus).toBe('PENDING_SYNC');

    const expenses = await adapter.getExpenses(2026, 9);
    expect(expenses.length).toBe(1);
    expect(expenses[0].amount).toBe(45.5);
  });

  it('saves and retrieves categories', async () => {
    const category = await adapter.saveCategory({
      id: 'cat_coffee',
      name: 'Living - Coffee',
      plannedMonthlyDefault: 50,
    });

    expect(category.id).toBe('cat_coffee');
    const allCats = await adapter.getCategories();
    expect(allCats.some(c => c.id === 'cat_coffee')).toBe(true);
  });

  it('keeps a locally created category when its cloud push failed, then retries it', async () => {
    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response);

    await adapter.saveCategory({ id: 'item_custom_1', name: 'Leisure - Hobbies', plannedMonthlyDefault: 0, isCustom: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    // Refresh from the cloud, which does not have the category yet; the retry push succeeds
    fetchSpy
      .mockResolvedValueOnce({ ok: true, json: async () => ({ categories: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) } as unknown as Response);
    const cats = await adapter.getCategories(true);

    expect(cats.some(c => c.id === 'item_custom_1')).toBe(true);
    const pushes = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(pushes.length).toBe(2);
  });

  it('flushes pending expenses when authenticated', async () => {
    // Save expense while unauthenticated
    await adapter.saveExpense({
      date: '2026-09-25',
      amount: 100,
      categoryId: 'cat_dining',
      categoryName: 'Leisure - Dining',
      enteredBy: 'Mike',
    });

    const pendingBefore = await adapter.getPendingSyncExpenses();
    expect(pendingBefore.length).toBe(1);

    // Authenticate
    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');

    // Mock API Gateway batch response
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', count: 1 }),
    } as unknown as Response);

    const result = await adapter.flushPendingExpenses();
    expect(result.syncedCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const pendingAfter = await adapter.getPendingSyncExpenses();
    expect(pendingAfter.length).toBe(0);
  });

  it('updates an existing expense and flushes updates to cloud', async () => {
    const saved = await adapter.saveExpense({
      date: '2026-09-10',
      amount: 50,
      categoryId: 'cat_groceries',
      categoryName: 'Groceries',
      enteredBy: 'Mike',
    });

    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' }),
    } as unknown as Response);

    const updated = await adapter.updateExpense(saved.expenseId, {
      amount: 75.25,
      notes: 'Weekly groceries at Trader Joes',
    });

    expect(updated.amount).toBe(75.25);
    expect(updated.notes).toBe('Weekly groceries at Trader Joes');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('deletes old remote item if date month/year changed during update', async () => {
    const saved = await adapter.saveExpense({
      date: '2026-08-25',
      amount: 30,
      categoryId: 'cat_fuel',
      categoryName: 'Fuel',
      enteredBy: 'Mike',
    });

    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' }),
    } as unknown as Response);

    await adapter.updateExpense(saved.expenseId, {
      date: '2026-09-02',
    });

    // First fetch should be DELETE /api/expenses/{id}
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/api/expenses/${encodeURIComponent(saved.expenseId)}`),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('updates multiple expenses in batch and triggers a single cloud flush', async () => {
    const exp1 = await adapter.saveExpense({
      date: '2026-09-01',
      amount: 20,
      categoryId: 'cat_coffee',
      categoryName: 'Living - Coffee',
      enteredBy: 'Mike',
    });
    const exp2 = await adapter.saveExpense({
      date: '2026-09-02',
      amount: 40,
      categoryId: 'cat_dining',
      categoryName: 'Leisure - Dining',
      enteredBy: 'Mike',
    });

    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' }),
    } as unknown as Response);

    const updated = await adapter.updateExpensesBatch([
      { id: exp1.expenseId, updates: { category: 'Miscellaneous', name: 'Gifts' } },
      { id: exp2.expenseId, updates: { category: 'Miscellaneous', name: 'Gifts' } },
    ]);

    expect(updated.length).toBe(2);
    expect(updated[0].category).toBe('Miscellaneous');
    expect(updated[0].name).toBe('Gifts');
    expect(updated[1].category).toBe('Miscellaneous');
    expect(updated[1].name).toBe('Gifts');

    // flushPendingExpenses was called once for the batch
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/expenses/batch'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('does not overwrite newer local edits with stale remote snapshots during cloud sync', async () => {
    // Local record already flushed (SYNCED) with a newer edit at 12:00, so the
    // pending-ID guard cannot protect it; only the timestamp guard can.
    const saved = await mockLocal.saveExpense({
      date: '2026-09-05',
      amount: 50,
      categoryId: 'cat_misc_gifts',
      categoryName: 'Miscellaneous - Gifts',
      category: 'Miscellaneous',
      name: 'Gifts',
      enteredBy: 'Mike',
      createdAt: '2026-09-05T10:00:00.000Z',
      updatedAt: '2026-09-05T12:00:00.000Z',
      syncStatus: 'SYNCED',
    });

    vi.spyOn(AuthService, 'isAuthenticated').mockReturnValue(true);
    vi.spyOn(AuthService, 'getIdToken').mockResolvedValue('mock_token');

    // Remote returns older snapshot from 10:00
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          expenseId: saved.expenseId,
          date: '2026-09-05',
          amount: 50,
          categoryId: 'cat_phone',
          categoryName: 'Home - Cell Phone',
          enteredBy: 'Mike',
          createdAt: '2026-09-05T10:00:00.000Z',
          updatedAt: '2026-09-05T10:00:00.000Z',
        },
      ],
    } as unknown as Response);

    const expenses = await adapter.getExpenses(2026, 9);
    expect(expenses.length).toBe(1);
    // Should preserve newer local edit
    expect(expenses[0].category).toBe('Miscellaneous');
    expect(expenses[0].name).toBe('Gifts');
  });
});
